import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import {
  Dashboard,
  Connections,
  ConnectionDetail,
  Catalog,
  ImportWizard,
  VariantMappings,
  Orders,
  Settings,
  Migration,
  Marketplace,
  Payouts,
  Collections,
  InventoryLocations,
  ProductHistoryPage,
} from './pages';

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <AppLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/connections/:connectionId" element={<ConnectionDetail />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/catalog/import" element={<ImportWizard />} />
          <Route path="/catalog/variants" element={<VariantMappings />} />
          <Route path="/catalog/collections" element={<Collections />} />
          <Route path="/catalog/history" element={<ProductHistoryPage />} />
          <Route path="/orders/*" element={<Orders />} />
          <Route path="/payouts" element={<Payouts />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="/settings/migration" element={<Migration />} />
          <Route path="/settings/locations" element={<InventoryLocations />} />
          <Route path="/marketplace/*" element={<Marketplace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
