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

export default router;
