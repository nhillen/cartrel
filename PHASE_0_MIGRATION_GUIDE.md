# Phase 0 Migration Guide: Schema & Pricing Foundation

**Date:** November 17, 2025
**Phase:** 0 - Database Schema & Pricing Updates
**Estimated Duration:** 2-3 days
**Risk Level:** LOW (additive changes only, no destructive operations)

---

## Overview

This guide documents the database schema changes and code updates required to implement Cartrel's new 6-tier pricing model and prepare for Syncio-competitive features.

**Objectives:**
1. Add CORE and PRO plan tiers
2. Implement grandfathering for existing customers
3. Add product SKU tracking (new usage metric)
4. Support add-on purchases (+connections, +orders)
5. Expand ProductMapping for granular sync control
6. Add conflict resolution and rollback capabilities
7. Create tables for variant mapping, snapshots, and order routing

---

## Pre-Migration Checklist

- [ ] Backup production database
- [ ] Test migrations on production snapshot locally
- [ ] Review all changes with team
- [ ] Plan rollback strategy
- [ ] Schedule maintenance window (migrations take ~5 minutes)

---

## Migration Sequence

### Migration 1: Add CORE and PRO Plan Tiers

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_add_core_pro_plans/migration.sql`

```sql
-- Add new plan tiers to ShopPlan enum
ALTER TYPE "ShopPlan" ADD VALUE IF NOT EXISTS 'CORE';
ALTER TYPE "ShopPlan" ADD VALUE IF NOT EXISTS 'PRO';
```

**Rollback:** Cannot remove enum values in PostgreSQL without dropping/recreating type (KEEP)

**Risk:** LOW - Enum additions are safe

---

### Migration 2: Add Plan Version for Grandfathering

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_add_plan_version/migration.sql`

```sql
-- Add planVersion field for price grandfathering
ALTER TABLE "Shop"
ADD COLUMN "planVersion" TEXT DEFAULT 'v1';

-- Set existing shops to legacy pricing
UPDATE "Shop"
SET "planVersion" = 'legacy_wholesale_2024'
WHERE "createdAt" < NOW();

-- Future shops will get 'v1' by default
```

**Schema Change:**
```prisma
model Shop {
  // ... existing fields ...
  planVersion      String?  @default("v1")
}
```

**Rollback:**
```sql
ALTER TABLE "Shop" DROP COLUMN "planVersion";
```

**Risk:** LOW - New optional field with safe default

**Business Logic:**
- `planVersion="legacy_wholesale_2024"` → Use old pricing ($99/$299/$799)
- `planVersion="v1"` → Use new pricing ($15/$29/$49/$99/$199)
- Future price changes → Increment to "v2", keeping "v1" users grandfathered

---

### Migration 3: Add Product SKU Tracking

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_add_product_sku_tracking/migration.sql`

```sql
-- Add product SKU counter for new usage limits
ALTER TABLE "Shop"
ADD COLUMN "productSKUsThisMonth" INTEGER NOT NULL DEFAULT 0;

-- Initialize counts for existing shops
UPDATE "Shop" SET "productSKUsThisMonth" = (
  SELECT COUNT(*)
  FROM "SupplierProduct"
  WHERE "SupplierProduct"."supplierShopId" = "Shop"."id"
    AND "SupplierProduct"."isWholesaleEligible" = true
);
```

**Schema Change:**
```prisma
model Shop {
  // ... existing fields ...
  productSKUsThisMonth Int @default(0) // NEW
}
```

**Rollback:**
```sql
ALTER TABLE "Shop" DROP COLUMN "productSKUsThisMonth";
```

**Risk:** LOW - New field with safe default

**Business Logic:**
- Increment when marking product as `isWholesaleEligible=true`
- Reset to 0 monthly (based on `currentPeriodStart`)
- Enforce plan limits before allowing new wholesale products

---

### Migration 4: Add Add-On Tracking

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_add_addon_tracking/migration.sql`

```sql
-- Add add-on purchase tracking
ALTER TABLE "Shop"
ADD COLUMN "addOnConnections" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "addOnOrders" INTEGER NOT NULL DEFAULT 0;

-- No data migration needed (all shops start with 0 add-ons)
```

