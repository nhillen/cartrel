/**
 * Domain types matching backend Prisma schema
 */

// Enums
export type ShopRole = 'SUPPLIER' | 'RETAILER' | 'BOTH';
export type ShopPlan = 'FREE' | 'STARTER' | 'CORE' | 'PRO' | 'GROWTH' | 'SCALE';
export type ConnectionStatus = 'PENDING_INVITE' | 'ACTIVE' | 'PAUSED' | 'TERMINATED';
export type TierLevel = 'STANDARD' | 'SILVER' | 'GOLD' | 'CUSTOM';
export type PaymentTermsType = 'PREPAY' | 'NET_15' | 'NET_30' | 'NET_60';
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

// Reference types (for nested objects)
export interface ShopRef {
  id: string;
  myshopifyDomain: string;
  companyName: string | null;
}

export interface ConnectionRef {
  id: string;
  supplierShop: ShopRef;
  retailerShop: ShopRef;
}

// Main entities
export interface Shop {
  id: string;
  myshopifyDomain: string;
  companyName: string | null;
  role: ShopRole;
  plan: ShopPlan;
  productCount: number;
  connectionCount: number;
  purchaseOrdersThisMonth: number;
  createdAt: string;
  // Extended fields (from detail endpoint)
  planLimits?: PlanLimits;
  auditLogs?: AuditLog[];
}

export interface PlanLimits {
  connections: number;
  products: number;
  ordersPerMonth: number;
  invitesPerMonth: number;
}

export interface Connection {
  id: string;
  supplierShop: ShopRef;
  retailerShop: ShopRef;
  status: ConnectionStatus;
  paymentTermsType: PaymentTermsType;
  tier: TierLevel;
  createdAt: string;
  // Extended fields
  nickname?: string;
  notes?: string;
  creditLimit?: number;
  minOrderAmount?: number;
}

export interface Product {
  id: string;
  supplierShop: ShopRef;
  title: string;
  sku: string | null;
  wholesalePrice: number;
  inventoryQuantity: number;
  isWholesaleEligible: boolean;
  mappingCount: number;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  connection: ConnectionRef;
  supplierShop: ShopRef;
  retailerShop: ShopRef;
  status: PurchaseOrderStatus;
  subtotal: number;
  shippingCost: number;
  taxAmount: number;
  total: number;
  currency: string;
  submittedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  shopId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Stats {
  totalShops: number;
  totalSuppliers: number;
  totalRetailers: number;
  totalConnections: number;
  totalProducts: number;
  totalOrders: number;
  shopsByPlan: Record<ShopPlan, number>;
  version: string | null;
  commitHash: string | null;
  buildDate: string | null;
}

// Health types
export interface SystemHealth {
  id: string;
  component: string;
  webhookQueueSize: number | null;
  webhookErrorRate: number | null;
  apiResponseTime: number | null;
  databaseResponseTime: number | null;
  healthy: boolean;
  createdAt: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  total: number;
}

export interface HealthData {
  status: 'healthy' | 'warning' | 'degraded' | 'critical';
  queueHealthy: boolean;
  queues: {
    webhook: QueueStats;
    import: QueueStats;
  } | null;
  components: Array<{
    component: string;
    healthy: boolean;
    webhookQueueSize: number | null;
    webhookErrorRate: number | null;
    apiResponseTime: number | null;
    databaseResponseTime: number | null;
    checkedAt: string;
  }>;
  activeIncidents: Array<{
    id: string;
    title: string;
    component: string;
    impact: string;
    status: string;
    createdAt: string;
    latestUpdate: string | null;
  }>;
  recentIncidents: Array<{
    id: string;
    title: string;
    component: string;
    impact: string;
    resolvedAt: string;
  }>;
}

export interface FailedJob {
  id: string;
  name: string;
  data: {
    topic?: string;
    shopDomain?: string;
  };
  failedReason: string;
  stacktrace?: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}

// Connection health types
export type ConnectionHealthStatus = 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'OFFLINE';

export interface ConnectionHealth {
  connectionId: string;
  status: ConnectionHealthStatus;
  lastSyncAt: string | null;
  lastInventorySyncAt: string | null;
  lastCatalogSyncAt: string | null;
  lastOrderForwardAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  errorCount24h: number;
  isThrottled: boolean;
  throttledUntil: string | null;
  pendingJobs: number;
  failedJobs: number;
  activeMappings: number;
  errorMappings: number;
  pendingMappings: number;
}

export type ActivityType =
  | 'SYNC_SUCCESS'
  | 'SYNC_ERROR'
  | 'INVENTORY_UPDATE'
  | 'CATALOG_UPDATE'
  | 'ORDER_FORWARD'
  | 'ORDER_PENDING'
  | 'ORDER_SHADOWED'
  | 'ORDER_PUSHED'
  | 'ORDER_PUSH_FAILED'
  | 'FULFILLMENT_SYNCED'
  | 'RATE_LIMIT'
  | 'MAPPING_ERROR'
  | 'SKU_DRIFT';

export type ActivityResourceType = 'PRODUCT' | 'INVENTORY' | 'ORDER' | 'CONNECTION';

export interface ActivityEntry {
  id: string;
  connectionId: string;
  type: ActivityType;
  resourceType: ActivityResourceType;
  resourceId?: string;
  message: string;
  details?: Record<string, unknown>;
  createdAt: string;
}
