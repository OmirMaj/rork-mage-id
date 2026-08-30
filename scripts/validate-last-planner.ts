// validate-last-planner.ts — the lookahead must agree with the Gantt.
//
// WHY THIS EXISTS. ScheduleTask stores its two date fields in DIFFERENT UNITS
// once a project has a start date:
//   • startDay     — a CALENDAR day index (utils/scheduleRebase converts the
//                    working-day ordinal to a calendar index the moment a start
//                    date is assigned).
//   • durationDays — still a WORKING-day COUNT; scheduleRebase passes durations
//                    through untouched.
//
// utils/lastPlanner.taskWindow treated BOTH as calendar days:
//     endMs = startMs + (dur - 1) * DAY_MS
// while utils/cpm computes the same finish as
//     walkWorkingDays(es, dur - 1, 1, ...)
//
// So on a Mon-Fri calendar a 10-day task finished 2 days early, a 20-day task 4
// days early, and the error grew with duration. Two consequences, both on the
// screen a superintendent commits next week's crews from:
//   1. Tasks displayed a finish date the Gantt disagreed with.
//   2. The horizon overlap test (`win.endMs < thisMondayMs`) FILTERED OUT tasks
//      whose real window reached into the lookahead — work vanished from the
//      3-week plan entirely rather than merely being mislabelled.
//
// Run via: bun run test:last-planner

import { taskWindow, buildLookahead } from '../utils/lastPlanner';
import type { ScheduleTask } from '../types';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(`${label} (= ${String(expected)})`, actual === expected, `got ${String(actual)}`);
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function task(over: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 't1', name: 'Frame', startDay: 1, durationDays: 1, ...over } as ScheduleTask;
}

// 2026-08-31 is a MONDAY. Every expectation below is hand-checked against it.
const START = '2026-08-31';

console.log('\nlast planner window math (working days, not calendar days):');

check('the anchor really is a Monday', new Date(START + 'T00:00:00Z').getUTCDay() === 1);

// ── 1. a 5-working-day task on a Mon-Fri calendar ends FRIDAY ───────────────
{
  const w = taskWindow(task({ durationDays: 5 }), START, { workingDaysPerWeek: 5 });
  eq('Mon + 5 working days starts Monday', iso(w!.startMs), '2026-08-31');
  eq('...and ends Friday, not Friday-minus-nothing', iso(w!.endMs), '2026-09-04');
}

// ── 2. 10 working days spans TWO weeks — the case that was 2 days short ─────
{
  const w = taskWindow(task({ durationDays: 10 }), START, { workingDaysPerWeek: 5 });
  eq('10 working days ends the following Friday', iso(w!.endMs), '2026-09-11');
  // The old calendar-day math produced 2026-09-09. Pin the delta explicitly.
  check('...which is 2 days later than the old calendar-day result',
    (w!.endMs - w!.startMs) / DAY === 11,
    `span was ${(w!.endMs - w!.startMs) / DAY} days`);
}

// ── 3. the error compounds with duration ────────────────────────────────────
{
  const w = taskWindow(task({ durationDays: 20 }), START, { workingDaysPerWeek: 5 });
  eq('20 working days ends four weeks out', iso(w!.endMs), '2026-09-25');
}

// ── 4. closures push the finish out too ─────────────────────────────────────
{
  const w = taskWindow(task({ durationDays: 5 }), START,
    { workingDaysPerWeek: 5, nonWorkingDates: ['2026-09-02'] });
  eq('a mid-week holiday pushes the finish to Monday', iso(w!.endMs), '2026-09-07');
}

// ── 5. 7-day weeks are the identity — behaviour is unchanged ────────────────
// This is the default, so every caller that has no calendar to pass keeps the
// exact arithmetic it had before the fix.
{
  const w7 = taskWindow(task({ durationDays: 10 }), START, { workingDaysPerWeek: 7 });
  const wNone = taskWindow(task({ durationDays: 10 }), START);
  eq('7-day weeks: 10 days is 10 calendar days', iso(w7!.endMs), '2026-09-09');
  eq('omitting the calendar matches the 7-day default', wNone!.endMs, w7!.endMs);
}

// ── 6. degenerate calendars terminate ───────────────────────────────────────
// Every day closed must not spin the walk forever; it falls back to the
// calendar span rather than hanging the lookahead.
{
  const allClosed = Array.from({ length: 400 }, (_, i) =>
    iso(Date.parse(START + 'T00:00:00Z') + i * DAY));
  const w = taskWindow(task({ durationDays: 10 }), START,
    { workingDaysPerWeek: 5, nonWorkingDates: allClosed });
  check('a fully-closed calendar terminates and falls back', !!w && Number.isFinite(w.endMs));
}

// ── 7. no start date → no window (unchanged) ────────────────────────────────
check('no project start date yields null', taskWindow(task(), null) === null);
check('an unparseable start date yields null', taskWindow(task(), 'not-a-date') === null);

// ── 8. the horizon filter no longer drops real work ─────────────────────────
// THE USER-VISIBLE BUG. A task whose working-day window reaches into the
// 3-week horizon must appear in the lookahead. Under calendar-day math its
// end fell short of `thisMonday` and it was filtered out — the superintendent
// simply never saw the work.
{
  // Starts 12 calendar days BEFORE the as-of Monday, 10 working days long.
  // Calendar math ends it before the horizon opens; working-day math does not.
  const asOf = new Date('2026-09-14T00:00:00Z'); // a Monday
  const t = task({ id: 'reach', startDay: 3, durationDays: 10 });
  const la = buildLookahead([t], START, [], {
    weeks: 3, asOf, calendar: { workingDaysPerWeek: 5 },
  });
  const ids = la.weeks.flatMap(w => w.entries.map(e => e.task.id));
  check('a task spanning into the horizon is IN the lookahead',
    ids.includes('reach'),
    'the working-day window reaches this week, so the superintendent must see it');
}

if (failures > 0) {
  console.error(`\n✗ validate-last-planner: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n15 passed, 0 failed\n');
