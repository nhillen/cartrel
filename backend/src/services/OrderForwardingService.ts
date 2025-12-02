/**
 * OrderForwardingService - Handles order forwarding from retailers to suppliers
 *
 * Phase 5 Order Forwarding:
 * - Manual/auto forwarding per connection
 * - Shadow mode (preview) for order push testing
 * - Shipping rules/tags with $0 order workaround
 * - Bulk push for errors/on-hold orders
 * - Fulfillment/tracking sync back
 * - POS/local pickup exclusion
 * - Idempotency for duplicate prevention
 * - Error surfaces with detailed messages
 *
 * Per PRD_ORDER_PUSH_SHADOW_MODE
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { ConnectionHealthService } from './ConnectionHealthService';
import { PurchaseOrderStatus, OrderTriggerPolicy, SyncMode } from '@prisma/client';

// Order forwarding mode
export type OrderForwardingMode = 'MANUAL' | 'AUTO' | 'SHADOW';

// Order push status
export type OrderPushStatus =
  | 'NOT_PUSHED'
  | 'SHADOWED'
  | 'PUSHED'
  | 'FAILED'
  | 'EXCLUDED';

// Push failure reasons
export type PushFailureReason =
  | 'MISSING_CUSTOMER'
  | 'UNSYNCED_PRODUCT'
  | 'LOCATION_MISMATCH'
  | 'QUANTITY_EDITED'
  | 'API_ERROR'
  | 'FULFILLED_OR_ARCHIVED'
  | 'ZERO_TOTAL'
  | 'POS_ORDER'
  | 'LOCAL_PICKUP'
  | 'CATALOG_ONLY_MODE';

// Order push result
export interface OrderPushResult {
  success: boolean;
  orderId: string;
  status: OrderPushStatus;
  supplierOrderId?: string;
  supplierDraftOrderId?: string;
  error?: string;
  failureReason?: PushFailureReason;
}

// Shipping rules configuration
export interface ShippingRules {
  zeroOrderWorkaround: boolean; // Add $0.01 shipping for $0 orders
  defaultShippingFee?: number;
  shippingTags?: Record<string, string>; // Map shipping rate name to custom tag
  includeShippingCost?: boolean;
}

interface LineItem {
  variantId: string;
  quantity: number;
  price: string;
  title?: string;
  sku?: string;
}

interface ShippingAddress {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone?: string;
}

interface DraftOrderLineItem {
  variantId: string;
  quantity: number;
  originalUnitPrice?: string;
}

export class OrderForwardingService {
  /**
   * Create a draft order in the supplier's Shopify when retailer submits a PO
   */
  static async createDraftOrderInSupplierShop(
    purchaseOrderId: string
  ): Promise<string> {
    try {
      logger.info(`Creating draft order for PO ${purchaseOrderId}`);

      // Get the purchase order with all related data
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          supplierShop: true,
          retailerShop: true,
          connection: true,
        },
      });

      if (!po) {
        throw new Error(`Purchase order ${purchaseOrderId} not found`);
      }

      // Extract line items from JSON
      const items = po.items as unknown as LineItem[];

      if (!items || items.length === 0) {
        throw new Error(`Purchase order ${purchaseOrderId} has no items`);
      }

      // Extract shipping address
      const shippingAddress = po.shippingAddress as unknown as ShippingAddress;

      // Create Shopify GraphQL client for supplier
      const client = createShopifyGraphQLClient(
        po.supplierShop.myshopifyDomain,
        po.supplierShop.accessToken
      );

      // Build line items for draft order
      const lineItems: DraftOrderLineItem[] = items.map((item) => ({
        variantId: `gid://shopify/ProductVariant/${item.variantId}`,
        quantity: item.quantity,
        originalUnitPrice: item.price, // Wholesale price
      }));

      // Create draft order mutation
      const mutation = `
        mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              name
              invoiceUrl
              totalPrice
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          lineItems,
          shippingAddress: {
            firstName: shippingAddress.firstName,
            lastName: shippingAddress.lastName,
            address1: shippingAddress.address1,
            address2: shippingAddress.address2 || '',
            city: shippingAddress.city,
            province: shippingAddress.province,
            country: shippingAddress.country,
            zip: shippingAddress.zip,
            phone: shippingAddress.phone || '',
          },
          note: `Wholesale order from ${po.retailerShop.myshopifyDomain} - PO #${po.poNumber}`,
          tags: ['wholesale', 'cartrel', `po-${po.poNumber}`],
          customAttributes: [
            {
              key: 'cartrel_po_id',
              value: po.id,
            },
            {
              key: 'cartrel_po_number',
              value: po.poNumber,
            },
            {
              key: 'retailer_shop',
              value: po.retailerShop.myshopifyDomain,
            },
          ],
        },
      };

      const response: any = await client.request(mutation, { variables });

      if (response.data?.draftOrderCreate?.userErrors?.length > 0) {
        const errors = response.data.draftOrderCreate.userErrors;
        logger.error(`Shopify draft order creation errors:`, errors);
        throw new Error(`Draft order creation failed: ${errors[0].message}`);
      }

      const draftOrder = response.data.draftOrderCreate.draftOrder;
      const draftOrderId = draftOrder.id.split('/').pop();

      logger.info(
        `Draft order created in supplier shop: ${draftOrder.name} (ID: ${draftOrderId})`
      );

      // Update PurchaseOrder with draft order ID
      await prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          supplierShopifyDraftOrderId: draftOrderId,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      logger.info(`PurchaseOrder ${purchaseOrderId} updated with draft order ID`);

      return draftOrderId;
    } catch (error) {
      logger.error(`Error creating draft order for PO ${purchaseOrderId}:`, error);

      // Log error in PurchaseOrder for debugging
      await prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: 'DRAFT', // Revert to draft on error
        },
      });

      throw error;
    }
  }

  /**
   * Complete a draft order (convert to real order) when payment is confirmed
   */
  static async completeDraftOrder(purchaseOrderId: string): Promise<string> {
    try {
      logger.info(`Completing draft order for PO ${purchaseOrderId}`);

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          supplierShop: true,
        },
      });

      if (!po) {
        throw new Error(`Purchase order ${purchaseOrderId} not found`);
      }

      if (!po.supplierShopifyDraftOrderId) {
        throw new Error(`No draft order ID for PO ${purchaseOrderId}`);
      }

      const client = createShopifyGraphQLClient(
        po.supplierShop.myshopifyDomain,
        po.supplierShop.accessToken
      );

      // Complete the draft order
      const mutation = `
        mutation draftOrderComplete($id: ID!, $paymentPending: Boolean) {
          draftOrderComplete(id: $id, paymentPending: $paymentPending) {
            draftOrder {
              id
              order {
                id
                name
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: `gid://shopify/DraftOrder/${po.supplierShopifyDraftOrderId}`,
        paymentPending: po.paymentTermsType === 'PREPAY' ? false : true, // If NET terms, mark as payment pending
      };

      const response: any = await client.request(mutation, { variables });

      if (response.data?.draftOrderComplete?.userErrors?.length > 0) {
        const errors = response.data.draftOrderComplete.userErrors;
        logger.error(`Shopify draft order completion errors:`, errors);
        throw new Error(`Draft order completion failed: ${errors[0].message}`);
      }

      const order = response.data.draftOrderComplete.draftOrder.order;
      const orderId = order.id.split('/').pop();

      logger.info(`Draft order completed, real order created: ${order.name} (ID: ${orderId})`);

      // Update PurchaseOrder with real order ID
      await prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          supplierShopifyOrderId: orderId,
          status: po.paymentTermsType === 'PREPAY' ? 'PAID' : 'AWAITING_PAYMENT',
          paidAt: po.paymentTermsType === 'PREPAY' ? new Date() : null,
        },
      });

      logger.info(`PurchaseOrder ${purchaseOrderId} status updated to order completion`);

      return orderId;
    } catch (error) {
      logger.error(`Error completing draft order for PO ${purchaseOrderId}:`, error);
      throw error;
    }
  }

  /**
   * Sync order fulfillment status from supplier to retailer
   */
  static async syncFulfillmentStatus(
    shopId: string,
    shopifyOrderId: string,
    fulfillmentPayload: any
  ): Promise<void> {
    try {
      logger.info(`Syncing fulfillment for order ${shopifyOrderId} in shop ${shopId}`);

      // Find the purchase order by supplier order ID
      const po = await prisma.purchaseOrder.findFirst({
        where: {
          supplierShopId: shopId,
          supplierShopifyOrderId: shopifyOrderId,
        },
      });

      if (!po) {
        logger.warn(
          `No purchase order found for supplier order ${shopifyOrderId} in shop ${shopId}`
        );
        return;
      }

      // Extract fulfillment details
      const fulfillment = fulfillmentPayload;
      const trackingNumber = fulfillment.tracking_number || null;
      const trackingUrl = fulfillment.tracking_url || null;
      const status = fulfillment.status;

      // Map Shopify fulfillment status to PurchaseOrder status
      let poStatus: PurchaseOrderStatus = po.status;

      if (status === 'success' || status === 'fulfilled') {
        poStatus = 'SHIPPED';
      } else if (status === 'in_transit') {
        poStatus = 'SHIPPED';
      } else if (status === 'delivered') {
        poStatus = 'DELIVERED';
      }

      // Update PurchaseOrder with tracking info
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          trackingNumber,
          trackingUrl,
          status: poStatus,
          shippedAt: poStatus === 'SHIPPED' ? new Date() : po.shippedAt,
        },
      });

      logger.info(
        `PurchaseOrder ${po.id} updated: status=${poStatus}, tracking=${trackingNumber}`
      );

      // TODO: Notify retailer via email/webhook about fulfillment
      logger.info(`Retailer ${po.retailerShopId} should be notified about fulfillment`);
    } catch (error) {
      logger.error(`Error syncing fulfillment for order ${shopifyOrderId}:`, error);
      throw error;
    }
  }

  /**
   * Handle order cancellation
   */
  static async cancelOrder(purchaseOrderId: string, reason?: string): Promise<void> {
    try {
      logger.info(`Cancelling order ${purchaseOrderId}, reason: ${reason || 'none'}`);

      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          supplierShop: true,
        },
      });

      if (!po) {
        throw new Error(`Purchase order ${purchaseOrderId} not found`);
      }

      // If there's a Shopify order, cancel it
      if (po.supplierShopifyOrderId) {
        const client = createShopifyGraphQLClient(
          po.supplierShop.myshopifyDomain,
          po.supplierShop.accessToken
        );

        const mutation = `
          mutation orderCancel($orderId: ID!, $reason: OrderCancelReason) {
            orderCancel(orderId: $orderId, reason: $reason) {
              orderCancelUserErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          orderId: `gid://shopify/Order/${po.supplierShopifyOrderId}`,
          reason: 'OTHER',
        };

        const response: any = await client.request(mutation, { variables });

        if (response.data?.orderCancel?.orderCancelUserErrors?.length > 0) {
          const errors = response.data.orderCancel.orderCancelUserErrors;
          logger.error(`Shopify order cancellation errors:`, errors);
          throw new Error(`Order cancellation failed: ${errors[0].message}`);
        }

        logger.info(`Shopify order ${po.supplierShopifyOrderId} cancelled`);
      } else if (po.supplierShopifyDraftOrderId) {
        // If it's still a draft order, delete it
        const client = createShopifyGraphQLClient(
          po.supplierShop.myshopifyDomain,
          po.supplierShop.accessToken
        );

        const mutation = `
          mutation draftOrderDelete($input: DraftOrderDeleteInput!) {
            draftOrderDelete(input: $input) {
              deletedId
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          input: {
            id: `gid://shopify/DraftOrder/${po.supplierShopifyDraftOrderId}`,
          },
        };

        await client.request(mutation, { variables });
        logger.info(`Draft order ${po.supplierShopifyDraftOrderId} deleted`);
      }

      // Update PurchaseOrder status
      await prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: 'CANCELLED',
        },
      });

      logger.info(`PurchaseOrder ${purchaseOrderId} cancelled`);
    } catch (error) {
      logger.error(`Error cancelling order ${purchaseOrderId}:`, error);
      throw error;
    }
  }

  /**
   * Send PO to supplier as draft order (helper for batch processing)
   */
  static async forwardPurchaseOrder(purchaseOrderId: string): Promise<void> {
    try {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
      });

      if (!po) {
        throw new Error(`Purchase order ${purchaseOrderId} not found`);
      }

      if (po.status !== 'DRAFT') {
        logger.warn(`PO ${purchaseOrderId} already forwarded (status: ${po.status})`);
        return;
      }

      // Create draft order in supplier shop
      await this.createDraftOrderInSupplierShop(purchaseOrderId);

      logger.info(`Purchase order ${purchaseOrderId} forwarded to supplier`);
    } catch (error) {
      logger.error(`Error forwarding purchase order ${purchaseOrderId}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // PHASE 5: ORDER PUSH FROM DESTINATION TO SOURCE
  // ============================================================================

  /**
   * Process incoming order for automatic forwarding
   * Called when destination store receives an order
   */
  static async processOrderForForwarding(
    retailerShopId: string,
    shopifyOrderId: string,
    orderPayload: any
  ): Promise<OrderPushResult[]> {
    const results: OrderPushResult[] = [];

    try {
      logger.info(`Processing order ${shopifyOrderId} for forwarding from shop ${retailerShopId}`);

      // Check for POS/local pickup exclusion first
      const exclusionCheck = this.checkOrderExclusions(orderPayload);
      if (exclusionCheck.excluded) {
        logger.info(`Order ${shopifyOrderId} excluded: ${exclusionCheck.reason}`);
        return [{
          success: false,
          orderId: shopifyOrderId,
          status: 'EXCLUDED',
          failureReason: exclusionCheck.failureReason,
          error: exclusionCheck.reason,
        }];
      }

      // Get active connections for this retailer
      const connections = await prisma.connection.findMany({
        where: {
          retailerShopId,
          status: 'ACTIVE',
          orderForwardingEnabled: true,
        },
        include: {
          supplierShop: true,
          retailerShop: true,
        },
      });

      if (connections.length === 0) {
        logger.info(`No connections with order forwarding enabled for shop ${retailerShopId}`);
        return [];
      }

      // Group line items by supplier (connection)
      const lineItemsByConnection = await this.groupLineItemsBySupplier(
        orderPayload.line_items || [],
        connections
      );

      // Process each supplier's portion
      for (const [connectionId, lineItems] of lineItemsByConnection) {
        const connection = connections.find((c) => c.id === connectionId);
        if (!connection) continue;

        // Check sync mode - skip if CATALOG_ONLY
        if (connection.syncMode === SyncMode.CATALOG_ONLY) {
          logger.info(`Skipping order push for connection ${connectionId} - CATALOG_ONLY mode`);
          results.push({
            success: false,
            orderId: shopifyOrderId,
            status: 'EXCLUDED',
            failureReason: 'CATALOG_ONLY_MODE',
            error: 'Order forwarding disabled in catalog-only mode',
          });
          continue;
        }

        // Check trigger policy
        const shouldPush = this.shouldPushOrder(
          connection.orderTriggerPolicy,
          orderPayload.financial_status
        );

        if (!shouldPush.push) {
          logger.info(
            `Skipping order push for connection ${connectionId}: ${shouldPush.reason}`
          );
          continue;
        }

        // Check forwarding mode
        const mode = connection.orderForwardingMode as OrderForwardingMode;

        if (mode === 'MANUAL') {
          // Just record the order for manual push later
          await this.recordPendingPush(connection.id, shopifyOrderId, orderPayload, lineItems);
          results.push({
            success: true,
            orderId: shopifyOrderId,
            status: 'NOT_PUSHED',
          });
        } else if (mode === 'SHADOW') {
          // Create shadow record without actual order
          const shadowResult = await this.createShadowOrder(
            connection,
            shopifyOrderId,
            orderPayload,
            lineItems
          );
          results.push(shadowResult);
        } else {
          // AUTO mode - push immediately
          const pushResult = await this.pushOrderToSupplier(
            connection,
            shopifyOrderId,
            orderPayload,
            lineItems
          );
          results.push(pushResult);
        }
      }

      return results;
    } catch (error) {
      logger.error(`Error processing order ${shopifyOrderId} for forwarding:`, error);
      return [{
        success: false,
        orderId: shopifyOrderId,
        status: 'FAILED',
        failureReason: 'API_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error',
      }];
    }
  }

  /**
   * Check order exclusions (POS, local pickup, etc.)
   */
  private static checkOrderExclusions(orderPayload: any): {
    excluded: boolean;
    reason?: string;
    failureReason?: PushFailureReason;
  } {
    // Check for POS order
    const sourceName = orderPayload.source_name?.toLowerCase() || '';
    if (sourceName === 'pos' || sourceName.includes('point of sale')) {
      return {
        excluded: true,
        reason: 'POS order - not eligible for forwarding',
        failureReason: 'POS_ORDER',
      };
    }

    // Check for local pickup
    const fulfillmentStatus = orderPayload.fulfillment_status;
    const shippingLines = orderPayload.shipping_lines || [];
    const hasLocalPickup = shippingLines.some((line: any) =>
      line.title?.toLowerCase().includes('local pickup') ||
      line.title?.toLowerCase().includes('in-store pickup') ||
      line.code?.toLowerCase().includes('pickup')
    );

    if (hasLocalPickup) {
      return {
        excluded: true,
        reason: 'Local pickup order - not eligible for forwarding',
        failureReason: 'LOCAL_PICKUP',
      };
    }

    // Check if already fulfilled or archived
    if (fulfillmentStatus === 'fulfilled' || orderPayload.closed_at) {
      return {
        excluded: true,
        reason: 'Order already fulfilled or archived',
        failureReason: 'FULFILLED_OR_ARCHIVED',
      };
    }

    return { excluded: false };
  }

  /**
   * Determine if order should be pushed based on trigger policy
   */
  private static shouldPushOrder(
    policy: OrderTriggerPolicy,
    financialStatus: string
  ): { push: boolean; reason?: string } {
    if (policy === OrderTriggerPolicy.ON_CREATE) {
      return { push: true };
    }

    // ON_PAID policy
    if (financialStatus === 'paid' || financialStatus === 'partially_paid') {
      return { push: true };
    }

    return {
      push: false,
      reason: `ON_PAID policy - order status is ${financialStatus}`,
    };
  }

  /**
   * Group order line items by supplier connection
   */
  private static async groupLineItemsBySupplier(
    lineItems: any[],
    connections: any[]
  ): Promise<Map<string, any[]>> {
    const grouped = new Map<string, any[]>();

    for (const item of lineItems) {
      const variantId = item.variant_id?.toString();
      if (!variantId) continue;

      // Find which connection this variant belongs to
      const mapping = await prisma.productMapping.findFirst({
        where: {
          retailerShopifyVariantId: variantId,
          connection: {
            id: { in: connections.map((c) => c.id) },
          },
          status: 'ACTIVE',
        },
      });

      if (mapping) {
        const existing = grouped.get(mapping.connectionId) || [];
        existing.push({
          ...item,
          supplierVariantId: mapping.supplierShopifyVariantId,
          mappingId: mapping.id,
        });
        grouped.set(mapping.connectionId, existing);
      }
    }

    return grouped;
  }

  /**
   * Record pending push for manual forwarding
   */
  private static async recordPendingPush(
    connectionId: string,
    orderId: string,
    orderPayload: any,
    lineItems: any[]
  ): Promise<void> {
    logger.info(`Recording pending push for order ${orderId} on connection ${connectionId}`);

    // Store in pending orders (could be a separate table or JSON field)
    // For now, create an activity log entry
    await ConnectionHealthService.logActivity(connectionId, {
      type: 'ORDER_PENDING',
      resourceType: 'ORDER',
      resourceId: orderId,
      message: `Order pending manual push: ${lineItems.length} items`,
      details: {
        orderId,
        orderNumber: orderPayload.order_number,
        lineItemCount: lineItems.length,
        total: orderPayload.total_price,
      },
    });
  }

  /**
   * Create shadow order (preview without actual push)
   */
  private static async createShadowOrder(
    connection: any,
    orderId: string,
    orderPayload: any,
    lineItems: any[]
  ): Promise<OrderPushResult> {
    logger.info(`Creating shadow order for ${orderId} on connection ${connection.id}`);

    // Calculate what would be pushed
    const totalItems = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = lineItems.reduce(
      (sum, item) => sum + parseFloat(item.price) * item.quantity,
      0
    );

    // Record shadow order
    await ConnectionHealthService.logActivity(connection.id, {
      type: 'ORDER_SHADOWED',
      resourceType: 'ORDER',
      resourceId: orderId,
      message: `Shadow order created: ${totalItems} items, $${subtotal.toFixed(2)}`,
      details: {
        orderId,
        orderNumber: orderPayload.order_number,
        lineItems: lineItems.map((item) => ({
          variantId: item.variant_id,
          quantity: item.quantity,
          price: item.price,
        })),
        subtotal,
        wouldCreateDraftOrder: true,
      },
    });

    return {
      success: true,
      orderId,
      status: 'SHADOWED',
    };
  }

  /**
   * Push order to supplier (create actual order)
   */
  private static async pushOrderToSupplier(
    connection: any,
    orderId: string,
    orderPayload: any,
    lineItems: any[],
    options?: { shippingOverride?: number }
  ): Promise<OrderPushResult> {
    try {
      logger.info(`Pushing order ${orderId} to supplier ${connection.supplierShopId}`);

      // Check for idempotency - has this order already been pushed?
      const existingPush = await this.checkExistingPush(connection.id, orderId);
      if (existingPush) {
        logger.info(`Order ${orderId} already pushed to connection ${connection.id}`);
        return {
          success: true,
          orderId,
          status: 'PUSHED',
          supplierOrderId: existingPush.supplierOrderId,
          supplierDraftOrderId: existingPush.supplierDraftOrderId,
        };
      }

      // Validate order is pushable
      const validation = await this.validateOrderForPush(orderPayload, lineItems);
      if (!validation.valid) {
        return {
          success: false,
          orderId,
          status: 'FAILED',
          failureReason: validation.failureReason,
          error: validation.error,
        };
      }

      // Get shipping rules from connection config
      const shippingRules = this.getShippingRules(connection);

      // Create draft order in supplier's Shopify
      const client = createShopifyGraphQLClient(
        connection.supplierShop.myshopifyDomain,
        connection.supplierShop.accessToken
      );

      // Build line items for supplier
      const supplierLineItems = lineItems.map((item) => ({
        variantId: `gid://shopify/ProductVariant/${item.supplierVariantId}`,
        quantity: item.quantity,
      }));

      // Build tags
      const tags = this.buildOrderTags(connection, orderPayload);

      // Handle $0 order workaround and shipping override
      let shippingLine: any = null;
      const orderTotal = parseFloat(orderPayload.total_price || '0');

      // Use explicit shipping override if provided
      if (options?.shippingOverride !== undefined) {
        shippingLine = {
          title: 'Shipping',
          price: options.shippingOverride.toFixed(2),
        };
      } else if (orderTotal === 0 && shippingRules.zeroOrderWorkaround) {
        // Apply $0 order workaround
        shippingLine = {
          title: 'Processing Fee',
          price: '0.01',
        };
      }

      // Create draft order
      const mutation = `
        mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              name
              totalPrice
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const input: any = {
        lineItems: supplierLineItems,
        note: this.buildOrderNote(connection, orderPayload),
        tags,
        customAttributes: [
          { key: 'cartrel_source_order_id', value: orderId },
          { key: 'cartrel_source_order_number', value: orderPayload.order_number?.toString() || '' },
          { key: 'cartrel_retailer_shop', value: connection.retailerShop.myshopifyDomain },
          { key: 'cartrel_connection_id', value: connection.id },
        ],
      };

      // Add shipping address if available
      if (orderPayload.shipping_address) {
        input.shippingAddress = {
          firstName: orderPayload.shipping_address.first_name || '',
          lastName: orderPayload.shipping_address.last_name || '',
          address1: orderPayload.shipping_address.address1 || '',
          address2: orderPayload.shipping_address.address2 || '',
          city: orderPayload.shipping_address.city || '',
          province: orderPayload.shipping_address.province || '',
          country: orderPayload.shipping_address.country || '',
          zip: orderPayload.shipping_address.zip || '',
          phone: orderPayload.shipping_address.phone || '',
        };
      }

      // Add shipping line if needed
      if (shippingLine) {
        input.shippingLine = shippingLine;
      }

      const response: any = await client.request(mutation, { variables: { input } });

      if (response.data?.draftOrderCreate?.userErrors?.length > 0) {
        const errors = response.data.draftOrderCreate.userErrors;
        logger.error(`Shopify draft order creation errors:`, errors);

        await this.recordPushFailure(connection.id, orderId, errors[0].message);

        return {
          success: false,
          orderId,
          status: 'FAILED',
          failureReason: 'API_ERROR',
          error: errors[0].message,
        };
      }

      const draftOrder = response.data.draftOrderCreate.draftOrder;
      const draftOrderId = draftOrder.id.split('/').pop();

      // Record successful push
      await this.recordPushSuccess(connection.id, orderId, draftOrderId);

      logger.info(`Order ${orderId} pushed to supplier as draft order ${draftOrder.name}`);

      return {
        success: true,
        orderId,
        status: 'PUSHED',
        supplierDraftOrderId: draftOrderId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error pushing order ${orderId} to supplier:`, error);

      await this.recordPushFailure(connection.id, orderId, errorMessage);

      return {
        success: false,
        orderId,
        status: 'FAILED',
        failureReason: 'API_ERROR',
        error: errorMessage,
      };
    }
  }

  /**
   * Check if order was already pushed (idempotency)
   */
  private static async checkExistingPush(
    connectionId: string,
    orderId: string
  ): Promise<{ supplierOrderId?: string; supplierDraftOrderId?: string } | null> {
    // Check for existing PurchaseOrder with this source order
    const existing = await prisma.purchaseOrder.findFirst({
      where: {
        connectionId,
        retailerShopifyOrderId: orderId,
      },
    });

    if (existing) {
      return {
        supplierOrderId: existing.supplierShopifyOrderId || undefined,
        supplierDraftOrderId: existing.supplierShopifyDraftOrderId || undefined,
      };
    }

    return null;
  }

  /**
   * Validate order is ready for push
   */
  private static async validateOrderForPush(
    orderPayload: any,
    lineItems: any[]
  ): Promise<{ valid: boolean; failureReason?: PushFailureReason; error?: string }> {
    // Check for customer details
    if (!orderPayload.shipping_address && !orderPayload.billing_address) {
      return {
        valid: false,
        failureReason: 'MISSING_CUSTOMER',
        error: 'Order missing customer shipping/billing address',
      };
    }

    // Check for synced products
    if (lineItems.length === 0) {
      return {
        valid: false,
        failureReason: 'UNSYNCED_PRODUCT',
        error: 'No synced products in order',
      };
    }

    // Check for $0 total (without workaround)
    const total = parseFloat(orderPayload.total_price || '0');
    if (total === 0) {
      // Will apply workaround if enabled, but log warning
      logger.warn(`Order has $0 total - may need workaround`);
    }

    return { valid: true };
  }

  /**
   * Get shipping rules from connection config
   */
  private static getShippingRules(connection: any): ShippingRules {
    const priceRulesConfig = connection.priceRulesConfig as any;
    return {
      zeroOrderWorkaround: priceRulesConfig?.zeroOrderWorkaround ?? true,
      defaultShippingFee: priceRulesConfig?.defaultShippingFee,
      shippingTags: priceRulesConfig?.shippingTags,
      includeShippingCost: priceRulesConfig?.includeShippingCost ?? false,
    };
  }

  /**
   * Build order tags for supplier order
   */
  private static buildOrderTags(connection: any, orderPayload: any): string[] {
    const tags = ['cartrel', 'forwarded'];

    // Add retailer store name (truncated for 40 char limit)
    const retailerName = connection.retailerShop.myshopifyDomain
      .replace('.myshopify.com', '')
      .slice(0, 30);
    tags.push(`from-${retailerName}`);

    // Add original order number
    if (orderPayload.order_number) {
      tags.push(`order-${orderPayload.order_number}`);
    }

    // Add shipping type tag if configured
    const shippingRules = this.getShippingRules(connection);
    const shippingTitle = orderPayload.shipping_lines?.[0]?.title;
    if (shippingTitle && shippingRules.shippingTags?.[shippingTitle]) {
      tags.push(shippingRules.shippingTags[shippingTitle]);
    }

    return tags;
  }

  /**
   * Build order note for supplier order
   */
  private static buildOrderNote(connection: any, orderPayload: any): string {
    const lines = [
      `Forwarded from: ${connection.retailerShop.myshopifyDomain}`,
      `Original order: #${orderPayload.order_number || orderPayload.name}`,
    ];

    if (orderPayload.note) {
      lines.push(`Customer note: ${orderPayload.note}`);
    }

    // Include shipping info
    const shippingTitle = orderPayload.shipping_lines?.[0]?.title;
    if (shippingTitle) {
      lines.push(`Shipping: ${shippingTitle}`);
    }

    return lines.join('\n');
  }

  /**
   * Record successful push
   */
  private static async recordPushSuccess(
    connectionId: string,
    orderId: string,
    draftOrderId: string
  ): Promise<void> {
    await ConnectionHealthService.logActivity(connectionId, {
      type: 'ORDER_PUSHED',
      resourceType: 'ORDER',
      resourceId: orderId,
      message: `Order pushed successfully: draft order ${draftOrderId}`,
      details: {
        orderId,
        supplierDraftOrderId: draftOrderId,
        pushedAt: new Date().toISOString(),
      },
    });

    await ConnectionHealthService.recordSync(connectionId, 'ORDER', true);
  }

  /**
   * Record push failure
   */
  private static async recordPushFailure(
    connectionId: string,
    orderId: string,
    error: string
  ): Promise<void> {
    await ConnectionHealthService.logActivity(connectionId, {
      type: 'ORDER_PUSH_FAILED',
      resourceType: 'ORDER',
      resourceId: orderId,
      message: `Order push failed: ${error}`,
      details: {
        orderId,
        error,
        failedAt: new Date().toISOString(),
      },
    });

    await ConnectionHealthService.recordSync(connectionId, 'ORDER', false, error);
  }

  // ============================================================================
  // PHASE 5: BULK PUSH & MANUAL PUSH
  // ============================================================================

  /**
   * Bulk push multiple orders
   */
  static async bulkPushOrders(
    connectionId: string,
    orderIds: string[],
    options?: {
      shippingOverride?: number;
      skipValidation?: boolean;
    }
  ): Promise<{
    total: number;
    success: number;
    failed: number;
    results: OrderPushResult[];
  }> {
    logger.info(`Bulk pushing ${orderIds.length} orders for connection ${connectionId}`);

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const results: OrderPushResult[] = [];

    for (const orderId of orderIds) {
      try {
        // Fetch order details from Shopify
        const orderPayload = await this.fetchOrderDetails(
          connection.retailerShop,
          orderId
        );

        if (!orderPayload) {
          results.push({
            success: false,
            orderId,
            status: 'FAILED',
            failureReason: 'API_ERROR',
            error: 'Could not fetch order details',
          });
          continue;
        }

        // Group line items for this connection
        const lineItemsMap = await this.groupLineItemsBySupplier(
          orderPayload.line_items || [],
          [connection]
        );

        const lineItems = lineItemsMap.get(connectionId) || [];

        if (lineItems.length === 0) {
          results.push({
            success: false,
            orderId,
            status: 'FAILED',
            failureReason: 'UNSYNCED_PRODUCT',
            error: 'No synced products in order',
          });
          continue;
        }

        // Push to supplier with optional overrides
        const result = await this.pushOrderToSupplier(
          connection,
          orderId,
          orderPayload,
          lineItems,
          options
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          orderId,
          status: 'FAILED',
          failureReason: 'API_ERROR',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info(`Bulk push complete: ${success} success, ${failed} failed`);

    return {
      total: orderIds.length,
      success,
      failed,
      results,
    };
  }

  /**
   * Fetch order details from Shopify
   */
  private static async fetchOrderDetails(
    retailerShop: any,
    orderId: string
  ): Promise<any | null> {
    try {
      const client = createShopifyGraphQLClient(
        retailerShop.myshopifyDomain,
        retailerShop.accessToken
      );

      const query = `
        query getOrder($id: ID!) {
          order(id: $id) {
            id
            name
            orderNumber: name
            totalPrice: totalPriceSet { shopMoney { amount } }
            financialStatus
            fulfillmentStatus
            closedAt
            note
            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            shippingLines(first: 5) {
              edges {
                node {
                  title
                  code
                }
              }
            }
            lineItems(first: 100) {
              edges {
                node {
                  id
                  quantity
                  variant {
                    id
                  }
                  originalUnitPrice: originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      `;

      const orderGid = orderId.startsWith('gid://')
        ? orderId
        : `gid://shopify/Order/${orderId}`;

      const response: any = await client.request(query, {
        variables: { id: orderGid },
      });

      const order = response.data?.order;
      if (!order) return null;

      // Transform to webhook-like format for consistency
      return {
        id: order.id.split('/').pop(),
        name: order.name,
        order_number: order.orderNumber,
        total_price: order.totalPrice?.shopMoney?.amount || '0',
        financial_status: order.financialStatus?.toLowerCase(),
        fulfillment_status: order.fulfillmentStatus?.toLowerCase(),
        closed_at: order.closedAt,
        note: order.note,
        shipping_address: order.shippingAddress,
        shipping_lines: order.shippingLines?.edges?.map((e: any) => e.node) || [],
        line_items: order.lineItems?.edges?.map((e: any) => ({
          id: e.node.id.split('/').pop(),
          variant_id: e.node.variant?.id?.split('/').pop(),
          quantity: e.node.quantity,
          price: e.node.originalUnitPrice?.shopMoney?.amount || '0',
        })) || [],
      };
    } catch (error) {
      logger.error(`Error fetching order ${orderId}:`, error);
      return null;
    }
  }

  /**
   * Promote shadow order to real push
   */
  static async promoteShadowOrder(
    connectionId: string,
    orderId: string
  ): Promise<OrderPushResult> {
    logger.info(`Promoting shadow order ${orderId} for connection ${connectionId}`);

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Fetch order details
    const orderPayload = await this.fetchOrderDetails(connection.retailerShop, orderId);

    if (!orderPayload) {
      return {
        success: false,
        orderId,
        status: 'FAILED',
        failureReason: 'API_ERROR',
        error: 'Could not fetch order details',
      };
    }

    // Group line items
    const lineItemsMap = await this.groupLineItemsBySupplier(
      orderPayload.line_items || [],
      [connection]
    );

    const lineItems = lineItemsMap.get(connectionId) || [];

    // Push to supplier
    return await this.pushOrderToSupplier(connection, orderId, orderPayload, lineItems);
  }

  // ============================================================================
  // PHASE 5: ENHANCED FULFILLMENT SYNC
  // ============================================================================

  /**
   * Sync fulfillment from supplier to retailer order
   */
  static async syncFulfillmentToRetailer(
    supplierShopId: string,
    supplierOrderId: string,
    fulfillmentPayload: any
  ): Promise<void> {
    try {
      logger.info(
        `Syncing fulfillment for supplier order ${supplierOrderId} to retailer`
      );

      // Find the connection and original order
      const po = await prisma.purchaseOrder.findFirst({
        where: {
          supplierShopId,
          OR: [
            { supplierShopifyOrderId: supplierOrderId },
            { supplierShopifyDraftOrderId: supplierOrderId },
          ],
        },
        include: {
          retailerShop: true,
          connection: true,
        },
      });

      if (!po || !po.retailerShopifyOrderId) {
        logger.warn(`No matching retailer order found for supplier order ${supplierOrderId}`);
        return;
      }

      // Extract tracking info
      const trackingNumber = fulfillmentPayload.tracking_number;
      const trackingUrl = fulfillmentPayload.tracking_url;
      const trackingCompany = fulfillmentPayload.tracking_company;

      if (!trackingNumber) {
        logger.info('No tracking number in fulfillment - skipping sync');
        return;
      }

      // Create fulfillment in retailer's Shopify
      const client = createShopifyGraphQLClient(
        po.retailerShop.myshopifyDomain,
        po.retailerShop.accessToken
      );

      const mutation = `
        mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
          fulfillmentCreateV2(fulfillment: $fulfillment) {
            fulfillment {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Get line item IDs from retailer order
      const orderQuery = `
        query getOrder($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 10) {
              edges {
                node {
                  id
                  status
                  lineItems(first: 100) {
                    edges {
                      node {
                        id
                        remainingQuantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const orderResponse: any = await client.request(orderQuery, {
        variables: { id: `gid://shopify/Order/${po.retailerShopifyOrderId}` },
      });

      const fulfillmentOrder = orderResponse.data?.order?.fulfillmentOrders?.edges?.[0]?.node;

      if (!fulfillmentOrder) {
        logger.warn('No fulfillment order found for retailer order');
        return;
      }

      const lineItemsFulfillment = fulfillmentOrder.lineItems.edges
        .filter((e: any) => e.node.remainingQuantity > 0)
        .map((e: any) => ({
          id: e.node.id,
          quantity: e.node.remainingQuantity,
        }));

      if (lineItemsFulfillment.length === 0) {
        logger.info('All line items already fulfilled');
        return;
      }

      const fulfillmentInput = {
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: fulfillmentOrder.id,
            fulfillmentOrderLineItems: lineItemsFulfillment,
          },
        ],
        trackingInfo: {
          number: trackingNumber,
          url: trackingUrl,
          company: trackingCompany,
        },
        notifyCustomer: true,
      };

      const response: any = await client.request(mutation, {
        variables: { fulfillment: fulfillmentInput },
      });

      if (response.data?.fulfillmentCreateV2?.userErrors?.length > 0) {
        const errors = response.data.fulfillmentCreateV2.userErrors;
        logger.error(`Fulfillment sync errors:`, errors);
        throw new Error(`Fulfillment sync failed: ${errors[0].message}`);
      }

      // Update PurchaseOrder with tracking
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          trackingNumber,
          trackingUrl,
          status: 'SHIPPED',
          shippedAt: new Date(),
        },
      });

      logger.info(
        `Fulfillment synced to retailer order ${po.retailerShopifyOrderId}: ${trackingNumber}`
      );

      // Record health
      await ConnectionHealthService.recordSync(po.connectionId, 'FULFILLMENT', true);
    } catch (error) {
      logger.error(`Error syncing fulfillment:`, error);
      throw error;
    }
  }
}
