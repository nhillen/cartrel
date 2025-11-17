/**
 * VariantMappingService - Handles variant-level mapping for multi-variant products
 *
 * Core responsibilities:
 * - Map supplier variants to retailer variants for products with multiple variants
 * - Auto-match variants by option values (size, color, material, etc.)
 * - Manual variant mapping when auto-match fails or is disabled
 * - Sync inventory and pricing at variant level
 * - Handle variant-specific preferences (some variants sync, others don't)
 *
 * Use case:
 * - Supplier has product "T-Shirt" with variants: S/Red, M/Red, L/Red, S/Blue, M/Blue, L/Blue
 * - Retailer imports it and may have different variant structure
 * - Need to map which supplier variant corresponds to which retailer variant
 */

import { prisma } from '../index';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';

interface VariantOption {
  name: string; // e.g., "Size", "Color"
  value: string; // e.g., "Medium", "Red"
}

interface VariantMatchResult {
  supplierVariantId: string;
  retailerVariantId: string | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  supplierOptions: VariantOption[];
  retailerOptions: VariantOption[];
  requiresManualMapping: boolean;
}

export class VariantMappingService {
  /**
   * Auto-match supplier variants to retailer variants based on option values
   */
  static async autoMatchVariants(
    productMappingId: string
  ): Promise<VariantMatchResult[]> {
    try {
      logger.info(`Auto-matching variants for product mapping ${productMappingId}`);

      const productMapping = await prisma.productMapping.findUnique({
        where: { id: productMappingId },
        include: {
          supplierProduct: true,
          connection: {
            include: {
              retailerShop: true,
            },
          },
        },
      });

      if (!productMapping) {
        throw new Error(`Product mapping ${productMappingId} not found`);
      }

      if (!productMapping.retailerShopifyProductId) {
        throw new Error('Product not imported to retailer shop yet');
      }

      // Fetch supplier product variants from Shopify
      const supplierClient = createShopifyGraphQLClient(
        productMapping.connection.retailerShop.myshopifyDomain,
        productMapping.connection.retailerShop.accessToken
      );

      const supplierVariants = await this.fetchProductVariants(
        supplierClient,
        productMapping.supplierShopifyProductId!
      );

      // Fetch retailer product variants from Shopify
      const retailerVariants = await this.fetchProductVariants(
        supplierClient,
        productMapping.retailerShopifyProductId
      );

      logger.info(
        `Found ${supplierVariants.length} supplier variants and ${retailerVariants.length} retailer variants`
      );

      // Match variants
      const matches: VariantMatchResult[] = [];

      for (const supplierVariant of supplierVariants) {
        let bestMatch: any = null;
        let matchConfidence: 'exact' | 'partial' | 'none' = 'none';

        // Try to find exact match (all options match)
        for (const retailerVariant of retailerVariants) {
          const matchResult = this.compareVariants(
            supplierVariant.options,
            retailerVariant.options
          );

          if (matchResult === 'exact') {
            bestMatch = retailerVariant;
            matchConfidence = 'exact';
            break;
          } else if (matchResult === 'partial' && !bestMatch) {
            bestMatch = retailerVariant;
            matchConfidence = 'partial';
          }
        }

        matches.push({
          supplierVariantId: supplierVariant.id,
          retailerVariantId: bestMatch?.id || null,
          matchConfidence,
          supplierOptions: supplierVariant.options,
          retailerOptions: bestMatch?.options || [],
          requiresManualMapping: matchConfidence !== 'exact',
        });
      }

      // Save exact matches to database
      for (const match of matches) {
        if (match.matchConfidence === 'exact' && match.retailerVariantId) {
          await prisma.variantMapping.upsert({
            where: {
              productMappingId_supplierVariantId: {
                productMappingId,
                supplierVariantId: match.supplierVariantId,
              },
            },
            update: {
              retailerVariantId: match.retailerVariantId,
              supplierOptions: match.supplierOptions as unknown as Prisma.InputJsonValue,
              retailerOptions: match.retailerOptions as unknown as Prisma.InputJsonValue,
              manuallyMapped: false,
            },
            create: {
              productMappingId,
              supplierVariantId: match.supplierVariantId,
              retailerVariantId: match.retailerVariantId,
              supplierOptions: match.supplierOptions as unknown as Prisma.InputJsonValue,
              retailerOptions: match.retailerOptions as unknown as Prisma.InputJsonValue,
              manuallyMapped: false,
            },
          });
        }
      }

      logger.info(
        `Auto-matched ${matches.filter((m) => m.matchConfidence === 'exact').length}/${matches.length} variants`
      );

      return matches;
    } catch (error) {
      logger.error(`Error auto-matching variants for mapping ${productMappingId}:`, error);
      throw error;
    }
  }

