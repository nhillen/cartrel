import { Job } from 'bull';
import { logger } from '../../utils/logger';
import { prisma } from '../../index';
import { WebhookTopic } from '@prisma/client';
import { ProductSyncService } from '../../services/ProductSyncService';
import { InventorySyncService } from '../../services/InventorySyncService';

export interface WebhookJob {
  topic: WebhookTopic;
  shopId: string;
  shopifyId: string;
  payload: any;
}

export async function processWebhook(job: Job<WebhookJob>) {
  const { topic, shopId, shopifyId, payload } = job.data;

  logger.info(`Processing webhook: ${topic} for shop ${shopId}`);

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

    // TODO: Process webhook based on topic
    switch (topic) {
      case 'PRODUCTS_CREATE':
      case 'PRODUCTS_UPDATE':
        await handleProductUpdate(shopId, payload);
        break;

      case 'PRODUCTS_DELETE':
        await handleProductDelete(shopId, payload);
        break;

      case 'INVENTORY_LEVELS_UPDATE':
        await handleInventoryUpdate(shopId, payload);
        break;

      case 'ORDERS_CREATE':
      case 'ORDERS_UPDATED':
        await handleOrderUpdate(shopId, payload);
        break;

      case 'APP_UNINSTALLED':
        await handleAppUninstall(shopId);
        break;

      default:
        logger.warn(`Unhandled webhook topic: ${topic}`);
    }

    // Mark as processed
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

    logger.info(`Webhook processed: ${topic} for shop ${shopId}`);
  } catch (error) {
    logger.error(`Error processing webhook ${topic}:`, error);

    // Log the error
    await prisma.webhookLog.updateMany({
      where: {
        shopId,
        topic,
        shopifyId,
        processed: false,
      },
      data: {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error; // Re-throw to trigger retry
  }
}

async function handleProductUpdate(shopId: string, payload: any) {
  logger.info(`Handling product update for shop ${shopId}`);

  const productId = payload.id?.toString() || payload.admin_graphql_api_id;

  if (!productId) {
    logger.error('No product ID in webhook payload');
    return;
  }

  // Step 1: Update SupplierProduct cache
  await ProductSyncService.updateSupplierProductCache(shopId, productId, payload);

  // Step 2: Propagate to connected retailers
  await ProductSyncService.propagateToRetailers(shopId, productId);

  logger.info(`Product update handled for ${productId}`);
}

async function handleProductDelete(shopId: string, payload: any) {
  logger.info(`Handling product delete for shop ${shopId}`);

  const productId = payload.id?.toString() || payload.admin_graphql_api_id;

  if (!productId) {
    logger.error('No product ID in webhook payload');
    return;
  }

  // Mark product as discontinued in all mappings
  await ProductSyncService.handleProductDelete(shopId, productId);

  logger.info(`Product delete handled for ${productId}`);
}

async function handleInventoryUpdate(shopId: string, payload: any) {
  logger.info(`Handling inventory update for shop ${shopId}`);

  // Shopify sends inventory_levels/update webhook with inventory_item_id
  if (!payload.inventory_item_id) {
    logger.error('No inventory_item_id in webhook payload');
    return;
  }

  // Update supplier inventory and propagate to retailers
  await InventorySyncService.updateSupplierInventory(shopId, payload);

  logger.info(`Inventory update handled for item ${payload.inventory_item_id}`);
}

async function handleOrderUpdate(_shopId: string, _payload: any) {
  logger.info('Order update - TO BE IMPLEMENTED IN PHASE 2');
  // TODO Phase 2: Update PurchaseOrder status if this is a wholesale order
  // TODO Phase 2: Sync fulfillment status
  // TODO Phase 2: Update tracking information
}

async function handleAppUninstall(shopId: string) {
  logger.info(`Handling app uninstall for shop: ${shopId}`);

  try {
    // Pause all connections where this shop is supplier or retailer
    await prisma.connection.updateMany({
      where: {
        OR: [{ supplierShopId: shopId }, { retailerShopId: shopId }],
        status: 'ACTIVE',
      },
      data: {
        status: 'PAUSED',
      },
    });

    logger.info(`Paused all connections for shop ${shopId}`);

    // Mark shop role as RETAILER (downgrade from SUPPLIER to prevent billing)
    // Keep the shop record for data retention
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        role: 'RETAILER', // Retailers don't pay
        plan: 'FREE',
      },
    });

    logger.info(`Downgraded shop ${shopId} to FREE/RETAILER plan`);
  } catch (error) {
    logger.error(`Error handling app uninstall for ${shopId}:`, error);
    throw error;
  }
}
