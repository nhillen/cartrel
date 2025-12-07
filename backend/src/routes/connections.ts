/**
 * Connections Routes - Unified API for connection management
 *
 * These endpoints are called by the embedded React app using session tokens.
 * They work for both suppliers and retailers based on the authenticated shop's role.
 */
import { Router } from 'express';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { requireSessionToken, AuthenticatedRequest } from '../middleware/auth';
import { createShopifyGraphQLClient } from '../services/shopify';
import { decryptAccessToken } from '../utils/crypto';
import { nanoid } from 'nanoid';
import type { Connection, ConnectionInvite, Shop } from '@prisma/client';

// Type for connection with included shop relations
type ConnectionWithShops = Connection & {
  supplierShop: Pick<Shop, 'id' | 'myshopifyDomain' | 'companyName'>;
  retailerShop: Pick<Shop, 'id' | 'myshopifyDomain' | 'companyName'>;
};

const router = Router();

// Apply session token auth to all routes
router.use(requireSessionToken);

/**
 * GET /api/connections - List all connections for the authenticated shop
 */
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;

    // Get connections where this shop is either supplier or retailer
    const connections = await prisma.connection.findMany({
      where: {
        OR: [{ supplierShopId: shop.id }, { retailerShopId: shop.id }],
        status: { in: ['ACTIVE', 'PENDING_INVITE', 'PAUSED'] },
      },
      include: {
        supplierShop: {
          select: {
            id: true,
            myshopifyDomain: true,
            companyName: true,
          },
        },
        retailerShop: {
          select: {
            id: true,
            myshopifyDomain: true,
            companyName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = connections.map((c: ConnectionWithShops) => ({
      id: c.id,
      status: c.status,
      supplierShop: {
        id: c.supplierShop.id,
        myshopifyDomain: c.supplierShop.myshopifyDomain,
        name: c.supplierShop.companyName || c.supplierShop.myshopifyDomain,
      },
      retailerShop: {
        id: c.retailerShop.id,
        myshopifyDomain: c.retailerShop.myshopifyDomain,
        name: c.retailerShop.companyName || c.retailerShop.myshopifyDomain,
      },
      syncMode: c.syncMode,
      tier: c.tier,
      createdAt: c.createdAt.toISOString(),
    }));

    logger.info(`Loaded ${formatted.length} connections for shop: ${shop.myshopifyDomain}`);
    res.json(formatted);
  } catch (error) {
    logger.error('Error loading connections:', error);
    next(error);
  }
});

/**
 * GET /api/connections/invites - List invites for the authenticated shop
 */
router.get('/invites', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;

    // Get invites created by this shop (as supplier)
    const invites = await prisma.connectionInvite.findMany({
      where: {
        supplierShopId: shop.id,
        status: { in: ['ACTIVE', 'REDEEMED', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const formatted = invites.map((i: ConnectionInvite) => ({
      id: i.id,
      code: i.code,
      status: i.status === 'ACTIVE' ? 'PENDING' : i.status,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));

    res.json(formatted);
  } catch (error) {
    logger.error('Error loading invites:', error);
    next(error);
  }
});

/**
 * POST /api/connections/invites - Create a new invite (supplier only)
 */
router.post('/invites', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;

    // Verify shop is a supplier
    if (shop.role !== 'SUPPLIER' && shop.role !== 'BOTH') {
      res.status(403).json({ error: 'Only suppliers can create invites' });
      return;
    }

    // Generate invite code
    const code = nanoid(12).toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await prisma.connectionInvite.create({
      data: {
        supplierShopId: shop.id,
        code,
        nickname: `Invite ${code.slice(0, 4)}`,
        expiresAt,
      },
    });

    logger.info(`Created invite ${code} for supplier: ${shop.myshopifyDomain}`);

    res.json({
      id: invite.id,
      code: invite.code,
      status: 'PENDING',
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error creating invite:', error);
    next(error);
  }
});

/**
 * POST /api/connections/accept - Accept an invite code (retailer)
 */
router.post('/accept', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;
    const { code } = req.body;

    if (!code) {
      res.status(400).json({ error: 'Missing invite code' });
      return;
    }

    // Verify shop is a retailer
    if (shop.role !== 'RETAILER' && shop.role !== 'BOTH') {
      res.status(403).json({ error: 'Only retailers can accept invites' });
      return;
    }

    // Find the invite
    const invite = await prisma.connectionInvite.findUnique({
      where: { code: code.toUpperCase() },
      include: { supplierShop: true },
    });

    if (!invite) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    if (invite.status !== 'ACTIVE') {
      res.status(400).json({ error: 'This invite has already been used or expired' });
      return;
    }

    if (invite.expiresAt < new Date()) {
      await prisma.connectionInvite.update({
        where: { id: invite.id },
        data: { status: 'EXPIRED' },
      });
      res.status(400).json({ error: 'This invite has expired' });
      return;
    }

    // Check if connection already exists
    const existingConnection = await prisma.connection.findFirst({
      where: {
        supplierShopId: invite.supplierShopId,
        retailerShopId: shop.id,
        status: { in: ['ACTIVE', 'PENDING_INVITE'] },
      },
    });

    if (existingConnection) {
      res.status(400).json({ error: 'Connection already exists with this supplier' });
      return;
    }

    // Create connection and mark invite as redeemed
    const [connection] = await prisma.$transaction([
      prisma.connection.create({
        data: {
          supplierShopId: invite.supplierShopId,
          retailerShopId: shop.id,
          status: 'ACTIVE',
          tier: 'STANDARD',
        },
      }),
      prisma.connectionInvite.update({
        where: { id: invite.id },
        data: {
          status: 'REDEEMED',
          redeemedBy: shop.id,
          redeemedAt: new Date(),
        },
      }),
    ]);

    logger.info(
      `Connection created: ${invite.supplierShop.myshopifyDomain} -> ${shop.myshopifyDomain}`
    );

    res.json({
      success: true,
      connectionId: connection.id,
      supplier: invite.supplierShop.companyName || invite.supplierShop.myshopifyDomain,
    });
  } catch (error) {
    logger.error('Error accepting invite:', error);
    next(error);
  }
});

/**
 * GET /api/connections/:id - Get connection details
 */
router.get('/:connectionId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;
    const { connectionId } = req.params;

    const connection = await prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ supplierShopId: shop.id }, { retailerShopId: shop.id }],
      },
      include: {
        supplierShop: {
          select: {
            id: true,
            myshopifyDomain: true,
            companyName: true,
          },
        },
        retailerShop: {
          select: {
            id: true,
            myshopifyDomain: true,
            companyName: true,
          },
        },
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    res.json({
      id: connection.id,
      status: connection.status,
      supplierShop: {
        id: connection.supplierShop.id,
        myshopifyDomain: connection.supplierShop.myshopifyDomain,
        name: connection.supplierShop.companyName || connection.supplierShop.myshopifyDomain,
      },
      retailerShop: {
        id: connection.retailerShop.id,
        myshopifyDomain: connection.retailerShop.myshopifyDomain,
        name: connection.retailerShop.companyName || connection.retailerShop.myshopifyDomain,
      },
      syncMode: connection.syncMode,
      tier: connection.tier,
      stockBuffer: connection.stockBuffer,
      orderForwardingEnabled: connection.orderForwardingEnabled,
      orderForwardingMode: connection.orderForwardingMode,
      syncScope: connection.syncScope,
      createdAt: connection.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Error loading connection:', error);
    next(error);
  }
});

/**
 * GET /api/connections/:id/locations/source - Get supplier's inventory locations
 */
router.get('/:connectionId/locations/source', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;
    const { connectionId } = req.params;

    const connection = await prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ supplierShopId: shop.id }, { retailerShopId: shop.id }],
      },
      include: {
        supplierShop: true,
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Fetch locations from supplier's Shopify store
    const supplierShop = connection.supplierShop;
    const accessToken = decryptAccessToken(supplierShop.accessToken);
    const client = createShopifyGraphQLClient(supplierShop.myshopifyDomain, accessToken);

    const query = `
      query GetLocations {
        locations(first: 50) {
          nodes {
            id
            name
            address {
              formatted
            }
            isActive
            fulfillsOnlineOrders
          }
        }
      }
    `;

    const response = await client.request(query);
    const locations = (response as any).data?.locations?.nodes || [];

    const formatted = locations.map((loc: any, index: number) => ({
      id: loc.id.replace('gid://shopify/Location/', ''),
      name: loc.name,
      address: loc.address?.formatted?.join(', ') || null,
      isActive: loc.isActive,
      isDefault: index === 0,
    }));

    res.json({ locations: formatted });
  } catch (error) {
    logger.error('Error loading source locations:', error);
    next(error);
  }
});

