/**
 * HealthCheckService - Automated system health monitoring
 *
 * Core responsibilities:
 * - Monitor webhook queue size
 * - Track webhook error rates
 * - Measure API response times
 * - Auto-create incidents when thresholds exceeded
 *
 * Run this as a cron job every 5 minutes:
 * Cron: every 5 minutes - node -e "require('./dist/services/HealthCheckService').HealthCheckService.runHealthChecks()"
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { initializeQueues } from '../queues';
import { SystemComponent } from '@prisma/client';

export class HealthCheckService {
  /**
   * Run all health checks and record metrics
   */
  static async runHealthChecks(): Promise<void> {
    try {
      logger.info('Running health checks...');

      // Check webhook queue health
      await this.checkWebhookQueue();

      // Check database performance
      await this.checkDatabasePerformance();

      // Check API health (via simple query)
      await this.checkAPIHealth();

      logger.info('Health checks completed');
    } catch (error) {
      logger.error('Error running health checks:', error);
    }
  }

  /**
   * Check webhook queue for backlog and error rate
   */
  private static async checkWebhookQueue(): Promise<void> {
    try {
      const { webhookQueue } = initializeQueues();

      // Get queue metrics
      const waitingCount = await webhookQueue.getWaitingCount();
      const activeCount = await webhookQueue.getActiveCount();
      const failedCount = await webhookQueue.getFailedCount();
      const completedCount = await webhookQueue.getCompletedCount();

      const totalProcessed = failedCount + completedCount;
      const errorRate = totalProcessed > 0 ? failedCount / totalProcessed : 0;
      const queueSize = waitingCount + activeCount;

      logger.info(
        `Webhook queue: ${queueSize} pending, ${errorRate.toFixed(3)} error rate`
      );

      // Determine health status
      const healthy = queueSize < 500 && errorRate < 0.05;

      // Record metric
      await prisma.systemHealth.create({
        data: {
          component: 'WEBHOOKS',
          webhookQueueSize: queueSize,
          webhookErrorRate: errorRate,
          healthy,
        },
      });

      // Auto-create incident if unhealthy
      if (!healthy) {
        await this.createIncidentIfNeeded(SystemComponent.WEBHOOKS, {
          webhookQueueSize: queueSize,
          webhookErrorRate: errorRate,
        });
      } else {
        // Auto-resolve incident if now healthy
        await this.resolveIncidentIfExists(SystemComponent.WEBHOOKS);
      }
    } catch (error) {
      logger.error('Error checking webhook queue:', error);
    }
  }

  /**
   * Check database performance
   */
  private static async checkDatabasePerformance(): Promise<void> {
    try {
      const startTime = Date.now();

      // Run a simple query to test database performance
      await prisma.shop.count();

      const responseTime = Date.now() - startTime;

      logger.info(`Database response time: ${responseTime}ms`);

      const healthy = responseTime < 500; // 500ms threshold

      await prisma.systemHealth.create({
        data: {
          component: 'DATABASE',
          databaseResponseTime: responseTime,
          healthy,
        },
      });

      if (!healthy) {
        await this.createIncidentIfNeeded(SystemComponent.DATABASE, {
          databaseResponseTime: responseTime,
        });
      } else {
        await this.resolveIncidentIfExists(SystemComponent.DATABASE);
      }
    } catch (error) {
      logger.error('Error checking database performance:', error);

      // Database is DOWN if we can't even run a query
      await this.createIncidentIfNeeded('DATABASE', {
        databaseResponseTime: 99999,
      });
    }
  }

  /**
   * Check API health (basic sanity check)
   */
  private static async checkAPIHealth(): Promise<void> {
    try {
      const startTime = Date.now();

      // Simple health check - just verify prisma is connected
      await prisma.$queryRaw`SELECT 1`;

      const responseTime = Date.now() - startTime;

      logger.info(`API response time: ${responseTime}ms`);

      const healthy = responseTime < 1000;

      await prisma.systemHealth.create({
        data: {
          component: 'API',
          apiResponseTime: responseTime,
          healthy,
        },
      });

      if (!healthy) {
        await this.createIncidentIfNeeded(SystemComponent.API, {
          apiResponseTime: responseTime,
        });
      } else {
        await this.resolveIncidentIfExists(SystemComponent.API);
      }
    } catch (error) {
      logger.error('Error checking API health:', error);
    }
  }

  /**
   * Create an incident if one doesn't already exist for this component
   */
  private static async createIncidentIfNeeded(
    component: SystemComponent,
    metrics: any
  ): Promise<void> {
    try {
      // Check for existing unresolved incident
      const existingIncident = await prisma.incident.findFirst({
        where: {
          component,
          status: {
            not: 'RESOLVED',
          },
        },
      });

      if (existingIncident) {
        // Already tracking this issue
        return;
      }

      // Determine incident details
      let title = '';
      let impact: 'MINOR' | 'MAJOR' | 'CRITICAL' = 'MINOR';
      let message = '';

      if (metrics.webhookQueueSize !== undefined) {
        if (metrics.webhookQueueSize > 5000) {
          title = `Webhook Queue Severely Backed Up (${metrics.webhookQueueSize} items)`;
          impact = 'MAJOR';
          message = `Webhook queue has ${metrics.webhookQueueSize} pending items. Sync delays of 30+ minutes expected.`;
        } else if (metrics.webhookQueueSize > 1000) {
          title = `Webhook Queue Backlog (${metrics.webhookQueueSize} items)`;
          impact = 'MINOR';
          message = `Webhook queue has ${metrics.webhookQueueSize} pending items. Sync delays of 10-15 minutes expected.`;
        }
      }

      if (metrics.webhookErrorRate !== undefined && metrics.webhookErrorRate > 0.1) {
        const errorPct = Math.round(metrics.webhookErrorRate * 100);
        title = `High Webhook Failure Rate (${errorPct}%)`;
        impact = metrics.webhookErrorRate > 0.2 ? 'MAJOR' : 'MINOR';
        message = `${errorPct}% of webhooks are failing. Investigating root cause.`;
      }

      if (metrics.databaseResponseTime !== undefined && metrics.databaseResponseTime > 500) {
        title = `Database Performance Degraded (${metrics.databaseResponseTime}ms)`;
        impact = metrics.databaseResponseTime > 2000 ? 'MAJOR' : 'MINOR';
        message = `Database queries are slow (${metrics.databaseResponseTime}ms avg). Performance degraded.`;
      }

      if (metrics.apiResponseTime !== undefined && metrics.apiResponseTime > 1000) {
        title = `API Response Time Degraded (${metrics.apiResponseTime}ms)`;
        impact = metrics.apiResponseTime > 5000 ? 'MAJOR' : 'MINOR';
        message = `API is responding slowly (${metrics.apiResponseTime}ms avg).`;
      }

      if (title) {
        await prisma.incident.create({
          data: {
            title,
            component,
            impact,
            status: 'INVESTIGATING',
            autoDetected: true,
            updates: {
              create: {
                message,
                status: 'INVESTIGATING',
              },
            },
          },
        });

        logger.warn(`Auto-created incident: ${title}`);
      }
    } catch (error) {
      logger.error('Error creating incident:', error);
    }
  }

  /**
   * Auto-resolve an incident if system is now healthy
   */
  private static async resolveIncidentIfExists(component: SystemComponent): Promise<void> {
    try {
      const incident = await prisma.incident.findFirst({
        where: {
          component,
          autoDetected: true, // Only auto-resolve auto-detected incidents
          status: {
            not: 'RESOLVED',
          },
        },
      });

      if (incident) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            updates: {
              create: {
                message: 'System health has returned to normal. This incident has been auto-resolved.',
                status: 'RESOLVED',
              },
            },
          },
        });

        logger.info(`Auto-resolved incident: ${incident.title}`);
      }
    } catch (error) {
      logger.error('Error resolving incident:', error);
    }
  }

  /**
   * Clean up old health metrics (keep last 7 days)
   */
  static async cleanupOldMetrics(): Promise<void> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const deleted = await prisma.systemHealth.deleteMany({
        where: {
          createdAt: {
            lt: sevenDaysAgo,
          },
        },
      });

      logger.info(`Cleaned up ${deleted.count} old health metrics`);
    } catch (error) {
      logger.error('Error cleaning up old metrics:', error);
    }
  }
}

// Allow running as standalone script
if (require.main === module) {
  HealthCheckService.runHealthChecks()
    .then(() => {
      logger.info('Health checks completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Health checks failed:', error);
      process.exit(1);
    });
}
