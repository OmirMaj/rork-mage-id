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

import { runCpm, formatFloat, wouldCreateCycle } from '../utils/cpm';
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

console.log('\n============================================');
console.log(failed === 0 ? 'ALL PASS ✓' : `${failed} failure(s) ✗`);
process.exit(failed === 0 ? 0 : 1);
