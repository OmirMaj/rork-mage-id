// validate-summary-grouping.ts — Summary's TODAY ON SITE, grouped by job
// (wave 6c, lane DC).
//
// WHY. At 1512 × 945 the Summary was one column of 32 task rows that pushed
// MONEY and NEEDS YOU off the screen, and a task tap opened the job page, not
// the task. The desktop Summary now shows one card per job (utils/
// summaryBriefing.groupTodayByJob) and a tap opens the task (TodayTask.taskId).
// This pins the grouping rules the cards are drawn from:
//   - groups are stable (first appearance breaks every tie);
//   - crews are de-duped, blanks dropped, first-seen order;
//   - jobs with a critical task come first, then the busiest;
//   - every TodayTask carries its taskId;
//   - summaryBriefing reads no record timestamp (the old undated anchor bug).
//
// Run via: bun scripts/validate-summary-grouping.ts   (test:summary-grouping)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project, ScheduleTask } from '../types';
import { computeTodayTasks, groupTodayByJob, type TodayTask } from '../utils/summaryBriefing';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); return; }
  fail++;
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`);
}

const t = (projectId: string, title: string, o: Partial<TodayTask> = {}): TodayTask => ({
  projectId,
  projectName: projectId.toUpperCase(),
  projectColor: '#123',
  taskId: `${projectId}-${title}`,
  taskTitle: title,
  isCritical: false,
  context: '',
  ...o,
});

console.log('\ngroupTodayByJob — order:');
{
  // a: 3 tasks, no crit; b: 1 task, crit; c: 3 tasks, no crit (after a); d: 2 tasks, crit.
  const tasks = [
    t('a', 'a1'), t('b', 'b1', { isCritical: true }), t('a', 'a2'), t('c', 'c1'), t('d', 'd1'),
    t('c', 'c2'), t('a', 'a3'), t('c', 'c3'), t('d', 'd2', { isCritical: true }),
  ];
  const g = groupTodayByJob(tasks);
  ok('critical jobs first, then task count descending, then first appearance',
    g.map((x) => x.projectId).join() === 'd,b,a,c', g.map((x) => x.projectId));
  ok('critCount counts the critical tasks of each job', g.find((x) => x.projectId === 'd')?.critCount === 1 && g.find((x) => x.projectId === 'a')?.critCount === 0);
  ok('each group keeps its tasks in their input order', g.find((x) => x.projectId === 'c')?.tasks.map((x) => x.taskTitle).join() === 'c1,c2,c3');
  ok('every task lands in exactly one group', g.reduce((n, x) => n + x.tasks.length, 0) === tasks.length);
  const again = groupTodayByJob(tasks);
  ok('stable: the same input gives the same order', JSON.stringify(again) === JSON.stringify(g));
  const tie = groupTodayByJob([t('x', 'x1'), t('y', 'y1'), t('z', 'z1')]);
  ok('equal jobs keep first-appearance order (no reordering on a tie)', tie.map((x) => x.projectId).join() === 'x,y,z', tie.map((x) => x.projectId));
  const twoCrit = groupTodayByJob([t('p', 'p1', { isCritical: true }), t('q', 'q1', { isCritical: true }), t('q', 'q2')]);
  ok('among critical jobs the busier one leads', twoCrit.map((x) => x.projectId).join() === 'q,p', twoCrit.map((x) => x.projectId));
  ok('an empty day is no groups', groupTodayByJob([]).length === 0);
  ok('groups carry no internal ordering field', !('first' in (g[0] as object)));
}

console.log('\ngroupTodayByJob — crews:');
{
  const g = groupTodayByJob([
    t('a', '1', { context: 'Framers' }), t('a', '2', { context: '' }), t('a', '3', { context: '  ' }),
    t('a', '4', { context: 'Sparks' }), t('a', '5', { context: 'Framers' }), t('a', '6', { context: ' Sparks ' }),
    t('a', '7', { context: 'Acme Plumbing' }),
  ]);
  ok('de-duped, blanks dropped, first-seen order', g[0].crews.join('|') === 'Framers|Sparks|Acme Plumbing', g[0].crews);
}

console.log('\ncomputeTodayTasks — taskId:');
{
  const task = (o: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask =>
    ({ phase: 'Interior', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o } as ScheduleTask);
  const project = {
    id: 'p1', name: 'Henderson', status: 'in_progress',
    schedule: {
      id: 's1', name: 's', projectId: 'p1', startDate: '2026-09-14', workingDaysPerWeek: 5, bufferDays: 0,
      tasks: [task({ id: 'task-a', title: 'Framing', startDay: 1, durationDays: 10, crew: 'Framers' }), task({ id: 'task-b', title: 'Later', startDay: 30, durationDays: 2 })],
      totalDurationDays: 31, criticalPathDays: 31, laborAlignmentScore: 0, riskItems: [],
    },
  } as unknown as Project;
  const today = computeTodayTasks([project], new Date(2026, 8, 16, 9, 0, 0));
  ok('a task on site today carries its own schedule task id', today.length === 1 && today[0].taskId === 'task-a', today);
  ok('…and groups under its job with its crew', groupTodayByJob(today)[0]?.crews.join() === 'Framers');
}

console.log('\nsource pins:');
{
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'utils', 'summaryBriefing.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('summaryBriefing reads no createdAt (code, comments stripped)', !/createdAt/.test(code));
  ok('TodayTask declares taskId', /export interface TodayTask \{[^}]*\btaskId: string;/.test(src));
  ok('computeTodayTasks sets taskId: t.id', /taskId: t\.id,/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
