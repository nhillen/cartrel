'use client';

/**
 * Header component with top-level navigation
 */

import { signOut } from 'next-auth/react';
import { Loader2, LogOut, RefreshCcw, Store, Factory, Settings } from 'lucide-react';
import { useActiveView } from '@/context/DashboardContext';
import { useStats } from '@/queries/useStats';
import { cn } from '@/lib/utils';

interface HeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function Header({ onRefresh, isRefreshing }: HeaderProps) {
  const { activeView, setActiveView } = useActiveView();
  const { data: stats } = useStats();

  const navItems = [
    { id: 'retailers' as const, label: 'Retailers', icon: Store },
    { id: 'suppliers' as const, label: 'Suppliers', icon: Factory },
    { id: 'admin' as const, label: 'Admin', icon: Settings },
  ];

  return (
    <header className="backdrop-blur bg-white/80 border-b sticky top-0 z-20 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top row: Logo, Nav, Actions */}
        <div className="py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-500 flex items-center justify-center text-white font-semibold shadow-md text-sm">
              CT
            </div>
            <div>
              <div className="text-base font-semibold">Cartrel Admin</div>
              <p className="text-xs text-slate-500">CS Console</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition',
                    isActive
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 transition disabled:opacity-60"
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCcw className="w-4 h-4" />
              )}
              Refresh
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/sign-in' })}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Status Strip */}
        <div className="pb-2 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-4">
            {stats && (
              <>
                <span>
                  <strong>{stats.totalShops}</strong> Shops
                </span>
                <span className="text-slate-300">|</span>
                <span>
                  <strong>{stats.totalSuppliers}</strong> Suppliers
                </span>
                <span className="text-slate-300">|</span>
                <span>
                  <strong>{stats.totalRetailers}</strong> Retailers
                </span>
                <span className="text-slate-300">|</span>
                <span>
                  <strong>{stats.totalConnections}</strong> Connections
                </span>
                <span className="text-slate-300">|</span>
                <span>
                  <strong>{stats.totalProducts}</strong> Products
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              All systems operational
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
