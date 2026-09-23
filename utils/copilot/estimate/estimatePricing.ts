// utils/copilot/estimate/estimatePricing.ts — the pure half of the Copilot
// estimate: turning the model's cost lines into a LinkedEstimate, deciding
// which prices are his, resolving the markup and wording the review. No mageAI
// / React import, so validators drive it directly.
//
// WHY THIS EXISTS (#7 + #38). The Copilot estimate
//   - said "priced from your jobs" whether or not any of his costs fed it,
//   - showed no total (pricing only happened inside Build),
//   - wrote `markup: 0` on every line and grandTotal = base × 1.18 — a markup
//     he never chose, stored OUTSIDE lineTotal, so the next voice edit or
//     calibration (both rebuild grandTotal = Σ lineTotal) erased it,
//   - replaced the job's estimate with nothing marking which prices were his.
// Now the lines are built through utils/estimateMarkup.withMarkup (markup
// inside lineTotal, Σ lineTotal === grandTotal), each line carries where its
// price came from, and the markup is his or it is asked.
import type { LinkedEstimate, LinkedEstimateItem, QualityTier } from '@/types';
import { withMarkup, isMarkupSet, round2 } from '@/utils/estimateMarkup';
import { scopeRelevance } from '@/utils/groundingChip';
import type { EstimateGroundingEntry } from './estimateGrounding';
import type { CopilotContext } from '../types';

/** Where a line's unit price came from. 'learned' = his measured cost book;
 *  'seeded' = a rate he set himself; 'regional' = MAGE's typical-rate estimate. */
export type EstimatePriceSource = 'learned' | 'seeded' | 'regional';

/** CONTRACT 27 local extension: LinkedEstimateItem.priceSource lives here until
 *  w5-join-core folds it into types/index.ts (then this alias goes). Optional,
 *  so every existing reader of LinkedEstimateItem is unaffected. */
export type LinkedEstimateItemW5 = LinkedEstimateItem & { priceSource?: EstimatePriceSource };

/** One cost line as the model returns it (all fields untrusted). */
export interface GenLine {
  category?: string; name?: string; unit?: string; quantity?: number;
  unitPrice?: number; csiDivision?: string; isAllowance?: boolean;
  /** The model's claim of what priced this line. Accepted only when the line's
   *  trade matches a cost-book entry that fed the prompt. */
  basis?: string;
}

/**
 * Where this line's price came from. The model's `basis` is a claim; it is
 * believed only when the line's own words name a trade that was actually in
 * the prompt (scopeRelevance's text match, the same matcher that picked the
 * entries). A matched seeded entry reads 'seeded', a measured one 'learned';
 * anything else is 'regional' — never "your cost" on the model's say-so.
 */
export function lineSourceFor(
  line: Pick<GenLine, 'category' | 'name' | 'basis'>,
  entries: readonly EstimateGroundingEntry[],
): EstimatePriceSource {
  const claimed = String(line.basis ?? '').trim().toLowerCase();
  if (claimed !== 'learned' && claimed !== 'seeded') return 'regional';
  const text = `${line.category ?? ''} ${line.name ?? ''}`;
  // >= 2 is the "trade named in the text" score; the project-type +1 alone
  // is not evidence that THIS line used that rate.
  const hit = entries.find((e) => scopeRelevance(e, { scope: text }) >= 2);
  if (!hit) return 'regional';
  return hit.provenance === 'seeded' ? 'seeded' : 'learned';
}

/** The model's lines → cost-only estimate items (markup 0, lineTotal = cost),
 *  each stamped with its price source. Lines with no name/category or no
 *  numeric price are dropped. `makeId` is injected so this stays pure. */
export function buildCostItems(
  rawLines: readonly GenLine[],
  entries: readonly EstimateGroundingEntry[],
  makeId: () => string,
): LinkedEstimateItemW5[] {
  return rawLines
    .filter((l) => l && (l.name || l.category) && typeof l.unitPrice === 'number' && Number.isFinite(l.unitPrice))
    .map((l) => {
      const quantity = typeof l.quantity === 'number' && Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 1;
      const unitPrice = round2(Math.max(0, Number(l.unitPrice) || 0));
      const item: LinkedEstimateItemW5 = {
        materialId: makeId(),
        name: l.name ?? l.category ?? 'Line item',
        category: l.category ?? 'General',
        unit: l.unit ?? 'ea',
        quantity,
        unitPrice,
        bulkPrice: unitPrice,
        markup: 0,
        usesBulk: false,
        lineTotal: round2(quantity * unitPrice),
        supplier: '',
        csiDivision: l.csiDivision,
        isAllowance: !!l.isAllowance,
        priceSource: lineSourceFor(l, entries),
      };
      return item;
    });
}

export type MarkupSource = 'said' | 'job' | 'saved';

