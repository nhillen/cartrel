/**
 * PriceRuleService - Per-connection price rules and markups
 *
 * Per PRD_PRICE_RULES:
 * - Per-connection price strategy (markup/markdown/fixed)
 * - Optional per-market overrides (Shopify Markets)
 * - Currency awareness and safeguards
 * - Preview before applying, batch updates
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { logger } from '../utils/logger';
import { createShopifyGraphQLClient } from './shopify';
import { ConnectionHealthService } from './ConnectionHealthService';
import { RateLimitService } from './RateLimitService';

// Price rule types
export type PriceRuleType =
  | 'MIRROR'
  | 'MARKUP_PERCENT'
  | 'MARKDOWN_PERCENT'
  | 'MARKUP_FIXED'
  | 'MARKDOWN_FIXED';

export interface PriceRule {
  type: PriceRuleType;
  value: number; // Percentage or fixed amount
  roundTo?: number; // Round to nearest (e.g., 0.99)
  applyToCompareAt: boolean;
}

export interface MarketPriceRule {
  marketId: string;
  marketName: string;
  rule: PriceRule;
}

export interface PricePreview {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  sourcePrice: number;
  sourceCurrency: string;
  calculatedPrice: number;
  destCurrency: string;
  priceChange: number;
  priceChangePercent: number;
}

export interface ApplyPriceResult {
  success: boolean;
  productId: string;
  variantId: string;
  newPrice?: number;
  error?: string;
}

class PriceRuleServiceClass {
  /**
   * Get price rule for a connection
   */
  async getPriceRule(connectionId: string): Promise<PriceRule | null> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: {
        priceRulesEnabled: true,
        priceRulesConfig: true,
      },
    });

    if (!connection) {
      return null;
    }

    // If price rules not enabled, return MIRROR
    if (!connection.priceRulesEnabled) {
      return {
        type: 'MIRROR',
        value: 0,
        applyToCompareAt: false,
      };
    }

    // Parse priceRulesConfig JSON
    const config = connection.priceRulesConfig as {
      strategy?: string;
      value?: number;
      roundTo?: number;
      applyToCompareAt?: boolean;
    } | null;

    if (!config || !config.strategy) {
      return {
        type: 'MIRROR',
        value: 0,
        applyToCompareAt: false,
      };
    }

    return {
      type: config.strategy as PriceRuleType,
      value: config.value || 0,
      roundTo: config.roundTo,
      applyToCompareAt: config.applyToCompareAt ?? true,
    };
  }

  /**
   * Save price rule for a connection
   */
  async savePriceRule(connectionId: string, rule: PriceRule): Promise<void> {
    const isMirror = rule.type === 'MIRROR';

    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        priceRulesEnabled: !isMirror,
        priceRulesConfig: isMirror
          ? Prisma.DbNull
          : {
              strategy: rule.type,
              value: rule.value,
              roundTo: rule.roundTo,
              applyToCompareAt: rule.applyToCompareAt,
            },
      },
    });

    logger.info(`Saved price rule for connection ${connectionId}: ${rule.type} ${rule.value}`);
  }

  /**
   * Calculate price based on rule
   */
  calculatePrice(sourcePrice: number, rule: PriceRule): number {
    let calculatedPrice: number;

    switch (rule.type) {
      case 'MIRROR':
        calculatedPrice = sourcePrice;
        break;

      case 'MARKUP_PERCENT':
        calculatedPrice = sourcePrice * (1 + rule.value / 100);
        break;

      case 'MARKDOWN_PERCENT':
        calculatedPrice = sourcePrice * (1 - rule.value / 100);
        break;

      case 'MARKUP_FIXED':
        calculatedPrice = sourcePrice + rule.value;
        break;

      case 'MARKDOWN_FIXED':
        calculatedPrice = sourcePrice - rule.value;
        break;

      default:
        calculatedPrice = sourcePrice;
    }

    // Ensure non-negative
    calculatedPrice = Math.max(0, calculatedPrice);

    // Round if specified
    if (rule.roundTo) {
      calculatedPrice = this.roundToNearest(calculatedPrice, rule.roundTo);
    } else {
      // Default: round to 2 decimal places
      calculatedPrice = Math.round(calculatedPrice * 100) / 100;
    }

    return calculatedPrice;
  }

  /**
   * Round price to nearest value (e.g., .99 or .95)
   */
  private roundToNearest(price: number, roundTo: number): number {
    const wholePart = Math.floor(price);
    const decimalPart = price - wholePart;

    if (roundTo >= 1) {
      // Round to nearest whole number
      return Math.round(price / roundTo) * roundTo;
    }

    // Round decimal part
    if (decimalPart >= roundTo) {
      return wholePart + roundTo;
    } else {
      return wholePart > 0 ? wholePart - 1 + roundTo : roundTo;
    }
  }

  /**
   * Preview price changes for products
   */
  async previewPriceChanges(
    connectionId: string,
    rule: PriceRule,
    limit: number = 50
  ): Promise<PricePreview[]> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    // Get mapped products
    const mappings = await prisma.productMapping.findMany({
      where: {
        connectionId,
        status: 'ACTIVE',
        retailerShopifyProductId: { not: null },
      },
      take: limit,
      select: {
        supplierShopifyProductId: true,
        supplierShopifyVariantId: true,
        retailerShopifyProductId: true,
        retailerShopifyVariantId: true,
      },
    });

    if (mappings.length === 0) {
      return [];
    }

    // Fetch source prices
    const sourcePrices = await this.fetchProductPrices(
      connection.supplierShop,
      mappings.map((m) => m.supplierShopifyProductId)
    );

    const previews: PricePreview[] = [];

    for (const mapping of mappings) {
      const sourceData = sourcePrices.get(mapping.supplierShopifyProductId);
      if (!sourceData) continue;

      for (const variant of sourceData.variants) {
        const sourcePrice = parseFloat(variant.price);
        const calculatedPrice = this.calculatePrice(sourcePrice, rule);
        const priceChange = calculatedPrice - sourcePrice;
        const priceChangePercent =
          sourcePrice > 0 ? Math.round((priceChange / sourcePrice) * 100 * 10) / 10 : 0;

        previews.push({
          productId: mapping.supplierShopifyProductId,
          productTitle: sourceData.title,
          variantId: variant.id,
          variantTitle: variant.title,
          sourcePrice,
          sourceCurrency: sourceData.currency,
          calculatedPrice,
          destCurrency: sourceData.currency, // Assuming same currency for now
          priceChange,
          priceChangePercent,
        });
      }
    }

    return previews;
  }

  /**
   * Apply price rule to all mapped products
   */
  async applyPriceRule(
    connectionId: string,
    options?: {
      productIds?: string[];
      dryRun?: boolean;
    }
  ): Promise<{
    total: number;
    updated: number;
    failed: number;
    results: ApplyPriceResult[];
  }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    const rule = await this.getPriceRule(connectionId);
    if (!rule) {
      throw new Error('No price rule configured');
    }

    // Get mappings to update
    const whereClause: any = {
      connectionId,
      status: 'ACTIVE',
      retailerShopifyProductId: { not: null },
    };

    if (options?.productIds) {
      whereClause.supplierShopifyProductId = { in: options.productIds };
    }

    const mappings = await prisma.productMapping.findMany({
      where: whereClause,
      select: {
        supplierShopifyProductId: true,
        retailerShopifyProductId: true,
        retailerShopifyVariantId: true,
      },
    });

    if (mappings.length === 0) {
      return { total: 0, updated: 0, failed: 0, results: [] };
    }

    // Fetch source prices in batches
    const sourcePrices = await this.fetchProductPrices(
      connection.supplierShop,
      mappings.map((m) => m.supplierShopifyProductId)
    );

    const results: ApplyPriceResult[] = [];
    let updated = 0;
    let failed = 0;

    // Process in batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < mappings.length; i += batchSize) {
      const batch = mappings.slice(i, i + batchSize);

      // Check rate limit
      const delay = await RateLimitService.getRequiredDelay(
        connection.retailerShop.myshopifyDomain
      );
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      for (const mapping of batch) {
        const sourceData = sourcePrices.get(mapping.supplierShopifyProductId);
        if (!sourceData) {
          results.push({
            success: false,
            productId: mapping.supplierShopifyProductId,
            variantId: mapping.retailerShopifyVariantId || '',
            error: 'Source product not found',
          });
          failed++;
          continue;
        }

        // Find the variant
        const sourceVariant =
          sourceData.variants.find((v) => v.id.includes(mapping.retailerShopifyVariantId || '')) ||
          sourceData.variants[0];

        const sourcePrice = parseFloat(sourceVariant.price);
        const newPrice = this.calculatePrice(sourcePrice, rule);

        if (options?.dryRun) {
          results.push({
            success: true,
            productId: mapping.supplierShopifyProductId,
            variantId: mapping.retailerShopifyVariantId || '',
            newPrice,
          });
          updated++;
          continue;
        }

        // Apply price to destination
        const success = await this.updateVariantPrice(
          connection.retailerShop,
          mapping.retailerShopifyVariantId!,
          newPrice,
          rule.applyToCompareAt ? sourceVariant.compareAtPrice : null
        );

        if (success) {
          results.push({
            success: true,
            productId: mapping.retailerShopifyProductId!,
            variantId: mapping.retailerShopifyVariantId!,
            newPrice,
          });
          updated++;
        } else {
          results.push({
            success: false,
            productId: mapping.retailerShopifyProductId!,
            variantId: mapping.retailerShopifyVariantId!,
            error: 'Failed to update price',
          });
          failed++;
        }
      }
    }

    // Log activity
    if (!options?.dryRun) {
      await ConnectionHealthService.logActivity(connectionId, {
        type: 'CATALOG_UPDATE',
        resourceType: 'PRODUCT',
        message: `Applied price rule: ${updated} updated, ${failed} failed`,
        details: { rule, updated, failed },
      });
    }

    logger.info(
      `Applied price rule to connection ${connectionId}: ${updated} updated, ${failed} failed`
    );

    return {
      total: mappings.length,
      updated,
      failed,
      results,
    };
  }

  /**
   * Apply price to a single product during sync
   */
  async applyPriceOnSync(
    connectionId: string,
    sourcePrice: number,
    sourceCompareAtPrice: number | null
  ): Promise<{ price: number; compareAtPrice: number | null }> {
    const rule = await this.getPriceRule(connectionId);

    if (!rule || rule.type === 'MIRROR') {
      return { price: sourcePrice, compareAtPrice: sourceCompareAtPrice };
    }

    const newPrice = this.calculatePrice(sourcePrice, rule);
    let newCompareAtPrice: number | null = null;

    if (rule.applyToCompareAt && sourceCompareAtPrice) {
      newCompareAtPrice = this.calculatePrice(sourceCompareAtPrice, rule);
    }

    return { price: newPrice, compareAtPrice: newCompareAtPrice };
  }

  /**
   * Fetch product prices from Shopify
   */
  private async fetchProductPrices(
    shop: any,
    productIds: string[]
  ): Promise<Map<string, { title: string; currency: string; variants: any[] }>> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const result = new Map<string, { title: string; currency: string; variants: any[] }>();

    // Fetch in batches of 10
    const batchSize = 10;
    for (let i = 0; i < productIds.length; i += batchSize) {
      const batch = productIds.slice(i, i + batchSize);

      const gids = batch.map((id) =>
        id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`
      );

      const query = `
        query getProductPrices($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              priceRangeV2 {
                minVariantPrice {
                  currencyCode
                }
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                  }
                }
              }
            }
          }
        }
      `;

      try {
        const response: any = await client.request(query, {
          variables: { ids: gids },
        });

        for (const node of response.nodes || []) {
          if (!node) continue;

          const productId = node.id.replace('gid://shopify/Product/', '');
          result.set(productId, {
            title: node.title,
            currency: node.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
            variants: (node.variants?.edges || []).map((e: any) => e.node),
          });
        }
      } catch (error) {
        logger.error('Error fetching product prices:', error);
      }
    }

    return result;
  }

  /**
   * Update variant price on destination
   */
  private async updateVariantPrice(
    shop: any,
    variantId: string,
    price: number,
    compareAtPrice: number | null
  ): Promise<boolean> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const gid = variantId.startsWith('gid://')
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const mutation = `
      mutation updateVariantPrice($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
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
      id: gid,
      price: price.toFixed(2),
    };

    if (compareAtPrice !== null) {
      input.compareAtPrice = compareAtPrice.toFixed(2);
    }

    try {
      const response: any = await client.request(mutation, {
        variables: { input },
      });

      return response.productVariantUpdate?.userErrors?.length === 0;
    } catch (error) {
      logger.error('Error updating variant price:', error);
      return false;
    }
  }

  /**
   * Check currency compatibility between shops
   */
  async checkCurrencyCompatibility(connectionId: string): Promise<{
    compatible: boolean;
    sourceCurrency: string;
    destCurrency: string;
    warning?: string;
  }> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: {
        supplierShop: true,
        retailerShop: true,
      },
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    // Fetch shop currencies
    const [sourceCurrency, destCurrency] = await Promise.all([
      this.getShopCurrency(connection.supplierShop),
      this.getShopCurrency(connection.retailerShop),
    ]);

    const compatible = sourceCurrency === destCurrency;

    return {
      compatible,
      sourceCurrency,
      destCurrency,
      warning: compatible
        ? undefined
        : `Currency mismatch: source uses ${sourceCurrency}, destination uses ${destCurrency}. Price rules may not work as expected.`,
    };
  }

  /**
   * Get shop's primary currency
   */
  private async getShopCurrency(shop: any): Promise<string> {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query getShopCurrency {
        shop {
          currencyCode
        }
      }
    `;

    try {
      const response: any = await client.request(query);
      return response.shop?.currencyCode || 'USD';
    } catch (error) {
      logger.error('Error fetching shop currency:', error);
      return 'USD';
    }
  }

  /**
   * Get available price rule types with descriptions
   */
  getPriceRuleTypes(): Array<{
    type: PriceRuleType;
    name: string;
    description: string;
    example: string;
  }> {
    return [
      {
        type: 'MIRROR',
        name: 'Mirror Source',
        description: 'Use exact source prices',
        example: '$10.00 → $10.00',
      },
      {
        type: 'MARKUP_PERCENT',
        name: 'Markup (Percentage)',
        description: 'Add percentage to source price',
        example: '20% markup: $10.00 → $12.00',
      },
      {
        type: 'MARKDOWN_PERCENT',
        name: 'Markdown (Percentage)',
        description: 'Reduce source price by percentage',
        example: '20% markdown: $10.00 → $8.00',
      },
      {
        type: 'MARKUP_FIXED',
        name: 'Markup (Fixed Amount)',
        description: 'Add fixed amount to source price',
        example: '$5 markup: $10.00 → $15.00',
      },
      {
        type: 'MARKDOWN_FIXED',
        name: 'Markdown (Fixed Amount)',
        description: 'Reduce source price by fixed amount',
        example: '$3 markdown: $10.00 → $7.00',
      },
    ];
  }
}

export const PriceRuleService = new PriceRuleServiceClass();
