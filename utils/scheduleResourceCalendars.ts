// scheduleResourceCalendars — resolve which working calendar applies to
// a task. P6 has Global / Project / Resource calendars; we model
// Project (the schedule's nonWorkingDates + workingDaysPerWeek) and
// optional Resource overrides.
//
// Resolution rules:
//   1. If a task has resourceIds, use the first resource's calendar
//      (if it has one).
//   2. Otherwise fall back to the project calendar.
// The CPM engine is calendar-aware via `addWorkingDays`; this util
// provides the right (workingDaysPerWeek, closures) inputs to that.

import type {
  ScheduleTask, ProjectSchedule, ResourceCalendar, ProjectResource,
} from '@/types';

export interface ResolvedCalendar {
  workingDaysPerWeek: number;
  workingDaysOfWeek?: number[];
  closures: string[];
  /** What we resolved to — for UI badges showing "follows: Drywall calendar". */
  source: 'project' | { resourceId: string; calendarKey: string };
}

export function resolveCalendarForTask(
  task: ScheduleTask,
  schedule: ProjectSchedule,
): ResolvedCalendar {
  const projectCalendar: ResolvedCalendar = {
    workingDaysPerWeek: schedule.workingDaysPerWeek ?? 5,
    closures: schedule.nonWorkingDates ?? [],
    source: 'project',
  };

  if (!task.resourceIds || task.resourceIds.length === 0) return projectCalendar;
  if (!schedule.resources || !schedule.resourceCalendars) return projectCalendar;

  const resources = new Map<string, ProjectResource>(
    schedule.resources.map(r => [r.id, r]),
  );
  const calendars = new Map<string, ResourceCalendar>(
    schedule.resourceCalendars.map(c => [c.key, c]),
  );

  for (const rId of task.resourceIds) {
    const resource = resources.get(rId);
    if (!resource?.calendarKey) continue;
    const cal = calendars.get(resource.calendarKey);
    if (!cal) continue;
    return {
      workingDaysPerWeek: cal.workingDaysPerWeek,
      workingDaysOfWeek: cal.workingDaysOfWeek,
      // Resource closures supplement, not replace, project closures.
      closures: [
        ...(schedule.nonWorkingDates ?? []),
        ...(cal.closures ?? []),
      ],
      source: { resourceId: rId, calendarKey: cal.key },
    };
  }

  return projectCalendar;
}

/** Pretty label for the resolved calendar — used in TaskInspector. */
export function describeResolvedCalendar(c: ResolvedCalendar, schedule: ProjectSchedule): string {
  if (c.source === 'project') return `Project calendar (${c.workingDaysPerWeek}-day week)`;
  const calendarKey = c.source.calendarKey;
  const cal = (schedule.resourceCalendars ?? []).find(rc => rc.key === calendarKey);
  return cal ? `${cal.name} (${cal.workingDaysPerWeek}-day week)` : 'Resource calendar';
}
