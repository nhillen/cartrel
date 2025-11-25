'use client';

/**
 * Connection inspector panel
 */

import { useState } from 'react';
import { Trash2, Copy, ExternalLink } from 'lucide-react';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { useToast } from '@/context/ToastContext';
import { formatDate, cn } from '@/lib/utils';
import type { Connection } from '@/types/domain';

interface ConnectionInspectorProps {
  connection: Connection;
  onDelete?: (connectionId: string) => void;
}

export function ConnectionInspector({ connection, onDelete }: ConnectionInspectorProps) {
  const { pushToast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;

    const confirmed = window.confirm(
      'Delete this connection? Related mappings and orders may be affected.'
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete(connection.id);
      pushToast('success', 'Connection deleted');
    } catch {
      pushToast('error', 'Failed to delete connection');
    } finally {
      setIsDeleting(false);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(connection.id);
    pushToast('info', 'Connection ID copied');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <StatusBadge status={connection.status} />
          <Badge variant="default">{connection.tier}</Badge>
        </div>
        <h3 className="text-lg font-semibold text-slate-900">
          {connection.supplierShop.companyName || connection.supplierShop.myshopifyDomain}
          <span className="text-slate-400 mx-2">→</span>
          {connection.retailerShop.companyName || connection.retailerShop.myshopifyDomain}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Created {formatDate(connection.createdAt)}
        </p>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-4">
        <DetailItem label="Supplier">
          <div className="font-medium">
            {connection.supplierShop.companyName || 'No company name'}
          </div>
          <div className="text-xs text-slate-500">
            {connection.supplierShop.myshopifyDomain}
          </div>
        </DetailItem>

        <DetailItem label="Retailer">
          <div className="font-medium">
            {connection.retailerShop.companyName || 'No company name'}
          </div>
          <div className="text-xs text-slate-500">
            {connection.retailerShop.myshopifyDomain}
          </div>
        </DetailItem>

        <DetailItem label="Payment Terms">
          <div className="font-medium">
            {connection.paymentTermsType.replace('_', ' ')}
          </div>
        </DetailItem>

        <DetailItem label="Tier">
          <div className="font-medium">{connection.tier}</div>
        </DetailItem>
      </div>

      {/* Extended Details */}
      {(connection.creditLimit || connection.minOrderAmount || connection.nickname) && (
        <div className="border-t pt-4 space-y-3">
          {connection.nickname && (
            <DetailItem label="Nickname">
              <div className="font-medium">{connection.nickname}</div>
            </DetailItem>
          )}
          {connection.creditLimit && (
            <DetailItem label="Credit Limit">
              <div className="font-medium">${connection.creditLimit.toLocaleString()}</div>
            </DetailItem>
          )}
          {connection.minOrderAmount && (
            <DetailItem label="Min Order Amount">
              <div className="font-medium">${connection.minOrderAmount.toLocaleString()}</div>
            </DetailItem>
          )}
          {connection.notes && (
            <DetailItem label="Notes">
              <div className="text-slate-600">{connection.notes}</div>
            </DetailItem>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="border-t pt-4 space-y-2">
        <p className="text-xs text-slate-500 font-medium mb-2">Actions</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-slate-50 transition"
          >
            <Copy className="w-3 h-3" />
            Copy ID
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-slate-50 transition opacity-50 cursor-not-allowed"
            disabled
          >
            <ExternalLink className="w-3 h-3" />
            Impersonate
          </button>
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition',
                'border-rose-200 text-rose-600 hover:bg-rose-50'
              )}
            >
              <Trash2 className="w-3 h-3" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* IDs */}
      <div className="text-xs text-slate-500 space-y-1 border-t pt-4">
        <p>
          <span className="text-slate-400">Connection ID:</span>{' '}
          <code className="font-mono bg-slate-100 px-1 rounded">{connection.id}</code>
        </p>
        <p>
          <span className="text-slate-400">Supplier ID:</span>{' '}
          <code className="font-mono bg-slate-100 px-1 rounded">{connection.supplierShop.id}</code>
        </p>
        <p>
          <span className="text-slate-400">Retailer ID:</span>{' '}
          <code className="font-mono bg-slate-100 px-1 rounded">{connection.retailerShop.id}</code>
        </p>
      </div>
    </div>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <div className="text-sm text-slate-900">{children}</div>
    </div>
  );
}
