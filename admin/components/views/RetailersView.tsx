'use client';

/**
 * Retailers view - Main view for CS helping retailer customers
 */

import { useMemo, useState, useCallback } from 'react';
import { useDashboard, useListSelection } from '@/context/DashboardContext';
import { useShops } from '@/queries/useShops';
import { useConnections, useDeleteConnection } from '@/queries/useConnections';
import { useProducts } from '@/queries/useProducts';
import { useToast } from '@/context/ToastContext';
import { ResourceTree } from '@/components/tree/ResourceTree';
import { FilterBar } from '@/components/list/FilterBar';
import { ConnectionsList } from '@/components/list/ConnectionsList';
import { ShopsList } from '@/components/list/ShopsList';
import { Inspector } from '@/components/inspector/Inspector';
import { SkeletonTable } from '@/components/ui/Skeleton';
import type { Shop, Connection } from '@/types/domain';

export function RetailersView() {
  const { state, selectTreeNode } = useDashboard();
  const { selectedListItemId, listSearch, selectListItem, setListSearch } = useListSelection();
  const { pushToast } = useToast();

  const [treeSearch, setTreeSearch] = useState('');

  // Fetch data
  const { data: shops = [], isLoading: shopsLoading } = useShops();
  const { data: connections = [], isLoading: connectionsLoading } = useConnections();
  const { data: products = [] } = useProducts();

  // Delete connection mutation
  const deleteConnectionMutation = useDeleteConnection();

  // Filter shops to retailers only
  const retailers = useMemo(
    () => shops.filter((s) => s.role === 'RETAILER' || s.role === 'BOTH'),
    [shops]
  );

  // Get selected shop from tree
  const selectedShop = useMemo(() => {
    if (!state.selectedNodeId) return null;
    const shopId = state.selectedNodeId.replace('shop-', '').split('-')[0];
    return shops.find((s) => s.id === shopId) || null;
  }, [state.selectedNodeId, shops]);

  // Filter connections based on selected shop
  const filteredConnections = useMemo(() => {
    if (!selectedShop) return connections;

    // Filter to connections where selected shop is the retailer
    return connections.filter(
      (c) => c.retailerShop.myshopifyDomain === selectedShop.myshopifyDomain
    );
  }, [connections, selectedShop]);

  // Apply search filter to list
  const searchedConnections = useMemo(() => {
    if (!listSearch) return filteredConnections;
    const search = listSearch.toLowerCase();
    return filteredConnections.filter(
      (c) =>
        c.supplierShop.myshopifyDomain.toLowerCase().includes(search) ||
        c.supplierShop.companyName?.toLowerCase().includes(search) ||
        c.retailerShop.myshopifyDomain.toLowerCase().includes(search)
    );
  }, [filteredConnections, listSearch]);

  // Get selected connection for inspector
  const selectedConnection = useMemo(() => {
    if (!selectedListItemId) return null;
    return connections.find((c) => c.id === selectedListItemId) || null;
  }, [selectedListItemId, connections]);

  // Handlers
  const handleDeleteConnection = useCallback(
    async (connectionId: string) => {
      try {
        await deleteConnectionMutation.mutateAsync(connectionId);
        selectListItem(null);
        pushToast('success', 'Connection deleted');
      } catch {
        pushToast('error', 'Failed to delete connection');
      }
    },
    [deleteConnectionMutation, selectListItem, pushToast]
  );

  const handleSelectConnection = useCallback(
    (connection: Connection) => {
      selectListItem(connection.id);
    },
    [selectListItem]
  );

  // Determine what to show in middle pane
  const showConnectionsList = state.selectedNodeType === 'shop' ||
    state.selectedNodeId?.includes('-connections');
  const showShopsList = !state.selectedNodeId;

  return (
    <>
      {/* Left Pane - Resource Tree */}
      <ResourceTree
        shops={retailers}
        connections={connections}
        products={products}
        isLoading={shopsLoading}
        search={treeSearch}
        onSearchChange={setTreeSearch}
      />

      {/* Middle Pane - List */}
      <div className="h-full flex flex-col">
        <FilterBar
          search={listSearch}
          onSearchChange={setListSearch}
          placeholder={showConnectionsList ? 'Search connections...' : 'Search retailers...'}
        />
        <div className="flex-1 overflow-y-auto">
          {showShopsList && (
            <ShopsList
              shops={retailers}
              isLoading={shopsLoading}
              selectedId={selectedShop?.id}
              onSelect={(shop) => selectTreeNode(`shop-${shop.id}`, 'shop')}
            />
          )}
          {showConnectionsList && (
            <ConnectionsList
              connections={searchedConnections}
              isLoading={connectionsLoading}
              selectedId={selectedListItemId}
              onSelect={handleSelectConnection}
              viewMode="retailers"
            />
          )}
        </div>
      </div>

      {/* Right Pane - Inspector */}
      <Inspector
        selectedShop={selectedShop}
        selectedConnection={selectedConnection}
        onDeleteConnection={handleDeleteConnection}
      />
    </>
  );
}
