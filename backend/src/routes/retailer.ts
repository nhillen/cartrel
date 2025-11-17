import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { createShopifyClient } from '../services/shopify';
import { requireAuth, requireRole } from '../middleware/auth';
import { orderLimiter } from '../middleware/rateLimits';

const router = Router();

// Apply authentication to all retailer routes
router.use(requireAuth);
router.use(requireRole('RETAILER', 'BOTH'));

/**
 * Get connected suppliers
 */
router.get('/suppliers', async (req, res, next) => {
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
      logger.warn(`Retailer shop not found: ${shop}`);
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    logger.debug(`Loading suppliers for retailer: ${shop} (ID: ${shopRecord.id})`);

    // Get connections where this shop is the retailer
    const connections = await prisma.connection.findMany({
      where: {
        retailerShopId: shopRecord.id,
        status: 'ACTIVE',
      },
      include: {
        supplierShop: true,
      },
    });

    logger.debug(`Found ${connections.length} active connections for retailer ${shop}`);

    const suppliers = connections.map((conn) => {
      const perks = conn.perksConfig as any || {};
      return {
        id: conn.supplierShopId,
        name: conn.supplierShop.myshopifyDomain,
        paymentTerms: conn.paymentTermsType,
        tier: conn.tier,
        connectionId: conn.id,
        defaultMarkup: perks.defaultMarkup || { type: 'PERCENTAGE', value: 50 },
      };
    });

    logger.info(`Loaded ${suppliers.length} suppliers for retailer: ${shop}`);

    res.json({ suppliers });
  } catch (error) {
    logger.error('Error loading suppliers:', error);
    next(error);
  }
});

/**
 * Browse supplier's wholesale catalog
 */
router.get('/catalog/:supplierId', async (req, res, next) => {
  try {
    const { supplierId } = req.params;
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Get retailer shop
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Verify connection exists
    const connection = await prisma.connection.findFirst({
      where: {
        supplierShopId: supplierId,
        retailerShopId: retailerShop.id,
        status: 'ACTIVE',
      },
    });

    if (!connection) {
      res.status(403).json({ error: 'Not connected to this supplier' });
      return;
    }

    // Get wholesale products from supplier
    const products = await prisma.supplierProduct.findMany({
      where: {
        supplierShopId: supplierId,
        isWholesaleEligible: true,
      },
      include: {
        productMappings: {
          where: {
            connectionId: connection.id,
          },
        },
      },
    });

    const formattedProducts = products.map((p) => {
      const mapping = p.productMappings[0]; // Should only be one per connection
      return {
        id: p.shopifyProductId,
        variantId: p.shopifyVariantId,
        title: p.title,
        price: p.wholesalePrice.toFixed(2),
        image: p.imageUrl || null,
        isImported: !!mapping,
        mappingId: mapping?.id,
        retailPrice: mapping ? (parseFloat(p.wholesalePrice.toFixed(2)) * (1 + mapping.retailerMarkupValue.toNumber() / 100)).toFixed(2) : null,
        lastSynced: p.lastSyncedAt,
      };
    });

    logger.info(
      `Loaded ${formattedProducts.length} products from supplier ${supplierId} for retailer: ${shop}`
    );

    res.json({ products: formattedProducts });
  } catch (error) {
    logger.error('Error loading catalog:', error);
    next(error);
  }
});

/**
 * Place order (create draft order in supplier's Shopify)
 * Rate limited to prevent order spam
 */
