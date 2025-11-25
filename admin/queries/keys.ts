/**
 * TanStack Query key factory
 * Provides type-safe, consistent query keys across the application
 */

export const queryKeys = {
  // Stats
  stats: ['stats'] as const,

  // Shops
  shops: {
    all: ['shops'] as const,
    list: (filters?: { role?: string; plan?: string; search?: string }) =>
      ['shops', 'list', filters] as const,
    byRole: (role: 'supplier' | 'retailer') => ['shops', 'role', role] as const,
    detail: (id: string) => ['shops', 'detail', id] as const,
  },

  // Connections
  connections: {
    all: ['connections'] as const,
    list: (filters?: { status?: string; supplier?: string; retailer?: string }) =>
      ['connections', 'list', filters] as const,
    byShop: (shopId: string, role: 'supplier' | 'retailer') =>
      ['connections', 'shop', shopId, role] as const,
    detail: (id: string) => ['connections', 'detail', id] as const,
  },

  // Products
  products: {
    all: ['products'] as const,
    list: (filters?: { supplier?: string; wholesale?: boolean }) =>
      ['products', 'list', filters] as const,
    bySupplier: (shopId: string) => ['products', 'supplier', shopId] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
  },

  // Orders (future)
  orders: {
    all: ['orders'] as const,
    byConnection: (connectionId: string) => ['orders', 'connection', connectionId] as const,
    byShop: (shopId: string, role: 'supplier' | 'retailer') =>
      ['orders', 'shop', shopId, role] as const,
  },

  // Health (future)
  health: {
    current: ['health', 'current'] as const,
    history: (component: string) => ['health', 'history', component] as const,
  },

  // Audit logs
  logs: {
    audit: (shopId: string) => ['logs', 'audit', shopId] as const,
    webhook: (shopId: string) => ['logs', 'webhook', shopId] as const,
  },
} as const;
