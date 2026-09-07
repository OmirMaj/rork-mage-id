// scheduleOps.ts — higher-level operations on a schedule: reflow from
// actuals, named baselines, CSV export, share-link encode/decode.
//
// Keep each op pure (input → output). The caller commits via their own
// state manager / persist layer.

import type { ScheduleTask, ScheduleBaseline } from '@/types';
import { runCpm, type RunCpmOptions } from '@/utils/cpm';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

// ---------------------------------------------------------------------------
// 0) Which schedule day is a given calendar date?
// ---------------------------------------------------------------------------
// The exact inverse of scheduleEngine.getTaskDateRange (start =
// addWorkingDays(startDate, startDay - 1)): 1-indexed, day 1 = the schedule's
// start day, a date on/before the start is day 1, and weekends / site
// closures are skipped exactly as addWorkingDays skips them. Audit UX-F1: the
// daily report counted raw elapsed milliseconds instead.

export function scheduleDayNumberFor(
  start: Date,
  target: Date,
  workingDaysPerWeek: number = 5,
  nonWorkingDates?: string[],
): number {
  const base = new Date(start.getTime());
  base.setHours(0, 0, 0, 0);
  const tgt = new Date(target.getTime());
  tgt.setHours(0, 0, 0, 0);
  if (tgt.getTime() <= base.getTime()) return 1;
  const blocked = nonWorkingDates && nonWorkingDates.length > 0 ? new Set(nonWorkingDates) : null;
  let count = 1;
  const cur = new Date(base.getTime());
  while (cur < tgt) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (workingDaysPerWeek < 7 && (dow === 0 || dow === 6)) continue;
    if (blocked && blocked.has(toCalendarDayString(cur))) continue;
    count++;
  }
  return count;
}

/**
 * The `startDay` a task PICKED to start on `target` gets. scheduleDayNumberFor
 * answers "which day is this date" and treats a closed day (weekend, site
 * closure) as still belonging to the working day before it — right for "today
 * on site", wrong for a start date: a task the user put on Saturday must start
 * the next working day, not roll back to Friday (B4 review A9; MS Project does
 * the same). A target on/before the anchor is day 1.
 */
export function startDayNumberFor(
  start: Date,
  target: Date,
  workingDaysPerWeek: number = 5,
  nonWorkingDates?: string[],
): number {
  const n = scheduleDayNumberFor(start, target, workingDaysPerWeek, nonWorkingDates);
  const onOrBefore = addWorkingDays(start, n - 1, workingDaysPerWeek, nonWorkingDates);
  const tgt = new Date(target.getTime());
  tgt.setHours(0, 0, 0, 0);
  return onOrBefore.getTime() < tgt.getTime() ? n + 1 : n;
}

/**
 * MEMBERSHIP: which schedule day IS this calendar day — or null when the day
 * is not a day of this schedule at all.
 *
 * The exact inverse of `addWorkingDays(anchor, n - 1)`: it returns `n` only
 * when the schedule really does land on `target`, so
 *   - a date strictly BEFORE the anchor  → null (the job has not started)
 *   - a weekend / site closure           → null (nobody is on site)
 *   - the anchor itself                  → 1, even when the user anchored on a
 *                                          Saturday (addWorkingDays(start, 0)
 *                                          is `start`, so day 1 is that day)
 *
 * NOT interchangeable with `scheduleDayNumberFor`, whose two clamps exist for
 * a different question ("what working day is the job on today?"): it answers 1
 * for every date at or before the anchor and folds a closed day back onto the
 * working day before it. Used as a membership test those clamps INVENT work —
 * every task starting on day 1 is reported as on site on every calendar day
 * before the job breaks ground, and a 0-day milestone fires once per day from
 * Monday through its Thursday anchor. Ask the membership question with this
 * function and the "which day are we on" question with the other one.
 */
export function scheduleDayOnCalendar(
  start: Date,
  target: Date,
  workingDaysPerWeek: number = 5,
  nonWorkingDates?: string[],
): number | null {
  const base = new Date(start.getTime());
  base.setHours(0, 0, 0, 0);
  const tgt = new Date(target.getTime());
  tgt.setHours(0, 0, 0, 0);
  if (tgt.getTime() < base.getTime()) return null;
  const n = scheduleDayNumberFor(base, tgt, workingDaysPerWeek, nonWorkingDates);
  const landsOn = addWorkingDays(base, n - 1, workingDaysPerWeek, nonWorkingDates);
  landsOn.setHours(0, 0, 0, 0);
  return landsOn.getTime() === tgt.getTime() ? n : null;
}

