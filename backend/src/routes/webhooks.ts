import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';

const router = Router();

// Shopify webhook handler
// POST /webhooks/shopify/:topic
router.post('/shopify/:topic', async (req, res): Promise<void> => {
  try {
    const { topic } = req.params;
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmac = req.get('X-Shopify-Hmac-Sha256');

    if (!shopDomain || !hmac) {
      res.status(401).json({ error: 'Missing Shopify headers' });
      return;
    }

    // TODO: Verify webhook HMAC
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