router.post('/order', orderLimiter, async (req, res, next) => {
  try {
    const { shop, supplierId, items } = req.body;

    if (!shop || !supplierId || !items || items.length === 0) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Get retailer shop
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Retailer shop not found' });
      return;
    }

    // Get supplier shop
    const supplierShop = await prisma.shop.findUnique({
      where: { id: supplierId },
    });

    if (!supplierShop) {
      res.status(404).json({ error: 'Supplier shop not found' });
      return;
    }

    // Verify connection
    const connection = await prisma.connection.findFirst({
      where: {
        supplierShopId: supplierId,
        retailerShopId: retailerShop.id,
        status: 'ACTIVE',
      },
    });

    if (!connection) {
      res.status(403).json({ error: 'Not connected to this supplier' });
      return;
    }

    // Check supplier's PO capacity
    const { canCreatePurchaseOrder, shouldResetMonthlyUsage } = await import('../utils/planLimits');

    // Reset counter if needed
    if (shouldResetMonthlyUsage(supplierShop.currentPeriodStart)) {
      await prisma.shop.update({
        where: { id: supplierShop.id },
        data: {
          purchaseOrdersThisMonth: 0,
          currentPeriodStart: new Date(),
        },
      });
      supplierShop.purchaseOrdersThisMonth = 0;
    }

    // Check if supplier can accept more POs
    const limitCheck = canCreatePurchaseOrder(
      supplierShop.purchaseOrdersThisMonth,
      supplierShop.plan
    );

    if (!limitCheck.allowed) {
      res.status(400).json({
        error: 'Supplier at capacity',
        message: `This supplier has reached their monthly order limit. Please try again later or contact the supplier to upgrade their plan.`,
        supplierAtCapacity: true,
      });
      return;
    }

    // Calculate total
    const subtotal = items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );

    // Generate PO number
    const poNumber = `PO-${Date.now()}`;

    // Create PO record
    const po = await prisma.purchaseOrder.create({
      data: {
        connectionId: connection.id,
        retailerShopId: retailerShop.id,
        supplierShopId: supplierShop.id,
        poNumber,
        status: 'DRAFT',
        items,
        subtotal,
        total: subtotal, // No shipping/tax for now
        currency: 'USD',
        paymentTermsType: connection.paymentTermsType,
        tierAtOrder: connection.tier,
        shippingAddress: { shop: retailerShop.myshopifyDomain }, // Placeholder
      },
    });

    logger.info(
      `Created PO ${po.id} from ${shop} to ${supplierShop.myshopifyDomain}`
    );

    // Forward order to supplier's Shopify using OrderForwardingService
    try {
      const { OrderForwardingService } = await import('../services/OrderForwardingService');

      // Create draft order in supplier's Shopify
      const draftOrderId = await OrderForwardingService.createDraftOrderInSupplierShop(po.id);

      // Increment supplier's PO count for this month
      await prisma.shop.update({
        where: { id: supplierShop.id },
        data: {
          purchaseOrdersThisMonth: {
            increment: 1,
          },
        },
      });

      logger.info(
        `Draft order ${draftOrderId} created in supplier Shopify for PO ${po.id}. Supplier PO count: ${supplierShop.purchaseOrdersThisMonth + 1}`
      );

      // Log audit event
      await prisma.auditLog.create({
        data: {
          shopId: retailerShop.id,
          action: 'PURCHASE_ORDER_CREATED',
          resourceType: 'PurchaseOrder',
          resourceId: po.id,
        },
      });

      res.json({
        success: true,
        orderId: po.id,
        draftOrderId,
        poNumber: poNumber,
        message: 'Order submitted successfully. Draft order created in supplier Shopify.',
      });
    } catch (shopifyError) {
      logger.error('Error creating draft order in Shopify:', shopifyError);

      // Update PO status to failed
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'CANCELLED' },
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create draft order in supplier Shopify',
      });
    }
  } catch (error) {
    logger.error('Error placing order:', error);
    next(error);
  }
});

/**
 * Get available products from supplier for import wizard
 */
router.get('/import/available', async (req, res, next) => {
  try {
    const { shop, connectionId, includeImported } = req.query;

    if (!shop || typeof shop !== 'string' || !connectionId || typeof connectionId !== 'string') {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Verify retailer owns this connection
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { retailerShop: true },
    });

    if (!connection || connection.retailerShopId !== retailerShop.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const { ProductImportService } = await import('../services/ProductImportService');
    const result = await ProductImportService.getAvailableProducts(
      connectionId,
      includeImported === 'true'
    );

    res.json(result);
  } catch (error) {
    logger.error('Error getting available products:', error);
    next(error);
  }
});

