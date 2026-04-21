// Critical Path Method (CPM) engine for construction schedules.
//
// Purpose
// -------
// Given a set of tasks with dependencies (FS/SS/FF/SF + lag), compute:
//   1. Early Start (ES)  + Early Finish (EF)   — forward pass
//   2. Late Start  (LS)  + Late Finish  (LF)   — backward pass
//   3. Total Float  (TF)                        — LS − ES (= LF − EF)
//   4. Free Float   (FF)                        — slack before the next successor
//   5. Critical Path                            — tasks with TF ≤ 0
//   6. Resource Leveling                        — if two tasks share a crew and
//                                                 overlap, delay the one with
//                                                 more float. If both are on
//                                                 the critical path, the
//                                                 project end date slides and
//                                                 we surface the conflict.
//
// Why build this alongside scheduleEngine.ts rather than replacing it
// ------------------------------------------------------------------
// `recalculateStartDays` in scheduleEngine.ts is a forward-pass-only resolver.
// Lots of existing screens call it and expect the legacy mutation semantics
// (a task's startDay is PUSHED to meet its earliest constraint). This module
// is side-effect free: it takes tasks in, returns a `CpmResult`, and the
// caller decides whether to apply it. That keeps the old API working while
// the new UI (grid + drag Gantt) consumes the rich CPM output.
//
// Data model contract
// -------------------
// Days are integers, 1-indexed to match the rest of the codebase. A task that
// starts on day 1 with duration 5 has ES=1, EF=5 (inclusive end). A successor
// FS with lag 0 has ES = predecessor.EF + 1. The +1 is the convention the
// existing `recalculateStartDays` already uses — we preserve it so old data
// keeps laying out correctly.
//
//   FS (finish-to-start, default): S.ES ≥ P.EF + lag + 1
//   SS (start-to-start):           S.ES ≥ P.ES + lag
//   FF (finish-to-finish):         S.EF ≥ P.EF + lag  →  S.ES = S.EF − dur + 1
//   SF (start-to-finish, rare):    S.EF ≥ P.ES + lag  →  S.ES = S.EF − dur + 1
//
// (For SS/FF/SF the "+1" convention only applies where a finish meets a start.)

import type { ScheduleTask, DependencyLink } from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmTaskResult {
  id: string;
  es: number;          // early start (day number, 1-indexed)
  ef: number;          // early finish (day number, inclusive)
  ls: number;          // late start
  lf: number;          // late finish
  totalFloat: number;  // LS − ES  (also LF − EF). 0 or less → critical.
  freeFloat: number;   // slack before earliest successor starts slipping
  isCritical: boolean; // totalFloat ≤ 0
}

export interface CpmConflict {
  /** Machine-readable kind so the UI can show different icons / copy. */
  kind: 'cycle' | 'resource_overallocation' | 'resource_delayed_project';
  /** Short human-readable summary. */
  message: string;
  /** Task ids involved in the conflict. */
  taskIds: string[];
  /** Additional structured context for the UI (varies by kind). */
  detail?: Record<string, unknown>;
}

export interface CpmResult {
  /** Per-task CPM fields keyed by task.id. */
  perTask: Map<string, CpmTaskResult>;
  /** Absolute project start day (always 1 in the current model, kept for future). */
  projectStart: number;
  /** Project finish day — max EF across all tasks. */
  projectFinish: number;
  /** Tasks on the critical path, in topological order. */
  criticalPath: string[];
  /** Any DAG cycles, resource conflicts, or unreachable nodes detected. */
  conflicts: CpmConflict[];
  /**
   * Leveled startDays (only present when leveling ran). Callers apply these
   * back onto tasks if they want the engine to own scheduling. We return them
   * separately so the UI can preview / diff before committing.
   */
  leveledStartDays?: Map<string, number>;
}

export interface RunCpmOptions {
  /**
   * When true, delays tasks that share a crew and overlap with tasks that
   * have less float. Default false — leveling changes startDays, so it should
   * be opt-in (the grid view doesn't want it auto-running on every keystroke).
   */
  levelResources?: boolean;
  /**
   * If set, forces the project finish used for the backward pass. Otherwise
   * uses the max EF from the forward pass. Useful when the user has committed
   * to a contract end date and wants to see negative float on tasks that will
   * blow it.
   */
  targetFinishDay?: number;
}

// ---------------------------------------------------------------------------
// Dependency helpers (tolerant of the legacy `dependencies: string[]` shape)
// ---------------------------------------------------------------------------

