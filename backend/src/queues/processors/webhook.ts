import { Job } from 'bull';
import { logger } from '../../utils/logger';
import { prisma } from '../../index';
import { WebhookTopic } from '@prisma/client';
import { ProductSyncService } from '../../services/ProductSyncService';
import { InventorySyncService } from '../../services/InventorySyncService';
import { OrderForwardingService } from '../../services/OrderForwardingService';
import { EventService, NormalizedEvent } from '../../services/EventService';
import { RateLimitService } from '../../services/RateLimitService';
import { ConnectionHealthService } from '../../services/ConnectionHealthService';

export interface WebhookJob {
  topic: WebhookTopic;
  shopId: string;
  shopifyId: string;
  payload: any;
  // New fields for Phase 2
  idempotencyKey?: string;
  priority?: number;
  retryCount?: number;
}

export async function processWebhook(job: Job<WebhookJob>) {
  const { topic, shopId, shopifyId, payload, retryCount = 0 } = job.data;

  logger.info(`Processing webhook: ${topic} for shop ${shopId} (attempt ${retryCount + 1})`);

  // Normalize the event
  const event = EventService.normalizeEvent(shopId, topic, shopifyId, payload);

  // Check idempotency - skip if already processed
  const alreadyProcessed = await EventService.isProcessed(event.idempotencyKey);
  if (alreadyProcessed) {
    logger.info(`Webhook already processed, skipping: ${event.idempotencyKey}`);
    return { skipped: true, reason: 'duplicate' };
  }

  // Check rate limit state - should we delay or use DLQ?
  const shouldDLQ = await RateLimitService.shouldUseDLQ(shopId);
  if (shouldDLQ) {
    logger.warn(`Shop ${shopId} has too many errors, moving to DLQ`);
    // Don't throw - job will be marked as failed and stay in failed jobs list
    await prisma.webhookLog.create({
      data: {
        shopId,
        topic,
        shopifyId,
        payload,
        processed: false,
        errorMessage: 'Moved to DLQ due to repeated rate limit errors',
      },
    });
    return { skipped: true, reason: 'dlq' };
  }

  // Apply rate limit delay if needed
  const delayMs = await RateLimitService.getRequiredDelay(shopId);
  if (delayMs > 0) {
    logger.info(`Applying rate limit delay of ${delayMs}ms for shop ${shopId}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  try {
    // Log the webhook
    await prisma.webhookLog.create({
      data: {
        shopId,
        topic,
        shopifyId,
        payload,
        processed: false,
      },
    });

    // Process with idempotency tracking
    const result = await EventService.processWithIdempotency(event, async () => {
      switch (topic) {
        case 'PRODUCTS_CREATE':
        case 'PRODUCTS_UPDATE':
          return await handleProductUpdate(shopId, payload, event);

        case 'PRODUCTS_DELETE':
          return await handleProductDelete(shopId, payload, event);

        case 'INVENTORY_LEVELS_UPDATE':
          return await handleInventoryUpdate(shopId, payload, event);

        case 'ORDERS_CREATE':
        case 'ORDERS_UPDATED':
          return await handleOrderUpdate(shopId, payload, event);

        case 'APP_UNINSTALLED':
          return await handleAppUninstall(shopId);

        default:
          logger.warn(`Unhandled webhook topic: ${topic}`);
          return { handled: false };
      }
    });

    if (result.error) {
      throw result.error;
    }

    // Mark as processed in database
    await prisma.webhookLog.updateMany({
      where: {
        shopId,
        topic,
        shopifyId,
        processed: false,
      },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });

    // Update rate limit state (success)
    await RateLimitService.updateState(shopId, {}, false);

    logger.info(`Webhook processed: ${topic} for shop ${shopId}`);
    return { processed: true, result: result.result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error processing webhook ${topic}:`, error);

    // Check if it's a rate limit error (429)
    const is429 =
      errorMessage.includes('429') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('Too Many Requests');

    // Update rate limit state
    await RateLimitService.updateState(shopId, {}, is429);

    // Log the error
    await prisma.webhookLog.updateMany({
      where: {
        shopId,
        topic,
        shopifyId,
        processed: false,
      },
      data: {
        errorMessage,
      },
    });

    // Update job data with retry count for next attempt
    job.data.retryCount = retryCount + 1;

    throw error; // Re-throw to trigger retry
  }
}

async function handleProductUpdate(
  shopId: string,
  payload: any,
  _event: NormalizedEvent
): Promise<{ productId: string; propagated: boolean }> {
  logger.info(`Handling product update for shop ${shopId}`);

  const productId = payload.id?.toString() || payload.admin_graphql_api_id;

  if (!productId) {
    logger.error('No product ID in webhook payload');
    return { productId: 'unknown', propagated: false };
  }

  // Step 1: Update SupplierProduct cache
  await ProductSyncService.updateSupplierProductCache(shopId, productId, payload);

  // Step 2: Propagate to connected retailers
  // Get affected connections for health tracking
  const connections = await prisma.connection.findMany({
    where: { supplierShopId: shopId, status: 'ACTIVE' },
    select: { id: true },
  });

  await ProductSyncService.propagateToRetailers(shopId, productId);

  // Record health for each connection
  for (const conn of connections) {
    await ConnectionHealthService.recordSync(conn.id, 'CATALOG', true);
  }

  logger.info(`Product update handled for ${productId}`);
  return { productId, propagated: connections.length > 0 };
}

