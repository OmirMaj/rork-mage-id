// utils/levelingBasis.ts — bid leveling's honesty label (T7).
//
// When a sub excludes scope the GC's book cannot price, the leveling prompt
// (utils/bidLevelingEngine.ts) lets the model fall back to "typical
// residential costs". Those amounts used to look exactly like book prices
// after a reload, and they moved the ranking and "Best value".
//
// The label travels WITH the saved reason text ("Not from your book: …",
// "Needs price: …"), so it survives reloads and sync with no new field on
// BidPackageBid. And the label does not take the model's word for its own
// basis: a 'your_history' row counts as the book only when the leveling call
// actually carried book rows, and an 'estimate' row only when the prompt
// actually carried the package's estimate lines.
//
// An exclusion that needs his price is NOT applied: its amount stays 0 and
// its reason says "Needs price: …", so an unpriced exclusion never silently
// moves the ranking.
//
// Integration round 2 — that 0 is NOT a price. Every leveled-money helper
// (utils/projectFinancials leveledBidTotal / leveledBuyoutSavings /
// uncoveredScopeOf / openExcludedScope, utils/bulkSavings) reads only
// normalizedAdjustment, so a needs-price bid would count its unpriced excluded
// scope as $0 — savings on the Award dialog, the stored buyoutSavings, the
// package hero, Job Costing and the client PDF's "Bulk Savings". The rule:
// a bid whose saved reason reads needs_price has an UNKNOWN leveled cost.
//   • It cannot be awarded until he prices the excluded scope (the bid card
//     swaps Award for "Set your price", and handleAward refuses it) — so no
//     stored or printed savings figure is ever built on it.
//   • "Set your price" writes his number as the adjustment, reason
//     "Your price: …" (yourPriceReason) — the one writer besides leveling.
//   • Leveling never overwrites his price, and never rewrites the awarded
//     bid (its award-time figure is what the commitment, Job Costing and the
//     client PDF were built on): levelingMayWrite.
//   • Anywhere a savings figure would read a needs-price bid, it says
//     SAVINGS_NEEDS_PRICE instead of a number.
//
// Integration round 3 (onto main) — the 0 is never a NUMBER on screen either,
// and the unlock is always reachable:
//   • no screen prints a leveled total, "as bid" or a vs-budget figure for a
//     needs-price bid ("Needs price" instead), and it is kept out of every
//     numeric comparison — the median, the spread, the outliers and "Lowest"
//     (utils/bidLeveling computeBidLeveling's leveledCostUnknown option, and
//     the buyout matrix's knownBids). The ranking keeps it where its bid puts
//     it: the bid is a lower bound on its leveled cost, so a would-be winner
//     stays a close call until he prices the exclusion;
//   • "Nothing extra" is an answer: a button beside the price field, or 0
//     typed and confirmed, saves "Your price: Nothing extra for …" at 0 — the
//     excluded scope is covered, so the leveled total is the bid;
//   • once a bid carries his answer ('your_price'), leveling's question, a
//     low-confidence guess or an "another bid includes it" 0 no longer label
//     it needs-price (classify), and the pass leaves his bid out of its
//     labels and counts (it is never written over — levelingMayWrite).
//
// Pure — no React, no storage, no network (scripts/validate-leveling-basis.ts
// runs it under bun).

// The two tags a saved reason can open with. (Named *_TAG, not *_PREFIX:
// scripts/validate-storage-hygiene reads any `const *PREFIX = '…'` as a
// storage-key prefix, and these are sentence openings, not keys.)
export const NOT_FROM_BOOK_TAG = 'Not from your book: ';
export const NEEDS_PRICE_TAG = 'Needs price: ';
/** His own price for the excluded scope ("Set your price"). */
export const YOUR_PRICE_TAG = 'Your price: ';
/** The slice limit both screens have always applied to a saved reason. */
export const REASON_MAX = 240;

export type LevelingLabel = 'book' | 'not_from_book' | 'needs_price';
type Basis = 'your_history' | 'estimate' | 'market_guess';

/** What the leveling call actually carried. Built inside levelBids
 *  (utils/bidLevelingEngine.ts) from buildCostBookFacts' entryCount; callers
 *  never re-derive it. */
export interface LevelingBasisContext {
  costBookEntries: number;
  promptHadEstimateLines: boolean;
}

