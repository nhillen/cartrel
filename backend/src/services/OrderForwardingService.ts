/**
 * OrderForwardingService - Handles order forwarding from retailers to suppliers
 *
 * Core responsibilities:
 * - Create draft orders in supplier's Shopify when retailer submits PurchaseOrder
 * - Convert draft orders to real orders when paid
 * - Sync fulfillment status and tracking back to retailer
 * - Handle order updates and cancellations
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { PurchaseOrder, PurchaseOrderStatus } from '@prisma/client';

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
}
