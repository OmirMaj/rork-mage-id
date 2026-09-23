// proposalBuilder.ts — turn an estimate into a client-ready good/better/best
// proposal, priced by the Win Optimizer.
//
// Jobber and Housecall both monetize the "send a tiered proposal" flow, but
// neither prices the tiers by expected value. We do: the three tiers are the
// optimizer's aggressive / recommended / premium points dressed in client
// language — Essential (lean), Signature (flagship, the one we recommend),
// Premium (white-glove). The GC sees win odds and expected profit per tier
// in-app; the CLIENT never does. `proposalToShareText` is the only thing that
// leaves the building, and it carries prices + inclusions only.
//
// Pure module — no storage, no network, no React. The learning loop closes
// elsewhere: an accepted/declined proposal flips the linked Lead to won/lost,
// which is exactly the history `computeWinOptimizer` calibrates from.

import type { Lead } from '@/types';
import { computeWinOptimizer, type BidPoint } from '@/utils/winOptimizer';
import { formatMoney } from '@/utils/formatters';
import { generateUUID } from '@/utils/generateId';
import { workmanshipWarrantyLine } from '@/utils/paymentTerms';

export type ProposalTierKey = 'essential' | 'signature' | 'premium';

export interface ProposalTier {
  key: ProposalTierKey;
  /** Client-facing tier name ("Essential" / "Signature" / "Premium"). */
  label: string;
  /** Client-safe one-liner under the tier name. */
  tagline: string;
  /** Bid price for this tier. */
  price: number;
  /** Markup over cost, as a fraction. GC-ONLY — never in client output. */
  markup: number;
  /** Modeled win odds at this price, 0..1. GC-ONLY. */
  winProbability: number;
  /** profit × winProbability. GC-ONLY. */
  expectedProfit: number;
  /** Editable, client-safe scope bullets. Sensible defaults per tier. */
  inclusions: string[];
  /** True for the tier we want the client to pick (Signature). */
  recommended: boolean;
}

export interface BuildProposalInput {
  /** True job cost BEFORE markup. Must be > 0. */
  cost: number;
  /** Lead history — calibrates the win curve. Empty array is fine (cold start). */
  leads: Pick<Lead, 'stage' | 'lostReason'>[];
  /**
   * The GC's usual markup. Accepts either form: values > 1 are treated as
   * percents (18 → 0.18), values ≤ 1 as fractions (0.18 → 0.18).
   */
  typicalMarkup?: number;
  competitorCount?: number;
  clientName?: string;
  projectName?: string;
  scopeSummary?: string;
  /**
   * The GC's saved workmanship warranty in months (settings.warrantyMonths via
   * utils/paymentTerms.resolveWarrantyMonths), or null/absent when he has never
   * set one. Every tier prints this ONE period — a tier ladder must not promise
   * a 1-, 2- or 5-year guarantee nobody chose — and with no answer the line is
   * "Workmanship warranty" with no period at all.
   */
  warrantyMonths?: number | null;
  /** His saved licence number (settings.branding.licenseNumber). Printed on the
   *  Essential tier only when set — never an unstated "licensed, insured". */
  licenseNumber?: string | null;
}

export interface ProposalTiersResult {
  cost: number;
  /** Always [essential, signature, premium], ascending price. */
  tiers: ProposalTier[];
  /** Plain-English reasoning — for the GC-facing "why these prices" panel. */
  drivers: string[];
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
}

/**
 * A saved proposal. Defined here (not types/index.ts) to keep this stacked
 * branch conflict-free with main.
 */
