# v2.1 — Schedule Engine Truth — Design

Follow-up sub-project from the 2026-05-19 CPM end-to-end audit. The shipped CPM is mature on core math but inconsistent at the edges: two earned-value engines produce different SPI/CPI on side-by-side screens, `criticalPathDays` is overwritten by a heuristic on every save, and `computeFreeFloat` only handles FS links. v2.1 makes `project.schedule` tell one true story across every reader.

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` (== `main` @ `f0de54f`). **App + util-only, OTA-able. No migration, no edge fn, no portal, no new dependency** → Netlify-independent.

## 1. Reality check (vs the audit findings used as input)

The audit (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, run @ `f0de54f`) surfaced 9 bugs and 5 integration gaps. v2.1 takes:
- **3 engine-truth bugs** that affect what every reader of `project.schedule` sees — audit #1 (two EV engines), #4 (two critical-path sources), #5 (FS-only free float).
- **3 whole-file dead-code deletes** — `earnedValueEngine.ts` (replaced by adapter), `scheduleFragnets.ts`, `scheduleResourceRates.ts`.
- **2 within-file dead-code deletes** — `applyCpmToTasks` in `cpm.ts`, `loeAdjustedTasks` void'd computation in `schedule-pro`.
- **1 type-shape cleanup** — remove unused `auditLog` field from `ProjectSchedule`.

The remaining audit items are queued as v2.2 (calendar-aware CPM + anchor honoring), v2.3 (cross-domain wedges: schedule→invoice/AIA prefill + sub-update rollup + estimate→schedule re-sync), or polish (URL guard, debounce race, dep-vs-depLinks UI filter, legacy resolver elimination, tier-gate granularity, levelResources surfacing). Bug #9 (duration-0 milestone) and gap D (two health systems) were investigated and dismissed as non-issues — see §7.

Verified callsites:
- `utils/earnedValueEngine.ts` (112 lines) — ONE callsite: `app/budget-dashboard.tsx:21` imports `calculateEVM` + `generateCashFlowData`.
- `utils/scheduleEarnedValue.ts` (177 lines) — TWO callsites: `app/schedule-pro.tsx:60` + `components/schedule/EarnedValuePanel.tsx:21`. Exports `buildEarnedValueSnapshot`, `computeActualCostFromInvoices`, `formatMoneyCompact`, `performanceTone`, type `ScheduleEvSnapshot`.
- `criticalPathDays` — 4 writers, 7 readers. Writers split across `runCpm`-derived (`schedule-pro:222`) and heuristic (`scheduleEngine.ts:287` via `buildScheduleFromTasks:350`) — the heuristic wins on every persist.
- `utils/scheduleFragnets.ts`, `utils/scheduleResourceRates.ts` — confirmed zero `from '@/utils/<name>'` import lines anywhere.
- `utils/scheduleResourceCalendars.ts` — also orphaned today, but slated for v2.2 calendar-aware CPM. Keep.

## 2. Problem

Three distinct integrity problems that all surface as "the dashboards lie":

1. **The two earned-value engines produce different numbers for the same project.** `earnedValueEngine.calculateEVM` defines `EV = BAC × (avg(task.progress)/100)` and `PV = BAC × elapsedRatio` — a 60-second heuristic that treats every task as equally weighted regardless of dollar value. `scheduleEarnedValue.buildEarnedValueSnapshot` defines `EV` and `PV` per-task via `linkedEstimateItems × (lineTotal × (1+markup))` — the right math. A GC sees SPI 0.94 on Schedule Pro, navigates to Budget Dashboard, sees SPI 0.81. Loss of trust.

2. **`criticalPathDays` is overwritten by a heuristic on every save.** `utils/scheduleEngine.ts:287` computes `criticalPathDays = sum(critical.durationDays)` where `critical = isCriticalPath || hasDeps || dur >= 4`. This runs inside `buildScheduleFromTasks:350`, which is called on every persist from `schedule-pro`. So `runCpm` produces the correct `projectFinish` (e.g. day 87), the SchedulerContext UI shows 87, persist fires, `buildScheduleFromTasks` overwrites with `sum(critical.durationDays)` (e.g. 64), and the project-detail tile, AI service, PDF exports, scheduler header, and dashboard tab all now read 64. The user just saw 87 in the Gantt and the project tile says 64.

3. **`computeFreeFloat` short-circuits on non-FS links.** `utils/cpm.ts:487` has `if ((link.type ?? 'FS') !== 'FS') continue;`. Any schedule using SS/FF/SF links gets wrong free-float numbers on the predecessor side, which then mislabels tasks as "Critical" in the Grid float column.

## 3. Goal / Non-goals

**Goal:** Make `project.schedule` produce **one true SPI/CPI**, **one true critical-path-days**, and **one true free-float** that every reader sees consistently. Pure engine-truth — no UI redesign, no new product surface.

**Non-goals (YAGNI / scope / honesty):**
- NOT calendar-aware CPM (audit bug #2). The engine staying calendar-blind in v2.1 is a known issue; the fix needs `runCpm` to consume `workingDaysPerWeek` + `nonWorkingDates` + per-resource calendars and is invasive enough to deserve its own design. Queued as v2.2.
- NOT backward-pass anchor honoring (audit bug #3). Sister fix to calendar-aware. v2.2.
- NOT the AIA G702 wedge (schedule→invoice progress prefill) — gap A. The data path is ready (`scheduleEarnedValue` already computes per-task EV); wiring it into `app/invoice.tsx` and `app/aia-pay-app.tsx` is its own sub-project. v2.3.
- NOT sub-update → master-task progress rollup — gap B. v2.3.
- NOT estimate-change → tasks-with-stale-`linkedEstimateItems` re-sync — gap C. Same cross-domain re-sync shape as A/B. v2.3.
- NOT `dependencies` vs `dependencyLinks` callsite normalization (audit bug #8). UI bug, not engine-truth.
- NOT `shared-schedule` URL size guard (bug #6). Queueable any time.
- NOT `schedulePersist` debounce race (bug #7). Polish.
- NOT `recalculateStartDays` + `runCpm` double-execution elimination (gap E). Interconnected with the persist flow's contract about whether `task.startDay` already reflects engine ES; deserves own design. Polish queue.
- NOT health-system unification (gap D). On re-read, `scheduleHealth.computePillStatus` and `scheduleHealthScore.computeScheduleHealthScore` are complementary, not duplicative — the pill consumes the score as input and adds two extra signals (`overdueCount`, `cpmSlipDays`). The audit's "can disagree" framing is true but by design.
- NOT duration-0 milestone off-by-one verification (audit bug #9 — "worth a unit test"). On re-read of `cpm.ts:355-372`, both `efMin` and `efExact` branches handle `dur === 0` symmetrically (`req = efMin` and `es = efExact` respectively) and `ef = dur === 0 ? es : es + dur - 1` resolves milestones correctly. Audit was over-cautious.
- NOT classic-mobile-schedule tier-gate decision. Policy question.
- NOT `runCpm({ levelResources: true })` deletion. The code is wired (forward + backward passes call into it conditionally); deleting requires removing the optional parameter from `RunCpmOptions` and the conditional branches inside the engine. Surfacing the toggle in UI is the right move — but it's its own sub-project, not v2.1 cleanup.
- NO change to RevenueCat / tiers. No new entitlement keys.
- NO migration. NO edge fn. NO portal HTML change. NO new dep.

## 4. Architecture

### 4.1 Free-float math for SS / FF / SF (`utils/cpm.ts:455-496`)

**Definition.** Free float for task T = the largest Δ such that pushing T's ES by Δ doesn't push any successor's ES. Pushing T's ES by Δ also pushes T's EF by Δ.

**Per-link bound** for T → S with lag L:
- **FS**: `S.ES − T.EF − L − 1`
- **SS**: `S.ES − T.ES − L`
- **FF**: `S.EF − T.EF − L`
- **SF**: `S.EF − T.ES − L`

Free float for T = MIN of these across all outgoing links, clamped at 0.

**Code change.** Replace the FS-only filter at `cpm.ts:487` with a switch on `link.type` that computes the four bounds. Default link type stays `FS` (existing convention). Math preserves engine semantics: tasks with no successors return `totalFloat` (correct — only the project's late finish constrains them).

**Edge cases handled by the patch:**
- Task with no successors → returns `totalFloat`.
- Successor referenced but missing from `resultMap` → skipped silently (resilient to in-flight edits or partial schedules).
- Negative lag → math is symmetric; works for lead times.
- Floating-point or weird input → clamps to 0 via `Math.max(0, ...)`.

### 4.2 `criticalPathDays` single source of truth (`utils/scheduleEngine.ts`, `app/schedule-pro.tsx`)

**Signature change to `buildScheduleFromTasks`** (additive, no type-shape break elsewhere):

```ts
// utils/scheduleEngine.ts
export function buildScheduleFromTasks(
  tasks: ScheduleTask[],
  opts?: {
    /** Engine-derived project-finish day. When omitted, falls back to
     *  max(t.startDay + t.durationDays - 1) — correct for a single-pass
     *  forward-only resolver. Pass `cpm.projectFinish` to use the full
     *  CPM result. */
    criticalPathDays?: number;
    // … other existing buildScheduleFromTasks opts unchanged
  },
): ProjectSchedule { /* … */ }
```

Inside the function: delete the `:287` `criticalPathDays = critical.reduce(...)` block. Replace with:

```ts
const criticalPathDays =
  opts?.criticalPathDays
  ?? tasks.reduce((max, t) => Math.max(max, t.startDay + t.durationDays - 1), 0);
