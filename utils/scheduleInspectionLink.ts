// utils/scheduleInspectionLink.ts — links Permit inspection results
// to the schedule. When a permit transitions to `inspection_passed`,
// any task with a matching `requiresInspection` value gets surfaced
// as "ready to start" so the GC can advance dependent work.
//
// Why a soft signal vs. an automatic schedule mutation:
//   The audit's super-persona request was "inspection passing should
//   unblock dependent tasks." The naive read is "remove the predecessor
//   automatically." That's wrong — task dependencies are sequencing
//   logic, not authorization gates. Removing them would hide the real
//   schedule structure from CPM. The right model: surface the
//   "ready" signal as an annotation, let the GC choose to start the
//   task (which they were going to do anyway).
//
// What this gives the GC:
//   - `findInspectionUnblockedTasks(...)` returns the list of tasks
//     whose required-inspection permit just passed. Surfaces in
//     project-detail's permit modal as "Foundation passed inspection
//     today — 3 tasks ready to start: Slab pour, Wall framing, …".
//   - `taskIsBlockedByInspection(...)` is a per-task lookup the
//     schedule grid + Gantt can use to render a small chip.

import type { Permit, PermitType, ScheduleTask } from '@/types';

/**
 * For a given permit (typically the most-recently-updated permit),
 * return the list of tasks that:
 *   - Have a `requiresInspection` matching the permit's type
 *   - Are not yet started (status !== 'in_progress' / 'done')
 *   - Belong to the same project
 * Pair with the permit's status === 'inspection_passed' to get the
 * "ready to start" set. When the permit hasn't passed yet, this
 * returns the BLOCKED set instead — same shape, different intent.
 */
export function findTasksTiedToPermit(opts: {
  permit: Permit;
  tasks: ScheduleTask[];
}): ScheduleTask[] {
  const { permit, tasks } = opts;
  if (!permit.type) return [];
  return tasks.filter(t => {
    if (!t.requiresInspection) return false;
    if (t.requiresInspection !== permit.type) return false;
    return true;
  });
}

/**
 * Convenience for the project-detail Permits modal: tasks the GC can
 * start NOW because their required inspection just passed. Excludes
 * tasks already in progress / done.
 */
export function findInspectionUnblockedTasks(opts: {
  permit: Permit;
  tasks: ScheduleTask[];
}): ScheduleTask[] {
  const { permit } = opts;
  if (permit.status !== 'inspection_passed') return [];
  return findTasksTiedToPermit(opts).filter(t =>
    t.status !== 'in_progress' && t.status !== 'done',
  );
}

/**
 * Per-task lookup: is this task currently blocked by a pending or
 * failed inspection? Used by the schedule grid + Gantt to render a
 * "🛑 Awaiting <type> inspection" chip in the task row.
 *
 * Returns null when the task has no inspection requirement OR when
 * the matching permit has passed. Returns the permit when the task
 * is blocked.
 */
export function taskIsBlockedByInspection(opts: {
  task: ScheduleTask;
  permits: Permit[];
}): Permit | null {
  const { task, permits } = opts;
  if (!task.requiresInspection) return null;
  // Find the permit for this project + type. Prefer the most-recently
  // updated row when multiple match (a re-issue).
  const candidates = permits
    .filter(p => p.type === task.requiresInspection)
    .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? '0') - Date.parse(a.updatedAt ?? a.createdAt ?? '0'));
  const latest = candidates[0];
  if (!latest) {
    // Required-inspection set on the task but no matching permit
    // exists yet — the GC hasn't applied. Treat as blocked-without-
    // permit; UI shows "No <type> permit applied yet."
    return {
      id: 'pending-permit',
      projectId: task.id,
      projectName: '',
      type: task.requiresInspection as PermitType,
      jurisdiction: '',
      status: 'applied',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Permit;
  }
  if (latest.status === 'inspection_passed') return null;
  return latest;
}

/**
 * Bulk version of `taskIsBlockedByInspection`. Returns a Map keyed
 * by task.id → blocking Permit. Cheap to recompute — the schedule
 * screen calls this once per render.
 */
export function buildInspectionBlockMap(opts: {
  tasks: ScheduleTask[];
  permits: Permit[];
}): Map<string, Permit> {
  const out = new Map<string, Permit>();
  for (const t of opts.tasks) {
    const blocker = taskIsBlockedByInspection({ task: t, permits: opts.permits });
    if (blocker) out.set(t.id, blocker);
  }
  return out;
}
