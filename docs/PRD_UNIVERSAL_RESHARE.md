# PRD: Universal Store & Re-Share Consent

**Goal**  
Allow a store to act as both source and destination, and optionally re-share supplier catalogs with consent. Avoid the blanket block Syncio enforces while protecting supplier control.

## Scope
- Dual-role enablement: a shop can be both source and destination; switch context in UI.
- Default rule: no third-party re-share unless explicitly permitted by the supplier.
- Consent model: per-supplier opt-in to allow re-share; scope defines which fields (catalog only vs inventory vs both), and max destinations.
- Governance: prevent uncontrolled fan-out; enforce per-supplier limits and audit who consumed the feed.
- Billing: unified billing (no separate source/destination bills); marketplace plan can include re-share rights; destinations remain free.
- Visibility: imported products from partner remain private unless re-share consent is granted.
- Safety: no re-share when product-only mode is used without supplier consent; support revocation to cut off downstream quickly.

## UX/Flows
- Toggle to enable source role/destination role; show plan/limits.
- Re-share settings per supplier: consent request, status (pending/approved/denied), scope allowed, limits (destinations count), revoke button.
- Audit: list of downstream destinations consuming a supplier’s catalog.
- Error states: block re-share attempts without consent; explain why.

## Non-goals
- Revenue split or payouts (separate).

## Open Decisions
- Default limits on re-share (e.g., max N destinations per supplier unless expanded).  
- Whether to require supplier-side approval per connection vs blanket approval for all connections.  
- Handling existing synced products when consent is revoked (likely unsync/zero-out with notice).

## Differentiators / How we win
- Allow re-share with consent instead of blanket blocking; marketplace-friendly.
- Unified billing (no dual plans), with consent controls and auditability.
- Supplier opt-in per scope (catalog-only vs inventory) and per-destination limits to stay safe.
- Pricing/performance: re-share rights gated to Growth/Scale; enforce caps to control API/load impact.
- Tie-in with marketplace profiles and invites to streamline supplier/retailer discovery and consent capture.
