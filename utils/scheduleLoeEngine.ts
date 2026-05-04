// scheduleLoeEngine — Level-of-Effort (LOE) span resolver.
//
// LOE tasks (P6/Asta call them "Hammock") auto-stretch from earliest
// predecessor start to latest successor finish. Useful for "Site
// Supervision," "PM Overhead," "GC General Conditions" — overhead
// activities that should always cover the linked work span.
//
// Implementation: post-process after CPM. Caller runs `runCpm(tasks)`,
// then optionally calls `applyLevelOfEffortSpans(tasks, cpm)` to get a
// new `ScheduleTask[]` with LOE tasks' startDay + durationDays adjusted.
// The CPM result itself stays untouched — re-run CPM on the materialized
// tasks if you need their downstream effects.

import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

/**
 * Walk every LOE task. For each, find:
 *   - earliestStart = min(ES of predecessors)
 *   - latestFinish  = max(EF of successors)
 * Then set the LOE task to span [earliestStart, latestFinish]. If the
 * task has no linked predecessors, it falls back to its authored start.
 * Same for missing successors → falls back to authored duration.
 */
export function applyLevelOfEffortSpans(
  tasks: ScheduleTask[],
  cpm: CpmResult,
): ScheduleTask[] {
  // Index successors per task id for fast lookup.
  const successorMap = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.dependencies ?? []) {
      const arr = successorMap.get(dep) ?? [];
      arr.push(t.id);
      successorMap.set(dep, arr);
    }
  }

  return tasks.map(t => {
    if (!t.isLevelOfEffort || t.isSummary) return t;

    let earliestStart: number | undefined;
    let latestFinish: number | undefined;

    // Earliest predecessor ES.
    for (const depId of t.dependencies ?? []) {
      const depResult = cpm.perTask.get(depId);
      if (!depResult) continue;
      if (earliestStart === undefined || depResult.es < earliestStart) {
        earliestStart = depResult.es;
      }
    }

    // Latest successor EF.
    for (const succId of successorMap.get(t.id) ?? []) {
      const succResult = cpm.perTask.get(succId);
      if (!succResult) continue;
      if (latestFinish === undefined || succResult.ef > latestFinish) {
        latestFinish = succResult.ef;
      }
    }

    // No linked work — leave authored values.
    if (earliestStart === undefined && latestFinish === undefined) {
      return t;
    }

    const newStart = earliestStart ?? t.startDay;
    const computedFinish = latestFinish ?? (t.startDay + t.durationDays - 1);
    const newDuration = Math.max(1, computedFinish - newStart + 1);

    if (newStart === t.startDay && newDuration === t.durationDays) return t;
    return { ...t, startDay: newStart, durationDays: newDuration };
  });
}

/** Detect whether a tasks list has any LOE activities — caller uses this
 *  to skip the post-process when no LOE tasks exist (cheap optimization). */
export function hasAnyLevelOfEffort(tasks: ScheduleTask[]): boolean {
  return tasks.some(t => t.isLevelOfEffort);
}
