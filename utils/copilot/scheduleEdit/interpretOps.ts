// utils/copilot/scheduleEdit/interpretOps.ts — pure interpreter: apply EditOps
// to a task array with per-op guards. Never throws; every op yields an OpResult.
// React/RN-free (only domain types + cpm) so validators drive it.
import type { ScheduleTask, DependencyLink } from '@/types';
import { wouldCreateCycle, runCpm, calendarIndexToWorkingOrdinal, type RunCpmOptions, type CpmResult } from '@/utils/cpm';
import { generateUUID } from '@/utils/generateId';
import type { EditOp } from './editOps';

/** `anchorTitle` (addTask only): the task the new row ACTUALLY follows after
 *  chaining — the "what landed" line names it, not the model's raw `after`
 *  (three adds "after rough-in" land chained, and the card must say so).
 *  `fromDay` / `toDay` / `askedDay` (move only): where the task was SCHEDULED
 *  to start before the batch, where it is scheduled after it, and the day the
 *  move asked for — working-day ordinals, the same numbers the grounding lists.
 *  The "what landed" line prints these, never the op's raw deltaDays, so it
 *  says what the Gantt will show. */
export interface OpResult { op: EditOp; ok: boolean; reason?: string; anchorTitle?: string; fromDay?: number; toDay?: number; askedDay?: number }

type Resolved = { id: string } | { error: string };

/** Resolve a TaskRef: exact id, else exact title (case-insensitive), else a
 *  UNIQUE substring of a title. A substring that matches several tasks is
 *  refused with the candidates named — "rough-in" used to take the first match
 *  (Plumbing rough-in) when he meant the inspection. */
function resolveRef(ref: string, tasks: ScheduleTask[]): Resolved {
  if (tasks.some(t => t.id === ref)) return { id: ref };
  const lc = ref.trim().toLowerCase();
  if (!lc) return { error: 'no task named' };
  const exact = tasks.filter(t => t.title.trim().toLowerCase() === lc);
  if (exact.length === 1) return { id: exact[0].id };
  const pool = exact.length > 1 ? exact : tasks.filter(t => t.title.trim().toLowerCase().includes(lc));
  if (pool.length === 1) return { id: pool[0].id };
  if (pool.length === 0) return { error: `no task matching "${ref}"` };
  const names = pool.slice(0, 4).map(t => `“${t.title}”`).join(', ');
  return { error: `"${ref}" could mean ${names}${pool.length > 4 ? ` and ${pool.length - 4} more` : ''} — say which` };
}

/** New task ids are UUIDs (the same source createId uses). The counter this
 *  replaced restarted at edit-1 on every page load, so a second session reused
 *  the first session's ids and the duplicate rows collapsed on save — the new
 *  tasks vanished. */
function freshId(): string { return generateUUID(); }

/** FS successors of `anchorId`: tasks that depend on it with a finish-to-start
 *  link (a dependency with no link entry is FS by default). */
function isFsSuccessorOf(t: ScheduleTask, anchorId: string): boolean {
  if (!t.dependencies.includes(anchorId)) return false;
  const link = t.dependencyLinks?.find(l => l.taskId === anchorId);
  return !link || !link.type || link.type === 'FS';
}

/**
 * `cpmOptions`: the calendar the host's CPM runs on (the same object its
 * preview and commit use). Moves are placed and judged on it — see the move
 * pass below. Omitted = the day-number model ({}).
 */
