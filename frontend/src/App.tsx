import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { Dashboard, Connections, Catalog, Orders, Settings, Marketplace } from './pages';

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/connections/*" element={<Connections />} />
          <Route path="/catalog/*" element={<Catalog />} />
          <Route path="/orders/*" element={<Orders />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="/marketplace/*" element={<Marketplace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
