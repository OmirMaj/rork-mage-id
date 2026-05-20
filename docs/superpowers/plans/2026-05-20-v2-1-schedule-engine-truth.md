# v2.1 Schedule Engine Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `project.schedule` produce one true SPI/CPI, one true critical-path-days, and one true free-float visible consistently across every screen.

**Architecture:** Three engine fixes across three util files + one screen, three dead-code deletes (two whole-file utility deletes + two within-file deletes), and one type-shape cleanup. No new files, no migration, no edge fn, no new dependency. Strict TS no `any`. Per-task gate is `npx tsc --noEmit` clean + spec §6 reasoning. No unit-test runner in this repo — verification is `tsc` + grep assertions + manual spot-checks on the audit's reproducer scenarios.

**Tech Stack:** TypeScript (strict mode), React Native (Expo Router 6), Supabase (no schema change). Worktree at `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` == main @ `f0de54f`. Spec at `docs/superpowers/specs/2026-05-19-v2-1-schedule-engine-truth-design.md` (committed `f62a071`, amended `c3f5b77`).

---

## File ledger (locked scope — 7 modified + 3 deleted = 10 file-level changes)

| # | File | Change | Task |
|---|---|---|---|
| 1 | `utils/cpm.ts` | Modify `computeFreeFloat:455-496` + delete `applyCpmToTasks:730-742` | Task 1 |
| 2 | `utils/scheduleEngine.ts` | Add `opts.criticalPathDays` to `buildScheduleFromTasks`; delete `:286-287` heuristic | Task 2 |
| 3 | `app/schedule-pro.tsx` | Thread `cpm.projectFinish` into both `buildScheduleFromTasks` callsites; delete `loeAdjustedTasks` block at `:227-238` + its imports | Task 2 |
| 4 | `utils/scheduleEarnedValue.ts` | Add `buildCashFlow`, `legacyEvmMetrics`, type `CashFlowPoint`, private `elapsedDaysForCursor`/`round1`/`round2` helpers | Task 3 |
| 5 | `app/budget-dashboard.tsx` | Swap imports + 2 function calls | Task 4 |
| 6 | `utils/earnedValueEngine.ts` | **DELETE** (112 lines) | Task 5 |
| 7 | `types/index.ts` | Remove `auditLog?: ScheduleAuditEntry[]` field from `ProjectSchedule` at `:791` | Task 6 |
| 8 | `utils/scheduleAudit.ts` | Update stale comment at `:8-10` to reflect AsyncStorage backing | Task 6 |
| 9 | `utils/scheduleFragnets.ts` | **DELETE** (orphaned) | Task 7 |
| 10 | `utils/scheduleResourceRates.ts` | **DELETE** (orphaned) | Task 7 |

