/**
 * API Client for Cartrel Backend
 *
 * Uses session tokens from App Bridge for authentication.
 * All requests go through our backend - no direct Shopify mutations.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

class ApiClient {
  private getSessionToken: () => Promise<string>;

  constructor() {
    this.getSessionToken = async () => {
      if (window.shopify?.idToken) {
        return window.shopify.idToken();
      }
      throw new Error('App Bridge not initialized');
    };
  }

  async request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    try {
      const token = await this.getSessionToken();

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const error: ApiError = await response.json().catch(() => ({
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.message || 'Request failed');
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) return {} as T;

      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error occurred');
    }
  }

  // Convenience methods
  get<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  put<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, { method: 'PUT', body });
  }

  patch<T>(endpoint: string, body?: unknown) {
    return this.request<T>(endpoint, { method: 'PATCH', body });
  }

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient();

// Type definitions for API responses
export interface Shop {
  id: string;
  myshopifyDomain: string;
  name: string;
  plan: string;
  role: 'SUPPLIER' | 'RETAILER' | 'BOTH';
  isActive: boolean;
}

export interface Connection {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'TERMINATED';
  supplierShop: {
    id: string;
    myshopifyDomain: string;
    name: string;
  };
  retailerShop: {
    id: string;
    myshopifyDomain: string;
    name: string;
  };
  syncMode: 'FULL' | 'CATALOG_ONLY' | 'MANUAL';
  tier: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  code: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  createdAt: string;
}

export interface Product {
  id: string;
  shopifyProductId: string;
  title: string;
  sku: string | null;
  wholesalePrice: number;
  inventoryQuantity: number;
  isWholesaleEligible: boolean;
  status: string;
}

export interface DashboardStats {
  connections: {
    active: number;
    pending: number;
    total: number;
  };
  products: {
    wholesale: number;
    mapped: number;
    total: number;
  };
  orders: {
    pending: number;
    completed: number;
    total: number;
  };
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    lastSync: string | null;
    webhooksActive: boolean;
  };
}

export interface Order {
  id: string;
  shopifyOrderId: string;
  orderNumber: string;
  status: 'PENDING' | 'FORWARDED' | 'FULFILLED' | 'CANCELLED';
  totalPrice: number;
  currency: string;
  createdAt: string;
  lineItems: Array<{
    title: string;
    quantity: number;
    price: number;
  }>;
}

// Marketplace types
export interface PartnerProfile {
  id: string;
  displayName: string;
  slug: string | null;
  description: string | null;
  website: string | null;
  socialLinks: Record<string, string> | null;
  location: string | null;
  country: string | null;
  category: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  galleryImages: string[] | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'CONNECTIONS_ONLY';
  verified: boolean;
  productCount: number;
  connectionCount: number;
  allowReshare: boolean;
  reshareScope: string | null;
  reshareMaxDests: number;
  shop?: {
    id: string;
    role: string;
    myshopifyDomain?: string;
  };
}

export interface MarketplaceInvite {
  id: string;
  message: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  suggestedSyncMode: string | null;
  createdAt: string;
  expiresAt: string;
  senderProfile?: {
    id: string;
    displayName: string;
    logoUrl: string | null;
    category: string | null;
  };
  recipientProfile?: {
    id: string;
    displayName: string;
    logoUrl: string | null;
    category: string | null;
  };
}

export interface BrowseProfilesResponse {
  profiles: PartnerProfile[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MarketplaceInvitesResponse {
  sent: MarketplaceInvite[];
  received: MarketplaceInvite[];
}

// Import Wizard types
export interface SupplierForImport {
  id: string;
  name: string;
  paymentTerms: string;
  tier: string;
  connectionId: string;
  defaultMarkup: {
    type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'CUSTOM';
    value: number;
  };
}

export interface AvailableProduct {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  title: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  imageUrl: string | null;
  inventoryQuantity: number;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  isImported: boolean;
  mappingId: string | null;
  // Order history - for prioritization feature
  hasOrdered: boolean;
  orderCount: number;
  lastOrderDate: string | null;
  totalQuantityOrdered: number;
}

export interface ImportPreferences {
  syncTitle: boolean;
  syncDescription: boolean;
  syncImages: boolean;
  syncPricing: boolean;
  syncInventory: boolean;
  syncTags: boolean;
  syncSEO: boolean;
  syncMetafields: boolean;
  markupType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'CUSTOM';
  markupValue: number;
}

export interface ImportPreviewItem {
  productId: string;
  title: string;
  isNew: boolean;
  changes: Array<{
    field: string;
    oldValue: string | null;
    newValue: string;
  }>;
  wholesalePrice: string;
  calculatedRetailPrice: string;
}

export interface ImportPreviewResult {
  products: ImportPreviewItem[];
  summary: {
    newImports: number;
    updates: number;
    unchanged: number;
    total: number;
  };
}

export interface ImportResult {
  products: Array<{
    productId: string;
    success: boolean;
    retailerProductId?: string;
    error?: string;
  }>;
  summary: {
    success: number;
    errors: number;
    total: number;
  };
}

// Price Rules types
export type PriceRuleType =
  | 'MIRROR'
  | 'MARKUP_PERCENT'
  | 'MARKDOWN_PERCENT'
  | 'MARKUP_FIXED'
  | 'MARKDOWN_FIXED';

export interface PriceRule {
  type: PriceRuleType;
  value: number;
  roundTo?: number;
  applyToCompareAt: boolean;
}

export interface PriceRuleTypeInfo {
  type: PriceRuleType;
  name: string;
  description: string;
  example: string;
}

export interface PricePreview {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  sourcePrice: number;
  calculatedPrice: number;
  priceChange: number;
  priceChangePercent: number;
}

// Shadow Mode types
export interface ShadowModeStats {
  enabled: boolean;
  shadowImports: number;
  totalMappings: number;
  lastShadowImport: string | null;
}

export interface PricingComparison {
  cartrel: {
    plan: string;
    monthlyPrice: number;
    annualPrice: number;
    features: string[];
  };
  competitor: {
    plan: string;
    monthlyPrice: number;
    annualPrice: number;
    features: string[];
  };
  savings: {
    monthly: number;
    annual: number;
    percentMonthly: number;
  };
}

export interface FeatureComparison {
  feature: string;
  cartrel: boolean | string;
  competitor: boolean | string;
  winner: 'cartrel' | 'competitor' | 'tie';
}

// Variant Mapping types
export interface VariantOption {
  name: string;
  value: string;
}

export interface VariantMapping {
  id: string;
  supplierVariantId: string;
  retailerVariantId: string | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  supplierOptions: VariantOption[];
  retailerOptions: VariantOption[];
  supplierSku: string | null;
  retailerSku: string | null;
  supplierPrice: string;
  retailerPrice: string | null;
  supplierInventory: number;
  retailerInventory: number | null;
  syncEnabled: boolean;
}

export interface ProductVariantMappings {
  productMappingId: string;
  productTitle: string;
  supplierProductId: string;
  retailerProductId: string | null;
  variantCount: number;
  mappedCount: number;
  unmappedCount: number;
  variants: VariantMapping[];
}

// Order Forwarding types
export type OrderForwardingMode = 'AUTO' | 'MANUAL' | 'SHADOW';

export interface OrderForwardingSettings {
  mode: OrderForwardingMode;
  triggerOn: 'ON_CREATE' | 'ON_PAID' | 'ON_FULFILLED';
  includeShippingCost: boolean;
  defaultShippingFee: number | null;
  tagMapping: Record<string, string>;
  autoFulfill: boolean;
  shadowModeEnabled: boolean;
}

// Metafield Sync types
export interface MetafieldDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  type: string;
  description: string | null;
  ownerType: string;
}

export interface MetafieldSyncConfig {
  enabled: boolean;
  definitions: Array<{
    definitionId: string;
    namespace: string;
    key: string;
    name: string;
    syncEnabled: boolean;
  }>;
}

// Payout types
export type PayoutStatus = 'OPEN' | 'PAID' | 'RECEIVED' | 'DELETED';

export interface PayoutSettings {
  includesTax: boolean;
  shippingFeeType: 'NONE' | 'ORDER_SHIPPING' | 'FLAT';
  shippingFeeFlat: number;
  processingFeeType: 'NONE' | 'FLAT' | 'PERCENT' | 'FLAT_PLUS_PERCENT';
  processingFeeFlat: number;
  processingFeePercent: number;
  commissionType: 'FLAT' | 'PERCENT';
  commissionValue: number;
}

export interface Payout {
  id: string;
  payoutNumber: string;
  status: PayoutStatus;
  connectionId: string;
  supplierName: string;
  subtotal: number;
  shippingFees: number;
  processingFees: number;
  commissionAmount: number;
  adjustments: number;
  total: number;
  currency: string;
  orderCount: number;
  createdAt: string;
  paidAt: string | null;
  receivedAt: string | null;
}

export interface PayoutSummary {
  openPayouts: number;
  openTotal: number;
  paidPayouts: number;
  paidTotal: number;
  receivedPayouts: number;
  receivedTotal: number;
  currency: string;
}

// Collection Sync types
export interface CollectionMapping {
  id: string;
  sourceCollectionId: string;
  destCollectionId: string | null;
  sourceHandle: string;
  sourceTitle: string;
  destTitle: string | null;
  syncEnabled: boolean;
  overwriteLocal: boolean;
  productsCount: number;
  lastSyncedAt: string | null;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
}

export interface CollectionSyncSettings {
  enabled: boolean;
  overwriteLocalEdits: boolean;
  syncProductMembership: boolean;
  syncImages: boolean;
  syncDescriptions: boolean;
}

// Multi-Location Inventory types
export interface InventoryLocation {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
  isDefault: boolean;
}

export interface LocationSettings {
  sourceLocationId: string | null;
  destLocationId: string | null;
  stockBuffer: number;
  syncEnabled: boolean;
}

// Product Snapshot/Rollback types
export interface ProductSnapshot {
  id: string;
  productId: string;
  productTitle: string;
  field: string;
  oldValue: string;
  newValue: string;
  changedBy: 'SUPPLIER_SYNC' | 'MANUAL_EDIT' | 'SYSTEM';
  createdAt: string;
  canRollback: boolean;
}

export interface ProductHistory {
  productId: string;
  productTitle: string;
  snapshots: ProductSnapshot[];
  currentValues: Record<string, string>;
}
