/**
 * BillingEnforcementService - Tier caps and usage enforcement
 *
 * Per PRD_PRICING_PACKAGING:
 * - Enforce caps per tier (connections/products/orders/metafield defs/order forwards)
 * - Soft overages with upgrade prompts
 * - Usage tracking and metering
 * - Single-sided billing (supplier pays)
 */

import { prisma } from '../index';
import { logger } from '../utils/logger';

// Tier definitions
export type TierLevel = 'FREE' | 'STARTER' | 'CORE' | 'PRO' | 'GROWTH' | 'SCALE' | 'MARKETPLACE';

// Tier caps per PRD_PRICING_PACKAGING
export interface TierCaps {
  connections: number;
  products: number;
  ordersPerMonth: number;
  orderPushesPerMonth: number;
  metafieldDefinitions: number;
  features: {
    autoOrderPush: boolean;
    priceSync: boolean;
    multiLocation: boolean;
    advancedFields: boolean; // SEO, cost, HS code
    payouts: boolean;
    marketplace: boolean;
  };
}

export const TIER_CAPS: Record<TierLevel, TierCaps> = {
  FREE: {
    connections: 3,
    products: 150,
    ordersPerMonth: 50,
    orderPushesPerMonth: 10,
    metafieldDefinitions: 10,
    features: {
      autoOrderPush: false,
      priceSync: false,
      multiLocation: false,
      advancedFields: false,
      payouts: false,
      marketplace: false,
    },
  },
  STARTER: {
    connections: 5,
    products: 500,
    ordersPerMonth: 100,
    orderPushesPerMonth: 100,
    metafieldDefinitions: 25,
    features: {
      autoOrderPush: true,
      priceSync: true,
      multiLocation: false,
      advancedFields: false,
      payouts: false,
      marketplace: false,
    },
  },
  CORE: {
    connections: 10,
    products: 1500,
    ordersPerMonth: 300,
    orderPushesPerMonth: 300,
    metafieldDefinitions: 50,
    features: {
      autoOrderPush: true,
      priceSync: true,
      multiLocation: true,
      advancedFields: false,
      payouts: true,
      marketplace: false,
    },
  },
  PRO: {
    connections: 20,
    products: 5000,
    ordersPerMonth: 800,
    orderPushesPerMonth: 800,
    metafieldDefinitions: 200,
    features: {
      autoOrderPush: true,
      priceSync: true,
      multiLocation: true,
      advancedFields: true,
      payouts: true,
      marketplace: false,
    },
  },
  GROWTH: {
    connections: 40,
    products: 20000,
    ordersPerMonth: 2000,
    orderPushesPerMonth: 2000,
    metafieldDefinitions: 500,
    features: {
      autoOrderPush: true,
      priceSync: true,
      multiLocation: true,
      advancedFields: true,
      payouts: true,
      marketplace: true,
    },
  },
  SCALE: {
    connections: 80,
    products: 100000,
    ordersPerMonth: 5000,
    orderPushesPerMonth: 5000,
    metafieldDefinitions: 999999,
    features: {
      autoOrderPush: true,
      priceSync: true,
      multiLocation: true,
      advancedFields: true,
      payouts: true,
      marketplace: true,
    },
  },
  MARKETPLACE: {
    connections: 999999,
    products: 999999,
    ordersPerMonth: 999999,
    orderPushesPerMonth: 999999,
    metafieldDefinitions: 999999,
    features: {
      autoOrderPush: true,
      priceSync: true,
      multiLocation: true,
      advancedFields: true,
      payouts: true,
      marketplace: true,
    },
  },
};

// Usage check result
export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  percentUsed: number;
  isOverLimit: boolean;
  suggestedTier?: TierLevel;
}

// Feature check result
export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;
  requiredTier?: TierLevel;
}

// Full usage report
export interface UsageReport {
  shopId: string;
  tier: TierLevel;
  connections: UsageCheckResult;
  products: UsageCheckResult;
  ordersThisMonth: UsageCheckResult;
  orderPushesThisMonth: UsageCheckResult;
  metafieldDefinitions: UsageCheckResult;
  features: {
    autoOrderPush: boolean;
    priceSync: boolean;
    multiLocation: boolean;
    advancedFields: boolean;
    payouts: boolean;
    marketplace: boolean;
  };
  overallStatus: 'OK' | 'WARNING' | 'BLOCKED';
  warnings: string[];
}

