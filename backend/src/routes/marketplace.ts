import { Router } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../index';

const router = Router();

// =============================================================================
// MY PROFILE
// =============================================================================

// Get my marketplace profile
router.get('/profile', async (req, res, next) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
      include: {
        partnerProfile: true,
      },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    res.json(shopRecord.partnerProfile || null);
  } catch (error) {
    logger.error('Error getting marketplace profile:', error);
    next(error);
  }
});

// Create or update my marketplace profile
router.post('/profile', async (req, res, next) => {
  try {
    const { shop } = req.query;
    const {
      displayName,
      description,
      website,
      socialLinks,
      location,
      country,
      category,
      logoUrl,
      coverImageUrl,
      galleryImages,
      visibility,
      allowReshare,
      reshareScope,
      reshareMaxDests,
    } = req.body;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    if (!displayName) {
      res.status(400).json({ error: 'Display name is required' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    // Generate slug from display name
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Count products for stats
    const productCount = await prisma.supplierProduct.count({
      where: {
        supplierShopId: shopRecord.id,
        isWholesaleEligible: true,
      },
    });

    // Count connections for stats
    const connectionCount = await prisma.connection.count({
      where: {
        OR: [
          { supplierShopId: shopRecord.id, status: 'ACTIVE' },
          { retailerShopId: shopRecord.id, status: 'ACTIVE' },
        ],
      },
    });

    const profile = await prisma.partnerProfile.upsert({
      where: { shopId: shopRecord.id },
      create: {
        shopId: shopRecord.id,
        displayName,
        slug,
        description,
        website,
        socialLinks,
        location,
        country,
        category,
        logoUrl,
        coverImageUrl,
        galleryImages,
        visibility: visibility || 'PRIVATE',
        allowReshare: allowReshare || false,
        reshareScope,
        reshareMaxDests: reshareMaxDests || 0,
        productCount,
        connectionCount,
      },
      update: {
        displayName,
        slug,
        description,
        website,
        socialLinks,
        location,
        country,
        category,
        logoUrl,
        coverImageUrl,
        galleryImages,
        visibility,
        allowReshare,
        reshareScope,
        reshareMaxDests,
        productCount,
        connectionCount,
      },
    });

    logger.info(`Marketplace profile saved for shop: ${shop}`);
    res.json(profile);
  } catch (error) {
    logger.error('Error saving marketplace profile:', error);
    next(error);
  }
});

// =============================================================================
// BROWSE PROFILES
// =============================================================================

// Browse public marketplace profiles
router.get('/browse', async (req, res, next) => {
  try {
    const { shop, search, category, country, cursor, limit = '20' } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const take = Math.min(parseInt(limit as string) || 20, 50);

    const profiles = await prisma.partnerProfile.findMany({
      where: {
        visibility: 'PUBLIC',
        shopId: { not: shopRecord.id }, // Don't show own profile
        flagged: false,
        ...(search && typeof search === 'string'
          ? {
              OR: [
                { displayName: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { location: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(category && typeof category === 'string' ? { category } : {}),
        ...(country && typeof country === 'string' ? { country } : {}),
      },
      orderBy: [{ featuredOrder: 'asc' }, { verified: 'desc' }, { productCount: 'desc' }],
      take: take + 1, // Get one extra to check if there's more
      ...(cursor && typeof cursor === 'string' ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        displayName: true,
        slug: true,
        description: true,
        location: true,
        country: true,
        category: true,
        logoUrl: true,
        coverImageUrl: true,
        verified: true,
        productCount: true,
        connectionCount: true,
        shop: {
          select: {
            role: true,
          },
        },
      },
    });

    const hasMore = profiles.length > take;
    const results = hasMore ? profiles.slice(0, -1) : profiles;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    res.json({
      profiles: results,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    logger.error('Error browsing marketplace:', error);
    next(error);
  }
});

// Get a specific profile by ID
router.get('/profiles/:id', async (req, res, next) => {
  try {
    const { shop } = req.query;
    const { id } = req.params;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const profile = await prisma.partnerProfile.findUnique({
      where: { id },
      include: {
        shop: {
          select: {
            id: true,
            role: true,
            myshopifyDomain: true,
          },
        },
      },
    });

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Check visibility
    if (profile.visibility === 'PRIVATE') {
      const shopRecord = await prisma.shop.findUnique({
        where: { myshopifyDomain: shop },
      });
      if (!shopRecord || profile.shopId !== shopRecord.id) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
    }

    res.json(profile);
  } catch (error) {
    logger.error('Error getting profile:', error);
    next(error);
  }
});

// =============================================================================
// INVITES
// =============================================================================

// Send a marketplace invite
router.post('/invites', async (req, res, next) => {
  try {
    const { shop } = req.query;
    const { recipientProfileId, message, suggestedSyncMode } = req.body;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    if (!recipientProfileId) {
      res.status(400).json({ error: 'Recipient profile ID is required' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
      include: { partnerProfile: true },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    if (!shopRecord.partnerProfile) {
      res.status(400).json({ error: 'You must create a profile before sending invites' });
      return;
    }

    // Check if recipient exists
    const recipientProfile = await prisma.partnerProfile.findUnique({
      where: { id: recipientProfileId },
    });

    if (!recipientProfile) {
      res.status(404).json({ error: 'Recipient profile not found' });
      return;
    }

    // Check for existing pending invite
    const existingInvite = await prisma.marketplaceInvite.findFirst({
      where: {
        senderProfileId: shopRecord.partnerProfile.id,
        recipientProfileId,
        status: 'PENDING',
      },
    });

    if (existingInvite) {
      res.status(400).json({ error: 'You already have a pending invite to this partner' });
      return;
    }

    // Create invite (expires in 30 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const invite = await prisma.marketplaceInvite.create({
      data: {
        senderProfileId: shopRecord.partnerProfile.id,
        recipientProfileId,
        message,
        suggestedSyncMode,
        expiresAt,
      },
      include: {
        recipientProfile: {
          select: {
            displayName: true,
            logoUrl: true,
          },
        },
      },
    });

    logger.info(`Marketplace invite sent from ${shop} to profile ${recipientProfileId}`);
    res.json(invite);
  } catch (error) {
    logger.error('Error sending invite:', error);
    next(error);
  }
});

// Get my invites (sent and received)
router.get('/invites', async (req, res, next) => {
  try {
    const { shop, type = 'all' } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
      include: { partnerProfile: true },
    });

    if (!shopRecord) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    if (!shopRecord.partnerProfile) {
      res.json({ sent: [], received: [] });
      return;
    }

    const profileId = shopRecord.partnerProfile.id;

    const [sent, received] = await Promise.all([
      type === 'received'
        ? []
        : prisma.marketplaceInvite.findMany({
            where: { senderProfileId: profileId },
            include: {
              recipientProfile: {
                select: {
                  id: true,
                  displayName: true,
                  logoUrl: true,
                  category: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
      type === 'sent'
        ? []
        : prisma.marketplaceInvite.findMany({
            where: { recipientProfileId: profileId },
            include: {
              senderProfile: {
                select: {
                  id: true,
                  displayName: true,
                  logoUrl: true,
                  category: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
    ]);

    res.json({ sent, received });
  } catch (error) {
    logger.error('Error getting invites:', error);
    next(error);
  }
});

// Respond to an invite (accept/decline)
router.patch('/invites/:id', async (req, res, next) => {
  try {
    const { shop } = req.query;
    const { id } = req.params;
    const { action } = req.body; // 'accept' or 'decline'

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({ error: 'Missing shop parameter' });
      return;
    }

    if (!['accept', 'decline'].includes(action)) {
      res.status(400).json({ error: 'Action must be accept or decline' });
      return;
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { myshopifyDomain: shop },
      include: { partnerProfile: true },
    });

    if (!shopRecord || !shopRecord.partnerProfile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const invite = await prisma.marketplaceInvite.findUnique({
      where: { id },
      include: {
        senderProfile: {
          include: { shop: true },
        },
      },
    });

    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    // Verify this invite is for us
    if (invite.recipientProfileId !== shopRecord.partnerProfile.id) {
      res.status(403).json({ error: 'This invite is not for you' });
      return;
    }

    if (invite.status !== 'PENDING') {
      res.status(400).json({ error: `Invite already ${invite.status.toLowerCase()}` });
      return;
    }

    // Update invite status
    const updatedInvite = await prisma.marketplaceInvite.update({
      where: { id },
      data: {
        status: action === 'accept' ? 'ACCEPTED' : 'DECLINED',
        respondedAt: new Date(),
      },
    });

    // If accepted, create a connection invite code for them to use
    let connectionInvite = null;
    if (action === 'accept' && invite.senderProfile.shop) {
      // Create a connection invite from the sender's shop
      connectionInvite = await prisma.connectionInvite.create({
        data: {
          supplierShopId: invite.senderProfile.shop.id,
          code:
            Math.random().toString(36).substring(2, 8).toUpperCase() +
            Math.random().toString(36).substring(2, 8).toUpperCase(),
          nickname: `Marketplace: ${shopRecord.partnerProfile?.displayName || shop}`,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });
    }

    logger.info(`Marketplace invite ${id} ${action}ed by ${shop}`);
    res.json({
      invite: updatedInvite,
      connectionInvite: connectionInvite
        ? { code: connectionInvite.code, expiresAt: connectionInvite.expiresAt }
        : null,
    });
  } catch (error) {
    logger.error('Error responding to invite:', error);
    next(error);
  }
});

// =============================================================================
// CATEGORIES (for filtering)
// =============================================================================

router.get('/categories', async (_req, res, next) => {
  try {
    const categories = await prisma.partnerProfile.groupBy({
      by: ['category'],
      where: {
        visibility: 'PUBLIC',
        category: { not: null },
      },
      _count: true,
      orderBy: { _count: { category: 'desc' } },
    });

    res.json(
      categories
        .filter((c) => c.category)
        .map((c) => ({
          name: c.category,
          count: c._count,
        }))
    );
  } catch (error) {
    logger.error('Error getting categories:', error);
    next(error);
  }
});

export default router;
