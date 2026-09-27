// weatherReschedule.ts — turn a weather forecast into a schedule reschedule.
//
// The field-facing half of weather-aware scheduling: given the live schedule,
// the project start date, and a forecast (real OpenWeather or simulated), find
// the non-workable days that fall on WEATHER-SENSITIVE tasks and propagate the
// lost days downstream — so a rained-out slab pour pushes framing, and the
// project finish, by the right number of days. No SMB residential competitor
// does this; the enterprise tools (ALICE, EHAB) are $$$ and commercial-only.
//
// PROVENANCE: the reschedule math treats live and simulated days identically —
// planning around a hypothetical is legitimate. What is NOT legitimate is
// writing a hypothetical into weatherDelayLog, the record an owner sees. Each
// affected date's `source` is carried out on the result, and
// buildWeatherDelayLog refuses (or quarantines) anything not backed by a real
// reading. See utils/weatherProvenance.ts.
//
// Model (deliberate): weather injects delay into the dependency EDGES, not the
// hit task's own bar. A weather-sensitive task keeps its authored duration; its
// SUCCESSORS (and the project finish) slip by the lost days. This keeps durations
// honest, cascades correctly through FS/SS/FF/SF + lag (same math as the CPM
// engine's recalculateStartDays), and matches how a GC thinks: "rain Tue/Wed
// delays everything after the pour by two days."
//
// Pure: dependency forward-pass + impact accounting only. The screen does the
// I/O (fetch forecast, commit new startDays, log the delay). Done tasks and
// tasks already in the past are pinned — the plan stays the plan for work that
// already happened.

import type { ScheduleTask, DependencyLink, WeatherDelayLogEntry } from '@/types';
import { findWeatherRisk, type DayForecast } from '@/utils/weatherService';
import {
  partitionDatesBySource,
  summarizeForecastSource,
  type ForecastCoverage,
} from '@/utils/weatherProvenance';
import {
  taskCalendarDay,
  todayWorkingOrdinal,
  scheduleAnchorDate,
  type ScheduleCalendar,
} from '@/utils/scheduleCalendarDate';

export type { WeatherDelayLogEntry };

export interface WeatherImpact {
  taskId: string;
  title: string;
  phase: string;
  /** Idle days the weather injects into this task. Only > 0 for directly-hit
   *  weather-sensitive tasks; cascaded tasks have 0 here but a startSlip. */
  weatherDelayDays: number;
  /** How far this task's start moved vs. its original startDay (upstream slip). */
  startSlipDays: number;
  /** Non-workable forecast dates (ISO) that fall inside this task's window. */
  badDates: string[];
  /** Worst condition across this task's bad dates, for display. */
  worstCondition?: DayForecast['condition'];
  originalStartDay: number;
  newStartDay: number;
  /** True when this task's OWN weather sensitivity caused delay (vs. cascade only). */
  directlyHit: boolean;
}

export interface WeatherRescheduleResult {
  /** Full task array with updated startDays (untouched tasks unchanged). */
  tasks: ScheduleTask[];
  /** Affected tasks (directly hit or cascaded), worst-slip first. */
  impacts: WeatherImpact[];
  /** New project finish (day number) − original finish. 0 = no schedule impact. */
  projectSlipDays: number;
  /** Tasks whose own weather days caused delay. */
  directHitCount: number;
  /** Tasks pushed only by upstream slip. */
  cascadedCount: number;
  /** Distinct non-workable dates that actually hit a task, ascending. */
  affectedDates: string[];
  /** Subset of `affectedDates` backed by a real OpenWeather reading. Only
   *  these came from a real reading. */
  liveAffectedDates: string[];
  /** Subset of `affectedDates` that came from getSimulatedForecast — invented,
   *  with no relation to the jobsite. Never evidence. */
  simulatedAffectedDates: string[];
  /** Provenance of the forecast window this result was computed from.
   *  'empty' when no forecast was supplied at all. */
  forecastSource: ForecastCoverage;
}

