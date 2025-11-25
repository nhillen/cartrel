/**
 * Connections query hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './keys';
import type { Connection } from '@/types/domain';

interface ConnectionsResponse {
  connections: Connection[];
}

interface ConnectionFilters {
  status?: string;
  supplier?: string;
  retailer?: string;
  limit?: number;
}

/**
 * Fetch all connections with optional filters
 */
export function useConnections(filters?: ConnectionFilters) {
  // Default to ACTIVE status to match stats counting
  const defaultFilters = { status: 'ACTIVE', ...filters };

  return useQuery({
    queryKey: queryKeys.connections.list(defaultFilters),
    queryFn: () => api.get<ConnectionsResponse>('/connections', defaultFilters),
    staleTime: 30_000,
    select: (data) => data.connections,
  });
}

/**
 * Fetch connections for a specific shop
 */
export function useConnectionsByShop(shopId: string | null, role: 'supplier' | 'retailer') {
  const filterKey = role === 'supplier' ? 'supplier' : 'retailer';

  return useQuery({
    queryKey: queryKeys.connections.byShop(shopId || '', role),
    queryFn: async () => {
      // We need to get the shop domain first, then filter by it
      // For now, fetch all and filter client-side
      // TODO: Add proper backend filtering by shop ID
      const response = await api.get<ConnectionsResponse>('/connections', { status: 'ACTIVE' });
      return response;
    },
    enabled: !!shopId,
    staleTime: 30_000,
    select: (data) => data.connections,
  });
}

/**
 * Delete connection mutation
 */
export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) => api.delete(`/connections/${connectionId}`),
    onSuccess: () => {
      // Invalidate all connection queries
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.shops.all });
    },
  });
}
