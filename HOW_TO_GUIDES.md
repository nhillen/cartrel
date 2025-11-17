# Cartrel How-To Guides

**Last Updated**: November 17, 2025

Step-by-step guides for all major Cartrel features. Choose your role below.

---

## Table of Contents

**For Suppliers:**
1. [How to Create a Connection Invite](#1-how-to-create-a-connection-invite-supplier)
2. [How to Mark Products as Wholesale](#2-how-to-mark-products-as-wholesale-supplier)
3. [How to Set Up Multi-Location Inventory](#3-how-to-set-up-multi-location-inventory-supplier)
4. [How to Forward Orders to Your Shopify](#4-how-to-forward-orders-supplier)
5. [How to Manage Order Fulfillment](#5-how-to-manage-order-fulfillment-supplier)

**For Retailers:**
6. [How to Accept a Connection Invite](#6-how-to-accept-a-connection-invite-retailer)
7. [How to Import Products with Preview](#7-how-to-import-products-with-preview-retailer)
8. [How to Import Large Catalogs (1000+ Products)](#8-how-to-import-large-catalogs-retailer)
9. [How to Map Multi-Variant Products](#9-how-to-map-multi-variant-products-retailer)
10. [How to Use 30-Day Rollback](#10-how-to-use-30-day-rollback-retailer)
11. [How to Submit Purchase Orders](#11-how-to-submit-purchase-orders-retailer)

**For Syncio Migrators:**
12. [How to Migrate from Syncio with Shadow Mode](#12-how-to-migrate-from-syncio-shadow-mode)

**For Everyone:**
13. [How to Check Platform Status](#13-how-to-check-platform-status)
14. [How to Monitor Connection Health](#14-how-to-monitor-connection-health)
15. [How to Upgrade Your Plan](#15-how-to-upgrade-your-plan)

---

## For Suppliers

### 1. How to Create a Connection Invite (Supplier)

**Goal**: Invite a retailer to connect with your wholesale catalog

**Steps**:

1. **Log into Cartrel** in your Shopify admin
   - Navigate to Apps → Cartrel

2. **Go to Connections page**
   - Click "Connections" in sidebar

3. **Click "Create Invite"**
   - Button in top right

4. **Set Payment Terms** (optional)
   - PREPAY: Retailer pays upfront (default)
   - NET_15: Pay within 15 days
   - NET_30: Pay within 30 days
   - NET_60: Pay within 60 days

5. **Set Credit Limit** (optional)
   - Maximum amount retailer can owe
   - Leave blank for unlimited

6. **Generate Invite Code**
   - Click "Generate"
   - You'll get a 12-character code like: `ABC-DEF-1234`

7. **Share with Retailer**
   - Send code via email, SMS, or in person
   - Code expires in 24 hours

**API Example**:
```bash
POST /api/supplier/connection-invite
{
  "paymentTermsType": "NET_30",
  "creditLimit": 10000,
  "currency": "USD"
}

Response:
{
  "inviteCode": "ABC-DEF-1234",
  "expiresAt": "2025-11-18T12:00:00Z"
}
```

**What Happens Next**:
- Retailer accepts invite → Connection status: ACTIVE
- You can now mark products as wholesale
- Retailer can import your products

---

### 2. How to Mark Products as Wholesale (Supplier)

**Goal**: Make products available to your retailers

**Steps**:

1. **Go to Products page**
   - Click "Products" in Cartrel sidebar

2. **Select Products**
   - Check boxes next to products you want to wholesale
   - Or click "Select All"

3. **Set Wholesale Price**
   - Enter wholesale price for each product
   - Should be lower than retail price
   - Example: Retail $50 → Wholesale $30

4. **Click "Mark as Wholesale"**
   - Products now visible to connected retailers

5. **Set Sync Preferences** (per product)
   - Which fields sync automatically:
     - ✓ Title
     - ✓ Description
     - ✓ Images
     - ✓ Pricing
     - ✓ Inventory
     - ✓ Tags
     - ✓ SEO
   - Retailer can override these preferences

**API Example**:
```bash
POST /api/supplier/products/wholesale
{
  "productIds": ["prod_123", "prod_456"],
  "wholesalePrice": 30.00,
  "syncPreferences": {
    "syncTitle": true,
    "syncDescription": true,
    "syncImages": true,
    "syncPricing": false,
    "syncInventory": true
  }
}
```

**What Happens Next**:
- Products appear in retailer's "Available Products"
- When you update products in Shopify, changes sync automatically
- Inventory updates sync in real-time

---

### 3. How to Set Up Multi-Location Inventory (Supplier)

**Goal**: Sync inventory from specific warehouses and reserve safety stock

**When to Use**:
- You have multiple Shopify locations (warehouses)
- You want East Coast retailers to sync from NYC warehouse
- You want to reserve 10 units for emergencies (safety stock)

**Steps**:

1. **List Your Shopify Locations**
   ```bash
   GET /api/supplier/locations

   Response:
   {
     "locations": [
       {
         "id": "gid://shopify/Location/123",
         "name": "NYC Warehouse",
         "address": { "city": "New York", "province": "NY" }
       },
       {
         "id": "gid://shopify/Location/456",
         "name": "LA Warehouse",
         "address": { "city": "Los Angeles", "province": "CA" }
       }
     ]
   }
   ```

2. **Go to Connections page**
   - Find the connection you want to configure

3. **Click "Configure Location"**
   - Or use API:

4. **Select Location**
   - Choose which warehouse syncs to this retailer
   - Example: NYC Warehouse for East Coast retailers

5. **Set Safety Stock** (optional)
   - Reserve X units (won't sync to retailer)
   - Example: Keep 10 units for emergencies
   - Retailer sees: Total inventory - Safety stock

6. **Save Settings**
   ```bash
   PATCH /api/supplier/connections/:connectionId/location
   {
     "inventoryLocationId": "gid://shopify/Location/123",
     "safetyStockQuantity": 10
   }
   ```

**Example Setup**:
```
You have 3 warehouses:
  - NYC: 100 units
  - LA: 150 units
  - Chicago: 50 units (reserved for retail)

Connection 1: East Coast Retailer
  - Location: NYC (gid://shopify/Location/123)
  - Safety stock: 10 units
  - Retailer sees: 90 units (100 - 10)

Connection 2: West Coast Retailer
  - Location: LA (gid://shopify/Location/456)
  - Safety stock: 20 units
  - Retailer sees: 130 units (150 - 20)

Chicago warehouse: Not synced (keep for B2C)
```

**What Happens Next**:
- Only inventory from selected location syncs
- Safety stock subtracted before syncing
- Prevents overselling across channels

---

### 4. How to Forward Orders (Supplier)

**Goal**: Receive retailer orders as draft orders in your Shopify

**Steps**:

1. **Retailer Submits Purchase Order**
   - Retailer creates PO in Cartrel
   - Within 5 seconds, draft order appears in your Shopify

2. **Review Draft Order in Shopify**
   - Go to Shopify Admin → Orders → Drafts
   - Look for tags: "wholesale", "cartrel", "po-{number}"
   - Custom attributes show:
     - `cartrel_po_id`: Purchase order ID
     - `retailer_shop`: Retailer's shop name

3. **Edit if Needed** (optional)
   - Add/remove line items
   - Adjust quantities
   - Add discounts

4. **Mark as Paid**
   - Option 1: In Shopify, complete the draft order
   - Option 2: In Cartrel, click "Mark as Paid"
   ```bash
   POST /api/supplier/orders/:orderId/complete
   ```

5. **Draft Converts to Real Order**
   - Now appears in regular Orders section
   - Ready to fulfill

**Payment Terms Behavior**:
- **PREPAY**: Auto-completes (no action needed)
- **NET_15/30/60**: Requires manual "Mark as Paid"

---

### 5. How to Manage Order Fulfillment (Supplier)

**Goal**: Fulfill orders and sync tracking to retailers

**Steps**:

1. **Fulfill Order in Shopify**
   - Go to Shopify Admin → Orders
   - Click order → Click "Fulfill items"
   - Add tracking number and carrier
   - Click "Fulfill"

2. **Tracking Syncs Automatically**
   - Cartrel receives `orders/fulfilled` webhook
   - Updates purchase order status: SHIPPED
   - Adds tracking number and URL to PO
   - Retailer sees tracking info in Cartrel

3. **Order Delivered**
   - When carrier marks as "delivered"
   - Shopify sends `orders/updated` webhook
   - PO status updates to: DELIVERED

**To Cancel an Order**:
1. **In Shopify**: Cancel the order
2. **Or in Cartrel**:
   ```bash
   POST /api/supplier/orders/:orderId/cancel
   {
     "reason": "Out of stock"
   }
   ```
3. **PO Status**: Changes to CANCELLED

**What Retailers See**:
- Real-time tracking info
- Order status updates
- Estimated delivery date

---

## For Retailers

### 6. How to Accept a Connection Invite (Retailer)

**Goal**: Connect with a supplier's wholesale catalog

**Steps**:

1. **Get Invite Code from Supplier**
   - 12-character code like: `ABC-DEF-1234`
   - Valid for 24 hours

2. **Log into Cartrel**
   - Go to Shopify Admin → Apps → Cartrel

3. **Go to Connections page**
   - Click "Connections" in sidebar

4. **Click "Accept Invite"**
   - Enter the 12-character code
   - Click "Submit"

5. **Review Connection Details**
   - Supplier name
   - Payment terms (PREPAY, NET_15, etc.)
   - Credit limit (if any)

6. **Accept Connection**
   - Click "Accept"
   - Status changes to: ACTIVE

**API Example**:
```bash
POST /api/retailer/accept-invite
{
  "inviteCode": "ABC-DEF-1234"
}

Response:
{
  "connection": {
    "id": "conn_123",
    "supplierShopName": "Widget Co",
    "paymentTerms": "NET_30",
    "status": "ACTIVE"
  }
}
```

**What Happens Next**:
- Supplier's wholesale products now visible
- You can import products
- You can submit purchase orders

---

### 7. How to Import Products with Preview (Retailer)

**Goal**: Import supplier products with full control and preview

**Steps**:

1. **Go to Import Wizard**
   - Click "Import Products" in sidebar
   - Select connection

2. **Browse Available Products**
   ```bash
   GET /api/retailer/import/available?connectionId=conn_123

   Response:
   {
     "products": [
       {
         "id": "prod_123",
         "title": "Widget XYZ",
         "wholesalePrice": 30.00,
         "retailPrice": 50.00,
         "inventoryQuantity": 100
       }
     ]
   }
   ```

3. **Select Products to Import**
   - Check boxes next to products
   - Or click "Select All"

4. **Set Import Preferences**
   - **Markup Type**: PERCENTAGE or FIXED_AMOUNT
   - **Markup Value**: e.g., 67% (wholesale $30 → retail $50)
   - **Sync Preferences**:
     - ✓ Title
     - ✓ Description
     - ✓ Images
     - ✓ Pricing
     - ✓ Inventory
     - ✓ Tags
     - ✓ SEO

5. **Preview Changes**
   ```bash
   POST /api/retailer/import/preview
   {
     "connectionId": "conn_123",
     "productIds": ["prod_123", "prod_456"],
     "preferences": {
       "markupType": "PERCENTAGE",
       "markupValue": 67,
       "syncTitle": true,
       "syncPricing": true
     }
   }

   Response:
   {
     "previews": [
       {
         "product": { "title": "Widget XYZ" },
         "diffs": [
           {
             "field": "price",
             "supplierValue": "$30.00 wholesale",
             "retailerValue": "$50.00 retail (67% markup)",
             "willSync": true
           }
         ]
       }
     ]
   }
   ```

6. **Review Preview**
   - See exactly what will change
   - Check pricing calculations
   - Verify sync preferences

7. **Confirm Import**
   ```bash
   POST /api/retailer/import/bulk
   {
     "connectionId": "conn_123",
     "productIds": ["prod_123"],
     "preferences": { /* ... */ },
     "createInShopify": true
   }
   ```

8. **Products Created**
   - Products appear in your Shopify store
   - ProductMapping created for each
   - Inventory syncs automatically

**What to Check**:
- Pricing looks correct (wholesale + markup = retail)
- Images look good
- Product titles match your brand

---

### 8. How to Import Large Catalogs (Retailer)

**Goal**: Import 1000+ products without timeout

**When to Use**:
- Supplier has 500+ products
- You want to import entire catalog
- You need progress tracking

**Steps**:

1. **Use Async Import**
   ```bash
   POST /api/retailer/import/async
   {
     "connectionId": "conn_123",
     "productIds": [ /* 1000 product IDs */ ],
     "preferences": {
       "markupType": "PERCENTAGE",
       "markupValue": 67,
       "syncAll": true
     },
     "createInShopify": true
   }

   Response:
   {
     "batchId": "batch_xyz",
     "message": "Import started, check status at /api/retailer/import/status/batch_xyz"
   }
   ```

2. **Monitor Progress**
   ```bash
   GET /api/retailer/import/status/batch_xyz

   Response:
   {
     "batchId": "batch_xyz",
     "status": "IN_PROGRESS",
     "totalProducts": 1000,
     "completed": 450,
     "successful": 445,
     "failed": 5,
     "progress": 45
   }
   ```

3. **Check Progress in UI**
   - Progress bar shows 0-100%
   - Estimated time remaining
   - Success/failure counts

4. **Review Results**
   - When status: COMPLETED
   - View successful imports
   - Review failed imports (with error messages)

**Performance**:
- Processes 10 products per batch
- 500ms delay between batches (respects Shopify rate limits)
- ~6 products per second
- 1000 products ≈ 3 minutes

**If Import Fails**:
- Check error messages
- Common issues:
  - Product already exists
  - Invalid wholesale price
  - Missing product data
- Re-import failed products after fixing

---

### 9. How to Map Multi-Variant Products (Retailer)

**Goal**: Map supplier variants to your variant structure

**Example Problem**:
- Supplier has T-shirt with variants: S, M, L
- You imported it, but your variants are: Small, Medium, Large
- Need to map: S → Small, M → Medium, L → Large

**Steps**:

1. **Auto-Match Variants**
   ```bash
   POST /api/retailer/variants/auto-match
   {
     "productMappingId": "mapping_123"
   }

   Response:
   {
     "matches": [
       {
         "supplierVariantId": "var_s",
         "retailerVariantId": "var_small",
         "matchConfidence": "partial",
         "requiresManualMapping": true
       },
       {
         "supplierVariantId": "var_m",
         "retailerVariantId": "var_medium",
         "matchConfidence": "exact",
         "requiresManualMapping": false
       }
     ]
   }
   ```

2. **Review Auto-Matches**
   - **Exact**: Automatically mapped ✓
   - **Partial**: Needs manual review
   - **None**: No match found

3. **Manually Map Partial/None**
   ```bash
   POST /api/retailer/variants/manual-map
   {
     "productMappingId": "mapping_123",
     "supplierVariantId": "var_s",
     "retailerVariantId": "var_small"
   }
   ```

4. **Repeat for All Variants**
   - Until all variants mapped
   - Usually 80%+ auto-match

5. **Inventory Syncs at Variant Level**
   - Supplier: S (10 units), M (20 units), L (5 units)
   - Syncs to: Small (10), Medium (20), Large (5)

**What Happens Next**:
- Inventory updates sync per variant
- Pricing syncs per variant
- If supplier adds new variant → auto-match attempts again

---

### 10. How to Use 30-Day Rollback (Retailer)

**Goal**: Undo unwanted product changes

**Use Cases**:
1. Supplier changed price by mistake
2. Unwanted title update
3. Need to revert to yesterday's state

**Steps**:

1. **View Change History**
   ```bash
   GET /api/retailer/snapshots/history?productId=prod_123

   Response:
   {
     "history": [
       {
         "field": "price",
         "value": 50.00,
         "changedBy": "SUPPLIER_SYNC",
         "createdAt": "2025-11-17T10:00:00Z"
       },
       {
         "field": "price",
         "value": 45.00,
         "changedBy": "SUPPLIER_SYNC",
         "createdAt": "2025-11-10T08:00:00Z"
       }
     ]
   }
   ```

2. **Identify Change to Undo**
   - See who changed what and when
   - changedBy: SUPPLIER_SYNC, MANUAL_EDIT, or SYSTEM

3. **Option A: Rollback Single Field**
   ```bash
   POST /api/retailer/snapshots/rollback-field
   {
     "productId": "prod_123",
     "field": "price",
     "snapshotCreatedAt": "2025-11-10T08:00:00Z"
   }
   ```

4. **Option B: Rollback Entire Product**
   ```bash
   POST /api/retailer/snapshots/rollback-product
   {
     "productId": "prod_123",
     "targetDate": "2025-11-10T08:00:00Z"
   }

   Response:
   {
     "rolledBack": ["price", "title", "description"],
     "errors": []
   }
   ```

5. **Changes Applied**
   - Product reverted in Shopify
   - New snapshot created (changedBy: SYSTEM)
   - Audit trail preserved

**Limitations**:
- Only works for last 30 days
- Can't rollback price (variant-level field)
- Can rollback: title, description, tags, status, SEO

**Example Scenarios**:

**Scenario 1: Undo Price Change**
- Supplier changed price $50 → $1000 (typo)
- View history → see $50 snapshot from yesterday
- Rollback price field → reverts to $50

**Scenario 2: Undo Title Update**
- Supplier changed title to "MEGA SALE WIDGET!!!"
- You prefer original: "Premium Widget"
- Rollback title field only (keep other changes)

**Scenario 3: Full Revert**
- Multiple unwanted changes
- Rollback entire product to last week
- All fields revert to state from that date

---

### 11. How to Submit Purchase Orders (Retailer)

**Goal**: Order products from supplier

**Steps**:

1. **Create Purchase Order**
   ```bash
   POST /api/retailer/order
   {
     "connectionId": "conn_123",
     "items": [
       {
         "supplierProductId": "prod_123",
         "quantity": 50,
         "wholesalePrice": 30.00
       }
     ],
     "shippingAddress": {
       "address1": "123 Main St",
       "city": "New York",
       "province": "NY",
       "zip": "10001",
       "country": "US"
     },
     "notes": "Please ship by Friday"
   }

   Response:
   {
     "purchaseOrder": {
       "id": "po_xyz",
       "number": "PO-1001",
       "status": "SUBMITTED",
       "totalAmount": 1500.00,
       "draftOrderId": "draft_123"
     }
   }
   ```

2. **Draft Order Created in Supplier Shopify**
   - Within 5 seconds
   - Supplier reviews and accepts

3. **Supplier Marks as Paid**
   - If PREPAY: Auto-paid
   - If NET terms: Manual payment

4. **Supplier Fulfills Order**
   - Ships products
   - Adds tracking number

5. **Track Order Status**
   ```bash
   GET /api/retailer/orders?connectionId=conn_123

   Response:
   {
     "orders": [
       {
         "id": "po_xyz",
         "status": "SHIPPED",
         "trackingNumber": "1Z999AA10123456784",
         "trackingUrl": "https://www.ups.com/track?..."
       }
     ]
   }
   ```

6. **Receive Order**
   - Status updates to: DELIVERED
   - Add inventory to your Shopify

**Payment Terms**:
- **PREPAY**: You pay upfront (auto-charged)
- **NET_15**: Pay within 15 days
- **NET_30**: Pay within 30 days
- **NET_60**: Pay within 60 days

---

## For Syncio Migrators

### 12. How to Migrate from Syncio (Shadow Mode)

**Goal**: Test Cartrel without disrupting existing Syncio setup

**Why Shadow Mode?**
- Zero risk - test without affecting live products
- Side-by-side comparison
- Gradual migration
- Rollback anytime

**Steps**:

1. **Calculate Savings**
   ```bash
   GET /api/retailer/shadow/compare-pricing?connections=5&products=500&orders=100

   Response:
   {
     "cartrel": {
       "plan": "STARTER",
       "monthlyPrice": 15,
       "annualPrice": 150
     },
     "syncio": {
       "monthlyPrice": 29,
       "annualPrice": 348
     },
     "savings": {
       "monthlyAmount": 14,
       "annualAmount": 198,
       "percentage": 48
     }
   }
   ```

2. **Review Feature Comparison**
   ```bash
   GET /api/retailer/shadow/compare-features

   Response:
   {
     "comparisons": [
       {
         "feature": "Base Price",
         "cartrel": "$15/month",
         "syncio": "$29/month",
         "advantage": "cartrel"
       }
       // ... 20 features
     ]
   }
   ```

3. **Enable Shadow Mode**
   ```bash
   POST /api/retailer/shadow/enable
   {
     "connectionId": "conn_123"
   }
   ```

4. **Import Products in Shadow Mode**
   ```bash
   POST /api/retailer/import/bulk
   {
     "connectionId": "conn_123",
     "productIds": ["prod_123"],
     "preferences": { /* ... */ },
     "createInShopify": false  // ← Shadow mode: don't create in Shopify
   }
   ```

5. **Test for 48-72 Hours**
   - Products mapped but not created in Shopify
   - See what would sync
   - Monitor sync accuracy
   - Compare to Syncio behavior

6. **Review Shadow Imports**
   ```bash
   GET /api/retailer/shadow/stats

   Response:
   {
     "shadowImports": 50,
     "totalValue": 5000,
     "estimatedSavings": 240
   }
   ```

7. **Promote When Ready**
   ```bash
   POST /api/retailer/shadow/promote
   {
     "connectionId": "conn_123",
     "productMappingIds": ["mapping_123", "mapping_456"]
   }

   Response:
   {
     "success": 50,
     "failed": 0
   }
   ```

8. **Disable Syncio**
   - After confirming Cartrel works perfectly
   - Cancel Syncio subscription
   - Delete Syncio products (optional)

**Migration Timeline**:
- **Week 1**: Enable Shadow Mode, test 10-20 products
- **Week 2**: Expand to 50-100 products, monitor closely
- **Week 3**: If satisfied, promote all shadow imports
- **Week 4**: Disable Syncio

**Rollback Plan**:
- If issues found, disable Shadow Mode
- No changes made to live products
- Continue using Syncio while troubleshooting

---

## For Everyone

### 13. How to Check Platform Status

**Goal**: See if Cartrel is experiencing issues

**Public Status Page**:
```
Visit: https://cartrel.com/status
```

**What You'll See**:
- **Overall Status**: OPERATIONAL, DEGRADED, or DOWN
- **Component Status**:
  - Authentication & Login: ✓ Operational
  - Product Sync: ✓ Operational
  - Inventory Sync: ✓ Operational
  - Order Forwarding: ✓ Operational
  - Billing: ✓ Operational
  - Webhooks: ⚠ Degraded
- **Active Incidents**: Current issues being worked on
- **Recent Incidents**: Last 7 days of incidents (resolved)
- **Uptime**: 7/30/90-day uptime percentages

**Example Incident**:
```
⚠ Webhook Queue Backlog (1,234 items)
Status: INVESTIGATING
Started: Nov 17, 2025 - 2:30 PM EST

Updates:
  3:45 PM: Queue processing rate increased, backlog decreasing
  3:00 PM: Identified slow database queries, optimizing
  2:30 PM: Investigating delayed syncs
```

**Subscribe to Updates**:
- Email notifications when incidents created/resolved
- SMS alerts for critical incidents
- RSS feed for status updates

**If You See an Issue**:
1. Check status page first
2. If incident already reported → we're working on it
3. If no incident → contact support@cartrel.com

---

### 14. How to Monitor Connection Health

**Goal**: Ensure your connection is syncing correctly

**Steps**:

1. **View Health Dashboard**
   ```bash
   GET /api/retailer/health

   Response:
   {
     "connections": [
       {
         "id": "conn_123",
         "supplierName": "Widget Co",
         "status": "ACTIVE",
         "lastSync": "2025-11-17T10:30:00Z",
         "productCount": 150,
         "orderCount": 25,
         "healthScore": 98,
         "recentErrors": []
       }
     ]
   }
   ```

2. **Check Health Score**
   - 90-100: Excellent ✅
   - 70-89: Good ⚠
   - <70: Needs attention ❌

3. **Review Recent Errors**
   - Common errors:
     - "Product not found" (product deleted in Shopify)
     - "Rate limit exceeded" (too many requests)
     - "Invalid price" (negative or zero price)

4. **Fix Issues**
   - Product not found → re-import product
   - Rate limit → wait, system will retry
   - Invalid price → contact supplier

**Health Indicators**:
- **Last Sync**: Should be recent (<1 hour for active products)
- **Product Count**: Matches expected number
- **Order Count**: Accurate order history
- **Recent Errors**: Should be empty or minimal

**When to Worry**:
- Last sync >24 hours ago
- Health score <70
- Multiple recent errors
- Products not syncing

**Troubleshooting**:
1. Check status page (platform issue?)
2. Check connection status (paused or inactive?)
3. Check webhook queue (backed up?)
4. Contact support if issues persist

---

### 15. How to Upgrade Your Plan

**Goal**: Upgrade to higher tier when you outgrow current plan

**When to Upgrade**:
- Usage approaching limits (>80%)
- Need more connections
- Need more products
- Need more orders

**Steps**:

1. **Check Current Usage**
   ```bash
   GET /api/shop/usage

   Response:
   {
     "plan": "STARTER",
     "connections": {
       "current": 4,
       "limit": 5,
       "percentUsed": 80
     },
     "products": {
       "current": 450,
       "limit": 500,
       "percentUsed": 90
     },
     "orders": {
       "current": 85,
       "limit": 100,
       "percentUsed": 85
     }
   }
   ```

2. **See Upgrade Recommendation**
   - System suggests: "Upgrade to CORE ($29/month)"
   - Reason: "Products at 90% capacity"

3. **Compare Plans**
   - Visit /pricing
   - Compare features and limits
   - Calculate ROI

4. **Initiate Upgrade**
   ```bash
   POST /api/billing/upgrade
   {
     "newPlan": "CORE",
     "billingCycle": "MONTHLY"  // or "ANNUAL"
   }

   Response:
   {
     "confirmationUrl": "https://shop.myshopify.com/admin/charges/12345/confirm"
   }
   ```

5. **Confirm in Shopify**
   - Redirected to Shopify billing page
   - Review charge details
   - Click "Approve"

6. **Upgrade Complete**
   - New limits active immediately
   - Billed via Shopify subscription
   - Old plan prorated (credit applied)

**Annual Billing**:
- Save 16.7% (pay for 10 months, get 12)
- Example: CORE $29/month = $290/year (vs $348 monthly)

**Add-Ons** (Alternative to Upgrading):
- **+10 Connections**: $30/month
- **+1,000 Orders**: $25/month
- Often cheaper than full upgrade

**Example**:
- Current: STARTER ($15) + 4 connections
- Need 1 more connection
- Option 1: Upgrade to CORE ($29) = +$14/month
- Option 2: Buy +10 connections add-on ($30) = +$30/month
- **Best**: Upgrade to CORE (more products + orders too)

---

## 🚨 Common Issues & Solutions

### "Products Not Syncing"
1. Check connection status (should be ACTIVE)
2. Check sync preferences (syncInventory, syncPricing enabled?)
3. Check health dashboard for errors
4. Verify webhook queue not backed up (status page)

### "Import Failed"
1. Check error message:
   - "Product already exists" → delete and re-import
   - "Invalid price" → check wholesale price set correctly
   - "Rate limit" → wait 5 minutes, retry
2. Try importing 1 product at a time to isolate issue
3. Contact support with batch ID

### "Variant Mapping Not Working"
1. Run auto-match first
2. Review match confidence (exact vs partial)
3. Manually map partial/none matches
4. Ensure variant options match (Size vs size)

### "Order Not Appearing in Supplier Shopify"
1. Check purchase order status (should be SUBMITTED)
2. Check supplier Shopify → Drafts (not Orders)
3. Check tags: "cartrel", "wholesale", "po-{number}"
4. Wait 5 minutes (webhook delay)
5. Check webhook queue (status page)

---

## 📞 Support

**Need Help?**
- Email: support@cartrel.com
- Status Page: https://cartrel.com/status
- Documentation: https://github.com/nhillen/cartrel
- Response Time: <24 hours (usually <4 hours)

**Enterprise Support**:
- Dedicated Slack channel
- Priority support
- Custom onboarding
- Contact: enterprise@cartrel.com

---

**Last Updated**: November 17, 2025
**Questions or Feedback?** Let us know at support@cartrel.com
