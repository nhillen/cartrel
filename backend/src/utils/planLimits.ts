/**
 * Plan limits and enforcement for Cartrel pricing tiers
 *
 * Core model:
 * - Retailers are always free
 * - Only suppliers pay
 * - No GMV percentage fees
 * - Flat plans with clear usage limits
 */

export interface PlanLimits {
  name: string;
  price: number;
  maxConnections: number;
  maxPurchaseOrdersPerMonth: number;
  maxActiveInvites: number; // Max active (unredeemed) invites at once
  maxInvitesPerHour: number; // Rate limit for invite creation
  features: {
    catalogSync: 'basic' | 'selected' | 'full';
    multipleTermProfiles: boolean;
    tierAndPerks: boolean;
    reporting: boolean;
    prioritySupport: boolean;
    apiAccess: boolean;
  };
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  FREE: {
    name: 'Test Flight',
    price: 0,
    maxConnections: 2,
    maxPurchaseOrdersPerMonth: 10,
    maxActiveInvites: 5,
    maxInvitesPerHour: 5,
    features: {
      catalogSync: 'basic',
      multipleTermProfiles: false,
      tierAndPerks: false,
      reporting: false,
      prioritySupport: false,
      apiAccess: false,
    },
  },
  STARTER: {
    name: 'Starter',
    price: 99,
    maxConnections: 5,
    maxPurchaseOrdersPerMonth: 100,
    maxActiveInvites: 10,
    maxInvitesPerHour: 10,
    features: {
      catalogSync: 'selected',
      multipleTermProfiles: false,
      tierAndPerks: false,
      reporting: false,
      prioritySupport: false,
      apiAccess: false,
    },
  },
  GROWTH: {
    name: 'Growth',
    price: 299,
    maxConnections: 25,
    maxPurchaseOrdersPerMonth: 1000,
    maxActiveInvites: 50,
    maxInvitesPerHour: 25,
    features: {
      catalogSync: 'full',
      multipleTermProfiles: true,
      tierAndPerks: true,
      reporting: true,
      prioritySupport: false,
      apiAccess: false,
    },
  },
  SCALE: {
    name: 'Scale',
    price: 799,
    maxConnections: 999999, // Essentially unlimited
    maxPurchaseOrdersPerMonth: 999999, // Essentially unlimited
    maxActiveInvites: 999999,
    maxInvitesPerHour: 999999,
    features: {
      catalogSync: 'full',
      multipleTermProfiles: true,
      tierAndPerks: true,
      reporting: true,
      prioritySupport: true,
      apiAccess: true,
    },
  },
};

/**
 * Get plan limits for a specific plan
 */
export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
}

/**
 * Check if a shop can create a new connection
 */
export function canCreateConnection(
  currentConnections: number,
  plan: string
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  if (currentConnections >= limits.maxConnections) {
    return {
      allowed: false,
      reason: `You've reached your plan limit of ${limits.maxConnections} connections. Upgrade to connect more retailers.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a shop can create a new purchase order
 */
export function canCreatePurchaseOrder(
  purchaseOrdersThisMonth: number,
  plan: string
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  if (purchaseOrdersThisMonth >= limits.maxPurchaseOrdersPerMonth) {
    return {
      allowed: false,
      reason: `You've reached your plan limit of ${limits.maxPurchaseOrdersPerMonth} purchase orders this month. Upgrade to process more orders.`,
    };
  }

  return { allowed: true };
}

/**
 * Get usage summary for a shop
 */
export interface UsageSummary {
  plan: string;
  planName: string;
  connections: {
    current: number;
    max: number;
    percentage: number;
  };
  purchaseOrders: {
    current: number;
    max: number;
    percentage: number;
  };
  shouldUpgrade: boolean;
}

export function getUsageSummary(
  plan: string,
  currentConnections: number,
  purchaseOrdersThisMonth: number
): UsageSummary {
  const limits = getPlanLimits(plan);

  const connectionsPercentage = (currentConnections / limits.maxConnections) * 100;
  const posPercentage = (purchaseOrdersThisMonth / limits.maxPurchaseOrdersPerMonth) * 100;

  return {
    plan,
    planName: limits.name,
    connections: {
      current: currentConnections,
      max: limits.maxConnections,
      percentage: Math.min(connectionsPercentage, 100),
    },
    purchaseOrders: {
      current: purchaseOrdersThisMonth,
      max: limits.maxPurchaseOrdersPerMonth,
      percentage: Math.min(posPercentage, 100),
    },
    shouldUpgrade: connectionsPercentage >= 80 || posPercentage >= 80,
  };
}

/**
 * Reset monthly usage counters if needed
 * Should be called when creating POs to check if we need to reset
 */
export function shouldResetMonthlyUsage(currentPeriodStart: Date): boolean {
  const now = new Date();
  const daysSinceStart = Math.floor(
    (now.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Reset if it's been 30+ days
  return daysSinceStart >= 30;
}

/**
 * Check if a shop can create a new invite
 */
export function canCreateInvite(
  activeInvitesCount: number,
  recentInvitesCount: number,
  plan: string
): { allowed: boolean; reason?: string } {
  const limits = getPlanLimits(plan);

  // Check active invites limit
  if (activeInvitesCount >= limits.maxActiveInvites) {
    return {
      allowed: false,
      reason: `You've reached your plan limit of ${limits.maxActiveInvites} active invites. Revoke or wait for some to expire before creating more.`,
    };
  }

  // Check rate limit (invites created in last hour)
  if (recentInvitesCount >= limits.maxInvitesPerHour) {
    return {
      allowed: false,
      reason: `You've reached your hourly limit of ${limits.maxInvitesPerHour} invites. Please wait before creating more.`,
    };
  }

  return { allowed: true };
}
