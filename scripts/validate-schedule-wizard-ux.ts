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
//   8. MULTI-PREDECESSOR: a row can wait on any subset of the EARLIER rows,
//      and no move can leave one of those predecessors below it
//   9. REORDER PATH: the drag geometry that turns a finger's travel into a
//      target index, and the guarantee that a drag is just moveTask — i.e.
//      it can't reach a state the up/down arrows can't
//  10. after any operation, a CPM run over the list reports NO cycle conflict

import {
  SCHEDULE_TEMPLATES,
  repairChain, moveTask, removeTaskAt, insertTaskAt,
  readLinkMode, applyLinkMode, cycleLinkMode, setTaskDuration,
  setPredecessors, predecessorOptions, dropTargetIndex, reorderShiftDirection,
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

/**
 * The stronger half of the invariant. `chainIsSane` proves nothing ILLEGAL
 * survived; this proves nothing LEGAL was thrown away — the failure mode that
 * would let a reorder quietly delete "Rough Inspection waits on electrical"
 * while still looking perfectly well-formed.
 *
 * A task is allowed to lose a predecessor only when that predecessor now sits
 * at or after it (genuinely illegal), or when it lost ALL of them and got
 * re-anchored to the row above.
 */
function keptEveryLegalPredecessor(
  before: readonly TemplateTask[],
  after: readonly TemplateTask[],
): string | null {
  const posAfter = new Map(after.map((t, i) => [t.id, i] as const));
  const beforeById = new Map(before.map(t => [t.id, t] as const));
  for (let i = 0; i < after.length; i++) {
    const t = after[i];
    const orig = beforeById.get(t.id);
    if (!orig) continue;
    const stillLegal = orig.predecessorIds.filter(p => {
      const at = posAfter.get(p);
      return at !== undefined && at < i;
    });
    if (stillLegal.length === 0) continue; // re-anchor territory, covered above
    for (const p of stillLegal) {
      if (!t.predecessorIds.includes(p)) return `${t.id} dropped still-legal predecessor ${p}`;
    }
  }
  return null;
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

  // De-duplication. Matters now that predecessors are edited as a SET: a
  // doubled id is harmless to CPM but makes a one-predecessor row's chip read
  // "After 2 tasks".
  const doubled = repairChain([T('a'), T('b'), T('c', ['a', 'a', 'b'])]);
  ok('collapses duplicate predecessors', doubled[2].predecessorIds.join() === 'a,b', doubled[2].predecessorIds);
  ok('de-duplication is idempotent', JSON.stringify(repairChain(doubled)) === JSON.stringify(doubled));

  // Multi-predecessor rows survive untouched when they're all legal.
  const multiClean = [T('a'), T('b'), T('c'), T('d', ['a', 'b', 'c'])];
  ok('keeps every legal predecessor of a multi row', repairChain(multiClean)[3].predecessorIds.length === 3);
  // …and drops ONLY the ones that are illegal.
  const multiPartial = repairChain([T('a'), T('d', ['a', 'b', 'c']), T('b'), T('c')]);
  ok('drops only the now-later predecessors', multiPartial[1].predecessorIds.join() === 'a', multiPartial[1].predecessorIds);
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

// ── 8. multi-predecessor ────────────────────────────────────────────────────
// The wizard's chip could only ever say "after the row above". Real jobs are
// not chains: Rough Inspection waits on plumbing AND electrical AND HVAC, and
// a chain forces you to name one and lie about the other two — which then
// under-runs the plan, because CPM starts the inspection as soon as the one
// link you were allowed to record clears.
console.log('\n8. multi-predecessor');
{
  const chain = [T('a'), T('b', ['a']), T('c', ['b']), T('d', ['c'])];

  // predecessorOptions — the picker can only ever OFFER earlier rows, so the
  // invariant is enforced at the UI boundary as well as in the writer.
  ok('row 1 is offered nothing to wait on', predecessorOptions(chain, 0).length === 0);
  ok('row 3 is offered exactly the two rows above it',
    predecessorOptions(chain, 2).map(t => t.id).join() === 'a,b');
  ok('options never include the row itself',
    predecessorOptions(chain, 2).every(t => t.id !== 'c'));
  ok('out-of-range index offers everything above it',
    predecessorOptions(chain, 99).length === 4);
  ok('negative index offers nothing', predecessorOptions(chain, -3).length === 0);

  // setPredecessors — the picker's only write path.
  const two = setPredecessors(chain, 3, ['a', 'b']);
  ok('sets several predecessors at once', two[3].predecessorIds.join() === 'a,b', two[3].predecessorIds);
  ok('chain stays sane', chainIsSane(two));
  ok('no cycle', cpmCycles(two) === 0);
  ok('a multi row reads as custom', readLinkMode(two, 3) === 'custom');

  // Order is by POSITION, not by the order the user tapped the checkboxes —
  // otherwise the chip's sentence reshuffles itself between edits.
  ok('returns ids in list order regardless of tap order',
    setPredecessors(chain, 3, ['c', 'a', 'b'])[3].predecessorIds.join() === 'a,b,c');
  ok('collapses duplicates', setPredecessors(chain, 3, ['a', 'a', 'b'])[3].predecessorIds.join() === 'a,b');

  // Illegal selections are refused rather than trusted.
  ok('drops an id that sits later in the list',
    setPredecessors(chain, 1, ['a', 'c', 'd'])[1].predecessorIds.join() === 'a');
  ok('drops an unknown id', setPredecessors(chain, 2, ['a', 'ghost'])[2].predecessorIds.join() === 'a');
  ok('a selection of ONLY later rows cannot create a forward link',
    chainIsSane(setPredecessors(chain, 1, ['c', 'd'])));
  ok('row 1 can never be given a predecessor', setPredecessors(chain, 0, ['b', 'c'])[0].predecessorIds.length === 0);

  // Clearing means day 1 — and must NOT be mistaken for "orphaned", which
  // repairChain re-anchors to the row above.
  const cleared = setPredecessors(chain, 2, []);
  ok('an empty selection means starts day 1', cleared[2].predecessorIds.length === 0);
  ok('an empty selection is not re-anchored to the row above', readLinkMode(cleared, 2) === 'start');

  // The three one-tap presets are just selections, so they round-trip through
  // readLinkMode — nothing that worked before the picker got slower or lost.
  ok('preset "after the task above" round-trips',
    readLinkMode(setPredecessors(chain, 2, ['b']), 2) === 'after');
  ok('preset "alongside" round-trips',
    readLinkMode(setPredecessors(chain, 2, [...chain[1].predecessorIds]), 2) === 'with');
  ok('preset "day 1" round-trips', readLinkMode(setPredecessors(chain, 2, []), 2) === 'start');

  ok('out-of-range index is a no-op', setPredecessors(chain, 9, ['a']).length === 4);
  const snap = JSON.stringify(chain);
  setPredecessors(chain, 3, ['a', 'b']);
  ok('does not mutate its input', JSON.stringify(chain) === snap);

  // ── The headline guarantee ────────────────────────────────────────────
  // A fan-in list (three trades feeding one inspection, two feeding cleanup)
  // put through EVERY possible move. After each one:
  //   • every predecessor still exists and still sits earlier  (chainIsSane)
  //   • nothing still-legal was silently discarded            (keptEvery…)
  //   • CPM can still schedule it                             (cpmCycles)
  const fan = [
    T('start', [], 0),
    T('plumb', ['start']),
    T('elec', ['start']),
    T('hvac', ['start']),
    T('inspect', ['plumb', 'elec', 'hvac']),
    T('drywall', ['inspect']),
    T('paint', ['drywall']),
    T('clean', ['paint', 'inspect']),
  ];
  ok('the fan-in fixture is well-formed to begin with', chainIsSane(fan) && cpmCycles(fan) === 0);

  let broken: string | null = null;
  let moves = 0;
  for (let from = 0; from < fan.length && broken === null; from++) {
    for (let to = 0; to < fan.length && broken === null; to++) {
      const moved = moveTask(fan, from, to);
      moves++;
      if (moved.length !== fan.length) broken = `move ${from}->${to} changed the row count`;
      else if (!chainIsSane(moved)) broken = `move ${from}->${to} left a predecessor below its task`;
      else if (cpmCycles(moved) !== 0) broken = `move ${from}->${to} produced a cycle`;
      else {
        const lost = keptEveryLegalPredecessor(fan, moved);
        if (lost) broken = `move ${from}->${to}: ${lost}`;
      }
    }
  }
  ok(`every one of ${moves} possible moves keeps predecessors earlier`, broken === null, broken);

  // Two-hop: move, then re-point a row at an arbitrary subset, then move again.
  let composed: string | null = null;
  for (let from = 0; from < fan.length && composed === null; from++) {
    const once = moveTask(fan, from, (from + 3) % fan.length);
    for (let idx = 1; idx < once.length && composed === null; idx++) {
      const all = predecessorOptions(once, idx).map(t => t.id);
      const edited = setPredecessors(once, idx, all); // wait on EVERYTHING above
      if (!chainIsSane(edited)) { composed = `wait-on-all at ${idx} broke the chain`; break; }
      if (cpmCycles(edited) !== 0) { composed = `wait-on-all at ${idx} produced a cycle`; break; }
      if (edited[idx].predecessorIds.length !== idx) {
        composed = `wait-on-all at ${idx} kept ${edited[idx].predecessorIds.length} of ${idx}`;
        break;
      }
      const back = moveTask(edited, idx, 0); // yank the fan-in row to the top
      if (!chainIsSane(back)) composed = `moving a fan-in row to the top broke the chain`;
      else if (back[0].predecessorIds.length !== 0) composed = `a row moved to the top kept a predecessor`;
      else if (cpmCycles(back) !== 0) composed = `moving a fan-in row to the top produced a cycle`;
    }
  }
  ok('move → wait-on-everything-above → move stays sane', composed === null, composed);
}

// ── 9. reorder path (drag geometry) ─────────────────────────────────────────
// The drag component owns pixels; these two pure functions own the arithmetic
// that turns a finger's travel into an INDEX. That index is then handed to
// moveTask, so a drag is the up/down arrows with a nicer input device — it
// cannot reach a state the arrows can't. The mid-list move that used to orphan
// every successor of the moved row is fenced off by section 8 above; this
// section pins the geometry that decides WHICH move happens.
console.log('\n9. reorder path');
{
  const H = [60, 60, 60, 60, 60]; // uniform rows
  const GAP = 8;
  const SPAN = 60 + GAP;

  ok('no travel means no move', dropTargetIndex(2, 0, H, GAP) === 2);
  ok('less than half a row down does not move', dropTargetIndex(2, SPAN / 2 - 1, H, GAP) === 2);
  ok('past half a row down moves one', dropTargetIndex(2, SPAN / 2 + 1, H, GAP) === 3);
  ok('one and a half rows down moves two', dropTargetIndex(2, SPAN * 1.5 + 1, H, GAP) === 4);
  ok('less than half a row up does not move', dropTargetIndex(2, -(SPAN / 2 - 1), H, GAP) === 2);
  ok('past half a row up moves one', dropTargetIndex(2, -(SPAN / 2 + 1), H, GAP) === 1);
  ok('a long drag up lands on row 1', dropTargetIndex(4, -10000, H, GAP) === 0);
  ok('a long drag down clamps to the last row', dropTargetIndex(0, 10000, H, GAP) === 4);
  ok('cannot be dragged above the first row', dropTargetIndex(0, -10000, H, GAP) === 0);
  ok('cannot be dragged below the last row', dropTargetIndex(4, 10000, H, GAP) === 4);

  // Real geometry, not an assumed row height: a row whose chips wrapped onto
  // a second line is taller, and passing it takes proportionally more travel.
  const ragged = [40, 140, 40, 40];
  ok('a tall neighbour takes more travel to pass', dropTargetIndex(0, 60, ragged, 0) === 0);
  ok('…and is passed at its own midpoint', dropTargetIndex(0, 71, ragged, 0) === 1);
  ok('short rows after a tall one still pass at their own midpoint',
    dropTargetIndex(0, 140 + 21, ragged, 0) === 2);

  // Degenerate inputs are answers, not crashes — onLayout may not have run.
  ok('an unmeasured list returns row 1', dropTargetIndex(0, 500, [], 0) === 0);
  ok('NaN travel is treated as no travel', dropTargetIndex(2, Number.NaN, H, GAP) === 2);
  ok('a from-index past the end clamps', dropTargetIndex(99, 0, H, GAP) === 4);
  ok('a negative from-index clamps', dropTargetIndex(-5, 0, H, GAP) === 0);
  // A row that hasn't laid out yet measures 0. Passing it "for free" would
  // fling a just-added task to the end of the list on the first frame.
  ok('an unmeasured row is never passed', dropTargetIndex(2, 5, [0, 0, 0, 0, 0], 0) === 2);
  ok('a long drag stops at the first unmeasured row', dropTargetIndex(0, 9999, [60, 60, 0, 60], 0) === 1);
  ok('measured rows before an unmeasured one still work',
    dropTargetIndex(0, 9999, [60, 60, 60, 0], 0) === 2);

  // reorderShiftDirection — the visual preview. Only the rows the dragged row
  // passes may move, and each moves exactly one slot.
  ok('the dragged row itself never shifts', reorderShiftDirection(2, 2, 4) === 0);
  ok('a no-op drag shifts nothing', [0, 1, 2, 3].every(i => reorderShiftDirection(i, 2, 2) === 0));
  ok('rows passed on the way DOWN slide up',
    reorderShiftDirection(3, 2, 4) === -1 && reorderShiftDirection(4, 2, 4) === -1);
  ok('rows below the target are untouched (down)', reorderShiftDirection(5, 2, 4) === 0);
  ok('rows above the source are untouched (down)', reorderShiftDirection(1, 2, 4) === 0);
  ok('rows passed on the way UP slide down',
    reorderShiftDirection(1, 3, 1) === 1 && reorderShiftDirection(2, 3, 1) === 1);
  ok('rows above the target are untouched (up)', reorderShiftDirection(0, 3, 1) === 0);
  ok('rows below the source are untouched (up)', reorderShiftDirection(4, 3, 1) === 0);
  {
    const shifted = [0, 1, 2, 3, 4, 5].filter(i => reorderShiftDirection(i, 1, 4) !== 0);
    ok('exactly |to - from| rows shift', shifted.length === 3, shifted);
  }

  // End to end: pixels → index → moveTask → repairChain. Sweep a wide range of
  // drags over a multi-predecessor list and prove none of them corrupts it.
  {
    const list = [
      T('a', [], 0), T('b', ['a']), T('c', ['a']), T('d', ['b', 'c']), T('e', ['d']),
    ];
    const heights = [52, 52, 74, 52, 52];
    let bad: string | null = null;
    for (let from = 0; from < list.length && bad === null; from++) {
      for (let dy = -400; dy <= 400 && bad === null; dy += 17) {
        const to = dropTargetIndex(from, dy, heights, GAP);
        if (to < 0 || to >= list.length) { bad = `from ${from} dy ${dy} → out-of-range ${to}`; break; }
        const next = moveTask(list, from, to);
        if (next.length !== list.length) bad = `from ${from} dy ${dy} lost a row`;
        else if (!chainIsSane(next)) bad = `from ${from} dy ${dy} broke the chain`;
        else if (cpmCycles(next) !== 0) bad = `from ${from} dy ${dy} produced a cycle`;
        else {
          const lost = keptEveryLegalPredecessor(list, next);
          if (lost) bad = `from ${from} dy ${dy}: ${lost}`;
        }
      }
    }
    ok('every drag distance from every row lands on a valid schedule', bad === null, bad);
  }

  // A drag is not privileged: dragging one slot must equal tapping the arrow.
  {
    const list = [T('a'), T('b', ['a']), T('c', ['b']), T('d', ['c'])];
    const heights = [60, 60, 60, 60];
    const dragged = moveTask(list, 1, dropTargetIndex(1, SPAN, heights, GAP));
    const arrowed = moveTask(list, 1, 2);
    ok('a one-row drag is byte-identical to the down arrow',
      JSON.stringify(dragged) === JSON.stringify(arrowed));
  }
}

// ── 10. fuzz: random editing never produces an unschedulable list ───────────
console.log('\n10. fuzz');
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
      switch (rnd(7)) {
        case 0: list = removeTaskAt(list, i); break;
        case 1: list = moveTask(list, i, rnd(Math.max(1, list.length))); break;
        case 2: list = insertTaskAt(list, i, T(`f${seed}-${step}`)); break;
        case 3: list = cycleLinkMode(list, i); break;
        case 4: {
          // Multi-predecessor edit — a random subset of the earlier rows, plus
          // (deliberately) ids the picker would never offer, because a bad
          // caller must not be able to corrupt the graph either.
          const picks: string[] = [];
          for (let k = 0; k < i; k++) if (rnd(2) === 0) picks.push(list[k].id);
          if (rnd(3) === 0 && i + 1 < list.length) picks.push(list[i + 1].id); // later
          if (rnd(4) === 0) picks.push(`ghost-${step}`);                       // unknown
          if (rnd(4) === 0 && picks.length > 0) picks.push(picks[0]);          // duplicate
          list = setPredecessors(list, i, picks);
          break;
        }
        case 5: {
          // Drag: let the drop geometry pick the index from a pixel offset, so
          // the reorder path is fuzzed the way a finger actually drives it.
          const heights = list.map(() => 44 + rnd(60));
          const dy = (rnd(2) === 0 ? 1 : -1) * rnd(500);
          list = moveTask(list, i, dropTargetIndex(i, dy, heights, 8));
          break;
        }
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