// Severity order for picking the headline condition on a multi-day hit.
const CONDITION_SEVERITY: Record<DayForecast['condition'], number> = {
  storm: 5, snow: 4, rain: 3, wind: 2, cloudy: 1, clear: 0,
};

function depLinks(task: ScheduleTask): DependencyLink[] {
  if (task.dependencyLinks && task.dependencyLinks.length > 0) return task.dependencyLinks;
  return (task.dependencies ?? []).map((id) => ({ taskId: id, lagDays: 0, type: 'FS' as const }));
}

/** RAW-DAY MODE ONLY: ISO date for a 1-indexed schedule day as a plain
 *  calendar offset. Correct only when the schedule has no start date — the
 *  engine then runs without a calendar and the working and calendar scales
 *  are the same numbers (utils/cpm.ts "THE TWO DAY-NUMBER SCALES"). A dated
 *  schedule goes through `taskCalendarDay` instead (see `calendar` below). */
function isoForDay(projectStartDate: Date, dayNumber: number): string {
  const d = new Date(projectStartDate.getTime());
  d.setDate(d.getDate() + (dayNumber - 1));
  return d.toISOString().split('T')[0];
}

/** Calendar days from the raw anchor to `now`, 1-based (raw-day mode's today). */
function rawTodayDay(projectStartDate: Date, now: Date): number {
  return Math.max(1, Math.floor((now.getTime() - projectStartDate.getTime()) / 86400000) + 1);
}

