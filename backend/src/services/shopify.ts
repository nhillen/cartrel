import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { config } from '../config';
import { prisma } from '../index';
import { logger } from '../utils/logger';

// Initialize Shopify API
export const shopify = shopifyApi({
  apiKey: config.shopify.apiKey,
  apiSecretKey: config.shopify.apiSecret,
  scopes: config.shopify.scopes,
  hostName: config.shopify.hostName,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false, // Using cookie-based OAuth, not session tokens
  // Session storage (we'll use database)
  sessionStorage: {
    async storeSession(session: Session): Promise<boolean> {
      try {
        // Store session in database if needed
        logger.debug(`Storing session for shop: ${session.shop}`);
        return true;
      } catch (error) {
        logger.error('Error storing session:', error);
        return false;
      }
    },
    async loadSession(id: string): Promise<Session | undefined> {
      try {
        logger.debug(`Loading session: ${id}`);
        // Load session from database if needed
        return undefined;
      } catch (error) {
        logger.error('Error loading session:', error);
        return undefined;
      }
    },
    async deleteSession(id: string): Promise<boolean> {
      try {
        logger.debug(`Deleting session: ${id}`);
        return true;
      } catch (error) {
        logger.error('Error deleting session:', error);
        return false;
      }
    },
    async deleteSessions(ids: string[]): Promise<boolean> {
      try {
        logger.debug(`Deleting ${ids.length} sessions`);
        return true;
      } catch (error) {
        logger.error('Error deleting sessions:', error);
        return false;
      }
    },
    async findSessionsByShop(shop: string): Promise<Session[]> {
      try {
        logger.debug(`Finding sessions for shop: ${shop}`);
        return [];
      } catch (error) {
        logger.error('Error finding sessions:', error);
        return [];
      }
    },
  },
});

/**
 * Save shop to database after OAuth
 */
export async function saveShop(shop: string, accessToken: string, role: 'SUPPLIER' | 'RETAILER' | 'BOTH' = 'BOTH') {
  try {
    const existingShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (existingShop) {
      // Update existing shop
      await prisma.shop.update({
        where: { myshopifyDomain: shop },
        data: {
          accessToken,
          updatedAt: new Date(),
        },
      });
      logger.info(`Updated shop: ${shop}`);
    } else {
      // Create new shop
      await prisma.shop.create({
        data: {
          myshopifyDomain: shop,
          accessToken,
          role,
        },
      });
      logger.info(`Created new shop: ${shop}`);

      // Log audit event
      const createdShop = await prisma.shop.findUnique({
        where: { myshopifyDomain: shop },
      });

      if (createdShop) {
        await prisma.auditLog.create({
          data: {
            shopId: createdShop.id,
            action: 'SHOP_INSTALLED',
            resourceType: 'Shop',
            resourceId: createdShop.id,
          },
        });
      }
    }

    return true;
  } catch (error) {
    logger.error('Error saving shop:', error);
    throw error;
  }
}

/**
 * Get shop from database
 */
export async function getShop(shopDomain: string) {
  return await prisma.shop.findUnique({
    where: { myshopifyDomain: shopDomain },
  });
}

/**
 * Create Shopify API client for a specific shop
 */
export function createShopifyClient(shop: string, accessToken: string) {
  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: '',
    isOnline: false,
    accessToken,
  });

  return new shopify.clients.Rest({ session });
}
