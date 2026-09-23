// timeClockPayroll.ts — the pure rules behind the time clock's payroll export,
// its forgotten-clock-out handling and its offline-safe server pull.
//
// Pure — no React, no react-native, no storage — so scripts/validate-time-
// clock-*.ts can run every rule under bun. hooks/useTimeEntries.ts and
// app/time-tracking.tsx are the only callers.
//
// Days are LOCAL calendar days ('YYYY-MM-DD', utils/calendarDate) compared as
// strings. Never Date math on an ISO string's date half: that is the UTC day,
// which names tomorrow for any shift punched after ~5 pm Pacific (field-ops #9).

import type { TimeEntry } from '@/types';
import { addCalendarDays, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import {
  computeOvertime, overtimeFor, describeOvertimeRule, openShiftHours, payrollWeekStart, shiftWorkDay,
  isMissedOpenShift, missedClockOutHours as missedClockOutHoursRule,
  DEFAULT_OVERTIME_RULE, type OvertimeRule, type Weekday,
} from '@/utils/overtime';

/**
 * Hours for a clock-in/clock-out pair minus break minutes. The implementation
 * behind hooks/useTimeEntries.computeShiftHours (re-exported there — see the
 * note on it about the legacy per-shift overtime figure nothing reads).
 */
export function computeShiftHours(clockIn: string, clockOut: string, breakMinutes: number): { totalHours: number; overtimeHours: number } {
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const grossHours = Math.max(0, ms / 3_600_000);
  const totalHours = Math.max(0, grossHours - breakMinutes / 60);
  const overtimeHours = Math.max(0, totalHours - 8);
  return {
    totalHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
  };
}

// ── Live hours (#152) ────────────────────────────────────────────────────
//
// The card's timer used to be clock-in → now, gross: a worker with a 60-min
// break at 8.5 h elapsed read "8h 30m" beside a banner saying "0.5h to 8h
// shift", and during a break the break itself kept counting as work
// (breakMinutes only grows when the break ends). One definition now serves the
// timer, the threshold banner, the Clock Out confirm and Hours Today.

function isOpenShift(e: Pick<TimeEntry, 'status' | 'clockOut'>): boolean {
  return e.status !== 'clocked_out' && !e.clockOut;
}

/** Net hours on the clock so far: finished breaks AND the break in progress
 *  are taken off. 0 for a finished shift (read totalHours for that). */
export function liveNetHours(entry: TimeEntry, nowMs: number): number {
  if (!isOpenShift(entry)) return 0;
  return openShiftHours(entry, nowMs);
}

/** "7h 30m" from decimal hours. */
export function formatHoursMinutes(hours: number): string {
  const totalMin = Math.max(0, Math.floor(hours * 60 + 1e-6));
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

/**
 * The minutes of break a clock-out right now would record: the finished breaks
 * plus the one still running. clockOut used to pass only breakMinutes, so a
 * worker clocked out straight from 'break' was paid for the open break.
 */
export function breakMinutesAt(entry: Pick<TimeEntry, 'status' | 'breakMinutes' | 'breakStartedAt'>, outMs: number): number {
  let mins = Math.max(0, entry.breakMinutes || 0);
  if (entry.status === 'break' && entry.breakStartedAt) {
    const bs = Date.parse(entry.breakStartedAt);
    if (Number.isFinite(bs)) mins += Math.max(0, Math.round((outMs - bs) / 60_000));
  }
  return mins;
}

// ── Missed clock-out (#66) ───────────────────────────────────────────────
//
// A forgotten clock-out used to sit "On Site" for days (production had one open
// 118 days), block that worker from being clocked in again, and — when finally
// tapped — book every elapsed hour into payroll and job cost. The shift is now
// flagged, leaves the On Site count, stops blocking a new clock-in, and its
// Clock Out asks for the real out time.

/** Net hours past which an open shift is certainly forgotten, whatever the day.
 *  The rule lives in utils/overtime (#41 — the live OT allocation needs it and
 *  cannot import this module back); re-exported for every existing caller. */
export const missedClockOutHours = missedClockOutHoursRule;

/**
 * An open shift that started on an earlier LOCAL day than today, or has run
 * more net hours than max(alert + 2, 14). The day test uses calendar days, so
 * a shift clocked in at 11 pm reads as missed after midnight — its Clock Out
 * then asks for the time (with "now" one tap away) instead of guessing.
 * One rule with the live overtime split (utils/overtime.isMissedOpenShift), so
 * a shift the screen calls "missed" is never also counted as hours so far.
 */
export function isMissedClockOut(entry: TimeEntry, nowMs: number, alertHours: number): boolean {
  if (!isOpenShift(entry)) return false;
  return isMissedOpenShift(entry, nowMs, alertHours);
}

/** End of the clock-in's local day (23:59), as epoch ms. */
function endOfClockInDayMs(clockInMs: number): number {
  const d = new Date(clockInMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, 0).getTime();
}

/**
 * The out time the missed-clock-out sheet offers first: clock-in + the alert
 * hours + the break taken, clamped to the clock-in day, never before the
 * clock-in and never after now.
 */
export function defaultMissedOutMs(entry: TimeEntry, alertHours: number, nowMs: number): number {
  const inMs = Date.parse(entry.clockIn);
  if (!Number.isFinite(inMs)) return nowMs;
  const guess = inMs + alertHours * 3_600_000 + Math.max(0, entry.breakMinutes || 0) * 60_000;
  const clamped = Math.min(guess, endOfClockInDayMs(inMs), nowMs);
  return Math.max(inMs, clamped);
}

/** Why an entered out time can't be saved, or null when it can. */
export function outTimeProblem(entry: Pick<TimeEntry, 'clockIn'>, outMs: number, nowMs: number): string | null {
  const inMs = Date.parse(entry.clockIn);
  if (!Number.isFinite(outMs)) return 'Enter the time he left, e.g. 3:30 pm.';
  if (Number.isFinite(inMs) && outMs <= inMs) return 'The out time has to be after the clock-in.';
  if (outMs > nowMs + 60_000) return 'The out time can’t be later than now.';
  if (Number.isFinite(inMs) && outMs - inMs > 24 * 3_600_000) return 'A shift can’t run past 24 hours. Pick a time within a day of the clock-in.';
  return null;
}

/**
 * Read a typed wall-clock time — "15:30", "3:30 pm", "3pm", "0730" — as minutes
 * after midnight. null when it is not a time.
 */
export function parseClockTime(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
    if (ap.startsWith('p')) h += 12;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

/** The epoch ms of `minutes` after midnight on the clock-in's local day,
 *  plus `dayOffset` days (1 = the next day, for a shift past midnight). */
export function outMsOnClockInDay(clockIn: string, minutes: number, dayOffset = 0): number {
  const d = new Date(clockIn);
  if (Number.isNaN(d.getTime())) return NaN;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
}

/** "3:30 pm" for an epoch ms, local wall clock. */
export function formatClockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// ── Adjusted rows (#151) ─────────────────────────────────────────────────
//
// The Correct sheet changes HOURS and keeps the punch stamps — the stamps are
// the audit record a GC needs in a wage dispute, so they are never rewritten to
// make the row "look" consistent. Instead the gap is shown: when the stamps
// minus the break don't make the hours, the row is flagged, on screen and in
// the CSV, with the punched figure beside it. Derived from the stored stamps,
// so rows corrected before this build are flagged too.

/** The hours the punch stamps make (clock-out − clock-in − break), or null for
 *  a row that has no usable pair. */
export function punchedHours(e: Pick<TimeEntry, 'clockIn' | 'clockOut' | 'breakMinutes'>): number | null {
  if (!e.clockIn || !e.clockOut) return null;
  if (!Number.isFinite(Date.parse(e.clockIn)) || !Number.isFinite(Date.parse(e.clockOut))) return null;
  return computeShiftHours(e.clockIn, e.clockOut, e.breakMinutes || 0).totalHours;
}

/** A finished row whose recorded hours differ from what its stamps make by
 *  more than 0.005 h. */
export function isAdjustedEntry(e: TimeEntry): boolean {
  if (e.status !== 'clocked_out') return false;
  const p = punchedHours(e);
  if (p === null) return false;
  return Math.abs(p - (e.totalHours || 0)) > 0.005;
}

// ── Pay period + job (#64) ───────────────────────────────────────────────

export interface PayPeriod { start: string; end: string }

/** The payroll week holding `today`, moved `offsetWeeks` (−1 = last week). */
export function payWeekRange(today: string, weekStartsOn: Weekday, offsetWeeks = 0): PayPeriod {
  const start = parseCalendarDay(payrollWeekStart(today, weekStartsOn));
  if (!start) return { start: today, end: today };
  const s = addCalendarDays(start, offsetWeeks * 7);
  return { start: toCalendarDayString(s), end: toCalendarDayString(addCalendarDays(s, 6)) };
}

export interface PayrollSelection<T extends TimeEntry = TimeEntry> {
  /** Finished shifts in the period (and job) — what the export writes. */
  rows: T[];
  /** Shifts still on the clock in the period — NOT exported, named instead. */
  open: T[];
}

/**
 * The shifts a payroll export for [startDay, endDay] holds: FINISHED shifts
 * whose local work day is in range (and on `projectId`, when given). Shifts
 * still on the clock come back separately so the screen can say "2 crew still
 * on the clock (Mike, Jose) — not included" instead of exporting them at 0.00 h.
 * The export used to dump every shift ever logged, so each week's CSV repeated
 * all the earlier weeks and payroll paid them twice.
 */
export function selectPayrollEntries<T extends TimeEntry>(
  entries: readonly T[],
  startDay: string,
  endDay: string,
  opts: { projectId?: string | null } = {},
): PayrollSelection<T> {
  const rows: T[] = [];
  const open: T[] = [];
  for (const e of entries) {
    if (opts.projectId && e.projectId !== opts.projectId) continue;
    const day = shiftWorkDay(e);
    if (!day || day < startDay || day > endDay) continue;
    if (e.status === 'clocked_out') rows.push(e);
    else open.push(e);
  }
  rows.sort((a, b) => shiftWorkDay(a).localeCompare(shiftWorkDay(b)) || a.clockIn.localeCompare(b.clockIn));
  return { rows, open };
}

/** 'time-entries-2026-09-08-to-2026-09-14.csv' — calendar days only, so no
 *  locale slash ever lands in a file name. */
export function payrollFileName(period: PayPeriod, projectName?: string | null): string {
  const slug = (projectName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `time-entries-${period.start}-to-${period.end}${slug ? `-${slug}` : ''}.csv`;
}

export function payrollTitle(period: PayPeriod, projectName?: string | null): string {
  return `Time entries ${period.start} to ${period.end}${projectName ? ` — ${projectName}` : ''}`;
}

/** Why an export can't run, or null when it can. */
export function payrollBlockedReason(sel: PayrollSelection, period: PayPeriod): string | null {
  if (sel.rows.length > 0) return null;
  if (sel.open.length > 0) {
    return `Nobody has finished a shift between ${period.start} and ${period.end} yet — ${sel.open.length} still on the clock. Clock them out first.`;
  }
  return `No finished shifts between ${period.start} and ${period.end}. Pick another week or job.`;
}

/** "2 crew still on the clock (Mike, Jose) — not included". */
export function openShiftsNote(open: readonly TimeEntry[]): string | null {
  if (open.length === 0) return null;
  const names = [...new Set(open.map(e => e.workerName).filter(Boolean))];
  return `${open.length} crew still on the clock${names.length ? ` (${names.join(', ')})` : ''} — not included`;
}

// ── The CSV ──────────────────────────────────────────────────────────────

/** Clock time for the payroll CSV: the LOCAL wall clock, 'YYYY-MM-DD HH:MM'
 *  (24h). An unparseable value passes through unchanged. */
export function formatClockForCsv(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${toCalendarDayString(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A row the export writes, with who logged it when it was not this user
 *  (#63: crew clocked by his foreman on his own jobs). */
export type PayrollRow = TimeEntry & { loggedByLabel?: string };

/**
 * The payroll CSV. Columns:
 *   Date, Worker, Trade, Project, Clock In, Clock Out, Break (min), Hours,
 *   Overtime (<rule>), OT status, Adjusted, Logged by, Notes
 *
 * - Overtime is ALLOCATED under the GC's rule across `allEntries` (every shift
 *   the device knows for each worker, all jobs), never the stored per-shift
 *   figure (#65). 'so far' marks a payroll week that has not ended.
 * - Adjusted names the punched hours when a correction changed the hours but
 *   left the stamps (#151), so a bookkeeper who works hours out from the
 *   stamps sees why they differ.
 * - Logged by is blank for the user's own clock-ins and names whoever else
 *   clocked the shift on his job (#63) — a labelled column, never a silent
 *   merge, so a foreman's own export and the GC's can't both pay it unseen.
 *   A legacy row filed under no real job (project id not a uuid, #155) says
 *   'Not synced — this device only' there too: the server refused it, so no
 *   other device or export has it, and the screen's label must reach the file.
 *
 * Date is the local day the shift was worked; clock columns are local wall
 * clock. This is a plain CSV for a spreadsheet or a payroll service's CSV
 * import — not a QuickBooks timesheet import format.
 */
export function buildTimeEntriesCSV(
  entries: readonly PayrollRow[],
  overtimeRule: OvertimeRule = DEFAULT_OVERTIME_RULE,
  allEntries: readonly TimeEntry[] = entries,
): string {
  const escape = (v: string | undefined): string => {
    if (!v) return '';
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };
  const ot = computeOvertime(allEntries, overtimeRule);
  const header = [
    'Date', 'Worker', 'Trade', 'Project', 'Clock In', 'Clock Out', 'Break (min)', 'Hours',
    `Overtime (${describeOvertimeRule(ot.rule)})`, 'OT status', 'Adjusted', 'Logged by', 'Notes',
  ].map(h => escape(h)).join(',');
  const rows = entries.map(e => {
    const punched = punchedHours(e);
    return [
      escape(shiftWorkDay(e)),
      escape(e.workerName),
      escape(e.trade),
      escape(e.projectName),
      escape(formatClockForCsv(e.clockIn)),
      escape(formatClockForCsv(e.clockOut)),
      String(e.breakMinutes || 0),
      (e.totalHours || 0).toFixed(2),
      overtimeFor(ot, e.id).toFixed(2),
      ot.provisional.has(e.id) ? 'so far' : '',
      isAdjustedEntry(e) && punched !== null ? escape(`Adjusted (punched ${punched.toFixed(2)})`) : '',
      escape(payrollLoggedByCell(e)),
      escape(e.notes),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

/** The Logged by cell: who clocked it (#63), plus the not-synced marker for a
 *  legacy row the server never accepted (#155). */
export function payrollLoggedByCell(e: PayrollRow): string {
  const parts = [e.loggedByLabel?.trim(), isUuid(e.projectId) ? '' : 'Not synced \u2014 this device only']
    .filter((p): p is string => !!p);
  return parts.join('; ');
}

/** The same rows tab-separated, for a clipboard paste that splits into
 *  columns in Excel (the fallback when no file can be handed over). */
export function csvToTsv(csv: string): string {
  const out: string[] = [];
  for (const line of csv.split('\n')) {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    out.push(cells.map(s => s.replace(/\t/g, ' ')).join('\t'));
  }
  return out.join('\n');
}

// ── The offline-safe pull (#67) ─────────────────────────────────────────
//
// The pull used to be "server wins" for every id. When he clocked Jose out in a
// dead zone, the UPDATE sat in the queue; if the foreground pull's SELECT
// returned before the flush landed, the server's clocked_in row replaced the
// local clocked_out one — Jose was "Working" again, the 8h alert re-posted, and
// a second Clock Out overwrote the real hours. A correction saved offline was
// reverted the same way. (ProjectContext's mergeLocalOnly only keeps local rows
// the server does NOT have — here the server has the row, so it needs
// local-wins-while-pending.)

/** Options for the own-timesheet pull (#103). The team pull passes none. */
export interface MergeServerPullOptions<T> {
  /** Stamp every row the server returned with this instant as
   *  `seenOnServerAt`: from then on the device KNOWS the row reached the
   *  server, so its later absence means it was deleted there. */
  seenAt?: string;
  /** A local row the server did NOT return is dropped when this says so.
   *  Pass it only for a COMPLETE pull (see timeEntryGoneFromServer). */
  pruneMissing?: (e: T) => boolean;
}

/**
 * Merge a server pull into the device copy:
 *   • an id with a queued write (`pendingIds` — the union read before AND after
 *     the SELECT) keeps the LOCAL row: the server copy predates that write;
 *   • an id with a queued DELETE is dropped from both sides, so an entry
 *     deleted offline does not come back on the same pull;
 *   • every other server row wins; a local row the server lacks is kept (an
 *     offline clock-in not yet flushed) — UNLESS `opts.pruneMissing` says it
 *     was deleted on another device (#103).
 */
export function mergeServerPull<T extends { id: string; seenOnServerAt?: string }>(
  local: readonly T[],
  fromServer: readonly T[],
  pendingIds: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
  opts: MergeServerPullOptions<T> = {},
): T[] {
  const byId = new Map<string, T>();
  const localById = new Map<string, T>();
  for (const e of local) {
    if (deletedIds.has(e.id) || localById.has(e.id)) continue;
    localById.set(e.id, e);
    byId.set(e.id, e);
  }
  const serverIds = new Set<string>();
  for (const s of fromServer) {
    if (deletedIds.has(s.id)) continue;
    serverIds.add(s.id);
    const mine = localById.get(s.id);
    const row = pendingIds.has(s.id) && mine ? mine : s;
    byId.set(s.id, opts.seenAt ? { ...row, seenOnServerAt: opts.seenAt } : row);
  }
  if (opts.pruneMissing) {
    for (const e of localById.values()) {
      if (!serverIds.has(e.id) && opts.pruneMissing(e)) byId.delete(e.id);
    }
  }
  return Array.from(byId.values());
}

/**
 * #103: may a local shift the server did not return be dropped as "deleted on
 * another device"? A shift deleted on the web used to stay on every other
 * device forever — paid in that phone's payroll CSV, costed in Job Costing.
 * Only when ALL of these hold, because each missing guard deletes real hours:
 *   • the pull was COMPLETE (every page read — an unpaged SELECT is silently
 *     cut at PostgREST's max_rows, and the oldest shifts would look deleted);
 *   • the row carries `seenOnServerAt` — the device saw it on the server
 *     before, so it is not an offline clock-in still on its way up, nor an
 *     insert whose queued write failed (dropping that destroys the only copy);
 *   • its project id is a uuid — a legacy 'unassigned' row never reaches the
 *     server by design (#155) and would otherwise vanish from payroll;
 *   • no write for it is queued or in flight (`pendingIds`).
 */
export function timeEntryGoneFromServer(
  e: Pick<TimeEntry, 'id' | 'projectId' | 'seenOnServerAt'>,
  pendingIds: ReadonlySet<string>,
  pullComplete: boolean,
): boolean {
  return pullComplete && !!e.seenOnServerAt && isUuid(e.projectId) && !pendingIds.has(e.id);
}

/**
 * Integration round 2 (field): the shifts a DISCARD from the Not-saved sheet
 * takes off this phone. The discard confirm says a never-saved record is
 * removed from the phone, but a re-pull cannot do it for a time entry:
 * mergeServerPull keeps every local row the server lacks unless
 * timeEntryGoneFromServer says so, and that needs `seenOnServerAt`, which an
 * insert the server refused never gets. So a foreman whose clock-in was
 * refused (his seat removed before the flush) tapped Discard and the shift
 * stayed — in Time Tracking, this phone's payroll CSV, Job Costing labor and
 * the DFR crew roster, and "on the clock".
 *
 * Removed: an entry whose INSERT/UPSERT is in the discarded batch, that the
 * device never saw on the server, and that has no write still queued or under
 * Not saved (`keepIds` — a later clock-in resend would otherwise lose its
 * row). A discarded EDIT removes nothing: the re-pull puts MAGE's copy back.
 */
export function dropDiscardedTimeEntryCreates<T extends { id: string; seenOnServerAt?: string }>(
  entries: readonly T[],
  discarded: readonly { table?: string; operation?: string; recordId?: string }[],
  keepIds: ReadonlySet<string>,
): T[] {
  const created = new Set<string>();
  for (const f of discarded) {
    if (f.table !== 'time_entries' || !f.recordId) continue;
    if (f.operation === 'insert' || f.operation === 'upsert') created.add(f.recordId);
  }
  if (created.size === 0) return entries as T[];
  const out = entries.filter(e => !(created.has(e.id) && !e.seenOnServerAt && !keepIds.has(e.id)));
  return out.length === entries.length ? (entries as T[]) : out;
}

/** Ids with a queued delete on `table` (pendingIdsForTable leaves deletes out
 *  on purpose, so they are collected here). */
export function queuedDeleteIds(
  queue: readonly { table: string; operation: string; data?: { id?: unknown } | null }[],
  table: string,
): Set<string> {
  const ids = new Set<string>();
  for (const q of queue) {
    if (q.table !== table || q.operation !== 'delete') continue;
    const id = q.data?.id;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/** A project id the server will accept: a uuid. 'unassigned' (the old
 *  no-project fallback) fails RLS can_access_project, so the row never left
 *  the phone (#155). */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ── The GC's crew for one job, saved for a seat's offline clock-in (#100) ──
//
// A foreman on a field seat clocks the GC's crew in from the job's crew list
// (contexts/CrewContext useProjectCrew — two SECURITY DEFINER reads). That
// list came only from the network, so in a basement with no signal he could
// clock nobody in and the day's hours were never recorded. Each successful
// read is now saved on the device, per user and per job, and served — labelled
// with when it was fetched — when the read can't reach the server. Only what
// the Clock In sheet needs is kept: id, name, trades, status, and each
// certificate's type and expiry (the cert chips are worked out from the expiry
// against today, so a day-old copy still flags a card that lapsed since). The
// `mageid_` prefix puts it in the tenant sweep; a removed seat's copy is
// deleted when his role on the job resolves to none.

export const PROJECT_CREW_CACHE_PREFIX = 'mageid_project_crew:';

export function projectCrewCacheKey(userId: string, projectId: string): string {
  return `${PROJECT_CREW_CACHE_PREFIX}${userId}:${projectId}`;
}

export interface SavedCrewMember { id: string; fullName: string; trades: string[]; status: string }
export interface SavedCrewCert { id: string; workerId?: string; type: string; expiresDate?: string }
export interface SavedProjectCrew { fetchedAt: string; crew: SavedCrewMember[]; certifications: SavedCrewCert[] }

/** The saved shape — and nothing more — from a fresh read. */
export function savedProjectCrewFrom(
  crew: readonly SavedCrewMember[],
  certifications: readonly { id: string; workerId?: string; type: string; expiresDate?: string }[],
  fetchedAt: string,
): SavedProjectCrew {
  return {
    fetchedAt,
    crew: crew.map(m => ({ id: m.id, fullName: m.fullName, trades: [...m.trades], status: m.status })),
    certifications: certifications.map(c => ({
      id: c.id,
      ...(c.workerId ? { workerId: c.workerId } : {}),
      type: c.type,
      ...(c.expiresDate ? { expiresDate: c.expiresDate } : {}),
    })),
  };
}

/** Read a saved copy back; null for anything that is not one. */
export function parseSavedProjectCrew(raw: string | null | undefined): SavedProjectCrew | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedProjectCrew> | null;
    if (!v || typeof v.fetchedAt !== 'string' || !Number.isFinite(Date.parse(v.fetchedAt))) return null;
    if (!Array.isArray(v.crew) || !Array.isArray(v.certifications)) return null;
    const crew = v.crew
      .filter((m): m is SavedCrewMember => !!m && typeof m.id === 'string')
      .map(m => ({ id: m.id, fullName: typeof m.fullName === 'string' ? m.fullName : '', trades: Array.isArray(m.trades) ? m.trades.filter((t): t is string => typeof t === 'string') : [], status: typeof m.status === 'string' ? m.status : 'active' }));
    const certifications = v.certifications
      .filter((c): c is SavedCrewCert => !!c && typeof c.id === 'string')
      .map(c => ({ id: c.id, workerId: typeof c.workerId === 'string' ? c.workerId : undefined, type: typeof c.type === 'string' ? c.type : '', expiresDate: typeof c.expiresDate === 'string' ? c.expiresDate : undefined }));
    return { fetchedAt: v.fetchedAt, crew, certifications };
  } catch {
    return null;
  }
}

/** "Crew list saved Tue 7:05 am" — when the copy on screen was fetched. */
export function savedCrewLine(fetchedAt: string, offline: boolean): string {
  const ms = Date.parse(fetchedAt);
  const d = new Date(ms);
  const when = Number.isFinite(ms)
    ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${formatClockTime(ms)}`
    : 'earlier';
  return offline
    ? `You're offline. Crew list and certificate flags from ${when}, saved on this phone.`
    : `Showing the crew list saved ${when} while this job's list reloads.`;
}
