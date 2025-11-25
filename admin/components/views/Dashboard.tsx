'use client';

/**
 * Main dashboard component
 * Switches between views based on active navigation
 */

import { useActiveView } from '@/context/DashboardContext';
import { AppShell } from '@/components/layout/AppShell';
import { RetailersView } from './RetailersView';
import { SuppliersView } from './SuppliersView';
import { AdminView } from './AdminView';

export function Dashboard() {
  const { activeView } = useActiveView();

  // Render the appropriate view based on active navigation
  const renderView = () => {
    switch (activeView) {
      case 'retailers':
        return <RetailersView />;
      case 'suppliers':
        return <SuppliersView />;
      case 'admin':
        return <AdminView />;
      default:
        return <SuppliersView />;
    }
  };

  // Get the panes from the active view
  // Views return [leftPane, middlePane, rightPane] as children
  const ViewComponent = () => {
    switch (activeView) {
      case 'retailers':
        return <RetailersViewWrapper />;
      case 'suppliers':
        return <SuppliersViewWrapper />;
      case 'admin':
        return <AdminViewWrapper />;
      default:
        return <SuppliersViewWrapper />;
    }
  };

  return <ViewComponent />;
}

// Wrapper components to properly pass panes to AppShell
function RetailersViewWrapper() {
  return (
    <AppShell
      leftPane={<RetailersLeftPane />}
      middlePane={<RetailersMiddlePane />}
      rightPane={<RetailersRightPane />}
    />
  );
}

function SuppliersViewWrapper() {
  return (
    <AppShell
      leftPane={<SuppliersLeftPane />}
      middlePane={<SuppliersMiddlePane />}
      rightPane={<SuppliersRightPane />}
    />
  );
}

function AdminViewWrapper() {
  return (
    <AppShell
      leftPane={<AdminLeftPane />}
      middlePane={<AdminMiddlePane />}
      rightPane={<AdminRightPane />}
    />
  );
}

// These components extract the panes from the view components
// They share state through context, so we can split them up

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
import { Settings, CreditCard, Activity, BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Connection, Product } from '@/types/domain';

// ===== RETAILERS VIEW PANES =====

function RetailersLeftPane() {
  const [treeSearch, setTreeSearch] = useState('');
  const { data: shops = [], isLoading } = useShops();
  const { data: connections = [] } = useConnections();
  const { data: products = [] } = useProducts();

  const retailers = useMemo(
    () => shops.filter((s) => s.role === 'RETAILER' || s.role === 'BOTH'),
    [shops]
  );

  return (
    <ResourceTree
      shops={retailers}
      connections={connections}
      products={products}
      isLoading={isLoading}
      search={treeSearch}
      onSearchChange={setTreeSearch}
    />
  );
}

function RetailersMiddlePane() {
  const { state, selectTreeNode } = useDashboard();
  const { selectedListItemId, listSearch, selectListItem, setListSearch } = useListSelection();
  const { data: shops = [], isLoading: shopsLoading } = useShops();
  const { data: connections = [], isLoading: connectionsLoading } = useConnections();

  const retailers = useMemo(
    () => shops.filter((s) => s.role === 'RETAILER' || s.role === 'BOTH'),
    [shops]
  );

  const selectedShop = useMemo(() => {
    if (!state.selectedNodeId) return null;
    const shopId = state.selectedNodeId.replace('shop-', '').split('-')[0];
    return shops.find((s) => s.id === shopId) || null;
  }, [state.selectedNodeId, shops]);

  const filteredConnections = useMemo(() => {
    if (!selectedShop) return connections;
    return connections.filter(
      (c) => c.retailerShop.myshopifyDomain === selectedShop.myshopifyDomain
    );
  }, [connections, selectedShop]);

  const searchedConnections = useMemo(() => {
    if (!listSearch) return filteredConnections;
    const search = listSearch.toLowerCase();
    return filteredConnections.filter(
      (c) =>
        c.supplierShop.myshopifyDomain.toLowerCase().includes(search) ||
        c.supplierShop.companyName?.toLowerCase().includes(search)
    );
  }, [filteredConnections, listSearch]);

  const showConnectionsList = state.selectedNodeType === 'shop' ||
    state.selectedNodeId?.includes('-connections');
  const showShopsList = !state.selectedNodeId;

  return (
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
            onSelect={(c) => selectListItem(c.id)}
            viewMode="retailers"
          />
        )}
      </div>
    </div>
  );
}

function RetailersRightPane() {
  const { state } = useDashboard();
  const { selectedListItemId, selectListItem } = useListSelection();
  const { pushToast } = useToast();
  const { data: shops = [] } = useShops();
  const { data: connections = [] } = useConnections();
  const deleteConnectionMutation = useDeleteConnection();

  const selectedShop = useMemo(() => {
    if (!state.selectedNodeId) return null;
    const shopId = state.selectedNodeId.replace('shop-', '').split('-')[0];
    return shops.find((s) => s.id === shopId) || null;
  }, [state.selectedNodeId, shops]);

  const selectedConnection = useMemo(() => {
    if (!selectedListItemId) return null;
    return connections.find((c) => c.id === selectedListItemId) || null;
  }, [selectedListItemId, connections]);

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

  return (
    <Inspector
      selectedShop={selectedShop}
      selectedConnection={selectedConnection}
      onDeleteConnection={handleDeleteConnection}
    />
  );
}

// ===== SUPPLIERS VIEW PANES =====

