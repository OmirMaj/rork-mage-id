// utils/copilot/safety/safetyGrounding.ts — light grounding for the safety
// incident interview.
import type { CopilotContext, Grounding } from '../types';

export async function buildSafetyGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Logging a safety incident on ${c.project.name}.`);
  return { facts, data: {} };
}
