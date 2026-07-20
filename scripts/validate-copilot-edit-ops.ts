// scripts/validate-copilot-edit-ops.ts — pure-fn validator for the schedule
// edit-op vocabulary: the normalizer (drops junk, clamps bounds) and the
// interpreter (cycle/ref/bounds guards + partial application).
import { normalizeEditOps } from '../utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps } from '../utils/copilot/scheduleEdit/interpretOps';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

// --- normalizeEditOps ---
ok('non-array → []', normalizeEditOps(null).length === 0 && normalizeEditOps({}).length === 0);
ok('keeps a valid move op', normalizeEditOps([{ op: 'move', task: 't1', deltaDays: 7 }]).length === 1);
ok('drops an unknown op', normalizeEditOps([{ op: 'nuke', task: 't1' }]).length === 0);
ok('drops move with no task', normalizeEditOps([{ op: 'move', deltaDays: 3 }]).length === 0);
ok('clamps progress to 0..100', (() => {
  const o = normalizeEditOps([{ op: 'setProgress', task: 't1', pct: 250 }])[0] as any;
  return o.op === 'setProgress' && o.pct === 100;
})());
ok('drops setDuration with negative days', normalizeEditOps([{ op: 'setDuration', task: 't1', days: -4 }]).length === 0);
ok('coerces addDependency type + defaults lag 0', (() => {
  const o = normalizeEditOps([{ op: 'addDependency', from: 'a', to: 'b', type: 'SS' }])[0] as any;
  return o.type === 'SS' && o.lag === 0;
})());
ok('bad dep type → FS', (() => {
  const o = normalizeEditOps([{ op: 'addDependency', from: 'a', to: 'b', type: 'ZZ' }])[0] as any;
  return o.type === 'FS';
})());
ok('keeps level', normalizeEditOps([{ op: 'level' }]).length === 1);
ok('drops the removed setStartDate op', normalizeEditOps([{ op: 'setStartDate', iso: '2026-08-01' }]).length === 0);
ok('addTask needs a title', normalizeEditOps([{ op: 'addTask', durationDays: 3 }]).length === 0);

// --- interpretScheduleOps ---
const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
// framing(1) → rough(2, dep framing) → mep(3, dep rough)
const base = (): ScheduleTask[] => [
  mk('t1', { title: 'Framing', startDay: 1, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }),
  mk('t3', { title: 'MEP', startDay: 10, durationDays: 3, dependencies: ['t2'] }),
];

ok('move by delta shifts startDay', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'move', task: 't1', deltaDays: 7 }], base());
  return results[0].ok && nextTasks.find(t => t.id === 't1')!.startDay === 8;
})());
ok('resolves a ref by name (case-insensitive)', (() => {
  const { results } = interpretScheduleOps([{ op: 'setDuration', task: 'framing', days: 9 }], base());
  return results[0].ok;
})());
ok('rejects an unresolved ref', (() => {
  const { results } = interpretScheduleOps([{ op: 'move', task: 'nope', deltaDays: 1 }], base());
  return !results[0].ok && !!results[0].reason;
})());
ok('addDependency rejects a cycle', (() => {
  // t1 → t2 → t3; adding t3 as a predecessor of t1 closes a loop
  const { results } = interpretScheduleOps([{ op: 'addDependency', from: 't3', to: 't1', type: 'FS', lag: 0 }], base());
  return !results[0].ok && /cycle/i.test(results[0].reason || '');
})());
ok('addDependency (no cycle) adds the link', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'addDependency', from: 't1', to: 't3', type: 'FS', lag: 0 }], base());
  return results[0].ok && nextTasks.find(t => t.id === 't3')!.dependencies.includes('t1');
})());
ok('removeTask strips dangling deps', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'removeTask', task: 't2' }], base());
  return !nextTasks.find(t => t.id === 't2') && !nextTasks.find(t => t.id === 't3')!.dependencies.includes('t2');
})());
ok('addTask appends after a ref', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'addTask', title: 'Cabinet procurement', durationDays: 10, after: 't1' }], base());
  return nextTasks.length === 4 && !!nextTasks.find(t => t.title === 'Cabinet procurement');
})());
ok('setCrew writes crewSize', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'setCrew', task: 't1', crewSize: 6 }], base());
  return nextTasks.find(t => t.id === 't1')!.crewSize === 6;
})());
ok('partial application: valid applies, invalid reported', (() => {
  const { nextTasks, results } = interpretScheduleOps([
    { op: 'setDuration', task: 't1', days: 9 },
    { op: 'move', task: 'ghost', deltaDays: 2 },
  ], base());
  return nextTasks.find(t => t.id === 't1')!.durationDays === 9 && results[0].ok && !results[1].ok;
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
