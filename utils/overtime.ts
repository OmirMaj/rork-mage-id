// overtime.ts — ONE overtime rule for every screen that reads crew hours.
//
// THE BUG THIS REPLACES (audit #65). Overtime used to be decided per SHIFT:
// hooks/useTimeEntries.computeShiftHours stored `max(0, shiftHours − 8)` on
// each row at clock-out, and every reader trusted that stored number. Nothing
// ever added a worker's shifts up:
//   • Jose works Henderson 6–12, is clocked out, then Oak St 12:30–4:30 —
//     10.5 h in the day, two shifts under 8 h, 0 h OT in the payroll CSV.
//   • Four 10-hour days = 40 h: the per-shift rule booked 8 h of OT dollars
//     into job cost where federal (FLSA) overtime is 0.
// And the stored figure went stale the moment another shift landed on the
// same day or week, so it could not be fixed by recomputing one row.
//
// THE RULE NOW. Overtime is worked out at READ time, from every finished shift
// a worker has, grouped by worker and by calendar day / payroll week:
//   • weekly: hours past `weeklyThreshold` in the GC's payroll week (federal
//     default 40, week starting on the GC's `weekStartsOn`);
//   • daily (optional, off by default): hours past `dailyThreshold` in one
//     calendar day — the California-style rule some GCs pay.
// With both on, an hour is overtime ONCE: hours already paid as daily OT do not
// also count toward the 40 (the FLSA "no pyramiding" reading), so nothing is
// double counted.
//
// WHICH SHIFT CARRIES THE PREMIUM (documented choice, not an accident). A
// worker's shifts are walked in clock-in order, and the overtime lands on the
// hours PAST the threshold — i.e. on the chronologically LATER shifts. When
// Jose splits a day between two jobs, the job that got his 9th and 10th hour
// carries their premium in job cost. Pro-rating would spread it over jobs that
// never saw a late hour. Ties on clock-in fall back to the entry id so the
// answer never depends on array order.
//
// THE CURRENT WEEK IS PROVISIONAL. A week that has not ended can only show the
// overtime SO FAR — more shifts can still push hours past 40 — so every entry
// in an open week is flagged, and screens label it rather than stating it as
// the week's final number. Nothing here is ever written back to a stored row.
//
// Days come from the clock-in instant's LOCAL calendar day (the #9 rule every
// time-clock reader uses) through utils/calendarDate, never the UTC `date`.
//
// Pure — no React, no storage. Pinned by scripts/validate-labor-cost-overtime.ts.

import type { TimeEntry } from '@/types';
import { addCalendarDays, parseCalendarDay, toCalendarDayString, todayCalendarDay } from '@/utils/calendarDate';

/** 0 = Sunday … 6 = Saturday (Date#getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface OvertimeRule {
  /** Hours per payroll week after which every hour is overtime. null = no weekly rule. */
  weeklyThreshold: number | null;
  /** Hours per calendar day after which every hour is overtime. null = no daily rule. */
  dailyThreshold: number | null;
  /** First day of the GC's payroll week. */
  weekStartsOn: Weekday;
}

/** Federal default: weekly over 40, no daily rule, weeks starting Monday. */
export const DEFAULT_OVERTIME_RULE: OvertimeRule = Object.freeze({
  weeklyThreshold: 40,
  dailyThreshold: null,
  weekStartsOn: 1 as Weekday,
});

/** The daily threshold offered as the optional setting. */
export const DAILY_OVERTIME_HOURS = 8;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export function weekdayShort(d: Weekday): string {
  return WEEKDAY_SHORT[d];
}

/** Sane a stored / typed rule. Anything unusable falls back to the default
 *  piece by piece, so a corrupt daily value never switches the weekly rule off. */
