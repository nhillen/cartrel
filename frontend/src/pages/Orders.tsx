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
  Filters,
  ChoiceList,
  Modal,
  FormLayout,
  TextField,
  Select,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type { Order, Connection } from '../lib/api';

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queryValue, setQueryValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState('');
  const [poNote, setPoNote] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [ordersData, connectionsData] = await Promise.all([
        api.get<Order[]>('/api/orders'),
        api.get<Connection[]>('/api/connections'),
      ]);
      setOrders(ordersData);
      setConnections(connectionsData.filter((c) => c.status === 'ACTIVE'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  const handleCreatePO = useCallback(async () => {
    if (!selectedConnection) return;

    try {
      setCreating(true);
      await api.post('/api/orders/purchase-order', {
        connectionId: selectedConnection,
        note: poNote,
      });
      await loadData();
      setShowCreateModal(false);
      setSelectedConnection('');
      setPoNote('');
      window.shopify?.toast.show('Purchase order created');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to create PO',
        { isError: true }
      );
    } finally {
      setCreating(false);
    }
  }, [selectedConnection, poNote]);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge tone="attention">Pending</Badge>;
      case 'FORWARDED':
        return <Badge tone="info">Forwarded</Badge>;
      case 'FULFILLED':
        return <Badge tone="success">Fulfilled</Badge>;
      case 'CANCELLED':
        return <Badge tone="critical">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filteredOrders = orders.filter((order) => {
    const matchesQuery =
      !queryValue ||
      order.orderNumber.toLowerCase().includes(queryValue.toLowerCase());

    const matchesStatus =
      statusFilter.length === 0 || statusFilter.includes(order.status);

    return matchesQuery && matchesStatus;
  });

  if (loading) {
    return (
      <Page title="Orders">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading orders...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Orders"
      subtitle="Manage wholesale orders and purchase orders"
      primaryAction={{
        content: 'Create Purchase Order',
        onAction: () => setShowCreateModal(true),
        disabled: connections.length === 0,
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Error" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Stats */}
        <Layout.Section>
          <Card>
            <InlineStack gap="800">
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {orders.filter((o) => o.status === 'PENDING').length}
                </Text>
                <Text as="p" tone="subdued">
                  Pending
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {orders.filter((o) => o.status === 'FORWARDED').length}
                </Text>
                <Text as="p" tone="subdued">
                  Forwarded
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {orders.filter((o) => o.status === 'FULFILLED').length}
                </Text>
                <Text as="p" tone="subdued">
                  Fulfilled
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {orders.length}
                </Text>
                <Text as="p" tone="subdued">
                  Total
                </Text>
              </BlockStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Order List */}
        <Layout.Section>
          <Card padding="0">
            {orders.length === 0 ? (
              <Card>
                <BlockStack gap="400" inlineAlign="center">
                  <Text as="p" tone="subdued">
                    No orders yet
                  </Text>
                  {connections.length > 0 ? (
                    <Button onClick={() => setShowCreateModal(true)}>
                      Create purchase order
                    </Button>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Connect with a supplier first to create purchase orders
                    </Text>
                  )}
                </BlockStack>
              </Card>
            ) : (
              <ResourceList
                resourceName={{ singular: 'order', plural: 'orders' }}
                items={filteredOrders}
                filterControl={
                  <Filters
                    queryValue={queryValue}
                    filters={[
                      {
                        key: 'status',
                        label: 'Status',
                        filter: (
                          <ChoiceList
                            title="Status"
                            titleHidden
                            choices={[
                              { label: 'Pending', value: 'PENDING' },
                              { label: 'Forwarded', value: 'FORWARDED' },
                              { label: 'Fulfilled', value: 'FULFILLED' },
                              { label: 'Cancelled', value: 'CANCELLED' },
                            ]}
                            selected={statusFilter}
                            onChange={setStatusFilter}
                            allowMultiple
                          />
                        ),
                        shortcut: true,
                      },
                    ]}
                    onQueryChange={setQueryValue}
                    onQueryClear={() => setQueryValue('')}
                    onClearAll={() => {
                      setQueryValue('');
                      setStatusFilter([]);
                    }}
                  />
                }
                renderItem={(order) => (
                  <ResourceItem
                    id={order.id}
                    url={`/orders/${order.id}`}
                    accessibilityLabel={`View order ${order.orderNumber}`}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h3" variant="bodyMd" fontWeight="semibold">
                          {order.orderNumber}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {order.lineItems.length} items •{' '}
                          {order.currency} {order.totalPrice.toFixed(2)} •{' '}
                          {new Date(order.createdAt).toLocaleDateString()}
                        </Text>
                      </BlockStack>
                      {statusBadge(order.status)}
                    </InlineStack>
                  </ResourceItem>
                )}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {/* Create PO Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Purchase Order"
        primaryAction={{
          content: 'Create PO',
          onAction: handleCreatePO,
          loading: creating,
          disabled: !selectedConnection,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setShowCreateModal(false);
              setSelectedConnection('');
              setPoNote('');
            },
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Supplier Connection"
              options={[
                { label: 'Select a connection', value: '' },
                ...connections.map((c) => ({
                  label: c.supplierShop.name,
                  value: c.id,
                })),
              ]}
              value={selectedConnection}
              onChange={setSelectedConnection}
            />
            <TextField
              label="Note (optional)"
              value={poNote}
              onChange={setPoNote}
              autoComplete="off"
              multiline={3}
              helpText="Add a note for the supplier"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
