# Cartrel UAT (User Acceptance Testing) Plan

## Overview
This document provides a comprehensive testing plan for all features built in Cartrel Phases 0-5. Tests are organized by user role and feature area.

---

## Test Environment Setup

### Prerequisites
- [ ] 2 Shopify development stores (1 supplier, 1 retailer)
- [ ] Cartrel app installed on both stores
- [ ] Test products created in supplier store
- [ ] PostgreSQL database accessible
- [ ] Redis running (for queues)
- [ ] Access to logs for debugging

### Test Data Setup
- [ ] Supplier store: 25+ products with variants (S/M/L, Red/Blue/Green)
- [ ] Supplier store: Products at various price points ($10, $50, $100)
- [ ] Supplier store: Products with/without images
- [ ] Retailer store: Empty catalog initially

---

## Phase 0: Schema & Pricing Foundation

### Test 1.1: Plan Limits Enforcement
**Objective**: Verify plan limits are enforced correctly

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Free tier connection limit | 1. Create 3 connections<br>2. Attempt 4th connection | Blocked with upgrade prompt | ☐ |
| Free tier product limit | 1. Mark 25 products wholesale<br>2. Attempt 26th | Blocked with upgrade prompt | ☐ |
| Starter tier limits | 1. Upgrade to Starter<br>2. Create 5 connections<br>3. Mark 500 products | All allowed | ☐ |
| Order limit enforcement | 1. Create 10 POs in Free tier<br>2. Attempt 11th | Blocked with upgrade prompt | ☐ |

### Test 1.2: Grandfathering
**Objective**: Verify early customers get locked pricing

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Set plan version | 1. Create shop with planVersion='legacy_2024'<br>2. Check pricing | Legacy pricing applied | ☐ |
| New shop gets current pricing | 1. Create new shop (no planVersion)<br>2. Check pricing | Current pricing applied | ☐ |

### Test 1.3: Add-ons
**Objective**: Verify add-ons work correctly

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Extra connections add-on | 1. Starter plan (5 conn)<br>2. Purchase +10 connections add-on<br>3. Create 15 connections | All 15 allowed | ☐ |
| Extra orders add-on | 1. Starter plan (100 orders)<br>2. Purchase +1000 orders add-on<br>3. Create 1100 orders | All 1100 allowed | ☐ |

---

## Phase 1: Webhook Handlers

### Test 2.1: Product Sync
**Objective**: Verify real-time product synchronization

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Product update triggers sync | 1. Create ProductMapping<br>2. Update product title in supplier Shopify<br>3. Wait 10 seconds | Retailer product title updated | ☐ |
| Price update with markup | 1. Supplier price: $10<br>2. Retailer markup: 50%<br>3. Update supplier price to $15 | Retailer price: $22.50 | ☐ |
| Description sync (enabled) | 1. Enable syncDescription<br>2. Update description | Retailer description updated | ☐ |
| Description sync (disabled) | 1. Disable syncDescription<br>2. Update description | Retailer description unchanged | ☐ |
| Tags sync (enabled) | 1. Enable syncTags<br>2. Update tags | Retailer tags updated | ☐ |
| SEO sync | 1. Enable syncSEO<br>2. Update SEO title/description | Retailer SEO updated | ☐ |
| Change detection (no sync) | 1. Update product<br>2. Immediately update back to original | 1 webhook, 0 Shopify API calls | ☐ |

### Test 2.2: Inventory Sync
**Objective**: Verify real-time inventory synchronization

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Inventory update | 1. Supplier inventory: 100<br>2. Update to 50 | Retailer inventory: 50 | ☐ |
| Inventory sync (disabled) | 1. Disable syncInventory<br>2. Update inventory | Retailer inventory unchanged | ☐ |
| Variant-level inventory | 1. Multi-variant product<br>2. Update S/Red variant inventory | Only S/Red variant updated | ☐ |