/**
 * GET /api/connections/:id/locations/dest - Get retailer's inventory locations
 */
router.get('/:connectionId/locations/dest', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;
    const { connectionId } = req.params;

    const connection = await prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ supplierShopId: shop.id }, { retailerShopId: shop.id }],
      },
      include: {
        retailerShop: true,
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Fetch locations from retailer's Shopify store
    const retailerShop = connection.retailerShop;
    const accessToken = decryptAccessToken(retailerShop.accessToken);
    const client = createShopifyGraphQLClient(retailerShop.myshopifyDomain, accessToken);

    const query = `
      query GetLocations {
        locations(first: 50) {
          nodes {
            id
            name
            address {
              formatted
            }
            isActive
            fulfillsOnlineOrders
          }
        }
      }
    `;

    const response = await client.request(query);
    const locations = (response as any).data?.locations?.nodes || [];

    const formatted = locations.map((loc: any, index: number) => ({
      id: loc.id.replace('gid://shopify/Location/', ''),
      name: loc.name,
      address: loc.address?.formatted?.join(', ') || null,
      isActive: loc.isActive,
      isDefault: index === 0,
    }));

    res.json({ locations: formatted });
  } catch (error) {
    logger.error('Error loading dest locations:', error);
    next(error);
  }
});

/**
 * GET /api/connections/:id/location-settings - Get location sync settings
 */
router.get('/:connectionId/location-settings', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;
    const { connectionId } = req.params;

    const connection = await prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ supplierShopId: shop.id }, { retailerShopId: shop.id }],
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    res.json({
      sourceLocationId: connection.inventoryLocationId || null,
      destLocationId: connection.destLocationId || null,
      stockBuffer: connection.stockBuffer || 0,
      syncEnabled: connection.syncMode !== 'CATALOG_ONLY',
    });
  } catch (error) {
    logger.error('Error loading location settings:', error);
    next(error);
  }
});

/**
 * POST /api/connections/:id/location-settings - Update location sync settings
 */
router.post('/:connectionId/location-settings', async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = req.shop!;
    const { connectionId } = req.params;
    const { sourceLocationId, destLocationId, stockBuffer, syncEnabled } = req.body;

    const connection = await prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ supplierShopId: shop.id }, { retailerShopId: shop.id }],
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        inventoryLocationId: sourceLocationId || null,
        destLocationId: destLocationId || null,
        stockBuffer: typeof stockBuffer === 'number' ? stockBuffer : connection.stockBuffer,
        syncMode: syncEnabled === false ? 'CATALOG_ONLY' : 'INVENTORY_AND_CATALOG',
      },
    });

    logger.info(`Updated location settings for connection: ${connectionId}`);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating location settings:', error);
    next(error);
  }
});

export default router;
