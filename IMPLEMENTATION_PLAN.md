# Cartrel - Implementation Plan

Quick reference for building Cartrel in phases.

## Pre-Development Checklist

- [ ] Review and approve [DESIGN.md](./DESIGN.md)
- [ ] Set up Shopify Partner account
- [ ] Create development store(s) for testing
- [ ] Choose hosting provider (Railway, Render, etc.)
- [ ] Set up PostgreSQL database
- [ ] Set up Redis instance
- [ ] Configure domain (cartrel.com)
- [ ] Set up GitHub repo with proper .gitignore

---

## Phase 0: Foundation (Week 1-2)

**Goal**: Basic app that can be installed and shows an empty dashboard

### Backend Setup
- [ ] Initialize Node.js + TypeScript project
- [ ] Set up Prisma with PostgreSQL
- [ ] Run `prisma migrate dev` with schema.prisma
- [ ] Set up Express/Fastify server
- [ ] Configure environment variables (.env.example)
- [ ] Set up Redis connection for queues

### Shopify OAuth
- [ ] Create Shopify app in Partner Dashboard
- [ ] Implement OAuth flow
  - [ ] `/auth/shopify` - initiate
  - [ ] `/auth/shopify/callback` - handle redirect
  - [ ] Store shop + access token in database
- [ ] Implement session token verification
- [ ] Test: Can install app and see it in Shopify admin

### Frontend Shell
- [ ] Set up React project
- [ ] Install Shopify App Bridge + Polaris
- [ ] Create basic layout with left nav
- [ ] Implement role detection (supplier vs retailer)
- [ ] Create empty dashboard pages

### Deploy
- [ ] Deploy to staging environment
- [ ] Test full OAuth flow in real Shopify store
- [ ] Set up CI/CD pipeline

**Acceptance Criteria:**
- ✅ App appears in Shopify admin after install
- ✅ Can authenticate and see empty dashboard
- ✅ Role (supplier/retailer) detected correctly

---

## Phase 1: Supplier Core (Week 3-4)

**Goal**: Supplier can set up wholesale catalog and invite retailers

### Product Sync
- [ ] Implement Shopify Admin API client
- [ ] Fetch products from Shopify
  - [ ] Use GraphQL or REST API
  - [ ] Handle pagination
- [ ] Display products in "Wholesale Catalog" page
- [ ] Implement "Mark as Wholesale" toggle
  - [ ] Save to SupplierProduct table
  - [ ] Set wholesale price
  - [ ] Set minimum quantity

### Webhooks
- [ ] Register webhooks on app install:
  - [ ] products/create
  - [ ] products/update
  - [ ] products/delete
  - [ ] inventory_levels/update
  - [ ] app/uninstalled
- [ ] Implement webhook endpoints with verification
- [ ] Set up Bull queue for webhook processing
- [ ] Handle webhook events:
  - [ ] Update SupplierProduct cache
  - [ ] Log to WebhookLog table

### Invitation System
- [ ] Create "Retailers" page
- [ ] Implement "Invite Retailer" form
  - [ ] Email input
  - [ ] Optional custom terms
- [ ] Generate unique invite token
- [ ] Create Connection record (status: PENDING_INVITE)
- [ ] Send invite email (use Resend, SendGrid, or similar)
- [ ] Generate shareable invite link

### UI
- [ ] Wholesale Catalog table/grid
  - [ ] Product image, title, SKU, variants
  - [ ] Toggle wholesale eligible
  - [ ] Edit wholesale price inline
  - [ ] Bulk actions
- [ ] Retailers list page
  - [ ] Show pending invites
  - [ ] Show accepted connections
  - [ ] Status badges

**Acceptance Criteria:**
- ✅ Supplier can see all their Shopify products
- ✅ Can mark products as wholesale with pricing
- ✅ Can generate and send invite links
- ✅ Product cache updates when Shopify products change

---

## Phase 2: Retailer Core (Week 5-6)

**Goal**: Retailer can accept invite, view catalog, and import products

### Accept Invitation
- [ ] Implement invite link handler
  - [ ] Validate token
  - [ ] Trigger Shopify OAuth for retailer
  - [ ] Link retailer shop to connection
- [ ] Update Connection status to ACTIVE
- [ ] Send confirmation email to both parties

