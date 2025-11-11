import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { createShopifyClient } from '../services/shopify';

const router = Router();

/**
 * Get products from Shopify and mark which are wholesale
 */
router.get('/products', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Check if access token exists
    if (!shopRecord.accessToken || shopRecord.accessToken === '') {
      logger.warn(`Shop ${shop} has no access token, needs OAuth`);
      res.status(401).json({
        error: 'Invalid access token. Please reinstall the app.',
        requiresReauth: true
      });
      return;
    }

    // Create Shopify client
    const client = createShopifyClient(shop, shopRecord.accessToken);

    // Fetch products from Shopify
    let response;
    try {
      response = await client.get({
        path: 'products',
        query: { limit: '50' },
      });
    } catch (shopifyError: any) {
      // Handle invalid/expired token
      if (shopifyError?.response?.code === 401) {
        logger.error(`Invalid access token for shop ${shop}, clearing token`);
        // Clear the invalid token
        await prisma.shop.update({
          where: { id: shopRecord.id },
          data: { accessToken: '' },
        });
        res.status(401).json({
          error: 'Invalid access token. Please reload the page to re-authenticate.',
          requiresReauth: true
        });
        return;
      }
      throw shopifyError;
    }

    const shopifyProducts = (response.body as any).products || [];

    // Get wholesale products from database (only those marked as wholesale eligible)
    const wholesaleProducts = await prisma.supplierProduct.findMany({
      where: {
        supplierShopId: shopRecord.id,
        isWholesaleEligible: true,
      },
    });

    const wholesaleProductIds = new Set(
      wholesaleProducts.map((p) => p.shopifyProductId)
    );

    // Combine data
    const products = shopifyProducts.map((p: any) => ({
      id: p.id.toString(),
      title: p.title,
      price: p.variants[0]?.price || '0.00',
      image: p.images[0]?.src || null,
      isWholesale: wholesaleProductIds.has(p.id.toString()),
    }));

    logger.info(`Loaded ${products.length} products for shop: ${shop}`);

    res.json({ products });
  } catch (error) {
    logger.error('Error loading products:', error);
    next(error);
  }
});

/**
 * Toggle product as wholesale
 */