/** An adjustment row as the model returns it (levelingResultSchema). */
export interface AdjustmentLike {
  bidId: string;
  adjustment: number;
  reason: string;
  confidence: number;
  adjustmentBasis?: Basis;
  needsAnswer?: string;
}

export interface BidLike { id: string; excludes?: string | null; normalizedAdjustmentReason?: string | null }

/** He has answered for this bid's excluded scope — his own price, or
 *  "Nothing extra" ("Your price: …"). Leveling never writes over it. */
function answeredByYou(bid: { normalizedAdjustmentReason?: string | null } | null | undefined): boolean {
  return readReason(bid?.normalizedAdjustmentReason).label === 'your_price';
}

export interface LevelingResultLike {
  adjustments: AdjustmentLike[];
  summary: string;
  recommendedWinnerBidId: string;
  recommendedWinnerReason: string;
  basisContext?: LevelingBasisContext;
}

/** The context a result with none is read under: nothing carried, so no
 *  model-claimed basis is trusted. */
export const UNKNOWN_BASIS_CONTEXT: LevelingBasisContext = { costBookEntries: 0, promptHadEstimateLines: false };

export type SavedReasonLabel = 'not_from_book' | 'needs_price' | 'your_price';

/** The saved text split into its label and the model's own words. */
export function readReason(text: string | null | undefined): { label: SavedReasonLabel | null; text: string } {
  let t = String(text ?? '');
  let label: SavedReasonLabel | null = null;
  // Strip every leading label (a doubled one from an older write reads once).
  for (;;) {
    if (t.startsWith(NEEDS_PRICE_TAG)) { t = t.slice(NEEDS_PRICE_TAG.length); label = label ?? 'needs_price'; continue; }
    if (t.startsWith(NOT_FROM_BOOK_TAG)) { t = t.slice(NOT_FROM_BOOK_TAG.length); label = label ?? 'not_from_book'; continue; }
    if (t.startsWith(YOUR_PRICE_TAG)) { t = t.slice(YOUR_PRICE_TAG.length); label = label ?? 'your_price'; continue; }
    break;
  }
  return { label, text: t };
}

/** The reason to save: the label's prefix once (idempotent), capped at
 *  REASON_MAX with the prefix kept. A 'book' row keeps the model's words. */
export function tagReason(label: LevelingLabel, reason: string | null | undefined): string {
  const body = readReason(reason).text;
  const prefix = label === 'not_from_book' ? NOT_FROM_BOOK_TAG : label === 'needs_price' ? NEEDS_PRICE_TAG : '';
  return prefix + body.slice(0, Math.max(0, REASON_MAX - prefix.length));
}

// The model's own sentence says another bid covers this bid's exclusion.
const OTHER_INCLUDES = /\binclud(?:e|es|ed|ing)\b/i;
// …unless it is saying this bid is complete.
const ALL_IN = /\b(?:all[- ]in|fully inclusive|no exclusions|includes? everything)\b/i;

/**
 * Where an adjustment's number comes from, judged on what the call carried.
 *   needs_price  — the model asked a question (needsAnswer), or guessed at
 *                  confidence < 30, or left an excluding bid at 0 while its
 *                  own reason says another bid includes that scope.
 *   book         — a 'your_history' row when the call carried book rows, an
 *                  'estimate' row when the prompt carried estimate lines, or
 *                  a zero adjustment (there is no number to label).
 *   not_from_book — every other non-zero amount.
 * A bid he has already answered for (his price, or "Nothing extra" — the
 * saved reason reads 'your_price') is never needs_price: the question has
 * its answer (round 3).
 * Only what the result says is used; the bids are not re-parsed.
 */
export function classify(adj: AdjustmentLike, bid: BidLike | null | undefined, ctx: LevelingBasisContext): LevelingLabel {
  const amount = Number(adj.adjustment) || 0;
  const basis: Basis = adj.adjustmentBasis ?? 'market_guess';
  const reason = String(adj.reason ?? '');
  const open = !answeredByYou(bid);
  if (open && (adj.needsAnswer ?? '').trim() !== '') return 'needs_price';
  if (open && basis === 'market_guess' && Number(adj.confidence) < 30 && amount !== 0) return 'needs_price';
  if (amount === 0) {
    const excludes = String(bid?.excludes ?? '').trim();
    return open && excludes && OTHER_INCLUDES.test(reason) && !ALL_IN.test(reason) ? 'needs_price' : 'book';
  }
  if (basis === 'your_history') return ctx.costBookEntries > 0 ? 'book' : 'not_from_book';
  if (basis === 'estimate') return ctx.promptHadEstimateLines ? 'book' : 'not_from_book';
  return 'not_from_book';
}

