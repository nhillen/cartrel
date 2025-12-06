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
  Box,
  Modal,
  DataTable,
  Checkbox,
  Icon,
} from '@shopify/polaris';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  RefreshIcon,
} from '@shopify/polaris-icons';
import { api } from '../lib/api';
import type {
  ProductVariantMappings,
  Connection,
} from '../lib/api';

export function VariantMappings() {
  const [searchParams] = useSearchParams();
  const connectionId = searchParams.get('connectionId');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(connectionId || '');
  const [products, setProducts] = useState<ProductVariantMappings[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductVariantMappings | null>(null);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editing state for variant mappings
  const [editedMappings, setEditedMappings] = useState<Map<string, string | null>>(new Map());
  const [availableRetailerVariants, setAvailableRetailerVariants] = useState<Array<{
    id: string;
    title: string;
    sku: string | null;
    options: string;
  }>>([]);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedConnectionId) {
      loadProducts();
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

  async function loadProducts() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<{ products: ProductVariantMappings[] }>(
        `/api/connections/${selectedConnectionId}/variant-mappings`
      );
      setProducts(data.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load variant mappings');
    } finally {
      setLoading(false);
    }
  }

  const handleProductClick = useCallback(async (product: ProductVariantMappings) => {
    setSelectedProduct(product);
    setEditedMappings(new Map());

    // Load available retailer variants for this product
    if (product.retailerProductId) {
      try {
        const data = await api.get<{ variants: typeof availableRetailerVariants }>(
          `/api/products/${product.retailerProductId}/variants`
        );
        setAvailableRetailerVariants(data.variants);
      } catch {
        setAvailableRetailerVariants([]);
      }
    }

    setShowMappingModal(true);
  }, []);

  const handleMappingChange = useCallback((supplierVariantId: string, retailerVariantId: string | null) => {
    setEditedMappings(prev => {
      const updated = new Map(prev);
      updated.set(supplierVariantId, retailerVariantId);
      return updated;
    });
  }, []);

  const handleSaveMappings = useCallback(async () => {
    if (!selectedProduct || editedMappings.size === 0) return;

    try {
      setSaving(true);
      const mappings = Array.from(editedMappings.entries()).map(([supplierVariantId, retailerVariantId]) => ({
        supplierVariantId,
        retailerVariantId,
      }));

      await api.post(`/api/products/${selectedProduct.productMappingId}/variant-mappings`, {
        mappings,
      });

      window.shopify?.toast.show('Variant mappings saved');
      setShowMappingModal(false);
      loadProducts();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save mappings',
        { isError: true }
      );
    } finally {
      setSaving(false);
    }
  }, [selectedProduct, editedMappings]);

  const handleAutoMatch = useCallback(async () => {
    if (!selectedProduct) return;

    try {
      setSaving(true);
      await api.post(`/api/products/${selectedProduct.productMappingId}/variant-mappings/auto-match`);
      window.shopify?.toast.show('Auto-match complete');
      setShowMappingModal(false);
      loadProducts();
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Auto-match failed',
        { isError: true }
      );
    } finally {
      setSaving(false);
    }
  }, [selectedProduct]);

  const confidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'exact':
        return <Badge tone="success">Exact Match</Badge>;
      case 'partial':
        return <Badge tone="warning">Partial Match</Badge>;
      case 'none':
        return <Badge tone="critical">No Match</Badge>;
      default:
        return <Badge>{confidence}</Badge>;
    }
  };

  const productsWithIssues = products.filter(p => p.unmappedCount > 0);
  const productsFullyMapped = products.filter(p => p.unmappedCount === 0);

  if (loading && products.length === 0) {
    return (
      <Page title="Variant Mappings" backAction={{ content: 'Catalog', url: '/catalog' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading variant mappings...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Variant Mappings"
      backAction={{ content: 'Catalog', url: '/catalog' }}
      subtitle="Manage how supplier variants map to your product variants"
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
            <InlineStack align="space-between" blockAlign="center">
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
              <Button onClick={loadProducts} icon={RefreshIcon} loading={loading}>
                Refresh
              </Button>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Summary */}
        <Layout.Section>
          <InlineStack gap="400">
            <Card>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" variant="headingLg" tone="critical">
                  {productsWithIssues.length}
                </Text>
                <Text as="p" tone="subdued">Products need attention</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" variant="headingLg" tone="success">
                  {productsFullyMapped.length}
                </Text>
                <Text as="p" tone="subdued">Fully mapped</Text>
              </BlockStack>
            </Card>
          </InlineStack>
        </Layout.Section>

        {/* Products needing attention */}
        {productsWithIssues.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200">
                  <Icon source={AlertCircleIcon} tone="warning" />
                  <Text as="h2" variant="headingMd">Products Needing Attention</Text>
                </InlineStack>
                <Text as="p" tone="subdued">
                  These products have variants that couldn't be automatically matched.
                  Click to manually map them.
                </Text>

                <ResourceList
                  resourceName={{ singular: 'product', plural: 'products' }}
                  items={productsWithIssues}
                  renderItem={(product) => (
                    <ResourceItem
                      id={product.productMappingId}
                      onClick={() => handleProductClick(product)}
                      accessibilityLabel={`Edit ${product.productTitle}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {product.productTitle}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {product.variantCount} variants • {product.mappedCount} mapped
                          </Text>
                        </BlockStack>
                        <Badge tone="critical">
                          {`${product.unmappedCount} unmapped`}
                        </Badge>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Fully mapped products */}
        {productsFullyMapped.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="h2" variant="headingMd">Fully Mapped Products</Text>
                </InlineStack>

                <ResourceList
                  resourceName={{ singular: 'product', plural: 'products' }}
                  items={productsFullyMapped.slice(0, 10)}
                  renderItem={(product) => (
                    <ResourceItem
                      id={product.productMappingId}
                      onClick={() => handleProductClick(product)}
                      accessibilityLabel={`View ${product.productTitle}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {product.productTitle}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {product.variantCount} variants
                          </Text>
                        </BlockStack>
                        <Badge tone="success">All mapped</Badge>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />

                {productsFullyMapped.length > 10 && (
                  <Text as="p" tone="subdued" alignment="center">
                    ...and {productsFullyMapped.length - 10} more products
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {products.length === 0 && !loading && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Text as="p" tone="subdued">
                  No variant mappings found for this connection.
                </Text>
                <Button url="/catalog/import">Import Products</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Variant Mapping Modal */}
      <Modal
        open={showMappingModal}
        onClose={() => setShowMappingModal(false)}
        title={selectedProduct?.productTitle || 'Variant Mappings'}
        primaryAction={{
          content: 'Save Mappings',
          onAction: handleSaveMappings,
          loading: saving,
          disabled: editedMappings.size === 0,
        }}
        secondaryActions={[
          {
            content: 'Auto-Match',
            onAction: handleAutoMatch,
            loading: saving,
          },
          {
            content: 'Cancel',
            onAction: () => setShowMappingModal(false),
          },
        ]}
        size="large"
      >
        <Modal.Section>
          {selectedProduct && (
            <BlockStack gap="400">
              <Banner tone="info">
                <p>
                  Map each supplier variant to the corresponding variant in your store.
                  Leave unmapped if you don't want to sync a particular variant.
                </p>
              </Banner>

              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text']}
                headings={['Supplier Variant', 'Match Status', 'Your Variant', 'Sync']}
                rows={selectedProduct.variants.map(variant => {
                  const currentMapping = editedMappings.has(variant.supplierVariantId)
                    ? editedMappings.get(variant.supplierVariantId)
                    : variant.retailerVariantId;

                  return [
                    <BlockStack gap="100" key={`supplier-${variant.supplierVariantId}`}>
                      <Text as="span" fontWeight="semibold">
                        {variant.supplierOptions.map(o => o.value).join(' / ')}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        SKU: {variant.supplierSku || 'N/A'} • ${variant.supplierPrice}
                      </Text>
                    </BlockStack>,
                    confidenceBadge(variant.matchConfidence),
                    <Select
                      key={`select-${variant.supplierVariantId}`}
                      label=""
                      labelHidden
                      options={[
                        { label: '-- Not mapped --', value: '' },
                        ...availableRetailerVariants.map(rv => ({
                          label: `${rv.options} (${rv.sku || 'No SKU'})`,
                          value: rv.id,
                        })),
                      ]}
                      value={currentMapping || ''}
                      onChange={(value) => handleMappingChange(
                        variant.supplierVariantId,
                        value || null
                      )}
                    />,
                    <Checkbox
                      key={`sync-${variant.supplierVariantId}`}
                      label=""
                      labelHidden
                      checked={variant.syncEnabled}
                      onChange={() => {}}
                    />,
                  ];
                })}
              />
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
