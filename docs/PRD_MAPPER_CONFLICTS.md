# PRD: Mapper, Conflict Resolution, & Drift Detection

**Goal**  
Make product/variant mapping robust and self-service: bulk/individual mapping, clear conflicts, SKU drift alerts, and clean unsync/resync flows.

## Scope
- Mapping modes: bulk map (entire catalog) and individual map per product.
- Preconditions: unique SKUs per variant, matching variant counts, “track quantity” enabled, at least one image.
- Conflict handling: duplicate SKUs, missing variants, variant-count mismatch, unsupported product type, replaced product (type change).
- Drift detection: detect SKU changes post-mapping and flag as breaking; prompt remap; block sync until resolved.
- Hidden/visibility tag: honor a “hidden” tag from source; hide from discovery; if already synced, prompt unsync/zero-out instead of silent removal.
- States: `active`, `replaced`, `unsupported`, `unsynced`. Replaced/unsupported zero out destination inventory (inventory mode) and block updates until remapped.
- Bulk limits: remove small-page limits; allow large batches with progress + retries.
- Activity/logs: per-product last sync, last error, and conflict badges.
- Attention/fail states: surface failed sync/map statuses with reasons (duplicate/missing SKUs, variant mismatch); expose in Activity Center and allow retry.
- Disconnection: handle disconnect & keep vs disconnect & delete by zeroing or deleting as chosen and breaking mappings safely.

## UX/Flows
- Bulk Mapper wizard: run validation, show conflict list with filters, apply auto-matches, queue jobs with progress.
- Individual mapper: view source vs destination variants/SKUs, choose manual matches, save and test.
- Unsync: keep vs delete; confirm impacts (inventory stop, order push stop).
- Resync: re-pull content/inventory for a mapped product; revalidate SKUs.
- Alerts: email/UI for SKU drift, replaced/unsupported types, hidden tag on synced product.

## Non-goals
- Pricing/billing logic (covered elsewhere).

## Open Decisions
- Auto-SKU generation policy for missing SKUs.  
- Whether to allow partial variant mapping when counts differ (default: no).  
- Retrying cadence and caps for bulk mapping jobs.

## Differentiators / How we win
- Better conflict UX (bulk lists, filters, auto-suggest remaps) vs blunt bulk map.
- SKU drift detection alerts; Syncio just warns not to change SKUs.
- Support hidden tag remediation with prompts, not silent failures.
- Larger batch sizes with retries/progress to reduce manual effort.
- Performance: batch conflict checks and retries to stay within API limits; bulk operations run with backpressure awareness.
