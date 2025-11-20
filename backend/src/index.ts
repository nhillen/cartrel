import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import path from 'path';
import fs from 'fs';

import { config } from './config';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import shopRoutes from './routes/shop';
import webhookRoutes from './routes/webhooks';
import supplierRoutes from './routes/supplier';
import retailerRoutes from './routes/retailer';
import billingRoutes from './routes/billing';
import statusRoutes from './routes/status';
import adminRoutes from './routes/admin';
import { errorHandler } from './middleware/errorHandler';
import { sanitizeInputs } from './middleware/validation';
import { generalApiLimiter, authLimiter, webhookLimiter } from './middleware/rateLimits';
import { initializeQueues } from './queues';

// Initialize Prisma
export const prisma = new PrismaClient({
  log: config.isDevelopment ? ['query', 'error', 'warn'] : ['error'],
});

// Initialize Express app
const app = express();

const embeddedAppBuildPath = path.join(__dirname, '../public/app');
const embeddedAppIndexPath = path.join(embeddedAppBuildPath, 'index.html');
const hasEmbeddedAppBundle = fs.existsSync(embeddedAppIndexPath);

if (hasEmbeddedAppBundle) {
  app.use('/app/assets', express.static(path.join(embeddedAppBuildPath, 'assets')));
  app.get('/app', (_req, res) => {
    res.sendFile(embeddedAppIndexPath);
  });
  app.get('/app/*', (_req, res) => {
    res.sendFile(embeddedAppIndexPath);
  });
}

// Initialize Redis client for sessions
const redisClient = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on('error', (err) => {
  logger.error('Redis session store error:', err);
});

redisClient.on('connect', () => {
  logger.info('✓ Redis session store connected');
});

// Security: Helmet - sets various HTTP security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.shopify.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'cdn.shopify.com', 'unpkg.com'],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, etc)
      imgSrc: ["'self'", 'data:', 'https:', 'cdn.shopify.com'],
      connectSrc: ["'self'", 'https://cartrel.com', 'https://*.shopify.com', 'https://monorail-edge.shopifysvc.com'],
      frameSrc: ["'self'", 'https://*.myshopify.com'],
      frameAncestors: ["'self'", 'https://*.myshopify.com', 'https://admin.shopify.com'],
      formAction: ["'self'", 'https://*.myshopify.com', 'https://admin.shopify.com'], // Allow form submissions for OAuth
      navigateTo: ["'self'", 'https://*.myshopify.com', 'https://admin.shopify.com'], // Allow navigation for OAuth redirects
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding in Shopify admin
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow resources from different origins
}));

// Security: CORS configuration
app.use(cors({
  origin: config.appUrl,
  credentials: true,
}));

// Cookie parser - needed for Shopify OAuth flow
app.use(cookieParser());

// Webhook routes need raw body
app.use('/webhooks', express.raw({ type: 'application/json' }));

// JSON parsing for other routes
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security: Input sanitization - protects against XSS
app.use(sanitizeInputs);

// Security: Rate limiting - protects against DoS attacks
// Applied globally to all routes except webhooks (they have their own limiter)
app.use('/api', generalApiLimiter);
app.use('/auth', generalApiLimiter);