export function interpretScheduleOps(
  ops: EditOp[],
  tasks: ScheduleTask[],
  cpmOptions: RunCpmOptions = {},
): { nextTasks: ScheduleTask[]; results: OpResult[] } {
  let working: ScheduleTask[] = tasks.map(t => ({ ...t, dependencies: [...t.dependencies], dependencyLinks: t.dependencyLinks ? [...t.dependencyLinks] : undefined }));
  // One slot per op, in the order he said them — moves are filled in a second
  // pass (below) but still report in their spoken position.
  const results: (OpResult | undefined)[] = new Array(ops.length);
  const patch = (id: string, over: Partial<ScheduleTask>) => { working = working.map(t => t.id === id ? { ...t, ...over } : t); };
  // Consecutive adds on ONE anchor chain in the order spoken: the tail of the
  // chain hanging off each original anchor, and which anchor each new task
  // belongs to. Without this, three adds "after rough-in" each inserted at
  // anchor+1 — reversed and all in parallel.
  const chainTail = new Map<string, string>();
  const rootOf = new Map<string, string>();
  // Titles of tasks added in THIS batch win over older tasks with the same
  // title: the prompt chains adds by title, and a second "add drywall hang…"
  // session must chain onto the new row, not refuse "could mean 2 tasks".
  const addedByTitle = new Map<string, string>();
  // Adds in THIS batch that failed, by title: a later add chained onto one
  // ("tape after Drywall hang") fails because its anchor was never placed —
  // say that, not "no task matching" as if he named something that doesn't exist.
  const failedAdds = new Set<string>();
  const resolve = (ref: string): Resolved => {
    const mine = addedByTitle.get(ref.trim().toLowerCase());
    return mine && working.some(t => t.id === mine) ? { id: mine } : resolveRef(ref, working);
  };

  // PASS 1 — every op except `move`, in spoken order.
  ops.forEach((op, i) => {
    if (op.op === 'move') return;
    const put = (r: OpResult) => { results[i] = r; };
    try {
      const refOr = (ref: string): string | null => {
        const r = resolve(ref);
        if ('error' in r) { put({ op, ok: false, reason: r.error }); return null; }
        return r.id;
      };
      switch (op.op) {
        case 'setDuration': {
          const id = refOr(op.task); if (!id) break;
          patch(id, { durationDays: Math.max(0, Math.round(op.days)) });
          put({ op, ok: true }); break;
        }
        case 'setProgress': {
          const id = refOr(op.task); if (!id) break;
          patch(id, { progress: op.pct });
          put({ op, ok: true }); break;
        }
        case 'setCrew': {
          const id = refOr(op.task); if (!id) break;
          patch(id, { crewSize: op.crewSize });
          put({ op, ok: true }); break;
        }
        case 'addDependency': {
          const to = resolve(op.to), from = resolve(op.from);
          if ('error' in to || 'error' in from) {
            put({ op, ok: false, reason: 'error' in to ? to.error : (from as { error: string }).error }); break;
          }
          const toId = to.id, fromId = from.id;
          if (wouldCreateCycle(working, toId, fromId)) { put({ op, ok: false, reason: `that dependency would create a cycle` }); break; }
          const toTask = working.find(t => t.id === toId)!;
          const deps = toTask.dependencies.includes(fromId) ? toTask.dependencies : [...toTask.dependencies, fromId];
          const links = [...(toTask.dependencyLinks ?? []).filter(l => l.taskId !== fromId), { taskId: fromId, type: op.type, lagDays: op.lag }];
          patch(toId, { dependencies: deps, dependencyLinks: links });
          put({ op, ok: true }); break;
        }
        case 'removeDependency': {
          const to = resolve(op.to), from = resolve(op.from);
          if ('error' in to || 'error' in from) {
            put({ op, ok: false, reason: 'error' in to ? to.error : (from as { error: string }).error }); break;
          }
          const toTask = working.find(t => t.id === to.id)!;
          if (!toTask.dependencies.includes(from.id)) { put({ op, ok: false, reason: `“${toTask.title}” doesn't wait on that task` }); break; }
          patch(to.id, { dependencies: toTask.dependencies.filter(d => d !== from.id), dependencyLinks: (toTask.dependencyLinks ?? []).filter(l => l.taskId !== from.id) });
          put({ op, ok: true }); break;
        }
        case 'removeTask': {
          const id = refOr(op.task); if (!id) break;
          working = working.filter(t => t.id !== id).map(t => ({
            ...t,
            dependencies: t.dependencies.filter(d => d !== id),
            dependencyLinks: t.dependencyLinks?.filter(l => l.taskId !== id),
          }));
          put({ op, ok: true }); break;
        }
        case 'addTask': {
          // An `after` that names nothing is a FAILURE, not "the end of the
          // schedule with no dependency" reported as done.
          let anchorId: string | null = null;
          if (op.after) {
            const r = resolve(op.after);
            if ('error' in r) {
              const anchorFailed = failedAdds.has(op.after.trim().toLowerCase());
              failedAdds.add(op.title.trim().toLowerCase());
              put({ op, ok: false, reason: anchorFailed ? `“${op.title}” goes after “${op.after}”, which wasn't added` : r.error });
              break;
            }
            anchorId = r.id;
          }
          // Chain: a second add after the same ORIGINAL anchor goes after the
          // previous new task, in the order spoken. An explicit reference to a
          // task added earlier in the batch is honoured as written.
          let root: string | null = null;
          if (anchorId && !op.parallel) {
            root = rootOf.get(anchorId) ?? anchorId;
            if (anchorId === root && chainTail.has(root)) anchorId = chainTail.get(root)!;
          }
          const anchor = anchorId ? working.find(t => t.id === anchorId) : undefined;
          // No anchor: the card says "at the end", so start the working day
          // after the SCHEDULED finish. The last row's pin + duration it used
          // before sat mid-plan once any dependency push had moved later work
          // past its pin (the last row need not be the last to finish either).
          const startDay = anchor ? anchor.startDay + anchor.durationDays : dayAfterScheduledFinish(working, cpmOptions);
          const last = working[working.length - 1];
          const id = freshId();
          const t: ScheduleTask = {
            id, title: op.title, phase: (anchor ?? last)?.phase ?? 'General',
            durationDays: op.durationDays, startDay, progress: 0, crew: '',
            crewSize: op.crew, dependencies: anchorId ? [anchorId] : [], notes: '',
            status: 'not_started', isMilestone: op.isMilestone,
          };
          // Inserted work pushes what follows: the anchor's FS successors now
          // wait on the new task, so the ripple and the finish date are honest.
          // Not when he said it runs in parallel.
          if (anchorId && !op.parallel) {
            working = working.map(w => {
              if (w.id === id || !isFsSuccessorOf(w, anchorId!)) return w;
              const deps = w.dependencies.filter(d => d !== anchorId);
              if (!deps.includes(id)) deps.push(id);
              const links: DependencyLink[] | undefined = w.dependencyLinks
                ? w.dependencyLinks.map(l => (l.taskId === anchorId ? { ...l, taskId: id } : l))
                : undefined;
              return { ...w, dependencies: deps, dependencyLinks: links };
            });
            chainTail.set(root!, id);
            rootOf.set(id, root!);
          }
          const idx = anchor ? working.findIndex(x => x.id === anchor.id) + 1 : working.length;
          working = [...working.slice(0, idx), t, ...working.slice(idx)];
          addedByTitle.set(op.title.trim().toLowerCase(), id);
          put({ op, ok: true, anchorTitle: anchorId ? anchor?.title : undefined }); break;
        }
        case 'level': {
          // Applied via applyEditEffects (which has the CPM options); the
          // interpreter just marks it applied.
          put({ op, ok: true }); break;
        }
        default: put({ op, ok: false, reason: 'unknown op' });
      }
    } catch (e) {
      put({ op, ok: false, reason: (e as Error).message });
    }
  });

  // PASS 2 — moves. See placeMoves for the rule.
  working = placeMoves(ops, tasks, working, results, resolve, cpmOptions);
  return { nextTasks: working, results: results.map((r, i) => r ?? { op: ops[i], ok: false, reason: 'skipped' }) };
}