### Test 2.3: Product Deletion
**Objective**: Verify product deletion handling

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Product deleted | 1. Delete product in supplier Shopify | ProductMapping status: DISCONTINUED | ☐ |
| Product discontinued | 1. Product marked DISCONTINUED<br>2. Try to sync | Sync skipped | ☐ |

### Test 2.4: App Uninstall
**Objective**: Verify graceful app uninstall

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Uninstall as supplier | 1. Uninstall app<br>2. Check connections | All connections PAUSED<br>Shop plan: FREE | ☐ |
| Uninstall as retailer | 1. Uninstall app<br>2. Check connections | Connections PAUSED | ☐ |

---

## Phase 2: Order Forwarding

### Test 3.1: Order Creation
**Objective**: Verify end-to-end order flow

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Create draft order | 1. Retailer submits PO<br>2. Check supplier Shopify | Draft order created with correct items, pricing, tags | ☐ |
| Draft order tags | 1. Check draft order tags | Contains: wholesale, cartrel, po-{number} | ☐ |
| Draft order attributes | 1. Check custom attributes | cartrel_po_id, cartrel_po_number, retailer_shop present | ☐ |
| PO status after creation | 1. Create PO | Status: SUBMITTED | ☐ |

### Test 3.2: Order Completion
**Objective**: Verify draft → real order conversion

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Complete draft (PREPAY) | 1. Payment terms: PREPAY<br>2. Complete draft order | Status: PAID<br>paidAt: set | ☐ |
| Complete draft (NET_30) | 1. Payment terms: NET_30<br>2. Complete draft order | Status: AWAITING_PAYMENT<br>paidAt: null | ☐ |
| Payment webhook (NET_30) | 1. Mark order paid in Shopify | Status: PAID<br>paidAt: set | ☐ |

### Test 3.3: Fulfillment Tracking
**Objective**: Verify tracking sync from supplier to retailer

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Fulfill order | 1. Fulfill order in supplier Shopify<br>2. Add tracking number | PO status: SHIPPED<br>trackingNumber: set | ☐ |
| Tracking URL | 1. Add tracking URL | trackingUrl: set in PO | ☐ |
| Delivered status | 1. Shopify marks as delivered | PO status: DELIVERED | ☐ |

### Test 3.4: Order Cancellation
**Objective**: Verify order cancellation

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Cancel draft order | 1. Cancel draft order | Draft deleted<br>PO status: CANCELLED | ☐ |
| Cancel real order | 1. Complete draft<br>2. Cancel real order | Order cancelled in Shopify<br>PO status: CANCELLED | ☐ |

---

## Phase 3: Import Wizard & Health Panel

### Test 4.1: Product Import Preview
**Objective**: Verify import preview shows accurate diffs

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Preview new import | 1. Select 10 products<br>2. Set markup: 50%<br>3. Preview | Shows 10 products with pricing diffs | ☐ |
| Preview with toggles | 1. Disable syncTitle<br>2. Preview | Title diff shows "will not sync" | ☐ |
| Plan limit warning | 1. Free tier (25 products)<br>2. Preview 30 products | 5 products show "would exceed limit" | ☐ |

### Test 4.2: Bulk Import
**Objective**: Verify bulk import works correctly

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Import 10 products | 1. Select 10 products<br>2. Import | 10 ProductMappings created<br>10 products in retailer Shopify | ☐ |
| Import with preferences | 1. Disable syncDescription<br>2. Import | ProductMapping.syncDescription: false | ☐ |
| Import existing product | 1. Import product already imported | Updates existing ProductMapping | ☐ |

### Test 4.3: Async Import (Large Catalog)
**Objective**: Verify async import for 100+ products

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Queue async import | 1. Select 150 products<br>2. Start async import | ImportBatchStatus created<br>Job queued | ☐ |
| Track progress | 1. Poll /import/status/:batchId | Progress: 0% → 100%<br>Status: IN_PROGRESS → COMPLETED | ☐ |
| Import completes | 1. Wait for completion | 150 products imported<br>Status: COMPLETED | ☐ |
| Import with errors | 1. Include invalid product<br>2. Start import | Errors logged<br>Other products succeed | ☐ |

