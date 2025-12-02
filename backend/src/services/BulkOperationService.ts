/**
 * BulkOperationService - Shopify Bulk Operations API
 *
 * Provides infrastructure for async bulk queries and mutations:
 * - Bulk queries: Export large datasets (products, orders, customers) to JSONL
 * - Staged uploads: Upload files to Shopify CDN for bulk mutations
 * - Bulk mutations: Create/update many resources via JSONL input
 * - Polling: Check operation status and download results
 */

import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';

export type BulkOperationType = 'QUERY' | 'MUTATION';
export type BulkOperationStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELING'
  | 'CANCELED'
  | 'FAILED'
  | 'EXPIRED';

export interface BulkOperation {
  id: string;
  status: BulkOperationStatus;
  errorCode?: string;
  objectCount?: number;
  fileSize?: number;
  url?: string;
  partialDataUrl?: string;
  query?: string;
  rootObjectCount?: number;
  completedAt?: string;
}

export interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

export interface StagedUploadInput {
  filename: string;
  mimeType: string;
  resource: 'BULK_MUTATION_VARIABLES' | 'FILE' | 'IMAGE' | 'MODEL_3D' | 'VIDEO';
  fileSize?: number;
  httpMethod?: 'POST' | 'PUT';
}

export class BulkOperationService {
  /**
   * Start a bulk query operation
   * Returns the operation ID for polling
   */
  static async startBulkQuery(
    shop: { myshopifyDomain: string; accessToken: string },
    query: string
  ): Promise<{ operationId: string; status: BulkOperationStatus }> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation bulkOperationRunQuery($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation {
            id
            status
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
        variables: { query },
      });

      if (response.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
        const errors = response.data.bulkOperationRunQuery.userErrors;
        throw new Error(`Bulk query failed: ${errors[0].message}`);
      }

      const operation = response.data?.bulkOperationRunQuery?.bulkOperation;
      if (!operation) {
        throw new Error('No bulk operation returned');
      }

      logger.info(`Started bulk query operation ${operation.id} for ${shop.myshopifyDomain}`);

