# Cartrel - Technical Design Document

## Executive Summary

**Cartrel** is a Shopify-to-Shopify wholesale infrastructure platform that enables direct, peer-to-peer wholesale relationships between brands and retailers without acting as a marketplace intermediary.

### Core Value Proposition
- **For Brands**: Lower fees, direct retailer relationships, no platform lock-in
- **For Retailers**: Automated catalog sync, clean wholesale ordering, transparent terms and perks
- **For Both**: Eliminates spreadsheets, manual line sheets, and marketplace drama

### Key Differentiator from Faire
Cartrel is **infrastructure, not a marketplace**:
- No commission on ongoing orders
- Direct payment between parties
- Full relationship ownership
- Transparent attribution
- SaaS pricing model instead of GMV percentage

### Terminology Note
Cartrel supports both **wholesale** and **dropshipping** workflows:

| Context | Inventory Owner | Order Fulfiller | Terminology |
|---------|-----------------|-----------------|-------------|
| Wholesale | Supplier | Supplier | Supplier → Retailer |
| Dropshipping | Source | Source | Source → Destination |

Throughout this document:
- **Supplier/Source**: The store that owns inventory and fulfills orders
- **Retailer/Destination**: The store that sells to end customers
- **Sync**: The underlying infrastructure that keeps products, inventory, and orders in sync between connected stores

Sync is a **feature that enables** wholesale and dropshipping—not the purpose itself.

---

## Business Model

### Revenue Strategy

**Core Principle**: Single-sided billing (supplier/source pays); retailers/destinations always FREE.

#### Tier Structure
```
Free:       3 connections, 150 products, 10 order forwards/month (manual only)
Starter:    5 connections, 500 products, 100 orders/month
Core:       10 connections, 1,500 products, 300 orders/month
Pro:        20 connections, 5,000 products, 800 orders/month
Growth:     40 connections, 20,000 products, 2,000 orders/month
Scale:      80 connections, 100,000 products, 5,000+ orders/month
```

#### Bundled Features by Tier
- **Free**: Catalog + inventory sync, basic product fields (title/desc/media/tags), manual order forwarding, metafields (10 defs)
- **Starter**: + Auto order forwarding, price sync, metafields (25 defs)
- **Core**: + Multi-location (single), stock buffer, payouts, metafields (50 defs)
- **Pro**: + Advanced fields (SEO/cost/HS code), multi-location advanced, metafields (200 defs)
- **Growth**: + Marketplace/re-share eligibility, metafields (500 defs)
- **Scale**: + Re-share rights, unlimited metafields, custom SLA

#### Add-ons
- Additional connections
- Additional order forwards
- (No SKU-based metering—meter on products/orders/connections only)

#### Future: Premium Add-Ons
- Credit checks and risk management
- Advanced analytics and sell-through reporting
- Multi-supplier catalog aggregation for retailers
- EDI/ERP integrations
- Collection sync (roadmap)
- Price rules/markups (roadmap)

### Pricing Instrumentation

To support flexible pricing experiments, the system tracks:

**Per Shop:**
- Active connections count
- Total POs created (all-time and monthly)
- Total GMV processed (all-time and monthly)
- Products synced count
- API usage / webhook volume

**Per Connection:**
- POs created
- GMV on this connection
- Product mappings count
- Tier level and upgrades

**Per Purchase Order:**
- Total amount
- Line items count
- Perks applied (for value demonstration)
- Creation and fulfillment timestamps

**Analytics Tables:**
- Monthly rollups for billing
- Usage trends for pricing optimization
- Feature adoption metrics

This instrumentation allows us to:
1. Experiment with different pricing models without code changes
2. Analyze which metrics correlate with value
3. Implement usage-based billing if needed
4. Provide customers with usage dashboards

### Target Market

**Phase 1**: Existing wholesale relationships
- Brands with 10-100 active stockists
- Already doing wholesale, hate the current process
- Shopify or Shopify Plus merchants

