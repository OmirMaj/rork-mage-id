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
//  11. LAG / LEAD per dependency: the offset model, its canonical form, and
//      the guarantee that an offset never outlives the link it describes
//  12. PRUNING: the trap. A lag is a property of a LINK but is stored beside
//      the TASK, so every graph edit can orphan one. An orphan is invisible —
//      until the same predecessor is re-added and a wait nobody asked for
//      silently moves a date
//  13. LAG REACHES CPM ON BOTH PATHS: the live preview AND the saved
//      schedule, through the same id remap, agreeing to the day
//  14. TRUTHFUL SENTENCES: the chip and the spoken/summary sentence say what
//      the graph actually does, including mixed offsets — and say EXACTLY
//      what they used to when there are no offsets at all

import {
  SCHEDULE_TEMPLATES,
  repairChain, moveTask, removeTaskAt, insertTaskAt,
  readLinkMode, applyLinkMode, cycleLinkMode, setTaskDuration,
  setPredecessors, predecessorOptions, dropTargetIndex, reorderShiftDirection,
  getLag, setLag, setLags, clampLag, LAG_LIMIT,
  toCpmTasks, dependencyLinksFor, remapDependencies,
  taskName, sequenceLabel, sequenceDetail, lagStepperLabel,
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
  return runCpm(toCpmTasks(tasks), { scheduleStartDate: '2026-08-03', workingDaysPerWeek: 5 })
    .conflicts.filter(c => c.kind === 'cycle').length;
}

// ── Lag helpers ─────────────────────────────────────────────────────────────

/**
 * The lag map's canonical form, checked directly. Three rules, and violating
 * any of them is a bug that only shows up days later:
 *   • every key is a CURRENT predecessor — a stale entry is invisible right up
 *     until that predecessor is re-added and resurrects a wait nobody set;
 *   • no key stores 0 — two representations of "no wait" means the sentence,
 *     the chip icon and the preset highlight can each pick a different one;
 *   • values are whole days inside the clamp — CPM adds them to a day index.
 */
function lagsAreClean(tasks: readonly TemplateTask[]): string | null {
  for (const t of tasks) {
    if (!t.lags) continue;
    for (const [pid, v] of Object.entries(t.lags)) {
      if (!t.predecessorIds.includes(pid)) {
        return `${t.id} holds an offset for ${pid}, which is not one of its predecessors`;
      }
      if (v === 0) return `${t.id} stores a zero offset for ${pid}`;
      if (!Number.isInteger(v) || Math.abs(v) > LAG_LIMIT) {
        return `${t.id} stores an out-of-range offset ${v} for ${pid}`;
      }
    }
  }
  return null;
}

/** The wizard's own calendar (see WIZARD_WORKING_DAYS_PER_WEEK). */
const WIZ = { start: '2026-08-03', wd: 5 };   // 2026-08-03 is a Monday
/** A 7-day week, where a day of lag is a day of finish and nothing else. */
const RAW = { start: '2026-08-03', wd: 7 };

/**
 * Mirrors `scheduledTasks` in app/schedule-wizard.tsx — the LIVE PREVIEW path.
 * Shares `toCpmTasks` with the screen, so if the screen ever stopped emitting
 * lag this would stop seeing it too.
 */
function preview(tasks: readonly TemplateTask[], opts: { start: string; wd: number }) {
  const result = runCpm(toCpmTasks(tasks), {
    scheduleStartDate: opts.start, workingDaysPerWeek: opts.wd,
  });
  return tasks.map(t => {
    const r = result.perTask.get(t.id);
    const startDay = r?.es ?? 1;
    const endDay = r?.ef ?? startDay + Math.max(0, t.duration - 1);
    return { ...t, startDay, endDay };
  });
}

function previewFinish(tasks: readonly TemplateTask[], opts: { start: string; wd: number }): number {
  const rows = preview(tasks, opts);
  return rows.length === 0 ? 0 : Math.max(...rows.map(r => r.endDay));
}

/**
 * Mirrors `handleSave` in app/schedule-wizard.tsx — the SAVE path. Every task
 * gets a fresh id (Supabase wants UUIDs) and every predecessor reference is
 * translated through the SAME map. This is where `lagDays: 0` used to be
 * hard-coded, so the saved plan silently disagreed with the one the user just
 * approved on screen.
 */