### View Catalog
- [ ] Create "Suppliers" page for retailers
- [ ] Show connected suppliers
- [ ] Click supplier → view their wholesale catalog
- [ ] Fetch SupplierProducts filtered by connection
- [ ] Display wholesale pricing specific to this connection
- [ ] Show available inventory

### Product Import
- [ ] Implement "Add to My Store" action
- [ ] Use Shopify Admin API to create products in retailer store
  - [ ] Map all product fields
  - [ ] Set wholesale price as cost
  - [ ] Calculate and set retail price based on markup
  - [ ] Add tags (e.g., "cartrel-supplier-123")
- [ ] Create ProductMapping record
- [ ] Show import status in UI

### Inventory Sync
- [ ] When supplier inventory changes:
  - [ ] Find all ProductMappings
  - [ ] Check sync preferences
  - [ ] Update retailer inventory via Admin API
- [ ] Handle sync errors gracefully
- [ ] Show sync status in retailer UI

### UI
- [ ] Suppliers list page
- [ ] Supplier catalog browser
  - [ ] Product grid/list
  - [ ] Filters (product type, price range, availability)
  - [ ] Search
  - [ ] "Add to Store" buttons
  - [ ] Markup configuration modal
- [ ] Show sync status per product
  - [ ] Last synced timestamp
  - [ ] "Update Available" badge

**Acceptance Criteria:**
- ✅ Retailer can accept invite and see connected supplier
- ✅ Can browse supplier wholesale catalog
- ✅ Can import products to their store
- ✅ Inventory syncs automatically from supplier to retailer

---

## Phase 3: Purchase Orders (Week 7-8)

**Goal**: Complete PO workflow from build → submit → pay → fulfill

### PO Builder UI
- [ ] Create "New Purchase Order" page
- [ ] Select supplier dropdown
- [ ] Load supplier catalog
- [ ] Add items to PO (cart-like interface)
  - [ ] Quantity inputs
  - [ ] Respect minimum quantities
  - [ ] Show line totals
- [ ] Shipping address form
- [ ] Review screen with totals
- [ ] Submit button

### PO Creation Backend
- [ ] Create PurchaseOrder record in database
- [ ] Generate unique PO number (PO-2024-001)
- [ ] Create Draft Order in supplier's Shopify via Admin API
  - [ ] Map line items
  - [ ] Add custom attributes (PO number, Cartrel metadata)
  - [ ] Tag as "cartrel-wholesale"
- [ ] Store supplierShopifyDraftOrderId

### Payment Handling
- [ ] Check connection payment terms
- [ ] If PREPAY:
  - [ ] Get draft order invoice URL from Shopify
  - [ ] Show "Pay Now" button in UI
  - [ ] Retailer clicks → redirected to supplier's Shopify checkout
  - [ ] Handle payment confirmation webhook
- [ ] If NET_XX:
  - [ ] Mark status as SUBMITTED
  - [ ] Notify supplier to approve

### PO Status Sync
- [ ] Subscribe to orders webhooks from supplier shop
- [ ] When order status changes:
  - [ ] Update PurchaseOrder status
  - [ ] Update tracking info if shipped
- [ ] Show status timeline in UI

### UI - Supplier Side
- [ ] "Purchase Orders" page
- [ ] List incoming POs
- [ ] Status filters
- [ ] Click → detail view
  - [ ] Line items
  - [ ] Retailer info
  - [ ] Status timeline
  - [ ] Link to Shopify order
- [ ] Actions:
  - [ ] Mark as processing
  - [ ] Add tracking number

### UI - Retailer Side
- [ ] "Purchase Orders" page
- [ ] List submitted POs
- [ ] Click → detail view
  - [ ] Line items
  - [ ] Terms and perks applied
  - [ ] Payment status
  - [ ] "Pay Now" button (if PREPAY + unpaid)
  - [ ] Tracking info
- [ ] Download invoice (PDF)

**Acceptance Criteria:**
- ✅ Retailer can build and submit PO
- ✅ PO creates Draft Order in supplier's Shopify
- ✅ PREPAY flow: retailer can pay via supplier checkout
- ✅ Both sides see real-time status updates
- ✅ Tracking info syncs when supplier ships

---

## Phase 4: Terms & Tiers (Week 9-10)

**Goal**: Full tier system with automated benefits

### Terms Configuration UI
- [ ] "Terms & Tiers" page for suppliers
- [ ] Configure default connection settings:
  - [ ] Payment terms dropdown
  - [ ] Credit limit
  - [ ] Minimum order amount

