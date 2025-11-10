import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';

const router = Router();

// Get current shop info
router.get('/me', async (_req, res, next) => {
  try {
    // TODO: Get shop from session/auth middleware
    logger.info('Get shop info - TO BE IMPLEMENTED');

    res.json({ message: 'TO BE IMPLEMENTED' });
  } catch (error) {
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

// Set shop role (onboarding)
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

    // Update shop role
    const updatedShop = await prisma.shop.update({
      where: { myshopifyDomain: shop },
      data: { role },
    });

    logger.info(`Shop role updated: ${shop} -> ${role}`);

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: updatedShop.id,
        action: 'ROLE_UPDATED',
        resourceType: 'Shop',
        resourceId: updatedShop.id,
        metadata: { role },
      },
    });

    res.json({ success: true, role: updatedShop.role });
  } catch (error) {
    logger.error('Error updating shop role:', error);
    next(error);
  }
});

export default router;
