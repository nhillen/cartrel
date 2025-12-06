import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Checkbox,
  TextField,
  Select,
  ProgressBar,
  Divider,
  Box,
  Icon,
  Filters,
} from '@shopify/polaris';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
} from '@shopify/polaris-icons';
import { api } from '../lib/api';
import type {
  SupplierForImport,
  AvailableProduct,
  ImportPreferences,
  ImportPreviewResult,
  ImportResult,
} from '../lib/api';

type WizardStep = 'supplier' | 'products' | 'settings' | 'preview' | 'importing' | 'complete';

const STEP_ORDER: WizardStep[] = ['supplier', 'products', 'settings', 'preview', 'importing', 'complete'];

const DEFAULT_PREFERENCES: ImportPreferences = {
  syncTitle: true,
  syncDescription: true,
  syncImages: true,
  syncPricing: false,
  syncInventory: true,
  syncTags: false,
  syncSEO: false,
  syncMetafields: false,
  markupType: 'PERCENTAGE',
  markupValue: 50,
};

export function ImportWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedConnectionId = searchParams.get('connectionId');

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('supplier');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [suppliers, setSuppliers] = useState<SupplierForImport[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierForImport | null>(null);
  const [availableProducts, setAvailableProducts] = useState<AvailableProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<ImportPreferences>(DEFAULT_PREFERENCES);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [showImported, setShowImported] = useState(false);
  const [orderedOnly, setOrderedOnly] = useState(false);
  const [sortByOrdered, setSortByOrdered] = useState(true);

  // Load suppliers on mount
  useEffect(() => {
    loadSuppliers();
  }, []);

  // Auto-select preselected connection
  useEffect(() => {
    if (preselectedConnectionId && suppliers.length > 0) {
      const supplier = suppliers.find(s => s.connectionId === preselectedConnectionId);
      if (supplier) {
        setSelectedSupplier(supplier);
        setCurrentStep('products');
      }
    }
  }, [preselectedConnectionId, suppliers]);

  async function loadSuppliers() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<{ suppliers: SupplierForImport[] }>('/api/retailer/suppliers');
      setSuppliers(data.suppliers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailableProducts() {
    if (!selectedSupplier) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.get<{ products: AvailableProduct[]; nextCursor: string | null }>(
        `/api/retailer/import/available?connectionId=${selectedSupplier.connectionId}&includeImported=${showImported}`
      );
      setAvailableProducts(data.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }

  async function loadPreview() {
    if (!selectedSupplier || selectedProductIds.length === 0) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.post<ImportPreviewResult>('/api/retailer/import/preview', {
        connectionId: selectedSupplier.connectionId,
        productIds: selectedProductIds,
        preferences,
      });
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview');
    } finally {
      setLoading(false);
    }
  }

  async function executeImport() {
    if (!selectedSupplier || selectedProductIds.length === 0) return;

    try {
      setError(null);
      setCurrentStep('importing');

      const data = await api.post<ImportResult>('/api/retailer/import/bulk', {
        connectionId: selectedSupplier.connectionId,
        productIds: selectedProductIds,
        preferences,
        createInShopify: true,
      });

      setImportResult(data);
      setCurrentStep('complete');
      window.shopify?.toast.show(`Successfully imported ${data.summary.success} products`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setCurrentStep('preview');
    }
  }

  // Load products when supplier is selected
  useEffect(() => {
    if (currentStep === 'products' && selectedSupplier) {
      loadAvailableProducts();
    }
  }, [currentStep, selectedSupplier, showImported]);

  // Load preview when entering preview step
  useEffect(() => {
    if (currentStep === 'preview') {
      loadPreview();
    }
  }, [currentStep]);

  const handleSupplierSelect = useCallback((supplier: SupplierForImport) => {
    setSelectedSupplier(supplier);
    setPreferences(prev => ({
      ...prev,
      markupType: supplier.defaultMarkup.type,
      markupValue: supplier.defaultMarkup.value,
    }));
  }, []);

  const handleNextStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      setCurrentStep(STEP_ORDER[currentIndex + 1]);
    }
  }, [currentStep]);

  const handlePrevStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(STEP_ORDER[currentIndex - 1]);
    }
  }, [currentStep]);

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 'supplier':
        return selectedSupplier !== null;
      case 'products':
        return selectedProductIds.length > 0;
      case 'settings':
        return true;
      case 'preview':
        return preview !== null && !loading;
      default:
        return false;
    }
  }, [currentStep, selectedSupplier, selectedProductIds, preview, loading]);

  const filteredProducts = useMemo(() => {
    let products = availableProducts.filter(product => {
      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch = (
          product.title.toLowerCase().includes(query) ||
          product.sku?.toLowerCase().includes(query) ||
          product.vendor?.toLowerCase().includes(query)
        );
        if (!matchesSearch) return false;
      }
      // Filter to only show ordered products if enabled
      if (orderedOnly && !product.hasOrdered) {
        return false;
      }
      return true;
    });

    // Sort ordered products first if enabled
    if (sortByOrdered) {
      products = [...products].sort((a, b) => {
        // Ordered products first
        if (a.hasOrdered && !b.hasOrdered) return -1;
        if (!a.hasOrdered && b.hasOrdered) return 1;
        // Among ordered, sort by order count (most ordered first)
        if (a.hasOrdered && b.hasOrdered) {
          return b.orderCount - a.orderCount;
        }
        return 0;
      });
    }

    return products;
  }, [availableProducts, searchQuery, orderedOnly, sortByOrdered]);

  const orderedProductCount = useMemo(() => {
    return availableProducts.filter(p => p.hasOrdered).length;
  }, [availableProducts]);

  const stepProgress = useMemo(() => {
    const index = STEP_ORDER.indexOf(currentStep);
    return Math.round((index / (STEP_ORDER.length - 1)) * 100);
  }, [currentStep]);

  // Render functions for each step
  const renderSupplierStep = () => (
    <Layout.Section>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">Select a Supplier</Text>
          <Text as="p" tone="subdued">
            Choose which supplier's catalog you want to import products from.
          </Text>

          {suppliers.length === 0 ? (
            <Banner tone="info">
              <p>You don't have any active supplier connections. Connect to a supplier first to import products.</p>
            </Banner>
          ) : (
            <ResourceList
              resourceName={{ singular: 'supplier', plural: 'suppliers' }}
              items={suppliers}
              renderItem={(supplier) => (
                <ResourceItem
                  id={supplier.connectionId}
                  onClick={() => handleSupplierSelect(supplier)}
                  accessibilityLabel={`Select ${supplier.name}`}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h3" variant="bodyMd" fontWeight="semibold">
                        {supplier.name}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {supplier.tier} tier • {supplier.paymentTerms} payment
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge>
                        {`${supplier.defaultMarkup.value}% markup`}
                      </Badge>
                      {selectedSupplier?.connectionId === supplier.connectionId && (
                        <Icon source={CheckIcon} tone="success" />
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
  );

  const renderProductsStep = () => (
    <Layout.Section>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Select Products to Import</Text>
              <Text as="p" tone="subdued">
                {selectedProductIds.length} of {filteredProducts.length} products selected
                {orderedProductCount > 0 && ` (${orderedProductCount} you've ordered)`}
              </Text>
            </BlockStack>
            <InlineStack gap="400">
              <Checkbox
                label="Show already imported"
                checked={showImported}
                onChange={setShowImported}
              />
            </InlineStack>
          </InlineStack>

          {/* Order-based filtering banner */}
          {orderedProductCount > 0 && (
            <Banner tone="info">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="p">
                  You've ordered {orderedProductCount} products from this supplier.
                  We recommend starting with products you've already purchased.
                </Text>
                <InlineStack gap="200">
                  <Checkbox
                    label="Show ordered first"
                    checked={sortByOrdered}
                    onChange={setSortByOrdered}
                  />
                  <Checkbox
                    label="Only show ordered"
                    checked={orderedOnly}
                    onChange={setOrderedOnly}
                  />
                </InlineStack>
              </InlineStack>
            </Banner>
          )}

          <Filters
            queryValue={searchQuery}
            filters={[]}
            onQueryChange={setSearchQuery}
            onQueryClear={() => setSearchQuery('')}
            onClearAll={() => setSearchQuery('')}
            queryPlaceholder="Search by title, SKU, or vendor..."
          />

          {loading ? (
            <BlockStack gap="400" inlineAlign="center">
              <Spinner size="large" />
              <Text as="p">Loading products...</Text>
            </BlockStack>
          ) : (
            <ResourceList
              resourceName={{ singular: 'product', plural: 'products' }}
              items={filteredProducts}
              selectedItems={selectedProductIds}
              onSelectionChange={(items) =>
                setSelectedProductIds(items === 'All' ? filteredProducts.map(p => p.id) : items)
              }
              selectable
              renderItem={(product) => (
                <ResourceItem
                  id={product.id}
                  onClick={() => {}}
                  accessibilityLabel={`Select ${product.title}`}
                  media={
                    <Thumbnail
                      source={product.imageUrl || 'https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg'}
                      alt={product.title}
                    />
                  }
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="bodyMd" fontWeight="semibold">
                          {product.title}
                        </Text>
                        {product.hasOrdered && (
                          <Badge tone="success">
                            {`Ordered ${product.orderCount}x`}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {product.sku || 'No SKU'} • ${product.price} • {product.inventoryQuantity} in stock
                        {product.hasOrdered && product.lastOrderDate && (
                          <> • Last ordered {new Date(product.lastOrderDate).toLocaleDateString()}</>
                        )}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      {product.isImported && (
                        <Badge tone="info">Already imported</Badge>
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
  );

  const renderSettingsStep = () => (
    <Layout.Section>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Sync Settings</Text>
            <Text as="p" tone="subdued">
              Choose which product fields to sync from your supplier. These settings will be applied to all selected products.
            </Text>

            <Divider />

            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Field-Level Sync</Text>

              <InlineStack gap="800" wrap>
                <Checkbox
                  label="Title"
                  helpText="Sync product titles"
                  checked={preferences.syncTitle}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncTitle: checked }))}
                />
                <Checkbox
                  label="Description"
                  helpText="Sync product descriptions"
                  checked={preferences.syncDescription}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncDescription: checked }))}
                />
                <Checkbox
                  label="Images"
                  helpText="Sync product images"
                  checked={preferences.syncImages}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncImages: checked }))}
                />
              </InlineStack>

              <InlineStack gap="800" wrap>
                <Checkbox
                  label="Inventory"
                  helpText="Keep inventory in sync"
                  checked={preferences.syncInventory}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncInventory: checked }))}
                />
                <Checkbox
                  label="Pricing"
                  helpText="Auto-update prices when supplier changes"
                  checked={preferences.syncPricing}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncPricing: checked }))}
                />
                <Checkbox
                  label="Tags"
                  helpText="Sync product tags"
                  checked={preferences.syncTags}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncTags: checked }))}
                />
              </InlineStack>

              <InlineStack gap="800" wrap>
                <Checkbox
                  label="SEO"
                  helpText="Sync SEO title and description"
                  checked={preferences.syncSEO}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncSEO: checked }))}
                />
                <Checkbox
                  label="Metafields"
                  helpText="Sync custom metafields"
                  checked={preferences.syncMetafields}
                  onChange={(checked) => setPreferences(p => ({ ...p, syncMetafields: checked }))}
                />
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">Pricing & Markup</Text>
            <Text as="p" tone="subdued">
              Set how your retail prices are calculated from the wholesale price.
            </Text>

            <InlineStack gap="400" wrap>
              <Box minWidth="200px">
                <Select
                  label="Markup Type"
                  options={[
                    { label: 'Percentage (%)', value: 'PERCENTAGE' },
                    { label: 'Fixed Amount ($)', value: 'FIXED_AMOUNT' },
                    { label: 'Custom Price', value: 'CUSTOM' },
                  ]}
                  value={preferences.markupType}
                  onChange={(value) => setPreferences(p => ({
                    ...p,
                    markupType: value as ImportPreferences['markupType']
                  }))}
                />
              </Box>
              <Box minWidth="150px">
                <TextField
                  label={preferences.markupType === 'PERCENTAGE' ? 'Markup %' : 'Amount $'}
                  type="number"
                  value={preferences.markupValue.toString()}
                  onChange={(value) => setPreferences(p => ({
                    ...p,
                    markupValue: parseFloat(value) || 0
                  }))}
                  autoComplete="off"
                />
              </Box>
            </InlineStack>

            <Banner tone="info">
              <p>
                Example: A product priced at $10.00 wholesale will be listed at{' '}
                <strong>
                  ${preferences.markupType === 'PERCENTAGE'
                    ? (10 * (1 + preferences.markupValue / 100)).toFixed(2)
                    : preferences.markupType === 'FIXED_AMOUNT'
                    ? (10 + preferences.markupValue).toFixed(2)
                    : preferences.markupValue.toFixed(2)
                  }
                </strong>
                {' '}in your store.
              </p>
            </Banner>
          </BlockStack>
        </Card>
      </BlockStack>
    </Layout.Section>
  );

  const renderPreviewStep = () => (
    <Layout.Section>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">Import Preview</Text>
          <Text as="p" tone="subdued">
            Review the changes before importing. These products will be created in your Shopify store.
          </Text>

          {loading ? (
            <BlockStack gap="400" inlineAlign="center">
              <Spinner size="large" />
              <Text as="p">Generating preview...</Text>
            </BlockStack>
          ) : preview ? (
            <>
              <InlineStack gap="400">
                <Badge tone="success">{`${preview.summary.newImports} new products`}</Badge>
                <Badge tone="attention">{`${preview.summary.updates} updates`}</Badge>
                <Badge>{`${preview.summary.total} total`}</Badge>
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                {preview.products.slice(0, 10).map((item) => (
                  <Box key={item.productId} padding="200" background="bg-surface-secondary" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="h4" variant="bodyMd" fontWeight="semibold">
                            {item.title}
                          </Text>
                          {item.isNew && <Badge tone="success">New</Badge>}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Wholesale: ${item.wholesalePrice} → Retail: ${item.calculatedRetailPrice}
                        </Text>
                      </BlockStack>
                      {item.changes.length > 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {item.changes.length} field{item.changes.length !== 1 ? 's' : ''} will update
                        </Text>
                      )}
                    </InlineStack>
                  </Box>
                ))}

                {preview.products.length > 10 && (
                  <Text as="p" tone="subdued" alignment="center">
                    ...and {preview.products.length - 10} more products
                  </Text>
                )}
              </BlockStack>
            </>
          ) : (
            <Banner tone="warning">
              <p>Failed to generate preview. Please try again.</p>
            </Banner>
          )}
        </BlockStack>
      </Card>
    </Layout.Section>
  );

  const renderImportingStep = () => (
    <Layout.Section>
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner size="large" />
          <Text as="h2" variant="headingMd">Importing Products...</Text>
          <Text as="p" tone="subdued">
            Please wait while we create your products in Shopify. This may take a few minutes for large catalogs.
          </Text>
          <Box width="100%" maxWidth="400px">
            <ProgressBar progress={50} size="small" />
          </Box>
        </BlockStack>
      </Card>
    </Layout.Section>
  );

  const renderCompleteStep = () => (
    <Layout.Section>
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Box padding="400" background="bg-fill-success" borderRadius="full">
            <Icon source={CheckIcon} tone="success" />
          </Box>
          <Text as="h2" variant="headingMd">Import Complete!</Text>

          {importResult && (
            <InlineStack gap="400">
              <Badge tone="success">{`${importResult.summary.success} imported`}</Badge>
              {importResult.summary.errors > 0 && (
                <Badge tone="critical">{`${importResult.summary.errors} failed`}</Badge>
              )}
            </InlineStack>
          )}

          <Text as="p" tone="subdued">
            Your products have been imported and are now available in your Shopify store.
          </Text>

          <InlineStack gap="200">
            <Button onClick={() => navigate('/catalog')}>
              View Catalog
            </Button>
            <Button variant="primary" onClick={() => {
              setCurrentStep('supplier');
              setSelectedProductIds([]);
              setPreview(null);
              setImportResult(null);
            }}>
              Import More Products
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Layout.Section>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'supplier':
        return renderSupplierStep();
      case 'products':
        return renderProductsStep();
      case 'settings':
        return renderSettingsStep();
      case 'preview':
        return renderPreviewStep();
      case 'importing':
        return renderImportingStep();
      case 'complete':
        return renderCompleteStep();
      default:
        return null;
    }
  };

  if (loading && currentStep === 'supplier') {
    return (
      <Page title="Import Products" backAction={{ content: 'Catalog', url: '/catalog' }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading suppliers...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Import Products"
      backAction={{ content: 'Catalog', url: '/catalog' }}
      subtitle={selectedSupplier ? `From ${selectedSupplier.name}` : undefined}
    >
      <Layout>
        {/* Progress indicator */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="p" variant="bodySm" tone="subdued">
                  Step {STEP_ORDER.indexOf(currentStep) + 1} of {STEP_ORDER.length}
                </Text>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {currentStep.charAt(0).toUpperCase() + currentStep.slice(1)}
                </Text>
              </InlineStack>
              <ProgressBar progress={stepProgress} size="small" />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Error banner */}
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Current step content */}
        {renderCurrentStep()}

        {/* Navigation buttons */}
        {currentStep !== 'importing' && currentStep !== 'complete' && (
          <Layout.Section>
            <InlineStack align="space-between">
              <Button
                onClick={handlePrevStep}
                disabled={currentStep === 'supplier'}
                icon={ChevronLeftIcon}
              >
                Back
              </Button>

              {currentStep === 'preview' ? (
                <Button
                  variant="primary"
                  onClick={executeImport}
                  disabled={!canProceed}
                >
                  {`Import ${selectedProductIds.length} Products`}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleNextStep}
                  disabled={!canProceed}
                  icon={ChevronRightIcon}
                >
                  Continue
                </Button>
              )}
            </InlineStack>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
