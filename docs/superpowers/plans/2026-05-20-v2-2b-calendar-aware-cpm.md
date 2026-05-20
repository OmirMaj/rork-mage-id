# v2.2b Calendar-Aware CPM (Layer A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Forward + backward + anchor math become calendar-aware — skip weekends and closures instead of counting raw integer days. Engine + renderer agree on dates.

**Architecture:** 2 files, 4 commits. Scaffold helpers + opts (T1) → calendar-aware EF/LS + thread opts (T2) → calendar-aware anchor math (T3) → schedule-pro caller wires calendar fields (T4).

**Tech Stack:** TypeScript strict, React Native / Expo Router 6. No new dep, no migration, no edge fn.

Worktree: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`. Branch: `claude/p0-launch-on-main` (HEAD `0978857` after v2.2b spec lands). Spec: `docs/superpowers/specs/2026-05-20-v2-2b-calendar-aware-cpm-design.md` (commit `0978857`).

---

## File ledger (2 modified, 0 deleted, 0 created)

| File | Tasks |
|---|---|
| `utils/cpm.ts` | T1, T2, T3 |
| `app/schedule-pro.tsx` | T4 |

---

## Task 1: Scaffolding — helpers + RunCpmOptions fields

**File:** `utils/cpm.ts` only. Pure additive; no behavior change.

- [ ] **Step 1.1:** Read lines 130-180 of `utils/cpm.ts` to anchor the insertion point (immediately after `isoToDay`).

- [ ] **Step 1.2:** Insert `isWorkingDay` + `walkWorkingDays` helpers after `isoToDay` (around line 144):

```ts
/**
 * v2.2b — Is `dayIndex` a working day per the given project calendar?
 * Matches the addWorkingDays helper in scheduleEngine.ts:175 so engine
 * and renderer agree on which days count.
 *
 * - dayIndex 1 = scheduleStartDate (matches isoToDay convention).
 * - workingDaysPerWeek < 7 excludes weekends (Sun=0, Sat=6).
 * - closures set holds ISO dates (YYYY-MM-DD) that are blocked even
 *   when the weekday would normally be working.
 *
 * Returns true (permissive) when scheduleStartDate is unparseable so
 * the engine degrades to raw-day behavior instead of crashing.
 */
function isWorkingDay(
  dayIndex: number,
  workingDaysPerWeek: number,
  scheduleStartDate: string,
  closures: Set<string>,
): boolean {
  const startMs = Date.parse(scheduleStartDate + 'T00:00:00Z');
  if (!Number.isFinite(startMs)) return true;
  const dayMs = startMs + (dayIndex - 1) * 86400000;
  const d = new Date(dayMs);
  const dow = d.getUTCDay();
  const weekendSkip = workingDaysPerWeek < 7 && (dow === 0 || dow === 6);
  if (weekendSkip) return false;
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return !closures.has(iso);
}

/**
 * v2.2b — Walk `count` working days from startIndex in `direction`
 * (1 = forward, -1 = backward), skipping non-working days. Returns the
 * resulting calendar-day index. For count=0 or missing scheduleStart,
 * returns startIndex unchanged (no-op).
 *
 * Caller MUST pre-check whether startIndex itself is a working day:
 *  - If yes, pass count = dur - 1 (startIndex counts as the first unit).
 *  - If no, pass count = dur (advance past the non-working start first).
 */
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

- [ ] **Step 1.3:** Extend `RunCpmOptions` (around `cpm.ts:91-118`). Add the two new optional fields AFTER `scheduleStartDate?: string`:

```ts
  /**
   * v2.2b — Working days per week (1-7). Default 7 (no weekend skipping
   * — preserves pre-v2.2b raw-day behavior for callers that don't opt
   * in). Typical construction values: 5 (Mon-Fri) or 6 (Mon-Sat).
   */
  workingDaysPerWeek?: number;
  /**
   * v2.2b — ISO date strings (YYYY-MM-DD) for closures / holidays that
   * block work even when the weekday would otherwise be working. Union
   * with the workingDaysPerWeek weekend mask.
   */
  nonWorkingDates?: string[];
```

