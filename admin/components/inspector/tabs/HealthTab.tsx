/**
 * Health tab stub
 */

import { Activity, Wifi, AlertCircle, Clock, RefreshCcw } from 'lucide-react';

export function HealthTab() {
  return (
    <div className="space-y-4">
      {/* Stub Header */}
      <div className="flex items-center gap-2 text-slate-400">
        <Activity className="w-5 h-5" />
        <span className="text-sm font-medium">Health Monitoring</span>
      </div>

      {/* Coming Soon Message */}
      <div className="border rounded-lg p-6 bg-slate-50/50 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
          <Activity className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Health monitoring coming soon
        </h3>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          When enabled, you&apos;ll see real-time health metrics for this resource.
        </p>
      </div>

      {/* Preview of what will be shown */}
      <div className="space-y-3 opacity-50">
        <p className="text-xs text-slate-500 font-medium">Preview</p>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Webhook queue depth</span>
            </div>
            <span className="text-sm font-medium text-slate-400">—</span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Error rate (24h)</span>
            </div>
            <span className="text-sm font-medium text-slate-400">—</span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Last sync</span>
            </div>
            <span className="text-sm font-medium text-slate-400">—</span>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCcw className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-600">Recent failures</span>
            </div>
            <span className="text-sm font-medium text-slate-400">—</span>
          </div>
        </div>
      </div>
    </div>
  );
}