**Schema Change:**
```prisma
model Shop {
  // ... existing fields ...
  addOnConnections Int @default(0) // NEW - purchased connection add-ons (+10 each)
  addOnOrders      Int @default(0) // NEW - purchased order add-ons (+1000 each)
}
```

**Rollback:**
```sql
ALTER TABLE "Shop" DROP COLUMN "addOnConnections";
ALTER TABLE "Shop" DROP COLUMN "addOnOrders";
```

**Risk:** LOW - New fields with safe defaults

**Business Logic:**
- `addOnConnections=1` → +10 connections (total = base + 10)
- `addOnOrders=2` → +2,000 orders (total = base + 2,000)
- Purchased via billing.ts (new endpoint needed in future)

---

### Migration 5: Expand ProductMapping Sync Toggles

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_expand_product_mapping_sync/migration.sql`

```sql
-- Add granular sync toggles
ALTER TABLE "ProductMapping"
ADD COLUMN "syncTitle" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "syncTags" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "syncSEO" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "syncMetafields" JSONB;

-- Existing mappings default to syncing title, but not tags/SEO/metafields
```

**Schema Change:**
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
  syncSEO          Boolean @default(false)
  syncMetafields   Json?                   // Array of metafield keys, e.g., ["custom.size_chart", "custom.care_instructions"]
}
```

**Rollback:**
```sql
ALTER TABLE "ProductMapping"
DROP COLUMN "syncTitle",
DROP COLUMN "syncTags",
DROP COLUMN "syncSEO",
DROP COLUMN "syncMetafields";
```

**Risk:** LOW - New fields with safe defaults

**Business Logic (Future):**
- `syncTitle=true` → Copy supplier title to retailer title on update
- `syncTags=true` → Merge supplier tags into retailer tags
- `syncSEO=true` → Sync SEO title and description
- `syncMetafields=["custom.size_chart"]` → Sync only specified metafields

---

### Migration 6: Add Conflict Resolution Fields

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_add_conflict_resolution/migration.sql`

```sql
-- Add conflict detection and resolution
CREATE TYPE "ConflictMode" AS ENUM ('SUPPLIER_WINS', 'RETAILER_WINS', 'REVIEW_QUEUE');

ALTER TABLE "ProductMapping"
ADD COLUMN "imageChecksum" TEXT,
ADD COLUMN "lastSyncHash" TEXT,
ADD COLUMN "conflictMode" "ConflictMode" NOT NULL DEFAULT 'SUPPLIER_WINS';

-- No data migration needed
```

**Schema Change:**
```prisma
enum ConflictMode {
  SUPPLIER_WINS  // Auto-apply supplier changes (default)
  RETAILER_WINS  // Ignore supplier changes
  REVIEW_QUEUE   // Queue changes for manual approval
}

model ProductMapping {
  // ... existing fields ...

  // NEW:
  imageChecksum    String?       // SHA256 hash of image URLs (for dedupe)
  lastSyncHash     String?       // Hash of all synced fields (detect changes)
  conflictMode     ConflictMode  @default(SUPPLIER_WINS)
}
```

**Rollback:**
```sql
ALTER TABLE "ProductMapping"
DROP COLUMN "imageChecksum",
DROP COLUMN "lastSyncHash",
DROP COLUMN "conflictMode";

DROP TYPE "ConflictMode";
```

**Risk:** LOW - New optional fields, safe enum

**Business Logic (Future - Phase 5):**
- `imageChecksum` → Compare SHA256 before updating images (avoid re-upload if identical)
- `lastSyncHash` → Hash of `{title, price, description, etc.}` to detect changes
- `conflictMode=SUPPLIER_WINS` → Auto-apply all changes (default behavior)
- `conflictMode=REVIEW_QUEUE` → Store in PendingSync table, require approval

---

### Migration 7: Add SupplierProduct Matching Fields

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_add_supplier_product_matching/migration.sql`

```sql
-- Add fields for matching ladder (barcode -> SKU -> options)
ALTER TABLE "SupplierProduct"
ADD COLUMN "barcode" TEXT,
ADD COLUMN "seoTitle" TEXT,
ADD COLUMN "seoDescription" TEXT,
ADD COLUMN "metafieldsData" JSONB;

-- Create index on barcode for fast lookups
CREATE INDEX "SupplierProduct_barcode_idx" ON "SupplierProduct"("barcode") WHERE "barcode" IS NOT NULL;

-- Populate barcodes from Shopify (future task - requires API call)
```

