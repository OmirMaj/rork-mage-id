// utils/copilot/estimate/estimateCapability.ts — the Estimate Copilot capability.
//
// Voice a rough scope → the interview grounds pricing in the contractor's own
// learned costs (estimateGrounding), asks only what history can't resolve
// (finish level / size), then GENERATES a line-itemed estimate priced from
// those learned rates, commits it undo-safely, and drops the user on the
// project where the estimate now lives. Mirrors the Schedule capability's
// shape; the moat is the cost-book grounding fed into generation.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { estimateGaps, type EstimateDraft } from './estimateGaps';
import { buildEstimateGrounding } from './estimateGrounding';
import { mageAI } from '@/utils/mageAI';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { createId } from '@/utils/scheduleEngine';
import type { QualityTier, LinkedEstimate, LinkedEstimateItem } from '@/types';

export interface EstimateApplied { route: '/project-detail'; projectId: string }

const QUALITIES: QualityTier[] = ['economy', 'standard', 'premium', 'luxury'];
const isQuality = (v: unknown): v is QualityTier => typeof v === 'string' && (QUALITIES as string[]).includes(v);

interface GenLine {
  category?: string; name?: string; unit?: string; quantity?: number;
  unitPrice?: number; csiDivision?: string; isAllowance?: boolean;
}

export const estimateCapability: CopilotCapability<EstimateDraft, EstimateApplied> = {
  id: 'estimate',
  label: 'Build an estimate',
  aiFeature: 'quickEstimate',
  maxQuestions: 3,
  askThreshold: 0.4,
  suggestions: [
    'Kitchen gut — demo, 200 SF tile, new cabinets, rewire, repaint',
    'Full bath remodel, standard finishes, move the plumbing',
  ],
  topicChecklist: [
    { label: 'Scope', hint: 'rooms / trades / what work' },
    { label: 'Finish level', hint: 'economy → luxury' },
    { label: 'Size', hint: 'rough square footage' },
  ],
  copy: {
    voiceTitle: 'Build an estimate',
    reviewHeadline: 'Here’s your estimate, priced from your jobs.',
    reviewSub: 'Review the total, then build. You can fine-tune every line on the estimate grid.',
    buildingLabel: 'Pricing your estimate…',
    webRoute: '/(tabs)/estimate',
  },
  buildGrounding: buildEstimateGrounding,
  gaps: (draft: EstimateDraft, grounding: Grounding): Gap[] => estimateGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a contractor scope a construction estimate.',
      'Extract ONLY the pricing parameters the contractor actually stated. Do NOT',
      'invent them — a null field is how you ASK. Fields:',
      '• quality: economy | standard | premium | luxury — only if they named a',
      '  finish level; else null.',
      '• sizeSqft: number — only if they gave a square footage; else null.',
      '• markupPct: number — only if they stated a markup; else null.',
      '',
      'THEIR HISTORY:', ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { quality: null, sizeSqft: null, markupPct: null },
  }),

  mergeDraft: (draft, aiJson, meta): EstimateDraft => ({
    // The transcript IS the scope — keep the latest so apply() can price it.
    scope: meta?.transcript ?? draft.scope ?? null,
    quality: isQuality(aiJson?.quality) ? aiJson.quality : draft.quality ?? null,
    sizeSqft: typeof aiJson?.sizeSqft === 'number' ? aiJson.sizeSqft : draft.sizeSqft ?? null,
    markupPct: typeof aiJson?.markupPct === 'number' ? aiJson.markupPct : draft.markupPct ?? null,
  }),

  apply: async (draft: EstimateDraft, ctx: CopilotContext): Promise<EstimateApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project to attach the estimate to.');

    // Resolve the pricing parameters: interview answer → project metadata → default.
    const grounding = await buildEstimateGrounding(ctx);
    const g = grounding.data as { projectQuality?: QualityTier; projectSqft?: number; defaultMarkupPct?: number };
    const quality: QualityTier = draft.quality ?? g.projectQuality ?? 'standard';
    const sizeSqft = draft.sizeSqft ?? g.projectSqft ?? 200;
    const markupPct = draft.markupPct ?? g.defaultMarkupPct ?? 18;
    const scope = (draft.scope ?? '').trim();
    if (!scope) throw new Error('Tell me the scope first, then I can price it.');

    const gen = await mageAI({
      prompt: [
        'You are MAGE Copilot pricing a construction estimate for a contractor.',
        `SCOPE: ${scope}`,
        `FINISH LEVEL: ${quality}`,
        `WORK AREA: ~${sizeSqft} SF`,
        project.location ? `LOCATION: ${project.location}` : '',
        '',
        'Price from the contractor\'s OWN learned unit costs where the trade appears',
        'below; for trades with no history use realistic standard regional rates for',
        `the ${quality} finish level. THEIR LEARNED COSTS:`,
        ...grounding.facts,
        '',
        'Return itemized line items grouped by trade/category. Each line: category,',
        'name, unit (ea/sf/ls/lf), quantity, unitPrice (the contractor cost BEFORE',
        'markup), csiDivision (2-digit CSI), isAllowance (true only for not-yet-',
        'selected tile / fixtures / appliances). Do NOT apply markup. Be complete',
        'but never padded.',
      ].filter(Boolean).join('\n'),
      schemaHint: {
        lineItems: [{ category: 'Demolition', name: 'Kitchen demo', unit: 'ls', quantity: 1, unitPrice: 2500, csiDivision: '02', isAllowance: false }],
        notes: ['assumptions worth flagging'],
      },
      tier: 'smart',
      maxTokens: 4000,
      feature: 'quickEstimate',
    });
    if (!gen.success || !gen.data) {
      throw new Error(gen.error ?? 'Could not price the estimate. Try again.');
    }

    const rawLines: GenLine[] = Array.isArray((gen.data as { lineItems?: GenLine[] }).lineItems)
      ? (gen.data as { lineItems: GenLine[] }).lineItems
      : [];
    const items: LinkedEstimateItem[] = rawLines
      .filter((l) => (l.name || l.category) && typeof l.unitPrice === 'number')
      .map((l) => {
        const quantity = typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : 1;
        const unitPrice = Math.max(0, Number(l.unitPrice) || 0);
        return {
          materialId: createId('mat'),
          name: l.name ?? l.category ?? 'Line item',
          category: l.category ?? 'General',
          unit: l.unit ?? 'ea',
          quantity,
          unitPrice,
          bulkPrice: unitPrice,
          markup: 0,
          usesBulk: false,
          lineTotal: Math.round(quantity * unitPrice * 100) / 100,
          supplier: '',
          csiDivision: l.csiDivision,
          isAllowance: !!l.isAllowance,
        };
      });
    if (items.length === 0) throw new Error('The estimate came back empty — try describing the scope in more detail.');

    const baseTotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
    const markupTotal = Math.round(baseTotal * (markupPct / 100) * 100) / 100;
    const linked: LinkedEstimate = {
      id: createId('est'),
      items,
      globalMarkup: markupPct,
      baseTotal,
      markupTotal,
      grandTotal: Math.round((baseTotal + markupTotal) * 100) / 100,
      createdAt: new Date().toISOString(),
    };

    const patch = commitEstimatePatch(project, linked, { reason: 'pre_overwrite', note: 'Built by MAGE Copilot' });
    ctx.ctx?.updateProject?.(ctx.projectId, patch);
    return { route: '/project-detail', projectId: ctx.projectId };
  },
};
