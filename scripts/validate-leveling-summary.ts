// scripts/validate-leveling-summary.ts — pure-fn validator for utils/levelingSummary.ts.
import { summarizeLeveling } from '../utils/levelingSummary';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const T = (id: string, startDay: number): ScheduleTask => ({ id, title: id.toUpperCase(), phase: '', startDay, durationDays: 2, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started' } as ScheduleTask);

const tasks = [T('a', 1), T('b', 3), T('c', 5)];
const m = new Map<string, number>([['a', 2], ['b', 6], ['c', 5]]);
const s = summarizeLeveling(tasks, m);
eq('shiftedCount ignores zero-delta', s.shiftedCount, 2);
eq('maxShiftDays is the largest |delta|', s.maxShiftDays, 3);
eq('totalShiftDays sums |delta|', s.totalShiftDays, 4);
eq('shifts carry id+title+from+to+delta', s.shifts.find(x => x.id === 'b'), { id: 'b', title: 'B', fromDay: 3, toDay: 6, deltaDays: 3 });
eq('no entries → empty summary', summarizeLeveling(tasks, new Map()), { shiftedCount: 0, maxShiftDays: 0, totalShiftDays: 0, shifts: [] });
eq('a leveled map with only zero-deltas → empty', summarizeLeveling(tasks, new Map([['a', 1]])), { shiftedCount: 0, maxShiftDays: 0, totalShiftDays: 0, shifts: [] });

// The engine computes a full WHY for every move — resource, counterpart task,
// working days delayed, float available and consumed, whether the finish moves.
// The summary used to rebuild the shift list from the bare id→day map and drop
// all of it, so "Fix overloads" asked a superintendent to approve "Day 12 → 19"
// with no reason attached.
{
  const crew = (id: string, dur: number): ScheduleTask => ({
    id, title: id.toUpperCase(), phase: '', startDay: 1, durationDays: dur, progress: 0,
    crew: 'framers', dependencies: [], notes: '', status: 'not_started',
  } as ScheduleTask);
  const CAL = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5 };
  const tasks = [crew('a', 5), crew('b', 5), crew('c', 5)];
  const lev = runCpm(tasks, { ...CAL, levelResources: true });
  const withReasons = summarizeLeveling(tasks, lev.leveledStartDays!, lev.conflicts);
  const bare = summarizeLeveling(tasks, lev.leveledStartDays!);

  eq('the fixture really does move tasks', withReasons.shiftedCount > 0, true);
  eq('every shift carries the engine\'s reason', withReasons.shifts.every(s2 => !!s2.reason), true);
  eq('  …and names the resource it frees up',
    withReasons.shifts.every(s2 => s2.resource === 'framers'), true);
  eq('  …and the counterpart it was competing with',
    withReasons.shifts.every(s2 => !!s2.counterpartTitle), true);
  eq('  …and says whether the move eats the finish date',
    withReasons.shifts.some(s2 => s2.pushesFinish === true), true);
  eq('  …and the reason is in WORKING days, not raw ones',
    withReasons.shifts.every(s2 => /working day\(s\)/.test(s2.reason ?? '')), true);
  eq('omitting the conflicts still works, it just says nothing',
    bare.shifts.every(s2 => s2.reason === undefined), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
