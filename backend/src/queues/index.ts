import Queue from 'bull';
import { config } from '../config';
import { logger } from '../utils/logger';
import { processWebhook } from './processors/webhook';
import { processImport } from './processors/import';

let webhookQueue: Queue.Queue | null = null;
let importQueue: Queue.Queue | null = null;
let queuesInitialized = false;

export function initializeQueues() {
  if (queuesInitialized && webhookQueue && importQueue) {
    return { webhookQueue, importQueue };
  }

  // Create webhook processing queue
  webhookQueue = new Queue('webhooks', config.redisUrl, {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  // Create import processing queue (for large catalogs)
  importQueue = new Queue('imports', config.redisUrl, {
    defaultJobOptions: {
      attempts: 2, // Only retry once for imports
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: false, // Keep for progress tracking
      removeOnFail: false,
    },
  });

  // Register processors
  webhookQueue.process(10, processWebhook);
  importQueue.process(2, processImport); // Process 2 imports concurrently

  // Webhook queue event listeners
  webhookQueue.on('completed', (job) => {
    logger.debug(`Webhook job ${job.id} completed`);
  });

  webhookQueue.on('failed', (job, err) => {
    logger.error(`Webhook job ${job.id} failed:`, err);
  });

  webhookQueue.on('error', (error) => {
    logger.error('Webhook queue error:', error);
  });

  // Import queue event listeners
  importQueue.on('completed', (job) => {
    logger.info(`Import job ${job.id} completed`);
  });

  importQueue.on('failed', (job, err) => {
    logger.error(`Import job ${job.id} failed:`, err);
  });

  importQueue.on('progress', (job, progress) => {
    logger.debug(`Import job ${job.id} progress: ${progress}%`);
  });

  importQueue.on('error', (error) => {
    logger.error('Import queue error:', error);
  });

  queuesInitialized = true;
  logger.info('✓ Webhook queue initialized');
  logger.info('✓ Import queue initialized');

  return { webhookQueue, importQueue };
}

export function getWebhookQueue() {
  if (!webhookQueue) {
    throw new Error('Webhook queue not initialized');
  }
  return webhookQueue;
}

export function getImportQueue() {
  if (!importQueue) {
    throw new Error('Import queue not initialized');
  }
  return importQueue;
}