/**
 * Preview product import with field-level diffs
 */
router.post('/import/preview', async (req, res, next) => {
  try {
    const { shop, connectionId, productIds, preferences } = req.body;

    if (!shop || !connectionId || !productIds || !Array.isArray(productIds)) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Verify retailer owns this connection
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { retailerShop: true },
    });

    if (!connection || connection.retailerShopId !== retailerShop.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const { ProductImportService } = await import('../services/ProductImportService');
    const result = await ProductImportService.previewImport(
      connectionId,
      productIds,
      preferences || {}
    );

    logger.info(
      `Import preview for ${shop}: ${result.summary.newImports} new, ${result.summary.updates} updates`
    );

    res.json(result);
  } catch (error) {
    logger.error('Error previewing import:', error);
    next(error);
  }
});

/**
 * Bulk import products with field-level preferences
 */
router.post('/import/bulk', async (req, res, next) => {
  try {
    const { shop, connectionId, productIds, preferences, createInShopify = true } = req.body;

    if (!shop || !connectionId || !productIds || !Array.isArray(productIds)) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Verify retailer owns this connection
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { retailerShop: true },
    });

    if (!connection || connection.retailerShopId !== retailerShop.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const { ProductImportService } = await import('../services/ProductImportService');
    const result = await ProductImportService.importProducts(
      connectionId,
      productIds,
      preferences || {},
      createInShopify
    );

    logger.info(
      `Bulk import for ${shop}: ${result.summary.success} success, ${result.summary.errors} errors`
    );

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: retailerShop.id,
        action: 'PRODUCTS_BULK_IMPORTED',
        resourceType: 'ProductMapping',
        resourceId: connectionId,
        metadata: {
          productCount: productIds.length,
          successCount: result.summary.success,
          errorCount: result.summary.errors,
        },
      },
    });

    res.json(result);
  } catch (error) {
    logger.error('Error bulk importing products:', error);
    next(error);
  }
});

/**
 * Update sync preferences for existing product mappings
 */
router.patch('/import/preferences', async (req, res, next) => {
  try {
    const { shop, mappingIds, preferences } = req.body;

    if (!shop || !mappingIds || !Array.isArray(mappingIds) || !preferences) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Verify retailer owns these mappings
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Verify all mappings belong to this retailer
    const mappings = await prisma.productMapping.findMany({
      where: {
        id: { in: mappingIds },
      },
      include: {
        connection: true,
      },
    });

    const unauthorized = mappings.some(
      (m) => m.connection.retailerShopId !== retailerShop.id
    );

    if (unauthorized) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const { ProductImportService } = await import('../services/ProductImportService');
    const updatedCount = await ProductImportService.updateMappingPreferences(
      mappingIds,
      preferences
    );

    logger.info(`Updated preferences for ${updatedCount} product mappings for ${shop}`);

    res.json({ success: true, updatedCount });
  } catch (error) {
    logger.error('Error updating mapping preferences:', error);
    next(error);
  }
});

/**
 * Import product to retailer's store (legacy single import)
 */
