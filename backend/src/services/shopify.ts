import { shopifyApi, LATEST_API_VERSION, Session, MemorySessionStorage } from '@shopify/shopify-api';
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
  // Session storage using in-memory store for OAuth cookies
  // This is required for the OAuth flow to work properly
  sessionStorage: new MemorySessionStorage(),
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
