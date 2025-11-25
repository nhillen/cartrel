'use client';

/**
 * Filter bar component for list views
 */

import { X } from 'lucide-react';
import { SearchInput } from '@/components/ui/SearchInput';
import { cn } from '@/lib/utils';

interface FilterChip {
  id: string;
  label: string;
  value: string;
}

interface FilterBarProps {
  search: string;
  onSearchChange: (search: string) => void;
  placeholder?: string;
  filters?: FilterChip[];
  onRemoveFilter?: (filterId: string) => void;
  onClearFilters?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function FilterBar({
  search,
  onSearchChange,
  placeholder = 'Search...',
  filters = [],
  onRemoveFilter,
  onClearFilters,
  actions,
  className,
}: FilterBarProps) {
  return (
    <div className={cn('flex items-center gap-3 p-4 border-b bg-white', className)}>
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder={placeholder}
        className="w-64"
      />

      {filters.length > 0 && (
        <div className="flex items-center gap-2">
          {filters.map((filter) => (
            <div
              key={filter.id}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 rounded-md"
            >
              <span className="text-slate-500">{filter.label}:</span>
              <span className="font-medium">{filter.value}</span>
              {onRemoveFilter && (
                <button
                  onClick={() => onRemoveFilter(filter.id)}
                  className="p-0.5 rounded hover:bg-slate-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {onClearFilters && (
            <button
              onClick={onClearFilters}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
