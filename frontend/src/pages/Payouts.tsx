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
  ResourceList,
  ResourceItem,
  Select,
  Divider,
  Box,
  Modal,
  TextField,
  Tabs,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type {
  Payout,
  PayoutSummary,
  PayoutSettings,
  PayoutStatus,
  Connection,
} from '../lib/api';

export function Payouts() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);

  // Data
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('all');

  // Settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settings, setSettings] = useState<PayoutSettings>({
    includesTax: false,
    shippingFeeType: 'NONE',
    shippingFeeFlat: 0,
    processingFeeType: 'NONE',
    processingFeeFlat: 0,
    processingFeePercent: 0,
    commissionType: 'PERCENT',
    commissionValue: 0,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // Action states
  const [processingPayoutId, setProcessingPayoutId] = useState<string | null>(null);

  const tabs = [
    { id: 'open', content: `Open (${summary?.openPayouts || 0})` },
    { id: 'paid', content: `Paid (${summary?.paidPayouts || 0})` },
    { id: 'received', content: `Received (${summary?.receivedPayouts || 0})` },
  ];

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadPayouts();
  }, [selectedTab, selectedConnectionId]);

  async function loadData() {
    try {
      setLoading(true);
      const [connectionsData, summaryData] = await Promise.all([
        api.get<Connection[]>('/api/connections'),
        api.get<PayoutSummary>('/api/payouts/summary'),
      ]);
      setConnections(connectionsData);
      setSummary(summaryData);
      await loadPayouts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }

  async function loadPayouts() {
    try {
      const status = ['OPEN', 'PAID', 'RECEIVED'][selectedTab] as PayoutStatus;
      const connectionParam = selectedConnectionId !== 'all' ? `&connectionId=${selectedConnectionId}` : '';
      const data = await api.get<{ payouts: Payout[] }>(
        `/api/payouts?status=${status}${connectionParam}`
      );
      setPayouts(data.payouts);
    } catch (err) {
      console.error('Failed to load payouts:', err);
    }
  }

  const handleMarkAsPaid = useCallback(async (payoutId: string) => {
    try {
      setProcessingPayoutId(payoutId);
      await api.post(`/api/payouts/${payoutId}/mark-paid`);
      window.shopify?.toast.show('Payout marked as paid');
      await loadData();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to update payout',
        { isError: true }
      );
    } finally {
      setProcessingPayoutId(null);
    }
  }, []);

  const handleMarkAsReceived = useCallback(async (payoutId: string) => {
    try {
      setProcessingPayoutId(payoutId);
      await api.post(`/api/payouts/${payoutId}/mark-received`);
      window.shopify?.toast.show('Payout marked as received');
      await loadData();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to update payout',
        { isError: true }
      );
    } finally {
      setProcessingPayoutId(null);
    }
  }, []);

  const handleSaveSettings = useCallback(async () => {
    try {
      setSavingSettings(true);
      await api.post('/api/payouts/settings', settings);
      window.shopify?.toast.show('Payout settings saved');
      setShowSettingsModal(false);
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save settings',
        { isError: true }
      );
    } finally {
      setSavingSettings(false);
    }
  }, [settings]);

  const statusBadge = (status: PayoutStatus) => {
    switch (status) {
      case 'OPEN':
        return <Badge tone="attention">Open</Badge>;
      case 'PAID':
        return <Badge tone="info">Paid</Badge>;
      case 'RECEIVED':
        return <Badge tone="success">Received</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  if (loading) {
    return (
      <Page title="Payouts">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading payouts...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Payouts"
      subtitle="Track commissions and settlements with your suppliers"
      primaryAction={{
        content: 'Payout Settings',
        onAction: () => setShowSettingsModal(true),
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Summary Cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Card>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" variant="headingLg" tone="caution">
                  {formatCurrency(summary?.openTotal || 0, summary?.currency)}
                </Text>
                <Text as="p" tone="subdued">{summary?.openPayouts || 0} open payouts</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" variant="headingLg" tone="info">
                  {formatCurrency(summary?.paidTotal || 0, summary?.currency)}
                </Text>
                <Text as="p" tone="subdued">{summary?.paidPayouts || 0} paid</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" variant="headingLg" tone="success">
                  {formatCurrency(summary?.receivedTotal || 0, summary?.currency)}
                </Text>
                <Text as="p" tone="subdued">{summary?.receivedPayouts || 0} received</Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Filters */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
              <Box minWidth="200px">
                <Select
                  label=""
                  labelHidden
                  options={[
                    { label: 'All connections', value: 'all' },
                    ...connections.map(c => ({
                      label: c.supplierShop.name,
                      value: c.id,
                    })),
                  ]}
                  value={selectedConnectionId}
                  onChange={setSelectedConnectionId}
                />
              </Box>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Payouts List */}
        <Layout.Section>
          <Card>
            {payouts.length === 0 ? (
              <BlockStack gap="400" inlineAlign="center">
                <Text as="p" tone="subdued">
                  No {['open', 'paid', 'received'][selectedTab]} payouts found
                </Text>
              </BlockStack>
            ) : (
              <ResourceList
                resourceName={{ singular: 'payout', plural: 'payouts' }}
                items={payouts}
                renderItem={(payout) => (
                  <ResourceItem
                    id={payout.id}
                    accessibilityLabel={`Payout ${payout.payoutNumber}`}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {payout.payoutNumber}
                          </Text>
                          {statusBadge(payout.status)}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {payout.supplierName} • {payout.orderCount} orders •{' '}
                          {new Date(payout.createdAt).toLocaleDateString()}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="400" blockAlign="center">
                        <BlockStack gap="100" inlineAlign="end">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {formatCurrency(payout.total, payout.currency)}
                          </Text>
                          {payout.commissionAmount > 0 && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              -{formatCurrency(payout.commissionAmount, payout.currency)} commission
                            </Text>
                          )}
                        </BlockStack>
                        {payout.status === 'OPEN' && (
                          <Button
                            size="slim"
                            onClick={() => handleMarkAsPaid(payout.id)}
                            loading={processingPayoutId === payout.id}
                          >
                            Mark Paid
                          </Button>
                        )}
                        {payout.status === 'PAID' && (
                          <Button
                            size="slim"
                            onClick={() => handleMarkAsReceived(payout.id)}
                            loading={processingPayoutId === payout.id}
                          >
                            Mark Received
                          </Button>
                        )}
                      </InlineStack>
                    </InlineStack>
                  </ResourceItem>
                )}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {/* Settings Modal */}
      <Modal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title="Payout Settings"
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
            <Select
              label="Commission Type"
              options={[
                { label: 'Percentage of order', value: 'PERCENT' },
                { label: 'Flat fee per order', value: 'FLAT' },
              ]}
              value={settings.commissionType}
              onChange={(value) => setSettings(prev => ({
                ...prev,
                commissionType: value as 'FLAT' | 'PERCENT',
              }))}
            />

            <TextField
              label={settings.commissionType === 'PERCENT' ? 'Commission %' : 'Commission Amount'}
              type="number"
              value={settings.commissionValue.toString()}
              onChange={(value) => setSettings(prev => ({
                ...prev,
                commissionValue: parseFloat(value) || 0,
              }))}
              suffix={settings.commissionType === 'PERCENT' ? '%' : undefined}
              prefix={settings.commissionType === 'FLAT' ? '$' : undefined}
              autoComplete="off"
            />

            <Divider />

            <Select
              label="Shipping Fee"
              options={[
                { label: 'None', value: 'NONE' },
                { label: 'Use order shipping cost', value: 'ORDER_SHIPPING' },
                { label: 'Flat fee', value: 'FLAT' },
              ]}
              value={settings.shippingFeeType}
              onChange={(value) => setSettings(prev => ({
                ...prev,
                shippingFeeType: value as PayoutSettings['shippingFeeType'],
              }))}
            />

            {settings.shippingFeeType === 'FLAT' && (
              <TextField
                label="Flat Shipping Fee"
                type="number"
                value={settings.shippingFeeFlat.toString()}
                onChange={(value) => setSettings(prev => ({
                  ...prev,
                  shippingFeeFlat: parseFloat(value) || 0,
                }))}
                prefix="$"
                autoComplete="off"
              />
            )}

            <Divider />

            <Select
              label="Processing Fee"
              options={[
                { label: 'None', value: 'NONE' },
                { label: 'Flat fee', value: 'FLAT' },
                { label: 'Percentage', value: 'PERCENT' },
                { label: 'Flat + Percentage', value: 'FLAT_PLUS_PERCENT' },
              ]}
              value={settings.processingFeeType}
              onChange={(value) => setSettings(prev => ({
                ...prev,
                processingFeeType: value as PayoutSettings['processingFeeType'],
              }))}
            />

            {(settings.processingFeeType === 'FLAT' || settings.processingFeeType === 'FLAT_PLUS_PERCENT') && (
              <TextField
                label="Processing Fee (Flat)"
                type="number"
                value={settings.processingFeeFlat.toString()}
                onChange={(value) => setSettings(prev => ({
                  ...prev,
                  processingFeeFlat: parseFloat(value) || 0,
                }))}
                prefix="$"
                autoComplete="off"
              />
            )}

            {(settings.processingFeeType === 'PERCENT' || settings.processingFeeType === 'FLAT_PLUS_PERCENT') && (
              <TextField
                label="Processing Fee (%)"
                type="number"
                value={settings.processingFeePercent.toString()}
                onChange={(value) => setSettings(prev => ({
                  ...prev,
                  processingFeePercent: parseFloat(value) || 0,
                }))}
                suffix="%"
                autoComplete="off"
              />
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
