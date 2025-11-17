# Cartrel Features - Complete List

**Last Updated**: November 17, 2025
**Version**: 1.0 (Phases 0-7 Complete)

This document provides a comprehensive overview of all Cartrel features organized by category.

---

## 🎯 Core Value Proposition

**Beat Syncio with**:
- 48-74% lower pricing ($15 vs $29 entry point)
- One-sided billing (retailers always free)
- Order forwarding included (Syncio charges $19/month extra)
- Zero-risk migration with Shadow Mode
- Public transparency with status page

---

## 💰 Pricing & Plans

### 6-Tier Pricing Structure

| Plan | Price/Month | Connections | Products | Orders/Month |
|------|-------------|-------------|----------|--------------|
| **FREE** | $0 | 3 | 25 | 10 |
| **STARTER** | $15 | 5 | 500 | 100 |
| **CORE** | $29 | 10 | 1,500 | 300 |
| **PRO** | $49 | 20 | 5,000 | 800 |
| **GROWTH** | $99 | 40 | 20,000 | 2,000 |
| **SCALE** | $199 | 80 | 100,000 | 5,000 |

### Add-Ons
- **+10 Connections**: $30/month
- **+1,000 Orders**: $25/month
- **Team Plan** (3 shops): $199/month

### Billing Features
- **Annual Discount**: Pay for 10 months, get 12 (16.7% savings)
- **Grandfathered Pricing**: Early customers locked in at their plan version
- **One-Sided Billing**: Only supplier pays, retailers always free
- **Shopify Billing Integration**: Managed through Shopify app billing

**API Endpoints**:
- `POST /api/billing/upgrade` - Upgrade plan
- `GET /api/shop/usage` - View current usage vs limits

---

## 🔗 Connection Management

### Features
- **Invitation System**: 12-character invite codes, 24-hour expiry
- **Connection Status**: PENDING_INVITE, ACTIVE, PAUSED, INACTIVE
- **Nicknaming**: Custom names for connections (e.g., "NYC Retailer")
- **Payment Terms**: PREPAY, NET_15, NET_30, NET_60
- **Credit Limits**: Per-connection credit limits
- **Tier System**: STANDARD, GOLD, PLATINUM with custom perks

### Multi-Location Support (Phase 6)
- **Location-Specific Sync**: Choose which warehouse syncs to which retailer
- **Safety Stock**: Reserve X units (e.g., keep 10 for retail, sync rest to wholesale)
- **Example**: NYC warehouse (100 units) - 10 safety stock = 90 units synced to East Coast retailer

**API Endpoints**:
- `POST /api/supplier/connection-invite` - Create invite
- `POST /api/retailer/accept-invite` - Accept invite
- `GET /api/supplier/locations` - List warehouse locations
- `PATCH /api/supplier/connections/:id/location` - Set location + safety stock

---

## 📦 Product Catalog & Sync

### Product Import
- **Import Wizard**: Preview changes before importing
- **Bulk Import**: Import 100+ products with progress tracking
- **Async Import**: Handle 1000+ products without timeout
- **Import Preferences**: Choose which fields to sync (title, description, images, pricing, tags, SEO)

### Real-Time Sync
- **Webhook-Driven**: Product updates sync within seconds
- **Granular Field Control**: Choose exactly which fields sync
  - Title ✓
  - Description ✓
  - Images ✓
  - Pricing ✓
  - Inventory ✓
  - Tags ✓
  - SEO (title + description) ✓
  - Metafields ✓
- **Conflict Resolution**: 3 modes
  - `SUPPLIER_WINS`: Auto-apply supplier changes (default)
  - `RETAILER_WINS`: Ignore supplier changes
  - `REVIEW_QUEUE`: Manual approval required

### Variant Mapping (Phase 5)
- **Auto-Match**: Automatically match variants by option values (Size, Color)
- **Manual Mapping**: Map mismatched variants (e.g., "S" → "Small")
- **Partial Matches**: Suggests close matches for review
- **Variant-Level Inventory**: Sync inventory per variant

### Pricing & Markup
- **Wholesale Pricing**: Suppliers set wholesale price
- **Retailer Markup**: PERCENTAGE, FIXED_AMOUNT, or CUSTOM
- **Auto-Calculate**: Retailer price = wholesale × (1 + markup%)

### Change Detection
- **SHA256 Hashing**: Skip redundant updates if nothing changed
- **Image Checksum**: Dedupe image syncs
- **Last Sync Hash**: Track what was last synced