export function computeWeatherReschedule(
  tasks: ScheduleTask[],
  projectStartDate: Date,
  forecast: DayForecast[],
  opts?: {
    /** 1-indexed "today" ON THE startDay SCALE — tasks starting before this are
     *  pinned (past work). Wins over `now` when both are given. Default 1. */
    todayDay?: number;
    /** The real clock. Converted to the startDay scale here — the working
     *  ordinal on a dated schedule (`todayWorkingOrdinal`), calendar days from
     *  `projectStartDate` in raw-day mode — so a caller cannot compare a
     *  calendar count with a working ordinal (which froze every task whose
     *  working day number was below the calendar day count). */
    now?: Date;
    /** The schedule's calendar (`scheduleCalendarOf(project.schedule)`). When
     *  it carries a start date, every startDay is read as a WORKING ordinal on
     *  it — the way the CPM engine and the Gantt read it — so only bad days
     *  that are WORKING days of the task count, and every day figure in the
     *  result (weatherDelayDays, startSlipDays, projectSlipDays) is in working
     *  days. Omitted or undated ⇒ raw-day mode (plain calendar offsets from
     *  `projectStartDate`), which is also how the engine reads an undated
     *  schedule. */
    calendar?: ScheduleCalendar;
  },
): WeatherRescheduleResult {
  const cal = opts?.calendar && scheduleAnchorDate(opts.calendar) ? opts.calendar : undefined;
  /** The date a task occupies on its `offset`-th working day. */
  const dayIso = (startDay: number, offset: number): string | null => (
    cal ? taskCalendarDay(cal, startDay, offset) : isoForDay(projectStartDate, startDay + offset)
  );
  const badByDate = new Map<string, DayForecast>();
  for (const f of forecast) if (!f.isWorkable) badByDate.set(f.date, f);

  const map = new Map<string, ScheduleTask>();
  for (const t of tasks) map.set(t.id, { ...t });

  const origStart = new Map<string, number>();
  for (const t of tasks) origStart.set(t.id, t.startDay);

  const effEnd = new Map<string, number>();      // effective exclusive end (incl. weather idle)
  const weatherDelayOf = new Map<string, number>();
  const badDatesOf = new Map<string, string[]>();
  const visiting = new Set<string>();

  const floor = opts?.todayDay
    ?? (opts?.now
      ? (cal ? todayWorkingOrdinal(cal, opts.now) : rawTodayDay(projectStartDate, opts.now))
      : 1);

  // The task's own days, one per unit of duration. On a dated schedule each is
  // a WORKING day (a Saturday on a Mon-Fri week is never one of them, so rain
  // on it costs nothing); in raw-day mode every calendar day is a work day.
  function badDaysInWindow(startDay: number, durationDays: number): string[] {
    const out: string[] = [];
    for (let o = 0; o < Math.max(1, durationDays); o++) {
      const iso = dayIso(startDay, o);
      if (iso && badByDate.has(iso)) out.push(iso);
    }
    return out;
  }

  function resolve(id: string): number {
    const task = map.get(id);
    if (!task) return 0;
    const cached = effEnd.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) {
      // Dependency cycle — break it by treating this node at its authored end.
      return task.startDay + task.durationDays;
    }
    visiting.add(id);

    const links = depLinks(task).filter((l) => map.has(l.taskId));
    let newStart = task.startDay;
    if (links.length > 0) {
      let latest = 0;
      for (const link of links) {
        const dep = map.get(link.taskId)!;
        const depEnd = resolve(link.taskId);        // effective exclusive end (incl. weather)
        const depStart = dep.startDay;
        const lag = link.lagDays || 0;
        const type = link.type || 'FS';
        let es = 0;
        switch (type) {
          case 'FS': es = depEnd + lag; break;
          case 'SS': es = depStart + lag; break;
          case 'FF': es = depEnd + lag - task.durationDays; break;
          case 'SF': es = depStart + lag - task.durationDays; break;
          default: es = depEnd + lag;
        }
        latest = Math.max(latest, es);
      }
      if (latest > 0) newStart = latest;
    }
    if (newStart < 1) newStart = 1;

    // Pin done tasks and anything that already started — the plan stays the plan
    // for work in the past; we never reschedule completed/in-flight history.
    const pinned = task.status === 'done' || task.startDay < floor;
    if (pinned) newStart = task.startDay;

    task.startDay = newStart;

    let wd = 0;
    let bad: string[] = [];
    if (task.isWeatherSensitive && !pinned) {
      bad = badDaysInWindow(newStart, task.durationDays);
      wd = bad.length;
    }
    weatherDelayOf.set(id, wd);
    badDatesOf.set(id, bad);

    const end = newStart + task.durationDays + wd; // exclusive end, incl. weather idle days
    effEnd.set(id, end);
    visiting.delete(id);
    return end;
  }

  for (const t of tasks) resolve(t.id);

  // Project slip — compare new effective finish to original authored finish.
  let origFinish = 0;
  let newFinish = 0;
  for (const t of tasks) {
    origFinish = Math.max(origFinish, (origStart.get(t.id) ?? t.startDay) + t.durationDays);
    const m = map.get(t.id)!;
    newFinish = Math.max(newFinish, effEnd.get(t.id) ?? (m.startDay + m.durationDays));
  }
  const projectSlipDays = Math.max(0, newFinish - origFinish);

  // Impacts: any task whose start moved, or that absorbed weather idle days.
  const impacts: WeatherImpact[] = [];
  const affected = new Set<string>();
  for (const t of tasks) {
    const m = map.get(t.id)!;
    const original = origStart.get(t.id) ?? t.startDay;
    const startSlip = m.startDay - original;
    const wd = weatherDelayOf.get(t.id) ?? 0;
    if (startSlip === 0 && wd === 0) continue;
    const bad = badDatesOf.get(t.id) ?? [];
    for (const d of bad) affected.add(d);
    let worst: DayForecast['condition'] | undefined;
    for (const d of bad) {
      const c = badByDate.get(d)?.condition;
      if (c && (worst === undefined || CONDITION_SEVERITY[c] > CONDITION_SEVERITY[worst])) worst = c;
    }
    impacts.push({
      taskId: t.id,
      title: t.title,
      phase: t.phase,
      weatherDelayDays: wd,
      startSlipDays: startSlip,
      badDates: bad,
      worstCondition: worst,
      originalStartDay: original,
      newStartDay: m.startDay,
      directlyHit: wd > 0,
    });
  }
  impacts.sort((a, b) => (b.startSlipDays + b.weatherDelayDays) - (a.startSlipDays + a.weatherDelayDays));

  // Carry each affected date's provenance out with the result. The reschedule
  // math is identical for live and simulated days — what differs is whether
  // the resulting delay may be written down as documentation.
  const affectedDates = Array.from(affected).sort();
  const split = partitionDatesBySource(affectedDates, forecast);

  return {
    tasks: Array.from(map.values()),
    impacts,
    projectSlipDays,
    directHitCount: impacts.filter((i) => i.directlyHit).length,
    cascadedCount: impacts.filter((i) => !i.directlyHit && i.startSlipDays > 0).length,
    affectedDates,
    liveAffectedDates: split.live,
    simulatedAffectedDates: split.simulated,
    forecastSource: summarizeForecastSource(forecast),
  };
}

