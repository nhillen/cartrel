'use client';

/**
 * Admin view - System health, stats, and failed jobs
 */

import { Activity, AlertTriangle, CheckCircle, XCircle, Clock, Server, Database, Webhook } from 'lucide-react';
import { useHealth } from '@/queries/useHealth';
import { useStats } from '@/queries/useStats';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/queries/api';
import type { FailedJob } from '@/types/domain';
import { cn } from '@/lib/utils';

// Shared hook for admin view data
function useAdminData() {
  const { data: health, isLoading: healthLoading } = useHealth();
  const { data: stats } = useStats();
  const { data: failedJobsData } = useQuery({
    queryKey: ['failed-jobs'],
    queryFn: () => api.get<{ failedJobs: FailedJob[] }>('/failed-jobs'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const failedJobs = failedJobsData?.failedJobs || [];
  return { health, healthLoading, stats, failedJobs };
}

// Export individual pane components for AppShell
export function AdminLeftPane() {
  const { health } = useAdminData();

  return (
    <div className="p-4 space-y-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">System Status</h2>
          <p className="text-xs text-slate-500">Platform health monitoring</p>
        </div>

        {/* Overall Status */}
        <div className={cn(
          'p-4 rounded-lg border',
          health?.status === 'healthy' ? 'bg-emerald-50 border-emerald-200' :
          health?.status === 'warning' ? 'bg-amber-50 border-amber-200' :
          health?.status === 'degraded' ? 'bg-orange-50 border-orange-200' :
          health?.status === 'critical' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'
        )}>
          <div className="flex items-center gap-2">
            {health?.status === 'healthy' ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : health?.status === 'critical' ? (
              <XCircle className="w-5 h-5 text-red-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            )}
            <span className="font-medium">
              {health?.status === 'healthy' ? 'All Systems Operational' :
               health?.status === 'warning' ? 'Minor Issues Detected' :
               health?.status === 'degraded' ? 'Degraded Performance' :
               health?.status === 'critical' ? 'System Issues' : 'Loading...'}
            </span>
          </div>
        </div>

        {/* Queue Stats */}
        {health?.queues && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-500 uppercase">Queue Status</h3>
            <div className="space-y-2">
              <QueueCard
                label="Webhook Queue"
                icon={Webhook}
                waiting={health.queues.webhook.waiting}
                active={health.queues.webhook.active}
                failed={health.queues.webhook.failed}
                completed={health.queues.webhook.completed}
              />
              <QueueCard
                label="Import Queue"
                icon={Database}
                waiting={health.queues.import.waiting}
                active={health.queues.import.active}
                failed={health.queues.import.failed}
                completed={health.queues.import.completed}
              />
            </div>
          </div>
        )}

        {/* Components */}
        {health?.components && health.components.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-500 uppercase">Components</h3>
            <div className="space-y-1">
              {health.components.map((comp) => (
                <div key={comp.component} className="flex items-center justify-between p-2 rounded bg-slate-50">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'w-2 h-2 rounded-full',
                      comp.healthy ? 'bg-emerald-500' : 'bg-red-500'
                    )} />
                    <span className="text-sm">{comp.component}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {comp.apiResponseTime && `${comp.apiResponseTime}ms`}
                    {comp.databaseResponseTime && `${comp.databaseResponseTime}ms`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}

export function AdminMiddlePane() {
  const { health, failedJobs } = useAdminData();

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
        {/* Active Incidents */}
        {health?.activeIncidents && health.activeIncidents.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Active Incidents ({health.activeIncidents.length})
            </h3>
            <div className="space-y-2">
              {health.activeIncidents.map((incident) => (
                <div key={incident.id} className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{incident.title}</div>
                      <div className="text-xs text-slate-600 mt-1">
                        {incident.component} • {incident.impact} • {incident.status}
                      </div>
                      {incident.latestUpdate && (
                        <div className="text-xs text-slate-500 mt-2">{incident.latestUpdate}</div>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {new Date(incident.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Failed Jobs */}
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            Failed Jobs ({failedJobs.length})
          </h3>
          {failedJobs.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
              No failed jobs
            </div>
          ) : (
            <div className="space-y-2">
              {failedJobs.map((job) => (
                <div key={job.id} className="p-3 rounded-lg border border-red-200 bg-red-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {job.data.topic || job.name}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        {job.data.shopDomain && <span>{job.data.shopDomain} • </span>}
                        Attempts: {job.attemptsMade}
                      </div>
                      <div className="text-xs text-red-600 mt-1 truncate">
                        {job.failedReason}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 ml-2">
                      {job.timestamp && new Date(job.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Incidents */}
        {health?.recentIncidents && health.recentIncidents.length > 0 && (
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              Recently Resolved ({health.recentIncidents.length})
            </h3>
            <div className="space-y-2">
              {health.recentIncidents.map((incident) => (
                <div key={incident.id} className="p-2 rounded bg-slate-50 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-700">{incident.title}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(incident.resolvedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}

export function AdminRightPane() {
  const { stats } = useAdminData();

  return (
    <div className="p-4 space-y-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Platform Stats</h2>
          <p className="text-xs text-slate-500">Usage overview</p>
        </div>

        {stats && (
          <div className="space-y-3">
            <StatCard label="Total Shops" value={stats.totalShops} />
            <StatCard label="Suppliers" value={stats.totalSuppliers} />
            <StatCard label="Retailers" value={stats.totalRetailers} />
            <StatCard label="Active Connections" value={stats.totalConnections} />
            <StatCard label="Products" value={stats.totalProducts} />
            <StatCard label="Purchase Orders" value={stats.totalOrders} />

            {/* Plan breakdown */}
            {stats.shopsByPlan && (
              <div className="pt-3 border-t">
                <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">By Plan</h3>
                <div className="space-y-1">
                  {Object.entries(stats.shopsByPlan).map(([plan, count]) => (
                    <div key={plan} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{plan}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Version info */}
            <div className="pt-3 border-t">
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Version</h3>
              <div className="space-y-1 text-xs">
                {stats.version && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Version</span>
                    <span className="font-mono">{stats.version}</span>
                  </div>
                )}
                {stats.commitHash && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Commit</span>
                    <span className="font-mono">{stats.commitHash}</span>
                  </div>
                )}
                {stats.buildDate && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Built</span>
                    <span>{new Date(stats.buildDate).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// Legacy export for backwards compatibility
export function AdminView() {
  return (
    <>
      <AdminLeftPane />
      <AdminMiddlePane />
      <AdminRightPane />
    </>
  );
}

interface QueueCardProps {
  label: string;
  icon: typeof Activity;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
}

function QueueCard({ label, icon: Icon, waiting, active, failed, completed }: QueueCardProps) {
  const hasIssues = failed > 0 || waiting > 100;

  return (
    <div className={cn(
      'p-3 rounded-lg border',
      hasIssues ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <div className="text-slate-500">Waiting</div>
          <div className={cn('font-medium', waiting > 100 && 'text-amber-600')}>{waiting}</div>
        </div>
        <div>
          <div className="text-slate-500">Active</div>
          <div className="font-medium">{active}</div>
        </div>
        <div>
          <div className="text-slate-500">Failed</div>
          <div className={cn('font-medium', failed > 0 && 'text-red-600')}>{failed}</div>
        </div>
        <div>
          <div className="text-slate-500">Done</div>
          <div className="font-medium text-emerald-600">{completed}</div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-lg font-semibold">{value.toLocaleString()}</span>
    </div>
  );
}