export interface SmartProposal {
  id: string;
  projectId?: string;
  leadId?: string;
  clientName: string;
  /** Optional display name for the job, used in the share text header. */
  projectName?: string;
  tiers: ProposalTier[];
  selectedTierKey?: ProposalTierKey;
  status: 'draft' | 'sent' | 'accepted' | 'declined';
  /**
   * How the proposal was authored. Absence means the classic tiered flow
   * (smart-proposal.tsx) — keeps every existing record valid without a
   * migration. `'quick'` is a Quick Quote: a single flat-priced tier for a
   * small job. Filter on this to list Quick Quotes separately.
   */
  kind?: 'quick' | 'tiered';
  /**
   * A Quick Quote's client-safe breakdown (#90): each line at its SELL amount
   * (markup folded in, never printed as its own row), the sales tax, and the
   * total — every figure on the cent grid, so the printed lines foot to the
   * printed total. Absent on quotes saved before it existed; those render
   * their descriptions without amounts.
   */
  quick?: QuickQuoteClientBreakdown;
  createdAt: string;
  updatedAt: string;
}

/** A single Quick Quote line item — a plain-English scope line and its price. */
export interface QuickQuoteLineItem {
  description: string;
  amount: number;
}

/** What the CLIENT sees of a Quick Quote — sell figures only. */
export interface QuickQuoteClientBreakdown {
  lines: QuickQuoteLineItem[];
  /** Σ lines — the pre-tax price. */
  subtotal: number;
  taxPct: number;
  tax: number;
  total: number;
}

/** The whole Quick Quote arithmetic, for the screen AND the saved quote. */
export interface QuickQuoteTotals extends QuickQuoteClientBreakdown {
  /** Σ the amounts he typed (his figures, before markup). GC-only. */
  costSubtotal: number;
  markupPct: number;
  /** subtotal − costSubtotal. GC-only. */
  markup: number;
}

const cents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/**
 * Quick Quote totals on the cent grid (#90).
 *
 * Every typed amount is rounded to the cent, each line's SELL amount is
 * round2(amount × (1 + markup)), the pre-tax subtotal is the sum of those
 * printed lines, tax is round2(subtotal × tax%), and the total is their sum —
 * so what the client reads adds up line by line. $1,000 + $1,234.56 at 7% tax
 * is $2,234.56 + $156.42 = $2,390.98. The share text used to print that as
 * "$2,391" (formatMoney's default is whole dollars).
 */
export function quickQuoteTotals(input: Pick<BuildQuickQuoteInput, 'lineItems' | 'markupPct' | 'taxPct'>): QuickQuoteTotals {
  const markupPct = input.markupPct && input.markupPct > 0 ? input.markupPct : 0;
  const taxPct = input.taxPct && input.taxPct > 0 ? input.taxPct : 0;
  const typed = input.lineItems.map(li => ({
    description: li.description,
    amount: cents(Number.isFinite(li.amount) ? li.amount : 0),
  }));
  const lines = typed.map(li => ({ description: li.description, amount: cents(li.amount * (1 + markupPct / 100)) }));
  const costSubtotal = cents(typed.reduce((s, li) => s + li.amount, 0));
  const subtotal = cents(lines.reduce((s, li) => s + li.amount, 0));
  const tax = cents(subtotal * (taxPct / 100));
  return {
    lines, subtotal, taxPct, tax, total: cents(subtotal + tax),
    costSubtotal, markupPct, markup: cents(subtotal - costSubtotal),
  };
}

export interface BuildQuickQuoteInput {
  clientName: string;
  jobTitle: string;
  scope?: string;
  lineItems: QuickQuoteLineItem[];
  /** Markup as a percent (e.g. 15 → 15%). Absent/≤0 means no markup. */
  markupPct?: number;
  /** Sales tax as a percent, applied to subtotal + markup. Absent/≤0 means none. */
  taxPct?: number;
}

/**
 * Build a Quick Quote — DMG-Pro-style fast path for small jobs. A single
 * flat-priced tier, no Win Optimizer curve: the GC types line items and an
 * optional markup/tax, and gets one professional number to send.
 *
 * Pure — no storage, no network, no React. subtotal = Σ line amounts;
 * markup = subtotal × markupPct%; tax = (subtotal + markup) × taxPct%;
 * total = subtotal + markup + tax. The single tier reuses ProposalTier so
 * `proposalToShareText` (which just loops tiers) renders it unchanged.
 */
