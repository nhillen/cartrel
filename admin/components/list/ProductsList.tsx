'use client';

/**
 * Products list component
 */

import { Package } from 'lucide-react';
import { DataTable, type Column } from './DataTable';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { Product } from '@/types/domain';

interface ProductsListProps {
  products: Product[];
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect?: (product: Product) => void;
}

export function ProductsList({
  products,
  isLoading,
  selectedId,
  onSelect,
}: ProductsListProps) {
  const columns: Column<Product>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (row) => (
        <div>
          <div className="font-medium text-slate-900">{row.title}</div>
          <div className="text-xs text-slate-500">
            {row.supplierShop.myshopifyDomain}
          </div>
        </div>
      ),
    },
    {
      id: 'sku',
      header: 'SKU',
      cell: (row) => (
        <span className="text-slate-600 font-mono text-xs">
          {row.sku || '—'}
        </span>
      ),
      className: 'w-32',
    },
    {
      id: 'price',
      header: 'Wholesale Price',
      cell: (row) => (
        <span className="text-slate-900 font-medium">
          {formatCurrency(row.wholesalePrice)}
        </span>
      ),
      className: 'w-32 text-right',
    },
    {
      id: 'inventory',
      header: 'Inventory',
      cell: (row) => (
        <span className={row.inventoryQuantity < 10 ? 'text-amber-600' : 'text-slate-600'}>
          {formatNumber(row.inventoryQuantity)}
        </span>
      ),
      className: 'w-24 text-right',
    },
    {
      id: 'wholesale',
      header: 'Wholesale',
      cell: (row) => (
        <Badge variant={row.isWholesaleEligible ? 'success' : 'default'}>
          {row.isWholesaleEligible ? 'Eligible' : 'Not enabled'}
        </Badge>
      ),
      className: 'w-28',
    },
    {
      id: 'mappings',
      header: 'Mappings',
      cell: (row) => (
        <span className="text-slate-500">{row.mappingCount}</span>
      ),
      className: 'w-20 text-right',
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={products}
      isLoading={isLoading}
      selectedId={selectedId}
      onRowClick={onSelect}
      getRowId={(row) => row.id}
      emptyState={{
        icon: Package,
        title: 'No products found',
        description: 'This supplier has no wholesale-eligible products.',
      }}
    />
  );
}
