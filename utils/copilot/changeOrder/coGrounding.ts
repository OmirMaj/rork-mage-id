// utils/copilot/changeOrder/coGrounding.ts — grounding for the change-order
// interview. Cites the current contract value so the new-total math is real.
import type { CopilotContext, Grounding } from '../types';

export async function buildCOGrounding(c: CopilotContext): Promise<Grounding> {
  const project = c.project;
  // The estimate grand total is the contract basis on a Project (there's no flat
  // Project.contractValue — that lives on ProjectContract).
  const contractValue = typeof project?.linkedEstimate?.grandTotal === 'number' ? project.linkedEstimate.grandTotal : 0;

  const facts: string[] = [];
  if (contractValue > 0) facts.push(`Current contract is $${contractValue.toLocaleString()} — the CO adjusts this total.`);
  if (project?.name) facts.push(`Change order for ${project.name}.`);

  return { facts, data: { contractValue } };
}