**Schema Change:**
```prisma
model SupplierProduct {
  // ... existing fields ...

  // NEW:
  barcode          String?  @index // For matching ladder
  seoTitle         String?          // SEO title (if different from product title)
  seoDescription   String?  @db.Text
  metafieldsData   Json?            // Cached custom fields
}
```

**Rollback:**
```sql
DROP INDEX "SupplierProduct_barcode_idx";

ALTER TABLE "SupplierProduct"
DROP COLUMN "barcode",
DROP COLUMN "seoTitle",
DROP COLUMN "seoDescription",
DROP COLUMN "metafieldsData";
```

**Risk:** LOW - New optional fields, index is safe

**Business Logic (Future - Phase 1):**
- Matching ladder: Try barcode first → then SKU → then manual selection
- Fetch barcode from Shopify API when syncing products
- Store metafields for granular sync control

---

### Migration 8: Create VariantMapping Table

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_create_variant_mapping/migration.sql`

```sql
-- Create variant-level mapping table
CREATE TABLE "VariantMapping" (
  "id" TEXT NOT NULL,
  "productMappingId" TEXT NOT NULL,
  "supplierVariantId" TEXT NOT NULL,
  "supplierOptions" JSONB NOT NULL,
  "retailerVariantId" TEXT NOT NULL,
  "retailerOptions" JSONB NOT NULL,
  "manuallyMapped" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VariantMapping_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint (one mapping per supplier variant per product mapping)
CREATE UNIQUE INDEX "VariantMapping_productMappingId_supplierVariantId_key"
ON "VariantMapping"("productMappingId", "supplierVariantId");

-- Create indexes for fast lookups
CREATE INDEX "VariantMapping_productMappingId_idx" ON "VariantMapping"("productMappingId");
CREATE INDEX "VariantMapping_supplierVariantId_idx" ON "VariantMapping"("supplierVariantId");
CREATE INDEX "VariantMapping_retailerVariantId_idx" ON "VariantMapping"("retailerVariantId");

-- Add foreign key constraint
ALTER TABLE "VariantMapping"
ADD CONSTRAINT "VariantMapping_productMappingId_fkey"
FOREIGN KEY ("productMappingId")
REFERENCES "ProductMapping"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
```

**Schema Change:**
```prisma
model VariantMapping {
  id                       String         @id @default(cuid())

  // Linked to ProductMapping
  productMappingId         String
  productMapping           ProductMapping @relation(fields: [productMappingId], references: [id], onDelete: Cascade)

  // Supplier variant
  supplierVariantId        String
  supplierOptions          Json           // { "Size": "Small", "Color": "Red" }

  // Retailer variant
  retailerVariantId        String
  retailerOptions          Json           // { "Size": "S", "Color": "Red" }

  // Manual override flag
  manuallyMapped           Boolean        @default(false)

  createdAt                DateTime       @default(now())
  updatedAt                DateTime       @updatedAt

  @@unique([productMappingId, supplierVariantId])
  @@index([productMappingId])
  @@index([supplierVariantId])
  @@index([retailerVariantId])
}
```

**Rollback:**
```sql
DROP TABLE "VariantMapping";
```

**Risk:** LOW - New table, no existing data

**Business Logic (Future - Phase 5):**
- Handle variant option mismatches (e.g., "Small" vs "S")
- Auto-mapping: Try exact match first → then fuzzy match → then manual
- `manuallyMapped=true` → Don't auto-update this mapping (user override)

---

### Migration 9: Create ProductSnapshot Table

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_create_product_snapshot/migration.sql`

```sql
-- Create snapshot table for 30-day rollback
CREATE TABLE "ProductSnapshot" (
  "id" TEXT NOT NULL,
  "retailerShopId" TEXT NOT NULL,
  "retailerProductId" TEXT NOT NULL,
  "retailerVariantId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "changedBy" TEXT NOT NULL,
  "sourceProductMappingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- Create indexes for fast rollback queries
CREATE INDEX "ProductSnapshot_retailerShopId_retailerProductId_createdAt_idx"
ON "ProductSnapshot"("retailerShopId", "retailerProductId", "createdAt");

CREATE INDEX "ProductSnapshot_createdAt_idx" ON "ProductSnapshot"("createdAt");
```

**Schema Change:**
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
  @@index([createdAt])
}
```

**Rollback:**
```sql
DROP TABLE "ProductSnapshot";
```

**Risk:** LOW - New table, no existing data

**Business Logic (Future - Phase 5):**
- Snapshot every field change (title, price, inventory, etc.)
- Retention: 30 days (cron job deletes old snapshots)
- Rollback: "Revert to Nov 1" → find all snapshots after that date → apply reverse changes

**Maintenance:**
- Add cron job: Delete snapshots older than 30 days daily

---

### Migration 10: Create OrderRouterRule Table

**File:** Create `backend/prisma/migrations/YYYYMMDDHHMMSS_create_order_router_rule/migration.sql`

```sql
-- Create order routing rules (multi-vendor splitting)
CREATE TYPE "RouterRuleType" AS ENUM ('VENDOR', 'TAG', 'COLLECTION');

