// validate-deliveries-schedule — Deliveries That Follow The Schedule, Phase 1
// (lane DELIVERIES-1). Dark behind DELIVERIES_FOLLOW_SCHEDULE_ENABLED = false,
// with an owner preview.
//
// WHAT IT PROVES, with no phone and no database. Every rule has at least one
// PLANTED MUTATION (a deliberately wrong copy of the code, the words or the
// SQL) that the rule must turn red; the run fails if a plant is not caught.
//
// A. NEEDED ON SITE BY (utils/deliveries/neededBy, calendar): a case table
//    worked by hand below: weekends, a non-working date, 6 and 7 day weeks,
//    buffer 0, a task with no start date, a task that moved, a removed task,
//    the engine's start (not the stored pin), and the same answers in four
//    time zones (run in child processes with TZ set).
// B. THE TWO FLAGS (flags): the schedule moved (not on first link, not after
//    the person has looked); the supplier's date against the day it is needed;
//    "No date yet" is its own state and is never before, never the same day.
// C. THE JOB EFFECT (jobEffect): the earliest start, the new finish date and
//    the tasks that slide, by hand; it is the schedule's own preview object
//    (the same object buildSchedulePreviewOverlay returns for the same input);
//    a slip inside the float moves no finish date; the input is never changed.
// D. LEAD TIME AND ORDER BY (orderBy): blank gives no date, no starter value;
//    What to Order This Week by hand.
// E. WHO SAID EACH DATE (provenance) and THE SCORECARD (promise): the original
//    promise is written once; the scorecard scores against it.
// F. THE ROW (rowCore): a delivery made the old way is written with exactly
//    the old columns; a cleared field is written as null; Needed On Site By is
//    not a column, not a field, not a key.
// G. WHAT THE LANE CANNOT DO, read from its source: move a task, send a
//    message, raise a notification, call a server function, slice a date.
// H. THE WORDS, English and Spanish: no "will arrive", no promise but the one
//    line that says it is not one, no "on time", none of guaranteed, accurate,
//    verified; Title Case labels, sentences that end; the honesty lines are on
//    the screens; every date row carries its source line.
// I. THE GATE: the flag is false and read in one file; three doors, each shut
//    when the gate is; the golden of the Deliveries screen exists.
// J. THE MIGRATION TEXT: nullable columns only, no policy, no grant, no
//    trigger, no function, no needed-by column, the header, the self-check,
//    the PGlite proof.
// K. REGISTRATION.
// L. THE REVIEW FIXES (2026-10-09), each with its own planted mutations: an
//    unattributed date stays unattributed; the promise is set from a supplier's
//    word only; the task sheet is handed its job; a person's Apply is logged as
//    a person's; "No Date Yet" is listed and can be received; the working week
//    is the engine's; one row per delivery; the proposal and the flag are one
//    rule (buffer 0, 1, 3); one set of engine options; the hold is marked and
//    can be removed by a press; the table holds the record; a write that proves
//    the columns gone closes the feature and is re-sent the old way; the shared
//    preview slot; the wording.
//
// Run: bun run scripts/validate-deliveries-schedule.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScheduleTask } from '../types';
import type { Delivery } from '../utils/deliverySchedule';
import { ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK, runCpm } from '../utils/cpm';
import { buildSchedulePreviewOverlay } from '../utils/schedulePreviewOverlay';
import { slipDays, computeSupplierScorecards } from '../utils/supplierScorecard';
import { earliestStartFor, isWorkedDay, stepWorkingDays, weekOf, workingDaysFromTo, stepCalendarDays } from '../utils/deliveries/calendar';
import { DEFAULT_BUFFER_WORKING_DAYS, bufferDaysOf, neededByForStart, neededOnSiteBy, scheduleDays, type ScheduleForDeliveries } from '../utils/deliveries/neededBy';
import { flagsFor, scheduleMovedFlag, supplierGap, supplierLateFlag, toReviewCount } from '../utils/deliveries/flags';
import { deliveryHold, engineOptionsFor, holdRelease, proposedTasks, releasedTasks, supplierJobEffect } from '../utils/deliveries/jobEffect';
import { buildLookahead } from '../utils/deliverySchedule';
import { lateMatchForSupplier } from '../utils/deliveryArrival';
import {
  DELIVERY_COLUMNS_SEEN_KEY, columnsAnswer, columnsEpoch, rewriteForMissingColumns, setColumnsAnswer, withoutScheduleColumns,
} from '../utils/deliveries/columnsGate';
import { endOfLocalWeek, leadTimeDaysOf, leadTimeFromInput, leadTimeParts, orderByDate, whatToOrderThisWeek } from '../utils/deliveries/orderBy';
import {
  DATE_HISTORY_MAX, NOTE_MAX, correctPromisedDate, formSourceFor, previousSupplierDate, readHistory, recordFromForm, recordOrdered, recordSupplierDate, supplierDateSource,
} from '../utils/deliveries/provenance';
import { scoredPromiseDate } from '../utils/deliveries/promise';
import {
  DELIVERY_SCHEDULE_COLUMNS, DELIVERY_SCHEDULE_FIELDS, carriesScheduleFields, deliveryScheduleColumns, deliveryScheduleFieldsFromRow,
  expectedDateColumn, expectedDateFromRow, rowHasScheduleColumns,
} from '../utils/deliveries/rowCore';
import { deliveriesFollowScheduleAllowedWith } from '../utils/deliveries/allowed';
import { buildSupplierDraft, draftMailUrl, type DraftWords } from '../utils/deliveries/messageDraft';
import { DELIVERIES_FOLLOW_SCHEDULE_ENABLED } from '../constants/featureFlags';
import { gapChip, gapLine, historyLine, neededBasisLine, orderBasisLine, supplierSourceLine } from '../components/deliveries/words';
import type { DeliveriesScheduleCopy } from '../hooks/useDeliveriesScheduleCopy';
import { EN as EN_SHARD } from '../i18n/catalog/en/office.deliveries-schedule.generated';
import { ES_OFFICE_DELIVERIES_SCHEDULE } from '../i18n/catalog/es/office/deliveriesSchedule';
import { EN_SHARDS } from '../i18n/catalog/en';
import { ES_SHARDS } from '../i18n/catalog/es';
import { isTitleCase } from './copy-title-case';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── The fixtures every part shares ──────────────────────────────────────────
const T = (id: string, title: string, durationDays: number, deps: string[] = [], startDay = 1, extra: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title, phase: '', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started', ...extra,
} as ScheduleTask);

/** The house in the founder's picture. Starts Mon Nov 2, 2026, 5-day week. */
const HOUSE_TASKS = (): ScheduleTask[] => [
  T('F', 'Framing', 12),                              // Mon Nov 2 .. Tue Nov 17
  T('W', 'Window Install', 4, ['F']),                 // Wed Nov 18 .. Mon Nov 23
  T('T', 'Exterior Trim', 5, ['W']),                  // Tue Nov 24 .. Mon Nov 30
  T('S', 'Siding', 5, ['T']),                         // Tue Dec 1 .. Mon Dec 7
  T('I', 'Interior Finishes', 20, ['F']),             // Wed Nov 18 .. Tue Dec 15
  T('X', 'Final Inspection', 1, ['S', 'I']),          // Wed Dec 16
  T('P', 'Punch Prep', 3, [], 6),                     // pinned to working day 6: Mon Nov 9 .. Wed Nov 11
];
const HOUSE = (over: Partial<ScheduleForDeliveries> = {}, tasks: ScheduleTask[] = HOUSE_TASKS()): ScheduleForDeliveries => ({ startDate: '2026-11-02', workingDaysPerWeek: 5, tasks, ...over });
/** Framing behind Site Prep. Starts Mon Oct 12, 2026. `prep` working days of Site Prep. */
const YARD = (prep: number): ScheduleForDeliveries => ({ startDate: '2026-10-12', workingDaysPerWeek: 5, tasks: [T('SP', 'Site Prep', prep), T('FR', 'Framing', 10, ['SP'])] });
const D = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', projectId: 'p1', description: '14 Windows', supplier: 'Northside Glass', expectedDate: '2026-11-12', status: 'scheduled',
  createdAt: '2026-10-01T16:00:00.000Z', updatedAt: '2026-10-01T16:00:00.000Z', ...over,
});

// ── TZ probe mode: the parent runs this file again with TZ set ───────────────
if (process.argv.includes('--probe')) {
  const needed = neededOnSiteBy({ taskId: 'W', bufferDays: 3 }, HOUSE());
  const moved = scheduleMovedFlag(D({ taskId: 'FR', bufferDays: 3, expectedDate: '2026-10-19', taskStartSeen: '2026-10-22' }), YARD(14));
  const effect = supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE());
  const said = supplierSourceLine(
    new Proxy({}, { get: (_t, k) => (...a: unknown[]) => `${String(k)}(${a.join('|')})` }) as unknown as DeliveriesScheduleCopy,
    { kind: 'typed', at: '2026-10-07T03:30:00.000Z', by: 'me', byName: '' }, 'me', 'en');
  console.log(JSON.stringify({
    needed: needed.date,
    back: stepWorkingDays('2026-11-09', -1, { workingDaysPerWeek: 5 }),
    gap: workingDaysFromTo('2026-10-19', '2026-10-27', { workingDaysPerWeek: 5 }),
    moved: moved ? [moved.taskStartWas, moved.taskStartNow, moved.neededByWas, moved.neededByNow, moved.workingDays] : null,
    effect: effect.kind === 'task_slides' ? [effect.taskStartEarliest, effect.finishWas, effect.finishNow, effect.finishDeltaWorkingDays] : effect.kind,
    order: orderByDate('2026-11-13', 42),
    weekEnd: endOfLocalWeek('2026-09-30'),
    said,
  }));
  process.exit(0);
}

let checks = 0;
let fails = 0;
let plants = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  checks++;
  if (!pass) { fails++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};
/** A planted mutation: `red` must be true (the rule caught it). */
const plant = (name: string, red: boolean): void => {
  plants++; checks++;
  if (!red) { fails++; console.log(`  ✗ PLANT NOT CAUGHT: ${name}`); }
};
const section = (s: string) => console.log(`\n── ${s}`);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const freeze = <X>(o: X): X => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) freeze(v); }
  return o;
};

// ════════════════════════════════════════════════════════════════════════════
section('A. Needed On Site By: the case table, worked by hand');
// THE RULE: the task's start as the schedule draws it, stepped back `buffer`
// WORKED days on the schedule's own calendar.
//
//   November 2026          Mo Tu We Th Fr Sa Su
//                           2  3  4  5  6  7  8
//                           9 10 11 12 13 14 15
//                          16 17 18 19 20 21 22
//                          23 24 25 26 27 28 29
//                          30
// Framing is 12 working days from Mon Nov 2: Nov 2-6 (5), 9-13 (5), 16, 17.
// Window Install follows it: starts Wed Nov 18.
type NeedCase = { name: string; schedule: ScheduleForDeliveries | null; taskId?: string; buffer?: number; want: string; why?: string; start?: string };
const NEED_CASES: NeedCase[] = [
  // back from Wed Nov 18: Tue 17 (1), Mon 16 (2), [Sun, Sat skipped], Fri 13 (3)
  { name: 'the picture: Window Install starts Wed Nov 18, buffer 3', schedule: HOUSE(), taskId: 'W', buffer: 3, want: '2026-11-13', start: '2026-11-18' },
  { name: 'the default buffer is 2 working days: Mon Nov 16', schedule: HOUSE(), taskId: 'W', buffer: undefined, want: '2026-11-16', start: '2026-11-18' },
  { name: 'buffer 0 is the day the task starts', schedule: HOUSE(), taskId: 'W', buffer: 0, want: '2026-11-18', start: '2026-11-18' },
  { name: 'buffer 1: Tue Nov 17', schedule: HOUSE(), taskId: 'W', buffer: 1, want: '2026-11-17' },
  // Tue 17, Mon 16, Fri 13, Thu 12, Wed 11
  { name: 'buffer 5 crosses one weekend: Wed Nov 11', schedule: HOUSE(), taskId: 'W', buffer: 5, want: '2026-11-11' },
  // Punch Prep is pinned to working day 6 = Mon Nov 9. One working day back is Fri Nov 6, not Sun Nov 8.
  { name: 'a Monday start, buffer 1, is the Friday before', schedule: HOUSE(), taskId: 'P', buffer: 1, want: '2026-11-06', start: '2026-11-09' },
  { name: 'a Monday start, buffer 2, is the Thursday before', schedule: HOUSE(), taskId: 'P', buffer: 2, want: '2026-11-05' },
  // Mon Nov 16 closed. Framing loses that day: 12 working days end Wed Nov 18, so Window Install starts Thu Nov 19.
  // Back from Thu 19: Wed 18 (1), Tue 17 (2), [Mon 16 closed], [weekend], Fri 13 (3).
  { name: 'a non-working date inside the buffer is not counted', schedule: HOUSE({ nonWorkingDates: ['2026-11-16'] }), taskId: 'W', buffer: 3, want: '2026-11-13', start: '2026-11-19' },
  // 6-day week: Framing Nov 2-7 (6), 9-14 (6). Window Install starts Mon Nov 16. Back: Sat 14, Fri 13, Thu 12.
  { name: 'a 6-day week counts Saturdays', schedule: HOUSE({ workingDaysPerWeek: 6 }), taskId: 'W', buffer: 3, want: '2026-11-12', start: '2026-11-16' },
  // 7-day week: Framing Nov 2-13. Window Install starts Sat Nov 14. Back: Fri 13, Thu 12, Wed 11.
  { name: 'a 7-day week counts every day', schedule: HOUSE({ workingDaysPerWeek: 7 }), taskId: 'W', buffer: 3, want: '2026-11-11', start: '2026-11-14' },
  { name: 'a schedule with no start date gives no date (never today plus N)', schedule: HOUSE({ startDate: undefined }), taskId: 'W', buffer: 3, want: '', why: 'schedule_undated' },
  { name: 'an unreadable start date gives no date', schedule: HOUSE({ startDate: 'soon' }), taskId: 'W', buffer: 3, want: '', why: 'schedule_undated' },
  { name: 'a task that was removed gives no date', schedule: HOUSE(), taskId: 'GONE', buffer: 3, want: '', why: 'task_removed' },
  { name: 'no task linked gives no date', schedule: HOUSE(), taskId: undefined, buffer: 3, want: '', why: 'no_task' },
  { name: 'no schedule gives no date', schedule: null, taskId: 'W', buffer: 3, want: '', why: 'no_schedule' },
  { name: 'a schedule with no tasks gives no date', schedule: HOUSE({}, []), taskId: 'W', buffer: 3, want: '', why: 'no_schedule' },
];
const runNeed = (impl: typeof neededOnSiteBy) => NEED_CASES.filter((c) => {
  const r = impl({ taskId: c.taskId, bufferDays: c.buffer }, c.schedule);
  const why = r.basis.kind === 'none' ? r.basis.why : undefined;
  const start = r.basis.kind === 'task' ? r.basis.taskStart : undefined;
  return r.date !== c.want || why !== c.why || (c.start !== undefined && start !== c.start);
}).map((c) => c.name);
ok(`the ${NEED_CASES.length} cases of the table`, runNeed(neededOnSiteBy).length === 0, runNeed(neededOnSiteBy).join(' | '));

// A task that moved: Framing grows from 12 to 18 working days. Window Install
// slides 6 working days, Wed Nov 18 to Thu Nov 26 (19, 20, 23, 24, 25, 26).
// Needed On Site By follows: back from Thu 26: Wed 25, Tue 24, Mon 23.
{
  const before = HOUSE();
  const after = HOUSE({}, HOUSE_TASKS().map((t) => (t.id === 'F' ? { ...t, durationDays: 18 } : t)));
  const d = freeze(D({ taskId: 'W', bufferDays: 3 }));
  const a = neededOnSiteBy(d, before);
  const b = neededOnSiteBy(d, after);
  ok('the task moves and the date moves with it, with nothing written (the delivery is frozen)', a.date === '2026-11-13' && b.date === '2026-11-23' && b.basis.kind === 'task' && b.basis.taskStart === '2026-11-26', `${a.date} then ${b.date}`);
  ok('the start is where the ENGINE put the task, not its stored pin (Window Install is pinned to day 1 and drawn on Nov 18)',
    HOUSE_TASKS().find((t) => t.id === 'W')?.startDay === 1 && scheduleDays(before).byTask.get('W')?.start === '2026-11-18');
  ok('neededByForStart gives the same date for the same start', neededByForStart({ bufferDays: 3 }, '2026-11-18', before) === '2026-11-13');
}
ok('a buffer outside 0 to 60, or not a number, falls back to the default of 2', DEFAULT_BUFFER_WORKING_DAYS === 2 && bufferDaysOf({ bufferDays: -1 }) === 2 && bufferDaysOf({ bufferDays: 61 }) === 2 && bufferDaysOf({ bufferDays: NaN }) === 2 && bufferDaysOf({ bufferDays: 60 }) === 60 && bufferDaysOf({ bufferDays: 0 }) === 0);
ok('working-day steps: Fri to Mon is 1; Mon back 1 is Fri; a closed day is not a worked day',
  workingDaysFromTo('2026-11-06', '2026-11-09', { workingDaysPerWeek: 5 }) === 1 && stepWorkingDays('2026-11-09', -1, { workingDaysPerWeek: 5 }) === '2026-11-06'
  && !isWorkedDay('2026-11-16', { workingDaysPerWeek: 5, nonWorkingDates: ['2026-11-16'] }) && isWorkedDay('2026-11-14', { workingDaysPerWeek: 6 }) && !isWorkedDay('2026-11-14', { workingDaysPerWeek: 5 }));
ok('working-day steps cross a clock change without losing a day (Nov 1, 2026 is the end of US daylight time)',
  stepWorkingDays('2026-11-02', -1, { workingDaysPerWeek: 5 }) === '2026-10-30' && stepCalendarDays('2026-11-02', -1) === '2026-11-01' && workingDaysFromTo('2026-10-30', '2026-11-02', { workingDaysPerWeek: 5 }) === 1);

