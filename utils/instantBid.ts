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
import { computeCalibration } from '@/utils/estimateCalibration';
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
  };
}

const TIER_META: Record<ProposalTierKey, { label: string; tagline: string; mult: number }> = {
  // Multipliers anchor each tier off the recommended ("better") midpoint so
  // the spread reads like a real Good/Better/Best ladder (~-18% / base / +22%).
  good: { label: 'Essential', tagline: 'Covers the core scope, value-engineered.', mult: 0.82 },
  better: { label: 'Recommended', tagline: 'The balanced option most homeowners pick.', mult: 1.0 },
  best: { label: 'Premium', tagline: 'Upgraded materials, finishes, and warranty.', mult: 1.22 },
};

const TIER_EXTRAS: Record<ProposalTierKey, string[]> = {
  good: ['Standard-grade materials', 'Workmanship warranty (1 yr)'],
  better: ['Mid-grade materials & fixtures', 'Workmanship warranty (2 yr)', 'Dedicated project updates'],
  best: ['Premium materials & finishes', 'Extended warranty (5 yr)', 'Priority scheduling', 'Final walkthrough + punch list'],
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
  financing?: FinancingConfig,
): ProposalTier {
  const meta = TIER_META[key];
  const amount = roundQuote(baseMid * meta.mult);
  return {
    key,
    label: meta.label,
    tagline: meta.tagline,
    amount,
    inclusions: [...scopeBullets, ...TIER_EXTRAS[key]],
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
    `I've put together three options below so you can pick the scope and budget that fits. Happy to walk the site and refine any of them — we can typically start within 2–3 weeks.`,
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
 * Returns { facts, rateCount } — rateCount=0 means no data.
 */
function buildInstantBidGrounding(
  opts: Pick<InstantBidOptions, 'groundingContext'>,
  rfp: InstantBidRfp,
): { facts: string[]; rateCount: number } {
  const facts: string[] = [];
  let rateCount = 0;
  if (!opts.groundingContext) return { facts, rateCount };
  const { projects, commitments, receipts, laborSamples } = opts.groundingContext;
  try {
    const db = buildCostDatabase(projects, commitments, receipts, laborSamples);
    // Pull the most-relevant entries (high-confidence first, up to 4 facts).
    const sorted = [...db.entries].sort((a, b) => {
      const rankConf = (e: typeof a) => e.confidence === 'high' ? 2 : e.confidence === 'medium' ? 1 : 0;
      return rankConf(b) - rankConf(a) || b.totalActual - a.totalActual;
    });
    for (const e of sorted.slice(0, 4)) {
      const biasNote = Math.abs(e.bidBias) > 0.05
        ? ` (you run ${e.bidBias > 0 ? '+' : ''}${(e.bidBias * 100).toFixed(0)}% vs your bid)`
        : '';
        facts.push(
          `${e.trade}: $${e.suggestedRate.toFixed(2)}/${e.unit} from your ${e.jobCount} job${e.jobCount === 1 ? '' : 's'}${biasNote}.`,
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
  return { facts, rateCount };
}

/** Ask the AI for a rough order-of-magnitude midpoint. Returns null on any
 *  failure so the caller falls back to budget/heuristic. */
async function aiMidpoint(
  rfp: InstantBidRfp,
  opts: Pick<InstantBidOptions, 'groundingContext'>,
): Promise<{ value: number | null; rateCount: number }> {
  const { facts, rateCount } = buildInstantBidGrounding(opts, rfp);

  const groundingSection =
    facts.length > 0
      ? `\n\nLEARNED RATES FROM THIS CONTRACTOR'S CLOSED JOBS:\n${facts.map(f => `• ${f}`).join('\n')}\nAnchor the ROM on these learned rates when the scope overlaps. When a rate covers a line item, use it.`
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
    return { value: text ? firstNumber(text) : null, rateCount };
  } catch (e) {
    console.warn('[instantBid] aiMidpoint failed', e);
    return { value: null, rateCount };
  }
}

async function aiMessage(rfp: InstantBidRfp, opts: InstantBidOptions): Promise<string | null> {
  const prompt =
    'You are a friendly, concise residential general contractor writing a short, warm ' +
    'proposal cover message to a homeowner. 3-4 sentences. No markdown, no salutation like ' +
    '"Dear". Sound human and confident, not salesy.\n\n' +
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
  const { value: aiMid, rateCount } = await aiMidpoint(rfp, opts);
  let midUsd: number;
  let source: 'ai' | 'heuristic';
  let basis: TieredProposal['basis'];

  if (aiMid && aiMid > 0) {
    if (budgetMid > 0) {
      midUsd = aiMid * 0.5 + budgetMid * 0.5;
      basis = 'budget'; // blended — budget was the anchor
    } else {
      midUsd = aiMid;
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
    budgetMid > 0 ? 'Blended toward the budget range you posted.' : 'No budget range posted; numbers are indicative.',
    ...(rateCount > 0 ? [`Anchored on ${rateCount} learned rate${rateCount === 1 ? '' : 's'} from your closed jobs.`] : []),
  ];

  const scopeBullets = scopeToBullets(rfp.scopeDescription);
  const tiers: ProposalTier[] = (['good', 'better', 'best'] as ProposalTierKey[]).map(k =>
    buildTier(k, midUsd, scopeBullets, opts.financing),
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
