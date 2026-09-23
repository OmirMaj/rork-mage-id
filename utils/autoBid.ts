// utils/autoBid.ts
//
// "MAGE bids for you" — turns inbound opportunities into PRE-PRICED bids.
//
// The 2026 AI bidding tools (Downtobid, ConstructionBids.ai, et al.) find and
// match opportunities but explicitly do NOT price them — they can't, because
// they don't know your costs. MAGE does: the price book learns your real rates
// and the Win Optimizer knows your win history. So this goes the last mile:
//   opportunity → cost basis from YOUR history → win-optimal price → ranked
// so the contractor wakes up to bids that are already priced, ready to review.
//
// Pure: no React/network/clock (caller passes nowMs). The cost basis carries a
// `basis` label so the UI can be honest about where the number came from.
//
// ── Audit wave 5, #16 ───────────────────────────────────────────────────────
// The screen said "Priced in your numbers" but history could never match:
// history was keyed on Project.type ('renovation', 'new_build'…) and
// opportunities on public_bids.category ('residential', 'construction'…), two
// vocabularies with no word in common, so every card was priced off the posted
// budget at a hard-coded 18%. And had they matched, the "cost" was the job's
// SELL price (effectiveEstimateTotal = grandTotal), marked up again. Now:
//   * PROJECT_TYPE_TO_BID_CATEGORY maps his job types onto the bid categories;
//   * historyFromProjects prices each closed job at what it COST — recorded
//     job-costing actuals when they plausibly cover the job, else the
//     estimate's pre-markup baseTotal — never grandTotal;
//   * the markup is his saved one, or an 18% the rows and drivers call
//     "assumed" (markupAssumed), never "your usual".

import { computeWinOptimizer } from '@/utils/winOptimizer';
import type { Lead, Project, BidCategory, ProjectType } from '@/types';

/** Minimal shape of an opportunity (a PublicBid row, incl. homeowner RFPs). */
export interface BidOpportunity {
  id: string;
  title: string;
  category?: string;
  /** Agency/scraped bids carry this. */
  estimatedValue?: number;
  /** Homeowner RFPs carry a range instead. */
  budgetMin?: number;
  budgetMax?: number;
  deadline?: string;
  city?: string;
  state?: string;
}

/** One completed job of the contractor's, for the cost anchor. */
export interface JobHistoryPoint {
  /** A BidCategory (mapped from the job's ProjectType), so it can meet an
   *  opportunity's category. */
  category: string;
  /** What the job COST him (never its sell price). */
  cost: number;
  /** Where `cost` came from — recorded actuals, or the estimate before markup. */
  costSource?: 'recorded_actuals' | 'estimate_before_markup';
}

/** The contractor's job types, in the vocabulary public_bids uses. Every
 *  residential scope — including the trade types, which on this app are
 *  overwhelmingly homeowner work — is 'residential'; commercial is
 *  'construction'. Projects created by an RFP award carry type 'awarded_rfp'
 *  (award_rfp) and are homeowner jobs, so 'residential' too. */
export const PROJECT_TYPE_TO_BID_CATEGORY: Record<ProjectType | 'awarded_rfp', BidCategory> = {
  new_build: 'residential',
  renovation: 'residential',
  addition: 'residential',
  remodel: 'residential',
  landscape: 'residential',
  roofing: 'residential',
  flooring: 'residential',
  painting: 'residential',
  plumbing: 'residential',
  electrical: 'residential',
  concrete: 'residential',
  awarded_rfp: 'residential',
  commercial: 'construction',
};

export function bidCategoryForProjectType(type: string | null | undefined): BidCategory | null {
  const key = String(type ?? '').trim().toLowerCase();
  return (PROJECT_TYPE_TO_BID_CATEGORY as Record<string, BidCategory>)[key] ?? null;
}

/**
 * Recorded actuals below this share of the job's own pre-markup estimate are
 * treated as INCOMPLETE capture, not as a cheap job: on a closed job that is
 * nearly always cost that was never logged (a crew trade with no rate, receipts
 * never snapped, subs paid outside MAGE), and bidding off it would under-price
 * the next job. The estimate's baseTotal is used instead and the row says so.
 */
export const ACTUALS_MIN_COVERAGE = 0.5;

/** What one closed job cost him, and from which record. null when neither
 *  recorded actuals nor an estimate says. */
