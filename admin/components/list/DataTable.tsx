'use client';

/**
 * Generic data table component
 */

import { cn } from '@/lib/utils';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LucideIcon } from 'lucide-react';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyState?: {
    icon?: LucideIcon;
    title: string;
    description?: string;
  };
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  getRowId: (row: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  isLoading,
  emptyState,
  selectedId,
  onRowClick,
  getRowId,
}: DataTableProps<T>) {
  if (isLoading) {
    return <SkeletonTable rows={8} />;
  }

  if (data.length === 0 && emptyState) {
    return (
      <EmptyState
        icon={emptyState.icon}
        title={emptyState.title}
        description={emptyState.description}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b sticky top-0">
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                className={cn(
                  'px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider',
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {data.map((row) => {
            const rowId = getRowId(row);
            const isSelected = selectedId === rowId;

            return (
              <tr
                key={rowId}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'transition',
                  onRowClick && 'cursor-pointer',
                  isSelected
                    ? 'bg-blue-50'
                    : onRowClick && 'hover:bg-slate-50'
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn('px-4 py-3 text-sm', col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
