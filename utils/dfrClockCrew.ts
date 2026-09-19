// dfrClockCrew.ts — the daily report's crew roster, from the time clock.
//
// THE GAP (audit round 2, field-ops #10). The daily report filled manpower
// only from the schedule PLAN: trade = task crew/sub/phase, headcount =
// crewSize, hours = a hardcoded 8. Meanwhile the time clock had already
// recorded who was on this job today and for how long. So a day with three
// framers and a laborer clocked 6:30–4:00 went out to the owner as
// "Framing × 4, 8 hrs" while the payroll export said 3 + 1 × 9 h — two records
// from the same app, same day, that contradict each other in a delay or
// back-charge dispute.
//
// ── WHICH SHIFTS COUNT ──────────────────────────────────────────────────────
// Finished shifts are picked with utils/laborSamples.isEligibleLaborEntry, the
// filter the cost book already uses, so the report and the book count the
// same shifts the same way. A shift still running (clocked_in / break) is not
// eligible there — its hours are provisional — but the person IS on site, so
// they count toward headcount with hours elapsed so far, and the result says
// how many are still on the clock so the chip can label those hours.
//
// ── WHICH DAY A SHIFT BELONGS TO ────────────────────────────────────────────
// The LOCAL calendar day of `clockIn`, never `TimeEntry.date`: that field was
// written as the UTC day, so a US crew clocking in after ~5–8 pm is filed
// under tomorrow and a join on it would move them onto the next day's report.
// 'unassigned' clock-ins carry no job and never land on a project's report.
//
// ── WHY THE ROWS CARRY THE GC's COMPANY NAME ────────────────────────────────
// utils/crewPresence tracks presence by trade AND company. A clocked "Framing"
// row with an empty company would read as the same crew as a sub's schedule
// row for framing with no company, and a mixed day would count the trade
// twice. Stamping the GC's own name keeps self-perform and sub crews apart.
//
// ── OVERTIME (#65) ──────────────────────────────────────────────────────────
// The overtime on each row is the ALLOCATED figure from utils/overtime —
// worked out per worker across every shift in `entries` (all jobs, so pass
// the whole mirror, not this job's rows), under the GC's rule (weekly >40 by
// default, daily >8 optional) — never the per-shift number stored on the row,
// which counted "past 8 in this one shift" and went stale the moment another
// shift landed the same day or week. Open shifts count with their hours so far.
// A DFR row's overtime is therefore "so far this payroll week" until the week
// ends; the caller that knows the GC's rule passes it (default: federal).
//
// Pure — no storage, no network. Pinned by scripts/validate-dfr-field-sources.ts.

import type { TimeEntry } from '@/types';
import { isEligibleLaborEntry, normalizeTradeKey } from '@/utils/laborSamples';
import { toCalendarDayString } from '@/utils/calendarDate';
import { computeOvertime, openShiftHours, overtimeFor, DEFAULT_OVERTIME_RULE, type OvertimeRule } from '@/utils/overtime';

/** Company label for clocked rows when the GC has not set a company name. */
export const OWN_CREW_FALLBACK_COMPANY = 'Own crew';

export interface ClockCrewRow {
  trade: string;
  company: string;
  /** Distinct workers clocked on this trade that day. */
  headcount: number;
  /** Hours PER PERSON (total ÷ headcount) — ManpowerEntry's contract:
   *  headcount × hoursWorked is the man-hours the portal and crewPresence sum. */
  hoursWorked: number;
  totalHours: number;
  overtimeHours: number;
  /** Workers whose shift is still open — their hours are "so far". */
  liveCount: number;
}