router.post('/import', async (req, res, next) => {
  try {
    const {
      shop,
      supplierId,
      productId,
      variantId,
      markupType,
      markupValue,
      syncInventory = true,
      syncPricing = false,
      syncDescription = false,
      syncImages = false,
    } = req.body;

    if (!shop || !supplierId || !productId || !variantId || !markupType || markupValue === undefined) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Get retailer shop
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Retailer shop not found' });
      return;
    }

    // Get supplier shop
    const supplierShop = await prisma.shop.findUnique({
      where: { id: supplierId },
    });

    if (!supplierShop) {
      res.status(404).json({ error: 'Supplier shop not found' });
      return;
    }

    // Verify connection
    const connection = await prisma.connection.findFirst({
      where: {
        supplierShopId: supplierId,
        retailerShopId: retailerShop.id,
        status: 'ACTIVE',
      },
    });

    if (!connection) {
      res.status(403).json({ error: 'Not connected to this supplier' });
      return;
    }

    // Get supplier product details
    const supplierProduct = await prisma.supplierProduct.findFirst({
      where: {
        supplierShopId: supplierId,
        shopifyProductId: productId,
        shopifyVariantId: variantId,
      },
    });

    if (!supplierProduct) {
      res.status(404).json({ error: 'Supplier product not found' });
      return;
    }

    // Calculate retail price based on markup
    let retailPrice = supplierProduct.wholesalePrice.toNumber();
    if (markupType === 'PERCENTAGE') {
      retailPrice = retailPrice * (1 + parseFloat(markupValue) / 100);
    } else if (markupType === 'FIXED_AMOUNT') {
      retailPrice = retailPrice + parseFloat(markupValue);
    } else if (markupType === 'CUSTOM') {
      retailPrice = parseFloat(markupValue);
    }

    // Create product in retailer's Shopify
    const client = createShopifyClient(retailerShop.myshopifyDomain, retailerShop.accessToken);

    const productData = {
      product: {
        title: supplierProduct.title,
        body_html: supplierProduct.description || '',
        vendor: supplierProduct.vendor || supplierShop.myshopifyDomain,
        product_type: supplierProduct.productType || 'Wholesale',
        tags: `cartrel,wholesale,supplier:${supplierId}`,
        variants: [
          {
            price: retailPrice.toFixed(2),
            sku: supplierProduct.sku || `WHOLESALE-${productId}`,
            inventory_management: 'shopify',
            inventory_quantity: 0, // Start with 0, retailer can adjust
          },
        ],
        images: supplierProduct.imageUrl ? [{ src: supplierProduct.imageUrl }] : [],
      },
    };

    const response = await client.post({
      path: 'products',
      data: productData,
    });

    const createdProduct = (response.body as any).product;

    // Create product mapping with retailer's sync preferences
    await prisma.productMapping.create({
      data: {
        connectionId: connection.id,
        supplierProductId: supplierProduct.id,
        supplierShopifyProductId: productId,
        supplierShopifyVariantId: variantId,
        retailerShopifyProductId: createdProduct.id.toString(),
        retailerShopifyVariantId: createdProduct.variants[0].id.toString(),
        retailerMarkupType: markupType,
        retailerMarkupValue: parseFloat(markupValue),
        syncInventory,
        syncPricing,
        syncDescription,
        syncImages,
      },
    });

    logger.info(
      `Product ${productId} imported to ${shop} with ${markupType} markup of ${markupValue}`
    );

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: retailerShop.id,
        action: 'PRODUCT_IMPORTED',
        resourceType: 'ProductMapping',
        resourceId: createdProduct.id.toString(),
        metadata: {
          supplierProductId: productId,
          markupType,
          markupValue,
        },
      },
    });

    res.json({
      success: true,
      productId: createdProduct.id,
      retailPrice: retailPrice.toFixed(2),
    });
  } catch (error: any) {
    logger.error('Error importing product:', error);

    // Check for auth errors (invalid/expired token)
    if (error?.response?.code === 401 || error?.message?.includes('Invalid API key')) {
      res.status(401).json({
        error: 'Invalid access token. Please try uninstalling and reinstalling the app.',
        requiresReinstall: true
      });
      return;
    }

    // Check for GraphQL errors
    if (error?.response?.errors) {
      res.status(400).json({ error: error.response.errors[0]?.message || 'Error creating product in Shopify' });
      return;
    }

    next(error);
  }
});

/**
 * Re-import product (for products that were deleted from store but mapping still exists)
 */
