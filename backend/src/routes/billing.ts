/**
 * Billing routes for Shopify subscription management
 */

import express from 'express';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import {
  createSubscription,
  hasActiveSubscription,
  cancelSubscription,
} from '../services/billing';
import { PLAN_LIMITS } from '../utils/planLimits';

const router = express.Router();

/**
 * POST /api/billing/upgrade
 * Initiate a subscription upgrade
 */
router.post('/upgrade', async (req, res) => {
  try {
    const { shop, plan } = req.body;

    if (!shop || !plan) {
      return res.status(400).json({ error: 'Missing shop or plan' });
    }

    // Validate plan
    if (!['STARTER', 'GROWTH', 'SCALE'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Choose STARTER, GROWTH, or SCALE' });
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Can't upgrade if you're a retailer
    if (shopRecord.isRetailer && !shopRecord.isSupplier) {
      return res.status(403).json({ error: 'Retailers do not need a paid plan' });
    }

    // Check if already on this plan
    if (shopRecord.plan === plan) {
      return res.status(400).json({ error: 'Already on this plan' });
    }

    // Create subscription charge
    const charge = await createSubscription(
      shopRecord.myshopifyDomain,
      shopRecord.accessToken,
      plan as keyof typeof PLAN_LIMITS
    );

    // Store pending charge in database
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        pendingPlan: plan,
        pendingChargeId: charge.chargeId,
      },
    });

    logger.info(`Billing upgrade initiated for ${shop} to ${plan}`);

    // Return confirmation URL for redirect
    res.json({
      confirmationUrl: charge.confirmationUrl,
    });
  } catch (error) {
    logger.error('Error initiating billing upgrade:', error);
    res.status(500).json({ error: 'Failed to initiate upgrade' });
  }
});

/**
 * GET /billing/confirm
 * Handle Shopify billing confirmation callback
 */
router.get('/confirm', async (req, res) => {
  try {
    const { shop, charge_id } = req.query;

    if (!shop || !charge_id) {
      return res.status(400).send('Missing shop or charge_id');
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop as string },
    });

    if (!shopRecord) {
      return res.status(404).send('Shop not found');
    }

    // Verify charge ID matches
    if (shopRecord.pendingChargeId !== charge_id) {
      logger.error(`Charge ID mismatch for ${shop}: expected ${shopRecord.pendingChargeId}, got ${charge_id}`);
      return res.status(400).send('Invalid charge ID');
    }

    // Check if subscription is actually active
    const isActive = await hasActiveSubscription(
      shopRecord.myshopifyDomain,
      shopRecord.accessToken
    );

    if (!isActive) {
      logger.error(`Subscription not active after confirmation for ${shop}`);
      return res.status(400).send('Subscription not confirmed');
    }

    // Update shop with new plan
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        plan: shopRecord.pendingPlan || 'FREE',
        pendingPlan: null,
        pendingChargeId: null,
      },
    });

    logger.info(`Billing confirmed for ${shop} - Plan: ${shopRecord.pendingPlan}`);

    // Redirect back to app with success message
    res.redirect(`/supplier?shop=${shop}&billing=success`);
  } catch (error) {
    logger.error('Error confirming billing:', error);
    res.status(500).send('Failed to confirm subscription');
  }
});

/**
 * POST /api/billing/cancel
 * Cancel subscription and downgrade to FREE
 */
router.post('/cancel', async (req, res) => {
  try {
    const { shop } = req.body;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop' });
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Can't cancel if already on FREE
    if (shopRecord.plan === 'FREE') {
      return res.status(400).json({ error: 'Already on FREE plan' });
    }

    // Cancel subscription in Shopify
    await cancelSubscription(
      shopRecord.myshopifyDomain,
      shopRecord.accessToken
    );

    // Update shop to FREE plan
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: {
        plan: 'FREE',
        pendingPlan: null,
        pendingChargeId: null,
      },
    });

    logger.info(`Billing cancelled for ${shop} - Downgraded to FREE`);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error cancelling billing:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * GET /api/billing/status
 * Get current subscription status
 */
router.get('/status', async (req, res) => {
  try {
    const { shop } = req.query;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop' });
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop as string },
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const currentPlan = shopRecord.plan || 'FREE';
    const planDetails = PLAN_LIMITS[currentPlan];

    res.json({
      currentPlan,
      planDetails,
      isSupplier: shopRecord.isSupplier,
      isRetailer: shopRecord.isRetailer,
    });
  } catch (error) {
    logger.error('Error getting billing status:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

export default router;
