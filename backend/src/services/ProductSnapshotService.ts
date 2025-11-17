/**
 * ProductSnapshotService - Handles 30-day rollback for product changes
 *
 * Core responsibilities:
 * - Capture snapshots of product fields before changes
 * - Enable rollback to previous state (within 30 days)
 * - Track who made changes (supplier sync vs manual edit)
 * - Provide change history for auditing
 * - Auto-cleanup snapshots older than 30 days
 *
 * Use case:
 * - Supplier updates product price $10 → $15
 * - Snapshot captures old price: $10
 * - Retailer realizes error, rolls back to $10
 * - All snapshots auto-deleted after 30 days
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';

interface SnapshotField {
  field: string; // e.g., "title", "price", "description"
  oldValue: any;
  newValue: any;
  changedBy: 'SUPPLIER_SYNC' | 'MANUAL_EDIT' | 'SYSTEM';
  changedAt: Date;
}

interface ProductHistoryEntry {
  field: string;
  value: any;
  changedBy: string;
  createdAt: Date;
}

export class ProductSnapshotService {
  /**
   * Create a snapshot before updating a product
   * Call this before any product update to enable rollback
   */
  static async captureSnapshot(
    retailerShopId: string,
    retailerProductId: string,
    field: string,
    oldValue: any,
    newValue: any,
    changedBy: 'SUPPLIER_SYNC' | 'MANUAL_EDIT' | 'SYSTEM'
  ): Promise<void> {
    try {
      // Only snapshot if value actually changed
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
        return;
      }

      await prisma.productSnapshot.create({
        data: {
          retailerShopId,
          retailerProductId,
          field,
          value: oldValue,
          changedBy,
        },
      });

      logger.debug(
        `Snapshot captured: ${field} changed from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)} by ${changedBy}`
      );
    } catch (error) {
      logger.error('Error capturing product snapshot:', error);
      // Don't throw - snapshots are optional, don't break the main flow
    }
  }

  /**
   * Get change history for a product (last 30 days)
   */
  static async getProductHistory(
    retailerShopId: string,
    retailerProductId: string,
    field?: string
  ): Promise<ProductHistoryEntry[]> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const snapshots = await prisma.productSnapshot.findMany({
        where: {
          retailerShopId,
          retailerProductId,
          field: field || undefined,
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100, // Limit to 100 most recent changes
      });

      return snapshots.map((s) => ({
        field: s.field,
        value: s.value,
        changedBy: s.changedBy,
        createdAt: s.createdAt,
      }));
    } catch (error) {
      logger.error(`Error getting product history:`, error);
      throw error;
    }
  }

  /**
   * Rollback a specific field to a previous snapshot
   */
  static async rollbackField(
    retailerShopId: string,
    retailerProductId: string,
    field: string,
    snapshotCreatedAt: Date
  ): Promise<void> {
    try {
      logger.info(
        `Rolling back ${field} for product ${retailerProductId} to snapshot from ${snapshotCreatedAt}`
      );

      // Get the snapshot
      const snapshot = await prisma.productSnapshot.findFirst({
        where: {
          retailerShopId,
          retailerProductId,
          field,
          createdAt: snapshotCreatedAt,
        },
      });

      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      // Get retailer shop
      const retailerShop = await prisma.shop.findUnique({
        where: { id: retailerShopId },
      });

      if (!retailerShop) {
        throw new Error('Retailer shop not found');
      }

      // Apply the rollback via Shopify API
      const client = createShopifyGraphQLClient(
        retailerShop.myshopifyDomain,
        retailerShop.accessToken
      );

      await this.applyFieldUpdate(client, retailerProductId, field, snapshot.value);

      // Capture a new snapshot showing the rollback
      await this.captureSnapshot(
        retailerShopId,
        retailerProductId,
        field,
        snapshot.value, // current value after rollback
        snapshot.value, // new value (same as old)
        'SYSTEM'
      );

      logger.info(`Successfully rolled back ${field} for product ${retailerProductId}`);
    } catch (error) {
      logger.error(`Error rolling back field:`, error);
      throw error;
    }
  }

  /**
   * Rollback entire product to a specific point in time
   * Rolls back all fields that have snapshots from that time
   */
  static async rollbackProduct(
    retailerShopId: string,
    retailerProductId: string,
    targetDate: Date
  ): Promise<{ rolledBack: string[]; errors: string[] }> {
    try {
      logger.info(
        `Rolling back product ${retailerProductId} to state at ${targetDate}`
      );

      // Get all snapshots around the target date (within 1 minute)
      const startDate = new Date(targetDate.getTime() - 60000); // 1 min before
      const endDate = new Date(targetDate.getTime() + 60000); // 1 min after

      const snapshots = await prisma.productSnapshot.findMany({
        where: {
          retailerShopId,
          retailerProductId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (snapshots.length === 0) {
        throw new Error('No snapshots found for the specified date');
      }

      const rolledBack: string[] = [];
      const errors: string[] = [];

      // Group by field (take the closest snapshot for each field)
      const fieldSnapshots = new Map<string, any>();
      for (const snapshot of snapshots) {
        if (!fieldSnapshots.has(snapshot.field)) {
          fieldSnapshots.set(snapshot.field, snapshot);
        }
      }

      // Rollback each field
      for (const [field, snapshot] of fieldSnapshots) {
        try {
          await this.rollbackField(
            retailerShopId,
            retailerProductId,
            field,
            snapshot.createdAt
          );
          rolledBack.push(field);
        } catch (error) {
          const errorMsg = `${field}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          logger.error(`Error rolling back field ${field}:`, error);
        }
      }

      logger.info(
        `Product rollback complete: ${rolledBack.length} fields rolled back, ${errors.length} errors`
      );

      return { rolledBack, errors };
    } catch (error) {
      logger.error(`Error rolling back product:`, error);
      throw error;
    }
  }

  /**
   * Clean up snapshots older than 30 days
   * This should be run as a cron job daily
   */
  static async cleanupOldSnapshots(): Promise<number> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await prisma.productSnapshot.deleteMany({
        where: {
          createdAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      logger.info(`Cleaned up ${result.count} old product snapshots`);

      return result.count;
    } catch (error) {
      logger.error('Error cleaning up old snapshots:', error);
      throw error;
    }
  }

  /**
   * Get snapshot statistics for a shop
   */
  static async getSnapshotStats(retailerShopId: string): Promise<any> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const totalSnapshots = await prisma.productSnapshot.count({
        where: {
          retailerShopId,
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
      });

      const snapshotsBySource = await prisma.productSnapshot.groupBy({
        by: ['changedBy'],
        where: {
          retailerShopId,
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
        _count: true,
      });

      const snapshotsByField = await prisma.productSnapshot.groupBy({
        by: ['field'],
        where: {
          retailerShopId,
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
        _count: true,
        orderBy: {
          _count: {
            field: 'desc',
          },
        },
        take: 10,
      });

      return {
        totalSnapshots,
        bySource: snapshotsBySource.reduce(
          (acc: any, item: any) => {
            acc[item.changedBy] = item._count;
            return acc;
          },
          {}
        ),
        topFields: snapshotsByField.map((item: any) => ({
          field: item.field,
          count: item._count,
        })),
      };
    } catch (error) {
      logger.error(`Error getting snapshot stats:`, error);
      throw error;
    }
  }

  /**
   * Apply a field update to a product in Shopify
   */
  private static async applyFieldUpdate(
    client: any,
    productId: string,
    field: string,
    value: any
  ): Promise<void> {
    // Build update based on field
    let input: any = {};

    switch (field) {
      case 'title':
        input.title = value;
        break;
      case 'description':
      case 'descriptionHtml':
        input.descriptionHtml = value;
        break;
      case 'vendor':
        input.vendor = value;
        break;
      case 'productType':
        input.productType = value;
        break;
      case 'tags':
        input.tags = Array.isArray(value) ? value : [value];
        break;
      case 'status':
        input.status = value;
        break;
      case 'price':
        // Price is at variant level, need different mutation
        throw new Error('Price rollback requires variant-specific update');
      default:
        throw new Error(`Unknown field: ${field}`);
    }

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

    input.id = `gid://shopify/Product/${productId}`;

    const response: any = await client.request(mutation, {
      variables: { input },
    });

    if (response.data?.productUpdate?.userErrors?.length > 0) {
      const errors = response.data.productUpdate.userErrors;
      throw new Error(`Product update failed: ${errors[0].message}`);
    }

    logger.debug(`Applied field update: ${field} = ${JSON.stringify(value)}`);
  }

  /**
   * Compare current product state to a snapshot
   * Useful for showing "what changed" UI
   */
  static async compareToSnapshot(
    retailerShopId: string,
    retailerProductId: string,
    snapshotDate: Date
  ): Promise<{ field: string; snapshotValue: any; currentValue: any }[]> {
    try {
      // Get snapshots around the target date
      const startDate = new Date(snapshotDate.getTime() - 60000);
      const endDate = new Date(snapshotDate.getTime() + 60000);

      const snapshots = await prisma.productSnapshot.findMany({
        where: {
          retailerShopId,
          retailerProductId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Get current product state from Shopify
      const retailerShop = await prisma.shop.findUnique({
        where: { id: retailerShopId },
      });

      if (!retailerShop) {
        throw new Error('Retailer shop not found');
      }

      const client = createShopifyGraphQLClient(
        retailerShop.myshopifyDomain,
        retailerShop.accessToken
      );

      const currentState = await this.fetchCurrentProductState(client, retailerProductId);

      // Compare
      const differences = [];

      for (const snapshot of snapshots) {
        const currentValue = currentState[snapshot.field];
        if (JSON.stringify(currentValue) !== JSON.stringify(snapshot.value)) {
          differences.push({
            field: snapshot.field,
            snapshotValue: snapshot.value,
            currentValue,
          });
        }
      }

      return differences;
    } catch (error) {
      logger.error('Error comparing to snapshot:', error);
      throw error;
    }
  }

  /**
   * Fetch current product state from Shopify
   */
  private static async fetchCurrentProductState(
    client: any,
    productId: string
  ): Promise<any> {
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          status
        }
      }
    `;

    const response: any = await client.request(query, {
      variables: { id: `gid://shopify/Product/${productId}` },
    });

    const product = response.data?.product;

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    return {
      title: product.title,
      description: product.descriptionHtml,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      status: product.status,
    };
  }
}
