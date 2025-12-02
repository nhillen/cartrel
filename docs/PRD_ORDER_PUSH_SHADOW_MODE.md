# PRD: Order Push & Shadow Mode

**Goal**  
Forward destination orders to source stores for fulfillment (line-item split by supplier) with a shadow mode to preview before live. Align with inventory sync policies.

## Scope
- Eligibility: destination order with at least one synced product; must have customer details and total > 0. Respect connection’s `order_trigger_policy` (`on_create` vs `on_paid`).
- Push modes: automatic (on eligible order) and manual push; shadow mode to generate a draft/flag without creating a live order.
- Splitting: split multi-supplier orders into per-supplier pushes; tag with retailer store name and original order id.
- Idempotency: prevent duplicate pushes on retries; dedupe on order id + connection + attempt key.
- Fulfillment sync back: track fulfillment status and tracking numbers from source back to destination order.
- Refunds/returns: if destination refunds with restock, restock source; if refund without restock, do not restock; support partial refunds per line.
- Location constraints: ensure fulfillment location matches mapped location; block or warn otherwise.
- Catalog-only mode: incompatible; pushing disabled when inventory sync is off.
- Improve on Syncio limitations: optionally include shipping service/cost/discount metadata in notes/metafields; clearly document what passes through when not supported by the platform.
- Platform/limits (from Syncio behaviors): Shopify-only integration; no payment transfer; cannot pass original shipping service details/cost/discount codes; $0 orders blocked unless workaround; tags limited to <40 chars.
- Tagging: pushed orders tagged with destination store name, destination order number, shipping type tag; note whether subtotal includes tax; optional custom shipping tags per shipping rate.
- Shipping fees: support custom shipping rate rules; allow $0 orders via optional $0.01 shipping fee workaround; allow manual entry when pushing manually.
- Auto vs manual: support per-connection auto push (Syncio applies globally); allow manual override; bulk push UI for errors/on-hold.
- On-hold orders: detect Shopify “On Hold” status; allow manual/bulk push; consider auto-push support with feature flag.
- Error handling: surface reasons (missing customer details, unsynced product, location mismatch, qty edited before/after push, network/API errors, fulfilled/archived, $0 order); provide “re-push” and guidance.
- Payments/settlement: payments not forwarded; supplier invoices destination or uses other arrangements; future payouts feature can automate invoicing/commissions.
- POS/local pickup: source-side Shopify POS orders adjust inventory as normal; destination-side POS/local pickup orders fulfilled/archived immediately so do not trigger push/sync (document limitation).
- Roadmap: optional auto-support for “On Hold” orders and other third-party-created orders; align with Shopify delivery profiles/routing when forwarding.

## UX/Flows
- Connection settings: enable order push; choose auto vs manual; enable shadow mode for initial rollout/testing.
- Order list: show push status per order (not pushed, shadowed, pushed, failed), with errors and retry.
- Shadow mode: create draft markers or internal records; allow one-click promote to live push.
- Tags/metadata: pushed orders tagged with source/destination identifiers for traceability.
- Shipping settings: per-connection shipping rate rules (including $0 order workaround), shipping type tags (editable labels), default email contact (customer/admin/other).
- Bulk push: select multiple orders and push with chosen shipping rules; show progress/results.

## Non-goals
- Payment transfer or revenue split (handled by payouts elsewhere).

## Open Decisions
- Draft vs note-based shadow representation on Shopify.  
- SLA for push retries and backoff strategy.  
- Whether to allow push on pending orders when policy is `on_create` (default yes) vs `on_paid` (default no).
- How much shipping/discount metadata to propagate vs platform constraints.
- Whether to auto-support Shopify “On Hold” orders or keep manual/bulk push only by default.

## Differentiators / How we win
- Shadow mode to de-risk go-live (Syncio lacks this preview).
- Included in core tiers (no add-on upsell); manual + auto modes.
- Clearer refund/restock handling and partial refunds; explicit idempotency.
- Optionally pass more metadata (shipping/discount) where platform allows, documented upfront.
- Performance/pricing: auto push gated to paid tiers; manual push allowed on free to manage cost; retries/backoff to respect API limits.
- Per-connection auto/manual control (Syncio auto toggle is global), richer error surfaces, built-in $0 order workaround, custom shipping tags/rules exposed in UI.