/**
 * Normalize a task's dependency declarations. Supports the modern
 * `dependencyLinks` array (FS/SS/FF/SF + lag) and falls back to the legacy
 * `dependencies: string[]` which implies FS + 0 lag.
 */
function getLinks(task: ScheduleTask): DependencyLink[] {
  if (task.dependencyLinks && task.dependencyLinks.length > 0) {
    return task.dependencyLinks;
  }
  return (task.dependencies ?? []).map(id => ({
    taskId: id,
    type: 'FS' as const,
    lagDays: 0,
  }));
}

// ---------------------------------------------------------------------------
// Step 1: DAG validation
// ---------------------------------------------------------------------------
//
// Uses DFS with a 3-color marker (white/gray/black) so we can both detect a
// cycle and return the cycle nodes (handy for the UI to highlight). A gray
// node found during DFS means we're revisiting an ancestor → cycle.

export function detectCycles(tasks: ScheduleTask[]): CpmConflict[] {
  const idSet = new Set(tasks.map(t => t.id));
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  tasks.forEach(t => color.set(t.id, 'white'));

  const conflicts: CpmConflict[] = [];
  const parent = new Map<string, string | null>();

  const visit = (id: string): string[] | null => {
    color.set(id, 'gray');
    const task = tasks.find(t => t.id === id);
    if (!task) return null;

    for (const link of getLinks(task)) {
      // Silently skip dangling dep refs — the UI should flag those separately.
      if (!idSet.has(link.taskId)) continue;

      const c = color.get(link.taskId);
      if (c === 'gray') {
        // Found cycle. Walk parents back from `id` to `link.taskId` to
        // reconstruct the cycle path.
        const cycle: string[] = [link.taskId, id];
        let cur: string | null | undefined = parent.get(id);
        while (cur && cur !== link.taskId) {
          cycle.splice(1, 0, cur);
          cur = parent.get(cur);
        }
        return cycle;
      }
      if (c === 'white') {
        parent.set(link.taskId, id);
        const found = visit(link.taskId);
        if (found) return found;
      }
    }

    color.set(id, 'black');
    return null;
  };

  for (const t of tasks) {
    if (color.get(t.id) === 'white') {
      const cycle = visit(t.id);
      if (cycle) {
        conflicts.push({
          kind: 'cycle',
          message: `Dependency cycle detected through ${cycle.length} task(s). Remove one of the links to continue.`,
          taskIds: cycle,
          detail: { cycle },
        });
        // Don't keep hunting — the caller should fix one cycle at a time so
        // we're not spamming them with the same problem recolored.
        break;
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Step 2: Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topoSort(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const indegree = new Map<string, number>();
  const succList = new Map<string, string[]>();

  tasks.forEach(t => {
    indegree.set(t.id, 0);
    succList.set(t.id, []);
  });

  tasks.forEach(t => {
    for (const link of getLinks(t)) {
      if (!byId.has(link.taskId)) continue;
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      succList.get(link.taskId)!.push(t.id);
    }
  });

  const queue: string[] = [];
  indegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const out: ScheduleTask[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const s of succList.get(id) ?? []) {
      const nd = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, nd);
      if (nd === 0) queue.push(s);
    }
  }

  // If the graph has a cycle, out.length < tasks.length. We still return the
  // partial order — callers have already run detectCycles() and shown a
  // warning; the CPM math below will just skip unresolved tasks.
  return out;
}

// ---------------------------------------------------------------------------
// Step 3: Forward pass (ES, EF)
// ---------------------------------------------------------------------------
//
// We respect each task's own `startDay` as a MINIMUM constraint — the user
// may have pinned a task to start no earlier than a specific day (e.g. "crew
// arrives Monday"). The computed ES is max(dependency-required-start, pinned
// start, 1).

function forwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
): Map<string, { es: number; ef: number }> {
  const map = new Map<string, { es: number; ef: number }>();
  const byId = new Map(all.map(t => [t.id, t]));

  for (const task of ordered) {
    const links = getLinks(task);
    const pins = Math.max(1, task.startDay || 1);

    let es = pins;
    for (const link of links) {
      const dep = byId.get(link.taskId);
      if (!dep) continue;
      const depCpm = map.get(dep.id);
      if (!depCpm) continue;

      const lag = link.lagDays || 0;
      const type = (link.type || 'FS') as DepType;

      let required = es;
      switch (type) {
        case 'FS': required = depCpm.ef + lag + 1; break;
        case 'SS': required = depCpm.es + lag; break;
        case 'FF': required = depCpm.ef + lag - task.durationDays + 1; break;
        case 'SF': required = depCpm.es + lag - task.durationDays + 1; break;
      }
      if (required > es) es = required;
    }

    const dur = Math.max(0, task.durationDays || 0);
    const ef = dur === 0 ? es : es + dur - 1; // milestone: duration 0, ES=EF
    map.set(task.id, { es, ef });
  }

  return map;
}

// ---------------------------------------------------------------------------
// Step 4: Backward pass (LS, LF)
// ---------------------------------------------------------------------------
//
// For each task walking reverse-topological order: LF = min over successors
// of the constraint imposed by each link type + lag. Tasks with no successors
// (schedule leaves) have LF = projectFinish.

function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
): Map<string, { ls: number; lf: number }> {
  const byId = new Map(all.map(t => [t.id, t]));
  const result = new Map<string, { ls: number; lf: number }>();

  // Pre-compute successor list keyed by predecessor id.
  const successors = new Map<string, Array<{ succ: ScheduleTask; link: DependencyLink }>>();
  all.forEach(t => successors.set(t.id, []));
  all.forEach(t => {
    for (const link of getLinks(t)) {
      if (byId.has(link.taskId)) {
        successors.get(link.taskId)!.push({ succ: t, link });
      }
    }
  });

  // Walk the topo order in reverse.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const task = ordered[i];
    const fwd = forward.get(task.id);
    if (!fwd) continue;

    const dur = Math.max(0, task.durationDays || 0);
    const succs = successors.get(task.id) ?? [];

    // Default: no successors → LF is project finish.
    let lf = projectFinish;

    for (const { succ, link } of succs) {
      const succLate = result.get(succ.id);
      if (!succLate) continue;

      const lag = link.lagDays || 0;
      const type = (link.type || 'FS') as DepType;

      let thisLf = lf;
      switch (type) {
        // FS: succ.LS ≥ this.LF + lag + 1  → this.LF ≤ succ.LS − lag − 1
        case 'FS': thisLf = succLate.ls - lag - 1; break;
        // SS: succ.LS ≥ this.LS + lag      → this.LS ≤ succ.LS − lag
        //                                   this.LF = this.LS + dur − 1
        case 'SS': thisLf = (succLate.ls - lag) + Math.max(0, dur - 1); break;
        // FF: succ.LF ≥ this.LF + lag      → this.LF ≤ succ.LF − lag
        case 'FF': thisLf = succLate.lf - lag; break;
        // SF: succ.LF ≥ this.LS + lag      → this.LS ≤ succ.LF − lag
        case 'SF': thisLf = (succLate.lf - lag) + Math.max(0, dur - 1); break;
      }
      if (thisLf < lf) lf = thisLf;
    }

    const ls = dur === 0 ? lf : lf - dur + 1;
    result.set(task.id, { ls, lf });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 5: Free float
// ---------------------------------------------------------------------------
//
// Free float = how much this task can slip WITHOUT delaying ANY successor's
// early start. Computed only for FS links in this first pass — the other
// link types have messier "earliest successor impact" semantics and the
// pragmatic MS Project convention is to only surface TF for those.

function computeFreeFloat(
  tasks: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
): Map<string, number> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const successors = new Map<string, Array<{ succ: ScheduleTask; link: DependencyLink }>>();
  tasks.forEach(t => successors.set(t.id, []));
  tasks.forEach(t => {
    for (const link of getLinks(t)) {
      if (byId.has(link.taskId)) {
        successors.get(link.taskId)!.push({ succ: t, link });
      }
    }
  });

  const ff = new Map<string, number>();
  for (const task of tasks) {
    const fwd = forward.get(task.id);
    if (!fwd) { ff.set(task.id, 0); continue; }

    const succs = successors.get(task.id) ?? [];
    if (succs.length === 0) {
      // Leaf tasks — free float conventionally equals total float, but we set
      // it to 0 here and let the caller use TF if they need it for leaves.
      ff.set(task.id, 0);
      continue;
    }

    let minSucc = Infinity;
    for (const { succ, link } of succs) {
      const succFwd = forward.get(succ.id);
      if (!succFwd) continue;
      if ((link.type ?? 'FS') !== 'FS') continue;
      const lag = link.lagDays || 0;
      // succ.ES − lag − 1 is the latest this task can finish; − EF is slack.
      const slack = succFwd.es - lag - 1 - fwd.ef;
      if (slack < minSucc) minSucc = slack;
    }
    ff.set(task.id, minSucc === Infinity ? 0 : Math.max(0, minSucc));
  }
  return ff;
}

