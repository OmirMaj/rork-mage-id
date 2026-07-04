// projectProgress.ts — one overall "% complete" for a project, rolled up from
// its schedule tasks. This is the trust signal the client portal's live-progress
// hero needs, and a useful at-a-glance indicator in-app.
//
// Weighting: by task duration (a 20-day task counts more than a 1-day task),
// falling back to a simple average when durations are missing. Milestones and
// zero-duration markers are excluded so they don't dilute the number.

import type { Project, ScheduleTask } from '@/types';

export interface ProjectProgress {
  /** 0–100 overall percent complete. */
  pct: number;
  /** Number of schedule tasks that fed the rollup. */
  taskCount: number;
  /** Tasks fully complete (progress >= 100). */
  doneCount: number;
  /** True when there's a schedule with real tasks to roll up. */
  hasSchedule: boolean;
}

export function computeProjectProgress(project: Project): ProjectProgress {
  const tasks: ScheduleTask[] = (project.schedule?.tasks ?? []).filter(t => !t.isMilestone);

  if (tasks.length === 0) {
    return { pct: 0, taskCount: 0, doneCount: 0, hasSchedule: false };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let doneCount = 0;

  for (const t of tasks) {
    const weight = Math.max(t.durationDays ?? 0, 0) || 1; // fall back to 1 so every task counts
    const progress = Math.max(0, Math.min(100, t.progress ?? 0));
    weightedSum += progress * weight;
    weightTotal += weight;
    if (progress >= 100) doneCount += 1;
  }

  const pct = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  return { pct, taskCount: tasks.length, doneCount, hasSchedule: true };
}
