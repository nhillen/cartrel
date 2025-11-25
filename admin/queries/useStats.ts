/**
 * Stats query hook
 */

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './keys';
import type { Stats } from '@/types/domain';

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.get<Stats>('/stats'),
    staleTime: 30_000, // 30 seconds
  });
}
