'use client';

/**
 * Three-pane layout container
 * Left: Resource tree (280px fixed)
 * Middle: List table (flexible)
 * Right: Inspector panel (360px fixed, collapsible)
 */

import { type ReactNode } from 'react';
import { useDashboard } from '@/context/DashboardContext';
import { cn } from '@/lib/utils';

interface ThreePaneLayoutProps {
  leftPane: ReactNode;
  middlePane: ReactNode;
  rightPane: ReactNode;
}

export function ThreePaneLayout({ leftPane, middlePane, rightPane }: ThreePaneLayoutProps) {
  const { state } = useDashboard();
  const { leftPaneCollapsed, inspectorVisible } = state;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Pane - Resource Tree */}
      <aside
        className={cn(
          'flex-shrink-0 border-r bg-white/50 overflow-hidden transition-all duration-200',
          leftPaneCollapsed ? 'w-0' : 'w-72'
        )}
      >
        <div className="h-full overflow-y-auto">{leftPane}</div>
      </aside>

      {/* Middle Pane - List Table */}
      <main className="flex-1 overflow-hidden bg-slate-50/50">
        <div className="h-full overflow-y-auto">{middlePane}</div>
      </main>

      {/* Right Pane - Inspector */}
      <aside
        className={cn(
          'flex-shrink-0 border-l bg-white overflow-hidden transition-all duration-200',
          inspectorVisible ? 'w-96' : 'w-0'
        )}
      >
        <div className="h-full overflow-y-auto">{rightPane}</div>
      </aside>
    </div>
  );
}