router.post('/reimport', async (req, res, next) => {
  try {
    const { shop, mappingId } = req.body;

    if (!shop || !mappingId) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Get retailer shop
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Retailer shop not found' });
      return;
    }

    // Get product mapping with supplier product details
    const mapping = await prisma.productMapping.findUnique({
      where: { id: mappingId },
      include: {
        supplierProduct: {
          include: {
            supplierShop: true,
          },
        },
        connection: true,
      },
    });

    if (!mapping) {
      res.status(404).json({ error: 'Product mapping not found' });
      return;
    }

    // Verify the mapping belongs to this retailer
    if (mapping.connection.retailerShopId !== retailerShop.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const supplierProduct = mapping.supplierProduct;

    // Calculate retail price based on existing markup
    let retailPrice = supplierProduct.wholesalePrice.toNumber();
    if (mapping.retailerMarkupType === 'PERCENTAGE') {
      retailPrice = retailPrice * (1 + mapping.retailerMarkupValue.toNumber() / 100);
    } else if (mapping.retailerMarkupType === 'FIXED_AMOUNT') {
      retailPrice = retailPrice + mapping.retailerMarkupValue.toNumber();
    } else if (mapping.retailerMarkupType === 'CUSTOM') {
      retailPrice = mapping.retailerMarkupValue.toNumber();
    }

    // Create product in retailer's Shopify
    const client = createShopifyClient(retailerShop.myshopifyDomain, retailerShop.accessToken);

    const productData = {
      product: {
        title: supplierProduct.title,
        body_html: supplierProduct.description || '',
        vendor: supplierProduct.vendor || supplierProduct.supplierShop.myshopifyDomain,
        product_type: supplierProduct.productType || 'Wholesale',
        tags: `cartrel,wholesale,supplier:${supplierProduct.supplierShopId}`,
        variants: [
          {
            price: retailPrice.toFixed(2),
            sku: supplierProduct.sku || `WHOLESALE-${supplierProduct.shopifyProductId}`,
            inventory_management: 'shopify',
            inventory_quantity: 0, // Start with 0, retailer can adjust
          },
        ],
        images: supplierProduct.imageUrl ? [{ src: supplierProduct.imageUrl }] : [],
      },
    };

    const response = await client.post({
      path: 'products',
      data: productData,
    });

    const createdProduct = (response.body as any).product;

    // Update product mapping with new Shopify IDs
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        retailerShopifyProductId: createdProduct.id.toString(),
        retailerShopifyVariantId: createdProduct.variants[0].id.toString(),
      },
    });

    logger.info(
      `Product ${supplierProduct.shopifyProductId} re-imported to ${shop} (mapping ${mappingId})`
    );

    res.json({
      success: true,
      productId: createdProduct.id,
    });
  } catch (error: any) {
    logger.error('Error re-importing product:', error);

    // Check for auth errors (invalid/expired token)
    if (error?.response?.code === 401 || error?.message?.includes('Invalid API key')) {
      res.status(401).json({
        error: 'Invalid access token. Please try uninstalling and reinstalling the app.',
        requiresReinstall: true
      });
      return;
    }

    // Check for GraphQL errors
    if (error?.response?.errors) {
      res.status(400).json({ error: error.response.errors[0]?.message || 'Error creating product in Shopify' });
      return;
    }

    next(error);
  }
});

/**
 * Redeem a connection code from a supplier
 */
