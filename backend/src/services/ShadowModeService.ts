/**
 * ShadowModeService - Enables zero-downtime Syncio migration
 *
 * Core responsibilities:
 * - Compare Cartrel vs Syncio pricing for a shop
 * - Preview what would change if migrating from Syncio
 * - Provide migration report showing gaps and benefits
 * - Allow testing imports without disrupting existing Syncio setup
 *
 * The "Shadow Mode" concept:
 * - Retailers can connect suppliers via Cartrel while keeping Syncio active
 * - Preview imports without actually creating products in Shopify
 * - Compare costs, features, and product coverage side-by-side
 * - When ready, switch to Cartrel with one click
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';
import { PLAN_LIMITS } from '../utils/planLimits';

// Syncio pricing as of Nov 2024 (from their website)
const SYNCIO_PRICING = {
  STARTER: {
    name: 'Starter',
    price: 29,
    priceAnnual: 290,
    connections: 1,
    products: 100,
    orders: 100,
  },
  BASIC: {
    name: 'Basic',
    price: 59,
    priceAnnual: 590,
    connections: 5,
    products: 500,
    orders: 500,
  },
  PROFESSIONAL: {
    name: 'Professional',
    price: 129,
    priceAnnual: 1290,
    connections: 10,
    products: 5000,
    orders: 1000,
  },
  ADVANCED: {
    name: 'Advanced',
    price: 299,
    priceAnnual: 2990,
    connections: 25,
    products: 20000,
    orders: 2000,
  },
};

interface PricingComparison {
  cartrelPlan: string;
  cartrelMonthly: number;
  cartrelAnnual: number;
  syncioPlan: string;
  syncioMonthly: number;
  syncioAnnual: number;
  monthlySavings: number;
  annualSavings: number;
  percentageSavings: number;
  cartrelLimits: {
    connections: number;
    products: number;
    orders: number;
  };
  syncioLimits: {
    connections: number;
    products: number;
    orders: number;
  };
}

interface FeatureComparison {
  feature: string;
  cartrel: boolean | string;
  syncio: boolean | string;
  advantage: 'cartrel' | 'syncio' | 'tie';
}

interface MigrationPreview {
  currentSetup: {
    platform: 'syncio' | 'none';
    estimatedMonthlySpend: number;
    connectedSuppliers: number;
    importedProducts: number;
  };
  cartrelSetup: {
    recommendedPlan: string;
    monthlyPrice: number;
    annualPrice: number;
    limits: any;
  };
  savings: {
    monthly: number;
    annual: number;
    percentage: number;
  };
  migrationSteps: string[];
  risks: string[];
  benefits: string[];
}

export class ShadowModeService {
  /**
   * Compare Cartrel pricing vs Syncio for a shop's needs
   */
  static async comparePricing(
    connections: number,
    products: number,
    orders: number
  ): Promise<PricingComparison> {
    try {
      logger.info(
        `Comparing pricing for: ${connections} connections, ${products} products, ${orders} orders`
      );

      // Find the best Cartrel plan
      let cartrelPlan = 'FREE';
      let cartrelLimits = PLAN_LIMITS.FREE;

      for (const [planName, limits] of Object.entries(PLAN_LIMITS)) {
        if (
          connections <= limits.maxConnections &&
          products <= limits.maxProducts &&
          orders <= limits.maxPurchaseOrdersPerMonth
        ) {
          cartrelPlan = planName;
          cartrelLimits = limits;
          break;
        }
      }

      // Find the best Syncio plan
      let syncioPlan = 'STARTER';
      let syncioLimits = SYNCIO_PRICING.STARTER;

      for (const [planName, limits] of Object.entries(SYNCIO_PRICING)) {
        if (
          connections <= limits.connections &&
          products <= limits.products &&
          orders <= limits.orders
        ) {
          syncioPlan = planName;
          syncioLimits = limits;
          break;
        }
      }

      const cartrelMonthly = cartrelLimits.price;
      const cartrelAnnual = cartrelLimits.priceAnnual;
      const syncioMonthly = syncioLimits.price;
      const syncioAnnual = syncioLimits.priceAnnual;

      const monthlySavings = syncioMonthly - cartrelMonthly;
      const annualSavings = syncioAnnual - cartrelAnnual;
      const percentageSavings =
        syncioMonthly > 0 ? Math.round((monthlySavings / syncioMonthly) * 100) : 0;

      logger.info(
        `Pricing comparison: Cartrel ${cartrelPlan} ($${cartrelMonthly}/mo) vs Syncio ${syncioPlan} ($${syncioMonthly}/mo) - Save ${percentageSavings}%`
      );

      return {
        cartrelPlan,
        cartrelMonthly,
        cartrelAnnual,
        syncioPlan,
        syncioMonthly,
        syncioAnnual,
        monthlySavings,
        annualSavings,
        percentageSavings,
        cartrelLimits: {
          connections: cartrelLimits.maxConnections,
          products: cartrelLimits.maxProducts,
          orders: cartrelLimits.maxPurchaseOrdersPerMonth,
        },
        syncioLimits: {
          connections: syncioLimits.connections,
          products: syncioLimits.products,
          orders: syncioLimits.orders,
        },
      };
    } catch (error) {
      logger.error('Error comparing pricing:', error);
      throw error;
    }
  }

  /**
   * Compare Cartrel vs Syncio features
   */
  static getFeatureComparison(): FeatureComparison[] {
    return [
      {
        feature: 'Base Price',
        cartrel: '$15/month',
        syncio: '$29/month',
        advantage: 'cartrel',
      },
      {
        feature: 'Free Tier',
        cartrel: 'Yes (3 connections, 25 products)',
        syncio: 'No',
        advantage: 'cartrel',
      },
      {
        feature: 'One-sided Billing',
        cartrel: 'Yes (only supplier pays)',
        syncio: 'Both sides pay',
        advantage: 'cartrel',
      },
      {
        feature: 'Order Forwarding',
        cartrel: 'Included',
        syncio: 'Extra cost',
        advantage: 'cartrel',
      },
      {
        feature: 'Automatic Inventory Sync',
        cartrel: true,
        syncio: true,
        advantage: 'tie',
      },
      {
        feature: 'Price Sync',
        cartrel: true,
        syncio: true,
        advantage: 'tie',
      },
      {
        feature: 'Field-level Sync Control',
        cartrel: 'Yes (title, description, images, pricing, inventory, tags, SEO)',
        syncio: 'Limited',
        advantage: 'cartrel',
      },
      {
        feature: 'Conflict Resolution Modes',
        cartrel: 'SUPPLIER_WINS, RETAILER_WINS, REVIEW_QUEUE',
        syncio: 'Limited',
        advantage: 'cartrel',
      },
      {
        feature: '30-day Rollback',
        cartrel: 'Yes (ProductSnapshot)',
        syncio: 'No',
        advantage: 'cartrel',
      },
      {
        feature: 'Import Preview with Diffs',
        cartrel: true,
        syncio: false,
        advantage: 'cartrel',
      },
      {
        feature: 'Async Imports (1000+ products)',
        cartrel: 'Yes with progress tracking',
        syncio: 'Limited',
        advantage: 'cartrel',
      },
      {
        feature: 'Shadow Mode (test without disrupting)',
        cartrel: true,
        syncio: false,
        advantage: 'cartrel',
      },
      {
        feature: 'Health Panel',
        cartrel: 'Yes (webhook errors, sync issues)',
        syncio: 'Limited',
        advantage: 'cartrel',
      },
      {
        feature: 'Multi-vendor Order Routing',
        cartrel: 'Yes (OrderRouterRule)',
        syncio: 'No',
        advantage: 'cartrel',
      },
      {
        feature: 'Variant Mapping',
        cartrel: true,
        syncio: true,
        advantage: 'tie',
      },
      {
        feature: 'Payment Terms (NET 15/30/60)',
        cartrel: true,
        syncio: 'Limited',
        advantage: 'cartrel',
      },
      {
        feature: 'Annual Pricing Discount',
        cartrel: '16.7% (pay 10, get 12)',
        syncio: '~15%',
        advantage: 'cartrel',
      },
      {
        feature: 'Grandfathered Pricing',
        cartrel: 'Yes (planVersion locks early customer pricing)',
        syncio: 'Unknown',
        advantage: 'cartrel',
      },
    ];
  }

  /**
   * Preview migration from Syncio to Cartrel
   */
  static async previewMigration(shopId: string): Promise<MigrationPreview> {
    try {
      logger.info(`Previewing Syncio migration for shop ${shopId}`);

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        include: {
          supplierConnections: {
            where: { status: 'ACTIVE' },
          },
          retailerConnections: {
            where: { status: 'ACTIVE' },
          },
        },
      });

      if (!shop) {
        throw new Error(`Shop ${shopId} not found`);
      }

      // Get current usage stats
      const connectedSuppliers = shop.retailerConnections.length;

      const importedProducts = await prisma.productMapping.count({
        where: {
          connection: {
            retailerShopId: shopId,
            status: 'ACTIVE',
          },
        },
      });

      const ordersThisMonth = await prisma.purchaseOrder.count({
        where: {
          retailerShopId: shopId,
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      });

      // Estimate Syncio cost (assume they're on the appropriate plan)
      const pricingComparison = await this.comparePricing(
        connectedSuppliers,
        importedProducts,
        ordersThisMonth
      );

      // Build migration preview
      const preview: MigrationPreview = {
        currentSetup: {
          platform: 'syncio', // Assume they're migrating from Syncio
          estimatedMonthlySpend: pricingComparison.syncioMonthly,
          connectedSuppliers,
          importedProducts,
        },
        cartrelSetup: {
          recommendedPlan: pricingComparison.cartrelPlan,
          monthlyPrice: pricingComparison.cartrelMonthly,
          annualPrice: pricingComparison.cartrelAnnual,
          limits: pricingComparison.cartrelLimits,
        },
        savings: {
          monthly: pricingComparison.monthlySavings,
          annual: pricingComparison.annualSavings,
          percentage: pricingComparison.percentageSavings,
        },
        migrationSteps: [
          '1. Keep Syncio active (no disruption to current operations)',
          '2. Install Cartrel app and connect suppliers',
          '3. Use Shadow Mode to preview imports without creating products',
          '4. Compare pricing, features, and product coverage side-by-side',
          '5. When ready, import products via Cartrel (creates new products)',
          '6. Test for 30 days with both platforms active',
          '7. Once confident, delete Syncio-managed products',
          '8. Uninstall Syncio and enjoy lower pricing',
        ],
        risks: [
          'Temporary duplicate products during migration (easily manageable with tags)',
          'Need to update internal processes to use Cartrel ordering flow',
          'Suppliers need to install Cartrel app (but they save money too!)',
        ],
        benefits: [
          `Save $${pricingComparison.monthlySavings}/month ($${pricingComparison.annualSavings}/year)`,
          'One-sided billing (only supplier pays)',
          'Better sync control (field-level toggles)',
          'Import preview with diffs',
          '30-day rollback capability',
          'Health panel for monitoring sync issues',
          'Order forwarding included (no extra cost)',
          'Better conflict resolution',
          'Free tier for testing',
        ],
      };

      logger.info(
        `Migration preview: Save ${preview.savings.percentage}% ($${preview.savings.monthly}/mo)`
      );

      return preview;
    } catch (error) {
      logger.error(`Error previewing migration for shop ${shopId}:`, error);
      throw error;
    }
  }

  /**
   * Enable shadow mode for a connection
   * In shadow mode, imports don't create actual products - just ProductMappings
   */
  static async enableShadowMode(connectionId: string): Promise<void> {
    try {
      logger.info(`Enabling shadow mode for connection ${connectionId}`);

      await prisma.connection.update({
        where: { id: connectionId },
        data: {
          // Store shadow mode flag in perks config
          perksConfig: {
            shadowMode: true,
            shadowModeEnabledAt: new Date().toISOString(),
          },
        },
      });

      logger.info(`Shadow mode enabled for connection ${connectionId}`);
    } catch (error) {
      logger.error(`Error enabling shadow mode for connection ${connectionId}:`, error);
      throw error;
    }
  }

  /**
   * Disable shadow mode (switch to production)
   */
  static async disableShadowMode(connectionId: string): Promise<void> {
    try {
      logger.info(`Disabling shadow mode for connection ${connectionId}`);

      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      const perksConfig = connection.perksConfig as any;

      await prisma.connection.update({
        where: { id: connectionId },
        data: {
          perksConfig: {
            ...perksConfig,
            shadowMode: false,
            shadowModeDisabledAt: new Date().toISOString(),
          },
        },
      });

      logger.info(`Shadow mode disabled for connection ${connectionId}`);
    } catch (error) {
      logger.error(`Error disabling shadow mode for connection ${connectionId}:`, error);
      throw error;
    }
  }

  /**
   * Get shadow mode statistics for a connection
   */
  static async getShadowModeStats(connectionId: string): Promise<any> {
    try {
      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      const perksConfig = connection.perksConfig as any;
      const isShadowMode = perksConfig?.shadowMode === true;

      // Count products imported in shadow mode (those without retailerShopifyProductId)
      const shadowImports = await prisma.productMapping.count({
        where: {
          connectionId,
          retailerShopifyProductId: null, // Shadow mode imports don't create products
        },
      });

      // Count actual products imported
      const realImports = await prisma.productMapping.count({
        where: {
          connectionId,
          retailerShopifyProductId: { not: null },
        },
      });

      return {
        connectionId,
        isShadowMode,
        shadowModeEnabledAt: perksConfig?.shadowModeEnabledAt,
        shadowImports,
        realImports,
        totalMappings: shadowImports + realImports,
        readyToMigrate: shadowImports > 0 && !isShadowMode,
      };
    } catch (error) {
      logger.error(`Error getting shadow mode stats for connection ${connectionId}:`, error);
      throw error;
    }
  }

  /**
   * Promote shadow imports to real products
   * This is called when retailer is ready to fully migrate from Syncio
   */
  static async promoteShadowImports(
    connectionId: string,
    productMappingIds: string[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    try {
      logger.info(
        `Promoting ${productMappingIds.length} shadow imports to real products for connection ${connectionId}`
      );

      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        include: {
          retailerShop: true,
        },
      });

      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      // Import each product using ProductImportService
      const { ProductImportService } = await import('./ProductImportService');

      for (const mappingId of productMappingIds) {
        try {
          const mapping = await prisma.productMapping.findUnique({
            where: { id: mappingId },
            include: { supplierProduct: true },
          });

          if (!mapping) {
            errors.push(`Mapping ${mappingId} not found`);
            failed++;
            continue;
          }

          if (mapping.retailerShopifyProductId) {
            // Already promoted
            success++;
            continue;
          }

          // Create product in Shopify
          const result = await ProductImportService.importProducts(
            connectionId,
            [mapping.supplierProduct.id],
            {
              syncTitle: mapping.syncTitle,
              syncDescription: mapping.syncDescription,
              syncImages: mapping.syncImages,
              syncPricing: mapping.syncPricing,
              syncInventory: mapping.syncInventory,
              syncTags: mapping.syncTags,
              syncSEO: mapping.syncSEO,
              retailerMarkupType: mapping.retailerMarkupType,
              retailerMarkupValue: mapping.retailerMarkupValue.toString(),
              conflictMode: mapping.conflictMode,
            },
            true // createInShopify = true
          );

          if (result.results[0]?.success) {
            success++;
          } else {
            failed++;
            errors.push(
              `Product ${mapping.supplierProduct.title}: ${result.results[0]?.error || 'Unknown error'}`
            );
          }
        } catch (error) {
          failed++;
          errors.push(
            `Mapping ${mappingId}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      logger.info(
        `Shadow import promotion complete: ${success} success, ${failed} failed`
      );

      return { success, failed, errors };
    } catch (error) {
      logger.error(`Error promoting shadow imports for connection ${connectionId}:`, error);
      throw error;
    }
  }
}
