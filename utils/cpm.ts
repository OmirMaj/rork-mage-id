// Critical Path Method (CPM) engine for construction schedules.
//
// Purpose
// -------
// Given a set of tasks with dependencies (FS/SS/FF/SF + lag), compute:
//   1. Early Start (ES)  + Early Finish (EF)   — forward pass
//   2. Late Start  (LS)  + Late Finish  (LF)   — backward pass
//   3. Total Float  (TF)                        — LS − ES (= LF − EF)
//   4. Free Float   (FF)                        — slack before the next successor
//   5. Critical Path                            — tasks with TF ≤ 0
//   6. Resource Leveling                        — if two tasks share a crew and
//                                                 overlap, delay the one with
//                                                 more float. If both are on
//                                                 the critical path, the
//                                                 project end date slides and
//                                                 we surface the conflict.
//
// Why build this alongside scheduleEngine.ts rather than replacing it
// ------------------------------------------------------------------
// `recalculateStartDays` in scheduleEngine.ts is a forward-pass-only resolver.
// Lots of existing screens call it and expect the legacy mutation semantics
// (a task's startDay is PUSHED to meet its earliest constraint). This module
// is side-effect free: it takes tasks in, returns a `CpmResult`, and the
// caller decides whether to apply it. That keeps the old API working while
// the new UI (grid + drag Gantt) consumes the rich CPM output.
//
// Data model contract
// -------------------
// Days are integers, 1-indexed to match the rest of the codebase. A task that
// starts on day 1 with duration 5 has ES=1, EF=5 (inclusive end). A successor
// FS with lag 0 has ES = predecessor.EF + 1. The +1 is the convention the
// existing `recalculateStartDays` already uses — we preserve it so old data
// keeps laying out correctly.
//
//   FS (finish-to-start, default): S.ES ≥ P.EF + lag + 1
//   SS (start-to-start):           S.ES ≥ P.ES + lag
//   FF (finish-to-finish):         S.EF ≥ P.EF + lag  →  S.ES = S.EF − dur + 1
//   SF (start-to-finish, rare):    S.EF ≥ P.ES + lag  →  S.ES = S.EF − dur + 1
//
// (For SS/FF/SF the "+1" convention only applies where a finish meets a start.)

import type { ScheduleTask, DependencyLink, AnchorType } from '@/types';
import { toCalendarDayString } from '@/utils/calendarDate';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmTaskResult {
  id: string;
  // es/ef/ls/lf are CALENDAR INDICES (day 1 = scheduleStartDate, every calendar
  // day consumes an index) — see "THE TWO DAY-NUMBER SCALES" below. Render them
  // with a plain date add, never with addWorkingDays().
  es: number;          // early start (day number, 1-indexed)
  ef: number;          // early finish (day number, inclusive)
  ls: number;          // late start
  lf: number;          // late finish
  /** WORKING days of slack on the task's own calendar. 0 or less → critical. */
  totalFloat: number;
  /**
   * WORKING days this task can slip before the earliest successor moves. Same
   * unit as totalFloat, and never clamped — a negative value means an anchor or
   * a pin has already put a successor inside this task's span.
   */
  freeFloat: number;
  isCritical: boolean; // totalFloat ≤ criticalFloatThresholdDays (default 0)
}

export interface CpmConflict {
  /** Machine-readable kind so the UI can show different icons / copy. */
  kind: 'cycle' | 'resource_overallocation' | 'resource_delayed_project'
    | 'anchor_violation' | 'dangling_link';
  /** Short human-readable summary. */
  message: string;
  /** Task ids involved in the conflict. */
  taskIds: string[];
  /** Additional structured context for the UI (varies by kind). */
  detail?: Record<string, unknown>;
}

export interface CpmResult {
  /** Per-task CPM fields keyed by task.id. */
  perTask: Map<string, CpmTaskResult>;
  /** Absolute project start day (always 1 in the current model, kept for future). */
  projectStart: number;
  /** Project finish day — max EF across all tasks. */
  projectFinish: number;
  /** Tasks on the critical path, in topological order. */
  criticalPath: string[];
  /** Any DAG cycles, resource conflicts, or unreachable nodes detected. */
  conflicts: CpmConflict[];
  /**
   * Leveled startDays (only present when leveling ran). Callers apply these
   * back onto tasks if they want the engine to own scheduling. We return them
   * separately so the UI can preview / diff before committing.
   */
  leveledStartDays?: Map<string, number>;
  /**
   * The project finish that RESULTS from applying `leveledStartDays` — present
   * only when levelling ran. `projectFinish` above is always the UNLEVELLED
   * one (it is fixed at step 4, before levelling at step 9), so a preview that
   * subtracts the two gets zero every time. Compare against this instead.
   */
  leveledProjectFinish?: number;
}

export interface RunCpmOptions {
  /**
   * When true, delays tasks that share a crew and overlap with tasks that
   * have less float. Default false — leveling changes startDays, so it should
   * be opt-in (the grid view doesn't want it auto-running on every keystroke).
   *
   * **STATUS (2026-05-20):** wired in the engine + tested via
   * `scripts/test-cpm.ts` and `scripts/test-demo-schedule.ts`, but NOT
   * surfaced in any user UI. The audit at
   * `docs/superpowers/audits/2026-05-20-session-end-audit.md` §F.T5
   * flagged this as needing a product decision: either surface as a
   * Pro-tier feature with a UI toggle, or delete the option + the
   * `levelResources` helper + the `LevelingContext` interface + the
   * `leveledStartDays` field on CpmResult. Engine code preserved
   * pending that product call — tested engine code is more valuable
   * than the maintenance overhead of carrying it.
   */
  levelResources?: boolean;
  /**
   * If set, forces the project finish used for the backward pass. Otherwise
   * uses the max EF from the forward pass. Useful when the user has committed
   * to a contract end date and wants to see negative float on tasks that will
   * blow it.
   */
  targetFinishDay?: number;
  /**
   * Tasks with totalFloat <= threshold are marked critical. Default 0
   * (strict CPM). Set higher to surface "near-critical" tasks. ProjectSchedule
   * carries this as `criticalFloatThresholdDays` — schedule-pro passes it in.
   */
  criticalFloatThresholdDays?: number;
  /**
   * Schedule start date (ISO YYYY-MM-DD) — needed to resolve anchorDate
   * strings into day numbers so the forward/backward pass can honor them.
   * When absent, anchors are ignored (back-compat with callers that don't
   * know about anchors yet).
   */
  scheduleStartDate?: string;
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
  /**
   * v2.2c — Per-task calendar override map. Caller builds this via
   * `resolveCalendarForTask(task, schedule)` from
   * utils/scheduleResourceCalendars.ts. Tasks not in the map fall back
   * to the project-level workingDaysPerWeek + nonWorkingDates above.
   * When undefined (default), every task uses project-level —
   * behavior identical to v2.2b Layer A.
   */
  taskCalendars?: Map<string, { workingDaysPerWeek: number; closures: string[] }>;
}

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------
//
// Anchors (our rebrand of MS Project "constraints") let a user pin a task's
// start or finish to an absolute date. They apply as additional floor/ceiling
// clamps on top of the dependency-driven ES/EF.
//
// The date-to-day math mirrors the convention used elsewhere in the app:
// day 1 = scheduleStartDate. Anchors without a scheduleStartDate context are
// dropped silently — the caller should set the field in RunCpmOptions.

