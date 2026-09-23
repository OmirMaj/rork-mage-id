// utils/copilot/scheduleEdit/scheduleEditGrounding.ts — the CURRENT schedule IS
// the grounding for an edit (no history lookup). Serializes the live tasks +
// finish date so the model can resolve references and reason about the change.
import type { CopilotContext, Grounding } from '../types';
import { runCpm, calendarIndexToWorkingOrdinal } from '@/utils/cpm';

export async function buildScheduleEditGrounding(c: CopilotContext): Promise<Grounding> {
  const tasks = c.currentTasks ?? [];
  const cpm = runCpm(tasks, c.cpmOptions ?? {});
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Editing the schedule for ${c.project.name}.`);
  facts.push(`${tasks.length} tasks; current finish is day ${cpm.projectFinish}.`);
  // The SCHEDULED start (CPM early start as a working-day ordinal), not the
  // stored startDay pin: Schedule Pro never writes CPM starts back, so after a
  // dependency push the pin can be weeks behind the Gantt, and a "move to day
  // N" worked out from it named a day he never sees (review round 4). The same
  // number interpretOps counts a move from.
  const list = tasks.map(t => {
    const r = cpm.perTask.get(t.id);
    const crit = r?.isCritical ? ' [critical]' : '';
    const start = r ? calendarIndexToWorkingOrdinal(r.es, c.cpmOptions ?? {}) : t.startDay;
    return `- ${t.id} "${t.title}" start day ${start}, ${t.durationDays}d${crit}`;
  });
  return { facts, data: { taskList: list, finishDay: cpm.projectFinish } };
}
