import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { config } from '../config';
import { getWebhookQueue, initializeQueues } from '../queues';
import { WebhookTopic } from '@prisma/client';

const router = Router();

/**
 * Verify Shopify webhook HMAC signature
 * This prevents unauthorized parties from sending fake webhooks
 */
function verifyShopifyWebhook(req: Request, res: Response, next: NextFunction): void {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    if (!hmacHeader) {
      logger.warn('Webhook rejected: Missing HMAC header');
      res.status(401).json({ error: 'Missing HMAC signature' });
      return;
    }

    // Get raw body (configured in index.ts with express.raw())
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      logger.error('Webhook rejected: Body is not a Buffer', { bodyType: typeof rawBody });
      res.status(400).json({ error: 'Invalid request body format' });
      return;
    }

    // Compute HMAC-SHA256 of the raw body using Shopify API secret
    const computedHmac = crypto
      .createHmac('sha256', config.shopify.apiSecret)
      .update(rawBody)
      .digest('base64');

    // Compare with the header value using timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(hmacHeader, 'base64'),
      Buffer.from(computedHmac, 'base64')
    );

    if (!isValid) {
      logger.warn('Webhook rejected: Invalid HMAC signature', {
        shopDomain: req.get('X-Shopify-Shop-Domain'),
        topic: req.params.topic,
      });
      res.status(401).json({ error: 'Invalid HMAC signature' });
      return;
    }

    // HMAC verified successfully
    logger.debug('Webhook HMAC verified successfully');
    next();
  } catch (error) {
    logger.error('Error verifying webhook HMAC:', error);
    res.status(401).json({ error: 'HMAC verification failed' });
  }
}

// Shopify webhook handler
// POST /webhooks/shopify/:topic
// HMAC verification middleware applied to ensure webhook authenticity
router.post('/shopify/:topic', verifyShopifyWebhook, async (req, res): Promise<void> => {
  try {
    const { topic } = req.params;
    const shopDomain = req.get('X-Shopify-Shop-Domain');

    if (!shopDomain) {
      res.status(401).json({ error: 'Missing shop domain header' });
      return;
    }

    const rawBody = req.body as Buffer;
    let payload: any;

    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (parseError) {
      logger.error('Webhook rejected: Invalid JSON payload', { topic, shopDomain, parseError });
      res.status(200).send('OK');
      return;
    }

    const shop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shopDomain },
    });

    if (!shop) {
      logger.warn(`Webhook from unknown shop: ${shopDomain}`);
      res.status(200).send('OK');
      return;
    }

    const webhookTopic = mapShopifyTopic(topic);

    if (!webhookTopic) {
      logger.warn(`Webhook topic not supported: ${topic}`);
      res.status(200).send('OK');
      return;
    }

    logger.info(`Webhook received: ${topic} from ${shopDomain}`);

    let webhookQueue;
    try {
      webhookQueue = getWebhookQueue();
    } catch {
      ({ webhookQueue } = initializeQueues());
    }

    await webhookQueue.add({
      topic: webhookTopic,
      shopId: shop.id,
      shopifyId: extractShopifyId(payload),
      payload,
    });

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error:', error);
    // Always return 200 to Shopify to avoid retries on our errors
    res.status(200).send('OK');
  }
});

export default router;

function mapShopifyTopic(topic: string): WebhookTopic | null {
  const normalized = topic.toLowerCase();

  switch (normalized) {
    case 'products/create':
      return 'PRODUCTS_CREATE';
    case 'products/update':
      return 'PRODUCTS_UPDATE';
    case 'products/delete':
      return 'PRODUCTS_DELETE';
    case 'inventory_levels/update':
      return 'INVENTORY_LEVELS_UPDATE';
    case 'orders/create':
      return 'ORDERS_CREATE';
    case 'orders/updated':
      return 'ORDERS_UPDATED';
    case 'app/uninstalled':
    case 'uninstalled':
      return 'APP_UNINSTALLED';
    default:
      return null;
  }
}

function extractShopifyId(payload: any): string {
  if (!payload) {
    return 'unknown';
  }

  if (payload.admin_graphql_api_id) {
    const parts = payload.admin_graphql_api_id.split('/');
    return parts[parts.length - 1] || payload.admin_graphql_api_id;
  }

  if (payload.id) {
    return payload.id.toString();
  }

  if (payload.inventory_item_id) {
    return payload.inventory_item_id.toString();
  }

  if (payload.order_id) {
    return payload.order_id.toString();
  }

  return 'unknown';
}