// Security: Secure session configuration with Redis store
app.use(session({
  store: new RedisStore({
    client: redisClient,
    prefix: 'cartrel:sess:',
    ttl: 24 * 60 * 60, // 24 hours in seconds
  }),
  secret: config.sessionSecret,
  name: 'cartrel.sid', // Custom session name (don't use default 'connect.sid')
  resave: false,
  saveUninitialized: false, // Don't create session until something stored (better security)
  rolling: true, // Reset maxAge on every request (keep session alive while active)
  cookie: {
    secure: config.isProduction, // HTTPS only in production
    httpOnly: true, // Prevent JavaScript access (XSS protection)
    sameSite: config.isProduction ? 'none' : 'lax', // Required for embedded apps
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    domain: config.isProduction ? '.cartrel.com' : undefined, // Restrict to domain
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

    // Render page that breaks out of iframe - use multiple methods for compatibility
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting...</title>
          <meta http-equiv="refresh" content="0;url=${redirectUri}">
        </head>
        <body>
          <p style="text-align: center; margin-top: 50px; font-family: sans-serif;">
            Redirecting to authentication...
          </p>
          <script>
            // Try multiple methods to break out of iframe
            try {
              // Method 1: Direct assignment (most reliable)
              if (window.top) {
                window.top.location.href = "${redirectUri}";
              }
            } catch (e) {
              // Method 2: Parent location (fallback)
              try {
                window.parent.location.href = "${redirectUri}";
              } catch (e2) {
                // Method 3: Current window (last resort)
                window.location.href = "${redirectUri}";
              }
            }
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

// Features page
app.get('/features', (_req, res): void => {
  res.sendFile(__dirname + '/views/features.html');
});

// Privacy policy page
app.get('/privacy', (_req, res): void => {
  res.sendFile(__dirname + '/views/privacy.html');
});

// Terms & Conditions page
app.get('/terms', (_req, res): void => {
  res.sendFile(__dirname + '/views/terms.html');
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
      const shopDomain = req.query.shop as string;
      const shop = await prisma.shop.findUnique({
        where: { myshopifyDomain: shopDomain },
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

        if (hasEmbeddedAppBundle) {
          res.sendFile(embeddedAppIndexPath);
          return;
        }

        // Fallback to legacy dashboards if bundle not built
        if (shop.role === 'SUPPLIER' || shop.role === 'BOTH') {
          res.sendFile(path.join(__dirname, '/views/supplier-dashboard.html'));
          return;
        } else if (shop.role === 'RETAILER') {
          res.sendFile(path.join(__dirname, '/views/retailer-dashboard.html'));
          return;
        }
      }
    } catch (error) {
      logger.error('Error loading shop role:', error);
    }

    // Fallback to generic app view
    res.sendFile(path.join(__dirname, '/views/app.html'));
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
// Note: Auth routes have stricter rate limiting applied in the route definitions
app.use('/auth', authLimiter, authRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/retailer', retailerRoutes);
app.use('/api/billing', billingRoutes);
app.use('/billing', billingRoutes); // For /billing/confirm callback
app.use('/webhooks', webhookLimiter, webhookRoutes);

// Public status page (no auth required)
app.use('/status', statusRoutes);

// Admin routes (TODO: add auth middleware before production)
app.use('/api/admin', adminRoutes);

// Test endpoint for Slack error reporting (development only)
if (config.isDevelopment) {
  app.get('/api/test-error', (_req, _res, next) => {
    const error = new Error('Test error from Cartrel - Slack integration test');
    next(error);
  });
}

// Slack Error Reporting (Manabot) - MUST be before errorHandler
const { slackReporter } = require('@manabot/slack-reporter');
if (process.env.SLACK_WEBHOOK_ERROR) {
  app.use(slackReporter({
    webhooks: {
      critical: process.env.SLACK_WEBHOOK_CRITICAL,
      error: process.env.SLACK_WEBHOOK_ERROR,
      warning: process.env.SLACK_WEBHOOK_WARNING,
      info: process.env.SLACK_WEBHOOK_INFO
    },
    serviceName: 'cartrel',
    environment: config.nodeEnv
  }));
  logger.info('✓ Slack error reporting enabled');
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
    const { webhookQueue } = initializeQueues();
    logger.info('✓ Queues initialized');

    // Bull Board for queue monitoring (development only)
    if (config.isDevelopment) {
      const serverAdapter = new ExpressAdapter();
      serverAdapter.setBasePath('/admin/queues');

      createBullBoard({
        queues: [new BullAdapter(webhookQueue)],
        serverAdapter,
      });

      app.use('/admin/queues', serverAdapter.getRouter());
      logger.info('Bull Board available at /admin/queues');
    }

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
