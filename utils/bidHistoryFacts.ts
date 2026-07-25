// utils/bidHistoryFacts.ts — builds win-rate facts from the GC's OWN
// outbound (prime) bids.
//
// ── POPULATION RULE (pinned by scripts/validate-bid-history-facts.ts) ──
// "YOUR BID WIN HISTORY" may ONLY be built from bids the GC themselves
// SUBMITTED to an owner/agency/homeowner — i.e. outcomes of the GC bidding
// OUT. Today the one real source is the marketplace `bid_responses` table
// (the GC's submitted RFP responses): status 'awarded' → won,
// 'declined' → lost, 'submitted'/'shortlisted' → pending (undecided),
// 'withdrawn' → excluded entirely (the GC pulled out; the market never
// decided).
//
// NEVER feed Subcontractor.bidHistory (SubBidRecord) into these facts.
// Those are subs' bids INTO the GC's packages — a different statistical
// population. With k subs bidding per package and one winner, the pooled
// "win rate" converges to ~1/k regardless of how good the GC actually is
// at winning prime work; presenting it as "your win history" is wrong for
// every GC. (This exact bug shipped once — see the 2026-07 tribunal
// finding "Bid win-probability grounded on the wrong population".)
//
// "Decided" = a bid whose outcome is known (won or lost). Pending bids are
// excluded — they haven't resolved yet and would corrupt the denominator.
//
// When fewer than 3 decided bids exist the win probability is unknowable —
// we return null rather than a hallucinated number. The renderers show an
// honest message ("Not enough decided bids to estimate odds") instead of a
// fake %.
//
// Pure functions — no storage, no network, safe to call in any context.

/** One of the GC's own outbound bids, reduced to what win-rate math needs.
 *  bidAmount <= 0 means "amount unknown" (e.g. a site-visit-first response
 *  that was still awarded) — counted in the overall rate, excluded from
 *  size buckets. */
export interface OutboundBidRecord {
  bidAmount: number;
  outcome: 'won' | 'lost' | 'pending';
}

/** Minimal row shape from the `bid_responses` table. */
export interface BidResponseRow {
  bid_amount: number | null;
  status: string;
}

/**
 * Map the GC's own `bid_responses` rows (their submitted marketplace bids)
 * to outbound-bid records. This is the ONLY sanctioned client-side source
 * for bidHistoryFacts today — see the population rule above.
 */
export function outboundBidRecordsFromResponses(rows: BidResponseRow[]): OutboundBidRecord[] {
  const out: OutboundBidRecord[] = [];
  for (const r of rows) {
    const outcome =
      r.status === 'awarded' ? 'won'
      : r.status === 'declined' ? 'lost'
      : r.status === 'submitted' || r.status === 'shortlisted' ? 'pending'
      : null; // 'withdrawn' (or unknown) — not a market decision, exclude.
    if (outcome === null) continue;
    const amount = typeof r.bid_amount === 'number' && Number.isFinite(r.bid_amount) ? r.bid_amount : 0;
    out.push({ bidAmount: amount, outcome });
  }
  return out;
}

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
 * Distil the GC's own outbound-bid records into prompt-ready win-rate facts.
 *
 * Input MUST satisfy the population rule at the top of this file (the GC's
 * own submitted bids — e.g. via outboundBidRecordsFromResponses). Returns
 * `overallWinRate: null` when fewer than MIN_DECIDED decided records exist —
 * callers MUST honour the null and render the honest fallback.
 */
export function bidHistoryFacts(records: OutboundBidRecord[]): BidHistoryFacts {
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

  // Per-size bucket — only emit buckets with ≥ 2 decided bids. Records with
  // no known amount (bidAmount <= 0) stay out of the buckets: they'd all
  // pool into the smallest bucket and skew its rate.
  const buckets = new Map<string, { label: string; won: number; total: number }>();
  for (const r of decided) {
    if (r.bidAmount <= 0) continue;
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
 * The instruction names the EXACT schema field (`estimatedWinProbability`)
 * — a fast-tier model told to fill "winProbability" emits a field Zod
 * silently strips, so the UI would wrongly show the no-history fallback.
 */
export function bidHistoryFactsBlock(histFacts: BidHistoryFacts): string {
  if (histFacts.facts.length === 0) return '';
  return [
    'YOUR BID WIN HISTORY (measured from your own submitted bids):',
    ...histFacts.facts.map(f => `- ${f}`),
    'Set estimatedWinProbability from these measured rates (a number 0–1, NOT a percentage). When a size-bucket matches, prefer that rate over the overall rate.',
  ].join('\n');
}

/**
 * Normalize a model-returned win probability to [0, 1] or null.
 * The injected facts state percentages ("44%"), the prompt asks for 0–1,
 * and the UI renders `value * 100` — so a model echoing the facts' scale
 * (returning 44) would render "4400%". Rule: finite number required;
 * values in (1, 100] are treated as percentages and divided by 100;
 * anything outside [0, 1] after that is null (never clamp garbage into a
 * fake confident number).
 */
export function normalizeWinProbability(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return scaled >= 0 && scaled <= 1 ? scaled : null;
}
