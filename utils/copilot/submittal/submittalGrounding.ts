// utils/copilot/submittal/submittalGrounding.ts — light grounding for the
// submittal interview.
import type { CopilotContext, Grounding } from '../types';

export async function buildSubmittalGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Logging a submittal on ${c.project.name}.`);
  return { facts, data: {} };
}