function isoToDay(iso: string | undefined, scheduleStart: string | undefined): number | null {
  if (!iso || !scheduleStart) return null;
  // Take the calendar-day PREFIX rather than concatenating onto the raw value.
  //
  // MS Project writes <ConstraintDate> as a full datetime (2026-08-31T08:00:00).
  // The old `iso + 'T00:00:00Z'` turned that into
  //     '2026-08-31T08:00:00T00:00:00Z'
  // which Date.parse answers NaN, so this returned null, computeAnchor returned
  // null, and the constraint was SILENTLY DROPPED. Every Must-Start-On /
  // Finish-No-Later-Than imported from MSPDI was parsed, mapped onto the task,
  // persisted — and then ignored by the engine. The anchor was visible in the
  // data and absent from the schedule, which is the worst way to be wrong.
  //
  // scheduleStart gets the same treatment: several fields declared 'YYYY-MM-DD'
  // come back from Supabase as full timestamps (see utils/calendarDate.ts), so
  // the same concatenation could NaN the baseline and drop every anchor at once.
  const a = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(scheduleStart.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // +1 so scheduleStart itself is day 1 (matching the 1-indexed convention).
  return Math.round((a - b) / 86400000) + 1;
}

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
/**
 * THE weekend rule, and the only copy of it. `dayOfWeek` is 0=Sunday..6=Saturday
 * (what both `Date.getDay()` and `Date.getUTCDay()` return).
 *
 *   7+ → every day works.
 *   6  → Mon–SAT; only Sunday is off.
 *   ≤5 → Mon–Fri.
 *
 * Extracted 2026-09-11 because it HAD drifted. `isWorkingDay` below (the
 * engine's index-based predicate) special-cased 6 as Mon–Sat, while
 * `scheduleEngine.addWorkingDays` and `scheduleOps.scheduleDayNumberFor` — the
 * two Date-based walkers every renderer, the CSV export and the .ics invite go
 * through — collapsed every value under 7 to Mon–Fri. On a 6-day project the
 * engine therefore scheduled Saturdays that every date label refused to count:
 * measured on a 5-day week they agree, and on a 6-day week from Mon 2026-03-02
 * working ordinal 11 was calendar index 12 (Fri Mar 13) to the engine and
 * Mon Mar 16 to `addWorkingDays` — three calendar days apart on one task, and
 * growing with every Saturday downstream. The rule now has one definition and
 * all three callers ask it.
 *
 * Values below 5 still mean Mon–Fri: a genuine 4-day week needs a per-day mask
 * (`ResourceCalendar.workingDaysOfWeek` is typed for exactly that and is still
 * unread), and inventing which day is off would be worse than counting five.
 */
export function isWorkingDayOfWeek(dayOfWeek: number, workingDaysPerWeek: number): boolean {
  if (workingDaysPerWeek >= 7) return true;
  if (workingDaysPerWeek === 6) return dayOfWeek !== 0;
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

export function isWorkingDay(
  dayIndex: number,
  workingDaysPerWeek: number,
  scheduleStartDate: string,
  closures: Set<string>,
): boolean {
  const startMs = startEpochMs(scheduleStartDate);
  if (!Number.isFinite(startMs)) return true;
  const dayMs = startMs + (dayIndex - 1) * 86400000;
  // Day-of-week without allocating a Date: the epoch day 0 (1970-01-01) was a
  // Thursday, so (epochDay + 4) % 7 is the UTC day-of-week. This function is
  // the innermost loop of the whole engine — every float computation, every
  // ordinal conversion and every EF walk lands here — and it used to Date.parse
  // the schedule start, allocate a Date and build an ISO string on EVERY call.
  const epochDay = Math.floor(dayMs / 86400000);
  const dow = ((epochDay + 4) % 7 + 7) % 7;
  // One rule, one definition — see isWorkingDayOfWeek above for why this is not
  // inlined here any more.
  if (!isWorkingDayOfWeek(dow, workingDaysPerWeek)) return false;
  // The ISO string is only ever used to probe `closures`; building it when
  // there are no closures was pure garbage on the hot path.
  if (closures.size === 0) return true;
  const d = new Date(dayMs);
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return !closures.has(iso);
}

/**
 * `Date.parse(iso + 'T00:00:00Z')` memoised on the last ISO seen. One runCpm
 * call asks for the same schedule start hundreds of thousands of times; a
 * single-slot cache is enough because a run only ever has one.
 */
let lastStartIso: string | undefined;
let lastStartMs = Number.NaN;
function startEpochMs(scheduleStartDate: string): number {
  if (scheduleStartDate !== lastStartIso) {
    lastStartIso = scheduleStartDate;
    lastStartMs = Date.parse(scheduleStartDate + 'T00:00:00Z');
  }
  return lastStartMs;
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

/**
 * v2.2b — Given a target EF (finish day) and a working-day duration, return
 * the ES that lands the finish exactly on `targetEf` under the given
 * calendar. This is the inverse of the EF walk: if `targetEf` is itself a
 * working day it counts as the last unit (walk back dur-1), otherwise we
 * skip the non-working finish first (walk back dur). Falls back to raw-day
 * math when `scheduleStart` is missing (pre-v2.2b behavior).
 *
 * Used by the FF/SF forward-pass dependency branches so non-FS links honor
 * weekends/closures instead of subtracting raw days off the finish.
 */
function esFromTargetEf(
  targetEf: number,
  dur: number,
  wd: number,
  closures: Set<string>,
  scheduleStart: string | undefined,
): number {
  if (dur === 0) return targetEf;
  if (!scheduleStart) return targetEf - dur + 1;
  return isWorkingDay(targetEf, wd, scheduleStart, closures)
    ? walkWorkingDays(targetEf, dur - 1, -1, wd, scheduleStart, closures)
    : walkWorkingDays(targetEf, dur, -1, wd, scheduleStart, closures);
}

/**
 * v2.2b — Mirror of {@link esFromTargetEf} for the backward pass: given a
 * target LS (late-start day) and duration, return the LF that lands the
 * start exactly on `targetLs`. Walk `dur` working days FORWARD. Used by the
 * SS/SF backward-pass branches (they constrain this task's LS, and its LF
 * must be the working-day span forward from there — not a raw-day add).
 */
function lfFromTargetLs(
  targetLs: number,
  dur: number,
  wd: number,
  closures: Set<string>,
  scheduleStart: string | undefined,
): number {
  if (dur === 0) return targetLs;
  if (!scheduleStart) return targetLs + dur - 1;
  return isWorkingDay(targetLs, wd, scheduleStart, closures)
    ? walkWorkingDays(targetLs, dur - 1, 1, wd, scheduleStart, closures)
    : walkWorkingDays(targetLs, dur, 1, wd, scheduleStart, closures);
}

/**
 * v2.2b — Signed count of working days you must walk from `fromDay` to reach
 * `toDay` under the given project calendar. Positive when `toDay` is later,
 * negative when earlier, 0 when equal. Counts working days in the half-open
 * interval (min, max]. Falls back to the raw calendar-day delta when
 * `scheduleStartDate` is missing (can't resolve weekdays without an anchor).
 *
 * Used by the schedule-pro "slip vs baseline" KPI to express the gap between
 * the current CPM finish and a captured baseline finish in working days.
 */
export function workingDaysBetween(
  fromDay: number,
  toDay: number,
  opts: {
    workingDaysPerWeek?: number;
    scheduleStartDate?: string;
    nonWorkingDates?: string[];
  } = {},
): number {
  if (fromDay === toDay) return 0;
  if (!opts.scheduleStartDate) return toDay - fromDay;
  return workingDaysBetweenOn(
    fromDay, toDay,
    opts.workingDaysPerWeek ?? 7,
    opts.scheduleStartDate,
    opts.nonWorkingDates && opts.nonWorkingDates.length > 0
      ? new Set(opts.nonWorkingDates)
      : EMPTY_CLOSURES,
  );
}

/** Shared empty closure set — avoids an allocation per call on the hot path. */
const EMPTY_CLOSURES: Set<string> = new Set();

/**
 * {@link workingDaysBetween} against an ALREADY-PREPARED calendar. The public
 * wrapper re-`new Set(...)`s its closures on every call, and the engine calls
 * it once per task (total float) and once per link (free float) — on an
 * 800-task import that allocation and the `[...closures]` spread feeding it
 * dominated the run. Internal callers that already hold a Set use this.
 */
function workingDaysBetweenOn(
  fromDay: number,
  toDay: number,
  wd: number,
  scheduleStart: string,
  closures: Set<string>,
): number {
  if (fromDay === toDay) return 0;
  const lo = Math.min(fromDay, toDay);
  const hi = Math.max(fromDay, toDay);
  let count = 0;
  for (let d = lo + 1; d <= hi; d++) {
    if (isWorkingDay(d, wd, scheduleStart, closures)) count++;
  }
  return toDay > fromDay ? count : -count;
}

// ---------------------------------------------------------------------------
// THE TWO DAY-NUMBER SCALES — read this before touching any date math
// ---------------------------------------------------------------------------
//
// This codebase has TWO 1-indexed day numberings and they are NOT the same
// number. Mixing them shows up as a date that is late by the width of every
// weekend a task spans, and the error compounds down the chain.
//
// CORRECTION (2026-09-11). This block used to cite the 2026-09-07 audit's
// headline: "a 10-day task starting Mon Mar 2 printed a finish of Tue Mar 17
// while the engine said Fri Mar 13". That figure was never produced by any
// shipped composition — it came from rendering the CALENDAR-aware engine's
// output through `addWorkingDays`, a pairing no screen had. Re-measured on the
// same fixture: the pre-change grid printed Mar 2 → Mar 13 / Mar 16 → Mar 20 /
// Mar 23 → Mar 27, i.e. it AGREED with the engine on plain FS chains and on
// closures. What it actually got wrong, because it ran the engine with no
// options at all, was everything the calendar unlocks — a "must start on Mon
// Mar 23" anchor rendered as Tue Mar 3 (twenty days out, and the Gantt bar
// beside it was right), a Mon-Sat task finishing Mon Mar 9 against the
// engine's Sat Mar 7, `criticalFloatThresholdDays` silently ignored so the
// near-critical highlight never appeared, and a Due-by cell reading "2d early"
// on a task that lands exactly on its deadline. The scale distinction below is
// real and load-bearing; only the anecdote was wrong.
//
//   CALENDAR INDEX  — day 1 = scheduleStartDate, and EVERY calendar day
//                     consumes an index. Weekends/closures are indices you
//                     land on but cannot work. `isWorkingDay(i)` answers
//                     whether index i is workable.
//                     ► Everything `runCpm` RETURNS is on this scale:
//                       CpmTaskResult.es/ef/ls/lf and CpmResult.projectFinish.
//                     ► Render it as `scheduleStartDate + (i - 1) CALENDAR
//                       days` — a plain date add, NEVER addWorkingDays().
//
//   WORKING ORDINAL — day 1 = the first working day, and only working days
//                     consume a number. The 11th working ordinal on a Mon-Fri
//                     week starting Mon Mar 2 is Mon Mar 16 (calendar index
//                     15).
//                     ► Everything STORED on a task is on this scale:
//                       ScheduleTask.startDay, baselineStartDay/baselineEndDay,
//                       and the share payload. They are written by
//                       scheduleAI.materializeGeneratedTasks, by
//                       scheduleEngine.recalculateStartDays, and by the grid's
//                       date cell via scheduleOps.scheduleDayNumberFor.
//                     ► Render it with scheduleEngine.addWorkingDays(start,
//                       n - 1, wd) — which is exactly what getTaskDateRange,
//                       the CSV export and icsGenerator already do correctly.
//
// The engine converts ONCE, at the `pins` line in forwardPass: a stored
// working ordinal becomes a calendar index on the way in. Nothing downstream
// converts again. If you need to go back the other way (e.g. writing a
// dragged bar position onto task.startDay) use
// `calendarIndexToWorkingOrdinal`.
//
// Both converters are the identity when `scheduleStartDate` is absent (the
// engine's raw-day mode) or when the calendar is 7 working days a week — in
// both of those cases the two scales genuinely coincide.
//
// ── EVERY WRITER OF `startDay` (all converting, verified 2026-09-11) ────────
// Five places used to persist a CALENDAR value onto `startDay`. Each one
// inflated the plan on the next run, because the `pins` line then read that
// calendar index as an ordinal and re-expanded it across every weekend it
// already contained. All five now convert on the way out:
//
//   • app/schedule-wizard.tsx `handleSave` — was `startDay = r.es`; the shipped
//     kitchen-remodel template previewed 29 and saved 39.
//   • utils/copilot/scheduleEdit/applyToProjectSchedule.ts — same shape.
//   • utils/coScheduleReflowCore.ts — was adding a CALENDAR delta to an ordinal.
//   • app/(tabs)/schedule/index.tsx `isoToStartDay` and `handleSaveTask` — both
//     divided the raw millisecond gap, so picking Mon Mar 16 stored 15 and the
//     engine planned Fri Mar 20. Now `scheduleOps.startDayNumberFor`.
//   • components/schedule/GridPane.tsx date cell — already used
//     `scheduleOps.scheduleDayNumberFor`.
//
// The conversion is `calendarIndexToWorkingOrdinal(value, { scheduleStartDate,
// workingDaysPerWeek, nonWorkingDates })`, or `scheduleOps.startDayNumberFor`
// when the input is a Date. Guards: validate-cpm §12 (the round trip is a fixed
// point) and §24 (the Schedule tab picker), validate-schedule-wizard-ux and
// validate-co-schedule-reflow — all green.
//
// `rebaseRawToCalendar` (utils/scheduleRebase.ts) is the mirror-image trap and
// is no longer called from anywhere. It existed to compensate for the engine
// MISREADING `startDay` at the moment a start date was first set; now that the
// engine converts, re-mapping first double-converts. Measured on
// A(10)->B(10)->C(5) at ordinals 1/11/21 from Mon 2026-03-02 on a 5-day week:
// finish Fri Apr 3 without it, Wed Apr 15 with it.
//
// KNOWN, AND DETECTABLE — NOT AUTOMATICALLY MIGRATED ON PURPOSE: a schedule
// that ran through `rebaseRawToCalendar` on an older build carries calendar
// indices in `startDay` and reads longer under this engine. An earlier note
// here claimed the condition was undetectable. It is not: the rebase moved
// `startDay` and left `baselineStartDay` — which is stamped EQUAL to it at
// authoring time — behind, so the task carries its own before-and-after pair.
// `detectStartDayBasis` reads that pair plus two corroborating signals; see the
// long note above it at the bottom of this file. Because the result is evidence
// and not proof, nothing converts data on its own: the verdict raises a
// one-time notice the user answers, and the answer is persisted as
// `ProjectSchedule.startDayBasis` so it is asked exactly once.

export interface DayScaleOptions {
  workingDaysPerWeek?: number;
  scheduleStartDate?: string;
  nonWorkingDates?: string[];
}

/**
 * WORKING ORDINAL → CALENDAR INDEX. The calendar index of the `ordinal`-th
 * working day counted from day 1. Mirrors
 * `scheduleEngine.addWorkingDays(start, ordinal - 1, wd, closures)` exactly,
 * so a date rendered from the returned index equals the date that helper
 * produces from the ordinal.
 */
export function workingOrdinalToCalendarIndex(
  ordinal: number,
  opts: DayScaleOptions = {},
): number {
  const n = Math.max(1, Math.floor(ordinal));
  if (!opts.scheduleStartDate) return n;
  const wd = opts.workingDaysPerWeek ?? 7;
  const closures = new Set(opts.nonWorkingDates ?? []);
  if (wd >= 7 && closures.size === 0) return n;
  if (n === 1) return 1;
  // walkWorkingDays counts the days it LANDS on, so walking n-1 working days
  // from index 1 lands on the n-th working day — provided index 1 is itself
  // workable. When it is not, addWorkingDays has the same quirk (it returns
  // `start` unchanged for days=0), so the two stay in lockstep.
  return walkWorkingDays(1, n - 1, 1, wd, opts.scheduleStartDate, closures);
}

/**
 * Inclusive count of WORKING days between two CALENDAR indices — i.e. the
 * duration a task occupying `[fromDay, toDay]` on the calendar actually has.
 * The inverse of the forward pass's EF walk, and what a Gantt drag-resize needs
 * to turn a pixel width (calendar days) back into `durationDays` (working days).
 */
export function workingDaysInSpan(
  fromDay: number,
  toDay: number,
  opts: DayScaleOptions = {},
): number {
  if (toDay < fromDay) return 0;
  if (!opts.scheduleStartDate) return toDay - fromDay + 1;
  const wd = opts.workingDaysPerWeek ?? 7;
  const closures = new Set(opts.nonWorkingDates ?? []);
  let count = 0;
  for (let d = fromDay; d <= toDay; d++) {
    if (isWorkingDay(d, wd, opts.scheduleStartDate, closures)) count++;
  }
  return count;
}

/**
 * CALENDAR INDEX → Date. The ONE renderer for anything `runCpm` returns
 * (es/ef/ls/lf/projectFinish). Day 1 is `projectStartDate` and every calendar
 * day advances the index by one, so this is a plain date add — deliberately
 * NOT `addWorkingDays`, which would count the same index as a working ordinal
 * and print a date later than the engine's by the width of every weekend the
 * task spans — measured on a 10-day task starting Mon Mar 2 on a 5-day week,
 * `addWorkingDays` puts the engine's EF (calendar index 12) on Tue Mar 17
 * against its real Fri Mar 13, and the gap grows with every weekend downstream.
 *
 * Uses local-time `setDate` (not raw millisecond arithmetic) so a DST boundary
 * inside the span does not shave or add an hour and floor to the wrong day.
 */
export function calendarDayToDate(projectStartDate: Date, calendarIndex: number): Date {
  const d = new Date(projectStartDate.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (Math.round(calendarIndex) - 1));
  return d;
}

/**
 * Date → CALENDAR INDEX. Inverse of {@link calendarDayToDate}. Used where the
 * UI has a real date (a deadline, "today") and needs to compare it against an
 * engine value.
 */
export function dateToCalendarDay(projectStartDate: Date, target: Date): number {
  const base = new Date(projectStartDate.getTime());
  base.setHours(0, 0, 0, 0);
  const tgt = new Date(target.getTime());
  tgt.setHours(0, 0, 0, 0);
  return Math.round((tgt.getTime() - base.getTime()) / 86400000) + 1;
}

/**
 * CALENDAR INDEX → WORKING ORDINAL — the inverse of
 * {@link workingOrdinalToCalendarIndex}. A non-working calendar index maps to
 * the ordinal of the last working day on or before it (matching
 * `scheduleOps.scheduleDayNumberFor`), so a bar dropped on a Saturday snaps
 * back to Friday rather than inventing a weekend ordinal.
 */
export function calendarIndexToWorkingOrdinal(
  calendarIndex: number,
  opts: DayScaleOptions = {},
): number {
  const idx = Math.max(1, Math.floor(calendarIndex));
  if (!opts.scheduleStartDate) return idx;
  const wd = opts.workingDaysPerWeek ?? 7;
  const closures = new Set(opts.nonWorkingDates ?? []);
  if (wd >= 7 && closures.size === 0) return idx;
  let ordinal = 1;
  for (let d = 2; d <= idx; d++) {
    if (isWorkingDay(d, wd, opts.scheduleStartDate, closures)) ordinal++;
  }
  return ordinal;
}

interface AnchorClamp {
  /** Earliest allowed ES (inclusive). */
  esMin?: number;
  /** Latest allowed ES (inclusive). */
  esMax?: number;
  /** Earliest allowed EF (inclusive). */
  efMin?: number;
  /** Latest allowed EF (inclusive). */
  efMax?: number;
  /** Pin ES to exact value — hard constraint. */
  esExact?: number;
  /** Pin EF to exact value — hard constraint. */
  efExact?: number;
  /** ALAP: push this task to its LS during a second pass. */
  alap?: boolean;
}

function computeAnchor(task: ScheduleTask, scheduleStart: string | undefined): AnchorClamp | null {
  const type: AnchorType = task.anchorType || 'none';
  if (type === 'none') return null;
  if (type === 'as-late-as-possible') return { alap: true };
  const day = isoToDay(task.anchorDate, scheduleStart);
  if (day === null) return null;
  switch (type) {
    case 'start-no-earlier':  return { esMin: day };
    case 'start-no-later':    return { esMax: day };
    case 'finish-no-earlier': return { efMin: day };
    case 'finish-no-later':   return { efMax: day };
    case 'must-start-on':     return { esExact: day };
    case 'must-finish-on':    return { efExact: day };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Dependency helpers (tolerant of the legacy `dependencies: string[]` shape)
// ---------------------------------------------------------------------------

/**
 * Normalize a task's dependency declarations. Supports the modern
 * `dependencyLinks` array (FS/SS/FF/SF + lag) and falls back to the legacy
 * `dependencies: string[]` which implies FS + 0 lag.
 */
function getLinks(task: ScheduleTask): DependencyLink[] {
  if (task.dependencyLinks && task.dependencyLinks.length > 0) {
    return task.dependencyLinks;
  }
  return (task.dependencies ?? []).map(id => ({
    taskId: id,
    type: 'FS' as const,
    lagDays: 0,
  }));
}

// ---------------------------------------------------------------------------
// Step 1: DAG validation
// ---------------------------------------------------------------------------
//
// Uses DFS with a 3-color marker (white/gray/black) so we can both detect a
// cycle and return the cycle nodes (handy for the UI to highlight). A gray
// node found during DFS means we're revisiting an ancestor → cycle.

/**
 * Dependency links that point at a task which is not in this schedule.
 *
 * Every other pass in this file skips them silently — `topoSort` at its
 * `!byId.has(link.taskId) continue`, `detectCycles` at its own, the forward and
 * backward passes at theirs. That is the RIGHT arithmetic (you cannot schedule
 * against a task that does not exist) and the wrong silence: deleting a task
 * quietly severs every link into it, the plan gets shorter, and nothing anywhere
 * says why. A GC reads that as the schedule improving.
 *
 * So the arithmetic is unchanged and the FACT is now reported. One conflict per
 * affected task, listing the ids it can no longer find, so the grid's existing
 * conflict banner (which renders any non-'cycle' kind as a warning rather than
 * an error) can show it without knowing what a dangling link is.
 *
 * Exported and pure so a guard can execute it.
 */
export function detectDanglingLinks(tasks: ScheduleTask[]): CpmConflict[] {
  const idSet = new Set(tasks.map(t => t.id));
  const out: CpmConflict[] = [];
  for (const task of tasks) {
    const missing = getLinks(task).map(l => l.taskId).filter(id => !idSet.has(id));
    if (missing.length === 0) continue;
    const unique = [...new Set(missing)];
    out.push({
      kind: 'dangling_link',
      message: `"${task.title}" depends on ${unique.length} task(s) that are no longer in this schedule, so ${unique.length === 1 ? 'that link is' : 'those links are'} being ignored.`,
      taskIds: [task.id],
      detail: { missingPredecessorIds: unique },
    });
  }
  return out;
}

export function detectCycles(tasks: ScheduleTask[]): CpmConflict[] {
  const idSet = new Set(tasks.map(t => t.id));
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  tasks.forEach(t => color.set(t.id, 'white'));

  const conflicts: CpmConflict[] = [];
  const parent = new Map<string, string | null>();

  const visit = (id: string): string[] | null => {
    color.set(id, 'gray');
    const task = tasks.find(t => t.id === id);
    if (!task) return null;

    for (const link of getLinks(task)) {
      // Silently skip dangling dep refs — the UI should flag those separately.
      if (!idSet.has(link.taskId)) continue;

      const c = color.get(link.taskId);
      if (c === 'gray') {
        // Found cycle. Walk parents back from `id` to `link.taskId` to
        // reconstruct the cycle path.
        const cycle: string[] = [link.taskId, id];
        let cur: string | null | undefined = parent.get(id);
        while (cur && cur !== link.taskId) {
          cycle.splice(1, 0, cur);
          cur = parent.get(cur);
        }
        return cycle;
      }
      if (c === 'white') {
        parent.set(link.taskId, id);
        const found = visit(link.taskId);
        if (found) return found;
      }
    }

    color.set(id, 'black');
    return null;
  };

  for (const t of tasks) {
    if (color.get(t.id) === 'white') {
      const cycle = visit(t.id);
      if (cycle) {
        conflicts.push({
          kind: 'cycle',
          message: `Dependency cycle detected through ${cycle.length} task(s). Remove one of the links to continue.`,
          taskIds: cycle,
          detail: { cycle },
        });
        // Don't keep hunting — the caller should fix one cycle at a time so
        // we're not spamming them with the same problem recolored.
        break;
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Step 2: Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topoSort(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const indegree = new Map<string, number>();
  const succList = new Map<string, string[]>();

  tasks.forEach(t => {
    indegree.set(t.id, 0);
    succList.set(t.id, []);
  });

  tasks.forEach(t => {
    for (const link of getLinks(t)) {
      if (!byId.has(link.taskId)) continue;
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      succList.get(link.taskId)!.push(t.id);
    }
  });

  const queue: string[] = [];
  indegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const out: ScheduleTask[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const s of succList.get(id) ?? []) {
      const nd = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, nd);
      if (nd === 0) queue.push(s);
    }
  }

  // If the graph has a cycle, out.length < tasks.length. We still return the
  // partial order — callers have already run detectCycles() and shown a
  // warning; the CPM math below will just skip unresolved tasks.
  return out;
}

// ---------------------------------------------------------------------------
// Step 3: Forward pass (ES, EF)
// ---------------------------------------------------------------------------
//
// We respect each task's own `startDay` as a MINIMUM constraint — the user
// may have pinned a task to start no earlier than a specific day (e.g. "crew
// arrives Monday"). The computed ES is max(dependency-required-start, pinned
// start, 1).
//
// SCALE: `task.startDay` is a WORKING ORDINAL (see the contract above) while
// everything this pass computes is a CALENDAR INDEX. The conversion happens
// once, at the `pins` line — nowhere else. Before that conversion existed the
// engine read the ordinal as an index, so typing "Mon Mar 16" (stored as
// working ordinal 11) planned the task on calendar day 11 = Thu Mar 12: every
// pinned task was scheduled EARLIER than authored, before a pixel was drawn.

/**
 * The earliest start ONE link permits for the successor, given the
 * predecessor's already-computed forward values. Extracted so the forward pass
 * and {@link computeFreeFloat} cannot drift apart: free float is defined as
 * "how far past the link's requirement does the successor actually start", and
 * that is only a true statement while both sides compute the requirement with
 * the same code.
 *
 * All arguments are on the CALENDAR-INDEX scale; `wd`/`closures` are the
 * SUCCESSOR's calendar (it is the successor's own working days that the walk
 * steps over).
 */
function requiredEsForLink(
  link: DependencyLink,
  depFwd: { es: number; ef: number },
  succDur: number,
  wd: number,
  closures: Set<string>,
  scheduleStart: string | undefined,
): number {
  const lag = link.lagDays || 0;
  const type = (link.type || 'FS') as DepType;
  switch (type) {
    // v2.2d — FS/SS were the last RAW-day arithmetic in this loop. FF/SF
    // were made calendar-aware earlier (see the note below); FS was not,
    // and FS is the overwhelmingly common link type.
    //
    // `depFwd.ef + lag + 1` lands the successor on the CALENDAR next day.
    // When a predecessor finishes on a Friday that is Saturday, so ES sits
    // on a non-working day while the EF walk correctly skips to Monday —
    // and the backward pass then computes LS from a working-day LF. The
    // difference is phantom float exactly the width of the weekend, so a
    // task on a pure chain with no parallel path reports float=2 and drops
    // off the critical path. Verified: A(3d)->B(2d)->C(2d) from Mon
    // 2026-03-02 gives C float=0 on a 7-day week and float=2 on a 5-day one.
    // On a real 5-day schedule most FS links cross a weekend somewhere, so
    // the critical path fragments into pieces.
    case 'FS': {
      // steps may be NEGATIVE: a LEAD (negative lag) pulls the successor
      // earlier, e.g. lag -2 means "start 2 days before the predecessor
      // finishes" => steps -1. walkWorkingDays refuses counts <= 0 and
      // returns its start index, so a lead must walk BACKWARD explicitly or
      // it is silently dropped — caught by validate-schedule-wizard-ux's
      // "a 2-day lead previews exactly 2 days shorter" assertions.
      const steps = lag + 1;
      return !scheduleStart ? depFwd.ef + steps
        : steps >= 0
          ? walkWorkingDays(depFwd.ef, steps, 1, wd, scheduleStart, closures)
          : walkWorkingDays(depFwd.ef, -steps, -1, wd, scheduleStart, closures);
    }
    // SS with lag 0 inherits the predecessor's ES, which is already a valid
    // working day. Only a non-zero lag can walk off the calendar.
    case 'SS':
      return !scheduleStart || lag === 0 ? depFwd.es + lag
        : lag > 0
          ? walkWorkingDays(depFwd.es, lag, 1, wd, scheduleStart, closures)
          : walkWorkingDays(depFwd.es, -lag, -1, wd, scheduleStart, closures);
    // FF/SF constrain this task's EF (to dep.EF+lag / dep.ES+lag). Walk
    // the *working-day* duration back to the matching ES. The old
    // `... - task.durationDays + 1` used RAW days, so any FF/SF link on a
    // 5- or 6-day calendar silently mis-dated the start and corrupted
    // float/critical-path across a weekend (v2.2b+ fix).
    case 'FF': return esFromTargetEf(depFwd.ef + lag, succDur, wd, closures, scheduleStart);
    case 'SF': return esFromTargetEf(depFwd.es + lag, succDur, wd, closures, scheduleStart);
  }
}

/** One row of the forward pass. See the two-scales contract: all CALENDAR indices. */
interface ForwardRow {
  es: number;
  ef: number;
  /** ES the DEPENDENCIES alone require — no authored pin, no anchor. */
  depEs: number;
  /** EF that `depEs` produces on this task's calendar. */
  depEf: number;
  /** Whether any resolvable predecessor link fed this task. */
  hasIncomingLink: boolean;
}

/**
 * An incremental WORKING ORDINAL → CALENDAR INDEX table for one calendar.
 * {@link workingOrdinalToCalendarIndex} walks from day 1 on every call, so
 * calling it per task made the forward pass O(tasks x maxOrdinal); this walks
 * the calendar once, extending as ordinals are asked for. Same answers — §1 of
 * validate-cpm asserts the two agree across the range.
 */
function makeOrdinalIndexer(opts: DayScaleOptions): (ordinal: number) => number {
  const scheduleStart = opts.scheduleStartDate;
  const wd = opts.workingDaysPerWeek ?? 7;
  const closures = opts.nonWorkingDates && opts.nonWorkingDates.length > 0
    ? new Set(opts.nonWorkingDates) : EMPTY_CLOSURES;
  if (!scheduleStart || (wd >= 7 && closures.size === 0)) {
    return (ordinal: number) => Math.max(1, Math.floor(ordinal));
  }
  // table[k] = calendar index of the k-th working ordinal. Index 1 is ordinal 1
  // whether or not it is workable — the same quirk addWorkingDays has for
  // days=0, and workingOrdinalToCalendarIndex is written to match it.
  const table: number[] = [0, 1];
  let cursor = 1;
  return (ordinal: number) => {
    const n = Math.max(1, Math.floor(ordinal));
    while (table.length <= n) {
      cursor++;
      if (isWorkingDay(cursor, wd, scheduleStart, closures)) table.push(cursor);
    }
    return table[n];
  };
}

function forwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  scheduleStart?: string,
  workingDaysPerWeek?: number,
  nonWorkingDates?: string[],
  taskCalendars?: Map<string, { workingDaysPerWeek: number; closures: string[] }>,
): Map<string, ForwardRow> {
  const map = new Map<string, ForwardRow>();
  const byId = new Map(all.map(t => [t.id, t]));
  // v2.2b — derive working values once per pass.
  const wdPerWeek = workingDaysPerWeek ?? 7;
  const closuresSet = new Set(nonWorkingDates ?? []);
  // v2.2c — per-task calendar cache. Built once per pass; same instance
  // reused at all 3 calendar-aware sites per task (EF + 2 anchor branches).
  const resolvedCalendars = new Map<string, { wd: number; closures: Set<string> }>();
  function calendarForTask(taskId: string): { wd: number; closures: Set<string> } {
    const cached = resolvedCalendars.get(taskId);
    if (cached) return cached;
    const cal = taskCalendars?.get(taskId);
    const resolved = cal
      ? { wd: cal.workingDaysPerWeek, closures: new Set(cal.closures) }
      : { wd: wdPerWeek, closures: closuresSet };
    resolvedCalendars.set(taskId, resolved);
    return resolved;
  }

  // The stored working ordinal → calendar index conversion, applied to the
  // PROJECT calendar (not the per-task one): startDay was authored against the
  // project-level grid renderer, so that is the calendar it was counted on.
  const projectScale: DayScaleOptions = {
    workingDaysPerWeek: wdPerWeek,
    scheduleStartDate: scheduleStart,
    nonWorkingDates: nonWorkingDates,
  };
  // Memoised ordinal → index table. `workingOrdinalToCalendarIndex` walks the
  // calendar from day 1 each time, so calling it once per task made the pass
  // O(tasks x maxOrdinal). The table is built once, incrementally, and shared.
  const ordinalToIndex = makeOrdinalIndexer(projectScale);

  for (const task of ordered) {
    const links = getLinks(task);
    const pins = ordinalToIndex(Math.max(1, task.startDay || 1));
    let depEs = 1;
    let hasIncomingLink = false;
    const anchor = computeAnchor(task, scheduleStart);
    const dur = Math.max(0, task.durationDays || 0);
    // v2.2c — resolve the task's calendar once. Reused by the non-FS
    // dependency math (FF/SF, below), the anchor clamps, and the EF walk.
    const { wd: taskWd, closures: taskClosures } = calendarForTask(task.id);

    let es = pins;
    for (const link of links) {
      const dep = byId.get(link.taskId);
      if (!dep) continue;
      const depCpm = map.get(dep.id);
      if (!depCpm) continue;

      const required = requiredEsForLink(link, depCpm, dur, taskWd, taskClosures, scheduleStart);
      if (required > es) es = required;
      // DEPENDENCY-DERIVED ONLY. Seeded at 1, never at `pins`: runCpm reports a
      // hard pin as unsatisfiable when the PREDECESSORS cannot deliver by the
      // pinned date, and the sentence it prints says exactly that. Folding the
      // authored `startDay` into this number made a task with NO predecessors
      // at all — any wizard/AI row, since they all carry a startDay — report
      // "the work feeding it cannot start until N day(s) after the
      // must-start-on date" the moment a user pinned it earlier than the day it
      // happened to be authored on. A pin superseding a stale authored start is
      // the pin doing its job, not a conflict.
      if (required > depEs) depEs = required;
      hasIncomingLink = true;
    }

    // Apply anchor floor/ceiling clamps. Hard pins (must-start-on /
    // must-finish-on) override dependency-derived ES; soft ones (SNET/SNLT/
    // FNET/FNLT) act as min/max bounds. If a clamp pushes ES below its
    // dependency floor, we log a conflict-like note by leaving ES untouched —
    // MS Project shows a warning indicator here too.
    if (anchor) {
      if (anchor.esExact !== undefined) es = anchor.esExact;
      if (anchor.esMin !== undefined && anchor.esMin > es) es = anchor.esMin;
      if (anchor.efMin !== undefined) {
        // v2.2b/c — Calendar-aware: walk back working days from efMin
        // to find the matching ES, using the per-task calendar.
        const { wd: aWd, closures: aClosures } = calendarForTask(task.id);
        const req = dur === 0 ? anchor.efMin
          : !scheduleStart ? anchor.efMin - dur + 1
          : isWorkingDay(anchor.efMin, aWd, scheduleStart, aClosures)
            ? walkWorkingDays(anchor.efMin, dur - 1, -1, aWd, scheduleStart, aClosures)
            : walkWorkingDays(anchor.efMin, dur, -1, aWd, scheduleStart, aClosures);
        if (req > es) es = req;
      }
      if (anchor.efExact !== undefined) {
        // v2.2b/c — Calendar-aware mirror of efMin branch.
        const { wd: aWd, closures: aClosures } = calendarForTask(task.id);
        es = dur === 0 ? anchor.efExact
          : !scheduleStart ? anchor.efExact - dur + 1
          : isWorkingDay(anchor.efExact, aWd, scheduleStart, aClosures)
            ? walkWorkingDays(anchor.efExact, dur - 1, -1, aWd, scheduleStart, aClosures)
            : walkWorkingDays(anchor.efExact, dur, -1, aWd, scheduleStart, aClosures);
      }
      // esMax / efMax don't push ES earlier — they're enforced as warnings
      // (conflict surfacing is wired in runCpm below, not here).
    }

    // v2.2b — Calendar-aware EF. v2.2c — uses per-task resolved calendar
    // (resolved once at the top of the loop) so resource-assigned tasks
    // honor their own working-day mask.
    const efFromEs = (start: number): number => (
      dur === 0 ? start
        : !scheduleStart ? start + dur - 1
        : isWorkingDay(start, taskWd, scheduleStart, taskClosures)
          ? walkWorkingDays(start, dur - 1, 1, taskWd, scheduleStart, taskClosures)
          : walkWorkingDays(start, dur, 1, taskWd, scheduleStart, taskClosures)
    );
    const ef = efFromEs(es);
    // The finish the dependency network alone would produce. The must-finish-on
    // check needs it for the same reason the must-start-on check needs `depEs`:
    // the anchor block above walks ES back FROM `efExact`, so `ef` is forced
    // equal to `efExact` and `r.ef !== clamp.efExact` can never fire for the
    // dependency-driven case. Compare `depEf` against the pin instead.
    map.set(task.id, { es, ef, depEs, depEf: efFromEs(depEs), hasIncomingLink });
  }

  return map;
}

// ---------------------------------------------------------------------------
// Step 4: Backward pass (LS, LF)
// ---------------------------------------------------------------------------
//
// For each task walking reverse-topological order: LF = min over successors
// of the constraint imposed by each link type + lag. Tasks with no successors
// (schedule leaves) have LF = projectFinish.

function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
  scheduleStartDate?: string,
  workingDaysPerWeek?: number,
  nonWorkingDates?: string[],
  taskCalendars?: Map<string, { workingDaysPerWeek: number; closures: string[] }>,
): Map<string, { ls: number; lf: number }> {
  const byId = new Map(all.map(t => [t.id, t]));
  const result = new Map<string, { ls: number; lf: number }>();
  // v2.2b — derive working values once per pass.
  const wdPerWeek = workingDaysPerWeek ?? 7;
  const closuresSet = new Set(nonWorkingDates ?? []);
  // v2.2c — per-task calendar cache (mirror of forwardPass).
  const resolvedCalendars = new Map<string, { wd: number; closures: Set<string> }>();
  function calendarForTask(taskId: string): { wd: number; closures: Set<string> } {
    const cached = resolvedCalendars.get(taskId);
    if (cached) return cached;
    const cal = taskCalendars?.get(taskId);
    const resolved = cal
      ? { wd: cal.workingDaysPerWeek, closures: new Set(cal.closures) }
      : { wd: wdPerWeek, closures: closuresSet };
    resolvedCalendars.set(taskId, resolved);
    return resolved;
  }

  // Pre-compute successor list keyed by predecessor id.
  const successors = new Map<string, { succ: ScheduleTask; link: DependencyLink }[]>();
  all.forEach(t => successors.set(t.id, []));
  all.forEach(t => {
    for (const link of getLinks(t)) {
      if (byId.has(link.taskId)) {
        successors.get(link.taskId)!.push({ succ: t, link });
      }
    }
  });

  // Walk the topo order in reverse.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const task = ordered[i];
    const fwd = forward.get(task.id);
    if (!fwd) continue;

    const dur = Math.max(0, task.durationDays || 0);
    const succs = successors.get(task.id) ?? [];
    // v2.2c — resolve the task's calendar once. Reused by the SS/SF finish
    // alignment (below), the anchor clamps, and the LS walk.
    const { wd: lsWd, closures: lsClosures } = calendarForTask(task.id);

    // Default: no successors → LF is project finish.
    let lf = projectFinish;

    for (const { succ, link } of succs) {
      const succLate = result.get(succ.id);
      if (!succLate) continue;

      const lag = link.lagDays || 0;
      const type = (link.type || 'FS') as DepType;

      let thisLf = lf;
      switch (type) {
        // FS: succ.LS ≥ this.LF + lag + 1  → this.LF ≤ succ.LS − lag − 1
        case 'FS': thisLf = succLate.ls - lag - 1; break;
        // SS: succ.LS ≥ this.LS + lag → this.LS ≤ succ.LS − lag, then
        // this.LF is the *working-day* span forward from that LS. The old
        // `+ Math.max(0, dur - 1)` added RAW days, mis-dating LF/float on
        // any non-7-day calendar spanning a weekend (v2.2b+ fix).
        case 'SS': thisLf = lfFromTargetLs(succLate.ls - lag, dur, lsWd, lsClosures, scheduleStartDate); break;
        // FF: succ.LF ≥ this.LF + lag      → this.LF ≤ succ.LF − lag
        case 'FF': thisLf = succLate.lf - lag; break;
        // SF: succ.LF ≥ this.LS + lag → this.LS ≤ succ.LF − lag, then LF is
        // the working-day span forward from that LS (raw-day fix, as SS).
        case 'SF': thisLf = lfFromTargetLs(succLate.lf - lag, dur, lsWd, lsClosures, scheduleStartDate); break;
      }
      if (thisLf < lf) lf = thisLf;
    }

    // v2.2a — Backward-pass anchor clamps (mirror of the forward-pass
    // clamps at :355-368). Apply AFTER the dependency-derived LF so
    // anchors can only tighten LF, never relax it. Strictest of multiple
    // bounds wins via min(). ALAP needs no clamp — the default
    // lf = projectFinish IS "as late as possible".
    const anchor = computeAnchor(task, scheduleStartDate);
    if (anchor) {
      if (anchor.efExact !== undefined) {
        lf = anchor.efExact;
      } else if (anchor.efMax !== undefined && anchor.efMax < lf) {
        lf = anchor.efMax;
      }
      if (anchor.esExact !== undefined) {
        // v2.2b/c — Calendar-aware with per-task calendar.
        const { wd: aWd, closures: aClosures } = calendarForTask(task.id);
        lf = dur === 0 ? anchor.esExact
          : !scheduleStartDate ? anchor.esExact + dur - 1
          : isWorkingDay(anchor.esExact, aWd, scheduleStartDate, aClosures)
            ? walkWorkingDays(anchor.esExact, dur - 1, 1, aWd, scheduleStartDate, aClosures)
            : walkWorkingDays(anchor.esExact, dur, 1, aWd, scheduleStartDate, aClosures);
      } else if (anchor.esMax !== undefined) {
        // v2.2b/c — Calendar-aware mirror of esExact branch.
        const { wd: aWd, closures: aClosures } = calendarForTask(task.id);
        const req = dur === 0 ? anchor.esMax
          : !scheduleStartDate ? anchor.esMax + dur - 1
          : isWorkingDay(anchor.esMax, aWd, scheduleStartDate, aClosures)
            ? walkWorkingDays(anchor.esMax, dur - 1, 1, aWd, scheduleStartDate, aClosures)
            : walkWorkingDays(anchor.esMax, dur, 1, aWd, scheduleStartDate, aClosures);
        if (req < lf) lf = req;
      }
    }

    // v2.2b — Calendar-aware LS. v2.2c — per-task calendar (resolved once
    // at the top of the loop).
    const ls = dur === 0 ? lf
      : !scheduleStartDate ? lf - dur + 1
      : isWorkingDay(lf, lsWd, scheduleStartDate, lsClosures)
        ? walkWorkingDays(lf, dur - 1, -1, lsWd, scheduleStartDate, lsClosures)
        : walkWorkingDays(lf, dur, -1, lsWd, scheduleStartDate, lsClosures);
    result.set(task.id, { ls, lf });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 5: Free float
// ---------------------------------------------------------------------------
//
// Free float = how much this task can slip WITHOUT delaying ANY successor's
// relevant CPM date (ES for FS/SS successors; EF for FF/SF successors —
// any shift in T's ES propagates to T's EF since duration is fixed, so
// the formulas all reduce to "how much can T's ES move before the
// successor's constraint binds"). MIN over outgoing links.
//
// UNITS: WORKING days on the successor's calendar — the same unit as total
// float, which is what makes `freeFloat <= totalFloat` (a CPM invariant, and
// the first thing a P6 user checks) actually hold. This used to subtract raw
// CALENDAR indices — `succFwd.es - fwd.ef - lag - 1` — while the forward pass
// had already walked ES/EF across weekends, so every intervening weekend added
// two phantom days of free float. On the default 5-day week the pure chain
// A(3d)->B(2d)->C(2d) reported B as "Total float 0d / Free float 2d" on the
// same TaskInspector row, which is not a state CPM can be in.
//
// NOT clamped at zero. An anchor or an authored pin can legitimately drive a
// successor's ES EARLIER than a predecessor's finish permits (a must-start-on
// date inside its predecessor's span does exactly that). P6 surfaces that;
// flooring it to 0 rendered a physically impossible schedule as "no slack, but
// fine". A negative free float is the signal that the logic is already broken.

function computeFreeFloat(
  tasks: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  scheduleStart: string | undefined,
  calendarForTask: (taskId: string) => ResolvedCalendar,
): Map<string, number> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const successors = new Map<string, { succ: ScheduleTask; link: DependencyLink }[]>();
  tasks.forEach(t => successors.set(t.id, []));
  tasks.forEach(t => {
    for (const link of getLinks(t)) {
      if (byId.has(link.taskId)) {
        successors.get(link.taskId)!.push({ succ: t, link });
      }
    }
  });

  const ff = new Map<string, number>();
  for (const task of tasks) {
    const fwd = forward.get(task.id);
    if (!fwd) { ff.set(task.id, 0); continue; }

    const succs = successors.get(task.id) ?? [];
    if (succs.length === 0) {
      // Leaf tasks — free float conventionally equals total float, but we set
      // it to 0 here and let the caller use TF if they need it for leaves.
      ff.set(task.id, 0);
      continue;
    }

    let minSucc = Infinity;
    const { countWorkingDays } = calendarForTask(task.id);
    for (const { succ, link } of succs) {
      const succFwd = forward.get(succ.id);
      if (!succFwd) continue;
      // Bound on this task's allowable forward shift Δ that keeps the
      // successor's relevant CPM date (ES for FS/SS; EF for FF/SF)
      // unchanged. `requiredEsForLink` is the SAME function the forward pass
      // used to place the successor, so "required vs actual" is exactly the
      // slack this one link leaves. Counting the gap in working days (rather
      // than subtracting the indices) is what keeps the unit honest.
      // The link is EVALUATED on the successor's calendar — it is the
      // successor's working days the forward pass steps over to place it.
      const { wd: sWd, closures: sClosures } = calendarForTask(succ.id);
      const required = requiredEsForLink(
        link, fwd, Math.max(0, succ.durationDays || 0), sWd, sClosures, scheduleStart,
      );
      // …but the ANSWER is counted on THIS task's calendar, because free float
      // is "how many days can THIS task slip" and the days it slips by are its
      // own crew days. Identical on a single-calendar project; the moment
      // `taskCalendars` is non-empty (schedule-pro builds it for every
      // resourceIds-assigned task) the successor's calendar was the wrong unit
      // for a number reported against the predecessor.
      const slack = countWorkingDays(required, succFwd.es);
      if (slack < minSucc) minSucc = slack;
    }
    ff.set(task.id, minSucc === Infinity ? 0 : minSucc);
  }
  return ff;
}

// ---------------------------------------------------------------------------
// Step 6: Resource leveling
// ---------------------------------------------------------------------------
//
// Simple single-resource-per-task leveling. Groups tasks by `assignedSubId`
// (falls back to `crew` string) and checks pairwise for calendar overlap.
// Where two tasks overlap, delays the one with MORE float. If neither has
// float, we report a `resource_delayed_project` conflict and push the
// less-critical one (tie-break by shorter duration first, then task id).
//
// Returns new startDays + any conflicts. Caller decides whether to commit.

interface LevelingContext {
  tasks: ScheduleTask[];
  cpm: Map<string, CpmTaskResult>;
  /** Forward-pass ES per task — CALENDAR indices, the scale levelling works in. */
  forwardEs: Map<string, number>;
  scheduleStart: string | undefined;
  calendarForTask: (taskId: string) => ResolvedCalendar;
  /** Project-level scale used to convert the result back to stored ordinals. */
  projectScale: DayScaleOptions;
}

/**
 * The resource a task competes for. `resourceIds` is checked LAST but is not
 * optional: it is the structured field schedule-pro already uses to build
 * per-task calendars (app/schedule-pro.tsx taskCalendars) and the one
 * ProjectSchedule.resources carries capacity on. Before it was read here, a
 * schedule that assigned work through the resource picker rather than the
 * free-text crew box was invisible to levelling — "Fix overloads" reported
 * nothing to do on exactly the schedules built with the newer UI.
 *
 * A task with several resources competes on each of them, so this returns a
 * LIST, not one key.
 */
function resourceKeys(t: ScheduleTask): string[] {
  const keys: string[] = [];
  if (t.assignedSubId) keys.push(`sub:${t.assignedSubId}`);
  if (t.crew && t.crew.trim()) keys.push(`crew:${t.crew.trim().toLowerCase()}`);
  for (const rid of t.resourceIds ?? []) {
    if (rid && rid.trim()) keys.push(`res:${rid.trim()}`);
  }
  return keys;
}

/**
 * Resource levelling.
 *
 * SCALE: everything in here is a CALENDAR INDEX, seeded from the forward
 * pass's ES. The old version seeded from `t.startDay` (a WORKING ordinal) while
 * SORTING by `cpm.es` (a calendar index) — it mixed the two scales before any
 * of the arithmetic even started, and then did raw `start + dur - 1` /
 * `busyUntil + 1` adds that could land a Mon-Fri crew on a Saturday (reproduced:
 * a levelled start of day 6 from Mon 2026-03-02 is Sat 2026-03-07).
 *
 * The returned map is converted BACK to working ordinals at the end, because
 * that is what `ScheduleTask.startDay` stores and what applyLeveling writes.
 * Tasks that did not move keep their exact original `startDay` so
 * summarizeLeveling does not report a phantom shift.
 *
 * RIPPLE: the map still contains only the tasks levelling itself moved — a
 * successor of a moved task is not in it. That is fine for the PLAN, because
 * `startDay` is a floor and runCpm re-runs on apply: measured on R1/R2 sharing
 * "framers" with AFTER depending on R2, applying the map and re-running puts
 * AFTER on Mon Mar 9 behind R2's Fri Mar 6, and `leveledProjectFinish` (12)
 * equals the finish you actually get. It is NOT fine for the preview's shift
 * list, which is built from this map alone and therefore never mentions the
 * successors that will move.
 *
 * Each conflict now carries the WHY — resource, counterpart task, working days
 * of delay, float available and consumed, and whether the finish moves — in
 * `detail`. Nothing renders it yet: utils/levelingSummary.ts rebuilds the shift
 * list from the id→day map and drops the conflicts, so
 * LevelingPreviewModal still shows a bare "Day X → Y". Both files are outside
 * this wave's scope; see the handoff note.
 */
function levelResources(ctx: LevelingContext): { leveled: Map<string, number>; conflicts: CpmConflict[] } {
  const conflicts: CpmConflict[] = [];
  const byIdTask = new Map(ctx.tasks.map(t => [t.id, t]));

  // Working copy in CALENDAR space. Seeded from the forward pass so levelling
  // reasons about where each task is actually SCHEDULED, not where it was pinned.
  const calStart = new Map<string, number>();
  for (const t of ctx.tasks) {
    calStart.set(
      t.id,
      ctx.forwardEs.get(t.id)
        ?? workingOrdinalToCalendarIndex(Math.max(1, t.startDay || 1), ctx.projectScale),
    );
  }
  const moved = new Set<string>();

  /** Calendar index of a task's finish, walking its own working calendar. */
  const calEndOf = (t: ScheduleTask, start: number): number => {
    const dur = Math.max(0, t.durationDays || 0);
    if (dur === 0) return start;
    const { wd, closures } = ctx.calendarForTask(t.id);
    if (!ctx.scheduleStart) return start + dur - 1;
    return isWorkingDay(start, wd, ctx.scheduleStart, closures)
      ? walkWorkingDays(start, dur - 1, 1, wd, ctx.scheduleStart, closures)
      : walkWorkingDays(start, dur, 1, wd, ctx.scheduleStart, closures);
  };

  /** First day AFTER `day` that `t`'s calendar will actually work. */
  const nextWorkingAfter = (t: ScheduleTask, day: number): number => {
    if (!ctx.scheduleStart) return day + 1;
    const { wd, closures } = ctx.calendarForTask(t.id);
    return walkWorkingDays(day, 1, 1, wd, ctx.scheduleStart, closures);
  };

  /** Signed working-day distance on `t`'s calendar. */
  const workingDelta = (t: ScheduleTask, from: number, to: number): number =>
    ctx.calendarForTask(t.id).countWorkingDays(from, to);

  // Group by resource. A task with several resources appears in several groups.
  const byResource = new Map<string, ScheduleTask[]>();
  for (const t of ctx.tasks) {
    for (const key of resourceKeys(t)) {
      if (!byResource.has(key)) byResource.set(key, []);
      byResource.get(key)!.push(t);
    }
  }

  for (const [resKey, group] of byResource.entries()) {
    if (group.length < 2) continue;

    // Sort by current scheduled start so we process calendar-left-to-right.
    const sorted = [...group].sort((a, b) => (calStart.get(a.id) ?? 1) - (calStart.get(b.id) ?? 1));

    // Sliding "busy until" cursor. When the next task would overlap, delay it.
    let busyUntil = -Infinity;
    let busyTaskId: string | null = null;

    for (const task of sorted) {
      const start = calStart.get(task.id)!;
      const end = calEndOf(task, start);

      if (start <= busyUntil) {
        // Conflict. Decide whether to delay THIS task or the already-scheduled
        // one, based on which has more float. More float → can afford delay.
        const prevFloat: number = ctx.cpm.get(busyTaskId!)?.totalFloat ?? 0;
        const curFloat: number = ctx.cpm.get(task.id)?.totalFloat ?? 0;

        const delayThis: boolean = curFloat >= prevFloat;
        const delayedTask: ScheduleTask | undefined = delayThis ? task : byIdTask.get(busyTaskId!);

        if (delayedTask) {
          const delayedId: string = delayedTask.id;
          const origStart = calStart.get(delayedId)!;
          const newStart = nextWorkingAfter(delayedTask, busyUntil);
          calStart.set(delayedId, newStart);
          moved.add(delayedId);
          const delayedFloat = delayThis ? curFloat : prevFloat;
          const delayDays = workingDelta(delayedTask, origStart, newStart);
          // Whether the delay pushes the END DATE, not whether the task merely
          // had no float to begin with. `delayedFloat <= 0` answered the wrong
          // question: a task with 2 days of float delayed 5 days moves the
          // finish, and the old test called that a routine overallocation.
          const projectImpact = delayDays > delayedFloat;

          conflicts.push({
            kind: projectImpact ? 'resource_delayed_project' : 'resource_overallocation',
            message: projectImpact
              ? `${delayedTask.title}: delayed ${delayDays} working day(s) to free up "${delayedTask.crew || delayedTask.assignedSubName || resKey.replace(/^(sub|crew|res):/, '')}" — that is more than its ${delayedFloat} day(s) of float, so the project end date moves.`
              : `${delayedTask.title}: delayed ${delayDays} working day(s) to free up "${delayedTask.crew || delayedTask.assignedSubName || resKey.replace(/^(sub|crew|res):/, '')}" (uses ${delayDays} of its ${delayedFloat} day(s) of float).`,
            taskIds: [delayedId, delayThis ? busyTaskId! : task.id],
            detail: {
              resource: resKey,
              // Reported on the STORED scale so the UI can render them the same
              // way it renders every other startDay.
              originalStart: calendarIndexToWorkingOrdinal(origStart, ctx.projectScale),
              newStart: calendarIndexToWorkingOrdinal(newStart, ctx.projectScale),
              originalStartCalendarIndex: origStart,
              newStartCalendarIndex: newStart,
              delayWorkingDays: delayDays,
              floatAvailable: delayedFloat,
              floatConsumed: Math.min(delayDays, Math.max(0, delayedFloat)),
              counterpartTaskId: delayThis ? busyTaskId! : task.id,
              counterpartTitle: byIdTask.get(delayThis ? busyTaskId! : task.id)?.title,
              pushesFinish: projectImpact,
            },
          });

          // Update busy cursor based on which ended up last.
          const newEnd = calEndOf(delayedTask, newStart);
          if (newEnd > busyUntil) {
            busyUntil = newEnd;
            busyTaskId = delayedId;
          }
          // If we delayed `prev`, `task` now owns the earlier slot.
          if (!delayThis) {
            busyUntil = end;
            busyTaskId = task.id;
          }
          continue;
        }
      }

      // No conflict, or we couldn't resolve it — this task takes the slot.
      if (end > busyUntil) {
        busyUntil = end;
        busyTaskId = task.id;
      }
    }
  }

  // Back to the stored WORKING-ordinal scale. Untouched tasks keep their exact
  // authored startDay — converting their (possibly dependency-pushed) scheduled
  // ES would register as a shift they never made.
  const leveled = new Map<string, number>();
  for (const t of ctx.tasks) {
    leveled.set(
      t.id,
      moved.has(t.id)
        ? calendarIndexToWorkingOrdinal(calStart.get(t.id)!, ctx.projectScale)
        : t.startDay,
    );
  }

  return { leveled, conflicts };
}

// ---------------------------------------------------------------------------
// One-call orchestration
// ---------------------------------------------------------------------------

/**
 * Per-task calendar resolver — mirror of the private caches inside
 * forwardPass/backwardPass, hoisted so runCpm, free float and levelling all
 * answer "which days can THIS task work?" the same way the passes did.
 */
interface ResolvedCalendar {
  wd: number;
  closures: Set<string>;
  /**
   * Signed working-day distance on THIS calendar, backed by an incremental
   * prefix table so it is O(1) amortised. Total float is `ls - es` counted in
   * working days, and on a wide-float import that span runs into the hundreds
   * — walking it per task made runCpm O(tasks x span). Same answers as
   * {@link workingDaysBetween}; §4 of validate-cpm asserts the agreement.
   */
  countWorkingDays: (from: number, to: number) => number;
}

function makeWorkingDayCounter(
  wd: number,
  closures: Set<string>,
  scheduleStart: string | undefined,
): (from: number, to: number) => number {
  if (!scheduleStart) return (from, to) => to - from;
  // prefix[d] = working days in the half-open interval (1, d]. prefix[1] = 0,
  // matching workingDaysBetween's "counts (min, max]" definition exactly.
  const prefix: number[] = [0, 0];
  const upTo = (d: number): number => {
    while (prefix.length <= d) {
      const idx = prefix.length;
      prefix.push(prefix[idx - 1] + (isWorkingDay(idx, wd, scheduleStart, closures) ? 1 : 0));
    }
    return prefix[d];
  };
  return (from, to) => {
    if (from === to) return 0;
    // Day indices BELOW 1 are real and they matter: the backward pass produces
    // a negative LS whenever a target finish or a hard pin makes the plan
    // impossible, and `ls - es` is then the negative total float that DCMA #7
    // and the whole "this schedule cannot be built" signal rest on. The prefix
    // table only covers d >= 1, and clamping the lower bound to 1 turned a
    // total float of -12 into -0 — which is not < 0, so the negative-float
    // check silently stopped firing (caught by validate-schedule-health #7).
    // Walk those; they are rare and always on a schedule that is already broken.
    if (from < 1 || to < 1) {
      return workingDaysBetweenOn(from, to, wd, scheduleStart, closures);
    }
    return (upTo(Math.max(from, to)) - upTo(Math.min(from, to))) * (to > from ? 1 : -1);
  };
}

function makeCalendarResolver(
  workingDaysPerWeek: number | undefined,
  nonWorkingDates: string[] | undefined,
  taskCalendars: Map<string, { workingDaysPerWeek: number; closures: string[] }> | undefined,
  scheduleStartDate: string | undefined,
): (taskId: string) => ResolvedCalendar {
  const wdPerWeek = workingDaysPerWeek ?? 7;
  const closuresSet = nonWorkingDates && nonWorkingDates.length > 0
    ? new Set(nonWorkingDates) : EMPTY_CLOSURES;
  const cache = new Map<string, ResolvedCalendar>();
  // One counter per distinct calendar, not per task: a 400-task schedule with
  // one shared calendar builds one prefix table, not 400.
  const counters = new Map<string, (from: number, to: number) => number>();
  const counterFor = (key: string, wd: number, closures: Set<string>) => {
    let c = counters.get(key);
    if (!c) { c = makeWorkingDayCounter(wd, closures, scheduleStartDate); counters.set(key, c); }
    return c;
  };
  const projectCal: ResolvedCalendar = {
    wd: wdPerWeek,
    closures: closuresSet,
    countWorkingDays: counterFor('@project', wdPerWeek, closuresSet),
  };
  return (taskId: string) => {
    const cached = cache.get(taskId);
    if (cached) return cached;
    const cal = taskCalendars?.get(taskId);
    let resolved: ResolvedCalendar;
    if (cal) {
      const closures = new Set(cal.closures);
      resolved = {
        wd: cal.workingDaysPerWeek,
        closures,
        countWorkingDays: counterFor(
          `${cal.workingDaysPerWeek}|${[...closures].sort().join(',')}`,
          cal.workingDaysPerWeek, closures,
        ),
      };
    } else {
      resolved = projectCal;
    }
    cache.set(taskId, resolved);
    return resolved;
  };
}

export function runCpm(tasks: ScheduleTask[], options: RunCpmOptions = {}): CpmResult {
  const conflicts: CpmConflict[] = [];
  const calendarForTask = makeCalendarResolver(
    options.workingDaysPerWeek, options.nonWorkingDates, options.taskCalendars,
    options.scheduleStartDate,
  );

  // 0. Links pointing at tasks that are not here. Reported, never repaired —
  // every pass below already ignores them, and this is the only thing that says
  // so out loud. Collected BEFORE the cycle bail-out so a schedule that has both
  // problems reports both.
  conflicts.push(...detectDanglingLinks(tasks));

  // 1. Cycle detection — bail early if found.
  const cycleConflicts = detectCycles(tasks);
  if (cycleConflicts.length > 0) {
    // Still return empty CPM so the UI can render the tasks; just flag it.
    return {
      perTask: new Map(),
      projectStart: 1,
      projectFinish: 1,
      criticalPath: [],
      // Cycle FIRST: GridPane's banner summarises `conflicts[0]`, and a cycle is
      // the one that stops the engine. The dangling report rides along behind it.
      conflicts: [...cycleConflicts, ...conflicts],
    };
  }

  // 2. Topo sort.
  const ordered = topoSort(tasks);

  // 3. Forward pass.
  const forward = forwardPass(
    ordered, tasks,
    options.scheduleStartDate, options.workingDaysPerWeek, options.nonWorkingDates,
    options.taskCalendars,
  );

  // 4. Project finish = max EF, unless caller pinned a target.
  let projectFinish = 1;
  forward.forEach(v => { if (v.ef > projectFinish) projectFinish = v.ef; });
  if (options.targetFinishDay && options.targetFinishDay > 0) {
    projectFinish = options.targetFinishDay;
  }

  // 5. Backward pass.
  const backward = backwardPass(
    ordered, tasks, forward, projectFinish,
    options.scheduleStartDate, options.workingDaysPerWeek, options.nonWorkingDates,
    options.taskCalendars,
  );

  // 6. Free float.
  const freeFloat = computeFreeFloat(tasks, forward, options.scheduleStartDate, calendarForTask);

  // 7. Assemble per-task results.
  const perTask = new Map<string, CpmTaskResult>();
  for (const task of tasks) {
    const fwd = forward.get(task.id);
    const bwd = backward.get(task.id);
    if (!fwd || !bwd) continue;
    // Total float in WORKING days on the task's own calendar. `bwd.ls - fwd.es`
    // subtracted two CALENDAR indices, so every weekend inside the float window
    // added two phantom days: a task that can really slide Thu→Wed on a Mon-Fri
    // week (4 working days of slack) reported 6. Three risk signals read this
    // number as if it were working days — floatExplain's "Can slip 6 days", the
    // grid's amber-under-3 colouring, and the criticalFloatThresholdDays chips —
    // and the error always ran toward promising MORE slack than exists, which is
    // the direction that puts a job late off a screen that said it was fine.
    const tf = calendarForTask(task.id).countWorkingDays(fwd.es, bwd.ls);
    const threshold = Math.max(0, options.criticalFloatThresholdDays ?? 0);
    perTask.set(task.id, {
      id: task.id,
      es: fwd.es,
      ef: fwd.ef,
      ls: bwd.ls,
      lf: bwd.lf,
      totalFloat: tf,
      freeFloat: freeFloat.get(task.id) ?? 0,
      isCritical: tf <= threshold,
    });
  }

  // 8. Critical path in topo order.
  const criticalPath = ordered
    .map(t => perTask.get(t.id))
    .filter((r): r is CpmTaskResult => !!r && r.isCritical)
    .map(r => r.id);

  // 8b. Anchor violations — a task whose computed ES/EF exceeds an upper
  // anchor bound (SNLT / FNLT / MSO / MFO drift) gets reported so the UI can
  // flag it with a warning glyph. This doesn't rewrite the schedule; it tells
  // the PM what to negotiate.
  //
  // HARD pins (must-start-on / must-finish-on) need the dependency-derived ES
  // the forward pass computed BEFORE it overwrote ES with the pin — `depEs`.
  // Testing `r.es !== clamp.esExact` compared the pin against itself, so the
  // must-start-on branch could never fire and the app scheduled a task INSIDE
  // its predecessor's span, called it critical with zero float, and reported
  // nothing. The only signal was negative float on the predecessor, which is
  // not where anyone looks.
  for (const task of tasks) {
    const clamp = computeAnchor(task, options.scheduleStartDate);
    const r = perTask.get(task.id);
    if (!clamp || !r) continue;
    const violations: string[] = [];
    if (clamp.esMax !== undefined && r.es > clamp.esMax) {
      violations.push(`start drifted past anchor by ${r.es - clamp.esMax}d`);
    }
    if (clamp.efMax !== undefined && r.ef > clamp.efMax) {
      violations.push(`finish drifted past anchor by ${r.ef - clamp.efMax}d`);
    }
    const fwdRow = forward.get(task.id);
    const { wd: aWd, closures: aClosures, countWorkingDays: workingGap } = calendarForTask(task.id);
    const anchorIsWorkingDay = (day: number): boolean => (
      !options.scheduleStartDate || isWorkingDay(day, aWd, options.scheduleStartDate, aClosures)
    );
    if (clamp.esExact !== undefined && fwdRow?.hasIncomingLink && fwdRow.depEs > clamp.esExact) {
      violations.push(
        `the work feeding it cannot start until ${workingGap(clamp.esExact, fwdRow.depEs)} working day(s) after the must-start-on date — the pin wins, so the plan shows work overlapping its own predecessors`,
      );
    }
    if (clamp.efExact !== undefined) {
      // THREE different things land here and they need different sentences.
      //
      // (a) The dependency-driven case, which is the one that actually hurts:
      //     the predecessors cannot deliver by the pinned finish, but the
      //     forward pass walks ES back FROM `efExact`, so `r.ef` is forced
      //     EQUAL to `efExact` and the old `r.ef !== clamp.efExact` test could
      //     never see it. Measured: P(10d) -> S(2d, must-finish-on Fri Mar 6)
      //     placed S at Mar 5-6, INSIDE P's Mar 2-13 span, and reported
      //     nothing at all. Compare the dependency-derived finish instead.
      // (b) An anchor date on a non-working day, where the walk-back /
      //     walk-forward round trip cannot return to a day the calendar
      //     refuses to work. The old message blamed "dependencies" for this,
      //     which was wrong — this was the ONLY case that could fire.
      // (c) Anything else that still lands off the anchor.
      if (fwdRow?.hasIncomingLink && fwdRow.depEf > clamp.efExact) {
        violations.push(
          `the work feeding it cannot finish until ${workingGap(clamp.efExact, fwdRow.depEf)} working day(s) after the must-finish-on date — the pin wins, so the plan shows work overlapping its own predecessors`,
        );
      } else if (r.ef !== clamp.efExact) {
        violations.push(
          !anchorIsWorkingDay(clamp.efExact)
            ? `the must-finish-on date is a non-working day on this task's calendar, so the finish lands ${Math.abs(r.ef - clamp.efExact)}d away`
            : `dependencies push finish off the must-finish-on anchor`,
        );
      }
    }
    if (violations.length > 0) {
      conflicts.push({
        kind: 'anchor_violation',
        message: `Anchor conflict on "${task.title}": ${violations.join('; ')}`,
        taskIds: [task.id],
        detail: { anchor: task.anchorType, anchorDate: task.anchorDate },
      });
    }
  }

  // 9. Optional resource leveling.
  let leveledStartDays: Map<string, number> | undefined;
  let leveledProjectFinish: number | undefined;
  if (options.levelResources) {
    const forwardEs = new Map<string, number>();
    forward.forEach((v, id) => forwardEs.set(id, v.es));
    const { leveled, conflicts: resConflicts } = levelResources({
      tasks,
      cpm: perTask,
      forwardEs,
      scheduleStart: options.scheduleStartDate,
      calendarForTask,
      projectScale: {
        workingDaysPerWeek: options.workingDaysPerWeek,
        scheduleStartDate: options.scheduleStartDate,
        nonWorkingDates: options.nonWorkingDates,
      },
    });
    leveledStartDays = leveled;
    conflicts.push(...resConflicts);

    // The finish AFTER levelling. `projectFinish` above is fixed at step 4 from
    // the UNLEVELLED forward pass, so `leveledResult.projectFinish -
    // cpm.projectFinish` was structurally zero for every possible input and the
    // "Fix overloads" preview printed "finish unchanged" in every case —
    // including the reproduced one where applying moved the finish from day 5
    // to day 19. Re-run the forward pass on the levelled startDays (which also
    // makes successors of a moved task ripple, since the engine treats startDay
    // as a floor) and report what actually happens.
    const relaid = tasks.map(t => {
      const next = leveled.get(t.id);
      return next !== undefined && next !== t.startDay ? { ...t, startDay: next } : t;
    });
    const reForward = forwardPass(
      topoSort(relaid), relaid,
      options.scheduleStartDate, options.workingDaysPerWeek, options.nonWorkingDates,
      options.taskCalendars,
    );
    let f = 1;
    reForward.forEach(v => { if (v.ef > f) f = v.ef; });
    leveledProjectFinish = f;
  }

  return {
    perTask,
    projectStart: 1,
    projectFinish,
    criticalPath,
    conflicts,
    leveledStartDays,
    leveledProjectFinish,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the UI layer
// ---------------------------------------------------------------------------

/**
 * Stamp the LIVE critical path onto `ScheduleTask.isCriticalPath`.
 *
 * Why this exists: `isCriticalPath` is a persisted field that six surfaces the
 * CLIENT sees read directly — the client portal (utils/portalSnapshot.ts), the
 * schedule PDF (utils/pdfGenerator.ts), the printable one-pager
 * (utils/printableGanttHtml.ts), the "On critical path" note in the calendar
 * invite (utils/icsGenerator.ts), and the AI's risk reasoning
 * (utils/oacEngine.ts, utils/aiService.ts). Nothing in the Pro scheduler ever
 * wrote it. It was set ONCE, at creation, by the AI schedule generator (whose
 * prompt literally asks the model to "mark tasks on the longest chain as
 * isCriticalPath: true") and by template seed code that hard-codes it — and
 * then never refreshed, however much the schedule changed afterwards.
 *
 * So on every surface a client, a sub or the AI saw, the "critical path" was a
 * language model's guess rather than the engine's answer. For a product whose
 * headline is real critical-path scheduling, that undercut the claim exactly
 * where it is sold.
 *
 * Returns a new array; tasks whose flag is already correct are returned by
 * reference so a caller diffing on identity sees no spurious change.
 */
export function stampCriticalPath(tasks: ScheduleTask[], cpm: CpmResult): ScheduleTask[] {
  // A CPM run that bailed on a cycle returns an empty perTask map. Stamping
  // from it would clear every flag on the schedule and tell the portal the job
  // has no critical path at all — leave the last known-good values alone.
  if (cpm.perTask.size === 0) return tasks;
  return tasks.map(t => {
    const next = cpm.perTask.get(t.id)?.isCritical;
    if (next === undefined || next === !!t.isCriticalPath) return t;
    return { ...t, isCriticalPath: next };
  });
}

/**
 * Human-readable float summary for the grid's Float column.
 *   0       → "Critical"
 *   n > 0   → "3d slack"
 *   n < 0   → "-2d behind"
 *
 * The "d" is a WORKING day on the task's own calendar — the unit a GC counts
 * crew days in. It used to be a raw calendar-index difference, so a task that
 * could really slide Thu→Wed on a Mon-Fri week printed "6d slack" against a
 * true 4, and the grid's amber-under-3 colouring stayed green on a task with
 * two real days of room. Both now read the same honest number.
 */
export function formatFloat(totalFloat: number): string {
  if (totalFloat === 0) return 'Critical';
  if (totalFloat < 0) return `${totalFloat}d behind`;
  return `${totalFloat}d slack`;
}

/**
 * Returns true iff `candidateDepId` being added as a predecessor to `taskId`
 * would create a cycle. The grid's dependency editor uses this to reject bad
 * links before committing — MS Project's #1 gap (per your spec: "intuitive UI
 * that prevents fatal logic errors").
 */
export function wouldCreateCycle(
  tasks: ScheduleTask[],
  taskId: string,
  candidateDepId: string,
): boolean {
  if (taskId === candidateDepId) return true;

  // DFS from candidateDepId chasing its own predecessors. If we reach taskId,
  // adding this edge closes a loop.
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Set<string>();
  const stack = [candidateDepId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const task = byId.get(cur);
    if (!task) continue;
    for (const link of getLinks(task)) stack.push(link.taskId);
  }
  return false;
}

/**
 * The one way a COMPONENT that holds `projectStartDate` as a `Date` should run
 * the engine.
 *
 * Why this exists rather than each pane calling `runCpm` itself: on 2026-09-11
 * an adversarial review found that `GridPane` computed `runCpm(tasks)` with NO
 * options while being handed `projectStartDate`, `workingDaysPerWeek` and
 * `nonWorkingDates` as props. In that raw-day mode es/ef come back as working
 * ordinals with no weekend expansion — and the grid then rendered them through
 * `calendarDayToDate`, which is a plain date add. Measured on A(10)->B(5)->C(5),
 * 5-day week, Mon 2026-03-02: the grid printed A Mar 2→Mar 11, B Mar 12→Mar 16,
 * C Mar 17→**Sat** Mar 21 against an engine that said Mar 13 / Mar 20 / Mar 27.
 * `workingDaysInSpan(es, ef)` was 8 / 3 / 4 for tasks of 10 / 5 / 5 days, so
 * "Start + Duration = Finish" failed on its face on every row.
 *
 * A grep-only guard cannot see that defect — the renderer call sites all read
 * `renderCalendarDate(cpmRow.es)` exactly as intended; it is the *engine run
 * behind `cpmRow`* that was wrong. Funnelling the composition through one
 * exported function means the guard can execute the real thing
 * (scripts/validate-cpm.ts §9) instead of grepping for an intention.
 *
 * Pass `extra` for the options a pane legitimately owns (criticalFloatThreshold,
 * per-task calendars, levelling). The three calendar fields are NOT overridable
 * — that is the whole point.
 */
export function runCpmForCalendar(
  tasks: ScheduleTask[],
  projectStartDate: Date,
  workingDaysPerWeek: number | undefined,
  nonWorkingDates: string[] | undefined,
  extra: Omit<RunCpmOptions, 'scheduleStartDate' | 'workingDaysPerWeek' | 'nonWorkingDates'> = {},
): CpmResult {
  return runCpm(tasks, {
    ...extra,
    scheduleStartDate: toCalendarDayString(projectStartDate),
    workingDaysPerWeek: workingDaysPerWeek ?? 5,
    nonWorkingDates: nonWorkingDates ?? [],
  });
}

// ───────────────────────────────────────────────────────────────────────────
// LEGACY DATA — the `rebaseRawToCalendar` population
// ───────────────────────────────────────────────────────────────────────────
//
// `utils/scheduleRebase.ts` shipped from 2026-07 to 2026-09-11. It fired the
// first time a start date was set on a schedule and rewrote every
// `task.startDay` from a WORKING ORDINAL to the CALENDAR INDEX of that
// ordinal's working day, then persisted the result through `updateProject`. It
// existed because the engine of the day read `startDay` as a calendar index at
// its `pins` line. The engine now CONVERTS there, so those rewritten rows are
// converted a second time and the plan inflates by the width of every weekend
// it already contained. Measured on A(10)->B(10)->C(5) authored at ordinals
// 1/11/21, 5-day week from Mon 2026-03-02: the authored 1/11/21 finishes on
// calendar index 33 (Fri Apr 3); the stored 1/15/29 finishes on 45
// (Wed Apr 15). Twelve days of silent inflation, in the data, not the display.
//
// The note that used to sit in the scale contract said the condition was
// undetectable. That was WRONG, and the reason is that the rebase left its own
// before-and-after pair on the task: it moved `startDay` and never touched
// `baselineStartDay` / `baselineEndDay`, which
// `scheduleAI.materializeGeneratedTasks` stamps EQUAL to `startDay` at
// authoring time (utils/scheduleAI.ts:701-702). So on a rebased task
// `startDay === workingOrdinalToCalendarIndex(baselineStartDay)` while on a
// never-rebased one `startDay === baselineStartDay` — and for any ordinal past
// the first weekend those two are mutually exclusive.
//
// TWO KNOWN BLIND SPOTS, both of which fail SAFE (the user is never asked, the
// data is never touched), and both worth knowing before someone widens this:
//
//  • A baseline CAPTURED AFTER the rebase destroys the pair.
//    `scheduleOps.saveBaseline` records `t.startDay` and `applyBaselineToTasks`
//    writes it back to `baselineStartDay`, so on a re-baselined legacy schedule
//    `startDay === baselineStartDay` again and that row reads as ORDINAL
//    evidence. The verdict then falls to `indeterminate` (ordinal and calendar
//    evidence disagreeing) or to `workingOrdinal`, and nothing is offered. The
//    plan stays inflated and the remedy is a manual re-anchor.
//  • A schedule with only ONE discriminating row is refused on purpose — see
//    `corroboratingTaskCount`. One row is indistinguishable from one slipped
//    task, and reverting a real slip is worse than leaving two days on a
//    two-task plan.
//
// It is still EVIDENCE, not proof, so nothing in this file converts data on its
// own and nothing runs at load. `detectStartDayBasis` classifies; a one-time
// disclosure (`components/schedule/StartDayBasisNotice.tsx`) puts the measured
// before/after finish in front of the user; their answer is persisted as
// `ProjectSchedule.startDayBasis`, which is what makes the migration one-shot.
// A wrong automatic migration is worse than an explicit one.

/** Scale the stored `ScheduleTask.startDay` values of one schedule are on. */
export type StartDayBasis = 'workingOrdinal' | 'calendarIndex';

export interface StartDayBasisReport {
  /**
   * `workingOrdinal`  — the stored numbers are on the scale the engine expects,
   *                     or converting them would move nothing.
   * `calendarIndex`   — every discriminating row says a pre-fix build rewrote
   *                     them, and none says otherwise.
   * `indeterminate`   — the signals disagree, some row cannot be read either
   *                     way, or this data carries no signal at all.
   */
  verdict: StartDayBasis | 'indeterminate';
  /**
   * True when the two scales are the same numbers for this calendar — no
   * anchor, or a 7-day week with no closures. The question is then moot.
   */
  scalesCoincide: boolean;
  /** Signals that say "these are ordinals", in the user's own task names. */
  ordinalEvidence: string[];
  /** Signals that say "these are calendar indices". */
  calendarEvidence: string[];
  /**
   * Titles of tasks that HAD a discriminating signal available and matched
   * neither reading — a row edited since the re-anchor, most likely. Their
   * presence forces `indeterminate`, because a schedule that cannot be read
   * end-to-end cannot be converted end-to-end. Named so the notice can list
   * them and the user can check those rows by hand.
   */
  unexplainedTitles: string[];
  /** How many tasks a remap would move. Zero ⇒ the question does not matter. */
  wouldRemapTaskCount: number;
  /**
   * How many DISTINCT tasks produced calendar evidence. The verdict needs two.
   *
   * `rebaseRawToCalendar` was a whole-schedule rewrite — it mapped every task
   * in one pass — so a genuinely rebased plan corroborates itself from several
   * rows. ONE row does not: a task that slipped from its baseline by exactly
   * the weekend it spans is byte-identical to a rebased row, and I measured
   * that shape asking for a re-anchor it must not get (a two-task plan,
   * baselines 1 and 6, the second slipped to day 8 — one calendar-evidence row,
   * two days of "inflation" that were a real slip). Accepting there would have
   * silently reverted the slip. Two independent rows is the cheapest rule that
   * separates the two, and the schedules it declines are the smallest ones,
   * where the error is smallest.
   */
  corroboratingTaskCount: number;
}

/**
 * Classify which scale one schedule's stored `startDay` values are on.
 *
 * PURE and CHEAP — O(tasks), no `runCpm` — so a screen may call it on every
 * render. Three independent signals, and the conservative answer wins:
 *
 *  1. VETO. Every value the rebase could produce is the index of a WORKING day.
 *     A `startDay > 1` that lands on a weekend or a closure cannot have come
 *     from it, so it is ordinal evidence.
 *  2. BASELINE PAIR (decisive). See the note above.
 *  3. CHAIN GAP. `scheduleEngine.recalculateStartDays` and
 *     `scheduleAI.materializeGeneratedTasks` both chain an FS+0 successor at
 *     `pred.startDay + pred.durationDays` exactly — contiguous on the ordinal
 *     scale. The calendar reading of the same link lands on the first working
 *     day after the predecessor's calendar EF, which is strictly later whenever
 *     the predecessor spans a weekend. Where those two differ, whichever the
 *     stored value matches is evidence for that scale; matching NEITHER is an
 *     unexplained row.
 *
 * A `calendarIndex` verdict additionally needs TWO distinct corroborating rows
 * (see `corroboratingTaskCount`); one is a slip, not a rewrite. Any unexplained
 * row, or any ordinal evidence at all, forces `indeterminate` and the caller
 * offers nothing.
 */
export function detectStartDayBasis(
  tasks: readonly ScheduleTask[],
  opts: DayScaleOptions = {},
): StartDayBasisReport {
  const wd = opts.workingDaysPerWeek ?? 7;
  const closures = new Set(opts.nonWorkingDates ?? []);
  const scalesCoincide = !opts.scheduleStartDate || (wd >= 7 && closures.size === 0);
  const base: StartDayBasisReport = {
    verdict: 'workingOrdinal',
    scalesCoincide,
    ordinalEvidence: [],
    calendarEvidence: [],
    unexplainedTitles: [],
    wouldRemapTaskCount: 0,
    corroboratingTaskCount: 0,
  };
  if (scalesCoincide) {
    return {
      ...base,
      ordinalEvidence: [
        wd >= 7
          ? 'A 7-day week with no closures — the working and calendar scales are the same numbers here.'
          : 'No start date — the engine runs in raw-day mode, where the two scales are the same numbers.',
      ],
    };
  }
  if (tasks.length === 0) return base;

  const start = opts.scheduleStartDate!;
  const ordinalToIndex = makeOrdinalIndexer(opts);
  const dayOf = (t: ScheduleTask) => Math.max(1, Math.round(t.startDay || 1));

  // Answer the cheap question first: if converting moves nothing, the label is
  // immaterial and there is no migration to offer.
  let wouldRemapTaskCount = 0;
  for (const t of tasks) {
    const d = dayOf(t);
    if (calendarIndexToWorkingOrdinal(d, opts) !== d) wouldRemapTaskCount++;
  }
  if (wouldRemapTaskCount === 0) {
    return {
      ...base,
      ordinalEvidence: ['Every stored day is the same number on both scales — there is nothing to convert.'],
    };
  }

  const byId = new Map(tasks.map(t => [t.id, t]));
  const ordinalEvidence: string[] = [];
  const calendarEvidence: string[] = [];
  const unexplained = new Set<string>();
  // Task ids, not evidence lines: the baseline pair and the chain gap can both
  // fire on the same row, and one row corroborating itself twice is still one
  // row. See StartDayBasisReport.corroboratingTaskCount.
  const corroborating = new Set<string>();

  // ── 1. Veto ───────────────────────────────────────────────────────────────
  for (const t of tasks) {
    const d = dayOf(t);
    if (d > 1 && !isWorkingDay(d, wd, start, closures)) {
      ordinalEvidence.push(
        `"${t.title}" starts on day ${d}, a non-working day on this calendar — no re-anchor could have produced it.`,
      );
      break;
    }
  }

  // ── 2. Baseline pair ──────────────────────────────────────────────────────
  for (const t of tasks) {
    const bsd = t.baselineStartDay;
    if (bsd == null || !Number.isFinite(bsd) || bsd < 1) continue;
    const ord = Math.max(1, Math.round(bsd));
    const mapped = ordinalToIndex(ord);
    if (mapped === ord) continue; // before the first weekend — says nothing
    const d = dayOf(t);
    if (d === ord) {
      ordinalEvidence.push(
        `"${t.title}" still starts on its own baseline day ${ord}; a re-anchor would have moved it to ${mapped}.`,
      );
    } else if (d === mapped) {
      calendarEvidence.push(
        `"${t.title}" starts on day ${d}, exactly the calendar day of its baseline working day ${ord}.`,
      );
      corroborating.add(t.id);
    } else {
      unexplained.add(t.title);
    }
  }

  // ── 3. Chain gap ──────────────────────────────────────────────────────────
  for (const t of tasks) {
    const links = getLinks(t);
    if (links.length !== 1) continue;
    const link = links[0];
    if ((link.type ?? 'FS') !== 'FS' || (link.lagDays ?? 0) !== 0) continue;
    const pred = byId.get(link.taskId);
    if (!pred) continue;
    const predDur = Math.max(0, Math.round(pred.durationDays || 0));
    if (predDur < 1) continue;
    const predDay = dayOf(pred);
    const ordinalExpectation = predDay + predDur;
    const predEf = isWorkingDay(predDay, wd, start, closures)
      ? walkWorkingDays(predDay, predDur - 1, 1, wd, start, closures)
      : walkWorkingDays(predDay, predDur, 1, wd, start, closures);
    const calendarExpectation = walkWorkingDays(predEf, 1, 1, wd, start, closures);
    if (calendarExpectation === ordinalExpectation) continue; // uninformative
    const d = dayOf(t);
    if (d === ordinalExpectation) {
      ordinalEvidence.push(
        `"${t.title}" starts the working day after "${pred.title}" (day ${ordinalExpectation}), not the calendar day after it (day ${calendarExpectation}).`,
      );
    } else if (d === calendarExpectation) {
      calendarEvidence.push(
        `"${t.title}" starts on day ${calendarExpectation}, the day after "${pred.title}" ends on the calendar — ${calendarExpectation - ordinalExpectation} day(s) past its working-day slot.`,
      );
      corroborating.add(t.id);
    } else {
      unexplained.add(t.title);
    }
  }

  const unexplainedTitles = [...unexplained];
  const corroboratingTaskCount = corroborating.size;
  let verdict: StartDayBasisReport['verdict'] = 'indeterminate';
  if (unexplainedTitles.length === 0) {
    // `calendarIndex` needs TWO independent rows — see corroboratingTaskCount.
    // `workingOrdinal` needs one, deliberately: it is the reading the engine
    // already applies, so it asserts nothing new and licenses no rewrite.
    if (corroboratingTaskCount >= 2 && ordinalEvidence.length === 0) verdict = 'calendarIndex';
    else if (ordinalEvidence.length > 0 && calendarEvidence.length === 0) verdict = 'workingOrdinal';
  }

  return {
    verdict,
    scalesCoincide,
    ordinalEvidence,
    calendarEvidence,
    unexplainedTitles,
    wouldRemapTaskCount,
    corroboratingTaskCount,
  };
}

/**
 * Undo a `rebaseRawToCalendar` pass: CALENDAR INDEX → WORKING ORDINAL on
 * `startDay`, and on `startDay` ONLY.
 *
 * NOT IDEMPOTENT as arithmetic — running it on data that is already on the
 * working scale SHORTENS the plan, which is the exact mirror of the bug it
 * repairs. Two things stop that:
 *
 *  • `report` is REQUIRED, and anything short of a `calendarIndex` VERDICT
 *    returns the input array by reference, untouched — not merely "some
 *    calendar evidence", which one weekend-exact slip can manufacture. You
 *    cannot call this without having classified the data first.
 *  • The caller persists `ProjectSchedule.startDayBasis = 'workingOrdinal'`
 *    with the result, and a schedule carrying that flag is never offered the
 *    migration again. That flag — not this function — is what makes the
 *    migration one-shot.
 *
 * The TASK-LEVEL `baselineStartDay`, `baselineEndDay`, `actualStartDay` and
 * `actualEndDay` are deliberately left alone. The rebase never touched them (it
 * returned `{ ...t, startDay: mapped }` — utils/scheduleRebase.ts as of
 * 172a1e6a^), so they are still the working ordinals the scale contract
 * documents. Remapping them would destroy the pair this migration is detected
 * by and would drag the baseline ghost off the plan it was captured against.
 *
 * THAT REASONING DOES NOT EXTEND TO THE SCHEDULE-LEVEL SNAPSHOTS, and an
 * earlier version of this note claimed it did. `ProjectSchedule.baseline` and
 * `ProjectSchedule.baselines[]` are captured from `t.startDay` AT CAPTURE TIME
 * (`scheduleEngine.saveBaseline`, `scheduleOps.captureBaseline`). A snapshot
 * taken while the schedule sat on the calendar-index scale therefore holds
 * calendar indices, and moving `startDay` underneath it leaves the ghost on the
 * old scale — silent phantom variance on every row, for as long as the snapshot
 * lives. This function cannot see those snapshots; the ANSWER path handles them
 * ({@link remapCapturedBaselineDays}, wired through
 * {@link startDayBasisAnswerPatch}), and it only touches a snapshot row whose
 * stored day still matches the task's, so a snapshot captured BEFORE the rebase
 * is left exactly where it is.
 *
 * Returns the SAME array reference when nothing moves, so an undo-aware
 * `commit()` treats a no-op as a no-op.
 */
export function remapCalendarIndexStartDaysToWorkingOrdinals(
  tasks: readonly ScheduleTask[],
  opts: DayScaleOptions,
  report: StartDayBasisReport,
): ScheduleTask[] {
  if (report.verdict !== 'calendarIndex') return tasks as ScheduleTask[];
  let changed = false;
  const next = tasks.map(t => {
    const d = Math.max(1, Math.round(t.startDay || 1));
    const ordinal = calendarIndexToWorkingOrdinal(d, opts);
    if (ordinal === t.startDay) return t;
    changed = true;
    return { ...t, startDay: ordinal };
  });
  return changed ? next : (tasks as ScheduleTask[]);
}

/**
 * The whole legacy-scale decision for ONE schedule, in one pure function, so
 * the screens carry no policy and a guard can execute the real thing rather
 * than grep for it.
 *
 * `shouldAsk` is false unless ALL of these hold:
 *
 *   • the schedule has never answered the question (`startDayBasis` absent);
 *   • TWO independent rows are positive evidence of a pre-fix re-anchor;
 *   • no row contradicts them and no row is unreadable (`verdict` is
 *     `calendarIndex`);
 *   • the remap actually moves a row, AND
 *   • the remapped plan finishes EARLIER — the symptom the bug produces.
 *
 * Only the last of those costs anything: the first four are O(tasks) and the
 * function returns before the engine runs at all unless they hold. When it does
 * run the engine it runs it twice (as stored, and as remapped), because the only
 * honest case for asking is a measured one — the user cannot check a scale, but
 * they can check a finish date. Memoise it on the schedule in a component.
 */
export interface StartDayBasisMigrationPreview {
  report: StartDayBasisReport;
  /** Ask the user. False for every schedule that is fine or unreadable. */
  shouldAsk: boolean;
  /**
   * Whether the three finish-day numbers below were actually computed. False
   * on the early-out path (already answered, or not classified as legacy), and
   * they are all 0 there — 0 is "not measured", never "measured as zero".
   */
  measured: boolean;
  /** Engine project-finish (calendar index) on the data exactly as stored. */
  storedFinishDay: number;
  /** Engine project-finish after the remap. */
  remappedFinishDay: number;
  /** storedFinishDay − remappedFinishDay. Positive = the plan reads long. */
  inflationDays: number;
  /** The tasks to persist if the user accepts. Same ref as input if no change. */
  remappedTasks: ScheduleTask[];
  /**
   * Every row the answer would move, with BOTH readings of its start day.
   *
   * This is what the notice puts in front of the user, and it is the whole
   * reason the notice is allowed to ask at all. The detector cannot prove a
   * re-anchor — a task that slipped from its baseline by exactly the weekend it
   * spans is byte-identical to a re-anchored row, at any row count (measured;
   * see the two-row fixture in scripts/validate-startdate-rebase.ts). What the
   * user CAN settle is a date: "Signage currently starts Mon Mar 9; the other
   * reading starts it Mon Mar 2 — which is right?" So the offer states the
   * measurement and names the rows, and never states the cause.
   *
   * Empty on the early-out path, exactly like the finish numbers.
   */
  affectedRows: StartDayBasisAffectedRow[];
}

/** One row a `startDayBasis` answer would move, in both readings. */
export interface StartDayBasisAffectedRow {
  id: string;
  title: string;
  /** `startDay` as stored today. */
  storedDay: number;
  /** `startDay` after the remap. Always < storedDay. */
  remappedDay: number;
}

export function previewStartDayBasisMigration(schedule: {
  tasks: ScheduleTask[];
  startDate?: string;
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  startDayBasis?: 'workingOrdinal';
}): StartDayBasisMigrationPreview {
  const scale: DayScaleOptions = {
    scheduleStartDate: schedule.startDate,
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    nonWorkingDates: schedule.nonWorkingDates,
  };
  const tasks = schedule.tasks ?? [];
  const report = detectStartDayBasis(tasks, scale);
  const remappedTasks = remapCalendarIndexStartDaysToWorkingOrdinals(tasks, scale, report);
  // BAIL BEFORE THE ENGINE. Three screens call this on every schedule change
  // and almost every schedule in the world takes this branch, so the two CPM
  // runs below must not be the price of asking a question whose answer is
  // already no. Nothing downstream is lost: every one of these conditions
  // independently forces `shouldAsk` false, and the classification — the part
  // a diagnostic wants — is in `report` either way.
  if (schedule.startDayBasis || report.verdict !== 'calendarIndex' || remappedTasks === tasks) {
    return {
      report, shouldAsk: false, measured: false,
      storedFinishDay: 0, remappedFinishDay: 0, inflationDays: 0,
      remappedTasks: tasks, affectedRows: [],
    };
  }
  const runOpts = {
    scheduleStartDate: schedule.startDate,
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    nonWorkingDates: schedule.nonWorkingDates,
  };
  const storedFinishDay = runCpm(tasks, runOpts).projectFinish;
  const remappedFinishDay = runCpm(remappedTasks, runOpts).projectFinish;
  const inflationDays = storedFinishDay - remappedFinishDay;
  const affectedRows: StartDayBasisAffectedRow[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const stored = tasks[i];
    const next = remappedTasks[i];
    if (!next || next.startDay === stored.startDay) continue;
    affectedRows.push({
      id: stored.id,
      title: stored.title,
      storedDay: Math.max(1, Math.round(stored.startDay || 1)),
      remappedDay: Math.max(1, Math.round(next.startDay || 1)),
    });
  }
  return {
    report,
    // The last gate, and the only one the user can check: the plan must read
    // LONGER than the remapped plan. A rebased row that carries float moves its
    // own dates but not the project's, and the notice speaks only about the
    // finish date, so it stays silent there rather than quote a zero-day saving.
    shouldAsk: inflationDays > 0,
    measured: true,
    storedFinishDay, remappedFinishDay, inflationDays, remappedTasks, affectedRows,
  };
}

/**
 * The fields a screen writes when the user answers `StartDayBasisNotice` —
 * the whole policy, in one pure function, so the three surfaces that mount the
 * notice carry none of it and a guard can EXECUTE the answer instead of
 * grepping for the string `startDayBasis` in a .tsx file.
 *
 * Spread it into the schedule record:
 *
 *   updateProject(id, { schedule: { ...existing, ...startDayBasisAnswerPatch(preview, accept) } })
 *
 * Three properties it holds, all of them asserted by executing it:
 *
 *  • DECLINING TOUCHES NO TASK. The patch has no `tasks` key at all, so the
 *    spread cannot overwrite the stored plan with a stale copy.
 *  • BOTH ANSWERS STAMP THE FLAG. Declining is a real answer — "these numbers
 *    are the plan I want" — and it is what stops the question coming back.
 *  • ACCEPTING IS GATED ON THE PREVIEW, not on the caller. A patch built from a
 *    preview that says `shouldAsk: false` never moves a task, whatever the
 *    button passed, so a stale memo or a double-tap after the first write
 *    cannot re-run a remap on already-remapped data and shorten the plan.
 */
export function startDayBasisAnswerPatch<
  B extends CapturedBaselineLike,
  N extends CapturedBaselineLike,
>(
  preview: StartDayBasisMigrationPreview,
  accept: boolean,
  /**
   * The schedule's captured baseline snapshots, if it has any. Supplying them
   * is what keeps the baseline ghost on the plan it was captured against — see
   * {@link remapCapturedBaselineDays}. Omitting them is safe and simply leaves
   * the snapshots out of the patch.
   */
  snapshots?: { baseline?: B | null; baselines?: N[] | null },
): {
  tasks?: ScheduleTask[];
  startDayBasis: 'workingOrdinal';
  totalDurationDays?: number;
  criticalPathDays?: number;
  baseline?: B | null;
  baselines?: N[];
} {
  if (!accept || !preview.shouldAsk) return { startDayBasis: 'workingOrdinal' };
  const baseline = snapshots?.baseline
    ? remapCapturedBaselineDays(snapshots.baseline, preview.affectedRows)
    : undefined;
  const baselines = snapshots?.baselines
    ? snapshots.baselines.map(b => remapCapturedBaselineDays(b, preview.affectedRows))
    : undefined;
  return {
    tasks: preview.remappedTasks,
    startDayBasis: 'workingOrdinal',
    // The stored scalars were computed from the inflated plan; leaving them
    // behind would show the old finish on every card that reads them instead of
    // running the engine.
    totalDurationDays: preview.remappedFinishDay,
    criticalPathDays: preview.remappedFinishDay,
    // Only present when something actually moved — an absent key cannot clobber
    // the stored snapshot on the spread.
    ...(baseline && baseline !== snapshots?.baseline ? { baseline } : {}),
    ...(baselines && baselines.some((b, i) => b !== snapshots!.baselines![i]) ? { baselines } : {}),
  };
}

/** The shape of `ProjectSchedule.baseline` and of one `baselines[]` entry. */
export interface CapturedBaselineLike {
  tasks: { id: string; startDay: number; endDay: number }[];
}

/**
 * Move a captured baseline snapshot onto the same scale the tasks just moved to.
 *
 * `scheduleEngine.saveBaseline` and `scheduleOps.captureBaseline` both record
 * `t.startDay` as it stood when the user pressed the button, so a snapshot taken
 * on a legacy (calendar-index) schedule holds calendar indices. Remapping the
 * tasks and not the snapshot leaves the Gantt's baseline ghost and every
 * variance number two days per weekend adrift — silently, and permanently.
 *
 * TWO RULES, both of which make this safe to run unconditionally:
 *
 *  • A row is touched ONLY when its recorded `startDay` still equals the task's
 *    STORED day. That is the proof the snapshot was captured on the scale we are
 *    leaving. A snapshot captured before the rebase (working ordinals) matches
 *    nothing and comes back untouched, which is correct — it was already right.
 *  • `endDay` is shifted by the SAME delta rather than re-derived. Its scale is
 *    not knowable here (`saveBaseline` stores `startDay + durationDays`, which
 *    is neither reading cleanly), so the span is preserved rather than guessed.
 *
 * Returns the same reference when nothing moves.
 */
export function remapCapturedBaselineDays<T extends CapturedBaselineLike>(
  snapshot: T,
  affectedRows: readonly StartDayBasisAffectedRow[],
): T {
  if (affectedRows.length === 0 || !Array.isArray(snapshot?.tasks)) return snapshot;
  const byId = new Map(affectedRows.map(r => [r.id, r]));
  let changed = false;
  const tasks = snapshot.tasks.map(bt => {
    const row = byId.get(bt.id);
    if (!row || bt.startDay !== row.storedDay) return bt;
    const delta = row.remappedDay - row.storedDay;
    if (delta === 0) return bt;
    changed = true;
    return { ...bt, startDay: bt.startDay + delta, endDay: bt.endDay + delta };
  });
  return changed ? { ...snapshot, tasks } : snapshot;
}

/** Which button the user pressed on `StartDayBasisNotice`. */
export type StartDayBasisChoice = 'keep' | 'reAnchor';

export interface StartDayBasisNoticeAction {
  key: StartDayBasisChoice;
  /** The boolean this button MUST hand to {@link startDayBasisAnswerPatch}. */
  accept: boolean;
  testID: string;
}

export interface StartDayBasisNoticeModel {
  /** Whether the notice renders at all. */
  visible: boolean;
  /** The rows to name, with both readings. Empty when hidden. */
  rows: StartDayBasisAffectedRow[];
  /** In render order: decline first, then accept. Empty when hidden. */
  actions: StartDayBasisNoticeAction[];
}

/**
 * Everything about the notice that is a DECISION rather than a layout, in one
 * pure function — so a guard can execute the binding between a button and the
 * answer it sends instead of grepping a .tsx for `onReAnchor={...}`.
 *
 * That grep is not a hypothetical weakness. Rewiring the accept button to send
 * `false` passed the old §4 checks at 88/0: it stamps the flag, retires the
 * one-shot offer for good, and leaves the plan inflated while the user believes
 * they just fixed it. The button→boolean binding is now data on this object,
 * the component maps over it, and the guard asserts the values.
 */
export function startDayBasisNoticeModel(
  preview: StartDayBasisMigrationPreview,
): StartDayBasisNoticeModel {
  if (!preview.shouldAsk) return { visible: false, rows: [], actions: [] };
  return {
    visible: true,
    rows: preview.affectedRows,
    actions: [
      { key: 'keep', accept: false, testID: 'schedule-startday-basis-keep' },
      { key: 'reAnchor', accept: true, testID: 'schedule-startday-basis-accept' },
    ],
  };
}
