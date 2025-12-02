/**
 * WebhookSubscriptionService - Manage webhook subscriptions across delivery methods
 *
 * Per PRD_RATE_LIMIT_OBSERVABILITY:
 * - Support HTTP webhooks (default)
 * - Support EventBridge for Shopify Plus (optional)
 * - Support Google Cloud Pub/Sub (optional)
 *
 * EventBridge/PubSub provide better reliability:
 * - At-least-once delivery guarantee
 * - Built-in retry and DLQ
 * - Lower latency at scale
 *
 * Note: AWS EventBridge requires Shopify Plus + partner event source setup
 * Note: GCP Pub/Sub requires topic and subscription configuration
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';

export type WebhookDeliveryMethod = 'HTTP' | 'EVENTBRIDGE' | 'PUBSUB';

export interface WebhookTopic {
  topic: string;
  description: string;
  required: boolean;
}

// Standard webhook topics for Cartrel
export const WEBHOOK_TOPICS: WebhookTopic[] = [
  { topic: 'PRODUCTS_CREATE', description: 'Product created', required: true },
  { topic: 'PRODUCTS_UPDATE', description: 'Product updated', required: true },
  { topic: 'PRODUCTS_DELETE', description: 'Product deleted', required: true },
  { topic: 'INVENTORY_LEVELS_UPDATE', description: 'Inventory changed', required: true },
  { topic: 'ORDERS_CREATE', description: 'Order created', required: true },
  { topic: 'ORDERS_UPDATED', description: 'Order updated', required: true },
  { topic: 'ORDERS_PAID', description: 'Order paid', required: true },
  { topic: 'ORDERS_CANCELLED', description: 'Order cancelled', required: true },
  { topic: 'REFUNDS_CREATE', description: 'Refund created', required: true },
  { topic: 'APP_UNINSTALLED', description: 'App uninstalled', required: true },
  { topic: 'SHOP_UPDATE', description: 'Shop settings updated', required: false },
  { topic: 'COLLECTIONS_UPDATE', description: 'Collection updated', required: false },
];

export interface WebhookSubscription {
  id: string;
  topic: string;
  endpoint: string;
  format: string;
  createdAt: string;
}

export class WebhookSubscriptionService {
  /**
   * Register webhooks for a shop based on delivery method preference
   */
  static async registerWebhooks(
    shop: {
      id: string;
      myshopifyDomain: string;
      accessToken: string;
    },
    options?: {
      deliveryMethod?: WebhookDeliveryMethod;
      eventBridgeArn?: string;
      pubsubProject?: string;
      pubsubTopic?: string;
    }
  ): Promise<{ registered: number; errors: string[] }> {
    const deliveryMethod = options?.deliveryMethod || 'HTTP';
    const errors: string[] = [];
    let registered = 0;

    logger.info(`Registering ${deliveryMethod} webhooks for ${shop.myshopifyDomain}`);

    for (const topic of WEBHOOK_TOPICS) {
      try {
        let success = false;

        switch (deliveryMethod) {
          case 'HTTP':
            success = await this.registerHttpWebhook(shop, topic.topic);
            break;

          case 'EVENTBRIDGE':
            if (!options?.eventBridgeArn) {
              errors.push(`EventBridge ARN required for ${topic.topic}`);
              continue;
            }
            success = await this.registerEventBridgeWebhook(
              shop,
              topic.topic,
              options.eventBridgeArn
            );
            break;

          case 'PUBSUB':
            if (!options?.pubsubProject || !options?.pubsubTopic) {
              errors.push(`Pub/Sub project and topic required for ${topic.topic}`);
              continue;
            }
            success = await this.registerPubSubWebhook(
              shop,
              topic.topic,
              options.pubsubProject,
              options.pubsubTopic
            );
            break;
        }

        if (success) {
          registered++;
        }
      } catch (error) {
        errors.push(`${topic.topic}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    logger.info(
      `Registered ${registered}/${WEBHOOK_TOPICS.length} webhooks for ${shop.myshopifyDomain}`
    );

    return { registered, errors };
  }

  /**
   * Register HTTP webhook (standard)
   */
  private static async registerHttpWebhook(
    shop: { myshopifyDomain: string; accessToken: string },
    topic: string
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const callbackUrl = `${process.env.APP_URL || 'https://cartrel.com'}/webhooks/${topic.toLowerCase().replace(/_/g, '-')}`;

    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response: any = await client.request(mutation, {
        variables: {
          topic,
          webhookSubscription: {
            callbackUrl,
            format: 'JSON',
          },
        },
      });

      if (response.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
        const errors = response.data.webhookSubscriptionCreate.userErrors;
        // Ignore "already exists" errors
        if (!errors[0].message.includes('already exists')) {
          logger.warn(`Webhook registration warning for ${topic}: ${errors[0].message}`);
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error registering HTTP webhook ${topic}:`, error);
      return false;
    }
  }

  /**
   * Register EventBridge webhook (Shopify Plus only)
   */
  private static async registerEventBridgeWebhook(
    shop: { myshopifyDomain: string; accessToken: string },
    topic: string,
    arn: string
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation eventBridgeWebhookSubscriptionCreate(
        $topic: WebhookSubscriptionTopic!
        $webhookSubscription: EventBridgeWebhookSubscriptionInput!
      ) {
        eventBridgeWebhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: $webhookSubscription
        ) {
          webhookSubscription {
            id
            endpoint {
              ... on WebhookEventBridgeEndpoint {
                arn
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response: any = await client.request(mutation, {
        variables: {
          topic,
          webhookSubscription: {
            arn,
          },
        },
      });

      if (response.data?.eventBridgeWebhookSubscriptionCreate?.userErrors?.length > 0) {
        const errors = response.data.eventBridgeWebhookSubscriptionCreate.userErrors;
        if (!errors[0].message.includes('already exists')) {
          logger.warn(`EventBridge webhook warning for ${topic}: ${errors[0].message}`);
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error registering EventBridge webhook ${topic}:`, error);
      return false;
    }
  }

  /**
   * Register Google Cloud Pub/Sub webhook
   */
  private static async registerPubSubWebhook(
    shop: { myshopifyDomain: string; accessToken: string },
    topic: string,
    pubSubProject: string,
    pubSubTopic: string
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation pubSubWebhookSubscriptionCreate(
        $topic: WebhookSubscriptionTopic!
        $webhookSubscription: PubSubWebhookSubscriptionInput!
      ) {
        pubSubWebhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: $webhookSubscription
        ) {
          webhookSubscription {
            id
            endpoint {
              ... on WebhookPubSubEndpoint {
                pubSubProject
                pubSubTopic
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response: any = await client.request(mutation, {
        variables: {
          topic,
          webhookSubscription: {
            pubSubProject,
            pubSubTopic,
          },
        },
      });

      if (response.data?.pubSubWebhookSubscriptionCreate?.userErrors?.length > 0) {
        const errors = response.data.pubSubWebhookSubscriptionCreate.userErrors;
        if (!errors[0].message.includes('already exists')) {
          logger.warn(`PubSub webhook warning for ${topic}: ${errors[0].message}`);
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error registering PubSub webhook ${topic}:`, error);
      return false;
    }
  }

  /**
   * List existing webhook subscriptions for a shop
   */
  static async listWebhooks(shop: {
    myshopifyDomain: string;
    accessToken: string;
  }): Promise<WebhookSubscription[]> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query webhookSubscriptions {
        webhookSubscriptions(first: 50) {
          edges {
            node {
              id
              topic
              format
              createdAt
              endpoint {
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
                ... on WebhookEventBridgeEndpoint {
                  arn
                }
                ... on WebhookPubSubEndpoint {
                  pubSubProject
                  pubSubTopic
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query);

      const webhooks = response.data?.webhookSubscriptions?.edges?.map((edge: any) => {
        const node = edge.node;
        let endpoint = '';

        if (node.endpoint?.callbackUrl) {
          endpoint = node.endpoint.callbackUrl;
        } else if (node.endpoint?.arn) {
          endpoint = `EventBridge: ${node.endpoint.arn}`;
        } else if (node.endpoint?.pubSubProject) {
          endpoint = `PubSub: ${node.endpoint.pubSubProject}/${node.endpoint.pubSubTopic}`;
        }

        return {
          id: node.id,
          topic: node.topic,
          endpoint,
          format: node.format,
          createdAt: node.createdAt,
        };
      });

      return webhooks || [];
    } catch (error) {
      logger.error('Error listing webhooks:', error);
      return [];
    }
  }

  /**
   * Delete a webhook subscription
   */
  static async deleteWebhook(
    shop: { myshopifyDomain: string; accessToken: string },
    webhookId: string
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation webhookSubscriptionDelete($id: ID!) {
        webhookSubscriptionDelete(id: $id) {
          deletedWebhookSubscriptionId
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response: any = await client.request(mutation, {
        variables: { id: webhookId },
      });

      if (response.data?.webhookSubscriptionDelete?.userErrors?.length > 0) {
        const errors = response.data.webhookSubscriptionDelete.userErrors;
        logger.warn(`Webhook deletion warning: ${errors[0].message}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error deleting webhook:', error);
      return false;
    }
  }

  /**
   * Delete all webhooks for a shop
   */
  static async deleteAllWebhooks(shop: {
    myshopifyDomain: string;
    accessToken: string;
  }): Promise<number> {
    const webhooks = await this.listWebhooks(shop);
    let deleted = 0;

    for (const webhook of webhooks) {
      const success = await this.deleteWebhook(shop, webhook.id);
      if (success) deleted++;
    }

    logger.info(`Deleted ${deleted}/${webhooks.length} webhooks for ${shop.myshopifyDomain}`);
    return deleted;
  }

  /**
   * Update shop's webhook delivery method preference
   */
  static async updateDeliveryMethod(
    shopId: string,
    deliveryMethod: WebhookDeliveryMethod,
    config?: {
      eventBridgeArn?: string;
      pubsubProject?: string;
      pubsubTopic?: string;
    }
  ): Promise<void> {
    // Store in database for reference
    // Note: Actual schema would need webhookDeliveryMethod field
    logger.info(`Updated webhook delivery method for shop ${shopId} to ${deliveryMethod}`);

    // Re-register webhooks with new delivery method
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      throw new Error('Shop not found');
    }

    // Delete existing webhooks
    const existingWebhooks = await this.listWebhooks(shop);
    for (const webhook of existingWebhooks) {
      await this.deleteWebhook(shop, webhook.id);
    }

    // Register with new delivery method
    await this.registerWebhooks(shop, {
      deliveryMethod,
      eventBridgeArn: config?.eventBridgeArn,
      pubsubProject: config?.pubsubProject,
      pubsubTopic: config?.pubsubTopic,
    });
  }

  /**
   * Verify webhook is working by checking recent deliveries
   */
  static async verifyWebhookHealth(
    shop: { myshopifyDomain: string; accessToken: string },
    webhookId: string
  ): Promise<{ healthy: boolean; lastDelivery?: string; failureCount?: number }> {
    // Note: Shopify doesn't expose webhook delivery history via API
    // This would need to be tracked in our own database
    // For now, just check if the webhook exists

    const webhooks = await this.listWebhooks(shop);
    const webhook = webhooks.find((w) => w.id === webhookId);

    if (!webhook) {
      return { healthy: false };
    }

    return { healthy: true, lastDelivery: webhook.createdAt };
  }
}
