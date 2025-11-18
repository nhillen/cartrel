# Documentation Audit - November 17, 2025

| Document | Purpose | Current Status | Follow-Ups |
| --- | --- | --- | --- |
| `README.md` | Public overview + pricing + feature list | ✅ Updated with roadmap caveats (multi-location inventory, health checks) and still accurate for current marketing site. | Revisit when multi-vendor routing ships so roadmap items can be promoted. |
| `DECISIONS.md` | Architectural & product decisions record | ✅ Comprehensive and in sync with implementation (infrastructure-only, Shopify-only, tiering, etc.). | Add new entries when major decisions (e.g., worker split, admin auth) are finalized. |
| `DESIGN.md` | Deep technical design and business model notes | ✅ Detailed; matches current positioning and phased roadmap. | Consider trimming deprecated pricing options once tier strategy is locked. |
| `DEPLOYMENT.md` | Deployment workflow, branching strategy, rollback guidance | ✅ Reflects deploy script + recommendations (blue/green, backups). | Add section on managing `ADMIN_API_KEY` when multi-env support is added. |
| `FEATURES.md` | Exhaustive feature descriptions | ⚠️ Includes Phase 6/7 capabilities as completed even though some are still ramping. | Mirror README roadmap labels (e.g., mark multi-location/routing as beta/coming soon). |
| `HOW_TO_GUIDES.md` | Step-by-step operational guides for suppliers/retailers | ✅ Up-to-date; references key APIs and flows. | Add screenshots once Shopify embedded UI ships. |
| `IMPLEMENTATION_PLAN.md` | Phase-based backlog | ✅ Matches design doc phases. | Update once multi-vendor routing enters implementation. |
| `PHASE_0_MIGRATION_GUIDE.md` | Database migration sequence | ✅ Detailed SQL + Prisma steps. | Add guidance for rolling migrations backward (tie into DEPLOYMENT). |
| `SYNCIO_AUDIT.md` | Competitive breakdown vs. Syncio | ✅ Aligns with marketing copy (cost savings, feature coverage). | Refresh metrics if Syncio pricing changes. |
| `UAT_TEST_PLAN.md` | Acceptance testing catalog | ✅ Extensive manual test suite; currently used for QA/UAT. | Incorporate lint/test automation once implemented. |
| `/docs` folder | Deployment-specific references | ⚠️ Only contains `DEPLOYMENT.md`. | Add README explaining doc structure (this audit file fills the gap). |
| `docs/EMBEDDED_FRONTEND_PLAN.md` | Embedded Polaris/App Bridge rollout plan | ✅ Captures stack + timeline | Keep updated as Shopify UI ships (tick off milestones). |

## Summary
- ✅ Core references (README, decisions, deployment, how-to guides) are current.
- ⚠️ Feature catalog still treats future work (multi-location, routing) as GA—needs roadmap tags similar to README/features site.
- 📌 Introduced this audit to act as the docs table-of-contents until a dedicated docs index is written.

## Next Steps
1. Update `FEATURES.md` language to mirror roadmap labels (beta/coming soon).
2. Capture `ADMIN_API_KEY` handling + worker/queue plans in `DECISIONS.md` once finalized.
3. When the Shopify embedded frontend lands, add screenshots/snippets to `HOW_TO_GUIDES.md` and a short `docs/README.md`.
