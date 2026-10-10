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
//
// Run: bun run scripts/validate-deliveries-schedule.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScheduleTask } from '../types';
import type { Delivery } from '../utils/deliverySchedule';
import { runCpm } from '../utils/cpm';
import { buildSchedulePreviewOverlay } from '../utils/schedulePreviewOverlay';
import { slipDays, computeSupplierScorecards } from '../utils/supplierScorecard';
import { isWorkedDay, stepWorkingDays, workingDaysFromTo, stepCalendarDays, compareDays } from '../utils/deliveries/calendar';
import { DEFAULT_BUFFER_WORKING_DAYS, bufferDaysOf, neededByForStart, neededOnSiteBy, scheduleDays, type ScheduleForDeliveries } from '../utils/deliveries/neededBy';
import { flagsFor, scheduleMovedFlag, supplierGap, supplierLateFlag, toReviewCount } from '../utils/deliveries/flags';
import { proposedTasks, supplierJobEffect } from '../utils/deliveries/jobEffect';
import { endOfLocalWeek, leadTimeDaysOf, leadTimeFromInput, leadTimeParts, orderByDate, whatToOrderThisWeek } from '../utils/deliveries/orderBy';
import { DATE_HISTORY_MAX, NOTE_MAX, previousSupplierDate, readHistory, recordOrdered, recordSupplierDate, supplierDateSource } from '../utils/deliveries/provenance';
import { scoredPromiseDate } from '../utils/deliveries/promise';
import {
  DELIVERY_SCHEDULE_COLUMNS, DELIVERY_SCHEDULE_FIELDS, carriesScheduleFields, deliveryScheduleColumns, deliveryScheduleFieldsFromRow,
  expectedDateColumn, expectedDateFromRow, rowHasScheduleColumns,
} from '../utils/deliveries/rowCore';
import { deliveriesFollowScheduleAllowedWith } from '../utils/deliveries/allowed';
import { buildSupplierDraft, draftMailUrl, type DraftWords } from '../utils/deliveries/messageDraft';
import { DELIVERIES_FOLLOW_SCHEDULE_ENABLED } from '../constants/featureFlags';
import { gapChip, gapLine, neededBasisLine, orderBasisLine, supplierSourceLine } from '../components/deliveries/words';
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
  const WANT = { needed: '2026-11-13', back: '2026-11-06', gap: 6, moved: ['2026-10-22', '2026-10-30', '2026-10-19', '2026-10-27', 6], effect: ['2026-12-02', '2026-12-16', '2026-12-22', 4], order: '2026-10-02', weekEnd: '2026-10-04' };
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
// The windows are needed Fri Nov 13. The supplier now says Tue Dec 1.
// The first working day after is Wed Dec 2: Window Install slides from Wed
// Nov 18, 10 working days (19, 20, 23, 24, 25, 26, 27, 30, Dec 1, Dec 2).
//   Window Install  Dec 2, 3, 4, 7          (was Nov 18 .. 23)
//   Exterior Trim   Dec 8 .. 14             (was Nov 24 .. 30)   10 later
//   Siding          Dec 15 .. 21            (was Dec 1 .. 7)     10 later
//   Interior Finishes does not move: Nov 18 .. Dec 15
//   Final Inspection waits for Siding: Tue Dec 22 (was Wed Dec 16)
// The finish date moves 4 working days (17, 18, 21, 22): the rest was float.
{
  const sched = HOUSE();
  freeze(sched);
  const d = freeze(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }));
  const e = supplierJobEffect(d, sched);
  ok('the picture: earliest start Dec 2, 10 working days later', e.kind === 'task_slides' && e.taskStartWas === '2026-11-18' && e.taskStartEarliest === '2026-12-02' && e.taskSlipWorkingDays === 10 && eq(e.proposal, { taskId: 'W', notBefore: '2026-12-02' }), JSON.stringify(e.kind === 'task_slides' ? [e.taskStartEarliest, e.taskSlipWorkingDays] : e));
  ok('the finish date moves from Wed Dec 16 to Tue Dec 22: 4 working days', e.kind === 'task_slides' && e.finishWas === '2026-12-16' && e.finishNow === '2026-12-22' && e.finishDeltaWorkingDays === 4);
  ok('three tasks slide: Exterior Trim 10, Siding 10, Final Inspection 4; Interior Finishes and Framing do not',
    e.kind === 'task_slides' && eq(e.slides.map((s) => [s.id, s.workingDaysLater]), [['T', 10], ['S', 10], ['X', 4]]) && e.linked.id === 'W');
  ok('the frozen schedule and the frozen delivery were not changed (a change would have thrown)', e.kind === 'task_slides');
  if (e.kind === 'task_slides') {
    // The reuse, proven: build the schedule's preview directly, the way the copilot's review does, and compare.
    const before = HOUSE_TASKS();
    const after = proposedTasks(before, 'W', '2026-12-02');
    const opt = { scheduleStartDate: '2026-11-02', workingDaysPerWeek: 5, nonWorkingDates: undefined };
    const direct = buildSchedulePreviewOverlay(before, after, runCpm(before, opt), runCpm(after, opt));
    ok('the effect\'s overlay IS the object utils/schedulePreviewOverlay builds for the same proposal (finish +6 calendar days)', eq(e.overlay, direct) && direct.finishDeltaDays === 6 && direct.moved.length === 4);
    ok('the proposal is the schedule\'s own "start no earlier than" anchor on that one task, on a copy',
      after !== before && after.filter((t, i) => t !== before[i]).length === 1 && after.find((t) => t.id === 'W')?.anchorType === 'start-no-earlier' && after.find((t) => t.id === 'W')?.anchorDate === '2026-12-02' && before.find((t) => t.id === 'W')?.anchorType === undefined);
  }
  // Inside the buffer: the supplier says Mon Nov 16 (after Fri Nov 13). The next working day is Tue Nov 17, before the Wed Nov 18 start.
  ok('a supplier date inside the buffer: the start holds', supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-11-16' }), HOUSE()).kind === 'start_holds');
  // Inside the float: Gutters (2 days after Window Install, nothing waits on it) starts Tue Nov 24, needed Thu Nov 19.
  // Supplier says Mon Nov 30: Gutters slides to Tue Dec 1 .. Wed Dec 2 and the finish date stays Dec 16.
  const withGutters = HOUSE({}, [...HOUSE_TASKS(), T('G', 'Gutters', 2, ['W'])]);
  const g = supplierJobEffect(D({ taskId: 'G', bufferDays: 3, expectedDate: '2026-11-30' }), withGutters);
  ok('a slip inside the float: the task slides, no other task moves and the finish date does not', g.kind === 'task_slides' && g.taskStartEarliest === '2026-12-01' && g.finishDeltaWorkingDays === 0 && g.slides.length === 0 && g.finishNow === '2026-12-16', JSON.stringify(g.kind === 'task_slides' ? [g.taskStartEarliest, g.finishDeltaWorkingDays, g.slides.length] : g));
  const why = (x: ReturnType<typeof supplierJobEffect>) => (x.kind === 'cannot_say' ? x.why : x.kind);
  ok('nothing is said when nothing can be: no date, not after, a loop, a pinned task, a started task, a settled load, no start date',
    why(supplierJobEffect(D({ taskId: 'W', expectedDate: '' }), HOUSE())) === 'no_supplier_date'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-11-12' }), HOUSE())) === 'not_after_needed'
    && why(supplierJobEffect(D({ taskId: 'B', bufferDays: 0, expectedDate: '2026-12-01' }), HOUSE({}, [T('A', 'A', 2, ['B']), T('B', 'B', 2, ['A'])]))) === 'cycle'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE({}, HOUSE_TASKS().map((t) => (t.id === 'W' ? { ...t, anchorType: 'must-start-on' as const, anchorDate: '2026-11-18' } : t))))) === 'task_pinned'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE({}, HOUSE_TASKS().map((t) => (t.id === 'W' ? { ...t, status: 'in_progress' as const } : t))))) === 'task_started'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01', status: 'delivered' }), HOUSE())) === 'settled'
    && why(supplierJobEffect(D({ taskId: 'W', bufferDays: 3, expectedDate: '2026-12-01' }), HOUSE({ startDate: undefined }))) === 'schedule_undated');
  plant('the earliest start is the supplier date itself, not the working day after', e.kind === 'task_slides' && e.taskStartEarliest !== '2026-12-01');
  plant('the finish moves by the task\'s slip (10), ignoring the float', e.kind === 'task_slides' && e.finishDeltaWorkingDays !== e.taskSlipWorkingDays);
  plant('a proposal that edits the task list in place', (() => { const f = freeze(HOUSE_TASKS()); try { const w = f.find((t) => t.id === 'W'); if (w) (w as ScheduleTask).anchorDate = '2026-12-02'; return false; } catch { return true; } })());
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
  const legacy = recordSupplierDate(D({ expectedDate: '2026-11-12' }), { date: '2026-12-01', source: 'typed', now: now('2026-10-09T15:00:00.000Z') });
  ok('a delivery that had a date before the lane keeps THAT date as its promise when the date is changed', legacy?.promisedDate === '2026-11-12' && legacy?.dateHistory?.[0].previousDate === '2026-11-12');
  let many = fresh as Delivery;
  for (let i = 0; i < 30; i++) many = { ...many, ...recordSupplierDate(many, { date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, source: 'typed', note: 'x'.repeat(500), now: now(`2026-10-06T15:00:${String(i).padStart(2, '0')}.000Z`) }) } as Delivery;
  ok(`the history keeps the last ${DATE_HISTORY_MAX} changes, and the promise is still the first date`, many.dateHistory?.length === DATE_HISTORY_MAX && many.promisedDate === '2026-11-01');
  ok(`a note is cut to ${NOTE_MAX} characters, and a stored history that is not a list reads as empty`,
    (recordSupplierDate(fresh, { date: '2026-11-12', source: 'supplier_said', note: 'y'.repeat(500), now: now('2026-10-06T15:00:00.000Z') })?.dateHistory?.[0].note ?? '').length === NOTE_MAX
    && readHistory({ dateHistory: { date: 'x' } as unknown as Delivery['dateHistory'] }).length === 0 && readHistory({ dateHistory: [null, 3, { date: '2026-11-12' }] as unknown as Delivery['dateHistory'] }).length === 0);
  ok('marking it ordered records the day, and the promise if none was recorded', eq(recordOrdered(D({ expectedDate: '2026-11-12' }), '2026-09-28'), { orderedOn: '2026-09-28', promisedDate: '2026-11-12' }) && eq(recordOrdered(D({ expectedDate: '2026-12-01', promisedDate: '2026-11-12' }), '2026-09-28'), { orderedOn: '2026-09-28', promisedDate: '2026-11-12' }) && eq(recordOrdered(D({ expectedDate: '' }), '2026-09-28'), { orderedOn: '2026-09-28' }));

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
  if ((follow.match(/\bcommit\(/g) ?? []).length !== 1 || !/const apply = \(\) => \{\s*const refused = commit\(\(prev\) => proposedTasks\(prev, proposal\.proposal\.taskId, proposal\.proposal\.notBefore\)\);/.test(follow) || !/onPress=\{apply\}/.test(follow)) out.push('the proposal is applied somewhere other than the banner\'s own button');
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
    && /copy\.previewOnlyBody/.test(sheet) && /copy\.draftOnlyBody/.test(sheet) && /copy\.ifNothingElseLabel/.test(sheet) && /copy\.supplierWordBody/.test(edit) && /copy\.previewOnlyBody/.test(follow)
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
  const DOORS = ['app/deliveries.tsx', 'app/schedule-pro.tsx', 'components/schedule/mobile/TaskDetailSheet.tsx', 'contexts/ProjectContext.tsx', 'utils/supplierScorecard.ts'];
  ok('the lane is reached from five files and no other: the Deliveries screen, the task sheet, Schedule Pro (the three doors), the delivery row mapping and the scorecard\'s basis', eq(outside.sort(), [...DOORS].sort()), outside.sort().join(','));
  const importsOf = (f: string) => [...strip(read(f)).matchAll(/from '(@\/(?:components|utils|hooks)\/[^']*[dD]eliver[^']*)'/g)].map((m) => m[1]).filter((p) => /deliveries\/|DeliveriesFollow|DeliveriesSchedule/.test(p));
  ok('each door imports only its one piece', eq(importsOf('app/deliveries.tsx'), ['@/components/deliveries/DeliveriesFollow']) && eq(importsOf('app/schedule-pro.tsx'), ['@/components/deliveries/DeliveriesFollow']) && eq(importsOf('components/schedule/mobile/TaskDetailSheet.tsx'), ['@/components/deliveries/DeliveriesFollow'])
    && eq(importsOf('contexts/ProjectContext.tsx'), ['@/utils/deliveries/rowCore']) && eq(importsOf('utils/supplierScorecard.ts'), ['@/utils/deliveries/promise']));
  const FOLLOW = strip(read('components/deliveries/DeliveriesFollow.tsx'));
  const doorRule = (s: string) => /if \(!gate\.on \|\| !model\) return \{ on: false, block: null, sheets: null, openAdd, openDelivery, datesLabel: copy\.deliveryDatesLabel \};/.test(s) && /if \(!gate\.on \|\| !project\) return null;/.test(s) && /const active = gate\.on && gate\.canPreviewJobEffect && !!deliveryId;/.test(s) && /if \(!active \|\| !delivery\) return null;/.test(s) && /if \(!gate\.on\) return null;\s*const open = scoped/.test(s) && /if \(gate\.on\) setEdit\(/.test(s) && /if \(gate\.on\) setOpenId\(/.test(s);
  ok('each of the three doors draws nothing and opens nothing when the gate is closed', doorRule(FOLLOW));
  plant('the task section draws for everyone', !doorRule(FOLLOW.replace('if (!gate.on || !project) return null;', 'if (!project) return null;')));
  plant('the banner previews with the gate closed', !doorRule(FOLLOW.replace('const active = gate.on && gate.canPreviewJobEffect && !!deliveryId;', 'const active = !!deliveryId;')));
  plant('the opener works with the gate closed', !doorRule(FOLLOW.replace('if (gate.on) setEdit(', 'setEdit(')));
  const HOOK = strip(read('hooks/useDeliveriesFollowSchedule.ts'));
  const hookRule = (s: string) => /const allowed = deliveriesFollowScheduleAllowed\(user\?\.email\) && !!user\?\.id;/.test(s) && /enabled: allowed,/.test(s) && /const on = allowed && probe\.data === true;/.test(s) && /if \(error\) return false;/.test(s) && /canPreviewJobEffect: on && isProOrAbove/.test(s);
  ok('the gate hook: allowed AND the table has the columns (an error, or offline with nothing seen, keeps it closed); the job effect on Pro and up', hookRule(HOOK));
  plant('the feature opens before the columns are seen', !hookRule(HOOK.replace('const on = allowed && probe.data === true;', 'const on = allowed;')));
  plant('an error from the table counts as "the columns are there"', !hookRule(HOOK.replace('if (error) return false;', 'if (error) return true;')));
  plant('the job effect is open to every plan', !hookRule(HOOK.replace('canPreviewJobEffect: on && isProOrAbove', 'canPreviewJobEffect: on')));
  // The Deliveries screen: what it adds is behind follow.on, and the golden pins the rest.
  const SCREEN = strip(read('app/deliveries.tsx'));
  const screenRule = (s: string) => /const follow = useDeliveriesFollow\(projectId\);/.test(s) && (s.match(/follow\.(block|sheets)/g) ?? []).length >= 2 && /follow\.on \? follow\.openAdd/.test(s) && (s.match(/onDates=\{follow\.on \? follow\.openDelivery : undefined\}/g) ?? []).length === 2 && !/DELIVERIES_FOLLOW|deliveriesFollowScheduleAllowed|isOwner\(/.test(s);
  ok('the Deliveries screen reaches the lane through one hook, and the old form is replaced only when follow.on', screenRule(SCREEN));
  const snap = 'app/../__tests__/smoke/__snapshots__/deliveries-schedule-golden.test.tsx.snap'.replace('app/../', '');
  const golden = existsSync(join(ROOT, snap)) ? read(snap) : '';
  const goldenTest = read('__tests__/smoke/deliveries-schedule-golden.test.tsx');
  ok('the golden of the Deliveries screen (flag off, not the owner) is committed: two snapshots, and its test mocks neither the flag nor the gate', (golden.match(/^exports\[`/gm) ?? []).length === 2 && /Roof Trusses/.test(golden) && /3 days late/.test(golden) && /Expecting a Delivery/.test(golden) && !/dfs-/.test(golden) && !/jest\.mock\(/.test(goldenTest));
  ok('the storage key the gate remembers is under an app-owned prefix', /DELIVERY_COLUMNS_SEEN_KEY = 'mageid_deliveries_fs_columns_seen'/.test(read('hooks/useDeliveriesFollowSchedule.ts')));
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
  if (/\b(create|drop|alter)\s+policy\b|\bgrant\b|\brevoke\b|\bcreate\s+(or replace\s+)?(function|trigger|procedure)\b|pg_cron|cron\.schedule|net\.http|fire_notify|\bdelete from\b|\bupdate public\./i.test(code.replace(/do \$\$[\s\S]*?end \$\$;/, ''))) out.push('the migration touches a policy, a grant, a trigger, a function, a job or existing rows');
  if (/add column[^;]*\b(needed|order_by)/i.test(code)) out.push('a needed-by or order-by column is added');
  for (const head of ['-- WHY.', '-- WHAT IS ADDED', '-- WHO WRITES / WHO READS.', '-- DEPLOY ORDER.', '-- VERIFY AFTER', '-- UNDO', '-- WHAT IS NOT ADDED, ON PURPOSE.', '-- ACCOUNT DELETION AND EXPORT.']) if (!sql.includes(head)) out.push(`the header has no "${head}"`);
  if (!/do \$\$[\s\S]*raise exception '\[deliveries_follow_schedule\] verify:[\s\S]*end \$\$;/.test(sql)) out.push('there is no self-check block');
  if (!/v_n <> 4/.test(sql) || !/column_name like 'needed%'/.test(sql)) out.push('the self-check does not pin the four policies and the absence of a needed-by column');
  if ((code.match(/between 0 and 60|between 1 and 730|jsonb_array_length\(date_history\) <= 40|octet_length\(date_history::text\) <= 16384|char_length\(task_id\) between 1 and 200/g) ?? []).length !== 5) out.push('a check is missing (buffer, lead time, history entries, history bytes, task id)');
  if (!/notify pgrst, 'reload schema';\s*$/.test(sql)) out.push('the schema cache is not reloaded');
  return out;
};
{
  ok('nullable columns only, expected_date nullable, no policy, no grant, no trigger, no function, no needed-by column, the header and the self-check', migRule(MIG).length === 0, migRule(MIG).join(' | '));
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
    ['an eighth column the app does not write', MIG.replace('alter table public.deliveries add column if not exists task_start_seen date;', 'alter table public.deliveries add column if not exists task_start_seen date;\nalter table public.deliveries add column if not exists supplier_token uuid;')],
  ];
  for (const [name, sql] of MIG_PLANTS) plant(`the migration: ${name}`, migRule(sql).length > 0);
  const proof = existsSync(join(ROOT, 'scripts/pgq/deliveries-follow-schedule.mjs')) ? read('scripts/pgq/deliveries-follow-schedule.mjs') : '';
  ok('the PGlite proof is committed, names this file, the real deliveries table and the real access rule, and plants 14 mutations',
    proof.includes("const FILE = '20261012090000_deliveries_follow_schedule.sql';") && proof.includes("readMigration(ROOT, '20260826200000_deliveries.sql')") && proof.includes('20260826130000_field_role.sql') && /\n    14: \[/.test(proof) && !/\n    15: \[/.test(proof)
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

console.log(fails === 0
  ? `\n✓ validate-deliveries-schedule: ${checks} checks passed, ${plants} of ${plants} planted mutations caught`
  : `\n✗ validate-deliveries-schedule: ${fails} of ${checks} failed`);
process.exit(fails === 0 ? 0 : 1);
