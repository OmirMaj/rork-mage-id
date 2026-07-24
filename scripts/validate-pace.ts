// validate-pace.ts — unit tests for the Productivity Feedback Loop:
// as-built transition stamping + the pace book engine.
// Run via: bun run test:pace
import { stampActuals, todayDayNumberFrom } from '../utils/pace/stampActuals';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// ── Fixtures ──
const NOW = '2026-07-23T15:00:00.000Z';
function t(over: Partial<ScheduleTask>): ScheduleTask {
  return {
    id: 'T1', title: 'Framing walls', phase: 'Structure', durationDays: 5,
    startDay: 4, progress: 0, crew: '', dependencies: [], notes: '',
    status: 'not_started', ...over,
  } as ScheduleTask;
}

console.log('\npace stampActuals:');

expect('→in_progress stamps start today',
  stampActuals(t({}), 'in_progress', 12, NOW),
  { actualStartDay: 12, actualStartDate: NOW });
expect('→in_progress never overwrites an existing start',
  stampActuals(t({ actualStartDay: 6, actualStartDate: '2026-07-17T08:00:00.000Z' }), 'in_progress', 12, NOW),
  {});
expect('→done stamps end only, when start exists',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW });
expect('→done retro-stamps start from planned startDay (Gantt rule)',
  stampActuals(t({}), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW, actualStartDay: 4, actualStartDate: NOW });
expect('→done never overwrites an existing end',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6, actualEndDay: 9 }), 'done', 12, NOW),
  {});
expect('→on_hold never stamps',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'on_hold', 12, NOW),
  {});
expect('same-status call is a no-op',
  stampActuals(t({ status: 'in_progress' }), 'in_progress', 12, NOW),
  {});
expect('reopen (→not_started) never stamps or clears',
  stampActuals(t({ status: 'done', actualStartDay: 6, actualEndDay: 9 }), 'not_started', 12, NOW),
  {});

console.log('\npace todayDayNumberFrom:');

const NOON = new Date('2026-07-23T12:00:00');
expect('schedule started today → day 1', todayDayNumberFrom('2026-07-23', NOON), 1);
expect('schedule started 10 days ago → day 11', todayDayNumberFrom('2026-07-13', NOON), 11);
expect('future start clamps to day 1', todayDayNumberFrom('2026-08-01', NOON), 1);
expect('missing startDate → day 1', todayDayNumberFrom(undefined, NOON), 1);
expect('garbage startDate → day 1', todayDayNumberFrom('not-a-date', NOON), 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