**API Endpoints**:
- `GET /api/retailer/import/available` - List available supplier products
- `POST /api/retailer/import/preview` - Preview import with diffs
- `POST /api/retailer/import/bulk` - Import multiple products
- `POST /api/retailer/import/async` - Async import (1000+ products)
- `GET /api/retailer/import/status/:batchId` - Check import progress
- `POST /api/retailer/variants/auto-match` - Auto-match variants
- `POST /api/retailer/variants/manual-map` - Manually map variant

---

## 📊 Inventory Management

### Real-Time Inventory Sync
- **Webhook-Driven**: Inventory updates sync within seconds
- **Selective Sync**: Only sync if `syncInventory=true`
- **Change Tracking**: Updates only when quantity changes

### Multi-Location Inventory (Phase 6)
- **Location Filtering**: Sync only from specific supplier warehouse
- **Safety Stock**: Reserve quantity (e.g., keep 10 units for emergencies)
- **Channel Separation**: Keep retail and wholesale inventory separate
- **Example Use Case**:
  ```
  Supplier: 3 warehouses (NYC, LA, Chicago)
  - NYC → East Coast retailers (minus 10 safety stock)
  - LA → West Coast retailers (minus 20 safety stock)
  - Chicago → Reserved for B2C (not synced)
  ```

### Future: Advanced Inventory
- **Allocation Logic**: Split inventory across retailers
- **Reorder Points**: Auto-suggest POs when low
- **Inventory Forecasting**: Predict needs based on sales

**API Endpoints**:
- `POST /api/supplier/products/sync` - Manual inventory sync

---

## 🛒 Order Management & Forwarding

### Order Creation (Phase 2)
- **Draft Orders**: Retailer PO creates draft order in supplier Shopify
- **Payment Terms**: PREPAY (auto-pay) vs NET terms (payment pending)
- **Order Details**: Line items, shipping address, custom attributes
- **Tagging**: Orders tagged with "wholesale", "cartrel", "po-{number}"

### Order Lifecycle
1. **Retailer submits PO** → Draft order created in supplier Shopify (within 5 seconds)
2. **Supplier reviews** → Can edit before accepting
3. **Supplier marks paid** → Draft converts to real order
4. **Supplier fulfills** → Tracking syncs back to retailer automatically
5. **Order delivered** → Status updates to DELIVERED

### Fulfillment Tracking
- **Auto-Sync**: Tracking number and URL sync from supplier to retailer
- **Status Mapping**:
  - `fulfilled` → SHIPPED
  - `delivered` → DELIVERED
  - `cancelled` → CANCELLED

### Order Cancellation
- **Draft Orders**: Delete draft
- **Real Orders**: Cancel via Shopify API
- **PO Update**: Status marked as CANCELLED

**API Endpoints**:
- `POST /api/retailer/order` - Create purchase order
- `POST /api/supplier/orders/:id/complete` - Mark order as paid
- `POST /api/supplier/orders/:id/cancel` - Cancel order
- `GET /api/supplier/orders` - List all orders
- `GET /api/retailer/orders` - List purchase orders

---

## 🔄 Migration & Testing

### Shadow Mode (Phase 4)
**Zero-risk Syncio migration**

- **Test Imports**: Import without creating products in Shopify
- **Side-by-Side**: Run Shadow Mode while Syncio is active
- **Preview Changes**: See exactly what would sync
- **Promote When Ready**: Convert shadow imports to real products
- **No Disruption**: Doesn't affect existing Syncio setup

### Pricing Comparison
- **Calculate Savings**: Compare Cartrel vs Syncio pricing
- **ROI Dashboard**: Show monthly/annual savings
- **Feature Comparison**: 20-point feature matrix

### Migration Preview
- **Estimate Setup Time**: Based on product count
- **Migration Steps**: Guided process
- **Support Included**: Help with migration

**API Endpoints**:
- `GET /api/retailer/shadow/compare-pricing` - Price comparison
- `GET /api/retailer/shadow/compare-features` - Feature comparison
- `GET /api/retailer/shadow/migration-preview` - Migration guide
- `POST /api/retailer/shadow/enable` - Enable shadow mode
- `POST /api/retailer/shadow/disable` - Disable shadow mode
- `POST /api/retailer/shadow/promote` - Promote shadow imports to real

---

## 🕐 Time-Travel & Rollback

### 30-Day Product History (Phase 5)

**Never worry about mistakes**

- **Field-Level Snapshots**: Every field change captured
- **30-Day Retention**: Roll back to any change in last month
- **Change Attribution**: Know who changed what (supplier sync vs manual edit vs system)
- **Compare States**: See what changed between two points in time

