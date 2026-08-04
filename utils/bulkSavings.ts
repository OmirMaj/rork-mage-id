import type { BidPackage, Commitment } from '@/types';

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
 * Real bulk savings for a project = Σ(estimate budget − signed award) across
 * buyout packages that are actually AWARDED and have a resolvable signed
 * Commitment. Forward estimates, open/leveling packages, and awarded-but-not-
 * committed packages never contribute. Overruns (negative lines) are included
 * in the net so the number is honest, never cherry-picked. Provenance is
 * 'measured_from_buyout' — distinct from seeded claims and closed-job actuals.
 */
export function computeBulkSavings(
  projectId: string,
  bidPackages: BidPackage[],
  commitments: Commitment[],
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

    const awardedAmount = commitment.amount + (commitment.changeAmount ?? 0);
    const estimateBudget = pkg.estimateBudget ?? 0;
    byPackage.push({
      packageId: pkg.id,
      packageName: pkg.name,
      estimateBudget,
      awardedAmount,
      savings: estimateBudget - awardedAmount,
    });
    totalBudgeted += estimateBudget;
    totalAwarded += awardedAmount;
  }

  return {
    bulkSavings: totalBudgeted - totalAwarded,
    awardedPackageCount: byPackage.length,
    totalBudgeted,
    totalAwarded,
    byPackage,
    hasRealData: byPackage.length > 0,
    source: 'measured_from_buyout',
    asOf,
  };
}
