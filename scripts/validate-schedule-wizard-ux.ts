// scripts/validate-schedule-wizard-ux.ts — pins the schedule wizard's task-list
// contract (constants/scheduleTemplates.ts).
//
// The wizard shows tasks as an ordered list and treats the list order as the
// build sequence. Everything below defends ONE invariant:
//
//     a predecessor always exists, and always sits earlier in the list.
//
// Three shipped bugs came from not having it:
//   1. deleting a mid-list task left its successor pointing at a ghost id;
//      runCpm silently drops unknown links, so the successor teleported to
//      day 1 and the whole tail of the schedule re-sorted itself;
//   2. reordering could point a task at something below it — a dependency
//      cycle, which runCpm reports as a conflict and refuses to schedule;
//   3. an orphaned task jumped to day 1 rather than holding its place.
//
// Pins here:
//   1. every shipped template is already well-formed (repairChain is a no-op)
//   2. repairChain is idempotent and never invents a forward/self reference
//   3. removeTaskAt heals the chain instead of orphaning the successor
//   4. moveTask keeps the graph acyclic and re-anchors what it displaced
//   5. insertTaskAt splices into the middle of a chain without breaking it
//   6. readLinkMode / cycleLinkMode round-trip through the three settable
//      states, and row 1 can never be given a predecessor
//   7. setTaskDuration clamps, and 0 days flips the milestone flag
//   8. after any operation, a CPM run over the list reports NO cycle conflict

import {
  SCHEDULE_TEMPLATES,
  repairChain, moveTask, removeTaskAt, insertTaskAt,
  readLinkMode, applyLinkMode, cycleLinkMode, setTaskDuration,
} from '../constants/scheduleTemplates';
import type { TemplateTask } from '../constants/scheduleTemplates';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n        got ' + JSON.stringify(detail) : ''));
  }
}

const T = (id: string, preds: string[] = [], duration = 2): TemplateTask => ({
  id,
  name: id.toUpperCase(),
  phase: 'General',
  duration,
  predecessorIds: preds,
  isMilestone: duration === 0,
  isCriticalPath: false,
  crewSize: 1,
});

/** The invariant, checked directly. */
function chainIsSane(tasks: readonly TemplateTask[]): boolean {
  const indexById = new Map(tasks.map((t, i) => [t.id, i] as const));
  return tasks.every((t, i) =>
    t.predecessorIds.every(pid => {
      const at = indexById.get(pid);
      return at !== undefined && at < i;
    }),
  );
}

/** Does the engine consider this list schedulable? */
function cpmCycles(tasks: readonly TemplateTask[]): number {
  const cpmTasks: ScheduleTask[] = tasks.map(t => ({
    id: t.id, title: t.name, phase: t.phase, durationDays: t.duration,
    startDay: 1, dependencies: t.predecessorIds, crew: '', crewSize: t.crewSize,
    isMilestone: t.isMilestone, notes: '', status: 'not_started', progress: 0,
  }));
  return runCpm(cpmTasks, { scheduleStartDate: '2026-08-03', workingDaysPerWeek: 5 })
    .conflicts.filter(c => c.kind === 'cycle').length;
}

console.log('\nschedule wizard task-list validation:');

// ── 1. Shipped templates are already well-formed ────────────────────────────
console.log('\n1. shipped templates');
for (const tpl of SCHEDULE_TEMPLATES) {
  ok(`${tpl.id}: authored in topological order`, chainIsSane(tpl.tasks));
  const repaired = repairChain(tpl.tasks);
  ok(
    `${tpl.id}: repairChain is a no-op`,
    repaired.every((t, i) =>
      t.predecessorIds.length === tpl.tasks[i].predecessorIds.length &&
      t.predecessorIds.every(p => tpl.tasks[i].predecessorIds.includes(p))),
  );
  ok(`${tpl.id}: schedules without a cycle`, cpmCycles(tpl.tasks) === 0);
}

