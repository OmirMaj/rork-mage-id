// utils/copilot/scheduleEdit/applyToProjectSchedule.ts — pure. Reflow a schedule
// after a copilot/tap edit produced `editedTasks`, ready for updateProject on the
// classic mobile schedule (which reads task.startDay directly and does NOT re-run
// CPM at render). runCpm anchors each task's ES to its startDay floor and raises
// dependents; we write that ES back so successors visibly move. All other schedule
// fields are preserved. React/RN-free so the validator can drive it.
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { runCpm, type RunCpmOptions } from '@/utils/cpm';

export function applyToProjectSchedule(
  schedule: ProjectSchedule,
  editedTasks: ScheduleTask[],
  cpmOptions: RunCpmOptions,
): ProjectSchedule {
  const cpm = runCpm(editedTasks, cpmOptions);
  const tasks = editedTasks.map(t => {
    const r = cpm.perTask.get(t.id);
    return r ? { ...t, startDay: r.es } : t;
  });
  return { ...schedule, tasks };
}
