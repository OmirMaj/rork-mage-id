// utils/copilot/hazard/hazardGrounding.ts — light grounding for hazard
// observations. Notes the project + how many hazards are still open so the
// contractor sees the running exposure. Reads SafetyContext (ctx.safety).
import type { CopilotContext, Grounding } from '../types';

export async function buildHazardGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Logging a hazard on ${c.project.name}.`);
  const existing = (c.safety?.getHazardsForProject?.(c.projectId) ?? []) as { status?: string }[];
  const open = existing.filter((h) => h.status !== 'closed' && h.status !== 'mitigated').length;
  if (open > 0) facts.push(`${open} hazard${open === 1 ? '' : 's'} still open on this job.`);
  return { facts, data: {} };
}
