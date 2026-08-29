// Quick smoke test for the CPM engine.
// Run with: bun run scripts/test-cpm.ts
//
// Uses a canonical CPM textbook example so the numbers are easy to verify
// against any PMP reference.
//
//            +--- B (3d) ---+
//   Start -> A (2d)         +-> D (4d) -> End
//            +--- C (5d) ---+
//
// Expected (FS, 0 lag, 1-indexed inclusive days):
//   A: ES=1, EF=2
//   B: ES=3, EF=5    (follows A)
//   C: ES=3, EF=7    (follows A)  <-- longest path
//   D: ES=8, EF=11   (follows max(B.EF,C.EF))
//   projectFinish = 11
//   Critical path: A → C → D (TF = 0)
//   B's TF = 2 (can slip 2 days without delaying D)

import { runCpm, formatFloat, wouldCreateCycle, workingDaysBetween } from '../utils/cpm';
import { captureBaseline, baselineFinishDayWorkingScale } from '../utils/scheduleOps';
import type { ScheduleTask } from '../types';

const stub = (overrides: Partial<ScheduleTask>): ScheduleTask => ({
  id: overrides.id!,
  title: overrides.title ?? overrides.id!,
  phase: 'General',
  durationDays: overrides.durationDays ?? 1,
  startDay: overrides.startDay ?? 1,
  progress: 0,
  crew: overrides.crew ?? '',
  dependencies: overrides.dependencies ?? [],
  dependencyLinks: overrides.dependencyLinks,
  notes: '',
  status: 'not_started',
  ...overrides,
});

const tasks: ScheduleTask[] = [
  stub({ id: 'A', durationDays: 2 }),
  stub({ id: 'B', durationDays: 3, dependencies: ['A'] }),
  stub({ id: 'C', durationDays: 5, dependencies: ['A'], crew: 'Framing' }),
  stub({ id: 'D', durationDays: 4, dependencies: ['B', 'C'] }),
];

const result = runCpm(tasks);

console.log('--- CPM result ---');
for (const id of ['A', 'B', 'C', 'D']) {
  const r = result.perTask.get(id);
  if (!r) { console.log(`${id}: (missing)`); continue; }
  console.log(
    `${id}: ES=${r.es} EF=${r.ef}  LS=${r.ls} LF=${r.lf}  TF=${r.totalFloat}  FF=${r.freeFloat}  ${r.isCritical ? 'CRITICAL' : ''}`
  );
}
console.log(`projectFinish: ${result.projectFinish}`);
console.log(`criticalPath: ${result.criticalPath.join(' → ')}`);
console.log(`conflicts: ${result.conflicts.length}`);

const expected = {
  A: { es: 1, ef: 2, tf: 0 },
  B: { es: 3, ef: 5, tf: 2 },
  C: { es: 3, ef: 7, tf: 0 },
  D: { es: 8, ef: 11, tf: 0 },
};
let failed = 0;
for (const [id, want] of Object.entries(expected)) {
  const got = result.perTask.get(id)!;
  if (got.es !== want.es || got.ef !== want.ef || got.totalFloat !== want.tf) {
    console.error(`  FAIL ${id}: got ES=${got.es} EF=${got.ef} TF=${got.totalFloat}, want ES=${want.es} EF=${want.ef} TF=${want.tf}`);
    failed++;
  }
}
if (result.projectFinish !== 11) {
  console.error(`  FAIL projectFinish: got ${result.projectFinish}, want 11`);
  failed++;
}
if (result.criticalPath.join(',') !== 'A,C,D') {
  console.error(`  FAIL critical path: got ${result.criticalPath.join(',')}, want A,C,D`);
  failed++;
}

// --- Cycle detection test ---
console.log('\n--- Cycle detection ---');
const cyclicTasks: ScheduleTask[] = [
  stub({ id: 'X', dependencies: ['Z'] }),
  stub({ id: 'Y', dependencies: ['X'] }),
  stub({ id: 'Z', dependencies: ['Y'] }),
];
const cyclic = runCpm(cyclicTasks);
if (cyclic.conflicts.length === 0) {
  console.error('  FAIL: expected a cycle conflict');
  failed++;
} else {
  console.log(`  OK: detected ${cyclic.conflicts[0].kind} — ${cyclic.conflicts[0].message}`);
}

// --- wouldCreateCycle guard ---
console.log('\n--- wouldCreateCycle guard ---');
// Given A → B → C, adding C as a predecessor of A would create a cycle.
const linear: ScheduleTask[] = [
  stub({ id: 'A' }),
  stub({ id: 'B', dependencies: ['A'] }),
  stub({ id: 'C', dependencies: ['B'] }),
];
const bad = wouldCreateCycle(linear, 'A', 'C');  // true
const ok = wouldCreateCycle(linear, 'C', 'A');   // false (already exists path)
if (!bad) { console.error('  FAIL: should have detected A <- C cycle'); failed++; }
else console.log('  OK: blocked cycle creation');
if (ok)  { console.error('  FAIL: should NOT flag valid transitive link'); failed++; }
else console.log('  OK: allowed valid forward edge');