router.post('/redeem-code', async (req, res, next) => {
  try {
    const { shop, code } = req.body;

    if (!shop || !code) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Normalize code (remove hyphens, uppercase)
    const normalizedCode = code.replace(/-/g, '').toUpperCase();

    // Get retailer shop
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Retailer shop not found' });
      return;
    }

    // Find invite by code
    const invite = await prisma.connectionInvite.findFirst({
      where: {
        code: normalizedCode,
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
      },
      include: {
        supplierShop: true,
      },
    });

    if (!invite) {
      res.status(404).json({ error: 'Invalid or expired code' });
      return;
    }

    // Check if connection already exists
    const existingConnection = await prisma.connection.findFirst({
      where: {
        supplierShopId: invite.supplierShopId,
        retailerShopId: retailerShop.id,
      },
    });

    if (existingConnection) {
      // If terminated, reactivate it
      if (existingConnection.status === 'TERMINATED') {
        await prisma.connection.update({
          where: { id: existingConnection.id },
          data: {
            status: 'ACTIVE',
            nickname: invite.nickname, // Copy nickname from invite
          },
        });

        // Mark invite as redeemed
        await prisma.connectionInvite.update({
          where: { id: invite.id },
          data: {
            status: 'REDEEMED',
            redeemedBy: retailerShop.id,
            redeemedAt: new Date(),
            connectionId: existingConnection.id,
          },
        });

        logger.info(
          `Connection reactivated via invite: ${invite.supplierShop.myshopifyDomain} → ${shop}`
        );

        res.json({
          success: true,
          supplierName: invite.supplierShop.myshopifyDomain,
          connectionId: existingConnection.id,
          reactivated: true,
        });
        return;
      }

      // Already active
      res.status(400).json({ error: 'Already connected to this supplier' });
      return;
    }

    // Check supplier's plan limits
    const supplierWithConnections = await prisma.shop.findUnique({
      where: { id: invite.supplierShopId },
      include: {
        supplierConnections: {
          where: {
            status: {
              in: ['ACTIVE', 'PENDING_INVITE'],
            },
          },
        },
      },
    });

    const currentConnections = supplierWithConnections?.supplierConnections.length || 0;
    const { canCreateConnection } = await import('../utils/planLimits');
    const limitCheck = canCreateConnection(currentConnections, invite.supplierShop.plan);

    if (!limitCheck.allowed) {
      res.status(400).json({ error: 'Supplier has reached their connection limit' });
      return;
    }

    // Create connection
    const connection = await prisma.connection.create({
      data: {
        supplierShopId: invite.supplierShopId,
        retailerShopId: retailerShop.id,
        status: 'ACTIVE',
        nickname: invite.nickname, // Copy nickname from invite
        paymentTermsType: 'PREPAY',
        tier: 'STANDARD',
      },
    });

    // Mark invite as redeemed
    await prisma.connectionInvite.update({
      where: { id: invite.id },
      data: {
        status: 'REDEEMED',
        redeemedBy: retailerShop.id,
        redeemedAt: new Date(),
        connectionId: connection.id,
      },
    });

    logger.info(
      `Connection created via invite ${invite.nickname}: ${invite.supplierShop.myshopifyDomain} → ${shop}`
    );

    // Log audit event
    await prisma.auditLog.create({
      data: {
        shopId: retailerShop.id,
        action: 'CONNECTION_CREATED',
        resourceType: 'Connection',
        resourceId: connection.id,
        metadata: { via: 'invite', inviteId: invite.id, nickname: invite.nickname },
      },
    });

    res.json({
      success: true,
      supplierName: invite.supplierShop.myshopifyDomain,
      connectionId: connection.id,
    });
  } catch (error) {
    logger.error('Error redeeming connection code:', error);
    next(error);
  }
});

/**
 * Start async product import (for large catalogs 100+ products)
 */
router.post('/import/async', async (req, res, next) => {
  try {
    const { shop, connectionId, productIds, preferences, createInShopify = true } = req.body;

    if (!shop || !connectionId || !productIds || !Array.isArray(productIds)) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Verify retailer owns this connection
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { retailerShop: true },
    });

    if (!connection || connection.retailerShopId !== retailerShop.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    // Generate batch ID
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create batch status record
    await prisma.importBatchStatus.create({
      data: {
        batchId,
        connectionId,
        retailerShopId: retailerShop.id,
        totalProducts: productIds.length,
        status: 'PENDING',
      },
    });

    // Queue the import job
    const { getImportQueue } = await import('../queues');
    const importQueue = getImportQueue();

    await importQueue.add({
      connectionId,
      retailerShopId: retailerShop.id,
      supplierProductIds: productIds,
      preferences: preferences || {},
      createInShopify,
      batchId,
    });

    logger.info(`Queued async import for ${shop}: ${productIds.length} products (batch ${batchId})`);

    res.json({
      success: true,
      batchId,
      totalProducts: productIds.length,
      message: 'Import queued. Use /import/status/:batchId to track progress.',
    });
  } catch (error) {
    logger.error('Error starting async import:', error);
    next(error);
  }
});

