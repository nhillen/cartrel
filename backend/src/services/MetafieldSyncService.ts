/**
 * MetafieldSyncService - Metafield definition and value synchronization
 *
 * Per PRD_METAFIELDS_SYNC:
 * - Definition sync: pick definitions to sync (product/variant)
 * - Supported types: single line text, number, date, measurement, color, URL, money, rich text
 * - Unsupported: references, file, JSON, mixed references, lists
 * - Value sync triggers: import, update, order, resync, 24h batch
 * - Caps per tier (10 free -> unlimited scale)
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { ConnectionHealthService } from './ConnectionHealthService';
import { RateLimitService } from './RateLimitService';

// Supported metafield types (per PRD)
export const SUPPORTED_METAFIELD_TYPES = [
  'single_line_text_field',
  'multi_line_text_field',
  'number_integer',
  'number_decimal',
  'date',
  'date_time',
  'dimension', // weight, volume, etc.
  'weight',
  'volume',
  'color',
  'url',
  'money',
  'rich_text_field',
  'boolean',
  'rating',
] as const;

// Unsupported types
export const UNSUPPORTED_METAFIELD_TYPES = [
  'product_reference',
  'variant_reference',
  'collection_reference',
  'page_reference',
  'metaobject_reference',
  'file_reference',
  'json',
  'mixed_reference',
  'list.single_line_text_field',
  'list.number_integer',
  'list.product_reference',
  // All list types are unsupported initially
] as const;

// Tier caps for metafield definitions
export const METAFIELD_TIER_CAPS: Record<string, number> = {
  FREE: 10,
  STARTER: 25,
  CORE: 50,
  PRO: 200,
  GROWTH: 500,
  SCALE: 999999, // Effectively unlimited
  MARKETPLACE: 999999,
};

export type MetafieldOwnerType = 'PRODUCT' | 'VARIANT';

export interface MetafieldDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  description?: string;
  type: {
    name: string;
  };
  ownerType: MetafieldOwnerType;
  validations?: any[];
}

export interface MetafieldValue {
  id: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
  ownerId: string; // Product or variant GID
}

export interface SyncDefinitionResult {
  success: boolean;
  configId?: string;
  destDefinitionId?: string;
  error?: string;
}

export interface SyncValueResult {
  success: boolean;
  metafieldId?: string;
  error?: string;
}

class MetafieldSyncServiceClass {
  /**
   * Check if a metafield type is supported for sync
   */
  isTypeSupported(type: string): boolean {
    // Check if it starts with 'list.' - lists not supported
    if (type.startsWith('list.')) {
      return false;
    }
    // Check if it's a reference type
    if (type.endsWith('_reference')) {
      return false;
    }
    // Check against supported list
    return SUPPORTED_METAFIELD_TYPES.includes(type as any);
  }

  /**
   * Get the metafield definition cap for a tier
   */
  getDefinitionCap(tier: string): number {
    return METAFIELD_TIER_CAPS[tier.toUpperCase()] || METAFIELD_TIER_CAPS.FREE;
  }

  /**
   * Check if connection has reached metafield definition cap
   */
  async hasReachedCap(
    connectionId: string
  ): Promise<{ reached: boolean; current: number; cap: number }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { supplierShop: true },
    });

    if (!connection) {
      return { reached: true, current: 0, cap: 0 };
    }

    const tier = connection.supplierShop.plan || 'FREE';
    const cap = this.getDefinitionCap(tier);

    const current = await prisma.metafieldConfig.count({
      where: {
        connectionId,
        syncEnabled: true,
      },
    });

    return {
      reached: current >= cap,
      current,
      cap,
    };
  }

  /**
   * Discover metafield definitions from source shop
   */
  async discoverDefinitions(
    connectionId: string,
    ownerType: MetafieldOwnerType = 'PRODUCT'
  ): Promise<MetafieldDefinition[]> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { supplierShop: true },
    });

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const client = createShopifyGraphQLClient(
      connection.supplierShop.myshopifyDomain,
      connection.supplierShop.accessToken
    );

    const query = `
      query getMetafieldDefinitions($ownerType: MetafieldOwnerType!) {
        metafieldDefinitions(first: 250, ownerType: $ownerType) {
          edges {
            node {
              id
              namespace
              key
              name
              description
              type {
                name
              }
              validations {
                name
                value
              }
            }
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query, {
        variables: { ownerType },
      });

      const definitions =
        response.metafieldDefinitions?.edges?.map((edge: any) => ({
          ...edge.node,
          ownerType,
        })) || [];

      // Store discovered definitions in our config table
      for (const def of definitions) {
        await prisma.metafieldConfig.upsert({
          where: {
            connectionId_namespace_key_ownerType: {
              connectionId,
              namespace: def.namespace,
              key: def.key,
              ownerType: def.ownerType,
            },
          },
          create: {
            connectionId,
            namespace: def.namespace,
            key: def.key,
            ownerType: def.ownerType,
            type: def.type.name,
            isSupported: this.isTypeSupported(def.type.name),
            sourceDefinitionId: def.id,
            syncEnabled: false,
          },
          update: {
            type: def.type.name,
            isSupported: this.isTypeSupported(def.type.name),
            sourceDefinitionId: def.id,
          },
        });
      }

      return definitions;
    } catch (error) {
      logger.error('Error discovering metafield definitions:', error);
      throw error;
    }
  }

  /**
   * Get all metafield configs for a connection
   */
  async getConfigs(
    connectionId: string,
    filters?: {
      ownerType?: MetafieldOwnerType;
      syncEnabled?: boolean;
      isSupported?: boolean;
    }
  ): Promise<any[]> {
    const where: any = { connectionId };

    if (filters?.ownerType) {
      where.ownerType = filters.ownerType;
    }
    if (filters?.syncEnabled !== undefined) {
      where.syncEnabled = filters.syncEnabled;
    }
    if (filters?.isSupported !== undefined) {
      where.isSupported = filters.isSupported;
    }

    return prisma.metafieldConfig.findMany({
      where,
      orderBy: [{ ownerType: 'asc' }, { namespace: 'asc' }, { key: 'asc' }],
    });
  }

  /**
   * Enable sync for a metafield definition
   */
  async enableSync(configId: string): Promise<SyncDefinitionResult> {
    const config = await prisma.metafieldConfig.findUnique({
      where: { id: configId },
      include: {
        connection: {
          include: {
            supplierShop: true,
            retailerShop: true,
          },
        },
      },
    });

    if (!config) {
      return { success: false, error: 'Config not found' };
    }

    if (!config.isSupported) {
      return { success: false, error: `Type ${config.type} is not supported for sync` };
    }

    // Check cap
    const capCheck = await this.hasReachedCap(config.connectionId);
    if (capCheck.reached && !config.syncEnabled) {
      return {
        success: false,
        error: `Metafield definition cap reached (${capCheck.current}/${capCheck.cap}). Upgrade to add more.`,
      };
    }

    // Create or link definition on destination
    const destDefinitionId = await this.createOrLinkDefinition(config);

    if (!destDefinitionId) {
      return { success: false, error: 'Failed to create/link definition on destination' };
    }

    // Update config
    await prisma.metafieldConfig.update({
      where: { id: configId },
      data: {
        syncEnabled: true,
        destDefinitionId,
      },
    });

    logger.info(
      `Enabled metafield sync for ${config.namespace}.${config.key} on connection ${config.connectionId}`
    );

    return {
      success: true,
      configId,
      destDefinitionId,
    };
  }

  /**
   * Disable sync for a metafield definition
   */
  async disableSync(
    configId: string,
    options?: { deleteDefinition?: boolean; deleteValues?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const config = await prisma.metafieldConfig.findUnique({
      where: { id: configId },
      include: {
        connection: {
          include: { retailerShop: true },
        },
      },
    });

    if (!config) {
      return { success: false, error: 'Config not found' };
    }

    // Optionally delete the definition on destination
    if (options?.deleteDefinition && config.destDefinitionId) {
      try {
        await this.deleteDefinitionOnDestination(config);
      } catch (error) {
        logger.warn('Failed to delete definition on destination:', error);
      }
    }

    // Optionally delete values on destination (expensive operation)
    if (options?.deleteValues) {
      try {
        await this.deleteValuesOnDestination(config);
      } catch (error) {
        logger.warn('Failed to delete values on destination:', error);
      }
    }

    // Update config
    await prisma.metafieldConfig.update({
      where: { id: configId },
      data: {
        syncEnabled: false,
        destDefinitionId: options?.deleteDefinition ? null : config.destDefinitionId,
      },
    });

    logger.info(`Disabled metafield sync for ${config.namespace}.${config.key}`);

    return { success: true };
  }

  /**
   * Create or link a metafield definition on the destination shop
   */
  private async createOrLinkDefinition(config: any): Promise<string | null> {
    const retailerShop = config.connection.retailerShop;

    const client = createShopifyGraphQLClient(
      retailerShop.myshopifyDomain,
      retailerShop.accessToken
    );

    // First, check if definition already exists on destination
    const existingDef = await this.findExistingDefinition(
      client,
      config.namespace,
      config.key,
      config.ownerType
    );

    if (existingDef) {
      logger.info(
        `Found existing definition ${existingDef} on destination for ${config.namespace}.${config.key}`
      );
      return existingDef;
    }

    // Create new definition
    const mutation = `
      mutation createMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response: any = await client.request(mutation, {
        variables: {
          definition: {
            namespace: config.namespace,
            key: config.key,
            name: `${config.namespace}.${config.key}`,
            type: config.type,
            ownerType: config.ownerType,
          },
        },
      });

      if (response.metafieldDefinitionCreate?.userErrors?.length > 0) {
        const errors = response.metafieldDefinitionCreate.userErrors;
        logger.error('Error creating metafield definition:', errors);
        return null;
      }

      return response.metafieldDefinitionCreate?.createdDefinition?.id || null;
    } catch (error) {
      logger.error('Error creating metafield definition:', error);
      return null;
    }
  }

  /**
   * Find existing definition on destination
   */
  private async findExistingDefinition(
    client: any,
    namespace: string,
    key: string,
    ownerType: string
  ): Promise<string | null> {
    const query = `
      query findDefinition($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
        metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
          edges {
            node {
              id
            }
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query, {
        variables: { ownerType, namespace, key },
      });

      return response.metafieldDefinitions?.edges?.[0]?.node?.id || null;
    } catch (error) {
      logger.error('Error finding existing definition:', error);
      return null;
    }
  }

  /**
   * Delete definition on destination
   */
  private async deleteDefinitionOnDestination(config: any): Promise<void> {
    if (!config.destDefinitionId) return;

    const client = createShopifyGraphQLClient(
      config.connection.retailerShop.myshopifyDomain,
      config.connection.retailerShop.accessToken
    );

    const mutation = `
      mutation deleteDefinition($id: ID!, $deleteAllAssociatedMetafields: Boolean!) {
        metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) {
          deletedDefinitionId
          userErrors {
            field
            message
          }
        }
      }
    `;

    await client.request(mutation, {
      variables: {
        id: config.destDefinitionId,
        deleteAllAssociatedMetafields: true,
      },
    });
  }

  /**
   * Delete metafield values on destination (for unsync + delete values)
   */
  private async deleteValuesOnDestination(config: any): Promise<void> {
    // This would require fetching all products with this metafield and deleting
    // Expensive operation - log warning and skip for now
    logger.warn(
      `Bulk value deletion not yet implemented for ${config.namespace}.${config.key}. ` +
        `Consider deleting the definition to cascade delete values.`
    );
  }

  /**
   * Sync metafield values for a specific product
   */
  async syncProductMetafields(
    connectionId: string,
    sourceProductId: string,
    destProductId: string
  ): Promise<{ synced: number; errors: string[] }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      return { synced: 0, errors: ['Connection not found'] };
    }

    // Get enabled configs for this connection
    const configs = await prisma.metafieldConfig.findMany({
      where: {
        connectionId,
        syncEnabled: true,
        ownerType: 'PRODUCT',
      },
    });

    if (configs.length === 0) {
      return { synced: 0, errors: [] };
    }

    // Fetch metafield values from source
    const sourceValues = await this.fetchProductMetafields(
      connection.supplierShop,
      sourceProductId,
      configs
    );

    if (sourceValues.length === 0) {
      return { synced: 0, errors: [] };
    }

    // Check rate limits
    const delay = await RateLimitService.getRequiredDelay(connection.retailerShop.myshopifyDomain);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Write values to destination
    const results = await this.writeProductMetafields(
      connection.retailerShop,
      destProductId,
      sourceValues
    );

    // Update last sync timestamp
    await prisma.metafieldConfig.updateMany({
      where: {
        connectionId,
        syncEnabled: true,
        ownerType: 'PRODUCT',
      },
      data: {
        lastSyncAt: new Date(),
      },
    });

    return results;
  }

  /**
   * Sync metafield values for a specific variant
   */
  async syncVariantMetafields(
    connectionId: string,
    sourceVariantId: string,
    destVariantId: string
  ): Promise<{ synced: number; errors: string[] }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      return { synced: 0, errors: ['Connection not found'] };
    }

    // Get enabled configs for this connection
    const configs = await prisma.metafieldConfig.findMany({
      where: {
        connectionId,
        syncEnabled: true,
        ownerType: 'VARIANT',
      },
    });

    if (configs.length === 0) {
      return { synced: 0, errors: [] };
    }

    // Fetch metafield values from source
    const sourceValues = await this.fetchVariantMetafields(
      connection.supplierShop,
      sourceVariantId,
      configs
    );

    if (sourceValues.length === 0) {
      return { synced: 0, errors: [] };
    }

    // Write values to destination
    const results = await this.writeVariantMetafields(
      connection.retailerShop,
      destVariantId,
      sourceValues
    );

    return results;
  }

  /**
   * Fetch metafield values for a product
   */
  private async fetchProductMetafields(
    shop: any,
    productId: string,
    configs: any[]
  ): Promise<MetafieldValue[]> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    // Build metafield identifiers
    const identifiers = configs.map((c) => ({
      namespace: c.namespace,
      key: c.key,
    }));

    const query = `
      query getProductMetafields($id: ID!, $identifiers: [HasMetafieldsIdentifier!]!) {
        product(id: $id) {
          metafields(identifiers: $identifiers) {
            id
            namespace
            key
            value
            type
          }
        }
      }
    `;

    try {
      // Ensure product ID is in GID format
      const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;

      const response: any = await client.request(query, {
        variables: { id: gid, identifiers },
      });

      return (response.product?.metafields || []).filter((m: any) => m !== null);
    } catch (error) {
      logger.error('Error fetching product metafields:', error);
      return [];
    }
  }

  /**
   * Fetch metafield values for a variant
   */
  private async fetchVariantMetafields(
    shop: any,
    variantId: string,
    configs: any[]
  ): Promise<MetafieldValue[]> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const identifiers = configs.map((c) => ({
      namespace: c.namespace,
      key: c.key,
    }));

    const query = `
      query getVariantMetafields($id: ID!, $identifiers: [HasMetafieldsIdentifier!]!) {
        productVariant(id: $id) {
          metafields(identifiers: $identifiers) {
            id
            namespace
            key
            value
            type
          }
        }
      }
    `;

    try {
      const gid = variantId.startsWith('gid://')
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`;

      const response: any = await client.request(query, {
        variables: { id: gid, identifiers },
      });

      return (response.productVariant?.metafields || []).filter((m: any) => m !== null);
    } catch (error) {
      logger.error('Error fetching variant metafields:', error);
      return [];
    }
  }

  /**
   * Write metafield values to a product
   */
  private async writeProductMetafields(
    shop: any,
    productId: string,
    values: MetafieldValue[]
  ): Promise<{ synced: number; errors: string[] }> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);
    const errors: string[] = [];
    let synced = 0;

    const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;

    // Use metafieldsSet mutation for efficiency
    const mutation = `
      mutation setProductMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const metafieldsInput = values.map((v) => ({
      ownerId: gid,
      namespace: v.namespace,
      key: v.key,
      value: v.value,
      type: v.type,
    }));

    try {
      const response: any = await client.request(mutation, {
        variables: { metafields: metafieldsInput },
      });

      if (response.metafieldsSet?.userErrors?.length > 0) {
        for (const error of response.metafieldsSet.userErrors) {
          errors.push(`${error.field}: ${error.message}`);
        }
      }

      synced = response.metafieldsSet?.metafields?.length || 0;
    } catch (error) {
      errors.push(`API error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    return { synced, errors };
  }

  /**
   * Write metafield values to a variant
   */
  private async writeVariantMetafields(
    shop: any,
    variantId: string,
    values: MetafieldValue[]
  ): Promise<{ synced: number; errors: string[] }> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);
    const errors: string[] = [];
    let synced = 0;

    const gid = variantId.startsWith('gid://')
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const mutation = `
      mutation setVariantMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const metafieldsInput = values.map((v) => ({
      ownerId: gid,
      namespace: v.namespace,
      key: v.key,
      value: v.value,
      type: v.type,
    }));

    try {
      const response: any = await client.request(mutation, {
        variables: { metafields: metafieldsInput },
      });

      if (response.metafieldsSet?.userErrors?.length > 0) {
        for (const error of response.metafieldsSet.userErrors) {
          errors.push(`${error.field}: ${error.message}`);
        }
      }

      synced = response.metafieldsSet?.metafields?.length || 0;
    } catch (error) {
      errors.push(`API error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    return { synced, errors };
  }

  /**
   * Bulk sync all metafields for a connection (24h batch job)
   * Optimized to batch metafields across multiple products into fewer API calls
   */
  async bulkSyncConnection(connectionId: string): Promise<{
    totalProducts: number;
    syncedProducts: number;
    totalMetafields: number;
    errors: string[];
  }> {
    logger.info(`Starting bulk metafield sync for connection ${connectionId}`);

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      return {
        totalProducts: 0,
        syncedProducts: 0,
        totalMetafields: 0,
        errors: ['Connection not found'],
      };
    }

    // Get all active mappings
    const mappings = await prisma.productMapping.findMany({
      where: {
        connectionId,
        status: 'ACTIVE',
        retailerShopifyProductId: { not: null },
      },
      select: {
        supplierShopifyProductId: true,
        retailerShopifyProductId: true,
      },
    });

    // Get enabled metafield configs
    const enabledConfigs = await prisma.metafieldConfig.findMany({
      where: { connectionId, syncEnabled: true, isSupported: true },
      select: { namespace: true, key: true, type: true },
    });

    if (enabledConfigs.length === 0) {
      logger.info(`No enabled metafield configs for connection ${connectionId}`);
      return { totalProducts: mappings.length, syncedProducts: 0, totalMetafields: 0, errors: [] };
    }

    const errors: string[] = [];
    let syncedProducts = 0;
    let totalMetafields = 0;

    // Use optimized batch sync that combines metafields across products
    const productBatchSize = 5; // Process 5 products at a time
    for (let i = 0; i < mappings.length; i += productBatchSize) {
      const productBatch = mappings.slice(i, i + productBatchSize);

      // Check rate limits before processing batch
      const delay = await RateLimitService.getRequiredDelay(
        connection.retailerShop.myshopifyDomain
      );
      if (delay > 0) {
        logger.info(`Rate limit delay: ${delay}ms before batch ${i / productBatchSize + 1}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const result = await this.batchSyncProductsMetafields(
          connection,
          productBatch,
          enabledConfigs
        );

        syncedProducts += result.syncedProducts;
        totalMetafields += result.synced;
        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }
      } catch (error) {
        errors.push(
          `Batch ${i / productBatchSize + 1}: ${error instanceof Error ? error.message : 'Unknown'}`
        );
      }

      // Log progress
      logger.info(
        `Bulk metafield sync progress: ${Math.min(i + productBatchSize, mappings.length)}/${mappings.length}`
      );
    }

    // Record activity
    await ConnectionHealthService.logActivity(connectionId, {
      type: 'SYNC_SUCCESS',
      resourceType: 'PRODUCT',
      message: `Bulk metafield sync: ${totalMetafields} metafields on ${syncedProducts} products`,
      details: {
        totalProducts: mappings.length,
        syncedProducts,
        totalMetafields,
        errorCount: errors.length,
      },
    });

    logger.info(
      `Bulk metafield sync complete for ${connectionId}: ` +
        `${totalMetafields} metafields on ${syncedProducts}/${mappings.length} products, ${errors.length} errors`
    );

    return {
      totalProducts: mappings.length,
      syncedProducts,
      totalMetafields,
      errors,
    };
  }

  /**
   * Batch sync metafields for multiple products in fewer API calls
   * Combines metafields across products into single metafieldsSet calls (up to 25 per call)
   */
  private async batchSyncProductsMetafields(
    connection: any,
    mappings: Array<{ supplierShopifyProductId: string; retailerShopifyProductId: string | null }>,
    enabledConfigs: Array<{ namespace: string; key: string; type: string }>
  ): Promise<{ synced: number; syncedProducts: number; errors: string[] }> {
    const supplierClient = createShopifyGraphQLClient(
      connection.supplierShop.myshopifyDomain,
      connection.supplierShop.accessToken
    );
    const retailerClient = createShopifyGraphQLClient(
      connection.retailerShop.myshopifyDomain,
      connection.retailerShop.accessToken
    );

    const errors: string[] = [];
    const allMetafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
      value: string;
      type: string;
    }> = [];
    const productIds = new Set<string>();

    // Step 1: Bulk query source metafields for all products
    const sourceProductIds = mappings.map((m) => {
      const id = m.supplierShopifyProductId;
      return id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
    });

    const sourceQuery = `
      query getProductsMetafields($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            metafields(first: 50) {
              edges {
                node {
                  namespace
                  key
                  value
                  type
                }
              }
            }
          }
        }
      }
    `;

    let sourceResponse: any;
    try {
      sourceResponse = await supplierClient.request(sourceQuery, {
        variables: { ids: sourceProductIds },
      });
    } catch (error) {
      errors.push(
        `Failed to query source metafields: ${error instanceof Error ? error.message : 'Unknown'}`
      );
      return { synced: 0, syncedProducts: 0, errors };
    }

    // Build source metafield map: sourceProductGid -> metafields[]
    const sourceMetafieldsMap = new Map<string, any[]>();
    for (const node of sourceResponse.data?.nodes || []) {
      if (!node?.id || !node.metafields) continue;
      const metafields = node.metafields.edges?.map((e: any) => e.node) || [];
      sourceMetafieldsMap.set(node.id, metafields);
    }

    // Step 2: Collect all metafields to write to retailer
    for (const mapping of mappings) {
      if (!mapping.retailerShopifyProductId) continue;

      const sourceGid = mapping.supplierShopifyProductId.startsWith('gid://')
        ? mapping.supplierShopifyProductId
        : `gid://shopify/Product/${mapping.supplierShopifyProductId}`;

      const destGid = mapping.retailerShopifyProductId.startsWith('gid://')
        ? mapping.retailerShopifyProductId
        : `gid://shopify/Product/${mapping.retailerShopifyProductId}`;

      const sourceMetafields = sourceMetafieldsMap.get(sourceGid) || [];

      // Filter to only enabled configs
      for (const config of enabledConfigs) {
        const match = sourceMetafields.find(
          (m: any) => m.namespace === config.namespace && m.key === config.key
        );
        if (match && match.value) {
          allMetafields.push({
            ownerId: destGid,
            namespace: match.namespace,
            key: match.key,
            value: match.value,
            type: match.type,
          });
          productIds.add(destGid);
        }
      }
    }

    if (allMetafields.length === 0) {
      return { synced: 0, syncedProducts: 0, errors };
    }

    // Step 3: Batch write metafields (up to 25 per call)
    const mutation = `
      mutation setMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    let synced = 0;
    const batchSize = 25; // Shopify limit for metafieldsSet

    for (let i = 0; i < allMetafields.length; i += batchSize) {
      const batch = allMetafields.slice(i, i + batchSize);

      try {
        const response: any = await retailerClient.request(mutation, {
          variables: { metafields: batch },
        });

        if (response.data?.metafieldsSet?.userErrors?.length > 0) {
          for (const error of response.data.metafieldsSet.userErrors) {
            errors.push(`${error.field}: ${error.message}`);
          }
        }

        synced += response.data?.metafieldsSet?.metafields?.length || 0;
      } catch (error) {
        errors.push(`Batch write failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    logger.info(
      `Batch synced ${synced} metafields across ${productIds.size} products (${allMetafields.length} total)`
    );

    return { synced, syncedProducts: productIds.size, errors };
  }

  /**
   * Get metafield sync stats for a connection
   */
  async getStats(connectionId: string): Promise<{
    totalDefinitions: number;
    enabledDefinitions: number;
    supportedDefinitions: number;
    unsupportedDefinitions: number;
    capUsed: number;
    capLimit: number;
    lastBulkSync: Date | null;
  }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { supplierShop: true },
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    const [totalDefinitions, enabledDefinitions, supportedDefinitions] = await Promise.all([
      prisma.metafieldConfig.count({ where: { connectionId } }),
      prisma.metafieldConfig.count({ where: { connectionId, syncEnabled: true } }),
      prisma.metafieldConfig.count({ where: { connectionId, isSupported: true } }),
    ]);

    const lastSync = await prisma.metafieldConfig.findFirst({
      where: { connectionId, syncEnabled: true },
      orderBy: { lastSyncAt: 'desc' },
      select: { lastSyncAt: true },
    });

    const tier = connection.supplierShop.plan || 'FREE';
    const cap = this.getDefinitionCap(tier);

    return {
      totalDefinitions,
      enabledDefinitions,
      supportedDefinitions,
      unsupportedDefinitions: totalDefinitions - supportedDefinitions,
      capUsed: enabledDefinitions,
      capLimit: cap,
      lastBulkSync: lastSync?.lastSyncAt || null,
    };
  }

  /**
   * Trigger metafield sync on product import/update
   * Called from ProductSyncService when a product is synced
   */
  async onProductSynced(
    connectionId: string,
    sourceProductId: string,
    destProductId: string,
    variantMappings?: Array<{ sourceVariantId: string; destVariantId: string }>
  ): Promise<void> {
    // Check if any metafields are enabled for this connection
    const enabledConfigs = await prisma.metafieldConfig.count({
      where: { connectionId, syncEnabled: true },
    });

    if (enabledConfigs === 0) {
      return;
    }

    try {
      // Sync product metafields
      const productResult = await this.syncProductMetafields(
        connectionId,
        sourceProductId,
        destProductId
      );

      if (productResult.errors.length > 0) {
        logger.warn(`Product metafield sync errors for ${destProductId}:`, productResult.errors);
      }

      // Sync variant metafields if mappings provided
      if (variantMappings && variantMappings.length > 0) {
        for (const vm of variantMappings) {
          const variantResult = await this.syncVariantMetafields(
            connectionId,
            vm.sourceVariantId,
            vm.destVariantId
          );

          if (variantResult.errors.length > 0) {
            logger.warn(
              `Variant metafield sync errors for ${vm.destVariantId}:`,
              variantResult.errors
            );
          }
        }
      }
    } catch (error) {
      logger.error(`Error syncing metafields for product ${destProductId}:`, error);
    }
  }
}

export const MetafieldSyncService = new MetafieldSyncServiceClass();
