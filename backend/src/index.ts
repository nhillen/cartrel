import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { PrismaClient } from '@prisma/client';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { config } from './config';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import shopRoutes from './routes/shop';
import webhookRoutes from './routes/webhooks';
import supplierRoutes from './routes/supplier';
import retailerRoutes from './routes/retailer';
import billingRoutes from './routes/billing';
import { errorHandler } from './middleware/errorHandler';
import { initializeQueues } from './queues';

// Initialize Prisma
export const prisma = new PrismaClient({
  log: config.isDevelopment ? ['query', 'error', 'warn'] : ['error'],
});

// Initialize Express app
const app = express();

// Middleware
app.use(cors({
  origin: config.appUrl,
  credentials: true,
}));

// Cookie parser - needed for Shopify OAuth flow
app.use(cookieParser());

// Webhook routes need raw body
app.use('/webhooks', express.raw({ type: 'application/json' }));

// JSON parsing for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true, // Need to save for OAuth flow
  cookie: {
    secure: config.isProduction,
    httpOnly: true,
    sameSite: config.isProduction ? 'none' : 'lax', // Required for embedded apps
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Exit iframe route - breaks out of Shopify admin iframe for OAuth
app.get('/exitiframe', (req, res): void => {
  const redirectUri = req.query.redirectUri as string;

  if (!redirectUri) {
    res.status(400).send('Missing redirectUri parameter');
    return;
  }

  // Validate that redirectUri is safe (same domain or Shopify domain)
  try {
    const url = new URL(redirectUri);
    const isOwnDomain = url.hostname === new URL(config.appUrl).hostname;
    const isShopifyDomain = url.hostname === 'admin.shopify.com' || url.hostname.endsWith('.myshopify.com');

    if (!isOwnDomain && !isShopifyDomain) {
      res.status(400).send('Invalid redirect URI');
      return;
    }

    // Render page that breaks out of iframe using window.open
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting...</title>
        </head>
        <body>
          <p style="text-align: center; margin-top: 50px; font-family: sans-serif;">
            Redirecting to authentication...
          </p>
          <script>
            // Shopify's recommended approach: use window.open with "_top" target
            window.open("${redirectUri}", "_top");
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Invalid redirectUri:', error);
    res.status(400).send('Invalid redirect URI');
  }
});

// Onboarding page - role selection for new installs
app.get('/onboarding', (_req, res): void => {
  res.sendFile(__dirname + '/views/onboarding.html');
});

// Pricing page
app.get('/pricing', (_req, res): void => {
  res.sendFile(__dirname + '/views/pricing.html');
});

// Privacy policy page
app.get('/privacy', (_req, res): void => {
  res.sendFile(__dirname + '/views/privacy.html');
});

// Invite page
app.get('/invite/:supplierShop', (_req, res): void => {
  res.sendFile(__dirname + '/views/invite.html');
});

// Get supplier info for invite
app.get('/api/invite/:supplierShop/info', async (req, res): Promise<void> => {
  try {
    const { supplierShop } = req.params;
    const shop = await prisma.shop.findUnique({
      where: { myshopifyDomain: supplierShop },
    });

    res.json({
      name: shop?.myshopifyDomain || supplierShop,
      exists: !!shop,
    });
  } catch (error) {
    logger.error('Error loading supplier info:', error);
    res.json({ name: req.params.supplierShop, exists: false });
  }
});

// Validate invite (connection created after OAuth for security)
app.post('/api/invite/:supplierShop/accept', async (req, res): Promise<void> => {
  try {
    const { supplierShop } = req.params;
    const { retailerShop } = req.body;

    // Validate retailer shop format
    if (!retailerShop || !retailerShop.includes('.myshopify.com')) {
      res.status(400).json({ error: 'Invalid shop domain' });
      return;
    }

    // Verify supplier exists
    const supplier = await prisma.shop.findUnique({
      where: { myshopifyDomain: supplierShop },
    });

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    // Don't create connection yet - will be created after OAuth authentication
    // This prevents anyone from creating unauthorized connections
    logger.info(`Invite validated: ${retailerShop} → ${supplierShop}`);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error validating invite:', error);
    res.status(500).json({ error: 'Failed to validate invite' });
  }
});

// Root endpoint - serve landing page for browsers, JSON for API clients, or app for embedded Shopify
app.get('/', async (req, res): Promise<void> => {
  // Check if this is an embedded Shopify app request (has host and shop query params)
  if (req.query.host && req.query.shop) {
    try {
      // Get shop from database to check role
      const shop = await prisma.shop.findUnique({
        where: { myshopifyDomain: req.query.shop as string },
      });

      if (shop) {
        // Check if shop has access token - if not, need to redo OAuth
        if (!shop.accessToken || shop.accessToken === '') {
          logger.warn(`Shop ${shop.myshopifyDomain} has no access token, redirecting to OAuth`);
          const oauthUrl = `${config.appUrl}/auth/shopify?shop=${shop.myshopifyDomain}`;

          // Redirect to exitiframe route with the OAuth URL as a parameter
          const exitUrl = `${config.appUrl}/exitiframe?redirectUri=${encodeURIComponent(oauthUrl)}`;
          res.redirect(exitUrl);
          return;
        }

        // Serve role-specific dashboard
        if (shop.role === 'SUPPLIER' || shop.role === 'BOTH') {
          res.sendFile(__dirname + '/views/supplier-dashboard.html');
          return;
        } else if (shop.role === 'RETAILER') {
          res.sendFile(__dirname + '/views/retailer-dashboard.html');
          return;
        }
      }
    } catch (error) {
      logger.error('Error loading shop role:', error);
    }

    // Fallback to generic app view
    res.sendFile(__dirname + '/views/app.html');
    return;
  }

  // Check if request wants JSON (API client)
  const acceptsJson = req.accepts('html') === 'html' ? false : true;

  if (acceptsJson || req.query.json) {
    res.json({
      app: 'Cartrel',
      version: '0.1.0',
      status: 'running',
      message: 'Cartrel API - Shopify Wholesale Infrastructure',
      docs: 'https://github.com/nhillen/cartrel',
    });
    return;
  }

  // Serve landing page for browsers
  res.sendFile(__dirname + '/views/landing.html');
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
  });
});

// API Routes
app.use('/auth', authRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/retailer', retailerRoutes);
app.use('/api/billing', billingRoutes);
app.use('/billing', billingRoutes); // For /billing/confirm callback
app.use('/webhooks', webhookRoutes);

// Bull Board for queue monitoring (development only)
if (config.isDevelopment) {
  const { webhookQueue } = initializeQueues();
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullAdapter(webhookQueue)],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());
  logger.info('Bull Board available at /admin/queues');
}

// Error handling
app.use(errorHandler);

// Start server
const PORT = config.port;

async function start() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✓ Database connected');

    // Initialize queues
    initializeQueues();
    logger.info('✓ Queues initialized');

    // Start server
    app.listen(PORT, () => {
      logger.info(`🚀 Cartrel backend running on port ${PORT}`);
      logger.info(`   Environment: ${config.nodeEnv}`);
      logger.info(`   App URL: ${config.appUrl}`);
      logger.info(`   Health: http://localhost:${PORT}/health`);
      if (config.isDevelopment) {
        logger.info(`   Queue Monitor: http://localhost:${PORT}/admin/queues`);
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

start();
