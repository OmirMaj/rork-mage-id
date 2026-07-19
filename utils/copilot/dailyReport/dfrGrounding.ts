// utils/copilot/dailyReport/dfrGrounding.ts — grounding for the daily-report
// interview. Surfaces today's in-progress critical-path task so the report can
// move the schedule when saved (the DFR→schedule linkage). Best-effort + cheap.
import type { CopilotContext, Grounding } from '../types';
import type { ScheduleTask } from '@/types';

export async function buildDFRGrounding(c: CopilotContext): Promise<Grounding> {
  const project = c.project;
  const tasks: ScheduleTask[] = project?.schedule?.tasks ?? [];

  const inProgress = tasks.filter((t) => {
    const p = t.progress ?? 0;
    return p > 0 && p < 100;
  });
  // Prefer a critical-path task; fall back to any in-progress task.
  const crit = inProgress.find((t) => t.isCriticalPath) ?? inProgress[0];

  const facts: string[] = [];
  let criticalTask: { id: string; title: string; phase: string; progress: number } | undefined;
  if (crit) {
    criticalTask = { id: crit.id, title: crit.title, phase: crit.phase ?? 'General', progress: Math.round(crit.progress ?? 0) };
    facts.push(`${crit.title} is at ${criticalTask.progress}%${crit.isCriticalPath ? ' and on the critical path' : ''} today.`);
  }
  if (project?.name) facts.push(`Logging today's field report for ${project.name}.`);

  return { facts, data: { criticalTask } };
}
