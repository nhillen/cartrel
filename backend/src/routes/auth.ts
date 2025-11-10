import { Router } from 'express';
import { logger } from '../utils/logger';

const router = Router();

// Shopify OAuth initiation
// GET /auth/shopify?shop=example.myshopify.com
router.get('/shopify', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // TODO: Implement Shopify OAuth flow
    logger.info(`OAuth initiated for shop: ${shop}`);

    res.json({ message: 'OAuth flow - TO BE IMPLEMENTED' });
  } catch (error) {
    next(error);
  }
});

// Shopify OAuth callback
// GET /auth/shopify/callback?code=...&shop=...&hmac=...
router.get('/shopify/callback', async (req, res, next) => {
  try {
    const { code, shop, hmac } = req.query;

    if (!code || !shop || !hmac) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // TODO: Implement OAuth callback handling
    logger.info(`OAuth callback received for shop: ${shop}`);

    res.json({ message: 'OAuth callback - TO BE IMPLEMENTED' });
  } catch (error) {
    next(error);
  }
});

// Verify session token (for embedded app)
router.post('/verify', async (req, res, next) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ error: 'Missing session token' });
    }

    // TODO: Implement session token verification
    logger.info('Session token verification - TO BE IMPLEMENTED');

    res.json({ valid: false, message: 'TO BE IMPLEMENTED' });
  } catch (error) {
    next(error);
  }
});

export default router;
