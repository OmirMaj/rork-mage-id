// utils/copilot/permit/permitGrounding.ts — light grounding for the Permit
// interview. Notes the project + permits already on file so the model stays
// consistent and the contractor sees continuity. Reads ProjectContext (ctx.ctx).
import type { CopilotContext, Grounding } from '../types';

export async function buildPermitGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Logging a permit on ${c.project.name}.`);
  if (c.project?.location) facts.push(`Job is in ${c.project.location}.`);
  const existing = (c.ctx?.getPermitsForProject?.(c.projectId) ?? []) as { type?: string }[];
  if (existing.length) facts.push(`Already on file: ${existing.length} permit${existing.length === 1 ? '' : 's'}.`);
  return { facts, data: { location: c.project?.location ?? null } };
}
