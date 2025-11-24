/**
 * Admin routes for CS tools
 * Protected by HTTP Basic Auth
 */

import { Router } from 'express';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { requireAdminAuth } from '../middleware/adminAuth';
import { PLAN_LIMITS } from '../utils/planLimits';

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
            supplierConnections: true,
            retailerConnections: true,
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
      shopsByPlan: Object.fromEntries(
        shopsByPlan.map((group) => [group.plan, group._count])
      ),
    });
  } catch (error) {
    logger.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
