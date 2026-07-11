// utils/outlineOps.ts — pure outline/reorder ops on the task array. No React, no I/O.
// Task order is array position; hierarchy is parentId + outlineLevel.
import type { ScheduleTask } from '../types';

/** Indent a task under the immediately-preceding row (its new parent), +1 level.
 *  No-op if the task is the first row (nothing to parent under). */
export function indentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  const i = tasks.findIndex(t => t.id === id);
  if (i <= 0) return tasks;
  const parent = tasks[i - 1];
  return tasks.map(t => t.id === id
    ? { ...t, parentId: parent.id, outlineLevel: (parent.outlineLevel ?? 0) + 1 }
    : t);
}

/** Outdent a task one level (clears parent when returning to level 0). */
export function outdentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  return tasks.map(t => {
    if (t.id !== id) return t;
    const next = Math.max(0, (t.outlineLevel ?? 0) - 1);
    return { ...t, outlineLevel: next, parentId: next === 0 ? undefined : t.parentId };
  });
}

/** Move a task by delta rows (-1 up, +1 down), clamped to array bounds. */
export function moveTask(tasks: ScheduleTask[], id: string, delta: number): ScheduleTask[] {
  const i = tasks.findIndex(t => t.id === id);
  if (i < 0) return tasks;
  const j = i + delta;
  if (j < 0 || j >= tasks.length) return tasks;
  const next = tasks.slice();
  const [row] = next.splice(i, 1);
  next.splice(j, 0, row);
  return next;
}
