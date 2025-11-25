/**
 * Tickets tab stub
 */

import { Ticket, Plus, MessageSquare, Clock, CheckCircle } from 'lucide-react';

export function TicketsTab() {
  return (
    <div className="space-y-4">
      {/* Stub Header */}
      <div className="flex items-center gap-2 text-slate-400">
        <Ticket className="w-5 h-5" />
        <span className="text-sm font-medium">Support Tickets</span>
      </div>

      {/* Coming Soon Message */}
      <div className="border rounded-lg p-6 bg-slate-50/50 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
          <Ticket className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Support tickets coming soon
        </h3>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          When enabled, you&apos;ll see related support tickets and be able to create new ones.
        </p>
      </div>

      {/* Preview of what will be shown */}
      <div className="space-y-3 opacity-50">
        <p className="text-xs text-slate-500 font-medium">Planned features</p>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center gap-3">
            <Plus className="w-4 h-4 text-slate-400" />
            <div>
              <p className="text-sm text-slate-600">Create new ticket</p>
              <p className="text-xs text-slate-400">Quick ticket creation with resource context</p>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-4 h-4 text-slate-400" />
            <div>
              <p className="text-sm text-slate-600">Zendesk integration</p>
              <p className="text-xs text-slate-400">View and reply to tickets inline</p>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-slate-400" />
            <div>
              <p className="text-sm text-slate-600">Auto-created alerts</p>
              <p className="text-xs text-slate-400">Automatic tickets for threshold breaches</p>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-white">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-4 h-4 text-slate-400" />
            <div>
              <p className="text-sm text-slate-600">Status tracking</p>
              <p className="text-xs text-slate-400">Open, Waiting, Solved status flow</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
