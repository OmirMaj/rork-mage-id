// scripts/validate-schedule-duration.ts — pins the ONE-derivation contract for
// schedule duration scalars (2026-07 sim-audit fix #2).
//
// The bug: the same schedule showed three different lengths — the project
// modal's "Duration" (max(startDay + durationDays) fencepost + a hidden +3
// buffer), the "Critical path" (CPM projectFinish), and the wizard preview
// (max CPM EF). buildScheduleFromTasks now derives BOTH stored scalars from
// the engine's project-finish day, and never invents a startDate.
//
// Pins:
//  1. totalDurationDays === criticalPathDays, always.
//  2. No +3 buffer folded in; bufferDays stays a separate field.
//  3. Fallback finish uses the CPM EF convention: a task ends on
//     startDay + durationDays - 1; a 0-day milestone ends ON its startDay.
//  4. opts.criticalPathDays (cpm.projectFinish) is authoritative for both.
//  5. Wizard parity: threading runCpm(...).projectFinish in yields the same
//     number the wizard computes (max EF) for a calendar-anchored chain.
//  6. startDate: never invented (key omitted when absent), passed through
//     when supplied — the retro-stamp finish-jump guard.

import { buildScheduleFromTasks } from '../utils/scheduleEngine';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n   got ${JSON.stringify(detail)}` : ''); }
}

const T = (
  id: string, startDay: number, durationDays: number,
  extra: Partial<ScheduleTask> = {},
): ScheduleTask => ({
  id, title: id.toUpperCase(), phase: 'General', startDay, durationDays,
  progress: 0, crew: '', crewSize: 1, dependencies: [], notes: '',
  status: 'not_started', ...extra,
} as ScheduleTask);

// ── 1+2+3: fallback derivation (no opts) ────────────────────────────────────
console.log('\nfallback finish (no CPM threaded):');
{
  // a: days 1-5, b: days 6-8 (FS after a), milestone m FS after b → the
  // resolver places m on day 9 (dep EF + 1) and it ENDS there → finish 9.
  // Legacy math: max(startDay+durationDays)=9, then +3 buffer → showed 12.
  const tasks = [T('a', 1, 5), T('b', 6, 3, { dependencies: ['a'] }), T('m', 8, 0, { isMilestone: true, dependencies: ['b'] })];
  const s = buildScheduleFromTasks('S', null, tasks);
  ok('finish day is 9 (fencepost-correct, no +3)', s.totalDurationDays === 9, s.totalDurationDays);
  ok('criticalPathDays equals totalDurationDays', s.criticalPathDays === s.totalDurationDays, s.criticalPathDays);
  ok('bufferDays stays its own field', s.bufferDays === 3, s.bufferDays);
}
{
  // Milestone AFTER the last work bar: work ends day 5, milestone pinned day 6.
  const tasks = [T('a', 1, 5), T('m', 6, 0, { isMilestone: true })];
  const s = buildScheduleFromTasks('S', null, tasks);
  ok('trailing 0d milestone ends ON its day (6), not day 5 or 7', s.totalDurationDays === 6, s.totalDurationDays);
}
{
  // Single 1-day task: starts and ends day 1. Legacy said 2 (+3 → 5).
  const s = buildScheduleFromTasks('S', null, [T('a', 1, 1)]);
  ok('single 1d task → finish day 1', s.totalDurationDays === 1, s.totalDurationDays);
}

// ── 4: engine-threaded value is authoritative for BOTH scalars ──────────────
console.log('\nengine-threaded (opts.criticalPathDays):');
{
  const tasks = [T('a', 1, 5), T('b', 6, 3)];
  const s = buildScheduleFromTasks('S', null, tasks, null, { criticalPathDays: 42 });
  ok('totalDurationDays takes cpm.projectFinish', s.totalDurationDays === 42, s.totalDurationDays);
  ok('criticalPathDays takes cpm.projectFinish', s.criticalPathDays === 42, s.criticalPathDays);
}

// ── 5: wizard parity — calendar-anchored chain agrees end-to-end ────────────
console.log('\nwizard parity (calendar-aware CPM → stored scalars):');
{
  // 2026-01-05 is a Monday. Chain a(5d) → b(3d) on a 5-day week:
  // a runs Mon-Fri (days 1-5), b starts next Mon (day 8) and ends day 10.
  const chain = [
    T('a', 1, 5),
    T('b', 1, 3, { dependencies: ['a'], dependencyLinks: [{ taskId: 'a', type: 'FS', lagDays: 0 }] }),
  ];
  const opts = { scheduleStartDate: '2026-01-05', workingDaysPerWeek: 5 };
  const cpm = runCpm(chain, opts);
  // Wizard derivation: max EF over all tasks (schedule-wizard totalDays).
  let maxEf = 0; cpm.perTask.forEach(v => { if (v.ef > maxEf) maxEf = v.ef; });
  ok('cpm.projectFinish === wizard max-EF', cpm.projectFinish === maxEf, { pf: cpm.projectFinish, maxEf });
  ok('weekend-aware finish is day 10', cpm.projectFinish === 10, cpm.projectFinish);
  const reflowed = chain.map(t => ({ ...t, startDay: cpm.perTask.get(t.id)?.es ?? t.startDay }));
  const s = buildScheduleFromTasks('S', null, reflowed, null, {
    criticalPathDays: cpm.projectFinish, startDate: '2026-01-05',
  });
  ok('stored Duration === stored Critical path === engine finish',
    s.totalDurationDays === 10 && s.criticalPathDays === 10,
    { total: s.totalDurationDays, critical: s.criticalPathDays });
}

// ── 6: startDate is never invented (retro-stamp guard) ──────────────────────
console.log('\nstartDate guard:');
{
  const s = buildScheduleFromTasks('S', null, [T('a', 1, 2)]);
  ok('no opts.startDate → startDate absent (undefined)', s.startDate === undefined, s.startDate);
  ok("no opts.startDate → key OMITTED (spread-safe: {...existing, ...built} keeps the real anchor)",
    !Object.prototype.hasOwnProperty.call(s, 'startDate'));
}
{
  const s = buildScheduleFromTasks('S', null, [T('a', 1, 2)], null, { startDate: '2026-03-02' });
  ok('opts.startDate passes through untouched', s.startDate === '2026-03-02', s.startDate);
}

console.log(`\nschedule-duration: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