// ---------------------------------------------------------------------------
// Step 6: Resource leveling
// ---------------------------------------------------------------------------
//
// Simple single-resource-per-task leveling. Groups tasks by `assignedSubId`
// (falls back to `crew` string) and checks pairwise for calendar overlap.
// Where two tasks overlap, delays the one with MORE float. If neither has
// float, we report a `resource_delayed_project` conflict and push the
// less-critical one (tie-break by shorter duration first, then task id).
//
// Returns new startDays + any conflicts. Caller decides whether to commit.

interface LevelingContext {
  tasks: ScheduleTask[];
  cpm: Map<string, CpmTaskResult>;
}

function resourceKey(t: ScheduleTask): string | null {
  if (t.assignedSubId) return `sub:${t.assignedSubId}`;
  if (t.crew && t.crew.trim()) return `crew:${t.crew.trim().toLowerCase()}`;
  return null;
}

function levelResources(ctx: LevelingContext): { leveled: Map<string, number>; conflicts: CpmConflict[] } {
  const leveled = new Map<string, number>();
  ctx.tasks.forEach(t => leveled.set(t.id, t.startDay));
  const conflicts: CpmConflict[] = [];

  // Group by resource.
  const byResource = new Map<string, ScheduleTask[]>();
  for (const t of ctx.tasks) {
    const key = resourceKey(t);
    if (!key) continue;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key)!.push(t);
  }

  for (const [resKey, group] of byResource.entries()) {
    if (group.length < 2) continue;

    // Sort by current ES so we process calendar-left-to-right.
    const sorted = [...group].sort((a, b) => {
      const ae = ctx.cpm.get(a.id)?.es ?? a.startDay;
      const be = ctx.cpm.get(b.id)?.es ?? b.startDay;
      return ae - be;
    });

    // Sliding "busy until" cursor. When the next task would overlap, delay it.
    let busyUntil = -Infinity;
    let busyTaskId: string | null = null;

    for (const task of sorted) {
      const start = leveled.get(task.id) ?? task.startDay;
      const end = start + Math.max(0, (task.durationDays || 0) - 1);

      if (start <= busyUntil) {
        // Conflict. Decide whether to delay THIS task or the already-scheduled
        // one, based on which has more float. More float → can afford delay.
        const prev = ctx.cpm.get(busyTaskId!);
        const cur = ctx.cpm.get(task.id);
        const prevFloat = prev?.totalFloat ?? 0;
        const curFloat = cur?.totalFloat ?? 0;

        const delayThis = curFloat >= prevFloat;
        const delayedId = delayThis ? task.id : busyTaskId!;
        const newStart = busyUntil + 1;
        const delayedTask = delayThis ? task : ctx.tasks.find(x => x.id === busyTaskId!);

        if (delayedTask) {
          const origStart = leveled.get(delayedTask.id) ?? delayedTask.startDay;
          leveled.set(delayedTask.id, newStart);
          const delayedFloat = delayThis ? curFloat : prevFloat;
          const projectImpact = delayedFloat <= 0;

          conflicts.push({
            kind: projectImpact ? 'resource_delayed_project' : 'resource_overallocation',
            message: projectImpact
              ? `${delayedTask.title}: resource conflict with no float — delaying pushes the project end date by ${newStart - origStart} day(s).`
              : `${delayedTask.title}: delayed ${newStart - origStart} day(s) to free up "${delayedTask.crew || delayedTask.assignedSubName || 'resource'}".`,
            taskIds: [delayedId, delayThis ? busyTaskId! : task.id],
            detail: {
              resource: resKey,
              originalStart: origStart,
              newStart,
              floatConsumed: delayedFloat,
            },
          });

          // Update busy cursor based on which ended up last.
          const newEnd = newStart + Math.max(0, (delayedTask.durationDays || 0) - 1);
          if (newEnd > busyUntil) {
            busyUntil = newEnd;
            busyTaskId = delayedTask.id;
          }
          // If we delayed `prev`, `task` now owns the earlier slot.
          if (!delayThis) {
            busyUntil = end;
            busyTaskId = task.id;
          }
          continue;
        }
      }

      // No conflict, or we couldn't resolve it — this task takes the slot.
      if (end > busyUntil) {
        busyUntil = end;
        busyTaskId = task.id;
      }
    }
  }

  return { leveled, conflicts };
}

