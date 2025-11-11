import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { config } from '../config';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { encryptAccessToken, decryptAccessToken } from '../utils/crypto';

// Session storage interface for Shopify OAuth
interface ISessionStorage {
  storeSession(session: Session): Promise<boolean>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<Session[]>;
}

// Simple in-memory session storage for OAuth flow
class SimpleSessionStorage implements ISessionStorage {
  private sessions: Map<string, Session> = new Map();

  async storeSession(session: Session): Promise<boolean> {
    this.sessions.set(session.id, session);
    logger.debug(`Stored session: ${session.id} for shop: ${session.shop}`);
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    logger.debug(`Loaded session: ${id}, found: ${!!session}`);
    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = this.sessions.delete(id);
    logger.debug(`Deleted session: ${id}, success: ${deleted}`);
    return deleted;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    ids.forEach(id => this.sessions.delete(id));
    logger.debug(`Deleted ${ids.length} sessions`);
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = Array.from(this.sessions.values()).filter(s => s.shop === shop);
    logger.debug(`Found ${sessions.length} sessions for shop: ${shop}`);
    return sessions;
  }
}

// Initialize Shopify API
export const shopify = shopifyApi({
  apiKey: config.shopify.apiKey,
  apiSecretKey: config.shopify.apiSecret,
  scopes: config.shopify.scopes,
  hostName: config.shopify.hostName,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false, // OAuth cookie flow with SameSite=None fix
  sessionStorage: new SimpleSessionStorage(),
});

/**
 * Save shop to database after OAuth
 */
export async function saveShop(shop: string, accessToken: string, role: 'SUPPLIER' | 'RETAILER' | 'BOTH' = 'BOTH') {
  try {
    // Encrypt access token before storing
    const encryptedToken = encryptAccessToken(accessToken);

    const existingShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (existingShop) {
      // Update existing shop
      await prisma.shop.update({
        where: { myshopifyDomain: shop },
        data: {
          accessToken: encryptedToken,
          updatedAt: new Date(),
        },
      });
      logger.info(`Updated shop: ${shop}`);
    } else {
      // Create new shop
      await prisma.shop.create({
        data: {
          myshopifyDomain: shop,
          accessToken: encryptedToken,
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
 * Get decrypted access token for a shop
 * Use this instead of directly accessing shop.accessToken
 */
export function getDecryptedAccessToken(encryptedToken: string): string {
  return decryptAccessToken(encryptedToken);
}

/**
 * Create Shopify REST API client for a specific shop
 * Note: Pass the ENCRYPTED token from database - this function will decrypt it
 */
export function createShopifyClient(shop: string, encryptedAccessToken: string) {
  // Decrypt the access token before using it
  const accessToken = decryptAccessToken(encryptedAccessToken);

  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: '',
    isOnline: false,
    accessToken,
  });

  return new shopify.clients.Rest({ session });
}

/**
 * Create Shopify GraphQL API client for a specific shop
 * Note: Pass the ENCRYPTED token from database - this function will decrypt it
 */
export function createShopifyGraphQLClient(shop: string, encryptedAccessToken: string) {
  // Decrypt the access token before using it
  const accessToken = decryptAccessToken(encryptedAccessToken);

  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: '',
    isOnline: false,
    accessToken,
  });

  return new shopify.clients.Graphql({ session });
}
