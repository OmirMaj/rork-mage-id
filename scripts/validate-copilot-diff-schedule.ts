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

// ── Moved list is ES-based: dependents appear as slides even when their raw
// startDay hasn't been rewritten yet. This is what apply actually persists
// (applyToProjectSchedule stamps startDay = ES for EVERY task), so the preview
// must show it. Regression pin for the delay-cascade / copilot preview gap.
const afterRawOnly: ScheduleTask[] = [
  mk('t1', { title: 'Framing', startDay: 8, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }), // raw startDay untouched
];
const dDep = diffSchedule(before, afterRawOnly, runCpm(before), runCpm(afterRawOnly), []);
ok('directly-moved task slides +7 (ES-based)', !!dDep.moved.find(m => m.name === 'Framing' && m.startDelta === 7));
ok('FS dependent appears as a +7 slide despite unchanged raw startDay',
  !!dDep.moved.find(m => m.name === 'Rough-in' && m.startDelta === 7));
ok('dependent slide matches the finish delta', dDep.finishDeltaDays === 7);

// Duration stretch on the predecessor ripples into the dependent's start.
const afterStretch: ScheduleTask[] = [
  mk('t1', { title: 'Framing', startDay: 1, durationDays: 8 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }),
];
const dStretch = diffSchedule(before, afterStretch, runCpm(before), runCpm(afterStretch), []);
ok('stretched task shows durationDelta +3 with no start slide',
  !!dStretch.moved.find(m => m.name === 'Framing' && m.durationDelta === 3 && m.startDelta === 0));
ok('dependent of a stretched task slides +3',
  !!dStretch.moved.find(m => m.name === 'Rough-in' && m.startDelta === 3));

// No-op edit → no moved lines (ES unchanged on both sides).
const dNoop = diffSchedule(before, before.map(t => ({ ...t })), runCpm(before), runCpm(before), []);
ok('identical schedules produce no moved lines', dNoop.moved.length === 0);

const withNew = [...before, mk('t3', { title: 'Cabinet procurement', startDay: 1, durationDays: 10 })];
const d2 = diffSchedule(before, withNew, runCpm(before), runCpm(withNew), []);
ok('detects an added task', d2.added.length === 1 && d2.added[0].name === 'Cabinet procurement');
const d3 = diffSchedule(before, [before[0]], runCpm(before), runCpm([before[0]]), []);
ok('detects a removed task', d3.removed.length === 1 && d3.removed[0].name === 'Rough-in');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
