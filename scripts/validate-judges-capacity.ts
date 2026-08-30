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
function proj(
  id: string, status: Project['status'], startDate: string,
  tasks: { startDay: number; durationDays: number }[],
  calendar?: { workingDaysPerWeek?: number; nonWorkingDates?: string[] },
): Project {
  return {
    id, name: id, status,
    schedule: {
      id: `${id}-s`, projectId: id, startDate,
      ...calendar,
      tasks: tasks.map((t, i) => ({ id: `${id}-t${i}`, title: 't', phase: 'p', durationDays: t.durationDays, startDay: t.startDay, status: 'not_started' })),
    },
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

// Parallel tasks in ONE project count once (interval union), not N times.
// Two identical 15-day tasks over a 30-day window → covered 15 → loadPct 0.5.
const parallel = proj('D', 'in_progress', '2026-01-01', [
  { startDay: 1, durationDays: 15 },
  { startDay: 1, durationDays: 15 },
]);
const par = computeCapacityLoad([parallel], '2026-01-01', '2026-01-31');
expect('parallel tasks union, loadPct 0.5', Math.round(par.loadPct * 1000), 500);
expect('parallel tasks: not booked solid', par.bookedSolid, false);
expect('parallel tasks: one project', par.overlappingProjects, 1);

// Adjacent sequential tasks merge into continuous coverage.
// Days 1–10 + 11–20 over a 30-day window → covered 20 → loadPct 2/3.
const sequential = proj('E', 'in_progress', '2026-01-01', [
  { startDay: 1, durationDays: 10 },
  { startDay: 11, durationDays: 10 },
]);
const seq = computeCapacityLoad([sequential], '2026-01-01', '2026-01-31');
expect('sequential tasks merge, loadPct 2/3', Math.round(seq.loadPct * 1000), 667);

// Half-open boundary: a task ENDING exactly at window start does not overlap.
const before = proj('F', 'in_progress', '2025-12-27', [{ startDay: 1, durationDays: 5 }]);
const b = computeCapacityLoad([before], '2026-01-01', '2026-01-31');
expect('task ending at window start → no overlap', b.loadPct, 0);
expect('boundary task → no overlapping project', b.overlappingProjects, 0);

// bookedSolid threshold: exactly 0.85 is booked solid.
// 17 busy days over a 20-day window (Jan 1 → Jan 21) → 0.85.
const tight = proj('G', 'in_progress', '2026-01-01', [{ startDay: 1, durationDays: 17 }]);
const t85 = computeCapacityLoad([tight], '2026-01-01', '2026-01-21');
expect('loadPct pinned at 0.85', Math.round(t85.loadPct * 1000), 850);
expect('bookedSolid at exactly 0.85', t85.bookedSolid, true);

// ── durations are WORKING days, so the crew's calendar occupancy is longer ──
// This file used to claim mapping working-day durations onto calendar days
// "overstates density slightly". It understated it, and not slightly.
//
// 2026-08-31 is a Monday. One 20-working-day task on a Mon-Fri calendar runs
// Aug 31 → Fri Sep 25, i.e. 26 of the window's 28 days = 92.9%. Spanning it as
// 20 calendar days gives 20/28 = 71.4% — below the 0.85 bookedSolid threshold,
// so a GC who is booked solid was told they had room.
{
  const wd5 = proj('W', 'in_progress', '2026-08-31',
    [{ startDay: 1, durationDays: 20 }], { workingDaysPerWeek: 5 });
  const load = computeCapacityLoad([wd5], '2026-08-31', '2026-09-28');
  expect('Mon-Fri: 20 working days covers 26 of 28 window days',
    Math.round(load.loadPct * 1000), 929);
  expect('...and that IS booked solid (the old math said false)',
    load.bookedSolid, true);
}

// A project that declares NO calendar keeps the previous arithmetic exactly —
// taskWindow defaults to 7-day weeks, matching utils/cpm's own `?? 7`.
{
  const noCal = proj('N', 'in_progress', '2026-08-31', [{ startDay: 1, durationDays: 20 }]);
  const load = computeCapacityLoad([noCal], '2026-08-31', '2026-09-28');
  expect('no declared calendar → unchanged 20/28', Math.round(load.loadPct * 1000), 714);
  expect('...and still not booked solid', load.bookedSolid, false);
}

// Holidays extend occupancy too — a shutdown day pushes the finish out.
{
  const withHoliday = proj('H', 'in_progress', '2026-08-31',
    [{ startDay: 1, durationDays: 5 }],
    { workingDaysPerWeek: 5, nonWorkingDates: ['2026-09-02'] });
  const load = computeCapacityLoad([withHoliday], '2026-08-31', '2026-09-28');
  // Mon Aug31 → Mon Sep 7 inclusive = 8 days of 28.
  expect('a mid-week holiday extends the span to 8 days',
    Math.round(load.loadPct * 28 * 1000) / 1000, 8);
}

// Each project brings its OWN calendar — a 6-day sub and a Mon-Fri GC do not
// occupy the same span for the same duration.
{
  const six = proj('S6', 'in_progress', '2026-08-31',
    [{ startDay: 1, durationDays: 12 }], { workingDaysPerWeek: 6 });
  const five = proj('S5', 'in_progress', '2026-08-31',
    [{ startDay: 1, durationDays: 12 }], { workingDaysPerWeek: 5 });
  const l6 = computeCapacityLoad([six], '2026-08-31', '2026-09-28');
  const l5 = computeCapacityLoad([five], '2026-08-31', '2026-09-28');
  expect('a 6-day week finishes sooner than a 5-day week', l6.loadPct < l5.loadPct, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