async function handleProductDelete(
  shopId: string,
  payload: any,
  _event: NormalizedEvent
): Promise<{ productId: string }> {
  logger.info(`Handling product delete for shop ${shopId}`);

  const productId = payload.id?.toString() || payload.admin_graphql_api_id;

  if (!productId) {
    logger.error('No product ID in webhook payload');
    return { productId: 'unknown' };
  }

  // Mark product as discontinued in all mappings
  await ProductSyncService.handleProductDelete(shopId, productId);

  logger.info(`Product delete handled for ${productId}`);
  return { productId };
}

async function handleInventoryUpdate(
  shopId: string,
  payload: any,
  _event: NormalizedEvent
): Promise<{ inventoryItemId: string; propagated: boolean }> {
  logger.info(`Handling inventory update for shop ${shopId}`);

  // Shopify sends inventory_levels/update webhook with inventory_item_id
  if (!payload.inventory_item_id) {
    logger.error('No inventory_item_id in webhook payload');
    return { inventoryItemId: 'unknown', propagated: false };
  }

  // Get affected connections for health tracking
  const connections = await prisma.connection.findMany({
    where: {
      supplierShopId: shopId,
      status: 'ACTIVE',
      syncMode: 'INVENTORY_AND_CATALOG', // Only sync inventory in full mode
    },
    select: { id: true },
  });

  // Update supplier inventory and propagate to retailers
  await InventorySyncService.updateSupplierInventory(shopId, payload);

  // Record health for each connection
  for (const conn of connections) {
    await ConnectionHealthService.recordSync(conn.id, 'INVENTORY', true);
  }

  logger.info(`Inventory update handled for item ${payload.inventory_item_id}`);
  return {
    inventoryItemId: payload.inventory_item_id.toString(),
    propagated: connections.length > 0,
  };
}

async function handleOrderUpdate(
  shopId: string,
  payload: any,
  _event: NormalizedEvent
): Promise<{ orderId: string; isWholesale: boolean; synced: boolean }> {
  logger.info(`Handling order update for shop ${shopId}`);

  const orderId = payload.id?.toString() || payload.admin_graphql_api_id;

  if (!orderId) {
    logger.error('No order ID in webhook payload');
    return { orderId: 'unknown', isWholesale: false, synced: false };
  }

  // Check if this is a wholesale order (has our custom attributes or tags)
  const tags = payload.tags || '';
  const isWholesaleOrder = tags.includes('cartrel') || tags.includes('wholesale');

  if (!isWholesaleOrder) {
    logger.info(`Order ${orderId} is not a wholesale order, skipping`);
    return { orderId, isWholesale: false, synced: false };
  }

  try {
    // Check for fulfillment updates
    const fulfillments = payload.fulfillments || [];

    if (fulfillments.length > 0) {
      // Get the latest fulfillment
      const latestFulfillment = fulfillments[fulfillments.length - 1];

      logger.info(
        `Order ${orderId} has fulfillment: ${latestFulfillment.status}, tracking: ${latestFulfillment.tracking_number || 'none'}`
      );

      // Sync fulfillment status to PurchaseOrder
      await OrderForwardingService.syncFulfillmentStatus(
        shopId,
        orderId.split('/').pop() || orderId, // Extract numeric ID
        latestFulfillment
      );

      logger.info(`Fulfillment synced for order ${orderId}`);
    } else {
      logger.info(`Order ${orderId} has no fulfillments yet`);
    }

    // Check for payment/financial status changes
    const financialStatus = payload.financial_status;
    if (financialStatus === 'paid') {
      // Find the purchase order by supplier order ID
      const po = await prisma.purchaseOrder.findFirst({
        where: {
          supplierShopId: shopId,
          supplierShopifyOrderId: orderId.split('/').pop() || orderId,
        },
      });

      if (po && po.status === 'AWAITING_PAYMENT') {
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: 'PAID',
            paidAt: new Date(),
          },
        });

        logger.info(`PurchaseOrder ${po.id} marked as PAID`);
      }
    }

    logger.info(`Order update handled for ${orderId}`);
    return { orderId, isWholesale: true, synced: true };
  } catch (error) {
    logger.error(`Error handling order update:`, error);
    throw error;
  }
}

async function handleAppUninstall(shopId: string): Promise<{ shopId: string; paused: number }> {
  logger.info(`Handling app uninstall for shop: ${shopId}`);

  try {
    // Pause all connections where this shop is supplier or retailer
    const result = await prisma.connection.updateMany({
      where: {
        OR: [{ supplierShopId: shopId }, { retailerShopId: shopId }],
        status: 'ACTIVE',
      },
      data: {
        status: 'PAUSED',
      },
    });

    logger.info(`Paused ${result.count} connections for shop ${shopId}`);

    // Clear access token and reset role to UNSET
    // This forces OAuth on reinstall and proper onboarding flow
    // Keep the shop record for data retention
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        accessToken: '', // Clear token to force OAuth on reinstall
        role: 'UNSET', // Reset role so they go through onboarding
        plan: 'FREE',
      },
    });

    logger.info(`Cleared token and reset shop ${shopId} to UNSET/FREE`);
    return { shopId, paused: result.count };
  } catch (error) {
    logger.error(`Error handling app uninstall for ${shopId}:`, error);
    throw error;
  }
}