// THE WORKING WEEK OF A SCHEDULE THAT DOES NOT SAY ONE is the engine's own
// default (7: every day), read from the same constant runCpm falls back to.
// Framing 12 days from Mon Nov 2 on a 7-day week ends Fri Nov 13; Punch Prep is
// pinned to working day 8, which is Mon Nov 9. One working day before a Monday
// is SUNDAY Nov 8 on that calendar. A 5-day default in the lane said Fri Nov 6:
// a needed-by date two days off the schedule the person is looking at.
{
  const unsaid = HOUSE({ workingDaysPerWeek: undefined }, HOUSE_TASKS().map((t) => (t.id === 'P' ? { ...t, startDay: 8 } : t)));
  const engineStart = scheduleDays(unsaid).byTask.get('P')?.start;
  const weekRule = (week: (c: { workingDaysPerWeek?: number | null }) => number): boolean => {
    const cal = { workingDaysPerWeek: week(unsaid) };
    return engineStart === '2026-11-09' && stepWorkingDays('2026-11-09', -1, cal) === '2026-11-08' && isWorkedDay('2026-11-08', cal);
  };
  ok('a schedule that does not say its working week is counted on the ENGINE\'s default (7), so a Monday start with buffer 1 is needed the Sunday before',
    ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK === 7 && weekOf({}) === ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK && weekOf({ workingDaysPerWeek: null }) === 7 && weekOf({ workingDaysPerWeek: 5 }) === 5
    && weekRule(weekOf) && neededOnSiteBy({ taskId: 'P', bufferDays: 1 }, unsaid).date === '2026-11-08');
  plant('the lane falls back to a 5-day week of its own', !weekRule((c) => c.workingDaysPerWeek ?? 5));
  const CAL = read('utils/deliveries/calendar.ts').replace(/\/\/.*$/gm, '');
  const calRule = (src: string) => /import \{ ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK, isWorkingDayOfWeek \} from '\.\.\/cpm';/.test(src) && /return cal\.workingDaysPerWeek \?\? ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK;/.test(src) && !/\?\?\s*\d/.test(src) && !/: 5;/.test(src);
  ok('calendar.ts reads the default from the engine\'s constant and has no number of its own', calRule(CAL));
  plant('a literal default in calendar.ts', !calRule(CAL.replace('cal.workingDaysPerWeek ?? ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK', 'cal.workingDaysPerWeek ?? 5')));
  const CPM = read('utils/cpm.ts');
  ok('the engine itself falls back to that constant everywhere (no bare `?? 7` left beside it)', /export const ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK = 7;/.test(CPM) && !/orkingDaysPerWeek \?\? 7\b/.test(CPM) && (CPM.match(/orkingDaysPerWeek \?\? ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK/g) ?? []).length >= 9);
}

// Planted wrong needed-by rules, each must fail the table.
plant('needed-by counted in CALENDAR days', runNeed((d, s) => {
  const r = neededOnSiteBy(d, s);
  return r.basis.kind === 'task' ? { ...r, date: stepCalendarDays(r.basis.taskStart, -r.basis.bufferDays) } : r;
}).length > 0);
plant('needed-by ignores the non-working dates', runNeed((d, s) => {
  const r = neededOnSiteBy(d, s);
  return r.basis.kind === 'task' ? { ...r, date: stepWorkingDays(r.basis.taskStart, -r.basis.bufferDays, { workingDaysPerWeek: s?.workingDaysPerWeek }) } : r;
}).length > 0);
plant('needed-by always uses a 5-day week', runNeed((d, s) => {
  const r = neededOnSiteBy(d, s);
  return r.basis.kind === 'task' ? { ...r, date: stepWorkingDays(r.basis.taskStart, -r.basis.bufferDays, { workingDaysPerWeek: 5, nonWorkingDates: s?.nonWorkingDates }) } : r;
}).length > 0);
plant('needed-by reads the stored pin, not the engine start', runNeed((d, s) => neededOnSiteBy(d, s ? { ...s, tasks: (s.tasks ?? []).map((t) => ({ ...t, dependencies: [] })) } : s)).length > 0);
plant('an undated schedule falls back to a date counted from a made-up start', runNeed((d, s) => neededOnSiteBy(d, s && !s.startDate ? { ...s, startDate: '2026-11-02' } : s)).length > 0);
plant('the default buffer is 0', runNeed((d, s) => neededOnSiteBy({ ...d, bufferDays: d.bufferDays ?? 0 }, s)).length > 0);

