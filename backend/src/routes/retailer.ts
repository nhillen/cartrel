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

    const suppliers = connections.map((conn) => ({
      id: conn.supplierShopId,
      name: conn.supplierShop.myshopifyDomain,
      paymentTerms: conn.paymentTermsType,
      tier: conn.tier,
      connectionId: conn.id,
    }));

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
    });

    const formattedProducts = products.map((p) => ({
      id: p.shopifyProductId,
      title: p.title,
      price: p.wholesalePrice.toFixed(2),
      image: p.imageUrl || null,
    }));

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

    // Create draft order in supplier's Shopify
    try {
      const client = createShopifyClient(
        supplierShop.myshopifyDomain,
        supplierShop.accessToken
      );

      const draftOrderData = {
        draft_order: {
          line_items: items.map((item: any) => ({
            variant_id: item.id,
            quantity: item.quantity,
          })),
          customer: {
            email: `${shop}@cartrel.com`, // Placeholder
          },
          note: `Wholesale order from ${shop} via Cartrel (PO: ${po.id})`,
          tags: 'cartrel,wholesale',
        },
      };

      const response = await client.post({
        path: 'draft_orders',
        data: draftOrderData,
      });

      const draftOrder = (response.body as any).draft_order;

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
        draftOrderId: draftOrder.id,
        invoiceUrl: draftOrder.invoice_url,
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

export default router;
