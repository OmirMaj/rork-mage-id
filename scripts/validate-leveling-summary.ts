// scripts/validate-leveling-summary.ts — pure-fn validator for utils/levelingSummary.ts.
import { summarizeLeveling } from '../utils/levelingSummary';
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
