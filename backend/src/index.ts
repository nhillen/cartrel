import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

// Webhook routes need raw body
app.use('/webhooks', express.raw({ type: 'application/json' }));

// JSON parsing for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Root endpoint - shows app is running
app.get('/', (_req, res) => {
  res.json({
    app: 'Cartrel',
    version: '0.1.0',
    status: 'running',
    message: 'Cartrel API - Shopify Wholesale Infrastructure',
    docs: 'https://github.com/nhillen/cartrel',
  });
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