/**
 * The calendar days a task occupies: scheduleEngine.getTaskDateRange with site
 * closures honoured (that signature predates `nonWorkingDates`). `start` is
 * the parsed schedule anchor (parseCalendarDay(schedule.startDate)); startDay
 * is 1-indexed and in WORKING days — the mobile list/gantt/month sheet used to
 * multiply it by 86 400 000 instead, drawing a startDay-6 task on the Saturday
 * five calendar days after a Monday anchor rather than the next Monday (B4
 * review A9). Milestones (0 days) end on their start day.
 */
export function taskCalendarRange(
  task: Pick<ScheduleTask, 'startDay' | 'durationDays'>,
  start: Date,
  workingDaysPerWeek: number = 5,
  nonWorkingDates?: string[],
): { start: Date; end: Date } {
  const s = addWorkingDays(start, Math.max(0, (task.startDay ?? 1) - 1), workingDaysPerWeek, nonWorkingDates);
  const e = addWorkingDays(s, Math.max(0, (task.durationDays || 1) - 1), workingDaysPerWeek, nonWorkingDates);
  return { start: s, end: e };
}

// ---------------------------------------------------------------------------
// 0b) THE anchor rule — one resolution, called by every surface
// ---------------------------------------------------------------------------
// `ProjectSchedule.startDate` is OPTIONAL, and 2 of the 3 real schedules in
// production have never carried one (The Henderson Residence — 20 tasks, 20
// open; Watermark 9F — 19 tasks, 15 open; both in_progress, re-verified
// read-only 2026-09-06). Before this helper existed, five surfaces invented
// five DIFFERENT anchors for that one missing field:
//
//   MobileScheduleScreen    todayCalendarDay()  every task date moved forward
//                                               one day, every day
//   app/(tabs)/schedule     new Date()          the same drift on desktop
//   utils/icsGenerator      todayIso()          wrote the drifting dates into
//                                               the GC's real calendar
//   utils/summaryBriefing   project.createdAt   "Nothing scheduled today" and
//                                               "No scheduled work this week"
//                                               on a job with 20 open tasks
//   construction-ai         the UTC day         a fifth answer again
//
// Two of them contradicted each other on the same morning: the Schedule tab
// drew Henderson starting TODAY while the Summary briefing reported an empty
// day AND an empty week for it, with "schedule at risk (health 55)" two cards
// below (runtime audit SCHED-NO-ANCHOR + MISS-01).
//
// THE RULE: THERE IS NO FALLBACK ANCHOR. An undated schedule has real
// WORKING-DAY numbers (startDay 1..n, durations in working days) and no
// calendar position whatsoever. A surface that prints dates must either print
// the day numbers instead (taskWorkingDayLabel) or say the schedule is undated
// and offer to set a start date — it must never substitute a date the user did
// not choose, because a date that silently moves is worse than a missing one.
//
// `unanchoredPreviewDate` is the ONE escape hatch, for surfaces that draw a
// purely RELATIVE picture (a gantt's column grid) and cannot render at all
// without some origin. Anything that reads it must render
// UNDATED_SCHEDULE_TITLE or UNDATED_SCHEDULE_PREVIEW_NOTE beside it — the
// "the preview discloses itself" section of
// scripts/validate-schedule-date-basis.ts sweeps every source file for
// `unanchoredPreview` and fails the build on one that names neither.

/** Anything carrying a schedule's optional anchor (ProjectSchedule, a draft). */
export interface ScheduleAnchorSource {
  startDate?: string | null;
}

export interface ResolvedScheduleAnchor {
  /** The schedule's own calendar day ('YYYY-MM-DD'), or null when undated. */
  iso: string | null;
  /** LOCAL midnight of `iso`. Null when undated — never today, never createdAt. */
  date: Date | null;
  /** True only when the schedule carries a real, parseable start date. */
  dated: boolean;
  /**
   * LOCAL midnight of today. NOT an anchor: it is the origin a relative
   * drawing needs, and every date derived from it moves forward one day per
   * calendar day. Legal only alongside the undated disclosure + a "set a start
   * date" action.
   */
  unanchoredPreviewDate: Date;
  /** `unanchoredPreviewDate` as a calendar day, for props typed `string`. */
  unanchoredPreviewIso: string;
}

/**
 * The single resolution of "when does this schedule start?".
 *
 * Accepts the mixed shapes the field actually holds — a bare 'YYYY-MM-DD' from
 * the app, a full ISO timestamp from a Supabase round-trip — via
 * parseCalendarDay, so the answer never shifts with the reader's timezone.
 * An absent, empty or unparseable value is UNDATED, not today.
 */
