// bidLevelingEngine.ts — AI-powered bid leveling for the buyout module.
//
// Bid leveling is the part of buyout where the GC takes 2–4 raw sub
// bids ("$4,800 includes everything except fixtures", "$5,200 all-in,
// 2-week start", "$4,600 excludes permits + dump fees") and normalizes
// them into a true apples-to-apples comparison. Without this, the GC
// awards to the lowest TOTAL even though that bid excluded $1,500 of
// scope the others included — and they pay the difference later.
//
// What this engine does:
//   1. Takes a BidPackage + array of BidPackageBid rows.
//   2. Sends the bids' includes/excludes/notes to Gemini with a tight
//      schema asking: "What's the dollar-value adjustment to add to
//      each bid to make them apples-to-apples? Why?"
//   3. Returns one suggestion per bid: { bidId, adjustment, reason,
//      confidence, adjustmentBasis }.
//   4. The screen applies the adjustments to each bid's
//      `normalizedAdjustment` field (after GC review).
//
// The model is told to be CONSERVATIVE — under-adjust rather than
// over-adjust. A bid that says "all-in" gets 0 adjustment. A bid
// that excludes a known cost gets a positive adjustment ("add $X to
// reflect the missing fixtures"). Speculative differences ("Sub B
// might be using cheaper material") get 0 — leveling is about
// SCOPE, not opinions.
//
// Grounding: when the GC's learned cost book covers the package's
// trade/CSI division, the prompt cites their real rates, and the
// schema returns adjustmentBasis so the UI can signal provenance
// ('your history' vs 'market guess').

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import { buildCostDatabase } from '@/utils/costDatabase';
import type { SeededRate } from '@/utils/costSeedCore';
import type { BidPackage, BidPackageBid, Project, Commitment, MaterialReceipt } from '@/types';

// ── Schema ────────────────────────────────────────────────────────────────────

const levelingResultSchema = z.object({
  adjustments: z.array(z.object({
    bidId: z.string(),
    /** Dollar amount to ADD to this bid to make it apples-to-apples
     *  with the others. Positive when bid is missing scope, negative
     *  if it's including scope the others didn't. Most adjustments
     *  are positive; negative is rare. */
    adjustment: z.number().default(0),
    /** One sentence explaining why. Shown inline to the GC. */
    reason: z.string().default(''),
    /** 0-100 confidence. Below 50 the screen shows "AI low confidence —
     *  review manually." */
    confidence: z.number().default(50),
    /** Where the adjustment dollar came from:
     *  - 'your_history'  → looked up from the GC's own learned cost book
     *  - 'estimate'      → anchored on the package's linked estimate lines
     *  - 'market_guess'  → generic model estimate (no learned data available)
     * Additive field — older data without this field defaults to 'market_guess'. */
    adjustmentBasis: z.enum(['your_history', 'estimate', 'market_guess']).default('market_guess'),
    /** When set, this adjustment is ambiguous (e.g. "Bid 2 says 'some permits'
     *  but is not clear if the full permit fee is covered") — render as a
     *  question chip the GC can answer before re-leveling. */
    needsAnswer: z.string().optional(),
  })).default([]),
  /** Summary of the leveling — shown above the matrix. */
  summary: z.string().default(''),
  /** Recommended winner after leveling, or empty if it's too close to
   *  call. The GC always makes the final call; this is just a flag. */
  recommendedWinnerBidId: z.string().default(''),
  recommendedWinnerReason: z.string().default(''),
});
export type LevelingResult = z.infer<typeof levelingResultSchema>;
export type AdjustmentBasis = 'your_history' | 'estimate' | 'market_guess';

// ── Options ───────────────────────────────────────────────────────────────────

