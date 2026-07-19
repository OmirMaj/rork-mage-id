// utils/copilot/punch/punchGrounding.ts — light grounding for the punch interview.
import type { CopilotContext, Grounding } from '../types';

export async function buildPunchGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Adding a punch item on ${c.project.name}.`);
  return { facts, data: {} };
}
