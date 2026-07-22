// validate-judges-capacity.ts — unit tests for cross-project crew capacity.
// Run via: bun run scripts/validate-judges-capacity.ts
import { computeCapacityLoad } from '../utils/judges/capacityLoad';
import type { Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// Build a minimal active project whose schedule occupies days in January 2026.
function proj(id: string, status: Project['status'], startDate: string, tasks: { startDay: number; durationDays: number }[]): Project {
  return {
    id, name: id, status,
    schedule: { id: `${id}-s`, projectId: id, startDate, tasks: tasks.map((t, i) => ({ id: `${id}-t${i}`, title: 't', phase: 'p', durationDays: t.durationDays, startDay: t.startDay, status: 'not_started' })) },
  } as unknown as Project;
}

console.log('\nJUDGES capacityLoad:');

// One active project fully occupies the window → high load.
const p1 = proj('A', 'in_progress', '2026-01-01', [{ startDay: 1, durationDays: 31 }]);
const busy = computeCapacityLoad([p1], '2026-01-01', '2026-01-31');
expect('overlapping project counted', busy.overlappingProjects, 1);
expect('bookedSolid when load high', busy.bookedSolid, true);

// Closed projects are excluded.
const closed = proj('B', 'closed', '2026-01-01', [{ startDay: 1, durationDays: 31 }]);
const free = computeCapacityLoad([closed], '2026-01-01', '2026-01-31');
expect('closed project excluded', free.overlappingProjects, 0);
expect('no load when nothing active', free.loadPct, 0);
expect('not booked when free', free.bookedSolid, false);

// A project with no schedule contributes 0.
const noSched = { id: 'C', name: 'C', status: 'in_progress' } as unknown as Project;
const none = computeCapacityLoad([noSched], '2026-01-01', '2026-01-31');
expect('no-schedule project → 0 load', none.loadPct, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
