// utils/copilot/billing/billingGrounding.ts — light grounding for the billing
// interview. Cites the contract basis so the draw reads as grounded.
import type { CopilotContext, Grounding } from '../types';

export async function buildBillingGrounding(c: CopilotContext): Promise<Grounding> {
  const project = c.project;
  const total = project?.linkedEstimate?.grandTotal;
  const facts: string[] = [];
  if (typeof total === 'number' && total > 0) facts.push(`Contract is $${total.toLocaleString()} — the draw bills against it.`);
  if (project?.name) facts.push(`Billing on ${project.name}.`);
  return { facts, data: {} };
}