CREATE TABLE "OrderRouterRule" (
  "id" TEXT NOT NULL,
  "retailerShopId" TEXT NOT NULL,
  "type" "RouterRuleType" NOT NULL,
  "matchValue" TEXT NOT NULL,
  "targetSupplierId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderRouterRule_pkey" PRIMARY KEY ("id")
);

-- Create indexes for rule matching
CREATE INDEX "OrderRouterRule_retailerShopId_enabled_idx"
ON "OrderRouterRule"("retailerShopId", "enabled");

CREATE INDEX "OrderRouterRule_priority_idx" ON "OrderRouterRule"("priority");
```

**Schema Change:**
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

**Rollback:**
```sql
DROP TABLE "OrderRouterRule";
DROP TYPE "RouterRuleType";
```

**Risk:** LOW - New table, feature not used yet

**Business Logic (Future - Phase 2 Advanced):**
- When retailer creates order with items from multiple suppliers → split into multiple PurchaseOrders
- Example: Products tagged "brand-acme" → route to Supplier A
- Priority determines rule precedence (lower number = higher priority)

---

## Code Changes

### 1. Update Plan Limits Configuration

**File:** `/backend/src/utils/planLimits.ts`

**Current Lines 74-101:**
```typescript
export const PLAN_LIMITS: Record<ShopPlan, PlanLimits> = {
  FREE: {
    connections: 2,
    ordersPerMonth: 10,
  },
  STARTER: {
    connections: 5,
    ordersPerMonth: 100,
  },
  GROWTH: {
    connections: 25,
    ordersPerMonth: 1000,
  },
  SCALE: {
    connections: 999999,
    ordersPerMonth: 999999,
  },
};
```

**New:**
```typescript
interface PlanLimits {
  connections: number;
  products: number;
  ordersPerMonth: number;
  price: {
    monthly: number;
    annual: number;
  };
}

export const PLAN_LIMITS: Record<ShopPlan, PlanLimits> = {
  FREE: {
    connections: 3,
    products: 25,
    ordersPerMonth: 10,
    price: { monthly: 0, annual: 0 },
  },
  STARTER: {
    connections: 5,
    products: 500,
    ordersPerMonth: 100,
    price: { monthly: 15, annual: 150 },
  },
  CORE: {
    connections: 10,
    products: 1500,
    ordersPerMonth: 300,
    price: { monthly: 29, annual: 290 },
  },
  PRO: {
    connections: 20,
    products: 5000,
    ordersPerMonth: 800,
    price: { monthly: 49, annual: 490 },
  },
  GROWTH: {
    connections: 40,
    products: 20000,
    ordersPerMonth: 2000,
    price: { monthly: 99, annual: 990 },
  },
  SCALE: {
    connections: 80,
    products: 100000,
    ordersPerMonth: 5000,
    price: { monthly: 199, annual: 1990 },
  },
};

export const ADD_ON_PRICING = {
  connections: { qty: 10, price: 30 },
  orders: { qty: 1000, price: 25 },
  team: { shops: 3, price: 199 },
};