### Test 4.4: Health Panel
**Objective**: Verify health monitoring

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Health score calculation | 1. No errors | Health score: 100 | ☐ |
| Health score with errors | 1. Simulate 5 webhook errors | Health score: 75 | ☐ |
| Webhook errors shown | 1. Cause webhook failure | Error shows in /health endpoint | ☐ |
| Failed imports shown | 1. Fail async import | Batch shows in /health endpoint | ☐ |
| Sync issues shown | 1. Mark product DISCONTINUED | Shows in syncIssues array | ☐ |

### Test 4.5: Preference Updates
**Objective**: Verify bulk preference updates

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Update sync toggles | 1. Select 5 mappings<br>2. Disable syncDescription | All 5 mappings updated | ☐ |
| Update markup | 1. Change markup from 50% to 60%<br>2. Update | All mappings updated<br>Prices recalculated | ☐ |

---

## Phase 4: Shadow Mode

### Test 5.1: Pricing Comparison
**Objective**: Verify Syncio pricing comparison

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Compare pricing (small) | 1. GET /shadow/compare-pricing?connections=5&products=500&orders=100 | Cartrel: $15<br>Syncio: $29<br>Savings: 48% | ☐ |
| Compare pricing (large) | 1. connections=10&products=1500&orders=300 | Cartrel: $29<br>Syncio: $59<br>Savings: 51% | ☐ |

### Test 5.2: Feature Comparison
**Objective**: Verify feature comparison matrix

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Get feature comparison | 1. GET /shadow/compare-features | 18 features listed<br>Cartrel advantages highlighted | ☐ |

### Test 5.3: Migration Preview
**Objective**: Verify migration preview

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Preview migration | 1. Shop with 5 connections, 500 products<br>2. GET /shadow/migration-preview | Shows savings<br>Migration steps<br>Risks & benefits | ☐ |

### Test 5.4: Shadow Mode Operations
**Objective**: Verify shadow mode import/promote flow

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Enable shadow mode | 1. POST /shadow/enable | perksConfig.shadowMode: true | ☐ |
| Import in shadow mode | 1. Import 10 products | 10 ProductMappings created<br>0 Shopify products created | ☐ |
| Shadow mode stats | 1. GET /shadow/stats | shadowImports: 10<br>realImports: 0 | ☐ |
| Promote shadow imports | 1. POST /shadow/promote with mappingIds | Products created in Shopify<br>shadowImports: 0<br>realImports: 10 | ☐ |
| Disable shadow mode | 1. POST /shadow/disable | perksConfig.shadowMode: false | ☐ |

---

## Phase 5: Variant Mapping & 30-Day Rollback

### Test 6.1: Variant Auto-Matching
**Objective**: Verify auto-match for multi-variant products

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Exact match | 1. Supplier: S/Red, M/Red<br>2. Retailer: S/Red, M/Red<br>3. Auto-match | 2 exact matches | ☐ |
| Partial match | 1. Supplier: S/Red<br>2. Retailer: Small/Red<br>3. Auto-match | 1 partial match (requires manual mapping) | ☐ |
| No match | 1. Supplier: S/Red<br>2. Retailer: L/Blue<br>3. Auto-match | 0 matches | ☐ |

### Test 6.2: Manual Variant Mapping
**Objective**: Verify manual variant mapping

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Manual map variant | 1. POST /variants/manual-map<br>supplierVariantId: 123<br>retailerVariantId: 456 | VariantMapping created<br>manuallyMapped: true | ☐ |
| Get variant mappings | 1. GET /variants/mappings | Returns all variant mappings | ☐ |