/**
 * Get import batch status
 */
router.get('/import/status/:batchId', async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    // Verify retailer owns this batch
    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const batchStatus = await prisma.importBatchStatus.findUnique({
      where: { batchId },
    });

    if (!batchStatus) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    if (batchStatus.retailerShopId !== retailerShop.id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    // Calculate progress percentage
    const progress = batchStatus.totalProducts > 0
      ? Math.round((batchStatus.completed / batchStatus.totalProducts) * 100)
      : 0;

    res.json({
      batchId: batchStatus.batchId,
      status: batchStatus.status,
      totalProducts: batchStatus.totalProducts,
      completed: batchStatus.completed,
      successful: batchStatus.successful,
      failed: batchStatus.failed,
      progress,
      startedAt: batchStatus.startedAt,
      completedAt: batchStatus.completedAt,
      errors: batchStatus.errors,
    });
  } catch (error) {
    logger.error('Error getting import batch status:', error);
    next(error);
  }
});

/**
 * Health panel - Get sync errors and warnings
 */
router.get('/health', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const retailerShop = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!retailerShop) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Get webhook errors from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const webhookErrors = await prisma.webhookLog.findMany({
      where: {
        shopId: retailerShop.id,
        processed: false,
        errorMessage: { not: null },
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Get failed import batches from last 7 days
    const failedImports = await prisma.importBatchStatus.findMany({
      where: {
        retailerShopId: retailerShop.id,
        status: 'FAILED',
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Get product mappings with sync issues (DISCONTINUED or no retailer product ID)
    const syncIssues = await prisma.productMapping.findMany({
      where: {
        connection: {
          retailerShopId: retailerShop.id,
        },
        OR: [
          { status: 'DISCONTINUED' },
          { retailerShopifyProductId: null },
        ],
      },
      include: {
        supplierProduct: {
          select: { title: true },
        },
      },
      take: 20,
    });

    // Calculate overall health score
    const totalErrors = webhookErrors.length + failedImports.length + syncIssues.length;
    let healthScore = 100;
    if (totalErrors > 0) {
      healthScore = Math.max(0, 100 - totalErrors * 5);
    }

    res.json({
      healthScore,
      webhookErrors: webhookErrors.map((w) => ({
        id: w.id,
        topic: w.topic,
        error: w.errorMessage,
        createdAt: w.createdAt,
      })),
      failedImports: failedImports.map((i) => ({
        batchId: i.batchId,
        totalProducts: i.totalProducts,
        completed: i.completed,
        errors: i.errors,
        createdAt: i.createdAt,
      })),
      syncIssues: syncIssues.map((m) => ({
        id: m.id,
        productTitle: m.supplierProduct.title,
        status: m.status,
        issue: m.retailerShopifyProductId ? 'Discontinued' : 'Not imported',
      })),
    });

    logger.info(`Health check for ${shop}: score ${healthScore}, ${totalErrors} issues`);
  } catch (error) {
    logger.error('Error getting health status:', error);
    next(error);
  }
});

/**
 * Get purchase orders for a retailer
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

    // Get purchase orders where this shop is the retailer
    const orders = await prisma.purchaseOrder.findMany({
      where: { retailerShopId: shopRecord.id },
      include: {
        supplierShop: true,
        connection: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedOrders = orders.map((order) => ({
      id: order.id,
      poNumber: order.poNumber,
      supplierShop: order.supplierShop.myshopifyDomain,
      status: order.status,
      subtotal: order.subtotal.toString(),
      total: order.total.toString(),
      currency: order.currency,
      paymentTerms: order.paymentTermsType,
      items: order.items,
      createdAt: order.createdAt,
      supplierDraftOrderId: order.supplierShopifyDraftOrderId,
    }));

    logger.info(`Loaded ${formattedOrders.length} orders for retailer: ${shop}`);

    res.json({ orders: formattedOrders });
  } catch (error) {
    logger.error('Error loading retailer orders:', error);
    next(error);
  }
});

export default router;