  /**
   * Manually map a supplier variant to a retailer variant
   */
  static async manuallyMapVariant(
    productMappingId: string,
    supplierVariantId: string,
    retailerVariantId: string
  ): Promise<void> {
    try {
      logger.info(
        `Manually mapping variant ${supplierVariantId} → ${retailerVariantId} for mapping ${productMappingId}`
      );

      const productMapping = await prisma.productMapping.findUnique({
        where: { id: productMappingId },
        include: {
          connection: {
            include: {
              retailerShop: true,
            },
          },
        },
      });

      if (!productMapping) {
        throw new Error(`Product mapping ${productMappingId} not found`);
      }

      // Fetch variant options from Shopify
      const client = createShopifyGraphQLClient(
        productMapping.connection.retailerShop.myshopifyDomain,
        productMapping.connection.retailerShop.accessToken
      );

      const supplierVariant = await this.fetchVariantById(client, supplierVariantId);
      const retailerVariant = await this.fetchVariantById(client, retailerVariantId);

      // Save mapping
      await prisma.variantMapping.upsert({
        where: {
          productMappingId_supplierVariantId: {
            productMappingId,
            supplierVariantId,
          },
        },
        update: {
          retailerVariantId,
          supplierOptions: supplierVariant.options as unknown as Prisma.InputJsonValue,
          retailerOptions: retailerVariant.options as unknown as Prisma.InputJsonValue,
          manuallyMapped: true,
        },
        create: {
          productMappingId,
          supplierVariantId,
          retailerVariantId,
          supplierOptions: supplierVariant.options as unknown as Prisma.InputJsonValue,
          retailerOptions: retailerVariant.options as unknown as Prisma.InputJsonValue,
          manuallyMapped: true,
        },
      });

      logger.info(`Variant mapping saved: ${supplierVariantId} → ${retailerVariantId}`);
    } catch (error) {
      logger.error(`Error manually mapping variant:`, error);
      throw error;
    }
  }

  /**
   * Get all variant mappings for a product
   */
  static async getVariantMappings(productMappingId: string): Promise<any[]> {
    try {
      const mappings = await prisma.variantMapping.findMany({
        where: { productMappingId },
      });

      return mappings.map((m) => ({
        supplierVariantId: m.supplierVariantId,
        retailerVariantId: m.retailerVariantId,
        supplierOptions: m.supplierOptions,
        retailerOptions: m.retailerOptions,
        manuallyMapped: m.manuallyMapped,
      }));
    } catch (error) {
      logger.error(`Error getting variant mappings for ${productMappingId}:`, error);
      throw error;
    }
  }