/** One-line summary for a banner / toast. Leads with the provenance when the
 *  forecast isn't fully live, so the number is never read as a real finding. */
export function summarizeWeatherImpact(r: WeatherRescheduleResult): string {
  if (r.impacts.length === 0) return 'No weather delays in the forecast window.';
  const d = r.projectSlipDays;
  const hit = r.directHitCount;
  const slip = d > 0 ? `${d} day${d === 1 ? '' : 's'}` : 'no net';
  const body = `${hit} weather-sensitive task${hit === 1 ? '' : 's'} hit · ${slip} project slip`;
  if (r.forecastSource === 'simulated') return `SIMULATED WEATHER — ${body}`;
  if (r.forecastSource === 'mixed') return `PARTLY SIMULATED — ${body}`;
  return body;
}

/**
 * Build a durable log entry from an applied reschedule (the "delay-day log").
 *
 * PROVENANCE RULE — the reason this can return null on a real impact:
 * weatherDelayLog is the record a GC hands an owner to justify a delay. A
 * delay day invented by getSimulatedForecast() has no relation to the jobsite,
 * so it is not evidence of anything.
 *
 *   • no live delay dates at all → null. Nothing is logged. The reschedule
 *     itself still applies (it's a planning aid); it just produces no
 *     documentation. No record beats a fabricated one.
 *   • some live, some simulated (the padded tail past OpenWeather's free
 *     5-day horizon) → an entry stamped `source: 'mixed'`, with `dates`
 *     holding ONLY the live-evidenced days and the invented ones quarantined
 *     in `simulatedDates`.
 *   • all live → `source: 'live'`.
 *
 * `source` is a required field on WeatherDelayLogEntry, so a reader can never
 * encounter one of these records without also seeing where it came from.
 */