export function resolveScheduleAnchor(
  schedule: ScheduleAnchorSource | null | undefined,
  now: Date = new Date(),
): ResolvedScheduleAnchor {
  const preview = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = parseCalendarDay(schedule?.startDate ?? null);
  return {
    iso: date ? toCalendarDayString(date) : null,
    date,
    dated: date !== null,
    unanchoredPreviewDate: preview,
    unanchoredPreviewIso: toCalendarDayString(preview),
  };
}

/** True when the schedule exists but has no usable calendar anchor. */
export function isUndatedSchedule(schedule: ScheduleAnchorSource | null | undefined): boolean {
  return !!schedule && !resolveScheduleAnchor(schedule).dated;
}

// The one wording for the undated case. Shared so the phone, the desktop tab
// and the briefing say the same true thing rather than three near-misses.
export const UNDATED_SCHEDULE_TITLE = 'This schedule has no start date';
export const UNDATED_SCHEDULE_BODY =
  'Its day numbers are real — the calendar dates are not. Set the start date and every task lands on a real day.';
export const UNDATED_SCHEDULE_CTA = 'Set start date';
/**
 * What the "Starts" field says on a surface that fell back to
 * `unanchoredPreviewDate`. It replaces a date — printing today's date in that
 * slot is the SCHED-NO-ANCHOR bug itself — so it is phrased as a field value,
 * not a sentence, and it is a shared constant because the desktop tab renders
 * that bar twice and drifted between the two copies within a day of the fix.
 */
export const UNDATED_SCHEDULE_PREVIEW_NOTE =
  'Not set — dates below are a preview drawn from today';

/**
 * What an undated schedule CAN honestly say about a task: its working-day
 * window. 'Day 6 – 10', or 'Day 6' for a one-day task or a milestone. These
 * numbers are stored data, unlike the calendar dates.
 */
export function taskWorkingDayLabel(
  task: Pick<ScheduleTask, 'startDay' | 'durationDays'>,
): string {
  const start = Math.max(1, Math.round(task.startDay ?? 1));
  const end = start + Math.max(1, Math.round(task.durationDays ?? 0)) - 1;
  return end <= start ? `Day ${start}` : `Day ${start} – ${end}`;
}

/**
 * Is `task` on site on schedule day `dayNumber` (1-indexed WORKING days)?
 *
 * The single membership test behind Home's TODAY ON SITE strip, Summary's
 * TODAY ON SITE card and Summary's THIS WEEK strip. Inclusive last day is
 * `startDay + durationDays - 1`, matching scheduleEngine.getTaskDateRange.
 * THIS WEEK used to run a different rule entirely — a 0-indexed raw CALENDAR
 * index with an end of `startDay + durationDays` — so the same job could be
 * counted by one card and not the other on the same screen (MISS-01).
 *
 * A 0-day milestone has no active window here (it is an event, not work);
 * `isMilestoneOnScheduleDay` reports those separately, as both strips display
 * them separately.
 */
export function isTaskActiveOnScheduleDay(
  task: Pick<ScheduleTask, 'startDay' | 'durationDays' | 'status'>,
  dayNumber: number,
): boolean {
  if (task.status === 'done') return false;
  const start = Math.max(1, task.startDay ?? 1);
  const dur = Math.max(0, task.durationDays ?? 0);
  return dayNumber >= start && dayNumber <= start + dur - 1;
}

/** Does a milestone land exactly on schedule day `dayNumber`? */
export function isMilestoneOnScheduleDay(
  task: Pick<ScheduleTask, 'startDay' | 'status' | 'isMilestone'>,
  dayNumber: number,
): boolean {
  if (task.status === 'done') return false;
  if (!task.isMilestone) return false;
  return dayNumber === Math.max(1, task.startDay ?? 1);
}

// ---------------------------------------------------------------------------
// 1) Reflow from actuals
// ---------------------------------------------------------------------------
// Philosophy: the plan is sacred until the PM says "reality is the plan now."
// This op takes the observed variance on each task with actuals and cascades
// it to downstream successors.
//
// Algorithm (simple & deterministic):
//   For each task with `actualStartDay` set:
//     delta = actualStartDay - baselineStartDay  (or startDay if no baseline)
//     If delta > 0, push every transitive successor's startDay by `delta` days
//       (unless that successor also already has an actualStartDay, in which
//        case its actuals override the cascade — they've already happened).
//   Idempotent: running twice on the same data produces the same output.
//
// This does NOT recompute the critical path — the caller re-runs `runCpm`
// after applying the reflow so all float numbers are fresh.

