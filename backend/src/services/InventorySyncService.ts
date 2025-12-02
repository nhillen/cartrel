/**
 * InventorySyncService - Handles inventory synchronization from suppliers to retailers
 *
 * Phase 4 Inventory Engine:
 * - Update SupplierProduct inventory when supplier inventory changes
 * - Propagate inventory to connected retailers via ProductMappings
 * - Apply inventory deltas from orders/adjustments/refunds
 * - Respect order_trigger_policy (ON_CREATE vs ON_PAID)
 * - Handle refund/restock rules per policy
 * - Order edits diff (add/remove items)
 * - Multi-location support with location filter
 * - Stock buffer/reserve application
 * - Rate-limit aware batching for inventory updates
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { RateLimitService } from './RateLimitService';
import { ConnectionHealthService } from './ConnectionHealthService';
import { OrderTriggerPolicy, SyncMode } from '@prisma/client';

// Inventory adjustment reason types
export type InventoryAdjustmentReason =
  | 'ORDER_CREATED'
  | 'ORDER_PAID'
  | 'ORDER_CANCELLED'
  | 'ORDER_EDITED'
  | 'REFUND'
  | 'RESTOCK'
  | 'MANUAL_ADJUSTMENT'
  | 'CORRECTION'
  | 'TRANSFER';

// Pending inventory update for batching
interface PendingInventoryUpdate {
  connectionId: string;
  retailerShopId: string;
  retailerVariantId: string;
  inventoryItemId?: string;
  locationId?: string;
  quantity: number;
  reason: InventoryAdjustmentReason;
}

interface InventoryLevel {
  inventory_item_id: string;
  location_id: string;
  available: number;
}

export class InventorySyncService {
  /**
   * Update supplier product inventory from webhook payload
   * Phase 6: Captures location ID for multi-location support
   */
  static async updateSupplierInventory(shopId: string, payload: any): Promise<void> {
    try {
      const inventoryLevel = payload as InventoryLevel;
      const inventoryItemId = inventoryLevel.inventory_item_id.toString();
      const locationId = inventoryLevel.location_id?.toString();

      logger.info(
        `Updating inventory for item ${inventoryItemId} at location ${locationId || 'unknown'} in shop ${shopId}: ${inventoryLevel.available}`
      );

      // Find SupplierProduct by inventory item ID
      // Note: Shopify inventory_item_id maps to variant ID in most cases
      const updated = await prisma.supplierProduct.updateMany({
        where: {
          supplierShopId: shopId,
          shopifyVariantId: inventoryItemId,
        },
        data: {
          inventoryQuantity: inventoryLevel.available,
          lastSyncedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        logger.warn(
          `No SupplierProduct found for inventory item ${inventoryItemId} in shop ${shopId}`
        );
        return;
      }

      logger.info(`Updated ${updated.count} supplier products with new inventory`);

      // Propagate to retailers (with location filter)
      await this.propagateInventoryToRetailers(shopId, inventoryItemId, locationId);
    } catch (error) {
      logger.error(`Error updating supplier inventory:`, error);
      throw error;
    }
  }

  /**
   * Propagate inventory changes to connected retailers
   * Phase 6: Supports multi-location and safety stock
   */
  static async propagateInventoryToRetailers(
    shopId: string,
    shopifyVariantId: string,
    locationId?: string
  ): Promise<void> {
    try {
      // Find the supplier product
      const supplierProduct = await prisma.supplierProduct.findFirst({
        where: {
          supplierShopId: shopId,
          shopifyVariantId: shopifyVariantId,
          isWholesaleEligible: true, // Only sync wholesale products
        },
        include: {
          productMappings: {
            where: {
              status: 'ACTIVE',
              syncInventory: true, // Only sync if preference is enabled
            },
            include: {
              connection: {
                include: {
                  retailerShop: true,
                },
              },
            },
          },
        },
      });

      if (!supplierProduct) {
        logger.warn(`No wholesale supplier product found for variant ${shopifyVariantId}`);
        return;
      }

      if (supplierProduct.productMappings.length === 0) {
        logger.info(
          `No active product mappings with inventory sync enabled for variant ${shopifyVariantId}`
        );
        return;
      }

      logger.info(
        `Propagating inventory ${supplierProduct.inventoryQuantity} to ${supplierProduct.productMappings.length} retailers`
      );

      // Update each retailer's inventory
      for (const mapping of supplierProduct.productMappings) {
        try {
          // Multi-location filter: Skip if location doesn't match
          const connection = mapping.connection;
          if (connection.inventoryLocationId && locationId) {
            // Extract numeric ID from Shopify GID (e.g., "gid://shopify/Location/123" -> "123")
            const connectionLocationNumeric = connection.inventoryLocationId.split('/').pop();
            const webhookLocationNumeric = locationId.split('/').pop();

            if (connectionLocationNumeric !== webhookLocationNumeric) {
              logger.debug(
                `Skipping retailer ${connection.retailerShopId} - location mismatch (${connectionLocationNumeric} != ${webhookLocationNumeric})`
              );
              continue;
            }
          }

          // Apply safety stock: Subtract reserved quantity
          let availableQuantity = supplierProduct.inventoryQuantity;
          if (connection.safetyStockQuantity > 0) {
            availableQuantity = Math.max(0, availableQuantity - connection.safetyStockQuantity);
            logger.debug(
              `Safety stock applied: ${supplierProduct.inventoryQuantity} - ${connection.safetyStockQuantity} = ${availableQuantity}`
            );
          }

          await this.updateRetailerInventory(
            connection.retailerShop,
            mapping.retailerShopifyVariantId,
            availableQuantity
          );
        } catch (error) {
          logger.error(
            `Failed to update inventory for retailer ${mapping.connection.retailerShopId}:`,
            error
          );
          // Continue with other retailers even if one fails
        }
      }

      logger.info(`Inventory propagated for variant ${shopifyVariantId}`);
    } catch (error) {
      logger.error(`Error propagating inventory for variant ${shopifyVariantId}:`, error);
      throw error;
    }
  }

  /**
   * Update inventory for a single retailer variant
   */
  private static async updateRetailerInventory(
    retailerShop: any,
    retailerVariantId: string | null,
    quantity: number
  ): Promise<void> {
    if (!retailerVariantId) {
      logger.warn(`No retailer variant ID - product not imported yet`);
      return;
    }

    try {
      const client = createShopifyGraphQLClient(
        retailerShop.myshopifyDomain,
        retailerShop.accessToken
      );

      // First, get the inventory item ID for the variant
      const variantQuery = `
        query getVariant($id: ID!) {
          productVariant(id: $id) {
            inventoryItem {
              id
            }
          }
        }
      `;

      const variantResponse: any = await client.request(variantQuery, {
        variables: { id: `gid://shopify/ProductVariant/${retailerVariantId}` },
      });

      const inventoryItemId = variantResponse.data?.productVariant?.inventoryItem?.id;

      if (!inventoryItemId) {
        logger.error(`Could not find inventory item for variant ${retailerVariantId}`);
        return;
      }

      // Get the location ID (use first available location)
      const locationsQuery = `
        query {
          locations(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      `;

      const locationsResponse: any = await client.request(locationsQuery);
      const locationId = locationsResponse.data?.locations?.edges?.[0]?.node?.id;

      if (!locationId) {
        logger.error(`No locations found for shop ${retailerShop.myshopifyDomain}`);
        return;
      }

      // Update inventory level
      const mutation = `
        mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
              reason
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          reason: 'correction',
          name: 'available',
          quantities: [
            {
              inventoryItemId: inventoryItemId,
              locationId: locationId,
              quantity: quantity,
            },
          ],
        },
      };

      const response: any = await client.request(mutation, { variables });

      if (response.data?.inventorySetQuantities?.userErrors?.length > 0) {
        const errors = response.data.inventorySetQuantities.userErrors;
        logger.error(`Shopify inventory update errors for retailer ${retailerShop.id}:`, errors);
        throw new Error(`Shopify inventory update failed: ${errors[0].message}`);
      }

      logger.info(
        `Updated inventory for retailer ${retailerShop.id} variant ${retailerVariantId}: ${quantity}`
      );
    } catch (error) {
      logger.error(`Error updating retailer inventory for ${retailerShop.myshopifyDomain}:`, error);
      throw error;
    }
  }

  /**
   * Handle bulk inventory sync for a supplier product
   * Useful for initial sync or manual sync
   */
  static async syncProductInventory(supplierProductId: string): Promise<void> {
    try {
      const supplierProduct = await prisma.supplierProduct.findUnique({
        where: { id: supplierProductId },
        include: {
          productMappings: {
            where: {
              status: 'ACTIVE',
              syncInventory: true,
            },
            include: {
              connection: {
                include: {
                  retailerShop: true,
                },
              },
            },
          },
        },
      });

      if (!supplierProduct) {
        throw new Error(`SupplierProduct ${supplierProductId} not found`);
      }

      logger.info(
        `Syncing inventory ${supplierProduct.inventoryQuantity} for product ${supplierProductId} to ${supplierProduct.productMappings.length} retailers`
      );

      for (const mapping of supplierProduct.productMappings) {
        await this.updateRetailerInventory(
          mapping.connection.retailerShop,
          mapping.retailerShopifyVariantId,
          supplierProduct.inventoryQuantity
        );
      }

      logger.info(`Inventory sync complete for product ${supplierProductId}`);
    } catch (error) {
      logger.error(`Error syncing product inventory for ${supplierProductId}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // PHASE 4: ORDER-BASED INVENTORY ADJUSTMENTS
  // ============================================================================

  /**
   * Process order event for inventory adjustment
   * Respects orderTriggerPolicy (ON_CREATE vs ON_PAID)
   */
  static async processOrderForInventory(
    shopId: string,
    orderId: string,
    event: 'CREATED' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EDITED',
    payload: any
  ): Promise<{ processed: boolean; reason?: string }> {
    try {
      logger.info(`Processing order ${orderId} event ${event} for inventory adjustment`);

      // Get shop and check if it's a supplier
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        include: {
          supplierConnections: {
            where: { status: 'ACTIVE' },
            include: { retailerShop: true },
          },
        },
      });

      if (!shop || shop.supplierConnections.length === 0) {
        // Not a supplier shop with active connections
        return { processed: false, reason: 'No active supplier connections' };
      }

      // Process line items for each connection
      const lineItems = payload.line_items || [];
      const financialStatus = payload.financial_status;

      for (const connection of shop.supplierConnections) {
        // Check sync mode - skip if CATALOG_ONLY
        if (connection.syncMode === SyncMode.CATALOG_ONLY) {
          logger.info(
            `[CATALOG_ONLY] Skipping order inventory adjustment for connection ${connection.id}`
          );
          await ConnectionHealthService.recordSync(
            connection.id,
            'INVENTORY',
            true,
            'Ignored: CATALOG_ONLY mode'
          );
          continue;
        }

        // Check trigger policy
        const shouldProcess = this.shouldProcessOrderEvent(
          connection.orderTriggerPolicy,
          event,
          financialStatus
        );

        if (!shouldProcess.process) {
          logger.info(
            `Skipping order ${orderId} for connection ${connection.id}: ${shouldProcess.reason}`
          );
          continue;
        }

        // Process line items
        for (const item of lineItems) {
          await this.applyOrderInventoryDelta(connection, item, event, payload);
        }
      }

      return { processed: true };
    } catch (error) {
      logger.error(`Error processing order ${orderId} for inventory:`, error);
      throw error;
    }
  }

  /**
   * Determine if order event should be processed based on trigger policy
   */
  private static shouldProcessOrderEvent(
    policy: OrderTriggerPolicy,
    event: 'CREATED' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EDITED',
    financialStatus: string
  ): { process: boolean; reason?: string } {
    switch (policy) {
      case OrderTriggerPolicy.ON_CREATE:
        // Process all events immediately
        return { process: true };

      case OrderTriggerPolicy.ON_PAID:
        // Only process when paid
        if (event === 'CREATED') {
          // Don't decrement on create, wait for payment
          return { process: false, reason: 'ON_PAID policy - waiting for payment' };
        }
        if (event === 'PAID') {
          return { process: true };
        }
        if (event === 'CANCELLED') {
          // Only restock if order was previously paid
          if (financialStatus === 'paid' || financialStatus === 'refunded') {
            return { process: true };
          }
          return { process: false, reason: 'Order was not paid - no restock needed' };
        }
        if (event === 'REFUNDED') {
          // Restock on refund of paid orders
          return { process: true };
        }
        if (event === 'EDITED') {
          // Process edits only if order was paid
          if (financialStatus === 'paid') {
            return { process: true };
          }
          return { process: false, reason: 'Order not paid - ignoring edit' };
        }
        return { process: false, reason: 'Unknown event type' };

      default:
        return { process: false, reason: 'Unknown policy' };
    }
  }

  /**
   * Apply inventory delta for a single order line item
   */
  private static async applyOrderInventoryDelta(
    connection: any,
    lineItem: any,
    event: 'CREATED' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EDITED',
    _orderPayload: any
  ): Promise<void> {
    const variantId = lineItem.variant_id?.toString();
    const quantity = lineItem.quantity || 0;

    if (!variantId) {
      logger.warn('Line item has no variant_id - skipping');
      return;
    }

    // Find the product mapping for this variant
    const mapping = await prisma.productMapping.findFirst({
      where: {
        connectionId: connection.id,
        supplierShopifyVariantId: variantId,
        status: 'ACTIVE',
        syncInventory: true,
      },
      include: {
        supplierProduct: true,
      },
    });

    if (!mapping) {
      logger.debug(
        `No active mapping found for variant ${variantId} in connection ${connection.id}`
      );
      return;
    }

    // Calculate delta based on event type
    let delta = 0;
    let reason: InventoryAdjustmentReason;

    switch (event) {
      case 'CREATED':
      case 'PAID':
        // Decrement inventory
        delta = -quantity;
        reason = event === 'CREATED' ? 'ORDER_CREATED' : 'ORDER_PAID';
        break;

      case 'CANCELLED':
      case 'REFUNDED':
        // Increment inventory (restock)
        delta = quantity;
        reason = event === 'CANCELLED' ? 'ORDER_CANCELLED' : 'REFUND';
        break;

      case 'EDITED':
        // For edits, we'd need to compare old vs new quantities
        // This is handled separately in processOrderEdit
        return;

      default:
        return;
    }

    if (delta === 0) {
      return;
    }

    logger.info(`Applying inventory delta ${delta} for variant ${variantId} (${reason})`);

    // Update supplier product inventory
    const currentQty = mapping.supplierProduct?.inventoryQuantity || 0;
    const newQty = Math.max(0, currentQty + delta);

    await prisma.supplierProduct.update({
      where: { id: mapping.supplierProductId },
      data: {
        inventoryQuantity: newQty,
        lastSyncedAt: new Date(),
      },
    });

    // Propagate to retailers with buffer applied
    await this.propagateInventoryWithBuffer(connection, mapping, newQty, reason);
  }

  /**
   * Process order edit for inventory adjustments
   * Calculates diff between old and new line items
   */
  static async processOrderEdit(
    shopId: string,
    orderId: string,
    previousPayload: any,
    currentPayload: any
  ): Promise<void> {
    logger.info(`Processing order edit for ${orderId}`);

    const previousItems = new Map<string, number>();
    const currentItems = new Map<string, number>();

    // Build maps of variant -> quantity
    for (const item of previousPayload.line_items || []) {
      const key = item.variant_id?.toString();
      if (key) {
        previousItems.set(key, (previousItems.get(key) || 0) + item.quantity);
      }
    }

    for (const item of currentPayload.line_items || []) {
      const key = item.variant_id?.toString();
      if (key) {
        currentItems.set(key, (currentItems.get(key) || 0) + item.quantity);
      }
    }

    // Calculate deltas
    const allVariants = new Set([...previousItems.keys(), ...currentItems.keys()]);

    for (const variantId of allVariants) {
      const prevQty = previousItems.get(variantId) || 0;
      const currQty = currentItems.get(variantId) || 0;
      const delta = currQty - prevQty;

      if (delta !== 0) {
        logger.info(
          `Order edit: variant ${variantId} changed from ${prevQty} to ${currQty} (delta: ${delta})`
        );

        // Apply delta (negative delta means more items ordered, positive means items removed)
        await this.applyInventoryDelta(shopId, variantId, -delta, 'ORDER_EDITED');
      }
    }
  }

  /**
   * Apply a raw inventory delta to a variant
   */
  static async applyInventoryDelta(
    shopId: string,
    variantId: string,
    delta: number,
    reason: InventoryAdjustmentReason
  ): Promise<void> {
    // Find supplier product
    const supplierProduct = await prisma.supplierProduct.findFirst({
      where: {
        supplierShopId: shopId,
        shopifyVariantId: variantId,
      },
    });

    if (!supplierProduct) {
      logger.warn(`No supplier product found for variant ${variantId}`);
      return;
    }

    const newQty = Math.max(0, supplierProduct.inventoryQuantity + delta);

    await prisma.supplierProduct.update({
      where: { id: supplierProduct.id },
      data: {
        inventoryQuantity: newQty,
        lastSyncedAt: new Date(),
      },
    });

    logger.info(
      `Applied inventory delta ${delta} to variant ${variantId}: ${supplierProduct.inventoryQuantity} -> ${newQty} (${reason})`
    );

    // Propagate to retailers
    await this.propagateInventoryToRetailers(shopId, variantId);
  }

  /**
   * Propagate inventory to a specific connection with buffer applied
   */
  private static async propagateInventoryWithBuffer(
    connection: any,
    mapping: any,
    quantity: number,
    reason: InventoryAdjustmentReason
  ): Promise<void> {
    // Apply stock buffer
    const buffer = connection.stockBuffer || connection.safetyStockQuantity || 0;
    const availableQuantity = Math.max(0, quantity - buffer);

    logger.info(
      `Propagating inventory to connection ${connection.id}: ${quantity} - ${buffer} buffer = ${availableQuantity} (${reason})`
    );

    try {
      // Check rate limits before updating
      const requiredDelay = await RateLimitService.getRequiredDelay(connection.retailerShopId);
      const shouldQueue = await RateLimitService.shouldUseDLQ(connection.retailerShopId);

      if (shouldQueue || requiredDelay > 5000) {
        logger.warn(
          `Rate limit concerns for ${connection.retailerShop.myshopifyDomain} (delay: ${requiredDelay}ms) - queueing update`
        );
        // Queue for later processing
        await this.queueInventoryUpdate({
          connectionId: connection.id,
          retailerShopId: connection.retailerShopId,
          retailerVariantId: mapping.retailerShopifyVariantId,
          quantity: availableQuantity,
          reason,
        });
        return;
      }

      // Apply any required delay
      if (requiredDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, requiredDelay));
      }

      await this.updateRetailerInventory(
        connection.retailerShop,
        mapping.retailerShopifyVariantId,
        availableQuantity
      );

      // Record successful sync
      await ConnectionHealthService.recordSync(connection.id, 'INVENTORY', true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to propagate inventory to connection ${connection.id}:`, error);

      // Record failed sync
      await ConnectionHealthService.recordSync(connection.id, 'INVENTORY', false, errorMessage);
    }
  }

  // ============================================================================
  // PHASE 4: RATE-LIMIT AWARE BATCHING
  // ============================================================================

  // Queue for batching inventory updates
  private static pendingUpdates: PendingInventoryUpdate[] = [];
  private static batchProcessorRunning = false;

  /**
   * Queue an inventory update for batched processing
   */
  static async queueInventoryUpdate(update: PendingInventoryUpdate): Promise<void> {
    this.pendingUpdates.push(update);
    logger.info(`Queued inventory update for variant ${update.retailerVariantId}`);

    // Start batch processor if not running
    if (!this.batchProcessorRunning) {
      this.startBatchProcessor();
    }
  }

  /**
   * Start the batch processor for pending updates
   */
  private static startBatchProcessor(): void {
    if (this.batchProcessorRunning) return;

    this.batchProcessorRunning = true;
    logger.info('Starting inventory batch processor');

    // Process batches every 2 seconds
    const intervalId = setInterval(async () => {
      if (this.pendingUpdates.length === 0) {
        clearInterval(intervalId);
        this.batchProcessorRunning = false;
        logger.info('Batch processor stopped - no pending updates');
        return;
      }

      await this.processBatch();
    }, 2000);
  }

  /**
   * Process a batch of pending inventory updates
   */
  private static async processBatch(): Promise<void> {
    // Group by shop for efficient batching
    const byShop = new Map<string, PendingInventoryUpdate[]>();

    // Take up to 50 updates per batch
    const batch = this.pendingUpdates.splice(0, 50);

    for (const update of batch) {
      const shopUpdates = byShop.get(update.retailerShopId) || [];
      shopUpdates.push(update);
      byShop.set(update.retailerShopId, shopUpdates);
    }

    logger.info(
      `Processing batch of ${batch.length} inventory updates across ${byShop.size} shops`
    );

    for (const [shopId, updates] of byShop) {
      try {
        await this.processShopBatch(shopId, updates);
      } catch (error) {
        logger.error(`Failed to process batch for shop ${shopId}:`, error);
        // Re-queue failed updates
        this.pendingUpdates.push(...updates);
      }
    }
  }

  /**
   * Process a batch of updates for a single shop
   * Uses bulk GraphQL queries and batched inventorySetQuantities for efficiency
   */
  private static async processShopBatch(
    shopId: string,
    updates: PendingInventoryUpdate[]
  ): Promise<void> {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
    });

    if (!shop) {
      logger.error(`Shop ${shopId} not found for batch processing`);
      return;
    }

    // Check rate limits
    const requiredDelay = await RateLimitService.getRequiredDelay(shopId);
    const shouldQueue = await RateLimitService.shouldUseDLQ(shopId);

    if (shouldQueue || requiredDelay > 10000) {
      logger.warn(`Rate limit still exceeded for ${shop.myshopifyDomain} - re-queueing`);
      this.pendingUpdates.push(...updates);
      return;
    }

    // Apply any required delay
    if (requiredDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, requiredDelay));
    }

    // Use batched inventory update for efficiency
    try {
      await this.batchUpdateRetailerInventory(shop, updates);
      logger.info(`Batch processed ${updates.length} inventory updates for shop ${shopId}`);
    } catch (error) {
      logger.error(`Failed batch inventory update for shop ${shopId}:`, error);
      // Re-queue failed updates for retry
      this.pendingUpdates.push(...updates);
    }
  }

  /**
   * Batch update inventory for multiple variants in a single API call
   * Much more efficient than individual updates
   */
  private static async batchUpdateRetailerInventory(
    retailerShop: any,
    updates: PendingInventoryUpdate[]
  ): Promise<void> {
    if (updates.length === 0) return;

    const client = createShopifyGraphQLClient(
      retailerShop.myshopifyDomain,
      retailerShop.accessToken
    );

    // Step 1: Get location ID (cache per shop)
    const locationsQuery = `
      query {
        locations(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
    `;

    const locationsResponse: any = await client.request(locationsQuery);
    const locationId = locationsResponse.data?.locations?.edges?.[0]?.node?.id;

    if (!locationId) {
      throw new Error(`No locations found for shop ${retailerShop.myshopifyDomain}`);
    }

    // Step 2: Bulk query all variant inventory item IDs using nodes query
    const variantGids = updates
      .filter((u) => u.retailerVariantId)
      .map((u) => {
        const id = u.retailerVariantId!;
        return id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`;
      });

    if (variantGids.length === 0) {
      logger.warn('No valid variant IDs in batch update');
      return;
    }

    // Query up to 250 nodes at once (Shopify limit)
    const nodesQuery = `
      query getVariantInventoryItems($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            inventoryItem {
              id
            }
          }
        }
      }
    `;

    const nodesResponse: any = await client.request(nodesQuery, {
      variables: { ids: variantGids.slice(0, 250) },
    });

    // Build map of variant GID -> inventory item ID
    const inventoryItemMap = new Map<string, string>();
    for (const node of nodesResponse.data?.nodes || []) {
      if (node?.id && node?.inventoryItem?.id) {
        inventoryItemMap.set(node.id, node.inventoryItem.id);
      }
    }

    // Step 3: Build quantities array for batch update
    const quantities: Array<{
      inventoryItemId: string;
      locationId: string;
      quantity: number;
    }> = [];

    for (const update of updates) {
      if (!update.retailerVariantId) continue;

      const variantGid = update.retailerVariantId.startsWith('gid://')
        ? update.retailerVariantId
        : `gid://shopify/ProductVariant/${update.retailerVariantId}`;

      const inventoryItemId = inventoryItemMap.get(variantGid);
      if (!inventoryItemId) {
        logger.warn(`No inventory item found for variant ${update.retailerVariantId}`);
        continue;
      }

      quantities.push({
        inventoryItemId,
        locationId: update.locationId || locationId,
        quantity: update.quantity,
      });
    }

    if (quantities.length === 0) {
      logger.warn('No valid inventory items to update in batch');
      return;
    }

    // Step 4: Send single batched inventorySetQuantities mutation
    // Shopify supports multiple quantities in one call
    const mutation = `
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
            changes {
              name
              delta
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response: any = await client.request(mutation, {
      variables: {
        input: {
          reason: 'correction',
          name: 'available',
          quantities,
        },
      },
    });

    if (response.data?.inventorySetQuantities?.userErrors?.length > 0) {
      const errors = response.data.inventorySetQuantities.userErrors;
      logger.error(`Shopify batch inventory update errors:`, errors);
      throw new Error(`Shopify batch inventory update failed: ${errors[0].message}`);
    }

    logger.info(
      `Successfully batch updated ${quantities.length} inventory items for ${retailerShop.myshopifyDomain}`
    );
  }

  // ============================================================================
  // PHASE 4: REFUND/RESTOCK HANDLING
  // ============================================================================

  /**
   * Process refund for inventory restock
   * Per PRD: if policy is ON_PAID, unpaid orders don't reverse; paid-then-refunded does
   */
  static async processRefundForRestock(
    shopId: string,
    orderId: string,
    refundPayload: any
  ): Promise<void> {
    logger.info(`Processing refund for order ${orderId} for potential restock`);

    const refundLineItems = refundPayload.refund_line_items || [];

    for (const refundItem of refundLineItems) {
      const lineItem = refundItem.line_item;
      const restockType = refundItem.restock_type; // 'return', 'cancel', 'no_restock'

      if (restockType === 'no_restock') {
        logger.info(`Refund item ${lineItem?.variant_id} marked as no_restock - skipping`);
        continue;
      }

      const variantId = lineItem?.variant_id?.toString();
      const quantity = refundItem.quantity || 0;

      if (!variantId || quantity === 0) {
        continue;
      }

      logger.info(`Restocking ${quantity} units of variant ${variantId} (type: ${restockType})`);

      await this.applyInventoryDelta(shopId, variantId, quantity, 'RESTOCK');
    }
  }

  // ============================================================================
  // PHASE 4: MULTI-LOCATION SUPPORT
  // ============================================================================

  /**
   * Handle location change for a connection
   * Zeros out old location and syncs to new location
   */
  static async handleLocationChange(
    connectionId: string,
    oldLocationId: string | null,
    newLocationId: string
  ): Promise<{ zeroed: number; synced: number }> {
    logger.info(
      `Handling location change for connection ${connectionId}: ${oldLocationId || 'all'} -> ${newLocationId}`
    );

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        productMappings: {
          where: { status: 'ACTIVE', syncInventory: true },
          include: { supplierProduct: true },
        },
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    let zeroed = 0;
    let synced = 0;

    for (const mapping of connection.productMappings) {
      // Zero out old location (if we tracked it)
      if (oldLocationId && mapping.retailerShopifyVariantId) {
        try {
          await this.setInventoryAtLocation(
            connection.retailerShop,
            mapping.retailerShopifyVariantId,
            oldLocationId,
            0
          );
          zeroed++;
        } catch (error) {
          logger.error(`Failed to zero inventory at old location:`, error);
        }
      }

      // Sync to new location
      if (mapping.retailerShopifyVariantId && mapping.supplierProduct) {
        const buffer = connection.stockBuffer || 0;
        const qty = Math.max(0, mapping.supplierProduct.inventoryQuantity - buffer);

        try {
          await this.setInventoryAtLocation(
            connection.retailerShop,
            mapping.retailerShopifyVariantId,
            newLocationId,
            qty
          );
          synced++;
        } catch (error) {
          logger.error(`Failed to sync inventory to new location:`, error);
        }
      }
    }

    // Update connection with new location
    await prisma.connection.update({
      where: { id: connectionId },
      data: { inventoryLocationId: newLocationId },
    });

    logger.info(`Location change complete: zeroed ${zeroed} items, synced ${synced} items`);

    return { zeroed, synced };
  }

  /**
   * Set inventory at a specific location
   */
  private static async setInventoryAtLocation(
    retailerShop: any,
    variantId: string,
    locationId: string,
    quantity: number
  ): Promise<void> {
    const client = createShopifyGraphQLClient(
      retailerShop.myshopifyDomain,
      retailerShop.accessToken
    );

    // Get inventory item ID
    const variantQuery = `
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          inventoryItem {
            id
          }
        }
      }
    `;

    const variantGid = variantId.startsWith('gid://')
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const variantResponse: any = await client.request(variantQuery, {
      variables: { id: variantGid },
    });

    const inventoryItemId = variantResponse.data?.productVariant?.inventoryItem?.id;

    if (!inventoryItemId) {
      throw new Error(`Could not find inventory item for variant ${variantId}`);
    }

    // Ensure location ID is in GID format
    const locationGid = locationId.startsWith('gid://')
      ? locationId
      : `gid://shopify/Location/${locationId}`;

    // Set inventory at location
    const mutation = `
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response: any = await client.request(mutation, {
      variables: {
        input: {
          reason: 'correction',
          name: 'available',
          quantities: [
            {
              inventoryItemId,
              locationId: locationGid,
              quantity,
            },
          ],
        },
      },
    });

    if (response.data?.inventorySetQuantities?.userErrors?.length > 0) {
      const errors = response.data.inventorySetQuantities.userErrors;
      throw new Error(`Shopify error: ${errors[0].message}`);
    }

    logger.info(`Set inventory for variant ${variantId} at location ${locationId}: ${quantity}`);
  }
}
