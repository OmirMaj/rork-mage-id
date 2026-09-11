// scripts/validate-startdate-rebase.ts — the RETIREMENT guard for what used to
// be utils/scheduleRebase.ts.
//
// History. Schedules created without a `startDate` ran the CPM engine in
// raw-day mode. Their stored `ScheduleTask.startDay` values were working-day
// ORDINALS ("the Nth day of work"). Assigning the first start date flipped the
// engine into calendar mode, where — at the time — the engine read those same
// integers as CALENDAR day indices, so every multi-day chain silently inflated:
// the finish-day jump bug, 33 → 43 on a real 20-task schedule (2026-07-12).
//
// `rebaseRawToCalendar` was the compensation: it re-mapped ordinal N onto the
// calendar index of the Nth working day, at the moment of the flip.
//
// 2026-09-11 removed the cause. `forwardPass` now converts at its `pins` line
// (`workingOrdinalToCalendarIndex`), so `startDay` means a working ordinal on
// BOTH sides of the flip and there is nothing left to re-map. Re-mapping anyway
// DOUBLE-converts — and the two surfaces that still called it
// (components/schedule/mobile/MobileScheduleScreen.tsx and
// app/(tabs)/schedule/index.tsx) wrote the result straight through
// `updateProject`, so it was persisted corruption reachable from two shipped
// screens, not a display artefact.
//
// Measured before removal, on A(10)->B(10)->C(5) authored at ordinals 1/11/21,
// 5-day week from Mon 2026-03-02:
//     startDays before rebase : 1,11,21
//     startDays after  rebase : 1,15,29   <- what those screens persisted
//     finish without rebase   : Fri Apr 03 2026   (schedule-pro, correct)
//     finish with    rebase   : Wed Apr 15 2026
//
// So this file no longer tests the helper — the helper is gone. It asserts the
// helper STAYS gone, and it re-proves the property the helper used to fake:
// setting the first start date must not move the plan.

import { runCpm, calendarDayToDate } from '../utils/cpm';
import type { ScheduleTask } from '../types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`); }
}
function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

console.log('\nstart-date rebase: retired');

// ── 1. The helper is gone and nothing re-introduces it ──────────────────────
{
  ok('utils/scheduleRebase.ts no longer exists', !existsSync(join(ROOT, 'utils', 'scheduleRebase.ts')));
  for (const rel of [
    'app/schedule-pro.tsx',
    'app/(tabs)/schedule/index.tsx',
    'components/schedule/mobile/MobileScheduleScreen.tsx',
  ]) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    ok(`${rel} does not re-map startDay when the first anchor is set`,
      !/rebaseRawToCalendar\s*\(/.test(src) && !/scheduleRebase/.test(src.replace(/\/\/[^\n]*/g, '')));
  }
}

// ── 2. The property the helper used to fake now holds on its own ────────────
// Setting the first start date must not move the plan. This is the ACTUAL
// regression test: it fails if anyone re-introduces a conversion at the flip,
// and it fails if the engine stops converting at `pins`.
{
  const T = (id: string, dur: number, startDay: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: deps, status: 'not_started',
  } as unknown as ScheduleTask);

  // Authored undated: A 10 working days, then B 10, then C 5 — pinned at the
  // ordinals the raw-day engine handed back (1, 11, 21).
  const tasks = [T('A', 10, 1), T('B', 10, 11, ['A']), T('C', 5, 21, ['B'])];

  // Undated (raw-day mode): the two scales coincide, so the finish is ordinal 25.
  const raw = runCpm(tasks);
  eq('undated, the plan is 25 working days long', raw.projectFinish, 25);

  // Now anchor it on Mon 2026-03-02, 5-day week. 25 working days from Mon Mar 2
  // is Fri Apr 3 — the SAME plan, laid on a calendar.
  const ISO = '2026-03-02';
  const START = new Date(2026, 2, 2);
  const dated = runCpm(tasks, { scheduleStartDate: ISO, workingDaysPerWeek: 5 });
  eq('anchoring it does not change its shape — 25 working days, finishing Fri Apr 3',
    calendarDayToDate(START, dated.projectFinish).toDateString(),
    new Date(2026, 3, 3).toDateString());
  eq('  …and no task moved off its authored working day',
    tasks.map(t => t.startDay), [1, 11, 21]);

  // What the old helper did, inlined: ordinal N → calendar index of the Nth
  // working day. Feeding THAT to the (now converting) engine is the bug.
  const rebased = tasks.map(t => ({
    ...t,
    startDay: t.id === 'A' ? 1 : t.id === 'B' ? 15 : 29,   // 1,11,21 → 1,15,29
  }));
  const doubled = runCpm(rebased, { scheduleStartDate: ISO, workingDaysPerWeek: 5 });
  eq('double-converting inflates the finish to Wed Apr 15 — which is why it was removed',
    calendarDayToDate(START, doubled.projectFinish).toDateString(),
    new Date(2026, 3, 15).toDateString());
  ok('  …and that really is a regression, not a rounding difference',
    doubled.projectFinish > dated.projectFinish + 5,
    { dated: dated.projectFinish, doubled: doubled.projectFinish });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
