// utils/floatExplain.ts — pure plain-language explanation of CPM float. No React, no I/O.
import type { ScheduleTask } from '../types';
import type { CpmResult } from './cpm';

/**
 * Plain-language slack phrase for a task's total float.
 *
 * `totalFloat` is WORKING days on the task's own calendar (utils/cpm.ts routes
 * it through workingDaysBetween). It used to be a raw calendar-index
 * subtraction, so this sentence — the headline promise a GC reads before
 * pulling a crew onto another job for the week — said "Can slip 6 days" about a
 * task that could really slip 4.
 */
export function floatPhrase(totalFloat: number): string {
  if (totalFloat <= 0) return 'On the critical path — no slack';
  return `Can slip ${totalFloat} ${totalFloat === 1 ? 'day' : 'days'}`;
}

export interface CriticalPathExplanation {
  /**
   * Project finish as a CALENDAR day index (day 1 = the schedule's start date).
   * Render it as a DATE — "day 33" means nothing to the client the PM opened
   * this panel to explain the schedule to.
   */
  finishDay: number;
  /**
   * The critical work, grouped into ACTUAL chains.
   *
   * `cpm.criticalPath` is a SET, not a path: the engine returns every task with
   * zero float, in topological order, and a real network routinely has two or
   * more branches that are simultaneously critical (utils/cpm.ts says so in its
   * own header). Rendering that set as one arrow-linked list drew
   * "Excavate → Order steel → Pour footings" as if steel waited on excavation
   * when the two run side by side — a PM reading it would crash the wrong task.
   *
   * Each entry here is one chain of critical tasks actually linked to each
   * other, in dependency order. Two parallel branches come back as two arrays,
   * and the panel draws arrows only WITHIN an array. Longest chain first — it
   * is the one that most plausibly reads as "the" critical path.
   */
  criticalChains: { id: string; title: string }[][];
  /** Every critical task, flattened, in `cpm.criticalPath` order. Kept because
   *  several callers only need the membership question. */
  criticalTitles: { id: string; title: string }[];
  slack: { id: string; title: string; canSlipDays: number }[];
}

/** Build a plain-language explanation from an already-computed CPM result. */
export function buildCriticalPathExplanation(cpm: CpmResult, tasks: ScheduleTask[]): CriticalPathExplanation {
  const byId = new Map(tasks.map(t => [t.id, t]));
  // Summary rows are excluded. They are WBS containers whose span is rolled up
  // from their own children, so leaving them in drew the chain as
  // "Framing → Frame walls → Frame roof → Drywall" — a parent and its own
  // children rendered as sequential links, which is not a path through
  // anything. utils/scheduleReportModel.ts has always filtered them, so the
  // printed report and this on-screen panel disagreed about what the critical
  // path contained.
  const criticalTitles = cpm.criticalPath
    .filter(id => {
      const t = byId.get(id);
      // An id with no task behind it is kept (falls back to the raw id below)
      // rather than silently dropped — losing a link is worse than showing one.
      return !t || !t.isSummary;
    })
    .map(id => ({ id, title: byId.get(id)?.title ?? id }));

  // ── Group the critical SET into real chains ───────────────────────────────
  // Union-find over the dependency edges that join two critical tasks. Nodes in
  // the same component are genuinely linked; separate components are parallel
  // branches and must not be joined by an arrow.
  const criticalIds = new Set(criticalTitles.map(x => x.id));
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) { const p = parent.get(r)!; parent.set(r, parent.get(p)!); r = p; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const id of criticalIds) parent.set(id, id);
  for (const id of criticalIds) {
    const t = byId.get(id);
    if (!t) continue;
    const preds = (t.dependencyLinks && t.dependencyLinks.length > 0)
      ? t.dependencyLinks.map(l => l.taskId)
      : (t.dependencies ?? []);
    for (const pid of preds) {
      // A summary parent was filtered out of the chain above; joining through
      // it would re-introduce exactly the parent-as-a-link defect.
      if (criticalIds.has(pid)) union(id, pid);
    }
  }
  const groups = new Map<string, { id: string; title: string }[]>();
  for (const entry of criticalTitles) {
    // criticalTitles is already in cpm.criticalPath (topological) order, so
    // pushing in sequence keeps each chain in dependency order.
    const root = find(entry.id);
    const arr = groups.get(root);
    if (arr) arr.push(entry); else groups.set(root, [entry]);
  }
  const criticalChains = [...groups.values()].sort((a, b) => b.length - a.length);

  const slack = tasks
    .map(t => ({ t, r: cpm.perTask.get(t.id) }))
    .filter(({ t, r }) => !!r && !r.isCritical && r.totalFloat > 0 && !t.isSummary)
    .map(({ t, r }) => ({ id: t.id, title: t.title, canSlipDays: r!.totalFloat }))
    .sort((a, b) => a.canSlipDays - b.canSlipDays)
    .slice(0, 20);
  return { finishDay: cpm.projectFinish, criticalChains, criticalTitles, slack };
}