**Not targeting**: Cold discovery (that's Faire's strength)

---

## Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Shopify Ecosystem                         │
├──────────────────────────┬──────────────────────────────────┤
│   Supplier Shopify       │      Retailer Shopify            │
│   - Products             │      - Products                  │
│   - Inventory            │      - Inventory                 │
│   - Draft Orders         │      - Orders                    │
│   - Wholesale Orders     │      - Customers                 │
└───────────┬──────────────┴──────────────┬───────────────────┘
            │                              │
            │ Webhooks + Admin API         │
            │                              │
┌───────────▼──────────────────────────────▼───────────────────┐
│                  Cartrel Backend (Node/TS)                    │
├───────────────────────────────────────────────────────────────┤
│  - OAuth & Session Management                                 │
│  - Webhook Processing                                         │
│  - Relationship Engine (connections, terms, tiers, perks)     │
│  - Product Cache & Sync Engine                                │
│  - Product Mapping Service                                    │
│  - Purchase Order Orchestration                               │
│  - Audit Logging                                              │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│              Embedded Shopify App UI (React)                  │
├───────────────────────────────────────────────────────────────┤
│  Supplier View:                    Retailer View:             │
│  - Wholesale Catalog Setup         - Connected Suppliers      │
│  - Retailer Management             - Browse Catalogs          │
│  - Terms & Tiers Config            - Build Purchase Orders    │
│  - Incoming PO Review              - Tier Progress & Perks    │
│  - Analytics                       - Order History            │
└───────────────────────────────────────────────────────────────┘
```

### Technology Stack (Recommended)

**Backend:**
- Runtime: Node.js with TypeScript
- Framework: Express or Fastify
- Database: PostgreSQL
- ORM: Prisma or TypeORM
- Queue: Bull (Redis-backed) for webhook processing
- Auth: Shopify OAuth 2.0 with session tokens

**Frontend:**
- Framework: React 18+
- Shopify Integration: @shopify/app-bridge, Polaris components
- State: React Query for server state
- Forms: React Hook Form with Zod validation

**Infrastructure:**
- Hosting: Railway, Render, or similar
- Database: Managed PostgreSQL
- Redis: Managed Redis for queues
- Storage: S3 for any future assets

### Sync Infrastructure (Enabling Wholesale & Dropshipping)

The following sync capabilities power both wholesale and dropshipping workflows. See `docs/INVENTORY_PRODUCT_SYNC_DESIGN.md` and individual PRDs for detailed specifications.

#### Connection Settings (per connection)
- **Sync mode**: `inventory_and_catalog` (full sync + order forwarding) or `catalog_only` (content replication without inventory)
- **Order trigger policy**: `on_create` (immediate) or `on_paid` (wait for payment)
- **Field scope**: Granular control over which product fields sync (title, description, images, tags, price, SEO, etc.)
- **Stock buffer**: Reserve inventory not exposed to destinations
- **Order forwarding**: Enable/disable per connection, manual or auto

#### Core Sync Features
| Feature | Description | PRD Reference |
|---------|-------------|---------------|
| Catalog sync | Product field controls, hide-by-default, resync, auto-add variants | `PRD_PRODUCT_SETTINGS_SYNC.md` |
| Inventory sync | Webhook-driven deltas, idempotent processing, multi-location, refund/return handling | `PRD_MULTI_LOCATION_SYNC.md` |
| Order forwarding | Manual/auto modes, shadow preview, shipping rules, $0 workaround | `PRD_ORDER_PUSH_SHADOW_MODE.md` |
| Metafields sync | Selective definition/value sync with tier caps | `PRD_METAFIELDS_SYNC.md` |
| Mapper service | SKU/variant validation, drift detection, conflict resolution, bulk operations | `PRD_MAPPER_CONFLICTS.md` |
| Payouts | Commission/fee tracking (no funds movement), bundled Core+ | `PRD_PAYOUTS.md` |
| Rate-limit handling | Batch/priority processing, backoff/DLQ, health surfacing | `PRD_RATE_LIMIT_OBSERVABILITY.md` |

#### Partner Network Features
| Feature | Description | PRD Reference |
|---------|-------------|---------------|
| Marketplace | Partner profiles, search, invites for discovery | `PRD_MARKETPLACE.md` |
| Dual-role & re-share | Stores can be both source and destination; consented re-share governance | `PRD_UNIVERSAL_RESHARE.md` |

#### Roadmap Features
- **Collection sync**: Mirror collections with membership via mapped products/tags (`PRD_COLLECTION_SYNC.md`)
- **Price rules**: Per-connection/per-market markup/markdown (`PRD_PRICE_RULES.md`)
- **Extended metafields**: Collection and reference type support
- **Per-connection billing**: For marketplace/dropship scenarios

---

## Data Model

### Core Entities

#### Shop
```typescript
interface Shop {
  id: string
  myshopifyDomain: string  // e.g., "brandname.myshopify.com"
  accessToken: string       // Encrypted
  role: 'SUPPLIER' | 'RETAILER' | 'BOTH'
  plan: 'STARTER' | 'GROWTH' | 'PLUS' | 'ENTERPRISE'
  settings: {
    companyName: string
    email: string
    timezone: string
  }
  createdAt: timestamp
  updatedAt: timestamp
}
```

#### Connection
Represents the relationship between a supplier and retailer.

```typescript
interface Connection {
  id: string
  supplierShopId: string
  retailerShopId: string