// --- Resource leveling test ---
console.log('\n--- Resource leveling ---');
// Two tasks, same crew, overlap. The one with more float should slide.
const resourceTasks: ScheduleTask[] = [
  stub({ id: 'R1', durationDays: 5, crew: 'Framing' }),
  stub({ id: 'R2', durationDays: 3, crew: 'Framing' }),
  stub({ id: 'R3', durationDays: 4, dependencies: ['R1'] }), // keeps R1 critical
];
const leveled = runCpm(resourceTasks, { levelResources: true });
if (!leveled.leveledStartDays) {
  console.error('  FAIL: expected leveledStartDays');
  failed++;
} else {
  const r2 = leveled.leveledStartDays.get('R2');
  console.log(`  R2 leveled startDay: ${r2} (original: 1)`);
  if (r2 === 1) {
    console.error('  FAIL: expected R2 to be delayed');
    failed++;
  } else {
    console.log(`  OK: conflicts reported: ${leveled.conflicts.length}`);
  }
}

// --- Non-FS links across a weekend (workingDaysPerWeek: 5) ---
// Regression lock for the v2.2b+ fix: the FF/SF forward branches and the
// SS/SF backward branches used to subtract/add RAW days for the duration
// term instead of walking WORKING days. On the default 5-day week any
// non-FS link that straddles a weekend silently mis-dated the task and
// corrupted float/critical-path. Calendar: 2024-01-01 is a Monday, so
// day 5 = Fri, days 6-7 = Sat/Sun (non-working), day 8 = Mon.
console.log('\n--- Non-FS links across a weekend (5-day week) ---');
const CAL = { scheduleStartDate: '2024-01-01', workingDaysPerWeek: 5 } as const;

// FF: P finishes on Monday day 8 (dur 6 from Mon day 1, skipping the weekend).
// Q (dur 3) is finish-to-finish tied to P, so Q must ALSO finish day 8, which
// forces Q.ES back across the weekend to Thu day 4 (Thu, Fri, Mon = 3 working
// days). The old raw-day math produced ES=6 (a Saturday) → EF=10.
const ffTasks: ScheduleTask[] = [
  stub({ id: 'P', durationDays: 6, startDay: 1 }),
  stub({ id: 'Q', durationDays: 3, startDay: 1, dependencyLinks: [{ taskId: 'P', type: 'FF', lagDays: 0 }] }),
];
const ffRes = runCpm(ffTasks, CAL);
const p = ffRes.perTask.get('P')!;
const q = ffRes.perTask.get('Q')!;
console.log(`  P: ES=${p.es} EF=${p.ef}   Q: ES=${q.es} EF=${q.ef}   projectFinish=${ffRes.projectFinish}`);
if (p.ef !== 8) { console.error(`  FAIL FF: P.EF got ${p.ef}, want 8`); failed++; }
if (q.ef !== 8) { console.error(`  FAIL FF: Q.EF got ${q.ef}, want 8 (finish must align to P's finish across the weekend)`); failed++; }
if (q.es !== 4) { console.error(`  FAIL FF: Q.ES got ${q.es}, want 4 (Thu — 3 working days back from Mon day 8)`); failed++; }
if (ffRes.projectFinish !== 8) { console.error(`  FAIL FF: projectFinish got ${ffRes.projectFinish}, want 8`); failed++; }
if (p.ef === 8 && q.ef === 8 && q.es === 4) console.log('  OK: FF finish aligns across the weekend');

// SS: A (dur 3) is start-to-start before B (dur 2). LONG (dur 6) pins the
// project finish at Monday day 8. The SS backward branch must walk A's late
// finish forward in WORKING days off B's late start (Fri day 5) — landing on
// the Monday (day 8). The old raw-day math produced LF=7, a Sunday.
console.log('\n--- SS backward alignment across a weekend ---');
const ssTasks: ScheduleTask[] = [
  stub({ id: 'A', durationDays: 3, startDay: 1 }),
  stub({ id: 'B', durationDays: 2, startDay: 1, dependencyLinks: [{ taskId: 'A', type: 'SS', lagDays: 0 }] }),
  stub({ id: 'LONG', durationDays: 6, startDay: 1 }),
];
const ssRes = runCpm(ssTasks, CAL);
const a = ssRes.perTask.get('A')!;
const b = ssRes.perTask.get('B')!;
console.log(`  A: ES=${a.es} EF=${a.ef} LS=${a.ls} LF=${a.lf}   B: LS=${b.ls}   projectFinish=${ssRes.projectFinish}`);
if (ssRes.projectFinish !== 8) { console.error(`  FAIL SS: projectFinish got ${ssRes.projectFinish}, want 8`); failed++; }
if (a.lf !== 8) { console.error(`  FAIL SS: A.LF got ${a.lf}, want 8 (late finish must land on the working Monday, not the Sunday day 7)`); failed++; }
else console.log('  OK: SS late-finish aligns to a working day across the weekend');

