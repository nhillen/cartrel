'use client';

/**
 * Tabs component for inspector and other tabbed interfaces
 */

import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div className={cn('border-b', className)}>
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            disabled={tab.disabled}
            className={cn(
              'py-3 px-4 border-b-2 text-sm font-medium transition',
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              tab.disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-xs text-slate-400">({tab.count})</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

interface TabPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function TabPanel({ children, className }: TabPanelProps) {
  return <div className={cn('py-4', className)}>{children}</div>;
}
