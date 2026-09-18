// Instant Bid generator — turns a homeowner RFP into a ready-to-send
// Good/Better/Best proposal in one tap.
//
// Why this exists: the single most evidence-backed lever for "this app gets
// me jobs" is speed-to-lead paired with a professional, tiered proposal. The
// contractor shouldn't have to hand-build a quote — the app drafts it from
// the RFP scope + budget, attaches an illustrative financing line, and lets
// them review/tweak before submitting. AI does the cost ROM + cover message
// with a deterministic heuristic fallback, so this NEVER hard-fails (offline,
// rate-limited, or AI error all degrade gracefully to a sendable draft).

import { mageAI } from '@/utils/mageAI';
import { illustrativeMonthly } from '@/utils/financing';
import { buildCostDatabase, type CostSample } from '@/utils/costDatabase';
import type { SeededRate } from '@/utils/costSeedCore';
import { computeCalibration } from '@/utils/estimateCalibration';
import { CONTRACTED_NOTE } from '@/utils/groundingChip';
import { workmanshipWarrantyLine } from '@/utils/paymentTerms';
import type {
  FinancingConfig,
  ProposalTier,
  ProposalTierKey,
  TieredProposal,
  Project,
  Commitment,
  MaterialReceipt,
} from '@/types';

/** Build the illustrative "as low as $X/mo" line for a tier amount, or null
 *  when the financing config has no example terms / is disabled. */
function tierFinancingLine(amountUsd: number, cfg?: FinancingConfig): string | null {
  if (!cfg || !cfg.enabled) return null;
  const monthly = illustrativeMonthly(amountUsd * 100, cfg);
  return monthly ? `As low as $${monthly.toLocaleString('en-US')}/mo` : null;
}

export interface InstantBidRfp {
  title: string;
  city?: string | null;
  state?: string | null;
  scopeDescription?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  projectType?: string | null;
}

export interface InstantBidOptions {
  /** GC company name used to personalise the pitch. */
  companyName?: string;
  /** Financing config (utils/financing) so we can add a monthly-payment line. */
  financing?: FinancingConfig;
  /** Free-text the contractor typed before generating, woven into the pitch. */
  contractorNote?: string;
  /**
   * The GC's saved workmanship warranty in months
   * (utils/paymentTerms.resolveWarrantyMonths(settings)), or null/absent when
   * he never set one. Every tier prints this ONE period; with no answer the
   * line is "Workmanship warranty" with no period — never an invented one.
   */
  warrantyMonths?: number | null;
  /**
   * The contractor's markup as a PERCENT OF COST (utils/estimateMarkup's
   * convention — 20 means price = cost × 1.20), applied to the AI's ROM before
   * the Good/Better/Best ladder is built off it.
   *
   * WHY IT IS OPTIONAL AND WHY THAT IS NOT FINE. `aiMidpoint` asks the model
   * for a "rough order-of-magnitude total COST" — materials and labor, no
   * overhead and no profit — and the number that comes back becomes the
   * `better` tier amount on a proposal a homeowner receives. With no markup
   * passed, that proposal quotes the contractor's cost. It is optional rather
   * than required because this module must not invent a percentage the
   * contractor never set (see utils/estimateMarkup's header), and because two
   * call sites — app/submit-bid-response.tsx and
   * components/InstantBidProposalModal.tsx — do not pass it yet. Until they
   * do, an unmarked-up proposal SAYS SO in `assumptions`, which renders on the
   * proposal itself. A silent cost quote is the one outcome ruled out.
   */
  markupPct?: number;
  /**
   * Closed-jobs data used to ground the ROM on the contractor's own cost
   * history. When present, aiMidpoint injects learned-rate facts into the
   * prompt rather than letting the model guess from national averages.
   * Omit on callers that don't have project context (the ROM degrades
   * gracefully to budget-hint or ai_guess basis).
   */
  groundingContext?: {
    projects: Project[];
    commitments: Commitment[];
    receipts?: MaterialReceipt[];
    /** Self-perform labor samples (utils/laborSamples.ts) — crew hours at
     *  the GC's configured loaded rates. Optional cost-book input. */
    laborSamples?: CostSample[];
    /** Cold-start seeds (hooks/useCostSeeds) — rates the contractor STATED
     *  before they had closed-job history here. Reported separately from
     *  earned rates everywhere downstream: they never set basis='history' and
     *  never count into groundingRateCount. */
    seeds?: SeededRate[];
  };
}

