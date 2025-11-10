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

    // Create Shopify client
    const client = createShopifyClient(shop, shopRecord.accessToken);

    // Fetch products from Shopify
    const response = await client.get({
      path: 'products',
      query: { limit: '50' },
    });

    const shopifyProducts = (response.body as any).products || [];

    // Get wholesale products from database
    const wholesaleProducts = await prisma.supplierProduct.findMany({
      where: { supplierShopId: shopRecord.id },
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
 * Update connection settings (payment terms, min order, status)
 */
router.patch('/connections/:connectionId', async (req, res, next) => {
  try {
    const { connectionId } = req.params;
    const { shop, paymentTermsType, minOrderAmount, status } = req.body;

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

export default router;
