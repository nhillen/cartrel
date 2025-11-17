/**
 * Public Status Page Routes
 *
 * Provides public-facing status information for transparency
 * - Current system status
 * - Active incidents
 * - Historical uptime
 * - Component health
 */

import express from 'express';
import path from 'path';
import { prisma } from '../index';
import { logger } from '../utils/logger';

const router = express.Router();

/**
 * Serve the public status page HTML
 */
router.get('/', (_req, res) => {
  const statusPagePath = path.join(__dirname, '../views/status.html');
  res.sendFile(statusPagePath);
});

/**
 * Get current status data (JSON API for status page)
 */
router.get('/api/status', async (_req, res) => {
  try {
    // Get active incidents (not resolved)
    const activeIncidents = await prisma.incident.findMany({
      where: {
        status: {
          not: 'RESOLVED',
        },
      },
      include: {
        updates: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 5, // Last 5 updates per incident
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get recent resolved incidents (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentResolvedIncidents = await prisma.incident.findMany({
      where: {
        status: 'RESOLVED',
        resolvedAt: {
          gte: sevenDaysAgo,
        },
      },
      include: {
        updates: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 3,
        },
      },
      orderBy: {
        resolvedAt: 'desc',
      },
      take: 5, // Last 5 resolved incidents
    });

    // Determine overall status
    let overallStatus = 'OPERATIONAL';
    let overallMessage = 'All systems are functioning normally';

    if (activeIncidents.length > 0) {
      const hasCritical = activeIncidents.some(i => i.impact === 'CRITICAL');
      const hasMajor = activeIncidents.some(i => i.impact === 'MAJOR');

      if (hasCritical) {
        overallStatus = 'DOWN';
        overallMessage = 'Some systems are experiencing critical issues';
      } else if (hasMajor) {
        overallStatus = 'DEGRADED';
        overallMessage = 'Some systems are experiencing degraded performance';
      } else {
        overallStatus = 'DEGRADED';
        overallMessage = 'Some systems are experiencing minor issues';
      }
    }

    // Get component status
    const componentStatus = await getComponentStatus(activeIncidents);

    // Calculate uptime (simplified - based on incidents)
    const uptime = await calculateUptime();

    res.json({
      overall: {
        status: overallStatus,
        message: overallMessage,
      },
      components: componentStatus,
      incidents: [...activeIncidents, ...recentResolvedIncidents].map(incident => ({
        id: incident.id,
        title: incident.title,
        component: incident.component,
        status: incident.status,
        impact: incident.impact,
        createdAt: incident.createdAt,
        resolvedAt: incident.resolvedAt,
        updates: incident.updates.map(update => ({
          message: update.message,
          status: update.status,
          createdAt: update.createdAt,
        })),
      })),
      uptime,
    });
  } catch (error) {
    logger.error('Error fetching status:', error);
    res.status(500).json({
      error: 'Failed to fetch status',
      overall: { status: 'UNKNOWN', message: 'Unable to determine system status' },
      components: [],
      incidents: [],
      uptime: { last7Days: 0, last30Days: 0, last90Days: 0 },
    });
  }
});

/**
 * Determine status for each component based on active incidents
 */
async function getComponentStatus(activeIncidents: any[]): Promise<any[]> {
  const components = [
    { id: 'AUTHENTICATION', name: 'Authentication & Login' },
    { id: 'PRODUCT_SYNC', name: 'Product Sync' },
    { id: 'INVENTORY_SYNC', name: 'Inventory Sync' },
    { id: 'ORDER_FORWARDING', name: 'Order Forwarding' },
    { id: 'BILLING', name: 'Billing & Subscriptions' },
    { id: 'WEBHOOKS', name: 'Webhook Processing' },
  ];

  return components.map(component => {
    const componentIncidents = activeIncidents.filter(i => i.component === component.id);

    if (componentIncidents.length === 0) {
      return {
        id: component.id,
        name: component.name,
        status: 'OPERATIONAL',
        statusText: 'Operational',
      };
    }

    const hasCritical = componentIncidents.some(i => i.impact === 'CRITICAL');
    const hasMajor = componentIncidents.some(i => i.impact === 'MAJOR');

    if (hasCritical) {
      return {
        id: component.id,
        name: component.name,
        status: 'DOWN',
        statusText: 'Outage',
      };
    } else if (hasMajor) {
      return {
        id: component.id,
        name: component.name,
        status: 'DEGRADED',
        statusText: 'Degraded',
      };
    } else {
      return {
        id: component.id,
        name: component.name,
        status: 'DEGRADED',
        statusText: 'Minor Issues',
      };
    }
  });
}

/**
 * Calculate uptime percentages based on incident history
 * Simplified: assumes 100% uptime minus time with CRITICAL incidents
 */
async function calculateUptime(): Promise<{
  last7Days: number;
  last30Days: number;
  last90Days: number;
}> {
  const now = new Date();

  async function getUptimeForPeriod(days: number): Promise<number> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all incidents in period
    const incidents = await prisma.incident.findMany({
      where: {
        impact: 'CRITICAL', // Only count critical incidents as downtime
        createdAt: {
          gte: startDate,
        },
      },
    });

    if (incidents.length === 0) {
      return 99.9; // Base uptime even with no incidents
    }

    // Calculate total downtime in minutes
    let totalDowntimeMinutes = 0;

    for (const incident of incidents) {
      const start = incident.createdAt;
      const end = incident.resolvedAt || now; // If not resolved, count until now
      const downtimeMs = end.getTime() - start.getTime();
      totalDowntimeMinutes += downtimeMs / 1000 / 60;
    }

    // Calculate uptime percentage
    const totalMinutesInPeriod = days * 24 * 60;
    const uptimePercentage = ((totalMinutesInPeriod - totalDowntimeMinutes) / totalMinutesInPeriod) * 100;

    // Round to 1 decimal place
    return Math.round(uptimePercentage * 10) / 10;
  }

  const last7Days = await getUptimeForPeriod(7);
  const last30Days = await getUptimeForPeriod(30);
  const last90Days = await getUptimeForPeriod(90);

  return { last7Days, last30Days, last90Days };
}

export default router;
