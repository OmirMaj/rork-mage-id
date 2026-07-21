// scripts/validate-copilot-mobile-apply.ts — pure-fn validator for applyToProjectSchedule.
import { applyToProjectSchedule } from '../utils/copilot/scheduleEdit/applyToProjectSchedule';
import type { ProjectSchedule, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
const sched = (tasks: ScheduleTask[], over: Partial<ProjectSchedule> = {}): ProjectSchedule =>
  ({ name: 'S', workingDaysPerWeek: 7, tasks, ...over } as ProjectSchedule);

// 1 — independent task keeps its start day (ES anchors to startDay floor)
{
  const s = sched([mk('a', { startDay: 5, durationDays: 3 })]);
  const out = applyToProjectSchedule(s, s.tasks, {});
  ok('independent task keeps its start day', out.tasks[0].startDay === 5);
}
// 2 — FS dependent reflows to predecessor finish + 1 (raw mode: a es1 ef3 → b es4)
{
  const tasks = [mk('a', { startDay: 1, durationDays: 3 }), mk('b', { startDay: 1, durationDays: 2, dependencies: ['a'] })];
  const out = applyToProjectSchedule(sched(tasks), tasks, {});
  ok('FS dependent reflows to predecessor finish + 1', out.tasks[1].startDay === 4);
}
// 3 — moving the predecessor later cascades the dependent (a es5 ef7 → b es8)
{
  const tasks = [mk('a', { startDay: 5, durationDays: 3 }), mk('b', { startDay: 1, durationDays: 2, dependencies: ['a'] })];
  const out = applyToProjectSchedule(sched(tasks), tasks, {});
  ok('moving predecessor cascades the dependent', out.tasks[0].startDay === 5 && out.tasks[1].startDay === 8);
}
// 4 — preserves non-task schedule fields
{
  const s = sched([mk('a')], { name: 'Henderson', startDate: '2026-03-01', workingDaysPerWeek: 5, baselines: [] as any });
  const out = applyToProjectSchedule(s, s.tasks, { workingDaysPerWeek: 5 });
  ok('preserves name/startDate/workingDaysPerWeek', out.name === 'Henderson' && out.startDate === '2026-03-01' && out.workingDaysPerWeek === 5);
  ok('preserves baselines sidecar', Array.isArray((out as any).baselines));
}
// 5 — does not mutate the input array
{
  const tasks = [mk('a', { startDay: 1, durationDays: 3 }), mk('b', { startDay: 1, dependencies: ['a'] })];
  const snapshot = tasks[1].startDay;
  applyToProjectSchedule(sched(tasks), tasks, {});
  ok('input tasks are not mutated', tasks[1].startDay === snapshot);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
