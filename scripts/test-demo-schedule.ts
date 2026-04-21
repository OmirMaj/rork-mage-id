// Exercise the CPM engine against the full 35-task residential build.
//
// This is mostly a smoke test — if any of the pieces we're banking on in the
// UI (critical path, resource conflicts, baselines) is wrong, it'll blow up
// or print garbage here. Run with: bun run scripts/test-demo-schedule.ts

import { seedDemoSchedule } from '../utils/demoSchedule';
import { runCpm, formatFloat } from '../utils/cpm';

const tasks = seedDemoSchedule();

console.log(`Seeded ${tasks.length} tasks`);
console.log('');

const cpm = runCpm(tasks, { levelResources: true });

console.log(`Project finish:  day ${cpm.projectFinish}`);
console.log(`Critical path:   ${cpm.criticalPath.length} task(s)`);
console.log(`Conflicts:       ${cpm.conflicts.length}`);
console.log('');

// Print the critical path in order so we can visually check it looks sane.
console.log('--- Critical path ---');
for (const id of cpm.criticalPath) {
  const t = tasks.find(x => x.id === id);
  const row = cpm.perTask.get(id);
  if (!t || !row) continue;
  console.log(`  ${t.title.padEnd(44)} ES=${row.es} EF=${row.ef} ${formatFloat(row.totalFloat)}`);
}
console.log('');

// Print conflicts.
if (cpm.conflicts.length > 0) {
  console.log('--- Conflicts ---');
  for (const c of cpm.conflicts) {
    console.log(`  [${c.kind}] ${c.message}`);
  }
  console.log('');
}

// Sanity: every task should have CPM fields.
let missing = 0;
for (const t of tasks) {
  if (!cpm.perTask.has(t.id)) {
    console.error(`  MISSING: ${t.title}`);
    missing++;
  }
}

// Sanity: project finish must equal max EF.
const maxEf = Math.max(...[...cpm.perTask.values()].map(r => r.ef));
if (maxEf !== cpm.projectFinish) {
  console.error(`  FAIL: projectFinish=${cpm.projectFinish} but maxEf=${maxEf}`);
  missing++;
}

// Sanity: every task on critical path must have TF ≤ 0.
for (const id of cpm.criticalPath) {
  const row = cpm.perTask.get(id)!;
  if (row.totalFloat > 0) {
    console.error(`  FAIL: ${id} is in criticalPath but TF=${row.totalFloat}`);
    missing++;
  }
}

// Sanity: as-built tasks should have baseline and actual.
const withActual = tasks.filter(t => t.actualStartDay != null);
const withBaseline = tasks.filter(t => t.baselineStartDay != null);
console.log(`Tasks with baseline:  ${withBaseline.length}`);
console.log(`Tasks with actuals:   ${withActual.length}`);

console.log('');
console.log(missing === 0 ? 'ALL PASS ✓' : `${missing} failure(s) ✗`);
process.exit(missing === 0 ? 0 : 1);
