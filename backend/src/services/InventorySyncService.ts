/**
 * InventorySyncService - Handles inventory synchronization from suppliers to retailers
 *
 * Core responsibilities:
 * - Update SupplierProduct inventory when supplier inventory changes
 * - Propagate inventory to connected retailers via ProductMappings
 * - Respect syncInventory preference
 * - Handle safety stock and allocation logic (future)
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';

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
  static async updateSupplierInventory(
    shopId: string,
    payload: any
  ): Promise<void> {
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

      const inventoryItemId =
        variantResponse.data?.productVariant?.inventoryItem?.id;

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
        logger.error(
          `Shopify inventory update errors for retailer ${retailerShop.id}:`,
          errors
        );
        throw new Error(`Shopify inventory update failed: ${errors[0].message}`);
      }

      logger.info(
        `Updated inventory for retailer ${retailerShop.id} variant ${retailerVariantId}: ${quantity}`
      );
    } catch (error) {
      logger.error(
        `Error updating retailer inventory for ${retailerShop.myshopifyDomain}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Handle bulk inventory sync for a supplier product
   * Useful for initial sync or manual sync
   */
  static async syncProductInventory(
    supplierProductId: string
  ): Promise<void> {
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
}
