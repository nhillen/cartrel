# Inventory & Product Sync Design (Umbrella)

**Status:** Draft  
**Purpose:** Define the top-level architecture, modes, and invariants for syncing inventory and product content across connected stores. Detailed requirements live in the focused PRDs listed below.

## Related PRDs
- Product-only mode & catalog sync: `docs/PRD_PRODUCT_ONLY_MODE.md`
- Mapper & conflict resolution: `docs/PRD_MAPPER_CONFLICTS.md`
- Multi-location sync: `docs/PRD_MULTI_LOCATION_SYNC.md`
- Order push & shadow mode: `docs/PRD_ORDER_PUSH_SHADOW_MODE.md`
- Rate limits, backpressure, observability: `docs/PRD_RATE_LIMIT_OBSERVABILITY.md`
- Universal store & re-share consent: `docs/PRD_UNIVERSAL_RESHARE.md`
- Pricing & packaging: `docs/PRD_PRICING_PACKAGING.md`
- Product settings (field-level sync): `docs/PRD_PRODUCT_SETTINGS_SYNC.md`
- Payouts (commissions/settlement tracking): `docs/PRD_PAYOUTS.md`
- Metafields sync: `docs/PRD_METAFIELDS_SYNC.md`
- Marketplace (discovery): `docs/PRD_MARKETPLACE.md`
- Collection sync (roadmap): `docs/PRD_COLLECTION_SYNC.md`
- Price rules (roadmap): `docs/PRD_PRICE_RULES.md`

## Modes & Policies (per connection)
- `sync_mode`: `inventory_and_product` (two-way stock adjustments + optional order push) or `product_only` (catalog replication only).
- `order_trigger_policy`: `on_create` (instant) or `on_paid` (paid-only).
- `sync_scope`: field flags (inventory, price, title, description, media, tags, metafields, SEO, etc.).
- `stock_buffer`: optional reserve applied when publishing to destinations (inventory mode).
- `order_push_enabled`: only in inventory mode.

## Core Triggers
- Source: manual inventory adjustments/transfers, orders (per policy), refunds/voids (restock), product attribute changes/deletions.
- Destination: orders (per policy) decrement source; no effect in product-only mode.
- Order edits: diff add/remove; respect paid-only policy.
- Resync: bulk imports and scheduled reconciliation for drift.

## Processing Overview
- Ingest platform webhooks → normalize to `InventoryEvent`, `ProductChange`, `OrderEvent` with idempotency keys.
- Inventory mode: apply delta to source, then fan out to destinations with buffer, rate limits, retries, and DLQ.
- Product-only mode: ignore inventory deltas; push allowed product fields downstream; periodic reconciliation to heal misses.
- Order push (inventory mode only): create source orders from destination sales; mark origin to avoid loops.
- Concurrency guard: version checks on inventory writes; refetch/retry on conflicts.
- Product import: auto-add new products from source is not supported initially; imports/map are manual (auto-add variants supported via product settings).
- Roadmap items (not committed): collection sync and price rules, extended metafields (collections/reference types), per-connection billing variants, auto-support for Shopify “On Hold” orders.

## Data Model Baseline
- `StoreConnection`: mode, trigger policy, sync scope, stock buffer, order push flag.
- `ProductMapping`: state (`active`, `replaced`, `unsupported`, `unsynced`), mapping strategy, ids, last sync/error.
- `InventoryEvent`: idempotency key, connection, variant/location, qty delta, reason, raw event.
- `ProductChange`: fields changed, connection, source/destination ids, idempotency key.

## Safety & Observability (high level)
- Dedupe all incoming events; retries with exponential backoff + DLQ.
- Zero destination qty when mappings become replaced/unsupported (inventory mode).
- Alert on unmapped SKUs, variant mismatches, repeated rate-limit hits; log ignored inventory events in product-only mode.
- Surface per-product last sync/error and per-connection health (rate-limit state) per PRD_RATE_LIMIT_OBSERVABILITY.

## UAT Must-Haves
- Inventory mode: destination order adjusts source and other destinations; paid-only blocks until paid; refund restocks; order edits adjust per policy.
- Product-only: source product updates reflect downstream; destination orders do not affect inventory or push orders.
- Mapping guardrails: duplicate SKU or variant-count mismatch blocks sync; replaced/unsupported sets destination qty to 0 and requires remap.
- Stock buffer: destinations see source qty minus buffer.
- Refund nuance: if policy is paid-only, unpaid orders do not reverse; paid-then-refunded does.
