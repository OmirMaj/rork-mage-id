// utils/safety/risk.ts — pure risk-matrix math for the Hazard Log.
//
// riskScore = severity × likelihood on a 1..5 scale (classic 5×5 matrix,
// range 1..25). Banding maps the score to a four-level qualitative band
// used for sort order + chip color. No UI, no RN imports — unit-tested by
// scripts/validate-safety-risk.ts.

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

/** Clamp any input to an integer in [1, 5]. Non-finite → 1 (never NaN). */
function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  const r = Math.round(v);
  if (r < 1) return 1;
  if (r > 5) return 5;
  return r;
}

/** severity × likelihood, each clamped to [1,5] → product in [1,25]. */
export function computeRiskScore(severity: number, likelihood: number): number {
  return clampScale(severity) * clampScale(likelihood);
}

/** 5×5 matrix bands: 1-4 low, 5-9 medium, 10-15 high, 16-25 critical. */
export function riskBand(score: number): RiskBand {
  if (score <= 4) return 'low';
  if (score <= 9) return 'medium';
  if (score <= 15) return 'high';
  return 'critical';
}
