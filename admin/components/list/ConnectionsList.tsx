'use client';

/**
 * Connections list component
 */

import { ArrowRightLeft } from 'lucide-react';
import { DataTable, type Column } from './DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { Connection } from '@/types/domain';

interface ConnectionsListProps {
  connections: Connection[];
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect?: (connection: Connection) => void;
  viewMode: 'retailers' | 'suppliers';
}

export function ConnectionsList({
  connections,
  isLoading,
  selectedId,
  onSelect,
  viewMode,
}: ConnectionsListProps) {
  const columns: Column<Connection>[] = [
    {
      id: 'partner',
      header: viewMode === 'retailers' ? 'Supplier' : 'Retailer',
      cell: (row) => {
        const partner = viewMode === 'retailers' ? row.supplierShop : row.retailerShop;
        return (
          <div>
            <div className="font-medium text-slate-900">
              {partner.companyName || partner.myshopifyDomain}
            </div>
            <div className="text-xs text-slate-500">{partner.myshopifyDomain}</div>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
      className: 'w-32',
    },
    {
      id: 'tier',
      header: 'Tier',
      cell: (row) => (
        <span className="text-slate-600">{row.tier}</span>
      ),
      className: 'w-24',
    },
    {
      id: 'paymentTerms',
      header: 'Payment Terms',
      cell: (row) => (
        <span className="text-slate-600">{row.paymentTermsType.replace('_', ' ')}</span>
      ),
      className: 'w-28',
    },
    {
      id: 'created',
      header: 'Created',
      cell: (row) => (
        <span className="text-slate-500">{formatDate(row.createdAt)}</span>
      ),
      className: 'w-28 text-right',
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={connections}
      isLoading={isLoading}
      selectedId={selectedId}
      onRowClick={onSelect}
      getRowId={(row) => row.id}
      emptyState={{
        icon: ArrowRightLeft,
        title: 'No connections yet',
        description: viewMode === 'retailers'
          ? 'This retailer has no supplier connections.'
          : 'This supplier has no retailer connections.',
      }}
    />
  );
}
