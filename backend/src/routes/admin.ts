/**
 * Admin Routes
 *
 * Internal admin endpoints for:
 * - Incident management (status page)
 * - System health monitoring
 * - Manual overrides
 *
 * NOTE: These endpoints should be protected with admin authentication in production
 */

import express, { NextFunction, Request, Response } from 'express';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { SystemComponent } from '@prisma/client';
import { config } from '../config';

const router = express.Router();

// Require admin authentication for all routes in this router
router.use(requireAdminAuth);

/**
 * Create a new incident (manual)
 */
router.post('/incidents', async (req, res) => {
  try {
    const { title, component, impact, message } = req.body;

    if (!title || !component || !impact) {
      return res.status(400).json({ error: 'Missing required fields: title, component, impact' });
    }

    // Create incident
    const incident = await prisma.incident.create({
      data: {
        title,
        component,
        impact,
        status: 'INVESTIGATING',
        autoDetected: false,
        updates: {
          create: {
            message: message || `Investigating ${title}`,
            status: 'INVESTIGATING',
          },
        },
      },
      include: {
        updates: true,
      },
    });

    logger.info(`Manual incident created: ${incident.id} - ${title}`);

    return res.json(incident);
  } catch (error) {
    logger.error('Error creating incident:', error);
    return res.status(500).json({ error: 'Failed to create incident' });
  }
});

/**
 * Add an update to an existing incident
 */
router.post('/incidents/:incidentId/updates', async (req, res) => {
  try {
    const { incidentId } = req.params;
    const { message, status } = req.body;

    if (!message || !status) {
      return res.status(400).json({ error: 'Missing required fields: message, status' });
    }

    // Verify incident exists
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Create update
    const update = await prisma.incidentUpdate.create({
      data: {
        incidentId,
        message,
        status,
      },
    });

    // Update incident status
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status,
        identifiedAt: status === 'IDENTIFIED' && !incident.identifiedAt ? new Date() : undefined,
      },
    });

    logger.info(`Incident update added: ${incidentId} - ${status}`);

    return res.json(update);
  } catch (error) {
    logger.error('Error adding incident update:', error);
    return res.status(500).json({ error: 'Failed to add update' });
  }
});

/**
 * Resolve an incident
 */
router.post('/incidents/:incidentId/resolve', async (req, res) => {
  try {
    const { incidentId } = req.params;
    const { message } = req.body;

    const incident = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        updates: {
          create: {
            message: message || 'This incident has been resolved.',
            status: 'RESOLVED',
          },
        },
      },
      include: {
        updates: true,
      },
    });

    logger.info(`Incident resolved: ${incidentId}`);

    res.json(incident);
  } catch (error) {
    logger.error('Error resolving incident:', error);
    res.status(500).json({ error: 'Failed to resolve incident' });
  }
});

/**
 * List all incidents (with pagination)
 */
router.get('/incidents', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const incidents = await prisma.incident.findMany({
      where,
      include: {
        updates: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: Number(limit),
      skip: Number(offset),
    });

    const total = await prisma.incident.count({ where });

    res.json({
      incidents,
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    logger.error('Error listing incidents:', error);
    res.status(500).json({ error: 'Failed to list incidents' });
  }
});

/**
 * Delete an incident (cleanup/testing)
 */
router.delete('/incidents/:incidentId', async (req, res) => {
  try {
    const { incidentId } = req.params;

    await prisma.incident.delete({
      where: { id: incidentId },
    });

    logger.info(`Incident deleted: ${incidentId}`);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting incident:', error);
    res.status(500).json({ error: 'Failed to delete incident' });
  }
});

/**
 * Get system health metrics
 */
router.get('/health/metrics', async (req, res) => {
  try {
    const { component, limit = 100 } = req.query;

    const where: any = {};
    if (component) {
      where.component = component;
    }

    const metrics = await prisma.systemHealth.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: Number(limit),
    });

    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching health metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * Record a health metric (called by automated health checks)
 */
router.post('/health/metrics', async (req, res) => {
  try {
    const {
      component,
      webhookQueueSize,
      webhookErrorRate,
      apiResponseTime,
      databaseResponseTime,
      healthy,
    } = req.body;

    if (!component) {
      return res.status(400).json({ error: 'Missing required field: component' });
    }

    const metric = await prisma.systemHealth.create({
      data: {
        component,
        webhookQueueSize,
        webhookErrorRate,
        apiResponseTime,
        databaseResponseTime,
        healthy: healthy !== undefined ? healthy : true,
      },
    });

    // Auto-create incident if system becomes unhealthy
    if (!healthy) {
      await autoCreateIncidentIfNeeded(component, {
        webhookQueueSize,
        webhookErrorRate,
        apiResponseTime,
        databaseResponseTime,
      });
    }

    return res.json(metric);
  } catch (error) {
    logger.error('Error recording health metric:', error);
    return res.status(500).json({ error: 'Failed to record metric' });
  }
});

/**
 * Auto-create incident if health checks detect issues
 */
async function autoCreateIncidentIfNeeded(
  component: SystemComponent,
  metrics: any
): Promise<void> {
  try {
    // Check if there's already an active incident for this component
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

    // Determine issue title and impact
    let title = '';
    let impact: 'MINOR' | 'MAJOR' | 'CRITICAL' = 'MINOR';
    let message = '';

    if (metrics.webhookQueueSize > 1000) {
      title = `Webhook Queue Backlog (${metrics.webhookQueueSize} items)`;
      impact = metrics.webhookQueueSize > 5000 ? 'MAJOR' : 'MINOR';
      message = `Webhook queue has ${metrics.webhookQueueSize} pending items. Sync delays expected.`;
    } else if (metrics.webhookErrorRate > 0.1) {
      title = `High Webhook Error Rate (${Math.round(metrics.webhookErrorRate * 100)}%)`;
      impact = metrics.webhookErrorRate > 0.2 ? 'MAJOR' : 'MINOR';
      message = `${Math.round(metrics.webhookErrorRate * 100)}% of webhooks are failing. Investigating root cause.`;
    } else if (metrics.apiResponseTime > 5000) {
      title = `Slow API Response Time (${metrics.apiResponseTime}ms)`;
      impact = 'MINOR';
      message = `API is responding slowly (${metrics.apiResponseTime}ms avg). Performance degraded.`;
    } else if (metrics.databaseResponseTime > 1000) {
      title = `Database Performance Degraded (${metrics.databaseResponseTime}ms)`;
      impact = 'MINOR';
      message = `Database queries are slow (${metrics.databaseResponseTime}ms avg). May affect performance.`;
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
    logger.error('Error auto-creating incident:', error);
  }
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminApiKey) {
    logger.error('ADMIN_API_KEY is not configured. Blocking admin access.');
    res.status(503).json({ error: 'Admin API is not configured' });
    return;
  }

  const headerToken = req.get('x-cartrel-admin-token');
  const bearer = req.get('authorization');
  const bearerToken = bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : null;
  const token = headerToken || bearerToken;

  if (!token || token !== config.adminApiKey) {
    logger.warn('Admin authentication failed', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export default router;
