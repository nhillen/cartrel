# Cartrel - Key Design Decisions

This document captures important architectural and product decisions made during planning.

## Product Decisions

### 1. Infrastructure, Not Marketplace

**Decision**: Cartrel will NOT act as a marketplace or merchant of record.

**Rationale**:
- Differentiate from Faire
- Lower regulatory burden
- Simpler financial model
- Brands keep control of relationships
- No platform attribution disputes

**Implications**:
- Payments flow directly between supplier and retailer
- We charge SaaS fees, not GMV percentage
- We don't handle chargebacks, refunds, or credit risk in v1
- Focus on tooling and automation, not discovery

---

### 2. Shopify-Only for MVP

**Decision**: Both suppliers and retailers must be on Shopify for v1.

**Rationale**:
- Deepest integration possible
- Uniform APIs and webhooks
- Embedded app experience
- Easier to support
- Fastest path to PMF

**Future**: Could expand to WooCommerce, BigCommerce, etc. but only after proving Shopify-to-Shopify works.

---

### 3. No Dropship in v1

**Decision**: Launch with classic wholesale (bulk orders) only. Add dropship in Phase 6+.

**Rationale**:
- Simpler to build and explain
- Fewer edge cases (inventory sync, tax, fulfillment timing)
- Easier to support
- Classic wholesale is the established need

**Future**: Dropship is a natural extension once core rails are proven.

---

### 4. Flexible Supplier-Side Pricing (Retailers Always Free)

**Decision**: Charge suppliers only, keep retailers free. Specific pricing model TBD - system designed to support multiple approaches.

**Rationale**:
- Supplier has higher willingness to pay (saves them operational cost)
- Retailer friction kills network growth
- Aligns with "we're infrastructure" positioning
- Market feedback needed to determine optimal model

**Options Being Evaluated**:

**A. Fixed SaaS Tiers**:
- Starter: $49/mo (10 retailers)
- Growth: $149/mo (50 retailers + tiers/perks)
- Plus: $399/mo (unlimited + analytics)
- Pros: Predictable MRR, simple to explain
- Cons: Doesn't scale with actual value delivered

**B. Transaction-Based with Caps**:
- $0.25-$1.00 per wholesale order
- Monthly caps: $49/$149 by tier
- Pros: Aligns with usage, feels fair
- Cons: Unpredictable revenue early on

**C. Hybrid (Base + Usage)**:
- Base: $29/mo + $0.50/order
- Caps apply at higher tiers
- Pros: Balance of predictability and fairness
- Cons: Slightly more complex to explain

**D. Small GMV Percentage**:
- 0.5-1% of wholesale GMV
- Much lower than Faire's 15-25%
- Pros: Scales with customer success
- Cons: Can feel like marketplace commission

**Implementation**:
- Comprehensive usage tracking (UsageMetric table)
- Shopify App billing API for recurring charges
- Ability to switch pricing models without code changes
- Partner with wholesale industry expert will inform final model

**Principle**: Retailers must always be free to preserve network growth dynamics.

---

### 5. Optional Product Import for Retailers

**Decision**: Retailers can order wholesale without importing products to their store.

**Rationale**:
- Not all retailers want to resell online (brick-and-mortar, in-person sales)
- Gives flexibility
- Reduces friction
- Import is a value-add for online retailers

**Implications**:
- ProductMapping table can have null retailer Shopify IDs
- PO flow works independently of import status

---

### 6. Tier System with Automated Perks

**Decision**: Build configurable tier system with rules engine for automatic perks.

**Rationale**:
- Brands already do this manually (spreadsheets, "VIP accounts")
- High-value feature for both sides
- Drives loyalty and repeat orders
- Differentiator vs basic wholesale apps

**Tier Mechanics**:
- Thresholds based on rolling windows (quarter, year, all-time)
- Benefits: discounts, free shipping, free items
- Automatic calculation and upgrade
- Transparent progress for retailers

---

## Technical Decisions

### 7. Embedded Shopify App (Not Standalone Portal)

**Decision**: Primary UX is embedded inside Shopify admin, not a separate website.

