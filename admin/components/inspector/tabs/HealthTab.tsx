/**
 * Health tab - Shows connection health and activity
 */

import { Activity, Wifi, AlertCircle, Clock, RefreshCcw, CheckCircle, XCircle, AlertTriangle, Package, ShoppingCart, Loader2 } from 'lucide-react';
import { useConnectionHealth, useConnectionActivity } from '@/queries/useConnectionHealth';
import { useListSelection } from '@/context/DashboardContext';
import { cn } from '@/lib/utils';
import type { ActivityType, ConnectionHealthStatus } from '@/types/domain';

const statusColors: Record<ConnectionHealthStatus, { bg: string; text: string; icon: typeof CheckCircle }> = {
  HEALTHY: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  DEGRADED: { bg: 'bg-amber-50', text: 'text-amber-700', icon: AlertTriangle },
  ERROR: { bg: 'bg-red-50', text: 'text-red-700', icon: XCircle },
  OFFLINE: { bg: 'bg-slate-100', text: 'text-slate-500', icon: AlertCircle },
};

const activityIcons: Record<ActivityType, typeof Activity> = {
  SYNC_SUCCESS: CheckCircle,
  SYNC_ERROR: XCircle,
  INVENTORY_UPDATE: Package,
  CATALOG_UPDATE: RefreshCcw,
  ORDER_FORWARD: ShoppingCart,
  ORDER_PENDING: Clock,
  ORDER_SHADOWED: AlertCircle,
  ORDER_PUSHED: CheckCircle,
  ORDER_PUSH_FAILED: XCircle,
  FULFILLMENT_SYNCED: CheckCircle,
  RATE_LIMIT: AlertTriangle,
  MAPPING_ERROR: AlertCircle,
  SKU_DRIFT: AlertTriangle,
};

const activityColors: Record<ActivityType, string> = {
  SYNC_SUCCESS: 'text-emerald-600',
  SYNC_ERROR: 'text-red-600',
  INVENTORY_UPDATE: 'text-blue-600',
  CATALOG_UPDATE: 'text-blue-600',
  ORDER_FORWARD: 'text-purple-600',
  ORDER_PENDING: 'text-amber-600',
  ORDER_SHADOWED: 'text-slate-500',
  ORDER_PUSHED: 'text-emerald-600',
  ORDER_PUSH_FAILED: 'text-red-600',
  FULFILLMENT_SYNCED: 'text-emerald-600',
  RATE_LIMIT: 'text-amber-600',
  MAPPING_ERROR: 'text-red-600',
  SKU_DRIFT: 'text-amber-600',
};

function formatTimeAgo(date: string | null): string {
  if (!date) return 'Never';
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function HealthTab() {
  const { selectedListItemId } = useListSelection();
  const connectionId = selectedListItemId;

  const { data: healthData, isLoading: healthLoading } = useConnectionHealth(connectionId ?? undefined);
  const { data: activityData, isLoading: activityLoading } = useConnectionActivity(connectionId ?? undefined);

  const health = healthData?.health;
  const activity = activityData?.activity || [];

  // If no connection selected, show placeholder
  if (!connectionId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-slate-400">
          <Activity className="w-5 h-5" />
          <span className="text-sm font-medium">Health Monitoring</span>
        </div>
        <div className="border rounded-lg p-6 bg-slate-50/50 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Activity className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Select a connection
          </h3>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Choose a connection from the list to view its health metrics and activity.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (healthLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-slate-400">
          <Activity className="w-5 h-5" />
          <span className="text-sm font-medium">Health Monitoring</span>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  const status = health?.status || 'OFFLINE';
  const StatusIcon = statusColors[status].icon;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-slate-400">
        <Activity className="w-5 h-5" />
        <span className="text-sm font-medium">Health Monitoring</span>
      </div>

      {/* Status Card */}
      <div className={cn('rounded-lg p-4 border', statusColors[status].bg)}>
        <div className="flex items-center gap-2">
          <StatusIcon className={cn('w-5 h-5', statusColors[status].text)} />
          <span className={cn('font-medium', statusColors[status].text)}>
            {status === 'HEALTHY' ? 'Connection Healthy' :
             status === 'DEGRADED' ? 'Performance Degraded' :
             status === 'ERROR' ? 'Connection Error' : 'Connection Offline'}
          </span>
        </div>
        {health?.lastError && (
          <p className="text-xs text-red-600 mt-2 font-mono">{health.lastError}</p>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500 uppercase">Sync Status</p>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Last Sync</span>
            </div>
            <span className="text-sm font-medium">
              {formatTimeAgo(health?.lastSyncAt ?? null)}
            </span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Inventory Sync</span>
            </div>
            <span className="text-sm font-medium">
              {formatTimeAgo(health?.lastInventorySyncAt ?? null)}
            </span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCcw className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Catalog Sync</span>
            </div>
            <span className="text-sm font-medium">
              {formatTimeAgo(health?.lastCatalogSyncAt ?? null)}
            </span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Order Forward</span>
            </div>
            <span className="text-sm font-medium">
              {formatTimeAgo(health?.lastOrderForwardAt ?? null)}
            </span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Errors (24h)</span>
            </div>
            <span className={cn(
              'text-sm font-medium',
              (health?.errorCount24h ?? 0) > 0 ? 'text-red-600' : 'text-slate-600'
            )}>
              {health?.errorCount24h ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* Mapping Stats */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500 uppercase">Product Mappings</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="border rounded-lg p-2 bg-white text-center">
            <div className="text-lg font-semibold text-emerald-600">{health?.activeMappings ?? 0}</div>
            <div className="text-xs text-slate-500">Active</div>
          </div>
          <div className="border rounded-lg p-2 bg-white text-center">
            <div className="text-lg font-semibold text-amber-600">{health?.pendingMappings ?? 0}</div>
            <div className="text-xs text-slate-500">Pending</div>
          </div>
          <div className="border rounded-lg p-2 bg-white text-center">
            <div className="text-lg font-semibold text-red-600">{health?.errorMappings ?? 0}</div>
            <div className="text-xs text-slate-500">Errors</div>
          </div>
        </div>
      </div>

      {/* Rate Limit Status */}
      {health?.isThrottled && (
        <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-700">Rate Limited</span>
          </div>
          {health.throttledUntil && (
            <p className="text-xs text-amber-600 mt-1">
              Until {new Date(health.throttledUntil).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {/* Activity Log */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500 uppercase">Recent Activity</p>
        {activityLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        ) : activity.length === 0 ? (
          <div className="border rounded-lg p-4 bg-slate-50 text-center">
            <p className="text-xs text-slate-500">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {activity.slice(0, 20).map((entry) => {
              const Icon = activityIcons[entry.type] || Activity;
              const color = activityColors[entry.type] || 'text-slate-500';
              return (
                <div key={entry.id} className="border rounded-lg p-2 bg-white">
                  <div className="flex items-start gap-2">
                    <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-700 line-clamp-2">{entry.message}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatTimeAgo(entry.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