  // Payment terms
  paymentTermsType: 'PREPAY' | 'NET_15' | 'NET_30' | 'NET_60'
  creditLimit: number | null
  currency: string  // USD, CAD, EUR, etc.
  minOrderAmount: number

  // Tier & perks
  tier: 'STANDARD' | 'SILVER' | 'GOLD' | 'CUSTOM'
  tierRules: TierRule[]  // JSON: thresholds and benefits

  // Status
  status: 'PENDING_INVITE' | 'ACTIVE' | 'PAUSED' | 'TERMINATED'
  inviteToken: string | null
  invitedAt: timestamp | null
  acceptedAt: timestamp | null

  // Metadata
  notes: string
  createdAt: timestamp
  updatedAt: timestamp
}

interface TierRule {
  tier: string
  threshold: number          // e.g., $3000
  period: 'QUARTER' | 'YEAR' | 'ALL_TIME'
  benefits: {
    discountPercent?: number
    freeShippingThreshold?: number
    autoFreebies?: FreebieRule[]
  }
}

interface FreebieRule {
  condition: {
    type: 'ORDER_TOTAL' | 'CONTAINS_SKU'
    value: number | string
  }
  action: {
    addSku: string
    quantity: number
  }
}
```

#### SupplierProduct
Cached mirror of supplier's wholesale-eligible products.

```typescript
interface SupplierProduct {
  id: string
  supplierShopId: string
  shopifyProductId: string
  shopifyVariantId: string

  // Product info (cached)
  title: string
  description: string
  vendor: string
  productType: string
  imageUrl: string

  // Variant info
  sku: string
  variantTitle: string
  wholesalePrice: number
  compareAtPrice: number
  inventoryQuantity: number

  // Wholesale config
  isWholesaleEligible: boolean
  minQuantity: number

  // Sync metadata
  lastSyncedAt: timestamp
  createdAt: timestamp
  updatedAt: timestamp
}
```

#### ProductMapping
Links a supplier product to a retailer's imported product.

```typescript
interface ProductMapping {
  id: string
  connectionId: string

  // Supplier side
  supplierProductId: string
  supplierShopifyProductId: string
  supplierShopifyVariantId: string

  // Retailer side
  retailerShopifyProductId: string
  retailerShopifyVariantId: string

