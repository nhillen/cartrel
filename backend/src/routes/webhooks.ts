import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { config } from '../config';

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

    // TODO: Queue webhook for processing

    logger.info(`Webhook received: ${topic} from ${shopDomain}`);

    // Handle app uninstall webhook
    if (topic === 'app/uninstalled' || topic === 'uninstalled') {
      await handleAppUninstall(shopDomain);
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error:', error);
    // Always return 200 to Shopify to avoid retries on our errors
    res.status(200).send('OK');
  }
});

/**
 * Handle app uninstall - pause connections to free up supplier slots
 */
async function handleAppUninstall(shopDomain: string) {
  try {
    logger.info(`Handling app uninstall for: ${shopDomain}`);

    const shop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shopDomain },
    });

    if (!shop) {
      logger.warn(`Shop not found for uninstall webhook: ${shopDomain}`);
      return;
    }

    // Clear access token so reinstall triggers OAuth
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        accessToken: '',
      },
    });

    // Pause all connections where this shop is the retailer
    // This frees up supplier connection slots
    const pausedRetailerConnections = await prisma.connection.updateMany({
      where: {
        retailerShopId: shop.id,
        status: 'ACTIVE',
      },
      data: {
        status: 'PAUSED',
      },
    });

    // Pause all connections where this shop is the supplier
    const pausedSupplierConnections = await prisma.connection.updateMany({
      where: {
        supplierShopId: shop.id,
        status: 'ACTIVE',
      },
      data: {
        status: 'PAUSED',
      },
    });

    logger.info(
      `App uninstalled: ${shopDomain} - Cleared token, paused ${pausedRetailerConnections.count} retailer connections and ${pausedSupplierConnections.count} supplier connections`
    );

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'SHOP_UNINSTALLED',
        resourceType: 'Shop',
        resourceId: shop.id,
        metadata: {
          retailerConnectionsPaused: pausedRetailerConnections.count,
          supplierConnectionsPaused: pausedSupplierConnections.count,
        },
      },
    });
  } catch (error) {
    logger.error('Error handling app uninstall:', error);
  }
}

export default router;
