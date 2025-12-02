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
  Box,
  InlineGrid,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type { DashboardStats } from '../lib/api';

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<DashboardStats>('/api/shop/dashboard');
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Page title="Dashboard">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading dashboard...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Dashboard">
        <Layout>
          <Layout.Section>
            <Banner tone="critical" title="Error loading dashboard">
              <p>{error}</p>
              <Button onClick={loadStats}>Retry</Button>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const healthBadge = () => {
    switch (stats?.health.status) {
      case 'healthy':
        return <Badge tone="success">Healthy</Badge>;
      case 'degraded':
        return <Badge tone="warning">Degraded</Badge>;
      case 'unhealthy':
        return <Badge tone="critical">Unhealthy</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  return (
    <Page
      title="Dashboard"
      subtitle="Overview of your wholesale operations"
      primaryAction={{
        content: 'Create Invite',
        url: '/connections/invite',
      }}
    >
      <Layout>
        {/* Health Banner */}
        {stats?.health.status !== 'healthy' && (
          <Layout.Section>
            <Banner
              tone={stats?.health.status === 'degraded' ? 'warning' : 'critical'}
              title="System Status"
            >
              <p>
                Some services may be experiencing issues.{' '}
                <Button variant="plain" url="/settings">
                  View details
                </Button>
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Stats Cards */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Active Connections
                </Text>
                <Text as="p" variant="headingXl">
                  {stats?.connections.active ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats?.connections.pending ?? 0} pending
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Wholesale Products
                </Text>
                <Text as="p" variant="headingXl">
                  {stats?.products.wholesale ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats?.products.mapped ?? 0} mapped to retailers
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Orders This Month
                </Text>
                <Text as="p" variant="headingXl">
                  {stats?.orders.total ?? 0}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats?.orders.pending ?? 0} pending fulfillment
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  System Health
                </Text>
                <Box>{healthBadge()}</Box>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats?.health.webhooksActive ? 'Webhooks active' : 'Webhooks inactive'}
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* Quick Actions */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Supplier Actions
              </Text>
              <BlockStack gap="200">
                <Button url="/connections/invite" variant="primary">
                  Create connection invite
                </Button>
                <Button url="/catalog">Manage wholesale catalog</Button>
                <Button url="/orders">View incoming orders</Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Retailer Actions
              </Text>
              <BlockStack gap="200">
                <Button url="/connections/accept" variant="primary">
                  Accept invite code
                </Button>
                <Button url="/catalog/import">Import products</Button>
                <Button url="/orders/create">Create purchase order</Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Activity */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent Activity
                </Text>
                <Button variant="plain" url="/orders">
                  View all
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                Recent order and sync activity will appear here.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
