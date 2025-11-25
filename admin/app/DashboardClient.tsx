'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { signOut, useSession } from 'next-auth/react';
import {
  Activity,
  ArrowRightLeft,
  CreditCard,
  Database,
  Factory,
  Loader2,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  Store,
} from 'lucide-react';

interface Shop {
  id: string;
  myshopifyDomain: string;
  companyName: string | null;
  role: string;
  plan: string;
  productCount: number;
  connectionCount: number;
  purchaseOrdersThisMonth: number;
}

interface Connection {
  id: string;
  supplierShop: {
    myshopifyDomain: string;
    companyName: string | null;
  };
  retailerShop: {
    myshopifyDomain: string;
    companyName: string | null;
  };
  status: string;
  paymentTermsType: string;
  tier: string;
  createdAt: string;
}

interface Product {
  id: string;
  supplierShop: {
    myshopifyDomain: string;
  };
  title: string;
  sku: string | null;
  wholesalePrice: number;
  inventoryQuantity: number;
  isWholesaleEligible: boolean;
  mappingCount: number;
}

interface Stats {
  totalShops: number;
  totalSuppliers: number;
  totalRetailers: number;
  totalConnections: number;
  totalProducts: number;
}

type DetailTab = 'connections' | 'products' | 'billing' | 'activity';
type ToastType = 'success' | 'error' | 'info';
type Scope = 'all' | 'supplier';
type ViewMode = 'supplier' | 'retailer';