function saved(tasks: readonly TemplateTask[], opts: { start: string; wd: number }): ScheduleTask[] {
  const idMap = new Map<string, string>();
  tasks.forEach((t, i) => idMap.set(t.id, `fresh-${i}`));
  return preview(tasks, opts).map(t => {
    const { dependencies, dependencyLinks } =
      remapDependencies(t, pid => idMap.get(pid) ?? pid);
    return {
      id: idMap.get(t.id)!,
      title: t.name.trim() || 'Untitled task',
      phase: t.phase,
      durationDays: t.duration,
      startDay: t.startDay,
      dependencies,
      dependencyLinks,
      crew: '',
      crewSize: t.crewSize,
      isMilestone: t.isMilestone,
      notes: '',
      status: 'not_started',
      progress: 0,
    };
  });
}

/** What the saved schedule re-schedules to — i.e. what Schedule Pro will show. */
function savedFinish(tasks: readonly TemplateTask[], opts: { start: string; wd: number }): number {
  const result = runCpm(saved(tasks, opts), {
    scheduleStartDate: opts.start, workingDaysPerWeek: opts.wd,
  });
  let max = 0;
  result.perTask.forEach(v => { if (v.ef > max) max = v.ef; });
  return max;
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
      switch (rnd(9)) {
        case 7: {
          // Offset edit. Aims at a real predecessor most of the time and at an
          // arbitrary row the rest, because a bad caller must not be able to
          // plant an offset on a link that doesn't exist.
          const preds = list[i].predecessorIds;
          const target = preds.length > 0 && rnd(4) > 0
            ? preds[rnd(preds.length)]
            : list[rnd(list.length)].id;
          list = setLag(list, i, target, rnd(2 * LAG_LIMIT + 40) - LAG_LIMIT - 20);
          break;
        }
        case 8: {
          // Bulk offset write — what the picker sheet commits. Deliberately
          // includes ids that are NOT predecessors of row i.
          const map: Record<string, number> = {};
          for (let k = 0; k < list.length; k++) {
            if (rnd(3) === 0) map[list[k].id] = rnd(21) - 10;
          }
          if (rnd(4) === 0) map[`ghost-${step}`] = 5;
          list = setLags(list, i, map);
          break;
        }
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
      const dirty = lagsAreClean(list);
      if (dirty) { worst = `seed ${seed} step ${step}: ${dirty}`; break; }
    }
    if (worst === null && cpmCycles(list) !== 0) worst = `seed ${seed}: CPM reported a cycle`;
    // The saved plan is the one the client signs. It must agree with the one
    // the wizard drew, on every seed, offsets and all.
    if (worst === null && previewFinish(list, WIZ) !== savedFinish(list, WIZ)) {
      worst = `seed ${seed}: preview finish ${previewFinish(list, WIZ)} !== saved finish ${savedFinish(list, WIZ)}`;
    }
  }
  ok('400 random edit sessions stay schedulable, with clean offsets that survive a save', worst === null, worst);
}