### Tier Rules Builder
- [ ] Define tiers (Standard, Silver, Gold, Custom)
- [ ] For each tier:
  - [ ] Threshold amount
  - [ ] Period (Quarter, Year, All-time)
  - [ ] Benefits configuration:
    - [ ] Additional discount percentage
    - [ ] Free shipping threshold
    - [ ] Auto-add free items (SKU + quantity + condition)
- [ ] Save as JSON in Connection.tierRules

### Tier Calculation Engine
- [ ] Background job to calculate tier progress
  - [ ] Sum PO totals per connection
  - [ ] Check thresholds
  - [ ] Update Connection.tier if threshold met
  - [ ] Log tier upgrades to AuditLog
- [ ] Run daily or after each PO
- [ ] Send notification when tier changes

### Perks Application
- [ ] When PO is submitted:
  - [ ] Load connection tier rules
  - [ ] Calculate applicable perks
  - [ ] Apply discount to line items
  - [ ] Add free items to PO
  - [ ] Adjust shipping cost
  - [ ] Store perksApplied in PurchaseOrder
- [ ] Show applied perks clearly in PO review

### UI - Supplier Side
- [ ] Terms & Tiers config page
- [ ] Visual tier rule builder
- [ ] Preview benefits for each tier
- [ ] Retailer list: show current tier for each connection

### UI - Retailer Side
- [ ] "Tier & Benefits" page
- [ ] For each supplier:
  - [ ] Current tier
  - [ ] Progress bar to next tier
  - [ ] Amount remaining + deadline
  - [ ] List of current and next tier benefits
- [ ] Order history breakdown (by period)
- [ ] Show tier badge on PO builder
- [ ] Show perks being applied in real-time during PO creation

**Acceptance Criteria:**
- ✅ Supplier can define tier rules with thresholds and benefits
- ✅ System automatically calculates tier progress
- ✅ Perks apply automatically when PO is submitted
- ✅ Retailer sees clear progress toward next tier
- ✅ Tier upgrades happen automatically and notify both parties

---

## Phase 5: Polish & Launch (Week 11-12)

**Goal**: Production-ready MVP with pilot customers

### Email Notifications
- [ ] Set up email service (Resend, SendGrid)
- [ ] Templates:
  - [ ] Invite sent (supplier)
  - [ ] Invite received (retailer)
  - [ ] Connection accepted (both)
  - [ ] New PO (supplier)
  - [ ] PO submitted (retailer confirmation)
  - [ ] PO paid (supplier)
  - [ ] PO shipped (retailer)
  - [ ] Tier upgraded (retailer)
- [ ] Email preferences in settings

### Analytics Dashboard
- [ ] Supplier Overview stats:
  - [ ] Total retailers
  - [ ] Active vs inactive
  - [ ] Tier distribution
  - [ ] Revenue by period
  - [ ] Top selling products (wholesale)
  - [ ] Average order value
- [ ] Retailer Overview:
  - [ ] Connected suppliers count
  - [ ] Wholesale spend by period
  - [ ] Tier status summary

### Bulk Actions & Search
- [ ] Bulk mark as wholesale
- [ ] Bulk price updates (CSV import)
- [ ] Search across products
- [ ] Filter by collections, tags, vendor
- [ ] Advanced PO filters (date range, status, supplier/retailer)

### Onboarding Flow
- [ ] First-time setup wizard for suppliers:
  - [ ] Welcome screen
  - [ ] Quick product selection
  - [ ] Invite first retailer
  - [ ] Tour of features
- [ ] First-time for retailers:
  - [ ] Welcome from supplier
  - [ ] Browse catalog tour
  - [ ] Create first PO

### Error Handling & Edge Cases
- [ ] Graceful handling of:
  - [ ] Shopify API rate limits (retry with backoff)
  - [ ] Missed webhooks (reconciliation job)
  - [ ] Product deleted on Shopify side
  - [ ] Connection terminated (clean up mappings)
  - [ ] Inventory goes negative
- [ ] User-friendly error messages
- [ ] Detailed error logs for debugging

### Documentation
- [ ] User guide for suppliers
- [ ] User guide for retailers
- [ ] FAQ
- [ ] Troubleshooting common issues
- [ ] Video walkthrough (Loom)

