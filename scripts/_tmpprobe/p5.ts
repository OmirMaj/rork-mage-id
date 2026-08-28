import { buildWeeklyWorkPlan, buildLookahead, taskWindow } from '../../utils/lastPlanner';
import { buildScheduleFromTasks } from '../../utils/scheduleEngine';
import { runCpm } from '../../utils/cpm';
import type { ScheduleTask } from '../../types';

const T = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: o.id!, title: o.title ?? o.id!, phase: 'General',
  startDay: o.startDay ?? 1, durationDays: o.durationDays ?? 1,
  progress: o.progress ?? 0, status: o.status ?? 'not_started',
  dependencies: o.dependencies ?? [], isMilestone: false, ...o,
} as ScheduleTask);

const start = '2026-01-05'; // Monday
console.log('=== lastPlanner.taskWindow ignores workingDaysPerWeek ===');
const t = T({ id: 'drywall', startDay: 1, durationDays: 20 });   // 20 WORKING days
const w = taskWindow(t, start)!;
console.log('  taskWindow:', new Date(w.startMs).toISOString().slice(0,10), '->', new Date(w.endMs).toISOString().slice(0,10));
const cpm = runCpm([t], { scheduleStartDate: start, workingDaysPerWeek: 5 });
const c = cpm.perTask.get('drywall')!;
const efDate = new Date(Date.parse(start+'T00:00:00Z') + (c.ef-1)*86400000);
console.log('  CPM (5-day week): es day', c.es, 'ef day', c.ef, '=', efDate.toISOString().slice(0,10));

console.log('\n  Weekly Work Plan for week of 2026-01-26 (task is genuinely in progress that week):');
const wwp = buildWeeklyWorkPlan([t], start, '2026-01-26', [], []);
console.log('   entries:', wwp.map(e => e.task.id));

console.log('\n  3-week lookahead as of 2026-01-26:');
const la = buildLookahead([t], start, [], { asOf: new Date('2026-01-26T12:00:00Z') });
console.log('   weeks:', JSON.stringify(la.weeks.map(x => ({ w: x.weekStart, n: x.entries.length }))), 'total', la.totalTasks);

console.log('\n=== scheduleEngine.buildScheduleFromTasks: overdue risk items ===');
const overdueTask = T({ id: 'ov', title: 'Framing', startDay: 1, durationDays: 5, status: 'in_progress', progress: 10 });
const built = buildScheduleFromTasks('S', 'p', [overdueTask], null, { startDate: '2020-01-01' });
console.log('  riskItems:', JSON.stringify(built.riskItems.map(r => r.title)));
console.log('  (task was scheduled Jan 2020 and is 10% done — expected an "is behind schedule" risk)');

console.log('\n=== atRisk semantics in lastPlanner.buildLookahead ===');
const t2 = T({ id: 'k', startDay: 40, durationDays: 3 });
const la2 = buildLookahead([t2], start, [
  { id:'c1', taskId:'k', category:'materials', description:'windows', status:'open', needBy:'2026-02-10', createdAt:'2026-01-01' } as any,
], { asOf: new Date('2026-02-09T12:00:00Z'), weeks: 4 });
console.log('  needBy 2026-02-10, task starts', new Date(taskWindow(t2, start)!.startMs).toISOString().slice(0,10));
la2.weeks.forEach(wk => wk.entries.forEach(e => console.log(`   ${e.task.id} atRisk=${e.atRisk}`)));
const la3 = buildLookahead([t2], start, [
  { id:'c1', taskId:'k', category:'materials', description:'windows', status:'open', needBy:'2020-01-01', createdAt:'2026-01-01' } as any,
], { asOf: new Date('2026-02-09T12:00:00Z'), weeks: 4 });
la3.weeks.forEach(wk => wk.entries.forEach(e => console.log(`   needBy long past: ${e.task.id} atRisk=${e.atRisk}`)));
