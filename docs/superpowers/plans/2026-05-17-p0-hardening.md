# P0 Hardening Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every estimate-total read return the correct value via the single `effectiveEstimateTotal` accessor (kills the $0-on-AIA/portal bug class), fix the dead AI-drawing route, and add a reachable Project Scope entry point — the pre-broad-TestFlight gate.

**Architecture:** Pure mechanical sweep: replace ~18 hand-rolled `linkedEstimate ?? estimate ?? 0` total reads with `effectiveEstimateTotal(project)` (already exported from `utils/estimateCommit.ts:154`, imports only `@/types` → acyclic). One route-string fix. One tile added to project-detail's existing tile grid.

**Tech Stack:** React Native / Expo Router (TypeScript strict). Spec: `docs/superpowers/specs/2026-05-17-p0-hardening-design.md`.

**Verification model:** No unit-test runner. The TDD red/green template does NOT apply. Each task's gate = (1) `npx tsc --noEmit` clean, (2) the specific manual check named in the task (spec §6). All commands from worktree root `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main` (HEAD `d14c77b`). **No checkpoints — code-only, no migration, no edge-fn deploy.**

**The accessor (use verbatim):** `import { effectiveEstimateTotal } from '@/utils/estimateCommit';` — `effectiveEstimateTotal(project): number` = `project?.linkedEstimate?.grandTotal ?? project?.estimate?.grandTotal ?? 0` (null-safe). It returns a **number** (0 when no estimate), so where the old code used `?? targetBudget` to fall through on a *missing* estimate, use `|| project.targetBudget?.amount` (0 falls through — a $0 estimate is meaningless as a budget cap, so this is desired).

**OUT OF SCOPE (do NOT touch — non-goal):** estimate-OBJECT reads `linkedEstimate ?? estimate` (not `.grandTotal`) in `utils/aiService.ts:113/732/815/1187`, `utils/jobCostEngine.ts:139`, `app/schedule-pro.tsx:265`, `components/AICopilot.tsx:101`. Not the bug; already linkedEstimate-first; the accessor returns a number, wrong tool for these.

---

### Task 1: H1 Group-A critical — lender/portal $0 fixes

**Files:** `utils/aiaBilling.ts`, `utils/portalSnapshot.ts`, `utils/publicProfileSnapshot.ts`, `app/client-view.tsx`

- [ ] **Step 1:** Add `import { effectiveEstimateTotal } from '@/utils/estimateCommit';` to each of the 4 files (with the other `@/utils` imports).

- [ ] **Step 2 — `utils/aiaBilling.ts:125`:** replace
`const originalContractSum = project.estimate?.grandTotal ?? 0;`
with
`const originalContractSum = effectiveEstimateTotal(project);`

- [ ] **Step 3 — `utils/portalSnapshot.ts` (~:425-428):** replace the block
```ts
    const baseContract =
      project.estimate?.grandTotal
      ?? project.targetBudget?.amount
      ?? 0;
```
with
```ts
    const baseContract =
      effectiveEstimateTotal(project)
      || project.targetBudget?.amount
      || 0;
```

- [ ] **Step 4 — `utils/portalSnapshot.ts` (~:644):** replace
`!project.estimate?.grandTotal && !project.targetBudget?.amount`
with
`effectiveEstimateTotal(project) <= 0 && !project.targetBudget?.amount`

- [ ] **Step 5 — `utils/publicProfileSnapshot.ts` (~:92-94):** replace
```ts
  const contractValue = project.estimate?.grandTotal
    ?? project.targetBudget?.amount
    ?? undefined;
```
with
```ts
  const _ev = effectiveEstimateTotal(project);
  const contractValue = (_ev > 0 ? _ev : project.targetBudget?.amount) ?? undefined;
```

- [ ] **Step 6 — `app/client-view.tsx:411`:** replace
`const contractValue = project?.estimate?.grandTotal ?? 0;`
with
`const contractValue = effectiveEstimateTotal(project);`

- [ ] **Step 7 — Verify:** `npx tsc --noEmit` clean. Manual (spec §6.1/§6.2): a project with `linkedEstimate.grandTotal=511863` and `estimate=null` → AIA G702 "Original Contract Sum" = 511,863 (not $0), "Balance to Finish" non-negative after a progress invoice; homeowner portal budget summary + public profile show 511,863 (not $0/blank); client-view revised-contract = base+COs (not COs-only).