### Shopify App Store Submission
- [ ] App listing content
  - [ ] App name: Cartrel
  - [ ] Tagline: Direct wholesale rails for Shopify stores
  - [ ] Description (from README)
  - [ ] Screenshots (5-7 key screens)
  - [ ] Demo video
- [ ] Privacy policy page
- [ ] Terms of service
- [ ] Support email
- [ ] Pricing clearly listed
- [ ] Submit for review

### Beta Testing
- [ ] Recruit 3-5 pilot suppliers
- [ ] Onboard their retailers
- [ ] Monitor usage and gather feedback
- [ ] Fix critical bugs
- [ ] Iterate on confusing UX

**Acceptance Criteria:**
- ✅ All email notifications working
- ✅ Analytics showing accurate data
- ✅ Onboarding smooth for new users
- ✅ Error handling prevents data loss
- ✅ Documentation complete
- ✅ 3+ pilot customers successfully using in production
- ✅ Submitted to Shopify App Store

---

## Post-Launch: Phase 6 Ideas

### Enhancements (Prioritize based on feedback)
- [ ] Dropship model (orders auto-route to supplier)
- [ ] Multi-currency support
- [ ] Credit checks and risk management integration
- [ ] Advanced analytics (sell-through, inventory forecasting)
- [ ] In-app messaging between supplier and retailer
- [ ] Mobile app or mobile-optimized UI
- [ ] Retailer can browse multiple suppliers in one catalog
- [ ] EDI/ERP integrations
- [ ] Automated restock suggestions
- [ ] Shopify POS integration for in-person wholesale

### Marketing & Growth
- [ ] Content marketing (blog posts, case studies)
- [ ] SEO for "Shopify wholesale", "Faire alternative"
- [ ] Partner with Shopify agencies
- [ ] Attend trade shows (ECRM, NRF, etc.)
- [ ] Referral program (supplier refers supplier)
- [ ] Affiliate program

---

## Key Metrics to Track

### Product Metrics
- **Installations**: Total shops installed
- **Active Connections**: Supplier-retailer pairs
- **GMV**: Total wholesale $ flowing through Cartrel
- **POs per month**: Volume indicator
- **Products synced**: Scale of catalog coverage
- **Tier upgrades**: Engagement signal

### Business Metrics
- **MRR**: Monthly recurring revenue
- **Churn rate**: Shops that uninstall
- **NPS**: Net promoter score
- **CAC**: Cost to acquire supplier
- **LTV**: Lifetime value of supplier

### Technical Metrics
- **Webhook success rate**: % processed without error
- **API response time**: Keep < 500ms
- **Sync lag**: Time from Shopify change to retailer update
- **Uptime**: 99.9%+

---

## Risk Mitigation

### Technical Risks
| Risk | Mitigation |
|------|-----------|
| Shopify API rate limits | Implement exponential backoff, use bulk operations, optimize queries |
| Webhook reliability | Periodic reconciliation jobs, webhook retry logic |
| Data sync conflicts | Last-write-wins with timestamps, conflict resolution UI |
| Database scale | Index properly, use caching (Redis), consider read replicas |

### Product Risks
| Risk | Mitigation |
|------|-----------|
| Low adoption | Start with warm intros to pilot customers, nail UX for them first |
| Competitive pressure from Faire | Emphasize direct relationships and lower fees, stay focused on Shopify |
| Feature creep | Stick to core "rails" positioning, say no to becoming a marketplace |

### Business Risks
| Risk | Mitigation |
|------|-----------|
| Shopify changes B2B features | Build on top of, not against their features; add unique value in sync and network |
| Payment disputes | Stay out of payment flow in v1, let parties handle directly |
| Legal (contracts, liability) | Clear ToS, position as software tool not marketplace, consult lawyer |

---

## Success Definition

**MVP Success (3 months post-launch):**
- 10+ active suppliers
- 50+ retailer connections
- $50K+ GMV
- NPS 8+
- 20% paying customers (vs free tier)

**Product-Market Fit (6 months):**
- 50+ suppliers
- 500+ connections
- $500K+ monthly GMV
- Strong retention (< 5% monthly churn)
- Organic growth from word-of-mouth

---

## Next Steps

1. **Approve this plan** ✅ (waiting for review)
2. **Set up development environment**
3. **Start Phase 0: Foundation**
4. **Weekly check-ins to review progress and adjust**
5. **Ship fast, iterate based on real feedback**

Let's build this! 🚀