### Test 6.3: Product Snapshots
**Objective**: Verify snapshot capture and rollback

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Snapshot on update | 1. Update product title | ProductSnapshot created with old title | ☐ |
| View history | 1. GET /snapshots/history?productId=123 | Shows all changes (last 30 days) | ☐ |
| Rollback field | 1. Update title<br>2. POST /snapshots/rollback-field | Title reverted to snapshot value | ☐ |
| Rollback product | 1. Update title, description, price<br>2. POST /snapshots/rollback-product | All 3 fields reverted | ☐ |
| Snapshot stats | 1. GET /snapshots/stats | Shows snapshot counts by source & field | ☐ |

### Test 6.4: Snapshot Cleanup
**Objective**: Verify auto-cleanup of old snapshots

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Create old snapshot | 1. Create snapshot dated 31 days ago<br>2. Run cleanupOldSnapshots() | Snapshot deleted | ☐ |
| Keep recent snapshot | 1. Create snapshot dated 29 days ago<br>2. Run cleanupOldSnapshots() | Snapshot kept | ☐ |

---

## Admin Console & Billing Test Mode

### Test 7.1: Billing (Shopify Test Charges)
**Objective**: Verify billing flows use Shopify `test: true` and handle state transitions

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Create test recurring charge | 1. Initiate charge with `test: true` from admin billing tab<br>2. Accept in Shopify | Charge status: ACTIVE (test)<br>Plan updated in admin | ☐ |
| Decline test charge | 1. Initiate charge with `test: true`<br>2. Decline in Shopify | Status: DECLINED<br>Plan unchanged<br>Error toast shown | ☐ |
| Cancel active test charge | 1. Active test charge<br>2. Cancel in Shopify | Status: CANCELLED<br>App downgrades plan to FREE | ☐ |
| Trial end in test mode | 1. Create test charge with `trial_days`>0<br>2. Simulate trial end (Partners or wait) | Trial -> ACTIVE transition logged<br>No real billing | ☐ |
| Frozen dev store | 1. Freeze dev store in Partners<br>2. Load admin | Billing error surfaced; plan actions blocked; guidance shown | ☐ |

### Test 7.2: Admin Console (Supplier-Scoped)
**Objective**: Verify supplier-first hierarchy and CS signals

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Supplier scoping | 1. Select supplier in sidebar<br>2. View connections tab | Only connections for selected supplier shown | ☐ |
| Product scoping | 1. Select supplier<br>2. View products tab | Only products for selected supplier shown | ☐ |
| Plan change (audit) | 1. Change plan via billing tab (test mode)<br>2. Refresh page | Plan persists; audit note visible in backend logs | ☐ |
| Connection delete safety | 1. Delete a connection from connections tab | Connection removed<br>UI refreshed<br>No orphaned data | ☐ |
| CS signals | 1. Open supplier with high counts<br>2. Check header badges | Limit/health badges visible (connections/products/POs) | ☐ |
| Toast/loader UX | 1. Trigger refresh<br>2. Trigger plan change failure | Loader shown during fetch<br>Error toast shown on failure | ☐ |

---

## End-to-End Scenarios

### Scenario 1: New Supplier Onboarding
**Objective**: Test complete supplier setup flow

1. [ ] Install Cartrel app on supplier Shopify store
2. [ ] Complete onboarding (role: SUPPLIER, plan: STARTER)
3. [ ] Mark 10 products as wholesale eligible
4. [ ] Create connection invite code
5. [ ] Share code with retailer

**Expected**: Supplier can send invite within 5 minutes

### Scenario 2: Retailer Connection & Import
**Objective**: Test complete retailer setup and import

1. [ ] Install Cartrel app on retailer Shopify store
2. [ ] Complete onboarding (role: RETAILER)
3. [ ] Redeem supplier's connection code
4. [ ] Browse supplier catalog (10 products visible)
5. [ ] Preview import with 50% markup
6. [ ] Import 5 products
7. [ ] Verify products appear in retailer Shopify

