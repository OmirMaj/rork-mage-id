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

import { mageAI, type AIMessage } from '@/utils/mageAI';
import { illustrativeMonthly } from '@/utils/financing';
import type {
  FinancingConfig,
  ProposalTier,
  ProposalTierKey,
  TieredProposal,
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

/** Ask the AI for a rough order-of-magnitude midpoint. Returns null on any
 *  failure so the caller falls back to budget/heuristic. */
async function aiMidpoint(rfp: InstantBidRfp): Promise<number | null> {
  const msgs: AIMessage[] = [
    {
      role: 'system',
      content:
        'You are a residential construction estimator. Given a project, reply with ONLY a single US-dollar rough order-of-magnitude total cost as a plain integer (no words, no currency symbol, no range). If unsure, give your best single-number guess.',
    },
    {
      role: 'user',
      content: `Project: ${rfp.projectType || rfp.title}. Location: ${[rfp.city, rfp.state].filter(Boolean).join(', ') || 'US'}. Scope: ${rfp.scopeDescription || rfp.title}. ${rfp.budgetMin || rfp.budgetMax ? `Homeowner budget hint: ${rfp.budgetMin ?? '?'}-${rfp.budgetMax ?? '?'}.` : ''} Give one integer dollar total.`,
    },
  ];
  try {
    const out = await mageAI(msgs);
    return firstNumber(out);
  } catch (e) {
    console.warn('[instantBid] aiMidpoint failed', e);
    return null;
  }
}

async function aiMessage(rfp: InstantBidRfp, opts: InstantBidOptions): Promise<string | null> {
  const msgs: AIMessage[] = [
    {
      role: 'system',
      content:
        'You are a friendly, concise residential general contractor writing a short, warm proposal cover message to a homeowner. 3-4 sentences. No markdown, no salutation like "Dear". Sound human and confident, not salesy.',
    },
    {
      role: 'user',
      content: `Project: "${rfp.title}". Location: ${[rfp.city, rfp.state].filter(Boolean).join(', ') || 'unspecified'}. Scope: ${rfp.scopeDescription || 'see request'}. Contractor: ${opts.companyName || 'a local GC'}.${opts.contractorNote ? ' Note to include: ' + opts.contractorNote : ''} Write the cover message.`,
    },
  ];
  try {
    const out = await mageAI(msgs);
    const trimmed = out.trim();
    return trimmed.length > 20 ? trimmed : null;
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

  // Establish the recommended midpoint. Prefer the AI ROM; blend toward the
  // homeowner's stated budget when both exist so we never ignore their number.
  const aiMid = await aiMidpoint(rfp);
  let midUsd: number;
  let source: 'ai' | 'heuristic';
  if (aiMid && aiMid > 0) {
    midUsd = budgetMid > 0 ? aiMid * 0.5 + budgetMid * 0.5 : aiMid;
    source = 'ai';
  } else {
    midUsd = budgetMid > 0 ? budgetMid : 15_000;
    source = 'heuristic';
  }

  const assumptions = [
    'Rough order-of-magnitude based on the scope provided — final price set after a site visit.',
    budgetMid > 0 ? 'Blended toward the budget range you posted.' : 'No budget range posted; numbers are indicative.',
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
