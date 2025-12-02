# PRD: Collection Sync (Roadmap)

**Goal**  
Sync collections across connected stores (create/update), including basic fields and product assignments, to match competitor claims (e.g., Multi Store Sync Power) and reduce manual setup.

## Scope (initial)
- Platforms: Shopify-first.
- Collection types: custom collections; smart/automated collections are out-of-scope initially (open decision).
- Fields: title, description, image, handle, published status, sort order.
- Assignments: mirror product membership by matching products via mapping/IDs/SKUs; support tag-based inclusion as a fallback.
- Direction: one-way (source → destination) for initial phase; two-way is out-of-scope.
- Triggers: collection create/update/delete on source; manual resync; optional scheduled reconciliation.
- Conflicts: if destination has local edits, allow overwrite vs preserve toggle per connection.
- Limits: batch operations to respect API limits; cap collection count per plan (e.g., Free 50, Starter 200, Core 500, Pro+ higher).
- Dependencies: requires product mapping; unmapped products skipped with warnings.

## UX/Flows
- Connection settings: toggle collection sync; overwrite vs preserve local edits toggle; handle prefix/suffix option to avoid handle clashes.
- Collections view: list synced collections, status, last sync, errors (missing products, handle conflict).
- Resync: per-collection resync button; bulk resync job with progress.

## Non-goals
- Smart/automated collection rule sync (initially).
- Metafields on collections (covered separately in metafields roadmap).

## Open Decisions
- Smart collection support and rule translation.
- Handle collision strategy (prefix/suffix vs fail).
- Plan caps per tier.

## Differentiators / How we win
- Bundled (not extra add-on) in core/pro tiers; higher caps than competitors.
- Clear conflict controls (overwrite vs preserve) and handle clash options.
- Tag-based fallback for membership when mappings are missing.
