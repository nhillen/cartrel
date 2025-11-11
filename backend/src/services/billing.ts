/**
 * Shopify Billing API integration for Cartrel subscriptions
 */

import { shopify } from './shopify';
import { logger } from '../utils/logger';
import { PLAN_LIMITS } from '../utils/planLimits';

interface BillingCharge {
  confirmationUrl: string;
  chargeId: string;
}

/**
 * Create a recurring app subscription for a plan
 */
export async function createSubscription(
  shop: string,
  accessToken: string,
  plan: keyof typeof PLAN_LIMITS
): Promise<BillingCharge> {
  const planDetails = PLAN_LIMITS[plan];

  if (!planDetails) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  if (plan === 'FREE') {
    throw new Error('Cannot create subscription for FREE plan');
  }

  try {
    const session = {
      shop,
      accessToken,
    };

    const billing = shopify.billing.request({
      session,
      plan: {
        name: planDetails.name,
        price: { amount: planDetails.price, currencyCode: 'USD' },
        interval: 'EVERY_30_DAYS',
      },
      isTest: process.env.NODE_ENV !== 'production', // Test charges in dev
      returnUrl: `${process.env.APP_URL}/billing/confirm`,
    });

    logger.info(`Created billing charge for ${shop} - Plan: ${plan}`);

    return {
      confirmationUrl: billing.confirmationUrl,
      chargeId: billing.id,
    };
  } catch (error) {
    logger.error(`Error creating subscription for ${shop}:`, error);
    throw new Error('Failed to create subscription');
  }
}

/**
 * Check if a shop has an active subscription
 */
export async function hasActiveSubscription(
  shop: string,
  accessToken: string
): Promise<boolean> {
  try {
    const session = {
      shop,
      accessToken,
    };

    const charges = await shopify.billing.check({
      session,
    });

    // Check if there's an active recurring charge
    return charges.hasActivePayment;
  } catch (error) {
    logger.error(`Error checking subscription for ${shop}:`, error);
    return false;
  }
}

/**
 * Cancel a shop's subscription (downgrade to FREE)
 */
export async function cancelSubscription(
  shop: string,
  accessToken: string
): Promise<void> {
  try {
    const session = {
      shop,
      accessToken,
    };

    await shopify.billing.cancel({
      session,
    });

    logger.info(`Cancelled subscription for ${shop}`);
  } catch (error) {
    logger.error(`Error cancelling subscription for ${shop}:`, error);
    throw new Error('Failed to cancel subscription');
  }
}
