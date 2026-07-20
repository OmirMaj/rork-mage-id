// utils/copilot/scheduleEdit/scheduleEditGrounding.ts — the CURRENT schedule IS
// the grounding for an edit (no history lookup). Serializes the live tasks +
// finish date so the model can resolve references and reason about the change.
import type { CopilotContext, Grounding } from '../types';
import { runCpm } from '@/utils/cpm';

export async function buildScheduleEditGrounding(c: CopilotContext): Promise<Grounding> {
  const tasks = c.currentTasks ?? [];
  const cpm = runCpm(tasks, c.cpmOptions ?? {});
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Editing the schedule for ${c.project.name}.`);
  facts.push(`${tasks.length} tasks; current finish is day ${cpm.projectFinish}.`);
  const list = tasks.map(t => {
    const crit = cpm.perTask.get(t.id)?.isCritical ? ' [critical]' : '';
    return `- ${t.id} "${t.title}" start day ${t.startDay}, ${t.durationDays}d${crit}`;
  });
  return { facts, data: { taskList: list, finishDay: cpm.projectFinish } };
}
