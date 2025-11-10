import { Router } from 'express';
import { logger } from '../utils/logger';

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

export default router;