class BillingEnforcementServiceClass {
  /**
   * Get tier caps for a tier level
   */
  getTierCaps(tier: TierLevel): TierCaps {
    return TIER_CAPS[tier] || TIER_CAPS.FREE;
  }

  /**
   * Get the current tier for a shop
   */
  async getShopTier(shopId: string): Promise<TierLevel> {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { plan: true },
    });

    return (shop?.plan?.toUpperCase() as TierLevel) || 'FREE';
  }

  /**
   * Check if a shop can add more connections
   */
  async canAddConnection(shopId: string): Promise<UsageCheckResult> {
    const tier = await this.getShopTier(shopId);
    const caps = this.getTierCaps(tier);

    const currentCount = await prisma.connection.count({
      where: {
        supplierShopId: shopId,
        status: { not: 'TERMINATED' },
      },
    });

    return this.buildUsageResult(currentCount, caps.connections, 'connections', tier);
  }

  /**
   * Check if a shop can add more products
   */
  async canAddProducts(shopId: string, count: number = 1): Promise<UsageCheckResult> {
    const tier = await this.getShopTier(shopId);
    const caps = this.getTierCaps(tier);

    // Count all active mappings across supplier connections
    const currentCount = await prisma.productMapping.count({
      where: {
        connection: {
          supplierShopId: shopId,
          status: { not: 'TERMINATED' },
        },
        status: 'ACTIVE',
      },
    });

    return this.buildUsageResult(currentCount + count - 1, caps.products, 'products', tier);
  }

  /**
   * Check if a shop can process more orders this month
   */
  async canProcessOrder(shopId: string): Promise<UsageCheckResult> {
    const tier = await this.getShopTier(shopId);
    const caps = this.getTierCaps(tier);

    // Get orders processed this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const currentCount = await this.getMonthlyOrderCount(shopId, startOfMonth);

    return this.buildUsageResult(currentCount, caps.ordersPerMonth, 'orders this month', tier);
  }

  /**
   * Check if a shop can push more orders this month
   */
  async canPushOrder(shopId: string): Promise<UsageCheckResult> {
    const tier = await this.getShopTier(shopId);
    const caps = this.getTierCaps(tier);

    // Get order pushes this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const currentCount = await this.getMonthlyOrderPushCount(shopId, startOfMonth);

    return this.buildUsageResult(
      currentCount,
      caps.orderPushesPerMonth,
      'order pushes this month',
      tier
    );
  }

  /**
   * Check if a shop can add more metafield definitions
   */
  async canAddMetafieldDefinition(connectionId: string): Promise<UsageCheckResult> {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { supplierShopId: true },
    });

    if (!connection) {
      return {
        allowed: false,
        reason: 'Connection not found',
        currentUsage: 0,
        limit: 0,
        percentUsed: 0,
        isOverLimit: true,
      };
    }

    const tier = await this.getShopTier(connection.supplierShopId);
    const caps = this.getTierCaps(tier);

    // Count enabled metafield definitions across all connections
    const currentCount = await prisma.metafieldConfig.count({
      where: {
        connection: {
          supplierShopId: connection.supplierShopId,
        },
        syncEnabled: true,
      },
    });

    return this.buildUsageResult(
      currentCount,
      caps.metafieldDefinitions,
      'metafield definitions',
      tier
    );
  }

  /**
   * Check if a feature is available for a shop's tier
   */
  async checkFeature(
    shopId: string,
    feature: keyof TierCaps['features']
  ): Promise<FeatureCheckResult> {
    const tier = await this.getShopTier(shopId);
    const caps = this.getTierCaps(tier);

    if (caps.features[feature]) {
      return { allowed: true };
    }

    // Find the minimum tier that has this feature
    const tiers: TierLevel[] = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE', 'MARKETPLACE'];
    let requiredTier: TierLevel | undefined;

    for (const t of tiers) {
      if (TIER_CAPS[t].features[feature]) {
        requiredTier = t;
        break;
      }
    }

    return {
      allowed: false,
      reason: `${feature} requires ${requiredTier} tier or higher`,
      requiredTier,
    };
  }

  /**
   * Get full usage report for a shop
   */
  async getUsageReport(shopId: string): Promise<UsageReport> {
    const tier = await this.getShopTier(shopId);
    const caps = this.getTierCaps(tier);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Gather all usage data in parallel
    const [connectionCount, productCount, orderCount, pushCount, metafieldCount] =
      await Promise.all([
        prisma.connection.count({
          where: {
            supplierShopId: shopId,
            status: { not: 'TERMINATED' },
          },
        }),
        prisma.productMapping.count({
          where: {
            connection: {
              supplierShopId: shopId,
              status: { not: 'TERMINATED' },
            },
            status: 'ACTIVE',
          },
        }),
        this.getMonthlyOrderCount(shopId, startOfMonth),
        this.getMonthlyOrderPushCount(shopId, startOfMonth),
        prisma.metafieldConfig.count({
          where: {
            connection: {
              supplierShopId: shopId,
            },
            syncEnabled: true,
          },
        }),
      ]);

    const connections = this.buildUsageResult(
      connectionCount,
      caps.connections,
      'connections',
      tier
    );
    const products = this.buildUsageResult(productCount, caps.products, 'products', tier);
    const ordersThisMonth = this.buildUsageResult(orderCount, caps.ordersPerMonth, 'orders', tier);
    const orderPushesThisMonth = this.buildUsageResult(
      pushCount,
      caps.orderPushesPerMonth,
      'order pushes',
      tier
    );
    const metafieldDefinitions = this.buildUsageResult(
      metafieldCount,
      caps.metafieldDefinitions,
      'metafield definitions',
      tier
    );

    // Collect warnings
    const warnings: string[] = [];
    if (connections.percentUsed >= 80)
      warnings.push(`Connection usage at ${connections.percentUsed}%`);
    if (products.percentUsed >= 80) warnings.push(`Product usage at ${products.percentUsed}%`);
    if (ordersThisMonth.percentUsed >= 80)
      warnings.push(`Monthly order usage at ${ordersThisMonth.percentUsed}%`);
    if (orderPushesThisMonth.percentUsed >= 80)
      warnings.push(`Monthly order push usage at ${orderPushesThisMonth.percentUsed}%`);

    // Determine overall status
    let overallStatus: 'OK' | 'WARNING' | 'BLOCKED' = 'OK';
    if (
      connections.isOverLimit ||
      products.isOverLimit ||
      ordersThisMonth.isOverLimit ||
      orderPushesThisMonth.isOverLimit
    ) {
      overallStatus = 'BLOCKED';
    } else if (warnings.length > 0) {
      overallStatus = 'WARNING';
    }

    return {
      shopId,
      tier,
      connections,
      products,
      ordersThisMonth,
      orderPushesThisMonth,
      metafieldDefinitions,
      features: caps.features,
      overallStatus,
      warnings,
    };
  }

  /**
   * Record usage in WebhookLog for order tracking
   * Uses existing WebhookLog to count monthly orders/pushes
   */
  async recordOrderPush(shopId: string, orderId: string, _connectionId: string): Promise<void> {
    // Order pushes are tracked via PurchaseOrder creation
    // This method can be used for additional audit logging if needed
    logger.info(`Recorded order push for shop ${shopId}, order ${orderId}`);
  }

  /**
   * Get suggested tier based on usage
   */
  getSuggestedTier(current: number, limit: number, currentTier: TierLevel): TierLevel | undefined {
    if (current <= limit) return undefined;

    const tiers: TierLevel[] = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE', 'MARKETPLACE'];
    const currentIndex = tiers.indexOf(currentTier);

    // Find the next tier that can accommodate the usage
    for (let i = currentIndex + 1; i < tiers.length; i++) {
      const tierCaps = TIER_CAPS[tiers[i]];
      // Check if any cap in this tier can handle the current usage
      if (
        tierCaps.connections >= current ||
        tierCaps.products >= current ||
        tierCaps.ordersPerMonth >= current ||
        tierCaps.orderPushesPerMonth >= current
      ) {
        return tiers[i];
      }
    }

    return undefined;
  }

  /**
   * Build a usage check result
   */
  private buildUsageResult(
    current: number,
    limit: number,
    metricName: string,
    tier: TierLevel
  ): UsageCheckResult {
    const percentUsed = limit > 0 ? Math.round((current / limit) * 100) : 0;
    const isOverLimit = current >= limit;
    const suggestedTier = isOverLimit ? this.getSuggestedTier(current + 1, limit, tier) : undefined;

    return {
      allowed: !isOverLimit,
      reason: isOverLimit ? `${metricName} limit reached (${current}/${limit})` : undefined,
      currentUsage: current,
      limit,
      percentUsed: Math.min(percentUsed, 100),
      isOverLimit,
      suggestedTier,
    };
  }

  /**
   * Get monthly order count from webhook logs
   */
  private async getMonthlyOrderCount(shopId: string, startOfMonth: Date): Promise<number> {
    // Count order events from webhooks this month
    const count = await prisma.webhookLog.count({
      where: {
        shopId,
        topic: { in: ['ORDERS_CREATE', 'ORDERS_UPDATED'] },
        createdAt: { gte: startOfMonth },
      },
    });

    return count;
  }

  /**
   * Get monthly order push count from purchase orders
   */
  private async getMonthlyOrderPushCount(shopId: string, startOfMonth: Date): Promise<number> {
    // Count purchase orders created this month for connections where this shop is supplier
    const count = await prisma.purchaseOrder.count({
      where: {
        connection: {
          supplierShopId: shopId,
        },
        createdAt: { gte: startOfMonth },
        status: { not: 'DRAFT' },
      },
    });

    return count;
  }

  /**
   * Check if auto order push is allowed (blocks free tier)
   */
  async canUseAutoOrderPush(shopId: string): Promise<FeatureCheckResult> {
    return this.checkFeature(shopId, 'autoOrderPush');
  }

  /**
   * Check if price sync is allowed
   */
  async canUsePriceSync(shopId: string): Promise<FeatureCheckResult> {
    return this.checkFeature(shopId, 'priceSync');
  }

  /**
   * Check if multi-location is allowed
   */
  async canUseMultiLocation(shopId: string): Promise<FeatureCheckResult> {
    return this.checkFeature(shopId, 'multiLocation');
  }

  /**
   * Check if advanced fields (SEO, cost, HS code) are allowed
   */
  async canUseAdvancedFields(shopId: string): Promise<FeatureCheckResult> {
    return this.checkFeature(shopId, 'advancedFields');
  }

  /**
   * Check if payouts are allowed
   */
  async canUsePayouts(shopId: string): Promise<FeatureCheckResult> {
    return this.checkFeature(shopId, 'payouts');
  }

  /**
   * Check if marketplace features are allowed
   */
  async canUseMarketplace(shopId: string): Promise<FeatureCheckResult> {
    return this.checkFeature(shopId, 'marketplace');
  }

  /**
   * Enforce connection limit before creating
   */
  async enforceConnectionLimit(shopId: string): Promise<{ allowed: boolean; error?: string }> {
    const result = await this.canAddConnection(shopId);
    if (!result.allowed) {
      logger.warn(`Connection limit enforced for shop ${shopId}: ${result.reason}`);
      return {
        allowed: false,
        error: result.reason || 'Connection limit reached. Please upgrade your plan.',
      };
    }
    return { allowed: true };
  }

  /**
   * Enforce product limit before mapping
   */
  async enforceProductLimit(
    shopId: string,
    count: number = 1
  ): Promise<{ allowed: boolean; error?: string }> {
    const result = await this.canAddProducts(shopId, count);
    if (!result.allowed) {
      logger.warn(`Product limit enforced for shop ${shopId}: ${result.reason}`);
      return {
        allowed: false,
        error: result.reason || 'Product limit reached. Please upgrade your plan.',
      };
    }
    return { allowed: true };
  }

  /**
   * Enforce order push limit before pushing
   */
  async enforceOrderPushLimit(shopId: string): Promise<{ allowed: boolean; error?: string }> {
    const result = await this.canPushOrder(shopId);
    if (!result.allowed) {
      logger.warn(`Order push limit enforced for shop ${shopId}: ${result.reason}`);
      return {
        allowed: false,
        error: result.reason || 'Order push limit reached. Please upgrade your plan.',
      };
    }

    return { allowed: true };
  }

  /**
   * Get tier comparison for upgrade modal
   */
  getTierComparison(currentTier: TierLevel): Array<{
    tier: TierLevel;
    isCurrent: boolean;
    caps: TierCaps;
  }> {
    const tiers: TierLevel[] = ['FREE', 'STARTER', 'CORE', 'PRO', 'GROWTH', 'SCALE'];

    return tiers.map((tier) => ({
      tier,
      isCurrent: tier === currentTier,
      caps: TIER_CAPS[tier],
    }));
  }
}

export const BillingEnforcementService = new BillingEnforcementServiceClass();
