/**
 * Shopify Billing API integration for Cartrel subscriptions
 */

import { createShopifyGraphQLClient } from './shopify';
import { logger } from '../utils/logger';
import { PLAN_LIMITS } from '../utils/planLimits';
import { config } from '../config';

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
    const client = createShopifyGraphQLClient(shop, accessToken);

    const mutation = `
      mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
        appSubscriptionCreate(
          name: $name
          lineItems: $lineItems
          returnUrl: $returnUrl
          test: $test
        ) {
          appSubscription {
            id
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      name: planDetails.name,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: planDetails.price,
                currencyCode: 'USD',
              },
              interval: 'EVERY_30_DAYS',
            },
          },
        },
      ],
      returnUrl: `${config.appUrl}/billing/confirm?shop=${shop}`,
      test: config.nodeEnv !== 'production',
    };

    const response: any = await client.request(mutation, { variables });

    if (response.data.appSubscriptionCreate.userErrors.length > 0) {
      const errors = response.data.appSubscriptionCreate.userErrors;
      logger.error(`Billing errors for ${shop}:`, errors);
      throw new Error(`Billing error: ${errors[0].message}`);
    }

    const confirmationUrl = response.data.appSubscriptionCreate.confirmationUrl;
    const chargeId = response.data.appSubscriptionCreate.appSubscription.id;

    logger.info(`Created billing charge for ${shop} - Plan: ${plan}`);

    return {
      confirmationUrl,
      chargeId,
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
    const client = createShopifyGraphQLClient(shop, accessToken);

    const query = `
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            status
          }
        }
      }
    `;

    const response: any = await client.request(query);

    const subscriptions = response.data?.currentAppInstallation?.activeSubscriptions || [];

    // Check if there's at least one active subscription
    return subscriptions.some((sub: any) => sub.status === 'ACTIVE');
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
    const client = createShopifyGraphQLClient(shop, accessToken);

    // First, get the active subscription ID
    const query = `
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            status
          }
        }
      }
    `;

    const queryResponse: any = await client.request(query);
    const subscriptions = queryResponse.data?.currentAppInstallation?.activeSubscriptions || [];

    if (subscriptions.length === 0) {
      logger.warn(`No active subscriptions found for ${shop}`);
      return;
    }

    // Cancel all active subscriptions
    for (const subscription of subscriptions) {
      const mutation = `
        mutation AppSubscriptionCancel($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: subscription.id,
      };

      const response: any = await client.request(mutation, { variables });

      if (response.data.appSubscriptionCancel.userErrors.length > 0) {
        const errors = response.data.appSubscriptionCancel.userErrors;
        logger.error(`Error cancelling subscription ${subscription.id} for ${shop}:`, errors);
        throw new Error(`Cancel error: ${errors[0].message}`);
      }
    }

    logger.info(`Cancelled subscription for ${shop}`);
  } catch (error) {
    logger.error(`Error cancelling subscription for ${shop}:`, error);
    throw new Error('Failed to cancel subscription');
  }
}