export function reflowFromActuals(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map<string, ScheduleTask>();
  for (const t of tasks) byId.set(t.id, { ...t });

  // Build successor index.
  const successors = new Map<string, string[]>();
  for (const t of tasks) {
    for (const depId of t.dependencies) {
      const arr = successors.get(depId) ?? [];
      arr.push(t.id);
      successors.set(depId, arr);
    }
  }

  // For each task with actuals, compute delta and propagate.
  for (const seed of tasks) {
    if (seed.actualStartDay == null) continue;
    const basis = seed.baselineStartDay ?? seed.startDay;
    const delta = seed.actualStartDay - basis;
    // Also factor in a finished task that ran longer than baseline.
    let finishDelta = 0;
    if (seed.actualEndDay != null) {
      const baseEnd = seed.baselineEndDay ?? (basis + Math.max(0, seed.durationDays - 1));
      finishDelta = seed.actualEndDay - baseEnd;
    }
    const push = Math.max(delta, finishDelta);
    if (push <= 0) continue;

    // BFS through successors. Stop at any successor that has its own actuals
    // (they're already grounded in reality and should be trusted).
    const seen = new Set<string>();
    const q = [...(successors.get(seed.id) ?? [])];
    while (q.length) {
      const sid = q.shift()!;
      if (seen.has(sid)) continue;
      seen.add(sid);
      const succ = byId.get(sid);
      if (!succ) continue;
      if (succ.actualStartDay != null) continue; // don't touch started work
      succ.startDay = succ.startDay + push;
      // Keep baseline as-is — baseline = the original promise, not the new plan.
      for (const next of successors.get(sid) ?? []) q.push(next);
    }
  }

  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// 2) Named baselines
// ---------------------------------------------------------------------------
// Extends the existing single-baseline model non-breakingly: we keep the
// legacy `schedule.baseline` for back-compat and add a sidecar list of named
// versions captured over time.

export interface NamedBaseline extends ScheduleBaseline {
  id: string;
  name: string;          // "v1", "Signed", "Approved rev 2", ...
  note?: string;
  /** Reason this baseline was captured/rebaselined. Drives the audit
   *  trail when an owner asks "why did this change?" — typical values:
   *  "permit delay", "scope change", "weather", "client direction", etc. */
  reasonCode?: BaselineReasonCode;
  /** Captured-by user identifier — email, name, or 'anonymous'. */
  capturedBy?: string;
}

/** Stable reason codes for re-baselines. Free text via `reasonOther` if
 *  the user picks "other." */
export type BaselineReasonCode =
  | 'as_bid'
  | 'permit_delay'
  | 'scope_change'
  | 'weather'
  | 'client_direction'
  | 'sub_unavailability'
  | 'design_revision'
  | 'material_delay'
  | 'other';

export const BASELINE_REASON_LABELS: Record<BaselineReasonCode, string> = {
  as_bid: 'As-bid baseline',
  permit_delay: 'Permit delay',
  scope_change: 'Scope change',
  weather: 'Weather',
  client_direction: 'Client direction',
  sub_unavailability: 'Sub unavailable',
  design_revision: 'Design revision',
  material_delay: 'Material delay',
  other: 'Other',
};

export interface CaptureBaselineOpts {
  reasonCode?: BaselineReasonCode;
  capturedBy?: string;
}

export function captureBaseline(
  tasks: ScheduleTask[],
  name: string,
  note?: string,
  opts: CaptureBaselineOpts = {},
): NamedBaseline {
  return {
    id: `baseline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    note,
    reasonCode: opts.reasonCode,
    capturedBy: opts.capturedBy,
    savedAt: new Date().toISOString(),
    tasks: tasks.map(t => ({
      id: t.id,
      startDay: t.startDay,
      endDay: t.startDay + Math.max(0, t.durationDays - 1),
    })),
  };
}

export interface BaselineCalendarOpts {
  /** ISO YYYY-MM-DD project start — day 1 anchor. Without it we fall back to
   *  the raw stored endDay (no calendar available to resolve weekdays). */
  scheduleStartDate?: string;
  /** Working days per week (1-7). Default 7 = raw-day behavior. */
  workingDaysPerWeek?: number;
  /** Closures / holidays (ISO YYYY-MM-DD) that block work. */
  nonWorkingDates?: string[];
  /** Per-task calendar overrides — same map shape runCpm consumes. */
  taskCalendars?: RunCpmOptions['taskCalendars'];
}

/**
 * Project finish of a named baseline expressed in WORKING-DAY space, using the
 * SAME calendar the live CPM engine uses.
 *
 * Why this exists: `captureBaseline` persists each task's `startDay` plus a RAW
 * `endDay` (= startDay + dur - 1, with no weekend/closure skipping). On the
 * app's default 5-day work week the live `cpm.projectFinish` is working-day
 * aware, so comparing it against the raw baseline finish via
 * `workingDaysBetween` fabricated phantom slip even on an UNCHANGED schedule
 * right after capture. Here we replay each baseline task's start + duration
 * through the real CPM engine (no dependencies — the baseline already baked the
 * dependency-resolved start into `startDay`) so the returned finish lives on the
 * same working-day scale as `cpm.projectFinish`.
 *
 * Backward-compatible: reads only `startDay`/`endDay`, which every persisted
 * baseline already carries. The reconstructed duration (`endDay - startDay + 1`)
 * equals the original working-day `durationDays` captureBaseline started from,
 * so this corrects existing raw-endDay baselines without a data migration.
 *
 * Returns null when the baseline has no tasks, or (via the runCpm fallback) the
 * raw finish when no `scheduleStartDate` is supplied.
 */
export function baselineFinishDayWorkingScale(
  baseline: NamedBaseline,
  calendar: BaselineCalendarOpts = {},
): number | null {
  if (!baseline.tasks || baseline.tasks.length === 0) return null;
  const stubs: ScheduleTask[] = baseline.tasks.map(b => ({
    id: b.id,
    title: b.id,
    phase: '',
    durationDays: Math.max(0, b.endDay - b.startDay + 1),
    startDay: b.startDay,
    progress: 0,
    crew: '',
    dependencies: [],
    notes: '',
    status: 'not_started',
  }));
  const res = runCpm(stubs, {
    scheduleStartDate: calendar.scheduleStartDate,
    workingDaysPerWeek: calendar.workingDaysPerWeek,
    nonWorkingDates: calendar.nonWorkingDates,
    taskCalendars: calendar.taskCalendars,
  });
  return res.projectFinish > 0 ? res.projectFinish : null;
}

/** Apply a captured baseline onto each task's baselineStartDay/baselineEndDay. */
export function applyBaselineToTasks(tasks: ScheduleTask[], baseline: NamedBaseline): ScheduleTask[] {
  const byId = new Map(baseline.tasks.map(b => [b.id, b]));
  return tasks.map(t => {
    const b = byId.get(t.id);
    if (!b) return t;
    return { ...t, baselineStartDay: b.startDay, baselineEndDay: b.endDay };
  });
}

export interface BaselineDiff {
  taskId: string;
  title: string;
  startDelta: number;    // newStart - baselineStart
  durationDelta: number;
  endDelta: number;
}

/** Compare two named baselines (e.g. as-bid vs. as-permitted) without
 *  involving the current plan. Used by the multi-baseline UI to show
 *  "what changed when the GC re-baselined after permit delay." */
export function diffTwoBaselines(a: NamedBaseline, b: NamedBaseline): BaselineDiff[] {
  const aById = new Map(a.tasks.map(t => [t.id, t]));
  const out: BaselineDiff[] = [];
  for (const bt of b.tasks) {
    const at = aById.get(bt.id);
    if (!at) continue;
    const aDur = at.endDay - at.startDay + 1;
    const bDur = bt.endDay - bt.startDay + 1;
    if (at.startDay === bt.startDay && aDur === bDur) continue;
    out.push({
      taskId: bt.id,
      title: bt.id, // caller can re-resolve via tasks[] if needed
      startDelta: bt.startDay - at.startDay,
      durationDelta: bDur - aDur,
      endDelta: bt.endDay - at.endDay,
    });
  }
  return out.sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
}

/** Show variance between the current plan and a named baseline. */
export function diffAgainstBaseline(tasks: ScheduleTask[], baseline: NamedBaseline): BaselineDiff[] {
  const byId = new Map(baseline.tasks.map(b => [b.id, b]));
  const out: BaselineDiff[] = [];
  for (const t of tasks) {
    const b = byId.get(t.id);
    if (!b) continue;
    const end = t.startDay + Math.max(0, t.durationDays - 1);
    const bDur = b.endDay - b.startDay + 1;
    if (t.startDay === b.startDay && t.durationDays === bDur) continue; // unchanged
    out.push({
      taskId: t.id,
      title: t.title,
      startDelta: t.startDay - b.startDay,
      durationDelta: t.durationDays - bDur,
      endDelta: end - b.endDay,
    });
  }
  return out.sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
}

// ---------------------------------------------------------------------------
// 3) CSV export
// ---------------------------------------------------------------------------

/**
 * CSV of the task table, with the same dates the grid shows.
 *
 * `workingDaysPerWeek` / `nonWorkingDates` come from the schedule
 * (ProjectSchedule). They default to the app-wide 5-day fallback that every
 * other date-rendering path uses (`schedule?.workingDaysPerWeek ?? 5`) —
 * callers on a 6- or 7-day week MUST pass their real value or the export will
 * skip weekends the schedule doesn't observe.
 */
export function exportTasksToCsv(
  tasks: ScheduleTask[],
  projectStartDate: Date,
  workingDaysPerWeek: number = 5,
  nonWorkingDates?: string[],
): string {
  // `startDay` / `finishDay` are WORKING-day numbers — day 1 is
  // projectStartDate, day 2 is the next working day — which is the convention
  // scheduleEngine.getTaskDateRange and every on-screen date use.
  //
  // This walked RAW CALENDAR days (`d.setDate(d.getDate() + dayNum - 1)`), so
  // on the default 5-day week the exported dates drifted one calendar day for
  // every weekend crossed and the error GREW down the file: a task with
  // startDay 11 / duration 10 on a Monday anchor exported Start 2026-03-12 /
  // Finish 2026-03-21 where the grid showed Mar 16 → Mar 27. Subs mobilized on
  // the wrong dates, and the CSV could not self-diagnose because the
  // 'Start day' / 'Finish day' integer columns beside the dates were correct.
  //
  // Formatting is from LOCAL Y/M/D rather than `toISOString().slice(0, 10)`.
  // addWorkingDays returns a local-midnight Date; toISOString() re-projects it
  // into UTC and emits the PREVIOUS calendar day at any POSITIVE UTC offset.
  // (The audit note claimed the ISO shift bit at NEGATIVE offsets — that is
  // backwards: local midnight in, say, New York is 05:00Z on the same day.)
  const fmtDate = (dayNum: number) => {
    const d = addWorkingDays(
      projectStartDate,
      Math.max(0, dayNum - 1),
      workingDaysPerWeek,
      nonWorkingDates,
    );
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const headers = [
    'WBS', 'Task', 'Phase', 'Duration (d)', 'Start day', 'Start date',
    'Finish day', 'Finish date', 'Crew', 'Progress %', 'Status',
    'Dependencies', 'Baseline start', 'Baseline end', 'Actual start', 'Actual end',
  ];
  const rows: string[] = [headers.join(',')];
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const t of tasks) {
    const finishDay = t.startDay + Math.max(0, t.durationDays - 1);
    const depTitles = t.dependencies
      .map(id => byId.get(id)?.title ?? id)
      .join('; ');
    const row = [
      t.wbsCode ?? '',
      csvEscape(t.title),
      t.phase,
      t.durationDays,
      t.startDay,
      fmtDate(t.startDay),
      finishDay,
      fmtDate(finishDay),
      csvEscape(t.crew),
      t.progress,
      t.status,
      csvEscape(depTitles),
      t.baselineStartDay ?? '',
      t.baselineEndDay ?? '',
      t.actualStartDay ?? '',
      t.actualEndDay ?? '',
    ];
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

function csvEscape(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Trigger a CSV download in the browser. Returns true on success. */
export function downloadCsvInBrowser(csv: string, filename: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 4) Share-link encode/decode (client-only, no backend)
// ---------------------------------------------------------------------------
//
// We stuff a minimal projection of the schedule into base64 in the URL hash.
// Downsides: 50-task schedule is ~6KB URL, which is fine. No server = no
// database migrations = ships immediately.
//
// The projection is intentionally minimal — we don't ship notes, progress
// history, or internal ids. The shared view is read-only so that's fine.

export interface SharedSchedulePayload {
  /** v=1 legacy; v=2 adds GC contact + per-task assignedSub for sub-confirm flow.
   *  v=3 adds projectId for the Sub Schedule Collab daily-update flow. */
  v: 1 | 2 | 3;
  name: string;
  /** The schedule's start CALENDAR DAY, 'YYYY-MM-DD'. Tokens minted before
   *  2026-09-04 carry a full toISOString() instant instead; parseCalendarDay
   *  truncates those to their date part (audit UX-F2). */
  projectStartISO: string;
  /** v3+: project this schedule belongs to. Lets the sub post updates
   *  that the GC's app picks up under the right project context. */
  projectId?: string;
  /** v2+: GC contact info — used to compose mailto/sms responses when the
   *  link is shared in "for sub" mode (?asSub= query param). Optional so
   *  v1 payloads keep decoding cleanly. */
  gc?: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
  };
  tasks: {
    id: string;
    title: string;
    phase: string;
    startDay: number;
    durationDays: number;
    dependencies: string[];
    crew?: string;
    isMilestone?: boolean;
    baselineStartDay?: number;
    baselineEndDay?: number;
    actualStartDay?: number;
    actualEndDay?: number;
    progress?: number;
    /** v2+: sub assignment — when ?asSub= matches this string we filter
     *  the confirm UI to just the sub's tasks. Plain text for back-compat. */
    assignedSub?: string;
  }[];
}

/** Typed error thrown by `encodeShareToken` when the resulting URL-safe
 *  base64 token exceeds the Safari URL ceiling buffer. Callers should
 *  catch this and surface a friendly "schedule too large to share via
 *  link" message; the active Supabase-snapshot fallback is its own
 *  sub-project. */
export class ShareTokenTooLargeError extends Error {
  constructor(public tokenLength: number, public maxLength: number) {
    super(`Share token too large: ${tokenLength} > ${maxLength} chars`);
    this.name = 'ShareTokenTooLargeError';
  }
}

/** Safari URL ceiling buffer. Real limit varies by browser/proxy/referrer-
 *  header; 6000 chars is a safe headroom under the 8KB practical floor. */
const MAX_SHARE_TOKEN_LENGTH = 6000;

/** Discriminated result for the Item-6 fallback. When `oversize`, the
 *  caller should write the payload to shared_schedule_snapshots via
 *  Supabase and use the snapshot UUID as the URL token (`s=` param)
 *  instead of the base64 inline token (`t=` param). */
export type ShareTokenResult =
  | { kind: 'inline'; token: string }
  | { kind: 'oversize'; tokenLength: number; maxLength: number };

/** v2.4 (audit Item 6) — non-throwing variant of encodeShareToken.
 *  Returns a discriminated union so callers can branch on inline vs
 *  oversize without try/catch noise. Existing `encodeShareToken` is
 *  preserved unchanged for back-compat (v2.3 P1 callers). */
export function tryEncodeShareToken(payload: SharedSchedulePayload): ShareTokenResult {
  const json = JSON.stringify(payload);
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  const token = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (token.length > MAX_SHARE_TOKEN_LENGTH) {
    return { kind: 'oversize', tokenLength: token.length, maxLength: MAX_SHARE_TOKEN_LENGTH };
  }
  return { kind: 'inline', token };
}

export function encodeShareToken(payload: SharedSchedulePayload): string {
  const json = JSON.stringify(payload);
  // btoa only handles ASCII; use utf-8 round-trip.
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  // Make URL-safe.
  const token = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // v2.3 P1 — guard against silent URL-too-long failures. Throws a typed
  // error the caller can catch and surface a friendly alert.
  if (token.length > MAX_SHARE_TOKEN_LENGTH) {
    throw new ShareTokenTooLargeError(token.length, MAX_SHARE_TOKEN_LENGTH);
  }
  return token;
}

export function decodeShareToken(token: string): SharedSchedulePayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    const bytes = Uint8Array.from(ascii, c => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : ascii;
    const parsed = JSON.parse(json) as SharedSchedulePayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface BuildSharePayloadOpts {
  /** GC contact info — drives the sub-confirm reply (mailto/sms). Optional. */
  gc?: SharedSchedulePayload['gc'];
  /** Project this schedule belongs to. Required for Sub Schedule Collab
   *  daily updates so posts route to the right project context. */
  projectId?: string;
}

export function buildSharePayload(
  name: string,
  projectStartDate: Date,
  tasks: ScheduleTask[],
  opts: BuildSharePayloadOpts = {},
): SharedSchedulePayload {
  // Bump to v3 when projectId is provided (enables sub daily updates),
  // v2 when only GC contact / sub assignment is set, v1 otherwise.
  const anySub = tasks.some(t => t.assignedSubName);
  const hasGc = !!(opts.gc?.name || opts.gc?.email || opts.gc?.phone);
  const v: 1 | 2 | 3 = opts.projectId ? 3 : (anySub || hasGc) ? 2 : 1;
  return {
    v,
    name,
    // UX-F2: a calendar day, from LOCAL components. toISOString() re-projected
    // local midnight into UTC, and the viewer re-parsed that as UTC midnight —
    // every shared task sat a day early west of Greenwich.
    //
    // Legacy tokens (minted before this fix) still carry that toISOString()
    // instant, and app/shared-schedule.tsx now reads the date PREFIX of it
    // (parseCalendarDay). For a token minted WEST of Greenwich the prefix is
    // the intended day (local midnight is later the same UTC day); for one
    // minted EAST of Greenwich — where local midnight is still the previous
    // UTC day — every task in the legacy token reads a day EARLY. Only
    // re-sharing fixes such a link (B4 review A10).
    projectStartISO: toCalendarDayString(projectStartDate),
    projectId: opts.projectId,
    gc: opts.gc,
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      startDay: t.startDay,
      durationDays: t.durationDays,
      dependencies: t.dependencies,
      crew: t.crew || undefined,
      isMilestone: t.isMilestone,
      baselineStartDay: t.baselineStartDay,
      baselineEndDay: t.baselineEndDay,
      actualStartDay: t.actualStartDay,
      actualEndDay: t.actualEndDay,
      progress: t.progress,
      assignedSub: t.assignedSubName,
    })),
  };
}

/** Reconstruct ScheduleTask[] from the shared payload so our viewer can render. */
export function tasksFromSharePayload(payload: SharedSchedulePayload): ScheduleTask[] {
  return payload.tasks.map(t => ({
    id: t.id,
    title: t.title,
    phase: t.phase,
    durationDays: t.durationDays,
    startDay: t.startDay,
    progress: t.progress ?? 0,
    crew: t.crew ?? '',
    dependencies: t.dependencies,
    notes: '',
    status: 'not_started',
    isMilestone: t.isMilestone,
    baselineStartDay: t.baselineStartDay,
    baselineEndDay: t.baselineEndDay,
    actualStartDay: t.actualStartDay,
    actualEndDay: t.actualEndDay,
    assignedSubName: t.assignedSub,
  }));
}

// ───────────────────────────────────────────────────────────────────────
// Sub-confirm response composers — login-less reply flow for shareable
// schedule URLs. Sub taps "Confirm" / "Need to reschedule" → we open a
// pre-filled mailto: + sms: so the GC gets a structured response without
// the sub ever creating an account. Wedge against Buildertrend's sub
// portal which requires login.
// ───────────────────────────────────────────────────────────────────────

export type SubConfirmAction = 'confirm' | 'reschedule' | 'decline';

export interface ComposeReplyArgs {
  action: SubConfirmAction;
  projectName: string;
  taskTitle: string;
  taskDateRange: string;
  subName: string;
  gcName?: string;
  reason?: string;
}

/** Build a one-liner subject + multi-line body the sub can send to GC. */
export function composeSubReply(args: ComposeReplyArgs): { subject: string; body: string } {
  const { action, projectName, taskTitle, taskDateRange, subName, gcName, reason } = args;
  const verb = action === 'confirm'
    ? 'CONFIRMED'
    : action === 'reschedule'
      ? 'NEED TO RESCHEDULE'
      : 'DECLINED';
  const subject = `[${verb}] ${projectName} — ${taskTitle} (${taskDateRange})`;
  const lines: string[] = [];
  lines.push(`Hi${gcName ? ' ' + gcName : ''},`);
  lines.push('');
  if (action === 'confirm') {
    lines.push(`Confirming the following on the ${projectName} schedule:`);
    lines.push(`  • ${taskTitle}`);
    lines.push(`  • ${taskDateRange}`);
    lines.push('');
    lines.push('We\'ll be on site as scheduled.');
  } else if (action === 'reschedule') {
    lines.push(`Need to reschedule the following on the ${projectName} schedule:`);
    lines.push(`  • ${taskTitle}`);
    lines.push(`  • Currently: ${taskDateRange}`);
    if (reason) {
      lines.push('');
      lines.push(`Reason: ${reason}`);
    }
    lines.push('');
    lines.push('Let me know what works on your end.');
  } else {
    lines.push(`Have to decline the following on the ${projectName} schedule:`);
    lines.push(`  • ${taskTitle}`);
    lines.push(`  • ${taskDateRange}`);
    if (reason) {
      lines.push('');
      lines.push(`Reason: ${reason}`);
    }
  }
  lines.push('');
  lines.push(`— ${subName}`);
  lines.push('');
  lines.push('(Sent via MAGE ID schedule link)');
  return { subject, body: lines.join('\n') };
}

/** mailto: URL builder. Falls back gracefully when email is empty. */
export function buildMailtoUrl(args: ComposeReplyArgs & { gcEmail?: string }): string {
  const { gcEmail, ...rest } = args;
  const { subject, body } = composeSubReply(rest);
  const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${gcEmail ?? ''}?${params}`;
}

/** sms: URL builder. iOS uses & or ?, Android uses ?, both accept ?body=. */
export function buildSmsUrl(args: ComposeReplyArgs & { gcPhone?: string }): string {
  const { gcPhone, ...rest } = args;
  const { subject, body } = composeSubReply(rest);
  // Keep SMS short — strip the long body for SMS, just use subject + name.
  const text = `${subject}\n\n— ${rest.subName}`;
  void body;
  return `sms:${gcPhone ?? ''}?body=${encodeURIComponent(text)}`;
}