// ── 11. lag / lead: the model ───────────────────────────────────────────────
// A finish-to-start link means "the day after". Real jobs need "two days after
// the pour, once it's cured" and "three days before the drywallers finish,
// because painting the far rooms can start early". Faking either by padding a
// duration lies to the crew count, the labor curve and the cost report in order
// to move one date.
console.log('\n11. lag / lead model');
{
  const chain = [T('a'), T('b', ['a']), T('c', ['a', 'b'])];

  ok('a row with no offsets reports 0', getLag(chain[1], 'a') === 0);
  ok('a row with no offsets carries NO lags key at all', chain[1].lags === undefined);
  ok('reading an id that is not a predecessor reports 0', getLag(chain[1], 'zzz') === 0);
  ok('reading from an undefined row reports 0', getLag(undefined, 'a') === 0);

  const lagged = setLag(chain, 1, 'a', 3);
  ok('setLag stores the offset', getLag(lagged[1], 'a') === 3, lagged[1].lags);
  ok('setLag round-trips through the map', lagged[1].lags?.a === 3);
  ok('setLag leaves other rows alone', lagged[0] === chain[0] && lagged[2] === chain[2]);
  ok('setLag does not touch the graph', lagged[1].predecessorIds.join() === 'a');

  const lead = setLag(chain, 1, 'a', -2);
  ok('a negative offset is a lead and is stored as such', getLag(lead[1], 'a') === -2);

  ok('clamps above the limit', getLag(setLag(chain, 1, 'a', 9999)[1], 'a') === LAG_LIMIT);
  ok('clamps below the limit', getLag(setLag(chain, 1, 'a', -9999)[1], 'a') === -LAG_LIMIT);
  ok('rounds a fractional offset', getLag(setLag(chain, 1, 'a', 2.6)[1], 'a') === 3);
  ok('NaN collapses to no offset', setLag(chain, 1, 'a', Number.NaN)[1].lags === undefined);
  ok('clampLag is the same function the UI steps through',
    clampLag(2.4) === 2 && clampLag(-1e9) === -LAG_LIMIT && clampLag(Number.POSITIVE_INFINITY) === 0);

  // ONE representation of "no wait" — otherwise the chip, the sentence and the
  // preset highlight can each disagree about whether this link is plain.
  const cleared = setLag(lagged, 1, 'a', 0);
  ok('setting 0 removes the entry entirely', cleared[1].lags === undefined, cleared[1].lags);
  ok('a cleared row is JSON-identical to one that never had an offset',
    JSON.stringify(cleared[1]) === JSON.stringify(chain[1]));

  // An offset on a link that doesn't exist is not a smaller mistake than a
  // dangling predecessor; it's the same mistake, one level down.
  const bogus = setLag(chain, 1, 'c', 4);
  ok('setLag refuses an id that is not a predecessor', bogus[1].lags === undefined, bogus[1].lags);
  ok('setLag on an out-of-range row is a no-op', setLag(chain, 99, 'a', 3).length === 3);
  {
    const snap = JSON.stringify(chain);
    setLag(chain, 1, 'a', 3);
    setLags(chain, 2, { a: 1, b: 2 });
    ok('the offset writers do not mutate their input', JSON.stringify(chain) === snap);
  }

  // setLags — the picker's commit. Its draft is authoritative, so this is a
  // REPLACE: an offset the user cleared has to disappear, not merge back in.
  const both = setLags(chain, 2, { a: 2, b: -1 });
  ok('setLags writes several offsets at once',
    getLag(both[2], 'a') === 2 && getLag(both[2], 'b') === -1);
  const replaced = setLags(both, 2, { b: 4 });
  ok('setLags replaces rather than merges', replaced[2].lags?.a === undefined && getLag(replaced[2], 'b') === 4, replaced[2].lags);
  ok('setLags drops keys that are not predecessors',
    setLags(chain, 1, { a: 2, b: 5, ghost: 9 })[1].lags?.b === undefined);
  ok('setLags keeps the legal key from that same write', getLag(setLags(chain, 1, { a: 2, ghost: 9 })[1], 'a') === 2);
  ok('setLags with an empty map clears every offset', setLags(both, 2, {})[2].lags === undefined);
  ok('setLags on an out-of-range row is a no-op', setLags(chain, 99, { a: 1 }).length === 3);

  // The shipped library is untouched by all of this.
  for (const tpl of SCHEDULE_TEMPLATES) {
    ok(`${tpl.id}: ships with no offsets`, tpl.tasks.every(t => t.lags === undefined));
  }
  ok('repairChain never invents an offset',
    SCHEDULE_TEMPLATES.every(tpl => repairChain(tpl.tasks).every(t => t.lags === undefined)));
  ok('every shipped template has a clean offset map',
    SCHEDULE_TEMPLATES.every(tpl => lagsAreClean(tpl.tasks) === null));
}

