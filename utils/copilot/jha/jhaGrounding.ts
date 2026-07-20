// utils/copilot/jha/jhaGrounding.ts — light grounding for the JHA interview.
// Cites the project + any JHAs already on file so the model can stay consistent
// with how this crew names its analyses. Reads SafetyContext via ctx.safety.
import type { CopilotContext, Grounding } from '../types';

export async function buildJHAGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Writing a job hazard analysis on ${c.project.name}.`);
  const existing = (c.safety?.getJhasForProject?.(c.projectId) ?? []) as { title?: string }[];
  const titles = existing.map((j) => j.title).filter(Boolean) as string[];
  if (titles.length) facts.push(`Already on file: ${titles.slice(0, 5).join(', ')}.`);
  return { facts, data: {} };
}