export function normalizeOvertimeRule(raw: unknown): OvertimeRule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const threshold = (v: unknown, fallback: number | null): number | null => {
    if (v === null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (v === undefined || !Number.isFinite(n)) return fallback;
    return n > 0 && n <= 168 ? Math.round(n * 100) / 100 : fallback;
  };
  const ws = Number(r.weekStartsOn);
  return {
    weeklyThreshold: threshold(r.weeklyThreshold, DEFAULT_OVERTIME_RULE.weeklyThreshold),
    dailyThreshold: threshold(r.dailyThreshold, DEFAULT_OVERTIME_RULE.dailyThreshold),
    weekStartsOn: (Number.isInteger(ws) && ws >= 0 && ws <= 6 ? ws : DEFAULT_OVERTIME_RULE.weekStartsOn) as Weekday,
  };
}

const fmtH = (n: number): string => String(n);

/** Short label for a CSV column / a caption: "weekly >40", "daily >8, weekly >40". */
export function describeOvertimeRule(rule: OvertimeRule): string {
  const parts: string[] = [];
  if (rule.dailyThreshold != null) parts.push(`daily >${fmtH(rule.dailyThreshold)}`);
  if (rule.weeklyThreshold != null) parts.push(`weekly >${fmtH(rule.weeklyThreshold)}`);
  return parts.length > 0 ? parts.join(', ') : 'no overtime rule';
}

/** The local calendar day a shift was worked (clock-in instant; stored `date`
 *  only when the instant is unusable). Same rule as useTimeEntries.timeEntryDay,
 *  restated because that module pulls in react-native. */
export function shiftWorkDay(e: Pick<TimeEntry, 'clockIn' | 'date'>): string {
  if (e.clockIn) {
    const d = new Date(e.clockIn);
    if (!Number.isNaN(d.getTime())) return toCalendarDayString(d);
  }
  return e.date || '';
}

/** First day (YYYY-MM-DD) of the payroll week holding `day`. '' for a bad day. */
export function payrollWeekStart(day: string, weekStartsOn: Weekday): string {
  const d = parseCalendarDay(day);
  if (!d) return '';
  const back = (d.getDay() - weekStartsOn + 7) % 7;
  return toCalendarDayString(addCalendarDays(d, -back));
}

/** Hours so far on a shift still on the clock, net of finished breaks and of
 *  the break in progress. */
export function openShiftHours(e: TimeEntry, nowMs: number): number {
  const start = Date.parse(e.clockIn);
  if (!Number.isFinite(start)) return 0;
  let breakMin = Math.max(0, e.breakMinutes || 0);
  if (e.status === 'break' && e.breakStartedAt) {
    const bs = Date.parse(e.breakStartedAt);
    if (Number.isFinite(bs)) breakMin += Math.max(0, (nowMs - bs) / 60_000);
  }
  return Math.max(0, (nowMs - start) / 3_600_000 - breakMin / 60);
}

/** Who worked a shift. A real clock-in carries the crew member's id; a row
 *  with no id falls back to the name. (workerId 'self' rows never reach this:
 *  computeOvertime treats them as straight time — see VOICE LOGS below.) */
export function overtimeWorkerKey(e: Pick<TimeEntry, 'workerId' | 'workerName'>): string {
  if (e.workerId && e.workerId !== 'self') return `id:${e.workerId}`;
  return `name:${(e.workerName ?? '').trim().toLowerCase()}`;
}

export interface OvertimeAllocation {
  /** Overtime hours allocated to each counted entry, by entry id. */
  byEntry: Map<string, number>;
  /** Entries whose payroll week has not ended — their OT is "so far". */
  provisional: Set<string>;
  rule: OvertimeRule;
}

