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
  Divider,
  Box,
  Modal,
  DataTable,
  Icon,
  TextField,
  Filters,
} from '@shopify/polaris';
import {
  ClockIcon,
  ReplayIcon,
  PersonIcon,
  AppsIcon,
} from '@shopify/polaris-icons';
import { api } from '../lib/api';
import type {
  ProductSnapshot,
  ProductHistory,
} from '../lib/api';

interface ProductWithHistory {
  productId: string;
  productTitle: string;
  snapshotCount: number;
  lastChange: string;
  imageUrl: string | null;
}

export function ProductHistoryPage() {
  const [searchParams] = useSearchParams();
  const productIdParam = searchParams.get('productId');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Data
  const [products, setProducts] = useState<ProductWithHistory[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductHistory | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Rollback state
  const [rollingBack, setRollingBack] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (productIdParam) {
      loadProductHistory(productIdParam);
    }
  }, [productIdParam]);

  async function loadProducts() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<{ products: ProductWithHistory[] }>('/api/products/with-history');
      setProducts(data.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }

  async function loadProductHistory(productId: string) {
    try {
      const data = await api.get<ProductHistory>(`/api/products/${productId}/history`);
      setSelectedProduct(data);
      setShowHistoryModal(true);
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to load history',
        { isError: true }
      );
    }
  }

  const handleRollback = useCallback(async (snapshotId: string) => {
    try {
      setRollingBack(true);
      setSelectedSnapshotId(snapshotId);
      await api.post(`/api/snapshots/${snapshotId}/rollback`);
      window.shopify?.toast.show('Rollback successful');

      if (selectedProduct) {
        await loadProductHistory(selectedProduct.productId);
      }
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Rollback failed',
        { isError: true }
      );
    } finally {
      setRollingBack(false);
      setSelectedSnapshotId(null);
    }
  }, [selectedProduct]);

  const filteredProducts = products.filter(product => {
    if (!searchQuery) return true;
    return product.productTitle.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const changedByIcon = (changedBy: string) => {
    switch (changedBy) {
      case 'SUPPLIER_SYNC':
        return <Icon source={AppsIcon} tone="info" />;
      case 'MANUAL_EDIT':
        return <Icon source={PersonIcon} tone="success" />;
      default:
        return <Icon source={ClockIcon} tone="subdued" />;
    }
  };

  const changedByLabel = (changedBy: string) => {
    switch (changedBy) {
      case 'SUPPLIER_SYNC':
        return 'Supplier Sync';
      case 'MANUAL_EDIT':
        return 'Manual Edit';
      case 'SYSTEM':
        return 'System';
      default:
        return changedBy;
    }
  };

  const formatValue = (value: string) => {
    if (!value) return '(empty)';
    if (value.length > 50) return value.substring(0, 50) + '...';
    return value;
  };

  if (loading) {
    return (
      <Page title="Product History" backAction={{ content: 'Catalog', url: '/catalog' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading product history...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Product History"
      backAction={{ content: 'Catalog', url: '/catalog' }}
      subtitle="View changes and rollback to previous versions (30-day retention)"
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Info banner */}
        <Layout.Section>
          <Banner tone="info">
            <p>
              Product snapshots are kept for 30 days. You can rollback any field to a previous value
              within this window. Changes made by supplier sync, manual edits, and system updates are all tracked.
            </p>
          </Banner>
        </Layout.Section>

        {/* Search */}
        <Layout.Section>
          <Card>
            <Filters
              queryValue={searchQuery}
              filters={[]}
              onQueryChange={setSearchQuery}
              onQueryClear={() => setSearchQuery('')}
              onClearAll={() => setSearchQuery('')}
              queryPlaceholder="Search products..."
            />
          </Card>
        </Layout.Section>

        {/* Products with history */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Products with Change History</Text>

              {filteredProducts.length === 0 ? (
                <BlockStack gap="400" inlineAlign="center">
                  <Text as="p" tone="subdued">
                    No products with change history found
                  </Text>
                </BlockStack>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'product', plural: 'products' }}
                  items={filteredProducts}
                  renderItem={(product) => (
                    <ResourceItem
                      id={product.productId}
                      onClick={() => loadProductHistory(product.productId)}
                      accessibilityLabel={`View history for ${product.productTitle}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {product.productTitle}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {product.snapshotCount} changes • Last change:{' '}
                            {new Date(product.lastChange).toLocaleDateString()}
                          </Text>
                        </BlockStack>
                        <Button size="slim">View History</Button>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* History Modal */}
      <Modal
        open={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        title={selectedProduct?.productTitle || 'Product History'}
        large
      >
        <Modal.Section>
          {selectedProduct && (
            <BlockStack gap="400">
              {selectedProduct.snapshots.length === 0 ? (
                <Text as="p" tone="subdued">No change history available</Text>
              ) : (
                <BlockStack gap="300">
                  {selectedProduct.snapshots.map((snapshot) => (
                    <Box
                      key={snapshot.id}
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start">
                          <InlineStack gap="200" blockAlign="center">
                            {changedByIcon(snapshot.changedBy)}
                            <BlockStack gap="100">
                              <Text as="h4" variant="bodyMd" fontWeight="semibold">
                                {snapshot.field}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {changedByLabel(snapshot.changedBy)} •{' '}
                                {new Date(snapshot.createdAt).toLocaleString()}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          {snapshot.canRollback && (
                            <Button
                              size="slim"
                              icon={ReplayIcon}
                              onClick={() => handleRollback(snapshot.id)}
                              loading={rollingBack && selectedSnapshotId === snapshot.id}
                            >
                              Rollback
                            </Button>
                          )}
                        </InlineStack>

                        <Divider />

                        <InlineStack gap="400" wrap>
                          <Box minWidth="45%">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" tone="subdued">Previous value:</Text>
                              <Box padding="200" background="bg-surface-critical-subdued" borderRadius="100">
                                <Text as="p" variant="bodySm">
                                  {formatValue(snapshot.oldValue)}
                                </Text>
                              </Box>
                            </BlockStack>
                          </Box>
                          <Box minWidth="45%">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" tone="subdued">New value:</Text>
                              <Box padding="200" background="bg-surface-success-subdued" borderRadius="100">
                                <Text as="p" variant="bodySm">
                                  {formatValue(snapshot.newValue)}
                                </Text>
                              </Box>
                            </BlockStack>
                          </Box>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}

              {selectedProduct.snapshots.length > 0 && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Current Values</Text>
                    <DataTable
                      columnContentTypes={['text', 'text']}
                      headings={['Field', 'Value']}
                      rows={Object.entries(selectedProduct.currentValues).map(([field, value]) => [
                        field,
                        formatValue(value),
                      ])}
                    />
                  </BlockStack>
                </>
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
