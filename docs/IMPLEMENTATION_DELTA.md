# Implementation Delta vs Design

**Purpose**
Identify gaps between current codebase and the updated design/PRDs to inform next engineering steps (core architecture, not feature-by-feature tickets).

**Status**: DESIGN.md aligned with PRDs as of 2025-12-02. This document tracks remaining codebase gaps.

## Known Current State (from prior audits)
- OAuth/session, multi-tenant shops, billing scaffolding present.
- Webhook infrastructure and Bull queues exist but handlers for product/inventory are stubbed.
- Variant-level mapping incomplete; order forwarding not built; shadow mode not present.
- No collection sync, price rules, metafields sync, payouts, or partner network implemented.
- No multi-location logic beyond baseline; no stock buffer; no rate-limit health surfacing.
- Product creation/import is manual; auto-add variants not wired.

## Design Expectations (high level)
- Per-connection settings: mode, trigger policy, scope, buffer, forwarding flag.
- Inventory pipeline: idempotent webhooks, deltas applied, fan-out, refund/return logic, buffers, multi-location.
- Catalog pipeline: field controls, mapping with conflicts/drift detection, hidden-tag handling.
- Order forwarding: manual/auto, shipping rules/tags, $0 workaround, error handling, shadow preview.
- Metafields sync: selective defs/values with caps.
- Collections/price rules: roadmap.
- Payouts: commission/fee tracking (no funds).
- Mapper service: bulk + individual, states, errors, unsync/disconnect flows.
- Rate-limit/backpressure: batching, health surfacing.
- Partner network/re-share: profiles, invites, consent governance.
- Billing: single-sided tiers with caps; optional per-connection billing (roadmap).

## Core Architecture Gaps
- **Webhook handlers:** need full implementation for products, variants, inventory levels, orders (create/update/refund), order edits, and metafields (if enabled).
- **Event normalization/idempotency:** build canonical events with idempotency keys and DLQ/retry strategy.
- **Mapping service:** variant mapping, conflict detection, drift detection, hidden-tag logic, states (`active/replaced/unsupported/unsynced`).
- **Inventory engine:** apply deltas, respect buffers, multi-location selection, refund/restock rules, version checks.
- **Catalog field controls:** enforce sync scopes, resync paths, hide-by-default, auto-add variants.
- **Order forwarding engine:** push orders with per-connection auto/manual, shipping rules, tagging, $0 workaround, error surfaces, shadow mode.
- **Metafields sync:** definition/value selection, scheduling/batching, caps enforcement.
- **Payouts module:** compute commissions/fees, payout lifecycle, notifications (no payments).
- **Rate-limit observability:** capture API headers, throttle, surface health, plus Shopify Plus multiplier detection.
- **Partner network/re-share:** profile storage, search/invites, consent rules; gated by tier.
- **Billing alignment:** enforce new caps/tiers, consider per-connection pricing flag.

## Next Steps (core, not feature tickets)
- Inventory the codebase for existing stubs vs missing modules (scan backend/src/routes, services).
- Draft data model migrations for connections (mode/policy/scope/buffer/forwarding), product mappings (state/errors), metafields caps, payouts, partner profiles.
- Implement event processing pipeline with idempotency/DLQ.
- Stand up mapper service and inventory engine per design.
- Implement order forwarding core (manual first, then auto/shadow), with shipping rules.
- Add rate-limit middleware/metrics and health surfacing baseline.
- Defer collection sync/price rules as roadmap; leave placeholders/flags in settings.
