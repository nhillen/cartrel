import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { getUsageSummary, shouldResetMonthlyUsage } from '../utils/planLimits';

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
        supplierConnections: { where: { status: 'ACTIVE' } },
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
          currentPeriodStart: new Date(),
        },
      });
      shopRecord.purchaseOrdersThisMonth = 0;
    }

    const activeConnections = shopRecord.supplierConnections.length;
    const usage = getUsageSummary(
      shopRecord.plan,
      activeConnections,
      shopRecord.purchaseOrdersThisMonth
    );

    res.json(usage);
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

    // Get current shop to check for downgrades
    const existingShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    // Prevent downgrades (BOTH -> SUPPLIER/RETAILER)
    if (existingShop && existingShop.role === 'BOTH' && role !== 'BOTH') {
      res.status(400).json({
        error: 'Cannot downgrade from BOTH role. Please contact support if you need to change your role.'
      });
      return;
    }

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

    logger.info(`Shop role ${previousRole ? 'changed' : 'set'}: ${shop} ${previousRole ? `${previousRole} ->` : '->'} ${role}`);

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
