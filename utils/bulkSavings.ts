import type { BidPackage, BidPackageBid, Commitment, LinkedEstimateItem } from '@/types';
import { awardedCommitmentCost, openExcludedScope } from '@/utils/projectFinancials';
import { lineCost } from '@/utils/estimateMarkup';

/** The estimate lines a package budget can be checked against. */
export type BudgetBasisItem = Pick<LinkedEstimateItem, 'materialId' | 'lineTotal' | 'unitPrice' | 'quantity'>;

/**
 * Was this package's budget written at SELL — the old auto-fill (#11)?
 *
 * Until the fix, app/buyout.tsx auto-filled a package budget with
 * `Math.round(Σ lineTotal)` of the lines he ticked, and utils/generativeSetup
 * with the unrounded Σ lineTotal. lineTotal carries his markup, so every
 * award then read his own margin as "buyout savings" — and computeBulkSavings
 * printed it on the homeowner's estimate PDF. New packages are budgeted at
 * cost (estimateMarkup.lineCost); the rows already stored are not.
 *
 * Detected, not guessed: true only when the linked lines are still on the
 * estimate, they carry a real markup (sell exceeds cost by at least a dollar,
 * so the two can be told apart at all), and the stored budget equals their
 * SELL sum to within the old whole-dollar rounding. A budget he typed by hand
 * almost never lands there; one that does is flagged for review, never
 * rewritten — the screen says why and he decides.
 */
export function isSellBasisBudget(
  pkg: Pick<BidPackage, 'estimateBudget' | 'linkedEstimateItemIds'>,
  items: readonly BudgetBasisItem[] | null | undefined,
): boolean {
  const ids = pkg.linkedEstimateItemIds ?? [];
  if (!items || ids.length === 0) return false;
  const linked = items.filter(i => ids.includes(i.materialId));
  if (linked.length === 0) return false;
  const sell = linked.reduce((s, i) => s + (i.lineTotal ?? 0), 0);
  const cost = linked.reduce((s, i) => s + lineCost(i), 0);
  if (sell - cost < 1) return false;
  const budget = pkg.estimateBudget ?? 0;
  return Math.abs(budget - sell) <= 0.5 + 1e-9;
}

export interface BulkSavingsLine {
  packageId: string;
  packageName: string;
  estimateBudget: number;
  awardedAmount: number;
  savings: number; // estimateBudget - awardedAmount; negative = overrun
}

export interface BulkSavingsSummary {
  bulkSavings: number;
  awardedPackageCount: number;
  totalBudgeted: number;
  totalAwarded: number;
  byPackage: BulkSavingsLine[];
  /** Awarded packages left OUT of the figure because their budget was stored
   *  at sell (isSellBasisBudget) — their "savings" would be his own markup. */
  needsReview: string[];
  hasRealData: boolean;
  source: 'measured_from_buyout';
  asOf: string;
}

/**
 * A package with estimateBudget 0 still contributes (as an overrun equal to its
 * awardedAmount) — a zero-budget committed line is a real cost, surfaced honestly.
 *
 * Real bulk savings for a project = Σ(estimate budget − signed award) across
 * buyout packages that are actually AWARDED and have a resolvable signed
 * Commitment. Forward estimates, open/leveling packages, and awarded-but-not-
 * committed packages never contribute. Overruns (negative lines) are included
 * in the net so the number is honest, never cherry-picked. Provenance is
 * 'measured_from_buyout' — distinct from seeded claims and closed-job actuals.
 */
const cents = (n: number) => Math.round(n * 100) / 100;

export function computeBulkSavings(
  projectId: string,
  bidPackages: BidPackage[],
  commitments: Commitment[],
  /** Every bid row the packages could have awarded (the awarded one is found
   *  by pkg.awardedBidId). Required — without it the figure is not leveled. */
  bids: ReadonlyArray<Pick<BidPackageBid, 'id' | 'amount' | 'normalizedAdjustment'>>,
  asOf: string = new Date().toISOString(),
  /** The project's estimate lines. When given, a package whose budget was
   *  stored at SELL is refused (#11) rather than printed as Bulk Savings.
   *  Optional so existing callers compile; the client-PDF callers must pass
   *  it — see the w5-join-screens handoff. */
  opts?: { estimateItems?: readonly BudgetBasisItem[] | null },
): BulkSavingsSummary {
  const byPackage: BulkSavingsLine[] = [];
  const needsReview: string[] = [];
  let totalBudgeted = 0;
  let totalAwarded = 0;

  const awarded = bidPackages.filter(
    (p) => p.projectId === projectId && p.status === 'awarded',
  );

  for (const pkg of awarded) {
    const commitment = pkg.awardedCommitmentId
      ? commitments.find(
          (c) => c.id === pkg.awardedCommitmentId && c.projectId === projectId,
        )
      : undefined;
    if (!commitment) continue;
    // A sell-basis budget is refused, not netted: budget − award there is his
    // markup, and this figure is printed on the CLIENT's PDF as money saved.
    if (isSellBasisBudget(pkg, opts?.estimateItems)) { needsReview.push(pkg.id); continue; }

    // LEVELED, like every other buyout-savings figure (audit round 2, #5;
    // utils/projectFinancials leveledBuyoutSavings). The commitment is the
    // sub's bid, but scope the awarded bid excludes is still his to buy — so
    // it is not savings. Budget − raw commitment printed "Bulk Savings" on the
    // client's estimate PDF that included $3,200 of blocking and dumpster the
    // sub never priced, while the buyout screens showed the leveled number.
    // Same base as packageBuyoutSavings (awardedCommitmentCost: commitment +
    // its COs), so the project page and the buyout screens move together.
    // Only a POSITIVE adjustment is levelled in here, though: this figure is
    // printed on the CLIENT's estimate PDF as "Bulk Savings", and a negative
    // adjustment (the AI's guess that the bid covers extra scope) would raise
    // it above budget − what he actually signed — an AI estimate printed to
    // the client as money saved. The buyout screens (his own) keep the signed
    // adjustment, so the two agree to the cent whenever it is ≥ 0.
    const awardedBid = pkg.awardedBidId ? bids.find((b) => b.id === pkg.awardedBidId) : undefined;
    const signed = awardedCommitmentCost(pkg, [commitment]) ?? 0;
    // Only the excluded scope the commitment has not already absorbed — a
    // commitment edited up to take it must not have it subtracted twice
    // (projectFinancials.openExcludedScope, leftovers review).
    const awardedAmount = cents(signed + openExcludedScope(awardedBid, commitment.amount));
    const estimateBudget = pkg.estimateBudget ?? 0;
    byPackage.push({
      packageId: pkg.id,
      packageName: pkg.name,
      estimateBudget,
      awardedAmount,
      savings: cents(estimateBudget - awardedAmount),
    });
    totalBudgeted += estimateBudget;
    totalAwarded += awardedAmount;
  }

  return {
    bulkSavings: cents(totalBudgeted - totalAwarded),
    awardedPackageCount: byPackage.length,
    totalBudgeted,
    totalAwarded,
    byPackage,
    needsReview,
    hasRealData: byPackage.length > 0,
    source: 'measured_from_buyout',
    asOf,
  };
}