**Rationale**:
- Merchants live in Shopify admin all day
- Better integration (feels native)
- Lower barrier (no separate login)
- Shopify App Bridge provides polish

**Optional**: Standalone portal can be same codebase, non-embedded, for multi-store users later.

---

### 8. Backend-Driven Architecture

**Decision**: Cartrel backend owns all cross-shop logic, state, and relationships.

**Rationale**:
- Shopify stores are just data sources/sinks
- We need central place for connections, mappings, and rules
- Can't store cross-shop data in either individual store

**Stack**:
- Node.js + TypeScript
- PostgreSQL (relational fits our data model)
- Redis for queues
- Webhooks for real-time sync
- Admin API for CRUD

---

### 9. Webhooks + Periodic Reconciliation

**Decision**: Use webhooks for real-time sync, but also run periodic reconciliation jobs.

**Rationale**:
- Webhooks can be missed (network issues, downtime)
- Reconciliation ensures data consistency
- Safety net for edge cases

**Implementation**:
- Primary: webhook-driven updates (fast)
- Backup: nightly reconciliation job (thorough)

---

### 10. Prisma ORM + PostgreSQL

**Decision**: Use Prisma for database access and PostgreSQL as database.

**Rationale**:
- Type-safe queries (TypeScript)
- Excellent migration tooling
- Good DX (developer experience)
- PostgreSQL is reliable, scales well, handles JSON fields

**Alternative considered**: Raw SQL, but Prisma's safety and speed won out.

---

### 11. Direct Draft Order Creation (Not Custom App Order Flow)

**Decision**: POs create Draft Orders in supplier's Shopify, supplier converts to Order.

**Rationale**:
- Leverages existing Shopify workflows
- Supplier can review/edit before finalizing
- Natural fit for NET terms (draft until paid)
- Uses Shopify's native invoicing

**Alternative considered**: Custom order objects entirely in Cartrel, but that divorces from Shopify's fulfillment flow.

---

### 12. No Custom Checkout / Payment Processing in v1

**Decision**: All payments happen via supplier's existing Shopify checkout or invoicing.

**Rationale**:
- Simplest legally (no money transmitter license)
- Fastest to build
- Supplier already has payment processing set up
- Lower risk (no chargebacks, fraud for us)

**Future**: Could add aggregated invoicing or Stripe Connect if there's demand, but not a priority.

---

### 13. Terms Stored Per Connection, Not Globally

**Decision**: Payment terms, tiers, and perks are connection-specific, not shop-wide.

**Rationale**:
- Supplier may have different terms for different retailers
- More flexible and realistic
- Allows "VIP" treatment per relationship

**Default**: Suppliers set defaults, can override per retailer.

---

## UX Decisions

### 14. Cartrel Brand: Warm, Calm, Infrastructure

**Decision**: Brand identity is "warm operations console" not "flashy marketplace."

