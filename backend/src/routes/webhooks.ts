import { Router } from 'express';
import { logger } from '../utils/logger';

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

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error:', error);
    // Always return 200 to Shopify to avoid retries on our errors
    res.status(200).send('OK');
  }
});

export default router;
