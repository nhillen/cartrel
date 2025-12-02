# PRD: Rate Limit Handling, Backpressure, & Observability

**Goal**  
Keep sync reliable under API limits by prioritizing critical events, batching intelligently, and surfacing health to users.

## Scope
- Prioritization: orders/inventory events > product field updates. Degrade/queue product fields during spikes.
- Batching: batch inventory updates per store/connection where supported; partial field updates to minimize write payloads.
- Rate-limit detection: inspect API headers for remaining calls/leaky bucket; detect 429s and slow down.
- Backpressure: dynamic throttling per store; exponential backoff with jitter; DLQ for repeated failures with alerting.
- Health surfacing: per-connection API health widget (current rate usage, last 429), per-job status, and last-sync timestamps per product.
- Dedupe/idempotency: ensure retries don’t double-apply inventory.
- Scheduling: nightly/periodic reconciliation jobs run at low-traffic windows.
- Shopify Plus: detect rate multiplier availability; adjust throughput if granted; suggest request path in docs.

## UX/Flows
- Dashboard health: badges for “degraded” when rate-limited; hover for details.
- Activity/logs: record 429 events and automatic retries; link to affected products/orders.
- Controls: toggle “aggressive product sync” off during sales; optionally “order-only mode” temporary throttle.

## Non-goals
- Deep APM or full metrics stack design (out of scope).

## Open Decisions
- Default batch sizes per platform; thresholds for entering degraded mode.  
- Whether to auto-shift reconciliation windows based on observed traffic.
- Plus API multiplier: document Shopify Plus rate multiplier request path for higher limits; consider detection and adjusted throughput.

## Differentiators / How we win
- Proactive rate-limit health surfacing vs “be careful” guidance.
- Priority + batching strategy to keep orders/inventory flowing during spikes.
- Controls to throttle product sync during sales; self-serve, no support ticket.