```

The fallback (when caller omits the arg) now matches the engine's `projectFinish` definition (latest task end-day), not the bogus sum-of-critical-durations heuristic.

**Callsite update.** `app/schedule-pro.tsx`'s persist path threads `criticalPathDays: cpm.projectFinish` into the `buildScheduleFromTasks(...)` call. The value is already computed at `schedule-pro:222` — just pass it through. No other callsite changes:

- `app/schedule-wizard.tsx:194` — wizard doesn't call `buildScheduleFromTasks`; it constructs a `ProjectSchedule` literal. The `totalDays` approximation stays as the one-time-at-creation initial value (gets overwritten on first edit in schedule-pro).
- `contexts/ProjectContext.tsx:1397` — delay bump (`+ bumpDays`) remains correct once the base value is correct.
- All 7 readers (`project-detail:1909`, `aiService:132`, `pdfGenerator:596+1546`, `SchedulerHeader:102`, `DashboardTab:63+132`) — no change. They continue reading `project.schedule.criticalPathDays`, now consistent.

### 4.3 EV engine collapse (`utils/scheduleEarnedValue.ts`, `app/budget-dashboard.tsx`, delete `utils/earnedValueEngine.ts`)

**Step 1: Move `generateCashFlowData` into `scheduleEarnedValue.ts`** as a sibling export of `buildEarnedValueSnapshot`, renamed `buildCashFlow`. Same return shape. Internally swaps its `calculateEVM(...)` CPI source for a single `buildEarnedValueSnapshot(...)` call at `dayCursor = totalDurationDays`. Keeps the simple period-bucket loop for `plannedCumulative` / `actualCumulative` (preserves shipped UI behavior; per-task PV-per-period accuracy is a separate product question, queueable later).

```ts
// utils/scheduleEarnedValue.ts (new export)
export interface CashFlowPoint {
  period: string;
  plannedCumulative: number;
  actualCumulative: number;
  forecastCumulative: number;
}