      return {
        operationId: operation.id,
        status: operation.status,
      };
    } catch (error) {
      logger.error('Error starting bulk query:', error);
      throw error;
    }
  }

  /**
   * Start a bulk mutation operation using staged upload
   */
  static async startBulkMutation(
    shop: { myshopifyDomain: string; accessToken: string },
    mutation: string,
    stagedUploadPath: string
  ): Promise<{ operationId: string; status: BulkOperationStatus }> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const bulkMutation = `
      mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
        bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const response: any = await client.request(bulkMutation, {
        variables: { mutation, stagedUploadPath },
      });

      if (response.data?.bulkOperationRunMutation?.userErrors?.length > 0) {
        const errors = response.data.bulkOperationRunMutation.userErrors;
        throw new Error(`Bulk mutation failed: ${errors[0].message}`);
      }

      const operation = response.data?.bulkOperationRunMutation?.bulkOperation;
      if (!operation) {
        throw new Error('No bulk operation returned');
      }

      logger.info(`Started bulk mutation operation ${operation.id} for ${shop.myshopifyDomain}`);

      return {
        operationId: operation.id,
        status: operation.status,
      };
    } catch (error) {
      logger.error('Error starting bulk mutation:', error);
      throw error;
    }
  }

  /**
   * Get current bulk operation status (there can only be one per shop)
   */
  static async getCurrentOperation(shop: {
    myshopifyDomain: string;
    accessToken: string;
  }): Promise<BulkOperation | null> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query currentBulkOperation {
        currentBulkOperation {
          id
          status
          errorCode
          objectCount
          fileSize
          url
          partialDataUrl
          query
          rootObjectCount
          completedAt
        }
      }
    `;

    try {
      const response: any = await client.request(query);
      return response.data?.currentBulkOperation || null;
    } catch (error) {
      logger.error('Error getting current bulk operation:', error);
      throw error;
    }
  }

  /**
   * Get bulk operation by ID
   */
  static async getOperation(
    shop: { myshopifyDomain: string; accessToken: string },
    operationId: string
  ): Promise<BulkOperation | null> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query bulkOperation($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            errorCode
            objectCount
            fileSize
            url
            partialDataUrl
            query
            rootObjectCount
            completedAt
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query, {
        variables: { id: operationId },
      });
      return response.data?.node || null;
    } catch (error) {
      logger.error('Error getting bulk operation:', error);
      throw error;
    }
  }

  /**
   * Poll operation until complete
   * Returns the final operation state with download URL
   */
  static async pollUntilComplete(
    shop: { myshopifyDomain: string; accessToken: string },
    operationId: string,
    options?: {
      maxWaitMs?: number;
      pollIntervalMs?: number;
      onProgress?: (operation: BulkOperation) => void;
    }
  ): Promise<BulkOperation> {
    const maxWait = options?.maxWaitMs || 300000; // 5 minutes default
    const pollInterval = options?.pollIntervalMs || 2000; // 2 seconds default
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const operation = await this.getOperation(shop, operationId);

      if (!operation) {
        throw new Error(`Operation ${operationId} not found`);
      }

      if (options?.onProgress) {
        options.onProgress(operation);
      }

      switch (operation.status) {
        case 'COMPLETED':
          logger.info(
            `Bulk operation ${operationId} completed: ${operation.objectCount} objects, ${operation.fileSize} bytes`
          );
          return operation;

        case 'FAILED':
          throw new Error(`Bulk operation failed: ${operation.errorCode}`);

        case 'CANCELED':
        case 'EXPIRED':
          throw new Error(`Bulk operation ${operation.status.toLowerCase()}`);

        case 'CREATED':
        case 'RUNNING':
        case 'CANCELING':
          // Still in progress, wait and poll again
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          break;
      }
    }

    throw new Error(`Bulk operation timed out after ${maxWait}ms`);
  }

  /**
   * Cancel a running bulk operation
   */
  static async cancelOperation(
    shop: { myshopifyDomain: string; accessToken: string },
    operationId: string
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation bulkOperationCancel($id: ID!) {
        bulkOperationCancel(id: $id) {
          bulkOperation {
            id
            status
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
        variables: { id: operationId },
      });

      if (response.data?.bulkOperationCancel?.userErrors?.length > 0) {
        const errors = response.data.bulkOperationCancel.userErrors;
        logger.error(`Failed to cancel operation: ${errors[0].message}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error canceling bulk operation:', error);
      return false;
    }
  }

  /**
   * Create staged upload targets for files
   */
  static async createStagedUploads(
    shop: { myshopifyDomain: string; accessToken: string },
    inputs: StagedUploadInput[]
  ): Promise<StagedUploadTarget[]> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const mutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
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
        variables: { input: inputs },
      });

      if (response.data?.stagedUploadsCreate?.userErrors?.length > 0) {
        const errors = response.data.stagedUploadsCreate.userErrors;
        throw new Error(`Staged upload creation failed: ${errors[0].message}`);
      }

      return response.data?.stagedUploadsCreate?.stagedTargets || [];
    } catch (error) {
      logger.error('Error creating staged uploads:', error);
      throw error;
    }
  }

  /**
   * Upload content to a staged upload target
   * Returns the resourceUrl to use in subsequent mutations
   */
  static async uploadToStagedTarget(
    target: StagedUploadTarget,
    content: string | Buffer
  ): Promise<string> {
    // Build form data from parameters
    const formData = new FormData();

    for (const param of target.parameters) {
      formData.append(param.name, param.value);
    }

    // Add the file content
    const blob =
      typeof content === 'string'
        ? new Blob([content], { type: 'application/jsonl' })
        : new Blob([content]);

    formData.append('file', blob);

    try {
      const response = await fetch(target.url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      logger.info(`Uploaded to staged target: ${target.resourceUrl}`);
      return target.resourceUrl;
    } catch (error) {
      logger.error('Error uploading to staged target:', error);
      throw error;
    }
  }

  /**
   * Download and parse JSONL results from a bulk operation
   * Returns an async generator for memory-efficient processing of large files
   */
  static async *downloadResults<T = any>(url: string): AsyncGenerator<T> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const text = await response.text();
      const lines = text.trim().split('\n');

      for (const line of lines) {
        if (line.trim()) {
          yield JSON.parse(line) as T;
        }
      }
    } catch (error) {
      logger.error('Error downloading bulk operation results:', error);
      throw error;
    }
  }

  /**
   * Download all results into an array (for smaller datasets)
   */
  static async downloadAllResults<T = any>(url: string): Promise<T[]> {
    const results: T[] = [];
    for await (const item of this.downloadResults<T>(url)) {
      results.push(item);
    }
    return results;
  }

  /**
   * Helper: Create a JSONL string from an array of objects
   */
  static toJsonl(items: any[]): string {
    return items.map((item) => JSON.stringify(item)).join('\n');
  }

  /**
   * Helper: Parse JSONL string into array of objects
   */
  static parseJsonl<T = any>(jsonl: string): T[] {
    return jsonl
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T);
  }
}

// Common bulk query templates
export const BulkQueryTemplates = {
  /**
   * Export all products with variants and metafields
   */
  allProducts: `
    {
      products {
        edges {
          node {
            id
            title
            handle
            status
            vendor
            productType
            tags
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  price
                  compareAtPrice
                  inventoryQuantity
                  inventoryItem {
                    id
                  }
                }
              }
            }
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
    }
  `,

  /**
   * Export all orders with line items
   */
  allOrders: `
    {
      orders {
        edges {
          node {
            id
            name
            createdAt
            financialStatus
            fulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 100) {
              edges {
                node {
                  id
                  title
                  quantity
                  variant {
                    id
                    sku
                  }
                }
              }
            }
          }
        }
      }
    }
  `,

  /**
   * Export all inventory levels
   */
  allInventory: `
    {
      locations(first: 10) {
        edges {
          node {
            id
            name
            inventoryLevels(first: 100) {
              edges {
                node {
                  id
                  available
                  inventoryItem {
                    id
                    sku
                    variant {
                      id
                      product {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,

  /**
   * Export all metafield definitions
   */
  allMetafieldDefinitions: `
    {
      metafieldDefinitions(ownerType: PRODUCT, first: 100) {
        edges {
          node {
            id
            namespace
            key
            name
            type {
              name
            }
          }
        }
      }
    }
  `,
};
