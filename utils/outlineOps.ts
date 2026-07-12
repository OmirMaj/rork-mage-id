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

/** Outdent a task one level. Reparents to the current parent's parent (the
 *  grandparent) so `parentId` and `outlineLevel` stay consistent, and clears
 *  the parent entirely at level 0. No-op (same array reference) when the task
 *  is already top-level — lets the caller's undo/redo guard skip a phantom step. */
export function outdentTask(tasks: ScheduleTask[], id: string): ScheduleTask[] {
  const target = tasks.find(t => t.id === id);
  if (!target || (target.outlineLevel ?? 0) === 0) return tasks; // already top-level
  const nextLevel = (target.outlineLevel ?? 0) - 1;
  const parent = target.parentId ? tasks.find(t => t.id === target.parentId) : undefined;
  const nextParentId = nextLevel === 0 ? undefined : parent?.parentId;
  return tasks.map(t => t.id === id ? { ...t, outlineLevel: nextLevel, parentId: nextParentId } : t);
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
