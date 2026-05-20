# v2.2b — Calendar-Aware CPM (Layer A — Project Calendar) — Design

Follow-up sub-project closing audit bug #2. v2.1 made the engine internally consistent on EV + criticalPathDays + free-float; v2.2a closed audit bug #3 (backward-pass anchor honoring); v2.3 wired cross-domain integrations + polish. v2.2b is the engine refactor that teaches forward + backward passes to skip weekends and closures, so the engine and the renderer agree on dates.

**Scope locked to Layer A (project calendar).** Layer B (per-resource calendars via `resolveCalendarForTask`) is deferred to v2.2c. Per-resource calendars layer on top of project calendars; getting Layer A clean is the prerequisite.

Build target: p0-on-main worktree (`/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`), branch `claude/p0-launch-on-main` @ `f6a1cc8` (== `main` after the v2.3 + polish + v2.2a OTA ship). **Engine + 1 caller. No migration, no edge fn, no portal, no new dependency.**

## 1. Reality check (vs the audit)

Audit bug #2 verbatim:
> "addWorkingDays skips weekends but CPM forward/backward passes don't. utils/cpm.ts:316-375 treats startDay as raw integer days; nonWorkingDates and workingDaysPerWeek are read **only** by addWorkingDays (utils/scheduleEngine.ts:175) when the UI maps day-number→Date for display. So runCpm says 'EF=10,' the Gantt renders day 10 as a date that's skipped if it falls on a holiday/weekend, and successors' computed ES will be wrong on screen. resolveCalendarForTask (utils/scheduleResourceCalendars.ts:25) is never called by runCpm; CPM is calendar-blind."

Verified surfaces:

- **`addWorkingDays` at `scheduleEngine.ts:175-200`** — the renderer's existing weekend + closure skip algorithm. v2.2b's `walkWorkingDays` re-implements the same algorithm on day-number indices instead of Date objects so engine and renderer share the mental model.
- **`isoToDay` at `cpm.ts:136-143`** — the existing day-number convention (day 1 = scheduleStartDate, UTC). `isWorkingDay` and `walkWorkingDays` use the same convention.
- **`RunCpmOptions.scheduleStartDate?: string` at `cpm.ts:117`** — already exists. v2.2b adds two siblings: `workingDaysPerWeek?: number` and `nonWorkingDates?: string[]`.
- **Forward pass EF derivation** — currently `const ef = dur === 0 ? es : es + dur - 1;` (raw integer math, no calendar awareness).
- **Backward pass LS derivation** — `cpm.ts:460` `const ls = dur === 0 ? lf : lf - dur + 1;` (same raw pattern).
- **Forward-pass anchor block at `cpm.ts:355-368`** — `efExact` and `efMin` branches do raw `efExact - dur + 1` arithmetic.
- **Backward-pass anchor block from v2.2a (`f6a1cc8`)** — `esExact` and `esMax` branches do raw `esExact + dur - 1` arithmetic.
- **`runCpm` caller in `schedule-pro.tsx`** — passes `scheduleStartIso` + `criticalFloatThresholdDays` today; v2.2b adds the two calendar fields from `project.schedule`.

## 2. Problem

Today, a 5-day task starting Thursday produces engine EF = Monday (raw `4 + 5 − 1 = 8`). The renderer (via `addWorkingDays`) shows the bar spanning Thu, Fri, then skipping weekend, then Mon, Tue, Wed = Wednesday. Engine says Monday, renderer shows Wednesday. Downstream consumers (criticalPathDays on the project tile, AI prompts, PDF exports, dashboard date math) all read the engine's wrong date.

Same disagreement on tasks crossing closures (holidays). Same on anchor math: a "must finish Friday" + 5-day task should set ES = Monday, but raw arithmetic produces ES = Monday only when the 5 days happen to fit cleanly without a weekend in the middle.

## 3. Goal / Non-goals

**Goal:** Forward and backward passes compute EF and LS by counting working days (skipping weekends + closures), so the engine and the renderer agree on dates. Anchor math gets the same treatment. Lag stays in calendar days (MS Project default). Behavior preserved for callers that don't pass the new calendar fields.

**Non-goals (YAGNI / scope / honesty):**

