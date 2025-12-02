/**
 * PayoutService - Commission and settlement tracking
 *
 * Per PRD_PAYOUTS:
 * - Track commissions/revenue splits between destination and source
 * - Generate payouts with configurable fees/commissions
 * - Payout lifecycle: OPEN -> PAID -> RECEIVED (or DELETED)
 * - No actual payment transfer - just tracking
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';

// Payout status
export type PayoutStatus = 'OPEN' | 'PAID' | 'RECEIVED' | 'DELETED';

// Fee types
export type ShippingFeeType = 'NONE' | 'ORDER_SHIPPING' | 'FLAT';
export type ProcessingFeeType = 'NONE' | 'FLAT' | 'PERCENT' | 'FLAT_PLUS_PERCENT';
export type CommissionType = 'FLAT' | 'PERCENT';

export interface PayoutSettings {
  includesTax: boolean;
  shippingFeeType: ShippingFeeType;
  shippingFeeFlat: number;
  processingFeeType: ProcessingFeeType;
  processingFeeFlat: number;
  processingFeePercent: number;
  commissionType: CommissionType;
  commissionValue: number;
}

export interface PayableOrder {
  orderId: string;
  orderName: string;
  orderDate: Date;
  fulfillmentStatus: string;
  financialStatus: string;
  subtotal: number;
  shipping: number;
  totalTax: number;
  currency: string;
  lineItems: PayableLineItem[];
}

export interface PayableLineItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isSynced: boolean; // Is this product synced from the source?
  productMappingId?: string;
}

export interface CreatePayoutResult {
  success: boolean;
  payoutId?: string;
  payoutNumber?: string;
  error?: string;
}

export interface PayoutCalculation {
  subtotal: number;
  shippingFees: number;
  processingFees: number;
  commissionAmount: number;
  adjustments: number;
  total: number; // Amount due to source
}

class PayoutServiceClass {
  /**
   * Get or create default payout settings for a shop
   */
  async getSettings(shopId: string, targetShopId?: string): Promise<PayoutSettings> {
    // Try to find specific settings for this target
    let settings = await prisma.payoutSettings.findUnique({
      where: {
        shopId_targetShopId: {
          shopId,
          targetShopId: targetShopId || '',
        },
      },
    });

    // Fall back to default settings (no target)
    if (!settings && targetShopId) {
      settings = await prisma.payoutSettings.findFirst({
        where: {
          shopId,
          targetShopId: null,
        },
      });
    }

    // Return defaults if no settings found
    if (!settings) {
      return {
        includesTax: false,
        shippingFeeType: 'NONE',
        shippingFeeFlat: 0,
        processingFeeType: 'NONE',
        processingFeeFlat: 0,
        processingFeePercent: 0,
        commissionType: 'PERCENT',
        commissionValue: 0,
      };
    }

    return {
      includesTax: settings.includesTax,
      shippingFeeType: settings.shippingFeeType as ShippingFeeType,
      shippingFeeFlat: Number(settings.shippingFeeFlat),
      processingFeeType: settings.processingFeeType as ProcessingFeeType,
      processingFeeFlat: Number(settings.processingFeeFlat),
      processingFeePercent: Number(settings.processingFeePercent),
      commissionType: settings.commissionType as CommissionType,
      commissionValue: Number(settings.commissionValue),
    };
  }

  /**
   * Save payout settings for a shop
   */
  async saveSettings(
    shopId: string,
    settings: Partial<PayoutSettings>,
    targetShopId?: string
  ): Promise<void> {
    await prisma.payoutSettings.upsert({
      where: {
        shopId_targetShopId: {
          shopId,
          targetShopId: targetShopId || '',
        },
      },
      create: {
        shopId,
        targetShopId: targetShopId || null,
        includesTax: settings.includesTax ?? false,
        shippingFeeType: settings.shippingFeeType ?? 'NONE',
        shippingFeeFlat: settings.shippingFeeFlat ?? 0,
        processingFeeType: settings.processingFeeType ?? 'NONE',
        processingFeeFlat: settings.processingFeeFlat ?? 0,
        processingFeePercent: settings.processingFeePercent ?? 0,
        commissionType: settings.commissionType ?? 'PERCENT',
        commissionValue: settings.commissionValue ?? 0,
      },
      update: {
        includesTax: settings.includesTax,
        shippingFeeType: settings.shippingFeeType,
        shippingFeeFlat: settings.shippingFeeFlat,
        processingFeeType: settings.processingFeeType,
        processingFeeFlat: settings.processingFeeFlat,
        processingFeePercent: settings.processingFeePercent,
        commissionType: settings.commissionType,
        commissionValue: settings.commissionValue,
      },
    });
  }

  /**
   * Get payable orders for a connection (destination's fulfilled orders with synced products)
   */
  async getPayableOrders(
    connectionId: string,
    filters?: {
      fulfillmentStatus?: string;
      financialStatus?: string;
      startDate?: Date;
      endDate?: Date;
      excludeInPayout?: boolean;
    }
  ): Promise<PayableOrder[]> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Get synced product IDs for this connection
    const mappings = await prisma.productMapping.findMany({
      where: {
        connectionId,
        status: 'ACTIVE',
        retailerShopifyProductId: { not: null },
      },
      select: {
        id: true,
        retailerShopifyProductId: true,
        retailerShopifyVariantId: true,
      },
    });

    const syncedProductIds = new Set(
      mappings.map((m) => m.retailerShopifyProductId).filter(Boolean)
    );

    if (syncedProductIds.size === 0) {
      return [];
    }

    // Get orders already included in payouts (to exclude)
    let excludedOrderIds = new Set<string>();
    if (filters?.excludeInPayout) {
      const existingPayouts = await prisma.payout.findMany({
        where: {
          connectionId,
          status: { not: 'DELETED' },
        },
        select: { includedOrderIds: true },
      });

      for (const payout of existingPayouts) {
        const orderIds = payout.includedOrderIds as string[];
        orderIds.forEach((id) => excludedOrderIds.add(id));
      }
    }

    // Fetch orders from Shopify
    const client = createShopifyGraphQLClient(
      connection.retailerShop.myshopifyDomain,
      connection.retailerShop.accessToken
    );

    // Build query filters
    let queryFilter = 'status:any';
    if (filters?.fulfillmentStatus) {
      queryFilter += ` fulfillment_status:${filters.fulfillmentStatus}`;
    }
    if (filters?.financialStatus) {
      queryFilter += ` financial_status:${filters.financialStatus}`;
    }
    if (filters?.startDate) {
      queryFilter += ` created_at:>=${filters.startDate.toISOString().split('T')[0]}`;
    }
    if (filters?.endDate) {
      queryFilter += ` created_at:<=${filters.endDate.toISOString().split('T')[0]}`;
    }

    const query = `
      query getOrders($query: String!) {
        orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              displayFinancialStatus
              subtotalPriceSet { shopMoney { amount currencyCode } }
              totalShippingPriceSet { shopMoney { amount } }
              totalTaxSet { shopMoney { amount } }
              lineItems(first: 100) {
                edges {
                  node {
                    id
                    title
                    variantTitle
                    sku
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    product { id }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query, {
        variables: { query: queryFilter },
      });

      const payableOrders: PayableOrder[] = [];

      for (const edge of response.orders?.edges || []) {
        const order = edge.node;
        const orderId = order.id.replace('gid://shopify/Order/', '');

        // Skip if already in a payout
        if (excludedOrderIds.has(orderId) || excludedOrderIds.has(order.id)) {
          continue;
        }

        // Check if order has any synced products
        const lineItems: PayableLineItem[] = [];
        let hasSyncedProduct = false;

        for (const lineEdge of order.lineItems?.edges || []) {
          const line = lineEdge.node;
          const productGid = line.product?.id;
          const productId = productGid?.replace('gid://shopify/Product/', '');
          const isSynced = productId && syncedProductIds.has(productId);

          if (isSynced) {
            hasSyncedProduct = true;
          }

          // Find mapping for commission override
          const mapping = mappings.find(
            (m) => m.retailerShopifyProductId === productId
          );

          const unitPrice = parseFloat(line.originalUnitPriceSet?.shopMoney?.amount || '0');

          lineItems.push({
            id: line.id,
            productTitle: line.title,
            variantTitle: line.variantTitle,
            sku: line.sku,
            quantity: line.quantity,
            unitPrice,
            lineTotal: unitPrice * line.quantity,
            isSynced,
            productMappingId: mapping?.id,
          });
        }

        // Only include orders with synced products
        if (hasSyncedProduct) {
          payableOrders.push({
            orderId: order.id,
            orderName: order.name,
            orderDate: new Date(order.createdAt),
            fulfillmentStatus: order.displayFulfillmentStatus,
            financialStatus: order.displayFinancialStatus,
            subtotal: parseFloat(order.subtotalPriceSet?.shopMoney?.amount || '0'),
            shipping: parseFloat(order.totalShippingPriceSet?.shopMoney?.amount || '0'),
            totalTax: parseFloat(order.totalTaxSet?.shopMoney?.amount || '0'),
            currency: order.subtotalPriceSet?.shopMoney?.currencyCode || 'USD',
            lineItems,
          });
        }
      }

      return payableOrders;
    } catch (error) {
      logger.error('Error fetching payable orders:', error);
      throw error;
    }
  }

  /**
   * Calculate payout amounts based on settings
   */
  calculatePayout(
    orders: PayableOrder[],
    settings: PayoutSettings,
    options?: { excludeOrderIds?: Set<string> }
  ): PayoutCalculation {
    let subtotal = 0;
    let orderCount = 0;

    // Sum up synced line items only
    for (const order of orders) {
      if (options?.excludeOrderIds?.has(order.orderId)) {
        continue;
      }

      for (const line of order.lineItems) {
        if (line.isSynced) {
          subtotal += line.lineTotal;
        }
      }
      orderCount++;
    }

    // Calculate shipping fees
    let shippingFees = 0;
    switch (settings.shippingFeeType) {
      case 'ORDER_SHIPPING':
        shippingFees = orders
          .filter((o) => !options?.excludeOrderIds?.has(o.orderId))
          .reduce((sum, o) => sum + o.shipping, 0);
        break;
      case 'FLAT':
        shippingFees = settings.shippingFeeFlat * orderCount;
        break;
    }

    // Calculate processing fees
    let processingFees = 0;
    const totalAmount = subtotal + shippingFees;
    switch (settings.processingFeeType) {
      case 'FLAT':
        processingFees = settings.processingFeeFlat * orderCount;
        break;
      case 'PERCENT':
        processingFees = totalAmount * (settings.processingFeePercent / 100);
        break;
      case 'FLAT_PLUS_PERCENT':
        processingFees =
          settings.processingFeeFlat * orderCount +
          totalAmount * (settings.processingFeePercent / 100);
        break;
    }

    // Calculate commission (destination keeps this)
    let commissionAmount = 0;
    switch (settings.commissionType) {
      case 'FLAT':
        commissionAmount = settings.commissionValue * orderCount;
        break;
      case 'PERCENT':
        commissionAmount = subtotal * (settings.commissionValue / 100);
        break;
    }

    // Total due to source = subtotal + shipping - processing fees - commission
    const total = subtotal + shippingFees - processingFees - commissionAmount;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      shippingFees: Math.round(shippingFees * 100) / 100,
      processingFees: Math.round(processingFees * 100) / 100,
      commissionAmount: Math.round(commissionAmount * 100) / 100,
      adjustments: 0,
      total: Math.round(total * 100) / 100,
    };
  }

  /**
   * Create a new payout
   */
  async createPayout(
    connectionId: string,
    orderIds: string[],
    options?: { notes?: string }
  ): Promise<CreatePayoutResult> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        retailerShop: true,
        supplierShop: true,
      },
    });

    if (!connection) {
      return { success: false, error: 'Connection not found' };
    }

    // Get settings
    const settings = await this.getSettings(
      connection.retailerShopId,
      connection.supplierShopId
    );

    // Fetch order details
    const payableOrders = await this.getPayableOrders(connectionId);
    const selectedOrders = payableOrders.filter((o) =>
      orderIds.includes(o.orderId) || orderIds.includes(o.orderId.replace('gid://shopify/Order/', ''))
    );

    if (selectedOrders.length === 0) {
      return { success: false, error: 'No valid orders selected' };
    }

    // Calculate amounts
    const calculation = this.calculatePayout(selectedOrders, settings);

    // Generate payout number
    const payoutCount = await prisma.payout.count({
      where: { connectionId },
    });
    const payoutNumber = `PAY-${connection.id.slice(0, 6).toUpperCase()}-${String(payoutCount + 1).padStart(4, '0')}`;

    // Create payout with lines
    const payout = await prisma.payout.create({
      data: {
        connectionId,
        payoutNumber,
        subtotal: calculation.subtotal,
        shippingFees: calculation.shippingFees,
        processingFees: calculation.processingFees,
        commissionAmount: calculation.commissionAmount,
        adjustments: 0,
        total: calculation.total,
        currency: selectedOrders[0].currency,
        status: 'OPEN',
        includedOrderIds: selectedOrders.map((o) => o.orderId),
        settingsSnapshot: settings as any,
        notes: options?.notes,
        lines: {
          create: selectedOrders.flatMap((order) =>
            order.lineItems
              .filter((line) => line.isSynced)
              .map((line) => ({
                shopifyOrderId: order.orderId,
                shopifyOrderName: order.orderName,
                productTitle: line.productTitle,
                variantTitle: line.variantTitle,
                sku: line.sku,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
              }))
          ),
        },
      },
    });

    logger.info(`Created payout ${payoutNumber} for connection ${connectionId}: $${calculation.total}`);

    return {
      success: true,
      payoutId: payout.id,
      payoutNumber: payout.payoutNumber,
    };
  }

  /**
   * Get a payout with details
   */
  async getPayout(payoutId: string): Promise<any> {
    return prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        lines: true,
        connection: {
          include: {
            supplierShop: true,
            retailerShop: true,
          },
        },
      },
    });
  }

  /**
   * Get payouts for a connection
   */
  async getPayouts(
    connectionId: string,
    filters?: {
      status?: PayoutStatus;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<any[]> {
    const where: any = { connectionId };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.startDate) {
      where.createdAt = { ...where.createdAt, gte: filters.startDate };
    }
    if (filters?.endDate) {
      where.createdAt = { ...where.createdAt, lte: filters.endDate };
    }

    return prisma.payout.findMany({
      where,
      include: {
        lines: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Mark payout as paid (destination marks when they've sent payment)
   */
  async markPaid(payoutId: string): Promise<{ success: boolean; error?: string }> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      return { success: false, error: 'Payout not found' };
    }

    if (payout.status !== 'OPEN') {
      return { success: false, error: `Cannot mark ${payout.status} payout as paid` };
    }

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
    });

    logger.info(`Marked payout ${payout.payoutNumber} as paid`);

    return { success: true };
  }

  /**
   * Mark payout as received (source marks when they've received payment)
   */
  async markReceived(payoutId: string): Promise<{ success: boolean; error?: string }> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      return { success: false, error: 'Payout not found' };
    }

    if (payout.status !== 'PAID') {
      return { success: false, error: `Cannot mark ${payout.status} payout as received` };
    }

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: 'RECEIVED',
        receivedAt: new Date(),
      },
    });

    logger.info(`Marked payout ${payout.payoutNumber} as received`);

    return { success: true };
  }

  /**
   * Delete a payout (only OPEN payouts can be deleted)
   */
  async deletePayout(payoutId: string): Promise<{ success: boolean; error?: string }> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      return { success: false, error: 'Payout not found' };
    }

    if (payout.status !== 'OPEN') {
      return { success: false, error: `Cannot delete ${payout.status} payout` };
    }

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: 'DELETED',
      },
    });

    logger.info(`Deleted payout ${payout.payoutNumber}`);

    return { success: true };
  }

  /**
   * Add adjustment to a payout
   */
  async addAdjustment(
    payoutId: string,
    amount: number,
    reason: string
  ): Promise<{ success: boolean; newTotal?: number; error?: string }> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      return { success: false, error: 'Payout not found' };
    }

    if (payout.status !== 'OPEN') {
      return { success: false, error: `Cannot adjust ${payout.status} payout` };
    }

    const newAdjustments = Number(payout.adjustments) + amount;
    const newTotal = Number(payout.total) + amount;

    // Add comment about adjustment
    const comments = (payout.comments as any[]) || [];
    comments.push({
      author: 'system',
      message: `Adjustment: ${amount >= 0 ? '+' : ''}$${amount.toFixed(2)} - ${reason}`,
      timestamp: new Date().toISOString(),
    });

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        adjustments: newAdjustments,
        total: newTotal,
        comments,
      },
    });

    return { success: true, newTotal };
  }

  /**
   * Add a comment to a payout
   */
  async addComment(
    payoutId: string,
    author: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      return { success: false, error: 'Payout not found' };
    }

    const comments = (payout.comments as any[]) || [];
    comments.push({
      author,
      message,
      timestamp: new Date().toISOString(),
    });

    await prisma.payout.update({
      where: { id: payoutId },
      data: { comments },
    });

    return { success: true };
  }

  /**
   * Exclude/include a line item from payout calculation
   */
  async toggleLineExclusion(
    lineId: string,
    excluded: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const line = await prisma.payoutLine.findUnique({
      where: { id: lineId },
      include: { payout: true },
    });

    if (!line) {
      return { success: false, error: 'Line not found' };
    }

    if (line.payout.status !== 'OPEN') {
      return { success: false, error: 'Cannot modify non-open payout' };
    }

    await prisma.payoutLine.update({
      where: { id: lineId },
      data: { excluded },
    });

    // Recalculate payout totals
    await this.recalculatePayout(line.payoutId);

    return { success: true };
  }

  /**
   * Recalculate payout totals based on non-excluded lines
   */
  private async recalculatePayout(payoutId: string): Promise<void> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: { lines: true },
    });

    if (!payout) return;

    const settings = (payout.settingsSnapshot as unknown as PayoutSettings) || {
      shippingFeeType: 'NONE',
      shippingFeeFlat: 0,
      processingFeeType: 'NONE',
      processingFeeFlat: 0,
      processingFeePercent: 0,
      commissionType: 'PERCENT',
      commissionValue: 0,
    };

    // Sum non-excluded lines
    const activeLines = payout.lines.filter((l) => !l.excluded);
    const subtotal = activeLines.reduce((sum, l) => sum + Number(l.lineTotal), 0);

    // Unique orders for per-order fees
    const uniqueOrders = new Set(activeLines.map((l) => l.shopifyOrderId));
    const orderCount = uniqueOrders.size;

    // Calculate fees (simplified - doesn't re-fetch shipping from orders)
    let shippingFees = 0;
    if (settings.shippingFeeType === 'FLAT') {
      shippingFees = settings.shippingFeeFlat * orderCount;
    }

    let processingFees = 0;
    const totalAmount = subtotal + shippingFees;
    switch (settings.processingFeeType) {
      case 'FLAT':
        processingFees = settings.processingFeeFlat * orderCount;
        break;
      case 'PERCENT':
        processingFees = totalAmount * (settings.processingFeePercent / 100);
        break;
      case 'FLAT_PLUS_PERCENT':
        processingFees =
          settings.processingFeeFlat * orderCount +
          totalAmount * (settings.processingFeePercent / 100);
        break;
    }

    let commissionAmount = 0;
    switch (settings.commissionType) {
      case 'FLAT':
        commissionAmount = settings.commissionValue * orderCount;
        break;
      case 'PERCENT':
        commissionAmount = subtotal * (settings.commissionValue / 100);
        break;
    }

    const total = subtotal + shippingFees - processingFees - commissionAmount + Number(payout.adjustments);

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        subtotal: Math.round(subtotal * 100) / 100,
        shippingFees: Math.round(shippingFees * 100) / 100,
        processingFees: Math.round(processingFees * 100) / 100,
        commissionAmount: Math.round(commissionAmount * 100) / 100,
        total: Math.round(total * 100) / 100,
      },
    });
  }

  /**
   * Refresh a payout to incorporate order edits (for unpaid payouts)
   */
  async refreshPayout(payoutId: string): Promise<{ success: boolean; changes?: string[]; error?: string }> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        lines: true,
        connection: {
          include: { retailerShop: true },
        },
      },
    });

    if (!payout) {
      return { success: false, error: 'Payout not found' };
    }

    if (payout.status !== 'OPEN') {
      return { success: false, error: 'Can only refresh open payouts' };
    }

    const changes: string[] = [];

    // Re-fetch orders from Shopify
    const orderIds = payout.includedOrderIds as string[];
    const payableOrders = await this.getPayableOrders(payout.connectionId);
    const currentOrders = payableOrders.filter((o) =>
      orderIds.includes(o.orderId) || orderIds.includes(o.orderId.replace('gid://shopify/Order/', ''))
    );

    // Check for changes
    for (const order of currentOrders) {
      const existingLines = payout.lines.filter((l) => l.shopifyOrderId === order.orderId);

      for (const line of order.lineItems) {
        if (!line.isSynced) continue;

        const existing = existingLines.find(
          (l) => l.productTitle === line.productTitle && l.sku === line.sku
        );

        if (!existing) {
          changes.push(`New line item added: ${line.productTitle}`);
        } else if (existing.quantity !== line.quantity) {
          changes.push(`Quantity changed for ${line.productTitle}: ${existing.quantity} -> ${line.quantity}`);
        } else if (Number(existing.lineTotal) !== line.lineTotal) {
          changes.push(`Price changed for ${line.productTitle}: $${existing.lineTotal} -> $${line.lineTotal}`);
        }
      }
    }

    if (changes.length > 0) {
      // Delete old lines and recreate
      await prisma.payoutLine.deleteMany({
        where: { payoutId },
      });

      await prisma.payoutLine.createMany({
        data: currentOrders.flatMap((order) =>
          order.lineItems
            .filter((line) => line.isSynced)
            .map((line) => ({
              payoutId,
              shopifyOrderId: order.orderId,
              shopifyOrderName: order.orderName,
              productTitle: line.productTitle,
              variantTitle: line.variantTitle,
              sku: line.sku,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            }))
        ),
      });

      // Recalculate totals
      await this.recalculatePayout(payoutId);

      // Add comment about refresh
      await this.addComment(
        payoutId,
        'system',
        `Payout refreshed. Changes: ${changes.join('; ')}`
      );
    }

    logger.info(`Refreshed payout ${payout.payoutNumber}: ${changes.length} changes`);

    return { success: true, changes };
  }

  /**
   * Get payout summary stats for a connection
   */
  async getStats(connectionId: string): Promise<{
    totalPayouts: number;
    openPayouts: number;
    paidPayouts: number;
    receivedPayouts: number;
    totalPaid: number;
    totalPending: number;
  }> {
    const [totalPayouts, openPayouts, paidPayouts, receivedPayouts] = await Promise.all([
      prisma.payout.count({ where: { connectionId, status: { not: 'DELETED' } } }),
      prisma.payout.count({ where: { connectionId, status: 'OPEN' } }),
      prisma.payout.count({ where: { connectionId, status: 'PAID' } }),
      prisma.payout.count({ where: { connectionId, status: 'RECEIVED' } }),
    ]);

    const openPayoutsTotals = await prisma.payout.aggregate({
      where: { connectionId, status: 'OPEN' },
      _sum: { total: true },
    });

    const paidPayoutsTotals = await prisma.payout.aggregate({
      where: { connectionId, status: { in: ['PAID', 'RECEIVED'] } },
      _sum: { total: true },
    });

    return {
      totalPayouts,
      openPayouts,
      paidPayouts,
      receivedPayouts,
      totalPaid: Number(paidPayoutsTotals._sum.total || 0),
      totalPending: Number(openPayoutsTotals._sum.total || 0),
    };
  }
}

export const PayoutService = new PayoutServiceClass();