// ── 12. pruning: the trap ───────────────────────────────────────────────────
// A lag describes a LINK but is stored on the TASK. Every operation that moves
// the dependency graph can therefore orphan one, and an orphan is invisible:
// nothing renders it, nothing schedules around it, and it survives happily in
// the draft that gets autosaved to AsyncStorage. Then the user re-adds that
// predecessor — days later, on a different screen — and a wait they never set
// moves a date they never touched. Every mutation funnels through repairChain,
// so that is where the offsets are re-derived from the graph.
console.log('\n12. pruning');
{
  const base = setLag([T('a'), T('b'), T('c', ['a', 'b'])], 2, 'a', 3);
  ok('fixture has the offset to begin with', getLag(base[2], 'a') === 3);

  // ── The headline: no resurrection ────────────────────────────────────
  const dropped = setPredecessors(base, 2, ['b']);
  ok('dropping a predecessor drops its offset', dropped[2].lags?.a === undefined, dropped[2].lags);
  const readded = setPredecessors(dropped, 2, ['a', 'b']);
  ok('RE-ADDING that predecessor does NOT resurrect the old offset',
    getLag(readded[2], 'a') === 0, readded[2].lags);
  ok('the re-added link is clean', lagsAreClean(readded) === null);

  // …and the same round trip through every other write path.
  {
    const viaRemove = removeTaskAt(base, 0);            // delete the predecessor itself
    ok('deleting the predecessor TASK drops its offset', lagsAreClean(viaRemove) === null, viaRemove.map(t => t.lags));
    ok('the re-anchored successor inherits no offset',
      viaRemove[viaRemove.length - 1].lags === undefined);
  }
  {
    const viaMove = moveTask(base, 2, 0);               // yank the row above its predecessors
    ok('moving a row above its predecessors drops their offsets', viaMove[0].lags === undefined, viaMove[0].lags);
    ok('…and the chain is still sane', chainIsSane(viaMove) && lagsAreClean(viaMove) === null);
  }
  {
    const viaMove = moveTask(base, 0, 2);               // push 'a' below 'c'
    ok('a reorder that invalidates one link prunes exactly that offset', lagsAreClean(viaMove) === null);
  }
  {
    // A legal reorder must NOT throw away an offset that is still legal —
    // the silent-data-loss twin of the resurrection bug.
    const kept = moveTask(setLag(base, 2, 'b', -2), 0, 1); // swap a and b, both still above c
    ok('a reorder that keeps both links keeps both offsets',
      getLag(kept[2], 'a') === 3 && getLag(kept[2], 'b') === -2, kept[2].lags);
  }

  // repairChain on a hand-authored / deserialised list: a draft written by an
  // older build, a template edited by hand, a bad caller.
  {
    const stale: TemplateTask[] = [
      T('a'), T('b', ['a']),
      { ...T('c', ['b']), lags: { b: 2, a: 5, ghost: 9 } },
    ];
    const fixed = repairChain(stale);
    ok('repairChain drops offsets for non-predecessors even when the graph is unchanged',
      JSON.stringify(fixed[2].lags) === JSON.stringify({ b: 2 }), fixed[2].lags);
    ok('repairChain leaves the legal offset alone', getLag(fixed[2], 'b') === 2);
    ok('repairChain output is clean', lagsAreClean(fixed) === null);
    ok('pruning is idempotent', JSON.stringify(repairChain(fixed)) === JSON.stringify(fixed));

    // Zero and out-of-range values are canonicalised on the way through, so a
    // deserialised draft can't smuggle in a second spelling of "no wait".
    const zeroed = repairChain([T('a'), { ...T('b', ['a']), lags: { a: 0 } }]);
    ok('a stored zero is canonicalised away', zeroed[1].lags === undefined, zeroed[1].lags);
    const wild = repairChain([T('a'), { ...T('b', ['a']), lags: { a: 99999 } }]);
    ok('an out-of-range stored offset is clamped', getLag(wild[1], 'a') === LAG_LIMIT);
  }

  // Referential identity still holds for rows nothing happened to — this is
  // what keeps the task list from re-rendering every row on every keystroke.
  {
    const clean: TemplateTask[] = [T('a'), { ...T('b', ['a']), lags: { a: 2 } }];
    const same = repairChain(clean);
    ok('repairChain returns the same objects when the offsets are already clean',
      same[0] === clean[0] && same[1] === clean[1]);
  }

  // Link-mode presets. 'with' means "runs alongside the row above" — if it
  // dropped that row's offsets this task would start EARLIER than the one it
  // claims to run alongside, which is the only thing the word promises.
  {
    const withLag: TemplateTask[] = [
      T('a'), T('b'),
      { ...T('c', ['a', 'b']), lags: { a: 2 } },
      T('d', ['c']),
    ];
    const alongside = applyLinkMode(withLag, 3, 'with');
    ok('"alongside" copies the row above\'s offsets, not just its predecessors',
      getLag(alongside[3], 'a') === 2, alongside[3].lags);
    ok('"alongside" reads back as with', readLinkMode(alongside, 3) === 'with');
    ok('"alongside" is clean', lagsAreClean(alongside) === null);

    const started = applyLinkMode(alongside, 3, 'start');
    ok('"starts day 1" clears the offsets with the links', started[3].lags === undefined);

    // 'after' re-asserts the link to the row above; an offset the user already
    // put on THAT link survives, everything else goes.
    const seed: TemplateTask[] = [T('a'), { ...T('b', ['a']), lags: { a: 4 } }];
    ok('"after the task above" keeps the offset on that same link',
      getLag(applyLinkMode(seed, 1, 'after')[1], 'a') === 4);
    const other: TemplateTask[] = [T('a'), T('b'), { ...T('c', ['a']), lags: { a: 4 } }];
    ok('"after the task above" drops an offset that belonged to a different link',
      applyLinkMode(other, 2, 'after')[2].lags === undefined, applyLinkMode(other, 2, 'after')[2].lags);

    let cur = withLag;
    for (let k = 0; k < 6; k++) {
      cur = cycleLinkMode(cur, 3);
      const dirty = lagsAreClean(cur);
      if (dirty) { ok('cycling the link mode never strands an offset', false, dirty); break; }
    }
    ok('cycling the link mode never strands an offset', lagsAreClean(cur) === null);
  }

  // ── The sweep. Every possible move over a fan-in list that CARRIES offsets.
  {
    let fan: TemplateTask[] = [
      T('start', [], 0),
      T('plumb', ['start']),
      T('elec', ['start']),
      T('hvac', ['start']),
      T('inspect', ['plumb', 'elec', 'hvac']),
      T('drywall', ['inspect']),
      T('paint', ['drywall']),
      T('clean', ['paint', 'inspect']),
    ];
    fan = setLag(fan, 4, 'plumb', 2);
    fan = setLag(fan, 4, 'elec', -1);
    fan = setLag(fan, 5, 'inspect', 3);
    fan = setLag(fan, 7, 'inspect', 5);
    ok('the offset fan-in fixture is well-formed', chainIsSane(fan) && lagsAreClean(fan) === null && cpmCycles(fan) === 0);

    let broken: string | null = null;
    let moves = 0;
    for (let from = 0; from < fan.length && broken === null; from++) {
      for (let to = 0; to < fan.length && broken === null; to++) {
        const moved = moveTask(fan, from, to);
        moves++;
        if (!chainIsSane(moved)) broken = `move ${from}->${to} left a predecessor below its task`;
        else {
          const dirty = lagsAreClean(moved);
          if (dirty) broken = `move ${from}->${to}: ${dirty}`;
          else if (cpmCycles(moved) !== 0) broken = `move ${from}->${to} produced a cycle`;
          else {
            const lost = keptEveryLegalPredecessor(fan, moved);
            if (lost) broken = `move ${from}->${to}: ${lost}`;
          }
        }
      }
    }
    ok(`every one of ${moves} possible moves leaves no stranded offset`, broken === null, broken);

    // Removing each row in turn — the delete path, which re-anchors.
    let cut: string | null = null;
    for (let i = 0; i < fan.length && cut === null; i++) {
      const after = removeTaskAt(fan, i);
      const dirty = lagsAreClean(after);
      if (dirty) cut = `removing ${fan[i].id}: ${dirty}`;
      else if (!chainIsSane(after)) cut = `removing ${fan[i].id} broke the chain`;
    }
    ok('deleting any row leaves no stranded offset', cut === null, cut);

    // Re-pointing each row at everything above it, then at nothing.
    let edit: string | null = null;
    for (let i = 1; i < fan.length && edit === null; i++) {
      const all = setPredecessors(fan, i, predecessorOptions(fan, i).map(t => t.id));
      const none = setPredecessors(all, i, []);
      const d1 = lagsAreClean(all);
      const d2 = lagsAreClean(none);
      if (d1) edit = `wait-on-all at ${i}: ${d1}`;
      else if (d2) edit = `wait-on-nothing at ${i}: ${d2}`;
      else if (none[i].lags !== undefined) edit = `clearing row ${i} left an offset map behind`;
    }
    ok('re-pointing a row at everything, then nothing, strands no offset', edit === null, edit);
  }
}

