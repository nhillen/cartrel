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
