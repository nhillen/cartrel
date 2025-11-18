import { useMemo, type ReactNode } from 'react';
import { createApp } from '@shopify/app-bridge';
import { Banner, BlockStack, Frame, Page, Spinner, Text } from '@shopify/polaris';
import { AppBridgeContext } from '../context/AppBridgeContext';

function MissingHostState() {
  return (
    <Frame>
      <Page title="Open Cartrel from Shopify">
        <Banner tone="critical" title="Open Cartrel via the Shopify admin">
          <Text as="p">
            This embedded app must be launched from the Shopify admin so that we can authenticate securely.
          </Text>
          <Text as="p">From Shopify, head to Apps → Cartrel.</Text>
        </Banner>
      </Page>
    </Frame>
  );
}

function MissingApiKeyState() {
  return (
    <Frame>
      <Page title="Configuration required">
        <Banner tone="critical" title="Missing VITE_SHOPIFY_API_KEY">
          <Text as="p">
            Set <code>VITE_SHOPIFY_API_KEY</code> in <code>frontend/.env</code> to your public Shopify app API key, then restart the
            dev server or rebuild the frontend bundle.
          </Text>
        </Banner>
      </Page>
    </Frame>
  );
}

export function AppBridgeProvider({ children }: { children: ReactNode }) {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const host = searchParams.get('host');
  const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY;
  const appBridge = useMemo(() => {
    if (!host || !apiKey) {
      return null;
    }

    return createApp({
      apiKey,
      host,
      forceRedirect: true,
    });
  }, [apiKey, host]);

  if (!host) {
    return <MissingHostState />;
  }

  if (!apiKey) {
    return <MissingApiKeyState />;
  }

  if (!appBridge) {
    return (
      <Frame>
        <Page>
          <BlockStack gap="200" align="center">
            <Spinner size="large" />
            <Text as="p" variant="bodyMd">
              Loading Cartrel…
            </Text>
          </BlockStack>
        </Page>
      </Frame>
    );
  }

  return <AppBridgeContext.Provider value={appBridge}>{children}</AppBridgeContext.Provider>;
}
