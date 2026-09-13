// utils/copilot/scheduleEdit/applyToProjectSchedule.ts — pure. Reflow a schedule
// after a copilot/tap edit produced `editedTasks`, ready for updateProject on the
// classic mobile schedule (which reads task.startDay directly and does NOT re-run
// CPM at render). runCpm anchors each task's ES to its startDay floor and raises
// dependents; we write that ES back so successors visibly move. All other schedule
// fields are preserved. React/RN-free so the validator can drive it.
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { runCpm, calendarIndexToWorkingOrdinal, stampCriticalPath, type RunCpmOptions } from '@/utils/cpm';

export function applyToProjectSchedule(
  schedule: ProjectSchedule,
  editedTasks: ScheduleTask[],
  cpmOptions: RunCpmOptions,
): ProjectSchedule {
  const cpm = runCpm(editedTasks, cpmOptions);
  const tasks = editedTasks.map(t => {
    const r = cpm.perTask.get(t.id);
    // `r.es` is a CALENDAR INDEX; `startDay` is a WORKING ORDINAL (see "THE TWO
    // DAY-NUMBER SCALES" in utils/cpm.ts). Writing the index straight back made
    // the plan inflate by every weekend it already spanned on the very next
    // run, and each subsequent apply inflated it again. RunCpmOptions is a
    // superset of DayScaleOptions, so the same options convert it back.
    return r ? { ...t, startDay: calendarIndexToWorkingOrdinal(r.es, cpmOptions) } : t;
  });
  // Stamp the LIVE critical path too. `isCriticalPath` is a PERSISTED field the
  // client portal, the schedule PDF, the printable one-pager and the calendar
  // invite all read directly, and nothing but the AI generator (at creation)
  // ever wrote it — so a plan reflowed by the copilot kept shipping the model's
  // original guess. Same pass, same answer as the reflow above.
  return { ...schedule, tasks: stampCriticalPath(tasks, cpm) };
}