const RANK: Record<LevelingLabel, number> = { book: 0, not_from_book: 1, needs_price: 2 };
function stronger(a: LevelingLabel, b: LevelingLabel | null): LevelingLabel {
  return b && RANK[b] > RANK[a] ? b : a;
}

export const CLOSE_CALL_REASON = 'Close call until you price the exclusion.';

export interface LevelingHonesty<R extends LevelingResultLike> {
  result: R;
  labels: Record<string, LevelingLabel>;
  notFromBookCount: number;
  needsPriceCount: number;
  bookCount: number;
}

/**
 * The honesty pass both screens run on levelBids' result before writing a
 * single normalizedAdjustment:
 *   • needs_price → amount 0, reason "Needs price: …" (never moves the ranking);
 *   • not_from_book → amount kept, reason "Not from your book: …";
 *   • the AI-unavailable rows (confidence 0) pass through untouched — the
 *     screens already skip them;
 *   • a bid he has answered for ("Your price: …", incl. "Nothing extra")
 *     passes through unlabelled and uncounted, its question dropped — the
 *     screens never write over it (levelingMayWrite), so it is not asked
 *     again and never clears the recommendation (round 3);
 *   • a recommended winner whose own exclusion needs a price is not a winner
 *     yet: the recommendation is cleared and says so.
 */
export function applyLevelingHonestyPure<R extends LevelingResultLike>(result: R, bids: readonly BidLike[]): LevelingHonesty<R> {
  const ctx = result.basisContext ?? UNKNOWN_BASIS_CONTEXT;
  const byId = new Map(bids.map(b => [b.id, b]));
  const labels: Record<string, LevelingLabel> = {};
  let notFromBookCount = 0;
  let needsPriceCount = 0;
  let bookCount = 0;
  const adjustments = result.adjustments.map(adj => {
    if (adj.confidence === 0) return adj;
    if (answeredByYou(byId.get(adj.bidId))) {
      const { needsAnswer: _answered, ...rest } = adj;
      return rest;
    }
    // A label already on the reason is never weakened (the pass is idempotent).
    // 'your_price' is not a leveling label (levelingMayWrite keeps his price).
    const had = readReason(adj.reason).label;
    const label = stronger(classify(adj, byId.get(adj.bidId), ctx), had === 'your_price' ? null : had);
    labels[adj.bidId] = label;
    if (label === 'needs_price') {
      needsPriceCount += 1;
      return { ...adj, adjustment: 0, reason: tagReason('needs_price', adj.reason) };
    }
    if (label === 'not_from_book') {
      notFromBookCount += 1;
      return { ...adj, reason: tagReason('not_from_book', adj.reason) };
    }
    if ((Number(adj.adjustment) || 0) !== 0) bookCount += 1;
    return { ...adj, reason: tagReason('book', adj.reason) };
  });
  const winnerNeedsPrice = !!result.recommendedWinnerBidId && labels[result.recommendedWinnerBidId] === 'needs_price';
  const next = {
    ...result,
    adjustments,
    ...(winnerNeedsPrice ? { recommendedWinnerBidId: '', recommendedWinnerReason: CLOSE_CALL_REASON } : {}),
  } as R;
  return { result: next, labels, notFromBookCount, needsPriceCount, bookCount };
}

/**
 * How many non-zero adjustments really are from the book (classify === 'book').
 * levelBids adds its "Adjustments priced from your cost book" lead only when
 * this is above 0 — a book full of rates whose every row came back
 * market_guess used to be told its adjustments were priced from its book.
 */
export function countBookRows(
  adjustments: readonly AdjustmentLike[],
  bids: readonly BidLike[],
  ctx: LevelingBasisContext,
): number {
  const byId = new Map(bids.map(b => [b.id, b]));
  return adjustments.filter(a => a.confidence !== 0 && (Number(a.adjustment) || 0) !== 0
    && !answeredByYou(byId.get(a.bidId))
    && classify(a, byId.get(a.bidId), ctx) === 'book').length;
}

// ── Screen copy ──────────────────────────────────────────────────────────────