function SuppliersLeftPane() {
  const [treeSearch, setTreeSearch] = useState('');
  const { data: shops = [], isLoading } = useShops();
  const { data: connections = [] } = useConnections();
  const { data: products = [] } = useProducts();

  const suppliers = useMemo(
    () => shops.filter((s) => s.role === 'SUPPLIER' || s.role === 'BOTH'),
    [shops]
  );

  return (
    <ResourceTree
      shops={suppliers}
      connections={connections}
      products={products}
      isLoading={isLoading}
      search={treeSearch}
      onSearchChange={setTreeSearch}
    />
  );
}

function SuppliersMiddlePane() {
  const { state, selectTreeNode } = useDashboard();
  const { selectedListItemId, listSearch, selectListItem, setListSearch } = useListSelection();
  const { data: shops = [], isLoading: shopsLoading } = useShops();
  const { data: connections = [], isLoading: connectionsLoading } = useConnections();
  const { data: products = [], isLoading: productsLoading } = useProducts();

  const suppliers = useMemo(
    () => shops.filter((s) => s.role === 'SUPPLIER' || s.role === 'BOTH'),
    [shops]
  );

  const selectedShop = useMemo(() => {
    if (!state.selectedNodeId) return null;
    const shopId = state.selectedNodeId.replace('shop-', '').split('-')[0];
    return shops.find((s) => s.id === shopId) || null;
  }, [state.selectedNodeId, shops]);

  const showProducts = state.selectedNodeId?.includes('-products');
  const showConnections = state.selectedNodeId?.includes('-connections') ||
    (state.selectedNodeType === 'shop' && !showProducts);
  const showShopsList = !state.selectedNodeId;

  const filteredConnections = useMemo(() => {
    if (!selectedShop) return connections;
    return connections.filter(
      (c) => c.supplierShop.myshopifyDomain === selectedShop.myshopifyDomain
    );
  }, [connections, selectedShop]);

  const filteredProducts = useMemo(() => {
    if (!selectedShop) return products;
    return products.filter(
      (p) => p.supplierShop.myshopifyDomain === selectedShop.myshopifyDomain
    );
  }, [products, selectedShop]);

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

  return (
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
            onSelect={(c) => selectListItem(c.id)}
            viewMode="suppliers"
          />
        )}
        {showProducts && (
          <ProductsList
            products={searchedProducts}
            isLoading={productsLoading}
            selectedId={selectedListItemId}
            onSelect={(p) => selectListItem(p.id)}
          />
        )}
      </div>
    </div>
  );
}

function SuppliersRightPane() {
  const { state } = useDashboard();
  const { selectedListItemId, selectListItem } = useListSelection();
  const { pushToast } = useToast();
  const { data: shops = [] } = useShops();
  const { data: connections = [] } = useConnections();
  const { data: products = [] } = useProducts();
  const updatePlanMutation = useUpdatePlan();
  const deleteConnectionMutation = useDeleteConnection();

  const selectedShop = useMemo(() => {
    if (!state.selectedNodeId) return null;
    const shopId = state.selectedNodeId.replace('shop-', '').split('-')[0];
    return shops.find((s) => s.id === shopId) || null;
  }, [state.selectedNodeId, shops]);

  const showProducts = state.selectedNodeId?.includes('-products');
  const showConnections = state.selectedNodeId?.includes('-connections') ||
    (state.selectedNodeType === 'shop' && !showProducts);

  const selectedConnection = useMemo(() => {
    if (!selectedListItemId || !showConnections) return null;
    return connections.find((c) => c.id === selectedListItemId) || null;
  }, [selectedListItemId, showConnections, connections]);

  const selectedProduct = useMemo(() => {
    if (!selectedListItemId || !showProducts) return null;
    return products.find((p) => p.id === selectedListItemId) || null;
  }, [selectedListItemId, showProducts, products]);

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

  return (
    <Inspector
      selectedShop={selectedShop}
      selectedConnection={selectedConnection}
      selectedProduct={selectedProduct}
      onUpdatePlan={handleUpdatePlan}
      onDeleteConnection={handleDeleteConnection}
    />
  );
}

// ===== ADMIN VIEW PANES =====

function AdminLeftPane() {
  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">Admin Settings</h2>
        <p className="text-xs text-slate-500">Platform configuration</p>
      </div>

      <div className="space-y-1">
        <AdminNavItem
          icon={CreditCard}
          label="Pricing Tiers"
          description="Manage subscription plans"
          active
        />
        <AdminNavItem
          icon={Activity}
          label="System Health"
          description="Platform monitoring"
        />
        <AdminNavItem
          icon={BarChart3}
          label="Platform Stats"
          description="Usage analytics"
        />
      </div>
    </div>
  );
}

function AdminMiddlePane() {
  return (
    <div className="h-full flex flex-col p-6">
      <EmptyState
        icon={Settings}
        title="Admin Settings Coming Soon"
        description="This section will include pricing tier management, system health monitoring, and platform analytics."
      />
    </div>
  );
}

function AdminRightPane() {
  return (
    <div className="p-4">
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        Select an admin section
      </div>
    </div>
  );
}

interface AdminNavItemProps {
  icon: typeof Settings;
  label: string;
  description: string;
  active?: boolean;
}

function AdminNavItem({ icon: Icon, label, description, active }: AdminNavItemProps) {
  return (
    <button
      className={`w-full text-left p-3 rounded-lg transition ${
        active
          ? 'bg-blue-50 border border-blue-200'
          : 'hover:bg-slate-100 border border-transparent'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className={`text-sm font-medium ${active ? 'text-blue-900' : 'text-slate-700'}`}>
            {label}
          </div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
    </button>
  );
}