**Expected**: 5 products imported and visible in retailer store within 2 minutes

### Scenario 3: Complete Order Flow
**Objective**: Test end-to-end order lifecycle

1. [ ] Retailer creates purchase order (5 items, $250 total)
2. [ ] Draft order appears in supplier Shopify within 10 seconds
3. [ ] Supplier completes draft order
4. [ ] PO status: PAID (PREPAY) or AWAITING_PAYMENT (NET)
5. [ ] Supplier fulfills order in Shopify
6. [ ] Tracking number syncs to PO within 10 seconds
7. [ ] PO status: SHIPPED
8. [ ] Shopify marks as delivered
9. [ ] PO status: DELIVERED

**Expected**: Complete flow works within 5 minutes

### Scenario 4: Syncio Migration
**Objective**: Test zero-downtime migration from Syncio

1. [ ] Retailer currently using Syncio
2. [ ] Install Cartrel app (don't uninstall Syncio)
3. [ ] Compare pricing: GET /shadow/compare-pricing
4. [ ] Preview migration: GET /shadow/migration-preview
5. [ ] Enable shadow mode for connection
6. [ ] Import 50 products (no Shopify products created)
7. [ ] Review shadow stats: 50 shadow imports
8. [ ] Promote 10 shadow imports
9. [ ] Verify 10 products created in Shopify
10. [ ] Test for 7 days with both platforms active
11. [ ] Disable shadow mode
12. [ ] Promote remaining 40 imports
13. [ ] Uninstall Syncio

**Expected**: Zero downtime, products working throughout migration

### Scenario 5: Multi-Variant Product Sync
**Objective**: Test complex product with 9 variants

1. [ ] Supplier creates product "T-Shirt" with 9 variants (S/M/L × Red/Blue/Green)
2. [ ] Retailer imports product
3. [ ] Auto-match variants
4. [ ] Verify 9 exact matches
5. [ ] Update inventory for S/Red variant (100 → 50)
6. [ ] Verify only S/Red variant inventory updated in retailer Shopify
7. [ ] Update price (wholesale $20 → $25)
8. [ ] Verify all 9 variants updated with markup

**Expected**: All 9 variants sync correctly at variant level

---

## Performance Testing

### Test 7.1: Large Catalog Import
**Objective**: Verify performance with 1000+ products

| Test Case | Target | Actual | Status |
|-----------|--------|--------|--------|
| Async import 1000 products | < 10 minutes | _____ min | ☐ |
| Progress updates | Every 10% | _____ | ☐ |
| Memory usage | < 512MB | _____ MB | ☐ |
| Database queries | < 5000 | _____ | ☐ |

### Test 7.2: Webhook Processing Speed
**Objective**: Verify webhook processing latency

| Test Case | Target | Actual | Status |
|-----------|--------|--------|--------|
| Product update → sync complete | < 5 seconds | _____ sec | ☐ |
| Inventory update → sync complete | < 3 seconds | _____ sec | ☐ |
| Order creation → draft order | < 10 seconds | _____ sec | ☐ |

### Test 7.3: Concurrent Operations
**Objective**: Verify system handles concurrent operations

| Test Case | Target | Actual | Status |
|-----------|--------|--------|--------|
| 10 concurrent imports | All succeed | _____ | ☐ |
| 50 concurrent webhook events | All processed | _____ | ☐ |
| 100 concurrent API requests | < 500ms p95 | _____ ms | ☐ |

---

## Security Testing

### Test 8.1: Authorization
**Objective**: Verify users can only access their own data

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Access other shop's data | 1. Get auth token for Shop A<br>2. Try to access Shop B's data | 403 Forbidden | ☐ |
| Access retailer endpoint as supplier | 1. Supplier token<br>2. Call /api/retailer/* endpoint | 403 Forbidden | ☐ |
| Access connection not owned | 1. Try to access connectionId not belonging to shop | 403 Forbidden | ☐ |

### Test 8.2: Input Validation
**Objective**: Verify all inputs are validated

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Invalid productId | 1. Call endpoint with productId="<script>" | 400 Bad Request | ☐ |
| SQL injection attempt | 1. Try productId="1 OR 1=1" | 400 Bad Request or safe handling | ☐ |
| Extremely large input | 1. Send 10MB JSON payload | 413 Payload Too Large | ☐ |

### Test 8.3: Rate Limiting
**Objective**: Verify rate limiting works

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Order endpoint rate limit | 1. Send 20 order requests in 1 minute | Blocked after limit | ☐ |
| API endpoint rate limit | 1. Send 100 API requests in 1 minute | 429 Too Many Requests | ☐ |

---

## Edge Cases & Error Handling

### Test 9.1: Network Failures
**Objective**: Verify resilience to network issues

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Shopify API timeout | 1. Simulate slow Shopify response | Retry with exponential backoff | ☐ |
| Redis connection lost | 1. Stop Redis<br>2. Try to queue job | Error logged, graceful degradation | ☐ |
| Database connection lost | 1. Stop PostgreSQL<br>2. Try to read data | Error logged, 500 error returned | ☐ |

### Test 9.2: Data Inconsistencies
**Objective**: Verify handling of bad data

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Product deleted externally | 1. Delete product in Shopify<br>2. Try to sync | Error logged, mapping marked DISCONTINUED | ☐ |
| Variant mismatch | 1. Supplier has 3 variants<br>2. Retailer has 2 variants<br>3. Sync | Partial sync, error logged for missing variant | ☐ |
| Invalid webhook payload | 1. Send malformed webhook | Error logged, webhook marked as failed | ☐ |

### Test 9.3: Boundary Conditions
**Objective**: Verify handling of edge values

| Test Case | Steps | Expected Result | Status |
|-----------|-------|----------------|--------|
| Zero price product | 1. Product price: $0<br>2. Import | Imports with $0 price | ☐ |
| Negative inventory | 1. Inventory: -5 | Handled gracefully (set to 0) | ☐ |
| Very long product name | 1. Title: 500 characters | Truncated to Shopify limit | ☐ |
| Empty description | 1. Description: "" | Handles empty string | ☐ |

---

## Regression Testing Checklist

After any code changes, verify core flows still work:

- [ ] Supplier can create connection invite
- [ ] Retailer can redeem invite and connect
- [ ] Product sync works (update title, price, inventory)
- [ ] Order creation works (draft order appears in supplier Shopify)
- [ ] Order fulfillment tracking works
- [ ] Bulk import works (10 products)
- [ ] Shadow mode works (enable, import, promote)
- [ ] Variant mapping works (auto-match)
- [ ] Snapshot & rollback works

---

## Sign-Off

### Test Environment
- [ ] All tests passed in development environment
- [ ] All tests passed in staging environment
- [ ] Performance benchmarks met
- [ ] Security tests passed
- [ ] Edge cases handled

### User Acceptance
- [ ] Supplier user tested complete flow
- [ ] Retailer user tested complete flow
- [ ] Syncio migration user tested shadow mode
- [ ] Product owner approved all features

### Production Readiness
- [ ] Database migrations tested
- [ ] Rollback plan documented
- [ ] Monitoring/alerts configured
- [ ] Documentation updated
- [ ] Support team trained

---

## Test Summary

**Total Test Cases**: 150+
**Passed**: _____
**Failed**: _____
**Blocked**: _____
**Not Tested**: _____

**Pass Rate**: _____% (Target: >95%)

**Critical Issues**: _____
**Major Issues**: _____
**Minor Issues**: _____

**Ready for Production**: YES / NO

---

## Notes & Observations

[Space for testers to add observations, issues found, suggestions for improvement]

---

**Last Updated**: 2025-01-17
**Version**: 1.0
**Prepared By**: Cartrel Team
