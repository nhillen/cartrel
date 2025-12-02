/**
 * CollectionSyncService - Collection synchronization across stores
 *
 * Per PRD_COLLECTION_SYNC:
 * - Sync custom collections (title, description, image, handle, etc.)
 * - Product membership via mapping/tags
 * - One-way sync (source -> destination)
 * - Overwrite vs preserve local edits toggle
 */

import { createHash } from 'crypto';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { ConnectionHealthService } from './ConnectionHealthService';
import { RateLimitService } from './RateLimitService';

// Collection tier caps
export const COLLECTION_TIER_CAPS: Record<string, number> = {
  FREE: 50,
  STARTER: 200,
  CORE: 500,
  PRO: 1000,
  GROWTH: 2000,
  SCALE: 999999,
  MARKETPLACE: 999999,
};

export interface CollectionData {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  image?: {
    url: string;
    altText?: string;
  };
  sortOrder: string;
  templateSuffix?: string;
  productsCount: number;
}

export interface SyncCollectionResult {
  success: boolean;
  collectionMappingId?: string;
  destCollectionId?: string;
  error?: string;
  productsAdded?: number;
  productsRemoved?: number;
}

class CollectionSyncServiceClass {
  /**
   * Get collection cap for a tier
   */
  getCollectionCap(tier: string): number {
    return COLLECTION_TIER_CAPS[tier.toUpperCase()] || COLLECTION_TIER_CAPS.FREE;
  }

