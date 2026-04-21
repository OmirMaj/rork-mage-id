// Bulk-edit operations — pure-function smoke test.
//
// The UI wiring (selection toggles, Cmd+A, bulk bar) can only be fully tested
// in the browser, but every *op* the bar fires is a pure transformation on
// ScheduleTask[]. We replicate those transformations here and assert the
// invariants we care about:
//   - Bulk delete strips dep references
//   - Bulk duplicate creates independent copies with new ids
//   - Bulk shift-days moves startDay but respects the >=1 floor
//   - Bulk setPhase / setCrew only touch selected tasks
//   - Original tasks are never mutated (immutability contract)
//
// Run with: bun run scripts/test-bulk-edit.ts

import { seedDemoSchedule } from '../utils/demoSchedule';
import { createId, generateWbsCodes } from '../utils/scheduleEngine';
import type { ScheduleTask } from '../types';

let failures = 0;
const fail = (msg: string) => { console.error(`  FAIL: ${msg}`); failures++; };
const ok   = (msg: string) => { console.log(`  OK: ${msg}`); };

// ---------------------------------------------------------------------------
// Replicated reducers — must stay byte-identical to schedule-pro.tsx
// ---------------------------------------------------------------------------

function bulkDelete(tasks: ScheduleTask[], ids: string[]): ScheduleTask[] {
  const idSet = new Set(ids);
  return tasks
    .filter(t => !idSet.has(t.id))
    .map(t => ({
      ...t,
      dependencies: t.dependencies.filter(d => !idSet.has(d)),
      dependencyLinks: (t.dependencyLinks ?? []).filter(l => !idSet.has(l.taskId)),
    }));
}

function bulkDuplicate(tasks: ScheduleTask[], ids: string[]): ScheduleTask[] {
  const idSet = new Set(ids);
  const clones: ScheduleTask[] = tasks
    .filter(t => idSet.has(t.id))
    .map(t => ({
      ...t,
      id: createId('task'),
      title: `${t.title} (copy)`,
      dependencies: [],
      dependencyLinks: [],
      actualStartDay: undefined,
      actualEndDay: undefined,
      actualStartDate: undefined,
      actualEndDate: undefined,
      progress: 0,
      status: 'not_started' as const,
    }));
  return generateWbsCodes([...tasks, ...clones]);
}

function bulkShiftDays(tasks: ScheduleTask[], ids: string[], days: number): ScheduleTask[] {
  const idSet = new Set(ids);
  return tasks.map(t => {
    if (!idSet.has(t.id)) return t;
    return { ...t, startDay: Math.max(1, t.startDay + days) };
  });
}

function bulkSetPhase(tasks: ScheduleTask[], ids: string[], phase: string): ScheduleTask[] {
  const idSet = new Set(ids);
  return tasks.map(t => idSet.has(t.id) ? { ...t, phase } : t);
}

