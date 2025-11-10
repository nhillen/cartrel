import { Router } from 'express';
import { Session } from '@shopify/shopify-api';
import { logger } from '../utils/logger';
import { shopify, saveShop, getShop } from '../services/shopify';
import { config } from '../config';
import { prisma } from '../index';
import { canCreateConnection } from '../utils/planLimits';

const router = Router();

// Shopify OAuth initiation
// GET /auth/shopify?shop=example.myshopify.com&invite=supplier.myshopify.com
router.get('/shopify', async (req, res, next): Promise<void> => {
  try {
    const { shop, invite } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Validate shop domain format
    if (!shop.endsWith('.myshopify.com')) {
      res.status(400).json({ error: 'Invalid shop domain' });
      return;
    }

    logger.info(`OAuth initiated for shop: ${shop}${invite ? ` (invite from ${invite})` : ''}`);
    logger.debug('OAuth begin - Request cookies:', req.cookies);
    logger.debug('OAuth begin - Request headers:', req.headers);

    // Store invite in session if present (will be used after OAuth)
    if (invite && typeof invite === 'string') {
      // We'll pass this through the state parameter
      (req as any).session = (req as any).session || {};
      (req as any).session.pendingInvite = invite;
    }

    // Intercept response to fix OAuth cookie SameSite
    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = function(name: string, value: any) {
      if (name.toLowerCase() === 'set-cookie') {
        // Fix SameSite for OAuth cookies
        const cookies = Array.isArray(value) ? value : [value];
        const fixedCookies = cookies.map((cookie: string) => {
          if (cookie.includes('shopify_app_state')) {
            // Replace sameSite=lax with sameSite=none for OAuth cookies
            return cookie.replace(/sameSite=lax/gi, 'sameSite=none');
          }
          return cookie;
        });
        return originalSetHeader(name, fixedCookies);
      }
      return originalSetHeader(name, value);
    };

    // Begin OAuth flow
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(shop, true)!,
      callbackPath: '/auth/shopify/callback',
      isOnline: false, // Offline access tokens for background operations
      rawRequest: req,
      rawResponse: res,
    });

    logger.debug('OAuth begin - Response headers:', res.getHeaders());
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
    logger.debug('OAuth callback - Request cookies:', req.cookies);
    logger.debug('OAuth callback - Cookie header:', req.headers.cookie);
    logger.debug('OAuth callback - Query params:', req.query);

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

    // Check for pending invite and create connection (AFTER authentication)
    const pendingInvite = (req as any).session?.pendingInvite;
    if (pendingInvite && typeof pendingInvite === 'string') {
      try {
        logger.info(`Processing invite: ${session.shop} → ${pendingInvite}`);

        // Get supplier and retailer shops
        const supplier = await prisma.shop.findUnique({
          where: { myshopifyDomain: pendingInvite },
        });

        const retailer = await prisma.shop.findUnique({
          where: { myshopifyDomain: session.shop },
        });

        if (supplier && retailer) {
          // Check if connection already exists
          const existingConnection = await prisma.connection.findFirst({
            where: {
              supplierShopId: supplier.id,
              retailerShopId: retailer.id,
            },
          });

          if (!existingConnection) {
            // Check plan limits before creating connection
            const supplierWithConnections = await prisma.shop.findUnique({
              where: { id: supplier.id },
              include: {
                supplierConnections: { where: { status: 'ACTIVE' } },
              },
            });

            const currentConnections = supplierWithConnections?.supplierConnections.length || 0;
            const limitCheck = canCreateConnection(currentConnections, supplier.plan);

            if (!limitCheck.allowed) {
              logger.warn(`Connection blocked by plan limit: ${supplier.myshopifyDomain} (${currentConnections} connections)`);
              // Don't create connection, but don't fail OAuth either
              // Supplier will see upgrade prompt in their dashboard
              return;
            }

            // Create connection now that retailer is authenticated
            await prisma.connection.create({
              data: {
                supplierShopId: supplier.id,
                retailerShopId: retailer.id,
                status: 'ACTIVE',
                paymentTermsType: 'PREPAY',
                tier: 'STANDARD',
              },
            });

            logger.info(`Created authenticated connection: ${pendingInvite} → ${session.shop}`);

            // Log audit event
            await prisma.auditLog.create({
              data: {
                shopId: retailer.id,
                action: 'CONNECTION_CREATED',
                resourceType: 'Connection',
                resourceId: `${supplier.id}-${retailer.id}`,
              },
            });
          }
        }

        // Clear pending invite from session
        delete (req as any).session.pendingInvite;
      } catch (inviteError) {
        logger.error('Error processing pending invite:', inviteError);
        // Don't fail OAuth flow if invite processing fails
      }
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
    { topic: 'products/create', address: `${config.appUrl}/webhooks/shopify/products/create` },
    { topic: 'products/update', address: `${config.appUrl}/webhooks/shopify/products/update` },
    { topic: 'products/delete', address: `${config.appUrl}/webhooks/shopify/products/delete` },
    { topic: 'inventory_levels/update', address: `${config.appUrl}/webhooks/shopify/inventory/update` },
    { topic: 'orders/create', address: `${config.appUrl}/webhooks/shopify/orders/create` },
    { topic: 'orders/updated', address: `${config.appUrl}/webhooks/shopify/orders/update` },
    { topic: 'app/uninstalled', address: `${config.appUrl}/webhooks/shopify/app/uninstalled` },
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
