// summaryRollup.ts — compute derived fields on summary (parent) tasks from
// their children. MAGE calls WBS hierarchy "stacks" in the UI, but the data
// model keeps `parentId` / `outlineLevel` / `isSummary` for clarity.
//
// What rolls up:
//   - startDay         = min(child.startDay)
//   - durationDays     = max(child.EF) − min(child.ES) + 1
//   - progress (0-100) = duration-weighted average of children
//
// What stays user-controlled on the summary row:
//   - title, phase, crew, notes, isMilestone, isSummary, parentId,
//     outlineLevel, collapsed, anchorType/anchorDate, deadline, resourceIds
//
// Call this BEFORE running CPM so the summary's own startDay/durationDays
// reflect what its children are actually doing. CPM treats summaries as
// ordinary nodes after that — their dependencies still flow through.
//
// If a summary has no children (e.g. newly inserted), we leave its own
// fields alone so the user isn't surprised by a 0-duration summary.

import type { ScheduleTask } from '@/types';

export function computeSummaryRollup(tasks: ScheduleTask[]): ScheduleTask[] {
  // Build parent→children index once.
  const childrenByParent = new Map<string, ScheduleTask[]>();
  for (const t of tasks) {
    if (t.parentId) {
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }
  }

  // Walk summaries in reverse outline-level order so deepest summaries
  // resolve before their own parents do. Fallback to 0 when outlineLevel
  // is missing.
  const summaries = tasks
    .filter(t => t.isSummary)
    .sort((a, b) => (b.outlineLevel ?? 0) - (a.outlineLevel ?? 0));

  // We mutate a working copy keyed by id so cascading rollups see updated
  // child dates during this pass.
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));

  for (const summary of summaries) {
    const kids = childrenByParent.get(summary.id) ?? [];
    const resolved = kids
      .map(k => byId.get(k.id))
      .filter((k): k is ScheduleTask => !!k);
    if (resolved.length === 0) continue;

    let minStart = Infinity;
    let maxEnd = -Infinity;
    let totalDur = 0;
    let weightedProgress = 0;
    for (const k of resolved) {
      const ks = Math.max(1, k.startDay || 1);
      const kd = Math.max(0, k.durationDays || 0);
      const kEnd = kd === 0 ? ks : ks + kd - 1;
      if (ks < minStart) minStart = ks;
      if (kEnd > maxEnd) maxEnd = kEnd;
      totalDur += kd;
      weightedProgress += (k.progress || 0) * kd;
    }

    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) continue;

    const rolled = byId.get(summary.id);
    if (!rolled) continue;
    rolled.startDay = minStart;
    rolled.durationDays = Math.max(0, maxEnd - minStart + 1);
    rolled.progress = totalDur > 0 ? Math.round(weightedProgress / totalDur) : 0;
    byId.set(summary.id, rolled);
  }

  // Preserve input order but emit the updated copies.
  return tasks.map(t => byId.get(t.id) ?? t);
}

/**
 * Returns the set of task ids that are children (direct OR transitive) of a
 * collapsed summary. UI can filter these out of the rendered row list.
 */
export function getHiddenTaskIds(tasks: ScheduleTask[]): Set<string> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const hidden = new Set<string>();
  // For every collapsed summary, walk its descendants and mark them hidden.
  for (const t of tasks) {
    if (t.isSummary && t.collapsed) {
      const stack: string[] = [t.id];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const child of tasks) {
          if (child.parentId === cur && !hidden.has(child.id)) {
            hidden.add(child.id);
            // If the child is itself a summary (collapsed or not), we still
            // want its subtree hidden since the parent is collapsed.
            stack.push(child.id);
          }
        }
      }
    }
  }
  void byId;
  return hidden;
}
