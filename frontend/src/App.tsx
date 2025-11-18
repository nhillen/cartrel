import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
} from '@shopify/polaris';
import { useSessionToken } from './hooks/useSessionToken';
import { useShopParams } from './hooks/useShopParams';

const DOCS_BASE = 'https://github.com/nhillen/cartrel/blob/main';

const supplierSteps = [
  {
    title: 'Enable wholesale products',
    description: 'From the Catalog tab, mark SKUs as wholesale ready and set sync preferences.',
    href: `${DOCS_BASE}/HOW_TO_GUIDES.md#2-how-to-mark-products-as-wholesale-supplier`,
  },
  {
    title: 'Send connection invites',
    description: 'Share 12-digit invite codes with retailers and attach payment terms.',
    href: `${DOCS_BASE}/HOW_TO_GUIDES.md#1-how-to-create-a-connection-invite-supplier`,
  },
  {
    title: 'Watch inventory + orders',
    description: 'Use the Orders table plus the public status page to confirm webhook health.',
    href: `${DOCS_BASE}/HOW_TO_GUIDES.md#5-how-to-manage-order-fulfillment-supplier`,
  },
];

const retailerSteps = [
  {
    title: 'Accept invites & import selectively',
    description: 'Preview diffs, choose markup rules, and keep non-wholesale variants untouched.',
    href: `${DOCS_BASE}/HOW_TO_GUIDES.md#7-how-to-import-products-with-preview-retailer`,
  },
  {
    title: 'Test with Shadow Mode',
    description: 'Run Cartrel alongside Syncio without touching live products.',
    href: `${DOCS_BASE}/HOW_TO_GUIDES.md#12-how-to-migrate-from-syncio-shadow-mode`,
  },
  {
    title: 'Submit clean purchase orders',
    description: 'Create POs that forward to supplier draft orders within five seconds.',
    href: `${DOCS_BASE}/HOW_TO_GUIDES.md#11-how-to-submit-purchase-orders-retailer`,
  },
];

const resources = [
  {
    title: 'Deployment · Zero downtime checklist',
    description: 'Blue/green steps, rollback drills, and DB backup strategy.',
    href: `${DOCS_BASE}/DEPLOYMENT.md`,
  },
  {
    title: 'Design decisions',
    description: 'Why we chose infrastructure-only, Shopify-only, and the queue architecture.',
    href: `${DOCS_BASE}/DECISIONS.md`,
  },
  {
    title: 'Feature matrix',
    description: 'Every phase, status, and API endpoint with roadmap callouts.',
    href: `${DOCS_BASE}/FEATURES.md`,
  },
];

const externalTools = [
  { label: 'Status page', href: '/status' },
  { label: 'Queue monitor (dev)', href: '/admin/queues' },
  { label: 'Health API', href: '/status/api/status' },
];

export default function App() {
  const { shop } = useShopParams();
  const sessionToken = useSessionToken();

  return (
    <Page title="Cartrel Control Center" subtitle={shop ? `Connected as ${shop}` : undefined}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <div>
                  <Text as="h2" variant="headingLg">
                    Session health
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Tokens refresh automatically every 45 seconds while this tab stays open.
                  </Text>
                </div>
                <Badge tone={sessionToken ? 'success' : 'critical'}>
                  {sessionToken ? 'Active' : 'Waiting for token'}
                </Badge>
              </InlineStack>
              <Divider />
              <InlineStack gap="200" align="start">
                {externalTools.map(tool => (
                  <Button key={tool.label} url={tool.href} target="_blank">
                    {tool.label}
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Supplier checklist
                </Text>
                <Badge tone="info">Infrastructure-first</Badge>
              </InlineStack>
              {supplierSteps.map(step => (
                <BlockStack key={step.title} gap="100">
                  <Text as="h3" variant="headingMd">
                    {step.title}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {step.description}{' '}
                    <Link url={step.href} target="_blank">
                      View guide
                    </Link>
                  </Text>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Retailer checklist
                </Text>
                <Badge tone="success">Retailers stay free</Badge>
              </InlineStack>
              {retailerSteps.map(step => (
                <BlockStack key={step.title} gap="100">
                  <Text as="h3" variant="headingMd">
                    {step.title}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {step.description}{' '}
                    <Link url={step.href} target="_blank">
                      View guide
                    </Link>
                  </Text>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingLg">
                Documentation & playbooks
              </Text>
              <BlockStack gap="200">
                {resources.map(resource => (
                  <Box
                    key={resource.title}
                    background="bg-surface-secondary"
                    borderRadius="300"
                    padding={{ xs: '400', md: '500' }}
                  >
                    <BlockStack gap="150">
                      <div>
                        <Text as="h3" variant="headingMd">
                          {resource.title}
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {resource.description}
                        </Text>
                      </div>
                      <Button url={resource.href} target="_blank">
                        Open
                      </Button>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                Need a hand?
              </Text>
              <Text as="p" variant="bodyMd">
                Ping <Link url="mailto:hello@cartrel.com">hello@cartrel.com</Link> or drop a note in Slack. Attach the UAT test case
                or incident ID so we can trace it quickly.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
