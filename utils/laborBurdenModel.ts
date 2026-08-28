// utils/laborBurdenModel.ts — labor-burden guardrail for the cost-learning loop.
//
// The cost book learns labor cost from the GC's entered $/hr rates. Those rates
// MUST be LOADED (wages + burden: payroll taxes, workers' comp, GL, PTO,
// vehicle, small tools) — otherwise every estimate the loop "improves" prices
// labor ~25-48% low, and the moat quietly learns the wrong lesson.
//
// We deliberately do NOT silently multiply entered rates by a burden factor: the
// UI already asks for a loaded rate, so multiplying would DOUBLE-count for every
// GC who followed instructions, and true burden varies by state, insurance
// carrier, and trade code (a competitor can't copy your job history, and we
// can't guess your comp mod). Instead we DETECT rates that look like a bare wage
// and nudge, and offer to compute a loaded rate from a bare one on demand.
//
// Pure + testable (scripts/validate-labor-burden.ts pins the numbers).

/** Typical labor-burden fraction by trade CATEGORY. Workers-comp dominates and
 *  swings hard by trade — roofing/structural high, laborer/landscape low. These
 *  are industry-ballpark reference points for a nudge, NOT applied automatically. */
export const BURDEN_BY_CATEGORY: Record<string, number> = {
  roofing: 0.48,
  structural: 0.40,
  concrete: 0.40,
  masonry: 0.38,
  plumbing: 0.38,
  hvac: 0.36,
  electrical: 0.34,
  drywall: 0.30,
  finishing: 0.30,
  flooring: 0.30,
  insulation: 0.30,
  general: 0.28,
  landscape: 0.26,
};
const DEFAULT_BURDEN = 0.32;

/** Rough BARE-wage low per category (mirrors constants/laborRates rateRange.low)
 *  — where a bare hourly wage sits before burden is added. */
const BARE_LOW_BY_CATEGORY: Record<string, number> = {
  structural: 22, electrical: 24, plumbing: 23, hvac: 22, finishing: 17,
  roofing: 19, masonry: 21, concrete: 19, drywall: 18, flooring: 18,
  general: 15, landscape: 14, insulation: 17,
};
const DEFAULT_BARE_LOW = 18;

/** Map a free-form trade key to a burden category via keywords. */
export function categoryForTrade(tradeKey: string): string {
  const k = (tradeKey || '').toLowerCase();
  if (/roof/.test(k)) return 'roofing';
  if (/electric/.test(k)) return 'electrical';
  if (/plumb|pipe/.test(k)) return 'plumbing';
  if (/hvac|sheet.?metal|duct/.test(k)) return 'hvac';
  if (/mason|brick/.test(k)) return 'masonry';
  if (/concrete|finisher/.test(k)) return 'concrete';
  if (/drywall/.test(k)) return 'drywall';
  if (/paint|glaz|tile/.test(k)) return 'finishing';
  if (/floor/.test(k)) return 'flooring';
  if (/insulat/.test(k)) return 'insulation';
  if (/landscap/.test(k)) return 'landscape';
  if (/carpenter|framer|iron|structural|weld/.test(k)) return 'structural';
  return 'general';
}

/** Typical burden fraction (0-1) for a trade. */
export function burdenPctForTrade(tradeKey: string): number {
  return BURDEN_BY_CATEGORY[categoryForTrade(tradeKey)] ?? DEFAULT_BURDEN;
}

function bareLowForTrade(tradeKey: string): number {
  return BARE_LOW_BY_CATEGORY[categoryForTrade(tradeKey)] ?? DEFAULT_BARE_LOW;
}

/** Add a trade's typical burden to a bare wage → a loaded $/hr (2 dp). For the
 *  opt-in "compute my loaded rate" helper only — NEVER auto-applied to stored
 *  rates. */
export function applyBurden(bareWage: number, tradeKey: string): number {
  if (!Number.isFinite(bareWage) || bareWage <= 0) return 0;
  return Math.round(bareWage * (1 + burdenPctForTrade(tradeKey)) * 100) / 100;
}

/** True when an entered rate looks like a BARE wage (not burden-loaded) for the
 *  trade — below the midpoint between the bare-low and a loaded-low. Nudge only,
 *  never blocks. */
export function looksLikeBareWage(tradeKey: string, rate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  return rate < bareLowForTrade(tradeKey) * (1 + burdenPctForTrade(tradeKey) * 0.5);
}

/** Whole-percent burden for display, e.g. 40. */
export function burdenPercentLabel(tradeKey: string): number {
  return Math.round(burdenPctForTrade(tradeKey) * 100);
}