  /**
   * Check if connection has reached collection cap
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
    const cap = this.getCollectionCap(tier);

    const current = await prisma.collectionMapping.count({
      where: {
        connectionId,
        status: 'ACTIVE',
      },
    });

    return {
      reached: current >= cap,
      current,
      cap,
    };
  }

  /**
   * Discover collections from source shop
   */
  async discoverCollections(connectionId: string): Promise<CollectionData[]> {
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
      query getCollections($cursor: String) {
        collections(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              handle
              title
              description
              descriptionHtml
              image {
                url
                altText
              }
              sortOrder
              templateSuffix
              productsCount
            }
          }
        }
      }
    `;

    const collections: CollectionData[] = [];
    let cursor: string | null = null;

    try {
      do {
        const response: any = await client.request(query, {
          variables: { cursor },
        });

        const edges = response.collections?.edges || [];
        for (const edge of edges) {
          collections.push(edge.node);
        }

        cursor = response.collections?.pageInfo?.hasNextPage
          ? response.collections.pageInfo.endCursor
          : null;
      } while (cursor);

      return collections;
    } catch (error) {
      logger.error('Error discovering collections:', error);
      throw error;
    }
  }

  /**
   * Get collection mappings for a connection
   */
  async getMappings(connectionId: string): Promise<any[]> {
    return prisma.collectionMapping.findMany({
      where: { connectionId },
      orderBy: { sourceTitle: 'asc' },
    });
  }

  /**
   * Enable sync for a collection
   */
  async enableSync(
    connectionId: string,
    sourceCollectionId: string,
    options?: {
      preserveLocalEdits?: boolean;
      handlePrefix?: string;
    }
  ): Promise<SyncCollectionResult> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      return { success: false, error: 'Connection not found' };
    }

    if (!connection.collectionSyncEnabled) {
      return { success: false, error: 'Collection sync not enabled for this connection' };
    }

    // Check cap
    const capCheck = await this.hasReachedCap(connectionId);
    if (capCheck.reached) {
      return {
        success: false,
        error: `Collection sync cap reached (${capCheck.current}/${capCheck.cap}). Upgrade to add more.`,
      };
    }

    // Fetch collection details from source
    const sourceCollection = await this.fetchCollection(
      connection.supplierShop,
      sourceCollectionId
    );

    if (!sourceCollection) {
      return { success: false, error: 'Source collection not found' };
    }

    // Create or update mapping
    const mapping = await prisma.collectionMapping.upsert({
      where: {
        connectionId_sourceCollectionId: {
          connectionId,
          sourceCollectionId,
        },
      },
      create: {
        connectionId,
        sourceCollectionId,
        sourceHandle: sourceCollection.handle,
        sourceTitle: sourceCollection.title,
        preserveLocalEdits: options?.preserveLocalEdits ?? false,
        status: 'ACTIVE',
      },
      update: {
        sourceHandle: sourceCollection.handle,
        sourceTitle: sourceCollection.title,
        preserveLocalEdits: options?.preserveLocalEdits ?? false,
        status: 'ACTIVE',
      },
    });

    // Create or update collection on destination
    const syncResult = await this.syncCollection(mapping.id);

    return {
      success: syncResult.success,
      collectionMappingId: mapping.id,
      destCollectionId: syncResult.destCollectionId,
      error: syncResult.error,
      productsAdded: syncResult.productsAdded,
    };
  }

  /**
   * Disable sync for a collection
   */
  async disableSync(
    mappingId: string,
    options?: { deleteDestination?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const mapping = await prisma.collectionMapping.findUnique({
      where: { id: mappingId },
      include: {
        connection: {
          include: { retailerShop: true },
        },
      },
    });

    if (!mapping) {
      return { success: false, error: 'Mapping not found' };
    }

    // Optionally delete destination collection
    if (options?.deleteDestination && mapping.destCollectionId) {
      try {
        await this.deleteDestinationCollection(
          mapping.connection.retailerShop,
          mapping.destCollectionId
        );
      } catch (error) {
        logger.warn('Failed to delete destination collection:', error);
      }
    }

    // Update mapping status
    await prisma.collectionMapping.update({
      where: { id: mappingId },
      data: {
        status: 'DELETED',
        destCollectionId: options?.deleteDestination ? null : mapping.destCollectionId,
      },
    });

    return { success: true };
  }

  /**
   * Sync a single collection
   */
  async syncCollection(mappingId: string): Promise<SyncCollectionResult> {
    const mapping = await prisma.collectionMapping.findUnique({
      where: { id: mappingId },
      include: {
        connection: {
          include: {
            supplierShop: true,
            retailerShop: true,
          },
        },
      },
    });

    if (!mapping) {
      return { success: false, error: 'Mapping not found' };
    }

    try {
      // Fetch source collection data
      const sourceCollection = await this.fetchCollection(
        mapping.connection.supplierShop,
        mapping.sourceCollectionId
      );

      if (!sourceCollection) {
        await prisma.collectionMapping.update({
          where: { id: mappingId },
          data: {
            status: 'ERROR',
            lastError: 'Source collection not found or deleted',
          },
        });
        return { success: false, error: 'Source collection not found' };
      }

      // Check for changes using hash
      const newHash = this.hashCollection(sourceCollection);
      if (mapping.lastSyncHash === newHash && mapping.destCollectionId) {
        // No changes
        return { success: true, destCollectionId: mapping.destCollectionId };
      }

      // Check rate limits
      const delay = await RateLimitService.getRequiredDelay(
        mapping.connection.retailerShop.myshopifyDomain
      );
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Create or update destination collection
      let destCollectionId = mapping.destCollectionId;

      if (!destCollectionId) {
        // Create new collection
        destCollectionId = await this.createDestinationCollection(
          mapping.connection.retailerShop,
          sourceCollection,
          mapping.connection.id
        );
      } else if (!mapping.preserveLocalEdits) {
        // Update existing collection
        await this.updateDestinationCollection(
          mapping.connection.retailerShop,
          destCollectionId,
          sourceCollection
        );
      }

      if (!destCollectionId) {
        await prisma.collectionMapping.update({
          where: { id: mappingId },
          data: {
            status: 'ERROR',
            lastError: 'Failed to create destination collection',
          },
        });
        return { success: false, error: 'Failed to create destination collection' };
      }

      // Sync product membership
      const productsResult = await this.syncCollectionProducts(
        mapping.connectionId,
        mapping.sourceCollectionId,
        destCollectionId
      );

      // Update mapping
      await prisma.collectionMapping.update({
        where: { id: mappingId },
        data: {
          destCollectionId,
          destHandle: sourceCollection.handle,
          status: 'ACTIVE',
          lastError: null,
          lastSyncAt: new Date(),
          lastSyncHash: newHash,
        },
      });

      logger.info(
        `Synced collection ${sourceCollection.title} to ${destCollectionId}, ` +
          `${productsResult.added} products added, ${productsResult.removed} removed`
      );

      return {
        success: true,
        destCollectionId,
        productsAdded: productsResult.added,
        productsRemoved: productsResult.removed,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await prisma.collectionMapping.update({
        where: { id: mappingId },
        data: {
          status: 'ERROR',
          lastError: errorMsg,
        },
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Bulk sync all collections for a connection
   */
  async bulkSyncConnection(connectionId: string): Promise<{
    total: number;
    success: number;
    failed: number;
    errors: string[];
  }> {
    const mappings = await prisma.collectionMapping.findMany({
      where: {
        connectionId,
        status: 'ACTIVE',
      },
    });

    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    for (const mapping of mappings) {
      const result = await this.syncCollection(mapping.id);
      if (result.success) {
        success++;
      } else {
        failed++;
        errors.push(`${mapping.sourceTitle}: ${result.error}`);
      }
    }

    // Log activity
    await ConnectionHealthService.logActivity(connectionId, {
      type: 'SYNC_SUCCESS',
      resourceType: 'PRODUCT',
      message: `Bulk collection sync: ${success} synced, ${failed} failed`,
      details: { total: mappings.length, success, failed },
    });

    return {
      total: mappings.length,
      success,
      failed,
      errors,
    };
  }

  /**
   * Fetch collection details from Shopify
   */
  private async fetchCollection(shop: any, collectionId: string): Promise<CollectionData | null> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query getCollection($id: ID!) {
        collection(id: $id) {
          id
          handle
          title
          description
          descriptionHtml
          image {
            url
            altText
          }
          sortOrder
          templateSuffix
          productsCount
        }
      }
    `;

    try {
      const response: any = await client.request(query, {
        variables: { id: collectionId },
      });

      return response.collection || null;
    } catch (error) {
      logger.error('Error fetching collection:', error);
      return null;
    }
  }

  /**
   * Create collection on destination
   */
  private async createDestinationCollection(
    shop: any,
    sourceCollection: CollectionData,
    connectionId: string
  ): Promise<string | null> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation createCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input: any = {
      title: sourceCollection.title,
      descriptionHtml: sourceCollection.descriptionHtml,
      sortOrder: sourceCollection.sortOrder,
      templateSuffix: sourceCollection.templateSuffix,
      metafields: [
        {
          namespace: 'cartrel',
          key: 'source_collection_id',
          value: sourceCollection.id,
          type: 'single_line_text_field',
        },
        {
          namespace: 'cartrel',
          key: 'connection_id',
          value: connectionId,
          type: 'single_line_text_field',
        },
      ],
    };

    // Add image if present
    if (sourceCollection.image?.url) {
      input.image = {
        src: sourceCollection.image.url,
        altText: sourceCollection.image.altText || sourceCollection.title,
      };
    }

    try {
      const response: any = await client.request(mutation, {
        variables: { input },
      });

      if (response.collectionCreate?.userErrors?.length > 0) {
        logger.error('Collection create errors:', response.collectionCreate.userErrors);
        return null;
      }

      return response.collectionCreate?.collection?.id || null;
    } catch (error) {
      logger.error('Error creating destination collection:', error);
      return null;
    }
  }

  /**
   * Update collection on destination
   */
  private async updateDestinationCollection(
    shop: any,
    collectionId: string,
    sourceCollection: CollectionData
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation updateCollection($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input: any = {
      id: collectionId,
      title: sourceCollection.title,
      descriptionHtml: sourceCollection.descriptionHtml,
      sortOrder: sourceCollection.sortOrder,
    };

    if (sourceCollection.image?.url) {
      input.image = {
        src: sourceCollection.image.url,
        altText: sourceCollection.image.altText,
      };
    }

    try {
      const response: any = await client.request(mutation, {
        variables: { input },
      });

      return response.collectionUpdate?.userErrors?.length === 0;
    } catch (error) {
      logger.error('Error updating destination collection:', error);
      return false;
    }
  }

  /**
   * Delete collection on destination
   */
  private async deleteDestinationCollection(shop: any, collectionId: string): Promise<void> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation deleteCollection($input: CollectionDeleteInput!) {
        collectionDelete(input: $input) {
          deletedCollectionId
          userErrors {
            field
            message
          }
        }
      }
    `;

    await client.request(mutation, {
      variables: { input: { id: collectionId } },
    });
  }

  /**
   * Sync product membership for a collection
   */
  private async syncCollectionProducts(
    connectionId: string,
    sourceCollectionId: string,
    destCollectionId: string
  ): Promise<{ added: number; removed: number }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      return { added: 0, removed: 0 };
    }

    // Get products in source collection
    const sourceProducts = await this.getCollectionProducts(
      connection.supplierShop,
      sourceCollectionId
    );

    // Get product mappings to find destination product IDs
    const mappings = await prisma.productMapping.findMany({
      where: {
        connectionId,
        status: 'ACTIVE',
        supplierShopifyProductId: {
          in: sourceProducts.map((p) => p.replace('gid://shopify/Product/', '')),
        },
        retailerShopifyProductId: { not: null },
      },
      select: {
        retailerShopifyProductId: true,
      },
    });

    const destProductIds = mappings
      .map((m) => m.retailerShopifyProductId)
      .filter((id): id is string => id !== null);

    if (destProductIds.length === 0) {
      return { added: 0, removed: 0 };
    }

    // Add products to destination collection
    const client = createShopifyGraphQLClient(
      connection.retailerShop.myshopifyDomain,
      connection.retailerShop.accessToken
    );

    const mutation = `
      mutation addProductsToCollection($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
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
      const productGids = destProductIds.map((id) =>
        id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`
      );

      await client.request(mutation, {
        variables: {
          id: destCollectionId,
          productIds: productGids,
        },
      });

      return { added: destProductIds.length, removed: 0 };
    } catch (error) {
      logger.error('Error syncing collection products:', error);
      return { added: 0, removed: 0 };
    }
  }

  /**
   * Get product IDs in a collection
   */
  private async getCollectionProducts(shop: any, collectionId: string): Promise<string[]> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query getCollectionProducts($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const productIds: string[] = [];
    let cursor: string | null = null;

    try {
      do {
        const response: any = await client.request(query, {
          variables: { id: collectionId, cursor },
        });

        const edges = response.collection?.products?.edges || [];
        for (const edge of edges) {
          productIds.push(edge.node.id);
        }

        cursor = response.collection?.products?.pageInfo?.hasNextPage
          ? response.collection.products.pageInfo.endCursor
          : null;
      } while (cursor);

      return productIds;
    } catch (error) {
      logger.error('Error getting collection products:', error);
      return [];
    }
  }

  /**
   * Hash collection data for change detection
   */
  private hashCollection(collection: CollectionData): string {
    const data = {
      title: collection.title,
      description: collection.description,
      sortOrder: collection.sortOrder,
      imageUrl: collection.image?.url,
    };
    return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  }

  /**
   * Get collection sync stats for a connection
   */
  async getStats(connectionId: string): Promise<{
    totalMappings: number;
    activeMappings: number;
    errorMappings: number;
    lastSyncAt: Date | null;
    capUsed: number;
    capLimit: number;
  }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { supplierShop: true },
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    const [totalMappings, activeMappings, errorMappings] = await Promise.all([
      prisma.collectionMapping.count({ where: { connectionId } }),
      prisma.collectionMapping.count({ where: { connectionId, status: 'ACTIVE' } }),
      prisma.collectionMapping.count({ where: { connectionId, status: 'ERROR' } }),
    ]);

    const lastSync = await prisma.collectionMapping.findFirst({
      where: { connectionId },
      orderBy: { lastSyncAt: 'desc' },
      select: { lastSyncAt: true },
    });

    const tier = connection.supplierShop.plan || 'FREE';
    const cap = this.getCollectionCap(tier);

    return {
      totalMappings,
      activeMappings,
      errorMappings,
      lastSyncAt: lastSync?.lastSyncAt || null,
      capUsed: activeMappings,
      capLimit: cap,
    };
  }
}

export const CollectionSyncService = new CollectionSyncServiceClass();
