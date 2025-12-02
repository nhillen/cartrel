/**
 * Query hooks for connection health and activity
 */

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ConnectionHealth, ActivityEntry } from '@/types/domain';

interface ConnectionHealthResponse {
  health: ConnectionHealth;
}

interface ConnectionActivityResponse {
  activity: ActivityEntry[];
}

interface ConnectionWithErrorsResponse {
  connections: (ConnectionHealth & {
    connection: {
      id: string;
      supplierShop: { myshopifyDomain: string; companyName: string | null };
      retailerShop: { myshopifyDomain: string; companyName: string | null };
    } | null;
  })[];
}

interface FeaturesResponse {
  features: {
    available: {
      id: string;
      name: string;
      description: string;
      tier: string;
      caps?: Record<string, number | string>;
    }[];
    comingSoon: {
      id: string;
      name: string;
      description: string;
      plannedTier: string;
      roadmapStatus: string;
    }[];
  };
}

/**
 * Get health for a specific connection
 */
export function useConnectionHealth(connectionId: string | undefined) {
  return useQuery({
    queryKey: ['connection-health', connectionId],
    queryFn: () => api.get<ConnectionHealthResponse>(`/connections/${connectionId}/health`),
    enabled: !!connectionId,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Refresh every minute
  });
}

/**
 * Get activity log for a specific connection
 */
export function useConnectionActivity(connectionId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ['connection-activity', connectionId, limit],
    queryFn: () => api.get<ConnectionActivityResponse>(`/connections/${connectionId}/activity`, { limit }),
    enabled: !!connectionId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Get all connections with health issues
 */
export function useConnectionsWithErrors() {
  return useQuery({
    queryKey: ['connections-with-errors'],
    queryFn: () => api.get<ConnectionWithErrorsResponse>('/connections-with-errors'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Get feature availability
 */
export function useFeatures() {
  return useQuery({
    queryKey: ['features'],
    queryFn: () => api.get<FeaturesResponse>('/features'),
    staleTime: 5 * 60_000, // 5 minutes
  });
}
