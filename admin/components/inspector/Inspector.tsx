'use client';

/**
 * Inspector panel container
 * Displays contextual details based on selected item
 */

import { X } from 'lucide-react';
import { useDashboard, useInspector } from '@/context/DashboardContext';
import { Tabs } from '@/components/ui/Tabs';
import { ShopInspector } from './ShopInspector';
import { ConnectionInspector } from './ConnectionInspector';
import { ProductInspector } from './ProductInspector';
import { HealthTab } from './tabs/HealthTab';
import { TicketsTab } from './tabs/TicketsTab';
import type { Shop, Connection, Product } from '@/types/domain';

interface InspectorProps {
  // Selected items from parent
  selectedShop?: Shop | null;
  selectedConnection?: Connection | null;
  selectedProduct?: Product | null;
  // Callbacks
  onUpdatePlan?: (shopId: string, plan: string) => void;
  onDeleteConnection?: (connectionId: string) => void;
}

export function Inspector({
  selectedShop,
  selectedConnection,
  selectedProduct,
  onUpdatePlan,
  onDeleteConnection,
}: InspectorProps) {
  const { toggleInspector } = useDashboard();
  const { activeInspectorTab, setInspectorTab } = useInspector();

  // Determine what to show based on selection priority
  // Connection > Product > Shop
  const showConnection = !!selectedConnection;
  const showProduct = !showConnection && !!selectedProduct;
  const showShop = !showConnection && !showProduct && !!selectedShop;
  const showEmpty = !showConnection && !showProduct && !showShop;

  // Define tabs based on what's selected
  const tabs = [
    { id: 'details', label: 'Details' },
    { id: 'logs', label: 'Logs' },
    { id: 'health', label: 'Health', disabled: true },
    { id: 'tickets', label: 'Tickets', disabled: true },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {showConnection && 'Connection Details'}
            {showProduct && 'Product Details'}
            {showShop && 'Shop Details'}
            {showEmpty && 'Inspector'}
          </h2>
          <p className="text-xs text-slate-500">
            {showConnection && selectedConnection?.retailerShop.myshopifyDomain}
            {showProduct && selectedProduct?.title}
            {showShop && selectedShop?.myshopifyDomain}
            {showEmpty && 'Select an item to view details'}
          </p>
        </div>
        <button
          onClick={toggleInspector}
          className="p-1.5 rounded-lg hover:bg-slate-100 transition"
          aria-label="Close inspector"
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Empty state */}
      {showEmpty && (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="text-slate-400">
            <p className="text-sm">No item selected</p>
            <p className="text-xs mt-1">
              Click on a shop, connection, or product to view its details
            </p>
          </div>
        </div>
      )}

      {/* Content with tabs */}
      {!showEmpty && (
        <>
          <Tabs
            tabs={tabs}
            activeTab={activeInspectorTab}
            onTabChange={(tab) => setInspectorTab(tab as typeof activeInspectorTab)}
          />

          <div className="flex-1 overflow-y-auto p-4">
            {activeInspectorTab === 'details' && (
              <>
                {showConnection && selectedConnection && (
                  <ConnectionInspector
                    connection={selectedConnection}
                    onDelete={onDeleteConnection}
                  />
                )}
                {showProduct && selectedProduct && (
                  <ProductInspector product={selectedProduct} />
                )}
                {showShop && selectedShop && (
                  <ShopInspector
                    shop={selectedShop}
                    onUpdatePlan={onUpdatePlan}
                  />
                )}
              </>
            )}

            {activeInspectorTab === 'logs' && (
              <div className="text-sm text-slate-500">
                <p className="font-medium text-slate-700 mb-2">Audit Logs</p>
                <p className="text-xs">
                  Audit log display coming soon. Will show recent actions for this resource.
                </p>
              </div>
            )}

            {activeInspectorTab === 'health' && <HealthTab />}
            {activeInspectorTab === 'tickets' && <TicketsTab />}
          </div>
        </>
      )}
    </div>
  );
}