export interface ComputeOvertimeOptions {
  /** Today's calendar day (for the provisional flag). Defaults to the device's. */
  today?: string;
  /** When set, shifts still on the clock count with their hours so far. */
  liveNowMs?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function isOpen(e: TimeEntry): boolean {
  return (e.status === 'clocked_in' || e.status === 'break') && !e.clockOut;
}

/**
 * Allocate overtime across `entries` under `rule`. Every finished shift with
 * hours counts toward its worker's day and week — whatever project it is on,
 * 'unassigned' included, because the worker's pay does not care which job the
 * hours were on. The stored per-shift `overtimeHours` is never read.
 */
export function computeOvertime(
  entries: readonly TimeEntry[] | null | undefined,
  rule: OvertimeRule = DEFAULT_OVERTIME_RULE,
  opts: ComputeOvertimeOptions = {},
): OvertimeAllocation {
  const r = normalizeOvertimeRule(rule);
  const today = opts.today ?? todayCalendarDay();
  const todayWeek = payrollWeekStart(today, r.weekStartsOn);
  const byEntry = new Map<string, number>();
  const provisional = new Set<string>();

  interface Counted { e: TimeEntry; hours: number; day: string; week: string; t: number }
  const byWorker = new Map<string, Counted[]>();
  for (const e of entries ?? []) {
    if (!e || !e.id) continue;
    // VOICE LOGS ARE STRAIGHT TIME. workerId 'self' is written only by
    // addManualEntry (the mic's "24 hours framing"): a crew-hours TOTAL for a
    // trade, labelled with the company name — not one person's shift. Pooling
    // a week of those under one "worker" invents weekly overtime nobody
    // worked and prices it at the multiplier, so they carry 0 OT and do not
    // count toward anyone's day or week. (The name can't split them: it is
    // the same company name on every log.)
    if (e.workerId === 'self') {
      if (e.status === 'clocked_out') byEntry.set(e.id, 0);
      continue;
    }
    let hours: number;
    if (isOpen(e)) {
      if (opts.liveNowMs === undefined) continue;
      hours = openShiftHours(e, opts.liveNowMs);
    } else if (e.status === 'clocked_out' && Number.isFinite(e.totalHours)) {
      hours = Math.max(0, e.totalHours);
    } else {
      continue;
    }
    const day = shiftWorkDay(e);
    const week = payrollWeekStart(day, r.weekStartsOn);
    const t = Date.parse(e.clockIn);
    const key = overtimeWorkerKey(e);
    const list = byWorker.get(key) ?? [];
    list.push({ e, hours, day, week, t: Number.isFinite(t) ? t : 0 });
    byWorker.set(key, list);
  }

  for (const list of byWorker.values()) {
    list.sort((a, b) => a.t - b.t || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
    const dayWorked = new Map<string, number>();
    const weekRegular = new Map<string, number>();
    for (const c of list) {
      // Daily: the part of this shift past the day's threshold.
      let dailyOt = 0;
      if (r.dailyThreshold != null) {
        const before = dayWorked.get(c.day) ?? 0;
        const after = before + c.hours;
        dailyOt = Math.max(0, after - Math.max(before, r.dailyThreshold));
        dayWorked.set(c.day, after);
      }
      // Weekly: only hours NOT already daily OT count toward the 40.
      const straight = c.hours - dailyOt;
      let weeklyOt = 0;
      if (r.weeklyThreshold != null && c.week) {
        const before = weekRegular.get(c.week) ?? 0;
        const after = before + straight;
        weeklyOt = Math.max(0, after - Math.max(before, r.weeklyThreshold));
        weekRegular.set(c.week, after);
      }
      byEntry.set(c.e.id, round2(Math.min(c.hours, dailyOt + weeklyOt)));
      // A week not yet over (or a live shift) can still gain overtime.
      if (isOpen(c.e) || !c.week || (todayWeek && c.week >= todayWeek)) provisional.add(c.e.id);
    }
  }
  return { byEntry, provisional, rule: r };
}

/** Allocated OT for one entry — 0 for an entry the allocation did not count. */
export function overtimeFor(alloc: OvertimeAllocation, entryId: string): number {
  return alloc.byEntry.get(entryId) ?? 0;
}
