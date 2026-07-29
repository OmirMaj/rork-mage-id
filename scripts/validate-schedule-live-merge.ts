// validate-schedule-live-merge.ts — pins the Phase 2 3-way live-sync merge.
// Run via: bun run scripts/validate-schedule-live-merge.ts
import { mergeScheduleTasks } from '../utils/scheduleMerge';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

// id + a version marker (durationDays) to distinguish base/peer/local edits.
const mk = (id: string, d: number): ScheduleTask => ({ id, durationDays: d } as ScheduleTask);
const dur = (ts: ScheduleTask[]) => ts.map(t => `${t.id}:${(t as { durationDays?: number }).durationDays}`);

console.log('\nschedule 3-way merge:');
const baseline = [mk('a', 1), mk('b', 1)];

// peer changed A, I touched nothing → take peer's A, keep B
expect('peer changed A → take peer',
  dur(mergeScheduleTasks(baseline, [mk('a', 2), mk('b', 1)], [mk('a', 1), mk('b', 1)])), ['a:2', 'b:1']);

// peer changed nothing, I edited B locally → keep my B
expect('my local edit to B preserved',
  dur(mergeScheduleTasks(baseline, [mk('a', 1), mk('b', 1)], [mk('a', 1), mk('b', 9)])), ['a:1', 'b:9']);

// peer changed A, I edited B → both survive
expect('peer A + my B both survive',
  dur(mergeScheduleTasks(baseline, [mk('a', 2), mk('b', 1)], [mk('a', 1), mk('b', 9)])), ['a:2', 'b:9']);

// same-task conflict: peer + I both changed A → peer wins
expect('same-task conflict → peer wins',
  dur(mergeScheduleTasks(baseline, [mk('a', 2), mk('b', 1)], [mk('a', 5), mk('b', 1)])), ['a:2', 'b:1']);

// peer added C → appears
expect('peer-added task appears',
  mergeScheduleTasks(baseline, [mk('a', 1), mk('b', 1), mk('c', 1)], [mk('a', 1), mk('b', 1)]).map(t => t.id), ['a', 'b', 'c']);

// peer deleted B → dropped
expect('peer-deleted task dropped',
  mergeScheduleTasks(baseline, [mk('a', 1)], [mk('a', 1), mk('b', 1)]).map(t => t.id), ['a']);

// I added D locally (not in baseline/incoming) → kept
expect('my local-only addition kept',
  mergeScheduleTasks(baseline, [mk('a', 1), mk('b', 1)], [mk('a', 1), mk('b', 1), mk('d', 1)]).map(t => t.id), ['a', 'b', 'd']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