// Helper to calculate effective limits with add-ons
export function getEffectiveLimits(shop: {
  plan: ShopPlan;
  addOnConnections?: number;
  addOnOrders?: number;
}) {
  const baseLimits = PLAN_LIMITS[shop.plan];
  return {
    connections: baseLimits.connections + (shop.addOnConnections || 0) * ADD_ON_PRICING.connections.qty,
    products: baseLimits.products,
    ordersPerMonth: baseLimits.ordersPerMonth + (shop.addOnOrders || 0) * ADD_ON_PRICING.orders.qty,
  };
}
```

---

### 2. Update Billing Routes

**File:** `/backend/src/routes/billing.ts`

**Current Lines 37-75:**
```typescript
const PLAN_PRICES: Record<Exclude<ShopPlan, "FREE">, { monthly: number; annual: number }> = {
  STARTER: { monthly: 99, annual: 950 },
  GROWTH: { monthly: 299, annual: 2870 },
  SCALE: { monthly: 799, annual: 7670 },
};
```

**New:**
```typescript
const PLAN_PRICES: Record<Exclude<ShopPlan, "FREE">, { monthly: number; annual: number }> = {
  STARTER: { monthly: 15, annual: 150 },
  CORE: { monthly: 29, annual: 290 },
  PRO: { monthly: 49, annual: 490 },
  GROWTH: { monthly: 99, annual: 990 },
  SCALE: { monthly: 199, annual: 1990 },
};

// Note: Annual = 10 months price (2 months free)
// Example: STARTER annual = 15 * 10 = 150 (vs 15 * 12 = 180)
```

**Update `createSubscription()` function to handle CORE and PRO plans:**

```typescript
router.post("/upgrade", requireAuth, async (req, res) => {
  // ... existing validation ...

  // Add validation for new plan tiers
  const validPlans = ["STARTER", "CORE", "PRO", "GROWTH", "SCALE"];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  // ... rest of existing logic ...
});
```

---

### 3. Add SKU Tracking to Usage Endpoint

**File:** `/backend/src/routes/shop.ts`

**Current Lines 52-138:**
```typescript
router.get("/usage", requireAuth, async (req, res) => {
  const { shop } = req;

  // Count connections
  const connectionCount = await prisma.connection.count({
    where: {
      OR: [
        { supplierShopId: shop.id, status: "ACTIVE" },
        { retailerShopId: shop.id, status: "ACTIVE" },
      ],
    },
  });

  const limits = getPlanLimits(shop.plan);

  return res.json({
    connections: {
      current: connectionCount,
      limit: limits.connections,
      percentage: Math.round((connectionCount / limits.connections) * 100),
    },
    orders: {
      current: shop.purchaseOrdersThisMonth,
      limit: limits.ordersPerMonth,
      percentage: Math.round((shop.purchaseOrdersThisMonth / limits.ordersPerMonth) * 100),
    },
  });
});
```

**New:**
```typescript
router.get("/usage", requireAuth, async (req, res) => {
  const { shop } = req;

  // Count active connections
  const connectionCount = await prisma.connection.count({
    where: {
      OR: [
        { supplierShopId: shop.id, status: "ACTIVE" },
        { retailerShopId: shop.id, status: "ACTIVE" },
      ],
    },
  });

  // Count wholesale-eligible products
  const productCount = await prisma.supplierProduct.count({
    where: {
      supplierShopId: shop.id,
      isWholesaleEligible: true,
    },
  });

  // Get base limits
  const baseLimits = getPlanLimits(shop.plan);

  // Calculate effective limits with add-ons
  const effectiveConnectionLimit = baseLimits.connections + (shop.addOnConnections || 0) * 10;
  const effectiveOrderLimit = baseLimits.ordersPerMonth + (shop.addOnOrders || 0) * 1000;

  return res.json({
    connections: {
      current: connectionCount,
      limit: effectiveConnectionLimit,
      baseLimit: baseLimits.connections,
      addOnQty: shop.addOnConnections || 0,
      percentage: Math.round((connectionCount / effectiveConnectionLimit) * 100),
    },
    products: {
      current: productCount,
      limit: baseLimits.products,
      percentage: Math.round((productCount / baseLimits.products) * 100),
    },
    orders: {
      current: shop.purchaseOrdersThisMonth,
      limit: effectiveOrderLimit,
      baseLimit: baseLimits.ordersPerMonth,
      addOnQty: shop.addOnOrders || 0,
      percentage: Math.round((shop.purchaseOrdersThisMonth / effectiveOrderLimit) * 100),
    },
    planVersion: shop.planVersion, // Show grandfathered status
    upgradeRecommended: productCount > baseLimits.products * 0.8 || connectionCount > effectiveConnectionLimit * 0.8,
  });
});
```

---

## Testing Checklist

### Pre-Deployment Testing

- [ ] Run all migrations on local database
- [ ] Verify enum additions (`CORE`, `PRO`, `SUPPLIER_WINS`, etc.)
- [ ] Verify all new columns exist with correct defaults
- [ ] Verify all new tables exist with correct indexes
- [ ] Test usage endpoint returns product counts
- [ ] Test billing endpoint accepts CORE and PRO plans

### Post-Deployment Testing

- [ ] Verify existing shops have `planVersion="legacy_wholesale_2024"`
- [ ] Verify new shop creation sets `planVersion="v1"`
- [ ] Verify product SKU counts are accurate
- [ ] Verify add-on fields default to 0
- [ ] Verify no data loss or corruption
- [ ] Monitor error logs for migration issues

---

## Rollback Plan

If critical issues arise after deployment:

### Quick Rollback (Database Only)

```sql
-- Reverse migrations in opposite order (10 -> 1)

