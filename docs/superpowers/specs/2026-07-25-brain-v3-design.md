# Brain v3 — One Mind · Outcome Learning · Portfolio Sense · Morning Brief — Design

**Date:** 2026-07-25 · **Status:** Approved · **Branch:** `claude/brain-v3` (off main @4e3142b)

## Goal
The unification release: the brain stops being a set of faculties and becomes one entity that (1) **remembers its own predictions and grades itself** (brain_predictions ledger, 7 capture kinds, graders, visible accuracy with misses shown), (2) **understands the whole business** (utils/portfolio/* engines → /business screen: job-type profitability, pipeline-vs-capacity, client behavior, seasonality), (3) **answers anything from everything** (One Mind: the existing Ask surface upgraded to a router + per-domain fact assemblers + fused cited answers with drill-ins), and (4) **speaks first** (Morning Brief: composeBrief + push ~6:30 + pinned home card + "what I did for you").

## Owner decisions (locked 2026-07-25)
- **Voice: hybrid** — facts neutral/dense; first-person "I" only for initiative, judgment, self-correction.
- **Transparency: full** — misses shown; self-correction is a feature.
- **Brief: push + home card** — local scheduling v1 (OTA-safe); server push owner-gated follow-up.
- **One Mind door: the existing Ask surface** — no new parallel AI surface.

## Architecture, capture points, storage rationale, wave plan
See the verified architect plan: `docs/superpowers/plans/2026-07-25-brain-v3.md` (grounded to file:line on main @4e3142b; G-rules G1–G9 govern implementers). Key resolutions: Supabase table over AsyncStorage (LOCAL_USER_CACHE_KEYS wipes on sign-in — a ledger is not a cache); capture fire-and-forget, never load-bearing; dedupeBySubject as the systemic double-capture answer; brain types in utils/brain/types.ts (not types/index.ts) to keep the hottest merge file cold.

## Ship boundary
OTA-safe except: `20260725120000_brain_predictions.sql` (applied via Supabase MCP before OTA) and the optional Wave-7 push edge fn. Full adversarial tribunal before merge. Tier: new surfaces Business+.
