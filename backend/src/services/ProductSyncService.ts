/**
 * ProductSyncService - Handles product synchronization from suppliers to retailers
 *
 * Core responsibilities:
 * - Update SupplierProduct cache when supplier product changes
 * - Propagate changes to connected retailers via ProductMappings
 * - Respect sync preferences (syncTitle, syncPricing, syncImages, etc.)
 * - Handle conflict resolution (SUPPLIER_WINS, RETAILER_WINS, REVIEW_QUEUE)
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import crypto from 'crypto';

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
   */
  private static async syncToRetailer(
    supplierProduct: any,
    mapping: any
  ): Promise<void> {
    const { connection, conflictMode } = mapping;
    const retailerShop = connection.retailerShop;

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

      // Build update mutation based on sync preferences
      const updates: any = {};

      if (mapping.syncTitle) {
        updates.title = supplierProduct.title;
      }

      if (mapping.syncDescription) {
        updates.descriptionHtml = supplierProduct.description;
      }

      if (mapping.syncImages) {
        updates.images = supplierProduct.imageUrl ? [{ src: supplierProduct.imageUrl }] : [];
      }

      if (mapping.syncPricing) {
        // Apply retailer markup
        const basePrice = parseFloat(supplierProduct.wholesalePrice);
        let retailerPrice = basePrice;

        if (mapping.retailerMarkupType === 'PERCENTAGE') {
          retailerPrice = basePrice * (1 + parseFloat(mapping.retailerMarkupValue) / 100);
        } else if (mapping.retailerMarkupType === 'FIXED_AMOUNT') {
          retailerPrice = basePrice + parseFloat(mapping.retailerMarkupValue);
        }

        updates.variants = [
          {
            id: mapping.retailerShopifyVariantId,
            price: retailerPrice.toFixed(2),
          },
        ];
      }

      if (mapping.syncSEO && (supplierProduct.seoTitle || supplierProduct.seoDescription)) {
        updates.seo = {
          title: supplierProduct.seoTitle,
          description: supplierProduct.seoDescription,
        };
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

      // Update mapping with new sync hash
      await prisma.productMapping.update({
        where: { id: mapping.id },
        data: {
          lastSyncHash: syncHash,
          updatedAt: new Date(),
        },
      });

      logger.info(
        `Product ${supplierProduct.id} synced to retailer ${retailerShop.id} successfully`
      );
    } catch (error) {
      logger.error(`Error syncing to retailer ${retailerShop.id}:`, error);
      throw error;
    }
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
