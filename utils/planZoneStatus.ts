import type { ScheduleTask } from '@/types';

export type ZoneStatus = 'not_started' | 'in_progress' | 'done';
export interface ZoneState {
  status: ZoneStatus;
  plannedPct: number;        // 0–1, planned progress of the active trade as of the day
  activeTask: ScheduleTask | null;
}

// startDay is 1-indexed (matches the CPM engine + desktop + mobile Gantt).
// `dayIndex` is a 0-indexed day offset from schedule start, so shift startDay
// down by one before comparing.
const startOffset = (t: ScheduleTask): number => (t.startDay ?? 1) - 1;
const taskEnd = (t: ScheduleTask): number => startOffset(t) + Math.max(1, t.durationDays || 1);

// Planned state of a zone as of `dayIndex` (days from schedule start), derived
// purely from the linked tasks' dates. A room moves through trades over time, so
// we surface the currently-active trade (latest-starting in-progress task).
export function zoneStateAsOf(linkedTasks: ScheduleTask[], dayIndex: number): ZoneState {
  if (linkedTasks.length === 0) return { status: 'not_started', plannedPct: 0, activeTask: null };

  const inProgress = linkedTasks.filter((t) => startOffset(t) <= dayIndex && dayIndex < taskEnd(t));
  if (inProgress.length > 0) {
    const active = inProgress.reduce((a, b) => (startOffset(a) >= startOffset(b) ? a : b));
    const s = startOffset(active);
    const dur = Math.max(1, active.durationDays || 1);
    return { status: 'in_progress', plannedPct: Math.max(0, Math.min(1, (dayIndex - s) / dur)), activeTask: active };
  }

  const done = linkedTasks.filter((t) => taskEnd(t) <= dayIndex);
  if (done.length > 0) {
    const last = done.reduce((a, b) => (taskEnd(a) >= taskEnd(b) ? a : b));
    return { status: 'done', plannedPct: 1, activeTask: last };
  }
  return { status: 'not_started', plannedPct: 0, activeTask: null };
}
