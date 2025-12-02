# PRD: Payouts (Commissions & Settlement Tracking)

**Goal**  
Track commissions/revenue splits between destination and source stores for synced orders; generate payouts with configurable fees/commissions; keep both sides in sync on status. Payments are out-of-band (no funds transfer).

## Scope
- Platforms: Shopify-only initial scope.
- Eligibility: orders containing synced products (at time of purchase) appear in a payable list; include/exclude per payout.
- Payout entities: created by destination, visible to source; states: open/unpaid, paid, marked received by source, deleted.
- Calculations per store (overridable at product level):
  - Base amount: with/without tax.
  - Shipping fees (none / use destination order shipping / custom flat per order).
  - Payment processing fees (none / flat $ / % / $ + %).
  - Commission to destination (flat $ or %, store-level; product-level overrides).
  - Optional manual adjustments (positive/negative line items).
- Order edits handling:
  - Supported in unpaid payouts: add/remove line items or quantities (refresh to update).
  - Not reflected automatically: refunds/cancellations; user can exclude or recreate payout.
- $0 orders: payouts ignore if order value $0 unless manually adjusted.
- Comments/notes: bidirectional comments on payout; event log for status changes.
- Notifications: email/alert to source when payout created, deleted, or status updated; to destination when source marks received.
- Pricing: destination pays; source view is free. Bundle in Core+ to undercut Syncio’s $9/mo add-on; optionally keep as add-on for Starter if needed.
- Performance: batch payout generation; refresh button re-pulls unpaid payout data; pagination/filters by store/date/status.

## UX/Flows
- Destination:
  - Payouts tab: payable orders filtered by status (fulfilled/unfulfilled/cancelled/refunded); select orders; create payout.
  - Payout settings per store: base includes tax toggle, shipping fee option, processing fee option, commission type/rate; bulk set across stores; product-level overrides.
  - Payout view: edit shipping, add adjustment lines, view included orders, edit settings, mark paid, delete unpaid; refresh orders for unpaid payouts to reflect edits.
- Source:
  - Open payouts tab: filter by store/date/status; view details; mark payment received; comment.
  - Completed payouts tab: history.
- Error/edge handling: block payout creation without required settings; surface when orders were refunded/cancelled (excluded by user), warn on missing commission settings.
- Refresh behavior: manual refresh for unpaid payouts to incorporate order edits; optional auto-refresh mode (open decision) including refund/cancel detection.

## Non-goals
- Actual payments/funds transfer (future consideration).
- Tax remittance or accounting exports (could be future).

## Open Decisions
- Default base: include tax vs exclude; default commission type/rate.
- Whether to auto-refresh unpaid payouts on order edits vs manual refresh button.
- Gating: include payouts in which tier vs as add-on; pricing model (flat vs usage).
- Whether auto-refresh should also ingest refunds/cancellations instead of requiring payout recreation.

## Differentiators / How we win
- Bundle in Pro+ (or Core+) to undercut Syncio’s paid add-on; keep source side free.
- Better edit handling: optionally auto-refresh unpaid payouts on order edits (including refunds/cancellations) instead of manual recreate.
- Clear notifications, bidirectional comments, and audit trail; Syncio is minimal.
- Potential future: optional integrated invoicing/payment rails; for now, clearer guidance and reminders to reduce manual friction.
