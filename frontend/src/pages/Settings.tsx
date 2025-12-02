import { useEffect, useState } from 'react';
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
  Divider,
  List,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type { Shop } from '../lib/api';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: boolean;
    redis: boolean;
    shopify: boolean;
    queues: boolean;
  };
  version: string;
  uptime: number;
}

export function Settings() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [shopData, healthData] = await Promise.all([
        api.get<Shop>('/api/shop'),
        api.get<HealthStatus>('/api/status'),
      ]);
      setShop(shopData);
      setHealth(healthData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  const statusBadge = (healthy: boolean) =>
    healthy ? (
      <Badge tone="success">Operational</Badge>
    ) : (
      <Badge tone="critical">Down</Badge>
    );

  const planBadge = (plan: string) => {
    switch (plan?.toUpperCase()) {
      case 'FREE':
        return <Badge>Free</Badge>;
      case 'STARTER':
        return <Badge tone="info">Starter</Badge>;
      case 'GROWTH':
        return <Badge tone="attention">Growth</Badge>;
      case 'SCALE':
        return <Badge tone="success">Scale</Badge>;
      default:
        return <Badge>{plan || 'Free'}</Badge>;
    }
  };

  if (loading) {
    return (
      <Page title="Settings">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading settings...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Settings" subtitle="Manage your account and view system health">
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Error" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Account Info */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Account
              </Text>
              <Divider />
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Store
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {shop?.name || 'Unknown'}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Domain
                  </Text>
                  <Text as="p">{shop?.myshopifyDomain}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Role
                  </Text>
                  <Text as="p">{shop?.role || 'Not set'}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Plan
                  </Text>
                  {planBadge(shop?.plan || 'FREE')}
                </InlineStack>
              </BlockStack>
              <Button url="/settings/billing">Manage billing</Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* System Health */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  System Health
                </Text>
                <Badge
                  tone={
                    health?.status === 'healthy'
                      ? 'success'
                      : health?.status === 'degraded'
                        ? 'warning'
                        : 'critical'
                  }
                >
                  {health?.status || 'Unknown'}
                </Badge>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Database
                  </Text>
                  {statusBadge(health?.services.database ?? false)}
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Redis
                  </Text>
                  {statusBadge(health?.services.redis ?? false)}
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Shopify API
                  </Text>
                  {statusBadge(health?.services.shopify ?? false)}
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">
                    Job Queues
                  </Text>
                  {statusBadge(health?.services.queues ?? false)}
                </InlineStack>
              </BlockStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Version: {health?.version || 'Unknown'} • Uptime:{' '}
                {health?.uptime ? `${Math.floor(health.uptime / 3600)}h` : 'Unknown'}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Plan Features */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Plan Features
              </Text>
              <Divider />
              <InlineStack gap="800">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Current Plan: {shop?.plan || 'Free'}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      {shop?.plan === 'FREE' ? '3' : shop?.plan === 'STARTER' ? '10' : 'Unlimited'}{' '}
                      connections
                    </List.Item>
                    <List.Item>
                      {shop?.plan === 'FREE'
                        ? '100'
                        : shop?.plan === 'STARTER'
                          ? '500'
                          : 'Unlimited'}{' '}
                      products
                    </List.Item>
                    <List.Item>
                      {shop?.plan === 'SCALE' ? 'Priority' : 'Standard'} support
                    </List.Item>
                  </List>
                </BlockStack>
                <BlockStack gap="200">
                  <Button url="/settings/billing" variant="primary">
                    Upgrade Plan
                  </Button>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unlock more connections, products, and features
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Danger Zone */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" tone="critical">
                Danger Zone
              </Text>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    Disconnect all retailers
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    This will terminate all active connections with retailers.
                  </Text>
                </BlockStack>
                <Button tone="critical">Disconnect all</Button>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    Uninstall app
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Remove Cartrel from your store. All data will be deleted.
                  </Text>
                </BlockStack>
                <Button tone="critical" url="/settings/uninstall">
                  Uninstall
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