- [ ] **Step 8 — Commit:**
```bash
git add utils/aiaBilling.ts utils/portalSnapshot.ts utils/publicProfileSnapshot.ts app/client-view.tsx
git commit -m "fix(H1): lender-facing AIA + portal/public-profile show real estimate total (not \$0)"
```

---

### Task 2: H1 Group-A remainder

**Files:** `app/weekly-snapshot.tsx`, `app/(tabs)/(home)/index.tsx`, `utils/dataExport.ts`, `components/UniversalMicButton.tsx`, `components/PipelineHeroChart.tsx`

- [ ] **Step 1:** Add `import { effectiveEstimateTotal } from '@/utils/estimateCommit';` to each file (with other `@/utils` imports).

- [ ] **Step 2 — `app/weekly-snapshot.tsx:216`:** replace
`const budgetCap = project.estimate?.grandTotal ?? totalBilled;`
with
`const budgetCap = effectiveEstimateTotal(project) || totalBilled;`

- [ ] **Step 3 — `app/(tabs)/(home)/index.tsx:112`:** replace the predicate
`|| (p.estimate?.grandTotal ?? 0) > 0,`
with
`|| effectiveEstimateTotal(p) > 0,`

- [ ] **Step 4 — `utils/dataExport.ts:127`:** replace
`pr.status, pr.estimate?.grandTotal ?? '', pr.createdAt, pr.updatedAt,`
with
`pr.status, (effectiveEstimateTotal(pr) || ''), pr.createdAt, pr.updatedAt,`

- [ ] **Step 5 — `components/UniversalMicButton.tsx:200`:** replace
`const baseValue = proj.estimate?.grandTotal ?? 0;`
with
`const baseValue = effectiveEstimateTotal(proj);`

- [ ] **Step 6 — `components/PipelineHeroChart.tsx` (~:40-41):** replace the two-line ladder
```ts
  if (p.linkedEstimate?.grandTotal) return p.linkedEstimate.grandTotal;
  if (p.estimate?.grandTotal) return p.estimate.grandTotal;
```
with
```ts
  const ev = effectiveEstimateTotal(p);
  if (ev > 0) return ev;
```
(leave whatever fallback line follows it unchanged.)

- [ ] **Step 7 — Verify:** `npx tsc --noEmit` clean. Manual (spec §6.3): CSV export estimate column shows the linked total for a linked-estimate project; home estimate-count includes linked-estimate projects; pipeline chart bar uses the linked total.

- [ ] **Step 8 — Commit:**
```bash
git add app/weekly-snapshot.tsx "app/(tabs)/(home)/index.tsx" utils/dataExport.ts components/UniversalMicButton.tsx components/PipelineHeroChart.tsx
git commit -m "fix(H1): remaining legacy-only estimate-total reads use effectiveEstimateTotal"
```

---

### Task 3: H1 Group-B — correctness-preserving consistency sweep

**Files:** `app/invoice.tsx`, `app/closeout-binder.tsx`, `app/project-detail.tsx`, `app/(tabs)/summary/index.tsx`, `utils/earnedValueEngine.ts`, `utils/closeoutPacketGenerator.ts`, `utils/financialReports.ts`, `utils/portalSnapshot.ts`

These already produce the correct number (they hand-roll `linkedEstimate?.grandTotal ?? estimate?.grandTotal ?? 0`). Routing them through the accessor must NOT change the displayed value — only de-duplicate the ladder.

- [ ] **Step 1:** Add the import to each file (skip files that already imported it in an earlier task: `utils/portalSnapshot.ts` already has it from Task 1).