  // Sync preferences
  syncPreferences: {
    inventory: boolean        // Default: true
    pricing: boolean          // Default: false (retailer controls markup)
    description: boolean      // Default: false
    images: boolean          // Default: false
  }

  // Retailer pricing
  retailerMarkupType: 'FIXED_AMOUNT' | 'PERCENTAGE' | 'CUSTOM'
  retailerMarkupValue: number

  status: 'ACTIVE' | 'PAUSED' | 'DISCONTINUED'
  createdAt: timestamp
  updatedAt: timestamp
}
```

#### PurchaseOrder
Wholesale order from retailer to supplier.

```typescript
interface PurchaseOrder {
  id: string
  connectionId: string

  // Order details
  poNumber: string  // User-friendly: PO-2024-001
  items: POItem[]
  subtotal: number
  shippingCost: number
  taxAmount: number
  total: number
  currency: string

  // Terms applied at time of order
  paymentTermsType: string
  tierAtOrder: string
  perksApplied: AppliedPerk[]

  // Shopify integration
  supplierShopifyOrderId: string | null
  supplierShopifyDraftOrderId: string | null

  // Status tracking
  status: 'DRAFT' | 'SUBMITTED' | 'AWAITING_PAYMENT' |
          'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' |
          'CANCELLED'

  // Shipping
  shippingAddress: Address
  trackingNumber: string | null
  trackingUrl: string | null

  // Audit
  submittedAt: timestamp | null
  paidAt: timestamp | null
  shippedAt: timestamp | null
  createdAt: timestamp
  updatedAt: timestamp
}

