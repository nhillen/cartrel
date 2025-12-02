import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { getUsageSummary, shouldResetMonthlyUsage, getPlanLimits } from '../utils/planLimits';

const router = Router();

// Get current shop info
router.get('/me', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
      select: {
        id: true,
        myshopifyDomain: true,
        role: true,
        plan: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    logger.info(`Retrieved shop info for: ${shop}`);

    res.json(shopRecord);
  } catch (error) {
    logger.error('Error getting shop info:', error);
    next(error);
  }
});

// Get usage statistics and plan limits
router.get('/usage', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
      include: {
        supplierConnections: {
          where: {
            status: {
              in: ['ACTIVE', 'PENDING_INVITE'], // Only count active and pending connections
            },
          },
        },
      },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Reset monthly usage if needed
    if (shouldResetMonthlyUsage(shopRecord.currentPeriodStart)) {
      await prisma.shop.update({
        where: { id: shopRecord.id },
        data: {
          purchaseOrdersThisMonth: 0,
          productSKUsThisMonth: 0, // NEW - reset product count too
          currentPeriodStart: new Date(),
        },
      });
      shopRecord.purchaseOrdersThisMonth = 0;
      shopRecord.productSKUsThisMonth = 0;
    }

    // Count wholesale-eligible products
    const productCount = await prisma.supplierProduct.count({
      where: {
        supplierShopId: shopRecord.id,
        isWholesaleEligible: true,
      },
    });

    const activeConnections = shopRecord.supplierConnections.length;
    const usage = getUsageSummary(
      shopRecord.plan,
      activeConnections,
      shopRecord.purchaseOrdersThisMonth
    );

    // NEW - Add product count and add-on info to usage response
    const limits = getPlanLimits(shopRecord.plan);
    const effectiveConnectionLimit =
      limits.maxConnections + (shopRecord.addOnConnections || 0) * 10;
    const effectiveOrderLimit =
      limits.maxPurchaseOrdersPerMonth + (shopRecord.addOnOrders || 0) * 1000;

    res.json({
      ...usage,
      products: {
        current: productCount,
        max: limits.maxProducts,
        percentage: Math.min(Math.round((productCount / limits.maxProducts) * 100), 100),
      },
      connections: {
        ...usage.connections,
        baseLimit: limits.maxConnections,
        effectiveLimit: effectiveConnectionLimit,
        addOnQty: shopRecord.addOnConnections || 0,
      },
      purchaseOrders: {
        ...usage.purchaseOrders,
        baseLimit: limits.maxPurchaseOrdersPerMonth,
        effectiveLimit: effectiveOrderLimit,
        addOnQty: shopRecord.addOnOrders || 0,
      },
      planVersion: shopRecord.planVersion, // Show grandfathered status
      upgradeRecommended:
        productCount > limits.maxProducts * 0.8 ||
        activeConnections > effectiveConnectionLimit * 0.8 ||
        usage.shouldUpgrade,
    });
  } catch (error) {
    logger.error('Error getting usage stats:', error);
    next(error);
  }
});

// Update shop settings
router.patch('/settings', async (_req, res, next) => {
  try {
    // TODO: Update shop settings
    logger.info('Update shop settings - TO BE IMPLEMENTED');

    res.json({ message: 'TO BE IMPLEMENTED' });
  } catch (error) {
    next(error);
  }
});

// Set shop role (onboarding or upgrade)
router.post('/role', async (req, res, next) => {
  try {
    const { shop, role } = req.body;

    if (!shop || !role) {
      res.status(400).json({ error: 'Missing shop or role' });
      return;
    }

    // Validate role
    const validRoles = ['SUPPLIER', 'RETAILER', 'BOTH'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role. Must be SUPPLIER, RETAILER, or BOTH' });
      return;
    }

    // Get current shop to track previous role
    const existingShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    const previousRole = existingShop?.role;

    // Upsert shop (create if doesn't exist, update if it does)
    const updatedShop = await prisma.shop.upsert({
      where: { myshopifyDomain: shop },
      update: { role },
      create: {
        myshopifyDomain: shop,
        accessToken: '', // Will be set during OAuth
        role,
      },
    });

    logger.info(
      `Shop role ${previousRole ? 'changed' : 'set'}: ${shop} ${previousRole ? `${previousRole} ->` : '->'} ${role}`
    );

    // Log role change in audit log if this was an upgrade
    if (existingShop && previousRole !== role) {
      await prisma.auditLog.create({
        data: {
          shopId: updatedShop.id,
          action: 'ROLE_CHANGED',
          resourceType: 'Shop',
          resourceId: updatedShop.id,
          metadata: {
            previousRole,
            newRole: role,
          },
        },
      });

      logger.info(`Role change audited: ${shop} from ${previousRole} to ${role}`);
    }

    res.json({ success: true, role: updatedShop.role });
  } catch (error) {
    logger.error('Error setting shop role:', error);
    next(error);
  }
});

export default router;
