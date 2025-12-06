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
  Select,
  TextField,
  Divider,
  Box,
  ResourceList,
  ResourceItem,
  Icon,
} from '@shopify/polaris';
import {
  LocationIcon,
  CheckCircleIcon,
} from '@shopify/polaris-icons';
import { api } from '../lib/api';
import type {
  InventoryLocation,
  LocationSettings,
  Connection,
} from '../lib/api';

export function InventoryLocations() {
  const [searchParams] = useSearchParams();
  const connectionIdParam = searchParams.get('connectionId');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(connectionIdParam || '');
  const [sourceLocations, setSourceLocations] = useState<InventoryLocation[]>([]);
  const [destLocations, setDestLocations] = useState<InventoryLocation[]>([]);
  const [settings, setSettings] = useState<LocationSettings>({
    sourceLocationId: null,
    destLocationId: null,
    stockBuffer: 0,
    syncEnabled: true,
  });

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedConnectionId) {
      loadLocations();
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

  async function loadLocations() {
    try {
      setLoading(true);
      setError(null);

      const [sourceData, destData, settingsData] = await Promise.all([
        api.get<{ locations: InventoryLocation[] }>(
          `/api/connections/${selectedConnectionId}/locations/source`
        ),
        api.get<{ locations: InventoryLocation[] }>(
          `/api/connections/${selectedConnectionId}/locations/dest`
        ),
        api.get<LocationSettings>(
          `/api/connections/${selectedConnectionId}/location-settings`
        ).catch(() => settings),
      ]);

      setSourceLocations(sourceData.locations);
      setDestLocations(destData.locations);
      setSettings(settingsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }

  const handleSave = useCallback(async () => {
    if (!selectedConnectionId) return;

    try {
      setSaving(true);
      await api.post(`/api/connections/${selectedConnectionId}/location-settings`, settings);
      window.shopify?.toast.show('Location settings saved');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save settings',
        { isError: true }
      );
    } finally {
      setSaving(false);
    }
  }, [selectedConnectionId, settings]);

  if (loading && sourceLocations.length === 0) {
    return (
      <Page title="Inventory Locations" backAction={{ content: 'Settings', url: '/settings' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading locations...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Inventory Locations"
      backAction={{ content: 'Settings', url: '/settings' }}
      subtitle="Configure which warehouse locations sync inventory"
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Connection selector */}
        <Layout.Section>
          <Card>
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
          </Card>
        </Layout.Section>

        {/* Location mapping */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200">
                <Icon source={LocationIcon} />
                <Text as="h2" variant="headingMd">
                  Source Location (Supplier)
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued">
                Which supplier warehouse should we pull inventory from?
              </Text>

              <Divider />

              {sourceLocations.length === 0 ? (
                <Text as="p" tone="subdued">No locations found</Text>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'location', plural: 'locations' }}
                  items={sourceLocations}
                  renderItem={(location) => (
                    <ResourceItem
                      id={location.id}
                      onClick={() => setSettings(prev => ({
                        ...prev,
                        sourceLocationId: location.id,
                      }))}
                      accessibilityLabel={`Select ${location.name}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {location.name}
                          </Text>
                          {location.address && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {location.address}
                            </Text>
                          )}
                        </BlockStack>
                        <InlineStack gap="200">
                          {location.isDefault && <Badge>Default</Badge>}
                          {settings.sourceLocationId === location.id && (
                            <Icon source={CheckCircleIcon} tone="success" />
                          )}
                        </InlineStack>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200">
                <Icon source={LocationIcon} />
                <Text as="h2" variant="headingMd">
                  Destination Location (Your Store)
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued">
                Which of your locations should receive inventory updates?
              </Text>

              <Divider />

              {destLocations.length === 0 ? (
                <Text as="p" tone="subdued">No locations found</Text>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'location', plural: 'locations' }}
                  items={destLocations}
                  renderItem={(location) => (
                    <ResourceItem
                      id={location.id}
                      onClick={() => setSettings(prev => ({
                        ...prev,
                        destLocationId: location.id,
                      }))}
                      accessibilityLabel={`Select ${location.name}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {location.name}
                          </Text>
                          {location.address && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {location.address}
                            </Text>
                          )}
                        </BlockStack>
                        <InlineStack gap="200">
                          {location.isDefault && <Badge>Default</Badge>}
                          {settings.destLocationId === location.id && (
                            <Icon source={CheckCircleIcon} tone="success" />
                          )}
                        </InlineStack>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Stock buffer setting */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Stock Buffer</Text>
              <Text as="p" tone="subdued">
                Reserve stock to prevent overselling. This amount will be subtracted from the synced inventory.
              </Text>

              <Box maxWidth="200px">
                <TextField
                  label="Buffer quantity"
                  type="number"
                  value={settings.stockBuffer.toString()}
                  onChange={(value) => setSettings(prev => ({
                    ...prev,
                    stockBuffer: parseInt(value) || 0,
                  }))}
                  min={0}
                  autoComplete="off"
                  helpText="Units to hold back from synced quantity"
                />
              </Box>

              <Banner tone="info">
                <p>
                  Example: If supplier has 100 units and buffer is 5, your store will show 95 available.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Save button */}
        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              Save Location Settings
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