- [ ] **Step 2 — single-line `X.linkedEstimate?.grandTotal ?? X.estimate?.grandTotal ?? 0` → `effectiveEstimateTotal(X)`** at:
  - `app/invoice.tsx:145` `let base = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;` → `let base = effectiveEstimateTotal(project);`
  - `app/closeout-binder.tsx:389` `const baseSum = (project.linkedEstimate?.grandTotal) ?? (project.estimate?.grandTotal) ?? 0;` → `const baseSum = effectiveEstimateTotal(project);`
  - `app/project-detail.tsx:1112` `const heroTotal = linkedEstimate?.grandTotal ?? estimate?.grandTotal ?? 0;` → `const heroTotal = effectiveEstimateTotal(project);` (the screen's `project` object is in scope; `linkedEstimate`/`estimate` here are destructured from it)
  - `app/project-detail.tsx:2803` `{formatMoney(project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0)}` → `{formatMoney(effectiveEstimateTotal(project))}`
  - `utils/earnedValueEngine.ts:72` `const bac = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;` → `const bac = effectiveEstimateTotal(project);`
  - `utils/closeoutPacketGenerator.ts:99` `const baseEstimate = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;` → `const baseEstimate = effectiveEstimateTotal(project);`
  - `utils/portalSnapshot.ts:698` `const contractValue = (project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0) + approvedCOs;` → `const contractValue = effectiveEstimateTotal(project) + approvedCOs;`

- [ ] **Step 3 — multi-line ladders → `effectiveEstimateTotal(project)`:**
  - `app/(tabs)/summary/index.tsx` (~:103-105)
```ts
  const budget = project.linkedEstimate?.grandTotal
    ?? project.estimate?.grandTotal
    ?? 0;
```
→ `const budget = effectiveEstimateTotal(project);`
  - `utils/financialReports.ts` (~:64-67) and (~:171-174) — both occurrences:
```ts
    const contractValue =
      project.linkedEstimate?.grandTotal
      ?? project.estimate?.grandTotal
      ?? 0;
```
→ `const contractValue = effectiveEstimateTotal(project);`

- [ ] **Step 4 — Verify:** `npx tsc --noEmit` clean. Manual (spec §6.6): open invoice (base), project-detail hero + estimate section total, summary budget, a financial report, closeout binder — each shows the SAME number it did before this task (these were already correct; this is a no-visible-change refactor). Confirm via a project that has a `linkedEstimate`.

- [ ] **Step 5 — Commit:**
```bash
git add app/invoice.tsx app/closeout-binder.tsx app/project-detail.tsx "app/(tabs)/summary/index.tsx" utils/earnedValueEngine.ts utils/closeoutPacketGenerator.ts utils/financialReports.ts utils/portalSnapshot.ts
git commit -m "refactor(H1): route hand-rolled estimate-total reads through effectiveEstimateTotal"
```

---

### Task 4: H2 — drawing-analyzer dead route

**Files:** `app/drawing-analyzer.tsx`

- [ ] **Step 1 (~:192-196):** the current code is:
```ts
            updateProject(pickedProjectId, commitEstimatePatch(getProject(pickedProjectId), linked, { reason: 'pre_overwrite' }));
            router.push({
              pathname: '/estimate' as never,
              params: { projectId: pickedProjectId, hydratedFromAnalyzer: '1' } as never,
            });
```
Replace ONLY the `router.push({...})` call with:
```ts
            router.push({ pathname: '/project-detail', params: { id: pickedProjectId } } as never);
```
(Leave the `updateProject(... commitEstimatePatch ...)` line untouched. The `hydratedFromAnalyzer` param is dropped with the old push.)

- [ ] **Step 2 — Verify:** `npx tsc --noEmit` clean. Manual (spec §6.4): in the app, upload a drawing → analyze → confirm/commit → lands on the project-detail screen for that project (NOT a "page not found").

- [ ] **Step 3 — Commit:**
```bash
git add app/drawing-analyzer.tsx
git commit -m "fix(H2): drawing-analyzer routes to /project-detail (was dead /estimate)"
```

---

### Task 5: H3 — Project Scope tile on project-detail

**Files:** `app/project-detail.tsx`

READ `app/project-detail.tsx` first: the `SectionKey` union (~:75), the `Tile` type `{ key,label,icon,color,count }` and the tile arrays/groups (~:1400-1430), `renderTile` and its per-key `router.push` switch (~:1439-1485), the `tileBadges`/status sub-label affordance, and `colorFor()`. The screen has `project`, `router`, and `id` in scope.

- [ ] **Step 1:** Ensure a lucide icon is available for scope — reuse one already imported (e.g. `ClipboardList` or `FileText` — pick one present in this file's lucide import; if `ClipboardEdit` is imported use it, else `FileText`).

- [ ] **Step 2:** Add `'scope'` to the `SectionKey` union (~:75) if not present.

- [ ] **Step 3:** Add a tile entry to the project/precon-oriented tile group array (the same array that holds e.g. the `linkedEstimate`/`schedule` tiles, near ~:1403). Use the established object shape and `colorFor`:
```ts
            { key: 'scope', label: 'Scope', icon: <ScopeIcon>, color: colorFor('scope'), count: null },
```
(`<ScopeIcon>` = the icon chosen in Step 1. `count: null` so no count badge renders, matching other non-counting tiles.)

- [ ] **Step 4:** In `renderTile`'s `onPress` per-key switch (the block with `if (tile.key === 'plans') { router.push(... '/plans' ...); return; }` etc.), add a `scope` case BEFORE the generic `setActiveTile(tile.key)` fallthrough:
```ts
                  if (tile.key === 'scope') { router.push({ pathname: '/project-scope', params: { id } } as never); return; }
```

- [ ] **Step 5 (set/not-set hint):** the tile grid renders an optional status sub-label via `tileBadges[tile.key]`. Add a scope entry to whatever builds `tileBadges` so that when scope is unset it shows a muted "Not set". The "set" predicate is `!!project.scope && (project.scope.scope ?? '').trim().length > 0`. Concretely, where `tileBadges` is constructed, add:
```ts
      scope: (!!project.scope && (project.scope.scope ?? '').trim().length > 0)
        ? undefined
        : { label: 'Not set', tone: 'neutral' },
```
(Match the exact shape/tone keys the existing `tileBadges`/`STATUS_TONES` use — read them; if the tone enum has no `'neutral'`, use the same tone an existing informational badge uses. If `tileBadges` is not easily extensible without broader changes, it is acceptable to omit the hint and ship just the tile + navigation — note this in the report.)

- [ ] **Step 6 — Verify:** `npx tsc --noEmit` clean. Manual (spec §6.5): project-detail shows a "Scope" tile; tapping opens `/project-scope?id=<thisProject>`; a project with empty scope shows the "Not set" hint; reachable repeatedly (not gated by NextStepHero state).

- [ ] **Step 7 — Commit:**
```bash
git add app/project-detail.tsx
git commit -m "fix(H3): add Scope tile entry point on project-detail (screen was orphaned)"
```

---

### Task 6: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` clean repo-wide.
- [ ] **Step 2:** `npx eslint utils/aiaBilling.ts utils/portalSnapshot.ts utils/publicProfileSnapshot.ts app/client-view.tsx app/weekly-snapshot.tsx "app/(tabs)/(home)/index.tsx" utils/dataExport.ts components/UniversalMicButton.tsx components/PipelineHeroChart.tsx app/invoice.tsx app/closeout-binder.tsx app/project-detail.tsx "app/(tabs)/summary/index.tsx" utils/earnedValueEngine.ts utils/closeoutPacketGenerator.ts utils/financialReports.ts app/drawing-analyzer.tsx` — 0 NEW errors (pre-existing warnings OK).
- [ ] **Step 3:** Walk spec §6 steps 1–6 end to end.
- [ ] **Step 4:** `git grep -nE "\\.estimate\\?\\.grandTotal" -- 'app/*' 'utils/*' 'components/*' | grep -v estimateCommit` → confirm NO remaining hand-rolled estimate-**total** reads except the explicitly out-of-scope object reads (none should match `.grandTotal`); the only `effectiveEstimateTotal` definition stays in `utils/estimateCommit.ts`.
- [ ] **Step 5:** Confirm the OUT-OF-SCOPE object reads (`aiService.ts`, `jobCostEngine.ts:139`, `schedule-pro.tsx:265`, `AICopilot.tsx:101`) are UNCHANGED (`git diff main...HEAD --stat` should not list them).

## Self-review notes

- Single mechanical batch, decomposed so the lender-facing fix (Task 1) lands first and independently.
- `||` vs `??`: `effectiveEstimateTotal` returns `0` (not null) when no estimate, so `|| targetBudget` / `|| totalBilled` / `|| ''` preserves the original "fall through when there's no estimate" intent (a $0 estimate as a budget cap is meaningless → falling through is correct/desired).
- Group B (Task 3) is explicitly a no-visible-change refactor; its manual check is "same number as before."
- No new types/functions introduced; `effectiveEstimateTotal` already exists and is acyclic. No migration, no edge-fn, no checkpoint.
