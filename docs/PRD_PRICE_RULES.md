# PRD: Price Rules & Markups (Roadmap)

**Goal**  
Allow per-connection price rules (markup/markdown/fixed overrides) and per-market adjustments to handle multi-currency/wholesale vs retail differences and counter competitor price-rule claims.

## Scope
- Per-connection price strategy: options for fixed markup (%), fixed markdown (%), add/subtract fixed amount, or mirror source.
- Optional per-market overrides (Shopify Markets) for international pricing; fallback to connection-level rule.
- Application points: product creation/update; optional “reprice” button to apply new rules; do not override destination manual prices if price sync is off.
- Fields: price and compare-at-price; cost untouched unless enabled in field controls.
- Safeguards: currency awareness; block/alert if source/destination currencies differ and no conversion rule is set.
- Performance: apply deltas only; batch updates; rate-limit aware.
- Compatibility: works with inventory_and_product and product_only modes; disabled if price sync is off.

## UX/Flows
- Connection settings: choose price rule; toggle per-market rules; preview sample products before applying.
- Reprice action: per-product and bulk; show summary of changes.
- Errors: surface currency mismatches, missing exchange rates, and failures in activity log.

## Non-goals
- Dynamic pricing based on inventory or demand (initially).
- Tax-inclusive pricing transformations.

## Open Decisions
- Default rule per tier; whether free tier allows price rules (likely Starter+).
- Currency conversion source (Shopify FX vs manual rates).
- Interaction with discount/compare-at strategies.

## Differentiators / How we win
- Built-in (no add-on) and per-connection, unlike competitors; optional per-market support tied to Shopify Markets.
- Safe previews and batch application to reduce errors and API load.
