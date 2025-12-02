/**
 * MapperService - Product/variant mapping with conflict detection and drift handling
 *
 * Per PRD_MAPPER_CONFLICTS:
 * - Bulk and individual mapping with validation
 * - Conflict detection: duplicate SKUs, missing variants, variant mismatch
 * - SKU drift detection post-mapping
 * - Hidden tag handling (zero inventory or unsync)
 * - States: active, replaced, unsupported, unsynced, discontinued
 * - Unsync/disconnect flows
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { ProductMappingStatus } from '@prisma/client';
import { ConnectionHealthService } from './ConnectionHealthService';

// Hidden tag action values (stored as string in DB)
type HiddenTagAction = 'ZERO_INVENTORY' | 'UNSYNC' | 'PENDING';

// Conflict types for mapping validation
export enum ConflictType {
  DUPLICATE_SKU = 'DUPLICATE_SKU', // Same SKU used multiple times in source
  MISSING_SKU = 'MISSING_SKU', // Variant has no SKU
  VARIANT_COUNT_MISMATCH = 'VARIANT_COUNT_MISMATCH', // Different number of variants
  UNSUPPORTED_PRODUCT_TYPE = 'UNSUPPORTED_PRODUCT_TYPE', // Gift cards, bundles, etc.
  SKU_DRIFT = 'SKU_DRIFT', // SKU changed after mapping
  HIDDEN_TAG = 'HIDDEN_TAG', // Source product has hidden tag
  NO_IMAGES = 'NO_IMAGES', // Product has no images
  NOT_TRACKING_INVENTORY = 'NOT_TRACKING_INVENTORY', // Inventory tracking disabled
}

export interface MappingConflict {
  type: ConflictType;
  message: string;
  severity: 'error' | 'warning';
  supplierProductId?: string;
  sku?: string;
  details?: Record<string, any>;
}

export interface MappingValidationResult {
  valid: boolean;
  conflicts: MappingConflict[];
  warnings: MappingConflict[];
}

export interface BulkMappingResult {
  total: number;
  mapped: number;
  skipped: number;
  failed: number;
  conflicts: MappingConflict[];
}

// Unsupported product types that can't be synced
const UNSUPPORTED_PRODUCT_TYPES = ['gift_card', 'bundle'];

// Hidden tag variations to detect
const HIDDEN_TAGS = ['hidden', 'hide', 'wholesale-hidden', 'cartrel-hidden', 'not-for-resale'];

class MapperServiceClass {
  /**
   * Validate a product for mapping
   * Checks preconditions before allowing mapping
   */
  async validateProduct(
    supplierProductId: string,
    _connectionId: string
  ): Promise<MappingValidationResult> {
    const conflicts: MappingConflict[] = [];
    const warnings: MappingConflict[] = [];

    try {
      // Get supplier product with all variants
      const supplierProduct = await prisma.supplierProduct.findUnique({
        where: { id: supplierProductId },
        include: {
          supplierShop: true,
        },
      });

      if (!supplierProduct) {
        conflicts.push({
          type: ConflictType.MISSING_SKU,
          message: 'Supplier product not found',
          severity: 'error',
          supplierProductId,
        });
        return { valid: false, conflicts, warnings };
      }

      // Get all variants for this product
      const variants = await prisma.supplierProduct.findMany({
        where: {
          supplierShopId: supplierProduct.supplierShopId,
          shopifyProductId: supplierProduct.shopifyProductId,
        },
      });

      // Check for unsupported product type
      if (
        supplierProduct.productType &&
        UNSUPPORTED_PRODUCT_TYPES.includes(supplierProduct.productType.toLowerCase())
      ) {
        conflicts.push({
          type: ConflictType.UNSUPPORTED_PRODUCT_TYPE,
          message: `Product type "${supplierProduct.productType}" is not supported for sync`,
          severity: 'error',
          supplierProductId,
        });
      }

      // Check for missing SKUs
      const variantsWithoutSku = variants.filter((v) => !v.sku || v.sku.trim() === '');
      if (variantsWithoutSku.length > 0) {
        conflicts.push({
          type: ConflictType.MISSING_SKU,
          message: `${variantsWithoutSku.length} variant(s) missing SKU`,
          severity: 'error',
          supplierProductId,
          details: { variantIds: variantsWithoutSku.map((v) => v.shopifyVariantId) },
        });
      }

      // Check for duplicate SKUs
      const skus = variants.map((v) => v.sku).filter((s) => s && s.trim() !== '');
      const duplicateSkus = skus.filter((sku, index) => skus.indexOf(sku) !== index);
      if (duplicateSkus.length > 0) {
        conflicts.push({
          type: ConflictType.DUPLICATE_SKU,
          message: `Duplicate SKUs found: ${[...new Set(duplicateSkus)].join(', ')}`,
          severity: 'error',
          supplierProductId,
          details: { duplicates: [...new Set(duplicateSkus)] },
        });
      }

      // Check for no images
      if (!supplierProduct.imageUrl) {
        warnings.push({
          type: ConflictType.NO_IMAGES,
          message: 'Product has no images',
          severity: 'warning',
          supplierProductId,
        });
      }

      // Check for hidden tag
      const productTags = await this.getProductTags(supplierProduct.supplierShopId, supplierProduct.shopifyProductId);
      const hasHiddenTag = productTags.some((tag) =>
        HIDDEN_TAGS.includes(tag.toLowerCase())
      );

      if (hasHiddenTag) {
        conflicts.push({
          type: ConflictType.HIDDEN_TAG,
          message: 'Product has a hidden tag and should not be synced',
          severity: 'error',
          supplierProductId,
          details: { tags: productTags },
        });
      }

      return {
        valid: conflicts.length === 0,
        conflicts,
        warnings,
      };
    } catch (error) {
      logger.error('Error validating product for mapping:', error);
      throw error;
    }
  }

  /**
   * Create a product mapping with validation
   */
  async createMapping(
    connectionId: string,
    supplierProductId: string,
    retailerShopifyProductId?: string,
    retailerShopifyVariantId?: string,
    options?: {
      syncTitle?: boolean;
      syncDescription?: boolean;
      syncImages?: boolean;
      syncPricing?: boolean;
      syncInventory?: boolean;
      syncTags?: boolean;
      syncSEO?: boolean;
      conflictMode?: 'SUPPLIER_WINS' | 'RETAILER_WINS' | 'REVIEW_QUEUE';
    }
  ): Promise<{ mapping: any; validation: MappingValidationResult }> {
    // Validate first
    const validation = await this.validateProduct(supplierProductId, connectionId);

    if (!validation.valid) {
      logger.warn(`Product ${supplierProductId} failed validation`, validation.conflicts);
      // Still allow creation but mark as appropriate status
    }

    // Get supplier product
    const supplierProduct = await prisma.supplierProduct.findUnique({
      where: { id: supplierProductId },
    });

    if (!supplierProduct) {
      throw new Error(`Supplier product ${supplierProductId} not found`);
    }

    // Determine initial status based on conflicts
    let status: ProductMappingStatus = 'ACTIVE';
    let hiddenTagAction: HiddenTagAction | null = null;

    const hasUnsupportedType = validation.conflicts.some(
      (c) => c.type === ConflictType.UNSUPPORTED_PRODUCT_TYPE
    );
    const hasHiddenTag = validation.conflicts.some((c) => c.type === ConflictType.HIDDEN_TAG);

    if (hasUnsupportedType) {
      status = 'UNSUPPORTED';
    } else if (hasHiddenTag) {
      hiddenTagAction = 'PENDING';
    }

    // Create the mapping
    const mapping = await prisma.productMapping.create({
      data: {
        connectionId,
        supplierProductId,
        // Required fields from supplier product
        supplierShopifyProductId: supplierProduct.shopifyProductId,
        supplierShopifyVariantId: supplierProduct.shopifyVariantId,
        retailerShopifyProductId,
        retailerShopifyVariantId,
        // Required markup value (default 0%)
        retailerMarkupValue: 0,
        status,
        syncTitle: options?.syncTitle ?? true,
        syncDescription: options?.syncDescription ?? true,
        syncImages: options?.syncImages ?? true,
        syncPricing: options?.syncPricing ?? true,
        syncInventory: options?.syncInventory ?? true,
        syncTags: options?.syncTags ?? false,
        syncSEO: options?.syncSEO ?? false,
        conflictMode: options?.conflictMode ?? 'SUPPLIER_WINS',
        // Store original SKU for drift detection
        originalSupplierSku: supplierProduct.sku,
        skuDriftDetected: false,
        sourceHiddenTag: hasHiddenTag,
        hiddenTagAction,
      },
    });

    logger.info(`Created mapping ${mapping.id} for product ${supplierProductId}`);
    return { mapping, validation };
  }

  /**
   * Bulk validate products for mapping
   */
  async bulkValidate(
    connectionId: string,
    supplierProductIds: string[]
  ): Promise<Map<string, MappingValidationResult>> {
    const results = new Map<string, MappingValidationResult>();

    for (const productId of supplierProductIds) {
      try {
        const validation = await this.validateProduct(productId, connectionId);
        results.set(productId, validation);
      } catch (error) {
        logger.error(`Error validating product ${productId}:`, error);
        results.set(productId, {
          valid: false,
          conflicts: [
            {
              type: ConflictType.MISSING_SKU,
              message: 'Validation error',
              severity: 'error',
              supplierProductId: productId,
            },
          ],
          warnings: [],
        });
      }
    }

    return results;
  }

  /**
   * Bulk create mappings
   */
  async bulkCreateMappings(
    connectionId: string,
    supplierProductIds: string[],
    options?: {
      skipInvalid?: boolean;
      defaultOptions?: {
        syncTitle?: boolean;
        syncDescription?: boolean;
        syncImages?: boolean;
        syncPricing?: boolean;
        syncInventory?: boolean;
      };
    }
  ): Promise<BulkMappingResult> {
    const result: BulkMappingResult = {
      total: supplierProductIds.length,
      mapped: 0,
      skipped: 0,
      failed: 0,
      conflicts: [],
    };

    // First validate all
    const validations = await this.bulkValidate(connectionId, supplierProductIds);

    for (const productId of supplierProductIds) {
      const validation = validations.get(productId);

      if (!validation) {
        result.failed++;
        continue;
      }

      if (!validation.valid && options?.skipInvalid) {
        result.skipped++;
        result.conflicts.push(...validation.conflicts);
        continue;
      }

      try {
        await this.createMapping(
          connectionId,
          productId,
          undefined,
          undefined,
          options?.defaultOptions
        );
        result.mapped++;
      } catch (error) {
        logger.error(`Error creating mapping for ${productId}:`, error);
        result.failed++;
      }
    }

    return result;
  }

  /**
   * Detect SKU drift for existing mappings
   * Returns mappings where the supplier SKU has changed since creation
   */
  async detectSkuDrift(connectionId: string): Promise<Array<{
    mappingId: string;
    originalSku: string;
    currentSku: string;
    supplierProductId: string;
  }>> {
    const drifted: Array<{
      mappingId: string;
      originalSku: string;
      currentSku: string;
      supplierProductId: string;
    }> = [];

    // Get all active mappings for this connection
    const mappings = await prisma.productMapping.findMany({
      where: {
        connectionId,
        status: 'ACTIVE',
      },
      include: {
        supplierProduct: true,
      },
    });

    for (const mapping of mappings) {
      if (!mapping.originalSupplierSku || !mapping.supplierProduct) {
        continue;
      }

      const currentSku = mapping.supplierProduct.sku;
      if (currentSku !== mapping.originalSupplierSku) {
        drifted.push({
          mappingId: mapping.id,
          originalSku: mapping.originalSupplierSku,
          currentSku: currentSku || '',
          supplierProductId: mapping.supplierProductId,
        });

        // Update mapping to flag drift
        await prisma.productMapping.update({
          where: { id: mapping.id },
          data: { skuDriftDetected: true },
        });

        // Log to connection activity
        await ConnectionHealthService.recordMappingError(
          connectionId,
          mapping.id,
          'SKU_DRIFT',
          `SKU changed from "${mapping.originalSupplierSku}" to "${currentSku}"`
        );
      }
    }

    logger.info(`Detected ${drifted.length} SKU drifts for connection ${connectionId}`);
    return drifted;
  }

  /**
   * Handle hidden tag detection on synced products
   */
  async handleHiddenTag(
    mappingId: string,
    action: HiddenTagAction
  ): Promise<void> {
    const mapping = await prisma.productMapping.findUnique({
      where: { id: mappingId },
      include: { connection: true },
    });

    if (!mapping) {
      throw new Error(`Mapping ${mappingId} not found`);
    }

    switch (action) {
      case 'ZERO_INVENTORY':
        // Zero out inventory at retailer
        await this.zeroRetailerInventory(mapping);
        await prisma.productMapping.update({
          where: { id: mappingId },
          data: {
            hiddenTagAction: 'ZERO_INVENTORY',
            status: 'PAUSED',
          },
        });
        logger.info(`Zeroed inventory for mapping ${mappingId} due to hidden tag`);
        break;

      case 'UNSYNC':
        // Unsync the product
        await this.unsyncMapping(mappingId, { keepRetailerProduct: true });
        await prisma.productMapping.update({
          where: { id: mappingId },
          data: {
            hiddenTagAction: 'UNSYNC',
            status: 'UNSYNCED',
          },
        });
        logger.info(`Unsynced mapping ${mappingId} due to hidden tag`);
        break;

      case 'PENDING':
        // Just mark as pending, waiting for user decision
        await prisma.productMapping.update({
          where: { id: mappingId },
          data: { hiddenTagAction: 'PENDING' },
        });
        break;
    }
  }

  /**
   * Zero out inventory for a retailer product
   */
  private async zeroRetailerInventory(mapping: any): Promise<void> {
    // TODO: Implement inventory zeroing via Shopify API
    logger.info(`Would zero inventory for retailer product ${mapping.retailerShopifyProductId}`);
  }

  /**
   * Unsync a mapping - disconnect without deleting
   */
  async unsyncMapping(
    mappingId: string,
    options?: {
      keepRetailerProduct?: boolean;
      zeroInventory?: boolean;
    }
  ): Promise<void> {
    const mapping = await prisma.productMapping.findUnique({
      where: { id: mappingId },
      include: {
        connection: { include: { retailerShop: true } },
      },
    });

    if (!mapping) {
      throw new Error(`Mapping ${mappingId} not found`);
    }

    // Optionally zero inventory first
    if (options?.zeroInventory) {
      await this.zeroRetailerInventory(mapping);
    }

    // Update mapping status
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        status: 'UNSYNCED',
        syncInventory: false, // Stop inventory sync
        lastSyncAt: new Date(),
      },
    });

    // If not keeping retailer product, we'd delete it here
    if (!options?.keepRetailerProduct && mapping.retailerShopifyProductId) {
      // TODO: Delete product from retailer's Shopify
      logger.info(`Would delete retailer product ${mapping.retailerShopifyProductId}`);
    }

    logger.info(`Unsynced mapping ${mappingId}`);
  }

  /**
   * Disconnect a mapping completely
   */
  async disconnectMapping(
    mappingId: string,
    options?: {
      deleteRetailerProduct?: boolean;
    }
  ): Promise<void> {
    const mapping = await prisma.productMapping.findUnique({
      where: { id: mappingId },
      include: {
        connection: { include: { retailerShop: true } },
      },
    });

    if (!mapping) {
      throw new Error(`Mapping ${mappingId} not found`);
    }

    // Delete retailer product if requested
    if (options?.deleteRetailerProduct && mapping.retailerShopifyProductId) {
      // TODO: Delete product from retailer's Shopify via API
      logger.info(`Would delete retailer product ${mapping.retailerShopifyProductId}`);
    }

    // Delete the mapping
    await prisma.productMapping.delete({
      where: { id: mappingId },
    });

    logger.info(`Disconnected and deleted mapping ${mappingId}`);
  }

  /**
   * Resync a mapping - re-pull all content from supplier
   */
  async resyncMapping(mappingId: string): Promise<void> {
    const mapping = await prisma.productMapping.findUnique({
      where: { id: mappingId },
      include: {
        supplierProduct: true,
        connection: true,
      },
    });

    if (!mapping) {
      throw new Error(`Mapping ${mappingId} not found`);
    }

    // Re-validate (to update any status based on current state)
    await this.validateProduct(
      mapping.supplierProductId,
      mapping.connectionId
    );

    // Update SKU drift status
    if (mapping.supplierProduct && mapping.originalSupplierSku) {
      const skuDrifted = mapping.supplierProduct.sku !== mapping.originalSupplierSku;
      if (skuDrifted !== mapping.skuDriftDetected) {
        await prisma.productMapping.update({
          where: { id: mappingId },
          data: { skuDriftDetected: skuDrifted },
        });
      }
    }

    // Clear sync hash to force full resync
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        lastSyncHash: null,
        lastSyncAt: new Date(),
        // Clear errors if resyncing
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
      },
    });

    logger.info(`Marked mapping ${mappingId} for resync`);
  }

  /**
   * Get mapping status summary for a connection
   */
  async getMappingSummary(connectionId: string): Promise<{
    total: number;
    active: number;
    paused: number;
    unsynced: number;
    unsupported: number;
    discontinued: number;
    withErrors: number;
    withSkuDrift: number;
    withHiddenTag: number;
  }> {
    const [
      total,
      active,
      paused,
      unsynced,
      unsupported,
      discontinued,
      withErrors,
      withSkuDrift,
      withHiddenTag,
    ] = await Promise.all([
      prisma.productMapping.count({ where: { connectionId } }),
      prisma.productMapping.count({ where: { connectionId, status: 'ACTIVE' } }),
      prisma.productMapping.count({ where: { connectionId, status: 'PAUSED' } }),
      prisma.productMapping.count({ where: { connectionId, status: 'UNSYNCED' } }),
      prisma.productMapping.count({ where: { connectionId, status: 'UNSUPPORTED' } }),
      prisma.productMapping.count({ where: { connectionId, status: 'DISCONTINUED' } }),
      prisma.productMapping.count({
        where: { connectionId, lastError: { not: null } },
      }),
      prisma.productMapping.count({
        where: { connectionId, skuDriftDetected: true },
      }),
      prisma.productMapping.count({
        where: { connectionId, sourceHiddenTag: true },
      }),
    ]);

    return {
      total,
      active,
      paused,
      unsynced,
      unsupported,
      discontinued,
      withErrors,
      withSkuDrift,
      withHiddenTag,
    };
  }

  /**
   * Get mappings with conflicts/issues for a connection
   */
  async getMappingsWithIssues(
    connectionId: string,
    filter?: {
      hasSkuDrift?: boolean;
      hasHiddenTag?: boolean;
      hasError?: boolean;
      status?: ProductMappingStatus;
    }
  ): Promise<any[]> {
    const where: any = { connectionId };

    if (filter?.hasSkuDrift) {
      where.skuDriftDetected = true;
    }
    if (filter?.hasHiddenTag) {
      where.sourceHiddenTag = true;
    }
    if (filter?.hasError) {
      where.lastError = { not: null };
    }
    if (filter?.status) {
      where.status = filter.status;
    }

    return prisma.productMapping.findMany({
      where,
      include: {
        supplierProduct: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Get product tags from cache or mark for fetch
   * For now returns empty array - in production would fetch from Shopify
   */
  private async getProductTags(_shopId: string, _productId: string): Promise<string[]> {
    // TODO: Fetch tags from Shopify or cache
    // For now, return empty - tags would be stored in SupplierProduct or fetched on demand
    return [];
  }
}

export const MapperService = new MapperServiceClass();
