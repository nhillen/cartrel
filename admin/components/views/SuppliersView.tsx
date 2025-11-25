'use client';

/**
 * Suppliers view - Main view for CS helping supplier customers
 */

import { useMemo, useState, useCallback } from 'react';
import { useDashboard, useListSelection } from '@/context/DashboardContext';
import { useShops, useUpdatePlan } from '@/queries/useShops';
import { useConnections, useDeleteConnection } from '@/queries/useConnections';
import { useProducts } from '@/queries/useProducts';
import { useToast } from '@/context/ToastContext';
import { ResourceTree } from '@/components/tree/ResourceTree';
import { FilterBar } from '@/components/list/FilterBar';
import { ConnectionsList } from '@/components/list/ConnectionsList';
import { ProductsList } from '@/components/list/ProductsList';
import { ShopsList } from '@/components/list/ShopsList';
import { Inspector } from '@/components/inspector/Inspector';
import type { Shop, Connection, Product } from '@/types/domain';

export function SuppliersView() {
  const { state, selectTreeNode } = useDashboard();
  const { selectedListItemId, listSearch, selectListItem, setListSearch } = useListSelection();
  const { pushToast } = useToast();

  const [treeSearch, setTreeSearch] = useState('');

  // Fetch data
  const { data: shops = [], isLoading: shopsLoading } = useShops();
  const { data: connections = [], isLoading: connectionsLoading } = useConnections();
  const { data: products = [], isLoading: productsLoading } = useProducts();

  // Mutations
  const updatePlanMutation = useUpdatePlan();
  const deleteConnectionMutation = useDeleteConnection();

  // Filter shops to suppliers only
  const suppliers = useMemo(
    () => shops.filter((s) => s.role === 'SUPPLIER' || s.role === 'BOTH'),
    [shops]
  );

  // Get selected shop from tree
  const selectedShop = useMemo(() => {
    if (!state.selectedNodeId) return null;
    const shopId = state.selectedNodeId.replace('shop-', '').split('-')[0];
    return shops.find((s) => s.id === shopId) || null;
  }, [state.selectedNodeId, shops]);

  // Determine what type of list to show
  const showProducts = state.selectedNodeId?.includes('-products');
  const showConnections = state.selectedNodeId?.includes('-connections') ||
    (state.selectedNodeType === 'shop' && !showProducts);
  const showShopsList = !state.selectedNodeId;

  // Filter connections based on selected shop
  const filteredConnections = useMemo(() => {
    if (!selectedShop) return connections;
    return connections.filter(
      (c) => c.supplierShop.myshopifyDomain === selectedShop.myshopifyDomain
    );
  }, [connections, selectedShop]);

  // Filter products based on selected shop
  const filteredProducts = useMemo(() => {
    if (!selectedShop) return products;
    return products.filter(
      (p) => p.supplierShop.myshopifyDomain === selectedShop.myshopifyDomain
    );
  }, [products, selectedShop]);

  // Apply search filter
  const searchedConnections = useMemo(() => {
    if (!listSearch) return filteredConnections;
    const search = listSearch.toLowerCase();
    return filteredConnections.filter(
      (c) =>
        c.retailerShop.myshopifyDomain.toLowerCase().includes(search) ||
        c.retailerShop.companyName?.toLowerCase().includes(search)
    );
  }, [filteredConnections, listSearch]);

  const searchedProducts = useMemo(() => {
    if (!listSearch) return filteredProducts;
    const search = listSearch.toLowerCase();
    return filteredProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(search) ||
        p.sku?.toLowerCase().includes(search)
    );
  }, [filteredProducts, listSearch]);

  // Get selected items for inspector
  const selectedConnection = useMemo(() => {
    if (!selectedListItemId || !showConnections) return null;
    return connections.find((c) => c.id === selectedListItemId) || null;
  }, [selectedListItemId, showConnections, connections]);

  const selectedProduct = useMemo(() => {
    if (!selectedListItemId || !showProducts) return null;
    return products.find((p) => p.id === selectedListItemId) || null;
  }, [selectedListItemId, showProducts, products]);

  // Handlers
  const handleUpdatePlan = useCallback(
    async (shopId: string, plan: string) => {
      try {
        await updatePlanMutation.mutateAsync({
          shopId,
          plan: plan as any,
          notes: 'Updated via admin panel',
        });
        pushToast('success', `Plan updated to ${plan}`);
      } catch {
        pushToast('error', 'Failed to update plan');
      }
    },
    [updatePlanMutation, pushToast]
  );

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

  const handleSelectProduct = useCallback(
    (product: Product) => {
      selectListItem(product.id);
    },
    [selectListItem]
  );

  return (
    <>
      {/* Left Pane - Resource Tree */}
      <ResourceTree
        shops={suppliers}
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
          placeholder={
            showProducts
              ? 'Search products...'
              : showConnections
              ? 'Search connections...'
              : 'Search suppliers...'
          }
        />
        <div className="flex-1 overflow-y-auto">
          {showShopsList && (
            <ShopsList
              shops={suppliers}
              isLoading={shopsLoading}
              selectedId={selectedShop?.id}
              onSelect={(shop) => selectTreeNode(`shop-${shop.id}`, 'shop')}
            />
          )}
          {showConnections && !showShopsList && (
            <ConnectionsList
              connections={searchedConnections}
              isLoading={connectionsLoading}
              selectedId={selectedListItemId}
              onSelect={handleSelectConnection}
              viewMode="suppliers"
            />
          )}
          {showProducts && (
            <ProductsList
              products={searchedProducts}
              isLoading={productsLoading}
              selectedId={selectedListItemId}
              onSelect={handleSelectProduct}
            />
          )}
        </div>
      </div>

      {/* Right Pane - Inspector */}
      <Inspector
        selectedShop={selectedShop}
        selectedConnection={selectedConnection}
        selectedProduct={selectedProduct}
        onUpdatePlan={handleUpdatePlan}
        onDeleteConnection={handleDeleteConnection}
      />
    </>
  );
}