**Colors**:
- Spruce green primary (#214937)
- Saffron accent (#F28C3A)
- Stone backgrounds (#F5F5F3)
- Near-black text (#0F172A)

**Rationale**:
- Reflects positioning: serious tooling with human relationships
- Not trying to be Faire or DTC marketplace
- Needs to feel trustworthy

---

### 15. Tier Progress Shown Prominently to Retailers

**Decision**: Tier progress and "X more to next tier" shown in multiple places.

**Rationale**:
- Drives order behavior (gamification)
- Transparent = builds trust
- Low-hanging engagement feature

**Locations**:
- Dashboard widget
- PO builder (live)
- Dedicated "Tier & Benefits" page
- Supplier card in list view

---

### 16. No In-App Chat for v1

**Decision**: Supplier and retailer communicate via email or phone, not in-app messaging.

**Rationale**:
- Avoids building a whole messaging system
- They already have communication channels
- Focus on core value (sync + POs)

**Future**: Could add later if high demand.

---

## Scope Decisions (What We're NOT Doing in v1)

### ❌ Discovery / Marketplace Features
- No "find new brands" directory
- No product reviews or ratings
- No supplier profiles visible to non-connected retailers

**Why**: We're infrastructure for existing relationships, not a marketplace.

---

### ❌ Credit Checks / Net Terms Financing
- No built-in credit checks
- No funding of net terms
- Supplier assumes credit risk

**Why**: Regulatory complexity, not core value.

**Future**: Partner with credit/payment services if needed.

---

### ❌ Multi-Currency in v1
- Supplier and retailer must use same currency per connection

**Why**: Exchange rates, display complexity, accounting headaches.

**Future**: Can add once core is stable.

---

### ❌ Tax Calculation
- Cartrel does not calculate tax on POs
- Tax handled by supplier's Shopify checkout

**Why**: Tax is jurisdictionally complex, Shopify already does this.

---

### ❌ Returns / Refunds Management
- Parties handle directly, not tracked in Cartrel

**Why**: Out of scope for infrastructure tool.

**Future**: Could add refund tracking if users ask for it.

---

### ❌ Analytics on Sell-Through (End Customer)
- We track wholesale orders, not retail sales of those products

**Why**: Would require tracking end customer orders in retailer's store, complex.

**Future**: Possible as premium feature.

---

### ❌ Custom Branding / White Label
- Cartrel is Cartrel, not rebrandable

**Why**: Not targeting agencies or SaaS resellers.

---

## Open Questions (To Be Decided)

### 1. Multi-Warehouse Support?
Some suppliers have multiple warehouses. Do we:
- Support per-warehouse inventory sync?
- Let supplier route POs to specific warehouse?

**Decision**: Not v1, add if requested.

---

### 2. Should Suppliers See Retailer's Retail Pricing?
If retailer imports products, should supplier see what price they're charging end customers?

**Current stance**: No, that's retailer's business.

**Could argue**: Transparency helps avoid gray market issues.

**Decision**: Default to privacy, add opt-in visibility if needed.

---

### 3. Retailer Can Connect to Multiple Suppliers?
Yes, that's the goal. One retailer can have many suppliers.

**Implication**: Retailer UI needs to handle browsing multiple catalogs, comparing, etc.

---

### 4. Can a Shop Be Both Supplier and Retailer?
Yes, the `role` field supports `BOTH`.

**Example**: A brand that also resells complementary products from other brands.

**Implementation**: UI adapts to show both supplier and retailer nav items.

---

### 5. Handling Product Variants?
Each variant is a separate `SupplierProduct` row.

**Rationale**: Variants can have different wholesale prices, inventory, SKUs.

**UI**: Group by product for display, but allow per-variant configuration.

---

### 6. What Happens When Supplier Deletes Product?
Webhook fires → we mark `SupplierProduct` as inactive.

For ProductMappings:
- If retailer imported, we DON'T auto-delete from their store (they may have sales history)
- We mark mapping as `DISCONTINUED` and stop syncing
- Retailer sees warning: "Supplier discontinued this product"

---

### 7. Can Retailer Edit Imported Product Details?
After import, retailer owns that product in their Shopify.

**Sync options**:
- Inventory: recommended to sync (stay accurate)
- Pricing: retailer controls retail price, sync wholesale cost only
- Description/images: retailer can choose sync or manual override

**Philosophy**: Give control to retailer, they know their brand.

---

## Risks and Mitigations

### Risk: Shopify Launches Competing Feature
**Mitigation**:
- Stay close to merchants, understand needs Shopify won't prioritize
- Our network effects (multi-shop connections) are hard to replicate
- We can move faster than Shopify

---

### Risk: Low Network Effects (Chicken-Egg)
**Mitigation**:
- Target existing relationships (no cold start)
- Supplier brings their retailers, not the other way around
- Value exists even with 1 supplier + 1 retailer (saves them time)

---

### Risk: Faire Retaliates
**Mitigation**:
- We're not competing on discovery
- Our model is fundamentally different (SaaS vs marketplace)
- Brands can use both (Faire for discovery, Cartrel for repeat)

---

## Changelog

**2025-11-10**: Initial decisions document created

---

**Document Status**: Living document, update as decisions are made
