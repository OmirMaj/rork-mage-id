// utils/copilot/warranty/warrantyGrounding.ts — light grounding for the
// Warranty interview. Cites the project name + what's already tracked so the
// model doesn't re-log a duplicate and the contractor sees continuity.
import type { CopilotContext, Grounding } from '../types';
import { resolveWarrantyMonths } from '@/utils/paymentTerms';

export async function buildWarrantyGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Logging a warranty on ${c.project.name}.`);
  const existing = c.ctx?.getWarrantiesForProject?.(c.projectId) as { title?: string }[] | undefined;
  const titles = (existing ?? []).map((w) => w.title).filter(Boolean) as string[];
  if (titles.length) facts.push(`Already tracked: ${titles.slice(0, 6).join(', ')}.`);
  // His saved workmanship warranty grounds the general-workmanship term
  // (warrantyGaps.groundedWarrantyTerm) instead of a flat 12 months.
  const savedWarrantyMonths = resolveWarrantyMonths(c.ctx?.settings);
  if (savedWarrantyMonths) facts.push(`Your saved workmanship warranty is ${savedWarrantyMonths} months.`);
  return { facts, data: { count: titles.length, savedWarrantyMonths } };
}
