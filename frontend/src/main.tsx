import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shopify/polaris/build/esm/styles.css';
import './index.css';
import App from './App';
import enTranslations from '@shopify/polaris/locales/en.json';
import { AppProvider as PolarisProvider } from '@shopify/polaris';

// App Bridge v4 - initialization handled by CDN script in index.html
// No Provider wrapper needed anymore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PolarisProvider i18n={enTranslations}>
      <App />
    </PolarisProvider>
  </StrictMode>,
);