-- Migration 10 rollback
DROP TABLE "OrderRouterRule";
DROP TYPE "RouterRuleType";

-- Migration 9 rollback
DROP TABLE "ProductSnapshot";

-- Migration 8 rollback
DROP TABLE "VariantMapping";

-- Migration 7 rollback
DROP INDEX "SupplierProduct_barcode_idx";
ALTER TABLE "SupplierProduct"
DROP COLUMN "barcode",
DROP COLUMN "seoTitle",
DROP COLUMN "seoDescription",
DROP COLUMN "metafieldsData";

-- Migration 6 rollback
ALTER TABLE "ProductMapping"
DROP COLUMN "imageChecksum",
DROP COLUMN "lastSyncHash",
DROP COLUMN "conflictMode";
DROP TYPE "ConflictMode";

-- Migration 5 rollback
ALTER TABLE "ProductMapping"
DROP COLUMN "syncTitle",
DROP COLUMN "syncTags",
DROP COLUMN "syncSEO",
DROP COLUMN "syncMetafields";

-- Migration 4 rollback
ALTER TABLE "Shop"
DROP COLUMN "addOnConnections",
DROP COLUMN "addOnOrders";

-- Migration 3 rollback
ALTER TABLE "Shop" DROP COLUMN "productSKUsThisMonth";

-- Migration 2 rollback
ALTER TABLE "Shop" DROP COLUMN "planVersion";

-- Migration 1 rollback
-- CANNOT REMOVE ENUM VALUES (keep CORE and PRO)
```

### Code Rollback

```bash
git revert <commit-hash>
git push origin main
```

---

## Maintenance Tasks

### Daily
- Monitor migration logs for errors
- Check database query performance (new indexes)

### Weekly
- Review ProductSnapshot table size (should grow slowly)
- Verify planVersion distribution (how many legacy vs v1)

### Monthly
- Clean up ProductSnapshot records older than 30 days:
  ```sql
  DELETE FROM "ProductSnapshot"
  WHERE "createdAt" < NOW() - INTERVAL '30 days';
  ```

---

## Success Criteria

Phase 0 is complete when:

- [ ] All 10 migrations run successfully in production
- [ ] Existing shops locked to legacy pricing
- [ ] New shops use v1 pricing ($15/$29/$49/$99/$199)
- [ ] Usage endpoint returns product SKU counts
- [ ] Billing creates subscriptions at new price points
- [ ] No data loss or corruption
- [ ] Zero downtime during migration

---

## Next Phase

After Phase 0 completion, proceed to:

**Phase 1: Webhook Handlers** (Days 4-8)
- Implement product/update sync handlers
- Implement inventory sync handlers
- Add conflict detection logic
- Test end-to-end sync flow

---

**Document Version:** 1.0
**Last Updated:** November 17, 2025
**Status:** Ready for implementation