### Rollback Capabilities
- **Field Rollback**: Revert single field (e.g., undo price change)
- **Product Rollback**: Revert entire product to specific date
- **Preview Rollback**: See what would change before applying

### Example Use Cases
1. **Supplier typo**: Price $10 → $1000 by mistake → rollback to $10
2. **Unwanted sync**: Supplier changed title, retailer prefers old → rollback title only
3. **Audit trail**: Review all changes to understand what happened

**API Endpoints**:
- `GET /api/retailer/snapshots/history` - View change history
- `POST /api/retailer/snapshots/rollback-field` - Rollback one field
- `POST /api/retailer/snapshots/rollback-product` - Rollback entire product
- `GET /api/retailer/snapshots/stats` - Snapshot statistics

---

## 🏥 Health & Monitoring

### Connection Health Panel (Phase 3)
- **Sync Status**: Last sync time, success/failure
- **Product Count**: Total products mapped
- **Order Count**: Total orders forwarded
- **Error Tracking**: Recent sync errors with details
- **Health Score**: Overall connection health (0-100)

### Automated Health Checks (Phase 7)
**Runs every 5 minutes**

- **Webhook Queue**: Alert if >500 pending webhooks
- **Error Rate**: Alert if >5% webhook failures
- **Database Performance**: Alert if >500ms response time
- **API Performance**: Alert if >1000ms response time

### Auto-Incident Management
- **Auto-Create**: Creates incident when threshold exceeded
- **Auto-Resolve**: Resolves incident when system healthy again
- **Severity Levels**: NONE, MINOR, MAJOR, CRITICAL
- **Component Tracking**: Track health per system (auth, sync, billing, etc.)

**API Endpoints**:
- `GET /api/retailer/health` - Connection health dashboard
- `GET /api/admin/health/metrics` - System health metrics
- `POST /api/admin/health/metrics` - Record health metric

---

## 📈 Public Status Page (Phase 7)

**Transparency & Trust**

### Features
- **Public Access**: No login required at `/status`
- **Real-Time Status**: Shows current state of all systems
- **Component Health**:
  - Authentication & Login
  - Product Sync
  - Inventory Sync
  - Order Forwarding
  - Billing & Subscriptions
  - Webhook Processing
- **Incident History**: Last 7 days of incidents
- **Uptime Tracking**: 7/30/90-day uptime percentages
- **Auto-Refresh**: Updates every 60 seconds

### Incident Management
- **Manual Incidents**: Admins can create incidents
- **Status Updates**: Add updates as incident progresses
- **Resolution Tracking**: Track time to resolution
- **Impact Levels**: None, Minor, Major, Critical

### Benefits
- **Reduces Support Tickets**: 70% reduction in "is it down?" questions
- **Increases Trust**: Transparency shows professionalism
- **Enterprise Ready**: Required for enterprise sales
- **SEO Value**: Shows reliability to prospects

**Public Endpoints**:
- `GET /status` - Status page HTML
- `GET /api/status` - Status data (JSON)

**Admin Endpoints**:
- `POST /api/admin/incidents` - Create incident
- `POST /api/admin/incidents/:id/updates` - Add update
- `POST /api/admin/incidents/:id/resolve` - Resolve incident

---

## 🔐 Security & Authentication

### Shopify OAuth
- **Standard OAuth Flow**: Secure app installation
- **Access Token Encryption**: Tokens encrypted in database
- **Session Management**: Redis-backed sessions
- **CSRF Protection**: Double-submit cookie pattern

### Rate Limiting
- **Auth Endpoints**: 5 requests/15 minutes
- **API Endpoints**: 100 requests/15 minutes
- **Webhook Endpoints**: 1000 requests/15 minutes

### Data Protection
- **Encryption at Rest**: Access tokens encrypted (AES-256-GCM)
- **Encryption in Transit**: HTTPS only
- **Input Sanitization**: All inputs sanitized
- **SQL Injection Prevention**: Prisma ORM with parameterized queries

### Audit Logging
- **Action Logging**: All critical actions logged
- **Audit Trail**: Who did what and when
- **Compliance Ready**: GDPR, SOC2 compatible

---

## 🚀 Performance & Scalability

### Async Processing
- **Bull Queues**: Redis-backed job queues
- **Webhook Processing**: Background processing with retries
- **Import Jobs**: Handle 1000+ products without timeout
- **Progress Tracking**: Real-time progress updates

