// scripts/validate-schedule-merge.ts — pure-fn validator for
// mergeEditedSchedule (utils/scheduleEngine.ts). PINS sidecar survival on a
// manual-edit save: the mobile Pro / desktop save path must merge freshly-
// derived scalars onto the EXISTING schedule, never overwrite it with a bare
// buildScheduleFromTasks result (which would wipe nonWorkingDates, scenarios,
// resources, baselines[], weatherDelayLog, … and reset bufferDays /
// workingDaysPerWeek). Regression guard for tribunal finding #1.
import { buildScheduleFromTasks, mergeEditedSchedule } from '../utils/scheduleEngine';
import { runCpm } from '../utils/cpm';
import type { ProjectSchedule, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});

// A rich schedule carrying EVERY sidecar field a naive `{ ...built }` write drops.
function richSchedule(): ProjectSchedule {
  return {
    id: 's1',
    name: 'Henderson Schedule',
    projectId: 'p1',
    startDate: '2026-03-01',
    workingDaysPerWeek: 6,       // NOT the buildScheduleFromTasks default (5)
    bufferDays: 7,               // NOT the buildScheduleFromTasks default (3)
    tasks: [mk('a', { startDay: 1, durationDays: 3 }), mk('b', { startDay: 4, durationDays: 2, dependencies: ['a'] })],
    totalDurationDays: 5,
    criticalPathDays: 5,
    laborAlignmentScore: 80,
    healthScore: 88,
    riskItems: [],
    baseline: null,
    nonWorkingDates: ['2026-07-04'],
    scenarios: [{ id: 'sc1', name: 'What if we add a crew', createdAt: '2026-03-02T00:00:00Z', tasks: [] }] as any,
    activeScenarioId: 'sc1',
    criticalFloatThresholdDays: 3,
    resources: [{ id: 'r1', name: 'Framing crew' }] as any,
    resourceCalendars: [{ resourceId: 'r1', nonWorkingDates: [] }] as any,
    fragnets: [{ id: 'f1', name: 'Rough-in kit', tasks: [] }] as any,
    baselines: [{ id: 'bl1', name: 'Contract baseline', savedAt: '2026-03-01T00:00:00Z', tasks: [] }] as any,
    weatherAlerts: [{ id: 'wa1', date: '2026-07-10', kind: 'rain' }] as any,
    weatherDelayLog: [{ id: 'wd1', date: '2026-07-11', days: 1 }] as any,
  } as unknown as ProjectSchedule;
}

console.log('\nmergeEditedSchedule — sidecar survival on a task edit:');

// Simulate a mobile-Pro save: mark task b in-progress, run CPM on the
// schedule's OWN calendar, build fresh scalars, then merge.
{
  const existing = richSchedule();
  const editedTasks = existing.tasks.map(t => t.id === 'b' ? { ...t, progress: 50, status: 'in_progress' as const } : t);
  const cpm = runCpm(editedTasks, {
    scheduleStartDate: existing.startDate,
    workingDaysPerWeek: existing.workingDaysPerWeek,
    nonWorkingDates: existing.nonWorkingDates,
  });
  const built = buildScheduleFromTasks(existing.name, existing.projectId, editedTasks, existing.baseline ?? null, {
    startDate: existing.startDate,
    criticalPathDays: cpm.projectFinish,
  });
  const merged = mergeEditedSchedule(existing, built, { projectId: 'p1' });

  // Sidecar fields ALL survive.
  ok('nonWorkingDates survives', JSON.stringify(merged.nonWorkingDates) === JSON.stringify(['2026-07-04']));
  ok('scenarios survives', Array.isArray(merged.scenarios) && merged.scenarios!.length === 1);
  ok('activeScenarioId survives', merged.activeScenarioId === 'sc1');
  ok('criticalFloatThresholdDays survives', (merged as any).criticalFloatThresholdDays === 3);
  ok('resources survives', Array.isArray((merged as any).resources) && (merged as any).resources.length === 1);
  ok('resourceCalendars survives', Array.isArray((merged as any).resourceCalendars) && (merged as any).resourceCalendars.length === 1);
  ok('fragnets survives', Array.isArray((merged as any).fragnets) && (merged as any).fragnets.length === 1);
  ok('baselines[] survives', Array.isArray((merged as any).baselines) && (merged as any).baselines.length === 1);
  ok('weatherAlerts survives', Array.isArray((merged as any).weatherAlerts) && (merged as any).weatherAlerts.length === 1);
  ok('weatherDelayLog survives', Array.isArray((merged as any).weatherDelayLog) && (merged as any).weatherDelayLog.length === 1);

  // Non-default scalars are NOT reset to buildScheduleFromTasks' hardcoded values.
  ok('workingDaysPerWeek NOT reset to 5', merged.workingDaysPerWeek === 6);
  ok('bufferDays NOT reset to 3', merged.bufferDays === 7);
  ok('startDate preserved', merged.startDate === '2026-03-01');

  // Derived scalars ARE taken from the fresh build.
  ok('tasks come from the edit (b in_progress)', merged.tasks.find(t => t.id === 'b')?.status === 'in_progress');
  ok('totalDurationDays = built value', merged.totalDurationDays === built.totalDurationDays);
  ok('criticalPathDays = built value', merged.criticalPathDays === built.criticalPathDays);
  ok('healthScore = built value', merged.healthScore === built.healthScore);
  ok('laborAlignmentScore = built value', merged.laborAlignmentScore === built.laborAlignmentScore);
  ok('projectId stamped', merged.projectId === 'p1');
  ok('updatedAt refreshed (ISO)', typeof merged.updatedAt === 'string' && merged.updatedAt.length >= 20);
}

// A bare `{ ...built }` write (the OLD behavior) would drop sidecars — assert
// the contrast so the pin is unambiguous about what mergeEditedSchedule fixes.
{
  const existing = richSchedule();
  const built = buildScheduleFromTasks(existing.name, existing.projectId, existing.tasks, existing.baseline ?? null, {
    startDate: existing.startDate,
    criticalPathDays: 5,
  });
  const naive = { ...built, projectId: 'p1' } as ProjectSchedule;
  ok('CONTROL: bare {...built} drops nonWorkingDates', naive.nonWorkingDates === undefined);
  ok('CONTROL: bare {...built} resets workingDaysPerWeek to 5', naive.workingDaysPerWeek === 5);
  ok('CONTROL: bare {...built} resets bufferDays to 3', naive.bufferDays === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
