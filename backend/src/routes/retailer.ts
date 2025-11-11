import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';
import { createShopifyClient } from '../services/shopify';

const router = Router();

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
 */
router.post('/order', async (req, res, next) => {
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

    // Create draft order in supplier's Shopify with customer association
    try {
      const client = createShopifyClient(
        supplierShop.myshopifyDomain,
        supplierShop.accessToken
      );

      // First, find or create a customer record for this retailer
      let customerId: string | null = null;

      try {
        // Search for existing customer by company name
        const searchResponse: any = await client.get({
          path: 'customers/search',
          query: { query: `company:${shop}` },
        });

        const existingCustomers = searchResponse.body.customers || [];

        if (existingCustomers.length > 0) {
          customerId = existingCustomers[0].id.toString();
          logger.info(`Found existing customer ${customerId} for retailer ${shop}`);
        } else {
          // Create new customer record for this retailer
          const customerData = {
            customer: {
              email: `orders@${shop}`,
              first_name: shop.split('.')[0],
              last_name: '(Retailer)',
              note: `B2B Wholesale Customer - Retailer Shop: ${shop}`,
              tags: 'wholesale,b2b,cartrel',
              tax_exempt: false,
            },
          };

          const customerResponse: any = await client.post({
            path: 'customers',
            data: customerData,
          });

          customerId = customerResponse.body.customer.id.toString();
          logger.info(`Created new customer ${customerId} for retailer ${shop}`);
        }
      } catch (customerError) {
        logger.warn('Could not create/find customer, creating draft order without customer:', customerError);
        // Continue without customer if there's an error
      }

      // Build line items for REST API
      const lineItems = items.map((item: any) => ({
        variant_id: parseInt(item.variantId || item.id),
        quantity: item.quantity,
      }));

      // Create draft order
      const draftOrderData: any = {
        draft_order: {
          line_items: lineItems,
          customer: customerId ? { id: parseInt(customerId) } : undefined,
          note: `Wholesale order from ${shop} via Cartrel\nPO Number: ${poNumber}\nPO ID: ${po.id}`,
          tags: 'cartrel,wholesale,b2b',
          email: `orders@${shop}`,
        },
      };

      const response: any = await client.post({
        path: 'draft_orders',
        data: draftOrderData,
      });

      const draftOrder = response.body.draft_order;

      // Update PO with Shopify draft order ID
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          supplierShopifyDraftOrderId: draftOrder.id.toString(),
        },
      });

      logger.info(
        `Created draft order ${draftOrder.id} in supplier Shopify for PO ${po.id}`
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
        draftOrderId: draftOrder.id.toString(),
        invoiceUrl: draftOrder.invoice_url,
        poNumber: poNumber,
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
 * Import product to retailer's store
 */
router.post('/import', async (req, res, next) => {
  try {
    const { shop, supplierId, productId, variantId, markupType, markupValue } = req.body;

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

    // Create product mapping
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
        syncInventory: false, // Default to false, retailer can enable
        syncPricing: false,
        syncDescription: false,
        syncImages: false,
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
          data: { status: 'ACTIVE' },
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

export default router;
