// utils/copilot/rfi/rfiGrounding.ts — light grounding for the RFI interview.
import type { CopilotContext, Grounding } from '../types';

export async function buildRFIGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Raising an RFI on ${c.project.name}.`);
  return { facts, data: {} };
}
