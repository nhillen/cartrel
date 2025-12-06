import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  TextField,
  Select,
  Checkbox,
  Divider,
  Box,
  DataTable,
  Modal,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type {
  Connection,
  PriceRule,
  PriceRuleType,
  PriceRuleTypeInfo,
  PricePreview,
  ShadowModeStats,
  OrderForwardingSettings,
  OrderForwardingMode,
  MetafieldSyncConfig,
} from '../lib/api';

interface ConnectionDetailData extends Connection {
  priceRule?: PriceRule;
  priceRuleTypes?: PriceRuleTypeInfo[];
  shadowMode?: ShadowModeStats;
  orderForwarding?: OrderForwardingSettings;
  metafieldConfig?: MetafieldSyncConfig;
  productCount?: number;
  orderCount?: number;
}

export function ConnectionDetail() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();

  const [connection, setConnection] = useState<ConnectionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Price rule state
  const [priceRule, setPriceRule] = useState<PriceRule>({
    type: 'MIRROR',
    value: 0,
    applyToCompareAt: true,
  });
  const [priceRuleTypes, setPriceRuleTypes] = useState<PriceRuleTypeInfo[]>([]);
  const [pricePreview, setPricePreview] = useState<PricePreview[]>([]);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Shadow mode state (for retailers)
  const [shadowMode, setShadowMode] = useState<ShadowModeStats | null>(null);
  const [toggingShadowMode, setToggingShadowMode] = useState(false);

  // Order forwarding state
  const [orderForwarding, setOrderForwarding] = useState<OrderForwardingSettings>({
    mode: 'AUTO',
    triggerOn: 'ON_PAID',
    includeShippingCost: false,
    defaultShippingFee: null,
    tagMapping: {},
    autoFulfill: true,
    shadowModeEnabled: false,
  });
  const [savingOrderSettings, setSavingOrderSettings] = useState(false);

  // Metafield sync state
  const [metafieldConfig, setMetafieldConfig] = useState<MetafieldSyncConfig>({
    enabled: false,
    definitions: [],
  });
  const [savingMetafields, setSavingMetafields] = useState(false);

  useEffect(() => {
    if (connectionId) {
      loadConnection();
      loadPriceRuleTypes();
    }
  }, [connectionId]);

  async function loadConnection() {
    try {
      setLoading(true);
      setError(null);

      // Load connection details
      const data = await api.get<ConnectionDetailData>(`/api/connections/${connectionId}`);
      setConnection(data);

      // Load current price rule
      if (data.priceRule) {
        setPriceRule(data.priceRule);
      }

      // Load shadow mode status (for retailers)
      if (data.shadowMode) {
        setShadowMode(data.shadowMode);
      }

      // Load order forwarding settings
      if (data.orderForwarding) {
        setOrderForwarding(data.orderForwarding);
      }

      // Load metafield sync config
      if (data.metafieldConfig) {
        setMetafieldConfig(data.metafieldConfig);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connection');
    } finally {
      setLoading(false);
    }
  }

  async function loadPriceRuleTypes() {
    try {
      const types = await api.get<PriceRuleTypeInfo[]>('/api/price-rules/types');
      setPriceRuleTypes(types);
    } catch {
      // Use defaults if endpoint doesn't exist
      setPriceRuleTypes([
        { type: 'MIRROR', name: 'Mirror Source', description: 'Use exact source prices', example: '$10 → $10' },
        { type: 'MARKUP_PERCENT', name: 'Markup (%)', description: 'Add percentage to source', example: '20%: $10 → $12' },
        { type: 'MARKDOWN_PERCENT', name: 'Markdown (%)', description: 'Reduce by percentage', example: '20%: $10 → $8' },
        { type: 'MARKUP_FIXED', name: 'Markup ($)', description: 'Add fixed amount', example: '$5: $10 → $15' },
        { type: 'MARKDOWN_FIXED', name: 'Markdown ($)', description: 'Reduce by fixed amount', example: '$3: $10 → $7' },
      ]);
    }
  }

  const handleSavePriceRule = useCallback(async () => {
    if (!connectionId) return;

    try {
      setSaving(true);
      await api.post(`/api/connections/${connectionId}/price-rule`, priceRule);
      window.shopify?.toast.show('Price rule saved');
      await loadConnection();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save price rule',
        { isError: true }
      );
    } finally {
      setSaving(false);
    }
  }, [connectionId, priceRule]);

  const handlePreviewPriceRule = useCallback(async () => {
    if (!connectionId) return;

    try {
      setLoadingPreview(true);
      const preview = await api.post<{ previews: PricePreview[] }>(
        `/api/connections/${connectionId}/price-rule/preview`,
        priceRule
      );
      setPricePreview(preview.previews || []);
      setShowPreviewModal(true);
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to generate preview',
        { isError: true }
      );
    } finally {
      setLoadingPreview(false);
    }
  }, [connectionId, priceRule]);

  const handleApplyPriceRule = useCallback(async () => {
    if (!connectionId) return;

    try {
      setSaving(true);
      const result = await api.post<{ updated: number; failed: number }>(
        `/api/connections/${connectionId}/price-rule/apply`
      );
      window.shopify?.toast.show(`Updated ${result.updated} products`);
      setShowPreviewModal(false);
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to apply price rule',
        { isError: true }
      );
    } finally {
      setSaving(false);
    }
  }, [connectionId]);

  const handleToggleShadowMode = useCallback(async () => {
    if (!connectionId || !shadowMode) return;

    try {
      setToggingShadowMode(true);
      const endpoint = shadowMode.enabled
        ? '/api/retailer/shadow/disable'
        : '/api/retailer/shadow/enable';

      await api.post(endpoint, { connectionId });

      setShadowMode(prev => prev ? { ...prev, enabled: !prev.enabled } : null);
      window.shopify?.toast.show(
        shadowMode.enabled ? 'Shadow mode disabled' : 'Shadow mode enabled'
      );
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to toggle shadow mode',
        { isError: true }
      );
    } finally {
      setToggingShadowMode(false);
    }
  }, [connectionId, shadowMode]);

  const handleSaveOrderForwarding = useCallback(async () => {
    if (!connectionId) return;

    try {
      setSavingOrderSettings(true);
      await api.post(`/api/connections/${connectionId}/order-forwarding`, orderForwarding);
      window.shopify?.toast.show('Order forwarding settings saved');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save order settings',
        { isError: true }
      );
    } finally {
      setSavingOrderSettings(false);
    }
  }, [connectionId, orderForwarding]);

  const handleSaveMetafieldConfig = useCallback(async () => {
    if (!connectionId) return;

    try {
      setSavingMetafields(true);
      await api.post(`/api/connections/${connectionId}/metafield-config`, metafieldConfig);
      window.shopify?.toast.show('Metafield sync settings saved');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save metafield settings',
        { isError: true }
      );
    } finally {
      setSavingMetafields(false);
    }
  }, [connectionId, metafieldConfig]);

  const handleToggleMetafieldDefinition = useCallback((definitionId: string, enabled: boolean) => {
    setMetafieldConfig(prev => ({
      ...prev,
      definitions: prev.definitions.map(def =>
        def.definitionId === definitionId
          ? { ...def, syncEnabled: enabled }
          : def
      ),
    }));
  }, []);

  const calculateExamplePrice = (sourcePrice: number): number => {
    switch (priceRule.type) {
      case 'MARKUP_PERCENT':
        return sourcePrice * (1 + priceRule.value / 100);
      case 'MARKDOWN_PERCENT':
        return sourcePrice * (1 - priceRule.value / 100);
      case 'MARKUP_FIXED':
        return sourcePrice + priceRule.value;
      case 'MARKDOWN_FIXED':
        return Math.max(0, sourcePrice - priceRule.value);
      default:
        return sourcePrice;
    }
  };

  if (loading) {
    return (
      <Page title="Connection" backAction={{ content: 'Connections', url: '/connections' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading connection...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!connection) {
    return (
      <Page title="Connection" backAction={{ content: 'Connections', url: '/connections' }}>
        <Layout>
          <Layout.Section>
            <Banner tone="critical">
              <p>Connection not found</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge tone="success">Active</Badge>;
      case 'PENDING':
        return <Badge tone="attention">Pending</Badge>;
      case 'PAUSED':
        return <Badge tone="warning">Paused</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <Page
      title={`${connection.supplierShop.name} ↔ ${connection.retailerShop.name}`}
      backAction={{ content: 'Connections', url: '/connections' }}
      titleMetadata={statusBadge(connection.status)}
      secondaryActions={[
        {
          content: 'Import Products',
          url: `/catalog/import?connectionId=${connectionId}`,
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

        {/* Connection Overview */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Overview</Text>

              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Sync Mode</Text>
                  <Text as="p" fontWeight="semibold">{connection.syncMode}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Tier</Text>
                  <Text as="p" fontWeight="semibold">{connection.tier}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Created</Text>
                  <Text as="p">{new Date(connection.createdAt).toLocaleDateString()}</Text>
                </InlineStack>
                {connection.productCount !== undefined && (
                  <InlineStack align="space-between">
                    <Text as="p" tone="subdued">Products</Text>
                    <Text as="p">{connection.productCount}</Text>
                  </InlineStack>
                )}
                {connection.orderCount !== undefined && (
                  <InlineStack align="space-between">
                    <Text as="p" tone="subdued">Orders</Text>
                    <Text as="p">{connection.orderCount}</Text>
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Price Rules Configuration */}
        <Layout.Section variant="twoThirds">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Price Rules</Text>
                  <Text as="p" tone="subdued">
                    Configure how retail prices are calculated from wholesale prices
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <BlockStack gap="400">
                <Select
                  label="Price Strategy"
                  options={priceRuleTypes.map(t => ({
                    label: `${t.name} - ${t.description}`,
                    value: t.type,
                  }))}
                  value={priceRule.type}
                  onChange={(value) => setPriceRule(prev => ({
                    ...prev,
                    type: value as PriceRuleType,
                    value: value === 'MIRROR' ? 0 : prev.value,
                  }))}
                />

                {priceRule.type !== 'MIRROR' && (
                  <InlineStack gap="400" wrap>
                    <Box minWidth="150px">
                      <TextField
                        label={priceRule.type.includes('PERCENT') ? 'Percentage' : 'Amount ($)'}
                        type="number"
                        value={priceRule.value.toString()}
                        onChange={(value) => setPriceRule(prev => ({
                          ...prev,
                          value: parseFloat(value) || 0,
                        }))}
                        autoComplete="off"
                        suffix={priceRule.type.includes('PERCENT') ? '%' : undefined}
                        prefix={priceRule.type.includes('FIXED') ? '$' : undefined}
                      />
                    </Box>

                    <Box minWidth="150px">
                      <TextField
                        label="Round to (optional)"
                        type="number"
                        value={priceRule.roundTo?.toString() || ''}
                        onChange={(value) => setPriceRule(prev => ({
                          ...prev,
                          roundTo: value ? parseFloat(value) : undefined,
                        }))}
                        autoComplete="off"
                        placeholder="e.g., 0.99"
                        helpText="Round prices to .99, .95, etc."
                      />
                    </Box>
                  </InlineStack>
                )}

                <Checkbox
                  label="Apply to Compare-at Price"
                  helpText="Also apply this rule to the compare-at (strikethrough) price"
                  checked={priceRule.applyToCompareAt}
                  onChange={(checked) => setPriceRule(prev => ({
                    ...prev,
                    applyToCompareAt: checked,
                  }))}
                />

                {/* Example calculation */}
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">Example</Text>
                    <InlineStack gap="200">
                      <Text as="span">$10.00 wholesale →</Text>
                      <Text as="span" fontWeight="bold" tone="success">
                        ${calculateExamplePrice(10).toFixed(2)} retail
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Text as="span">$25.00 wholesale →</Text>
                      <Text as="span" fontWeight="bold" tone="success">
                        ${calculateExamplePrice(25).toFixed(2)} retail
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>

                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    onClick={handleSavePriceRule}
                    loading={saving}
                  >
                    Save Price Rule
                  </Button>
                  <Button
                    onClick={handlePreviewPriceRule}
                    loading={loadingPreview}
                  >
                    Preview Changes
                  </Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Shadow Mode (for retailers migrating from other apps) */}
        {shadowMode && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <InlineStack gap="200">
                      <Text as="h2" variant="headingMd">Shadow Mode</Text>
                      {shadowMode.enabled ? (
                        <Badge tone="info">Active</Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      Test imports without creating products in your Shopify store
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={handleToggleShadowMode}
                    loading={toggingShadowMode}
                  >
                    {shadowMode.enabled ? 'Disable Shadow Mode' : 'Enable Shadow Mode'}
                  </Button>
                </InlineStack>

                {shadowMode.enabled && (
                  <>
                    <Divider />
                    <InlineStack gap="600">
                      <BlockStack gap="100">
                        <Text as="p" variant="headingLg">{shadowMode.shadowImports}</Text>
                        <Text as="p" tone="subdued">Shadow imports</Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p" variant="headingLg">{shadowMode.totalMappings}</Text>
                        <Text as="p" tone="subdued">Total mappings</Text>
                      </BlockStack>
                    </InlineStack>
                    <Banner tone="info">
                      <p>
                        Shadow mode is perfect for testing your migration. Imports won't affect
                        your store until you promote them.
                      </p>
                    </Banner>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Order Forwarding Settings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Order Forwarding</Text>
              <Text as="p" tone="subdued">
                Configure how orders are forwarded to your supplier
              </Text>

              <Divider />

              <BlockStack gap="400">
                <Select
                  label="Forwarding Mode"
                  options={[
                    { label: 'Automatic - Forward orders immediately', value: 'AUTO' },
                    { label: 'Manual - Review before forwarding', value: 'MANUAL' },
                    { label: 'Shadow - Test without actually forwarding', value: 'SHADOW' },
                  ]}
                  value={orderForwarding.mode}
                  onChange={(value) => setOrderForwarding(prev => ({
                    ...prev,
                    mode: value as OrderForwardingMode,
                  }))}
                  helpText={
                    orderForwarding.mode === 'AUTO'
                      ? 'Orders will be automatically sent to your supplier'
                      : orderForwarding.mode === 'MANUAL'
                      ? 'You will need to manually approve each order before it is forwarded'
                      : 'Orders will be tracked but not actually sent to the supplier'
                  }
                />

                <Select
                  label="Trigger On"
                  options={[
                    { label: 'When order is created', value: 'ON_CREATE' },
                    { label: 'When order is paid', value: 'ON_PAID' },
                    { label: 'When order is fulfilled', value: 'ON_FULFILLED' },
                  ]}
                  value={orderForwarding.triggerOn}
                  onChange={(value) => setOrderForwarding(prev => ({
                    ...prev,
                    triggerOn: value as 'ON_CREATE' | 'ON_PAID' | 'ON_FULFILLED',
                  }))}
                />

                <Checkbox
                  label="Include shipping cost in forwarded order"
                  helpText="Add your customer's shipping cost to the supplier order"
                  checked={orderForwarding.includeShippingCost}
                  onChange={(checked) => setOrderForwarding(prev => ({
                    ...prev,
                    includeShippingCost: checked,
                  }))}
                />

                <Checkbox
                  label="Auto-fulfill orders"
                  helpText="Automatically mark orders as fulfilled when the supplier ships"
                  checked={orderForwarding.autoFulfill}
                  onChange={(checked) => setOrderForwarding(prev => ({
                    ...prev,
                    autoFulfill: checked,
                  }))}
                />

                {orderForwarding.mode === 'SHADOW' && (
                  <Banner tone="info">
                    <p>
                      Shadow mode is perfect for testing your order flow without affecting real orders.
                      Orders will be logged but not actually sent to your supplier.
                    </p>
                  </Banner>
                )}

                <Button
                  variant="primary"
                  onClick={handleSaveOrderForwarding}
                  loading={savingOrderSettings}
                >
                  Save Order Settings
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Metafield Sync Configuration */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Metafield Sync</Text>
                  <Text as="p" tone="subdued">
                    Configure which custom metafields sync between stores
                  </Text>
                </BlockStack>
                <Checkbox
                  label="Enable metafield sync"
                  checked={metafieldConfig.enabled}
                  onChange={(checked) => setMetafieldConfig(prev => ({
                    ...prev,
                    enabled: checked,
                  }))}
                />
              </InlineStack>

              {metafieldConfig.enabled && (
                <>
                  <Divider />

                  {metafieldConfig.definitions.length > 0 ? (
                    <BlockStack gap="300">
                      {metafieldConfig.definitions.map(def => (
                        <Box
                          key={def.definitionId}
                          padding="300"
                          background="bg-surface-secondary"
                          borderRadius="200"
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="h4" variant="bodyMd" fontWeight="semibold">
                                {def.name}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {def.namespace}.{def.key}
                              </Text>
                            </BlockStack>
                            <Checkbox
                              label=""
                              labelHidden
                              checked={def.syncEnabled}
                              onChange={(checked) => handleToggleMetafieldDefinition(def.definitionId, checked)}
                            />
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  ) : (
                    <Banner tone="info">
                      <p>
                        No metafield definitions found. Metafields will be discovered from your supplier's products
                        during the next sync.
                      </p>
                    </Banner>
                  )}

                  <Button
                    variant="primary"
                    onClick={handleSaveMetafieldConfig}
                    loading={savingMetafields}
                  >
                    Save Metafield Settings
                  </Button>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Quick Actions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Quick Actions</Text>
              <InlineStack gap="200" wrap>
                <Button url={`/catalog/import?connectionId=${connectionId}`}>
                  Import Products
                </Button>
                <Button url={`/catalog/variants?connectionId=${connectionId}`}>
                  Manage Variants
                </Button>
                <Button url={`/orders?connectionId=${connectionId}`}>
                  View Orders
                </Button>
                <Button variant="primary" tone="critical">
                  Pause Connection
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Price Preview Modal */}
      <Modal
        open={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title="Price Rule Preview"
        primaryAction={{
          content: 'Apply to All Products',
          onAction: handleApplyPriceRule,
          loading: saving,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowPreviewModal(false),
          },
        ]}
        large
      >
        <Modal.Section>
          {pricePreview.length > 0 ? (
            <DataTable
              columnContentTypes={['text', 'numeric', 'numeric', 'numeric']}
              headings={['Product', 'Source Price', 'New Price', 'Change']}
              rows={pricePreview.slice(0, 20).map(p => [
                p.productTitle,
                `$${p.sourcePrice.toFixed(2)}`,
                `$${p.calculatedPrice.toFixed(2)}`,
                `${p.priceChangePercent > 0 ? '+' : ''}${p.priceChangePercent.toFixed(1)}%`,
              ])}
            />
          ) : (
            <Text as="p" tone="subdued">No products to preview</Text>
          )}
          {pricePreview.length > 20 && (
            <Box paddingBlockStart="400">
              <Text as="p" tone="subdued" alignment="center">
                ...and {pricePreview.length - 20} more products
              </Text>
            </Box>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
