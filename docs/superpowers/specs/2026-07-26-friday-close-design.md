# The Friday Close — Week-Close · Leak→Draft-CO · QBO Cost Pull · Pace Pre-Apply — Design

**Date:** 2026-07-26 · **Status:** Plan verified, awaiting owner review · **Branch:** `claude/friday-close` (off main @a8dbff6)

## Goal
The collection release: Brain v3 taught it to know things, Profit Leak taught it to spot money — the Friday Close teaches it to **collect**. (1) **A Friday ritual** (`composeWeekClose` pure sibling of composeBrief → `/week-close` five-leg checklist: bill / chase / close / commit / tell clients, with a Friday-afternoon doorbell), (2) **the brain drafts the paper itself** (leak flags → draft Change Orders on app open, gated by its own measured leak precision), (3) **true costs flow in from QuickBooks** (Purchase/Bill pull → confirm queue → receipts/cost book flagged `source:'qbo'`), and (4) **the first earned autonomous act** (schedule drafts arrive with your measured pace pre-applied, per-trade, only where you've beaten the AI).

## Locked guardrails (HARD requirements, from the frontier map)
- **No nag on inactive projects**: every ritual reuses the brief's cadence predicates + honest empty state; the Friday nudge isn't even armed when nothing qualifies.
- **DRAFT-forever**: auto-drafted COs are `status:'draft'`, never sent, never client-visible; every draft writes a did-for-you receipt; drafting auto-demotes (visibly) below ≥50% leak precision over n≥5.
- **Never silent into job costs / cost book**: QBO lines stage in `qbo_cost_lines` and post only on per-line confirmation (duplicate-of-scanned-receipt warning included); confirmed lines carry `source:'qbo'`.
- **Earned autonomy, not toggled autonomy**: pace pre-apply unlocks per-trade at ≥60% beat-or-tie over n≥5 from the brain's own graded ledger; badge "Set from your N jobs · tap for AI's number"; `aiOriginalDays` one-tap revert; prediction capture continues (autonomy never starves its own gate); visible auto-demotion; the smallest honest preference = `profiles.autonomy_preferences` jsonb, two booleans (`pace_preapply`, `leak_draft_co`), default ON — first autonomy prefs in the codebase.

## Architecture, anchors, wave plan
See the verified architect plan: `docs/superpowers/plans/2026-07-26-friday-close.md` (grounded to file:line on main @a8dbff6; G-rules G1–G14 govern implementers; 7 bundles F0–F6 + owner ship gates; conflict ledger included). Key resolutions: "overnight" drafting is honestly a catch-up sweep on app open (no client background runtime); QBO confirmed lines materialize as `MaterialReceipt{origin:'qbo'}` with deterministic ids so the whole job-cost + cost-book downstream is one conversion function; no new prediction kinds (CHECK constraint) — payload extensions only; pre-apply predictions record at accept, not at pre-apply.

## Ship boundary
OTA-safe except: two migrations (`20260726120000_autonomy_preferences.sql`, `20260726120100_qbo_cost_lines.sql` — applied via Supabase MCP BEFORE the OTA) and the `qbo-reconciler` redeploy (may trail the OTA; client tolerates an empty staging table). Full adversarial review before merge. Tier: all four surfaces Business+.
