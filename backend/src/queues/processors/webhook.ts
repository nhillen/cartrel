import { Job } from 'bull';
import { logger } from '../../utils/logger';
import { prisma } from '../../index';
import { WebhookTopic } from '@prisma/client';

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

async function handleProductUpdate(_shopId: string, _payload: any) {
  logger.info('Product update - TO BE IMPLEMENTED');
  // TODO: Update SupplierProduct cache
  // TODO: Propagate to connected retailers if needed
}

async function handleProductDelete(_shopId: string, _payload: any) {
  logger.info('Product delete - TO BE IMPLEMENTED');
  // TODO: Mark product as inactive
  // TODO: Notify connected retailers
}

async function handleInventoryUpdate(_shopId: string, _payload: any) {
  logger.info('Inventory update - TO BE IMPLEMENTED');
  // TODO: Update inventory in cache
  // TODO: Sync to connected retailers
}

async function handleOrderUpdate(_shopId: string, _payload: any) {
  logger.info('Order update - TO BE IMPLEMENTED');
  // TODO: Update PurchaseOrder status if this is a wholesale order
}

async function handleAppUninstall(shopId: string) {
  logger.info(`App uninstalled for shop: ${shopId}`);
  // TODO: Mark shop as inactive
  // TODO: Pause all connections
  // TODO: Send notification
}
