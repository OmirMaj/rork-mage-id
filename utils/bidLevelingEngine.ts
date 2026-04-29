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
//      confidence }.
//   4. The screen applies the adjustments to each bid's
//      `normalizedAdjustment` field (after GC review).
//
// The model is told to be CONSERVATIVE — under-adjust rather than
// over-adjust. A bid that says "all-in" gets 0 adjustment. A bid
// that excludes a known cost gets a positive adjustment ("add $X to
// reflect the missing fixtures"). Speculative differences ("Sub B
// might be using cheaper material") get 0 — leveling is about
// SCOPE, not opinions.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { BidPackage, BidPackageBid } from '@/types';

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
  })).default([]),
  /** Summary of the leveling — shown above the matrix. */
  summary: z.string().default(''),
  /** Recommended winner after leveling, or empty if it's too close to
   *  call. The GC always makes the final call; this is just a flag. */
  recommendedWinnerBidId: z.string().default(''),
  recommendedWinnerReason: z.string().default(''),
});
export type LevelingResult = z.infer<typeof levelingResultSchema>;

interface LevelOpts {
  pkg: BidPackage;
  bids: BidPackageBid[];
}

export async function levelBids(opts: LevelOpts): Promise<LevelingResult> {
  const { pkg, bids } = opts;
  // Leveling requires at least 2 bids — otherwise there's nothing to
  // normalize against. The screen guards this too, but utilities exposed
  // module-wide should defend themselves (code-review #5).
  if (bids.length < 2) return { adjustments: [], summary: '', recommendedWinnerBidId: '', recommendedWinnerReason: '' };

  // Build the prompt with each bid's raw text.
  const bidLines = bids.map((b, i) => {
    const who = b.subcontractorId ? `Sub #${b.subcontractorId.slice(0, 6)}` : (b.vendorName || `Bid ${i + 1}`);
    return `BID id=${b.id} from ${who}
  Amount: $${b.amount.toLocaleString()}
  Includes: ${b.includes || '(not specified)'}
  Excludes: ${b.excludes || '(not specified)'}
  Terms: ${b.terms || '(not specified)'}`;
  }).join('\n\n');

  const r = await mageAI({
    prompt: `You are a residential GC's buyout / bid leveling assistant. The GC has received multiple bids on the same scope of work and needs you to compute the ADJUSTMENT to add to each bid so they can be compared apples-to-apples.

PACKAGE
  Name: ${pkg.name}
  Phase: ${pkg.phase || '(unspecified)'}
  CSI: ${pkg.csiDivision || '(unspecified)'}
  Estimate budget (carry): $${pkg.estimateBudget.toLocaleString()}
  Scope description: ${pkg.scopeDescription || '(see line items)'}

BIDS
${bidLines}

YOUR JOB
1. For each bid, decide what dollar adjustment to ADD to make it apples-to-apples with the others.
   - If a bid EXCLUDES something another bid includes (fixtures, permits, dump fees, demolition), add the typical cost of that scope.
   - If a bid is "all-in" / fully inclusive, adjustment = 0.
   - Be CONSERVATIVE: only adjust for clearly-stated scope differences. Don't adjust for "Sub B might be using cheaper material."
2. Return one entry per bid in the adjustments array, with bidId matching the input.
3. Set 'confidence' 0-100. 80+ = strong call (clear exclusion of a known-cost item). 50-80 = reasonable but unverified. <50 = AI low confidence, GC should review.
4. Set 'summary' to one paragraph explaining what you noticed across all bids.
5. Set 'recommendedWinnerBidId' to the bid id that wins AFTER adjustment, or empty string if it's too close (within 5%) to call.
6. Set 'recommendedWinnerReason' to one short sentence ("After leveling, Bid 2 is $1,200 less than the next-lowest and includes everything").`,
    schema: levelingResultSchema,
    schemaHint: {
      adjustments: bids.map(b => ({ bidId: b.id, adjustment: 0, reason: 'No exclusions identified.', confidence: 70 })),
      summary: 'All three bids are reasonably close. Bid 1 excludes fixtures (typical $1,200), Bid 2 is all-in, Bid 3 excludes permits (typical $400).',
      recommendedWinnerBidId: bids[0]?.id ?? '',
      recommendedWinnerReason: 'After leveling, Bid 2 is the lowest fully-inclusive number.',
    },
    tier: 'fast',
    maxTokens: 1200,
  });

  if (!r.success) {
    return {
      adjustments: bids.map(b => ({ bidId: b.id, adjustment: 0, reason: 'AI unavailable — review manually.', confidence: 0 })),
      summary: '',
      recommendedWinnerBidId: '',
      recommendedWinnerReason: '',
    };
  }
  return r.data as LevelingResult;
}