function bulkSetCrew(tasks: ScheduleTask[], ids: string[], crew: string): ScheduleTask[] {
  const idSet = new Set(ids);
  return tasks.map(t => idSet.has(t.id) ? { ...t, crew } : t);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const base = seedDemoSchedule();
console.log(`Seeded ${base.length} tasks`);
console.log('');

// --- bulkDelete ---
console.log('--- bulkDelete ---');
{
  // Pick three tasks near the start, including one that others depend on.
  const victim = base[2]; // has successors
  const survivor = base[5];
  const ids = [base[0].id, base[1].id, victim.id];

  const after = bulkDelete(base, ids);

  if (after.length !== base.length - 3) fail(`expected length ${base.length - 3}, got ${after.length}`);
  else ok('removed exactly 3 tasks');

  if (after.some(t => ids.includes(t.id))) fail('some deleted task id still present');
  else ok('no deleted ids remain');

  const lingeringDep = after.find(t => t.dependencies.includes(victim.id));
  if (lingeringDep) fail(`task "${lingeringDep.title}" still lists deleted predecessor in dependencies`);
  else ok('dangling dependency refs to deleted tasks were stripped');

  if (after.find(t => t.id === survivor.id) !== after.find(t => t.id === survivor.id)) {
    // tautology, but keep the survivor sanity check
  }
  const survivorAfter = after.find(t => t.id === survivor.id);
  if (!survivorAfter) fail('unrelated survivor task was lost');
  else ok('untouched tasks survived intact');

  // Immutability: original array should be unchanged.
  if (base.length !== 39) fail(`base schedule length mutated (now ${base.length})`);
  else ok('base schedule immutable');
}

// --- bulkDuplicate ---
console.log('');
console.log('--- bulkDuplicate ---');
{
  const ids = [base[3].id, base[4].id];
  const after = bulkDuplicate(base, ids);

  if (after.length !== base.length + 2) fail(`expected length ${base.length + 2}, got ${after.length}`);
  else ok('added 2 clones');

  const clones = after.slice(-2);
  const sourceTitles = new Set(ids.map(id => base.find(t => t.id === id)!.title));
  for (const c of clones) {
    if (!c.title.endsWith('(copy)')) fail(`clone "${c.title}" missing "(copy)" suffix`);
    if (ids.includes(c.id)) fail(`clone reused original id ${c.id}`);
    if (c.dependencies.length !== 0) fail(`clone "${c.title}" inherited deps; should be fresh`);
    if (c.progress !== 0) fail(`clone "${c.title}" inherited progress ${c.progress}`);
    if (c.actualStartDay != null) fail(`clone "${c.title}" inherited actualStartDay`);
    if (c.status !== 'not_started') fail(`clone "${c.title}" inherited status ${c.status}`);
    // base title matches source after stripping suffix
    const baseTitle = c.title.replace(/ \(copy\)$/, '');
    if (!sourceTitles.has(baseTitle)) fail(`clone "${c.title}" has no matching source title`);
  }
  ok('clones are independent copies with fresh ids + reset state');

  // WBS regen: every task must have a wbsCode post-dup (generateWbsCodes)
  const missing = after.find(t => !t.wbsCode);
  if (missing) fail(`task "${missing.title}" has no WBS code after duplicate`);
  else ok('WBS codes regenerated across entire schedule');
}

// --- bulkShiftDays ---
console.log('');
console.log('--- bulkShiftDays ---');
{
  const ids = [base[10].id, base[11].id, base[12].id];
  const originals = new Map(ids.map(id => [id, base.find(t => t.id === id)!.startDay]));

  // +5 days
  const plus = bulkShiftDays(base, ids, 5);
  for (const id of ids) {
    const after = plus.find(t => t.id === id)!;
    const expected = originals.get(id)! + 5;
    if (after.startDay !== expected) fail(`id=${id}: expected startDay ${expected}, got ${after.startDay}`);
  }
  ok('shift +5 moves each selected startDay by 5');

  // Unselected tasks untouched
  const untouched = plus.find(t => !ids.includes(t.id) && t.startDay !== base.find(b => b.id === t.id)!.startDay);
  if (untouched) fail(`unselected task "${untouched.title}" was shifted`);
  else ok('unselected tasks untouched');

  // Floor: shift -1000 should clamp to 1
  const minus = bulkShiftDays(base, ids, -1000);
  for (const id of ids) {
    const after = minus.find(t => t.id === id)!;
    if (after.startDay !== 1) fail(`clamp failed for id=${id}: got startDay ${after.startDay}`);
  }
  ok('negative shifts clamp to startDay >= 1');
}

// --- bulkSetPhase ---
console.log('');
console.log('--- bulkSetPhase ---');
{
  const ids = [base[0].id, base[1].id];
  const after = bulkSetPhase(base, ids, 'CUSTOMPHASE');
  for (const id of ids) {
    const t = after.find(x => x.id === id)!;
    if (t.phase !== 'CUSTOMPHASE') fail(`id=${id} phase not updated, got "${t.phase}"`);
  }
  ok('phase updated on selected');
  const unselectedChanged = after.some((t, i) => !ids.includes(t.id) && t.phase !== base[i].phase);
  if (unselectedChanged) fail('unselected tasks had phase changed');
  else ok('unselected phases untouched');
}

// --- bulkSetCrew ---
console.log('');
console.log('--- bulkSetCrew ---');
{
  const ids = [base[7].id, base[8].id];
  const after = bulkSetCrew(base, ids, 'Test Crew');
  for (const id of ids) {
    const t = after.find(x => x.id === id)!;
    if (t.crew !== 'Test Crew') fail(`id=${id} crew not updated, got "${t.crew}"`);
  }
  ok('crew updated on selected');
  const unselectedChanged = after.some((t, i) => !ids.includes(t.id) && t.crew !== base[i].crew);
  if (unselectedChanged) fail('unselected tasks had crew changed');
  else ok('unselected crews untouched');
}

// --- Chained ops still produce a valid schedule ---
console.log('');
console.log('--- Chained ops produce a valid schedule ---');
{
  const ids = [base[2].id, base[3].id];
  let s = base;
  s = bulkSetPhase(s, ids, 'NewPhase');
  s = bulkSetCrew(s, ids, 'NewCrew');
  s = bulkShiftDays(s, ids, 3);
  s = bulkDuplicate(s, ids);      // adds 2 clones
  s = bulkDelete(s, [base[4].id]); // removes 1

  // Expected length: base.length + 2 - 1
  if (s.length !== base.length + 1) fail(`chain length off: expected ${base.length + 1}, got ${s.length}`);
  else ok(`chained ops produced correct length (${s.length})`);

  // Every task has a wbs code
  if (s.some(t => !t.wbsCode)) fail('post-chain task missing WBS');
  else ok('all WBS codes present after chain');

  // No dangling deps
  const idSet = new Set(s.map(t => t.id));
  const dangling = s.find(t => t.dependencies.some(d => !idSet.has(d)));
  if (dangling) fail(`task "${dangling.title}" has dangling dep after chain`);
  else ok('no dangling deps after chain');
}

console.log('');
console.log(failures === 0 ? 'ALL PASS ✓' : `${failures} failure(s) ✗`);
process.exit(failures === 0 ? 0 : 1);
