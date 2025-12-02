/**
 * Admin routes for CS tools
 * Protected by HTTP Basic Auth
 */

import { Router } from 'express';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { requireAdminAuth } from '../middleware/adminAuth';
import { PLAN_LIMITS } from '../utils/planLimits';
import { getWebhookQueue, getImportQueue, initializeQueues } from '../queues';
import { ConnectionHealthService } from '../services/ConnectionHealthService';
import { WebhookSubscriptionService, WEBHOOK_TOPICS } from '../services/WebhookSubscriptionService';
import * as fs from 'fs';
import * as path from 'path';

// Read deploy info once at startup
let deployInfo: { version?: string; commitHash?: string; buildDate?: string } = {};
try {
  const infoPath = path.join(__dirname, '../../.deploy-info.json');
  if (fs.existsSync(infoPath)) {
    deployInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  }
} catch {
  // Deploy info not available
}

const router = Router();

// Apply admin auth to all routes
router.use(requireAdminAuth);

/**
 * GET /api/admin/shops
 * List all shops with basic info
 */
router.get('/shops', async (req, res) => {
  try {
    const { search, role, plan } = req.query;

    const where: any = {};

    // Search by domain or company name
    if (search && typeof search === 'string') {
      where.OR = [
        { myshopifyDomain: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by role
    if (role && typeof role === 'string') {
      where.role = role;
    }

    // Filter by plan
    if (plan && typeof plan === 'string') {
      where.plan = plan;
    }

    const shops = await prisma.shop.findMany({
      where,
      select: {
        id: true,
        myshopifyDomain: true,
        companyName: true,
        role: true,
        plan: true,
        createdAt: true,
        purchaseOrdersThisMonth: true,
        currentPeriodStart: true,
        _count: {
          select: {
            supplierConnections: { where: { status: 'ACTIVE' } },
            retailerConnections: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit to prevent huge responses
    });

    // Enrich with product counts for suppliers
    const enrichedShops = await Promise.all(
      shops.map(async (shop) => {
        let productCount = 0;
        if (shop.role === 'SUPPLIER' || shop.role === 'BOTH') {
          productCount = await prisma.supplierProduct.count({
            where: {
              supplierShopId: shop.id,
              isWholesaleEligible: true,
            },
          });
        }

        return {
          ...shop,
          productCount,
          connectionCount: shop._count.supplierConnections + shop._count.retailerConnections,
        };
      })
    );

    res.json({ shops: enrichedShops });
  } catch (error) {
    logger.error('Error listing shops:', error);
    res.status(500).json({ error: 'Failed to list shops' });
  }
});

/**
 * GET /api/admin/shops/:shopId
 * Get detailed shop info
 */
router.get('/shops/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        supplierConnections: {
          include: {
            retailerShop: {
              select: {
                myshopifyDomain: true,
                companyName: true,
              },
            },
          },
        },
        retailerConnections: {
          include: {
            supplierShop: {
              select: {
                myshopifyDomain: true,
                companyName: true,
              },
            },
          },
        },
      },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Get product count
    let productCount = 0;
    if (shop.role === 'SUPPLIER' || shop.role === 'BOTH') {
      productCount = await prisma.supplierProduct.count({
        where: {
          supplierShopId: shop.id,
          isWholesaleEligible: true,
        },
      });
    }

    // Get recent audit logs
    const auditLogs = await prisma.auditLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const planLimits = PLAN_LIMITS[shop.plan];

    res.json({
      shop: {
        ...shop,
        productCount,
        planLimits,
        auditLogs,
      },
    });
  } catch (error) {
    logger.error('Error getting shop:', error);
    res.status(500).json({ error: 'Failed to get shop' });
  }
});

/**
 * PATCH /api/admin/shops/:shopId/plan
 * Update shop plan
 */
router.patch('/shops/:shopId/plan', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { plan, notes } = req.body;

    if (!plan) {
      res.status(400).json({ error: 'Plan is required' });
      return;
    }

    // Validate plan
    const validPlans = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE'];
    if (!validPlans.includes(plan)) {
      res.status(400).json({ error: 'Invalid plan', validPlans });
      return;
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const oldPlan = shop.plan;

    // Update plan
    const updatedShop = await prisma.shop.update({
      where: { id: shopId },
      data: {
        plan,
        pendingPlan: null,
        pendingChargeId: null,
      },
    });

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'TIER_UPGRADED',
        resourceType: 'Shop',
        resourceId: shop.id,
        metadata: {
          oldPlan,
          newPlan: plan,
          source: 'CS_ADMIN',
          notes: notes || 'Plan changed via CS Admin Tool',
        },
      },
    });

    logger.info(`[CS ADMIN] Plan changed for ${shop.myshopifyDomain}: ${oldPlan} -> ${plan}`);

    res.json({
      success: true,
      shop: updatedShop,
      message: `Plan updated from ${oldPlan} to ${plan}`,
    });
  } catch (error) {
    logger.error('Error updating plan:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

/**
 * POST /api/admin/shops/:shopId/reset-usage
 * Reset monthly usage counters
 */
router.post('/shops/:shopId/reset-usage', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { notes } = req.body;

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Reset usage
    const updatedShop = await prisma.shop.update({
      where: { id: shopId },
      data: {
        purchaseOrdersThisMonth: 0,
        productSKUsThisMonth: 0,
        currentPeriodStart: new Date(),
      },
    });

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'TIER_UPGRADED', // Reusing this action
        resourceType: 'Shop',
        resourceId: shop.id,
        metadata: {
          action: 'USAGE_RESET',
          source: 'CS_ADMIN',
          notes: notes || 'Usage counters reset via CS Admin Tool',
          previousOrders: shop.purchaseOrdersThisMonth,
          previousProducts: shop.productSKUsThisMonth,
        },
      },
    });

    logger.info(`[CS ADMIN] Usage reset for ${shop.myshopifyDomain}`);

    res.json({
      success: true,
      shop: updatedShop,
      message: 'Usage counters reset',
    });
  } catch (error) {
    logger.error('Error resetting usage:', error);
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

/**
 * PATCH /api/admin/shops/:shopId/role
 * Update shop role
 */
router.patch('/shops/:shopId/role', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { role, notes } = req.body;

    if (!role) {
      res.status(400).json({ error: 'Role is required' });
      return;
    }

    // Validate role
    const validRoles = ['SUPPLIER', 'RETAILER', 'BOTH'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role', validRoles });
      return;
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const oldRole = shop.role;

    // Update role
    const updatedShop = await prisma.shop.update({
      where: { id: shopId },
      data: { role },
    });

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'ROLE_CHANGED',
        resourceType: 'Shop',
        resourceId: shop.id,
        metadata: {
          oldRole,
          newRole: role,
          source: 'CS_ADMIN',
          notes: notes || 'Role changed via CS Admin Tool',
        },
      },
    });

    logger.info(`[CS ADMIN] Role changed for ${shop.myshopifyDomain}: ${oldRole} -> ${role}`);

    res.json({
      success: true,
      shop: updatedShop,
      message: `Role updated from ${oldRole} to ${role}`,
    });
  } catch (error) {
    logger.error('Error updating role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * GET /api/admin/stats
 * Get overall platform statistics
 */
router.get('/stats', async (_req, res) => {
  try {
    const [
      totalShops,
      totalSuppliers,
      totalRetailers,
      totalConnections,
      totalProducts,
      totalOrders,
      shopsByPlan,
    ] = await Promise.all([
      prisma.shop.count(),
      prisma.shop.count({ where: { role: { in: ['SUPPLIER', 'BOTH'] } } }),
      prisma.shop.count({ where: { role: { in: ['RETAILER', 'BOTH'] } } }),
      prisma.connection.count({ where: { status: 'ACTIVE' } }),
      prisma.supplierProduct.count({ where: { isWholesaleEligible: true } }),
      prisma.purchaseOrder.count(),
      prisma.shop.groupBy({
        by: ['plan'],
        _count: true,
      }),
    ]);

    res.json({
      totalShops,
      totalSuppliers,
      totalRetailers,
      totalConnections,
      totalProducts,
      totalOrders,
      shopsByPlan: Object.fromEntries(shopsByPlan.map((group) => [group.plan, group._count])),
      version: deployInfo.version || null,
      commitHash: deployInfo.commitHash || null,
      buildDate: deployInfo.buildDate || null,
    });
  } catch (error) {
    logger.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/admin/connections
 * List all connections
 */
router.get('/connections', async (req, res) => {
  try {
    const { status, supplier, retailer, limit = '100' } = req.query;

    const where: any = {};

    // Filter by status
    if (status && typeof status === 'string') {
      where.status = status;
    }

    // Filter by supplier domain
    if (supplier && typeof supplier === 'string') {
      where.supplierShop = {
        myshopifyDomain: { contains: supplier, mode: 'insensitive' },
      };
    }

    // Filter by retailer domain
    if (retailer && typeof retailer === 'string') {
      where.retailerShop = {
        myshopifyDomain: { contains: retailer, mode: 'insensitive' },
      };
    }

    const connections = await prisma.connection.findMany({
      where,
      select: {
        id: true,
        status: true,
        paymentTermsType: true,
        tier: true,
        createdAt: true,
        supplierShop: {
          select: {
            id: true,
            myshopifyDomain: true,
            companyName: true,
          },
        },
        retailerShop: {
          select: {
            id: true,
            myshopifyDomain: true,
            companyName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
    });

    res.json({ connections });
  } catch (error) {
    logger.error('Error listing connections:', error);
    res.status(500).json({ error: 'Failed to list connections' });
  }
});

/**
 * DELETE /api/admin/connections/:connectionId
 * Delete a connection (for UAT/testing)
 */
router.delete('/connections/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Delete connection (will cascade delete product mappings)
    await prisma.connection.delete({
      where: { id: connectionId },
    });

    // Log audit events for both shops
    await Promise.all([
      prisma.auditLog.create({
        data: {
          shopId: connection.supplierShopId,
          action: 'CONNECTION_TERMINATED',
          resourceType: 'Connection',
          resourceId: connectionId,
          metadata: {
            retailer: connection.retailerShop.myshopifyDomain,
            source: 'CS_ADMIN',
            reason: 'Deleted via CS Admin Tool',
          },
        },
      }),
      prisma.auditLog.create({
        data: {
          shopId: connection.retailerShopId,
          action: 'CONNECTION_TERMINATED',
          resourceType: 'Connection',
          resourceId: connectionId,
          metadata: {
            supplier: connection.supplierShop.myshopifyDomain,
            source: 'CS_ADMIN',
            reason: 'Deleted via CS Admin Tool',
          },
        },
      }),
    ]);

    logger.info(
      `[CS ADMIN] Connection deleted: ${connection.supplierShop.myshopifyDomain} -> ${connection.retailerShop.myshopifyDomain}`
    );

    res.json({
      success: true,
      message: 'Connection deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting connection:', error);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

/**
 * GET /api/admin/products
 * List supplier products
 */
router.get('/products', async (req, res) => {
  try {
    const { supplier, wholesale, limit = '100' } = req.query;

    const where: any = {};

    // Filter by supplier domain
    if (supplier && typeof supplier === 'string') {
      where.supplierShop = {
        myshopifyDomain: { contains: supplier, mode: 'insensitive' },
      };
    }

    // Filter by wholesale eligible
    if (wholesale && typeof wholesale === 'string') {
      where.isWholesaleEligible = wholesale === 'true';
    }

    const products = await prisma.supplierProduct.findMany({
      where,
      select: {
        id: true,
        title: true,
        sku: true,
        wholesalePrice: true,
        inventoryQuantity: true,
        isWholesaleEligible: true,
        createdAt: true,
        supplierShop: {
          select: {
            myshopifyDomain: true,
            companyName: true,
          },
        },
        _count: {
          select: {
            productMappings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
    });

    const enrichedProducts = products.map((product) => ({
      ...product,
      mappingCount: product._count.productMappings,
    }));

    res.json({ products: enrichedProducts });
  } catch (error) {
    logger.error('Error listing products:', error);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

/**
 * GET /api/admin/health
 * Get system health metrics, queue stats, and active incidents
 */
router.get('/health', async (_req, res) => {
  try {
    // Get queue stats
    let queueStats = null;
    try {
      let webhookQueue;
      let importQueue;
      try {
        webhookQueue = getWebhookQueue();
        importQueue = getImportQueue();
      } catch {
        ({ webhookQueue, importQueue } = initializeQueues());
      }

      const [
        webhookWaiting,
        webhookActive,
        webhookFailed,
        webhookCompleted,
        importWaiting,
        importActive,
        importFailed,
        importCompleted,
      ] = await Promise.all([
        webhookQueue.getWaitingCount(),
        webhookQueue.getActiveCount(),
        webhookQueue.getFailedCount(),
        webhookQueue.getCompletedCount(),
        importQueue.getWaitingCount(),
        importQueue.getActiveCount(),
        importQueue.getFailedCount(),
        importQueue.getCompletedCount(),
      ]);

      queueStats = {
        webhook: {
          waiting: webhookWaiting,
          active: webhookActive,
          failed: webhookFailed,
          completed: webhookCompleted,
          total: webhookWaiting + webhookActive,
        },
        import: {
          waiting: importWaiting,
          active: importActive,
          failed: importFailed,
          completed: importCompleted,
          total: importWaiting + importActive,
        },
      };
    } catch (error) {
      logger.warn('Could not get queue stats:', error);
    }

    // Get latest system health metrics (last 24 hours) - if table exists
    let healthMetrics: any[] = [];
    const latestByComponent: Record<string, any> = {};
    try {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      healthMetrics = await prisma.systemHealth.findMany({
        where: { createdAt: { gte: oneDayAgo } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      for (const metric of healthMetrics) {
        if (!latestByComponent[metric.component]) {
          latestByComponent[metric.component] = metric;
        }
      }
    } catch {
      // SystemHealth table may not exist yet
    }

    // Get active incidents - if table exists
    let activeIncidents: any[] = [];
    let recentIncidents: any[] = [];
    try {
      activeIncidents = await prisma.incident.findMany({
        where: { status: { not: 'RESOLVED' } },
        include: {
          updates: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
        orderBy: { createdAt: 'desc' },
      });

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      recentIncidents = await prisma.incident.findMany({
        where: { status: 'RESOLVED', resolvedAt: { gte: sevenDaysAgo } },
        orderBy: { resolvedAt: 'desc' },
        take: 10,
      });
    } catch {
      // Incident table may not exist yet
    }

    // Determine overall health
    const hasActiveIncident = activeIncidents.length > 0;
    const hasCritical = activeIncidents.some((i: any) => i.impact === 'CRITICAL');
    const hasMajor = activeIncidents.some((i: any) => i.impact === 'MAJOR');

    let overallStatus = 'healthy';
    if (hasCritical) overallStatus = 'critical';
    else if (hasMajor) overallStatus = 'degraded';
    else if (hasActiveIncident) overallStatus = 'warning';

    // Calculate queue health
    const queueHealthy = queueStats
      ? queueStats.webhook.total < 500 && queueStats.webhook.failed < 50
      : true;

    res.json({
      status: overallStatus,
      queueHealthy,
      queues: queueStats,
      components: Object.values(latestByComponent).map((h: any) => ({
        component: h.component,
        healthy: h.healthy,
        webhookQueueSize: h.webhookQueueSize,
        webhookErrorRate: h.webhookErrorRate,
        apiResponseTime: h.apiResponseTime,
        databaseResponseTime: h.databaseResponseTime,
        checkedAt: h.createdAt,
      })),
      activeIncidents: activeIncidents.map((i: any) => ({
        id: i.id,
        title: i.title,
        component: i.component,
        impact: i.impact,
        status: i.status,
        createdAt: i.createdAt,
        latestUpdate: i.updates?.[0]?.message || null,
      })),
      recentIncidents: recentIncidents.map((i: any) => ({
        id: i.id,
        title: i.title,
        component: i.component,
        impact: i.impact,
        resolvedAt: i.resolvedAt,
      })),
    });
  } catch (error) {
    logger.error('Error getting health:', error);
    res.status(500).json({ error: 'Failed to get health data' });
  }
});

/**
 * GET /api/admin/audit-logs
 * Get recent audit logs across all shops
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const { action, shopId, limit = '50' } = req.query;

    const where: any = {};

    if (action && typeof action === 'string') {
      where.action = action;
    }

    if (shopId && typeof shopId === 'string') {
      where.shopId = shopId;
    }

    const auditLogs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
    });

    // Enrich with shop info
    const shopIds = [...new Set(auditLogs.map((log) => log.shopId))];
    const shops = await prisma.shop.findMany({
      where: { id: { in: shopIds } },
      select: { id: true, myshopifyDomain: true, companyName: true },
    });
    const shopMap = new Map(shops.map((s) => [s.id, s]));

    const enrichedLogs = auditLogs.map((log) => ({
      ...log,
      shop: shopMap.get(log.shopId) || null,
    }));

    res.json({ auditLogs: enrichedLogs });
  } catch (error) {
    logger.error('Error listing audit logs:', error);
    res.status(500).json({ error: 'Failed to list audit logs' });
  }
});

/**
 * GET /api/admin/failed-jobs
 * Get failed webhook jobs from the queue
 */
router.get('/failed-jobs', async (req, res) => {
  try {
    const { limit = '20' } = req.query;

    let webhookQueue;
    try {
      webhookQueue = getWebhookQueue();
    } catch {
      ({ webhookQueue } = initializeQueues());
    }

    const failedJobs = await webhookQueue.getFailed(0, parseInt(limit as string, 10));

    const jobs = failedJobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: {
        topic: job.data?.topic,
        shopDomain: job.data?.shopDomain,
      },
      failedReason: job.failedReason,
      stacktrace: job.stacktrace?.[0]?.substring(0, 500), // Truncate stacktrace
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    }));

    res.json({ failedJobs: jobs });
  } catch (error) {
    logger.error('Error getting failed jobs:', error);
    res.status(500).json({ error: 'Failed to get failed jobs' });
  }
});

/**
 * GET /api/admin/connections/:id/health
 * Get health status for a specific connection
 */
router.get('/connections/:id/health', async (req, res) => {
  try {
    const { id } = req.params;

    const connection = await prisma.connection.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    const health = await ConnectionHealthService.getHealth(id);
    res.json({ health });
  } catch (error) {
    logger.error('Error getting connection health:', error);
    res.status(500).json({ error: 'Failed to get connection health' });
  }
});

/**
 * GET /api/admin/connections/:id/activity
 * Get activity log for a specific connection
 */
router.get('/connections/:id/activity', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = '50' } = req.query;

    const connection = await prisma.connection.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    const activity = await ConnectionHealthService.getActivity(id, parseInt(limit as string, 10));
    res.json({ activity });
  } catch (error) {
    logger.error('Error getting connection activity:', error);
    res.status(500).json({ error: 'Failed to get connection activity' });
  }
});

/**
 * GET /api/admin/connections-with-errors
 * Get all connections with health issues
 */
router.get('/connections-with-errors', async (_req, res) => {
  try {
    const connectionsWithErrors = await ConnectionHealthService.getConnectionsWithErrors();

    // Enrich with connection details
    const connectionIds = connectionsWithErrors.map((c) => c.connectionId);
    const connections = await prisma.connection.findMany({
      where: { id: { in: connectionIds } },
      include: {
        supplierShop: { select: { myshopifyDomain: true, companyName: true } },
        retailerShop: { select: { myshopifyDomain: true, companyName: true } },
      },
    });

    const connectionMap = new Map(connections.map((c) => [c.id, c]));

    const enrichedErrors = connectionsWithErrors.map((health) => ({
      ...health,
      connection: connectionMap.get(health.connectionId) || null,
    }));

    res.json({ connections: enrichedErrors });
  } catch (error) {
    logger.error('Error getting connections with errors:', error);
    res.status(500).json({ error: 'Failed to get connections with errors' });
  }
});

/**
 * GET /api/admin/features
 * Get feature availability status (available now vs coming soon)
 */
router.get('/features', async (_req, res) => {
  try {
    const features = {
      available: [
        {
          id: 'inventory_sync',
          name: 'Inventory Sync',
          description: 'Real-time inventory synchronization between suppliers and retailers',
          tier: 'FREE',
        },
        {
          id: 'catalog_sync',
          name: 'Catalog Sync',
          description: 'Product catalog mirroring with field controls',
          tier: 'FREE',
        },
        {
          id: 'order_forwarding_manual',
          name: 'Order Forwarding (Manual)',
          description: 'Manually push orders from retailers to suppliers',
          tier: 'FREE',
        },
        {
          id: 'order_forwarding_auto',
          name: 'Order Forwarding (Auto)',
          description: 'Automatic order forwarding on create/paid',
          tier: 'CORE',
        },
        {
          id: 'shadow_mode',
          name: 'Shadow Mode',
          description: 'Preview order forwarding without creating draft orders',
          tier: 'CORE',
        },
        {
          id: 'catalog_field_controls',
          name: 'Catalog Field Controls',
          description: 'Granular control over which fields sync (title, description, images, etc.)',
          tier: 'FREE',
        },
        {
          id: 'metafields_sync',
          name: 'Metafields Sync',
          description: 'Sync product metafields between stores (tier-based caps)',
          tier: 'FREE',
          caps: { FREE: 10, STARTER: 25, CORE: 50, PRO: 100, GROWTH: 250, SCALE: 'unlimited' },
        },
        {
          id: 'payouts',
          name: 'Payouts Tracking',
          description: 'Commission and fee tracking with payout lifecycle management',
          tier: 'CORE',
        },
        {
          id: 'multi_location',
          name: 'Multi-Location Inventory',
          description: 'Sync from specific locations or aggregate all locations',
          tier: 'PRO',
        },
        {
          id: 'rate_limit_observability',
          name: 'Rate Limit Observability',
          description: 'Per-connection API health monitoring and backpressure',
          tier: 'FREE',
        },
        {
          id: 'dual_role',
          name: 'Dual-Role Mode',
          description: 'Act as both supplier and retailer from the same store',
          tier: 'GROWTH',
        },
      ],
      comingSoon: [
        {
          id: 'collection_sync',
          name: 'Collection Sync',
          description: 'Sync custom collections between stores',
          plannedTier: 'CORE',
          roadmapStatus: 'Backend ready, UI in progress',
        },
        {
          id: 'price_rules',
          name: 'Price Rules',
          description: 'Per-connection markup/markdown pricing',
          plannedTier: 'CORE',
          roadmapStatus: 'Backend ready, UI in progress',
        },
        {
          id: 'extended_metafields',
          name: 'Extended Metafields',
          description: 'Collection metafields and reference type support',
          plannedTier: 'PRO',
          roadmapStatus: 'Planned',
        },
        {
          id: 'on_hold_auto_support',
          name: 'On-Hold Order Auto Support',
          description: 'Automatic forwarding for Shopify "On Hold" orders',
          plannedTier: 'PRO',
          roadmapStatus: 'Planned',
        },
        {
          id: 'per_connection_billing',
          name: 'Per-Connection Billing',
          description: 'Bill per active connection for marketplace operators',
          plannedTier: 'MARKETPLACE',
          roadmapStatus: 'Contact us',
        },
        {
          id: 'partner_network',
          name: 'Partner Network',
          description: 'Discover suppliers/retailers with consented re-share',
          plannedTier: 'GROWTH',
          roadmapStatus: 'Data models ready, UI planned',
        },
      ],
    };

    res.json({ features });
  } catch (error) {
    logger.error('Error getting features:', error);
    res.status(500).json({ error: 'Failed to get features' });
  }
});

// =============================================================================
// WEBHOOK MANAGEMENT
// =============================================================================

/**
 * GET /api/admin/shops/:id/webhooks
 * List webhook subscriptions and configuration for a shop
 */
router.get('/shops/:id/webhooks', async (req, res) => {
  try {
    const { id } = req.params;

    const shop = await prisma.shop.findUnique({
      where: { id },
      select: {
        id: true,
        myshopifyDomain: true,
        accessToken: true,
        webhookDeliveryMethod: true,
        eventBridgeArn: true,
        pubsubProject: true,
        pubsubTopic: true,
      },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Get current webhook subscriptions from Shopify
    const subscriptions = await WebhookSubscriptionService.listWebhooks(shop);

    res.json({
      config: {
        deliveryMethod: shop.webhookDeliveryMethod,
        eventBridgeArn: shop.eventBridgeArn,
        pubsubProject: shop.pubsubProject,
        pubsubTopic: shop.pubsubTopic,
      },
      subscriptions,
      availableTopics: WEBHOOK_TOPICS,
    });
  } catch (error) {
    logger.error('Error getting webhooks:', error);
    res.status(500).json({ error: 'Failed to get webhooks' });
  }
});

/**
 * POST /api/admin/shops/:id/webhooks/configure
 * Configure webhook delivery method for a shop
 */
router.post('/shops/:id/webhooks/configure', async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryMethod, eventBridgeArn, pubsubProject, pubsubTopic } = req.body;

    // Validate delivery method
    if (!['HTTP', 'EVENTBRIDGE', 'PUBSUB'].includes(deliveryMethod)) {
      res.status(400).json({ error: 'Invalid delivery method' });
      return;
    }

    // Validate required fields for non-HTTP methods
    if (deliveryMethod === 'EVENTBRIDGE' && !eventBridgeArn) {
      res.status(400).json({ error: 'EventBridge ARN required for EVENTBRIDGE delivery' });
      return;
    }

    if (deliveryMethod === 'PUBSUB' && (!pubsubProject || !pubsubTopic)) {
      res.status(400).json({ error: 'Pub/Sub project and topic required for PUBSUB delivery' });
      return;
    }

    const shop = await prisma.shop.update({
      where: { id },
      data: {
        webhookDeliveryMethod: deliveryMethod,
        eventBridgeArn: deliveryMethod === 'EVENTBRIDGE' ? eventBridgeArn : null,
        pubsubProject: deliveryMethod === 'PUBSUB' ? pubsubProject : null,
        pubsubTopic: deliveryMethod === 'PUBSUB' ? pubsubTopic : null,
      },
      select: {
        id: true,
        myshopifyDomain: true,
        webhookDeliveryMethod: true,
        eventBridgeArn: true,
        pubsubProject: true,
        pubsubTopic: true,
      },
    });

    logger.info(`Webhook delivery configured for ${shop.myshopifyDomain}: ${deliveryMethod}`);

    res.json({
      success: true,
      config: {
        deliveryMethod: shop.webhookDeliveryMethod,
        eventBridgeArn: shop.eventBridgeArn,
        pubsubProject: shop.pubsubProject,
        pubsubTopic: shop.pubsubTopic,
      },
    });
  } catch (error) {
    logger.error('Error configuring webhooks:', error);
    res.status(500).json({ error: 'Failed to configure webhooks' });
  }
});

/**
 * POST /api/admin/shops/:id/webhooks/register
 * Register webhooks for a shop using configured delivery method
 */
router.post('/shops/:id/webhooks/register', async (req, res) => {
  try {
    const { id } = req.params;

    const shop = await prisma.shop.findUnique({
      where: { id },
      select: {
        id: true,
        myshopifyDomain: true,
        accessToken: true,
        webhookDeliveryMethod: true,
        eventBridgeArn: true,
        pubsubProject: true,
        pubsubTopic: true,
      },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const result = await WebhookSubscriptionService.registerWebhooks(shop, {
      deliveryMethod: shop.webhookDeliveryMethod,
      eventBridgeArn: shop.eventBridgeArn || undefined,
      pubsubProject: shop.pubsubProject || undefined,
      pubsubTopic: shop.pubsubTopic || undefined,
    });

    logger.info(
      `Webhooks registered for ${shop.myshopifyDomain}: ${result.registered} registered, ${result.errors.length} errors`
    );

    res.json({
      success: result.errors.length === 0,
      registered: result.registered,
      errors: result.errors,
    });
  } catch (error) {
    logger.error('Error registering webhooks:', error);
    res.status(500).json({ error: 'Failed to register webhooks' });
  }
});

/**
 * DELETE /api/admin/shops/:id/webhooks
 * Delete all webhooks for a shop (useful before switching delivery methods)
 */
router.delete('/shops/:id/webhooks', async (req, res) => {
  try {
    const { id } = req.params;

    const shop = await prisma.shop.findUnique({
      where: { id },
      select: {
        id: true,
        myshopifyDomain: true,
        accessToken: true,
      },
    });

    if (!shop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const deleted = await WebhookSubscriptionService.deleteAllWebhooks(shop);

    logger.info(`All webhooks deleted for ${shop.myshopifyDomain}: ${deleted} removed`);

    res.json({
      success: true,
      deleted,
    });
  } catch (error) {
    logger.error('Error deleting webhooks:', error);
    res.status(500).json({ error: 'Failed to delete webhooks' });
  }
});

export default router;
