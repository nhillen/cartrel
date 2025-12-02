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
   * Bulk update variant prices grouped by product
   * Uses productVariantsBulkUpdate for efficiency (up to 100 variants per product)
   */
  async bulkUpdateVariantPrices(
    shop: any,
    updates: Array<{
      productId: string;
      variantId: string;
      price: number;
      compareAtPrice: number | null;
    }>
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    if (updates.length === 0) {
      return { success: 0, failed: 0, errors: [] };
    }

    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);
    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    // Group updates by product
    const byProduct = new Map<string, typeof updates>();
    for (const update of updates) {
      const productGid = update.productId.startsWith('gid://')
        ? update.productId
        : `gid://shopify/Product/${update.productId}`;
      const existing = byProduct.get(productGid) || [];
      existing.push(update);
      byProduct.set(productGid, existing);
    }

    const mutation = `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Process each product's variants in bulk
    for (const [productGid, productUpdates] of byProduct) {
      const variants = productUpdates.map((u) => {
        const variantGid = u.variantId.startsWith('gid://')
          ? u.variantId
          : `gid://shopify/ProductVariant/${u.variantId}`;

        const variant: any = {
          id: variantGid,
          price: u.price.toFixed(2),
        };

        if (u.compareAtPrice !== null) {
          variant.compareAtPrice = u.compareAtPrice.toFixed(2);
        }

        return variant;
      });

      try {
        const response: any = await client.request(mutation, {
          variables: {
            productId: productGid,
            variants,
          },
        });

        if (response.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
          for (const error of response.data.productVariantsBulkUpdate.userErrors) {
            errors.push(`${productGid}: ${error.field} - ${error.message}`);
          }
          failed += productUpdates.length;
        } else {
          success += response.data?.productVariantsBulkUpdate?.productVariants?.length || 0;
        }
      } catch (error) {
        errors.push(`${productGid}: ${error instanceof Error ? error.message : 'Unknown'}`);
        failed += productUpdates.length;
      }
    }

    logger.info(
      `Bulk updated ${success} variant prices across ${byProduct.size} products (${failed} failed)`
    );

    return { success, failed, errors };
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

  // ============================================================================
  // MARKETS-AWARE PRICING
  // ============================================================================

  /**
   * Discover markets configured on a shop
   */
  async discoverMarkets(shop: { myshopifyDomain: string; accessToken: string }): Promise<
    Array<{
      id: string;
      name: string;
      primary: boolean;
      currency: string;
      regions: string[];
    }>
  > {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query getMarkets {
        markets(first: 50) {
          edges {
            node {
              id
              name
              primary
              currencySettings {
                baseCurrency {
                  currencyCode
                }
              }
              regions(first: 20) {
                edges {
                  node {
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query);

      const markets = response.data?.markets?.edges?.map((edge: any) => ({
        id: edge.node.id,
        name: edge.node.name,
        primary: edge.node.primary,
        currency: edge.node.currencySettings?.baseCurrency?.currencyCode || 'USD',
        regions: edge.node.regions?.edges?.map((r: any) => r.node.name) || [],
      }));

      return markets || [];
    } catch (error) {
      logger.error('Error discovering markets:', error);
      return [];
    }
  }

  /**
   * Get price lists for a shop (used for market-specific pricing)
   */
  async getPriceLists(shop: { myshopifyDomain: string; accessToken: string }): Promise<
    Array<{
      id: string;
      name: string;
      currency: string;
      marketId: string | null;
    }>
  > {
    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);

    const query = `
      query getPriceLists {
        priceLists(first: 50) {
          edges {
            node {
              id
              name
              currency
              contextRule {
                marketId
              }
            }
          }
        }
      }
    `;

    try {
      const response: any = await client.request(query);

      const priceLists = response.data?.priceLists?.edges?.map((edge: any) => ({
        id: edge.node.id,
        name: edge.node.name,
        currency: edge.node.currency,
        marketId: edge.node.contextRule?.marketId || null,
      }));

      return priceLists || [];
    } catch (error) {
      logger.error('Error getting price lists:', error);
      return [];
    }
  }

  /**
   * Set market-specific price rules for a connection
   */
  async setMarketPriceRules(
    connectionId: string,
    marketRules: Array<{
      marketId: string;
      marketName: string;
      rule: PriceRule;
    }>
  ): Promise<void> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new Error('Connection not found');
    }

    // Store as JSON in priceRulesConfig alongside base rule
    const existingConfig = (connection.priceRulesConfig as any) || {};

    const updatedConfig = {
      ...existingConfig,
      marketRules: marketRules.map((mr) => ({
        marketId: mr.marketId,
        marketName: mr.marketName,
        rule: mr.rule,
      })),
    };

    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        priceRulesConfig: updatedConfig as Prisma.InputJsonValue,
      },
    });

    logger.info(
      `Set ${marketRules.length} market-specific price rules for connection ${connectionId}`
    );
  }

  /**
   * Get market-specific price rules for a connection
   */
  async getMarketPriceRules(connectionId: string): Promise<MarketPriceRule[]> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { priceRulesConfig: true },
    });

    if (!connection?.priceRulesConfig) {
      return [];
    }

    const config = connection.priceRulesConfig as any;
    return config.marketRules || [];
  }

  /**
   * Apply price rule to a price list for market-specific pricing
   */
  async applyPriceToMarket(
    shop: { myshopifyDomain: string; accessToken: string },
    priceListId: string,
    prices: Array<{
      variantId: string;
      price: number;
      compareAtPrice?: number;
    }>
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    if (prices.length === 0) {
      return { success: 0, failed: 0, errors: [] };
    }

    const client = createShopifyGraphQLClient(shop.myshopifyDomain, shop.accessToken);
    const errors: string[] = [];
    let success = 0;
    let failed = 0;

    // Batch prices (max 100 per call)
    const batchSize = 100;

    for (let i = 0; i < prices.length; i += batchSize) {
      const batch = prices.slice(i, i + batchSize);

      const mutation = `
        mutation priceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
          priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
            prices {
              variant {
                id
              }
              price {
                amount
                currencyCode
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const priceInputs = batch.map((p) => {
        const input: any = {
          variantId: p.variantId.startsWith('gid://')
            ? p.variantId
            : `gid://shopify/ProductVariant/${p.variantId}`,
          price: {
            amount: p.price.toFixed(2),
            currencyCode: 'USD', // TODO: Get from price list
          },
        };

        if (p.compareAtPrice !== undefined) {
          input.compareAtPrice = {
            amount: p.compareAtPrice.toFixed(2),
            currencyCode: 'USD',
          };
        }

        return input;
      });

      try {
        const response: any = await client.request(mutation, {
          variables: {
            priceListId,
            prices: priceInputs,
          },
        });

        if (response.data?.priceListFixedPricesAdd?.userErrors?.length > 0) {
          for (const error of response.data.priceListFixedPricesAdd.userErrors) {
            errors.push(`${error.field}: ${error.message}`);
          }
          failed += batch.length;
        } else {
          success += response.data?.priceListFixedPricesAdd?.prices?.length || 0;
        }
      } catch (error) {
        errors.push(
          `Batch ${i / batchSize + 1}: ${error instanceof Error ? error.message : 'Unknown'}`
        );
        failed += batch.length;
      }
    }

    logger.info(`Applied ${success} prices to price list ${priceListId} (${failed} failed)`);

    return { success, failed, errors };
  }

  /**
   * Calculate price for a specific market using market-specific rules
   */
  calculateMarketPrice(
    sourcePrice: number,
    baseRule: PriceRule,
    marketRules: MarketPriceRule[],
    targetMarketId: string
  ): number {
    // Check for market-specific rule
    const marketRule = marketRules.find((mr) => mr.marketId === targetMarketId);

    if (marketRule) {
      return this.calculatePrice(sourcePrice, marketRule.rule);
    }

    // Fall back to base rule
    return this.calculatePrice(sourcePrice, baseRule);
  }
}

export const PriceRuleService = new PriceRuleServiceClass();
