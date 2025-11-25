'use client';

/**
 * Shops list component (for when viewing all shops)
 */

import { Store } from 'lucide-react';
import { DataTable, type Column } from './DataTable';
import { PlanBadge } from '@/components/ui/Badge';
import { formatDate, formatNumber } from '@/lib/utils';
import type { Shop } from '@/types/domain';

interface ShopsListProps {
  shops: Shop[];
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect?: (shop: Shop) => void;
}

export function ShopsList({
  shops,
  isLoading,
  selectedId,
  onSelect,
}: ShopsListProps) {
  const columns: Column<Shop>[] = [
    {
      id: 'shop',
      header: 'Shop',
      cell: (row) => (
        <div>
          <div className="font-medium text-slate-900">
            {row.companyName || row.myshopifyDomain}
          </div>
          <div className="text-xs text-slate-500">{row.myshopifyDomain}</div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) => (
        <span className="text-slate-600">{row.role}</span>
      ),
      className: 'w-24',
    },
    {
      id: 'plan',
      header: 'Plan',
      cell: (row) => <PlanBadge plan={row.plan} />,
      className: 'w-24',
    },
    {
      id: 'connections',
      header: 'Connections',
      cell: (row) => (
        <span className="text-slate-600">{formatNumber(row.connectionCount)}</span>
      ),
      className: 'w-28 text-right',
    },
    {
      id: 'products',
      header: 'Products',
      cell: (row) => (
        <span className="text-slate-600">{formatNumber(row.productCount)}</span>
      ),
      className: 'w-24 text-right',
    },
    {
      id: 'orders',
      header: 'Orders/mo',
      cell: (row) => (
        <span className="text-slate-600">{formatNumber(row.purchaseOrdersThisMonth)}</span>
      ),
      className: 'w-24 text-right',
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
      data={shops}
      isLoading={isLoading}
      selectedId={selectedId}
      onRowClick={onSelect}
      getRowId={(row) => row.id}
      emptyState={{
        icon: Store,
        title: 'No shops found',
        description: 'No shops match your current filters.',
      }}
    />
  );
}