export const LABEL_NOT_FROM_BOOK = 'Not from Your Book';
export const LABEL_NEEDS_PRICE = 'Needs Price';
export const LABEL_YOUR_HISTORY = 'Your history';
export const NO_BOOK_MATCH_NOTE = 'No rates in your book matched these exclusions, so the amounts are not from your book.';

export function rankingNotFromBookLine(n: number): string {
  return `Ranking uses ${n} amount${n === 1 ? '' : 's'} not from your book.`;
}
export function exclusionsNeedPriceLine(n: number): string {
  return `${n} exclusion${n === 1 ? ' needs' : 's need'} your price before this ranking is complete.`;
}

// ── Needs your price (integration round 2) ───────────────────────────────────

export const LABEL_YOUR_PRICE = 'Your price';
export const SET_YOUR_PRICE_CTA = 'Set your price for the excluded scope';
export const SAVINGS_NEEDS_PRICE = 'Not shown. Needs your price';
export const AWARD_NEEDS_PRICE_TITLE = 'Price the excluded scope first';

interface BidReasonLike { id?: string; excludes?: string | null; normalizedAdjustmentReason?: string | null }

/** A bid whose saved reason reads needs_price: its leveled cost is unknown
 *  (its adjustment is a 0 placeholder, not a price). */
export function needsYourPrice(bid: BidReasonLike | null | undefined): boolean {
  return readReason(bid?.normalizedAdjustmentReason).label === 'needs_price';
}

/** The reason saved with his own price: "Your price: <what the bid excludes>". */
export function yourPriceReason(excludes: string | null | undefined): string {
  const what = String(excludes ?? '').trim() || 'the scope this bid excludes';
  return (YOUR_PRICE_TAG + what).slice(0, REASON_MAX);
}

/** Why Award is refused, and what unlocks it — his price, or "Nothing
 *  extra". A bid that lists no exclusion is refused on the saved question
 *  (the reason's own words), not on "the scope this bid excludes". */
export function awardNeedsPriceBody(excludes: string | null | undefined, reasonText?: string | null): string {
  const unlock = `Tap "${SET_YOUR_PRICE_CTA}" on the bid card, or "${NOTHING_EXTRA_LABEL}" there if it costs nothing more.`;
  const what = String(excludes ?? '').trim();
  const question = String(reasonText ?? '').trim();
  if (!what && question) return `This bid needs your answer before it can be awarded: ${question} ${unlock}`;
  return `${what || 'The scope this bid excludes'} needs your price before this bid can be awarded. ${unlock}`;
}

// ── Nothing extra (round 3) ──────────────────────────────────────────────────

export const NOTHING_EXTRA_LABEL = 'Nothing extra';
export const NOTHING_EXTRA_CONFIRM_TITLE = 'Nothing extra?';

/** "0", "0.00", "$0", "$ 0.0", ".0" typed into the price field: an answer
 *  ("it costs nothing extra"), not a missing number. Same shape rules as
 *  parseBidAmountInput (no sign, no comma decimal); a sub-cent is refused. */
export function isNothingExtraInput(text: string | null | undefined): boolean {
  const stripped = String(text ?? '').replace(/[$\s]/g, '');
  return /^(?:0+(?:\.0*)?|\.0+)$/.test(stripped);
}

/** The reason saved with "Nothing extra": his answer, at 0. */
export function nothingExtraReason(excludes: string | null | undefined): string {
  const what = String(excludes ?? '').trim() || 'the scope this bid excludes';
  return (YOUR_PRICE_TAG + 'Nothing extra for ' + what).slice(0, REASON_MAX);
}

/** The confirm when he types 0 as his price. */
export function nothingExtraConfirmBody(excludes: string | null | undefined): string {
  const what = String(excludes ?? '').trim() || 'The excluded scope';
  return `${what} costs nothing on top of this bid, so its leveled total is the bid amount.`;
}

/**
 * May a leveling run write its adjustment onto this bid?
 *   • never onto his own price ("Your price: …" — his number wins);
 *   • never onto the awarded bid (the commitment, the stored savings, Job
 *     Costing and the client PDF were built on its award-time figure).
 */
export function levelingMayWrite(bid: BidReasonLike | null | undefined, awardedBidId: string | null | undefined): boolean {
  if (!bid) return true;
  if (awardedBidId && bid.id === awardedBidId) return false;
  return readReason(bid.normalizedAdjustmentReason).label !== 'your_price';
}
