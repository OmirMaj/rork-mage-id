import type { ScheduleTask } from '@/types';

export type ZoneStatus = 'not_started' | 'in_progress' | 'done';
export interface ZoneState {
  status: ZoneStatus;
  plannedPct: number;        // 0–1, planned progress of the active trade as of the day
  activeTask: ScheduleTask | null;
}

const taskEnd = (t: ScheduleTask): number => (t.startDay ?? 0) + Math.max(1, t.durationDays || 1);

// Planned state of a zone as of `dayIndex` (days from schedule start), derived
// purely from the linked tasks' dates. A room moves through trades over time, so
// we surface the currently-active trade (latest-starting in-progress task).
export function zoneStateAsOf(linkedTasks: ScheduleTask[], dayIndex: number): ZoneState {
  if (linkedTasks.length === 0) return { status: 'not_started', plannedPct: 0, activeTask: null };

  const inProgress = linkedTasks.filter((t) => (t.startDay ?? 0) <= dayIndex && dayIndex < taskEnd(t));
  if (inProgress.length > 0) {
    const active = inProgress.reduce((a, b) => ((a.startDay ?? 0) >= (b.startDay ?? 0) ? a : b));
    const s = active.startDay ?? 0;
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
