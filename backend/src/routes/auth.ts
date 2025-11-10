import { Router } from 'express';
import { Session } from '@shopify/shopify-api';
import { logger } from '../utils/logger';
import { shopify, saveShop, getShop } from '../services/shopify';
import { config } from '../config';

const router = Router();

// Shopify OAuth initiation
// GET /auth/shopify?shop=example.myshopify.com
router.get('/shopify', async (req, res, next): Promise<void> => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Validate shop domain format
    if (!shop.endsWith('.myshopify.com')) {
      res.status(400).json({ error: 'Invalid shop domain' });
      return;
    }

    logger.info(`OAuth initiated for shop: ${shop}`);

    // Begin OAuth flow
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(shop, true)!,
      callbackPath: '/auth/shopify/callback',
      isOnline: false, // Offline access tokens for background operations
      rawRequest: req,
      rawResponse: res,
    });
  } catch (error) {
    logger.error('OAuth initiation error:', error);
    next(error);
  }
});

// Shopify OAuth callback
// GET /auth/shopify/callback?code=...&shop=...&hmac=...&host=...&timestamp=...
router.get('/shopify/callback', async (req, res, _next): Promise<void> => {
  try {
    logger.info('OAuth callback received');

    // Complete OAuth flow and get access token
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;

    logger.info(`OAuth completed for shop: ${session.shop}`);

    // Check if this is a new installation
    const existingShop = await getShop(session.shop);
    const isNewInstall = !existingShop;

    // Save shop and access token to database
    await saveShop(session.shop, session.accessToken!);

    // Register webhooks for this shop
    try {
      await registerWebhooks(session.shop, session.accessToken!);
    } catch (error) {
      logger.error('Error registering webhooks:', error);
      // Don't fail the OAuth flow if webhooks fail
    }

    // Get host parameter for embedded app URL
    const host = req.query.host as string;

    // If new install, redirect to onboarding to set role
    if (isNewInstall) {
      const onboardingUrl = `https://${session.shop}/admin/apps/${config.shopify.apiKey}/onboarding?shop=${session.shop}&host=${host}`;
      logger.info(`New install, redirecting to onboarding: ${onboardingUrl}`);
      res.redirect(onboardingUrl);
      return;
    }

    // Existing shop, redirect to app
    const redirectUrl = `https://${session.shop}/admin/apps/${config.shopify.apiKey}`;
    logger.info(`Redirecting to: ${redirectUrl}`);
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error('OAuth callback error:', error);
    // Redirect to error page
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Installation Error</title></head>
        <body>
          <h1>Installation Error</h1>
          <p>There was an error installing the Cartrel app. Please try again.</p>
          <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
        </body>
      </html>
    `);
  }
});

// Verify session token (for embedded app)
router.post('/verify', async (req, res, next): Promise<void> => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      res.status(400).json({ error: 'Missing session token' });
      return;
    }

    // Verify JWT session token from embedded app
    try {
      const payload = await shopify.session.decodeSessionToken(sessionToken);

      logger.debug(`Session token verified for shop: ${payload.dest.replace('https://', '')}`);

      res.json({
        valid: true,
        shop: payload.dest.replace('https://', ''),
        sub: payload.sub,
      });
    } catch (error) {
      logger.warn('Invalid session token');
      res.status(401).json({ valid: false, error: 'Invalid session token' });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Register webhooks for a shop
 */
async function registerWebhooks(shop: string, accessToken: string) {
  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: '',
    isOnline: false,
    accessToken,
  });

  const client = new shopify.clients.Rest({ session });

  const webhooks = [
    { topic: 'PRODUCTS_CREATE', address: `${config.appUrl}/webhooks/shopify/products/create` },
    { topic: 'PRODUCTS_UPDATE', address: `${config.appUrl}/webhooks/shopify/products/update` },
    { topic: 'PRODUCTS_DELETE', address: `${config.appUrl}/webhooks/shopify/products/delete` },
    { topic: 'INVENTORY_LEVELS_UPDATE', address: `${config.appUrl}/webhooks/shopify/inventory/update` },
    { topic: 'ORDERS_CREATE', address: `${config.appUrl}/webhooks/shopify/orders/create` },
    { topic: 'ORDERS_UPDATED', address: `${config.appUrl}/webhooks/shopify/orders/update` },
    { topic: 'APP_UNINSTALLED', address: `${config.appUrl}/webhooks/shopify/app/uninstalled` },
  ];

  for (const webhook of webhooks) {
    try {
      await client.post({
        path: 'webhooks',
        data: {
          webhook: {
            topic: webhook.topic,
            address: webhook.address,
            format: 'json',
          },
        },
      });
      logger.info(`Registered webhook: ${webhook.topic} for ${shop}`);
    } catch (error) {
      logger.error(`Failed to register webhook ${webhook.topic}:`, error);
    }
  }
}

export default router;
