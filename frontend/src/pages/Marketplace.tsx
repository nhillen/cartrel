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
  TextField,
  FormLayout,
  Select,
  Modal,
  Avatar,
  ResourceList,
  ResourceItem,
  Divider,
  Box,
} from '@shopify/polaris';
import { api } from '../lib/api';
import type {
  PartnerProfile,
  BrowseProfilesResponse,
  MarketplaceInvitesResponse,
  MarketplaceInvite,
} from '../lib/api';

type TabId = 'browse' | 'profile' | 'invites';

const CATEGORIES = [
  { label: 'All Categories', value: '' },
  { label: 'Apparel & Fashion', value: 'Apparel' },
  { label: 'Home & Garden', value: 'Home' },
  { label: 'Electronics', value: 'Electronics' },
  { label: 'Beauty & Health', value: 'Beauty' },
  { label: 'Food & Beverage', value: 'Food' },
  { label: 'Sports & Outdoors', value: 'Sports' },
  { label: 'Toys & Games', value: 'Toys' },
  { label: 'Other', value: 'Other' },
];

export function Marketplace() {
  const [selectedTab, setSelectedTab] = useState<TabId>('browse');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile state
  const [myProfile, setMyProfile] = useState<PartnerProfile | null>(null);
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    description: '',
    website: '',
    location: '',
    country: '',
    category: '',
    visibility: 'PRIVATE',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Browse state
  const [profiles, setProfiles] = useState<PartnerProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [browsing, setBrowsing] = useState(false);

  // Invites state
  const [invites, setInvites] = useState<MarketplaceInvitesResponse>({ sent: [], received: [] });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<PartnerProfile | null>(null);
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [profileData, invitesData] = await Promise.all([
        api.get<PartnerProfile | null>('/api/marketplace/profile'),
        api.get<MarketplaceInvitesResponse>('/api/marketplace/invites'),
      ]);
      setMyProfile(profileData);
      if (profileData) {
        setProfileForm({
          displayName: profileData.displayName || '',
          description: profileData.description || '',
          website: profileData.website || '',
          location: profileData.location || '',
          country: profileData.country || '',
          category: profileData.category || '',
          visibility: profileData.visibility || 'PRIVATE',
        });
      }
      setInvites(invitesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace data');
    } finally {
      setLoading(false);
    }
  }

  const handleBrowse = useCallback(async () => {
    try {
      setBrowsing(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter) params.set('category', categoryFilter);
      const data = await api.get<BrowseProfilesResponse>(
        `/api/marketplace/browse?${params.toString()}`
      );
      setProfiles(data.profiles);
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to search',
        { isError: true }
      );
    } finally {
      setBrowsing(false);
    }
  }, [searchQuery, categoryFilter]);

  useEffect(() => {
    if (selectedTab === 'browse') {
      handleBrowse();
    }
  }, [selectedTab, handleBrowse]);

  const handleSaveProfile = useCallback(async () => {
    if (!profileForm.displayName.trim()) {
      window.shopify?.toast.show('Display name is required', { isError: true });
      return;
    }

    try {
      setSavingProfile(true);
      const saved = await api.post<PartnerProfile>('/api/marketplace/profile', profileForm);
      setMyProfile(saved);
      window.shopify?.toast.show('Profile saved successfully');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to save profile',
        { isError: true }
      );
    } finally {
      setSavingProfile(false);
    }
  }, [profileForm]);

  const handleSendInvite = useCallback(async () => {
    if (!selectedProfile) return;

    try {
      setSendingInvite(true);
      await api.post('/api/marketplace/invites', {
        recipientProfileId: selectedProfile.id,
        message: inviteMessage,
      });
      setShowInviteModal(false);
      setSelectedProfile(null);
      setInviteMessage('');
      await loadData();
      window.shopify?.toast.show('Invite sent successfully');
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to send invite',
        { isError: true }
      );
    } finally {
      setSendingInvite(false);
    }
  }, [selectedProfile, inviteMessage]);

  const handleRespondToInvite = useCallback(async (invite: MarketplaceInvite, action: 'accept' | 'decline') => {
    try {
      await api.patch(`/api/marketplace/invites/${invite.id}`, { action });
      await loadData();
      window.shopify?.toast.show(
        action === 'accept' ? 'Invite accepted! Check your connections.' : 'Invite declined'
      );
    } catch (err) {
      window.shopify?.toast.show(
        err instanceof Error ? err.message : 'Failed to respond to invite',
        { isError: true }
      );
    }
  }, []);

  const openInviteModal = useCallback((profile: PartnerProfile) => {
    setSelectedProfile(profile);
    setInviteMessage('');
    setShowInviteModal(true);
  }, []);

  if (loading) {
    return (
      <Page title="Partner Network">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p">Loading marketplace...</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const pendingReceivedCount = invites.received.filter((i) => i.status === 'PENDING').length;

  return (
    <Page
      title="Partner Network"
      subtitle="Discover suppliers and retailers to connect with"
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
                variant={selectedTab === 'browse' ? 'primary' : 'tertiary'}
                onClick={() => setSelectedTab('browse')}
              >
                Browse Partners
              </Button>
              <Button
                variant={selectedTab === 'profile' ? 'primary' : 'tertiary'}
                onClick={() => setSelectedTab('profile')}
              >
                {`My Profile ${myProfile ? '' : '(Not Set)'}`}
              </Button>
              <Button
                variant={selectedTab === 'invites' ? 'primary' : 'tertiary'}
                onClick={() => setSelectedTab('invites')}
              >
                {`Invites ${pendingReceivedCount > 0 ? `(${pendingReceivedCount})` : ''}`}
              </Button>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Tab Content */}
        <Layout.Section>
          {selectedTab === 'browse' && (
            <BlockStack gap="400">
              {/* Search */}
              <Card>
                <InlineStack gap="400" blockAlign="end">
                  <Box minWidth="200px">
                    <TextField
                      label="Search"
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="Search by name or location..."
                      autoComplete="off"
                    />
                  </Box>
                  <Box minWidth="200px">
                    <Select
                      label="Category"
                      options={CATEGORIES}
                      value={categoryFilter}
                      onChange={setCategoryFilter}
                    />
                  </Box>
                  <Button onClick={handleBrowse} loading={browsing}>
                    Search
                  </Button>
                </InlineStack>
              </Card>

              {/* Results */}
              <Card>
                {profiles.length === 0 ? (
                  <BlockStack gap="400" inlineAlign="center">
                    <Text as="p" tone="subdued">
                      {browsing ? 'Searching...' : 'No partners found. Try different filters.'}
                    </Text>
                  </BlockStack>
                ) : (
                  <ResourceList
                    resourceName={{ singular: 'partner', plural: 'partners' }}
                    items={profiles}
                    renderItem={(profile) => (
                      <ResourceItem
                        id={profile.id}
                        onClick={() => {}}
                        accessibilityLabel={`View ${profile.displayName}`}
                        media={
                          <Avatar
                            customer
                            size="lg"
                            name={profile.displayName}
                            source={profile.logoUrl || undefined}
                          />
                        }
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="bodyMd" fontWeight="semibold">
                                {profile.displayName}
                              </Text>
                              {profile.verified && <Badge tone="success">Verified</Badge>}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {[profile.category, profile.location].filter(Boolean).join(' • ') ||
                                'No details'}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {profile.productCount} products • {profile.connectionCount} connections
                            </Text>
                          </BlockStack>
                          <Button onClick={() => openInviteModal(profile)}>
                            Send Invite
                          </Button>
                        </InlineStack>
                      </ResourceItem>
                    )}
                  />
                )}
              </Card>
            </BlockStack>
          )}

          {selectedTab === 'profile' && (
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Your Partner Profile
                </Text>
                <Text as="p" tone="subdued">
                  Create a profile to be discoverable by other suppliers and retailers.
                </Text>
                <Divider />
                <FormLayout>
                  <TextField
                    label="Display Name"
                    value={profileForm.displayName}
                    onChange={(v) => setProfileForm((p) => ({ ...p, displayName: v }))}
                    autoComplete="off"
                    helpText="Your business name as shown to other partners"
                  />
                  <TextField
                    label="Description"
                    value={profileForm.description}
                    onChange={(v) => setProfileForm((p) => ({ ...p, description: v }))}
                    autoComplete="off"
                    multiline={3}
                    helpText="Tell potential partners about your business"
                  />
                  <InlineStack gap="400">
                    <Box minWidth="200px">
                      <Select
                        label="Category"
                        options={CATEGORIES}
                        value={profileForm.category}
                        onChange={(v) => setProfileForm((p) => ({ ...p, category: v }))}
                      />
                    </Box>
                    <Box minWidth="200px">
                      <TextField
                        label="Location"
                        value={profileForm.location}
                        onChange={(v) => setProfileForm((p) => ({ ...p, location: v }))}
                        autoComplete="off"
                        placeholder="City, State"
                      />
                    </Box>
                  </InlineStack>
                  <TextField
                    label="Website"
                    value={profileForm.website}
                    onChange={(v) => setProfileForm((p) => ({ ...p, website: v }))}
                    autoComplete="off"
                    placeholder="https://..."
                  />
                  <Select
                    label="Visibility"
                    options={[
                      { label: 'Private - Only you can see', value: 'PRIVATE' },
                      { label: 'Public - Visible to all partners', value: 'PUBLIC' },
                      { label: 'Connections Only - Visible to connected partners', value: 'CONNECTIONS_ONLY' },
                    ]}
                    value={profileForm.visibility}
                    onChange={(v) => setProfileForm((p) => ({ ...p, visibility: v }))}
                    helpText="Control who can see your profile in the marketplace"
                  />
                </FormLayout>
                <InlineStack align="end">
                  <Button variant="primary" onClick={handleSaveProfile} loading={savingProfile}>
                    Save Profile
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          )}

          {selectedTab === 'invites' && (
            <BlockStack gap="400">
              {/* Received Invites */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Received Invites
                  </Text>
                  {invites.received.length === 0 ? (
                    <Text as="p" tone="subdued">
                      No invites received yet.
                    </Text>
                  ) : (
                    <ResourceList
                      resourceName={{ singular: 'invite', plural: 'invites' }}
                      items={invites.received}
                      renderItem={(invite) => (
                        <ResourceItem
                          id={invite.id}
                          onClick={() => {}}
                          accessibilityLabel={`Invite from ${invite.senderProfile?.displayName}`}
                          media={
                            <Avatar
                              customer
                              size="md"
                              name={invite.senderProfile?.displayName || 'Unknown'}
                              source={invite.senderProfile?.logoUrl || undefined}
                            />
                          }
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="h3" variant="bodyMd" fontWeight="semibold">
                                {invite.senderProfile?.displayName || 'Unknown Partner'}
                              </Text>
                              {invite.message && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  "{invite.message}"
                                </Text>
                              )}
                              <Text as="p" variant="bodySm" tone="subdued">
                                {new Date(invite.createdAt).toLocaleDateString()}
                              </Text>
                            </BlockStack>
                            <InlineStack gap="200">
                              {invite.status === 'PENDING' ? (
                                <>
                                  <Button
                                    onClick={() => handleRespondToInvite(invite, 'accept')}
                                    variant="primary"
                                  >
                                    Accept
                                  </Button>
                                  <Button
                                    onClick={() => handleRespondToInvite(invite, 'decline')}
                                  >
                                    Decline
                                  </Button>
                                </>
                              ) : (
                                <Badge
                                  tone={
                                    invite.status === 'ACCEPTED'
                                      ? 'success'
                                      : invite.status === 'DECLINED'
                                        ? 'critical'
                                        : 'attention'
                                  }
                                >
                                  {invite.status}
                                </Badge>
                              )}
                            </InlineStack>
                          </InlineStack>
                        </ResourceItem>
                      )}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Sent Invites */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Sent Invites
                  </Text>
                  {invites.sent.length === 0 ? (
                    <Text as="p" tone="subdued">
                      You haven't sent any invites yet. Browse partners to get started.
                    </Text>
                  ) : (
                    <ResourceList
                      resourceName={{ singular: 'invite', plural: 'invites' }}
                      items={invites.sent}
                      renderItem={(invite) => (
                        <ResourceItem
                          id={invite.id}
                          onClick={() => {}}
                          accessibilityLabel={`Invite to ${invite.recipientProfile?.displayName}`}
                          media={
                            <Avatar
                              customer
                              size="md"
                              name={invite.recipientProfile?.displayName || 'Unknown'}
                              source={invite.recipientProfile?.logoUrl || undefined}
                            />
                          }
                        >
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                              <Text as="h3" variant="bodyMd" fontWeight="semibold">
                                {invite.recipientProfile?.displayName || 'Unknown Partner'}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Sent {new Date(invite.createdAt).toLocaleDateString()}
                              </Text>
                            </BlockStack>
                            <Badge
                              tone={
                                invite.status === 'ACCEPTED'
                                  ? 'success'
                                  : invite.status === 'DECLINED'
                                    ? 'critical'
                                    : invite.status === 'PENDING'
                                      ? 'attention'
                                      : 'warning'
                              }
                            >
                              {invite.status}
                            </Badge>
                          </InlineStack>
                        </ResourceItem>
                      )}
                    />
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>

      {/* Send Invite Modal */}
      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title={`Invite ${selectedProfile?.displayName || 'Partner'}`}
        primaryAction={{
          content: 'Send Invite',
          onAction: handleSendInvite,
          loading: sendingInvite,
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
              Send an invite to connect with {selectedProfile?.displayName}. If they accept,
              you'll be able to establish a connection for syncing products.
            </Text>
            <TextField
              label="Message (optional)"
              value={inviteMessage}
              onChange={setInviteMessage}
              autoComplete="off"
              multiline={3}
              placeholder="Introduce yourself and explain why you'd like to connect..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