export function historyCostFor(input: {
  /** Recorded job-costing actual cost (utils/wip suggestCostToDateWithSource). */
  actualCost?: number | null;
  /** True only when every direct-cost source was handed over (crew time,
   *  equipment, permits) — otherwise the actual is a lower bound by design. */
  actualComplete?: boolean;
  /** linkedEstimate.baseTotal — the estimate BEFORE markup. */
  estimateBaseTotal?: number | null;
}): { cost: number; costSource: NonNullable<JobHistoryPoint['costSource']> } | null {
  const actual = Number(input.actualCost);
  const base = Number(input.estimateBaseTotal);
  const hasActual = input.actualComplete === true && Number.isFinite(actual) && actual > 0;
  const hasBase = Number.isFinite(base) && base > 0;
  if (hasActual && (!hasBase || actual >= base * ACTUALS_MIN_COVERAGE)) {
    return { cost: actual, costSource: 'recorded_actuals' };
  }
  if (hasBase) return { cost: base, costSource: 'estimate_before_markup' };
  return null;
}

/**
 * The cost anchor: every completed / closed job, in bid categories, at cost.
 * `actualFor` returns the job's recorded actual cost (and whether the sources
 * were complete); omit it to price from the estimates alone.
 */
export function historyFromProjects(
  projects: Pick<Project, 'id' | 'type' | 'status' | 'linkedEstimate'>[],
  actualFor?: (projectId: string) => { value: number; complete: boolean } | null,
): JobHistoryPoint[] {
  const out: JobHistoryPoint[] = [];
  for (const p of projects) {
    if (p.status !== 'completed' && p.status !== 'closed') continue;
    const category = bidCategoryForProjectType(p.type as string);
    if (!category) continue;
    const actual = actualFor?.(p.id) ?? null;
    const resolved = historyCostFor({
      actualCost: actual?.value ?? null,
      actualComplete: actual?.complete ?? false,
      estimateBaseTotal: p.linkedEstimate?.baseTotal ?? null,
    });
    if (!resolved) continue;
    out.push({ category, cost: resolved.cost, costSource: resolved.costSource });
  }
  return out;
}

/** The 18% the screen falls back to when he has never set a markup. Always
 *  labelled "assumed" on screen — it is not his. */
export const ASSUMED_MARKUP = 0.18;

/** Win-optimizer driver lines speak of "your usual X%". When the markup is the
 *  assumed default that is not his usual anything: say "the assumed X%", and
 *  drop the line that praises his instincts for it. */
export function driversForMarkup(drivers: string[], markupAssumed: boolean): string[] {
  if (!markupAssumed) return drivers;
  return drivers
    .filter((d) => !/nice instincts/i.test(d))
    .map((d) => d.replace(/\bYour usual\b/g, 'The assumed').replace(/\byour usual\b/g, 'the assumed'));
}

export type CostBasis = 'your_history' | 'their_budget' | 'none';

export interface PricedBid {
  id: string;
  title: string;
  category: string;
  /** Cost we priced from, and where it came from (honesty). */
  cost: number;
  basis: CostBasis;
  /** Win-optimal price (maximizes expected profit). */
  recommendedPrice: number;
  winProbability: number;
  expectedProfit: number;
  profit: number;
  confidence: 'low' | 'medium' | 'high';
  /** Days until the bid is due; null when no deadline. Negative = past due. */
  daysToDeadline: number | null;
  /** True when our win-optimal price exceeds the owner's stated budget cap. */
  overBudget: boolean;
  /** Fit 0..1 — how close this job is to the contractor's typical size. */
  fit: number;
  /** Ranking score = expectedProfit × fit. */
  score: number;
  /** Plain-English "why this price" lines from the Win Optimizer. */
  drivers: string[];
  /** The markup this row was priced at (fraction), and whether it is the
   *  assumed default rather than his saved markup. */
  markup: number;
  markupAssumed: boolean;
}

const DAY_MS = 86400000;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Opportunity value the owner/agency signalled (midpoint of a range). */
function signalledValue(o: BidOpportunity): number {
  if (o.budgetMin != null && o.budgetMax != null && o.budgetMax > 0) {
    return (o.budgetMin + o.budgetMax) / 2;
  }
  if (o.budgetMax != null && o.budgetMax > 0) return o.budgetMax;
  if (o.estimatedValue != null && o.estimatedValue > 0) return o.estimatedValue;
  return 0;
}

