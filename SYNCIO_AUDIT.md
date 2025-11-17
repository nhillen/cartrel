# Syncio Competitive Audit & Implementation Plan

**Date:** November 17, 2025
**Status:** Phase 0 - Schema & Pricing Foundation
**Objective:** Beat Syncio with better pricing, no two-sided billing, and superior migration tools

---

## Executive Summary

This document captures the comprehensive audit of Cartrel's codebase against Syncio's competitive requirements. The audit revealed **35% completion** against target features, with solid infrastructure but critical gaps in sync handlers, order forwarding, and pricing model.

### Current State Assessment

**What Works (100% Complete):**
- OAuth authentication and session management
- Multi-tenant shop architecture
- Shopify App Billing API integration
- Connection invitation system (12-char codes, 24-hour expiry)
- Basic product catalog management
- Webhook receiving infrastructure (Bull queue with retries)
- Audit logging and usage tracking tables

**Critical Gaps (0% Complete):**
- Webhook handlers (all stubbed - no product/inventory sync)
- Order forwarding (PurchaseOrders don't create draft orders in supplier Shopify)
- Variant-level mapping (multi-variant products can't sync)
- Shadow Mode (migration preview)
- Import wizard with field-level toggles
- Review queue and rollback snapshots

**Overall Readiness:** 35% complete for MVP launch against Syncio

---

## Competitive Strategy: Beating Syncio

### Pricing Posture Shift

#### Old Pricing (Cartrel Wholesale Focus)
```
FREE:    $0     - 2 connections, 10 POs/month
STARTER: $99    - 5 connections, 100 POs/month
GROWTH:  $299   - 25 connections, 1,000 POs/month
SCALE:   $799   - Unlimited connections/POs
```

**Problems:**
- Too expensive for small suppliers ($99 entry vs Syncio's ~$30)
- Limits felt stingy (2 connections on free tier)
- No clear product SKU limits (Syncio meters this)

#### New Pricing (Syncio-Competitive)
```
FREE:    $0    - 3 connections, 25 products, 10 orders/month
STARTER: $15   - 5 connections, 500 products, 100 orders/month
CORE:    $29   - 10 connections, 1,500 products, 300 orders/month
PRO:     $49   - 20 connections, 5,000 products, 800 orders/month
GROWTH:  $99   - 40 connections, 20,000 products, 2,000 orders/month
SCALE:   $199  - 80 connections, 100,000 products, 5,000 orders/month
```

**Add-Ons:**
- +10 connections: $30/month
- +1,000 orders: $25/month
- Team plan (3 stores, pooled caps): $199/month

**Promotions:**
- Annual billing: Pay for 10 months, get 12 (16.7% discount)
- Switcher credit: $100 off or 2 months free on annual plans

**Advantages:**
1. Lower entry price ($15 vs Syncio's ~$30)
2. Connection-forward (not SKU-obsessed)
3. One bill per merchant (retailer always free)
4. No paid add-on required for order forwarding

### Feature Differentiation

| Feature | Syncio | Cartrel Target | Status |
|---------|--------|---------------|--------|
| **Pricing** | Two-sided billing | Supplier-only | ✅ Implemented |
| **Order Forwarding** | Paid add-on | Included in all plans | ❌ Not built (Phase 2) |
| **Shadow Mode** | Not available | 48-72 hour preview before live sync | ❌ Not built (Phase 4) |
| **Field-Level Toggles** | Basic | Granular (title, desc, images, tags, price, metafields, SEO) | ❌ Not built (Phase 3) |
| **Variant Mapping** | Basic | Inspector with manual remap | ❌ Not built (Phase 5) |
| **Conflict Resolution** | Auto-overwrite | Review queue + 30-day rollback | ❌ Not built (Phase 5) |

---

## Database Schema Assessment

### Required Schema Changes (10 Migrations)

#### 1. Add New Plan Tiers
**File:** `backend/prisma/schema.prisma`

```prisma
enum ShopPlan {
  FREE
  STARTER
  CORE      // NEW
  PRO       // NEW
  GROWTH
  SCALE
}
```

**Migration Risk:** LOW - Enum addition, no data migration needed

---

#### 2. Add Grandfathering Support
**File:** `backend/prisma/schema.prisma`

```prisma
model Shop {
  // ... existing fields ...
  planVersion String? @default("v1") // NEW - locks pricing for early customers
}
```

**Migration Strategy:**
1. Add field as nullable with default "v1"
2. Run data migration: Set existing shops to `"legacy_wholesale_2024"`
3. Future price changes: Increment to "v2", "v3", etc.

**Migration Risk:** LOW - New optional field

---

#### 3. Add Product SKU Tracking
**File:** `backend/prisma/schema.prisma`

```prisma
model Shop {
  // ... existing fields ...
  productSKUsThisMonth Int @default(0) // NEW - count unique SKUs synced
}
```

**Logic:**
- Count distinct `SupplierProduct.id` where `isWholesaleEligible=true`
- Reset monthly on `currentPeriodStart`
- Enforce plan limits before marking new products wholesale

**Migration Risk:** LOW - New field with safe default

---

#### 4. Add Add-On Tracking
**File:** `backend/prisma/schema.prisma`

```prisma
model Shop {
  // ... existing fields ...
  addOnConnections Int @default(0) // NEW - purchased connection add-ons (+10 each)
  addOnOrders      Int @default(0) // NEW - purchased order add-ons (+1000 each)
}
```

**Migration Risk:** LOW - New fields with safe defaults

---

#### 5. Expand ProductMapping Sync Toggles
**File:** `backend/prisma/schema.prisma`

```prisma
model ProductMapping {
  // EXISTING:
  syncInventory    Boolean @default(true)
  syncPricing      Boolean @default(false)
  syncDescription  Boolean @default(false)
  syncImages       Boolean @default(false)

  // NEW:
  syncTitle        Boolean @default(true)
  syncTags         Boolean @default(false)
  syncSEO          Boolean @default(false) // SEO title + description
  syncMetafields   Json?                   // Array of metafield keys to sync
}
```

**Migration Risk:** LOW - New fields with safe defaults

---

#### 6. Add Conflict Resolution Fields
**File:** `backend/prisma/schema.prisma`

```prisma
enum ConflictMode {
  SUPPLIER_WINS  // Auto-apply supplier changes (default)
  RETAILER_WINS  // Ignore supplier changes
  REVIEW_QUEUE   // Require manual approval
}

model ProductMapping {
  // ... existing fields ...

  // NEW:
  imageChecksum    String?       // SHA256 of image URLs (dedupe)
  lastSyncHash     String?       // Hash of synced fields (detect changes)
  conflictMode     ConflictMode  @default(SUPPLIER_WINS)
}
```

**Migration Risk:** LOW - New optional fields, safe enum

---

#### 7. Add SupplierProduct Matching Fields
**File:** `backend/prisma/schema.prisma`

```prisma
model SupplierProduct {
  // ... existing fields ...

  // NEW:
  barcode          String?  @index // For matching ladder (barcode -> SKU -> options)
  seoTitle         String?          // SEO title (if different from product title)
  seoDescription   String?  @db.Text
  metafieldsData   Json?            // Custom fields to sync
}
```

**Migration Risk:** LOW - New optional fields, index is safe

---

#### 8. Create VariantMapping Table
**File:** `backend/prisma/schema.prisma`

```prisma
model VariantMapping {
  id                       String   @id @default(cuid())

  // Linked to ProductMapping
  productMappingId         String
  productMapping           ProductMapping @relation(fields: [productMappingId], references: [id], onDelete: Cascade)

  // Supplier variant
  supplierVariantId        String
  supplierOptions          Json     // { "Size": "Small", "Color": "Red" }

  // Retailer variant
  retailerVariantId        String
  retailerOptions          Json     // { "Size": "S", "Color": "Red" }

  // Manual override flag
  manuallyMapped           Boolean  @default(false)

  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([productMappingId, supplierVariantId])
  @@index([productMappingId])
  @@index([supplierVariantId])
  @@index([retailerVariantId])
}
```

**Purpose:** Handle variant option mismatches (e.g., "Small" vs "S")

**Migration Risk:** LOW - New table, no existing data

---

#### 9. Create ProductSnapshot Table
**File:** `backend/prisma/schema.prisma`

```prisma
model ProductSnapshot {
  id                    String   @id @default(cuid())

  // Retailer product being tracked
  retailerShopId        String
  retailerProductId     String   // Shopify product ID
  retailerVariantId     String   // Shopify variant ID

  // Snapshot data
  field                 String   // e.g., "title", "price", "inventory_quantity"
  value                 Json     // Field value at snapshot time

  // Metadata
  changedBy             String   // "webhook", "manual", "import"
  sourceProductMappingId String? // If changed by sync

  createdAt             DateTime @default(now())

  @@index([retailerShopId, retailerProductId, createdAt])
  @@index([createdAt]) // For 30-day retention cleanup
}
```

**Purpose:** 30-day rollback capability (field-level versioning)

**Retention:** Cron job deletes snapshots older than 30 days

**Migration Risk:** LOW - New table, no existing data

---

#### 10. Create OrderRouterRule Table
**File:** `backend/prisma/schema.prisma`

```prisma
enum RouterRuleType {
  VENDOR     // Split by product vendor
  TAG        // Split by product tag
  COLLECTION // Split by collection
}

model OrderRouterRule {
  id                String          @id @default(cuid())

  // Owner
  retailerShopId    String

  // Rule definition
  type              RouterRuleType
  matchValue        String          // Vendor name, tag, or collection ID
  targetSupplierId  String          // Route to this supplier

  // Priority (lower = higher priority)
  priority          Int             @default(0)

  // Status
  enabled           Boolean         @default(true)

  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@index([retailerShopId, enabled])
  @@index([priority])
}
```

**Purpose:** Multi-vendor order splitting (Phase 2 advanced feature)

**Example:**
- Rule: Products tagged "brand-acme" → route to Supplier A
- Rule: Products tagged "brand-widgets" → route to Supplier B

**Migration Risk:** LOW - New table, feature not used yet

---

## Code Changes Required

### 1. Update Plan Limits Configuration
**File:** `/backend/src/utils/planLimits.ts:74-101`

**Current:**
```typescript
export const PLAN_LIMITS = {
  FREE: { connections: 2, ordersPerMonth: 10 },
  STARTER: { connections: 5, ordersPerMonth: 100 },
  GROWTH: { connections: 25, ordersPerMonth: 1000 },
  SCALE: { connections: 999999, ordersPerMonth: 999999 },
};
```

**New:**
```typescript
export const PLAN_LIMITS = {
  FREE: {
    connections: 3,
    products: 25,
    ordersPerMonth: 10,
    price: { monthly: 0, annual: 0 }
  },
  STARTER: {
    connections: 5,
    products: 500,
    ordersPerMonth: 100,
    price: { monthly: 15, annual: 150 }
  },
  CORE: {
    connections: 10,
    products: 1500,
    ordersPerMonth: 300,
    price: { monthly: 29, annual: 290 }
  },
  PRO: {
    connections: 20,
    products: 5000,
    ordersPerMonth: 800,
    price: { monthly: 49, annual: 490 }
  },
  GROWTH: {
    connections: 40,
    products: 20000,
    ordersPerMonth: 2000,
    price: { monthly: 99, annual: 990 }
  },
  SCALE: {
    connections: 80,
    products: 100000,
    ordersPerMonth: 5000,
    price: { monthly: 199, annual: 1990 }
  },
};

export const ADD_ON_PRICING = {
  connections: { qty: 10, price: 30 },
  orders: { qty: 1000, price: 25 },
  team: { shops: 3, price: 199 },
};
```

---

### 2. Update Billing Charges
**File:** `/backend/src/routes/billing.ts:37-75`

**Current:**
```typescript
const PLAN_PRICES = {
  STARTER: { monthly: 99, annual: 950 },
  GROWTH: { monthly: 299, annual: 2870 },
  SCALE: { monthly: 799, annual: 7670 },
};
```

**New:**
```typescript
const PLAN_PRICES = {
  STARTER: { monthly: 15, annual: 150 },
  CORE: { monthly: 29, annual: 290 },
  PRO: { monthly: 49, annual: 490 },
  GROWTH: { monthly: 99, annual: 990 },
  SCALE: { monthly: 199, annual: 1990 },
};
```

**Note:** Update `createSubscription()` logic to handle CORE and PRO plans

---

### 3. Add SKU Tracking to Usage Endpoint
**File:** `/backend/src/routes/shop.ts:52-138`

**Current:**
```typescript
router.get("/usage", requireAuth, async (req, res) => {
  // ... existing code ...
  const limits = getPlanLimits(shop.plan);

  return res.json({
    connections: { current: connectionCount, limit: limits.connections },
    orders: { current: shop.purchaseOrdersThisMonth, limit: limits.ordersPerMonth },
  });
});
```

**New:**
```typescript
router.get("/usage", requireAuth, async (req, res) => {
  // ... existing code ...
  const limits = getPlanLimits(shop.plan);

  // Count wholesale-eligible products
  const productCount = await prisma.supplierProduct.count({
    where: {
      supplierShopId: shop.id,
      isWholesaleEligible: true,
    },
  });

  // Calculate effective limits (base + add-ons)
  const effectiveConnectionLimit = limits.connections + (shop.addOnConnections || 0) * 10;
  const effectiveOrderLimit = limits.ordersPerMonth + (shop.addOnOrders || 0) * 1000;

  return res.json({
    connections: {
      current: connectionCount,
      limit: effectiveConnectionLimit,
      baseLimit: limits.connections,
      addOnQty: shop.addOnConnections || 0
    },
    products: {
      current: productCount,
      limit: limits.products
    },
    orders: {
      current: shop.purchaseOrdersThisMonth,
      limit: effectiveOrderLimit,
      baseLimit: limits.ordersPerMonth,
      addOnQty: shop.addOnOrders || 0
    },
    planVersion: shop.planVersion, // Show grandfathered status
  });
});
```

---

## Implementation Phases

### Phase 0: Schema & Pricing Foundation (Days 1-3)
**Status:** IN PROGRESS

**Tasks:**
- [x] Audit codebase vs Syncio requirements
- [ ] Create 10 database migrations
- [ ] Update planLimits.ts with new pricing
- [ ] Update billing.ts with new Shopify charges
- [ ] Add SKU tracking to shop usage endpoint
- [ ] Test migrations on production snapshot

**Success Criteria:**
- All migrations run without errors
- Existing shops have `planVersion="legacy_wholesale_2024"`
- New shops default to `planVersion="v1"`
- Usage endpoint returns product SKU counts
- Billing creates subscriptions at new price points

---

### Phase 1: Webhook Handlers (Days 4-8)
**Status:** PLANNED

**Critical Path:** All sync features depend on this

**Files to Modify:**
- `/backend/src/queues/processors/webhook.ts` (replace TODOs)
- Create `/backend/src/services/ProductSyncService.ts`
- Create `/backend/src/services/InventorySyncService.ts`
- Create `/backend/src/services/MatchingService.ts`

**Handlers to Implement:**
1. `products/update` - Propagate changes to ProductMappings
2. `inventory_levels/update` - Sync inventory to retailers
3. `products/create` - Auto-match by barcode/SKU
4. `products/delete` - Mark mappings as DISCONTINUED
5. `app/uninstalled` - Cascade delete or pause connections

**Success Criteria:**
- Product price change in supplier → auto-updates retailer (if `syncPricing=true`)
- Inventory change → updates all mapped retailers
- Failed webhooks → retry 3x → stay in queue for inspection

---

### Phase 2: Order Forwarding (Days 9-14)
**Status:** PLANNED

**Critical Path:** Core value proposition

**Files to Modify:**
- `/backend/src/routes/retailer.ts:551-660` (add forwarding logic)
- Create `/backend/src/services/OrderForwardingService.ts`
- Add `/backend/src/routes/supplier.ts` endpoint for fulfillment

**Logic:**
1. Retailer submits PO → create draft order in supplier Shopify
2. Store `draftOrderId` in `PurchaseOrder` table
3. Supplier marks paid → convert draft to real order
4. Supplier fulfills → sync tracking back to retailer

**Success Criteria:**
- PO submission → draft order appears in supplier admin within 5 seconds
- Draft order → real order conversion works
- Tracking numbers sync back to retailer

---

### Phase 3: Import Wizard & Field Toggles (Days 15-20)
**Status:** PLANNED

**Files to Create:**
- `/backend/src/routes/retailer.ts` - Add `/import/preview` and `/import/apply` endpoints
- `/backend/src/services/ImportService.ts`
- `/frontend/src/pages/ImportWizard.tsx`

**Features:**
- Dry-run mode with diff preview
- Field-level sync toggles (title, description, images, tags, price, metafields, SEO)
- Batch import with progress tracking

---

### Phase 4: Shadow Mode & Migration Tools (Days 21-25)
**Status:** PLANNED

**Critical for Syncio switchers**

**Features:**
1. Shadow Mode: Read-only sync for 48-72 hours
2. CSV mapping import: Bulk map by SKU/barcode
3. Diff dashboard: Show what would have synced

---

### Phase 5: Variant Mapping & Conflict Safety (Days 26-32)
**Status:** PLANNED

**Features:**
1. Variant mapping inspector (manual remap)
2. Review queue for `conflictMode=REVIEW_QUEUE`
3. 30-day rollback via ProductSnapshot

---

### Phase 6: Bundles, Multi-Location, Async Imports (Days 33-40)
**Status:** PLANNED

**Advanced features:**
1. Bundles/kits (decrement multiple SKUs)
2. Multi-location mapping with safety stock
3. Chunked async imports for large catalogs

---

### Phase 7: Partner Dashboard & Polish (Days 41-45)
**Status:** PLANNED

**Features:**
1. Agency/partner multi-shop management
2. Public status page (Statuspage.io)
3. Connection health panel (metrics dashboard)

---

## Risk Assessment

### High-Impact Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Schema migration breaks existing data | LOW | CRITICAL | Test on production snapshot first |
| Webhook handlers fail in production | MEDIUM | HIGH | Extensive error logging + DLQ monitoring |
| Order forwarding creates duplicate orders | MEDIUM | CRITICAL | Idempotency keys on draft order creation |
| 45-day timeline too aggressive | HIGH | MEDIUM | Ship Phases 0-4 as MVP (25 days) |
| Pricing change confuses existing users | MEDIUM | MEDIUM | Email migration notice + grandfathering |

### Mitigation Strategies

1. **Data Safety:**
   - Always test migrations on production snapshot
   - Add `planVersion` before changing prices
   - Never destructive migrations (only additive)

2. **Webhook Reliability:**
   - Dead-letter queue for failed jobs
   - Bull Board monitoring dashboard
   - Alerting on queue backlog > 100

3. **Order Forwarding Safety:**
   - Generate idempotency key per PurchaseOrder
   - Store `draftOrderId` before making API call
   - Add `forwardingError` field to track failures

4. **Timeline Management:**
   - Cut Phases 6-7 if needed (bundles, agencies)
   - Ship MVP at 25 days (Phases 0-4)
   - Add advanced features in Month 2

---

## KPIs to Track

### Pre-Launch (Phase 0-4 Complete)
- Migration success rate: 100% (all shops migrated without errors)
- Webhook handler success rate: >99%
- Order forwarding success rate: >95%
- Shadow Mode adoption: >50% of Syncio switchers

### Post-Launch
- Trial to first sync: <1 hour
- Trial to first forwarded order: <24 hours
- Tickets per paying store: <0.2/week
- Free → Starter conversion: >25% within 14 days
- Monthly churn: <3%
- Infra spend: <5% of MRR

---

## Next Steps

**Immediate (Phase 0):**
1. Create 10 database migrations
2. Update planLimits.ts and billing.ts
3. Add SKU tracking to usage endpoint
4. Test on production snapshot
5. Deploy to staging

**After Phase 0:**
1. Implement webhook handlers (Phase 1)
2. Build order forwarding (Phase 2)
3. Create import wizard (Phase 3)
4. Add Shadow Mode (Phase 4)

---

## Appendix: File Locations

### Critical Files for Phase 0
- Schema: `/backend/prisma/schema.prisma`
- Plan limits: `/backend/src/utils/planLimits.ts`
- Billing: `/backend/src/routes/billing.ts`
- Usage: `/backend/src/routes/shop.ts`

### Critical Files for Phase 1
- Webhook processor: `/backend/src/queues/processors/webhook.ts`
- Shopify service: `/backend/src/services/shopify.ts`

### Critical Files for Phase 2
- Retailer routes: `/backend/src/routes/retailer.ts`
- Supplier routes: `/backend/src/routes/supplier.ts`

---

**Document Version:** 1.0
**Last Updated:** November 17, 2025
**Status:** Phase 0 in progress
