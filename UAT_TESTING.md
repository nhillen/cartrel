# UAT Testing Guide

## Overview
This guide explains how to test Cartrel features during UAT, including how to bypass payment for testing different plan tiers.

---

## Testing Plan Upgrades/Downgrades

### Using the UAT Plan Manager Script

For UAT testing, you can change shop plans without going through Shopify billing:

```bash
cd backend
npm run uat:plan <shop-domain> <plan>
```

**Example:**
```bash
# Upgrade test supplier to STARTER plan
npm run uat:plan test-supplier.myshopify.com STARTER

# Downgrade to FREE plan
npm run uat:plan test-supplier.myshopify.com FREE

# Try PRO tier
npm run uat:plan test-supplier.myshopify.com PRO
```

**Valid Plans:**
- `FREE` - 3 connections, 25 products, 10 orders/month
- `STARTER` - 5 connections, 500 products, 100 orders/month
- `CORE` - 10 connections, 1,500 products, 300 orders/month
- `PRO` - 20 connections, 5,000 products, 800 orders/month
- `GROWTH` - 40 connections, 20,000 products, 2,000 orders/month
- `SCALE` - 80 connections, 100,000 products, 5,000 orders/month

### Alternative: Database Direct Access

If you have database access, you can also update plans directly:

```sql
-- View current plan
SELECT "myshopifyDomain", plan FROM "Shop" WHERE "myshopifyDomain" = 'your-shop.myshopify.com';

-- Update plan
UPDATE "Shop" SET plan = 'STARTER' WHERE "myshopifyDomain" = 'your-shop.myshopify.com';
```

---

## Testing Product Limits

### Test 1.1: Free Tier Product Limit (25 products)

1. Set shop to FREE plan:
   ```bash
   npm run uat:plan supplier-shop.myshopify.com FREE
   ```

2. Mark 25 products as wholesale in the app (should succeed)

3. Try to mark 26th product - **should fail** with error:
   ```json
   {
     "error": "You've reached your plan limit of 25 wholesale products...",
     "upgradeRequired": true,
     "currentCount": 25,
     "limit": 25
   }
   ```

4. Upgrade to STARTER:
   ```bash
   npm run uat:plan supplier-shop.myshopify.com STARTER
   ```

5. Try marking 26th product again - **should succeed**

### Test 1.1: Bulk Wholesale Selection

Test the new bulk endpoint:

```bash
curl -X POST http://localhost:3000/api/supplier/products/wholesale/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "shop": "supplier-shop.myshopify.com",
    "productIds": [123, 456, 789, 101112],
    "isWholesale": true
  }'
```

**Expected response:**
```json
{
  "success": true,
  "results": {
    "succeeded": [123, 456, 789, 101112],
    "failed": []
  },
  "summary": {
    "total": 4,
    "succeeded": 4,
    "failed": 0
  }
}
```

**Test limit enforcement with bulk:**
- Set shop to FREE plan (25 product limit)
- Mark 20 products as wholesale
- Try to bulk-add 10 more products
- **Should fail** with detailed error showing it would exceed limit

---

## Testing Connection Limits

### Test 1.1: Free Tier Connection Limit (3 connections)

1. Set shop to FREE plan
2. Create 3 connections (should succeed)
3. Try to create 4th connection - **should fail** with upgrade prompt

### Test 1.3: Add-ons (Future)

Will be tested via CS Admin Tool when implemented.

---

## Testing Order Limits

### Test 1.1: Free Tier Order Limit (10 orders/month)

1. Set shop to FREE plan
2. Create 10 purchase orders (should succeed)
3. Try to create 11th order - **should fail** with upgrade prompt

**Note:** Monthly limits reset every 30 days from `currentPeriodStart`

---

## Testing Different Tiers

All tier limits are now testable using the plan manager script:

### Starter Tier Test
```bash
npm run uat:plan shop.myshopify.com STARTER
```
- Try creating 5 connections ✅
- Try creating 6th connection ❌
- Mark 500 products as wholesale ✅
- Try 501st product ❌

### Core Tier Test
```bash
npm run uat:plan shop.myshopify.com CORE
```
- 10 connections ✅
- 1,500 products ✅
- 300 orders/month ✅

And so on for PRO, GROWTH, SCALE tiers...

---

## Important Notes

### For UAT Testers
- The `npm run uat:plan` script is for testing only
- It directly updates the database without billing
- All plan changes are logged in the audit log
- This will be replaced by the CS Admin Tool in production

### For Production
- Real customers will use the Shopify billing flow
- CS team will use the Admin Tool to:
  - Manually upgrade/downgrade shops
  - Grant comped plans
  - Manage credits
  - Override limits for special cases

---

## Troubleshooting

### Script not found?
Make sure you're in the `backend` directory:
```bash
cd backend
npm run uat:plan <shop> <plan>
```

### Shop not found?
Check the shop exists in the database:
```bash
npm run db:studio
# Then browse to the Shop table
```

### Need to check current plan?
```bash
npm run db:studio
# Or query directly:
psql -d cartrel -c "SELECT myshopifyDomain, plan FROM Shop;"
```

---

## Next: CS Admin Tool

The UAT plan manager script will be replaced with a full CS Admin interface that includes:
- Shop search and management
- Plan upgrades/downgrades with credits
- Connection management
- Usage monitoring
- Audit log viewer
- Bulk operations
- Analytics dashboard

See separate CS Admin Tool design doc (TBD).