/**
 * A package's budget AT COST, from the estimate lines it links (#11) — the
 * figure the new-package form now auto-fills and the "review" fix offers.
 * Null when none of its linked lines are on the estimate any more.
 */
export function packageCostBudget(
  pkg: Pick<BidPackage, 'linkedEstimateItemIds'>,
  items: readonly BudgetBasisItem[] | null | undefined,
): number | null {
  const ids = pkg.linkedEstimateItemIds ?? [];
  const linked = (items ?? []).filter(i => ids.includes(i.materialId));
  if (linked.length === 0) return null;
  return cents(linked.reduce((s, i) => s + lineCost(i), 0));
}

// ── Bid amounts (#95) ──────────────────────────────────────────────────────
// A voice bid whose price the parser missed was saved at $0, sorted first,
// badged LOWEST and offered "Award · $0" — an award ProjectContext refuses in
// silence. On web a typed "4,800" became NaN the same way. A bid amount is a
// real, positive, finite number to the cent, or it is "needs an amount".

/** Typed text → dollars to the cent, or null. A "$" and spaces are stripped
 *  and US thousands grouping is accepted ("4,800" is 4800, "$12,345.50" is
 *  12345.5); anything else is refused rather than guessed: a second decimal
 *  point, zero, a negative, words, and ANY other comma.
 *
 *  WHY A COMMA IS REFUSED (integration review, wave 5). This used to strip
 *  every character but digits and '.', and both bid fields and the package
 *  budget are decimal-pad keyboards — which type ',' as the decimal mark in
 *  comma-decimal locales. '4800,50' became 480050: a $4,800.50 bid saved as
 *  $480,050, awardable into a commitment and the A401 contract sum. '-500'
 *  became 500. The same rule as cashFlowEngine.parseMoneyInput (refuse the
 *  ambiguous shape, say what to type); inlined, not imported, so this pure
 *  module does not pull the cash-flow engine into the buyout screens. */
export function parseBidAmountInput(text: string): number | null {
  const stripped = String(text ?? '').replace(/[$\s]/g, '');
  // Digits, optional US grouping, optional decimals — and nothing else. No
  // leading '-' (a bid or a budget is never negative), no comma decimal.
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(stripped)) return null;
  const n = Number(stripped.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = cents(n);
  return c > 0 ? c : null;
}

/** A stored bid's usable amount, or null when it has none (0, NaN, negative). */
export function bidAmountOf(bid: Pick<BidPackageBid, 'amount'>): number | null {
  const n = Number(bid.amount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Matrix order: leveled total ascending, and every bid with no usable amount
 *  LAST — never first, so it can never wear the LOWEST badge. */
export function compareBidsForMatrix(
  a: Pick<BidPackageBid, 'amount' | 'normalizedAdjustment'>,
  b: Pick<BidPackageBid, 'amount' | 'normalizedAdjustment'>,
): number {
  const aa = bidAmountOf(a), bb = bidAmountOf(b);
  if (aa == null && bb == null) return 0;
  if (aa == null) return 1;
  if (bb == null) return -1;
  return (aa + (a.normalizedAdjustment ?? 0)) - (bb + (b.normalizedAdjustment ?? 0));
}

/**
 * The one figure a client PDF may print as "Bulk Savings": a real, positive,
 * measured number, or nothing. Mirrors the guard both PDF callers apply today
 * (`hasRealData && bulkSavings > 0`) so the validator can execute it.
 */
export function bulkSavingsPdfTotal(summary: Pick<BulkSavingsSummary, 'hasRealData' | 'bulkSavings'>): number | undefined {
  return summary.hasRealData && summary.bulkSavings > 0 ? summary.bulkSavings : undefined;
}