// --- Slip vs baseline == 0 on an UNCHANGED 5-day-week schedule ---
// Regression lock for the "phantom slip" merge blocker. captureBaseline
// persists each task's startDay + a RAW endDay (startDay + dur - 1, no weekend
// skipping). The schedule-pro slip KPI used to take max(endDay) directly and
// compare it — via workingDaysBetween — against the working-day-aware
// cpm.projectFinish. On the default 5-day week those two finishes live on
// different scales, so slip came out non-zero the instant a baseline was
// captured on an untouched schedule. baselineFinishDayWorkingScale re-derives
// the baseline finish on the SAME calendar CPM uses, so slip == 0.
//
// Calendar: 2024-01-01 = Monday, 5-day week. A (dur 3) starts Mon day 1 →
// finishes Wed day 3. B (dur 4) follows A, starting Thu day 4 → Thu, Fri, then
// across the weekend to Mon day 8, Tue day 9 → finishes day 9. The RAW baseline
// endDay for B is 4 + 4 - 1 = 7 (a Sunday) — off the working-day scale.
console.log('\n--- Slip vs baseline == 0 (unchanged 5-day-week schedule) ---');
const SLIP_CAL = { scheduleStartDate: '2024-01-01', workingDaysPerWeek: 5 } as const;
const settledTasks: ScheduleTask[] = [
  stub({ id: 'A', durationDays: 3, startDay: 1 }),
  stub({ id: 'B', durationDays: 4, startDay: 4, dependencies: ['A'] }),
];
const settledCpm = runCpm(settledTasks, SLIP_CAL);
const baseline = captureBaseline(settledTasks, 'v1');
const baselineFinish = baselineFinishDayWorkingScale(baseline, SLIP_CAL);
const slip = baselineFinish == null
  ? null
  : workingDaysBetween(baselineFinish, settledCpm.projectFinish, SLIP_CAL);
// Show what the old raw-endDay approach would have reported, to make the
// regression legible if this ever breaks again.
const rawBaselineFinish = Math.max(...baseline.tasks.map(t => t.endDay));
const rawSlip = workingDaysBetween(rawBaselineFinish, settledCpm.projectFinish, SLIP_CAL);
console.log(`  cpm.projectFinish=${settledCpm.projectFinish}  baselineFinish(working)=${baselineFinish}  slip=${slip}  (raw-endDay slip would be ${rawSlip})`);
if (settledCpm.projectFinish !== 9) { console.error(`  FAIL slip: projectFinish got ${settledCpm.projectFinish}, want 9`); failed++; }
if (baselineFinish !== 9) { console.error(`  FAIL slip: baselineFinish got ${baselineFinish}, want 9 (working-day scale)`); failed++; }
if (slip !== 0) { console.error(`  FAIL slip: got ${slip}, want 0 (unchanged schedule must show zero slip)`); failed++; }
else console.log('  OK: unchanged schedule reports zero slip right after baseline capture');

// ── v2.2d: FS across a weekend must not invent float ────────────────────────
// A pure chain with no parallel path is critical by definition — every task,
// on every calendar. Before this fix `FS` used raw `dep.ef + lag + 1`, so a
// predecessor finishing on a Friday put its successor's ES on SATURDAY while
// the EF walk correctly skipped to Monday. The backward pass then derived LS
// from a working-day LF, and the difference showed up as phantom float exactly
// the width of the weekend: the task reported float=2 and fell off the critical
// path. On a real 5-day schedule most FS links cross a weekend somewhere, so
// the critical path fragmented into disconnected pieces.
{
  const chain: ScheduleTask[] = [
    stub({ id: 'A', durationDays: 3 }),
    stub({ id: 'B', durationDays: 2, dependencies: ['A'] }),
    stub({ id: 'C', durationDays: 2, dependencies: ['B'] }),
  ];
  for (const wd of [7, 5]) {
    const r = runCpm(chain, { scheduleStartDate: '2026-03-02', workingDaysPerWeek: wd });
    for (const id of ['A', 'B', 'C']) {
      const c = r.perTask.get(id)!;
      if (c.totalFloat !== 0) {
        console.error(`  FAIL ${wd}-day week: ${id} on a pure chain has float ${c.totalFloat}, want 0`);
        failed++;
      }
      if (!c.isCritical) {
        console.error(`  FAIL ${wd}-day week: ${id} on a pure chain is not critical`);
        failed++;
      }
    }
  }
  // And the successor must actually START on a working day, not a Saturday.
  const five = runCpm(chain, { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5 });
  const cEs = five.perTask.get('C')!.es;
  if (cEs !== 8) {
    console.error(`  FAIL: C must start Monday (day 8), not Saturday (day 6) — got ${cEs}`);
    failed++;
  } else {
    console.log('  OK: FS across a weekend lands on the next WORKING day, no phantom float');
  }
}

console.log('\n============================================');
console.log(failed === 0 ? 'ALL PASS ✓' : `${failed} failure(s) ✗`);
process.exit(failed === 0 ? 0 : 1);