// ---------------------------------------------------------------------------
// One-call orchestration
// ---------------------------------------------------------------------------

export function runCpm(tasks: ScheduleTask[], options: RunCpmOptions = {}): CpmResult {
  const conflicts: CpmConflict[] = [];

  // 1. Cycle detection — bail early if found.
  const cycleConflicts = detectCycles(tasks);
  if (cycleConflicts.length > 0) {
    // Still return empty CPM so the UI can render the tasks; just flag it.
    return {
      perTask: new Map(),
      projectStart: 1,
      projectFinish: 1,
      criticalPath: [],
      conflicts: cycleConflicts,
    };
  }

  // 2. Topo sort.
  const ordered = topoSort(tasks);

  // 3. Forward pass.
  const forward = forwardPass(ordered, tasks);

  // 4. Project finish = max EF, unless caller pinned a target.
  let projectFinish = 1;
  forward.forEach(v => { if (v.ef > projectFinish) projectFinish = v.ef; });
  if (options.targetFinishDay && options.targetFinishDay > 0) {
    projectFinish = options.targetFinishDay;
  }

  // 5. Backward pass.
  const backward = backwardPass(ordered, tasks, forward, projectFinish);

  // 6. Free float.
  const freeFloat = computeFreeFloat(tasks, forward);

  // 7. Assemble per-task results.
  const perTask = new Map<string, CpmTaskResult>();
  for (const task of tasks) {
    const fwd = forward.get(task.id);
    const bwd = backward.get(task.id);
    if (!fwd || !bwd) continue;
    const tf = bwd.ls - fwd.es;
    perTask.set(task.id, {
      id: task.id,
      es: fwd.es,
      ef: fwd.ef,
      ls: bwd.ls,
      lf: bwd.lf,
      totalFloat: tf,
      freeFloat: freeFloat.get(task.id) ?? 0,
      isCritical: tf <= 0,
    });
  }

  // 8. Critical path in topo order.
  const criticalPath = ordered
    .map(t => perTask.get(t.id))
    .filter((r): r is CpmTaskResult => !!r && r.isCritical)
    .map(r => r.id);

  // 9. Optional resource leveling.
  let leveledStartDays: Map<string, number> | undefined;
  if (options.levelResources) {
    const { leveled, conflicts: resConflicts } = levelResources({ tasks, cpm: perTask });
    leveledStartDays = leveled;
    conflicts.push(...resConflicts);
  }

  return {
    perTask,
    projectStart: 1,
    projectFinish,
    criticalPath,
    conflicts,
    leveledStartDays,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the UI layer
// ---------------------------------------------------------------------------

/**
 * Annotates the tasks with their CPM results (isCriticalPath + optional
 * baseline-style fields). Non-destructive — returns a new array. The UI uses
 * this to render the critical-path highlight without threading CpmResult
 * through every component.
 */
export function applyCpmToTasks(tasks: ScheduleTask[], cpm: CpmResult): ScheduleTask[] {
  return tasks.map(t => {
    const r = cpm.perTask.get(t.id);
    if (!r) return t;
    return { ...t, isCriticalPath: r.isCritical };
  });
}

/**
 * Human-readable float summary for the grid's Float column.
 *   0       → "Critical"
 *   n > 0   → "3d slack"
 *   n < 0   → "-2d behind"
 */
export function formatFloat(totalFloat: number): string {
  if (totalFloat === 0) return 'Critical';
  if (totalFloat < 0) return `${totalFloat}d behind`;
  return `${totalFloat}d slack`;
}

/**
 * Returns true iff `candidateDepId` being added as a predecessor to `taskId`
 * would create a cycle. The grid's dependency editor uses this to reject bad
 * links before committing — MS Project's #1 gap (per your spec: "intuitive UI
 * that prevents fatal logic errors").
 */
export function wouldCreateCycle(
  tasks: ScheduleTask[],
  taskId: string,
  candidateDepId: string,
): boolean {
  if (taskId === candidateDepId) return true;

  // DFS from candidateDepId chasing its own predecessors. If we reach taskId,
  // adding this edge closes a loop.
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Set<string>();
  const stack = [candidateDepId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const task = byId.get(cur);
    if (!task) continue;
    for (const link of getLinks(task)) stack.push(link.taskId);
  }
  return false;
}
