// utils/copilot/estimate/estimatePrice.ts — the ONE model call that prices a
// Copilot estimate, run when the interview reaches review (#38), metered as a
// quickEstimate (checkAILimit before, recordAIUsage after a success). Build
// (estimateCapability.apply) commits the result and never calls the model.
import type { QualityTier } from '@/types';
import type { CopilotContext } from '../types';
import type { EstimateDraft } from './estimateGaps';
import { buildEstimateGrounding, type EstimateGroundingEntry } from './estimateGrounding';
import { buildCostItems, type GenLine, type PricedEstimate } from './estimatePricing';
import { mageAI } from '@/utils/mageAI';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { FEATURE_CONFIG, type LimitCheck, type SubscriptionTierKey } from '@/utils/aiRateLimiterCore';
import { createId } from '@/utils/scheduleEngine';

export type PriceResult =
  | { ok: true; priced: PricedEstimate }
  | { ok: false; kind: 'limit'; reason: NonNullable<LimitCheck['reason']> | 'monthly_cap'; message: string }
  | { ok: false; kind: 'error'; message: string };

export async function priceCopilotEstimate(draft: EstimateDraft, ctx: CopilotContext): Promise<PriceResult> {
  const project = ctx.project;
  if (!project) return { ok: false, kind: 'error', message: 'Pick the job this estimate is for first.' };
  const scope = (draft.scope ?? '').trim();
  if (!scope) return { ok: false, kind: 'error', message: 'Tell me the scope first, then I can price it.' };

  // The scope picks the cost-book trades that feed the prompt.
  const grounding = await buildEstimateGrounding(ctx, scope);
  const g = grounding.data as { projectQuality?: QualityTier; projectSqft?: number; groundingEntries?: EstimateGroundingEntry[] };
  const entries = Array.isArray(g.groundingEntries) ? g.groundingEntries : [];
  // Finish level and size: his answer, then the job's own metadata; else an
  // assumption the review names as one.
  const quality: QualityTier = draft.quality ?? g.projectQuality ?? 'standard';
  const qualityAssumed = draft.quality == null && g.projectQuality == null;
  const sizeSqft = draft.sizeSqft ?? g.projectSqft ?? 200;
  const sizeAssumed = draft.sizeSqft == null && g.projectSqft == null;

  const reqTier = FEATURE_CONFIG.quickEstimate.tier;
  const limit = await checkAILimit(ctx.tier as SubscriptionTierKey, reqTier, 'quickEstimate');
  if (!limit.allowed) {
    return { ok: false, kind: 'limit', reason: limit.reason ?? 'daily_cap', message: limit.message ?? 'You’ve used your AI allowance for estimates.' };
  }

  const gen = await mageAI({
    prompt: [
      'You are MAGE Copilot pricing a construction estimate for a contractor.',
      `SCOPE: ${scope}`,
      `FINISH LEVEL: ${quality}`,
      `WORK AREA: ~${sizeSqft} SF`,
      project.location ? `LOCATION: ${project.location}` : '',
      '',
      entries.length
        ? 'Price from the contractor\'s OWN costs where the trade appears below; for trades with no entry use realistic standard regional rates for the ' + quality + ' finish level. THEIR COSTS:'
        : 'The contractor has no cost history for these trades — use realistic standard regional rates for the ' + quality + ' finish level.',
      ...grounding.facts,
      '',
      'Return itemized line items grouped by trade/category. Each line: category,',
      'name, unit (ea/sf/ls/lf), quantity, unitPrice (the contractor cost BEFORE',
      'markup), csiDivision (2-digit CSI), isAllowance (true only for not-yet-',
      'selected tile / fixtures / appliances), basis ("learned" when priced from',
      'one of THEIR measured costs above, "seeded" when from a rate they set',
      'themselves above, otherwise "regional"). Do NOT apply markup. Be complete',
      'but never padded. Put every assumption you made in notes.',
    ].filter(Boolean).join('\n'),
    schemaHint: {
      lineItems: [{ category: 'Demolition', name: 'Kitchen demo', unit: 'ls', quantity: 1, unitPrice: 2500, csiDivision: '02', isAllowance: false, basis: 'regional' }],
      notes: ['assumptions worth flagging'],
    },
    tier: reqTier,
    maxTokens: 4000,
    feature: 'quickEstimate',
  });
  if (!gen.success || !gen.data) {
    if (gen.errorKind === 'monthly_cap') return { ok: false, kind: 'limit', reason: 'monthly_cap', message: gen.error ?? 'Monthly AI limit reached.' };
    return { ok: false, kind: 'error', message: gen.error ?? 'Could not price the estimate. Try again.' };
  }
  void recordAIUsage(reqTier, 'quickEstimate');

  const data = gen.data as { lineItems?: GenLine[]; notes?: unknown };
  const costItems = buildCostItems(Array.isArray(data.lineItems) ? data.lineItems : [], entries, () => createId('mat'));
  if (costItems.length === 0) return { ok: false, kind: 'error', message: 'The estimate came back empty — try describing the scope in more detail.' };
  const notes = Array.isArray(data.notes)
    ? data.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim()).slice(0, 8)
    : [];
  return { ok: true, priced: { costItems, notes, fedEntries: entries.length, quality, qualityAssumed, sizeSqft, sizeAssumed } };
}