const TIER_META: Record<ProposalTierKey, { label: string; tagline: string; mult: number }> = {
  // Multipliers anchor each tier off the recommended ("better") midpoint so
  // the spread reads like a real Good/Better/Best ladder (~-18% / base / +22%).
  good: { label: 'Essential', tagline: 'Covers the core scope, value-engineered.', mult: 0.82 },
  better: { label: 'Recommended', tagline: 'The balanced option most homeowners pick.', mult: 1.0 },
  // No "and warranty": every tier carries the same warranty (the GC's one
  // saved period), so the Premium tier must not imply a longer one.
  best: { label: 'Premium', tagline: 'Upgraded materials and finishes.', mult: 1.22 },
};

// No warranty periods here. Until 2026-09-17 these promised a 1-, 2- and
// 5-year warranty the GC never stated, on a proposal a homeowner receives.
// buildTier appends workmanshipWarrantyLine(his saved months) instead — the
// same line on every tier.
const TIER_EXTRAS: Record<ProposalTierKey, string[]> = {
  good: ['Standard-grade materials'],
  better: ['Mid-grade materials & fixtures', 'Dedicated project updates'],
  best: ['Premium materials & finishes', 'Priority scheduling', 'Final walkthrough + punch list'],
};

/** Round to a clean, quote-friendly number (nearest $100, or $500 above 50k). */
function roundQuote(n: number): number {
  if (n <= 0) return 0;
  const step = n >= 50_000 ? 500 : 100;
  return Math.round(n / step) * step;
}

function buildTier(
  key: ProposalTierKey,
  baseMid: number,
  scopeBullets: string[],
  warrantyMonths: number | null,
  financing?: FinancingConfig,
): ProposalTier {
  const meta = TIER_META[key];
  const amount = roundQuote(baseMid * meta.mult);
  return {
    key,
    label: meta.label,
    tagline: meta.tagline,
    amount,
    inclusions: [...scopeBullets, ...TIER_EXTRAS[key], workmanshipWarrantyLine(warrantyMonths)],
    financingLine: tierFinancingLine(amount, financing),
  };
}

/** Pull short, presentable scope bullets out of the RFP free-text. */
function scopeToBullets(scope?: string | null): string[] {
  if (!scope) return ['Full scope as described in your project request'];
  const parts = scope
    .split(/[\n.;•]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 6)
    .slice(0, 4);
  return parts.length > 0 ? parts : ['Full scope as described in your project request'];
}

function heuristicMessage(rfp: InstantBidRfp, opts: InstantBidOptions): string {
  const who = opts.companyName ? opts.companyName : 'Our team';
  const loc = [rfp.city, rfp.state].filter(Boolean).join(', ');
  return [
    `Hi — thanks for posting "${rfp.title}".`,
    `${who} works in ${loc || 'your area'} and we'd love to take this on.`,
    opts.contractorNote?.trim() ? opts.contractorNote.trim() : '',
    // No start window: the GC never gave one, and the AI prompt is forbidden
    // from inventing terms — the fallback must not print one either.
    `I've put together three options below so you can pick the scope and budget that fits. Happy to walk the site and refine any of them.`,
  ].filter(Boolean).join(' ');
}

