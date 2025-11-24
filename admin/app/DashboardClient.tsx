'use client';

import { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';

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

type Tab = 'shops' | 'connections' | 'products';

export default function DashboardClient() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>('shops');
  const [stats, setStats] = useState<Stats | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && session) {
      loadData();
    }
  }, [status, session]);

  async function getSessionToken(): Promise<string | null> {
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
  }

  async function loadData() {
    setLoading(true);
    try {
      const token = await getSessionToken();
      if (!token) {
        console.error('No session token available');
        return;
      }

      const headers = {
        'Authorization': `Bearer ${token}`,
      };

      const [statsRes, shopsRes, connectionsRes, productsRes] = await Promise.all([
        fetch(process.env.NEXT_PUBLIC_API_URL + '/stats', { headers }),
        fetch(process.env.NEXT_PUBLIC_API_URL + '/shops', { headers }),
        fetch(process.env.NEXT_PUBLIC_API_URL + '/connections', { headers }),
        fetch(process.env.NEXT_PUBLIC_API_URL + '/products?limit=100', { headers }),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (shopsRes.ok) {
        const shopsData = await shopsRes.json();
        setShops(shopsData.shops || []);
      }

      if (connectionsRes.ok) {
        const connectionsData = await connectionsRes.json();
        setConnections(connectionsData.connections || []);
      }

      if (productsRes.ok) {
        const productsData = await productsRes.json();
        setProducts(productsData.products || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updatePlan(shopId: string, plan: string) {
    try {
      const token = await getSessionToken();
      if (!token) {
        alert('Authentication error');
        return;
      }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/shops/${shopId}/plan`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ plan, notes: 'Updated via admin panel' }),
        }
      );

      if (res.ok) {
        alert('Plan updated successfully');
        loadData();
        setShowModal(false);
      } else {
        alert('Failed to update plan');
      }
    } catch (error) {
      console.error('Error updating plan:', error);
      alert('Error updating plan');
    }
  }

  async function deleteConnection(connectionId: string) {
    if (!confirm('Are you sure you want to delete this connection?')) {
      return;
    }

    try {
      const token = await getSessionToken();
      if (!token) {
        alert('Authentication error');
        return;
      }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/connections/${connectionId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (res.ok) {
        alert('Connection deleted successfully');
        loadData();
      } else {
        alert('Failed to delete connection');
      }
    } catch (error) {
      console.error('Error deleting connection:', error);
      alert('Error deleting connection');
    }
  }

  const filteredShops = shops.filter((shop) =>
    shop.myshopifyDomain.toLowerCase().includes(search.toLowerCase()) ||
    shop.companyName?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredConnections = connections.filter((conn) =>
    conn.supplierShop.myshopifyDomain.toLowerCase().includes(search.toLowerCase()) ||
    conn.retailerShop.myshopifyDomain.toLowerCase().includes(search.toLowerCase()) ||
    conn.supplierShop.companyName?.toLowerCase().includes(search.toLowerCase()) ||
    conn.retailerShop.companyName?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProducts = products.filter((product) =>
    product.title.toLowerCase().includes(search.toLowerCase()) ||
    product.sku?.toLowerCase().includes(search.toLowerCase()) ||
    product.supplierShop.myshopifyDomain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cartrel Admin</h1>
            <p className="text-sm text-gray-600">Customer Success Tools <span className="text-xs text-gray-400">v1.1.0</span></p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/sign-in' })}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 border rounded-lg hover:bg-gray-50 transition"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="text-3xl font-bold text-blue-600">{stats.totalShops}</div>
              <div className="text-sm text-gray-600 mt-1">Total Shops</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="text-3xl font-bold text-green-600">{stats.totalSuppliers}</div>
              <div className="text-sm text-gray-600 mt-1">Suppliers</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="text-3xl font-bold text-purple-600">{stats.totalRetailers}</div>
              <div className="text-sm text-gray-600 mt-1">Retailers</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="text-3xl font-bold text-orange-600">{stats.totalConnections}</div>
              <div className="text-sm text-gray-600 mt-1">Connections</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <div className="text-3xl font-bold text-pink-600">{stats.totalProducts}</div>
              <div className="text-sm text-gray-600 mt-1">Products</div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow-sm border mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('shops')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                  activeTab === 'shops'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Shops ({shops.length})
              </button>
              <button
                onClick={() => setActiveTab('connections')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                  activeTab === 'connections'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Connections ({connections.length})
              </button>
              <button
                onClick={() => setActiveTab('products')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition ${
                  activeTab === 'products'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Products ({products.length})
              </button>
            </nav>
          </div>

          {/* Search Bar */}
          <div className="p-6 border-b">
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Tab Content */}
          <div className="overflow-x-auto">
            {activeTab === 'shops' && (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shop</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Products</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Connections</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Orders/Mo</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        Loading...
                      </td>
                    </tr>
                  ) : filteredShops.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        No shops found
                      </td>
                    </tr>
                  ) : (
                    filteredShops.map((shop) => (
                      <tr key={shop.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{shop.myshopifyDomain}</div>
                          {shop.companyName && (
                            <div className="text-sm text-gray-500">{shop.companyName}</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            shop.role === 'SUPPLIER' ? 'bg-blue-100 text-blue-800' :
                            shop.role === 'RETAILER' ? 'bg-green-100 text-green-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {shop.role}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            shop.plan === 'FREE' ? 'bg-gray-100 text-gray-800' :
                            shop.plan === 'STARTER' ? 'bg-emerald-100 text-emerald-800' :
                            shop.plan === 'CORE' ? 'bg-amber-100 text-amber-800' :
                            shop.plan === 'PRO' ? 'bg-rose-100 text-rose-800' :
                            shop.plan === 'GROWTH' ? 'bg-indigo-100 text-indigo-800' :
                            'bg-purple-100 text-purple-800'
                          }`}>
                            {shop.plan}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{shop.productCount}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{shop.connectionCount}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{shop.purchaseOrdersThisMonth}</td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => {
                              setSelectedShop(shop);
                              setShowModal(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'connections' && (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retailer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Terms</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        Loading...
                      </td>
                    </tr>
                  ) : filteredConnections.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        No connections found
                      </td>
                    </tr>
                  ) : (
                    filteredConnections.map((conn) => (
                      <tr key={conn.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{conn.supplierShop.myshopifyDomain}</div>
                          {conn.supplierShop.companyName && (
                            <div className="text-sm text-gray-500">{conn.supplierShop.companyName}</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{conn.retailerShop.myshopifyDomain}</div>
                          {conn.retailerShop.companyName && (
                            <div className="text-sm text-gray-500">{conn.retailerShop.companyName}</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            conn.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                            conn.status === 'PENDING_INVITE' ? 'bg-yellow-100 text-yellow-800' :
                            conn.status === 'PAUSED' ? 'bg-gray-100 text-gray-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {conn.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{conn.paymentTermsType}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{conn.tier}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {new Date(conn.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => deleteConnection(conn.id)}
                            className="text-red-600 hover:text-red-800 font-medium text-sm"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'products' && (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Inventory</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wholesale</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mappings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        Loading...
                      </td>
                    </tr>
                  ) : filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        No products found
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{product.title}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {product.supplierShop.myshopifyDomain}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{product.sku || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">${product.wholesalePrice}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{product.inventoryQuantity}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            product.isWholesaleEligible
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {product.isWholesaleEligible ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{product.mappingCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* Shop Management Modal */}
      {showModal && selectedShop && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Manage Shop</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 mb-1">Shop</div>
              <div className="text-sm text-gray-900">{selectedShop.myshopifyDomain}</div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Change Plan (UAT Mode)
              </label>
              <select
                defaultValue={selectedShop.plan}
                onChange={(e) => {
                  if (confirm(`Change plan to ${e.target.value}?`)) {
                    updatePlan(selectedShop.id, e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="FREE">FREE</option>
                <option value="STARTER">STARTER</option>
                <option value="CORE">CORE</option>
                <option value="PRO">PRO</option>
                <option value="GROWTH">GROWTH</option>
                <option value="SCALE">SCALE</option>
              </select>
            </div>

            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
              <div>Products: {selectedShop.productCount}</div>
              <div>Connections: {selectedShop.connectionCount}</div>
              <div>Orders/Month: {selectedShop.purchaseOrdersThisMonth}</div>
            </div>

            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              <strong>UAT Mode:</strong> Plan changes bypass billing. For production, use Shopify Billing API with <code>test: true</code> flag.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
