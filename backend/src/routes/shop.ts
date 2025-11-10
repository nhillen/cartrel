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

    logger.info(`Shop role set: ${shop} -> ${role}`);

    res.json({ success: true, role: updatedShop.role });
  } catch (error) {
    logger.error('Error setting shop role:', error);
    next(error);
  }
});

export default router;
