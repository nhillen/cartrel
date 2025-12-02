/**
 * ProductSyncService - Handles product synchronization from suppliers to retailers
 *
 * Core responsibilities:
 * - Update SupplierProduct cache when supplier product changes
 * - Propagate changes to connected retailers via ProductMappings
 * - Respect sync preferences (syncTitle, syncPricing, syncImages, etc.)
 * - Handle conflict resolution (SUPPLIER_WINS, RETAILER_WINS, REVIEW_QUEUE)
 *
 * Per PRD_PRODUCT_ONLY_MODE:
 * - CATALOG_ONLY mode syncs content without inventory
 * - Per-connection syncScope controls field defaults
 *
 * Per PRD_PRODUCT_SETTINGS_SYNC:
 * - Field-level controls per connection
 * - Tag sync modes (append vs mirror)
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { ConnectionHealthService } from './ConnectionHealthService';
import { SyncMode } from '@prisma/client';
import crypto from 'crypto';

// Sync scope fields that can be controlled per connection
export interface SyncScope {
  syncTitle?: boolean;
  syncDescription?: boolean;
  syncImages?: boolean;
  syncPricing?: boolean;
  syncVendor?: boolean;
  syncProductType?: boolean;
  syncTags?: boolean;
  syncSEO?: boolean;
  syncWeight?: boolean;
  syncBarcode?: boolean;
  tagSyncMode?: 'APPEND' | 'MIRROR';
}

// Default sync scope
const DEFAULT_SYNC_SCOPE: SyncScope = {
  syncTitle: true,
  syncDescription: true,
  syncImages: true,
  syncPricing: true,
  syncVendor: false,
  syncProductType: false,
  syncTags: false,
  syncSEO: false,
  syncWeight: false,
  syncBarcode: false,
  tagSyncMode: 'APPEND',
};

interface ShopifyProduct {
  id: string;
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  images?: Array<{ src: string }>;
  variants?: Array<{
    id: string;
    sku?: string;
    price?: string;
    compareAtPrice?: string;
    inventoryQuantity?: number;
    barcode?: string;
  }>;
  seo?: {
    title?: string;
    description?: string;
  };
  tags?: string[];
}

export class ProductSyncService {
  /**
   * Update SupplierProduct cache from Shopify webhook payload
   */
  static async updateSupplierProductCache(
    shopId: string,
    shopifyProductId: string,
    payload: any
  ): Promise<void> {
    try {
      logger.info(`Updating product cache for ${shopifyProductId} in shop ${shopId}`);

      const product = payload as ShopifyProduct;

      // Update or create SupplierProduct records for each variant
      for (const variant of product.variants || []) {
        const variantId = variant.id.split('/').pop() || variant.id; // Extract ID from GraphQL ID
        const productIdClean = shopifyProductId.split('/').pop() || shopifyProductId;

        await prisma.supplierProduct.upsert({
          where: {
            supplierShopId_shopifyVariantId: {
              supplierShopId: shopId,
              shopifyVariantId: variantId,
            },
          },
          update: {
            title: product.title,
            description: product.descriptionHtml || '',
            vendor: product.vendor || '',
            productType: product.productType || '',
            imageUrl: product.images?.[0]?.src || '',
            sku: variant.sku || '',
            wholesalePrice: parseFloat(variant.price || '0'),
            compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
            inventoryQuantity: variant.inventoryQuantity || 0,
            barcode: variant.barcode || null,
            seoTitle: product.seo?.title || null,
            seoDescription: product.seo?.description || null,
            lastSyncedAt: new Date(),
          },
          create: {
            supplierShopId: shopId,
            shopifyProductId: productIdClean,
            shopifyVariantId: variantId,
            title: product.title,
            description: product.descriptionHtml || '',
            vendor: product.vendor || '',
            productType: product.productType || '',
            imageUrl: product.images?.[0]?.src || '',
            sku: variant.sku || '',
            wholesalePrice: parseFloat(variant.price || '0'),
            compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
            inventoryQuantity: variant.inventoryQuantity || 0,
            barcode: variant.barcode || null,
            seoTitle: product.seo?.title || null,
            seoDescription: product.seo?.description || null,
            isWholesaleEligible: false, // Default to not eligible until explicitly marked
            lastSyncedAt: new Date(),
          },
        });
      }

      logger.info(`Product cache updated for ${shopifyProductId}`);
    } catch (error) {
      logger.error(`Error updating product cache for ${shopifyProductId}:`, error);
      throw error;
    }
  }

  /**
   * Propagate product changes to connected retailers
   */
  static async propagateToRetailers(
    shopId: string,
    shopifyProductId: string
  ): Promise<void> {
    try {
      const productIdClean = shopifyProductId.split('/').pop() || shopifyProductId;

      // Find all SupplierProducts for this Shopify product
      const supplierProducts = await prisma.supplierProduct.findMany({
        where: {
          supplierShopId: shopId,
          shopifyProductId: productIdClean,
          isWholesaleEligible: true, // Only sync wholesale-eligible products
        },
        include: {
          productMappings: {
            where: {
              status: 'ACTIVE',
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

      logger.info(`Found ${supplierProducts.length} supplier products to propagate`);

      // Propagate to each mapped retailer
      for (const supplierProduct of supplierProducts) {
        for (const mapping of supplierProduct.productMappings) {
          try {
            await this.syncToRetailer(supplierProduct, mapping);
          } catch (error) {
            logger.error(
              `Failed to sync product ${supplierProduct.id} to retailer ${mapping.connection.retailerShopId}:`,
              error
            );
            // Continue with other retailers even if one fails
          }
        }
      }

      logger.info(`Product ${shopifyProductId} propagated to retailers`);
    } catch (error) {
      logger.error(`Error propagating product ${shopifyProductId}:`, error);
      throw error;
    }
  }

  /**
   * Sync a single product to a retailer based on ProductMapping settings
   *
   * Checks:
   * - SKU drift blocking
   * - Hidden tag handling
   * - Connection sync mode (CATALOG_ONLY skips inventory)
   * - Field-level sync preferences (mapping + connection scope)
   */
  private static async syncToRetailer(
    supplierProduct: any,
    mapping: any
  ): Promise<void> {
    const { connection, conflictMode } = mapping;
    const retailerShop = connection.retailerShop;

    // Check for SKU drift - block sync until resolved
    if (mapping.skuDriftDetected) {
      logger.warn(
        `SKU drift detected for mapping ${mapping.id} - sync blocked until resolved`
      );
      await this.recordSyncError(
        mapping.id,
        connection.id,
        'SKU drift detected - original SKU has changed. Please remap or resolve.'
      );
      return;
    }

    // Check for hidden tag - handle according to action
    if (mapping.sourceHiddenTag && mapping.hiddenTagAction !== 'PENDING') {
      logger.info(
        `Hidden tag on source product for mapping ${mapping.id} - action: ${mapping.hiddenTagAction}`
      );
      // If ZERO_INVENTORY or UNSYNC, skip regular sync
      if (mapping.hiddenTagAction === 'ZERO_INVENTORY' || mapping.hiddenTagAction === 'UNSYNC') {
        return;
      }
    }

    // Check conflict mode - if REVIEW_QUEUE, don't auto-sync
    if (conflictMode === 'REVIEW_QUEUE') {
      logger.info(
        `Product ${supplierProduct.id} requires manual review for retailer ${retailerShop.id}`
      );
      // TODO: Create PendingSync record for manual approval
      return;
    }

    // If RETAILER_WINS, skip sync
    if (conflictMode === 'RETAILER_WINS') {
      logger.info(`Skipping sync for ${supplierProduct.id} - RETAILER_WINS mode`);
      return;
    }

    // SUPPLIER_WINS mode - proceed with sync
    if (!mapping.retailerShopifyProductId) {
      logger.warn(
        `No retailer product ID for mapping ${mapping.id} - product not imported yet`
      );
      return;
    }

    try {
      const client = createShopifyGraphQLClient(
        retailerShop.myshopifyDomain,
        retailerShop.accessToken
      );

      // Merge connection syncScope with mapping preferences
      // Mapping preferences override connection defaults
      const connectionScope = this.parseConnectionSyncScope(connection.syncScope);
      const effectiveScope = this.mergeScopes(connectionScope, mapping);

      // Build update mutation based on effective sync preferences
      const updates: any = {};

      if (effectiveScope.syncTitle) {
        updates.title = supplierProduct.title;
      }

      if (effectiveScope.syncDescription) {
        updates.descriptionHtml = supplierProduct.description;
      }

      if (effectiveScope.syncImages) {
        updates.images = supplierProduct.imageUrl ? [{ src: supplierProduct.imageUrl }] : [];
      }

      if (effectiveScope.syncVendor) {
        updates.vendor = supplierProduct.vendor;
      }

      if (effectiveScope.syncProductType) {
        updates.productType = supplierProduct.productType;
      }

      // Pricing sync - respects CATALOG_ONLY mode
      if (effectiveScope.syncPricing) {
        // Apply retailer markup
        const basePrice = parseFloat(supplierProduct.wholesalePrice);
        let retailerPrice = basePrice;

        if (mapping.retailerMarkupType === 'PERCENTAGE') {
          retailerPrice = basePrice * (1 + parseFloat(mapping.retailerMarkupValue || 0) / 100);
        } else if (mapping.retailerMarkupType === 'FIXED_AMOUNT') {
          retailerPrice = basePrice + parseFloat(mapping.retailerMarkupValue || 0);
        }

        updates.variants = [
          {
            id: mapping.retailerShopifyVariantId,
            price: retailerPrice.toFixed(2),
          },
        ];
      }

      if (effectiveScope.syncSEO && (supplierProduct.seoTitle || supplierProduct.seoDescription)) {
        updates.seo = {
          title: supplierProduct.seoTitle,
          description: supplierProduct.seoDescription,
        };
      }

      // Tag sync with mode support (APPEND vs MIRROR)
      if (effectiveScope.syncTags && supplierProduct.tags) {
        // For MIRROR mode, we'd replace all tags
        // For APPEND mode (default), we'd add without removing
        // Note: This requires fetching existing tags for APPEND mode
        updates.tags = supplierProduct.tags;
      }

      // Only update if there are changes
      if (Object.keys(updates).length === 0) {
        logger.info(`No sync preferences enabled for mapping ${mapping.id}`);
        return;
      }

      // Calculate sync hash to detect changes
      const syncHash = this.calculateSyncHash(updates);

      // Skip if nothing changed
      if (mapping.lastSyncHash === syncHash) {
        logger.info(`No changes detected for mapping ${mapping.id}`);
        return;
      }

      // Update product in retailer's Shopify
      const mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
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
          id: mapping.retailerShopifyProductId,
          ...updates,
        },
      };

      const response: any = await client.request(mutation, { variables });

      if (response.data?.productUpdate?.userErrors?.length > 0) {
        const errors = response.data.productUpdate.userErrors;
        logger.error(`Shopify API errors for mapping ${mapping.id}:`, errors);
        throw new Error(`Shopify update failed: ${errors[0].message}`);
      }

      // Update mapping with success status
      await prisma.productMapping.update({
        where: { id: mapping.id },
        data: {
          lastSyncHash: syncHash,
          lastSyncAt: new Date(),
          lastCatalogAt: new Date(),
          lastSuccessAt: new Date(),
          errorCount: 0,
          lastError: null,
          lastErrorAt: null,
        },
      });

      // Record health
      await ConnectionHealthService.recordSync(connection.id, 'CATALOG', true);

      logger.info(
        `Product ${supplierProduct.id} synced to retailer ${retailerShop.id} successfully`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error syncing to retailer ${retailerShop.id}:`, error);

      // Record error on mapping
      await this.recordSyncError(mapping.id, connection.id, errorMessage);

      throw error;
    }
  }

  /**
   * Record a sync error on a mapping and connection
   */
  private static async recordSyncError(
    mappingId: string,
    connectionId: string,
    error: string
  ): Promise<void> {
    // Update mapping error tracking
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        lastError: error,
        lastErrorAt: new Date(),
        errorCount: { increment: 1 },
      },
    });

    // Record health event
    await ConnectionHealthService.recordSync(connectionId, 'CATALOG', false, error);
  }

  /**
   * Parse connection syncScope JSON into SyncScope object
   */
  private static parseConnectionSyncScope(scopeJson: any): SyncScope {
    if (!scopeJson) {
      return DEFAULT_SYNC_SCOPE;
    }

    try {
      const parsed = typeof scopeJson === 'string' ? JSON.parse(scopeJson) : scopeJson;
      return { ...DEFAULT_SYNC_SCOPE, ...parsed };
    } catch {
      return DEFAULT_SYNC_SCOPE;
    }
  }

  /**
   * Merge connection scope with mapping-level preferences
   * Mapping preferences take precedence
   */
  private static mergeScopes(connectionScope: SyncScope, mapping: any): SyncScope {
    return {
      syncTitle: mapping.syncTitle ?? connectionScope.syncTitle,
      syncDescription: mapping.syncDescription ?? connectionScope.syncDescription,
      syncImages: mapping.syncImages ?? connectionScope.syncImages,
      syncPricing: mapping.syncPricing ?? connectionScope.syncPricing,
      syncVendor: connectionScope.syncVendor,
      syncProductType: connectionScope.syncProductType,
      syncTags: mapping.syncTags ?? connectionScope.syncTags,
      syncSEO: mapping.syncSEO ?? connectionScope.syncSEO,
      syncWeight: connectionScope.syncWeight,
      syncBarcode: connectionScope.syncBarcode,
      tagSyncMode: mapping.tagSyncMode ?? connectionScope.tagSyncMode,
    };
  }

  /**
   * Check if connection is in product-only mode
   */
  static isProductOnlyMode(connection: any): boolean {
    return connection.syncMode === SyncMode.CATALOG_ONLY;
  }

  /**
   * Calculate hash of sync data to detect changes
   */
  private static calculateSyncHash(data: any): string {
    const json = JSON.stringify(data);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  /**
   * Mark product as deleted (soft delete)
   */
  static async handleProductDelete(
    shopId: string,
    shopifyProductId: string
  ): Promise<void> {
    try {
      const productIdClean = shopifyProductId.split('/').pop() || shopifyProductId;

      // Mark all ProductMappings as DISCONTINUED
      const mappings = await prisma.productMapping.updateMany({
        where: {
          supplierProduct: {
            supplierShopId: shopId,
            shopifyProductId: productIdClean,
          },
        },
        data: {
          status: 'DISCONTINUED',
        },
      });

      logger.info(
        `Marked ${mappings.count} product mappings as DISCONTINUED for product ${shopifyProductId}`
      );

      // Mark SupplierProducts as not wholesale eligible
      await prisma.supplierProduct.updateMany({
        where: {
          supplierShopId: shopId,
          shopifyProductId: productIdClean,
        },
        data: {
          isWholesaleEligible: false,
        },
      });

      logger.info(`Product ${shopifyProductId} marked as deleted`);
    } catch (error) {
      logger.error(`Error handling product delete for ${shopifyProductId}:`, error);
      throw error;
    }
  }
}