/** His markup, in the order #7 sets: what he said in this interview → this
 *  job's current estimate → the markup he decided in the estimator. null =
 *  nobody has decided; the caller ASKS (never a default). */
export function resolveCopilotMarkup(a: {
  draftPct?: number | null;
  projectPct?: number | null;
  decidedPct?: number | null;
}): { pct: number; source: MarkupSource } | null {
  if (isMarkupSet(a.draftPct ?? null)) return { pct: a.draftPct as number, source: 'said' };
  // A job estimate at 0% is how the old wizard wrote "never asked"; it is not
  // read as a decision (estimateGrounding.defaultMarkupPct applies the same rule).
  if (typeof a.projectPct === 'number' && Number.isFinite(a.projectPct) && a.projectPct > 0) return { pct: a.projectPct, source: 'job' };
  if (isMarkupSet(a.decidedPct ?? null)) return { pct: a.decidedPct as number, source: 'saved' };
  return null;
}

/** The markup Build uses for this interview: his answer → this job's
 *  estimate → his saved markup (the ctx bag from app/copilot.tsx carries
 *  MaterialCartContext's markupDecided / globalMarkup as markupDecided /
 *  markup). null = undecided; Build refuses. */
export function copilotEstimateMarkup(
  draft: { markupPct?: number | null },
  ctx: Pick<CopilotContext, 'project' | 'ctx'>,
): ReturnType<typeof resolveCopilotMarkup> {
  const bag = (ctx.ctx ?? {}) as { markupDecided?: boolean | null; markup?: number };
  return resolveCopilotMarkup({
    draftPct: draft.markupPct ?? null,
    projectPct: ctx.project?.linkedEstimate?.globalMarkup ?? null,
    decidedPct: bag.markupDecided === true ? bag.markup ?? null : null,
  });
}

export function markupSourceLabel(s: MarkupSource): string {
  return s === 'said' ? 'what you told me' : s === 'job' ? 'this job’s current estimate' : 'your saved markup';
}

/** The estimate Build writes: markup INSIDE every lineTotal through
 *  withMarkup(force), so baseTotal + markupTotal === grandTotal === Σ lineTotal
 *  and recomputeEstimate / applyCalibration are no-ops on a fresh build. */
export function buildCopilotLinkedEstimate(
  costItems: readonly LinkedEstimateItemW5[],
  markupPct: number,
  id: string,
  createdAt: string,
): LinkedEstimate {
  const base: LinkedEstimate = {
    id,
    items: costItems.map((i) => ({ ...i, markup: 0, lineTotal: round2(i.quantity * i.unitPrice) })),
    globalMarkup: markupPct,
    baseTotal: 0, markupTotal: 0, grandTotal: 0,
    createdAt,
  };
  return withMarkup(base, markupPct, { force: true });
}

/** Review headline from what actually priced the lines (#38). "Priced from
 *  your jobs" only when a matching cost-book entry fed the prompt AND at least
 *  one line used it; otherwise it says typical regional rates. */
export function pricedHeadline(sources: readonly EstimatePriceSource[], fedEntries: number): string {
  const m = sources.length;
  const mine = sources.filter((s) => s !== 'regional').length;
  if (fedEntries > 0 && mine > 0) {
    // A seeded rate is one he SET, not one measured on a job — the seeding
    // firewall (estimateGrounding) keeps the model from calling it history,
    // and the headline must not either.
    const lead = sources.some((s) => s === 'learned') ? 'Priced from your jobs' : 'Priced from the rates you set';
    return mine === m
      ? `${lead} — all ${m} line${m === 1 ? '' : 's'} from your costs.`
      : `${lead} — ${mine} of ${m} lines from your costs; the rest at typical regional rates. Check those.`;
  }
  return fedEntries > 0
    ? 'Priced at typical regional rates — none of these lines matched your costs.'
    : 'Priced at typical regional rates — none of your jobs cover this scope yet.';
}

/** "This replaces your current N-line estimate ($X)." — null when there is none. */
export function replaceWarning(current: Pick<LinkedEstimate, 'items' | 'grandTotal'> | null | undefined): string | null {
  const n = current?.items?.length ?? 0;
  if (!current || n === 0) return null;
  const total = Number.isFinite(current.grandTotal) ? current.grandTotal : 0;
  return `This replaces your current ${n}-line estimate ($${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). The old version is saved.`;
}

/** What the pricing step hands the review and Build. Serializable: it lives in
 *  the interview draft (PATCH_DRAFT) so Build commits exactly what he saw and
 *  never asks the model a second time. */
export interface PricedEstimate {
  costItems: LinkedEstimateItemW5[];
  notes: string[];
  /** Matching cost-book entries that fed the prompt. */
  fedEntries: number;
  quality: QualityTier;
  qualityAssumed: boolean;
  sizeSqft: number;
  sizeAssumed: boolean;
}