// The same answers wherever the phone is: four zones, each a child process.
{
  const WANT = { needed: '2026-11-13', back: '2026-11-06', gap: 6, moved: ['2026-10-22', '2026-10-30', '2026-10-19', '2026-10-27', 6], effect: ['2026-12-04', '2026-12-16', '2026-12-24', 6], order: '2026-10-02', weekEnd: '2026-10-04' };
  // 03:30 UTC on Oct 7 is still Oct 6 in the Americas and already Oct 7 east of Greenwich: the label names the LOCAL day it was typed.
  const SAID: Record<string, string> = { 'America/Los_Angeles': 'Oct 6', 'America/New_York': 'Oct 6', 'Pacific/Kiritimati': 'Oct 7', 'Pacific/Pago_Pago': 'Oct 6', UTC: 'Oct 7' };
  for (const tz of Object.keys(SAID)) {
    const r = spawnSync(process.execPath, ['run', fileURLToPath(import.meta.url), '--probe'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    let got: Record<string, unknown> = {};
    try { got = JSON.parse((r.stdout || '').trim().split('\n').pop() || '{}'); } catch { /* reported below */ }
    const { said, ...rest } = got as { said?: string };
    ok(`in ${tz} every date is the same, and "typed" names the local day (${SAID[tz]})`, eq(rest, WANT) && typeof said === 'string' && said.includes(SAID[tz]), `${JSON.stringify(got)} ${r.stderr?.slice(0, 200) ?? ''}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('B. The two flags, as facts from the dates');
//   October 2026           Mo Tu We Th Fr Sa Su
//                          12 13 14 15 16 17 18
//                          19 20 21 22 23 24 25
//                          26 27 28 29 30 31
// Site Prep 8 working days from Mon Oct 12 ends Wed Oct 21: Framing starts Thu Oct 22.
// Site Prep grows to 14: ends Thu Oct 29, Framing starts Fri Oct 30. That is 6
// working days later (23, 26, 27, 28, 29, 30).
// Buffer 3: needed was Mon Oct 19 (21, 20, 19) and is now Tue Oct 27 (29, 28, 27).
// The yard's date is Mon Oct 19: now 6 working days before Oct 27 (20, 21, 22, 23, 26, 27).
{
  const lumber = D({ id: 'lum', description: 'Framing Lumber Package', supplier: 'Kessler Lumber Yard', taskId: 'FR', bufferDays: 3, expectedDate: '2026-10-19', taskStartSeen: '2026-10-22' });
  const m = scheduleMovedFlag(lumber, YARD(14));
  ok('the picture: Framing slid 6 working days, the lumber is now 6 working days early',
    !!m && m.direction === 'later' && m.workingDays === 6 && m.taskStartWas === '2026-10-22' && m.taskStartNow === '2026-10-30'
    && m.neededByWas === '2026-10-19' && m.neededByNow === '2026-10-27' && eq(m.gap, { kind: 'before', workingDays: 6 }), JSON.stringify(m));
  ok('no flag while the task is where the person last saw it', scheduleMovedFlag(lumber, YARD(8)) === null);
  ok('no flag on the first link (nothing seen yet)', scheduleMovedFlag({ ...lumber, taskStartSeen: undefined }, YARD(14)) === null);
  ok('no flag once the person has looked (taskStartSeen is the new start)', scheduleMovedFlag({ ...lumber, taskStartSeen: '2026-10-30' }, YARD(14)) === null);
  const up = scheduleMovedFlag({ ...lumber, taskStartSeen: '2026-10-30' }, YARD(8));
  ok('a task pulled in is "earlier", by the same count', !!up && up.direction === 'earlier' && up.workingDays === 6 && eq(up.gap, { kind: 'same_day' }), JSON.stringify(up));
  ok('a delivered or cancelled load raises no flag', scheduleMovedFlag({ ...lumber, status: 'delivered' }, YARD(14)) === null && scheduleMovedFlag({ ...lumber, status: 'cancelled' }, YARD(14)) === null && flagsFor({ ...lumber, status: 'delivered' }, YARD(14)).length === 0);
  ok('no flag on an undated schedule', scheduleMovedFlag(lumber, { ...YARD(14), startDate: undefined }) === null);
  plant('the moved flag fires on the first link', (() => { const f = (d: Delivery, s: ScheduleForDeliveries) => scheduleMovedFlag({ ...d, taskStartSeen: d.taskStartSeen ?? '2026-10-22' }, s); return f({ ...lumber, taskStartSeen: undefined }, YARD(14)) !== null; })());
  plant('the moved flag counts calendar days (8, not 6)', (() => { const days = Math.round((Date.UTC(2026, 9, 30) - Date.UTC(2026, 9, 22)) / 86_400_000); return days !== m?.workingDays; })());
}
{
  const cal = { workingDaysPerWeek: 5 };
  const need = { date: '2026-11-13' };
  const GAP: [string, string, unknown][] = [
    ['Thu Nov 12 against Fri Nov 13', '2026-11-12', { kind: 'before', workingDays: 1 }],
    ['the same day', '2026-11-13', { kind: 'same_day' }],
    ['Mon Nov 16 (the next working day)', '2026-11-16', { kind: 'after', workingDays: 1 }],
    ['Sat Nov 14 (a closed day after) still counts as after', '2026-11-14', { kind: 'after', workingDays: 1 }],
    ['Tue Dec 1: 12 working days after (16-20, 23-27, 30, Dec 1)', '2026-12-01', { kind: 'after', workingDays: 12 }],
    ['no supplier date', '', { kind: 'no_date' }],
    ['an unreadable supplier date is no date', 'soon', { kind: 'no_date' }],
  ];
  const bad = GAP.filter(([, date, want]) => !eq(supplierGap({ expectedDate: date }, need, cal), want)).map(([n]) => n);
  ok(`the supplier's date against the day it is needed: ${GAP.length} cases`, bad.length === 0, bad.join(' | '));
  ok('with no Needed On Site By there is nothing to compare', eq(supplierGap({ expectedDate: '2026-11-12' }, { date: '' }, cal), { kind: 'no_needed_by' }));
  // "No date yet" is never on time: not before, not the same day, and no late flag either (there is no date to be late).
  const none = D({ taskId: 'W', bufferDays: 3, expectedDate: '' });
  const g = supplierGap(none, neededOnSiteBy(none, HOUSE()), HOUSE());
  ok('"No date yet" is its own state: never before the day it is needed, never the same day', g.kind === 'no_date' && supplierLateFlag(none, HOUSE()) === null);
  plant('a delivery with no date is treated as before the day it is needed', (() => { const wrong = (d: Pick<Delivery, 'expectedDate'>) => (d.expectedDate ? supplierGap(d, need, cal) : { kind: 'before', workingDays: 0 }); return !eq(wrong({ expectedDate: '' }), { kind: 'no_date' }); })());
  const late = supplierLateFlag(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE());
  ok('the supplier flag: Dec 1 against Nov 13', !!late && late.neededBy === '2026-11-13' && late.supplierDate === '2026-12-01' && late.workingDays === 12);
  ok('no supplier flag when the date is before or on the day', supplierLateFlag(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-11-13' }), HOUSE()) === null && supplierLateFlag(D({ taskId: 'W', bufferDays: 3 }), HOUSE()) === null);
  ok('To Review counts deliveries, not flags', toReviewCount([D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01', taskStartSeen: '2026-11-02' }), D({ id: 'd2', taskId: 'W', bufferDays: 3 })], () => HOUSE()) === 1);
}

// ════════════════════════════════════════════════════════════════════════════
section('C. The job effect is the schedule\'s own proposed-change preview');
// THE ONE RULE (utils/deliveries/calendar.earliestStartFor): a supplier date
// raises no flag when it is on or before Needed On Site By, which is the start
// stepped back the buffer in worked days. The proposal is the EARLIEST start
// that raises no flag: the first worked day whose own needed-by date is on or
// after the supplier's date.
//
// The windows are needed Fri Nov 13 (buffer 3). The supplier now says Tue Dec 1.
// Three worked days after Dec 1 is Fri Dec 4 (2, 3, 4): Window Install slides
// from Wed Nov 18, 12 working days (19, 20, 23, 24, 25, 26, 27, 30, Dec 1, 2, 3, 4).
//   Window Install  Dec 4, 7, 8, 9          (was Nov 18 .. 23)
//   Exterior Trim   Dec 10 .. 16            (was Nov 24 .. 30)   12 later
//   Siding          Dec 17 .. 23            (was Dec 1 .. 7)     12 later
//   Interior Finishes does not move: Nov 18 .. Dec 15
//   Final Inspection waits for Siding: Thu Dec 24 (was Wed Dec 16)
// The finish date moves 6 working days (17, 18, 21, 22, 23, 24): the rest was float.
{
  const sched = HOUSE();
  freeze(sched);
  const d = freeze(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }));
  const e = supplierJobEffect(d, sched);
  ok('the picture: earliest start Fri Dec 4, 12 working days later (the same 12 the flag counts)', e.kind === 'task_slides' && e.taskStartWas === '2026-11-18' && e.taskStartEarliest === '2026-12-04' && e.taskSlipWorkingDays === 12 && eq(e.proposal, { taskId: 'W', notBefore: '2026-12-04' })
    && supplierLateFlag(d, sched)?.workingDays === 12, JSON.stringify(e.kind === 'task_slides' ? [e.taskStartEarliest, e.taskSlipWorkingDays] : e));
  ok('the finish date moves from Wed Dec 16 to Thu Dec 24: 6 working days', e.kind === 'task_slides' && e.finishWas === '2026-12-16' && e.finishNow === '2026-12-24' && e.finishDeltaWorkingDays === 6);
  ok('three tasks slide: Exterior Trim 12, Siding 12, Final Inspection 6; Interior Finishes and Framing do not',
    e.kind === 'task_slides' && eq(e.slides.map((s) => [s.id, s.workingDaysLater]), [['T', 12], ['S', 12], ['X', 6]]) && e.linked.id === 'W');
  ok('the frozen schedule and the frozen delivery were not changed (a change would have thrown)', e.kind === 'task_slides');
  if (e.kind === 'task_slides') {
    // The reuse, proven: build the schedule's preview directly, the way the copilot's review does, and compare.
    const before = HOUSE_TASKS();
    const after = proposedTasks(before, 'W', '2026-12-04', 'd1');
    const opt = engineOptionsFor(HOUSE(), before, '2026-11-02');
    const direct = buildSchedulePreviewOverlay(before, after, runCpm(before, opt), runCpm(after, opt));
    ok('the effect\'s overlay IS the object utils/schedulePreviewOverlay builds for the same proposal (finish +8 calendar days)', eq(e.overlay, direct) && direct.finishDeltaDays === 8 && direct.moved.length === 4);
    ok('the proposal is the schedule\'s own "start no earlier than" anchor on that one task, on a copy, marked with the delivery it came from',
      after !== before && after.filter((t, i) => t !== before[i]).length === 1 && after.find((t) => t.id === 'W')?.anchorType === 'start-no-earlier' && after.find((t) => t.id === 'W')?.anchorDate === '2026-12-04'
      && after.find((t) => t.id === 'W')?.anchorFromDeliveryId === 'd1' && before.find((t) => t.id === 'W')?.anchorType === undefined);
  }
  // Inside the float: Gutters (2 days after Window Install, nothing waits on it) starts Tue Nov 24, needed Thu Nov 19.
  // Supplier says Mon Nov 30: three worked days after is Thu Dec 3. Gutters slides to Dec 3 .. 4 and the finish date stays Dec 16.
  const withGutters = HOUSE({}, [...HOUSE_TASKS(), T('G', 'Gutters', 2, ['W'])]);
  const g = supplierJobEffect(D({ taskId: 'G', bufferDays: 3, expectedDate: '2026-11-30' }), withGutters);
  ok('a slip inside the float: the task slides, no other task moves and the finish date does not', g.kind === 'task_slides' && g.taskStartEarliest === '2026-12-03' && g.finishDeltaWorkingDays === 0 && g.slides.length === 0 && g.finishNow === '2026-12-16', JSON.stringify(g.kind === 'task_slides' ? [g.taskStartEarliest, g.finishDeltaWorkingDays, g.slides.length] : g));
  const why = (x: ReturnType<typeof supplierJobEffect>) => (x.kind === 'cannot_say' ? x.why : x.kind);
  ok('nothing is said when nothing can be: no date, not after, a loop, a pinned task, a started task, a settled load, no start date',
    why(supplierJobEffect(D({ taskId: 'W', expectedDate: '' }), HOUSE())) === 'no_supplier_date'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-11-12' }), HOUSE())) === 'not_after_needed'
    && why(supplierJobEffect(D({ taskId: 'B', bufferDays: 0, expectedDate: '2026-12-01' }), HOUSE({}, [T('A', 'A', 2, ['B']), T('B', 'B', 2, ['A'])]))) === 'cycle'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE({}, HOUSE_TASKS().map((t) => (t.id === 'W' ? { ...t, anchorType: 'must-start-on' as const, anchorDate: '2026-11-18' } : t))))) === 'task_pinned'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE({}, HOUSE_TASKS().map((t) => (t.id === 'W' ? { ...t, status: 'in_progress' as const } : t))))) === 'task_started'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01', status: 'delivered' }), HOUSE())) === 'settled'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE({ startDate: undefined }))) === 'schedule_undated');
  plant('the finish moves by the task\'s slip (12), ignoring the float', e.kind === 'task_slides' && e.finishDeltaWorkingDays !== e.taskSlipWorkingDays);
  plant('a proposal that edits the task list in place', (() => { const f = freeze(HOUSE_TASKS()); try { const w = f.find((t) => t.id === 'W'); if (w) (w as ScheduleTask).anchorDate = '2026-12-04'; return false; } catch { return true; } })());

  // ── THE PROPOSAL AND THE FLAG ARE ONE RULE: buffer 0, 1 and 3 ──────────────
  // Window Install starts Wed Nov 18. For each buffer, three supplier dates:
  //   the needed-by date itself          no flag, so NO proposal
  //   the next worked day after it       the FIRST flagged date: the smallest move, one worked day (Thu Nov 19)
  //   and once that proposal is applied  the flag is gone; one worked day earlier it would still be raised
  //                needed-by   first flagged   proposed start
  //   buffer 0     Wed Nov 18  Thu Nov 19      Thu Nov 19  (the supplier date itself)
  //   buffer 1     Tue Nov 17  Wed Nov 18      Thu Nov 19  (the worked day after it)
  //   buffer 3     Fri Nov 13  Mon Nov 16      Thu Nov 19  (16 + 3 worked days: 17, 18, 19)
  type Rule = (supplierDate: string, bufferDays: number, cal: ScheduleForDeliveries) => string;
  const BUFFER_CASES: [number, string, string][] = [[0, '2026-11-18', '2026-11-19'], [1, '2026-11-17', '2026-11-18'], [3, '2026-11-13', '2026-11-16']];
  const ruleProblems = (rule: Rule): string[] => {
    const out: string[] = [];
    for (const [buffer, neededBy, firstFlagged] of BUFFER_CASES) {
      const base = HOUSE();
      const load = (date: string) => D({ taskId: 'W', bufferDays: buffer, expectedDate: date });
      if (neededOnSiteBy(load(neededBy), base).date !== neededBy) out.push(`buffer ${buffer}: needed-by is not ${neededBy}`);
      // A date that raises no flag proposes no move: the earliest start it needs is on or before today's start.
      if (supplierLateFlag(load(neededBy), base) !== null) out.push(`buffer ${buffer}: ${neededBy} is flagged`);
      if (rule(neededBy, buffer, base) > '2026-11-18') out.push(`buffer ${buffer}: an unflagged date (${neededBy}) proposes a move to ${rule(neededBy, buffer, base)}`);
      // The first flagged date proposes the minimal move.
      if (supplierLateFlag(load(firstFlagged), base)?.workingDays !== 1) out.push(`buffer ${buffer}: ${firstFlagged} is not flagged by 1 working day`);
      const start = rule(firstFlagged, buffer, base);
      if (start !== '2026-11-19') out.push(`buffer ${buffer}: the first flagged date proposes ${start}, not Thu Nov 19`);
      // Applied, the flag is gone; one worked day earlier it is still raised.
      const applied = HOUSE({}, proposedTasks(HOUSE_TASKS(), 'W', start, 'd1'));
      if (supplierLateFlag(load(firstFlagged), applied) !== null) out.push(`buffer ${buffer}: the flag is still raised after the proposal (start ${start})`);
      const earlier = stepWorkingDays(start, -1, base);
      const tooEarly = HOUSE({}, proposedTasks(HOUSE_TASKS(), 'W', earlier, 'd1'));
      if (earlier >= '2026-11-18' && supplierLateFlag(load(firstFlagged), tooEarly) === null && earlier !== start) out.push(`buffer ${buffer}: a start one worked day earlier (${earlier}) would also clear the flag: the move is not minimal`);
    }
    return out;
  };
  ok('buffer 0, 1 and 3: a supplier date that raises no flag proposes no move, the first flagged date proposes the smallest move, and the applied proposal clears the flag', ruleProblems(earliestStartFor).length === 0, ruleProblems(earliestStartFor).join(' | '));
  for (const [buffer, neededBy, firstFlagged] of BUFFER_CASES) {
    const quiet = supplierJobEffect(D({ taskId: 'W', bufferDays: buffer, expectedDate: neededBy }), HOUSE());
    const first = supplierJobEffect(D({ taskId: 'W', bufferDays: buffer, expectedDate: firstFlagged }), HOUSE());
    ok(`buffer ${buffer}, through the job effect: ${neededBy} says nothing, ${firstFlagged} slides Window Install exactly 1 working day to Thu Nov 19`,
      why(quiet) === 'not_after_needed' && first.kind === 'task_slides' && first.taskStartEarliest === '2026-11-19' && first.taskSlipWorkingDays === 1 && first.bufferDays === buffer && first.proposal.notBefore === '2026-11-19',
      JSON.stringify([why(quiet), first.kind === 'task_slides' ? [first.taskStartEarliest, first.taskSlipWorkingDays] : first]));
  }
  ok('a supplier date on a closed day: buffer 0 starts the next worked day, buffer 1 the one after (Sat Nov 14: Mon Nov 16, Tue Nov 17)',
    earliestStartFor('2026-11-14', 0, HOUSE()) === '2026-11-16' && earliestStartFor('2026-11-14', 1, HOUSE()) === '2026-11-17' && earliestStartFor('', 3, HOUSE()) === '' && earliestStartFor('soon', 0, HOUSE()) === '');
  plant('the OLD rule: the first worked day after the supplier date, whatever the buffer (buffer 0 moves a day too far, buffer 3 leaves the flag up)', ruleProblems((date, _b, cal) => stepWorkingDays(date, 1, cal)).length > 0);
  plant('the proposal ignores the buffer and starts on the supplier date', ruleProblems((date) => date).length > 0);
  plant('the proposal adds the buffer and one more day', ruleProblems((date, b, cal) => stepWorkingDays(date, b + 1, cal)).length > 0);
  const EFFECT = read('utils/deliveries/jobEffect.ts').replace(/\/\/.*$/gm, '');
  const effectRule = (src: string) => /const earliest = earliestStartFor\(supplierDate, bufferDays, schedule\);/.test(src) && !/nextWorkedDayAfter/.test(src);
  ok('the job effect takes its start from earliestStartFor (the flag\'s rule), not from "the next worked day"', effectRule(EFFECT));
  plant('jobEffect goes back to nextWorkedDayAfter', !effectRule(EFFECT.replace('earliestStartFor(supplierDate, bufferDays, schedule)', 'nextWorkedDayAfter(supplierDate, schedule)')));

  // ── ONE SET OF ENGINE OPTIONS, for the sheet and the banner ────────────────
  // A schedule with a float setting and a crew on its own 6-day calendar. Both screens call
  // supplierJobEffect(delivery, schedule) and nothing else, so they cannot be handed different options.
  const crewed = { ...HOUSE({}, HOUSE_TASKS().map((t) => (t.id === 'T' ? { ...t, resourceIds: ['r1'] } : t))), criticalFloatThresholdDays: 2, resources: [{ id: 'r1', name: 'Trim Crew', calendarKey: 'six' }], resourceCalendars: [{ key: 'six', name: 'Six Days', workingDaysPerWeek: 6, closures: [] }] } as unknown as ScheduleForDeliveries;
  const opts = engineOptionsFor(crewed, crewed.tasks as ScheduleTask[], '2026-11-02');
  ok('the engine options are the schedule screen\'s: its start, week and closed days, its float setting and its per-task calendars',
    opts.scheduleStartDate === '2026-11-02' && opts.workingDaysPerWeek === 5 && opts.criticalFloatThresholdDays === 2 && opts.taskCalendars?.get('T')?.workingDaysPerWeek === 6 && opts.taskCalendars?.size === 1
    && engineOptionsFor(HOUSE(), HOUSE_TASKS(), '2026-11-02').taskCalendars === undefined && engineOptionsFor(HOUSE(), HOUSE_TASKS(), '2026-11-02').criticalFloatThresholdDays === 0);
  const ce = supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), crewed);
  const cb = crewed.tasks as ScheduleTask[];
  const ca = proposedTasks(cb, 'W', '2026-12-04', 'd1');
  ok('the effect is worked out WITH them: its overlay is the overlay those options give, and differs from the one the bare calendar gives',
    ce.kind === 'task_slides' && eq(ce.overlay, buildSchedulePreviewOverlay(cb, ca, runCpm(cb, opts), runCpm(ca, opts)))
    && !eq(ce.overlay, buildSchedulePreviewOverlay(cb, ca, runCpm(cb, { scheduleStartDate: '2026-11-02', workingDaysPerWeek: 5 }), runCpm(ca, { scheduleStartDate: '2026-11-02', workingDaysPerWeek: 5 }))));
  const SHEET_SRC = read('components/deliveries/DeliveryFollowSheet.tsx').replace(/\/\/.*$/gm, '');
  const FOLLOW_SRC = read('components/deliveries/DeliveriesFollow.tsx').replace(/\/\/.*$/gm, '');
  const oneOptions = (effectSrc: string, sheet: string, follow: string, pro: string): string[] => {
    const out: string[] = [];
    if (!/export function supplierJobEffect\(\s*delivery: Pick<Delivery, [^>]+>,\s*schedule: ScheduleForDeliveries \| null \| undefined,\s*\): JobEffect/.test(effectSrc)) out.push('supplierJobEffect takes something besides the delivery and the schedule');
    if ((effectSrc.match(/engineOptionsFor\(schedule, before, anchor\.iso\)/g) ?? []).length !== 2 || /const options: RunCpmOptions = \{/.test(effectSrc)) out.push('the options are assembled somewhere other than engineOptionsFor');
    for (const [name, src] of [['the sheet', sheet], ['the banner', follow]] as const) {
      const calls = src.match(/supplierJobEffect\([^)]*\)/g) ?? [];
      if (calls.length !== 1 || calls[0].split(',').length !== 2) out.push(`${name} does not call supplierJobEffect(delivery, schedule) exactly once with two arguments`);
      if (/runCpm|RunCpmOptions|taskCalendars|criticalFloatThresholdDays/.test(src)) out.push(`${name} builds engine options of its own`);
    }
    if (/deliveryProposalEngine|engine=\{/.test(pro.slice(pro.indexOf('<DeliveryProposalBanner'), pro.indexOf('<DeliveryProposalBanner') + 600))) out.push('Schedule Pro hands the banner options of its own');
    return out;
  };
  const PRO_SRC = read('app/schedule-pro.tsx');
  ok('the sheet and the banner both call supplierJobEffect(delivery, schedule), which builds the options in one helper; neither screen builds its own', oneOptions(EFFECT, SHEET_SRC, FOLLOW_SRC, PRO_SRC).length === 0, oneOptions(EFFECT, SHEET_SRC, FOLLOW_SRC, PRO_SRC).join(' | '));
  plant('the banner passes engine options the sheet does not', oneOptions(EFFECT, SHEET_SRC, FOLLOW_SRC.replace('supplierJobEffect(delivery, drawn)', 'supplierJobEffect(delivery, drawn, engine)'), PRO_SRC).length > 0);
  plant('the effect assembles its options inline again', oneOptions(EFFECT.replace('const options = engineOptionsFor(schedule, before, anchor.iso);', 'const options: RunCpmOptions = { scheduleStartDate: anchor.iso };'), SHEET_SRC, FOLLOW_SRC, PRO_SRC).length > 0);

  // ── THE HOLD: marked with its delivery, offered for removal when the date improves ──
  const heldTasks = proposedTasks(HOUSE_TASKS(), 'W', '2026-12-04', 'd1');
  const heldSched = HOUSE({}, heldTasks);
  const hold = deliveryHold(heldTasks, 'd1');
  ok('an applied proposal is found again by the delivery\'s id: the task and the day it is held to', eq(hold, { taskId: 'W', taskTitle: 'Window Install', notBefore: '2026-12-04' }) && deliveryHold(heldTasks, 'd2') === null && deliveryHold(HOUSE_TASKS(), 'd1') === null && deliveryHold(heldTasks, '') === null);
  const still = holdRelease(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), heldSched);
  ok('while the supplier date still needs it the hold is only stated, and nothing is offered', still.kind === 'held' && still.heldTo === '2026-12-04' && holdRelease(D({ taskId: 'W', bufferDays: 3, expectedDate: '' }), heldSched).kind === 'held' && holdRelease(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-02' }), heldSched).kind === 'held');
  // The supplier improves to Wed Nov 25: three worked days after is Mon Nov 30, before the hold's Fri Dec 4.
  const better = holdRelease(freeze(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-11-25' })), freeze(heldSched));
  ok('when the supplier date improves, removing the hold is OFFERED (with the schedule\'s own preview of it), and nothing is changed by asking',
    better.kind === 'can_release' && better.heldTo === '2026-12-04' && better.neededStart === '2026-11-30' && better.supplierDate === '2026-11-25' && !!better.overlay && better.overlay.finishDeltaDays === -8 && deliveryHold(heldTasks, 'd1') !== null);
  const released = releasedTasks(heldTasks, 'd1');
  const w = released.find((t) => t.id === 'W') as ScheduleTask;
  ok('removing it takes off the anchor and its mark from that task only, on a copy; a hold from another delivery, or a person\'s own anchor, is left alone',
    released !== heldTasks && !('anchorType' in w) && !('anchorDate' in w) && !('anchorFromDeliveryId' in w) && released.filter((t, i) => t !== heldTasks[i]).length === 1 && heldTasks.find((t) => t.id === 'W')?.anchorFromDeliveryId === 'd1'
    && eq(releasedTasks(heldTasks, 'd2'), heldTasks) && eq(releasedTasks(HOUSE_TASKS().map((t) => (t.id === 'W' ? { ...t, anchorType: 'must-start-on' as const, anchorDate: '2026-12-04', anchorFromDeliveryId: 'd1' } : t)), 'd1').find((t) => t.id === 'W')?.anchorType, 'must-start-on')
    && holdRelease(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-11-25' }), HOUSE({}, released)).kind === 'none');
  plant('the proposal does not record the delivery it came from (the hold can never be found)', deliveryHold(HOUSE_TASKS().map((t) => (t.id === 'W' ? { ...t, anchorType: 'start-no-earlier' as const, anchorDate: '2026-12-04' } : t)), 'd1') === null);
  plant('removing a hold strips every anchor on the schedule', (() => { const wrong = (tasks: ScheduleTask[]) => tasks.map(({ anchorType: _a, anchorDate: _b, ...rest }) => rest as ScheduleTask); const mine = HOUSE_TASKS().map((t) => (t.id === 'T' ? { ...t, anchorType: 'must-start-on' as const, anchorDate: '2026-12-10' } : t)); return !eq(wrong(mine), releasedTasks(mine, 'd1')); })());
  ok('a cloned job does not carry the mark: the template reset drops anchorFromDeliveryId with the anchor\'s date', /'anchorDate', 'anchorFromDeliveryId', 'deadline'/.test(read('utils/projectClone.ts')) && /anchorFromDeliveryId\?: string;/.test(read('types/index.ts')));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. Lead time, Order By and What to Order This Week');
// Needed Fri Nov 13. A 6 week lead time is 42 calendar days: Fri Oct 2.
{
  ok('the picture: 6 weeks back from Fri Nov 13 is Fri Oct 2', orderByDate('2026-11-13', 42) === '2026-10-02' && leadTimeFromInput('6', 'weeks') === 42);
  ok('no lead time, no date: blank, zero, a negative, text, and no needed-by date all give nothing',
    orderByDate('2026-11-13', null) === '' && orderByDate('2026-11-13', undefined) === '' && orderByDate('2026-11-13', 0) === '' && orderByDate('', 42) === ''
    && leadTimeFromInput('', 'weeks') === null && leadTimeFromInput('0', 'days') === null && leadTimeFromInput('-3', 'days') === null && leadTimeFromInput('two', 'weeks') === null && leadTimeFromInput('105', 'weeks') === null
    && leadTimeDaysOf({}) === null && leadTimeDaysOf({ leadTimeDays: 0 }) === null && leadTimeDaysOf({ leadTimeDays: 731 }) === null && leadTimeDaysOf({ leadTimeDays: 730 }) === 730);
  ok('a stored lead time reads back as typed: 42 days is 6 weeks, 10 days is 10 days', eq(leadTimeParts(42), { count: 6, unit: 'weeks' }) && eq(leadTimeParts(10), { count: 10, unit: 'days' }));
  plant('a blank lead time falls back to a 14 day starter value', ((lead: number | null) => orderByDate('2026-11-13', lead ?? 14))(null) !== '');
  ok('utils/deliveries never reads the lead time library (a national guess)', !readdirSync(join(ROOT, 'utils/deliveries')).some((f) => /leadTimeLibrary|learnedLeadTime|getLeadTime/.test(read(`utils/deliveries/${f}`).replace(/\/\/.*$/gm, ''))));

  // Today is Wed Sep 30, 2026. The week ends Sun Oct 4.
  const sched = HOUSE();
  const list = [
    D({ id: 'win', taskId: 'W', bufferDays: 3, leadTimeDays: 42 }),                                   // order by Fri Oct 2: this week
    D({ id: 'trim', description: 'Trim Package', taskId: 'T', bufferDays: 2, leadTimeDays: 60 }),     // needed Fri Nov 20; 60 days back is Mon Sep 21: past
    D({ id: 'side', description: 'Siding', taskId: 'S', bufferDays: 2, leadTimeDays: 56 }),           // needed Fri Nov 27; 56 days back is Fri Oct 2: this week
    D({ id: 'late', description: 'Doors', taskId: 'X', bufferDays: 0, leadTimeDays: 72 }),            // needed Wed Dec 16; 72 days back is Mon Oct 5: next week, not listed
    D({ id: 'done', taskId: 'W', bufferDays: 3, leadTimeDays: 42, orderedOn: '2026-09-28' }),          // ordered
    D({ id: 'here', taskId: 'W', bufferDays: 3, leadTimeDays: 42, status: 'delivered' }),
    D({ id: 'off', taskId: 'W', bufferDays: 3, leadTimeDays: 42, status: 'cancelled' }),
    D({ id: 'nolead', taskId: 'W', bufferDays: 3 }),
    D({ id: 'notask', leadTimeDays: 42 }),
  ];
  const r = whatToOrderThisWeek(list, () => sched, '2026-09-30');
  ok('the week of Wed Sep 30 ends Sun Oct 4', endOfLocalWeek('2026-09-30') === '2026-10-04' && endOfLocalWeek('2026-10-04') === '2026-10-04' && endOfLocalWeek('2026-10-05') === '2026-10-11');
  ok('overdue first (9 days past), then this week by date (a tie by name); next week, ordered, delivered, cancelled, no lead time and no task are left out',
    eq(r.rows.map((x) => [x.delivery.id, x.orderBy, x.daysLeft]), [['trim', '2026-09-21', -9], ['win', '2026-10-02', 2], ['side', '2026-10-02', 2]]) && r.overdue.length === 1 && r.thisWeek.length === 2,
    JSON.stringify(r.rows.map((x) => [x.delivery.id, x.orderBy, x.daysLeft])));
  ok('an undated schedule lists nothing', whatToOrderThisWeek(list, () => HOUSE({ startDate: undefined }), '2026-09-30').rows.length === 0);
  ok('overdue is not bounded by the week: a year past is still listed', whatToOrderThisWeek([list[0]], () => sched, '2027-09-30').overdue.length === 1);
  plant('ordered deliveries stay on the list', whatToOrderThisWeek(list.map((d) => ({ ...d, orderedOn: undefined })), () => sched, '2026-09-30').rows.length !== r.rows.length);
}

// ════════════════════════════════════════════════════════════════════════════
section('E. Who said each date, the history, and the scorecard\'s basis');
{
  const now = (s: string) => new Date(s);
  const fresh = D({ expectedDate: '', createdAt: '2026-10-01T16:00:00.000Z' });
  const first = recordSupplierDate(fresh, { date: '2026-11-12', source: 'supplier_said', note: ' by   phone ', by: 'u1', byName: 'Dana Ortiz', now: now('2026-10-06T15:00:00.000Z') });
  ok('the first supplier date is recorded with its source, and becomes the original promise',
    !!first && first.expectedDate === '2026-11-12' && first.promisedDate === '2026-11-12' && first.dateHistory?.length === 1
    && eq(first.dateHistory?.[0], { date: '2026-11-12', previousDate: '', at: '2026-10-06T15:00:00.000Z', source: 'supplier_said', note: 'by phone', by: 'u1', byName: 'Dana Ortiz' }));
  const d1 = { ...fresh, ...first } as Delivery;
  const second = recordSupplierDate(d1, { date: '2026-12-01', source: 'supplier_said', note: 'by phone', by: 'u1', now: now('2026-10-09T15:00:00.000Z') });
  const d2 = { ...d1, ...second } as Delivery;
  ok('a change keeps the promise (Nov 12), adds one entry with the date it was, and "was Nov 12" can be shown',
    !!second && d2.expectedDate === '2026-12-01' && d2.promisedDate === '2026-11-12' && d2.dateHistory?.length === 2 && d2.dateHistory?.[1].previousDate === '2026-11-12' && previousSupplierDate(d2) === '2026-11-12');
  const src = supplierDateSource(d2);
  ok('the current date names who said it and when', src.kind === 'supplier_said' && src.note === 'by phone' && src.at === '2026-10-09T15:00:00.000Z' && src.by === 'u1');
  ok('the same date from the same source records nothing', recordSupplierDate(d2, { date: '2026-12-01', source: 'supplier_said', note: 'by phone', now: now('2026-10-10T15:00:00.000Z') }) === null);
  ok('no date is "not given"; a date from before the lane is "no record of who gave it"', supplierDateSource(fresh).kind === 'not_given' && supplierDateSource(D()).kind === 'unrecorded');
  // THE PROMISE IS SET FROM THE SUPPLIER'S WORD ONLY. `Rec` is the recorder under test, so a wrong one can be planted.
  type Rec = typeof recordSupplierDate;
  const promiseProblems = (rec: Rec): string[] => {
    const out: string[] = [];
    const at = now('2026-10-09T15:00:00.000Z');
    // A date from before the lane (nobody recorded who gave it), now changed by typing: neither date is the promise.
    const legacy = rec(D({ expectedDate: '2026-11-12' }), { date: '2026-12-01', source: 'typed', now: at });
    if (legacy?.promisedDate !== undefined) out.push(`a typed change of an unattributed date set the promise to ${legacy?.promisedDate}`);
    if (legacy?.dateHistory?.[0].previousDate !== '2026-11-12') out.push('the history lost the date it was');
    // The same change, but the supplier said it: THAT date is the promise, not the unattributed one before it.
    const said = rec(D({ expectedDate: '2026-11-12' }), { date: '2026-12-01', source: 'supplier_said', now: at });
    if (said?.promisedDate !== '2026-12-01') out.push(`a supplier's date after an unattributed one gave the promise ${said?.promisedDate}, not Dec 1`);
    // A first date that was only typed is not a promise; the supplier's word later is.
    const typedFirst = rec(fresh, { date: '2026-11-12', source: 'typed', now: at });
    if (typedFirst?.promisedDate !== undefined) out.push('a first date that was only typed became the promise');
    const thenSaid = rec({ ...fresh, ...typedFirst } as Delivery, { date: '2026-11-20', source: 'supplier_said', now: at });
    if (thenSaid?.promisedDate !== '2026-11-20') out.push(`after a typed date, the supplier's word gave the promise ${thenSaid?.promisedDate}, not Nov 20`);
    // Once set, nothing here moves it.
    const moved = rec({ ...fresh, expectedDate: '2026-11-20', promisedDate: '2026-11-20' } as Delivery, { date: '2026-12-09', source: 'supplier_said', now: at });
    if (moved?.promisedDate !== '2026-11-20') out.push('a later supplier date moved the promise');
    // Clearing the date to "No date yet" makes no promise of nothing.
    const cleared = rec(D({ expectedDate: '2026-11-12' }), { date: '', source: 'supplier_said', now: at });
    if (cleared?.promisedDate !== undefined) out.push('clearing the date set a promise');
    return out;
  };
  ok('the promise is set only from a date the SUPPLIER is recorded as giving: not the date before it, not a typed date, and never moved after', promiseProblems(recordSupplierDate).length === 0, promiseProblems(recordSupplierDate).join(' | '));
  plant('the OLD rule: promise = existing || previous || next (an unattributed or typed date locks as the promise)', promiseProblems((d, input) => {
    const r = recordSupplierDate(d, input);
    if (!r) return r;
    const old = (d.promisedDate ?? '') || (d.expectedDate ?? '') || (input.date ?? '');
    return { expectedDate: r.expectedDate, dateHistory: r.dateHistory, ...(old ? { promisedDate: old } : {}) };
  }).length > 0);
  plant('any first date is the promise, typed or not', promiseProblems((d, input) => { const r = recordSupplierDate(d, input); return r && !r.promisedDate && input.date ? { ...r, promisedDate: input.date } : r; }).length > 0);
  let many = fresh as Delivery;
  for (let i = 0; i < 30; i++) many = { ...many, ...recordSupplierDate(many, { date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, source: i === 0 ? 'supplier_said' : 'typed', note: 'x'.repeat(500), now: now(`2026-10-06T15:00:${String(i).padStart(2, '0')}.000Z`) }) } as Delivery;
  ok(`the history keeps the last ${DATE_HISTORY_MAX} changes, and the promise is still the first date the supplier gave`, many.dateHistory?.length === DATE_HISTORY_MAX && many.promisedDate === '2026-11-01');

  // AN UNATTRIBUTED DATE STAYS UNATTRIBUTED. A delivery from before the lane is opened to link a task and saved.
  type FormRec = typeof recordFromForm;
  const who = { by: 'u1', byName: 'Dana Ortiz', now: now('2026-10-09T15:00:00.000Z') };
  const old1 = D({ expectedDate: '2026-11-12' });
  const formProblems = (rec: FormRec, sourceFor: typeof formSourceFor): string[] => {
    const out: string[] = [];
    const opened = { date: '2026-11-12', source: sourceFor(old1), note: '' };
    if (opened.source !== 'unrecorded') out.push(`the form opens an unattributed date as "${opened.source}"`);
    const untouched = rec(old1, opened, who);
    if (untouched !== null) out.push(`saving without touching the date wrote ${JSON.stringify(untouched.dateHistory)}`);
    // The person changes the date: recorded as typed (they typed it; no word on who gave it), never as the supplier's word.
    const changed = rec(old1, { ...opened, date: '2026-12-01' }, who);
    if (changed?.dateHistory?.[0].source !== 'typed' || changed?.expectedDate !== '2026-12-01' || changed?.promisedDate !== undefined) out.push('a changed date was not recorded as typed');
    // The person picks "The Supplier Said So" for the date that is there: recorded, as their own explicit word.
    const picked = rec(old1, { ...opened, source: 'supplier_said', note: 'by phone' }, who);
    if (picked?.dateHistory?.[0].source !== 'supplier_said' || picked?.dateHistory?.[0].by !== 'u1' || picked?.promisedDate !== '2026-11-12') out.push('an explicitly picked source was not recorded');
    // A new delivery with no date records nothing; with a date, the form's default is "typed".
    if (rec(null, { date: '', source: sourceFor(null), note: '' }, who) !== null) out.push('a new delivery with no date recorded something');
    if (sourceFor(null) !== 'typed' || sourceFor(D({ expectedDate: '' })) !== 'typed') out.push('the default source for a new date is not "typed"');
    const d1src = sourceFor({ ...old1, ...picked } as Delivery);
    if (d1src !== 'supplier_said') out.push('a recorded source does not read back into the form');
    return out;
  };
  ok('opening a delivery from before the lane and pressing Save records NOTHING about its date; a changed date is "typed"; a picked source is recorded', formProblems(recordFromForm, formSourceFor).length === 0, formProblems(recordFromForm, formSourceFor).join(' | '));
  plant('the OLD form: any date that is not "typed" defaults to "the supplier said so" (the history claims a source nobody gave)',
    formProblems(recordFromForm, (d) => { const k = d ? supplierDateSource(d).kind : 'not_given'; return k === 'typed' ? 'typed' : 'supplier_said'; }).length > 0);
  plant('the save records the date whatever the form holds', formProblems((d, form, w) => recordSupplierDate(d ?? { expectedDate: '', createdAt: '' }, { date: form.date, source: form.source === 'unrecorded' ? 'typed' : form.source, note: form.note, by: w.by, byName: w.byName, now: w.now }), formSourceFor).length > 0);
  const EDIT_SRC = read('components/deliveries/DeliveryEditSheet.tsx').replace(/\/\/.*$/gm, '');
  const editRule = (src: string) => /source: formSourceFor\(d\),/.test(src) && /const dateFields = recordFromForm\(delivery, \{ date: form\.date, source: form\.source, note: form\.note \}/.test(src) && !/recordSupplierDate/.test(src) && !/'supplier_said'\s*,\s*\n\s*note: src/.test(src) && !/: 'supplier_said',/.test(src);
  ok('the dates form takes its source from formSourceFor and saves through recordFromForm (it never calls recordSupplierDate itself)', editRule(EDIT_SRC));
  plant('the form defaults the source again', !editRule(EDIT_SRC.replace('source: formSourceFor(d),', "source: src && src.kind === 'typed' ? 'typed' : 'supplier_said',")));

  // THE LABELLED CORRECTION of the promised date.
  const promised = D({ expectedDate: '2026-12-01', promisedDate: '2026-11-12', dateHistory: [{ date: '2026-12-01', previousDate: '2026-11-12', at: '2026-10-08T15:00:00.000Z', source: 'supplier_said' }] });
  const fixd = correctPromisedDate(promised, { date: '2026-11-19', by: 'u1', byName: 'Dana Ortiz', now: now('2026-10-10T15:00:00.000Z') });
  ok('a correction sets the new promise and adds ONE history entry that says what it became, what it was, when and who; the supplier date is not touched',
    !!fixd && fixd.promisedDate === '2026-11-19' && !('expectedDate' in fixd) && fixd.dateHistory?.length === 2
    && eq(fixd.dateHistory?.[1], { date: '2026-12-01', previousDate: '2026-12-01', at: '2026-10-10T15:00:00.000Z', source: 'typed', by: 'u1', byName: 'Dana Ortiz', kind: 'promise_corrected', promisedDate: '2026-11-19', previousPromisedDate: '2026-11-12' }));
  const afterFix = { ...promised, ...fixd } as Delivery;
  ok('the correction survives a read, and does not change who is said to have given the supplier date or what it was before',
    readHistory(afterFix)[1].kind === 'promise_corrected' && supplierDateSource(afterFix).kind === 'supplier_said' && previousSupplierDate(afterFix) === '2026-11-12' && scoredPromiseDate(afterFix) === '2026-11-19');
  ok('correcting to the date it already is, or to no date, records nothing', correctPromisedDate(promised, { date: '2026-11-12', now: now('2026-10-10T15:00:00.000Z') }) === null && correctPromisedDate(promised, { date: '', now: now('2026-10-10T15:00:00.000Z') }) === null);
  const proxyCopy = new Proxy({}, { get: (_t, k) => (typeof k === 'string' && /Label$/.test(k) ? `<${k}>` : (...a: unknown[]) => `${String(k)}(${a.join('|')})`) }) as unknown as DeliveriesScheduleCopy;
  const line = historyLine(proxyCopy, readHistory(afterFix)[1], 'u1', 'en');
  ok('the history prints a correction as a correction, with who made it', line.startsWith('correctedByYouBody(') && line.includes('wasBody(Nov 12)') && historyLine(proxyCopy, readHistory(afterFix)[1], 'someone-else', 'en').startsWith('correctedByNameBody(') && historyLine(proxyCopy, readHistory(afterFix)[0], 'u1', 'en').includes('saidByTeammateBody'), line);
  plant('a correction that leaves no history entry', (() => { const wrong = (d: Delivery, date: string) => ({ promisedDate: date, dateHistory: readHistory(d) }); return wrong(promised, '2026-11-19').dateHistory.length !== fixd?.dateHistory?.length; })());
  ok('the form offers the correction under its own label and saves it through correctPromisedDate', /copy\.correctScoredLabel/.test(EDIT_SRC) && /label=\{copy\.scoredDateLabel\}/.test(EDIT_SRC) && /correctPromisedDate\(\{ \.\.\.delivery, \.\.\.\(dateFields \?\? \{\}\) \}, \{ date: form\.promiseCorrection, by: me\.id, byName: me\.name, now \}\)/.test(EDIT_SRC));
  const PROMISE_DOC = read('utils/deliveries/promise.ts');
  ok('promise.ts and the Delivery type say the same three ways the promise is set', /the\s+\/\/ first date recorded as "the supplier said so"|first date recorded as "the supplier said so"/.test(PROMISE_DOC) && !/the first supplier date recorded, or the supplier date standing when it was\s*\/\/ marked ordered\)\. A delivery/.test(PROMISE_DOC) && /A date that was only typed, or that has no record of who gave it, never becomes it\./.test(read('utils/deliverySchedule.ts')));
  ok(`a note is cut to ${NOTE_MAX} characters, and a stored history that is not a list reads as empty`,
    (recordSupplierDate(fresh, { date: '2026-11-12', source: 'supplier_said', note: 'y'.repeat(500), now: now('2026-10-06T15:00:00.000Z') })?.dateHistory?.[0].note ?? '').length === NOTE_MAX
    && readHistory({ dateHistory: { date: 'x' } as unknown as Delivery['dateHistory'] }).length === 0 && readHistory({ dateHistory: [null, 3, { date: '2026-11-12' }] as unknown as Delivery['dateHistory'] }).length === 0);
  ok('marking it ordered records the day, and (only when no promise is recorded) the supplier date standing as the promise', eq(recordOrdered(D({ expectedDate: '2026-11-12' }), '2026-09-28'), { orderedOn: '2026-09-28', promisedDate: '2026-11-12' }) && eq(recordOrdered(D({ expectedDate: '2026-12-01', promisedDate: '2026-11-12' }), '2026-09-28'), { orderedOn: '2026-09-28', promisedDate: '2026-11-12' }) && eq(recordOrdered(D({ expectedDate: '' }), '2026-09-28'), { orderedOn: '2026-09-28' }));

  // THE SCORECARD. Promised Nov 12. The date was edited to Dec 1 to match the truck, which came Dec 1.
  const truck = { ...d2, status: 'delivered' as const, deliveredAt: '2026-12-01T15:00:00.000' };
  ok('the scorecard scores against the ORIGINAL promise: 19 days late, not 0', scoredPromiseDate(truck) === '2026-11-12' && slipDays(truck) === 19);
  ok('a delivery with no recorded promise is scored against its date, as before the lane', scoredPromiseDate(D()) === '2026-11-12' && slipDays(D({ status: 'delivered', deliveredAt: '2026-11-14T15:00:00.000' })) === 2);
  ok('"No date yet" has no promise and gives no score (it is never counted as on time)', scoredPromiseDate(D({ expectedDate: '' })) === '' && slipDays(D({ expectedDate: '', status: 'delivered', deliveredAt: '2026-11-14T15:00:00.000' })) === null);
  const three = [1, 2, 3].map((n) => ({ ...truck, id: `t${n}`, createdAt: '2026-10-01T16:00:00.000Z' }));
  const card = computeSupplierScorecards({ deliveries: three })[0];
  ok('three such loads read as 3 of 3 late on the supplier\'s card', card?.lateCount === 3 && card?.settledCount === 3, JSON.stringify(card && [card.lateCount, card.settledCount]));
  plant('the scorecard scores against the CURRENT date (the edit erases the slip)', (() => { const wrong = (d: Delivery) => slipDays({ ...d, promisedDate: undefined }); return wrong(truck) !== 19; })());
  ok('utils/supplierScorecard reads the promise through scoredPromiseDate', /parseLocalDate\(scoredPromiseDate\(d\)\)/.test(read('utils/supplierScorecard.ts')));
  plant('the scorecard source reads d.expectedDate directly', !/parseLocalDate\(scoredPromiseDate\(d\)\)/.test(read('utils/supplierScorecard.ts').replace('parseLocalDate(scoredPromiseDate(d))', 'parseLocalDate(d.expectedDate)')));
}

// ════════════════════════════════════════════════════════════════════════════
section('F. The row: old deliveries are written as before; Needed On Site By is never written');
const CONTEXT = read('contexts/ProjectContext.tsx');
const OLD_ROW_KEYS = ['id', 'user_id', 'project_id', 'description', 'supplier', 'commitment_id', 'po_number', 'expected_date', 'delivery_window', 'status', 'confirmed_at', 'delivered_at', 'receipt_id', 'location', 'received_by', 'notes', 'created_at', 'updated_at'];
const rowBody = (src: string): string => {
  const at = src.indexOf('const deliveryRow = useCallback((d: Delivery) => ({');
  const end = at < 0 ? -1 : src.indexOf('}), [userId]);', at);
  return at < 0 || end < 0 ? '' : src.slice(at, end).replace(/\/\/.*$/gm, '');
};
const rowRule = (src: string): string[] => {
  const body = rowBody(src);
  const problems: string[] = [];
  if (!body) return ['deliveryRow not found'];
  const keys = [...body.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  if (!eq(keys, OLD_ROW_KEYS)) problems.push(`the row's own keys are not the ${OLD_ROW_KEYS.length} from before the lane: ${keys.join(',')}`);
  if (!/\.\.\.deliveryScheduleColumns\(d\),/.test(body)) problems.push('the new columns do not come from deliveryScheduleColumns(d)');
  if (/needed|order_by/i.test(body)) problems.push('the row names a needed-by or order-by key');
  if (!/expected_date: expectedDateColumn\(d\),/.test(body)) problems.push('expected_date is not written through expectedDateColumn');
  return problems;
};
{
  ok('ProjectContext.deliveryRow: the 18 old keys, then only deliveryScheduleColumns(d)', rowRule(CONTEXT).length === 0, rowRule(CONTEXT).join(' | '));
  plant('a needed_by key is added to the row', rowRule(CONTEXT.replace('    ...deliveryScheduleColumns(d),', '    needed_by: d.expectedDate,\n    ...deliveryScheduleColumns(d),')).length > 0);
  plant('the new columns are written for every delivery (task_id: d.taskId ?? null in the row)', rowRule(CONTEXT.replace('    ...deliveryScheduleColumns(d),', '    task_id: d.taskId ?? null,')).length > 0);
  const legacy = D();
  ok('a delivery made the old way carries none of the new fields and adds NO column to its row', !carriesScheduleFields(legacy) && eq(deliveryScheduleColumns(legacy), {}) && expectedDateColumn(legacy) === '2026-11-12');
  const full = D({ taskId: 'W', bufferDays: 3, leadTimeDays: 42, orderedOn: '2026-09-28', promisedDate: '2026-11-12', taskStartSeen: '2026-11-18', dateHistory: [{ date: '2026-11-12', previousDate: '', at: '2026-10-06T15:00:00.000Z', source: 'supplier_said', note: 'by phone' }] });
  const cols = deliveryScheduleColumns(full);
  ok('the seven columns, and exactly those', eq(Object.keys(cols), [...DELIVERY_SCHEDULE_COLUMNS]) && DELIVERY_SCHEDULE_COLUMNS.length === 7 && DELIVERY_SCHEDULE_FIELDS.length === 7);
  ok('a round trip through the row gives the same fields', eq(deliveryScheduleFieldsFromRow(JSON.parse(JSON.stringify(cols))), Object.fromEntries(DELIVERY_SCHEDULE_FIELDS.map((f) => [f, full[f]]))));
  const cleared = { ...full, taskId: undefined, bufferDays: undefined };
  ok('a field the person cleared is written as null, not left out', deliveryScheduleColumns(cleared).task_id === null && deliveryScheduleColumns(cleared).buffer_days === null && Object.keys(deliveryScheduleColumns(cleared)).length === 7);
  ok('out-of-range values never reach the table: buffer 99, lead 0, an empty task id', eq([deliveryScheduleColumns({ ...full, bufferDays: 99 }).buffer_days, deliveryScheduleColumns({ ...full, leadTimeDays: 0 }).lead_time_days, deliveryScheduleColumns({ ...full, taskId: '  ' }).task_id], [null, null, null]));
  ok('a row from a table WITHOUT the columns gives no new field (the delivery is the old object)', eq(deliveryScheduleFieldsFromRow({ id: 'x', expected_date: '2026-11-12' }), {}) && !rowHasScheduleColumns({ id: 'x' }) && rowHasScheduleColumns(Object.fromEntries(DELIVERY_SCHEDULE_COLUMNS.map((c) => [c, null]))));
  ok('"No date yet" is a NULL column and an empty string on the device', expectedDateColumn(D({ expectedDate: '' })) === null && expectedDateFromRow({ expected_date: null }) === '' && expectedDateFromRow({ expected_date: '2026-11-12' }) === '2026-11-12');
  const neededWords = /needed|order_?by/i;
  ok('no column and no field of the lane is a needed-by or an order-by date', ![...DELIVERY_SCHEDULE_COLUMNS, ...DELIVERY_SCHEDULE_FIELDS].some((k) => neededWords.test(k)));
  const iface = read('utils/deliverySchedule.ts');
  const deliveryIface = iface.slice(iface.indexOf('export interface Delivery {'), iface.indexOf('/** One change of a delivery'));
  const ifaceRule = (s: string) => [...s.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '').matchAll(/^\s{2}([A-Za-z]+)\??:/gm)].map((m) => m[1]).filter((k) => neededWords.test(k));
  ok('the Delivery type has no needed-by and no order-by field', deliveryIface.length > 500 && ifaceRule(deliveryIface).length === 0, ifaceRule(deliveryIface).join(','));
  plant('a neededBy field is added to the Delivery type', ifaceRule(deliveryIface.replace('  taskId?: string;', '  taskId?: string;\n  neededBy?: string;')).length > 0);
  ok('the new Delivery fields are all optional (a delivery made by the existing creation path still type-checks)', DELIVERY_SCHEDULE_FIELDS.every((f) => new RegExp(`^\\s{2}${f}\\?:`, 'm').test(deliveryIface)) && /^\s{2}expectedDate: string;/m.test(deliveryIface));
}

// ════════════════════════════════════════════════════════════════════════════
section('G. What the lane cannot do, read from its source');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/.*$/gm, '$1');
const LANE_FILES = [
  ...readdirSync(join(ROOT, 'utils/deliveries')).map((f) => `utils/deliveries/${f}`),
  ...readdirSync(join(ROOT, 'components/deliveries')).map((f) => `components/deliveries/${f}`),
  'hooks/useDeliveriesFollowSchedule.ts',
  'hooks/useDeliveriesScheduleCopy.ts',
];
const CODE = new Map(LANE_FILES.map((f) => [f, strip(read(f))] as const));
/** What no file of the lane may contain. */
const FORBIDDEN: [string, RegExp][] = [
  ['writes a project or a schedule', /\bupdateProject\b|\bsaveSchedule\b|\bapplyToProjectSchedule\b|\bpersistEditedTasks\b|\bsetWorkingTasks\b|schedule:\s*\{\s*\.\.\./],
  ['names the schedule screen\'s commit', /\bcommitEditorBatch\b|\bcommitAiBatch\b|\bapplyWeatherReschedule\b|\bapplyLeveling\b/],
  ['calls a server function', /\.functions\b|\.invoke\(|\.rpc\(|\bfetch\(|XMLHttpRequest|\baxios\b/],
  ['raises a notification', /expo-notifications|scheduleNotificationAsync|\bsendPush\b|\bfire_notify\b|\bnotify\(|NotificationContext|useNotifications/],
  ['sends a message', /send-email|\bsendEmail\b|\bsendSms\b|sms:|\bcomposeAsync\b|expo-mail-composer|expo-sms|\bResend\b|\bshareAsync\b/],
  ['writes to the offline queue itself', /\bsupabaseWrite\b|offlineQueue/],
  ['reads a date the UTC way', /new Date\(\s*['"`]\d{4}|new Date\(`\$\{|toISOString\(\)\s*\.\s*(slice|split|substring)|\.slice\(0,\s*10\)|\bDate\.parse\(/],
  ['uses a guessed lead time', /leadTimeLibrary|getLeadTime\(|learnedLeadTime/],
  ['reads the flag outside the gate file', /DELIVERIES_FOLLOW_SCHEDULE_ENABLED/],
  ['uses react-native-reanimated', /react-native-reanimated/],
  ['uses AI', /mageAI|aiRelay|ai-relay|gemini|anthropic|openai/i],
];
const laneRule = (code: ReadonlyMap<string, string>): string[] => {
  const out: string[] = [];
  for (const [file, src] of code) {
    for (const [what, re] of FORBIDDEN) {
      if (what === 'reads the flag outside the gate file' && file === 'utils/deliveries/allowed.ts') continue;
      if (re.test(src)) out.push(`${file} ${what}`);
    }
    if (/supabase\b/.test(src) && file !== 'hooks/useDeliveriesFollowSchedule.ts') out.push(`${file} touches the database client`);
    if (/Linking\.openURL/.test(src) && file !== 'components/deliveries/DeliveryFollowSheet.tsx') out.push(`${file} opens a URL`);
  }
  const hook = code.get('hooks/useDeliveriesFollowSchedule.ts') ?? '';
  if ((hook.match(/supabase\./g) ?? []).length !== 1 || !/supabase\.from\('deliveries'\)\.select\(/.test(hook) || /\.(insert|update|upsert|delete)\(/.test(hook)) out.push('the gate hook does more than one read of the deliveries table');
  const sheet = code.get('components/deliveries/DeliveryFollowSheet.tsx') ?? '';
  if ((sheet.match(/Linking\.openURL\(/g) ?? []).length !== 1 || !/Linking\.openURL\(draftMailUrl\(draft\)\)/.test(sheet)) out.push('the sheet opens something other than the draft');
  const follow = code.get('components/deliveries/DeliveriesFollow.tsx') ?? '';
  // The only way a task list is ever changed: the HOST's commit, inside the banner's apply, from a press.
  // Two presses, and no third: Apply (the proposal) and Remove the Hold (an earlier Apply's anchor). Each names itself in the change log.
  if ((follow.match(/\bcommit\(/g) ?? []).length !== 2
    || !/const apply = \(\) => \{\s*const refused = commit\(\(prev\) => proposedTasks\(prev, proposal\.proposal\.taskId, proposal\.proposal\.notBefore, delivery\.id\), copy\.auditAppliedSub\);/.test(follow) || (follow.match(/onPress=\{apply\}/g) ?? []).length !== 1
    || !/const removeHold = \(\) => \{\s*const refused = commit\(\(prev\) => releasedTasks\(prev, delivery\.id\), copy\.auditHoldRemovedSub\);/.test(follow) || (follow.match(/onPress=\{removeHold\}/g) ?? []).length !== 1
    || (follow.match(/(?<![-\w])apply\b/g) ?? []).length !== 2 || (follow.match(/\bremoveHold\b/g) ?? []).length !== 2) out.push('the proposal is applied, or a hold removed, somewhere other than the banner\'s own two buttons');
  for (const [file, src] of code) if (file !== 'components/deliveries/DeliveriesFollow.tsx' && file !== 'utils/deliveries/jobEffect.ts' && /\breleasedTasks\b/.test(src)) out.push(`${file} removes a hold`);
  for (const [file, src] of code) if (file !== 'components/deliveries/DeliveriesFollow.tsx' && file !== 'utils/deliveries/jobEffect.ts' && /\bproposedTasks\b/.test(src)) out.push(`${file} builds a proposal`);
  if (!/mailto:\?subject=/.test(code.get('utils/deliveries/messageDraft.ts') ?? '') || /mailto:[^?]/.test(code.get('utils/deliveries/messageDraft.ts') ?? '')) out.push('the draft has a recipient filled in');
  return out;
};
{
  ok(`the ${LANE_FILES.length} files of the lane move no task, send nothing, notify nobody, call no server function and slice no date`, laneRule(CODE).length === 0, laneRule(CODE).join(' | '));
  const withLine = (file: string, line: string) => new Map([...CODE, [file, `${CODE.get(file)}\n${line}`]]);
  const PLANTS: [string, string, string][] = [
    ['a core writes the schedule', 'utils/deliveries/jobEffect.ts', 'updateProject(projectId, { schedule: { ...schedule, tasks: after } });'],
    ['the sheet applies the proposal itself', 'components/deliveries/DeliveryFollowSheet.tsx', 'commit((prev) => proposedTasks(prev, d.taskId, earliest));'],
    ['the follow host applies on mount', 'components/deliveries/DeliveriesFollow.tsx', 'useEffect(() => { commit((prev) => proposedTasks(prev, a, b)); }, []);'],
    ['the hold comes off on its own when the date improves', 'components/deliveries/DeliveriesFollow.tsx', 'useEffect(() => { if (release) removeHold(); }, [release]);'],
    ['the sheet removes the hold itself', 'components/deliveries/DeliveryFollowSheet.tsx', 'onUpdate(d.id, {}); releasedTasks(tasks, d.id);'],
    ['a flag sends a push', 'utils/deliveries/flags.ts', "import * as Notifications from 'expo-notifications';"],
    ['a flag calls notify', 'components/deliveries/DeliveriesFollow.tsx', "void supabase.functions.invoke('notify', { body: {} });"],
    ['the draft is emailed by the app', 'utils/deliveries/messageDraft.ts', "await fetch('https://api.resend.com/emails');"],
    ['the draft is texted', 'components/deliveries/DeliveryFollowSheet.tsx', 'void Linking.openURL(`sms:${phone}`);'],
    ['the draft carries a recipient', 'utils/deliveries/messageDraft.ts', 'const u = `mailto:${email}?subject=`;'],
    ['a date is sliced out of an instant', 'utils/deliveries/provenance.ts', 'const day = input.now.toISOString().slice(0, 10);'],
    ['a bare day is parsed as UTC', 'utils/deliveries/calendar.ts', "const d = new Date('2026-11-13');"],
    ['a component writes straight to the queue', 'components/deliveries/DeliveryEditSheet.tsx', "void supabaseWrite('deliveries', 'update', row);"],
    ['a second file reads the flag', 'components/deliveries/DeliveriesFollow.tsx', 'if (DELIVERIES_FOLLOW_SCHEDULE_ENABLED) {}'],
    ['a starter lead time', 'utils/deliveries/orderBy.ts', "const lead = getLeadTime('material_lead');"],
    ['the gate hook writes', 'hooks/useDeliveriesFollowSchedule.ts', "await supabase.from('deliveries').update({ task_id: null });"],
    ['a second file opens a URL', 'components/deliveries/DeliveriesFollow.tsx', 'void Linking.openURL(url);'],
  ];
  for (const [name, file, line] of PLANTS) plant(name, laneRule(withLine(file, line)).length > 0);
  // The screens write a delivery only through ProjectContext's two writers.
  const writers = [...CODE].filter(([, s]) => /\b(addDelivery|updateDelivery)\(/.test(s)).map(([f]) => f).sort();
  ok('a delivery is written only by ProjectContext.addDelivery and updateDelivery (the offline queue), from two files', eq(writers, ['components/deliveries/DeliveriesFollow.tsx']) || eq(writers, ['components/deliveries/DeliveriesFollow.tsx', 'components/deliveries/DeliveryFollowSheet.tsx']), writers.join(','));
  ok('the pure cores import no React, no storage and no database client', readdirSync(join(ROOT, 'utils/deliveries')).every((f) => !/from 'react|react-native|async-storage|@\/lib\/supabase|@\/contexts\//.test(strip(read(`utils/deliveries/${f}`)))));
  // Schedule Pro: the banner is handed the screen's own preview slot and its own undoable commit.
  const PRO = read('app/schedule-pro.tsx');
  const proRule = (s: string) => /<DeliveryProposalBanner[\s\S]{0,400}onPreview=\{setPendingPreview\}\s*commit=\{commitEditorBatch\}/.test(s) && (s.match(/DeliveryProposalBanner/g) ?? []).length === 3 && !/utils\/deliveries/.test(s);
  ok('Schedule Pro hands the banner its OWN preview slot (setPendingPreview) and its OWN undoable commit (commitEditorBatch), and imports nothing else of the lane', proRule(PRO));
  plant('Schedule Pro applies the proposal when it opens', !proRule(PRO.replace('commit={commitEditorBatch}', 'commit={commitEditorBatch}\n autoApply')) || !proRule(`${PRO}\nimport { proposedTasks } from '@/utils/deliveries/jobEffect';`));
}

// ════════════════════════════════════════════════════════════════════════════
section('H. The words, in English and Spanish');
const P = 'office.deliveriesSchedule.';
type Cat = Record<string, string | { one?: string; other: string }>;
const EN = EN_SHARD as unknown as Cat;
const ES = Object.fromEntries(Object.entries(ES_OFFICE_DELIVERIES_SCHEDULE).map(([k, v]) => [k, (v as { s: string | { one?: string; other: string } }).s])) as Cat;
const texts = (v: string | { one?: string; other: string }): string[] => (typeof v === 'string' ? [v] : [v.one ?? '', v.other]);
const all = (cat: Cat): [string, string][] => Object.entries(cat).flatMap(([k, v]) => texts(v).filter(Boolean).map((s) => [k, s] as [string, string]));
const NOT_A_PROMISE = `${P}supplierWordBody`;
const BANNED_EN: RegExp[] = [/\bwill\b/i, /\bguarantee/i, /\baccurate|\baccuracy/i, /\bverified\b|\bverify\b/i, /\bon[ -]time\b/i, /\bensure/i, /\bwarn|\balert/i, /\bpromise/i, /\bexact/i, /\balways\b|\bnever\b/i, /\bautomatic/i, /\bconfirmed\b/i, /\breal[ -]time\b|\blive\b|\btrack/i];
const BANNED_ES: RegExp[] = [/\bllegará|\bllegarán|\bva a llegar/i, /garant/i, /\bexact/i, /\bverific/i, /\ba tiempo\b|\bpuntual/i, /\basegur/i, /\balert|\badvert|\bavis/i, /promesa|promet/i, /\bsiempre\b|\bnunca\b/i, /\bautomátic/i, /\bconfirmad/i, /tiempo real|en vivo|rastre/i];
const wordRule = (en: Cat, es: Cat): string[] => {
  const out: string[] = [];
  for (const [lang, cat, banned] of [['en', en, BANNED_EN], ['es', es, BANNED_ES]] as const) {
    for (const [k, s] of all(cat)) {
      for (const re of banned) {
        if (!re.test(s)) continue;
        // The ONE line that names a promise is the line that says the date is not one.
        if (k === NOT_A_PROMISE && /promise|promesa/i.test(re.source) && /not a promise from MAGE ID|no una promesa de MAGE ID/.test(s)) continue;
        out.push(`${lang} ${k}: "${s}" matches ${re}`);
      }
      if (/[—–]|&|\be\.g\.|→|←|➜|=>|->/.test(s)) out.push(`${lang} ${k}: a dash, an "and" sign, "e.g." or an arrow`);
      if (/!/.test(s) && lang === 'en') out.push(`${lang} ${k}: an exclamation mark`);
    }
  }
  for (const [k, s] of all(en)) {
    const slug = k.slice(P.length);
    if (/Label$/.test(slug) && (!isTitleCase(s) || /[.?]$/.test(s))) out.push(`en ${k}: a label is Title Case with no period: "${s}"`);
    if (/Body$/.test(slug) && !/[.?]$/.test(s)) out.push(`en ${k}: a sentence ends with a period: "${s}"`);
    if (/Body$/.test(slug) && !/^[A-Z0-9{]/.test(s)) out.push(`en ${k}: a sentence starts with a capital: "${s}"`);
    if (/Sub$/.test(slug) && /\.$/.test(s)) out.push(`en ${k}: a caption has no closing period: "${s}"`);
  }
  for (const [k, s] of all(es)) {
    const slug = k.slice(P.length);
    if (/Body$/.test(slug) && !/[.?]$/.test(s)) out.push(`es ${k}: a sentence ends with a period: "${s}"`);
  }
  const ek = Object.keys(en).sort();
  const sk = Object.keys(es).sort();
  if (!eq(ek, sk)) out.push(`the English and Spanish keys differ: ${ek.filter((k) => !sk.includes(k)).concat(sk.filter((k) => !ek.includes(k))).join(',')}`);
  const holes = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
  for (const k of ek) {
    const a = en[k]; const b = es[k];
    if (b === undefined) continue;
    if ((typeof a === 'string') !== (typeof b === 'string')) { out.push(`${k}: one language is plural and the other is not`); continue; }
    const pa = texts(a); const pb = texts(b);
    if (holes(pa[pa.length - 1]) !== holes(pb[pb.length - 1])) out.push(`${k}: the placeholders differ`);
  }
  return out;
};
{
  ok(`English and Spanish, ${Object.keys(EN).length} keys each: none of the forbidden words, the house style, the same keys and placeholders`, Object.keys(EN).length > 100 && wordRule(EN, ES).length === 0, wordRule(EN, ES).slice(0, 12).join('\n      '));
  const en = (k: string) => EN[`${P}${k}`] as string;
  ok('the five lines the lane must say, word for word',
    en('supplierWordBody') === 'The supplier date is the supplier\'s word, not a promise from MAGE ID.'
    && en('reminderBody') === 'MAGE ID shows what the dates say. It can miss things. Check with your supplier.'
    && en('previewOnlyBody') === 'A preview only. Your schedule does not move until you apply it.'
    && en('ifNothingElseLabel') === 'If Nothing Else Changes'
    && en('notGivenBody') === 'Nobody has told MAGE ID a date.'
    && en('typedByYouBody').startsWith('Typed by you, {date}.') && en('saidByYouNoteBody') === 'Supplier said so {note}. Typed by you, {date}.'
    && en('writeToYardLabel') === 'Write a Message to the Yard' && en('seeOnScheduleLabel') === 'See It on the Schedule' && en('addForTaskLabel') === 'Add a Delivery for This Task' && en('deliveriesForTaskLabel') === 'Deliveries for This Task');
  const withEn = (k: string, s: string): Cat => ({ ...EN, [`${P}${k}`]: s });
  const withEs = (k: string, s: string): Cat => ({ ...ES, [`${P}${k}`]: s });
  const WORD_PLANTS: [string, Cat, Cat][] = [
    ['"will arrive"', withEn('gapBeforeBody', 'The delivery will arrive 2 working days before it is needed.'), ES],
    ['"on time"', withEn('gapSameDaySub', 'On time'), ES],
    ['"guaranteed"', withEn('reminderBody', 'Dates are guaranteed by your supplier.'), ES],
    ['"accurate"', withEn('finishHoldsBody', 'An accurate finish date from your schedule.'), ES],
    ['"verified"', withEn('supplierSaidLabel', 'Verified by the Supplier'), ES],
    ['a second promise', withEn('reminderBody', 'MAGE ID makes a promise to remind you.'), ES],
    ['"MAGE ID alerts you"', withEn('reminderBody', 'MAGE ID alerts you when a date slips.'), ES],
    ['"a tiempo"', EN, withEs('gapSameDaySub', 'A tiempo')],
    ['"llegará"', EN, withEs('gapBeforeBody', 'La entrega llegará antes del día en que se necesita.')],
    ['"garantizado"', EN, withEs('reminderBody', 'Las fechas están garantizadas.')],
    ['"verificado"', EN, withEs('supplierSaidLabel', 'Verificado por el proveedor')],
    ['a lower-case label', withEn('markOrderedLabel', 'Mark ordered'), ES],
    ['a sentence with no period', withEn('nothingSentBody', 'Nothing has been sent to the supplier'), ES],
    ['an em dash', withEn('previewOnlyBody', 'A preview only — your schedule does not move until you apply it.'), ES],
    ['an "and" sign', withEn('followSectionLabel', 'Deliveries & the Schedule'), ES],
    ['a Spanish key missing', EN, Object.fromEntries(Object.entries(ES).filter(([k]) => k !== `${P}reminderBody`))],
    ['a Spanish placeholder dropped', EN, withEs('taskStartsBody', 'La tarea empieza el {date}.')],
  ];
  for (const [name, a, b] of WORD_PLANTS) plant(`the words: ${name}`, wordRule(a, b).length > 0);
  ok('the shard and the Spanish file are registered', EN_SHARDS['office.deliveries-schedule'] === EN_SHARD && ES_SHARDS['office/deliveriesSchedule'] === ES_OFFICE_DELIVERIES_SCHEDULE);

  // Where the lines are shown, and that every date row carries its source.
  const comp = (f: string) => strip(read(`components/deliveries/${f}`));
  const FOLLOW = comp('DeliveriesFollow.tsx'); const SHEET = comp('DeliveryFollowSheet.tsx'); const CARD = comp('DeliveryDatesCard.tsx'); const EDIT = comp('DeliveryEditSheet.tsx');
  const shown = (follow: string, sheet: string, edit: string) => /copy\.supplierWordBody/.test(follow) && /copy\.reminderBody/.test(follow) && /copy\.supplierWordBody/.test(sheet) && /copy\.reminderBody/.test(sheet)
    && /copy\.previewOnlyBody/.test(sheet) && /copy\.draftOnlyBody/.test(sheet) && /copy\.ifNothingElseLabel/.test(sheet) && /copy\.supplierWordBody/.test(edit) && (follow.match(/copy\.previewOnlyBody/g) ?? []).length === 2
    && (follow.match(/copy\.supplierWordBody/g) ?? []).length >= 2;
  ok('the honesty lines are on the Deliveries block, the task section, the delivery sheet, the form and the schedule banner', shown(FOLLOW, SHEET, EDIT));
  plant('the reminder line is taken off the sheet', !shown(FOLLOW, SHEET.replace('copy.reminderBody', 'copy.closeLabel'), EDIT));
  plant('the preview line is taken off the banner', !shown(FOLLOW.replace('copy.previewOnlyBody', 'copy.closeLabel'), SHEET, EDIT));
  const dateRowRule = (card: string, sheet: string, edit: string, follow: string): string[] => {
    const out: string[] = [];
    if (!/label: string;[\s\S]{0,400}\bbasis: string;/.test(card) || /basis\?:/.test(card)) out.push('DateRow.basis is not a required string');
    if (!/<Text style=\{styles\.dateBasis\} testID=\{`\$\{testID\}-basis`\}>\{basis\}<\/Text>/.test(card)) out.push('DateRow does not always draw its basis');
    for (const [name, src] of [['card', card], ['sheet', sheet], ['edit', edit], ['follow', follow]] as const) {
      const rows = src.match(/<DateRow\b[\s\S]*?\/>/g) ?? [];
      for (const r of rows) if (!/\bbasis=\{/.test(r)) out.push(`${name}: a DateRow without a basis`);
      // A date label is only ever drawn as a DateRow's label.
      const labels = (src.match(/copy\.(neededByLabel|supplierDateLabel|orderByLabel|finishDateLabel)\b/g) ?? []).length;
      const inRows = rows.join('\n').match(/label=\{copy\.(neededByLabel|supplierDateLabel|orderByLabel|finishDateLabel)\}/g)?.length ?? 0;
      const formUses = name === 'edit' ? (src.match(/(fieldLabel\}>\{copy\.supplierDateLabel\}|accessibilityLabel=\{copy\.supplierDateLabel\}|title=\{copy\.supplierDateLabel\})/g) ?? []).length : 0;
      if (labels !== inRows + formUses) out.push(`${name}: a date label is drawn outside a DateRow (${labels} uses, ${inRows} rows)`);
    }
    return out;
  };
  ok('every date row is a DateRow, and a DateRow cannot be drawn without the line that says where the date came from', dateRowRule(CARD, SHEET, EDIT, FOLLOW).length === 0 && (CARD.match(/<DateRow\b/g) ?? []).length === 3, dateRowRule(CARD, SHEET, EDIT, FOLLOW).join(' | '));
  plant('a date row loses its basis', dateRowRule(CARD.replace("basis={neededBasisLine(copy, needed)}", ''), SHEET, EDIT, FOLLOW).length > 0);
  plant('the basis becomes optional', dateRowRule(CARD.replace('basis: string;', 'basis?: string;'), SHEET, EDIT, FOLLOW).length > 0);
  plant('a date is drawn as plain text beside its label', dateRowRule(CARD, `${SHEET}\n<Text>{copy.neededByLabel}</Text>`, EDIT, FOLLOW).length > 0);
  // The three line builders never return an empty line, whatever the state.
  const fake = new Proxy({}, { get: (_t, k) => (typeof k === 'string' && /Body$|Sub$|Label$/.test(k) && !/^(needed|said|typed|unrecorded|was|gap(Before|After)|order|earliest|finishLater|later|slid|moved|now|start|after|cannot|proposal|taskStarts|toReview)/.test(k) ? `<${k}>` : (...a: unknown[]) => `<${String(k)}:${a.join(',')}>`) }) as unknown as DeliveriesScheduleCopy;
  const lines = [
    ...NEED_CASES.map((c) => neededBasisLine(fake, neededOnSiteBy({ taskId: c.taskId, bufferDays: c.buffer }, c.schedule))),
    supplierSourceLine(fake, { kind: 'not_given' }, 'me', 'en'), supplierSourceLine(fake, { kind: 'unrecorded', at: '2026-10-01T16:00:00.000Z' }, 'me', 'en'),
    supplierSourceLine(fake, { kind: 'supplier_said', note: 'by phone', at: '2026-10-06T16:00:00.000Z', by: 'me', byName: '' }, 'me', 'en'),
    supplierSourceLine(fake, { kind: 'supplier_said', note: '', at: '2026-10-06T16:00:00.000Z', by: 'x', byName: 'Luis' }, 'me', 'en'),
    supplierSourceLine(fake, { kind: 'typed', at: '2026-10-06T16:00:00.000Z', by: '', byName: '' }, 'me', 'en'),
    orderBasisLine(fake, null, ''), orderBasisLine(fake, 42, '2026-10-02'), orderBasisLine(fake, 42, ''),
    gapLine(fake, { kind: 'no_date' }), gapLine(fake, { kind: 'before', workingDays: 1 }), gapLine(fake, { kind: 'after', workingDays: 2 }), gapLine(fake, { kind: 'same_day' }), gapLine(fake, { kind: 'no_needed_by' }),
  ];
  ok(`the source lines are never empty (${lines.length} states)`, lines.every((l) => typeof l === 'string' && l.length > 2), lines.filter((l) => !l || l.length <= 2).join('|'));
  ok('"No date yet" shows as No Date Yet with a caution tone, never a plain or good one', eq(gapChip(fake, { kind: 'no_date' }), { text: '<noDateYetLabel>', tone: 'warn' }) && gapChip(fake, { kind: 'after', workingDays: 2 })?.tone === 'danger' && gapChip(fake, { kind: 'no_needed_by' }) === null);

  // The draft: facts only, and nobody is addressed.
  const W: DraftWords = { subject: (w) => `S:${w}`, hello: (s) => `H:${s}`, about: (w) => `A:${w}`, po: (p) => `PO:${p}`, yourDate: (d) => `Y:${d}`, noDateFromYou: 'NODATE', neededChanged: (a, b) => `N:${a}>${b}`, needed: (d) => `N:${d}`, askHold: (d) => `HOLD:${d}`, askEarlier: (d) => `EARLIER:${d}`, askDate: 'ASK', thanks: 'T' };
  const draft = buildSupplierDraft({ delivery: { description: 'Framing Lumber Package', supplier: 'Kessler Lumber Yard', poNumber: '1042', expectedDate: '2026-10-19' }, neededBy: '2026-10-27', neededByWas: '2026-10-19', gap: { kind: 'before', workingDays: 6 }, senderName: 'Dana Ortiz', formatDay: (d) => d, words: W });
  ok('the draft states the delivery, the PO, the supplier\'s date, the old and new needed-by dates and one question',
    draft.subject === 'S:Framing Lumber Package' && draft.body === 'H:Kessler Lumber Yard\n\nA:Framing Lumber Package\nPO:1042\nY:2026-10-19\nN:2026-10-19>2026-10-27\n\nHOLD:2026-10-27\n\nT\nDana Ortiz');
  ok('the question follows the dates: after asks for the day, no date asks for a date', buildSupplierDraft({ delivery: { description: 'x', supplier: 'y', expectedDate: '2026-12-01' }, neededBy: '2026-11-13', neededByWas: '', gap: { kind: 'after', workingDays: 12 }, senderName: '', formatDay: (d) => d, words: W }).body.includes('EARLIER:2026-11-13')
    && buildSupplierDraft({ delivery: { description: 'x', supplier: 'y', expectedDate: '' }, neededBy: '2026-11-13', neededByWas: '', gap: { kind: 'no_date' }, senderName: '', formatDay: (d) => d, words: W }).body.includes('NODATE\nN:2026-11-13\n\nASK'));
  ok('the draft opens in the mail app with NO recipient, and the builder takes no price, client, project or address', draftMailUrl(draft).startsWith('mailto:?subject=') && !/project|client|price|amount|address|contract/i.test(strip(read('utils/deliveries/messageDraft.ts')).replace(/poNumber/g, '')));
}

// ════════════════════════════════════════════════════════════════════════════
section('I. The gate');
{
  ok('the flag is false', (DELIVERIES_FOLLOW_SCHEDULE_ENABLED as boolean) === false);
  ok('flag off: only the owner account passes; flag on: everyone', deliveriesFollowScheduleAllowedWith(false, 'omirmajeed2000@gmail.com') && deliveriesFollowScheduleAllowedWith(false, ' OmirMajeed2000@Gmail.com ') && !deliveriesFollowScheduleAllowedWith(false, 'dana@ridgelinebuilders.test') && !deliveriesFollowScheduleAllowedWith(false, null) && !deliveriesFollowScheduleAllowedWith(false, '') && deliveriesFollowScheduleAllowedWith(true, 'dana@ridgelinebuilders.test'));
  // Who reads the flag, across the whole app.
  const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '__tests__', 'dist', '.git'].includes(e.name) ? [] : walk(`${dir}/${e.name}`)) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
  const SOURCES = ['app', 'components', 'hooks', 'contexts', 'utils', 'lib'].flatMap(walk);
  const readers = SOURCES.filter((f) => /DELIVERIES_FOLLOW_SCHEDULE_ENABLED/.test(strip(read(f))));
  ok('the flag is read in ONE file, utils/deliveries/allowed.ts', eq(readers, ['utils/deliveries/allowed.ts']), readers.join(','));
  // Who reaches the lane from outside it.
  const outside = SOURCES.filter((f) => !LANE_FILES.includes(f) && /@\/(components|utils)\/deliveries\/|useDeliveriesFollowSchedule|useDeliveriesScheduleCopy/.test(strip(read(f))));
  // The last two are the Supplier Link (lane DELIVERIES-2): its section sits on this lane's sheet and reads this lane's pure
  // helpers (the settled test, the calendar day, the date record) and its sheet styles. It has its own flag, files and validator
  // (scripts/validate-delivery-supplier-link.ts).
  const DOORS = ['app/deliveries.tsx', 'app/schedule-pro.tsx', 'components/schedule/mobile/TaskDetailSheet.tsx', 'contexts/ProjectContext.tsx', 'utils/supplierScorecard.ts', 'utils/offlineQueue.ts', 'components/deliveryLink/SupplierLinkSection.tsx', 'components/deliveryLink/TruckRouteStrip.tsx', 'utils/deliveryLink/core.ts'];
  ok('the lane is reached from nine files and no other: the Deliveries screen, the task sheet, Schedule Pro (the three doors), the delivery row mapping, the scorecard\'s basis, the sync queue (the one rewrite of a write that names a missing column), and the three files of the Supplier Link (its section, its truck strip and its rules)', eq(outside.sort(), [...DOORS].sort()), outside.sort().join(','));
  const importsOf = (f: string) => [...strip(read(f)).matchAll(/from '(@\/(?:components|utils|hooks)\/[^']*[dD]eliver[^']*)'/g)].map((m) => m[1]).filter((p) => /deliveries\/|DeliveriesFollow|DeliveriesSchedule/.test(p));
  ok('each door imports only its one piece', eq(importsOf('app/deliveries.tsx'), ['@/components/deliveries/DeliveriesFollow']) && eq(importsOf('app/schedule-pro.tsx'), ['@/components/deliveries/DeliveriesFollow']) && eq(importsOf('components/schedule/mobile/TaskDetailSheet.tsx'), ['@/components/deliveries/DeliveriesFollow'])
    && eq(importsOf('contexts/ProjectContext.tsx'), ['@/utils/deliveries/rowCore']) && eq(importsOf('utils/supplierScorecard.ts'), ['@/utils/deliveries/promise']) && eq(importsOf('utils/offlineQueue.ts'), ['@/utils/deliveries/columnsGate']));
  const FOLLOW = strip(read('components/deliveries/DeliveriesFollow.tsx'));
  const doorRule = (s: string) => /if \(!gate\.on \|\| !model\) return \{ on: false, pending: gate\.pending, block: null, sheets: null, openAdd, openDelivery, datesLabel: copy\.deliveryDatesLabel, noDateGroupLabel: copy\.noDateGroupLabel, shownIds: NO_IDS \};/.test(s) && /if \(!gate\.on \|\| !project\) return null;/.test(s) && /const active = gate\.on && gate\.canPreviewJobEffect && !!deliveryId;/.test(s) && /if \(!active \|\| !delivery\) return null;/.test(s) && /if \(!gate\.on\) return null;\s*const open = scoped/.test(s) && /if \(gate\.on\) setEdit\(/.test(s) && /if \(gate\.on\) setOpenId\(/.test(s);
  ok('each of the three doors draws nothing and opens nothing when the gate is closed', doorRule(FOLLOW));
  plant('the task section draws for everyone', !doorRule(FOLLOW.replace('if (!gate.on || !project) return null;', 'if (!project) return null;')));
  plant('the banner previews with the gate closed', !doorRule(FOLLOW.replace('const active = gate.on && gate.canPreviewJobEffect && !!deliveryId;', 'const active = !!deliveryId;')));
  plant('the opener works with the gate closed', !doorRule(FOLLOW.replace('if (gate.on) setEdit(', 'setEdit(')));
  const HOOK = strip(read('hooks/useDeliveriesFollowSchedule.ts'));
  const hookRule = (s: string) => /const allowed = deliveriesFollowScheduleAllowed\(user\?\.email\) && !!user\?\.id;/.test(s) && /enabled: allowed && answer === 'unseen',/.test(s) && /const on = allowed && answer === 'seen';/.test(s) && /if \(error\) return false;/.test(s) && /canPreviewJobEffect: on && isProOrAbove/.test(s)
    && /const pending = allowed && answer === 'unknown';/.test(s) && /queryKey: \['deliveries-follow-schedule-columns', user\?\.id \?\? null, epoch\],/.test(s) && /if \(columnsAnswer\(\) === 'unknown'\) setColumnsAnswer\(seen \? 'seen' : 'unseen'\);/.test(s);
  ok('the gate hook: allowed AND the table has the columns (an error, or offline with nothing seen, keeps it closed); pending only while the remembered answer is read, and only for a person the gate allows; asked again when a write proves it wrong; the job effect on Pro and up', hookRule(HOOK));
  plant('the feature opens before the columns are seen', !hookRule(HOOK.replace("const on = allowed && answer === 'seen';", 'const on = allowed;')));
  plant('an error from the table counts as "the columns are there"', !hookRule(HOOK.replace('if (error) return false;', 'if (error) return true;')));
  plant('the job effect is open to every plan', !hookRule(HOOK.replace('canPreviewJobEffect: on && isProOrAbove', 'canPreviewJobEffect: on')));
  plant('the screen is held for a person the gate does not allow (flag off would no longer be today\'s screen)', !hookRule(HOOK.replace("const pending = allowed && answer === 'unknown';", "const pending = answer === 'unknown';")));
  plant('the remembered answer is never asked about again (the epoch is out of the key)', !hookRule(HOOK.replace("user?.id ?? null, epoch],", 'user?.id ?? null],')));
  // The Deliveries screen: what it adds is behind follow.on, and the golden pins the rest.
  const SCREEN = strip(read('app/deliveries.tsx'));
  const screenRule = (s: string) => /const follow = useDeliveriesFollow\(projectId, \{ onConfirm: confirm, onReceive: receive \}\);/.test(s) && (s.match(/follow\.(block|sheets)/g) ?? []).length >= 2 && /follow\.on \? follow\.openAdd/.test(s) && (s.match(/onDates=\{follow\.on \? follow\.openDelivery : undefined\}/g) ?? []).length === 4 && !/DELIVERIES_FOLLOW|deliveriesFollowScheduleAllowed|isOwner\(/.test(s);
  ok('the Deliveries screen reaches the lane through one hook, and the old form is replaced only when follow.on', screenRule(SCREEN));
  const snap = 'app/../__tests__/smoke/__snapshots__/deliveries-schedule-golden.test.tsx.snap'.replace('app/../', '');
  const golden = existsSync(join(ROOT, snap)) ? read(snap) : '';
  const goldenTest = read('__tests__/smoke/deliveries-schedule-golden.test.tsx');
  ok('the golden of the Deliveries screen (flag off, not the owner) is committed: two snapshots, and its test mocks neither the flag nor the gate', (golden.match(/^exports\[`/gm) ?? []).length === 2 && /Roof Trusses/.test(golden) && /3 days late/.test(golden) && /Expecting a Delivery/.test(golden) && !/dfs-/.test(golden) && !/jest\.mock\(/.test(goldenTest));
  ok('the storage key the gate remembers is under an app-owned prefix', /DELIVERY_COLUMNS_SEEN_KEY = 'mageid_deliveries_fs_columns_seen'/.test(read('utils/deliveries/columnsGate.ts')) && DELIVERY_COLUMNS_SEEN_KEY.startsWith('mageid_'));
}

// ════════════════════════════════════════════════════════════════════════════
section('J. The migration text');
const MIG_FILE = 'supabase/migrations/20261012090000_deliveries_follow_schedule.sql';
const MIG = read(MIG_FILE);
const migRule = (sql: string): string[] => {
  const out: string[] = [];
  const code = sql.replace(/^\s*--.*$/gm, '');
  const adds = [...code.matchAll(/alter table public\.deliveries add column if not exists ([a-z_]+) ([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  if (!eq(adds.map((a) => a[0]), [...DELIVERY_SCHEDULE_COLUMNS])) out.push(`the added columns are not the seven the app writes: ${adds.map((a) => a[0]).join(',')}`);
  for (const [name, type] of adds) if (/not null|default/i.test(type)) out.push(`${name} is added NOT NULL or with a default`);
  if (!/alter table public\.deliveries alter column expected_date drop not null;/.test(code)) out.push('expected_date does not drop NOT NULL');
  // THE ONE TRIGGER, and nothing else that acts. Its function and its trigger are cut out and read on their own; what is left may touch no policy, grant, trigger, function, job or row.
  const fn = (code.match(/create or replace function public\.deliveries_fs_keep_record\(\)[\s\S]*?\$fn\$;/) ?? [''])[0];
  const trg = (code.match(/drop trigger if exists deliveries_fs_keep_record on public\.deliveries;\s*create trigger deliveries_fs_keep_record[\s\S]*?;/) ?? [''])[0];
  const REVOKE = 'revoke all on function public.deliveries_fs_keep_record() from public, anon, authenticated;';
  const rest = code.replace(/do \$\$[\s\S]*?end \$\$;/, '').replace(fn, '').replace(trg, '').replace(REVOKE, '');
  if (/\b(create|drop|alter)\s+policy\b|\bgrant\b|\brevoke\b|\bcreate\s+(or replace\s+)?(function|trigger|procedure)\b|pg_cron|cron\.schedule|net\.http|fire_notify|\bdelete from\b|\bupdate public\./i.test(rest)) out.push('the migration touches a policy, a grant, a trigger, a function, a job or existing rows outside its one trigger');
  if (!fn) out.push('the trigger function deliveries_fs_keep_record() is missing');
  else {
    if (!/returns trigger\s+language plpgsql\s+security invoker\s+set search_path = ''/.test(fn) || /security definer/i.test(fn)) out.push('the trigger function is not SECURITY INVOKER with an empty search_path');
    const body = fn.slice(fn.indexOf('$fn$'));
    if (/\b(insert|delete|perform|execute|raise|notify|pg_notify|select\s+.*\bfrom\b|update\s+\w)\b|net\.|http/i.test(body)) out.push('the trigger function does more than keep two columns (it raises, writes, reads a table or calls out)');
    const sets = body.match(/new\.[a-z_]+\s*:=/g) ?? [];
    if (sets.length !== 2 || !sets.every((a) => /new\.(promised_date|date_history)\s*:=/.test(a))) out.push('the trigger function assigns something other than promised_date and date_history');
    if (!/new\.promised_date := old\.promised_date;/.test(body) || !/new\.date_history := old\.date_history;/.test(body)) out.push('the trigger function does not keep the two columns as they were');
    if (!/\(v_last ->> 'kind'\) is distinct from 'promise_corrected'/.test(body) || !/\(v_last ->> 'promisedDate'\) is distinct from to_char\(new\.promised_date, 'YYYY-MM-DD'\)/.test(body) || !/\(v_last ->> 'previousPromisedDate'\) is distinct from to_char\(old\.promised_date, 'YYYY-MM-DD'\)/.test(body)) out.push('the correction is not read from the last history entry (its kind, what it became, what it was)');
    if (!/jsonb_array_length\(new\.date_history\) < jsonb_array_length\(old\.date_history\)/.test(body) || !/new\.date_history is null/.test(body)) out.push('the history can be shrunk or nulled');
  }
  if (!/create trigger deliveries_fs_keep_record\s+before update of promised_date, date_history on public\.deliveries\s+for each row execute function public\.deliveries_fs_keep_record\(\);/.test(trg)) out.push('the trigger is not BEFORE UPDATE OF promised_date, date_history, FOR EACH ROW');
  if ((code.match(/\bcreate trigger\b/gi) ?? []).length !== 1 || (code.match(/\bcreate (or replace )?function\b/gi) ?? []).length !== 1) out.push('there is more than the one trigger and its one function');
  if (!code.replace(/do \$\$[\s\S]*?end \$\$;/, '').includes(REVOKE) || /\bgrant\b/i.test(code.replace(/do \$\$[\s\S]*?end \$\$;/, ''))) out.push('EXECUTE on the trigger function is not revoked, or something is granted');
  if (!/prosecdef/.test(sql) || !/has_function_privilege\('authenticated', 'public\.deliveries_fs_keep_record\(\)', 'execute'\)/.test(sql) || !/v_names is distinct from 'deliveries_fs_keep_record'/.test(sql)) out.push('the self-check does not pin the one trigger, SECURITY INVOKER and no EXECUTE');
  if (!sql.includes('-- THE ONE TRIGGER.') || !/IT DOES NOT REFUSE THE UPDATE/.test(sql)) out.push('the header does not describe the one trigger');
  if (/shows it as having no date/.test(sql) || !/AN OLDER BUILD DOES NOT LIST A DELIVERY WITH A NULL\s+--\s+expected_date AT ALL/.test(sql)) out.push('the header still says an older build shows a delivery with no date');
  if (/the first supplier\s+--\s+date recorded for the delivery, or the supplier date/.test(sql) || !/only typed, or a date from before these columns/.test(sql)) out.push('the header describes the old promise rule');
  if (/add column[^;]*\b(needed|order_by)/i.test(code)) out.push('a needed-by or order-by column is added');
  for (const head of ['-- WHY.', '-- WHAT IS ADDED', '-- WHO WRITES / WHO READS.', '-- DEPLOY ORDER.', '-- VERIFY AFTER', '-- UNDO', '-- WHAT IS NOT ADDED, ON PURPOSE.', '-- ACCOUNT DELETION AND EXPORT.']) if (!sql.includes(head)) out.push(`the header has no "${head}"`);
  if (!/do \$\$[\s\S]*raise exception '\[deliveries_follow_schedule\] verify:[\s\S]*end \$\$;/.test(sql)) out.push('there is no self-check block');
  if (!/v_n <> 4/.test(sql) || !/column_name like 'needed%'/.test(sql)) out.push('the self-check does not pin the four policies and the absence of a needed-by column');
  if ((code.match(/between 0 and 60|between 1 and 730|jsonb_array_length\(date_history\) <= 40|octet_length\(date_history::text\) <= 16384|char_length\(task_id\) between 1 and 200/g) ?? []).length !== 5) out.push('a check is missing (buffer, lead time, history entries, history bytes, task id)');
  if (!/notify pgrst, 'reload schema';\s*$/.test(sql)) out.push('the schema cache is not reloaded');
  return out;
};
{
  ok('nullable columns only, expected_date nullable, no policy, no grant, no needed-by column, ONE trigger (SECURITY INVOKER, keeps two columns, refuses and touches nothing else), the header and the self-check', migRule(MIG).length === 0, migRule(MIG).join(' | '));
  const MIG_PLANTS: [string, string][] = [
    ['a column added NOT NULL', MIG.replace('add column if not exists buffer_days integer;', 'add column if not exists buffer_days integer not null default 2;')],
    ['a needed-by column', MIG.replace("notify pgrst, 'reload schema';", "alter table public.deliveries add column if not exists needed_by date;\nnotify pgrst, 'reload schema';")],
    ['a policy changed', MIG.replace("notify pgrst, 'reload schema';", "create policy deliveries_all on public.deliveries for all using (true);\nnotify pgrst, 'reload schema';")],
    ['a trigger that moves something', MIG.replace("notify pgrst, 'reload schema';", "create trigger deliveries_follow_schedule_touch before update on public.deliveries for each row execute function public.x();\nnotify pgrst, 'reload schema';")],
    ['a grant to anon', MIG.replace("notify pgrst, 'reload schema';", "grant select on public.deliveries to anon;\nnotify pgrst, 'reload schema';")],
    ['expected_date left NOT NULL', MIG.replace('alter table public.deliveries alter column expected_date drop not null;', '')],
    ['the history cap removed', MIG.replace('\n    and jsonb_array_length(date_history) <= 40', '')],
    ['the self-check removed', MIG.replace(/do \$\$[\s\S]*end \$\$;/, '')],
    ['the undo section removed', MIG.replace('-- UNDO', '-- LATER')],
    ['the trigger function made SECURITY DEFINER', MIG.replace('security invoker\nset search_path', 'security definer\nset search_path')],
    ['the trigger raises (a stale phone\'s whole write is refused)', MIG.replace('      new.promised_date := old.promised_date;', "      raise exception 'written once';")],
    ['the trigger writes another column', MIG.replace('    new.date_history := old.date_history;', '    new.date_history := old.date_history;\n    new.notes := old.notes;')],
    ['the trigger fires on every update', MIG.replace('  before update of promised_date, date_history on public.deliveries', '  before update on public.deliveries')],
    ['the trigger also fires on insert', MIG.replace('  before update of promised_date, date_history on public.deliveries', '  before insert or update of promised_date, date_history on public.deliveries')],
    ['the correction need not say what the promise was', MIG.replace("\n       or (v_last ->> 'previousPromisedDate') is distinct from to_char(old.promised_date, 'YYYY-MM-DD') then", ' then')],
    ['the history may be nulled', MIG.replace('(new.date_history is null\n          or ', '(')],
    ['EXECUTE left with everyone', MIG.replace('revoke all on function public.deliveries_fs_keep_record() from public, anon, authenticated;', '')],
    ['execute granted to authenticated', MIG.replace('revoke all on function public.deliveries_fs_keep_record() from public, anon, authenticated;', 'revoke all on function public.deliveries_fs_keep_record() from public, anon, authenticated;\ngrant execute on function public.deliveries_fs_keep_record() to authenticated;')],
    ['a second function that notifies', MIG.replace("notify pgrst, 'reload schema';", "create or replace function public.deliveries_fs_tell() returns trigger language plpgsql as $t$ begin perform pg_notify('x', 'y'); return new; end $t$;\nnotify pgrst, 'reload schema';")],
    ['the header keeps the old "older builds show it" line', MIG.replace('AN OLDER BUILD DOES NOT LIST A DELIVERY WITH A NULL', 'An older build shows it as having no date. A NULL')],
    ['an eighth column the app does not write', MIG.replace('alter table public.deliveries add column if not exists task_start_seen date;', 'alter table public.deliveries add column if not exists task_start_seen date;\nalter table public.deliveries add column if not exists supplier_token uuid;')],
  ];
  for (const [name, sql] of MIG_PLANTS) plant(`the migration: ${name}`, migRule(sql).length > 0);
  const proof = existsSync(join(ROOT, 'scripts/pgq/deliveries-follow-schedule.mjs')) ? read('scripts/pgq/deliveries-follow-schedule.mjs') : '';
  ok('the PGlite proof is committed, names this file, the real deliveries table and the real access rule, and plants 22 mutations (8 of them on the trigger)',
    proof.includes("const FILE = '20261012090000_deliveries_follow_schedule.sql';") && proof.includes("readMigration(ROOT, '20260826200000_deliveries.sql')") && proof.includes('20260826130000_field_role.sql') && /\n    22: \[/.test(proof) && !/\n    23: \[/.test(proof) && /'23 the trigger function is SECURITY INVOKER/.test(proof) && /'18 the promise is written once/.test(proof) && /'21 the history is not shrunk/.test(proof)
    && read('scripts/pgq/README.md').includes('deliveries-follow-schedule.mjs'));
  ok('the app applies nothing: no file of the lane names apply_migration or db push outside a comment', [...CODE.values()].every((s) => !/apply_migration|db push/.test(s)));
}

// ════════════════════════════════════════════════════════════════════════════
section('K. Registration');
{
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  ok('test:deliveries-schedule runs this file and is in the ship-check chain', pkg.scripts['test:deliveries-schedule'] === 'bun run scripts/validate-deliveries-schedule.ts' && pkg.scripts['ship-check'].split(' && ').includes('bun run test:deliveries-schedule'));
  const links = pkg.scripts['ship-check'].split(' && ').length;
  const validators = pkg.scripts['ship-check'].split(' && ').filter((l) => !['bun run typecheck', 'bun run lint', 'bun run test:smoke'].includes(l)).length;
  const gate = read('.github/workflows/ship-gate.yml');
  ok(`the ship gate's job name counts ${links} checks (${validators} validators)`, gate.includes(`ship-check — ${links} checks (${validators} validators, typecheck, lint, jest)`), (gate.match(/name: ship-check.*/) ?? [''])[0]);
  ok('the i18n surface is registered to the one copy hook', /id: 'office\.deliveries-schedule'[^\n]*keyPrefixes: \['office\.deliveriesSchedule\.'\][^\n]*files: \['hooks\/useDeliveriesScheduleCopy\.ts'\]/.test(read('i18n/surfaces.ts')));
  ok('the smoke tests of the three screens exist', existsSync(join(ROOT, '__tests__/smoke/deliveries-schedule.test.tsx')) && existsSync(join(ROOT, '__tests__/smoke/deliveries-schedule-golden.test.tsx')));
}

// ════════════════════════════════════════════════════════════════════════════
section('L. The review fixes that are read from the screens and the queue');
{
  const raw = (f: string) => strip(read(f));
  const FOLLOW = raw('components/deliveries/DeliveriesFollow.tsx');
  const SCREEN = raw('app/deliveries.tsx');
  const REGISTER = raw('components/registers/DeliveriesRegister.tsx');
  const CARD = raw('components/deliveries/DeliveryDatesCard.tsx');
  const EDIT = raw('components/deliveries/DeliveryEditSheet.tsx');
  const PRO = raw('app/schedule-pro.tsx');
  const QUEUE = raw('utils/offlineQueue.ts');
  const en = (k: string) => EN[`${P}${k}`];

  // 3. THE TASK SHEET IS HANDED ITS JOB. A cloned job keeps its task ids (utils/projectClone), so a task id names two jobs.
  const jobRule = (follow: string, sheet: string, phone: string): string[] => {
    const out: string[] = [];
    if (!/export function TaskDeliveriesSection\(\{ taskId, projectId \}: \{ taskId: string; projectId: string \}\)/.test(follow)) out.push('the task section is not handed a projectId');
    if (!/const project = useMemo\(\(\) => projects\.find\(\(p\) => p\.id === projectId\) \?\? null, \[projects, projectId\]\);/.test(follow)) out.push('the task section does not find its job by id');
    if (/tasks \?\? \[\]\)\.some\(\(x\) => x\.id === taskId\)/.test(follow)) out.push('a job is looked up by task id');
    if (!/tab === 'docs' && projectId \? <TaskDeliveriesSection taskId=\{task\.id\} projectId=\{projectId\} \/> : null/.test(sheet)) out.push('TaskDetailSheet does not pass its projectId');
    if (!/<TaskDetailSheet\s+visible=\{!!detailTask\}\s+task=\{detailTask\}\s+projectId=\{selectedProject\.id\}/.test(phone)) out.push('the schedule screen does not hand the task sheet its job');
    return out;
  };
  const SHEET_TASK = raw('components/schedule/mobile/TaskDetailSheet.tsx');
  const PHONE = raw('components/schedule/mobile/MobileScheduleScreen.tsx');
  ok('"Deliveries for This Task" is handed the job by the schedule screen and finds it by id, never by task id', jobRule(FOLLOW, SHEET_TASK, PHONE).length === 0, jobRule(FOLLOW, SHEET_TASK, PHONE).join(' | '));
  plant('the job is found by task id again (a cloned job gets the other job\'s deliveries)', jobRule(FOLLOW.replace('projects.find((p) => p.id === projectId) ?? null, [projects, projectId]', 'projects.find((p) => (p.schedule?.tasks ?? []).some((x) => x.id === taskId)) ?? null, [projects, taskId]'), SHEET_TASK, PHONE).length > 0);
  plant('the task sheet stops passing the job', jobRule(FOLLOW, SHEET_TASK.replace('projectId={projectId} />', '/>'), PHONE).length > 0);
  ok('utils/projectClone still keeps task ids on a clone (the reason the job must be handed in): the reset deletes no id', !/delete next\.id|id: generate|id: `/.test(raw('utils/projectClone.ts').slice(raw('utils/projectClone.ts').indexOf('export function resetTaskForTemplate'), raw('utils/projectClone.ts').indexOf('export function cloneScheduleAsTemplate'))));

  // 4. A PERSON'S APPLY IS LOGGED AS A PERSON'S.
  const auditRule = (pro: string, follow: string): string[] => {
    const out: string[] = [];
    if (!/\(producer: \(prev: ScheduleTask\[\]\) => ScheduleTask\[\], source\?: string\): string \| void => \{/.test(pro)) out.push('commitEditorBatch takes no source label');
    if (!/const named = source\?\.trim\(\);\s*if \(named\) \{ commitAiBatch\(producer, named\); return; \}\s*commitAiBatch\(producer, 'AI schedule edit'\);/.test(pro)) out.push('the editor commit always logs "AI schedule edit"');
    if (!/copy\.auditAppliedSub\);/.test(follow) || !/copy\.auditHoldRemovedSub\);/.test(follow)) out.push('the banner does not name its own change');
    if (!/commit: \(producer: \(prev: ScheduleTask\[\]\) => ScheduleTask\[\], source: string\) => string \| void;/.test(follow)) out.push('the banner\'s commit prop has no required source');
    return out;
  };
  ok('the schedule\'s commit takes a source label, and the banner\'s Apply reads "Applied from a delivery" in the change log (never "AI schedule edit")', auditRule(PRO, FOLLOW).length === 0 && en('auditAppliedSub') === 'Applied from a delivery' && en('auditHoldRemovedSub') === 'Hold removed from a delivery' && !/\bAI\b/.test(String(en('auditAppliedSub'))), auditRule(PRO, FOLLOW).join(' | '));
  plant('the commit ignores the label', auditRule(PRO.replace('if (named) { commitAiBatch(producer, named); return; }', ''), FOLLOW).length > 0);
  plant('the banner applies with no label', auditRule(PRO, FOLLOW.replace(', copy.auditAppliedSub);', ');')).length > 0);

  // 5. "NO DATE YET" IS LISTED AND CAN BE RECEIVED.
  const NOW = new Date(2026, 9, 14, 12).getTime();
  const open = [D({ id: 'late', expectedDate: '2026-10-10' }), D({ id: 'soon', expectedDate: '2026-10-16' }), D({ id: 'none2', expectedDate: '', createdAt: '2026-10-03T16:00:00.000Z' }), D({ id: 'none1', expectedDate: '', createdAt: '2026-10-02T16:00:00.000Z' }),
    D({ id: 'gone', expectedDate: '', status: 'delivered' }), D({ id: 'off', expectedDate: '', status: 'cancelled' })];
  const look = buildLookahead(open, 7, NOW);
  ok('the look-ahead keeps open deliveries with no date in their own list (oldest first), outside late, upcoming and the counts; settled ones are not in it',
    eq(look.undated.map((v) => v.delivery.id), ['none1', 'none2']) && eq(look.late.map((v) => v.delivery.id), ['late']) && eq(look.upcoming.map((v) => v.delivery.id), ['soon']) && eq(look.counts, { upcoming: 1, late: 1, unconfirmed: 1 })
    && buildLookahead([D()], 7, NOW).undated.length === 0);
  plant('the OLD look-ahead: a delivery with no date is on no list', (() => { const { undated: _gone, ...old } = look; return !('undated' in old) && [...old.late, ...old.upcoming].every((v) => v.delivery.expectedDate !== ''); })());
  const listRule = (screen: string, register: string): string[] => {
    const out: string[] = [];
    if (!/\{look\.undated\.length > 0 && \(/.test(screen) || !/\{look\.undated\.map\(v => \(\s*<Row key=\{v\.delivery\.id\}[\s\S]{0,200}onReceive=\{receive\} noConfirm/.test(screen)) out.push('the phone list has no "No Date Yet" group with Received');
    if (!/testID=\{`receive-\$\{d\.id\}`\}/.test(screen) || !/d\.status !== 'confirmed' && !noConfirm && \(/.test(screen)) out.push('the no-date row offers Confirm, or no Received');
    if (!/const undatedRows = useMemo\(\(\) => \(look\.undated \?\? \[\]\)\.map\(toRow\)/.test(register) || !/testID="deliveries-register-undated"/.test(register) || !/rows=\{undatedRows\}/.test(register)) out.push('the desktop register has no table of deliveries with no date');
    if (!/onDates\?: \(d: Delivery\) => void;/.test(register) || !/\{onDates \? \(\s*<Button[^>]*testID=\{`dfs-dates-\$\{r\.id\}`\} onPress=\{\(\) => onDates\(d\)\} \/>/.test(register)) out.push('the desktop register cannot open a delivery\'s dates');
    if (!/<DeliveriesRegister[\s\S]{0,700}onDates=\{follow\.on \? follow\.openDelivery : undefined\}/.test(screen)) out.push('the screen does not pass onDates to the desktop register');
    return out;
  };
  ok('the base list has a "No Date Yet" group with Received (no Confirm: there is no date), on the phone and in the desktop register, and the register can open a delivery\'s dates', listRule(SCREEN, REGISTER).length === 0, listRule(SCREEN, REGISTER).join(' | '));
  plant('the phone list drops the no-date group', listRule(SCREEN.replace('{look.undated.length > 0 && (', '{false && ('), REGISTER).length > 0);
  plant('the desktop register is not handed onDates', listRule(SCREEN.replace(/(<DeliveriesRegister[\s\S]{0,700})onDates=\{follow\.on \? follow\.openDelivery : undefined\}/, '$1'), REGISTER).length > 0);
  plant('the desktop register has no undated table', listRule(SCREEN, REGISTER.replace('rows={undatedRows}', 'rows={[]}')).length > 0);
  // The Arrived matcher: the truck at the gate may be the load nobody dated.
  type Match = typeof lateMatchForSupplier;
  const loads = [D({ id: 'u2', supplier: 'Kessler Lumber Yard', expectedDate: '', createdAt: '2026-10-05T16:00:00.000Z' }), D({ id: 'u1', supplier: 'kessler  lumber yard', expectedDate: '', createdAt: '2026-10-04T16:00:00.000Z' }),
    D({ id: 'future', supplier: 'Kessler Lumber Yard', expectedDate: '2026-11-20' }), D({ id: 'done', supplier: 'Kessler Lumber Yard', expectedDate: '', status: 'delivered' })];
  const matchProblems = (m: Match): string[] => {
    const out: string[] = [];
    if (m(loads, 'p1', 'Kessler Lumber Yard', '2026-10-14')?.id !== 'u1') out.push('an undated open delivery from the supplier is not offered (oldest first)');
    if (m([...loads, D({ id: 'due', supplier: 'Kessler Lumber Yard', expectedDate: '2026-10-12' })], 'p1', 'Kessler Lumber Yard', '2026-10-14')?.id !== 'due') out.push('a dated, due delivery does not come before an undated one');
    if (m(loads.filter((d) => d.expectedDate !== ''), 'p1', 'Kessler Lumber Yard', '2026-10-14') !== null) out.push('a delivery dated in the future is offered');
    if (m(loads, 'p1', 'Northside Glass', '2026-10-14') !== null || m(loads, 'p2', 'Kessler Lumber Yard', '2026-10-14') !== null) out.push('another supplier\'s or another job\'s delivery is offered');
    return out;
  };
  ok('"It\'s here now" offers an undated open delivery from that supplier (after any dated one that is due), never a settled, future or other supplier\'s load', matchProblems(lateMatchForSupplier).length === 0, matchProblems(lateMatchForSupplier).join(' | '));
  plant('the OLD matcher: only deliveries with a date', matchProblems((ds, p, sup, today) => lateMatchForSupplier(ds.filter((d) => d.expectedDate !== ''), p, sup, today)).length > 0);

  // 7. ONE ROW, NOT TWO.
  const oneRow = (follow: string, screen: string, card: string): string[] => {
    const out: string[] = [];
    if (!/\.filter\(\(d\) => !!d\.taskId \|\| hasNoSupplierDate\(d\)\)/.test(follow) || !/shownIds: new Set\(rows\.map\(\(x\) => x\.d\.id\)\)/.test(follow)) out.push('the block does not report every delivery it draws');
    if (!/const keep = \(v: DeliveryView\) => !follow\.shownIds\.has\(v\.delivery\.id\);/.test(screen) || !/late: allLook\.late\.filter\(keep\), upcoming: allLook\.upcoming\.filter\(keep\), undated: allLook\.undated\.filter\(keep\)/.test(screen)) out.push('the screen does not leave the block\'s deliveries out of its own rows');
    if (/allLook\.(late|upcoming|undated)\.(map|length)\b/.test(screen) || !/look=\{look\}/.test(screen) || !/summaryLook=\{allLook\}/.test(screen)) out.push('a list is drawn from the unfiltered look-ahead');
    if (!/actions=\{actions\}/.test(follow) || !/testID=\{`dfs-confirm-\$\{id\}`\}/.test(card) || !/testID=\{`dfs-receive-\$\{id\}`\}/.test(card) || !/onPress=\{\(\) => actions\.onReceive\(delivery\)\}/.test(card) || !/onPress=\{\(\) => actions\.onConfirm\(delivery\)\}/.test(card)) out.push('the card does not carry the screen\'s Confirm and Received');
    if (!/shownIds: NO_IDS \};/.test(follow)) out.push('with the gate closed the screen is told to hide rows');
    return out;
  };
  ok('with the block on, a delivery it draws is left out of the old Late, Upcoming and No Date rows, and its card carries the screen\'s own Confirm and Received; with the gate closed nothing is hidden', oneRow(FOLLOW, SCREEN, CARD).length === 0, oneRow(FOLLOW, SCREEN, CARD).join(' | '));
  plant('the old rows keep the linked deliveries (two rows each)', oneRow(FOLLOW, SCREEN.replace('late: allLook.late.filter(keep)', 'late: allLook.late'), CARD).length > 0);
  plant('the card loses Received (a linked delivery could not be received)', oneRow(FOLLOW, SCREEN, CARD.replace('onPress={() => actions.onReceive(delivery)}', 'onPress={() => undefined}')).length > 0);
  plant('the block hides rows it does not draw', oneRow(FOLLOW.replace('shownIds: new Set(rows.map((x) => x.d.id))', 'shownIds: new Set(open.map((x) => x.id))'), SCREEN, CARD).length > 0);

  // 10. THE APPLIED LINE CLEARS AFTER UNDO; 13. THE SHARED PREVIEW SLOT.
  const bannerRule = (follow: string): string[] => {
    const out: string[] = [];
    if (!/const asLeft = closed === 'applied' \? holdIsOn : !holdIsOn;\s*if \(asLeft\) settledRef\.current = true;\s*else if \(settledRef\.current\) \{ settledRef\.current = false; setClosed\('no'\); \}/.test(follow)) out.push('"Applied… Undo takes it back" does not clear once the hold it applied is gone');
    if (!/const held = useMemo\(\(\) => \(delivery \? deliveryHold\(tasks, delivery\.id\) : null\), \[delivery, tasks\]\);/.test(follow)) out.push('the banner does not read the hold from the tasks the schedule is drawing');
    if (!/const mine = overlayRef\.current;\s*onPreviewRef\.current\(mine\);\s*return \(\) => \{ onPreviewRef\.current\(\(current\) => \(current === mine \? null : current\)\); \};/.test(follow)) out.push('the banner\'s cleanup clears the preview slot whoever holds it');
    if (/onPreviewRef\.current\(null\)/.test(follow)) out.push('the banner sets the shared slot to null outright');
    if (!/onPreview: React\.Dispatch<React\.SetStateAction<SchedulePreviewOverlay \| null>>;/.test(follow)) out.push('the banner is not handed the slot\'s setter');
    if (!/r\.kind === 'can_release' \? r : null/.test(follow) || !/testID="dfs-hold-remove"/.test(follow)) out.push('the banner does not offer to remove an improved hold');
    return out;
  };
  ok('the banner: the Applied line clears after Undo; a hold whose supplier date improved is offered for removal; its cleanup clears the shared preview slot only while the slot is still its own', bannerRule(FOLLOW).length === 0, bannerRule(FOLLOW).join(' | '));
  plant('the cleanup clears the slot outright (it wipes the Change tab\'s preview)', bannerRule(FOLLOW.replace('onPreviewRef.current((current) => (current === mine ? null : current));', 'onPreviewRef.current(null);')).length > 0);
  plant('the Applied line stays up after Undo', bannerRule(FOLLOW.replace("else if (settledRef.current) { settledRef.current = false; setClosed('no'); }", '')).length > 0);

  // 12. A WRITE THAT PROVES THE COLUMNS GONE: forget, close, re-send the old way.
  const fullRow = { id: 'x', project_id: 'p1', description: '14 Windows', expected_date: null, status: 'scheduled', ...deliveryScheduleColumns(D({ taskId: 'W', bufferDays: 3, promisedDate: '2026-11-12' })) };
  const PGRST204 = "Could not find the 'task_id' column of 'deliveries' in the schema cache";
  type Rewrite = typeof rewriteForMissingColumns;
  const gateProblems = (rw: Rewrite): string[] => {
    const out: string[] = [];
    setColumnsAnswer('seen');
    const e0 = columnsEpoch();
    const sent = rw('deliveries', fullRow, PGRST204, 'PGRST204');
    if (!sent || !eq(Object.keys(sent), ['id', 'project_id', 'description', 'expected_date', 'status'])) out.push(`the row is not re-sent with the old columns only: ${sent ? Object.keys(sent).join(',') : 'null'}`);
    if (columnsAnswer() !== 'unseen' || columnsEpoch() !== e0 + 1) out.push('the feature is not closed and the table is not asked again');
    if (!eq(Object.keys(fullRow).length, 12)) out.push('the queued row was changed in place');
    setColumnsAnswer('seen');
    const e1 = columnsEpoch();
    // Not this lane's failure: another table, another error, a row with none of the columns, a column that is not one of the seven.
    if (rw('invoices', fullRow, PGRST204, 'PGRST204') !== null) out.push('another table\'s write is rewritten');
    if (rw('deliveries', fullRow, 'new row violates row-level security policy', '42501') !== null) out.push('an access refusal is rewritten');
    if (rw('deliveries', { id: 'x', description: 'y' }, PGRST204, 'PGRST204') !== null) out.push('a row with none of the columns is rewritten');
    if (rw('deliveries', fullRow, "Could not find the 'delivery_window' column of 'deliveries' in the schema cache", 'PGRST204') !== null) out.push('a miss on another column is rewritten');
    if (rw('deliveries', fullRow, 'TypeError: Network request failed', undefined) !== null) out.push('a network failure is rewritten');
    if (columnsAnswer() !== 'seen' || columnsEpoch() !== e1) out.push('the feature closes on a failure that is not a missing column');
    if (!rw('deliveries', fullRow, 'column "date_history" of relation "deliveries" does not exist', '42703')) out.push('Postgres\'s own "column does not exist" is not handled');
    setColumnsAnswer('unknown');
    return out;
  };
  ok('a delivery write refused for one of the seven columns closes the feature, has the table asked again, and is re-sent with the old columns only; nothing else is touched', gateProblems(rewriteForMissingColumns).length === 0 && eq(withoutScheduleColumns({ id: 1, task_id: 'a', notes: null }), { id: 1, notes: null }), gateProblems(rewriteForMissingColumns).join(' | '));
  plant('the write is kept unchanged (the queue wedges on it)', gateProblems(() => null).length > 0);
  plant('the row is stripped but the remembered answer is trusted', gateProblems((t, d) => (t === 'deliveries' && d ? withoutScheduleColumns(d) : null)).length > 0);
  plant('every schema-cache miss on any table is rewritten', gateProblems((_t, d, m, c) => rewriteForMissingColumns('deliveries', d, m, c)).length > 0);
  const queueRule = (q: string): string[] => {
    const out: string[] = [];
    if (!/const rewritten = rewriteForMissingColumns\(table, data, message, code\);\s*if \(!rewritten\) return null;\s*try \{ await AsyncStorage\.removeItem\(DELIVERY_COLUMNS_SEEN_KEY\); \}/.test(q)) out.push('the stored key is not removed when a write proves it wrong');
    const flush = q.indexOf("const oldColumnsOnly = mutation.operation === 'rpc' ? null : await deliveryRowWithoutMissingColumns(mutation.table, mutation.data, msg, code);");
    const flushTransient = q.indexOf('if (isNetworkError(err) || isSchemaCacheError(msg) || isAuthTransientError(msg, code)) {', flush);
    if (flush < 0 || flushTransient < 0 || !/gRemaining\.push\(\{ \.\.\.mutation, data: oldColumnsOnly \}\);/.test(q.slice(flush, flushTransient))) out.push('the flush re-queues the write unchanged (before asking whether a schedule column is missing)');
    const direct = q.indexOf("const oldColumnsOnly = operation === 'rpc' ? null : await deliveryRowWithoutMissingColumns(table, data, msg, code);");
    const directTransient = q.indexOf('if (isNetworkError(err) || isSchemaCacheError(msg) || isAuthTransientError(msg, code)) {', direct);
    if (direct < 0 || directTransient < 0 || !/enqueueOrFail\(\{ \.\.\.m, data: oldColumnsOnly \}, writerId, dropNoticeFor\(opts\)\);/.test(q.slice(direct, directTransient))) out.push('a direct write queues the row unchanged');
    if ((q.match(/deliveryRowWithoutMissingColumns\(/g) ?? []).length !== 3) out.push('the rewrite is not asked at exactly the two places a write fails');
    return out;
  };
  ok('the sync queue asks at both places a write fails, BEFORE treating the miss as "keep unchanged", removes the stored key, and queues the row with the old columns', queueRule(QUEUE).length === 0, queueRule(QUEUE).join(' | '));
  const GATE_SRC = raw('utils/deliveries/columnsGate.ts');
  const noImports = (src: string) => !/^\s*import\b|\brequire\(/m.test(src);
  ok('the one file of the lane the sync queue loads imports nothing (the queue does not pull the schedule engine in behind it), and rowCore takes the seven columns from it', noImports(GATE_SRC) && /export \{ DELIVERY_SCHEDULE_COLUMNS, type DeliveryScheduleColumn \};/.test(raw('utils/deliveries/rowCore.ts')) && /from '\.\/columnsGate';/.test(raw('utils/deliveries/rowCore.ts')));
  plant('columnsGate imports the row mapping (and the engine with it)', !noImports(`import { DELIVERY_SCHEDULE_COLUMNS } from './rowCore';\n${GATE_SRC}`));
  plant('the flush keeps the write unchanged', queueRule(QUEUE.replace('gRemaining.push({ ...mutation, data: oldColumnsOnly });', 'gRemaining.push(mutation);')).length > 0);
  plant('the stored key is left in place', queueRule(QUEUE.replace('try { await AsyncStorage.removeItem(DELIVERY_COLUMNS_SEEN_KEY); }', 'try { await Promise.resolve(); }')).length > 0);

  // 14. THE WORDING, AND THE SCREEN DOES NOT FLASH THE OLD LIST.
  const copyRule = (cat: Cat, edit: string, screen: string): string[] => {
    const out: string[] = [];
    const g = (k: string) => texts(cat[`${P}${k}`] ?? '').join(' ');
    if (g('nothingSentBody') !== 'MAGE ID has sent nothing.') out.push(`"nothing sent" is not a statement about what MAGE ID did: "${g('nothingSentBody')}"`);
    if (/\bearly\b|\blate\b|\bahead\b|\bbehind\b/i.test(g('nowEarlyBody')) || !/before the day it is needed\./.test(g('nowEarlyBody')) || !/^The supplier date for \{what\} is now /.test(g('nowEarlyBody'))) out.push(`the moved line gives a verdict, not a position: "${g('nowEarlyBody')}"`);
    for (const k of ['whatPlaceholder', 'supplierPlaceholder', 'windowPlaceholder', 'bufferLessLabel', 'bufferMoreLabel']) if (!g(k)) out.push(`${k} is not in the catalog`);
    if (/placeholder="[^"]/.test(edit) || /accessibilityLabel=\{`\$\{copy\.bufferLabel\}/.test(edit) || !/placeholder=\{copy\.whatPlaceholder\}/.test(edit) || !/placeholder=\{copy\.supplierPlaceholder\}/.test(edit) || !/placeholder=\{copy\.windowPlaceholder\}/.test(edit) || !/accessibilityLabel=\{copy\.bufferLessLabel\}/.test(edit) || !/accessibilityLabel=\{copy\.bufferMoreLabel\}/.test(edit)) out.push('the form has a hard-coded placeholder or a stitched-together stepper label');
    if (!/\{follow\.pending \? null : \(/.test(screen) || !/\{isDesktopWeb && follow\.pending \? null : isDesktopWeb \? \(/.test(screen)) out.push('the old list is drawn before the gate\'s remembered answer is back');
    return out;
  };
  ok('the wording: "MAGE ID has sent nothing."; the moved line says where the supplier date sits; placeholders and stepper labels come from the catalog, in both languages; the old list waits for the remembered answer',
    copyRule(EN, EDIT, SCREEN).length === 0 && ['whatPlaceholder', 'supplierPlaceholder', 'windowPlaceholder', 'bufferLessLabel', 'bufferMoreLabel', 'nothingSentBody', 'nowEarlyBody'].every((k) => !!ES[`${P}${k}`]) && ES[`${P}nothingSentBody`] === 'MAGE ID no ha enviado nada.',
    copyRule(EN, EDIT, SCREEN).join(' | '));
  plant('"Nothing has been sent to the supplier."', copyRule({ ...EN, [`${P}nothingSentBody`]: 'Nothing has been sent to the supplier.' }, EDIT, SCREEN).length > 0);
  plant('"{what} is now N working days early."', copyRule({ ...EN, [`${P}nowEarlyBody`]: { one: '{what} is now 1 working day early.', other: '{what} is now {count} working days early.' } }, EDIT, SCREEN).length > 0);
  plant('a hard-coded English placeholder', copyRule(EN, EDIT.replace('placeholder={copy.whatPlaceholder}', 'placeholder="14 Windows"'), SCREEN).length > 0);
  plant('the stepper label "Buffer -1"', copyRule(EN, EDIT.replace('accessibilityLabel={copy.bufferLessLabel}', 'accessibilityLabel={`${copy.bufferLabel} -1`}'), SCREEN).length > 0);
  plant('the old list is drawn while the gate is pending', copyRule(EN, EDIT, SCREEN.replace('{follow.pending ? null : (', '{false ? null : (')).length > 0);
}

console.log(fails === 0
  ? `\n✓ validate-deliveries-schedule: ${checks} checks passed, ${plants} of ${plants} planted mutations caught`
  : `\n✗ validate-deliveries-schedule: ${fails} of ${checks} failed`);
process.exit(fails === 0 ? 0 : 1);
