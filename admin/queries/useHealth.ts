/**
 * Health query hook
 */

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './keys';
import type { HealthData } from '@/types/domain';

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health.current,
    queryFn: () => api.get<HealthData>('/health'),
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Refetch every minute
  });
}