  /**
   * Sync inventory for a specific variant
   */
  static async syncVariantInventory(
    variantMappingId: string,
    quantity: number
  ): Promise<void> {
    try {
      const variantMapping = await prisma.variantMapping.findUnique({
        where: { id: variantMappingId },
        include: {
          productMapping: {
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

      if (!variantMapping) {
        throw new Error(`Variant mapping ${variantMappingId} not found`);
      }

      if (!variantMapping.retailerVariantId) {
        logger.warn('No retailer variant mapped, skipping inventory sync');
        return;
      }

      const retailerShop = variantMapping.productMapping.connection.retailerShop;
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

      const variantResponse: any = await client.request(variantQuery, {
        variables: { id: `gid://shopify/ProductVariant/${variantMapping.retailerVariantId}` },
      });

      const inventoryItemId = variantResponse.data?.productVariant?.inventoryItem?.id;

      if (!inventoryItemId) {
        throw new Error('Could not find inventory item for variant');
      }

      // Get location
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
        throw new Error('No locations found');
      }

      // Set inventory
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
              inventoryItemId,
              locationId,
              quantity,
            },
          ],
        },
      };

      const response: any = await client.request(mutation, { variables });

      if (response.data?.inventorySetQuantities?.userErrors?.length > 0) {
        const errors = response.data.inventorySetQuantities.userErrors;
        throw new Error(`Inventory sync failed: ${errors[0].message}`);
      }

      logger.info(`Synced inventory for variant ${variantMapping.retailerVariantId}: ${quantity}`);
    } catch (error) {
      logger.error(`Error syncing variant inventory:`, error);
      throw error;
    }
  }

  /**
   * Fetch all variants for a product from Shopify
   */
  private static async fetchProductVariants(
    client: any,
    productId: string
  ): Promise<any[]> {
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          variants(first: 100) {
            edges {
              node {
                id
                title
                selectedOptions {
                  name
                  value
                }
                price
                sku
                inventoryQuantity
              }
            }
          }
        }
      }
    `;

    const response: any = await client.request(query, {
      variables: { id: `gid://shopify/Product/${productId}` },
    });

    const variants = response.data?.product?.variants?.edges || [];

    return variants.map((edge: any) => ({
      id: edge.node.id.split('/').pop(),
      title: edge.node.title,
      options: edge.node.selectedOptions.map((opt: any) => ({
        name: opt.name,
        value: opt.value,
      })),
      price: edge.node.price,
      sku: edge.node.sku,
      inventoryQuantity: edge.node.inventoryQuantity,
    }));
  }

  /**
   * Fetch a single variant by ID from Shopify
   */
  private static async fetchVariantById(client: any, variantId: string): Promise<any> {
    const query = `
      query getVariant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          selectedOptions {
            name
            value
          }
          price
          sku
          inventoryQuantity
        }
      }
    `;

    const response: any = await client.request(query, {
      variables: { id: `gid://shopify/ProductVariant/${variantId}` },
    });

    const variant = response.data?.productVariant;

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    return {
      id: variant.id.split('/').pop(),
      title: variant.title,
      options: variant.selectedOptions.map((opt: any) => ({
        name: opt.name,
        value: opt.value,
      })),
      price: variant.price,
      sku: variant.sku,
      inventoryQuantity: variant.inventoryQuantity,
    };
  }

  /**
   * Compare two variant option sets to determine match quality
   */
  private static compareVariants(
    supplierOptions: VariantOption[],
    retailerOptions: VariantOption[]
  ): 'exact' | 'partial' | 'none' {
    if (supplierOptions.length !== retailerOptions.length) {
      return 'none';
    }

    let exactMatches = 0;
    let partialMatches = 0;

    for (const supplierOpt of supplierOptions) {
      const retailerOpt = retailerOptions.find((r) => r.name === supplierOpt.name);

      if (retailerOpt) {
        if (
          retailerOpt.value.toLowerCase().trim() === supplierOpt.value.toLowerCase().trim()
        ) {
          exactMatches++;
        } else {
          partialMatches++;
        }
      }
    }

    if (exactMatches === supplierOptions.length) {
      return 'exact';
    } else if (exactMatches + partialMatches >= supplierOptions.length / 2) {
      return 'partial';
    } else {
      return 'none';
    }
  }

  /**
   * Delete variant mapping (unmaps a variant)
   */
  static async deleteVariantMapping(
    productMappingId: string,
    supplierVariantId: string
  ): Promise<void> {
    try {
      await prisma.variantMapping.deleteMany({
        where: {
          productMappingId,
          supplierVariantId,
        },
      });

      logger.info(`Deleted variant mapping for ${supplierVariantId}`);
    } catch (error) {
      logger.error(`Error deleting variant mapping:`, error);
      throw error;
    }
  }
}
