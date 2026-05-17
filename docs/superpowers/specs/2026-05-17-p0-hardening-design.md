# P0 Hardening Batch — Design Spec

Date: 2026-05-17
Status: design approved (user delegated review; H3 placement decided = project-detail tile only)
Source: `docs/superpowers/audits/2026-05-17-prebroad-testflight-hardening-audit.md` items **H1, H2, H3**. Pre-broad-TestFlight gate. Code-only, OTA-able, no migration / no edge-fn deploy.

## 1. Problem

The F0 fix shipped earlier today routed only 2 of ~20 estimate-total reads through `effectiveEstimateTotal`. The rest hand-roll the `linkedEstimate ?? estimate` ladder; ~10 read the **legacy-only** `project.estimate?.grandTotal` (which is `null` for every modern linked-estimate project) and so render **$0 / negative** money — most dangerously on the lender-facing AIA G702 (`utils/aiaBilling.ts:125`), the homeowner portal budget, and the public profile. Separately: the AI Drawing-Estimate flow dead-ends on a non-existent `/estimate` route (regression from this session's `commitEstimatePatch` refactor), and the new Project Scope screen is unreachable after first use.

## 2. Goals / non-goals

**Goals**
- Every estimate **total** read returns the correct value via the single `effectiveEstimateTotal(project)` accessor (kills the $0 bug class + prevents regression).
- AI Drawing-Estimate lands on a real screen.
- Project Scope is reachable/editable any time from the project.

**Non-goals (YAGNI)**
- Do NOT touch estimate **object** reads (`linkedEstimate ?? estimate` for items, passed to AI/schedule/jobcost engines): `utils/aiService.ts:113/732/815/1187`, `utils/jobCostEngine.ts:139`, `app/schedule-pro.tsx:265`, `components/AICopilot.tsx:101`. They read the estimate object (not `.grandTotal`), are already linkedEstimate-first, and are not the $0 bug. `effectiveEstimateTotal` returns a `number` — wrong tool for those.
- No new accessor variants, no estimate-object unifier, no ProjectContext refactor (that's audit H5, separate).
- No migration, no edge-fn change, no UI redesign beyond one tile.

## 3. H1 — single-accessor money sweep

`effectiveEstimateTotal(project: Project | null | undefined): number` already exists in `utils/estimateCommit.ts` (returns `project?.linkedEstimate?.grandTotal ?? project?.estimate?.grandTotal ?? 0`). Replace each hand-rolled estimate-**total** read below with `effectiveEstimateTotal(<projectExpr>)`, importing it where needed. Preserve each call site's surrounding semantics (predicates compare `> 0`; CSV keeps blank-when-zero).

**Group A — currently WRONG (legacy-only; produce $0 on modern projects):**
- `utils/aiaBilling.ts:125` `const originalContractSum = project.estimate?.grandTotal ?? 0;` → `effectiveEstimateTotal(project)` *(P0 — lender-facing G702)*
- `app/client-view.tsx:411` `const contractValue = project?.estimate?.grandTotal ?? 0;` → `effectiveEstimateTotal(project)`
- `utils/portalSnapshot.ts:426` (budget-summary total) → `effectiveEstimateTotal(project)`
- `utils/portalSnapshot.ts:644` `!project.estimate?.grandTotal && !project.targetBudget?.amount` → `effectiveEstimateTotal(project) <= 0 && !project.targetBudget?.amount`
- `utils/publicProfileSnapshot.ts:92` → `effectiveEstimateTotal(project)` (keep the existing `?? targetBudget` fallthrough after it)
- `app/weekly-snapshot.tsx:216` `project.estimate?.grandTotal ?? totalBilled` → `effectiveEstimateTotal(project) || totalBilled`
- `app/(tabs)/(home)/index.tsx:112` `(p.estimate?.grandTotal ?? 0) > 0` (has-estimate predicate) → `effectiveEstimateTotal(p) > 0`
- `utils/dataExport.ts:127` `pr.estimate?.grandTotal ?? ''` → `effectiveEstimateTotal(pr) || ''` (preserve blank-when-none CSV cell)
- `components/UniversalMicButton.tsx:200` `proj.estimate?.grandTotal ?? 0` → `effectiveEstimateTotal(proj)`
- `components/PipelineHeroChart.tsx:40-41` (linkedEstimate→estimate ladder) → single `effectiveEstimateTotal(p)` (`> 0 ? value : <existing next fallback>`)

**Group B — correct but hand-rolled (route through the accessor to stop drift):**
- `app/invoice.tsx:145`, `app/closeout-binder.tsx:389`, `app/project-detail.tsx:1112` and `:2803`, `app/(tabs)/summary/index.tsx:103-104`, `utils/earnedValueEngine.ts:72`, `utils/closeoutPacketGenerator.ts:99`, `utils/financialReports.ts:65-66` and `:172-173`, `utils/portalSnapshot.ts:698` (the `+ approvedCOs` stays; only the base becomes `effectiveEstimateTotal(project)`).

Import note: `effectiveEstimateTotal` is exported from `@/utils/estimateCommit`, which imports only `@/types` — acyclic for all these consumers (confirmed in the F0 task). No behavior change beyond returning the correct number; CO-sum / retainage / approvedCO math is untouched.

## 4. H2 — drawing-analyzer dead route

`app/drawing-analyzer.tsx:192-194`: replace `router.push({ pathname: '/estimate', params: { hydratedFromAnalyzer: ... } })` with `router.push({ pathname: '/project-detail', params: { id: pickedProjectId } })` (mirrors `app/estimate-wizard.tsx`'s post-commit navigation). Remove the now-dead `hydratedFromAnalyzer` param. `commitEstimatePatch` already ran before this nav (unchanged).

## 5. H3 — Project Scope entry point (project-detail tile only)

Add a "Scope" tile to `app/project-detail.tsx`'s existing tile grid (same `Tile` shape `{ key,label,icon,color,count }` and `renderTile` path used by the other tiles; place it in the project/precon-oriented group). Tapping it routes `router.push({ pathname: '/project-scope', params: { id: project.id } })` (the route + param the existing NextStepHero "Add scope" card already uses). Surface set/not-set state using the same predicate NextStepHero uses — scope is "set" when `!!project.scope && (project.scope.scope ?? '').trim().length > 0`; show it via the tile's existing status/sub-label affordance (a small "Not set" hint when unset, otherwise the normal tile). No new screen, no scope data-model change — purely an additional entry point to the already-built `/project-scope` screen.

## 6. Edge cases / verification

- `effectiveEstimateTotal` is null-safe (handles null/undefined project) — no new guards needed.
- Predicate replacements keep identical truthiness intent (`> 0` / `<= 0`).
- No estimate-object reads touched (non-goal) — AI/schedule/jobcost behavior unchanged.
- H3 tile uses the existing tile rendering/onPress idiom — no modal/navigation race.
- Verification (no unit runner → `npx tsc --noEmit` clean + manual):
  1. A linked-estimate project (legacy `estimate` null): AIA G702 "Original Contract Sum" = the linked total (not $0); "Balance to Finish" non-negative after a progress invoice.
  2. Homeowner portal budget summary + public profile show the real contract value (not $0/blank).
  3. CSV export estimate column shows the linked total.
  4. Drawing-analyzer → analyze → commit → lands on `/project-detail` (no not-found).
  5. project-detail shows a "Scope" tile → opens `/project-scope?id=`; "Not set" hint when scope empty; reachable repeatedly.
  6. Spot-check Group-B screens (invoice, summary, closeout, financial reports) still show the same totals they did (no regression — they were already correct).

## 7. Files touched (summary)

~12 files for H1 (Groups A+B above) + `app/drawing-analyzer.tsx` (H2) + `app/project-detail.tsx` (H3 tile; also in H1 Group B). Single coherent batch → one implementation plan, subagent-driven with per-task tsc + manual verification.
