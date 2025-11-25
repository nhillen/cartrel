'use client';

/**
 * Admin view - General admin settings (stub)
 */

import { Settings, CreditCard, Activity, BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

export function AdminView() {
  return (
    <>
      {/* Left Pane - Navigation */}
      <div className="p-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Admin Settings</h2>
          <p className="text-xs text-slate-500">Platform configuration</p>
        </div>

        <div className="space-y-1">
          <AdminNavItem
            icon={CreditCard}
            label="Pricing Tiers"
            description="Manage subscription plans"
            active
          />
          <AdminNavItem
            icon={Activity}
            label="System Health"
            description="Platform monitoring"
          />
          <AdminNavItem
            icon={BarChart3}
            label="Platform Stats"
            description="Usage analytics"
          />
        </div>
      </div>

      {/* Middle Pane - Content */}
      <div className="h-full flex flex-col p-6">
        <EmptyState
          icon={Settings}
          title="Admin Settings Coming Soon"
          description="This section will include pricing tier management, system health monitoring, and platform analytics."
        />

        {/* Preview cards */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AdminPreviewCard
            icon={CreditCard}
            title="Pricing Tiers"
            items={['Configure plan limits', 'Set pricing', 'Manage add-ons']}
          />
          <AdminPreviewCard
            icon={Activity}
            title="System Health"
            items={['Webhook queue status', 'API response times', 'Error rates']}
          />
          <AdminPreviewCard
            icon={BarChart3}
            title="Platform Stats"
            items={['Active shops', 'MRR tracking', 'Growth metrics']}
          />
        </div>
      </div>

      {/* Right Pane - Empty */}
      <div className="p-4">
        <div className="h-full flex items-center justify-center text-slate-400 text-sm">
          Select an admin section
        </div>
      </div>
    </>
  );
}

interface AdminNavItemProps {
  icon: typeof Settings;
  label: string;
  description: string;
  active?: boolean;
}

function AdminNavItem({ icon: Icon, label, description, active }: AdminNavItemProps) {
  return (
    <button
      className={`w-full text-left p-3 rounded-lg transition ${
        active
          ? 'bg-blue-50 border border-blue-200'
          : 'hover:bg-slate-100 border border-transparent'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className={`text-sm font-medium ${active ? 'text-blue-900' : 'text-slate-700'}`}>
            {label}
          </div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
    </button>
  );
}

interface AdminPreviewCardProps {
  icon: typeof Settings;
  title: string;
  items: string[];
}

function AdminPreviewCard({ icon: Icon, title, items }: AdminPreviewCardProps) {
  return (
    <div className="border rounded-xl p-4 bg-white/50">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-700">{title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-slate-500 flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-slate-300" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