- [ ] **Step 1.4:** tsc gate:
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: 0 errors. (Helpers are unused but declared; tsc passes.)

- [ ] **Step 1.5:** Grep: `grep -nE "isWorkingDay|walkWorkingDays" utils/cpm.ts` → at least 2 matches (the declarations).

- [ ] **Step 1.6:** Commit:
```bash
git add utils/cpm.ts
git commit -m "$(cat <<'EOF'
feat(cpm): scaffolding — walkWorkingDays + isWorkingDay helpers + RunCpmOptions calendar fields (v2.2b Task 1)

Foundational additive scaffolding for calendar-aware CPM. Two new
file-local helpers (isWorkingDay, walkWorkingDays) re-implementing the
addWorkingDays algorithm from scheduleEngine.ts:175 on day-number
indices instead of Date objects. RunCpmOptions gains two optional
fields (workingDaysPerWeek, nonWorkingDates) with documented defaults
that preserve pre-v2.2b raw-day behavior.

No behavior change yet — helpers are unused; opts are unread. Tasks
2-4 wire them into the forward pass, backward pass, anchor math, and
schedule-pro caller.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Calendar-aware EF + LS (engine duration math)

**File:** `utils/cpm.ts` only.

- [ ] **Step 2.1:** Find `forwardPass` signature. Extend with two new optional params after `scheduleStartDate?: string`:

```ts
function forwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  scheduleStartDate?: string,
  workingDaysPerWeek?: number,
  nonWorkingDates?: string[],
): Map<string, { es: number; ef: number }> {
```

- [ ] **Step 2.2:** Near the top of `forwardPass` body, derive working values:

```ts
const wdPerWeek = workingDaysPerWeek ?? 7;
const closuresSet = new Set(nonWorkingDates ?? []);
```

- [ ] **Step 2.3:** Replace the EF derivation. Find `const ef = dur === 0 ? es : es + dur - 1;` (within the for-loop over ordered tasks):

```ts
const ef = dur === 0 ? es
  : !scheduleStartDate ? es + dur - 1
  : isWorkingDay(es, wdPerWeek, scheduleStartDate, closuresSet)
    ? walkWorkingDays(es, dur - 1, 1, wdPerWeek, scheduleStartDate, closuresSet)
    : walkWorkingDays(es, dur, 1, wdPerWeek, scheduleStartDate, closuresSet);
```

- [ ] **Step 2.4:** Extend `backwardPass` signature (already takes `scheduleStartDate?` since v2.2a). Add two new optional params after it:

```ts
function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
  scheduleStartDate?: string,
  workingDaysPerWeek?: number,
  nonWorkingDates?: string[],
): Map<string, { ls: number; lf: number }> {
```

- [ ] **Step 2.5:** Near the top of `backwardPass` body (same place v2.2a put its anchor logic), derive working values:

```ts
const wdPerWeek = workingDaysPerWeek ?? 7;
const closuresSet = new Set(nonWorkingDates ?? []);
```

- [ ] **Step 2.6:** Replace the LS derivation. Find `const ls = dur === 0 ? lf : lf - dur + 1;` (around `cpm.ts:460` post-v2.2a):

```ts
const ls = dur === 0 ? lf
  : !scheduleStartDate ? lf - dur + 1
  : isWorkingDay(lf, wdPerWeek, scheduleStartDate, closuresSet)
    ? walkWorkingDays(lf, dur - 1, -1, wdPerWeek, scheduleStartDate, closuresSet)
    : walkWorkingDays(lf, dur, -1, wdPerWeek, scheduleStartDate, closuresSet);
```

- [ ] **Step 2.7:** Update the `runCpm` callsite to pass calendar fields to both internal helpers. Find the existing `forwardPass(ordered, tasks, options.scheduleStartDate)` call and the `backwardPass(ordered, tasks, forward, projectFinish, options.scheduleStartDate)` call. Extend each:

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

- [ ] **Step 2.8:** tsc gate. Run `npx tsc --noEmit` — expect 0 errors.

- [ ] **Step 2.9:** Grep: `grep -cE "walkWorkingDays\(" utils/cpm.ts` → at least 2 callsites (forward EF + backward LS).

- [ ] **Step 2.10:** Commit:
```bash
git add utils/cpm.ts
git commit -m "$(cat <<'EOF'
feat(cpm): calendar-aware EF + LS (v2.2b Task 2)

Forward pass EF and backward pass LS now skip weekends + closures via
walkWorkingDays. A 5-day task starting Thursday now correctly produces
EF = next Wednesday (matching what the renderer shows) instead of
EF = Saturday (raw integer math).

Threading: forwardPass + backwardPass signatures gain
workingDaysPerWeek? + nonWorkingDates? options; runCpm passes them
through. Anchor math still uses raw arithmetic — Task 3 addresses that.

Default-behavior preservation via the !scheduleStartDate ? rawMath
branch: callers that don't pass scheduleStartDate get byte-identical
output pre-vs-post v2.2b. Critical regression-prevention property.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Calendar-aware anchor math

**File:** `utils/cpm.ts` only.

- [ ] **Step 3.1:** Find the forward-pass anchor block (around `cpm.ts:355-368`). Replace the `efExact` branch:

```ts
if (anchor.efExact !== undefined) {
  es = dur === 0 ? anchor.efExact
    : !scheduleStartDate ? anchor.efExact - dur + 1
    : isWorkingDay(anchor.efExact, wdPerWeek, scheduleStartDate, closuresSet)
      ? walkWorkingDays(anchor.efExact, dur - 1, -1, wdPerWeek, scheduleStartDate, closuresSet)
      : walkWorkingDays(anchor.efExact, dur, -1, wdPerWeek, scheduleStartDate, closuresSet);
}
```

- [ ] **Step 3.2:** Replace the `efMin` branch (within the same forward-pass anchor block):

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

- [ ] **Step 3.3:** Find the v2.2a backward-pass anchor block (in `backwardPass`, the block introduced by commit `f6a1cc8`). Replace the `esExact` branch:

```ts
if (anchor.esExact !== undefined) {
  lf = dur === 0 ? anchor.esExact
    : !scheduleStartDate ? anchor.esExact + dur - 1
    : isWorkingDay(anchor.esExact, wdPerWeek, scheduleStartDate, closuresSet)
      ? walkWorkingDays(anchor.esExact, dur - 1, 1, wdPerWeek, scheduleStartDate, closuresSet)
      : walkWorkingDays(anchor.esExact, dur, 1, wdPerWeek, scheduleStartDate, closuresSet);
}
```

- [ ] **Step 3.4:** Replace the `esMax` branch (within the same v2.2a backward-pass block):

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

**Variable-name verification:** the forward pass uses `scheduleStart` as the param name (per `cpm.ts:159` `computeAnchor(task, scheduleStart)`) — verify and adapt; the backward pass uses `scheduleStartDate` (added in v2.2a). Use whichever name is in scope. `wdPerWeek` + `closuresSet` are derived at the top of each function body in Task 2.

- [ ] **Step 3.5:** tsc gate. Run `npx tsc --noEmit` — expect 0 errors.

- [ ] **Step 3.6:** Grep: `grep -cE "walkWorkingDays\(" utils/cpm.ts` → at least 6 callsites now (forward EF + backward LS + forward efExact + forward efMin + backward esExact + backward esMax).

- [ ] **Step 3.7:** Commit:
```bash
git add utils/cpm.ts
git commit -m "$(cat <<'EOF'
feat(cpm): calendar-aware anchor math (v2.2b Task 3)

Forward-pass anchor block (efExact, efMin) and backward-pass anchor
block (esExact, esMax — added in v2.2a commit f6a1cc8) now compute
their derived ES/LF values via walkWorkingDays instead of raw
arithmetic. A finish-no-later=Friday-day-20 anchor with 5-day
duration now correctly derives ES = Monday-of-that-week (5 working
days back from Friday) instead of Monday-minus-weekend = Saturday.

Anchor handling now matches the calendar semantics of the rest of the
engine. Default-behavior preservation via the !scheduleStartDate ?
rawMath branch — same pattern as Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: schedule-pro caller threads calendar fields

**File:** `app/schedule-pro.tsx` only.

- [ ] **Step 4.1:** Find the existing `runCpm(rolledTasks, { ... })` call around `app/schedule-pro.tsx:209-215`. Current shape:

```ts
const cpm = useMemo(
  () => runCpm(rolledTasks, {
    scheduleStartDate: scheduleStartIso,
    criticalFloatThresholdDays,
  }),
  [rolledTasks, scheduleStartIso, criticalFloatThresholdDays],
);
```

- [ ] **Step 4.2:** Add the two calendar fields + add to the deps array:

```ts
const cpm = useMemo(
  () => runCpm(rolledTasks, {
    scheduleStartDate: scheduleStartIso,
    criticalFloatThresholdDays,
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  }),
  [
    rolledTasks,
    scheduleStartIso,
    criticalFloatThresholdDays,
    project?.schedule?.workingDaysPerWeek,
    project?.schedule?.nonWorkingDates,
  ],
);
```

- [ ] **Step 4.3:** tsc gate. Run `npx tsc --noEmit` — expect 0 errors.

- [ ] **Step 4.4:** Grep: `grep -nE "workingDaysPerWeek: project" app/schedule-pro.tsx` → 1 match.

- [ ] **Step 4.5:** Commit:
```bash
git add app/schedule-pro.tsx
git commit -m "$(cat <<'EOF'
feat(schedule-pro): thread calendar fields into runCpm (v2.2b Task 4)

Connects the engine's new calendar awareness (v2.2b Tasks 1-3) to real
project data. project.schedule.workingDaysPerWeek +
project.schedule.nonWorkingDates now flow into runCpm via the existing
useMemo callsite at :209. Engine produces EF/LS that match what the
Gantt renders via addWorkingDays. Projects without these fields (legacy
/ undefined values) continue to get the existing raw-day behavior via
the engine's back-compat defaults.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final whole-impl gates

After T4 commits:

- [ ] **Gate A — tsc clean:**
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Gate B — scope ledger:**
```bash
git diff --stat HEAD~4..HEAD
```
Expected: exactly 2 files (`utils/cpm.ts` + `app/schedule-pro.tsx`).

- [ ] **Gate C — calendar-aware sites wired:**
```bash
grep -cE "walkWorkingDays\(" utils/cpm.ts
```
Expected: ≥ 6 matches (forward EF + backward LS + 4 anchor branches).

```bash
grep -nE "workingDaysPerWeek: project" app/schedule-pro.tsx
```
Expected: 1 match.

- [ ] **Gate D — manual reasoning** (math walks from spec §6):
  1. 5-day task, Mon-Fri, ES=Mon → EF=Fri (raw + calendar same)
  2. 5-day task, Mon-Fri, ES=Thu → EF=Wed-of-next-week (calendar diverges from raw)
  3. 3-day task, Mon-Fri, ES=Sat → EF=Wed (non-working start)
  4. Milestone dur=0 → EF=ES regardless
  5. MFO efExact=Fri + dur=5 → ES=Mon-of-that-week
  6. Project with Dec 25 closure + 5-day task starting Dec 22 → EF=Dec 29 (skips Christmas + weekend)
  7. Default-regression — no calendar opts passed → byte-identical raw math
  8. scheduleStart present, no other calendar fields → wdPerWeek=7 → identical to raw

---

## Opus whole-impl review dispatch (after Gate D passes)

If API is healthy: dispatch one opus review verifying the 9 items in spec §6 + commit message accuracy.

If API is 529-degraded (as during v2.2a): controller inline-reviews with the same rigor. Document the inline-review fallback in the final ship audit.

---

## Ship — BATCHED

Per session pattern, v2.2b's 4 commits (T1-T4) + 2 doc commits (spec + plan) join `claude/p0-launch-on-main` waiting for the batched OTA. Run after opus APPROVES:

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git checkout main
git pull origin main
git merge --ff-only claude/p0-launch-on-main
git push origin main
eas update --branch production --message "v2.2b calendar-aware CPM Layer A (forward + backward + anchors honor workingDaysPerWeek + nonWorkingDates)"
```

No edge fn. No migration.
