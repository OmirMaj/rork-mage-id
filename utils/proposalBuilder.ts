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
  createdAt: string;
  updatedAt: string;
}

/** A single Quick Quote line item — a plain-English scope line and its price. */
export interface QuickQuoteLineItem {
  description: string;
  amount: number;
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
  const subtotal = input.lineItems.reduce(
    (sum, li) => sum + (Number.isFinite(li.amount) ? li.amount : 0),
    0,
  );
  const markupPct = input.markupPct && input.markupPct > 0 ? input.markupPct : 0;
  const taxPct = input.taxPct && input.taxPct > 0 ? input.taxPct : 0;
  const markup = subtotal * (markupPct / 100);
  const tax = (subtotal + markup) * (taxPct / 100);
  const total = subtotal + markup + tax;

  const now = new Date().toISOString();
  const tier: ProposalTier = {
    key: 'signature',
    label: input.jobTitle || 'Quote',
    tagline: input.scope ?? '',
    price: total,
    markup: markupPct ? markupPct / 100 : 0,
    winProbability: 0,
    expectedProfit: 0,
    inclusions: input.lineItems.map((li) => li.description).filter(Boolean),
    recommended: true,
  };

  return {
    id: generateUUID(),
    clientName: input.clientName,
    projectName: input.jobTitle,
    tiers: [tier],
    kind: 'quick',
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
const ESSENTIAL_INCLUSIONS: string[] = [
  'Full scope of work as discussed',
  'Quality standard-grade materials',
  'Licensed and insured crew',
  '1-year workmanship guarantee',
];

const SIGNATURE_INCLUSIONS: string[] = [
  'Everything in Essential',
  'Upgraded material allowances',
  'Dedicated project manager',
  'Weekly photo progress updates',
  '2-year workmanship guarantee',
];

const PREMIUM_INCLUSIONS: string[] = [
  'Everything in Signature',
  'Premium material and finish allowances',
  'Priority scheduling',
  'Daily site cleanup',
  '5-year workmanship guarantee',
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
    inclusions: [...inclusions],
    recommended,
  });

  const tiers: ProposalTier[] = [
    tier(
      'essential',
      'Essential',
      'The job done right, at the sharpest price.',
      result.aggressive,
      ESSENTIAL_INCLUSIONS,
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
 */
export function proposalToShareText(proposal: SmartProposal): string {
  const lines: string[] = [];
  const divider = '──────────────────────';

  lines.push(`PROPOSAL${proposal.projectName ? ` — ${proposal.projectName}` : ''}`);
  if (proposal.clientName) lines.push(`Prepared for ${proposal.clientName}`);
  lines.push('');

  for (const t of proposal.tiers) {
    lines.push(divider);
    lines.push(`${t.label.toUpperCase()}${t.recommended ? '  ★ Most popular' : ''} — ${formatMoney(t.price)}`);
    lines.push(t.tagline);
    for (const inc of t.inclusions) lines.push(`  • ${inc}`);
    lines.push('');
  }

  lines.push(divider);
  lines.push('Every option is delivered by the same licensed, insured team.');
  lines.push('To move forward, just reply with the option that fits best.');

  return lines.join('\n');
}