interface LevelOpts {
  pkg: BidPackage;
  bids: BidPackageBid[];
  /** GC's full project list — used to build their learned cost book.
   *  Passing undefined falls back to generic model estimates. */
  projects?: Project[];
  /** All commitments — required for cost-book accuracy. */
  commitments?: Commitment[];
  /** Snapped material receipts — additive learned rates. */
  receipts?: MaterialReceipt[];
  /** Cold-start seeds (hooks/useCostSeeds) — rates the GC stated before they
   *  had closed-job history here. Without them a seeded GC levels bids against
   *  an EMPTY cost book and every adjustment falls back to 'market_guess'. */
  seeds?: SeededRate[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a compact cost-book block for the prompt.  Returns an empty string
 *  when there are no closed jobs yet (cold start — graceful). */
function buildCostBookFacts(
  pkg: BidPackage,
  projects: Project[],
  commitments: Commitment[],
  receipts: MaterialReceipt[],
  seeds: SeededRate[],
): { facts: string; entryCount: number; seededCount: number } {
  const db = buildCostDatabase(projects, commitments, receipts, [], seeds);
  if (db.entries.length === 0) return { facts: '', entryCount: 0, seededCount: 0 };

  // Surface entries relevant to this package's trade / CSI.  We match
  // loosely: the package's CSI division prefix or its name words against
  // entry keys (trade|unit).  Fall back to top entries by totalActual.
  const pkgTrade = (pkg.csiDivision ?? pkg.name ?? '').toLowerCase();
  const words = pkgTrade.split(/\W+/).filter(w => w.length > 2);

  const relevant = db.entries
    .filter(e => words.some(w => e.key.includes(w)))
    .sort((a, b) => b.totalActual - a.totalActual)
    .slice(0, 6);

  const topEntries = relevant.length > 0
    ? relevant
    : db.entries.sort((a, b) => b.totalActual - a.totalActual).slice(0, 4);

  const lines = topEntries.map(e => {
    // A seeded-only rate is the GC's own claim, not something we measured.
    // "(1 sample, low confidence)" would read as evidence, so say what it is.
    if (e.provenance === 'seeded') {
      return `  • ${e.trade} / ${e.unit}: $${e.suggestedRate.toFixed(2)}/unit (SELF-REPORTED — the GC set this rate themselves; nothing here has measured it)`;
    }
    const confLabel = e.confidence === 'high' ? 'high confidence' : e.confidence === 'medium' ? 'medium confidence' : 'low confidence';
    const bias = e.bidBias > 0.05
      ? `, you bid LOW by ${Math.round(e.bidBias * 100)}%`
      : e.bidBias < -0.05
        ? `, you bid HIGH by ${Math.round(Math.abs(e.bidBias) * 100)}%`
        : '';
    return `  • ${e.trade} / ${e.unit}: $${e.suggestedRate.toFixed(2)}/unit (${e.sampleCount} samples, ${confLabel}${bias})`;
  });

  const seededCount = topEntries.filter(e => e.provenance === 'seeded').length;
  // jobsAnalyzed already excludes seeds by construction, so this header stays
  // true even for a book that is entirely self-reported ("0 closed jobs").
  const facts = `THE GC'S OWN RATES (${db.jobsAnalyzed} closed job${db.jobsAnalyzed === 1 ? '' : 's'} analyzed):\n${lines.join('\n')}`;
  return { facts, entryCount: topEntries.length, seededCount };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function levelBids(opts: LevelOpts): Promise<LevelingResult> {
  const { pkg, bids, projects = [], commitments = [], receipts = [], seeds = [] } = opts;
  // Leveling requires at least 2 bids — otherwise there's nothing to
  // normalize against. The screen guards this too, but utilities exposed
  // module-wide should defend themselves (code-review #5).
  if (bids.length < 2) return { adjustments: [], summary: '', recommendedWinnerBidId: '', recommendedWinnerReason: '' };

  // Build cost-book grounding block.
  const { facts: costBookFacts, entryCount: costBookEntries, seededCount: costBookSeeded } = buildCostBookFacts(
    pkg, projects, commitments, receipts, seeds,
  );

  // Build the prompt with each bid's raw text.
  const bidLines = bids.map((b, i) => {
    const who = b.subcontractorId ? `Sub #${b.subcontractorId.slice(0, 6)}` : (b.vendorName || `Bid ${i + 1}`);
    return `BID id=${b.id} from ${who}
  Amount: $${b.amount.toLocaleString()}
  Includes: ${b.includes || '(not specified)'}
  Excludes: ${b.excludes || '(not specified)'}
  Terms: ${b.terms || '(not specified)'}`;
  }).join('\n\n');

  const costBookSection = costBookFacts
    ? `\n${costBookFacts}\n\nWhen pricing an adjustment, use the rates above whenever the missing scope matches a trade/unit in it. Set adjustmentBasis='your_history' for rows priced off a MEASURED rate. A rate marked SELF-REPORTED is the GC's own stated number, not measured history — you may still price from it, but cap that row's confidence at 49 and never describe it as their history or job experience. For scope no rate covers, fall back to typical residential costs and set adjustmentBasis='market_guess', capping that confidence at 49.`
    : `\nNo cost-book data available — use typical residential costs and set adjustmentBasis='market_guess', capping confidence at 49.`;

  const r = await mageAI({
    prompt: `You are a residential GC's buyout / bid leveling assistant. The GC has received multiple bids on the same scope of work and needs you to compute the ADJUSTMENT to add to each bid so they can be compared apples-to-apples.

PACKAGE
  Name: ${pkg.name}
  Phase: ${pkg.phase || '(unspecified)'}
  CSI: ${pkg.csiDivision || '(unspecified)'}
  Estimate budget (carry): $${pkg.estimateBudget.toLocaleString()}
  Scope description: ${pkg.scopeDescription || '(see line items)'}
${costBookSection}

BIDS
${bidLines}

YOUR JOB
1. For each bid, decide what dollar adjustment to ADD to make it apples-to-apples with the others.
   - If a bid EXCLUDES something another bid includes (fixtures, permits, dump fees, demolition), add the cost of that scope.
   - Price exclusions from LEARNED COST BOOK when the trade matches; otherwise use typical residential costs.
   - If a bid is "all-in" / fully inclusive, adjustment = 0.
   - Be CONSERVATIVE: only adjust for clearly-stated scope differences. Don't adjust for "Sub B might be using cheaper material."
   - If an exclusion is AMBIGUOUS (bid says "some permits" without clarifying amount), set needsAnswer to a one-sentence question for the GC.
2. Return one entry per bid in the adjustments array, with bidId matching the input.
3. Set adjustmentBasis: 'your_history' when using the LEARNED COST BOOK, 'estimate' when anchoring on estimate lines, or 'market_guess' for generic estimates.
4. Set 'confidence' 0-100. For 'your_history' rows: match learned confidence level (high=80+, medium=60-79, low<60). For 'market_guess' rows: cap at 49.
5. Set 'summary' to one paragraph explaining what you noticed across all bids.
6. Set 'recommendedWinnerBidId' to the bid id that wins AFTER adjustment, or empty string if it's too close (within 5%) to call.
7. Set 'recommendedWinnerReason' to one short sentence ("After leveling, Bid 2 is $1,200 less than the next-lowest and includes everything").`,
    schema: levelingResultSchema,
    schemaHint: {
      adjustments: bids.map(b => ({
        bidId: b.id, adjustment: 0, reason: 'No exclusions identified.',
        confidence: 70, adjustmentBasis: 'market_guess',
      })),
      summary: 'All three bids are reasonably close. Bid 1 excludes fixtures (typical $1,200), Bid 2 is all-in, Bid 3 excludes permits (typical $400).',
      recommendedWinnerBidId: bids[0]?.id ?? '',
      recommendedWinnerReason: 'After leveling, Bid 2 is the lowest fully-inclusive number.',
    },
    tier: 'fast',
    maxTokens: 1400,
    feature: 'bidLeveling',
  });

  if (!r.success) {
    return {
      adjustments: bids.map(b => ({
        bidId: b.id, adjustment: 0, reason: 'AI unavailable — review manually.',
        confidence: 0, adjustmentBasis: 'market_guess' as const,
      })),
      summary: '',
      recommendedWinnerBidId: '',
      recommendedWinnerReason: '',
    };
  }

  const result = r.data as LevelingResult;

  // Attach a grounding summary to the summary so the GC understands the basis.
  if (costBookEntries > 0 && result.summary) {
    // Count earned and self-reported trades separately — a GC whose book is
    // entirely seeded must not be told the adjustments came from their history.
    const earned = costBookEntries - costBookSeeded;
    const parts = [
      earned > 0 ? `${earned} learned trade${earned === 1 ? '' : 's'}` : '',
      costBookSeeded > 0 ? `${costBookSeeded} rate${costBookSeeded === 1 ? '' : 's'} you set yourself` : '',
    ].filter(Boolean);
    const lead = earned > 0 ? 'Adjustments priced from your cost book' : 'Adjustments priced from rates you set yourself';
    result.summary = `(${lead} · ${parts.join(' + ')}) ${result.summary}`;
  }

  return result;
}

// ── Validation cases (pure, no network) ──────────────────────────────────────
// Pinned regression cases to keep engine shape honest.

/** Validate that the adjustmentBasis field passes through schema parsing. */
export function validateAdjustmentBasis(raw: unknown): AdjustmentBasis {
  const parsed = levelingResultSchema.safeParse(raw);
  if (!parsed.success) return 'market_guess';
  const adj = parsed.data.adjustments[0];
  return adj?.adjustmentBasis ?? 'market_guess';
}