interface POItem {
  supplierProductId: string
  sku: string
  title: string
  variantTitle: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

interface AppliedPerk {
  type: 'DISCOUNT' | 'FREE_ITEM' | 'FREE_SHIPPING'
  description: string
  value: number | string
}
```

---

## Payment & Billing Architecture

### How Money Flows (Wholesale Transactions)

**Critical Clarification**: Cartrel does NOT process wholesale payments. All wholesale transactions happen directly between supplier and retailer through Shopify's native payment infrastructure.

**The Flow:**

1. **Retailer places PO** → Cartrel creates Draft Order in supplier's Shopify
2. **Payment happens via Shopify**:
   - **If PREPAY**: Retailer clicks "Pay Now" → redirected to supplier's Shopify checkout → pays with card via supplier's payment processor
   - **If NET Terms**: Supplier approves draft → converts to order → invoices retailer directly (via Shopify invoice or external accounting)
3. **Funds go directly to supplier** → via their Shopify Payments, Stripe, or bank account
4. **Cartrel tracks status** → webhooks tell us when paid, shipped, etc.

**What Cartrel Does:**
- Creates the order object (Draft Order in Shopify)
- Generates invoice/checkout links
- Tracks payment status
- Syncs fulfillment updates

**What Cartrel Does NOT Do:**
- Hold funds
- Process credit cards
- Handle chargebacks
- Manage refunds
- Take transaction commission (in wholesale flow)

### How Cartrel Gets Paid

Cartrel charges **suppliers only** (retailers always free):

**Current options being evaluated:**
- Fixed monthly SaaS fee (tiered by usage)
- Per-transaction fee with monthly caps
- Hybrid model (base + usage)
- Small GMV percentage (< 1%)

**Billing mechanism:**
- Shopify App billing API (recurring charges)
- Usage-based billing for transaction models
- Tracked via Shop.plan and usage metrics

**Key tables for billing:**
- `Shop.plan` - current subscription tier
- `PurchaseOrder.total` - for GMV/transaction-based models
- `Connection` count - for connection-based pricing
- Monthly rollup analytics for usage billing

---

## User Flows

### 1. Supplier Setup Flow

**Step 1: Installation**
1. Supplier clicks "Install Cartrel" from app store or invite link
2. Shopify OAuth flow → Cartrel requests permissions:
   - Read products, inventory
   - Write orders (draft orders)
   - Read/write metafields (for tagging)
3. Redirect to Cartrel embedded app in Shopify admin

**Step 2: Wholesale Catalog Setup**
1. Supplier navigates to "Wholesale Catalog" section
2. Views all products from their store
3. For each product/variant:
   - Toggle "Wholesale Eligible"
   - Set wholesale price (can be bulk imported)
   - Set minimum order quantity
4. Save → Cartrel caches these in SupplierProduct table
5. Sets up webhooks for products, inventory

**Step 3: Configure Terms & Tiers**
1. Navigate to "Terms & Tiers"
2. Set default connection settings:
   - Payment terms: PREPAY, NET_30, etc.
   - Minimum order amount
   - Default tier: STANDARD
3. Optionally define tier rules:
   - Silver: $3,000/quarter → 2% extra discount, free shipping >$500
   - Gold: $10,000/year → 5% extra, free display kit, priority fulfillment
4. Save → stored in Connection template

**Step 4: Invite Retailers**
1. Navigate to "Retailers" → "Invite New"
2. Enter retailer email + optional custom terms
3. Generate unique invite link
4. Send via email or copy link
5. Connection created with status: PENDING_INVITE

---

### 2. Retailer Setup Flow

**Step 1: Accept Invitation**
1. Retailer receives email with invite link
2. Clicks link → redirects to Shopify App Store install page
3. OAuth flow (same permissions as supplier)
4. Redirect to Cartrel app → automatically links to supplier

**Step 2: Browse Wholesale Catalog**
1. Navigate to "Suppliers" → see connected supplier
2. Click supplier → view their wholesale catalog
3. See:
   - Product images, titles, descriptions
   - SKU, variants
   - **Their specific wholesale price** (based on connection terms)
   - Available inventory
   - Minimum quantities

**Step 3: (Optional) Import Products**
Retailer can import products to their own store for resale:

1. Select products from catalog
2. Click "Add to My Store"
3. Configure:
   - Markup strategy (e.g., 2x wholesale = keystone)
   - Sync preferences (inventory only, or full auto)
4. Cartrel:
   - Creates products in retailer's Shopify via Admin API
   - Stores ProductMapping
   - Tags products (e.g., "cartrel-supplier-[id]")

**Important**: Importing is OPTIONAL. Retailer can order wholesale without importing.

**Step 4: Place Purchase Order**
1. Navigate to "Purchase Orders" → "New PO"
2. Select supplier
3. Add items from catalog (search, browse, or bulk add by SKU)
4. Set quantities
5. Review:
   - Subtotal
   - Tier perks applied (e.g., "Gold: 5% discount, free display kit added")
   - Terms (NET_30, PREPAY, etc.)
   - Shipping address
6. Submit PO
7. Cartrel backend:
   - Creates PO record
   - Creates Draft Order in supplier's Shopify
   - If PREPAY: returns "Pay Now" link → supplier's Shopify checkout
   - If NET_XX: marks as awaiting approval

---

### 3. Purchase Order Lifecycle

```
DRAFT (retailer building)
  ↓
SUBMITTED (sent to supplier)
  ↓
AWAITING_PAYMENT (if PREPAY) → retailer pays via Shopify checkout
  ↓
PAID (payment confirmed)
  ↓
PROCESSING (supplier prepares shipment)
  ↓
SHIPPED (tracking provided)
  ↓
DELIVERED (completed)
```

**Supplier Actions:**
- Receives notification of new PO
- Reviews in Cartrel app or native Shopify orders
- If NET terms: approves and converts draft → order
- Fulfills order
- Adds tracking → synced back to Cartrel → retailer sees update

**Retailer Actions:**
- Sees real-time status updates in Cartrel app
- If PREPAY: clicks pay link when ready
- Receives tracking info
- Can message supplier (future: in-app messaging)

---

### 4. Product Sync Flow

When supplier updates a product:

```
Supplier updates product in Shopify
  ↓
Shopify fires products/update webhook → Cartrel
  ↓
Cartrel updates SupplierProduct cache
  ↓
Finds all ProductMappings for that product
  ↓
For each connected retailer:
  Check sync preferences
  ↓
  If auto-sync enabled:
    Update retailer product via Admin API
  ↓
  If manual:
    Flag "Update Available" in retailer's Cartrel UI
```

**Inventory Sync:**
- Happens on inventory_levels/update webhook
- Near real-time (within seconds)
- Respects sync preferences per mapping

**Price Sync:**
- Wholesale price changes propagate automatically
- Retailer pricing (retail price) can be:
  - Auto-calculated from markup rule
  - Manually managed by retailer

---

## UI/UX Specifications

### Design System

**Brand: Cartrel**
- Tagline: "Direct wholesale rails for Shopify stores"
- Feel: Calm, precise, relationship-focused infrastructure

**Color Palette:**
```
Ink (text):      #0F172A
Stone (bg):      #F5F5F3
Surface (card):  #FFFFFF
Border:          #E0DED8
Primary:         #214937 (deep spruce green)
Accent:          #F28C3A (saffron)
Success:         #10B981
Warning:         #F59E0B
Error:           #EF4444
```

**Typography:**
- Primary: Inter or IBM Plex Sans
- Sizes: base 16px, scale 1.25
- Line height: 1.5 for body, 1.2 for headings

**Components:**
- Use Shopify Polaris as base
- Customize colors to match Cartrel palette
- Custom components:
  - Tier progress bar (accent color)
  - Connection status pills
  - PO status timeline

---

### Supplier View Layout

**Left Navigation:**
```
Overview
Wholesale Catalog
Retailers
Terms & Tiers
Purchase Orders
Settings
```

#### Overview Page
- Total active retailers
- Total wholesale revenue (MTD, QTD)
- Recent POs (last 5)
- Tier distribution chart (Standard/Silver/Gold)
- Quick actions: "Invite Retailer", "Add Products"

#### Wholesale Catalog Page
Table view:
```
[ Image ] | Title | SKU | Variants | Wholesale Price | Inventory | Status | Actions
```
- Toggle "Wholesale Eligible" inline
- Bulk actions: enable/disable, edit prices
- Filter by status, product type

#### Retailers Page
Card grid or table:
```
[ Logo ] Retailer Name
         Status: Active | Tier: Silver
         Connection: Nov 2024 | Orders: 12 | Total: $8,450
         Progress: [$2,550 to Gold] ▓▓▓▓▓▓▓░░░ 71%
         [View Details] [Edit Terms]
```

Click → Detail view:
- Contact info
- Custom terms for this connection
- Order history
- Tier & perks config
- Notes

#### Terms & Tiers Page
- Default connection settings
- Tier rules builder:
  ```
  Tier: Silver
  Threshold: $3,000 per Quarter
  Benefits:
    - Discount: +2%
    - Free shipping over: $500
    - Auto add: 1x Display Kit (SKU-999) when order > $300
  ```

#### Purchase Orders Page
Table:
```
PO Number | Retailer | Date | Total | Status | Actions
```
Status colors:
- Submitted: blue
- Paid: green
- Processing: amber
- Shipped: gray
- Cancelled: red

Click → PO detail:
- Line items
- Applied perks
- Shipping address
- Tracking (if shipped)
- Timeline
- Link to Shopify order

---

### Retailer View Layout

**Left Navigation:**
```
Overview
Suppliers
Purchase Orders
Tier & Benefits
Settings
```

#### Overview Page
- Connected suppliers count
- Total wholesale spend (MTD, QTD)
- Recent POs
- Tier progress for each supplier (quick glance)

#### Suppliers Page
Card grid:
```
[ Logo ] Supplier Name
         Status: Active | Tier: Silver
         Products: 45 | 12 imported to store
         Next tier: [$600 to Gold by Sep 30]
         [Browse Catalog] [New PO]
```

#### Supplier Catalog (when clicked)
Split view:
- Left: Product grid/list with filters
- Right: Selected items for PO (cart-like)

Product card:
```
[ Image ]
Title
SKU | Variants
Wholesale: $12.50 ea (min 6)
Inventory: 120 available
[Add to Store] [Add to PO]
```

Filters:
- Product type
- Price range
- Availability
- Already imported

#### Purchase Orders Page
Similar to supplier view, but from buyer perspective:
```
PO Number | Supplier | Date | Total | Status | Actions
```

Click → Detail view includes:
- Payment status
- If PREPAY + unpaid: [Pay Now] button
- Tracking info
- Download invoice (PDF)

#### Tier & Benefits Page
For each supplier:
```
Supplier: Brand X
Current Tier: Silver
Benefits:
  ✓ 2% discount on all orders
  ✓ Free shipping over $500
  ✓ Free display kit with orders >$300

Progress to Gold:
  ▓▓▓▓▓▓▓░░░ $2,400 / $3,000 by Dec 31
  $600 more to unlock:
    → 5% discount
    → Priority fulfillment
    → Quarterly catalog preview

Order History:
  Q4 2024: $2,400
  Q3 2024: $1,800
```

---

## Implementation Phases

### Phase 0: Foundation (Week 1-2)
- [ ] Repository setup
- [ ] Database schema implementation (Prisma)
- [ ] Shopify OAuth flow
- [ ] Basic embedded app shell with Polaris
- [ ] Webhook infrastructure (Redis queue)
- [ ] Shop model CRUD

**Deliverable**: Can install app, see empty dashboard

---

### Phase 1: Supplier Core (Week 3-4)
- [ ] Fetch products from Shopify Admin API
- [ ] Wholesale catalog UI (mark products eligible, set prices)
- [ ] SupplierProduct table + sync
- [ ] Webhooks: products/update, products/delete, inventory
- [ ] Connection invitation system
- [ ] Basic "Retailers" list view

**Deliverable**: Supplier can set up catalog and invite retailers

---

### Phase 2: Retailer Core (Week 5-6)
- [ ] Accept invitation flow
- [ ] Connection linking
- [ ] View supplier catalog (with connection-specific pricing)
- [ ] Product import to retailer store (via Admin API)
- [ ] ProductMapping table + basic sync
- [ ] Inventory sync (supplier → retailer)

**Deliverable**: Retailer can browse catalog and import products

---

### Phase 3: Purchase Orders (Week 7-8)
- [ ] PO builder UI (cart-like interface)
- [ ] PurchaseOrder table
- [ ] Create Draft Order in supplier Shopify
- [ ] Payment terms handling (PREPAY vs NET)
- [ ] "Pay Now" link generation for PREPAY
- [ ] PO status sync (manual status updates)
- [ ] PO list and detail views for both roles

**Deliverable**: Full PO workflow from build → submit → pay → fulfill

---

### Phase 4: Terms & Tiers (Week 9-10)
- [ ] Connection terms configuration UI
- [ ] Tier rules builder
- [ ] Tier calculation engine (rolling windows, thresholds)
- [ ] Perks application:
  - Automatic discounts
  - Free items
  - Free shipping
- [ ] Tier progress UI for retailers
- [ ] Perks display in PO builder

**Deliverable**: Full tier system with automated benefits

---

### Phase 5: Polish & Launch (Week 11-12)
- [ ] Email notifications (PO submitted, status changes)
- [ ] Analytics dashboard for suppliers
- [ ] Bulk actions (import, edit)
- [ ] Search and filters
- [ ] Onboarding flow improvements
- [ ] Documentation
- [ ] Shopify App Store listing
- [ ] Beta testing with 3-5 pilot customers

**Deliverable**: Production-ready MVP

---

## Open Questions & Risks

### Technical Risks

**1. Shopify API Rate Limits**
- Risk: Heavy sync operations may hit rate limits
- Mitigation: Implement smart batching, use bulk APIs where available, queue long operations

**2. Webhook Reliability**
- Risk: Missed webhooks = stale data
- Mitigation: Implement periodic reconciliation jobs, webhook verification

**3. Multi-Currency**
- Risk: Complex if supplier and retailer use different currencies
- Solution for v1: Require same currency per connection, add conversion later

**4. Tax Calculation**
- Risk: Wholesale tax varies by jurisdiction
- Solution for v1: Supplier handles tax in their Shopify checkout, Cartrel doesn't calculate

### Product Risks

**1. "Why not just use Shopify B2B?"**
- Answer: Shopify B2B is single-store. Cartrel connects multiple stores with sync.
- Our value: network effects, relationship management, automated sync

**2. Network Cold Start**
- Risk: Low value until both sides of marketplace present
- Mitigation: Target existing relationships, not cold discovery

**3. Feature Bloat**
- Risk: Trying to match all Faire features
- Mitigation: Stay focused on "rails not marketplace" positioning

### Business Risks

**1. Shopify App Store Competition**
- Existing: Various wholesale apps, but none do peer-to-peer sync
- Positioning: We're infrastructure, not a form builder

**2. Faire Response**
- Could build similar features or pressure brands
- Defense: We own no transactions, can't "trap" anyone

**3. Payment Terms Risk**
- If we enable NET terms, credit risk falls on supplier
- Solution: Offer optional credit check integrations later, not v1

---

## Success Metrics

### Phase 1 (Beta, 3 months)
- 10 active supplier shops
- 50+ retailer connections
- 100+ POs processed
- $50K+ GMV flowing through Cartrel
- NPS: 8+

### Phase 2 (Launch, 6 months)
- 50 suppliers
- 500 retailer connections
- 1,000+ monthly POs
- $500K+ monthly GMV
- 20+ paying customers (suppliers)
- MRR: $2K+

### Phase 3 (Growth, 12 months)
- 200 suppliers
- 3,000+ connections
- $3M+ monthly GMV
- MRR: $15K+
- Add dropship model

---

## Next Steps

1. **Review this document** - Confirm approach, identify gaps
2. **Finalize tech stack** - Lock in frameworks, hosting
3. **Set up project** - Repo, database, Shopify partner account
4. **Build Phase 0** - Foundation + OAuth
5. **Weekly check-ins** - Review progress, adjust as needed

---

## Appendix: Key Technical Details

### Shopify Permissions Required
```
read_products, write_products
read_orders, write_orders, write_draft_orders
read_inventory
read_customers
write_metafields (for tagging)
```

### Webhook Subscriptions
```
products/create
products/update
products/delete
inventory_levels/update
orders/create
orders/updated
app/uninstalled
```

### Critical API Endpoints (Cartrel Backend)

**Auth:**
- `GET /auth/shopify` - Initiate OAuth
- `GET /auth/shopify/callback` - OAuth callback
- `GET /auth/shopify/verify` - Verify session token

**Supplier:**
- `GET /api/supplier/products` - Fetch wholesale catalog
- `POST /api/supplier/products/:id/wholesale` - Mark as wholesale
- `GET /api/supplier/retailers` - List connections
- `POST /api/supplier/retailers/invite` - Generate invite
- `GET /api/supplier/purchase-orders` - List POs

**Retailer:**
- `POST /api/retailer/connections/:token` - Accept invite
- `GET /api/retailer/suppliers` - List connected suppliers
- `GET /api/retailer/catalog/:supplierId` - View catalog
- `POST /api/retailer/products/import` - Import to store
- `POST /api/retailer/purchase-orders` - Create PO

**Webhooks:**
- `POST /webhooks/shopify/products/update`
- `POST /webhooks/shopify/inventory/update`
- `POST /webhooks/shopify/orders/update`

---

**Document Version**: 1.0
**Last Updated**: 2025-11-10
**Status**: Ready for Review
