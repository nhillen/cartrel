# PRD: Pricing & Packaging (Syncio-Competitive)

**Goal**  
Win small and mid-size stores with single-sided billing (supplier pays), a generous free tier, and bundled features that Syncio upcharges (order push, product attributes).

## Pricing Anchors (baseline from SYNCIO_AUDIT)
- Single-sided billing (supplier only); destinations free.
- Tier caps we previously modeled:  
  - Free: 3 connections, 25 products, 10 orders/month (baseline)  
  - Starter: 5 connections, 500 products, 100 orders/month  
  - Core: 10 connections, 1,500 products, 300 orders/month  
  - Pro: 20 connections, 5,000 products, 800 orders/month  
  - Growth: 40 connections, 20,000 products, 2,000 orders/month  
  - Scale: 80 connections, 100,000 products, 5,000 orders/month  
- Add-ons: +connections and +orders; avoid SKU-based metering.

## Differentiation Levers
- Generous free tier: catalog + inventory sync up to 150 products; include 10 order pushes/month; limited product attribute sync (titles/descriptions/media/tags/vendor/type) to capture small merchants.
- Bundle order push, product settings, starter metafields, and payouts into core tiers (no add-on tax); reserve advanced (metafields caps, SEO/cost/HS code) for higher tiers.
- Single bill: supplier-only billing; destinations free; no two-sided fees.
- Metering simplicity: meter on products/orders/connections; no SKU counting; soft overage with upgrade prompts.
- Promotions: switcher credits, annual discount (pay 10, get 12); trial period for order push/product attributes.
- Marketplace/re-share plan: higher tier unlocks re-share rights (with supplier consent) and higher caps.
- Beat Syncio freebies: they offer free auto-remove variant, 5 order pushes, 5 payouts; we should match or exceed (e.g., 10 order pushes, broader product-field sync) without heavy infra cost.
- Metafields: offer limited defs on lower tiers (Starter: 10, Core: 25), higher caps bundled in Pro/Growth, unlimited in Scale; consider bundling basic metafields rather than separate add-on.
- Compete with Multi Store Sync Power: they price per store/product tiers and include collection sync and price rules; our edge is one bill per supplier (not per connected store), higher free cap (150 products), bundled order push/product settings/payouts/metafields, re-share/marketplace, and optional collection sync roadmap.
- Alternate billing option: consider per-connection pricing for marketplace/dropship scenarios (inverted payer) while keeping supplier-simple defaults.

## Packaging Matrix (proposed numbers to test)
- Free: 3 connections; **150 products** catalog + inventory sync; 10 order pushes/month (manual only); product attributes basic (title/desc/media/tags/vendor/type); price/cost off; auto order push off; metafields up to 10 defs; limited support.
- Starter: 5 connections; 500 products; 100 orders/month; inventory + product sync; price sync optional; order push (auto/manual) included; metafields up to 25 defs; email support.
- Core: 10 connections; 1,500 products; 300 orders/month; multi-location (single destination location); stock buffer; price sync on; metafields up to 50 defs; rate-limit health; email/chat support; payouts included.
- Pro: 20 connections; 5,000 products; 800 orders/month; advanced product fields (SEO, cost, HS code, URL handle, auto add/remove variants); multi-location advanced; metafields up to 200 defs; payouts; priority support.
- Growth: 40 connections; 20,000 products; 2,000 orders/month; marketplace/re-share eligibility; metafields up to 500 defs; SLA-lite; dedicated CSM.
- Scale/Marketplace: 80 connections; 100,000 products; 5,000+ orders/month; re-share rights; unlimited metafields; custom overages; full SLA; dedicated support.

## Guardrails
- Prevent runaway infra: enforce soft caps with throttling and upgrade prompts; configurable overage ceilings; block auto push if gross over cap.
- Keep product-only mode cheap: low infra cost; great for acquisition.
- Avoid SKU-metering complexity; prefer product-count and order-count metrics we already track.
- Performance: batch and stagger bulk resyncs; prioritize orders/inventory within plan limits; alert when rate-limit degradation occurs (per PRD_RATE_LIMIT_OBSERVABILITY).
- Switching store type: allow in-app toggle (no uninstall) if possible; preserve mappings; bulk remap support.

## Open Decisions
- Validate free-tier caps (150 products, 10 pushes) against infra cost; adjust if needed.
- Final field gating per tier (cost/HS/SEO in Pro+; price sync enabled in Starter+?).
- Whether to allow auto order push on Free (default: manual-only).
- Whether payouts stay bundled in Core+ or move to Pro+ only.
- Whether to introduce per-connection pricing option to directly counter per-store competitors while keeping supplier simplicity.
- Whether to bundle collection sync and price rules in base tiers to blunt competitor feature claims.
- Whether to add connection retention rules (e.g., require order activity within X time) for marketplace-style links.

## Differentiators / How we win
- Single-sided billing; destinations always free; simpler than Syncio’s dual billing.
- More generous free tier (catalog + 10 order pushes) and bundled features vs Syncio add-ons.
- No SKU-metering; clearer metering on products/orders/connections and soft overages.
- Marketplace profile free; invite limits higher than Syncio’s early access; re-share rights at Growth/Scale.
