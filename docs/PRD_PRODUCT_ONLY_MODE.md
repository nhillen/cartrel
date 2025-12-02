# PRD: Product-Only Mode & Catalog Sync

**Goal**  
Let destinations consume product content (titles, descriptions, media, tags, metafields, SEO, optional price) from a source without syncing inventory or pushing orders. Self-serve toggle per connection with safe defaults.

## Scope
- Per-connection `sync_mode = product_only`.
- Allowed fields (default on): title, description, media/images, tags, SEO metafields, metafields, URL handle. Optional/advanced (tier-gated): price, cost, HS code, country of origin, online store channel, auto add/remove variant, track quantity/continue selling flags, variant name.
- No inventory writes, no order push, no stock buffer applied. Inventory events are no-ops but logged.
- Schedule + webhook-driven updates: respond to product changes and run periodic reconciliation (e.g., nightly) to heal drift.
- Mapping required: SKU/barcode match or manual mapping; still enforce unique SKUs and variant-count parity.
- Pricing/tier: enabled on all tiers; free tier allows generous product count (e.g., 100–250) and maybe price sync gated to paid tiers.
- Performance: prioritize deltas; partial field updates; batch where possible; run reconciliation in off-peak windows.

## UX/Flows
- Connection creation/edit: radio for Inventory+Product vs Product-only; tooltips explaining incompatibility with order push.
- Scope selector: checkboxes for fields; price toggle warned as optional.
- Status: per-product “last content sync” timestamp and last error.
- Logs: show ignored inventory events to reassure users.

## Non-goals
- No inventory adjustments, no order push, no payout handling.

## Open Decisions
- Exact default field set (include price or not).  
- Reconciliation cadence (daily vs hourly) and cost controls.

## Differentiators / How we win
- Self-serve toggle (no support ticket), clear incompatibility with order push, with safe defaults (price off).
- More generous free tier (catalog + basic fields) vs Syncio’s limited free add-on; includes field sync from PRD_PRODUCT_SETTINGS_SYNC basics.
- Delta-based updates + reconciliation to reduce write volume and API costs.
- Bundled field sync (basic) even on Free/Starter; no add-on tax.
- Hidden tag behavior clarified: hide works pre-sync; if added after sync, prompt unsync/zero-out instead of silent removal.