/** CPM, or null when it refuses the graph (a cycle the interpreter did not create). */
function cpmOrNull(tasks: ScheduleTask[], cpmOptions: RunCpmOptions): CpmResult | null {
  try {
    const r = runCpm(tasks, cpmOptions);
    return r.perTask.size === 0 && tasks.length > 0 ? null : r;
  } catch { return null; }
}

/** The working-day ordinal after the plan's SCHEDULED finish (max EF, the
 *  same number runCpm reports as projectFinish unless a target is pinned).
 *  Off CPM (a cycle it refuses), the latest pin + duration. */
function dayAfterScheduledFinish(tasks: ScheduleTask[], cpmOptions: RunCpmOptions): number {
  if (tasks.length === 0) return 1;
  const cpm = cpmOrNull(tasks, cpmOptions);
  if (!cpm) return Math.max(...tasks.map(t => t.startDay + t.durationDays));
  let ef = 0;
  cpm.perTask.forEach(r => { if (r.ef > ef) ef = r.ef; });
  return calendarIndexToWorkingOrdinal(Math.max(1, ef), cpmOptions) + 1;
}

/** Where a task is SCHEDULED to start, as a working-day ordinal (the unit a
 *  startDay pin and the grounding use). Falls back to the pin off CPM. */
function scheduledDay(cpm: CpmResult | null, t: ScheduleTask, cpmOptions: RunCpmOptions): number {
  const es = cpm?.perTask.get(t.id)?.es;
  return es === undefined ? t.startDay : calendarIndexToWorkingOrdinal(es, cpmOptions);
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Moves, in two simple rules (review round 4 — the rule before this one
 * failed review twice):
 *
 * 1. WHERE A MOVE COUNTS FROM. A stored startDay is only a floor; the task
 *    starts where CPM puts it, which after a dependency push can be weeks later
 *    than the pin (Schedule Pro never writes CPM starts back). So "push cabinets
 *    a week" counts from where cabinets is SCHEDULED — after every non-move op
 *    in the batch (the adds that pushed it) and BEFORE any other move in the
 *    batch. Counting from the pin refused a push behind a 3-task add ("waits on
 *    Insulation — shorten it"); counting from the batch-so-far pushed drywall
 *    +14 in "push framing, drywall and paint a week" (framing's ripple, then
 *    its own week). The pin is set to that target: a later pin can always be
 *    honoured, an earlier one only if nothing holds the task.
 *
 * 2. WHETHER IT LANDED — by where the task ENDS UP, not by whether its own pin
 *    was the binding constraint. One CPM of the tasks as he had them, one of
 *    the result: the move landed iff the task starts on the day asked for, or
 *    it moved in the direction asked for. Judging "did this pin bind" flagged
 *    the 2nd and 3rd of three chained +7 moves as "did nothing" (framing's
 *    ripple had already moved them) — "Understood 1 of 3" while all three
 *    moved, the founder's symptom again. A move that did not land has its pin
 *    put back, so nothing silent is written; putting pins back can only hold
 *    tasks later, so the check repeats until no more moves fail.
 */
function placeMoves(
  ops: EditOp[],
  original: ScheduleTask[],
  input: ScheduleTask[],
  results: (OpResult | undefined)[],
  resolve: (ref: string) => Resolved,
  cpmOptions: RunCpmOptions,
): ScheduleTask[] {
  const moveAt = ops.map((o, i) => (o.op === 'move' ? i : -1)).filter(i => i >= 0);
  if (moveAt.length === 0) return input;
  let working = input;
  const pinBefore = new Map(input.map(t => [t.id, t.startDay]));
  const origCpm = cpmOrNull(original, cpmOptions);
  const baseCpm = cpmOrNull(input, cpmOptions);
  const placed: { i: number; id: string; want: number; asked: number; from: number }[] = [];
  // The day each task was last asked for in THIS batch: "push framing 3 days,
  // then 2 more" compounds (1 → 6). Without it both counted from the batch's
  // start and the later move silently overrode the earlier one (1 → 3).
  const askedFor = new Map<string, number>();
  for (const i of moveAt) {
    const op = ops[i] as Extract<EditOp, { op: 'move' }>;
    const r = resolve(op.task);
    if ('error' in r) { results[i] = { op, ok: false, reason: r.error }; continue; }
    const cur = working.find(t => t.id === r.id)!;
    const base = askedFor.get(r.id) ?? scheduledDay(baseCpm, cur, cpmOptions);
    const asked = Math.max(1, Math.round(op.toStartDay != null ? op.toStartDay : base + (op.deltaDays ?? 0)));
    if (asked === base) { results[i] = { op, ok: false, reason: `“${cur.title}” already starts on day ${base}` }; continue; }
    const orig = original.find(t => t.id === r.id);
    const from = orig ? scheduledDay(origCpm, orig, cpmOptions) : base;
    const want = op.toStartDay != null ? sign(asked - from) : sign(op.deltaDays ?? 0);
    working = working.map(t => (t.id === r.id ? { ...t, startDay: asked } : t));
    askedFor.set(r.id, asked);
    placed.push({ i, id: r.id, want, asked, from });
  }
  const failed = new Set<number>();
  for (let round = 0; round <= placed.length; round++) {
    const now = cpmOrNull(working, cpmOptions);
    let newlyFailed = false;
    for (const m of placed) {
      if (failed.has(m.i)) continue;
      const task = working.find(t => t.id === m.id)!;
      // CPM refused the graph: the moves stand as interpreted and the diff
      // shows what CPM makes of them.
      const to = now ? scheduledDay(now, task, cpmOptions) : m.asked;
      const landed = to === m.asked || (m.want !== 0 && to !== m.from && sign(to - m.from) === m.want);
      const op = ops[m.i];
      if (landed) { results[m.i] = { op, ok: true, fromDay: m.from, toDay: to, askedDay: m.asked }; continue; }
      failed.add(m.i);
      newlyFailed = true;
      results[m.i] = { op, ok: false, reason: heldBy(task, working, now, to, m.asked < to, cpmOptions) };
      working = working.map(t => (t.id === m.id ? { ...t, startDay: pinBefore.get(m.id) ?? t.startDay } : t));
    }
    if (!newlyFailed) break;
  }
  return working;
}

/** Why a move did not land. "Shorten … or unlink it" is advice for a PULL held
 *  by a predecessor; a push that did not land gets a plain statement. */
function heldBy(task: ScheduleTask, tasks: ScheduleTask[], cpm: CpmResult | null, day: number, pull: boolean, cpmOptions: RunCpmOptions): string {
  if (pull && cpm) {
    let pred: ScheduleTask | undefined;
    let ef = -Infinity;
    for (const dep of task.dependencies) {
      const f = cpm.perTask.get(dep)?.ef;
      const t = tasks.find(x => x.id === dep);
      if (t && f !== undefined && f > ef) { ef = f; pred = t; }
    }
    if (pred) return `“${task.title}” waits on “${pred.title}” (finishes day ${calendarIndexToWorkingOrdinal(ef, cpmOptions)}) — shorten “${pred.title}” or unlink it`;
  }
  return `moving “${task.title}” doesn't change when it can start (day ${day})`;
}

/** Fold effects that need CPM (currently `level`) onto the task array after the
 *  pure interpreter runs. Lives here (not in the capability) so both the
 *  capability and ScheduleDiffView import it WITHOUT a cycle. Pure. */
export function applyEditEffects(ops: EditOp[], tasks: ScheduleTask[], cpmOptions: RunCpmOptions): ScheduleTask[] {
  let out = tasks;
  if (ops.some(o => o.op === 'level')) {
    const res = runCpm(out, { ...cpmOptions, levelResources: true });
    if (res.leveledStartDays) {
      const lvl = res.leveledStartDays;
      out = out.map(t => lvl.has(t.id) ? { ...t, startDay: lvl.get(t.id)! } : t);
    }
  }
  return out;
}
