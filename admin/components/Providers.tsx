'use client';

/**
 * Client-side providers wrapper
 * Combines all providers needed for the application
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState, type ReactNode } from 'react';
import { DashboardProvider } from '@/context/DashboardContext';
import { ToastProvider } from '@/context/ToastContext';

export function Providers({ children }: { children: ReactNode }) {
  // Create QueryClient instance that persists across renders
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't refetch on window focus by default
            refetchOnWindowFocus: false,
            // Retry once on failure
            retry: 1,
            // Consider data stale after 30 seconds
            staleTime: 30_000,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DashboardProvider>{children}</DashboardProvider>
        </ToastProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
