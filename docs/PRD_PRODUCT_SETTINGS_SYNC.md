# PRD: Product Settings Sync (Field-Level Controls)

**Goal**  
Field-level product sync (titles, descriptions, images, tags, etc.) configurable per connection, with clear behaviors (ongoing vs one-off) and performance safeguards.

## Scope
- Applies to both `inventory_and_product` and `product_only` modes; controlled by `sync_scope` flags.
- Ongoing sync fields (toggle per field):
  - Product: title, description, product type, vendor, tags (append by default; optional mirror), URL handle, online store sales channel availability, draft/active status, HS code, country of origin, SEO metafields, images, SEO page title/meta description, weight.
  - Variant: price/compare-at-price, cost, variant title/name, track quantity/continue selling flags, weight, auto add variant, auto remove variant, variant name.
- One-off/import behaviors (applied on initial sync and optionally via resync): import SEO metafields; sync URL handle; hide/unpublish by default; keep deleted products as draft instead of deletion.
- Non-retroactive toggles: changing a toggle affects future updates; resync button forces application; full bulk resync via job if needed.
- Image/video limitations: image sync overwrites alt text; large images slow or fail due to platform limits; video sync not supported (block or warn if videos present when image sync enabled).
- Performance: partial field updates; batch where possible; stagger bulk updates to respect API limits; defer heavy resyncs to low-traffic windows.
- Pricing: bundled in core/pro tiers; basic fields on free tier; advanced fields (cost/SEO/HS code) gated to higher tiers.
- Collections: no native collection sync; tag sync can drive destination collections if mirrored.
- Bundles: no bundle creation support; destination can build bundles using synced individual products; note compatibility caveats (test bundles; some apps like Shopify Bundles/Fast Bundles simple modes compatible).

## UX/Flows
- Settings page per connection: checkboxes for fields; tooltips for side effects (alt text overwrite, tag append vs mirror, price/currency cautions).
- Resync controls: per-product resync button; bulk resync job with progress/ETA; warnings about API load.
- Behavior toggles: hide synced products by default; keep deleted as draft; auto add/remove variants.
- Image/media warnings: flag if videos detected; suggest disabling image sync or stripping videos.

## Non-goals
- Media transcoding/compression (recommend best practices, but not implementing optimization service).
- Cross-store price rules (handled elsewhere if needed).
- Auto-creating new products; creation remains manual (auto-add variants supported).
- Local pickup sync; POS destination-side triggers that auto-fulfill/archived orders.

## Open Decisions
- Default tag strategy: append vs mirror; possibly per-connection toggle.
- Whether to allow image sync when videos present (default: block with warning).
- Bulk resync concurrency limits and scheduling windows.
- Whether to add collection sync (create/update) to compete with apps like Multi Store Sync Power; would require collection mapping and field scope.
- Whether to add price rules (per-connection/per-market markup/markdown) as part of catalog sync to compete with dynamic pricing claims.

## Differentiators / How we win
- Self-serve field toggles (no support ticket) with clear non-retroactive/resync behavior.
- Built-in safeguards for media (video detection, large image warnings) and API backpressure handling.
- More generous inclusion of field sync in base tiers vs Syncio’s paid add-on; advanced fields gated, not the basics.
- Tag mirror as an option (Syncio offers on request); we expose it in UI.
- Bundled into base/core tiers instead of an extra paid add-on.