router.post('/products/wholesale', async (req, res, next) => {
  try {
    const { shop, productId, isWholesale } = req.body;

    if (!shop || !productId) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Fetch product details from Shopify
    const client = createShopifyClient(shop, shopRecord.accessToken);
    const response = await client.get({
      path: `products/${productId}`,
    });

    const product = (response.body as any).product;

    if (!product) {
      res.status(404).json({ error: 'Product not found in Shopify' });
      return;
    }

    if (isWholesale) {
      // Add to wholesale catalog
      await prisma.supplierProduct.upsert({
        where: {
          supplierShopId_shopifyVariantId: {
            supplierShopId: shopRecord.id,
            shopifyVariantId: product.variants[0]?.id?.toString() || productId,
          },
        },
        create: {
          supplierShopId: shopRecord.id,
          shopifyProductId: productId,
          shopifyVariantId: product.variants[0]?.id?.toString() || productId,
          title: product.title,
          description: product.body_html || null,
          vendor: product.vendor || null,
          productType: product.product_type || null,
          imageUrl: product.images?.[0]?.src || null,
          sku: product.variants[0]?.sku || null,
          variantTitle: product.variants[0]?.title || null,
          wholesalePrice: parseFloat(product.variants[0]?.price || '0'),
          compareAtPrice: product.variants[0]?.compare_at_price ? parseFloat(product.variants[0].compare_at_price) : null,
          inventoryQuantity: product.variants[0]?.inventory_quantity || 0,
          isWholesaleEligible: true,
        },
        update: {
          isWholesaleEligible: true,
          title: product.title,
          description: product.body_html || null,
          vendor: product.vendor || null,
          productType: product.product_type || null,
          imageUrl: product.images?.[0]?.src || null,
          sku: product.variants[0]?.sku || null,
          variantTitle: product.variants[0]?.title || null,
          wholesalePrice: parseFloat(product.variants[0]?.price || '0'),
          compareAtPrice: product.variants[0]?.compare_at_price ? parseFloat(product.variants[0].compare_at_price) : null,
          inventoryQuantity: product.variants[0]?.inventory_quantity || 0,
          lastSyncedAt: new Date(),
        },
      });

      logger.info(
        `Product ${productId} marked as wholesale for shop: ${shop}`
      );

      // Log audit event
      await prisma.auditLog.create({
        data: {
          shopId: shopRecord.id,
          action: 'PRODUCT_MARKED_WHOLESALE',
          resourceType: 'SupplierProduct',
          resourceId: productId,
        },
      });
    } else {
      // Remove from wholesale catalog (or mark inactive)
      await prisma.supplierProduct.updateMany({
        where: {
          supplierShopId: shopRecord.id,
          shopifyProductId: productId,
        },
        data: {
          isWholesaleEligible: false,
        },
      });

      logger.info(
        `Product ${productId} unmarked as wholesale for shop: ${shop}`
      );
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error toggling wholesale:', error);
    next(error);
  }
});

/**
 * Get connected retail partners
 */
router.get('/partners', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Get connections where this shop is the supplier
    const connections = await prisma.connection.findMany({
      where: { supplierShopId: shopRecord.id },
      include: {
        retailerShop: true,
      },
    });

    const partners = connections.map((conn) => ({
      id: conn.id,
      retailerShop: conn.retailerShop.myshopifyDomain,
      paymentTerms: conn.paymentTermsType,
      minOrderAmount: conn.minOrderAmount.toString(),
      tier: conn.tier,
      status: conn.status,
      createdAt: conn.createdAt,
    }));

    logger.info(`Loaded ${partners.length} partners for shop: ${shop}`);

    res.json({ partners });
  } catch (error) {
    logger.error('Error loading partners:', error);
    next(error);
  }
});

/**
 * Update connection settings (payment terms, min order, status, default markup)
 */