**Files NOT touched** (each task's diff must stay narrow — verify with `git diff --stat` at each commit):

`contexts/ProjectContext.tsx`, `app/schedule-wizard.tsx`, `app/project-detail.tsx`, `utils/aiService.ts`, `utils/pdfGenerator.ts`, `components/schedule/SchedulerHeader.tsx`, `components/schedule/tabs/DashboardTab.tsx`, `components/schedule/SchedulerContext.tsx`, `app/(tabs)/discover/schedule/index.tsx`, the 7 other schedule-related utils not in the ledger, the 26 other `components/schedule/*` files, the classic mobile schedule, `hooks/useTierAccess.ts`, RevenueCat configuration.

---

## Task 1: Free-float SS/FF/SF + delete `applyCpmToTasks`

**Files:**
- Modify: `utils/cpm.ts:484-492` (the FS-only filter inside `computeFreeFloat`)
- Delete: `utils/cpm.ts:730-742` (`applyCpmToTasks` function — confirmed zero callers per spec §4.5)

- [ ] **Step 1.1: Read the current `computeFreeFloat` body**

Run: `sed -n '455,496p' utils/cpm.ts`
Expected: see the function body, the `successors` map keyed by predecessor ID → `{ succ, link }[]`, and the bug at line 487 (`if ((link.type ?? 'FS') !== 'FS') continue;`).

Confirm: the file uses `link.lagDays` (NOT `link.lag`) — see line 488 of the current code.

- [ ] **Step 1.2: Replace the FS-only inner loop body**

In `utils/cpm.ts`, find this block (currently lines 483-492):

```ts
    let minSucc = Infinity;
    for (const { succ, link } of succs) {
      const succFwd = forward.get(succ.id);
      if (!succFwd) continue;
      if ((link.type ?? 'FS') !== 'FS') continue;
      const lag = link.lagDays || 0;
      // succ.ES − lag − 1 is the latest this task can finish; − EF is slack.
      const slack = succFwd.es - lag - 1 - fwd.ef;
      if (slack < minSucc) minSucc = slack;
    }
```

Replace with:

```ts
    let minSucc = Infinity;
    for (const { succ, link } of succs) {
      const succFwd = forward.get(succ.id);
      if (!succFwd) continue;
      const lag = link.lagDays || 0;
      // Bound on this task's allowable forward shift Δ that keeps the
      // successor's relevant CPM date (ES for FS/SS; EF for FF/SF)
      // unchanged. See spec §4.1 for derivation. MIN across outgoing
      // links is the predecessor's free float.
      let slack: number;
      switch (link.type ?? 'FS') {
        case 'FS': slack = succFwd.es - fwd.ef - lag - 1; break;
        case 'SS': slack = succFwd.es - fwd.es - lag;     break;
        case 'FF': slack = succFwd.ef - fwd.ef - lag;     break;
        case 'SF': slack = succFwd.ef - fwd.es - lag;     break;
      }
      if (slack < minSucc) minSucc = slack;
    }
```

The final `ff.set(task.id, minSucc === Infinity ? 0 : Math.max(0, minSucc));` line at 493 stays as-is (existing clamp).

- [ ] **Step 1.3: Update the function header comment**

In `utils/cpm.ts`, the comment block currently at lines 450-454 says:

```
// Free float = how much this task can slip WITHOUT delaying ANY successor's
// early start. Computed only for FS links in this first pass — the other
// link types have messier "earliest successor impact" semantics and the
// pragmatic MS Project convention is to only surface TF for those.
```

Replace with:

```
// Free float = how much this task can slip WITHOUT delaying ANY successor's
// relevant CPM date (ES for FS/SS successors; EF for FF/SF successors —
// any shift in T's ES propagates to T's EF since duration is fixed, so
// the formulas all reduce to "how much can T's ES move before the
// successor's constraint binds"). MIN over outgoing links, clamp at 0.
```

- [ ] **Step 1.4: Delete `applyCpmToTasks`**

In `utils/cpm.ts`, delete lines 730-742 (the JSDoc block at `/**` through the closing `}` of the function body). The result should be that line 728 (the `// Helpers for the UI layer` section header) is immediately followed by what was line 744 (the `formatFloat` JSDoc).

Verify:
```bash
grep -n "applyCpmToTasks" utils/cpm.ts
```
Expected: 0 matches.

- [ ] **Step 1.5: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 1.6: Repo-wide assertion — no broken callers of `applyCpmToTasks`**

Run: `git grep -nE "applyCpmToTasks"`
Expected: 0 matches anywhere in the repo (the function was the only definition; nothing imported it).

- [ ] **Step 1.7: Commit**

```bash
git add utils/cpm.ts
git commit -m "$(cat <<'EOF'
fix(cpm): extend free-float math to SS/FF/SF; remove dead applyCpmToTasks

Bug #5 from the v2.1 audit. computeFreeFloat short-circuited on any
non-FS link via `if ((link.type ?? 'FS') !== 'FS') continue;`, causing
the Grid Float column to under-report slack on schedules using SS/FF/SF
links and mislabel non-critical tasks as "Critical."

Per-link bounds for predecessor T → successor S with lag L:
  FS: S.ES − T.EF − L − 1
  SS: S.ES − T.ES − L
  FF: S.EF − T.EF − L
  SF: S.EF − T.ES − L

Free float for T = MIN over outgoing links, clamped at 0 (existing
safety net preserved).

Same-file cleanup: deleted applyCpmToTasks (cpm.ts:730-742) — zero
callers (confirmed via git grep). The schedule-pro render path
consumes cpm.perTask directly; this helper was vestigial.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `criticalPathDays` single source + delete `loeAdjustedTasks`

**Files:**
- Modify: `utils/scheduleEngine.ts:271-357` (add `opts.criticalPathDays`; delete heuristic at `:286-287`)
- Modify: `app/schedule-pro.tsx:301-306` and `:336-339` (thread `cpm.projectFinish` into both `buildScheduleFromTasks` callsites)
- Modify: `app/schedule-pro.tsx:227-238` (delete `loeAdjustedTasks` block + its now-unused imports)

- [ ] **Step 2.1: Read the current `buildScheduleFromTasks` signature**

Run: `sed -n '271,290p' utils/scheduleEngine.ts`
Expected: see the 4-arg signature `(name, projectId, tasks, existingBaseline?)` and the bug location at lines 286-287 where critical tasks are filtered by `isCriticalPath || hasDeps || dur >= 4` and summed.

- [ ] **Step 2.2: Add the `opts.criticalPathDays` parameter to `buildScheduleFromTasks`**

In `utils/scheduleEngine.ts`, change the signature from:

```ts
export function buildScheduleFromTasks(
  name: string,
  projectId: string | null,
  tasks: ScheduleTask[],
  existingBaseline?: ScheduleBaseline | null
): ProjectSchedule {
```

To:

```ts
export function buildScheduleFromTasks(
  name: string,
  projectId: string | null,
  tasks: ScheduleTask[],
  existingBaseline?: ScheduleBaseline | null,
  opts?: {
    /** Engine-derived project-finish day. When omitted, falls back to
     *  max(t.startDay + t.durationDays - 1) — correct for a single-pass
     *  forward-only resolver. Pass `cpm.projectFinish` to use the full
     *  CPM result. */
    criticalPathDays?: number;
  },
): ProjectSchedule {
```

- [ ] **Step 2.3: Replace the heuristic critical-path computation**

In `utils/scheduleEngine.ts`, find lines 286-287:

```ts
  const criticalTasks = sortedTasks.filter(t => t.isCriticalPath || getDepLinks(t).length > 0 || t.durationDays >= 4);
  const criticalPathDays = criticalTasks.reduce((sum, task) => sum + task.durationDays, 0);
```

Replace with:

```ts
  // criticalPathDays = engine-true project-finish day. Caller passes
  // cpm.projectFinish via opts; if absent, fall back to the latest
  // task end-day (semantically the same as projectFinish for a
  // schedule whose tasks have already had a forward pass applied,
  // and a sane approximation otherwise). NEVER the old
  // sum-of-critical-durations heuristic — that produced a different
  // value from runCpm and overwrote it on every persist (audit bug #4).
  const criticalPathDays =
    opts?.criticalPathDays
    ?? sortedTasks.reduce((max, t) => Math.max(max, t.startDay + t.durationDays - 1), 0);
```

Note: `criticalTasks` is no longer used after this block (it was only used to compute `criticalPathDays`). Verify no other references in the function — there should be none. If `criticalTasks` is referenced later (e.g., by `riskItems` logic), keep its filter but rename to make intent clear, OR scope it to where it's used. **Re-read lines 290-340 of the file before deciding** — the spec assumes `criticalTasks` is local-to-the-deleted-block.

- [ ] **Step 2.4: Read the schedule-pro persist + unmount-flush call sites**

Run: `sed -n '297,360p' app/schedule-pro.tsx`
Expected: see two `buildScheduleFromTasks(...)` calls — one inside `schedulePersist` useCallback (around line 301) and one inside the unmount-flush useEffect (around line 336).

- [ ] **Step 2.5: Thread `cpm.projectFinish` into the persist callsite**

In `app/schedule-pro.tsx`, find the `buildScheduleFromTasks` call inside `schedulePersist` (approximately lines 301-306):

```ts
      const newSchedule = buildScheduleFromTasks(
        project.schedule?.name ?? project.name ?? 'Schedule',
        project.id,
        tasks,
        project.schedule?.baseline ?? null,
      );
```

Replace with:

```ts
      const newSchedule = buildScheduleFromTasks(
        project.schedule?.name ?? project.name ?? 'Schedule',
        project.id,
        tasks,
        project.schedule?.baseline ?? null,
        { criticalPathDays: cpm.projectFinish }, // v2.1: engine-true value
      );
```

- [ ] **Step 2.6: Thread `cpm.projectFinish` into the unmount-flush callsite**

In `app/schedule-pro.tsx`, find the `buildScheduleFromTasks` call inside the unmount useEffect (approximately lines 336-339, inside the `if (project) { ... }` block):

```ts
          const newSchedule = buildScheduleFromTasks(
            project.schedule?.name ?? project.name ?? 'Schedule',
            project.id,
            workingTasks,
```

The full call should currently end with `project.schedule?.baseline ?? null,` and the closing `)`. Replace the closing portion of the call so the final argument list becomes:

```ts
          const newSchedule = buildScheduleFromTasks(
            project.schedule?.name ?? project.name ?? 'Schedule',
            project.id,
            workingTasks,
            project.schedule?.baseline ?? null,
            { criticalPathDays: cpm.projectFinish }, // v2.1: engine-true value
          );
```

The unmount effect's dependency array should also include `cpm` (or `cpm.projectFinish`) so the closure captures the latest value. **Re-read the useEffect's dependency array** — if `cpm` isn't already listed, add it. The audit's bug #7 (debounce race) is deliberately not solved in v2.1; we're only ensuring the closure sees a fresh-enough value.

- [ ] **Step 2.7: Delete the `loeAdjustedTasks` useMemo + its preceding comment + its trailing `void`**

In `app/schedule-pro.tsx`, find this block (approximately lines 227-238):

```ts
  // Level-of-Effort post-process: stretch LOE tasks to span their linked
  // work. Cheap when no LOE tasks exist (early-return). The result feeds
  // the Gantt + grid views, which call this `loeAdjustedTasks` instead
  // of `rolledTasks` for rendering.
  const loeAdjustedTasks = useMemo(
    () => hasAnyLevelOfEffort(rolledTasks)
      ? applyLevelOfEffortSpans(rolledTasks, cpm)
      : rolledTasks,
    [rolledTasks, cpm],
  );
  void loeAdjustedTasks; // exposed for future view wiring; rolledTasks
  // is still the authoritative source for the existing render paths.
```

Delete the entire block (all 12 lines). The result: line 226 (the blank line before, or whatever immediately precedes the LOE comment) is followed by what was line 240 (the `// Schedule health score — pure compute over current tasks + cpm.` comment that starts the next useMemo).

- [ ] **Step 2.8: Remove now-unused imports**

In `app/schedule-pro.tsx`, find this import (somewhere in the top import block, likely around line 62):

```ts
import { applyLevelOfEffortSpans, hasAnyLevelOfEffort } from '@/utils/scheduleLoeEngine';
```

After Step 2.7, both symbols are unused. Either:
- Delete the entire import line, OR
- If `scheduleLoeEngine` exports additional symbols still used elsewhere in this file, narrow the import to only those.

Verify via grep:
```bash
grep -nE "applyLevelOfEffortSpans|hasAnyLevelOfEffort" app/schedule-pro.tsx
```
Expected after deletion: 0 matches (the import line is gone and no other references exist).

- [ ] **Step 2.9: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2.10: Repo-wide check that no other file expected the old heuristic**

Run: `git grep -nE "criticalTasks\.reduce|sum, task\) => sum \+ task\.durationDays"`
Expected: 0 matches (the heuristic was unique to `scheduleEngine.ts:287`).

- [ ] **Step 2.11: Commit**

```bash
git add utils/scheduleEngine.ts app/schedule-pro.tsx
git commit -m "$(cat <<'EOF'
fix(schedule): criticalPathDays single source of truth + remove void'd LOE useMemo

Bug #4 from the v2.1 audit. criticalPathDays had 4 writers and 2
different definitions:
  - runCpm.projectFinish (engine-true, used by schedule-pro UI)
  - sum(critical.durationDays) heuristic in scheduleEngine.ts:287
    (overwrote the engine value on every persist)

Fix:
  - buildScheduleFromTasks gains opts.criticalPathDays (optional);
    when omitted, fallback uses max(t.startDay + t.durationDays - 1)
    — semantically equivalent to runCpm.projectFinish on a forward-
    passed schedule, NEVER the old heuristic.
  - schedule-pro's persist + unmount-flush sites both pass
    cpm.projectFinish into opts. All 7 readers (project-detail tile,
    aiService, pdfGenerator, SchedulerHeader, DashboardTab, etc.)
    now see the same value the Gantt header shows.

Same-file cleanup in schedule-pro.tsx: removed the loeAdjustedTasks
useMemo at :227-238 (computed and explicitly `void`'d on the next
line; render path uses rolledTasks). Also removed the now-unused
applyLevelOfEffortSpans / hasAnyLevelOfEffort imports.

contexts/ProjectContext.tsx delay-bump path unchanged (still bumps
the base value, which is now engine-true).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: EV engine collapse — part 1 (add adapter + cash flow to `scheduleEarnedValue.ts`)

**Files:**
- Modify: `utils/scheduleEarnedValue.ts` (additive — new exports `buildCashFlow`, `legacyEvmMetrics`, `CashFlowPoint`, private helpers)

- [ ] **Step 3.1: Read the current `scheduleEarnedValue.ts` to confirm the existing exports + the `EarnedValueMetrics` type**

Run: `cat utils/scheduleEarnedValue.ts`
Expected: see `buildEarnedValueSnapshot`, `computeActualCostFromInvoices`, `formatMoneyCompact`, `performanceTone`, types `TaskCostLoad`, `ScheduleEvSnapshot`, `BuildEvOpts`.

Run: `grep -nE "EarnedValueMetrics" types/index.ts`
Expected: find the `EarnedValueMetrics` interface — note its fields exactly (BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC, VAC, percentComplete, calculatedAt).

Run: `grep -nE "import.*effectiveEstimateTotal|effectiveEstimateTotal" utils/`
Expected: confirm `effectiveEstimateTotal` is exported from `@/utils/estimateCommit` (we'll need it for `buildCashFlow`).

- [ ] **Step 3.2: Add the `CashFlowPoint` type + `buildCashFlow` export**

In `utils/scheduleEarnedValue.ts`, after the existing `performanceTone` export at the bottom of the file, append:

```ts

// ---------------------------------------------------------------------------
// Cash flow + legacy-EVM adapter
//
// These two exports replace the dead utils/earnedValueEngine.ts. They route
// every EV-derived number through buildEarnedValueSnapshot above so the
// Schedule Pro panel and the Budget Dashboard agree on SPI/CPI for the same
// project. See spec §4.3 for the collapse rationale.
// ---------------------------------------------------------------------------

import type { Project, Invoice, ProjectSchedule, EarnedValueMetrics } from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

export interface CashFlowPoint {
  period: string;
  plannedCumulative: number;
  actualCumulative: number;
  forecastCumulative: number;
}

/**
 * Period-bucket cash-flow projection. PV is linearly distributed across
 * `periods` buckets; AC is real invoice payments bucketed by period;
 * forecast = planned / CPI (so a CPI < 1 inflates the forecast). Matches
 * the shape of the dead engine's generateCashFlowData; CPI is sourced
 * from buildEarnedValueSnapshot at end-of-project (one canonical engine).
 *
 * Per-task PV-per-period (more accurate than linear) is deliberately
 * deferred — same approximation the dead engine used. v2.1 = engine-
 * truth at the SPI/CPI level; cash-flow accuracy is its own product
 * question.
 */
export function buildCashFlow(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
  periods: number = 12,
): CashFlowPoint[] {
  const bac = effectiveEstimateTotal(project);
  const totalDays = schedule?.totalDurationDays ?? 180;
  const daysPerPeriod = Math.ceil(totalDays / periods);
  const startDate = new Date(project.createdAt);

  const projectInvoices = invoices
    .filter(inv => inv.projectId === project.id)
    .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

  // Canonical CPI source — same engine the Schedule Pro panel uses.
  const snap = buildEarnedValueSnapshot(
    schedule?.tasks ?? [],
    project.linkedEstimate,
    { dayCursor: totalDays, invoices: projectInvoices },
  );
  const cpi = snap.cpi ?? 1;

  const data: CashFlowPoint[] = [];
  let actualCumulative = 0;

  for (let i = 0; i < periods; i++) {
    const periodStart = new Date(startDate.getTime() + i * daysPerPeriod * 86400000);
    const periodEnd = new Date(startDate.getTime() + (i + 1) * daysPerPeriod * 86400000);

    const plannedRatio = Math.min((i + 1) / periods, 1);
    const plannedCumulative = bac * plannedRatio;

    const periodPayments = projectInvoices.filter(inv => {
      const d = new Date(inv.issueDate).getTime();
      return d >= periodStart.getTime() && d < periodEnd.getTime();
    });
    actualCumulative += periodPayments.reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);

    const forecastCumulative = cpi !== 0 ? plannedCumulative / cpi : plannedCumulative;

    data.push({
      period: `Wk ${i + 1}`,
      plannedCumulative: Math.round(plannedCumulative),
      actualCumulative: Math.round(actualCumulative),
      forecastCumulative: Math.round(forecastCumulative),
    });
  }

  return data;
}

/**
 * Legacy-shape EarnedValueMetrics adapter. Lets budget-dashboard.tsx
 * keep its existing UI code path unchanged while sourcing every number
 * from the canonical buildEarnedValueSnapshot pipeline.
 *
 * Deliberate semantic shift on `percentComplete`: the dead engine used
 * avg(task.progress) — equally weighted regardless of dollar value. The
 * new shape uses cost-weighted EV/BAC × 100. Same scenario can produce
 * a much lower (correct) number on schedules with uneven task budgets.
 * Documented in spec §4.4.
 */
export function legacyEvmMetrics(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
): EarnedValueMetrics {
  const tasks = schedule?.tasks ?? [];
  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const dayCursor = elapsedDaysForCursor(project, schedule);

  const snap = buildEarnedValueSnapshot(
    tasks,
    project.linkedEstimate,
    { dayCursor, invoices: projectInvoices },
  );

  const bac = snap.totalBudget;
  const pv = snap.totalPlannedValue;
  const ev = snap.totalEarnedValue;
  const ac = computeActualCostFromInvoices(projectInvoices);
  const sv = ev - pv;
  const cv = ev - ac;
  const spi = snap.spi;
  const cpi = snap.cpi ?? 1;
  const eac = cpi !== 0 ? bac / cpi : bac;
  const etc = eac - ac;
  const vac = bac - eac;
  const percentComplete = bac > 0 ? (ev / bac) * 100 : 0;

  return {
    budgetAtCompletion: bac,
    plannedValue: pv,
    earnedValue: ev,
    actualCost: ac,
    scheduleVariance: sv,
    costVariance: cv,
    schedulePerformanceIndex: round2(spi),
    costPerformanceIndex: round2(cpi),
    estimateAtCompletion: round2(eac),
    estimateToComplete: round2(etc),
    varianceAtCompletion: round2(vac),
    percentComplete: round1(percentComplete),
    calculatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Calendar-days elapsed since project start, clamped to 1..totalDurationDays.
 *  v2.1 keeps the same calendar-days approximation the dead engine used.
 *  Calendar-aware (working days + holidays) lands in v2.2. */
function elapsedDaysForCursor(
  project: Project,
  schedule: ProjectSchedule | null | undefined,
): number {
  if (!project.createdAt) return 1;
  const start = new Date(project.createdAt).getTime();
  const now = Date.now();
  if (now <= start) return 1;
  const elapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;
  const cap = schedule?.totalDurationDays ?? elapsed;
  return Math.min(Math.max(1, elapsed), Math.max(1, cap));
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
```

- [ ] **Step 3.3: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors. (The new exports compile but aren't called yet — `earnedValueEngine.ts` still in use by budget-dashboard.tsx until Task 4.)

- [ ] **Step 3.4: Commit**

```bash
git add utils/scheduleEarnedValue.ts
git commit -m "$(cat <<'EOF'
feat(schedule-ev): add buildCashFlow + legacyEvmMetrics adapter

First half of bug #1 fix from the v2.1 audit (two EV engines, contradictory
SPI/CPI). scheduleEarnedValue.ts gains two new exports + a CashFlowPoint
type + private helpers (elapsedDaysForCursor, round1, round2). Both new
functions route every EV-derived number through buildEarnedValueSnapshot,
the canonical pipeline.

legacyEvmMetrics produces the EarnedValueMetrics shape so budget-dashboard.tsx
can swap imports in Task 4 without changing any downstream UI code.

Deliberate semantic shift documented inline: percentComplete is now
cost-weighted (EV/BAC × 100) instead of avg(task.progress). On schedules
with uneven task budgets this number will read LOWER — correct math, not
a regression.

earnedValueEngine.ts is still in use by budget-dashboard.tsx; the swap
+ delete happen in Tasks 4 and 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: EV engine collapse — part 2 (port `budget-dashboard.tsx`)

**Files:**
- Modify: `app/budget-dashboard.tsx:21` (import swap)
- Modify: `app/budget-dashboard.tsx:82, :87` (call swaps)

- [ ] **Step 4.1: Read the existing imports + callsites**

Run: `sed -n '20,90p' app/budget-dashboard.tsx`
Expected: line 21 is `import { calculateEVM, generateCashFlowData } from '@/utils/earnedValueEngine';`; line 82 is `return calculateEVM(project, projectInvoices, project.schedule);`; line 87 is `return generateCashFlowData(project, projectInvoices, project.schedule, 10);`.

- [ ] **Step 4.2: Swap the import**

In `app/budget-dashboard.tsx`, replace line 21:

```ts
import { calculateEVM, generateCashFlowData } from '@/utils/earnedValueEngine';
```

With:

```ts
import { legacyEvmMetrics, buildCashFlow } from '@/utils/scheduleEarnedValue';
```

- [ ] **Step 4.3: Swap the `calculateEVM` call**

In `app/budget-dashboard.tsx`, find the line currently at 82:

```ts
    return calculateEVM(project, projectInvoices, project.schedule);
```

Replace with:

```ts
    return legacyEvmMetrics(project, projectInvoices, project.schedule);
```

- [ ] **Step 4.4: Swap the `generateCashFlowData` call**

In `app/budget-dashboard.tsx`, find the line currently at 87:

```ts
    return generateCashFlowData(project, projectInvoices, project.schedule, 10);
```

Replace with:

```ts
    return buildCashFlow(project, projectInvoices, project.schedule, 10);
```

(`10` is the periods argument the original caller used — preserved.)

- [ ] **Step 4.5: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4.6: Confirm `earnedValueEngine` is no longer referenced from the screen**

Run: `grep -nE "earnedValueEngine|calculateEVM|generateCashFlowData" app/budget-dashboard.tsx`
Expected: 0 matches.

- [ ] **Step 4.7: Commit**

```bash
git add app/budget-dashboard.tsx
git commit -m "$(cat <<'EOF'
fix(budget-dashboard): port from earnedValueEngine to scheduleEarnedValue adapter

Second half of bug #1 from the v2.1 audit. budget-dashboard.tsx now
consumes legacyEvmMetrics + buildCashFlow from scheduleEarnedValue.ts —
the same canonical EV pipeline schedule-pro and the EarnedValuePanel
already use. SPI/CPI on the dashboard now matches the Gantt header.

Output shapes unchanged. All downstream chart / tile / sparkline / AI
forecast prompt code untouched.

Heads-up for QA: the Percent Complete tile will read lower than before
on projects with uneven task budgets. This is the deliberate cost-
weighted shift documented in scheduleEarnedValue.legacyEvmMetrics and
spec §4.4.

Next: delete earnedValueEngine.ts (Task 5 — now has 0 callers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delete `utils/earnedValueEngine.ts`

**Files:**
- Delete: `utils/earnedValueEngine.ts` (112 lines, now zero callers after Task 4)

- [ ] **Step 5.1: Verify zero callers repo-wide**

Run: `git grep -nE "from ['\"]@/utils/earnedValueEngine['\"]|from ['\"]\.\./utils/earnedValueEngine['\"]|from ['\"]\.\./\.\./utils/earnedValueEngine['\"]"`
Expected: 0 matches.

Run: `git grep -nE "calculateEVM|generateCashFlowData"`
Expected: 0 matches across `app/`, `components/`, `utils/` (the only definition was inside the file we're about to delete; legacyEvmMetrics + buildCashFlow are the replacements).

If either grep returns a hit, STOP and report to the controller — Task 4 missed a callsite.

- [ ] **Step 5.2: Delete the file**

Run: `git rm utils/earnedValueEngine.ts`
Expected: `rm 'utils/earnedValueEngine.ts'`.

- [ ] **Step 5.3: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5.4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(schedule-ev): delete utils/earnedValueEngine.ts (replaced by adapter)

Final step of the bug #1 fix from the v2.1 audit. earnedValueEngine.ts
had ONE caller (budget-dashboard.tsx) which was ported to the canonical
scheduleEarnedValue.ts pipeline in Task 4. The file is now fully
unreferenced — 0 hits across the repo for either the import path or
the function names.

Removes 112 lines including 2 left-in console.log debug statements
and a heuristic that disagreed with the engine on every project.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Type-shape cleanup — remove `ProjectSchedule.auditLog`

**Files:**
- Modify: `types/index.ts:790-792` (remove `auditLog?: ScheduleAuditEntry[]` field + its JSDoc)
- Modify: `utils/scheduleAudit.ts:8-10` (update stale comment)

- [ ] **Step 6.1: Verify the field has no structured readers**

Run: `git grep -nE "\.auditLog|schedule\.auditLog|schedule\?\.auditLog"`
Expected: only matches are the field declaration in `types/index.ts:791` and the stale comment in `utils/scheduleAudit.ts:8`. No app code reads `project.schedule.auditLog` as a structured value (audit entries persist via AsyncStorage in `scheduleAudit.ts:96` `appendAuditToAsyncStorage`).

If grep returns ANY hit in `app/`, `components/`, or any other `utils/*.ts` file, STOP and report — the field is in fact used and the deletion is unsafe.

- [ ] **Step 6.2: Read the field declaration context**

Run: `sed -n '785,795p' types/index.ts`
Expected: see the JSDoc preamble explaining the field plus the `auditLog?: ScheduleAuditEntry[];` line at 791.

- [ ] **Step 6.3: Delete the field + its JSDoc**

In `types/index.ts`, find and delete the JSDoc block + the field declaration. The block should look something like:

```ts
  /** Append-only audit log of CPM-affecting edits. P6's audit famously
   *  misses dependency / logic changes; we don't. Bounded at 500 entries
   *  on read for performance. */
  auditLog?: ScheduleAuditEntry[];
```

(Exact text per your `:785-795p` read. Delete all 3-4 lines belonging to this JSDoc + field declaration.)

If `ScheduleAuditEntry` is now unused anywhere in `types/index.ts`, leave its export in place — it's still exported as a type and is used by `utils/scheduleAudit.ts`'s function signatures.

- [ ] **Step 6.4: Update the stale comment in `scheduleAudit.ts`**

In `utils/scheduleAudit.ts`, find lines 8-15:

```ts
// Storage: lives on `ProjectSchedule.auditLog` so it persists with the
// rest of the schedule. The Settings → Schedule audit viewer reads from
// here.
//
// Side-channel local backup: also append to AsyncStorage so a user who
// loses connectivity mid-edit can still reconstruct what they did. The
// AsyncStorage cache is opportunistic; ProjectSchedule is the source of
// truth.
```

Replace with:

```ts
// Storage: AsyncStorage (key `tertiary_schedule_audit::<projectId>`).
// The Settings → Schedule audit viewer reads from here.
//
// The field `ProjectSchedule.auditLog` used to exist for "ride-with-
// the-schedule" persistence, but nothing ever populated it and v2.1
// removed it. AsyncStorage is the sole storage path now; cap at 500
// entries via FIFO trim.
```

- [ ] **Step 6.5: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If any callsite read `schedule.auditLog`, tsc would flag it now — the Step 6.1 grep should have caught this already, but tsc is the safety net.)

- [ ] **Step 6.6: Confirm no stale references remain**

Run: `git grep -nE "\.auditLog|ProjectSchedule\.auditLog"`
Expected: 0 matches.

- [ ] **Step 6.7: Commit**

```bash
git add types/index.ts utils/scheduleAudit.ts
git commit -m "$(cat <<'EOF'
chore(schedule): remove unused ProjectSchedule.auditLog field

Per v2.1 audit §4.5. The field was declared on the ProjectSchedule
interface at types/index.ts:791 but never populated — appendAuditToAsyncStorage
writes audit entries into AsyncStorage (tertiary_schedule_audit::<projectId>)
and the only reference to the typed field was a stale comment claiming
storage "lives on ProjectSchedule.auditLog so it persists with the rest of
the schedule." It never lived up to the claim.

Removes the field declaration + JSDoc from types/index.ts. Updates the
stale storage comment at utils/scheduleAudit.ts:8 to reflect the actual
AsyncStorage-only backing.

ScheduleAuditEntry type is preserved (still used by scheduleAudit.ts
function signatures).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Delete orphaned `scheduleFragnets.ts` + `scheduleResourceRates.ts`

**Files:**
- Delete: `utils/scheduleFragnets.ts`
- Delete: `utils/scheduleResourceRates.ts`

- [ ] **Step 7.1: Verify both files have zero callers**

Run: `git grep -nE "from ['\"]@/utils/scheduleFragnets['\"]|from ['\"]\.\./utils/scheduleFragnets['\"]"`
Expected: 0 matches.

Run: `git grep -nE "from ['\"]@/utils/scheduleResourceRates['\"]|from ['\"]\.\./utils/scheduleResourceRates['\"]"`
Expected: 0 matches.

Also verify by symbol name (catches relative imports we might have missed):

Run: `git grep -nE "STARTER_FRAGNETS|applyFragnetToSchedule|addFragnetToLibrary|deleteFragnet"`
Expected: 0 matches outside `utils/scheduleFragnets.ts` itself.

Run: `git grep -nE "getResourceRate"`
Expected: 0 matches outside `utils/scheduleResourceRates.ts` itself.

If any grep returns an external hit, STOP and report — a caller exists and the spec is incorrect.

- [ ] **Step 7.2: Delete both files**

Run: `git rm utils/scheduleFragnets.ts utils/scheduleResourceRates.ts`
Expected:
```
rm 'utils/scheduleFragnets.ts'
rm 'utils/scheduleResourceRates.ts'
```

- [ ] **Step 7.3: tsc gate**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7.4: Confirm clean grep**

Run: `git grep -nE "scheduleFragnets|scheduleResourceRates"`
Expected: 0 matches anywhere in the repo (the files are gone; no comments or other refs survive).

- [ ] **Step 7.5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(schedule): delete orphaned scheduleFragnets + scheduleResourceRates

Per v2.1 audit §4.5. Both utilities were fully built, fully typed, and
fully unreferenced:

  utils/scheduleFragnets.ts — exported STARTER_FRAGNETS,
    applyFragnetToSchedule, addFragnetToLibrary, deleteFragnet.
    No UI route, no callers across app/ or components/.

  utils/scheduleResourceRates.ts — exported getResourceRate
    (multi-rate picker for weekend / weekday / overtime billing).
    No callers.

utils/scheduleResourceCalendars.ts is NOT deleted — it's the calendar-
resolution helper that v2.2 (calendar-aware CPM) will wire into runCpm.

If product surfaces these features later, re-author from the new design;
the old code was speculative work that never matured into a feature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final whole-impl gates (before opus review dispatch)

After Task 7 commits, run these gates from the worktree root:

- [ ] **Gate A: tsc clean repo-wide**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main"
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Gate B: scope ledger matches**

```bash
git diff --stat main..HEAD -- utils/ app/ types/ docs/
```
Expected: shows exactly these files (order may differ; the spec/plan docs from earlier brainstorm sessions are also in scope but committed separately):

```
 app/budget-dashboard.tsx           |  4 ++--
 app/schedule-pro.tsx               | 18 ++++--------------
 types/index.ts                     |  4 ----
 utils/cpm.ts                       | 33 ++++++++++++++++++++++-----------
 utils/earnedValueEngine.ts         | 112 -----------------------
 utils/scheduleAudit.ts             |  8 ++++----
 utils/scheduleEarnedValue.ts       | 140 ++++++++++++++++++++++++++++++
 utils/scheduleEngine.ts            | 15 ++++++++++-----
 utils/scheduleFragnets.ts          | 220 ----------------------
 utils/scheduleResourceRates.ts     |  85 -----------------
```

(Line counts approximate; what matters is the set of files matches the §File-ledger and no other file shows up.)

- [ ] **Gate C: dead-code greps return 0**

```bash
git grep -nE "applyCpmToTasks|loeAdjustedTasks|calculateEVM|generateCashFlowData|earnedValueEngine|scheduleFragnets|scheduleResourceRates|criticalTasks\.reduce|\.auditLog"
```
Expected: 0 matches (or only comment matches that mention "audit log" generically without referring to the deleted field — careful review of any hit).

- [ ] **Gate D: spec coverage walk**

Open `docs/superpowers/specs/2026-05-19-v2-1-schedule-engine-truth-design.md` and verify:
- §4.1 free-float switch — Task 1 implemented it.
- §4.2 criticalPathDays opts + heuristic removal — Task 2 implemented it.
- §4.3 buildCashFlow + legacyEvmMetrics + import swap + delete — Tasks 3, 4, 5 implemented it.
- §4.4 percentComplete semantic shift — documented in Task 3 + Task 4 commit messages.
- §4.5 dead-code deletes — Tasks 1 (applyCpmToTasks), 2 (loeAdjustedTasks), 6 (auditLog), 7 (fragnets, rates).
- §5 error handling — all changes additive or surgical-delete; no throws added; null-tolerance preserved.
- §6 verification — gates A through C above + manual reproducer scenarios documented for QA.

---

## Opus whole-impl review dispatch (after Gate D passes)

Dispatch one opus review with this scope:
1. Confirm the 7 commits + ledger from Gate B match the spec exactly.
2. Confirm the free-float math (Task 1) is correct per the four link-type formulas.
3. Confirm the criticalPathDays thread-through (Task 2) reaches both schedule-pro callsites and the unmount-flush dependency array.
4. Confirm legacyEvmMetrics (Task 3) produces every EarnedValueMetrics field correctly, and that the percentComplete semantic shift is documented in both the function JSDoc and the commit message.
5. Confirm budget-dashboard (Task 4) downstream UI code (charts, tiles, AI forecast prompt) is byte-identical to pre-v2.1.
6. Confirm the file deletes (Tasks 5, 7) have zero residual callers via grep.
7. Confirm `ProjectSchedule.auditLog` removal (Task 6) leaves no stale readers; comment in scheduleAudit.ts now matches reality.
8. Confirm tsc clean, no `any` introduced, no new dep in package.json.
9. Final verdict: APPROVED / NEEDS-CHANGES with file:line evidence per check.

---

## Ship section (controller runs after opus APPROVED)

```bash
# 1. FF-merge claude/p0-launch-on-main → main
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git checkout main
git pull origin main
git merge --ff-only claude/p0-launch-on-main

# 2. Push
git push origin main

# 3. OTA — production channel
eas update --branch production --message "v2.1 schedule engine-truth (EV engines collapsed, criticalPathDays single source, free-float SS/FF/SF, dead-code cleanup)"
```

NO edge fn deploy (none changed). NO migration (none).

After OTA: post a brief ship audit summarizing the 7 commits + the OTA group ID + a heads-up note about the deliberate `percentComplete` semantic shift on Budget Dashboard (cost-weighted instead of avg-of-progress — expect lower numbers on projects with uneven task budgets; this is correct).
