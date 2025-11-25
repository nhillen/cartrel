'use client';

/**
 * Main application shell
 * Combines header and three-pane layout
 */

import { type ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { Header } from './Header';
import { ThreePaneLayout } from './ThreePaneLayout';
import { ToastContainer } from '@/components/ui/Toast';

interface AppShellProps {
  leftPane: ReactNode;
  middlePane: ReactNode;
  rightPane: ReactNode;
}

export function AppShell({ leftPane, middlePane, rightPane }: AppShellProps) {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Invalidate all queries to trigger refetch
      await queryClient.invalidateQueries();
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  // Show loading state while checking auth
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <Header onRefresh={handleRefresh} isRefreshing={isRefreshing} />
      <ThreePaneLayout
        leftPane={leftPane}
        middlePane={middlePane}
        rightPane={rightPane}
      />
      <ToastContainer />
    </div>
  );
}
