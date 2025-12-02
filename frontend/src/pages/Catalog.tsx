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
  Thumbnail,
  Filters,
  ChoiceList,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type { Product } from '../lib/api';

export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [queryValue, setQueryValue] = useState('');
  const [wholesaleFilter, setWholesaleFilter] = useState<string[]>([]);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<Product[]>('/api/catalog/products');
      setProducts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }

  const handleToggleWholesale = useCallback(
    async (productId: string, enabled: boolean) => {
      try {
        await api.patch(`/api/catalog/products/${productId}`, {
          isWholesaleEligible: enabled,
        });
        setProducts((prev) =>
          prev.map((p) =>
            p.id === productId ? { ...p, isWholesaleEligible: enabled } : p
          )
        );
        window.shopify?.toast.show(
          enabled ? 'Product enabled for wholesale' : 'Product removed from wholesale'
        );
      } catch (err) {
        window.shopify?.toast.show('Failed to update product', { isError: true });
      }
    },
    []
  );

  const handleBulkUpdate = useCallback(
    async (enabled: boolean) => {
      if (selectedProducts.length === 0) return;

      try {
        await api.post('/api/catalog/products/bulk', {
          productIds: selectedProducts,
          isWholesaleEligible: enabled,
        });
        await loadProducts();
        setSelectedProducts([]);
        window.shopify?.toast.show(
          `Updated ${selectedProducts.length} products`
        );
      } catch (err) {
        window.shopify?.toast.show('Failed to update products', { isError: true });
      }
    },
    [selectedProducts]
  );

  const filteredProducts = products.filter((product) => {
    const matchesQuery =
      !queryValue ||
      product.title.toLowerCase().includes(queryValue.toLowerCase()) ||
      product.sku?.toLowerCase().includes(queryValue.toLowerCase());

    const matchesWholesale =
      wholesaleFilter.length === 0 ||
      (wholesaleFilter.includes('wholesale') && product.isWholesaleEligible) ||
      (wholesaleFilter.includes('not-wholesale') && !product.isWholesaleEligible);

    return matchesQuery && matchesWholesale;
  });

  const promotedBulkActions = [
    {
      content: 'Enable wholesale',
      onAction: () => handleBulkUpdate(true),
    },
    {
      content: 'Disable wholesale',
      onAction: () => handleBulkUpdate(false),
    },
  ];

  if (loading) {
    return (
      <Page title="Catalog">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading catalog...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Catalog"
      subtitle="Manage your wholesale product catalog"
      primaryAction={{
        content: 'Import from Supplier',
        url: '/catalog/import',
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
                  {products.filter((p) => p.isWholesaleEligible).length}
                </Text>
                <Text as="p" tone="subdued">
                  Wholesale enabled
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingLg">
                  {products.length}
                </Text>
                <Text as="p" tone="subdued">
                  Total products
                </Text>
              </BlockStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Product List */}
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: 'product', plural: 'products' }}
              items={filteredProducts}
              selectedItems={selectedProducts}
              onSelectionChange={(items) =>
                setSelectedProducts(items === 'All' ? filteredProducts.map((p) => p.id) : items)
              }
              promotedBulkActions={promotedBulkActions}
              filterControl={
                <Filters
                  queryValue={queryValue}
                  filters={[
                    {
                      key: 'wholesale',
                      label: 'Wholesale status',
                      filter: (
                        <ChoiceList
                          title="Wholesale status"
                          titleHidden
                          choices={[
                            { label: 'Wholesale enabled', value: 'wholesale' },
                            { label: 'Not wholesale', value: 'not-wholesale' },
                          ]}
                          selected={wholesaleFilter}
                          onChange={setWholesaleFilter}
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
                    setWholesaleFilter([]);
                  }}
                />
              }
              renderItem={(product) => (
                <ResourceItem
                  id={product.id}
                  url={`/catalog/${product.id}`}
                  accessibilityLabel={`View ${product.title}`}
                  media={
                    <Thumbnail
                      source="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                      alt={product.title}
                    />
                  }
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h3" variant="bodyMd" fontWeight="semibold">
                        {product.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {product.sku || 'No SKU'} • ${product.wholesalePrice.toFixed(2)} •{' '}
                        {product.inventoryQuantity} in stock
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      {product.isWholesaleEligible ? (
                        <Badge tone="success">Wholesale</Badge>
                      ) : (
                        <Badge>Not wholesale</Badge>
                      )}
                      <Button
                        size="slim"
                        onClick={() =>
                          handleToggleWholesale(product.id, !product.isWholesaleEligible)
                        }
                      >
                        {product.isWholesaleEligible ? 'Disable' : 'Enable'}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </ResourceItem>
              )}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
