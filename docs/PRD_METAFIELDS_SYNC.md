# PRD: Metafields Sync

**Goal**  
Let destinations selectively sync product/variant metafield definitions and values from sources with control over scope, performance, and compatibility. Improve reliability and transparency over Syncio’s add-on.

## Scope
- Platforms: Shopify-first.
- Definition sync:
  - Pick definitions to sync (product and variant). Show supported/unsupported types.
  - Supported types (initial): single line text, number (int/decimal), date/datetime, measurement (dimensions/weight/volume, matching units), color, URL, money*, rich text. Unsupported: references (product/collection/page/metaobject), file, JSON, mixed references, lists (initially).
  - Cap on definitions to manage API load (Syncio starts at 50; we can start similar with a plan to raise). Product + variant counts separately.
  - Behavior: if matching namespace/key exists, link; else create copy.
- Value sync:
  - Triggers: product import, source product update, order created (inv/event), manual resync; scheduled batch (e.g., every 24h) for deltas.
  - Frequency: default 24h batch; consider incremental where cost allows.
  - Option to bulk resync values (full store) via job.
- Actions:
  - Sync definition; unsync + keep; unsync + delete definition; unsync + delete values; delete values only.
  - Allow using synced definitions on other products (including non-source products).
- Limits/performance:
  - Throttle metafield sync to avoid impacting orders/inventory; batch updates.
  - Warn/block when videos present if image metafields involved; respect unit consistency.
  - API limit-aware; degrade gracefully during spikes.
- Pricing: tiered caps per plan (see tier caps below); bundled in all tiers, not a separate add-on. Source side free.

## UX/Flows
- Metafields tab per source connection: list defs, filter supported/unsupported, product/variant tabs.
- Sync definition button; status badges (synced/unsupported/unsynced).
- Bulk select to sync/unsync/delete.
- Value sync banner: explains 24h batch; manual resync per product; request full-store resync job.
- Unit mismatch warnings (measurements, money).
- Limits indicator (definitions used/remaining); option to request higher cap.

## Non-goals
- Syncing reference metafields (product/collection/page/metaobject) initially.
- Media/video sync in metafields.

## Tier Caps (proposed)
- Free: up to 10 definitions (product + variant combined), supported types only.
- Starter: up to 25 definitions.
- Core: up to 50 definitions.
- Pro: up to 200 definitions.
- Growth: up to 500 definitions.
- Scale/Marketplace: unlimited (soft caps + monitoring).

## Open Decisions
- Whether to offer list types early or defer.
- Whether to auto-increase caps based on observed API usage.
- Whether to support collection metafields and additional reference types (competitors claim collection metafields); evaluate scope and Shopify limits.

## Differentiators / How we win
- Selective definition sync UI with clear supported/unsupported types (Syncio just lists).
- More transparent caps and upgrade path; consider bundling higher caps in Pro/Growth instead of strict add-on.
- Better performance strategy: batch + priority to avoid slowing orders/inventory; optional faster deltas when safe.
- Full control for unsync/delete (defs and values), and reuse definitions across stores.
