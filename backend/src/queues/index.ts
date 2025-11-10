import Queue from 'bull';
import { config } from '../config';
import { logger } from '../utils/logger';
import { processWebhook } from './processors/webhook';

let webhookQueue: Queue.Queue;

export function initializeQueues() {
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

  // Register processors
  webhookQueue.process(10, processWebhook);

  // Event listeners
  webhookQueue.on('completed', (job) => {
    logger.debug(`Webhook job ${job.id} completed`);
  });

  webhookQueue.on('failed', (job, err) => {
    logger.error(`Webhook job ${job.id} failed:`, err);
  });

  webhookQueue.on('error', (error) => {
    logger.error('Queue error:', error);
  });

  logger.info('✓ Webhook queue initialized');

  return { webhookQueue };
}

export function getWebhookQueue() {
  if (!webhookQueue) {
    throw new Error('Webhook queue not initialized');
  }
  return webhookQueue;
}