// ── 2. repairChain semantics ────────────────────────────────────────────────
console.log('\n2. repairChain');
{
  // Dangling reference to a task that isn't in the list at all.
  const dangling = [T('a'), T('b', ['ghost'])];
  const fixed = repairChain(dangling);
  ok('re-anchors a dangling predecessor to the row above', fixed[1].predecessorIds.join() === 'a', fixed[1].predecessorIds);

  // Forward reference — b depends on c which is below it.
  const forward = [T('a'), T('b', ['c']), T('c', ['a'])];
  const f2 = repairChain(forward);
  ok('drops a forward reference', chainIsSane(f2));
  ok('forward-referencing row re-anchors upward', f2[1].predecessorIds.join() === 'a', f2[1].predecessorIds);

  // Row 1 can never keep a predecessor.
  const headPred = repairChain([T('a', ['b']), T('b')]);
  ok('row 1 loses any predecessor', headPred[0].predecessorIds.length === 0);

  // A genuinely parallel task (never had predecessors) stays at day 1.
  const parallel = repairChain([T('a'), T('b'), T('c', ['a'])]);
  ok('a never-sequenced row is NOT invented a predecessor', parallel[1].predecessorIds.length === 0);

  // Idempotent.
  const once = repairChain([T('a'), T('b', ['ghost']), T('c', ['zzz'])]);
  const twice = repairChain(once);
  ok('idempotent', JSON.stringify(once) === JSON.stringify(twice));

  // Never mutates the input.
  const src = [T('a'), T('b', ['ghost'])];
  const snapshot = JSON.stringify(src);
  repairChain(src);
  ok('does not mutate its input', JSON.stringify(src) === snapshot);

  // Unchanged rows keep referential identity (cheap re-renders).
  const clean = [T('a'), T('b', ['a'])];
  const same = repairChain(clean);
  ok('returns the same object for untouched rows', same[0] === clean[0] && same[1] === clean[1]);
}

// ── 3. removeTaskAt ─────────────────────────────────────────────────────────
console.log('\n3. removeTaskAt');
{
  const chain = [T('a'), T('b', ['a']), T('c', ['b']), T('d', ['c'])];
  const cut = removeTaskAt(chain, 1); // delete the middle of the chain
  ok('removes the row', cut.map(t => t.id).join() === 'a,c,d');
  ok('successor re-anchors instead of orphaning', cut[1].predecessorIds.join() === 'a', cut[1].predecessorIds);
  ok('chain stays sane', chainIsSane(cut));
  ok('no cycle', cpmCycles(cut) === 0);

  // The regression this exists for: without repair, c pointed at deleted b,
  // CPM dropped the link and c started on day 1 alongside a.
  const naive = chain.filter((_, i) => i !== 1);
  ok('(control) naive filter DOES orphan the successor', !chainIsSane(naive));

  // Deleting the head promotes the next row to day 1.
  const headless = removeTaskAt(chain, 0);
  ok('deleting row 1 leaves the new row 1 at day 1', headless[0].predecessorIds.length === 0);

  // Out-of-range is a copy, not a crash.
  ok('out-of-range index is a no-op', removeTaskAt(chain, 99).length === chain.length);
}

// ── 4. moveTask ─────────────────────────────────────────────────────────────
console.log('\n4. moveTask');
{
  const chain = [T('a'), T('b', ['a']), T('c', ['b']), T('d', ['c'])];

  const up = moveTask(chain, 2, 0); // c to the top
  ok('reorders', up.map(t => t.id).join() === 'c,a,b,d');
  ok('moved row loses its now-later predecessor', up[0].predecessorIds.length === 0);
  ok('chain stays sane', chainIsSane(up));
  ok('no cycle', cpmCycles(up) === 0);

  const down = moveTask(chain, 0, 3); // a to the bottom
  ok('moving the head down keeps it acyclic', chainIsSane(down));
  ok('no cycle after a long move', cpmCycles(down) === 0);
  ok('new head starts at day 1', down[0].predecessorIds.length === 0);

  // Swapping neighbours keeps a chain a chain.
  const swap = moveTask(chain, 1, 2);
  ok('neighbour swap keeps every row sequenced', swap.slice(1).every(t => t.predecessorIds.length === 1));

  ok('no-op move returns an equal list', moveTask(chain, 1, 1).map(t => t.id).join() === 'a,b,c,d');
  ok('out-of-range target clamps', moveTask(chain, 0, 99).map(t => t.id).join() === 'b,c,d,a');
}

// ── 5. insertTaskAt ─────────────────────────────────────────────────────────
console.log('\n5. insertTaskAt');
{
  const chain = [T('a'), T('b', ['a']), T('c', ['b'])];
  const mid = insertTaskAt(chain, 2, T('new'));
  ok('splices into the middle', mid.map(t => t.id).join() === 'a,b,new,c');
  ok('inserted row chains onto the row above', mid[2].predecessorIds.join() === 'b', mid[2].predecessorIds);
  ok('chain stays sane', chainIsSane(mid));
  ok('no cycle', cpmCycles(mid) === 0);

  const head = insertTaskAt(chain, 0, T('first'));
  ok('inserting at the top leaves the new head at day 1', head[0].predecessorIds.length === 0);

  const empty = insertTaskAt([], 0, T('only'));
  ok('first task of an empty list has no predecessor', empty.length === 1 && empty[0].predecessorIds.length === 0);

  const tail = insertTaskAt(chain, 99, T('last'));
  ok('index past the end appends', tail[tail.length - 1].id === 'last');
}

