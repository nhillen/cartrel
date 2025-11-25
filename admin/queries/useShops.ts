/**
 * Shops query hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './keys';
import type { Shop, ShopPlan } from '@/types/domain';

interface ShopsResponse {
  shops: Shop[];
}

interface ShopFilters {
  role?: string;
  plan?: string;
  search?: string;
}

interface ShopDetailResponse {
  shop: Shop & {
    planLimits: {
      connections: number;
      products: number;
      ordersPerMonth: number;
      invitesPerMonth: number;
    };
    auditLogs: Array<{
      id: string;
      action: string;
      resourceType: string | null;
      resourceId: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: string;
    }>;
  };
}

/**
 * Fetch all shops with optional filters
 */
export function useShops(filters?: ShopFilters) {
  return useQuery({
    queryKey: filters ? queryKeys.shops.list(filters) : queryKeys.shops.all,
    queryFn: () => api.get<ShopsResponse>('/shops', filters ? { ...filters } : undefined),
    staleTime: 30_000,
    select: (data) => data.shops,
  });
}

/**
 * Fetch shops by role (supplier or retailer)
 */
export function useShopsByRole(role: 'supplier' | 'retailer') {
  const roleFilter = role === 'supplier' ? 'SUPPLIER' : 'RETAILER';
  return useQuery({
    queryKey: queryKeys.shops.byRole(role),
    queryFn: () => api.get<ShopsResponse>('/shops', { role: roleFilter }),
    staleTime: 30_000,
    select: (data) => data.shops,
  });
}

/**
 * Fetch single shop details
 */
export function useShop(shopId: string | null) {
  return useQuery({
    queryKey: queryKeys.shops.detail(shopId || ''),
    queryFn: () => api.get<ShopDetailResponse>(`/shops/${shopId}`),
    enabled: !!shopId,
    staleTime: 60_000,
    select: (data) => data.shop,
  });
}

/**
 * Update shop plan mutation
 */
interface UpdatePlanParams {
  shopId: string;
  plan: ShopPlan;
  notes?: string;
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shopId, plan, notes }: UpdatePlanParams) =>
      api.patch(`/shops/${shopId}/plan`, { plan, notes }),
    onSuccess: (_, { shopId }) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.detail(shopId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

/**
 * Update shop role mutation
 */
interface UpdateRoleParams {
  shopId: string;
  role: 'SUPPLIER' | 'RETAILER' | 'BOTH';
  notes?: string;
}

export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shopId, role, notes }: UpdateRoleParams) =>
      api.patch(`/shops/${shopId}/role`, { role, notes }),
    onSuccess: (_, { shopId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.detail(shopId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

/**
 * Reset shop usage mutation
 */
interface ResetUsageParams {
  shopId: string;
  notes?: string;
}

export function useResetUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ shopId, notes }: ResetUsageParams) =>
      api.post(`/shops/${shopId}/reset-usage`, { notes }),
    onSuccess: (_, { shopId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.detail(shopId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.all });
    },
  });
}