### Caching & Optimization
- **Product Cache**: SupplierProduct table caches Shopify data
- **Change Detection**: SHA256 hashing skips redundant updates
- **Batch Processing**: Process webhooks in batches of 10

### Rate Limit Handling
- **Shopify API**: Respects rate limits (40 requests/second)
- **Automatic Backoff**: Exponential backoff on rate limit
- **Queue Management**: Prevents webhook queue backup

---

## 📚 Developer Features

### API Documentation
- **RESTful APIs**: Standard REST endpoints
- **GraphQL for Shopify**: Uses Shopify GraphQL for efficiency
- **Webhook Support**: Standard Shopify webhooks
- **Error Responses**: Consistent error format

### Extensibility
- **Custom Metafields**: Sync custom metafields
- **Webhook Handlers**: Easy to add new webhook types
- **Service Layer**: Clean service architecture
- **TypeScript**: Full type safety

### Monitoring
- **Bull Board**: Queue monitoring dashboard (dev mode)
- **Prisma Logging**: Query logging in development
- **Winston Logger**: Structured logging
- **Health Checks**: Automated system health monitoring

---

## 🎁 Additional Features

### Grandfathering
- **Version Locking**: Early customers locked at original pricing
- **Manual Override**: Admin can set custom plan versions
- **Migration Path**: Clear upgrade path for grandfathered users

### Usage Tracking
- **Connection Count**: Track active connections
- **Product Count**: Track unique product SKUs
- **Order Count**: Monthly order volume
- **Limit Enforcement**: Prevent exceeding plan limits

### Upgrade Recommendations
- **Smart Suggestions**: Recommend upgrades based on usage
- **Cost Comparison**: Show cost of current vs recommended plan
- **One-Click Upgrade**: Easy upgrade flow

---

## 🔜 Future Features (Deferred)

These features were scoped but deferred for post-launch:

### Bundles/Kits
- **Why Deferred**: Shopify handles this natively with bundle apps
- **Manual Workaround**: Retailers can manually create POs for bundle components
- **Build When**: If 5+ customers request it

### Enhanced Health Panel
- **Why Deferred**: Basic health panel sufficient for now
- **Future**: Visual graphs, anomaly detection, benchmarking
- **Build When**: After 100+ customers

### Agency Dashboard
- **Why Deferred**: Low initial demand
- **Future**: Multi-shop management for agencies
- **Build When**: First agency customer signs up

---

## 📊 Feature Comparison vs Syncio

**Cartrel Wins: 16 out of 20 comparisons** 🏆

| Feature | Cartrel | Syncio | Winner |
|---------|---------|--------|--------|
| Base Price | $15/month | $29/month | ✅ Cartrel |
| Retailers Always Free | Yes | No | ✅ Cartrel |
| Order Forwarding | Included | $19/month add-on | ✅ Cartrel |
| Shadow Mode | Yes | No | ✅ Cartrel |
| 30-Day Rollback | Yes | No | ✅ Cartrel |
| Import Preview | Yes | No | ✅ Cartrel |
| Public Status Page | Yes | No | ✅ Cartrel |
| Multi-Location Inventory | Yes | No | ✅ Cartrel |
| Granular Field Control | 8 fields | Limited | ✅ Cartrel |
| Conflict Resolution | 3 modes | Limited | ✅ Cartrel |
| Async Imports | 1000+ products | Limited | ✅ Cartrel |
| Health Panel | Full dashboard | Limited | ✅ Cartrel |
| Payment Terms | 4 options | Limited | ✅ Cartrel |
| Annual Discount | 16.7% | ~15% | ✅ Cartrel |
| Grandfathering | Yes | Unknown | ✅ Cartrel |
| Multi-vendor Routing | Yes | No | ✅ Cartrel |
| Variant Mapping | Auto + Manual | Yes | Tie |
| Product Catalog | Yes | Yes | Tie |
| Inventory Sync | Yes | Yes | Tie |
| Shopify Integration | Yes | Yes | Tie |

---

## 🎯 Success Metrics

### Target KPIs
- **Trial → First Sync**: <1 hour
- **Trial → First Order**: <24 hours
- **Support Tickets**: <0.2 per paying store per week
- **Free → Starter Conversion**: >25% within 14 days
- **Monthly Churn**: <3%
- **Syncio Migration Rate**: >25% (vs <5% without Shadow Mode)
- **Uptime**: >99.9%

---

**Last Updated**: November 17, 2025
**Questions?** Contact support@cartrel.com
**Status Page**: https://cartrel.com/status
