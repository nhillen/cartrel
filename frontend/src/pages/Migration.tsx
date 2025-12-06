import { useEffect, useState, useCallback } from 'react';
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
  DataTable,
  Divider,
  Box,
  Icon,
  ProgressBar,
  Select,
  TextField,
} from '@shopify/polaris';
import {
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
} from '@shopify/polaris-icons';
import { api } from '../lib/api';
import type {
  PricingComparison,
  FeatureComparison,
  ShadowModeStats,
  Connection,
} from '../lib/api';

interface MigrationPreview {
  estimatedSetupTime: string;
  steps: Array<{
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'complete';
  }>;
  productCount: number;
  connectionCount: number;
}

export function Migration() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [pricingComparison, setPricingComparison] = useState<PricingComparison | null>(null);
  const [featureComparison, setFeatureComparison] = useState<FeatureComparison[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [shadowStats, setShadowStats] = useState<Map<string, ShadowModeStats>>(new Map());
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null);

  // Calculator inputs
  const [calcConnections, setCalcConnections] = useState('5');
  const [calcProducts, setCalcProducts] = useState('500');
  const [calcOrders, setCalcOrders] = useState('100');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const [pricing, features, conns, preview] = await Promise.all([
        api.get<PricingComparison>(
          `/api/retailer/shadow/compare-pricing?connections=${calcConnections}&products=${calcProducts}&orders=${calcOrders}`
        ).catch(() => null),
        api.get<{ features: FeatureComparison[] }>('/api/retailer/shadow/compare-features')
          .then(r => r.features)
          .catch(() => []),
        api.get<Connection[]>('/api/connections').catch(() => []),
        api.get<MigrationPreview>('/api/retailer/shadow/migration-preview').catch(() => null),
      ]);

      setPricingComparison(pricing);
      setFeatureComparison(features);
      setConnections(conns);
      setMigrationPreview(preview);

      // Load shadow stats for each connection
      const statsMap = new Map<string, ShadowModeStats>();
      for (const conn of conns) {
        try {
          const stats = await api.get<ShadowModeStats>(
            `/api/retailer/shadow/stats?connectionId=${conn.id}`
          );
          statsMap.set(conn.id, stats);
        } catch {
          // Ignore errors for individual connections
        }
      }
      setShadowStats(statsMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load migration data');
    } finally {
      setLoading(false);
    }
  }

  const handleRecalculate = useCallback(async () => {
    try {
      const pricing = await api.get<PricingComparison>(
        `/api/retailer/shadow/compare-pricing?connections=${calcConnections}&products=${calcProducts}&orders=${calcOrders}`
      );
      setPricingComparison(pricing);
    } catch (err) {
      window.shopify?.toast.show('Failed to calculate pricing', { isError: true });
    }
  }, [calcConnections, calcProducts, calcOrders]);

  const handleToggleShadowMode = useCallback(async (connectionId: string, enable: boolean) => {
    try {
      const endpoint = enable
        ? '/api/retailer/shadow/enable'
        : '/api/retailer/shadow/disable';

      await api.post(endpoint, { connectionId });

      setShadowStats(prev => {
        const updated = new Map(prev);
        const current = updated.get(connectionId);
        if (current) {
          updated.set(connectionId, { ...current, enabled: enable });
        }
        return updated;
      });

      window.shopify?.toast.show(
        enable ? 'Shadow mode enabled' : 'Shadow mode disabled'
      );
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to toggle shadow mode',
        { isError: true }
      );
    }
  }, []);

  const featureIcon = (value: boolean | string, winner: string, side: 'cartrel' | 'competitor') => {
    if (typeof value === 'boolean') {
      return value ? (
        <Icon source={CheckCircleIcon} tone={winner === side ? 'success' : 'base'} />
      ) : (
        <Icon source={XCircleIcon} tone="critical" />
      );
    }
    return <Text as="span">{value}</Text>;
  };

  if (loading) {
    return (
      <Page title="Migration Tools" backAction={{ content: 'Settings', url: '/settings' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading migration tools...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Migration Tools"
      backAction={{ content: 'Settings', url: '/settings' }}
      subtitle="Zero-risk migration with Shadow Mode"
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Pricing Comparison */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Pricing Comparison</Text>
                <Badge tone="success">Save up to 48%</Badge>
              </InlineStack>

              <Text as="p" tone="subdued">
                Calculate your savings by switching to Cartrel
              </Text>

              <Divider />

              {/* Calculator inputs */}
              <InlineStack gap="400" wrap>
                <Box minWidth="120px">
                  <TextField
                    label="Connections"
                    type="number"
                    value={calcConnections}
                    onChange={setCalcConnections}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="120px">
                  <TextField
                    label="Products"
                    type="number"
                    value={calcProducts}
                    onChange={setCalcProducts}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="120px">
                  <TextField
                    label="Orders/mo"
                    type="number"
                    value={calcOrders}
                    onChange={setCalcOrders}
                    autoComplete="off"
                  />
                </Box>
                <Box>
                  <Button onClick={handleRecalculate}>Calculate</Button>
                </Box>
              </InlineStack>

              {pricingComparison && (
                <>
                  <Divider />

                  <InlineStack gap="800" align="center">
                    {/* Competitor */}
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200" minWidth="200px">
                      <BlockStack gap="200" inlineAlign="center">
                        <Text as="h3" variant="headingSm">Other Apps</Text>
                        <Text as="p" variant="headingXl" tone="critical">
                          ${pricingComparison.competitor.monthlyPrice}/mo
                        </Text>
                        <Text as="p" tone="subdued">
                          {pricingComparison.competitor.plan} plan
                        </Text>
                      </BlockStack>
                    </Box>

                    {/* Arrow */}
                    <Text as="span" variant="headingLg">→</Text>

                    {/* Cartrel */}
                    <Box padding="400" background="bg-fill-success-secondary" borderRadius="200" minWidth="200px">
                      <BlockStack gap="200" inlineAlign="center">
                        <Text as="h3" variant="headingSm">Cartrel</Text>
                        <Text as="p" variant="headingXl" tone="success">
                          ${pricingComparison.cartrel.monthlyPrice}/mo
                        </Text>
                        <Text as="p" tone="subdued">
                          {pricingComparison.cartrel.plan} plan
                        </Text>
                      </BlockStack>
                    </Box>
                  </InlineStack>

                  <Banner tone="success">
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="bold">
                        Save ${pricingComparison.savings.monthly}/month ({pricingComparison.savings.percentMonthly}%)
                      </Text>
                      <Text as="p">
                        That's ${pricingComparison.savings.annual}/year with annual billing!
                      </Text>
                    </BlockStack>
                  </Banner>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Feature Comparison */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Feature Comparison</Text>
              <Text as="p" tone="subdued">
                See how Cartrel stacks up against other sync apps
              </Text>

              {featureComparison.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'text']}
                  headings={['Feature', 'Cartrel', 'Others']}
                  rows={featureComparison.map(f => [
                    f.feature,
                    featureIcon(f.cartrel, f.winner, 'cartrel'),
                    featureIcon(f.competitor, f.winner, 'competitor'),
                  ])}
                />
              ) : (
                <Text as="p" tone="subdued">Feature comparison not available</Text>
              )}

              <InlineStack gap="400">
                <InlineStack gap="100">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="span" tone="subdued">= Available</Text>
                </InlineStack>
                <InlineStack gap="100">
                  <Icon source={XCircleIcon} tone="critical" />
                  <Text as="span" tone="subdued">= Not available</Text>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Shadow Mode */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Shadow Mode</Text>
                  <Text as="p" tone="subdued">
                    Test imports without creating products - run alongside your current app risk-free
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">How Shadow Mode Works:</Text>
                  <Text as="p">
                    1. Enable shadow mode on a connection<br />
                    2. Import products - they're saved but NOT created in Shopify<br />
                    3. Compare what would sync vs your current app<br />
                    4. When ready, promote shadow imports to real products
                  </Text>
                </BlockStack>
              </Banner>

              {connections.length > 0 ? (
                <BlockStack gap="300">
                  {connections.map(conn => {
                    const stats = shadowStats.get(conn.id);
                    return (
                      <Box
                        key={conn.id}
                        padding="400"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200">
                              <Text as="h4" variant="bodyMd" fontWeight="semibold">
                                {conn.supplierShop.name}
                              </Text>
                              {stats?.enabled && (
                                <Badge tone="info">Shadow Mode Active</Badge>
                              )}
                            </InlineStack>
                            {stats && (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {stats.shadowImports} shadow imports • {stats.totalMappings} total mappings
                              </Text>
                            )}
                          </BlockStack>
                          <InlineStack gap="200">
                            {stats?.shadowImports > 0 && (
                              <Button
                                url={`/connections/${conn.id}?tab=shadow`}
                                variant="plain"
                              >
                                View Shadow Imports
                              </Button>
                            )}
                            <Button
                              onClick={() => handleToggleShadowMode(conn.id, !stats?.enabled)}
                              variant={stats?.enabled ? 'secondary' : 'primary'}
                            >
                              {stats?.enabled ? 'Disable' : 'Enable'} Shadow Mode
                            </Button>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  No connections found. Connect to a supplier first to use shadow mode.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Migration Steps */}
        {migrationPreview && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Migration Checklist</Text>
                  <Text as="p" tone="subdued">
                    Estimated time: {migrationPreview.estimatedSetupTime}
                  </Text>
                </InlineStack>

                <Divider />

                <BlockStack gap="300">
                  {migrationPreview.steps.map((step, index) => (
                    <InlineStack key={index} gap="300" blockAlign="start">
                      <Box minWidth="24px">
                        {step.status === 'complete' ? (
                          <Icon source={CheckCircleIcon} tone="success" />
                        ) : step.status === 'in_progress' ? (
                          <Spinner size="small" />
                        ) : (
                          <Icon source={MinusCircleIcon} tone="subdued" />
                        )}
                      </Box>
                      <BlockStack gap="100">
                        <Text
                          as="h4"
                          variant="bodyMd"
                          fontWeight={step.status === 'in_progress' ? 'bold' : 'regular'}
                        >
                          {step.title}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {step.description}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>

                <Divider />

                <InlineStack gap="800">
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg">{migrationPreview.productCount}</Text>
                    <Text as="p" tone="subdued">Products to migrate</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg">{migrationPreview.connectionCount}</Text>
                    <Text as="p" tone="subdued">Connections</Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* CTA */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400" inlineAlign="center">
              <Text as="h2" variant="headingMd">Ready to Switch?</Text>
              <Text as="p" tone="subdued">
                Start your zero-risk migration today. Keep your current app running while you test with Shadow Mode.
              </Text>
              <InlineStack gap="200">
                <Button variant="primary" url="/catalog/import">
                  Start Importing Products
                </Button>
                <Button url="/connections">
                  Manage Connections
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
