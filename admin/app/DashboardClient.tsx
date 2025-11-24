'use client';

import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

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

interface Stats {
  totalShops: number;
  totalSuppliers: number;
  totalRetailers: number;
  totalConnections: number;
  totalProducts: number;
}

export default function DashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [statsRes, shopsRes] = await Promise.all([
        fetch(process.env.NEXT_PUBLIC_API_URL + '/stats'),
        fetch(process.env.NEXT_PUBLIC_API_URL + '/shops'),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (shopsRes.ok) {
        const shopsData = await shopsRes.json();
        setShops(shopsData.shops || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updatePlan(shopId: string, plan: string) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/shops/${shopId}/plan`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
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

  const filteredShops = shops.filter((shop) =>
    shop.myshopifyDomain.toLowerCase().includes(search.toLowerCase()) ||
    shop.companyName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cartrel Admin</h1>
            <p className="text-sm text-gray-600">Customer Success Tools</p>
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
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="text-3xl font-bold text-blue-600">{stats.totalShops}</div>
              <div className="text-sm text-gray-600 mt-1">Total Shops</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="text-3xl font-bold text-green-600">{stats.totalSuppliers}</div>
              <div className="text-sm text-gray-600 mt-1">Suppliers</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="text-3xl font-bold text-purple-600">{stats.totalRetailers}</div>
              <div className="text-sm text-gray-600 mt-1">Retailers</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="text-3xl font-bold text-orange-600">{stats.totalConnections}</div>
              <div className="text-sm text-gray-600 mt-1">Connections</div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="text-3xl font-bold text-pink-600">{stats.totalProducts}</div>
              <div className="text-sm text-gray-600 mt-1">Products</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold mb-4">Shop Management</h2>
            <input
              type="text"
              placeholder="Search shops..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="overflow-x-auto">
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
          </div>
        </div>
      </main>

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
                Change Plan
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
          </div>
        </div>
      )}
    </div>
  );
}
