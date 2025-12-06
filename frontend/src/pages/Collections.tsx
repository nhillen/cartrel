import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Spinner,
  Banner,
  ResourceList,
  ResourceItem,
  Select,
  Checkbox,
  Divider,
  Box,
  Modal,
  Icon,
} from '@shopify/polaris';
import {
  RefreshIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
} from '@shopify/polaris-icons';
import { api } from '../lib/api';
import type {
  CollectionMapping,
  CollectionSyncSettings,
  Connection,
} from '../lib/api';

export function Collections() {
  const [searchParams] = useSearchParams();
  const connectionIdParam = searchParams.get('connectionId');

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(connectionIdParam || '');
  const [collections, setCollections] = useState<CollectionMapping[]>([]);
  const [settings, setSettings] = useState<CollectionSyncSettings>({
    enabled: false,
    overwriteLocalEdits: false,
    syncProductMembership: true,
    syncImages: true,
    syncDescriptions: true,
  });

  // Modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedConnectionId) {
      loadCollections();
    }
  }, [selectedConnectionId]);

  async function loadConnections() {
    try {
      const data = await api.get<Connection[]>('/api/connections');
      setConnections(data);
      if (data.length > 0 && !selectedConnectionId) {
        setSelectedConnectionId(data[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    }
  }

  async function loadCollections() {
    try {
      setLoading(true);
      setError(null);
      const [collectionsData, settingsData] = await Promise.all([
        api.get<{ collections: CollectionMapping[] }>(
          `/api/connections/${selectedConnectionId}/collections`
        ),
        api.get<CollectionSyncSettings>(
          `/api/connections/${selectedConnectionId}/collection-settings`
        ).catch(() => settings),
      ]);
      setCollections(collectionsData.collections);
      setSettings(settingsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collections');
    } finally {
      setLoading(false);
    }
  }

  const handleToggleCollection = useCallback(async (collectionId: string, enabled: boolean) => {
    try {
      await api.patch(`/api/collections/${collectionId}`, { syncEnabled: enabled });
      setCollections(prev =>
        prev.map(c => c.id === collectionId ? { ...c, syncEnabled: enabled } : c)
      );
      window.shopify?.toast.show(enabled ? 'Collection sync enabled' : 'Collection sync disabled');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to update collection',
        { isError: true }
      );
    }
  }, []);

  const handleSyncAll = useCallback(async () => {
    if (!selectedConnectionId) return;

    try {
      setSyncing(true);
      const result = await api.post<{ synced: number; failed: number }>(
        `/api/connections/${selectedConnectionId}/collections/sync`
      );
      window.shopify?.toast.show(`Synced ${result.synced} collections`);
      await loadCollections();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Sync failed',
        { isError: true }
      );
    } finally {
      setSyncing(false);
    }
  }, [selectedConnectionId]);

  const handleSyncOne = useCallback(async (collectionId: string) => {
    try {
      await api.post(`/api/collections/${collectionId}/sync`);
      window.shopify?.toast.show('Collection synced');
      await loadCollections();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Sync failed',
        { isError: true }
      );
    }
  }, []);

  const handleSaveSettings = useCallback(async () => {
    if (!selectedConnectionId) return;

    try {
      setSavingSettings(true);
      await api.post(`/api/connections/${selectedConnectionId}/collection-settings`, settings);
      window.shopify?.toast.show('Collection settings saved');
      setShowSettingsModal(false);
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save settings',
        { isError: true }
      );
    } finally {
      setSavingSettings(false);
    }
  }, [selectedConnectionId, settings]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'SYNCED':
        return <Icon source={CheckCircleIcon} tone="success" />;
      case 'PENDING':
        return <Icon source={ClockIcon} tone="subdued" />;
      case 'ERROR':
        return <Icon source={AlertCircleIcon} tone="critical" />;
      default:
        return null;
    }
  };

  const syncedCount = collections.filter(c => c.status === 'SYNCED').length;
  const pendingCount = collections.filter(c => c.status === 'PENDING').length;
  const enabledCount = collections.filter(c => c.syncEnabled).length;

  if (loading && collections.length === 0) {
    return (
      <Page title="Collections" backAction={{ content: 'Catalog', url: '/catalog' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading collections...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Collection Sync"
      backAction={{ content: 'Catalog', url: '/catalog' }}
      subtitle="Sync collections from your suppliers"
      primaryAction={{
        content: 'Sync All',
        icon: RefreshIcon,
        onAction: handleSyncAll,
        loading: syncing,
        disabled: enabledCount === 0,
      }}
      secondaryActions={[
        {
          content: 'Settings',
          onAction: () => setShowSettingsModal(true),
        },
      ]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Connection selector and summary */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Box minWidth="300px">
                <Select
                  label="Connection"
                  options={connections.map(c => ({
                    label: `${c.supplierShop.name} → ${c.retailerShop.name}`,
                    value: c.id,
                  }))}
                  value={selectedConnectionId}
                  onChange={setSelectedConnectionId}
                />
              </Box>
              <InlineStack gap="400">
                <Badge tone="success">{`${syncedCount} synced`}</Badge>
                <Badge tone="attention">{`${pendingCount} pending`}</Badge>
                <Badge>{`${enabledCount} enabled`}</Badge>
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Settings banner */}
        {!settings.enabled && (
          <Layout.Section>
            <Banner
              title="Collection sync is disabled"
              action={{ content: 'Enable', onAction: () => setShowSettingsModal(true) }}
            >
              <p>Enable collection sync to keep your collections in sync with your supplier.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Collections list */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Supplier Collections</Text>

              {collections.length === 0 ? (
                <BlockStack gap="400" inlineAlign="center">
                  <Text as="p" tone="subdued">
                    No collections found from this supplier
                  </Text>
                </BlockStack>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'collection', plural: 'collections' }}
                  items={collections}
                  renderItem={(collection) => (
                    <ResourceItem
                      id={collection.id}
                      onClick={() => {}}
                      accessibilityLabel={`Collection ${collection.sourceTitle}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="400" blockAlign="center">
                          <Checkbox
                            label=""
                            labelHidden
                            checked={collection.syncEnabled}
                            onChange={(checked) => handleToggleCollection(collection.id, checked)}
                          />
                          <BlockStack gap="100">
                            <InlineStack gap="200">
                              {statusIcon(collection.status)}
                              <Text as="h3" variant="bodyMd" fontWeight="semibold">
                                {collection.sourceTitle}
                              </Text>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {collection.productsCount} products •
                              {collection.destCollectionId ? (
                                <> Synced to: {collection.destTitle}</>
                              ) : (
                                <> Not yet synced</>
                              )}
                              {collection.lastSyncedAt && (
                                <> • Last sync: {new Date(collection.lastSyncedAt).toLocaleDateString()}</>
                              )}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <InlineStack gap="200">
                          {collection.overwriteLocal && (
                            <Badge tone="warning">Overwrite</Badge>
                          )}
                          <Button
                            size="slim"
                            onClick={() => handleSyncOne(collection.id)}
                            disabled={!collection.syncEnabled}
                          >
                            Sync
                          </Button>
                        </InlineStack>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Settings Modal */}
      <Modal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title="Collection Sync Settings"
        primaryAction={{
          content: 'Save Settings',
          onAction: handleSaveSettings,
          loading: savingSettings,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setShowSettingsModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Checkbox
              label="Enable collection sync"
              helpText="Sync collections from your supplier to your store"
              checked={settings.enabled}
              onChange={(checked) => setSettings(prev => ({ ...prev, enabled: checked }))}
            />

            <Divider />

            <Checkbox
              label="Overwrite local edits"
              helpText="Replace your collection changes with supplier's version on sync"
              checked={settings.overwriteLocalEdits}
              onChange={(checked) => setSettings(prev => ({ ...prev, overwriteLocalEdits: checked }))}
            />

            <Checkbox
              label="Sync product membership"
              helpText="Add/remove products in collections based on supplier's catalog"
              checked={settings.syncProductMembership}
              onChange={(checked) => setSettings(prev => ({ ...prev, syncProductMembership: checked }))}
            />

            <Checkbox
              label="Sync collection images"
              helpText="Copy collection images from supplier"
              checked={settings.syncImages}
              onChange={(checked) => setSettings(prev => ({ ...prev, syncImages: checked }))}
            />

            <Checkbox
              label="Sync descriptions"
              helpText="Copy collection descriptions from supplier"
              checked={settings.syncDescriptions}
              onChange={(checked) => setSettings(prev => ({ ...prev, syncDescriptions: checked }))}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
