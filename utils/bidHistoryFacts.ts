// utils/bidHistoryFacts.ts — builds win-rate facts from the GC's decided bids.
//
// "Decided" = a bid whose outcome is known (won or lost). Bids still pending
// are excluded — they haven't resolved yet and would corrupt the denominator.
//
// Source: SubBidRecord[] drawn from Subcontractor.bidHistory across all subs
// (the sub-bid records the GC creates when evaluating packages). This gives
// real outcome signals: won/lost/pending from the GC's perspective.
//
// When fewer than 3 decided bids exist the win probability is unknowable — we
// return null rather than a hallucinated number. The renderers show an honest
// message ("Not enough decided bids to estimate odds") instead of a fake %.
//
// Pure function — no storage, no network, safe to call in any context.

import type { SubBidRecord } from '@/types';

export interface BidHistoryFacts {
  /** Prompt-ready fact lines, one per bucket, e.g.:
   *  "Overall: 4 of 9 decided bids won (44% win rate)."
   *  "Mid-size ($100K–$500K): 2 of 4 won (50%)."
   *  Empty array when no decided bids exist. */
  facts: string[];
  /** Decided bid count (won + lost). Used to gate winProbability. */
  decidedCount: number;
  /** Overall win rate 0–1. null when decidedCount < MIN_DECIDED. */
  overallWinRate: number | null;
}

/** Minimum decided bids before we publish a win rate. */
const MIN_DECIDED = 3;

function sizeLabel(amount: number): string {
  if (amount < 50_000)  return 'Small (<$50K)';
  if (amount < 200_000) return 'Mid-small ($50K–$200K)';
  if (amount < 500_000) return 'Mid ($200K–$500K)';
  if (amount < 2_000_000) return 'Large ($500K–$2M)';
  return 'Major ($2M+)';
}

function sizeKey(amount: number): string {
  if (amount < 50_000)  return 'xs';
  if (amount < 200_000) return 'sm';
  if (amount < 500_000) return 'md';
  if (amount < 2_000_000) return 'lg';
  return 'xl';
}

/**
 * Distil SubBidRecord[] into prompt-ready win-rate facts.
 *
 * Accepts the flat list of ALL bid records (e.g. gathered from all
 * Subcontractor.bidHistory entries, or from a dedicated bid tracker).
 * Returns `winProbability: null` facts when fewer than MIN_DECIDED records
 * exist — callers MUST honour the null and render the honest fallback.
 */
export function bidHistoryFacts(records: SubBidRecord[]): BidHistoryFacts {
  const decided = records.filter(r => r.outcome === 'won' || r.outcome === 'lost');
  const wonTotal = decided.filter(r => r.outcome === 'won').length;

  if (decided.length < MIN_DECIDED) {
    return { facts: [], decidedCount: decided.length, overallWinRate: null };
  }

  const overallRate = wonTotal / decided.length;
  const facts: string[] = [];

  facts.push(
    `Overall bid win rate: ${wonTotal} of ${decided.length} decided bids won (${Math.round(overallRate * 100)}%).`
  );

  // Per-size bucket — only emit buckets with ≥ 2 decided bids.
  const buckets = new Map<string, { label: string; won: number; total: number }>();
  for (const r of decided) {
    const k = sizeKey(r.bidAmount);
    if (!buckets.has(k)) buckets.set(k, { label: sizeLabel(r.bidAmount), won: 0, total: 0 });
    const b = buckets.get(k)!;
    b.total++;
    if (r.outcome === 'won') b.won++;
  }

  for (const b of buckets.values()) {
    if (b.total < 2) continue;
    facts.push(
      `${b.label}: ${b.won} of ${b.total} won (${Math.round((b.won / b.total) * 100)}%).`
    );
  }

  return { facts, decidedCount: decided.length, overallWinRate: overallRate };
}

/**
 * Render the injectable prompt block.
 * Returns '' when there are no decided bids (callers concatenate safely).
 */
export function bidHistoryFactsBlock(histFacts: BidHistoryFacts): string {
  if (histFacts.facts.length === 0) return '';
  return [
    'YOUR BID WIN HISTORY (measured from your own decided bids):',
    ...histFacts.facts.map(f => `- ${f}`),
    'Derive winProbability from these measured rates. When a size-bucket matches, prefer that rate over the overall rate.',
  ].join('\n');
}
