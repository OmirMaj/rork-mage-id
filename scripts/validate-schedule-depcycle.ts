import { wouldCreateCycle } from '../utils/cpm';
import type { ScheduleTask } from '../types';

// Locks the drag-to-create-dependency cycle guard (utils/cpm.ts). The Gantt +
// grid gate every new edge through wouldCreateCycle(tasks, taskId, candidateDepId)
// — "would making taskId depend on candidateDepId close a loop?". A regression
// here would let a user drag a dependency that makes the CPM graph cyclic.

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule dependency cycle-guard validation:');

// Chain: t1 → t2 → t3  (t2 depends on t1, t3 depends on t2)
const chain = (): ScheduleTask[] =>
  [
    { id: 't1', dependencies: [] },
    { id: 't2', dependencies: ['t1'] },
    { id: 't3', dependencies: ['t2'] },
  ].map(p => ({
    title: p.id, phase: 'General', durationDays: 2, startDay: 1, progress: 0,
    crew: '', notes: '', status: 'not_started', ...p,
  } as unknown as ScheduleTask));

const tasks = chain();

// Making t1 depend on t3 closes the loop t1→t3→t2→t1.
expect('cycle: t1 depending on t3 is rejected', wouldCreateCycle(tasks, 't1', 't3'), true);
// Making t3 depend on t1 is a redundant forward edge, not a cycle.
expect('valid: t3 depending on t1 is accepted', wouldCreateCycle(tasks, 't3', 't1'), false);
// A direct back-edge onto an immediate predecessor is a 2-node cycle.
expect('cycle: t1 depending on t2 is rejected', wouldCreateCycle(tasks, 't1', 't2'), true);
// Self-link is always a cycle.
expect('self-link is rejected', wouldCreateCycle(tasks, 't1', 't1'), true);
// An unrelated forward edge on a fresh graph is fine.
expect('valid: t2 depending on t3 on independent tasks is accepted',
  wouldCreateCycle([
    { id: 't1', dependencies: [] }, { id: 't2', dependencies: [] }, { id: 't3', dependencies: [] },
  ].map(p => ({ title: p.id, phase: 'General', durationDays: 1, startDay: 1, progress: 0, crew: '', notes: '', status: 'not_started', ...p } as unknown as ScheduleTask)),
  't2', 't3'), false);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