// ── 6. link modes ───────────────────────────────────────────────────────────
console.log('\n6. link modes');
{
  const chain = [T('a'), T('b', ['a']), T('c', ['b'])];
  ok('row 1 reads as start', readLinkMode(chain, 0) === 'start');
  ok('chained row reads as after', readLinkMode(chain, 1) === 'after');

  const withPrev = applyLinkMode(chain, 2, 'with');
  ok('with = shares the row above\'s predecessors', withPrev[2].predecessorIds.join() === 'a', withPrev[2].predecessorIds);
  ok('with round-trips through readLinkMode', readLinkMode(withPrev, 2) === 'with');
  ok('with stays acyclic', chainIsSane(withPrev) && cpmCycles(withPrev) === 0);

  const started = applyLinkMode(chain, 2, 'start');
  ok('start clears predecessors', started[2].predecessorIds.length === 0);
  ok('start round-trips', readLinkMode(started, 2) === 'start');

  // One-tap cycle: after -> with -> start -> after.
  let cur = chain;
  ok('cycle 1: after -> with', readLinkMode(cur = cycleLinkMode(cur, 2), 2) === 'with');
  ok('cycle 2: with -> start', readLinkMode(cur = cycleLinkMode(cur, 2), 2) === 'start');
  ok('cycle 3: start -> after', readLinkMode(cur = cycleLinkMode(cur, 2), 2) === 'after');
  ok('cycling never breaks the chain', chainIsSane(cur) && cpmCycles(cur) === 0);

  // Row 1 has nothing above it — it must stay at day 1 whatever we ask for.
  ok('cycling row 1 is a no-op', cycleLinkMode(chain, 0)[0].predecessorIds.length === 0);
  ok('applyLinkMode(after) on row 1 is a no-op', applyLinkMode(chain, 0, 'after')[0].predecessorIds.length === 0);

  // A template's multi-predecessor row reads as custom, and normalises on tap.
  const multi = [T('a'), T('b'), T('c', ['a', 'b'])];
  ok('multi-predecessor row reads as custom', readLinkMode(multi, 2) === 'custom');
  ok('custom is not settable', applyLinkMode(multi, 2, 'custom')[2].predecessorIds.length === 2);
  ok('tapping a custom row normalises to after', readLinkMode(cycleLinkMode(multi, 2), 2) === 'after');

  // "with" on a row whose predecessor is row 1 means both start at day 1.
  const bothStart = applyLinkMode([T('a'), T('b')], 1, 'with');
  ok('with under a day-1 row keeps both at day 1', bothStart[1].predecessorIds.length === 0);
}

// ── 7. setTaskDuration ──────────────────────────────────────────────────────
console.log('\n7. setTaskDuration');
{
  const list = [T('a', [], 3)];
  ok('sets the value', setTaskDuration(list, 0, 12)[0].duration === 12);
  ok('0 days flips isMilestone on', setTaskDuration(list, 0, 0)[0].isMilestone === true);
  ok('non-zero flips isMilestone off', setTaskDuration(setTaskDuration(list, 0, 0), 0, 4)[0].isMilestone === false);
  ok('clamps below zero', setTaskDuration(list, 0, -5)[0].duration === 0);
  ok('clamps above a year', setTaskDuration(list, 0, 9999)[0].duration === 365);
  ok('NaN falls back to 0 rather than corrupting the task', setTaskDuration(list, 0, Number.NaN)[0].duration === 0);
  ok('rounds fractional input', setTaskDuration(list, 0, 2.6)[0].duration === 3);
  ok('out-of-range index is a no-op', setTaskDuration(list, 9, 5).length === 1);
}

// ── 8. fuzz: random editing never produces an unschedulable list ────────────
console.log('\n8. fuzz');
{
  let worst: string | null = null;
  for (let seed = 0; seed < 400 && worst === null; seed++) {
    // Deterministic LCG so a failure is reproducible from the seed.
    let s = seed * 2654435761 % 2147483647 || 1;
    const rnd = (n: number) => ((s = (s * 48271) % 2147483647) % n);
    let list: TemplateTask[] = SCHEDULE_TEMPLATES[seed % SCHEDULE_TEMPLATES.length]
      .tasks.map(t => ({ ...t }));
    for (let step = 0; step < 30; step++) {
      if (list.length === 0) list = insertTaskAt(list, 0, T(`f${step}`));
      const i = rnd(list.length);
      switch (rnd(5)) {
        case 0: list = removeTaskAt(list, i); break;
        case 1: list = moveTask(list, i, rnd(Math.max(1, list.length))); break;
        case 2: list = insertTaskAt(list, i, T(`f${seed}-${step}`)); break;
        case 3: list = cycleLinkMode(list, i); break;
        default: list = setTaskDuration(list, i, rnd(30)); break;
      }
      if (!chainIsSane(list)) { worst = `seed ${seed} step ${step}: chain broken`; break; }
    }
    if (worst === null && cpmCycles(list) !== 0) worst = `seed ${seed}: CPM reported a cycle`;
  }
  ok('400 random edit sessions stay schedulable', worst === null, worst);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
