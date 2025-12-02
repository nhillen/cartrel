# PRD: Multi-Location Sync

**Goal**  
Support syncing inventory to configurable destination locations (and optionally multiple) while preventing oversell when locations change.

## Scope
- Per-connection location mapping: choose one or more destination locations (where platform allows). Source location mapping maintained for inventory updates.
- Location change behavior: zero out old mapped destination locations when switching; log the change; optional cooldown to avoid flapping.
- Validation: ensure destination location exists/active; show Shopify/Woo location list; handle API limit of 50 locations gracefully.
- Multi-location publish: set inventory per mapped location; aggregate source availability per mapped source location(s) if multiple.
- Order push interplay: respect fulfillment location; block push if order fulfillment location doesn’t match mapped location unless override enabled.
- Shadow mode: preview location change impact (counts to be zeroed/updated) before applying.
- Default/all-locations behavior: allow “all locations combined” vs specific location(s); changing default may trigger full resync (auto for small catalogs; manual job for large).

## UX/Flows
- Location selector in connection settings; show last change timestamp and user.
- Change confirmation modal: explains zero-out of old locations and estimated duration.
- Activity log + email for location changes.
- Per-product view: show which destination locations are being updated.

## Non-goals
- Cross-warehouse optimization or allocation logic.

## Open Decisions
- Default: single location vs allow multiple on Shopify (likely start with single, expand with feature flag).  
- Cooldown duration (Syncio uses 20 minutes); we can use shorter with guardrails.  
- How to handle >50 locations (paging vs manual entry).

## Differentiators / How we win
- Support multiple mapped locations (feature-flag) vs Syncio single-location toggle.
- Preview impact and zero-out behavior; better logs and shorter, safer cooldowns.
- Rate-limit aware batching to update multiple locations efficiently.
- Pricing: likely Pro+ for multi-location; single-location included in Starter/Core.
