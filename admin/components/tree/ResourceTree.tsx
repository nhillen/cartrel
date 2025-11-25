'use client';

/**
 * Resource tree component for left pane navigation
 */

import { useMemo } from 'react';
import { ChevronRight, ChevronDown, Store, Factory, ArrowRightLeft, Package, ShoppingCart, Activity } from 'lucide-react';
import { useTreeSelection, useActiveView } from '@/context/DashboardContext';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge, PlanBadge, StatusBadge } from '@/components/ui/Badge';
import { SkeletonTree } from '@/components/ui/Skeleton';
import { cn, getInitials } from '@/lib/utils';
import type { Shop, Connection, Product } from '@/types/domain';

interface ResourceTreeProps {
  shops: Shop[];
  connections: Connection[];
  products: Product[];
  isLoading?: boolean;
  search: string;
  onSearchChange: (search: string) => void;
}

export function ResourceTree({
  shops,
  connections,
  products,
  isLoading,
  search,
  onSearchChange,
}: ResourceTreeProps) {
  const { activeView } = useActiveView();
  const {
    selectedNodeId,
    expandedNodes,
    selectTreeNode,
    toggleTreeNode,
  } = useTreeSelection();

  // Filter shops based on current view and search
  const filteredShops = useMemo(() => {
    let filtered = shops;

    // Filter by role based on view
    if (activeView === 'retailers') {
      filtered = shops.filter(s => s.role === 'RETAILER' || s.role === 'BOTH');
    } else if (activeView === 'suppliers') {
      filtered = shops.filter(s => s.role === 'SUPPLIER' || s.role === 'BOTH');
    }

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        s =>
          s.myshopifyDomain.toLowerCase().includes(searchLower) ||
          s.companyName?.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [shops, activeView, search]);

  // Get connections for a shop
  const getShopConnections = (shop: Shop) => {
    if (activeView === 'retailers') {
      return connections.filter(c => c.retailerShop.myshopifyDomain === shop.myshopifyDomain);
    }
    return connections.filter(c => c.supplierShop.myshopifyDomain === shop.myshopifyDomain);
  };

  // Get products for a shop (only for suppliers)
  const getShopProducts = (shop: Shop) => {
    if (activeView === 'suppliers') {
      return products.filter(p => p.supplierShop.myshopifyDomain === shop.myshopifyDomain);
    }
    return [];
  };

  if (isLoading) {
    return (
      <div className="p-3">
        <div className="mb-3">
          <SearchInput value="" onChange={() => {}} placeholder="Search..." />
        </div>
        <SkeletonTree items={6} />
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* Search */}
      <div className="mb-3">
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder={`Search ${activeView}...`}
        />
      </div>

      {/* Tree */}
      <div className="space-y-1">
        {filteredShops.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center">
            No {activeView} found
          </div>
        ) : (
          filteredShops.map((shop) => {
            const shopId = `shop-${shop.id}`;
            const isExpanded = expandedNodes.has(shopId);
            const isSelected = selectedNodeId === shopId;
            const shopConnections = getShopConnections(shop);
            const shopProducts = getShopProducts(shop);

            return (
              <div key={shop.id}>
                {/* Shop Node */}
                <button
                  onClick={() => {
                    selectTreeNode(shopId, 'shop');
                    if (!isExpanded) toggleTreeNode(shopId);
                  }}
                  className={cn(
                    'w-full text-left p-2 rounded-lg flex items-center gap-2 transition hover:bg-slate-100',
                    isSelected && 'bg-blue-50 border border-blue-200'
                  )}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTreeNode(shopId);
                    }}
                    className="p-0.5 rounded hover:bg-slate-200"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  <div className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white',
                    activeView === 'retailers' ? 'bg-emerald-600' : 'bg-blue-600'
                  )}>
                    {getInitials(shop.companyName || shop.myshopifyDomain)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {shop.companyName || shop.myshopifyDomain}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {shop.myshopifyDomain}
                    </div>
                  </div>

                  <PlanBadge plan={shop.plan} />
                </button>

                {/* Children */}
                {isExpanded && (
                  <div className="ml-6 mt-1 space-y-0.5 border-l pl-2">
                    {/* Connections Group */}
                    <TreeGroupNode
                      icon={ArrowRightLeft}
                      label="Connections"
                      count={shopConnections.length}
                      nodeId={`${shopId}-connections`}
                      isSelected={selectedNodeId === `${shopId}-connections`}
                      onClick={() => selectTreeNode(`${shopId}-connections`, 'connection')}
                    />

                    {/* Products Group (only for suppliers) */}
                    {activeView === 'suppliers' && (
                      <TreeGroupNode
                        icon={Package}
                        label="Products"
                        count={shopProducts.length}
                        nodeId={`${shopId}-products`}
                        isSelected={selectedNodeId === `${shopId}-products`}
                        onClick={() => selectTreeNode(`${shopId}-products`, 'product')}
                      />
                    )}

                    {/* Orders Group (stub) */}
                    <TreeGroupNode
                      icon={ShoppingCart}
                      label="Orders"
                      count={0}
                      nodeId={`${shopId}-orders`}
                      isSelected={selectedNodeId === `${shopId}-orders`}
                      onClick={() => selectTreeNode(`${shopId}-orders`, 'order')}
                      disabled
                    />

                    {/* Health Group (stub) */}
                    <TreeGroupNode
                      icon={Activity}
                      label="Health"
                      nodeId={`${shopId}-health`}
                      isSelected={selectedNodeId === `${shopId}-health`}
                      onClick={() => selectTreeNode(`${shopId}-health`, null)}
                      badge={{ text: 'OK', variant: 'success' }}
                      disabled
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Group node for connections, products, orders, health
interface TreeGroupNodeProps {
  icon: typeof ArrowRightLeft;
  label: string;
  count?: number;
  nodeId: string;
  isSelected: boolean;
  onClick: () => void;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' };
  disabled?: boolean;
}

function TreeGroupNode({
  icon: Icon,
  label,
  count,
  nodeId,
  isSelected,
  onClick,
  badge,
  disabled,
}: TreeGroupNodeProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full text-left p-2 rounded-lg flex items-center gap-2 transition text-sm',
        isSelected && !disabled && 'bg-blue-50 border border-blue-200',
        !isSelected && !disabled && 'hover:bg-slate-100',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <Icon className="w-4 h-4 text-slate-400" />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-slate-400">{count}</span>
      )}
      {badge && (
        <Badge variant={badge.variant}>{badge.text}</Badge>
      )}
    </button>
  );
}
