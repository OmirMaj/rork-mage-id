// utils/copilot/lead/leadGrounding.ts — light grounding for lead capture.
// A lead precedes any project, so there's little job history to lean on; we
// just note the pipeline size for continuity. Reads ProjectContext (ctx.ctx),
// which owns leads.
import type { CopilotContext, Grounding } from '../types';

export async function buildLeadGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  const leads = (c.ctx?.leads ?? []) as { stage?: string }[];
  const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length;
  if (open > 0) facts.push(`You have ${open} open lead${open === 1 ? '' : 's'} in the pipeline.`);
  return { facts, data: {} };
}