router.patch('/connections/:connectionId', async (req, res, next) => {
  try {
    const { connectionId } = req.params;
    const { shop, paymentTermsType, minOrderAmount, status, defaultMarkupType, defaultMarkupValue } = req.body;

    if (!shop) {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Verify connection belongs to this supplier
    const connection = await prisma.connection.findFirst({
      where: {
        id: connectionId,
        supplierShopId: shopRecord.id,
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Build update data
    const updateData: any = {};
    if (paymentTermsType !== undefined) updateData.paymentTermsType = paymentTermsType;
    if (minOrderAmount !== undefined) updateData.minOrderAmount = parseFloat(minOrderAmount);
    if (status !== undefined) updateData.status = status;

    // Store default markup in perksConfig JSON field
    if (defaultMarkupType !== undefined || defaultMarkupValue !== undefined) {
      const currentPerks = connection.perksConfig as any || {};
      updateData.perksConfig = {
        ...currentPerks,
        defaultMarkup: {
          type: defaultMarkupType || currentPerks?.defaultMarkup?.type || 'PERCENTAGE',
          value: defaultMarkupValue !== undefined ? parseFloat(defaultMarkupValue) : (currentPerks?.defaultMarkup?.value || 50),
        },
      };
    }

    // Update connection
    const updatedConnection = await prisma.connection.update({
      where: { id: connectionId },
      data: updateData,
    });

    logger.info(`Connection ${connectionId} updated by ${shop}`);

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: shopRecord.id,
        action: 'CONNECTION_UPDATED',
        resourceType: 'Connection',
        resourceId: connectionId,
        metadata: updateData,
      },
    });

    res.json({ success: true, connection: updatedConnection });
  } catch (error) {
    logger.error('Error updating connection:', error);
    next(error);
  }
});

/**
 * Save default wholesale settings
 */
router.post('/settings', async (req, res, next) => {
  try {
    const { shop, paymentTerms, minOrderAmount } = req.body;

    if (!shop) {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Get shop from database
    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // TODO: Store settings somewhere (maybe in a separate Settings table)
    logger.info(`Settings received for shop: ${shop} - ${paymentTerms}, ${minOrderAmount}`);

    // For now, just acknowledge receipt
    res.json({ success: true });
  } catch (error) {
    logger.error('Error saving settings:', error);
    next(error);
  }
});

/**
 * Create a connection invite with nickname
 */
router.post('/connection-invite', async (req, res, next) => {
  try {
    const { shop, nickname } = req.body;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    if (!nickname || nickname.trim().length === 0) {
      res.status(400).json({ error: 'Nickname is required' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Check rate limits
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [activeInvites, recentInvites] = await Promise.all([
      prisma.connectionInvite.count({
        where: {
          supplierShopId: shopRecord.id,
          status: 'ACTIVE',
          expiresAt: { gte: new Date() },
        },
      }),
      prisma.connectionInvite.count({
        where: {
          supplierShopId: shopRecord.id,
          createdAt: { gte: oneHourAgo },
        },
      }),
    ]);

    const { canCreateInvite } = await import('../utils/planLimits');
    const limitCheck = canCreateInvite(activeInvites, recentInvites, shopRecord.plan);

    if (!limitCheck.allowed) {
      res.status(429).json({ error: limitCheck.reason });
      return;
    }

    // Generate unique code
    const { generateConnectionCode } = await import('../utils/codeGenerator');
    let code = generateConnectionCode();

    // Ensure code is unique (extremely unlikely to collide, but safety check)
    let attempts = 0;
    while (attempts < 5) {
      const existing = await prisma.connectionInvite.findUnique({
        where: { code },
      });

      if (!existing) break;

      code = generateConnectionCode();
      attempts++;
    }

    // Create invite
    const invite = await prisma.connectionInvite.create({
      data: {
        supplierShopId: shopRecord.id,
        code,
        nickname: nickname.trim(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    logger.info(`Created connection invite for ${shop}: ${code} (${nickname})`);

    res.json({
      success: true,
      invite: {
        id: invite.id,
        code: invite.code,
        nickname: invite.nickname,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    logger.error('Error creating connection invite:', error);
    next(error);
  }
});

/**
 * Get all connection invites for a supplier
 */
router.get('/connection-invites', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const invites = await prisma.connectionInvite.findMany({
      where: { supplierShopId: shopRecord.id },
      orderBy: { createdAt: 'desc' },
    });

    // Auto-expire old invites
    const now = new Date();
    const expiredInvites = invites.filter(
      (inv) => inv.status === 'ACTIVE' && inv.expiresAt < now
    );

    if (expiredInvites.length > 0) {
      await prisma.connectionInvite.updateMany({
        where: {
          id: { in: expiredInvites.map((inv) => inv.id) },
        },
        data: { status: 'EXPIRED' },
      });
    }

    // Fetch updated invites
    const updatedInvites = await prisma.connectionInvite.findMany({
      where: { supplierShopId: shopRecord.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ invites: updatedInvites });
  } catch (error) {
    logger.error('Error loading connection invites:', error);
    next(error);
  }
});

/**
 * Revoke a connection invite
 */
router.delete('/connection-invite/:inviteId', async (req, res, next) => {
  try {
    const { inviteId } = req.params;
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Verify invite belongs to this supplier
    const invite = await prisma.connectionInvite.findFirst({
      where: {
        id: inviteId,
        supplierShopId: shopRecord.id,
      },
    });

    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    // Revoke invite
    await prisma.connectionInvite.update({
      where: { id: inviteId },
      data: { status: 'REVOKED' },
    });

    logger.info(`Revoked connection invite ${inviteId} for ${shop}`);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error revoking connection invite:', error);
    next(error);
  }
});

/**
 * Get purchase orders for a supplier
 */
router.get('/orders', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Get purchase orders where this shop is the supplier
    const orders = await prisma.purchaseOrder.findMany({
      where: { supplierShopId: shopRecord.id },
      include: {
        retailerShop: true,
        connection: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedOrders = orders.map((order) => ({
      id: order.id,
      poNumber: order.poNumber,
      retailerShop: order.retailerShop.myshopifyDomain,
      status: order.status,
      subtotal: order.subtotal.toString(),
      total: order.total.toString(),
      currency: order.currency,
      paymentTerms: order.paymentTermsType,
      items: order.items,
      createdAt: order.createdAt,
    }));

    logger.info(`Loaded ${formattedOrders.length} orders for supplier: ${shop}`);

    res.json({ orders: formattedOrders });
  } catch (error) {
    logger.error('Error loading supplier orders:', error);
    next(error);
  }
});

/**
 * POST /products/sync - Full product sync from Shopify
 * Imports new products, updates existing ones, marks deleted ones as inactive
 */
router.post('/products/sync', async (req, res, next) => {
  try {
    const { shop } = req.body;

    if (!shop) {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Get sync preferences
    const syncPrefs: any = shopRecord.syncPreferences || {
      syncTitle: true,
      syncDescription: true,
      syncImages: true,
      syncPrice: true,
      syncInventory: true,
    };

    // Fetch all products from Shopify
    const client = createShopifyClient(shop, shopRecord.accessToken);
    const response = await client.get({
      path: 'products',
      query: { limit: '250' }, // Max limit
    });

    const shopifyProducts = (response.body as any).products || [];
    const shopifyProductIds = new Set(
      shopifyProducts.map((p: any) => p.id.toString())
    );

    // Get all existing wholesale products from database
    const existingProducts = await prisma.supplierProduct.findMany({
      where: {
        supplierShopId: shopRecord.id,
        isWholesaleEligible: true,
      },
    });

    let imported = 0;
    let updated = 0;
    let removed = 0;

    // Update existing products and keep track of what's still in Shopify
    for (const existing of existingProducts) {
      if (shopifyProductIds.has(existing.shopifyProductId)) {
        // Product still exists in Shopify, update it
        const shopifyProduct = shopifyProducts.find(
          (p: any) => p.id.toString() === existing.shopifyProductId
        );

        if (shopifyProduct) {
          const updateData: any = {
            lastSyncedAt: new Date(),
          };

          if (syncPrefs.syncTitle) {
            updateData.title = shopifyProduct.title;
          }
          if (syncPrefs.syncDescription) {
            updateData.description = shopifyProduct.body_html || null;
          }
          if (syncPrefs.syncImages) {
            updateData.imageUrl = shopifyProduct.images?.[0]?.src || null;
          }
          if (syncPrefs.syncPrice) {
            updateData.wholesalePrice = parseFloat(
              shopifyProduct.variants[0]?.price || '0'
            );
            updateData.compareAtPrice = shopifyProduct.variants[0]
              ?.compare_at_price
              ? parseFloat(shopifyProduct.variants[0].compare_at_price)
              : null;
          }
          if (syncPrefs.syncInventory) {
            updateData.inventoryQuantity =
              shopifyProduct.variants[0]?.inventory_quantity || 0;
          }

          // Always update these metadata fields
          updateData.vendor = shopifyProduct.vendor || null;
          updateData.productType = shopifyProduct.product_type || null;
          updateData.sku = shopifyProduct.variants[0]?.sku || null;
          updateData.variantTitle = shopifyProduct.variants[0]?.title || null;

          await prisma.supplierProduct.updateMany({
            where: {
              supplierShopId: shopRecord.id,
              shopifyProductId: existing.shopifyProductId,
            },
            data: updateData,
          });

          updated++;
        }
      } else {
        // Product no longer exists in Shopify, mark as not wholesale eligible
        await prisma.supplierProduct.updateMany({
          where: {
            supplierShopId: shopRecord.id,
            shopifyProductId: existing.shopifyProductId,
          },
          data: {
            isWholesaleEligible: false,
          },
        });

        removed++;
      }
    }

    logger.info(
      `Product sync completed for ${shop}: ${imported} imported, ${updated} updated, ${removed} removed`
    );

    res.json({ success: true, imported, updated, removed });
  } catch (error) {
    logger.error('Error syncing products:', error);
    next(error);
  }
});

export default router;
