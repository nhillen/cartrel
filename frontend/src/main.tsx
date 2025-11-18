import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shopify/polaris/build/esm/styles.css';
import './index.css';
import App from './App';
import enTranslations from '@shopify/polaris/locales/en.json';
import { AppProvider as PolarisProvider } from '@shopify/polaris';
import { AppBridgeProvider } from './providers/AppBridgeProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PolarisProvider i18n={enTranslations}>
      <AppBridgeProvider>
        <App />
      </AppBridgeProvider>
    </PolarisProvider>
  </StrictMode>,
);
