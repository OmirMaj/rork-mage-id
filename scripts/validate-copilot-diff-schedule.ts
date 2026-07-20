// scripts/validate-copilot-diff-schedule.ts — pure-fn validator for diffSchedule.
import { diffSchedule } from '../utils/copilot/scheduleEdit/diffSchedule';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
const before: ScheduleTask[] = [
  mk('t1', { title: 'Framing', startDay: 1, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }),
];
// push framing +7d and stretch rough-in dep
const after: ScheduleTask[] = [
  mk('t1', { title: 'Framing', startDay: 8, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 13, durationDays: 4, dependencies: ['t1'] }),
];
const d = diffSchedule(before, after, runCpm(before), runCpm(after), [{ summary: 'x' }]);

ok('finish delta is positive after the push', d.finishDeltaDays > 0);
ok('framing shows a start delta of +7', !!d.moved.find(m => m.name === 'Framing' && m.startDelta === 7));
ok('carries rejected reasons through', d.rejected.length === 1 && d.rejected[0].summary === 'x');
ok('added/removed empty when none', d.added.length === 0 && d.removed.length === 0);

const withNew = [...before, mk('t3', { title: 'Cabinet procurement', startDay: 1, durationDays: 10 })];
const d2 = diffSchedule(before, withNew, runCpm(before), runCpm(withNew), []);
ok('detects an added task', d2.added.length === 1 && d2.added[0].name === 'Cabinet procurement');
const d3 = diffSchedule(before, [before[0]], runCpm(before), runCpm([before[0]]), []);
ok('detects a removed task', d3.removed.length === 1 && d3.removed[0].name === 'Rough-in');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
