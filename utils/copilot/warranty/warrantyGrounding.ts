// utils/copilot/warranty/warrantyGrounding.ts — light grounding for the
// Warranty interview. Cites the project name + what's already tracked so the
// model doesn't re-log a duplicate and the contractor sees continuity.
import type { CopilotContext, Grounding } from '../types';

export async function buildWarrantyGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Logging a warranty on ${c.project.name}.`);
  const existing = c.ctx?.getWarrantiesForProject?.(c.projectId) as { title?: string }[] | undefined;
  const titles = (existing ?? []).map((w) => w.title).filter(Boolean) as string[];
  if (titles.length) facts.push(`Already tracked: ${titles.slice(0, 6).join(', ')}.`);
  return { facts, data: { count: titles.length } };
}
