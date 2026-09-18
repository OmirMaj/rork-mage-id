import type { BidPackage, BidPackageBid, Commitment } from '@/types';
import { awardedCommitmentCost, uncoveredScopeOf } from '@/utils/projectFinancials';

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
  bids: ReadonlyArray<Pick<BidPackageBid, 'id' | 'normalizedAdjustment'>>,
  asOf: string = new Date().toISOString(),
): BulkSavingsSummary {
  const byPackage: BulkSavingsLine[] = [];
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
    const awardedAmount = cents(signed + uncoveredScopeOf(awardedBid));
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
    hasRealData: byPackage.length > 0,
    source: 'measured_from_buyout',
    asOf,
  };
}