/** First positive number found in a string (handles "$12,500", "12500", etc). */
function firstNumber(s: string): number | null {
  const m = s.replace(/[, ]/g, '').match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Coerce a mageAI result into the plain text the model returned. mageAI
 *  returns { success, data, raw } — for a no-schema call the text lands in
 *  `raw` (or `data` when it's already a string). */
function resultText(r: { success: boolean; data: unknown; raw?: string }): string | null {
  if (!r.success) return null;
  if (typeof r.raw === 'string' && r.raw.trim()) return r.raw.trim();
  if (typeof r.data === 'string' && r.data.trim()) return r.data.trim();
  return null;
}

/**
 * Build cost-book grounding facts for the ROM prompt, mirroring the
 * try/catch-additive shape of utils/copilot/estimate/estimateGrounding.ts.
 * Returns { facts, rateCount, seededRateCount } — rateCount=0 means no measured
 * data. The two counts are kept APART on purpose: rateCount is what sets
 * basis='history' and fills groundingRateCount (which the brain's prediction
 * ledger grades against), and a rate the contractor merely stated must never
 * make a proposal claim it was anchored on their closed jobs.
 */
function buildInstantBidGrounding(
  opts: Pick<InstantBidOptions, 'groundingContext'>,
  rfp: InstantBidRfp,
): { facts: string[]; rateCount: number; seededRateCount: number } {
  const facts: string[] = [];
  let rateCount = 0;
  let seededRateCount = 0;
  if (!opts.groundingContext) return { facts, rateCount, seededRateCount };
  const { projects, commitments, receipts, laborSamples, seeds } = opts.groundingContext;
  try {
    const db = buildCostDatabase(projects, commitments, receipts, laborSamples, seeds);
    // Pull the most-relevant entries (high-confidence first, up to 4 facts).
    const sorted = [...db.entries].sort((a, b) => {
      const rankConf = (e: typeof a) => e.confidence === 'high' ? 2 : e.confidence === 'medium' ? 1 : 0;
      return rankConf(b) - rankConf(a) || b.totalActual - a.totalActual;
    });
    for (const e of sorted.slice(0, 4)) {
      // A seeded-only entry is the contractor's own claim. Say so in the fact
      // itself — "from your 0 jobs" would be nonsense, and anything softer
      // would let the model narrate a stated rate as measured history.
      if (e.provenance === 'seeded') {
        facts.push(
          `${e.trade}: $${e.suggestedRate.toFixed(2)}/${e.unit} — a rate this contractor SET THEMSELVES (self-reported, not measured on any job here).`,
        );
        seededRateCount++;
        continue;
      }
      const biasNote = Math.abs(e.bidBias) > 0.05
        ? ` (you run ${e.bidBias > 0 ? '+' : ''}${(e.bidBias * 100).toFixed(0)}% vs your bid)`
        : '';
      // A book where every sample is a signed sub nobody has paid is real
      // evidence, but "from your N jobs" reads as a measured cost to the model
      // narrating it. Same qualifier every other prompt surface uses.
      const basisNote = e.earnedBasis === 'contracted' ? CONTRACTED_NOTE : '';
        facts.push(
          `${e.trade}: $${e.suggestedRate.toFixed(2)}/${e.unit} from your ${e.jobCount} job${e.jobCount === 1 ? '' : 's'}${basisNote}${biasNote}.`,
        );
      rateCount++;
    }

    // Add a per-sqft benchmark if we have closed jobs of the same projectType.
    const sameType = projects.filter(
      p =>
        (p.status === 'completed' || p.status === 'closed') &&
        rfp.projectType &&
        p.type === rfp.projectType &&
        p.squareFootage > 0 &&
        (p.linkedEstimate?.items?.length ?? 0) > 0,
    );
    if (sameType.length >= 2) {
      const perSqfts = sameType.map(p => {
        const total = (p.linkedEstimate?.items ?? []).reduce(
          (s: number, i) => s + ((i as { lineTotal?: number }).lineTotal ?? 0),
          0,
        );
        return total / p.squareFootage;
      }).filter((n: number) => n > 0);
      if (perSqfts.length >= 2) {
        const avg = perSqfts.reduce((a, b) => a + b, 0) / perSqfts.length;
        facts.push(
          `Your ${sameType.length} similar ${rfp.projectType} jobs averaged $${Math.round(avg)}/sqft.`,
        );
        rateCount++;
      }
    }

    // Surface calibration bias if meaningful.
    try {
      const cal = computeCalibration({ projects, commitments });
      if (cal.hasData && cal.categories[0]?.direction !== 'aligned') {
        facts.push(cal.categories[0].detail);
      }
    } catch { /* ignore — calibration is additive */ }
  } catch {
    // ignore — grounding is additive, never blocks generation
  }
  return { facts, rateCount, seededRateCount };
}

/** Ask the AI for a rough order-of-magnitude midpoint. Returns null on any
 *  failure so the caller falls back to budget/heuristic. */
async function aiMidpoint(
  rfp: InstantBidRfp,
  opts: Pick<InstantBidOptions, 'groundingContext'>,
): Promise<{ value: number | null; rateCount: number; seededRateCount: number }> {
  const { facts, rateCount, seededRateCount } = buildInstantBidGrounding(opts, rfp);

  // Header must not say "CLOSED JOBS" once seeded rates can appear in the list
  // — each line already declares which kind it is, and the header would
  // otherwise relabel every one of them as measured.
  const groundingSection =
    facts.length > 0
      ? `\n\nTHIS CONTRACTOR'S OWN RATES (each line states whether it came from closed jobs or the contractor set it themselves):\n${facts.map(f => `• ${f}`).join('\n')}\nAnchor the ROM on these rates when the scope overlaps. When a rate covers a line item, use it.`
      : '';

  const prompt =
    'You are a residential construction estimator. Reply with ONLY a single US-dollar ' +
    'rough order-of-magnitude total cost as a plain integer (no words, no currency symbol, ' +
    'no range).' +
    groundingSection + '\n\n' +
    `Project: ${rfp.projectType || rfp.title}. ` +
    `Location: ${[rfp.city, rfp.state].filter(Boolean).join(', ') || 'US'}. ` +
    `Scope: ${rfp.scopeDescription || rfp.title}. ` +
    `${rfp.budgetMin || rfp.budgetMax ? `Homeowner budget hint: $${rfp.budgetMin ?? '?'}–$${rfp.budgetMax ?? '?'}. ` : ''}` +
    'Give one integer dollar total.';
  try {
    const r = await mageAI({ prompt, tier: 'fast', maxTokens: 24 });
    const text = resultText(r);
    return { value: text ? firstNumber(text) : null, rateCount, seededRateCount };
  } catch (e) {
    console.warn('[instantBid] aiMidpoint failed', e);
    return { value: null, rateCount, seededRateCount };
  }
}

async function aiMessage(rfp: InstantBidRfp, opts: InstantBidOptions): Promise<string | null> {
  const prompt =
    'You are a friendly, concise residential general contractor writing a short, warm ' +
    'proposal cover message to a homeowner. 3-4 sentences. No markdown, no salutation like ' +
    '"Dear". Sound human and confident, not salesy. ' +
    // The tiers carry the GC's own warranty line; a model left to its own
    // devices "helpfully" promises a period or a deposit he never stated.
    'Do not state any warranty period, deposit, or payment terms.\n\n' +
    `Project: "${rfp.title}". ` +
    `Location: ${[rfp.city, rfp.state].filter(Boolean).join(', ') || 'unspecified'}. ` +
    `Scope: ${rfp.scopeDescription || 'see request'}. ` +
    `Contractor: ${opts.companyName || 'a local GC'}.` +
    `${opts.contractorNote ? ' Note to include: ' + opts.contractorNote : ''} ` +
    'Write the cover message.';
  try {
    const r = await mageAI({ prompt, tier: 'fast', maxTokens: 220 });
    const text = resultText(r);
    return text && text.length > 20 ? text : null;
  } catch (e) {
    console.warn('[instantBid] aiMessage failed', e);
    return null;
  }
}

/**
 * Generate a tiered Good/Better/Best proposal for an RFP. Never throws —
 * always returns a sendable draft, even fully offline.
 */
export async function generateInstantBid(
  rfp: InstantBidRfp,
  opts: InstantBidOptions = {},
): Promise<TieredProposal> {
  const budgetMid =
    rfp.budgetMin != null && rfp.budgetMax != null
      ? (rfp.budgetMin + rfp.budgetMax) / 2
      : rfp.budgetMax ?? rfp.budgetMin ?? 0;

  // Establish the recommended midpoint. Prefer the grounded AI ROM; blend
  // toward the homeowner's stated budget when both exist so we never ignore
  // their number.
  const { value: aiMidCost, rateCount, seededRateCount } = await aiMidpoint(rfp, opts);
  // The model returns COST. The homeowner is quoted a PRICE. Apply the
  // contractor's own markup to the cost side ONLY: `budgetMid` is what the
  // homeowner said they were willing to pay, which is already a price, and
  // marking that up would be quoting a markup on the client's own budget.
  const markupPct = typeof opts.markupPct === 'number' && opts.markupPct > 0 ? opts.markupPct : 0;
  const aiMid = aiMidCost != null ? aiMidCost * (1 + markupPct / 100) : null;
  let midUsd: number;
  let source: 'ai' | 'heuristic';
  let basis: TieredProposal['basis'];

  if (aiMid && aiMid > 0) {
    if (budgetMid > 0) {
      midUsd = aiMid * 0.5 + budgetMid * 0.5;
      basis = 'budget'; // blended — budget was the anchor
    } else {
      midUsd = aiMid;
      // Deliberately EARNED-only. A seeded-only book anchors the ROM (which is
      // the whole point of seeding) but must not set basis='history' — that
      // flag drives the "anchored on your closed jobs" copy in the UI and the
      // brain's instant_bid_sent prediction row. Understating it as 'ai_guess'
      // is the safe direction; the assumptions list below tells the truth.
      basis = rateCount > 0 ? 'history' : 'ai_guess';
    }
    source = 'ai';
  } else {
    midUsd = budgetMid > 0 ? budgetMid : 15_000;
    source = 'heuristic';
    basis = budgetMid > 0 ? 'budget' : 'ai_guess';
  }

  const assumptions = [
    'Rough order-of-magnitude based on the scope provided — final price set after a site visit.',
    // The honesty line. The ROM the model produces is a COST estimate; if no
    // markup was supplied, this proposal contains no overhead and no profit
    // and the contractor is entitled to be told so on the artifact itself
    // rather than discovering it at job close.
    ...(markupPct > 0
      ? [`Includes your ${markupPct}% markup on cost.`]
      : ['NO MARKUP APPLIED — this is a cost estimate. It carries no overhead and no profit.']),
    budgetMid > 0 ? 'Blended toward the budget range you posted.' : 'No budget range posted; numbers are indicative.',
    ...(rateCount > 0 ? [`Anchored on ${rateCount} learned rate${rateCount === 1 ? '' : 's'} from your closed jobs.`] : []),
    // Separate line, separate wording. Never merged into the count above.
    ...(seededRateCount > 0
      ? [`Anchored on ${seededRateCount} rate${seededRateCount === 1 ? '' : 's'} you set yourself — your numbers, not yet measured on a job here.`]
      : []),
  ];

  const scopeBullets = scopeToBullets(rfp.scopeDescription);
  const tiers: ProposalTier[] = (['good', 'better', 'best'] as ProposalTierKey[]).map(k =>
    buildTier(k, midUsd, scopeBullets, opts.warrantyMonths ?? null, opts.financing),
  );

  const drafted = await aiMessage(rfp, opts);
  const message = drafted ?? heuristicMessage(rfp, opts);

  return {
    kind: 'tiered_proposal_v1',
    tiers,
    recommendedTier: 'better',
    message,
    assumptions,
    source: drafted ? source : 'heuristic',
    basis,
    groundingRateCount: rateCount > 0 ? rateCount : undefined,
    generatedAt: new Date().toISOString(),
  };
}

/** Safe parse of a stored proposal (estimate_breakdown jsonb → object/string). */
export function parseTieredProposal(raw: unknown): TieredProposal | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const p = obj as TieredProposal;
    if (p?.kind === 'tiered_proposal_v1' && Array.isArray(p.tiers)) return p;
    return null;
  } catch {
    return null;
  }
}

/** Pull the recommended tier (or the first) for headline display. */
export function recommendedTierOf(p: TieredProposal): ProposalTier {
  return p.tiers.find(t => t.key === p.recommendedTier) ?? p.tiers[0];
}