export function buildCashFlow(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
  periods: number = 12,
): CashFlowPoint[] {
  // … period-bucket loop preserved from the dead engine …
  // CPI source: buildEarnedValueSnapshot at end-of-project cursor
  const snap = buildEarnedValueSnapshot(
    schedule?.tasks ?? [],
    project.linkedEstimate,
    { dayCursor: schedule?.totalDurationDays ?? 0, invoices },
  );
  const cpi = snap.cpi ?? 1;
  // … rest unchanged …
}
```

**Step 2: Add `legacyEvmMetrics` adapter** producing the legacy `EarnedValueMetrics` shape from the canonical snapshot. This means `budget-dashboard.tsx`'s downstream UI code does not change — only its imports + 2 function calls do.

```ts
// utils/scheduleEarnedValue.ts (new export)
export function legacyEvmMetrics(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
): EarnedValueMetrics {
  const tasks = schedule?.tasks ?? [];
  const dayCursor = elapsedDaysForCursor(project, schedule); // private helper
  const snap = buildEarnedValueSnapshot(
    tasks,
    project.linkedEstimate,
    { dayCursor, invoices },
  );
  const bac = snap.totalBudget;
  const pv = snap.totalPlannedValue;
  const ev = snap.totalEarnedValue;
  const ac = computeActualCostFromInvoices(invoices);
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
```

The `elapsedDaysForCursor` private helper derives `dayCursor` from `project.createdAt + days-since-creation`. For v2.1 it uses calendar-days (same approximation the dead engine used). Calendar-aware (working days + holidays) lands in v2.2. The local `round1` / `round2` helpers preserve the legacy display rounding.

**Step 3: Port `budget-dashboard.tsx:21`.**

```ts
// BEFORE
import { calculateEVM, generateCashFlowData } from '@/utils/earnedValueEngine';

// AFTER
import { legacyEvmMetrics, buildCashFlow } from '@/utils/scheduleEarnedValue';
```

Body changes: `calculateEVM(project, invoices, schedule)` → `legacyEvmMetrics(project, invoices, schedule)`; `generateCashFlowData(project, invoices, schedule)` → `buildCashFlow(project, invoices, schedule)`. Output shape identical, all downstream chart / tile / sparkline code unchanged.

**Step 4: Delete `utils/earnedValueEngine.ts`.** After Step 3, `git grep "earnedValueEngine"` returns 0 hits — safe delete. Removes 112 lines and 2 left-in `console.log` debug statements.

### 4.4 Deliberate semantic shift on `percentComplete`

`calculateEVM` defined `percentComplete = avg(task.progress)` — equally weighted, regardless of dollar value. A finished $100 task and a 0% $100K task averaged to 50%. The new `legacyEvmMetrics` defines `percentComplete = EV / BAC × 100` — cost-weighted. The same scenario now reports 0.1%, which is correct.

This is a deliberate math change. The `Percent Complete` tile on Budget Dashboard will read **lower** numbers on projects with uneven task budgets. Note in the commit message + ship report so it's not flagged as a regression.

### 4.5 Dead-code deletions

Verified zero external callers via `git grep` against `--include='*.ts' --include='*.tsx'` across `app/` and `components/`:

**Whole-file deletes:**
- **Delete `utils/scheduleFragnets.ts`** — fragnet library (`STARTER_FRAGNETS`, `applyFragnetToSchedule`, etc.), no callers, no UI route.
- **Delete `utils/scheduleResourceRates.ts`** — multi-rate picker (`getResourceRate`), no callers.

**Within-file deletes:**
- **Delete `applyCpmToTasks` from `utils/cpm.ts:730-742`** — function annotates tasks with `isCriticalPath` derived from `CpmResult`. Confirmed zero callers across the codebase (only its own export line matches in grep). The `schedule-pro` render path consumes `cpm.perTask` directly instead of via this annotation. Tighter API; one less export to maintain.
- **Delete `loeAdjustedTasks` useMemo + `void` statement at `app/schedule-pro.tsx:228-238`** — computed result is explicitly `void`'d on the next line, comment admits "exposed for future view wiring; rolledTasks is still the authoritative source." Render path uses `rolledTasks`, not this. ~10 lines including the useMemo, the void, and the comment block. Cheap cleanup.

**Type-shape clean-up:**
- **Remove `auditLog?: ScheduleAuditEntry[]` from `ProjectSchedule` at `types/index.ts:791`** — field is reserved but never populated. `utils/scheduleAudit.ts:96` `appendAuditToAsyncStorage` writes audit entries into AsyncStorage (key `tertiary_schedule_audit_*`), not into the typed field. Only reference to `.auditLog` anywhere in the codebase is a stale comment at `scheduleAudit.ts:8` (claims "Storage: lives on `ProjectSchedule.auditLog`" — the code never lived up to the claim). Spec also updates that comment to reflect the actual AsyncStorage backing.

**Keep `utils/scheduleResourceCalendars.ts`** — orphaned today but slated for v2.2 calendar-aware CPM wiring. Re-authoring after delete would be wasteful.

## 5. Error handling / correctness

- All four engine changes are pure / side-effect-free transformations on existing inputs. No throws added; existing cycle-guard + null-tolerance preserved.
- `buildScheduleFromTasks(opts.criticalPathDays)` is opt-in. Existing callers that omit it get the new sensible fallback (max-task-end-day) — never the bogus heuristic. Zero-task schedules return 0 (the `tasks.reduce(...)` initializer).
- `buildCashFlow` and `legacyEvmMetrics` accept `schedule: ProjectSchedule | null | undefined` and return safe defaults when schedule is absent (same null-tolerance the dead engine had).
- `legacyEvmMetrics`'s percent-complete shift is deliberately documented in §4.4 — surfaced in the commit message and ship report so the lower numbers don't read as a bug.
- Strict TS, no `any`. `npx tsc --noEmit` clean.

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean + spot-checks against the audit's reproducer scenarios:

1. **Free-float** — 3-task schedule, A→B/SS lag 2 + A→C/FS. Pre-fix: B's free float = 0 (FS-only filter dropped the link). Post-fix: B's free float = `B.es − A.es − 2`.
2. **`criticalPathDays`** — 10-task FS chain in Schedule Pro. Header shows `cpm.projectFinish` (e.g. 87). Save. Project-detail "X days" tile shows 87. Today shows 64.
3. **EV consistency** — Schedule Pro `EarnedValuePanel` SPI/CPI. Budget Dashboard SPI/CPI. They agree. Today they differ.
4. **`percentComplete` semantic shift** — Budget Dashboard `Percent Complete` tile reads lower on uneven-budget projects (correct cost-weighted math).
5. **Dead-code deletes** — `git grep -nE "from '@/utils/(earnedValueEngine|scheduleFragnets|scheduleResourceRates)'"` returns 0 hits after the EV-collapse commit and the dead-code-delete commit. `git grep -nE "applyCpmToTasks|loeAdjustedTasks"` returns only the deletion-site lines (now gone). `git grep -nE "\\.auditLog"` returns 0 hits in `app/` and `components/` (only the type definition was the unread surface; it's now gone too).
6. Final opus whole-impl review.

## 7. Out of scope / future

- **v2.2 — Calendar-aware CPM** — `runCpm` consumes `workingDaysPerWeek` + `nonWorkingDates` + per-resource calendars (via `resolveCalendarForTask`). Sister fix: backward-pass honors anchors (SNLT/FNLT/MFO clamps into LF/LS). Together these are the engine's biggest remaining accuracy gap.
- **v2.3 — Wedge integrations** — Schedule progress → invoice / AIA G702 progress-billing prefill (highest product leverage; data path ready). Sub schedule-update → master task progress rollup (closes the sub-portal hole). Estimate-change → tasks-with-stale-`linkedEstimateItems` re-sync (gap C — same cross-domain re-sync shape).
- **Polish queue** — `dependencies` vs `dependencyLinks` callsite normalization (audit bug #8), `shared-schedule` URL size guard (bug #6), `schedulePersist` debounce race (bug #7), `recalculateStartDays` + `runCpm` double-execution elimination (gap E — needs a contract decision about whether `task.startDay` reflects engine ES post-edit), classic-mobile-schedule tier-gate policy decision, `runCpm({ levelResources: true })` UI surfacing or removal.
- **Investigated and dismissed** — Bug #9 duration-0 milestone off-by-one (math verified correct on re-read of `cpm.ts:355-372`). Gap D two health systems (re-read shows complementary, not duplicative — pill consumes score as input).