// ── 13. lag reaches CPM — both paths ────────────────────────────────────────
// The engine has honoured DependencyLink.lagDays all along (utils/cpm.ts,
// forward + backward pass + free float). The wizard was the gap: its preview
// built links from bare predecessor ids and handleSave hard-coded
// `lagDays: 0`. So a wait could be recorded, drawn nowhere, and saved as
// nothing — the plan on screen and the plan in the database differed, and the
// difference was the part the user had just typed.
console.log('\n13. lag reaches CPM');
{
  // Deliberately trivial fixtures: two rows, so the arithmetic is checkable by
  // hand and a failure names the bug instead of the fixture.
  const plain = [T('a', [], 1), T('b', ['a'], 1)];
  const lag3 = setLag(plain, 1, 'a', 3);

  // Structure first: the links CPM is handed actually carry the number.
  {
    const links = toCpmTasks(lag3)[1].dependencyLinks ?? [];
    ok('the preview emits a dependency link per predecessor', links.length === 1);
    ok('…carrying the offset', links[0].lagDays === 3, links);
    ok('…as a finish-to-start link', links[0].type === 'FS');
    ok('a plain row still emits lagDays 0',
      (toCpmTasks(plain)[1].dependencyLinks ?? [])[0].lagDays === 0);
    ok('dependencyLinksFor remaps ids through the caller\'s map',
      dependencyLinksFor(lag3[1], id => `x-${id}`)[0].taskId === 'x-a');
    ok('…without disturbing the offset',
      dependencyLinksFor(lag3[1], id => `x-${id}`)[0].lagDays === 3);
    const { dependencies, dependencyLinks } = remapDependencies(lag3[1], id => `x-${id}`);
    ok('remapDependencies keeps both halves in step',
      dependencies.join() === 'x-a' && dependencyLinks[0].taskId === 'x-a' && dependencyLinks[0].lagDays === 3);
  }

  // Behaviour: on a 7-day calendar a day of lag is a day of finish, full stop.
  ok('a 3-day lag previews 3 days longer',
    previewFinish(lag3, RAW) === previewFinish(plain, RAW) + 3,
    { plain: previewFinish(plain, RAW), lag3: previewFinish(lag3, RAW) });
  ok('a 3-day lag SAVES 3 days longer',
    savedFinish(lag3, RAW) === savedFinish(plain, RAW) + 3,
    { plain: savedFinish(plain, RAW), lag3: savedFinish(lag3, RAW) });
  ok('preview and save agree exactly, with the lag',
    previewFinish(lag3, RAW) === savedFinish(lag3, RAW));
  ok('(control) the old hard-coded lagDays:0 would have made these differ',
    previewFinish(lag3, RAW) !== previewFinish(plain, RAW));

  // The wizard's OWN calendar. Lag is measured in calendar days, because that
  // is what utils/cpm.ts adds to a predecessor's EF — "wait two days for the
  // slab to cure" is a wall-clock wait and does not skip the weekend. Monday
  // start + 1-day tasks keeps this fixture clear of the weekend so the shift
  // is exactly the lag on the 5-day calendar too.
  ok('a 3-day lag previews 3 days longer on the wizard\'s 5-day calendar',
    previewFinish(lag3, WIZ) === previewFinish(plain, WIZ) + 3,
    { plain: previewFinish(plain, WIZ), lag3: previewFinish(lag3, WIZ) });
  ok('…and saves the same 3 days longer', savedFinish(lag3, WIZ) === savedFinish(plain, WIZ) + 3);

  // Lead — the direction that SHORTENS a job, and the one a padded duration
  // can never express at all.
  {
    // The successor must be long enough to DRIVE the finish, or the lead is
    // invisible: project finish is the max EF across all tasks, so pulling a
    // 1-day successor earlier can never take the finish below its 4-day
    // predecessor's own end. (That was a bad fixture, not a bad engine.)
    const longer = [T('a', [], 4), T('b', ['a'], 5)];
    const lead2 = setLag(longer, 1, 'a', -2);
    // Exactness is asserted on the 7-day calendar, where no weekend can absorb
    // or amplify the shift.
    ok('a 2-day lead previews exactly 2 days shorter (7-day calendar)',
      previewFinish(lead2, RAW) === previewFinish(longer, RAW) - 2,
      { plain: previewFinish(longer, RAW), lead2: previewFinish(lead2, RAW) });
    ok('a 2-day lead SAVES exactly 2 days shorter (7-day calendar)',
      savedFinish(lead2, RAW) === savedFinish(longer, RAW) - 2);
    ok('preview and save agree on the lead',
      previewFinish(lead2, RAW) === savedFinish(lead2, RAW));
    // On the wizard's 5-day calendar a weekend can sit inside the shift, so
    // assert the direction and that both paths still agree — not an exact day
    // count that would encode which weekday the fixture happens to start on.
    ok('a lead genuinely shortens the job on the wizard calendar',
      previewFinish(lead2, WIZ) < previewFinish(longer, WIZ),
      { plain: previewFinish(longer, WIZ), lead2: previewFinish(lead2, WIZ) });
    ok('…and the saved plan shortens with it',
      savedFinish(lead2, WIZ) < savedFinish(longer, WIZ));
    ok('a lead never pushes the finish out',
      previewFinish(lead2, WIZ) <= previewFinish(longer, WIZ));
  }

  // Only the constrained link moves. A fan-in row waits on the LATEST of its
  // links, so an offset on a link that isn't driving must change nothing.
  {
    const fan = [T('start', [], 0), T('slow', ['start'], 6), T('fast', ['start'], 1),
      T('next', ['slow', 'fast'], 1)];
    const onSlack = setLag(fan, 3, 'fast', 2); // 'fast' has 5 days of slack
    ok('an offset inside another link\'s float does not move the finish',
      previewFinish(onSlack, RAW) === previewFinish(fan, RAW));
    const driving = setLag(fan, 3, 'slow', 2);
    ok('an offset on the driving link does move the finish',
      previewFinish(driving, RAW) === previewFinish(fan, RAW) + 2);
    ok('a big enough offset makes the slack link the driver',
      previewFinish(setLag(fan, 3, 'fast', 7), RAW) === previewFinish(fan, RAW) + 2);
    ok('both paths still agree on a fan-in', previewFinish(driving, WIZ) === savedFinish(driving, WIZ));
  }

  // A real template with a real wait: 2 days for the slab to cure before
  // framing sits on it. The whole tail moves, and it moves in both places.
  {
    const kitchen = SCHEDULE_TEMPLATES.find(t => t.id === 'kitchen-remodel')!.tasks.map(t => ({ ...t }));
    const idx = kitchen.findIndex(t => t.id === 'kr-9');       // Drywall, after Insulation
    const cured = setLag(kitchen, idx, 'kr-8', 2);
    ok('a wait added to a shipped template moves its finish',
      previewFinish(cured, RAW) === previewFinish(kitchen, RAW) + 2,
      { before: previewFinish(kitchen, RAW), after: previewFinish(cured, RAW) });
    ok('…and the saved plan moves with it',
      savedFinish(cured, RAW) === savedFinish(kitchen, RAW) + 2);
    ok('…on the wizard\'s calendar too, preview and save still agree',
      previewFinish(cured, WIZ) === savedFinish(cured, WIZ));
    ok('the untouched template is byte-identical to what ships',
      JSON.stringify(kitchen) === JSON.stringify(SCHEDULE_TEMPLATES.find(t => t.id === 'kitchen-remodel')!.tasks));
  }

  // Every shipped template: no offsets, so nothing about its schedule changed.
  {
    let drift: string | null = null;
    for (const tpl of SCHEDULE_TEMPLATES) {
      if (previewFinish(tpl.tasks, WIZ) !== savedFinish(tpl.tasks, WIZ)) {
        drift = `${tpl.id}: preview ${previewFinish(tpl.tasks, WIZ)} vs saved ${savedFinish(tpl.tasks, WIZ)}`;
        break;
      }
    }
    ok('every shipped template still previews exactly as it saves', drift === null, drift);
  }
}