/**
 * Derive the cost basis for an opportunity.
 *  1. YOUR HISTORY — median actual cost of your completed jobs in this
 *     category, scaled toward the opportunity's signalled size when both exist.
 *  2. THEIR BUDGET — back out an implied cost from the posted value using your
 *     typical markup (price ÷ (1 + markup)).
 * Returns cost 0 / basis 'none' when neither signal exists (caller skips).
 */
export function deriveCostBasis(
  o: BidOpportunity,
  history: JobHistoryPoint[],
  typicalMarkup: number,
): { cost: number; basis: CostBasis } {
  const cat = (o.category ?? '').trim().toLowerCase();
  const sameCat = history.filter((h) => (h.category ?? '').trim().toLowerCase() === cat && h.cost > 0);
  const value = signalledValue(o);

  if (sameCat.length > 0) {
    const hist = median(sameCat.map((h) => h.cost));
    if (value > 0) {
      // Blend: your historical cost, nudged toward this job's signalled size.
      const impliedFromValue = value / (1 + typicalMarkup);
      return { cost: (hist + impliedFromValue) / 2, basis: 'your_history' };
    }
    return { cost: hist, basis: 'your_history' };
  }

  if (value > 0) return { cost: value / (1 + typicalMarkup), basis: 'their_budget' };
  return { cost: 0, basis: 'none' };
}

/** Fit 0..1 — 1.0 when the job matches your typical (median) job size. */
export function sizeFit(cost: number, history: JobHistoryPoint[]): number {
  const costs = history.map((h) => h.cost).filter((c) => c > 0);
  if (costs.length === 0 || cost <= 0) return 0.6; // unknown → neutral-ish
  const typical = median(costs);
  if (typical <= 0) return 0.6;
  const ratio = cost / typical;
  // Full credit within 0.5×..2× your typical job; tapering outside.
  if (ratio >= 0.5 && ratio <= 2) return 1;
  const off = ratio < 0.5 ? 0.5 / ratio : ratio / 2; // >1
  return Math.max(0.15, Math.min(1, 1 / off));
}

export function buildPricedBids(opts: {
  opportunities: BidOpportunity[];
  history: JobHistoryPoint[];
  leads: Pick<Lead, 'stage' | 'lostReason'>[];
  /** His saved markup as a fraction. Omit (or pass markupAssumed) to price at
   *  ASSUMED_MARKUP, which every row then labels as assumed. */
  typicalMarkup?: number;
  markupAssumed?: boolean;
  nowMs: number;
  /** Drop opportunities already past their deadline. Default true. */
  excludePastDue?: boolean;
}): PricedBid[] {
  const { opportunities, history, leads, nowMs } = opts;
  const markupAssumed = opts.markupAssumed === true || opts.typicalMarkup == null || !Number.isFinite(opts.typicalMarkup);
  const typicalMarkup = markupAssumed ? ASSUMED_MARKUP : (opts.typicalMarkup as number);
  const excludePastDue = opts.excludePastDue ?? true;

  const out: PricedBid[] = [];

  for (const o of opportunities) {
    const { cost, basis } = deriveCostBasis(o, history, typicalMarkup);
    if (basis === 'none' || cost <= 0) continue; // nothing honest to price from

    let daysToDeadline: number | null = null;
    if (o.deadline) {
      const ms = Date.parse(o.deadline.length === 10 ? o.deadline + 'T12:00:00' : o.deadline);
      if (Number.isFinite(ms)) daysToDeadline = Math.ceil((ms - nowMs) / DAY_MS);
    }
    if (excludePastDue && daysToDeadline != null && daysToDeadline < 0) continue;

    const wo = computeWinOptimizer({ cost, leads, typicalMarkup });
    const rec = wo.recommended;
    const fit = sizeFit(cost, history);
    const cap = o.budgetMax ?? 0;

    out.push({
      id: o.id,
      title: o.title,
      category: o.category ?? 'General',
      cost: Math.round(cost),
      basis,
      recommendedPrice: Math.round(rec.price),
      winProbability: rec.winProbability,
      expectedProfit: Math.round(rec.expectedProfit),
      profit: Math.round(rec.profit),
      confidence: wo.confidence,
      daysToDeadline,
      overBudget: cap > 0 && rec.price > cap,
      fit,
      score: Math.round(rec.expectedProfit * fit),
      drivers: driversForMarkup(wo.drivers, markupAssumed),
      markup: typicalMarkup,
      markupAssumed,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
