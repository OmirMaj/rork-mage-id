// utils/estimateReviewer.ts — "did you forget X?" AI pass over a
// project's linked estimate. Buildxact's Blu charges +$149/mo for an
// equivalent feature; we ship it bundled in Pro tier.
//
// What it does:
//   1. Sends the project's metadata + every line item to the
//      mageAI smart-tier model.
//   2. Asks for a structured response: missing trades, missing
//      common line items per trade, suggested allowances, and
//      compliance / OH&P sanity checks.
//   3. Returns the structured response — UI surfaces it as a
//      checklist of suggestions the GC can accept (adds them to the
//      estimate) or dismiss.
//
// Why structured vs. free-text:
//   - Free-text "advice" reads as preachy and is hard to action.
//   - Structured items can be applied with one tap, building real
//     trust as the user sees the AI catch real things.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Project } from '@/types';

const reviewerSchema = z.object({
  /** 0-100. Higher = more complete-looking. Surfaces as a small
   *  badge on the result card so the GC has a "you're 88% there"
   *  signal before reading the suggestions. */
  completenessScore: z.number().default(0),
  /** Confidence in the analysis (model's own self-rating). Low
   *  confidence triggers a "we're not sure — review carefully"
   *  banner instead of blue/green check chips. */
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  /** One-sentence summary, suitable for the result card hero text. */
  summary: z.string().default(''),
  /** Trades the model expects to be present given the project's
   *  type/scope but didn't see in the line items. Each entry is an
   *  actionable suggestion ("Add Plumbing rough-in for kitchen
   *  reno"). */
  missingTrades: z.array(z.object({
    trade: z.string(),
    rationale: z.string(),
    estimatedCost: z.number().nullable().optional(),
  })).default([]),
  /** Common line items that are missing within a trade the model
   *  CAN see. Example: trade=Concrete present, item=Concrete pump
   *  truck rental missing. */
  missingItems: z.array(z.object({
    trade: z.string(),
    item: z.string(),
    rationale: z.string(),
    estimatedCost: z.number().nullable().optional(),
  })).default([]),
  /** Items where the model thinks the unit-cost or qty looks off vs
   *  industry norms for the project size. Suggestion field gives a
   *  reasonable range. */
  pricingFlags: z.array(z.object({
    itemName: z.string(),
    issue: z.string(),
    suggestion: z.string(),
  })).default([]),
  /** Compliance / process gotchas — permits, insurance allowance,
   *  contingency %, OH&P. Not strictly line items but the GC should
   *  resolve before sending. */
  complianceFlags: z.array(z.object({
    label: z.string(),
    detail: z.string(),
  })).default([]),
});

export type EstimateReviewResult = z.infer<typeof reviewerSchema>;

export async function reviewEstimate(project: Project): Promise<EstimateReviewResult> {
  const linked = project.linkedEstimate;
  if (!linked || !Array.isArray(linked.items) || linked.items.length === 0) {
    return {
      completenessScore: 0,
      confidence: 'low',
      summary: 'No estimate to review yet — add line items first.',
      missingTrades: [],
      missingItems: [],
      pricingFlags: [],
      complianceFlags: [],
    };
  }

  // Compress the line items so we don't burn 5k tokens on a
  // 500-item estimate. Keep the high-leverage fields, group by
  // category so the model sees the structure.
  const byCategory = new Map<string, typeof linked.items>();
  for (const it of linked.items) {
    const k = it.category ?? 'Uncategorized';
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(it);
  }
  const itemBlock = Array.from(byCategory.entries())
    .map(([cat, items]) => {
      const subtotal = items.reduce((s, i) => s + (i.lineTotal ?? 0), 0);
      const lines = items.slice(0, 8).map(i =>
        `  - ${i.name} | ${i.quantity} ${i.unit} @ $${(i.usesBulk ? i.bulkPrice : i.unitPrice).toFixed(2)} = $${i.lineTotal.toFixed(2)}`
      );
      const overflow = items.length > 8 ? `\n  - …${items.length - 8} more` : '';
      return `${cat} (${items.length} items, $${subtotal.toFixed(2)}):\n${lines.join('\n')}${overflow}`;
    })
    .join('\n\n');

  const prompt = `You are a senior construction estimator. The contractor has an estimate they're about to send. Review it for completeness against industry norms for this project type and size, then flag anything missing or suspicious.

PROJECT:
Name: ${project.name}
Type: ${project.type ?? 'unknown'}
Square footage: ${project.squareFootage ?? 'unknown'}
Quality tier: ${project.quality ?? 'unknown'}
Location: ${project.location ?? 'unknown'}
Description: ${project.description ?? '—'}
Global markup: ${linked.globalMarkup}%
Base total: $${linked.baseTotal.toFixed(2)}
Markup: $${linked.markupTotal.toFixed(2)}
Grand total: $${linked.grandTotal.toFixed(2)}

LINE ITEMS BY CATEGORY:
${itemBlock}

Return a strict JSON object that matches the reviewer schema. Be specific — name actual trades and items, give cost ranges grounded in the project's location and quality tier. If the estimate looks comprehensive, return short missingTrades + missingItems arrays and a high completenessScore. If it's clearly thin (e.g. a kitchen reno without Plumbing or Electrical), be loud about what's missing.

Conservative bias: only flag things you're confident are missing for THIS project type. Do not pad the missingItems list with generic "supervision" / "general conditions" entries unless they're clearly absent.`;

  const result = await mageAI({
    prompt,
    schema: reviewerSchema,
    tier: 'smart',
    maxTokens: 1800,
  });
  if (!result.success) {
    throw new Error(result.error || 'AI unavailable');
  }
  return result.data;
}