export function buildWeatherDelayLog(
  r: WeatherRescheduleResult,
  idGen: () => string,
  now: string = new Date().toISOString(),
): WeatherDelayLogEntry | null {
  if (r.impacts.length === 0) return null;
  // Nothing real behind it → no record. (Today, with no OpenWeather key
  // configured, this is the normal path: every forecast is simulated, so the
  // delay log stays empty instead of filling with fiction.)
  if (r.liveAffectedDates.length === 0) return null;

  let worst: DayForecast['condition'] | undefined;
  for (const i of r.impacts) {
    if (i.worstCondition && (worst === undefined || CONDITION_SEVERITY[i.worstCondition] > CONDITION_SEVERITY[worst])) {
      worst = i.worstCondition;
    }
  }
  const simulated = r.simulatedAffectedDates;
  const mixed = simulated.length > 0;
  return {
    id: idGen(),
    appliedAt: now,
    dates: r.liveAffectedDates,
    condition: worst,
    taskIds: r.impacts.map((i) => i.taskId),
    projectSlipDays: r.projectSlipDays,
    source: mixed ? 'mixed' : 'live',
    ...(mixed ? { simulatedDates: simulated } : {}),
    ...(mixed
      ? {
          note:
            `${simulated.length} of ${r.affectedDates.length} delay day${r.affectedDates.length === 1 ? '' : 's'} ` +
            'came from SIMULATED weather (beyond live forecast coverage) and are excluded from the evidenced dates.',
        }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The "Push them" banner (components/schedule/WeatherReschedulePrompt.tsx).
// Lives here, pure, so the day-scale rule is executed by a validator instead of
// being trusted inside a component.
// ─────────────────────────────────────────────────────────────────────────────

export interface WeatherPushConflict {
  task: ScheduleTask;
  hitDay: DayForecast;
  /** How far to push the task's startDay so none of its days is un-workable.
   *  WORKING days on a dated schedule (the unit startDay is in); calendar days
   *  in raw-day mode, where the two coincide. */
  suggestedPushDays: number;
}

/**
 * Dated schedule: the smallest push, in WORKING days, after which none of the
 * task's working days is an un-workable forecast day. Bound at 14 like the raw
 * walk below. The result is added straight onto `startDay`, which is a working
 * ordinal — so a push never lands the task on a weekend it does not work, and
 * a push across a weekend is not inflated by the two days nobody works.
 */
export function findFirstWorkablePushWorkingDays(
  calendar: ScheduleCalendar,
  startDay: number,
  durationDays: number,
  forecasts: DayForecast[],
): number {
  for (let push = 1; push <= 14; push++) {
    let allWorkable = true;
    for (let offset = 0; offset < Math.max(1, durationDays); offset++) {
      const iso = taskCalendarDay(calendar, startDay + push, offset);
      const day = iso ? forecasts.find(f => f.date === iso) : undefined;
      if (day && !day.isWorkable) {
        allWorkable = false;
        break;
      }
    }
    if (allWorkable) return push;
  }
  return 1;
}

/** RAW-DAY MODE ONLY (no schedule start date — every calendar day is a work
 *  day). The banner's original calendar walk, keyed EXACTLY like
 *  findWeatherRisk's raw path (local start + n days, then its ISO day) so the
 *  push and the risk it answers can never disagree about which day is which.
 *  The old walk re-parsed a `toISOString()` day with `new Date(iso)` (UTC
 *  midnight) — the validate-calendar-date UNRESOLVED defect; that round trip
 *  is gone. */
function findFirstWorkableOffset(
  projectStartDate: Date,
  startDay: number,
  durationDays: number,
  forecasts: DayForecast[],
): number {
  // Try shifting by 1, 2, 3 days until the entire task window has no
  // un-workable forecast day. Bound at 14 days so we don't loop forever
  // when the forecast is all bad.
  for (let push = 1; push <= 14; push++) {
    let allWorkable = true;
    for (let offset = 0; offset < durationDays; offset++) {
      const d = new Date(projectStartDate.getTime());
      d.setDate(d.getDate() + (startDay - 1) + push + offset);
      const iso = d.toISOString().split('T')[0];
      const day = forecasts.find(f => f.date === iso);
      if (day && !day.isWorkable) {
        allWorkable = false;
        break;
      }
    }
    if (allWorkable) return push;
  }
  return 1;
}

/**
 * Weather-sensitive, not-yet-started, non-summary tasks whose days hit an
 * un-workable forecast day, with the push that clears them. `calendar` as in
 * computeWeatherReschedule: dated ⇒ working days throughout; omitted/undated ⇒
 * raw calendar offsets.
 */
export function findWeatherPushConflicts(
  tasks: readonly ScheduleTask[],
  forecasts: DayForecast[],
  projectStartDate: Date,
  calendar?: ScheduleCalendar,
): WeatherPushConflict[] {
  if (forecasts.length === 0) return [];
  const cal = calendar && scheduleAnchorDate(calendar) ? calendar : undefined;
  const out: WeatherPushConflict[] = [];
  for (const task of tasks) {
    if (task.isSummary) continue;
    if (!task.isWeatherSensitive) continue;
    // Already started — pushing won't help.
    if ((task.progress ?? 0) > 0) continue;
    const risk = findWeatherRisk(projectStartDate, task.startDay, task.durationDays, forecasts, cal);
    if (!risk) continue;
    if (cal) {
      out.push({ task, hitDay: risk, suggestedPushDays: findFirstWorkablePushWorkingDays(cal, task.startDay, task.durationDays, forecasts) });
      continue;
    }
    out.push({ task, hitDay: risk, suggestedPushDays: findFirstWorkableOffset(projectStartDate, task.startDay, task.durationDays, forecasts) });
  }
  return out;
}
