/**
 * ProductImportService - Handles bulk product imports with field-level control
 *
 * Core responsibilities:
 * - Fetch available products from supplier's Shopify
 * - Preview product imports with field-level diffs
 * - Bulk import products with configurable sync preferences
 * - Async import processing for large catalogs (1000+ products)
 * - Validate against plan limits
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { ProductMappingStatus } from '@prisma/client';
import { canMarkProductWholesale, getEffectiveLimits } from '../utils/planLimits';
import { BulkOperationService } from './BulkOperationService';

interface ImportPreferences {
  syncTitle?: boolean;
  syncDescription?: boolean;
  syncImages?: boolean;
  syncPricing?: boolean;
  syncInventory?: boolean;
  syncTags?: boolean;
  syncSEO?: boolean;
  syncMetafields?: string[]; // Array of metafield keys to sync
  retailerMarkupType?: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'CUSTOM';
  retailerMarkupValue?: string;
  conflictMode?: 'SUPPLIER_WINS' | 'RETAILER_WINS' | 'REVIEW_QUEUE';
}

interface ProductDiff {
  field: string;
  supplierValue: any;
  retailerValue: any;
  willSync: boolean;
  reason?: string;
}

interface ProductPreview {
  supplierProductId: string;
  title: string;
  wholesalePrice: string;
  retailPrice: string;
  imageUrl?: string;
  sku?: string;
  alreadyImported: boolean;
  diffs: ProductDiff[];
  wouldExceedLimit: boolean;
}

interface ImportResult {
  success: boolean;
  productMappingId?: string;
  error?: string;
}

export class ProductImportService {
  /**
   * Fetch available products from supplier for import
   * Filters out already-imported products by default
   * Supports cursor-based pagination for large catalogs (1000+ products)
   */
  static async getAvailableProducts(
    connectionId: string,
    options: {
      includeImported?: boolean;
      cursor?: string;
      limit?: number;
      search?: string;
    } = {}
  ): Promise<{ products: any[]; hasNextPage: boolean; nextCursor?: string; totalCount: number }> {
    try {
      const { includeImported = false, cursor, limit = 50, search } = options;
      const take = Math.min(limit, 100); // Cap at 100 per page

      logger.info(
        `Fetching available products for connection ${connectionId} (cursor: ${cursor || 'none'}, limit: ${take})`
      );

      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          supplierShop: true,
          retailerShop: true,
        },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      // Build where clause
      const whereClause: any = {
        supplierShopId: connection.supplierShopId,
        isWholesaleEligible: true,
      };

      // Add search filter if provided
      if (search) {
        whereClause.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Get total count for pagination info
      const totalCount = await prisma.supplierProduct.count({
        where: whereClause,
      });

      // Get supplier's wholesale products with cursor pagination
      const supplierProducts = await prisma.supplierProduct.findMany({
        where: whereClause,
        include: {
          productMappings: {
            where: {
              connectionId: connectionId,
            },
          },
        },
        take: take + 1, // Fetch one extra to check if there's more
        orderBy: [{ title: 'asc' }, { id: 'asc' }], // Stable ordering for cursor
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      // Check if there are more results
      const hasNextPage = supplierProducts.length > take;
      const productsToReturn = hasNextPage ? supplierProducts.slice(0, -1) : supplierProducts;

      // Filter based on includeImported flag
      let filteredProducts = productsToReturn;
      if (!includeImported) {
        filteredProducts = productsToReturn.filter((p) => p.productMappings.length === 0);
      }

      const products = filteredProducts.map((p) => ({
        id: p.id,
        shopifyProductId: p.shopifyProductId,
        title: p.title,
        description: p.description,
        wholesalePrice: p.wholesalePrice.toString(),
        imageUrl: p.imageUrl,
        sku: p.sku,
        inventoryQuantity: p.inventoryQuantity,
        alreadyImported: p.productMappings.length > 0,
        mappingId: p.productMappings[0]?.id,
      }));

      // Get cursor for next page (last item's ID)
      const nextCursor = hasNextPage ? productsToReturn[productsToReturn.length - 1].id : undefined;

      logger.info(
        `Found ${products.length} available products (${includeImported ? 'including' : 'excluding'} imported, total: ${totalCount})`
      );

      return {
        products,
        hasNextPage,
        nextCursor,
        totalCount,
      };
    } catch (error) {
      logger.error(`Error fetching available products:`, error);
      throw error;
    }
  }

  /**
   * Preview product import with field-level diffs
   * Shows what will be synced based on preferences
   */
  static async previewImport(
    connectionId: string,
    supplierProductIds: string[],
    preferences: ImportPreferences
  ): Promise<{ previews: ProductPreview[]; summary: any }> {
    try {
      logger.info(
        `Previewing import of ${supplierProductIds.length} products for connection ${connectionId}`
      );

      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          supplierShop: true,
          retailerShop: true,
        },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      // Check plan limits
      const retailerShop = connection.retailerShop;
      const limits = getEffectiveLimits(retailerShop);

      const currentProductCount = await prisma.supplierProduct.count({
        where: {
          supplierShopId: connection.supplierShopId,
          isWholesaleEligible: true,
        },
      });

      const previews: ProductPreview[] = [];

      for (const productId of supplierProductIds) {
        const supplierProduct = await prisma.supplierProduct.findUnique({
          where: { id: productId },
          include: {
            productMappings: {
              where: { connectionId },
            },
          },
        });

        if (!supplierProduct) {
          logger.warn(`Supplier product ${productId} not found, skipping`);
          continue;
        }

        const alreadyImported = supplierProduct.productMappings.length > 0;
        const existingMapping = supplierProduct.productMappings[0];

        // Calculate retail price with markup
        const basePrice = parseFloat(supplierProduct.wholesalePrice.toString());
        let retailPrice = basePrice;

        const markupType =
          preferences.retailerMarkupType || existingMapping?.retailerMarkupType || 'PERCENTAGE';
        const markupValue =
          preferences.retailerMarkupValue ||
          existingMapping?.retailerMarkupValue?.toString() ||
          '50';

        if (markupType === 'PERCENTAGE') {
          retailPrice = basePrice * (1 + parseFloat(markupValue) / 100);
        } else if (markupType === 'FIXED_AMOUNT') {
          retailPrice = basePrice + parseFloat(markupValue);
        }

        // Build diffs for each field
        const diffs: ProductDiff[] = [];

        // Title
        diffs.push({
          field: 'title',
          supplierValue: supplierProduct.title,
          retailerValue: existingMapping?.retailerShopifyProductId
            ? 'Current retailer title'
            : null,
          willSync: preferences.syncTitle !== false,
        });

        // Description
        diffs.push({
          field: 'description',
          supplierValue: supplierProduct.description?.substring(0, 100) + '...' || 'No description',
          retailerValue: existingMapping?.retailerShopifyProductId
            ? 'Current retailer description'
            : null,
          willSync: preferences.syncDescription !== false,
        });

        // Images
        diffs.push({
          field: 'images',
          supplierValue: supplierProduct.imageUrl ? '1 image' : 'No images',
          retailerValue: null,
          willSync: preferences.syncImages !== false,
        });

        // Pricing
        diffs.push({
          field: 'price',
          supplierValue: `$${basePrice.toFixed(2)} wholesale`,
          retailerValue: `$${retailPrice.toFixed(2)} retail (${markupType}: ${markupValue}${markupType === 'PERCENTAGE' ? '%' : ''})`,
          willSync: preferences.syncPricing !== false,
        });

        // Inventory
        diffs.push({
          field: 'inventory',
          supplierValue: `${supplierProduct.inventoryQuantity} units`,
          retailerValue: null,
          willSync: preferences.syncInventory !== false,
        });

        // SEO
        diffs.push({
          field: 'seo',
          supplierValue: 'SEO title & description',
          retailerValue: null,
          willSync: preferences.syncSEO === true,
        });

        // Check if would exceed limit
        const wouldExceedLimit =
          !alreadyImported &&
          !canMarkProductWholesale(currentProductCount + previews.length, retailerShop.plan)
            .allowed;

        previews.push({
          supplierProductId: productId,
          title: supplierProduct.title || 'Untitled Product',
          wholesalePrice: basePrice.toFixed(2),
          retailPrice: retailPrice.toFixed(2),
          imageUrl: supplierProduct.imageUrl || undefined,
          sku: supplierProduct.sku || undefined,
          alreadyImported,
          diffs,
          wouldExceedLimit,
        });
      }

      // Build summary
      const summary = {
        totalProducts: previews.length,
        newImports: previews.filter((p) => !p.alreadyImported).length,
        updates: previews.filter((p) => p.alreadyImported).length,
        wouldExceedLimit: previews.filter((p) => p.wouldExceedLimit).length,
        planLimit: limits.products,
        currentCount: currentProductCount,
        fieldsToSync: {
          title: preferences.syncTitle !== false,
          description: preferences.syncDescription !== false,
          images: preferences.syncImages !== false,
          pricing: preferences.syncPricing !== false,
          inventory: preferences.syncInventory !== false,
          tags: preferences.syncTags === true,
          seo: preferences.syncSEO === true,
        },
      };

      logger.info(
        `Preview complete: ${summary.newImports} new, ${summary.updates} updates, ${summary.wouldExceedLimit} exceed limit`
      );

      return { previews, summary };
    } catch (error) {
      logger.error(`Error previewing import:`, error);
      throw error;
    }
  }

  /**
   * Import products with specified preferences
   * Creates ProductMappings and optionally creates products in retailer's Shopify
   */
  static async importProducts(
    connectionId: string,
    supplierProductIds: string[],
    preferences: ImportPreferences,
    createInShopify: boolean = true
  ): Promise<{ results: ImportResult[]; summary: any }> {
    try {
      logger.info(`Importing ${supplierProductIds.length} products for connection ${connectionId}`);

      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          supplierShop: true,
          retailerShop: true,
        },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      // Check plan limits
      const retailerShop = connection.retailerShop;
      const limits = getEffectiveLimits(retailerShop);

      const currentProductCount = await prisma.supplierProduct.count({
        where: {
          supplierShopId: connection.supplierShopId,
          isWholesaleEligible: true,
        },
      });

      const results: ImportResult[] = [];
      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;

      for (const productId of supplierProductIds) {
        try {
          const supplierProduct = await prisma.supplierProduct.findUnique({
            where: { id: productId },
            include: {
              productMappings: {
                where: { connectionId },
              },
            },
          });

          if (!supplierProduct) {
            results.push({
              success: false,
              error: `Product ${productId} not found`,
            });
            errorCount++;
            continue;
          }

          // Check if already imported
          const existingMapping = supplierProduct.productMappings[0];
          if (existingMapping && !createInShopify) {
            results.push({
              success: true,
              productMappingId: existingMapping.id,
            });
            skippedCount++;
            continue;
          }

          // Check plan limit for new imports
          if (
            !existingMapping &&
            !canMarkProductWholesale(currentProductCount + successCount, retailerShop.plan).allowed
          ) {
            results.push({
              success: false,
              error: `Plan limit reached (${limits.products} products)`,
            });
            errorCount++;
            continue;
          }

          // Create or update ProductMapping
          const mapping = await this.createOrUpdateMapping(
            connection,
            supplierProduct,
            preferences,
            createInShopify
          );

          results.push({
            success: true,
            productMappingId: mapping.id,
          });
          successCount++;
        } catch (error) {
          logger.error(`Error importing product ${productId}:`, error);
          results.push({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          errorCount++;
        }
      }

      const summary = {
        total: supplierProductIds.length,
        success: successCount,
        errors: errorCount,
        skipped: skippedCount,
      };

      logger.info(
        `Import complete: ${successCount} success, ${errorCount} errors, ${skippedCount} skipped`
      );

      return { results, summary };
    } catch (error) {
      logger.error(`Error importing products:`, error);
      throw error;
    }
  }

  /**
   * Create or update ProductMapping with preferences
   */
  private static async createOrUpdateMapping(
    connection: any,
    supplierProduct: any,
    preferences: ImportPreferences,
    createInShopify: boolean
  ): Promise<any> {
    try {
      // Check if mapping already exists
      const existingMapping = await prisma.productMapping.findFirst({
        where: {
          connectionId: connection.id,
          supplierProductId: supplierProduct.id,
        },
      });

      // Calculate retail price
      const basePrice = parseFloat(supplierProduct.wholesalePrice || '0');
      let retailPrice = basePrice;

      const markupType = preferences.retailerMarkupType || 'PERCENTAGE';
      const markupValue = preferences.retailerMarkupValue || '50';

      if (markupType === 'PERCENTAGE') {
        retailPrice = basePrice * (1 + parseFloat(markupValue) / 100);
      } else if (markupType === 'FIXED_AMOUNT') {
        retailPrice = basePrice + parseFloat(markupValue);
      }

      let retailerShopifyProductId = existingMapping?.retailerShopifyProductId;
      let retailerShopifyVariantId = existingMapping?.retailerShopifyVariantId;

      // Create product in retailer's Shopify if requested
      if (createInShopify && !existingMapping) {
        const shopifyProduct = await this.createProductInRetailerShop(
          connection.retailerShop,
          supplierProduct,
          retailPrice,
          preferences
        );

        retailerShopifyProductId = shopifyProduct.productId;
        retailerShopifyVariantId = shopifyProduct.variantId;
      }

      // Create or update mapping
      const mappingData = {
        connectionId: connection.id,
        supplierProductId: supplierProduct.id,
        supplierShopifyProductId: supplierProduct.shopifyProductId,
        supplierShopifyVariantId: supplierProduct.shopifyVariantId,
        retailerShopifyProductId,
        retailerShopifyVariantId,
        status: ProductMappingStatus.ACTIVE,
        syncTitle: preferences.syncTitle !== false,
        syncDescription: preferences.syncDescription !== false,
        syncImages: preferences.syncImages !== false,
        syncPricing: preferences.syncPricing !== false,
        syncInventory: preferences.syncInventory !== false,
        syncTags: preferences.syncTags === true,
        syncSEO: preferences.syncSEO === true,
        retailerMarkupType: markupType,
        retailerMarkupValue: markupValue,
        conflictMode: preferences.conflictMode || 'SUPPLIER_WINS',
      };

      if (existingMapping) {
        return await prisma.productMapping.update({
          where: { id: existingMapping.id },
          data: mappingData,
        });
      } else {
        return await prisma.productMapping.create({
          data: mappingData,
        });
      }
    } catch (error) {
      logger.error(`Error creating/updating mapping:`, error);
      throw error;
    }
  }

  /**
   * Create product in retailer's Shopify store
   */
  private static async createProductInRetailerShop(
    retailerShop: any,
    supplierProduct: any,
    retailPrice: number,
    preferences: ImportPreferences
  ): Promise<{ productId: string; variantId: string }> {
    try {
      const client = createShopifyGraphQLClient(
        retailerShop.myshopifyDomain,
        retailerShop.accessToken
      );

      // Build product input based on preferences
      const productInput: any = {
        title: preferences.syncTitle !== false ? supplierProduct.title : 'Wholesale Product',
        descriptionHtml: preferences.syncDescription !== false ? supplierProduct.description : '',
        productType: 'Wholesale',
        vendor: 'Wholesale Supplier',
        tags: ['wholesale'],
      };

      // Add images if syncing
      if (preferences.syncImages !== false && supplierProduct.imageUrl) {
        productInput.images = [
          {
            src: supplierProduct.imageUrl,
          },
        ];
      }

      // Add variant with pricing
      productInput.variants = [
        {
          price: preferences.syncPricing !== false ? retailPrice.toFixed(2) : '0.00',
          sku: supplierProduct.sku || undefined,
          inventoryQuantity:
            preferences.syncInventory !== false ? supplierProduct.inventoryQuantity : 0,
        },
      ];

      // Create product mutation
      const mutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              title
              variants(first: 1) {
                edges {
                  node {
                    id
                  }
                }
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
        variables: { input: productInput },
      });

      if (response.data?.productCreate?.userErrors?.length > 0) {
        const errors = response.data.productCreate.userErrors;
        logger.error(`Shopify product creation errors:`, errors);
        throw new Error(`Product creation failed: ${errors[0].message}`);
      }

      const product = response.data.productCreate.product;
      const productId = product.id.split('/').pop();
      const variantId = product.variants.edges[0].node.id.split('/').pop();

      logger.info(`Created product in retailer shop: ${product.title} (ID: ${productId})`);

      return { productId, variantId };
    } catch (error) {
      logger.error(`Error creating product in retailer shop:`, error);
      throw error;
    }
  }

  /**
   * Stage upload an image and return the resource URL
   * Used for better performance when importing products with images
   */
  private static async stageUploadImage(
    shop: { myshopifyDomain: string; accessToken: string },
    imageUrl: string
  ): Promise<string | null> {
    try {
      // Download the image first
      const response = await fetch(imageUrl);
      if (!response.ok) {
        logger.warn(`Failed to fetch image from ${imageUrl}`);
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      // Determine filename from URL
      const urlParts = new URL(imageUrl);
      const filename = urlParts.pathname.split('/').pop() || 'image.jpg';

      // Create staged upload
      const targets = await BulkOperationService.createStagedUploads(shop, [
        {
          filename,
          mimeType: contentType,
          resource: 'IMAGE',
          fileSize: buffer.length,
        },
      ]);

      if (targets.length === 0) {
        logger.warn('No staged upload target returned');
        return null;
      }

      // Upload to staged target
      const resourceUrl = await BulkOperationService.uploadToStagedTarget(targets[0], buffer);
      return resourceUrl;
    } catch (error) {
      logger.error(`Error staging image upload:`, error);
      return null;
    }
  }

  /**
   * Create product with media using staged uploads for better performance
   * Falls back to URL-based images if staging fails
   */
  static async createProductWithStagedMedia(
    retailerShop: { myshopifyDomain: string; accessToken: string },
    productInput: any,
    imageUrls: string[]
  ): Promise<{ productId: string; variantId: string }> {
    const client = createShopifyGraphQLClient(
      retailerShop.myshopifyDomain,
      retailerShop.accessToken
    );

    // First create the product without images
    const createMutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            variants(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createResponse: any = await client.request(createMutation, {
      variables: { input: productInput },
    });

    if (createResponse.data?.productCreate?.userErrors?.length > 0) {
      const errors = createResponse.data.productCreate.userErrors;
      throw new Error(`Product creation failed: ${errors[0].message}`);
    }

    const product = createResponse.data.productCreate.product;
    const productId = product.id;
    const variantId = product.variants.edges[0]?.node?.id || '';

    // If we have images, add them via productCreateMedia for better async handling
    if (imageUrls.length > 0) {
      try {
        // Stage upload images in parallel
        const stagedUrls = await Promise.all(
          imageUrls.slice(0, 10).map((url) => this.stageUploadImage(retailerShop, url))
        );

        const validStagedUrls = stagedUrls.filter((u): u is string => u !== null);

        if (validStagedUrls.length > 0) {
          // Use productCreateMedia with staged uploads
          const mediaMutation = `
            mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media {
                  ... on MediaImage {
                    id
                  }
                }
                mediaUserErrors {
                  field
                  message
                }
              }
            }
          `;

          const mediaInput = validStagedUrls.map((stagedUrl) => ({
            originalSource: stagedUrl,
            mediaContentType: 'IMAGE',
          }));

          await client.request(mediaMutation, {
            variables: { productId, media: mediaInput },
          });

          logger.info(`Added ${validStagedUrls.length} staged images to product ${productId}`);
        } else {
          // Fallback to URL-based images if staging failed
          const fallbackMutation = `
            mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media {
                  ... on MediaImage {
                    id
                  }
                }
                mediaUserErrors {
                  field
                  message
                }
              }
            }
          `;

          const mediaInput = imageUrls.slice(0, 10).map((url) => ({
            originalSource: url,
            mediaContentType: 'IMAGE',
          }));

          await client.request(fallbackMutation, {
            variables: { productId, media: mediaInput },
          });

          logger.info(`Added ${imageUrls.length} URL-based images to product ${productId}`);
        }
      } catch (error) {
        logger.warn(`Failed to add media to product ${productId}:`, error);
        // Product was created, just without images - don't throw
      }
    }

    return {
      productId: productId.split('/').pop()!,
      variantId: variantId.split('/').pop() || '',
    };
  }

  /**
   * Bulk update mapping preferences for existing imports
   */
  static async updateMappingPreferences(
    mappingIds: string[],
    preferences: Partial<ImportPreferences>
  ): Promise<number> {
    try {
      logger.info(`Updating preferences for ${mappingIds.length} mappings`);

      const updateData: any = {};

      if (preferences.syncTitle !== undefined) updateData.syncTitle = preferences.syncTitle;
      if (preferences.syncDescription !== undefined)
        updateData.syncDescription = preferences.syncDescription;
      if (preferences.syncImages !== undefined) updateData.syncImages = preferences.syncImages;
      if (preferences.syncPricing !== undefined) updateData.syncPricing = preferences.syncPricing;
      if (preferences.syncInventory !== undefined)
        updateData.syncInventory = preferences.syncInventory;
      if (preferences.syncTags !== undefined) updateData.syncTags = preferences.syncTags;
      if (preferences.syncSEO !== undefined) updateData.syncSEO = preferences.syncSEO;
      if (preferences.retailerMarkupType !== undefined)
        updateData.retailerMarkupType = preferences.retailerMarkupType;
      if (preferences.retailerMarkupValue !== undefined)
        updateData.retailerMarkupValue = preferences.retailerMarkupValue;
      if (preferences.conflictMode !== undefined)
        updateData.conflictMode = preferences.conflictMode;

      const result = await prisma.productMapping.updateMany({
        where: {
          id: { in: mappingIds },
        },
        data: updateData,
      });

      logger.info(`Updated ${result.count} product mappings`);

      return result.count;
    } catch (error) {
      logger.error(`Error updating mapping preferences:`, error);
      throw error;
    }
  }

  // =============================================================================
  // BULK IMPORT (GraphQL Bulk Operations)
  // =============================================================================

  /**
   * Bulk import products using Shopify's bulkOperationRunMutation
   * Much more efficient for large imports (10-100x faster than individual mutations)
   *
   * Flow:
   * 1. Build JSONL file with product inputs
   * 2. Upload via staged uploads
   * 3. Run bulk mutation
   * 4. Poll for completion
   * 5. Process results and create mappings
   */
  static async bulkImportProducts(
    connectionId: string,
    supplierProductIds: string[],
    preferences: ImportPreferences
  ): Promise<{
    operationId: string;
    productCount: number;
    status: 'STARTED' | 'FAILED';
    error?: string;
  }> {
    try {
      logger.info(
        `Starting bulk import of ${supplierProductIds.length} products for connection ${connectionId}`
      );

      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          supplierShop: true,
          retailerShop: true,
        },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      // Get all supplier products
      const supplierProducts = await prisma.supplierProduct.findMany({
        where: {
          id: { in: supplierProductIds },
          supplierShopId: connection.supplierShopId,
        },
      });

      if (supplierProducts.length === 0) {
        return {
          operationId: '',
          productCount: 0,
          status: 'FAILED',
          error: 'No valid products found',
        };
      }

      // Build JSONL content for bulk mutation
      const jsonlLines: string[] = [];
      const productMap = new Map<number, string>(); // line index -> supplierProductId

      for (let i = 0; i < supplierProducts.length; i++) {
        const product = supplierProducts[i];
        const retailPrice = this.calculateRetailPrice(
          parseFloat(product.wholesalePrice.toString()),
          preferences
        );

        const productInput = this.buildProductInput(product, retailPrice, preferences);
        jsonlLines.push(JSON.stringify({ input: productInput }));
        productMap.set(i, product.id);
      }

      const jsonlContent = jsonlLines.join('\n');

      // Create staged upload for the JSONL file
      const targets = await BulkOperationService.createStagedUploads(connection.retailerShop, [
        {
          filename: `bulk-import-${connectionId}-${Date.now()}.jsonl`,
          mimeType: 'application/jsonl',
          resource: 'BULK_MUTATION_VARIABLES',
          fileSize: Buffer.byteLength(jsonlContent, 'utf8'),
        },
      ]);

      if (targets.length === 0) {
        throw new Error('Failed to create staged upload target');
      }

      // Upload the JSONL file
      const stagedPath = await BulkOperationService.uploadToStagedTarget(targets[0], jsonlContent);

      // Define the mutation for productCreate
      const productCreateMutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              title
              variants(first: 10) {
                edges {
                  node {
                    id
                    sku
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Start bulk mutation
      const { operationId } = await BulkOperationService.startBulkMutation(
        connection.retailerShop,
        productCreateMutation,
        stagedPath
      );

      // Store the operation for tracking
      await prisma.auditLog.create({
        data: {
          shopId: connection.retailerShopId,
          action: 'BULK_IMPORT_STARTED',
          resourceType: 'Connection',
          resourceId: connectionId,
          metadata: {
            operationId,
            productCount: supplierProducts.length,
            supplierProductIds,
            preferences: JSON.parse(JSON.stringify(preferences)), // Ensure JSON serializable
          },
        },
      });

      logger.info(
        `Bulk import operation started: ${operationId} with ${supplierProducts.length} products`
      );

      return {
        operationId,
        productCount: supplierProducts.length,
        status: 'STARTED',
      };
    } catch (error) {
      logger.error('Error starting bulk import:', error);
      return {
        operationId: '',
        productCount: 0,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check bulk import status and process results when complete
   */
  static async checkBulkImportStatus(
    connectionId: string,
    operationId: string
  ): Promise<{
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    progress?: number;
    results?: { created: number; failed: number; mappingsCreated: number };
    error?: string;
  }> {
    try {
      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          supplierShop: true,
          retailerShop: true,
        },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      // Get operation status
      const operation = await BulkOperationService.getOperation(
        connection.retailerShop,
        operationId
      );

      if (!operation) {
        return { status: 'FAILED', error: 'Operation not found' };
      }

      if (operation.status === 'RUNNING' || operation.status === 'CREATED') {
        return {
          status: 'RUNNING',
          progress: operation.objectCount || 0,
        };
      }

      if (operation.status === 'FAILED') {
        return {
          status: 'FAILED',
          error: operation.errorCode || 'Operation failed',
        };
      }

      if (operation.status === 'COMPLETED' && operation.url) {
        // Download and process results
        const results = await this.processBulkImportResults(connection, operationId, operation.url);
        return {
          status: 'COMPLETED',
          results,
        };
      }

      return { status: 'RUNNING' };
    } catch (error) {
      logger.error('Error checking bulk import status:', error);
      return {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process bulk import results and create product mappings
   */
  private static async processBulkImportResults(
    connection: any,
    operationId: string,
    resultsUrl: string
  ): Promise<{ created: number; failed: number; mappingsCreated: number }> {
    // Get the audit log to retrieve the original product IDs
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'BULK_IMPORT_STARTED',
        resourceId: connection.id,
        metadata: {
          path: ['operationId'],
          equals: operationId,
        },
      },
    });

    const metadata = auditLog?.metadata as any;
    const supplierProductIds: string[] = metadata?.supplierProductIds || [];
    const preferences: ImportPreferences = metadata?.preferences || {};

    // Download results
    const results = await BulkOperationService.downloadAllResults(resultsUrl);

    let created = 0;
    let failed = 0;
    let mappingsCreated = 0;

    // Process each result
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const supplierProductId = supplierProductIds[i];

      if (!supplierProductId) continue;

      if (result.data?.productCreate?.product) {
        created++;
        const product = result.data.productCreate.product;
        const productId = product.id.replace('gid://shopify/Product/', '');
        const variantId = product.variants?.edges?.[0]?.node?.id?.replace(
          'gid://shopify/ProductVariant/',
          ''
        );

        // Get supplier product for pricing
        const supplierProduct = await prisma.supplierProduct.findUnique({
          where: { id: supplierProductId },
        });

        if (supplierProduct) {
          // Parse markup value for storage
          const markupValue = preferences.retailerMarkupValue
            ? parseFloat(preferences.retailerMarkupValue)
            : 0;

          // Create product mapping
          await prisma.productMapping.create({
            data: {
              connectionId: connection.id,
              supplierProductId,
              supplierShopifyProductId: supplierProduct.shopifyProductId,
              supplierShopifyVariantId:
                supplierProduct.shopifyVariantId || supplierProduct.shopifyProductId,
              retailerShopifyProductId: productId,
              retailerShopifyVariantId: variantId,
              status: ProductMappingStatus.ACTIVE,
              retailerMarkupType: preferences.retailerMarkupType || 'PERCENTAGE',
              retailerMarkupValue: markupValue,
              syncTitle: preferences.syncTitle !== false,
              syncDescription: preferences.syncDescription !== false,
              syncImages: preferences.syncImages !== false,
              syncPricing: preferences.syncPricing !== false,
              syncInventory: preferences.syncInventory !== false,
              syncTags: preferences.syncTags !== false,
              syncSEO: preferences.syncSEO !== false,
              conflictMode: preferences.conflictMode || 'SUPPLIER_WINS',
            },
          });
          mappingsCreated++;
        }
      } else {
        failed++;
        const errors = result.data?.productCreate?.userErrors || [];
        logger.warn(`Bulk import product failed: ${errors[0]?.message || 'Unknown error'}`);
      }
    }

    // Update audit log with results
    await prisma.auditLog.create({
      data: {
        shopId: connection.retailerShopId,
        action: 'BULK_IMPORT_COMPLETED',
        resourceType: 'Connection',
        resourceId: connection.id,
        metadata: {
          operationId,
          created,
          failed,
          mappingsCreated,
        },
      },
    });

    logger.info(
      `Bulk import completed: ${created} created, ${failed} failed, ${mappingsCreated} mappings`
    );

    return { created, failed, mappingsCreated };
  }

  /**
   * Build product input for Shopify productCreate mutation
   */
  private static buildProductInput(
    supplierProduct: any,
    retailPrice: number,
    preferences: ImportPreferences
  ): any {
    const input: any = {
      title: preferences.syncTitle !== false ? supplierProduct.title : 'Wholesale Product',
      productType: 'Wholesale',
      vendor: 'Wholesale Supplier',
      tags: ['wholesale', 'bulk-import'],
    };

    if (preferences.syncDescription !== false && supplierProduct.description) {
      input.descriptionHtml = supplierProduct.description;
    }

    // Add variant with pricing
    input.variants = [
      {
        price: preferences.syncPricing !== false ? retailPrice.toFixed(2) : '0.00',
        sku: supplierProduct.sku || undefined,
        inventoryQuantities:
          preferences.syncInventory !== false
            ? [
                {
                  availableQuantity: supplierProduct.inventoryQuantity || 0,
                  locationId: 'gid://shopify/Location/1', // Will be updated based on shop's default location
                },
              ]
            : undefined,
      },
    ];

    return input;
  }

  /**
   * Calculate retail price from wholesale price with markup
   */
  private static calculateRetailPrice(
    wholesalePrice: number,
    preferences: ImportPreferences
  ): number {
    if (!preferences.retailerMarkupType || !preferences.retailerMarkupValue) {
      return wholesalePrice;
    }

    const markupValue = parseFloat(preferences.retailerMarkupValue);

    switch (preferences.retailerMarkupType) {
      case 'PERCENTAGE':
        return wholesalePrice * (1 + markupValue / 100);
      case 'FIXED_AMOUNT':
        return wholesalePrice + markupValue;
      case 'CUSTOM':
        return markupValue; // Custom is the actual retail price
      default:
        return wholesalePrice;
    }
  }
}
