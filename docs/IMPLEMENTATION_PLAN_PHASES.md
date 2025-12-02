# Implementation Plan (Core + Features)

**Goal**  
Sequence the work to align the codebase with the updated PRDs/design, covering core architecture fixes, roadmap placeholders, and key features. No code changes in this doc—just the plan.

## Phase 0: Design/Billing Alignment
- ✅ DESIGN.md updated with new naming (order forwarding, catalog field controls, dual-role, partner network), tier caps, bundled features, and sync-as-infrastructure framing.
- Align pricing enforcement plan with `PRD_PRICING_PACKAGING.md` (free 3/150/10 pushes, caps per tier, bundled forwarding/catalog controls/metafields/payouts).
- Decide per-connection billing flag behavior (marketplace/dropship) and retention rule approach (inactive connections).

## Phase 1: Data Model & Settings ✅
- ✅ Add per-connection config: `sync_mode`, `order_trigger_policy`, `sync_scope` (field flags), `stock_buffer`, `order_forwarding_enabled`, `inventory_location_id`, metafield caps, collection/price-rule flags (placeholders).
- ✅ ProductMapping states: `active/replaced/unsupported/unsynced`, `status`, `last_error`, `last_sync_hash`, `conflict_mode`, hidden-tag handling.
- ✅ Partner profile + invites (for partner network) data models; re-share consent flags.
- ✅ Payout entities (payouts, lines, settings per store/product-level overrides).
- ✅ Metafield definition/value tracking with caps.

## Phase 2: Event Pipeline & Observability ✅
- ✅ Idempotent webhook ingestion: generate idempotency keys, DLQ/backoff, dedupe; store raw events and processing status.
- ✅ Rate-limit/backpressure: capture API headers, dynamic throttling, health surfacing per connection; Shopify Plus multiplier detection.
- ✅ Activity/Log surfacing: errors (mapping conflicts, forwarding failures, rate limits) exposed for UI consumption.

## Phase 3: Mapping & Catalog Sync Core ✅
- ✅ Mapper service: bulk + individual mapping, conflict detection (duplicate/missing SKU, variant mismatch), drift detection (SKU changes), hidden-tag behavior, unsync/disconnect flows.
- ✅ Catalog field controls: enforce scopes (title/desc/media/tags/vendor/type/price/SEO/etc.), hide-by-default, resync (per-product + bulk job), auto-add variants, tag append vs mirror.
- ✅ Product-only mode: ignore inventory, log ignored events; content reconciliation job.

## Phase 4: Inventory Engine ✅
- ✅ Inventory deltas: apply from orders/manual adjustments/refunds; respect order_trigger_policy (on_create vs on_paid); refund/restock rules; order edits diff.
- ✅ Multi-location: per-connection location filter (single/all, feature-flag multi); resync on default location change; buffer/reserve application.
- ✅ Rate-limit aware batching for inventory updates to destinations.

## Phase 5: Order Forwarding ✅
- ✅ Manual/auto forwarding per connection; shipping rules/tags; $0 workaround; error surfaces.
- ✅ Shadow mode (preview) and bulk push for errors/on-hold orders; feature-flag auto support for Shopify "On Hold."
- ✅ Fulfillment/track sync back; idempotency; POS/local pickup exclusion.

## Phase 6: Metafields Sync ✅
- ✅ Definition selection UI/logic; supported types; caps enforcement per tier.
- ✅ Value sync triggers (import/update/order/resync) + 24h batch; bulk resync job.
- ✅ Unsupported types surfaced; feature flags for collection/reference metafields (roadmap).

## Phase 7: Collections & Price Rules (Roadmap/Flags)
- Collection sync (custom collections): create/update/delete, membership via mapped products/tags; overwrite vs preserve local edits; handle clashes; tier caps.
- Price rules: per-connection/per-market markup/markdown; preview + batch apply; currency safeguards.

## Phase 8: Payouts & Partner Network ✅
- ✅ Payouts: commission/fee config per store/product, payout lifecycle (unpaid/paid/received), notifications/comments, manual refresh, optional auto-refresh (flag).
- Partner network: profiles, search/filter, invites; consented re-share governance; tie to tier gating. (Data models exist, UI deferred)

## Phase 9: UI/Docs
- Surface health/logs/errors (rate limits, mapping conflicts, forwarding failures).
- “Available now” vs “Coming soon” labels (collection sync, price rules, extended metafields, auto on-hold support, per-connection billing).
- Update website/pricing/FAQs per `WEB_DOCS_PRICING_UPDATE.md`.

## Phase 10: Billing/Enforcement
- Enforce caps per tier (connections/products/orders/metafield defs/order forwards).
- Handle per-connection billing option (if enabled) and retention/inactivity rules.

## Shopify API Optimizations (threaded throughout)
- Use GraphQL Bulk/staged uploads for products/media/metafields; batching inventory updates.
- Markets-aware price rules for international.
- Delivery profiles/routing alignment for forwarding/shadow.
- EventBridge/PubSub webhooks option for reliability at scale.