export interface ClockCrew {
  rows: ClockCrewRow[];
  people: number;
  totalHours: number;
  overtimeHours: number;
  liveCount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The local calendar day a shift was worked, from its clock-in instant.
 *  Same rule as hooks/useTimeEntries.timeEntryDay, copied rather than imported
 *  because that module pulls in react-native/expo and this one must stay pure. */
export function clockInLocalDay(entry: Pick<TimeEntry, 'clockIn' | 'date'>): string {
  if (entry.clockIn) {
    const d = new Date(entry.clockIn);
    if (!Number.isNaN(d.getTime())) return toCalendarDayString(d);
  }
  return entry.date;
}


/**
 * Crew on `projectId` for the calendar day `day` (YYYY-MM-DD), grouped by
 * normalized trade. Null when nobody clocked in — the caller then falls back
 * to the schedule plan.
 */
export function clockCrewForDay(
  entries: readonly TimeEntry[] | null | undefined,
  projectId: string,
  day: string,
  companyName: string | null | undefined,
  nowMs: number = Date.now(),
  overtimeRule: OvertimeRule = DEFAULT_OVERTIME_RULE,
): ClockCrew | null {
  if (!projectId || projectId === 'unassigned' || !day) return null;
  const company = (companyName ?? '').trim() || OWN_CREW_FALLBACK_COMPANY;
  const ot = computeOvertime(entries ?? [], overtimeRule, { liveNowMs: nowMs });

  interface Group { trade: string; workers: Set<string>; live: Set<string>; total: number; overtime: number }
  const groups = new Map<string, Group>();
  const everyone = new Set<string>();
  const liveEveryone = new Set<string>();

  for (const e of entries ?? []) {
    if (!e || e.projectId !== projectId) continue;
    if (clockInLocalDay(e) !== day) continue;
    const open = (e.status === 'clocked_in' || e.status === 'break') && !e.clockOut;
    let total: number;
    let overtime: number;
    if (isEligibleLaborEntry(e)) {
      total = e.totalHours;
      overtime = Math.min(total, overtimeFor(ot, e.id));
    } else if (open) {
      total = openShiftHours(e, nowMs);
      overtime = Math.min(total, overtimeFor(ot, e.id));
    } else {
      continue; // a finished shift with no hours is not evidence of anyone
    }
    // Manual/voice entries are all workerId 'self'; the name tells them apart.
    const who = e.workerId && e.workerId !== 'self' ? e.workerId : `self:${(e.workerName ?? '').trim().toLowerCase()}`;
    const key = normalizeTradeKey(e.trade);
    let g = groups.get(key);
    if (!g) {
      g = { trade: key === 'general' ? 'General labor' : (e.trade ?? '').trim(), workers: new Set(), live: new Set(), total: 0, overtime: 0 };
      groups.set(key, g);
    }
    g.workers.add(who);
    g.total += total;
    g.overtime += overtime;
    everyone.add(who);
    if (open) { g.live.add(who); liveEveryone.add(who); }
  }

  if (groups.size === 0) return null;
  const rows: ClockCrewRow[] = Array.from(groups.values()).map(g => ({
    trade: g.trade,
    company,
    headcount: g.workers.size,
    hoursWorked: round2(g.total / g.workers.size),
    totalHours: round2(g.total),
    overtimeHours: round2(g.overtime),
    liveCount: g.live.size,
  }));
  return {
    rows,
    people: everyone.size,
    totalHours: round2(rows.reduce((s, r) => s + r.totalHours, 0)),
    overtimeHours: round2(rows.reduce((s, r) => s + r.overtimeHours, 0)),
    liveCount: liveEveryone.size,
  };
}

/** The provenance line the super reads above the roster he is about to sign. */
export function clockCrewSourceLine(crew: ClockCrew, subRowsFromSchedule: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  let line = `From the time clock: ${crew.people} ${crew.people === 1 ? 'person' : 'people'}, ${fmt(crew.totalHours)} h`;
  if (crew.overtimeHours > 0) line += ` (${fmt(crew.overtimeHours)} h overtime)`;
  if (crew.liveCount > 0) line += ` · ${crew.liveCount} still on the clock, hours so far`;
  if (subRowsFromSchedule > 0) line += ` · sub crews from today's schedule plan`;
  return `${line}. Tap a row to correct it.`;
}

/**
 * The warning a report carries while shifts it counted are still open. An open
 * shift's hours are "so far" — computed when the roster was filled — and
 * ManpowerEntry has no provisional flag, so once saved they read on the PDF and
 * the portal as the day's hours. Null when there is nothing to warn about: no
 * one on the clock, or the roster holds none of the clock's rows (the super
 * replaced them with his own count).
 */
export function liveClockHoursWarning(
  crew: ClockCrew | null | undefined,
  manpower: readonly { trade?: string; company?: string }[],
): string | null {
  if (!crew || crew.liveCount <= 0) return null;
  const liveRows = crew.rows.filter(r => r.liveCount > 0);
  const onReport = manpower.some(m => liveRows.some(r =>
    (m.company ?? '').trim().toLowerCase() === r.company.trim().toLowerCase()
    && normalizeTradeKey(m.trade) === normalizeTradeKey(r.trade)));
  if (!onReport) return null;
  const n = crew.liveCount;
  return `${n} ${n === 1 ? 'person is' : 'people are'} still on the clock — the crew hours on this report are hours so far, not the full shift. Correct the rows after they clock out, or they save as the day's hours.`;
}

/**
 * Stable ids for the auto-seeded crew roster. While anyone is still clocked
 * in, app/daily-report.tsx re-seeds the untouched roster every minute (the
 * "hours so far" move). Ids built from Date.now() changed on every re-seed, so
 * a correction the super was typing into the Edit Crew modal — which holds the
 * row's id — matched nothing on Save and was silently dropped, and so was a
 * Remove he was confirming. Deriving the id from the row's own key means a
 * re-seed of the same crew hands back the same ids. `kind` keeps a clock row
 * and a plan row for the same trade apart; a repeated key gets a counter so
 * React keys stay unique.
 */
export function seedRowIds(
  kind: 'clock' | 'sub' | 'plan',
  rows: readonly { trade?: string; company?: string }[],
): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `seed-${kind}-${normalizeTradeKey(r.trade)}|${(r.company ?? '').trim().toLowerCase()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/**
 * "Copy from yesterday" for the crew roster. Yesterday's rows are the point of
 * the button — the subs and the plan rarely change overnight — but the rows
 * THIS day's time clock wrote (ids from seedRowIds('clock', …)) are what was
 * witnessed today, and replacing them with yesterday's crew and yesterday's
 * hours put yesterday's man-hours on today's signed report. So: today's clock
 * rows stay, yesterday's own clock rows are dropped (that was yesterday's
 * clock, not today's), and yesterday's sub / plan / typed rows carry forward.
 *
 * Yesterday's clock rows are dropped even when nobody has clocked in yet. A
 * morning tap used to be a plain copy, so yesterday's measured man-hours sat
 * on today's roster under a clock id, the roster no longer matched the
 * auto-seed, and the clock never replaced them — today's signed report went
 * out with yesterday's hours. Until today's clock has rows, the self-perform
 * rows are today's plan seed (seed-plan-* rows already on the roster) or
 * whatever the super types.
 */
export function carryForwardManpower<T extends { id: string }>(yesterday: readonly T[], current: readonly T[]): T[] {
  const isClock = (r: T) => r.id.startsWith('seed-clock-');
  const todayClock = current.filter(isClock);
  const carried = yesterday.filter(r => !isClock(r));
  if (todayClock.length === 0) {
    // Yesterday's version of a plan row wins (that is the button's point);
    // today's plan rows fill in only what yesterday did not have.
    const carriedIds = new Set(carried.map(r => r.id));
    return [...carried, ...current.filter(r => r.id.startsWith('seed-plan-') && !carriedIds.has(r.id))];
  }
  const ids = new Set(todayClock.map(r => r.id));
  return [...todayClock, ...carried.filter(r => !ids.has(r.id))];
}

/**
 * The clock's rows for the day that the roster does not carry (matched on
 * trade + company, like liveClockHoursWarning). Once the super has touched the
 * roster — a morning "Copy from yesterday" is enough — the auto-seed never
 * runs again for that report, reopen included, so the crew that clocks in
 * after it never reached the roster and the signed report could contradict
 * payroll with nothing said (integration round 1). The screen shows these and
 * offers to add them; it never adds them by itself over his count.
 */
export function clockRowsMissingFromRoster(
  crew: ClockCrew | null | undefined,
  manpower: readonly { trade?: string; company?: string }[],
): ClockCrewRow[] {
  if (!crew) return [];
  return crew.rows.filter(r => !manpower.some(m =>
    (m.company ?? '').trim().toLowerCase() === r.company.trim().toLowerCase()
    && normalizeTradeKey(m.trade) === normalizeTradeKey(r.trade)));
}

/** The line above the roster when the clock has people it does not carry. */
export function clockRosterGapLine(missing: readonly ClockCrewRow[]): string | null {
  if (missing.length === 0) return null;
  const n = missing.reduce((s, r) => s + r.headcount, 0);
  return `The time clock has ${n} ${n === 1 ? 'person' : 'people'} on this job for this day who ${n === 1 ? 'is' : 'are'} not on this roster.`;
}

/**
 * The roster with the missing clock rows added. The plan's self-perform
 * guesses (seed-plan-* rows with no company, or the GC's own) go, because the
 * clock now measures that same crew and keeping both counts it twice — the
 * seed's own rule. Sub rows, typed rows and carried rows stay.
 */
export function addClockRowsToRoster<T extends { id: string; trade: string; company: string; headcount: number; hoursWorked: number }>(
  manpower: readonly T[],
  crew: ClockCrew,
  ownCompany: string | null | undefined,
  make: (row: { id: string; trade: string; company: string; headcount: number; hoursWorked: number }) => T,
): T[] {
  const missing = clockRowsMissingFromRoster(crew, manpower);
  if (missing.length === 0) return [...manpower];
  const own = (ownCompany ?? '').trim().toLowerCase();
  const kept = manpower.filter(m => !(m.id.startsWith('seed-plan-')
    && (!m.company.trim() || m.company.trim().toLowerCase() === own)));
  const allIds = seedRowIds('clock', crew.rows);
  const taken = new Set(kept.map(m => m.id));
  const added = missing.map((r) => {
    let id = allIds[crew.rows.indexOf(r)];
    while (taken.has(id)) id = `${id}+`;
    taken.add(id);
    return make({ id, trade: r.trade, company: r.company, headcount: r.headcount, hoursWorked: r.hoursWorked });
  });
  return [...kept, ...added];
}