// ── 14. truthful sentences ──────────────────────────────────────────────────
// The chip and its spoken label are the only place a user learns what a link
// does. A schedule that says "After Framing" while CPM waits two more days is
// not a cosmetic bug: it is a plan the client signs that nobody on site can
// reproduce.
console.log('\n14. sentences');
{
  const named = (id: string, name: string, preds: string[] = []): TemplateTask =>
    ({ ...T(id, preds), name });
  const rows = [named('f', 'Framing'), named('e', 'Electrical', ['f']), named('d', 'Drywall', ['e'])];

  // ── No offsets: EXACTLY the wording that shipped before lag existed ──
  ok('row 1 still reads "Starts day 1"', sequenceLabel(rows, 0) === 'Starts day 1');
  ok('a plain chained row still reads "After <prev>"',
    sequenceLabel(rows, 2) === 'After Electrical', sequenceLabel(rows, 2));
  ok('an alongside row still reads "Alongside <prev>"',
    sequenceLabel(applyLinkMode(rows, 2, 'with'), 2) === 'Alongside Electrical');
  ok('a day-1 row still reads "Starts day 1"',
    sequenceLabel(applyLinkMode(rows, 2, 'start'), 2) === 'Starts day 1');
  ok('a plain multi row still counts',
    sequenceLabel(setPredecessors(rows, 2, ['f', 'e']), 2) === 'After 2 tasks');
  // A single predecessor that is neither the row above NOR the row above's own
  // predecessor. (Pointing Drywall at 'f' does NOT test this: that gives it the
  // same predecessor as Electrical, which correctly reads "Alongside".)
  {
    const four = [...rows, named('p', 'Paint', ['d'])];
    ok('a plain single non-adjacent link is still named',
      sequenceLabel(setPredecessors(four, 3, ['f']), 3) === 'After Framing',
      sequenceLabel(setPredecessors(four, 3, ['f']), 3));
    ok('…and pointing a row at the row above\'s predecessor reads "Alongside"',
      sequenceLabel(setPredecessors(rows, 2, ['f']), 2) === 'Alongside Electrical');
  }
  ok('the plain detail sentence is unchanged',
    sequenceDetail(rows, ['e']) === 'Starts when Electrical finishes');
  ok('the plain two-predecessor sentence is unchanged',
    sequenceDetail(rows, ['f', 'e']) === 'Starts when Framing and Electrical have both finished');
  ok('the plain three-predecessor sentence is unchanged',
    sequenceDetail([...rows, named('p', 'Paint')], ['f', 'e', 'd'])
      === 'Starts when all 3 of Framing, Electrical and Drywall have finished');
  ok('an empty selection still reads "Starts on day 1"', sequenceDetail(rows, []) === 'Starts on day 1');

  // ── With offsets: the sentence changes, and says the right thing ──
  const wait2 = setLag(rows, 2, 'e', 2);
  ok('a lag is spoken on the chip', sequenceLabel(wait2, 2) === '2 days after Electrical', sequenceLabel(wait2, 2));
  ok('a lag is spelled out in the detail',
    sequenceDetail(wait2, ['e'], wait2[2].lags) === 'Starts 2 days after Electrical finishes',
    sequenceDetail(wait2, ['e'], wait2[2].lags));

  const wait1 = setLag(rows, 2, 'e', 1);
  ok('one day is singular', sequenceLabel(wait1, 2) === '1 day after Electrical', sequenceLabel(wait1, 2));

  const lead3 = setLag(rows, 2, 'e', -3);
  ok('a lead is spoken as an overlap on the chip',
    sequenceLabel(lead3, 2) === '3 days before Electrical ends', sequenceLabel(lead3, 2));
  ok('a lead is spelled out in the detail',
    sequenceDetail(lead3, ['e'], lead3[2].lags) === 'Starts 3 days before Electrical finishes',
    sequenceDetail(lead3, ['e'], lead3[2].lags));
  ok('a lead never leaks a minus sign into the sentence',
    !sequenceLabel(lead3, 2).includes('-') && !sequenceDetail(lead3, ['e'], lead3[2].lags).includes('-'));

  // ── Multi-predecessor with MIXED offsets. "when all three have finished" is
  // a lie the moment one of them carries a lead, so the sentence says what CPM
  // actually does: it takes the latest.
  {
    let mixed = setPredecessors([...rows, named('p', 'Paint', [])], 3, ['f', 'e', 'd']);
    mixed = setLag(mixed, 3, 'e', 2);
    mixed = setLag(mixed, 3, 'd', -1);
    ok('a mixed multi row is not passed off as a plain one',
      sequenceLabel(mixed, 3) === 'After 3 tasks with offsets', sequenceLabel(mixed, 3));
    const detail = sequenceDetail(mixed, mixed[3].predecessorIds, mixed[3].lags);
    ok('the mixed detail sentence names the latest-of rule',
      detail === 'Starts at the latest of: when Framing finishes, 2 days after Electrical finishes, 1 day before Drywall finishes',
      detail);
    // Order is by POSITION, not by which one the user tapped last.
    const shuffled = sequenceDetail(mixed, ['d', 'f', 'e'], mixed[3].lags);
    ok('the sentence does not reshuffle with the selection order', shuffled === detail);
    // Set every offset back to 0 and the old wording returns verbatim.
    const flat = setLags(mixed, 3, {});
    ok('clearing every offset restores the original sentence',
      sequenceDetail(flat, flat[3].predecessorIds, flat[3].lags)
        === 'Starts when all 3 of Framing, Electrical and Drywall have finished');
    ok('…and the original chip', sequenceLabel(flat, 3) === 'After 3 tasks');
  }

  // A row whose predecessors match the row above but whose OFFSETS don't is
  // not "alongside" it — it starts somewhere else entirely.
  {
    const par = setLag(setPredecessors([named('a', 'Slab'), named('b', 'Frame', ['a']), named('c', 'Rough-in', ['a'])], 2, ['a']), 2, 'a', 4);
    ok('a lagged parallel row is not described as "alongside"',
      sequenceLabel(par, 2) === '4 days after Slab', sequenceLabel(par, 2));
  }

  // The picker's stepper caption — the only place the user meets the control.
  ok('stepper says "No wait" at zero', lagStepperLabel(0) === 'No wait');
  ok('stepper counts a wait in plain English', lagStepperLabel(2) === 'Wait 2 days');
  ok('stepper is singular at one day', lagStepperLabel(1) === 'Wait 1 day');
  ok('stepper names the lead direction without jargon', lagStepperLabel(-3) === 'Start 3 days early');
  ok('stepper is singular for a one-day lead', lagStepperLabel(-1) === 'Start 1 day early');
  ok('stepper clamps like the model', lagStepperLabel(9999) === `Wait ${LAG_LIMIT} days`);
  ok('unnamed rows keep their placeholder', taskName(T('x')) === 'X' && taskName(undefined) === 'Untitled task');

  // A sentence is only true if the schedule agrees with it. Sweep a range of
  // offsets and check the sentence's direction against the CPM finish.
  {
    let mismatch: string | null = null;
    for (let lag = -4; lag <= 4 && mismatch === null; lag++) {
      const list = setLag(rows, 2, 'e', lag);
      const label = sequenceLabel(list, 2);
      const finish = previewFinish(list, RAW);
      const flatFinish = previewFinish(rows, RAW);
      if (lag > 0 && (!label.startsWith(`${lag} day`) || finish <= flatFinish)) {
        mismatch = `lag ${lag} said "${label}" but finished at ${finish} (plain ${flatFinish})`;
      } else if (lag < 0 && (!label.includes('before') || finish >= flatFinish)) {
        mismatch = `lead ${lag} said "${label}" but finished at ${finish} (plain ${flatFinish})`;
      } else if (lag === 0 && (label !== 'After Electrical' || finish !== flatFinish)) {
        mismatch = `zero said "${label}" and finished at ${finish} (plain ${flatFinish})`;
      }
    }
    ok('every offset the stepper can reach is described in the direction it schedules', mismatch === null, mismatch);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