export default function DashboardClient() {
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('connections');
  const [toasts, setToasts] = useState<{ id: number; type: ToastType; message: string }[]>([]);
  const [scope, setScope] = useState<Scope>('supplier');
  const [viewMode, setViewMode] = useState<ViewMode>('supplier');

  const pushToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const getSessionToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/token');
      if (res.ok) {
        const data = await res.json();
        return data.token;
      }
    } catch (error) {
      console.error('Error getting session token:', error);
    }
    return null;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getSessionToken();
      if (!token) {
        pushToast('error', 'Authentication error fetching data');
        return;
      }

      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let rateLimited = false;

      const fetchJson = async (path: string) => {
        const res = await fetch(process.env.NEXT_PUBLIC_API_URL + path, { headers });
        if (res.status === 429) {
          rateLimited = true;
          throw new Error('rate_limited');
        }
        if (!res.ok) {
          throw new Error(`fetch_failed_${path}`);
        }
        return res.json();
      };

      try {
        const statsData = await fetchJson('/stats');
        await sleep(120); // slight stagger to avoid rate limits
        const shopsData = await fetchJson('/shops');
        await sleep(120);
        const connectionsData = await fetchJson('/connections?status=ACTIVE');
        await sleep(120);
        const productsData = await fetchJson('/products?limit=200&wholesale=true');

        setStats(statsData);
        setShops(shopsData.shops || []);
        setConnections(connectionsData.connections || []);
        setProducts(productsData.products || []);
      } catch (err) {
        if (rateLimited) {
          pushToast('error', 'Rate limited (429). Please wait 60s and try again.');
        } else {
          throw err;
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
      pushToast('error', 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [getSessionToken, pushToast]);

  useEffect(() => {
    if (status === 'authenticated' && session) {
      loadData();
    }
  }, [status, session, loadData]);

  useEffect(() => {
    if (!selectedShop && shops.length > 0) {
      if (viewMode === 'supplier') {
        const supplier = shops.find((shop) => shop.role === 'SUPPLIER') || shops[0];
        setSelectedShop(supplier || null);
      } else {
        const retailer = shops.find((shop) => shop.role === 'RETAILER') || shops[0];
        setSelectedShop(retailer || null);
      }
    }
  }, [shops, selectedShop, viewMode]);

  async function updatePlan(shopId: string, plan: string, mode: 'test' | 'live') {
    try {
      const token = await getSessionToken();
      if (!token) {
        pushToast('error', 'Authentication error');
        return;
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/shops/${shopId}/plan`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan,
          notes: `Updated via admin panel (${mode === 'test' ? 'test mode' : 'live'})`,
        }),
      });

      if (res.ok) {
        pushToast('success', 'Plan updated');
        loadData();
      } else {
        pushToast('error', 'Plan update failed');
      }
    } catch (error) {
      console.error('Error updating plan:', error);
      pushToast('error', 'Error updating plan');
    }
  }

  async function deleteConnection(connectionId: string) {
    if (!confirm('Delete this connection? Related mappings/orders may pause.')) {
      return;
    }

    try {
      const token = await getSessionToken();
      if (!token) {
        pushToast('error', 'Authentication error');
        return;
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/connections/${connectionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        pushToast('success', 'Connection deleted');
        loadData();
      } else {
        pushToast('error', 'Failed to delete connection');
      }
    } catch (error) {
      console.error('Error deleting connection:', error);
      pushToast('error', 'Error deleting connection');
    }
  }

  const supplierShops = useMemo(
    () =>
      shops.filter((shop) =>
        ['SUPPLIER', 'SUPPLIER_RETAILER'].includes(shop.role || 'SUPPLIER')
      ),
    [shops]
  );
  const retailerShops = useMemo(
    () =>
      shops.filter((shop) =>
        ['RETAILER', 'SUPPLIER_RETAILER'].includes(shop.role || 'RETAILER')
      ),
    [shops]
  );

  const allSuppliersPseudo: Shop | null = useMemo(() => {
    if (!stats) return null;
    return {
      id: 'all',
      myshopifyDomain: 'All suppliers',
      companyName: 'Global scope',
      role: 'SUPPLIER',
      plan: '-',
      productCount: stats.totalProducts,
      connectionCount: stats.totalConnections,
      purchaseOrdersThisMonth: 0,
    };
  }, [stats]);

  const listShops = viewMode === 'supplier' ? supplierShops : retailerShops;

  const filteredSuppliers = listShops.filter(
    (shop) =>
      shop.myshopifyDomain.toLowerCase().includes(search.toLowerCase()) ||
      shop.companyName?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredConnections = connections.filter((conn) => {
    const matchesScope =
      scope === 'all' && viewMode === 'supplier'
        ? true
        : viewMode === 'supplier'
        ? selectedShop && conn.supplierShop.myshopifyDomain === selectedShop.myshopifyDomain
        : selectedShop && conn.retailerShop.myshopifyDomain === selectedShop.myshopifyDomain;
    const matchesSearch =
      conn.retailerShop.myshopifyDomain.toLowerCase().includes(search.toLowerCase()) ||
      conn.retailerShop.companyName?.toLowerCase().includes(search.toLowerCase()) ||
      conn.supplierShop.myshopifyDomain.toLowerCase().includes(search.toLowerCase());
    return matchesScope && matchesSearch;
  });

  const filteredProducts = products.filter((product) => {
    if (viewMode === 'retailer') {
      return false;
    }
    const matchesScope =
      scope === 'all' ||
      (selectedShop && product.supplierShop.myshopifyDomain === selectedShop.myshopifyDomain);
    const matchesSearch =
      product.title.toLowerCase().includes(search.toLowerCase()) ||
      product.sku?.toLowerCase().includes(search.toLowerCase()) ||
      product.supplierShop.myshopifyDomain.toLowerCase().includes(search.toLowerCase());
    return matchesScope && matchesSearch;
  });

  const planChip = (plan: string) => {
    const tone =
      plan === 'FREE'
        ? 'bg-gray-100 text-gray-800'
        : plan === 'STARTER'
        ? 'bg-emerald-100 text-emerald-800'
        : plan === 'CORE'
        ? 'bg-amber-100 text-amber-800'
        : plan === 'PRO'
        ? 'bg-rose-100 text-rose-800'
        : plan === 'GROWTH'
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-purple-100 text-purple-800';
    return `inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full ${tone}`;
  };

  const usageCounts = selectedShop && scope === 'supplier'
    ? {
        products: selectedShop.productCount,
        connections: selectedShop.connectionCount,
        orders: selectedShop.purchaseOrdersThisMonth,
      }
    : {
        products: stats?.totalProducts || 0,
        connections: stats?.totalConnections || 0,
        orders: 0,
      };

  const isOverloaded =
    usageCounts.products > 500 || usageCounts.connections > 50 || usageCounts.orders > 1000;

  return (
    <div className="bg-admin-ambient">
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-200 blur-3xl" />
        <div className="absolute right-[-10%] top-10 h-80 w-80 rounded-full bg-emerald-200 blur-3xl" />
        <div className="absolute left-1/3 bottom-[-20%] h-96 w-96 rounded-full bg-indigo-100 blur-[90px]" />
      </div>
      <div className="fixed top-4 right-4 space-y-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-md border text-sm flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : toast.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {toast.type === 'success' && <ShieldCheck className="w-4 h-4" />}
            {toast.type === 'error' && <Database className="w-4 h-4" />}
            {toast.type === 'info' && <Activity className="w-4 h-4" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <header className="backdrop-blur bg-white/80 border-b sticky top-0 z-20 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-500 flex items-center justify-center text-white font-semibold shadow-md">
              CT
            </div>
            <div>
              <div className="text-lg font-semibold">Cartrel Admin</div>
              <p className="text-xs text-slate-500 flex items-center gap-2">
                Supplier-first CS console
                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full bg-blue-100 text-blue-700">
                  v1.2.0
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 transition disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Refresh
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/sign-in' })}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="layout-wide mx-auto px-4 sm:px-6 lg:px-8 py-6 relative">
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <StatCard clickable title="Suppliers" value={stats.totalSuppliers} icon={<Factory className="w-4 h-4" />} accent="from-blue-500 to-indigo-500" onClick={() => setViewMode('supplier')} />
            <StatCard clickable title="Retailers" value={stats.totalRetailers} icon={<Store className="w-4 h-4" />} accent="from-emerald-500 to-teal-500" onClick={() => setViewMode('retailer')} />
            <StatCard clickable title="Connections" value={stats.totalConnections} icon={<ArrowRightLeft className="w-4 h-4" />} accent="from-amber-500 to-orange-500" />
            <StatCard clickable title="Products" value={stats.totalProducts} icon={<Database className="w-4 h-4" />} accent="from-purple-500 to-pink-500" />
            <StatCard clickable title="Shops" value={stats.totalShops} icon={<ShieldCheck className="w-4 h-4" />} accent="from-slate-500 to-gray-500" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-4 xl:col-span-3">
            <LeftRail
              supplierCount={supplierShops.length}
              search={search}
              setSearch={setSearch}
              loading={loading}
              suppliers={filteredSuppliers}
              selectedShop={selectedShop}
              onSelect={(shop) => {
                setSelectedShop(shop);
                setDetailTab('connections');
                setScope(shop.id === 'all' ? 'all' : 'supplier');
              }}
              allSuppliers={allSuppliersPseudo}
              scope={scope}
              onScopeChange={(next) => setScope(next)}
              viewMode={viewMode}
              onViewModeChange={(mode) => {
                setViewMode(mode);
                setScope('supplier');
                const list = mode === 'supplier' ? supplierShops : retailerShops;
                if (list.length > 0) {
                  setSelectedShop(list[0]);
                }
              }}
            />
          </aside>

          <section className="lg:col-span-8 xl:col-span-9">
            {!selectedShop ? (
              <div className="bg-white border rounded-2xl p-8 shadow-sm text-center text-slate-500">
                Select a {viewMode === 'supplier' ? 'supplier' : 'retailer'} to view details.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white/90 border rounded-2xl shadow-sm p-5">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="text-xl font-semibold">
                          {scope === 'all' ? 'All suppliers' : selectedShop.myshopifyDomain}
                        </div>
                        {scope !== 'all' && selectedShop.companyName && (
                          <span className="text-sm text-slate-500">({selectedShop.companyName})</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                      {scope === 'all' || viewMode === 'retailer' ? (
                        <span className="pill bg-slate-100 text-slate-800">
                          {viewMode === 'supplier' ? 'Global totals' : 'Retailer view'}
                        </span>
                      ) : (
                        <span className={planChip(selectedShop.plan)}>Plan: {selectedShop.plan}</span>
                      )}
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                          <ArrowRightLeft className="w-3 h-3" />
                          {usageCounts.connections} connections
                        </span>
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                          <Database className="w-3 h-3" />
                          {usageCounts.products} products
                        </span>
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                          <CreditCard className="w-3 h-3" />
                          {usageCounts.orders} Orders/mo
                        </span>
                        {isOverloaded && (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-800">
                            <ShieldCheck className="w-3 h-3" />
                            Approaching limits
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {scope !== 'all' && viewMode === 'supplier' && (
                        <button
                          onClick={() => setDetailTab('billing')}
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 transition"
                        >
                          <CreditCard className="w-4 h-4" />
                          Billing & Limits
                        </button>
                      )}
                      <button
                        onClick={() => setDetailTab('connections')}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 transition"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        Connections
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white/90 border rounded-2xl shadow-sm">
                  <div className="border-b px-4 sm:px-6">
                    <div className="flex gap-4">
                      {(['connections', 'products', 'billing', 'activity'] as DetailTab[]).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setDetailTab(tab)}
                          className={`py-4 px-1 border-b-2 text-sm font-medium transition ${
                            detailTab === tab
                              ? 'border-blue-500 text-blue-600'
                              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {tab === 'connections' && `Connections (${filteredConnections.length})`}
                          {tab === 'products' && `Products (${filteredProducts.length})`}
                          {tab === 'billing' && 'Billing & Limits'}
                          {tab === 'activity' && 'Activity'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 sm:p-6">
                    {detailTab === 'connections' && (
                      <ConnectionsTable
                        loading={loading}
                        connections={filteredConnections}
                        onDelete={deleteConnection}
                        selectedSupplier={selectedShop}
                      />
                    )}

                    {detailTab === 'products' && (
                      <ProductsTable loading={loading} products={filteredProducts} />
                    )}

                    {detailTab === 'billing' && (
                      <BillingPanel
                        shop={selectedShop}
                        onPlanChange={updatePlan}
                        loading={loading}
                      />
                    )}

                    {detailTab === 'activity' && (
                      <ActivityPanel connections={filteredConnections} products={filteredProducts} loading={loading} />
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function LeftRail({
  supplierCount,
  search,
  setSearch,
  loading,
  suppliers,
  selectedShop,
  onSelect,
  allSuppliers,
  scope,
  onScopeChange,
  viewMode,
  onViewModeChange,
}: {
  supplierCount: number;
  search: string;
  setSearch: (val: string) => void;
  loading: boolean;
  suppliers: Shop[];
  selectedShop: Shop | null;
  onSelect: (shop: Shop) => void;
  allSuppliers: Shop | null;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const [density, setDensity] = useState<'cozy' | 'compact'>('cozy');
  const rowPadding = density === 'compact' ? 'p-2.5' : 'p-3';
  const planBadge = (plan: string) => {
    const tone =
      plan === 'FREE'
        ? 'bg-gray-100 text-gray-800'
        : plan === 'STARTER'
        ? 'bg-emerald-100 text-emerald-800'
        : plan === 'CORE'
        ? 'bg-amber-100 text-amber-800'
        : plan === 'PRO'
        ? 'bg-rose-100 text-rose-800'
        : plan === 'GROWTH'
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-purple-100 text-purple-800';
    return `pill ${tone}`;
  };

  return (
    <div className="card p-4 sticky top-24">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">
            {viewMode === 'supplier' ? 'Suppliers' : 'Retailers'}
          </div>
          <p className="text-xs text-slate-500">Select to see details</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="px-2 py-1 rounded-lg border bg-slate-50">{supplierCount}</span>
          <div className="flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setDensity('cozy')}
              className={`px-2 py-1 ${density === 'cozy' ? 'bg-slate-100 font-semibold' : 'bg-white'}`}
            >
              Cozy
            </button>
            <button
              onClick={() => setDensity('compact')}
              className={`px-2 py-1 ${density === 'compact' ? 'bg-slate-100 font-semibold' : 'bg-white'}`}
            >
              Compact
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600 mb-3">
        <button
          onClick={() => {
            onScopeChange('supplier');
            if (selectedShop?.id === 'all' && suppliers[0]) onSelect(suppliers[0]);
          }}
          className={`px-3 py-1 rounded-lg border ${
            scope === 'supplier' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white'
          }`}
        >
          Per supplier
        </button>
        <button
          onClick={() => {
            onScopeChange('all');
            if (allSuppliers) onSelect(allSuppliers);
          }}
          className={`px-3 py-1 rounded-lg border ${
            scope === 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white'
          }`}
        >
          All suppliers
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600 mb-3">
        <button
          onClick={() => onViewModeChange('supplier')}
          className={`px-3 py-1 rounded-lg border ${
            viewMode === 'supplier' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white'
          }`}
        >
          Supplier view
        </button>
        <button
          onClick={() => onViewModeChange('retailer')}
          className={`px-3 py-1 rounded-lg border ${
            viewMode === 'retailer' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white'
          }`}
        >
          Retailer view
        </button>
      </div>
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers or retailers..."
          className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
        {loading ? (
          <SkeletonCard />
        ) : suppliers.length === 0 ? (
          <div className="text-xs text-slate-500 p-3 border rounded-lg bg-slate-50">
            No suppliers match that search.
          </div>
        ) : (
          <>
            {allSuppliers && (
              <button
                key="all-suppliers"
                onClick={() => {
                  onScopeChange('all');
                  onSelect(allSuppliers);
                  onViewModeChange('supplier');
                }}
                className={`w-full text-left ${rowPadding} border rounded-xl transition hover:shadow-sm ${
                  selectedShop?.id === 'all' ? 'border-blue-400 bg-blue-50/80' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-slate-700 text-white flex items-center justify-center text-xs font-bold">
                      ALL
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">All suppliers</div>
                      <div className="text-xs text-slate-500 truncate">Global view</div>
                    </div>
                  </div>
                  <span className="pill bg-slate-100 text-slate-800">Totals</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-slate-600 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    <ArrowRightLeft className="w-3 h-3" />
                    {allSuppliers.connectionCount} conns
                  </span>
                  <span className="inline-flex items-center justify-end gap-1">
                    <Database className="w-3 h-3" />
                    {allSuppliers.productCount} products
                  </span>
                  <span className="inline-flex items-center justify-end gap-1">
                    <CreditCard className="w-3 h-3" />
                    {allSuppliers.purchaseOrdersThisMonth} orders/mo
                  </span>
                </div>
              </button>
            )}
            {suppliers.map((shop) => (
              <button
                key={shop.id}
                onClick={() => onSelect(shop)}
                className={`w-full text-left ${rowPadding} border rounded-xl transition hover:shadow-sm ${
                  selectedShop?.id === shop.id
                    ? 'border-blue-400 bg-blue-50/80'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                      {shop.companyName?.slice(0, 2).toUpperCase() || shop.myshopifyDomain.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{shop.companyName || shop.myshopifyDomain}</div>
                      <div className="text-xs text-slate-500 truncate">{shop.myshopifyDomain}</div>
                    </div>
                  </div>
                  <span className={`pill ${planBadge(shop.plan)}`}>{shop.plan}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-slate-600 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    <ArrowRightLeft className="w-3 h-3" />
                    {shop.connectionCount} conns
                  </span>
                  <span className="inline-flex items-center justify-end gap-1">
                    <Database className="w-3 h-3" />
                    {shop.productCount} products
                  </span>
                  <span className="inline-flex items-center justify-end gap-1">
                    <CreditCard className="w-3 h-3" />
                    {shop.purchaseOrdersThisMonth} orders/mo
                  </span>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  accent,
  clickable,
  onClick,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  accent: string;
  clickable?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`card p-4 flex items-center justify-between ${
        clickable ? 'cursor-pointer hover:shadow-md transition' : ''
      }`}
      onClick={onClick}
    >
      <div>
        <div className="text-xs uppercase text-slate-500">{title}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </div>
      <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${accent} text-white flex items-center justify-center`}>
        {icon}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="space-y-2">
      <div className="p-3 border rounded-xl bg-slate-50 animate-pulse">
        <div className="h-3 bg-slate-200 rounded w-2/3 mb-2" />
        <div className="h-2 bg-slate-200 rounded w-1/3" />
      </div>
      <div className="p-3 border rounded-xl bg-slate-50 animate-pulse">
        <div className="h-3 bg-slate-200 rounded w-2/3 mb-2" />
        <div className="h-2 bg-slate-200 rounded w-1/3" />
      </div>
    </div>
  );
}

function ConnectionsTable({
  loading,
  connections,
  onDelete,
  selectedSupplier,
}: {
  loading: boolean;
  connections: Connection[];
  onDelete: (id: string) => void;
  selectedSupplier: Shop | null;
}) {
  const emptyState = (
    <div className="text-sm text-slate-500 border rounded-xl p-6 bg-slate-50 text-center space-y-3">
      <div className="font-semibold text-slate-700">No connections yet</div>
      <p className="text-xs text-slate-500">
        Invite a retailer to start syncing products and orders for this supplier.
      </p>
      <div className="flex items-center justify-center gap-2">
        <button className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
          <ArrowRightLeft className="w-4 h-4" />
          Invite retailer
        </button>
        <button className="text-sm text-slate-600 hover:text-slate-800 underline">
          Copy invite link
        </button>
      </div>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">
            Connections for {selectedSupplier?.myshopifyDomain || 'supplier'}
          </div>
          <p className="text-xs text-slate-500">Scoped to supplier; no orphaned connections.</p>
        </div>
        <div className="text-xs text-slate-500">
          Active: {connections.filter((c) => c.status === 'ACTIVE').length} • Pending:{' '}
          {connections.filter((c) => c.status !== 'ACTIVE').length}
        </div>
      </div>
      <table className="w-full">
        <thead className="bg-slate-50 border-b">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Retailer</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Payment Terms</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Tier</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Created</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {loading ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
                Loading connections...
              </td>
            </tr>
          ) : connections.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6">{emptyState}</td>
            </tr>
          ) : (
            connections.map((conn) => (
              <tr key={conn.id} className="hover:bg-slate-50 group">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{conn.retailerShop.myshopifyDomain}</div>
                  {conn.retailerShop.companyName && (
                    <div className="text-xs text-slate-500">{conn.retailerShop.companyName}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`pill ${
                      conn.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : conn.status === 'PENDING_INVITE'
                        ? 'bg-amber-100 text-amber-800'
                        : conn.status === 'PAUSED'
                        ? 'bg-slate-100 text-slate-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {conn.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">{conn.paymentTermsType}</td>
                <td className="px-4 py-3 text-sm text-slate-900">{conn.tier}</td>
                <td className="px-4 py-3 text-sm text-slate-500 text-right">
                  {new Date(conn.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition">
                    <button className="text-sm text-slate-700 hover:text-slate-900">View</button>
                    <button className="text-sm text-slate-700 hover:text-slate-900">Impersonate</button>
                    <button
                      onClick={() => onDelete(conn.id)}
                      className="text-sm text-rose-600 hover:text-rose-800 font-medium"
                    >
                      Disable
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ProductsTable({ loading, products }: { loading: boolean; products: Product[] }) {
  const emptyState = (
    <div className="text-sm text-slate-500 border rounded-xl p-6 bg-slate-50 text-center space-y-3">
      <div className="font-semibold text-slate-700">No products for this supplier</div>
      <p className="text-xs text-slate-500">Select products from the supplier store or bulk import.</p>
      <div className="flex items-center justify-center gap-2">
        <button className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
          <Database className="w-4 h-4" />
          Select products
        </button>
        <button className="text-sm text-slate-600 hover:text-slate-800 underline">Bulk import</button>
      </div>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-800">Products (supplier-scoped)</div>
        <div className="text-xs text-slate-500">Wholesale eligibility surfaced inline</div>
      </div>
      <table className="w-full">
        <thead className="bg-slate-50 border-b">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Product</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">SKU</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Price</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Inventory</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Wholesale</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Mappings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {loading ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
                Loading products...
              </td>
            </tr>
          ) : products.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6">{emptyState}</td>
            </tr>
          ) : (
            products.map((product) => (
              <tr key={product.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{product.title}</div>
                  <div className="text-xs text-slate-500">{product.supplierShop.myshopifyDomain}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-900">{product.sku || '-'}</td>
                <td className="px-4 py-3 text-sm text-right text-slate-900">${product.wholesalePrice}</td>
                <td className="px-4 py-3 text-sm text-right text-slate-900">{product.inventoryQuantity}</td>
                <td className="px-4 py-3">
                  <span
                    className={`pill ${
                      product.isWholesaleEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {product.isWholesaleEligible ? 'Eligible' : 'Not enabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-right text-slate-900">{product.mappingCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function BillingPanel({
  shop,
  onPlanChange,
  loading,
}: {
  shop: Shop;
  onPlanChange: (shopId: string, plan: string, mode: 'test' | 'live') => void;
  loading: boolean;
}) {
  const [planSelection, setPlanSelection] = useState(shop.plan);
  const [mode, setMode] = useState<'test' | 'live'>('test');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-800">Billing & Limits</div>
          <p className="text-xs text-slate-500">
            Use Shopify Billing API with <code>test: true</code> for non-billed flows.
          </p>
        </div>
        <div className="text-xs text-slate-500">Current plan: {shop.plan}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4 bg-slate-50/70">
          <div className="text-xs font-semibold text-slate-700 mb-1">Plan selection</div>
          <select
            value={planSelection}
            onChange={(e) => setPlanSelection(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          >
            <option value="FREE">FREE</option>
            <option value="STARTER">STARTER</option>
            <option value="CORE">CORE</option>
            <option value="PRO">PRO</option>
            <option value="GROWTH">GROWTH</option>
            <option value="SCALE">SCALE</option>
          </select>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <ShieldCheck className="w-3 h-3" />
            Plan changes log audit notes for CS.
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-slate-700">Mode</label>
            <div className="flex rounded-lg border overflow-hidden">
              <button
                onClick={() => setMode('test')}
                className={`px-3 py-2 text-xs font-semibold ${
                  mode === 'test' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700'
                }`}
              >
                Test
              </button>
              <button
                onClick={() => setMode('live')}
                className={`px-3 py-2 text-xs font-semibold ${
                  mode === 'live' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700'
                }`}
              >
                Live
              </button>
            </div>
          </div>
          <button
            onClick={() => onPlanChange(shop.id, planSelection, mode)}
            disabled={loading}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-70"
          >
            <CreditCard className="w-4 h-4" />
            Apply plan ({mode})
          </button>
        </div>

        <div className="border rounded-xl p-4 bg-white/70">
          <div className="text-xs font-semibold text-slate-700 mb-2">Shop signals</div>
          <div className="space-y-2 text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>Connections</span>
              <span className="font-semibold">{shop.connectionCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Products</span>
              <span className="font-semibold">{shop.productCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>POs this month</span>
              <span className="font-semibold">{shop.purchaseOrdersThisMonth}</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 border-t pt-3">
            For trial/frozen store checks: use a dev store + Billing API <code>test: true</code>; send Shopify test billing
            webhook to verify downgrade paths.
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityPanel({
  connections,
  products,
  loading,
}: {
  connections: Connection[];
  products: Product[];
  loading: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-slate-800">Recent activity</div>
      {loading ? (
        <div className="text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
          Loading activity...
        </div>
      ) : connections.length === 0 && products.length === 0 ? (
        <div className="text-sm text-slate-500 border rounded-xl p-4 bg-slate-50">No recent activity.</div>
      ) : (
        <div className="space-y-2">
          {connections.slice(0, 5).map((conn) => (
            <div key={conn.id} className="flex items-center justify-between p-3 border rounded-xl bg-white/80">
              <div className="flex items-center gap-3">
                <ArrowRightLeft className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Connection → {conn.retailerShop.myshopifyDomain}
                  </div>
                  <div className="text-xs text-slate-500">
                    {conn.status} • {new Date(conn.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-500">{conn.paymentTermsType}</span>
            </div>
          ))}
          {products.slice(0, 5).map((product) => (
            <div key={product.id} className="flex items-center justify-between p-3 border rounded-xl bg-white/80">
              <div className="flex items-center gap-3">
                <Database className="w-4 h-4 text-purple-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">{product.title}</div>
                  <div className="text-xs text-slate-500">
                    SKU: {product.sku || '—'} • Wholesale {product.isWholesaleEligible ? 'yes' : 'no'}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-500">${product.wholesalePrice}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

}