- NOT Layer B per-resource calendars (`resolveCalendarForTask` integration). Deferred to v2.2c. Layer B layers on top of project calendars and shouldn't ship until Layer A is verified clean.
- NOT changing `task.startDay`'s storage semantic. It stays as a calendar-day index from project start — no data migration.
- NOT changing the renderer. `addWorkingDays` already does the right thing; the engine just stops disagreeing with it.
- NOT changing lag semantics. Stays in calendar days. Switching to working-day lag is its own product decision.
- NOT changing the FS/SS/FF/SF dependency-link arithmetic. Calendar awareness comes purely from EF/LS computation; link math is unchanged.
- NOT updating `shared-schedule.tsx` or other secondary `runCpm` callers. They fall back to default raw behavior (= today's behavior). v2.2c can revisit if the share payload format gets bumped.
- NOT touching `utils/scheduleEngine.ts:addWorkingDays`. The new engine helper re-implements its algorithm on day-number indices but doesn't share code (the two functions have different signatures — one takes Date, one takes day-number).
- NO migration. NO edge fn. NO portal change. NO new dep. NO new entitlement keys.

## 4. Architecture

### 4.1 New helpers in `utils/cpm.ts`

Two pure helpers, placed near `isoToDay` (`cpm.ts:136-143`):

**`isWorkingDay`** — given a day-number and project calendar, returns whether that day counts as a working day:

```ts
function isWorkingDay(
  dayIndex: number,
  workingDaysPerWeek: number,
  scheduleStartDate: string,
  closures: Set<string>,
): boolean {
  const startMs = Date.parse(scheduleStartDate + 'T00:00:00Z');
  if (!Number.isFinite(startMs)) return true; // unparseable → permissive
  const dayMs = startMs + (dayIndex - 1) * 86400000;
  const d = new Date(dayMs);
  const dow = d.getUTCDay();
  const weekendSkip = workingDaysPerWeek < 7 && (dow === 0 || dow === 6);
  if (weekendSkip) return false;
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return !closures.has(iso);
}
```

**`walkWorkingDays`** — given a start index + a count + a direction, walks `count` working days and returns the resulting calendar-day index:

```ts
function walkWorkingDays(
  startIndex: number,
  count: number,
  direction: 1 | -1,
  workingDaysPerWeek: number,
  scheduleStartDate: string | undefined,
  closures: Set<string>,
): number {
  if (count <= 0 || !scheduleStartDate) return startIndex;
  let day = startIndex;
  let counted = 0;
  while (counted < count) {
    day += direction;
    if (isWorkingDay(day, workingDaysPerWeek, scheduleStartDate, closures)) {
      counted++;
    }
  }
  return day;
}
```

Both are file-local (not exported). Reused at 6 sites (forward EF, backward LS, forward `efExact`, forward `efMin`, backward `esExact`, backward `esMax`).

### 4.2 `RunCpmOptions` calendar fields

Append two optional fields to the existing interface at `cpm.ts:91-118`:

```ts
export interface RunCpmOptions {
  // ... existing fields ...
  /**
   * v2.2b — Working days per week (1-7). Default 7 (no weekend
   * skipping — preserves pre-v2.2b raw-day behavior for callers that
   * don't opt in). Typical construction values: 5 (Mon-Fri) or 6
   * (Mon-Sat).
   */
  workingDaysPerWeek?: number;
  /**
   * v2.2b — ISO date strings (YYYY-MM-DD) for closures / holidays that
   * block work even when the weekday would otherwise be working.
   * Union with the workingDaysPerWeek weekend mask.
   */
  nonWorkingDates?: string[];
}
```

### 4.3 Forward + backward pass internal signatures

`forwardPass` (currently takes `scheduleStartDate?`) gains two more optional params:

```ts
function forwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  scheduleStartDate?: string,
  workingDaysPerWeek?: number,
  nonWorkingDates?: string[],
): Map<string, { es: number; ef: number }>
```

`backwardPass` (took `scheduleStartDate?` since v2.2a) gains the same:

```ts
function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
  scheduleStartDate?: string,
  workingDaysPerWeek?: number,
  nonWorkingDates?: string[],
): Map<string, { ls: number; lf: number }>
```

Both derive working values at the top:

```ts
const wdPerWeek = workingDaysPerWeek ?? 7;
const closuresSet = new Set(nonWorkingDates ?? []);
```

### 4.4 Default-behavior fallback (CRITICAL — caught during Section 4 self-review)

When `scheduleStartDate` is undefined OR both `workingDaysPerWeek` and `nonWorkingDates` are absent, the engine must fall back to today's raw arithmetic. The naive expression `dur === 0 ? es : isWorkingDay(es, ...) ? walkWorkingDays(es, dur - 1, ...) : walkWorkingDays(es, dur, ...)` does NOT fall back correctly: when `scheduleStartDate` is undefined, `walkWorkingDays` short-circuits to `startIndex`, producing `ef = es` (losing `dur - 1` days).

**Fix:** branch on `scheduleStartDate` presence FIRST. Missing → raw math. Present → calendar-aware:

```ts
const ef = dur === 0 ? es
  : !scheduleStartDate ? es + dur - 1
  : isWorkingDay(es, wdPerWeek, scheduleStartDate, closuresSet)
    ? walkWorkingDays(es, dur - 1, 1, wdPerWeek, scheduleStartDate, closuresSet)
    : walkWorkingDays(es, dur, 1, wdPerWeek, scheduleStartDate, closuresSet);
```

Same pattern (`!scheduleStartDate ? rawMath : calendarAware`) applies to:
- Backward pass LS
- Forward pass `efExact` derivation
- Forward pass `efMin` derivation
- Backward pass `esExact` derivation (v2.2a addition)
- Backward pass `esMax` derivation (v2.2a addition)

6 sites total. Each follows the same shape.

### 4.5 Site-by-site math

**Forward EF** (was `es + dur - 1`):

```ts
const ef = dur === 0 ? es
  : !scheduleStartDate ? es + dur - 1
  : isWorkingDay(es, wdPerWeek, scheduleStartDate, closuresSet)
    ? walkWorkingDays(es, dur - 1, 1, wdPerWeek, scheduleStartDate, closuresSet)
    : walkWorkingDays(es, dur, 1, wdPerWeek, scheduleStartDate, closuresSet);
```

**Backward LS** (was `lf - dur + 1`):

```ts
const ls = dur === 0 ? lf
  : !scheduleStartDate ? lf - dur + 1
  : isWorkingDay(lf, wdPerWeek, scheduleStartDate, closuresSet)
    ? walkWorkingDays(lf, dur - 1, -1, wdPerWeek, scheduleStartDate, closuresSet)
    : walkWorkingDays(lf, dur, -1, wdPerWeek, scheduleStartDate, closuresSet);
```

**Forward `efExact`** (was `es = efExact - dur + 1`):

```ts
if (anchor.efExact !== undefined) {
  es = dur === 0 ? anchor.efExact
    : !scheduleStartDate ? anchor.efExact - dur + 1
    : isWorkingDay(anchor.efExact, wdPerWeek, scheduleStartDate, closuresSet)
      ? walkWorkingDays(anchor.efExact, dur - 1, -1, wdPerWeek, scheduleStartDate, closuresSet)
      : walkWorkingDays(anchor.efExact, dur, -1, wdPerWeek, scheduleStartDate, closuresSet);
}
```

**Forward `efMin`** (was `req = efMin - dur + 1; if (req > es) es = req`):

```ts
if (anchor.efMin !== undefined) {
  const req = dur === 0 ? anchor.efMin
    : !scheduleStartDate ? anchor.efMin - dur + 1
    : isWorkingDay(anchor.efMin, wdPerWeek, scheduleStartDate, closuresSet)
      ? walkWorkingDays(anchor.efMin, dur - 1, -1, wdPerWeek, scheduleStartDate, closuresSet)
      : walkWorkingDays(anchor.efMin, dur, -1, wdPerWeek, scheduleStartDate, closuresSet);
  if (req > es) es = req;
}
```

**Backward `esExact`** (v2.2a addition; was `lf = esExact + dur - 1`):

```ts
if (anchor.esExact !== undefined) {
  lf = dur === 0 ? anchor.esExact
    : !scheduleStartDate ? anchor.esExact + dur - 1
    : isWorkingDay(anchor.esExact, wdPerWeek, scheduleStartDate, closuresSet)
      ? walkWorkingDays(anchor.esExact, dur - 1, 1, wdPerWeek, scheduleStartDate, closuresSet)
      : walkWorkingDays(anchor.esExact, dur, 1, wdPerWeek, scheduleStartDate, closuresSet);
}
```

**Backward `esMax`** (v2.2a addition; was `req = esMax + dur - 1; if (req < lf) lf = req`):

```ts
} else if (anchor.esMax !== undefined) {
  const req = dur === 0 ? anchor.esMax
    : !scheduleStartDate ? anchor.esMax + dur - 1
    : isWorkingDay(anchor.esMax, wdPerWeek, scheduleStartDate, closuresSet)
      ? walkWorkingDays(anchor.esMax, dur - 1, 1, wdPerWeek, scheduleStartDate, closuresSet)
      : walkWorkingDays(anchor.esMax, dur, 1, wdPerWeek, scheduleStartDate, closuresSet);
  if (req < lf) lf = req;
}
```

### 4.6 `runCpm` callsite threading (inside `cpm.ts`)

`runCpm` at `:625+` already destructures `options`. Pass the new fields to both internal calls:

```ts
const forward = forwardPass(
  ordered, tasks,
  options.scheduleStartDate, options.workingDaysPerWeek, options.nonWorkingDates,
);
// ... projectFinish derivation unchanged ...
const backward = backwardPass(
  ordered, tasks, forward, projectFinish,
  options.scheduleStartDate, options.workingDaysPerWeek, options.nonWorkingDates,
);
```

### 4.7 `app/schedule-pro.tsx` external caller

The single `runCpm` callsite at `schedule-pro.tsx:209-215` gains two fields:

```ts
const cpm = useMemo(
  () => runCpm(rolledTasks, {
    scheduleStartDate: scheduleStartIso,
    criticalFloatThresholdDays,
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  }),
  [
    rolledTasks, scheduleStartIso, criticalFloatThresholdDays,
    project?.schedule?.workingDaysPerWeek,
    project?.schedule?.nonWorkingDates,
  ],
);
```

The deps array gets two new entries. `project.schedule.workingDaysPerWeek` is already a number on `ProjectSchedule` (`types/index.ts:729`); `nonWorkingDates?: string[]` is already optional on the same interface (`types/index.ts:777`). Both fields already exist in the data model — v2.2b just plumbs them into the engine.

## 5. Error handling / correctness

- All changes are additive within existing function bodies + one new helper file-block in cpm.ts. No throws added; existing dependency-driven ES/LF computations unchanged; FS/SS/FF/SF link math unchanged.
- **Default-behavior preservation** (`scheduleStartDate` missing): every calendar-aware site falls through to `!scheduleStartDate ? rawMath` BEFORE invoking `walkWorkingDays`. Callers that don't pass `scheduleStartDate` get byte-identical output pre-vs-post-v2.2b. Critical regression-prevention property.
- **Default-behavior preservation** (`scheduleStartDate` present but no calendar fields): `wdPerWeek ?? 7` → 7-day week → `isWorkingDay` returns true unconditionally → `walkWorkingDays(start, N, ±1, ...)` advances exactly N steps → output identical to `start ± N`. Same raw math result via a slightly more expensive code path. Acceptable.
- **`isWorkingDay` unparseable-date fallback**: returns `true` (permissive) when `Date.parse(scheduleStartDate + 'T00:00:00Z')` is `NaN`. Engine degrades to raw math gracefully instead of crashing.
- **Negative-float interaction with v2.2a**: an anchor whose calendar-aware derivation produces a value less than the dependency-derived ES still triggers v2.2a's negative-float surfacing via `isCritical = totalFloat <= 0`. The two changes compose cleanly.
- **Lag invariance**: dependency-link math (`thisLf = succLate.ls - lag - 1` etc.) unchanged. Lag stays in calendar days, period.
- **Performance**: `walkWorkingDays` loop bound is O(dur + skipped-days). For typical tasks (dur ≤ 20, ≤ 10 weekend days in range), ≤ 30 iterations per site. 6 sites per task per CPM run. Cost is negligible relative to the topo sort + dependency walks.
- Strict TS, no `any`. `npx tsc --noEmit` clean.

## 6. Verification (no unit runner)

`npx tsc --noEmit` clean is the per-task gate. Manual reasoning checks (the math walks from Section 4 of the brainstorm transcript):

1. **5-day task, Mon-Fri schedule, ES=Mon day 1:** walk dur-1=4 working days forward → Tue, Wed, Thu, Fri = day 5. EF = Fri. Old raw: `1 + 5 − 1 = 5`. Same number — coincidence on a clean week. ✓
2. **5-day task, Mon-Fri schedule, ES=Thu day 4:** walk 4 working days forward → Fri (1), skip Sat/Sun, Mon (2), Tue (3), Wed (4) = day 10. EF = Wed. Old raw: `4 + 5 − 1 = 8` = Sat. **Engine now agrees with renderer.** ✓
3. **3-day task, Mon-Fri schedule, ES=Sat day 6 (non-working):** `isWorkingDay(6) = false`, so use the `else` branch: walk dur=3 working days forward → skip Sun, Mon (1), Tue (2), Wed (3) = day 10. EF = Wed. ✓
4. **Milestone (dur=0):** EF = ES regardless. ✓
5. **MFO anchor `efExact=20` (Fri) + dur=5, Mon-Fri:** forward `efExact` derives `es = walkWorkingDays(20, 4, -1, ...)` = Thu (1), Wed (2), Tue (3), Mon (4) = day 16. ES = Mon, task spans Mon-Fri = 5 working days. ✓
6. **Project with Dec 25 closure, dur=5, ES=Mon Dec 22:** walk 4 forward → Tue 23 (1), Wed 24 (2), skip Thu 25 (closure), Fri 26 (3), skip Sat/Sun, Mon 29 (4) = Dec 29. EF = Dec 29. **Engine agrees with renderer.** ✓
7. **Default-behavior regression — dur=5, no calendar opts:** all calendar sites take the `!scheduleStartDate ? rawMath` branch → identical to pre-v2.2b. ✓
8. **`scheduleStartDate` present, `workingDaysPerWeek` and `nonWorkingDates` both absent:** `wdPerWeek = 7` → every day is working → `walkWorkingDays(start, N, ±1, ...)` returns `start ± N` exactly → identical to raw math. ✓

Final gate: opus whole-impl review (or controller inline if API still degraded).

## 7. Out of scope / future

- **v2.2c — Layer B per-resource calendars.** `resolveCalendarForTask` integration: each task with `resourceIds` uses its own working-day mask. Requires per-task calendar resolution inside the hot inner loops + closure-set unioning. Own sub-project once Layer A is verified.
- **Lag-in-working-days option.** MS Project allows it; today's code is calendar-day-lag. Adding a per-link `lagWorkingDays?: boolean` would be its own design.
- **Working-day-numbered task storage.** Today `task.startDay` is a calendar-day index. An alternative engine architecture stores everything in working-day indices and the renderer converts. Bigger change, harder to reverse; not needed if Layer A holds.
- **Secondary `runCpm` callers** (shared-schedule, scripts): default raw-day behavior preserved. v2.2c can revisit if/when the share payload format gets bumped.
- **Gap E `recalculateStartDays` + `runCpm` double-execution.** Own sub-project.
- **Per-AIA-line `linkedTaskId`, active estimate→schedule re-sync, Supabase-snapshot URL fallback, levelResources UI surfacing.** Each its own sub-project.

## 8. Touched-file ledger (locked scope)

| # | File | Change |
|---|---|---|
| 1 | `utils/cpm.ts` | Task 1: `isWorkingDay` + `walkWorkingDays` helpers; `RunCpmOptions.workingDaysPerWeek?` + `nonWorkingDates?` fields. Task 2: calendar-aware EF + LS; thread calendar opts through `forwardPass`/`backwardPass` internal signatures; update `runCpm` callsites of those helpers. Task 3: calendar-aware anchor math (forward `efExact`/`efMin`; backward `esExact`/`esMax` — the v2.2a additions). |
| 2 | `app/schedule-pro.tsx` | Task 4: pass `workingDaysPerWeek` + `nonWorkingDates` from `project.schedule` into the existing `runCpm` callsite + add to the useMemo deps array. |

**2 files touched, 0 deleted, 0 created.** Engine + 1 caller. No migration, no edge fn, no portal, no new dep.
