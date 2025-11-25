/**
 * Products query hooks
 */

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './keys';
import type { Product } from '@/types/domain';

interface ProductsResponse {
  products: Product[];
}

interface ProductFilters {
  supplier?: string;
  wholesale?: boolean;
  limit?: number;
}

/**
 * Fetch all products with optional filters
 */
export function useProducts(filters?: ProductFilters) {
  // Default to wholesale=true to match stats counting
  const defaultFilters = { wholesale: true, limit: 200, ...filters };

  return useQuery({
    queryKey: queryKeys.products.list(defaultFilters),
    queryFn: () => api.get<ProductsResponse>('/products', {
      ...defaultFilters,
      wholesale: defaultFilters.wholesale ? 'true' : undefined,
    }),
    staleTime: 30_000,
    select: (data) => data.products,
  });
}

/**
 * Fetch products for a specific supplier
 */
export function useProductsBySupplier(supplierDomain: string | null) {
  return useQuery({
    queryKey: queryKeys.products.bySupplier(supplierDomain || ''),
    queryFn: () => api.get<ProductsResponse>('/products', {
      supplier: supplierDomain || undefined,
      wholesale: 'true',
      limit: 200,
    }),
    enabled: !!supplierDomain,
    staleTime: 30_000,
    select: (data) => data.products,
  });
}
