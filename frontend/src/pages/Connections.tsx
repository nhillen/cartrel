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
  Avatar,
  Modal,
  TextField,
  FormLayout,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type { Connection, Invite } from '../lib/api';

type TabId = 'connections' | 'invites';

export function Connections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<TabId>('connections');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [connectionsData, invitesData] = await Promise.all([
        api.get<Connection[]>('/api/connections'),
        api.get<Invite[]>('/api/connections/invites'),
      ]);
      setConnections(connectionsData);
      setInvites(invitesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  }

  const handleCreateInvite = useCallback(async () => {
    try {
      setCreating(true);
      await api.post('/api/connections/invites');
      await loadData();
      setShowInviteModal(false);
      window.shopify?.toast.show('Invite created successfully');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to create invite',
        { isError: true }
      );
    } finally {
      setCreating(false);
    }
  }, []);

  const handleAcceptInvite = useCallback(async () => {
    if (!inviteCode.trim()) return;

    try {
      setCreating(true);
      await api.post('/api/connections/accept', { code: inviteCode });
      await loadData();
      setShowAcceptModal(false);
      setInviteCode('');
      window.shopify?.toast.show('Connection established successfully');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Invalid invite code',
        { isError: true }
      );
    } finally {
      setCreating(false);
    }
  }, [inviteCode]);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge tone="success">Active</Badge>;
      case 'PENDING':
        return <Badge tone="attention">Pending</Badge>;
      case 'PAUSED':
        return <Badge tone="warning">Paused</Badge>;
      case 'TERMINATED':
        return <Badge tone="critical">Terminated</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <Page title="Connections">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading connections...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Connections"
      subtitle="Manage your supplier and retailer connections"
      primaryAction={{
        content: 'Create Invite',
        onAction: () => setShowInviteModal(true),
      }}
      secondaryActions={[
        {
          content: 'Accept Invite',
          onAction: () => setShowAcceptModal(true),
        },
      ]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Error" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Tabs */}
        <Layout.Section>
          <Card padding="0">
            <InlineStack gap="0">
              <Button
                variant={selectedTab === 'connections' ? 'primary' : 'tertiary'}
                onClick={() => setSelectedTab('connections')}
              >
                {`Connections (${connections.length})`}
              </Button>
              <Button
                variant={selectedTab === 'invites' ? 'primary' : 'tertiary'}
                onClick={() => setSelectedTab('invites')}
              >
                {`Pending Invites (${invites.filter((i) => i.status === 'PENDING').length})`}
              </Button>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Content */}
        <Layout.Section>
          {selectedTab === 'connections' ? (
            <Card>
              {connections.length === 0 ? (
                <BlockStack gap="400" inlineAlign="center">
                  <Text as="p" tone="subdued">
                    No connections yet
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={() => setShowInviteModal(true)}>
                      Create invite (as supplier)
                    </Button>
                    <Button onClick={() => setShowAcceptModal(true)}>
                      Accept invite (as retailer)
                    </Button>
                  </InlineStack>
                </BlockStack>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'connection', plural: 'connections' }}
                  items={connections}
                  renderItem={(connection) => (
                    <ResourceItem
                      id={connection.id}
                      url={`/connections/${connection.id}`}
                      accessibilityLabel={`View ${connection.supplierShop.name}`}
                      media={
                        <Avatar
                          customer
                          size="md"
                          name={connection.supplierShop.name}
                        />
                      }
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {connection.supplierShop.name} ↔ {connection.retailerShop.name}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {connection.syncMode} • {connection.tier}
                          </Text>
                        </BlockStack>
                        {statusBadge(connection.status)}
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </Card>
          ) : (
            <Card>
              {invites.length === 0 ? (
                <BlockStack gap="400" inlineAlign="center">
                  <Text as="p" tone="subdued">
                    No pending invites
                  </Text>
                  <Button onClick={() => setShowInviteModal(true)}>Create invite</Button>
                </BlockStack>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'invite', plural: 'invites' }}
                  items={invites}
                  renderItem={(invite) => (
                    <ResourceItem
                      id={invite.id}
                      accessibilityLabel={`Invite ${invite.code}`}
                      onClick={() => {}}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="semibold">
                            {invite.code}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                          </Text>
                        </BlockStack>
                        {statusBadge(invite.status)}
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </Card>
          )}
        </Layout.Section>
      </Layout>

      {/* Create Invite Modal */}
      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Create Connection Invite"
        primaryAction={{
          content: 'Create Invite',
          onAction: handleCreateInvite,
          loading: creating,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowInviteModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Create an invite code to share with a retailer. They'll use this code to
              establish a connection with your store.
            </Text>
            <Text as="p" tone="subdued">
              Invite codes expire after 7 days if not accepted.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Accept Invite Modal */}
      <Modal
        open={showAcceptModal}
        onClose={() => setShowAcceptModal(false)}
        title="Accept Connection Invite"
        primaryAction={{
          content: 'Accept Invite',
          onAction: handleAcceptInvite,
          loading: creating,
          disabled: !inviteCode.trim(),
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setShowAcceptModal(false);
              setInviteCode('');
            },
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Invite Code"
              value={inviteCode}
              onChange={setInviteCode}
              autoComplete="off"
              placeholder="Enter 12-digit code"
              helpText="Get this code from your supplier"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
