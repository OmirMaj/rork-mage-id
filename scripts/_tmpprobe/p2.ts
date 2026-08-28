import { runCpm } from '../../utils/cpm';
import type { ScheduleTask } from '../../types';
const T = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: o.id!, title: o.title ?? o.id!, phase: 'General',
  startDay: o.startDay ?? 1, durationDays: o.durationDays ?? 1,
  progress: 0, status: 'not_started', dependencies: o.dependencies ?? [],
  isMilestone: false, ...o,
} as ScheduleTask);
const start = '2026-01-05'; // Monday
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dd = (d: number) => { const dt = new Date(Date.parse(start+'T00:00:00Z')+(d-1)*86400000); return `${dt.toISOString().slice(0,10)} ${DOW[dt.getUTCDay()]}`; };

console.log('=== Minimal 2-task FS chain, 5-day week, pred finishes Friday ===');
const chain = [ T({id:'X', startDay:1, durationDays:5}), T({id:'Y', startDay:1, durationDays:1, dependencies:['X']}) ];
const r = runCpm(chain, { scheduleStartDate: start, workingDaysPerWeek: 5 });
console.log('  projectFinish =', r.projectFinish, `(${dd(r.projectFinish)})`);
for (const id of ['X','Y']) {
  const t = r.perTask.get(id)!;
  console.log(`  ${id}: es=${t.es}(${dd(t.es)}) ef=${t.ef}(${dd(t.ef)}) ls=${t.ls}(${dd(t.ls)}) lf=${t.lf}(${dd(t.lf)})`);
  console.log(`      totalFloat(LS-ES)=${t.totalFloat}  LF-EF=${t.lf - t.ef}  isCritical=${t.isCritical}`);
}
console.log('  criticalPath =', JSON.stringify(r.criticalPath), ' <-- Y is the terminal task and MUST be critical');

console.log('\n=== Same chain, 7-day week (no weekend) — control ===');
const r7 = runCpm(chain, { scheduleStartDate: start, workingDaysPerWeek: 7 });
for (const id of ['X','Y']) { const t = r7.perTask.get(id)!; console.log(`  ${id}: es=${t.es} ef=${t.ef} ls=${t.ls} lf=${t.lf} TF=${t.totalFloat} crit=${t.isCritical}`); }
console.log('  criticalPath =', JSON.stringify(r7.criticalPath));

console.log('\n=== Longer real-ish chain: 4 tasks x 5d each, 5-day week ===');
const c4 = [
  T({id:'T1', durationDays:5}),
  T({id:'T2', durationDays:5, dependencies:['T1']}),
  T({id:'T3', durationDays:5, dependencies:['T2']}),
  T({id:'T4', durationDays:5, dependencies:['T3']}),
];
const r4 = runCpm(c4, { scheduleStartDate: start, workingDaysPerWeek: 5 });
for (const t of c4) { const v = r4.perTask.get(t.id)!; console.log(`  ${t.id}: es=${v.es}(${dd(v.es)}) ef=${v.ef}(${dd(v.ef)}) ls=${v.ls} lf=${v.lf} TF=${v.totalFloat} crit=${v.isCritical}`); }
console.log('  criticalPath =', JSON.stringify(r4.criticalPath), '(all four are the only path)');