export function buildQuickQuote(input: BuildQuickQuoteInput): SmartProposal {
  const q = quickQuoteTotals(input);

  const now = new Date().toISOString();
  const tier: ProposalTier = {
    key: 'signature',
    label: input.jobTitle || 'Quote',
    tagline: input.scope ?? '',
    // The total on the cent grid — the number the client is asked to accept.
    price: q.total,
    markup: q.markupPct ? q.markupPct / 100 : 0,
    winProbability: 0,
    expectedProfit: 0,
    inclusions: input.lineItems.map((li) => li.description).filter(Boolean),
    // One option is not "the most popular" of anything (#90).
    recommended: false,
  };

  return {
    id: generateUUID(),
    clientName: input.clientName,
    projectName: input.jobTitle,
    tiers: [tier],
    kind: 'quick',
    quick: { lines: q.lines, subtotal: q.subtotal, taxPct: q.taxPct, tax: q.tax, total: q.total },
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

/** Normalize a markup that may arrive as a percent (18) or a fraction (0.18). */
export function normalizeMarkup(m: number | undefined): number | undefined {
  if (m === undefined || !Number.isFinite(m) || m <= 0) return undefined;
  return m > 1 ? m / 100 : m;
}

// Default inclusions per tier. Client-safe wording only — these ship in the
// share text, so no pricing internals and none of the GC-only vocabulary.
// The warranty line is NOT in these lists: until 2026-09-17 they promised a
// 1-, 2- and 5-year guarantee the GC never stated. buildProposalTiers appends
// workmanshipWarrantyLine(his saved months) to every tier instead.
// Nor is "Licensed and insured crew" (#90): the app holds no insurance record
// for him at all, and a licence only when he saved one. licenseLine() below
// states the licence he saved, and nothing is said about insurance.
const ESSENTIAL_INCLUSIONS: string[] = [
  'Full scope of work as discussed',
  'Quality standard-grade materials',
];

/** "Licensed contractor — License #123", from his saved branding.licenseNumber
 *  only; null when he has not saved one, so nothing is claimed (#90). */
export function licenseLine(licenseNumber?: string | null): string | null {
  const n = typeof licenseNumber === 'string' ? licenseNumber.trim() : '';
  return n ? `Licensed contractor — License #${n.replace(/^#/, '')}` : null;
}

const SIGNATURE_INCLUSIONS: string[] = [
  'Everything in Essential',
  'Upgraded material allowances',
  'Dedicated project manager',
  'Weekly photo progress updates',
];

const PREMIUM_INCLUSIONS: string[] = [
  'Everything in Signature',
  'Premium material and finish allowances',
  'Priority scheduling',
  'Daily site cleanup',
  'Six-month post-completion walkthrough',
];

/**
 * Build the three proposal tiers from the Win Optimizer's curve.
 *
 * Essential  = the optimizer's `aggressive` point (price-to-win, lean scope).
 * Signature  = `recommended` (max expected profit — the flagship, marked recommended).
 * Premium    = `premium` point (hold-margin, white-glove scope).
 */
export function buildProposalTiers(input: BuildProposalInput): ProposalTiersResult {
  const result = computeWinOptimizer({
    cost: input.cost,
    leads: input.leads,
    typicalMarkup: normalizeMarkup(input.typicalMarkup),
    competitorCount: input.competitorCount,
  });

  // Same warranty on every tier (founder decision 2026-09-17): his one saved
  // period, or "Workmanship warranty" with no period until he sets one.
  const warrantyLine = workmanshipWarrantyLine(input.warrantyMonths ?? null);
  const license = licenseLine(input.licenseNumber);

  const tier = (
    key: ProposalTierKey,
    label: string,
    tagline: string,
    point: BidPoint,
    inclusions: string[],
    recommended: boolean,
  ): ProposalTier => ({
    key,
    label,
    tagline,
    price: point.price,
    markup: point.markup,
    winProbability: point.winProbability,
    expectedProfit: point.expectedProfit,
    inclusions: [...inclusions, warrantyLine],
    recommended,
  });

  const tiers: ProposalTier[] = [
    tier(
      'essential',
      'Essential',
      'The job done right, at the sharpest price.',
      result.aggressive,
      license ? [...ESSENTIAL_INCLUSIONS, license] : ESSENTIAL_INCLUSIONS,
      false,
    ),
    tier(
      'signature',
      'Signature',
      'Our most popular package — the best balance of value and finish.',
      result.recommended,
      SIGNATURE_INCLUSIONS,
      true,
    ),
    tier(
      'premium',
      'Premium',
      'White-glove service and top-shelf materials, start to finish.',
      result.premium,
      PREMIUM_INCLUSIONS,
      false,
    ),
  ];

  return {
    cost: result.cost,
    tiers,
    drivers: result.drivers,
    confidence: result.confidence,
    sampleSize: result.sampleSize,
  };
}

/**
 * Client-safe plain-text version of a proposal, for Share / email / SMS.
 *
 * HARD RULE: nothing internal leaves the building. No win odds, no expected
 * profit, no markup, no cost basis — prices and inclusions only.
 *
 * A Quick Quote (kind 'quick') is ONE price, so it reads as a quote (#90):
 * "QUOTE", its lines with their amounts, the total to the cent, one call to
 * action — no "★ Most popular" on the only option and no "Every option…"
 * footer. The tiered footer no longer claims a "licensed, insured team": the
 * licence line prints only from his saved number (`opts.licenseNumber`), and
 * insurance is never claimed because the app holds no record of it.
 */
export function proposalToShareText(
  proposal: SmartProposal,
  opts: { licenseNumber?: string | null } = {},
): string {
  const lines: string[] = [];
  const divider = '──────────────────────';
  const license = licenseLine(opts.licenseNumber);

  if (proposal.kind === 'quick') {
    const t = proposal.tiers[0];
    const q = proposal.quick;
    lines.push(`QUOTE${proposal.projectName ? ` — ${proposal.projectName}` : ''}`);
    if (proposal.clientName) lines.push(`Prepared for ${proposal.clientName}`);
    lines.push('');
    lines.push(divider);
    if (t?.tagline?.trim()) lines.push(t.tagline.trim());
    if (q && q.lines.length > 0) {
      for (const li of q.lines) lines.push(`  • ${li.description.trim() || 'Line item'} — ${formatMoney(li.amount, 2)}`);
      if (q.tax > 0) {
        lines.push('');
        lines.push(`Subtotal — ${formatMoney(q.subtotal, 2)}`);
        lines.push(`Sales tax (${q.taxPct}%) — ${formatMoney(q.tax, 2)}`);
      }
    } else if (t) {
      // A quote saved before the breakdown existed: its descriptions only.
      for (const inc of t.inclusions) lines.push(`  • ${inc}`);
    }
    lines.push('');
    lines.push(`TOTAL — ${formatMoney(q?.total ?? t?.price ?? 0, 2)}`);
    lines.push(divider);
    if (license) lines.push(license);
    lines.push('Reply to accept this quote.');
    return lines.join('\n');
  }

  lines.push(`PROPOSAL${proposal.projectName ? ` — ${proposal.projectName}` : ''}`);
  if (proposal.clientName) lines.push(`Prepared for ${proposal.clientName}`);
  lines.push('');

  const several = proposal.tiers.length > 1;
  for (const t of proposal.tiers) {
    lines.push(divider);
    lines.push(`${t.label.toUpperCase()}${several && t.recommended ? '  ★ Most popular' : ''} — ${formatMoney(t.price, 2)}`);
    if (t.tagline?.trim()) lines.push(t.tagline.trim());
    for (const inc of t.inclusions) lines.push(`  • ${inc}`);
    lines.push('');
  }

  lines.push(divider);
  if (license) lines.push(license);
  lines.push(several
    ? 'Every option is delivered by the same team. To move forward, just reply with the option that fits best.'
    : 'To move forward, just reply to this message.');

  return lines.join('\n');
}
