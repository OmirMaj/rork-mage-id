// ============================================================================
// constants/pricing.ts — the ONE fallback price table, plus the arithmetic
// that turns RevenueCat's store packages into the per-month and savings
// figures the upgrade screens print.
//
// WHY THIS EXISTS (audit wave 5, #42). Three upgrade screens carried three
// price tables and disagreed with each other and with the store:
//   • app/paywall.tsx fell back to $29 / $79 / $150 "the published list rate";
//   • components/Paywall.tsx fell back to $29.99 / $79.99 / $149.99 and an
//     annual $289.99 "mirroring App Store Connect";
//   • app/onboarding-paywall.tsx printed a hand-typed $23.20/mo and "SAVE 20%"
//     next to RevenueCat's REAL annual total — $23.20 x 12 is $278.40, the
//     store total beside it was $289.99 ($24.16/mo), so the first screen a new
//     contractor sees stated a per-month figure the store would not charge.
//
// The rules this module enforces:
//   1. One list rate per tier, the one marketing/pricing.html publishes. It is
//      a LIST price — screens label it as such and it is only shown while the
//      store's own price is unavailable.
//   2. No annual figure is ever typed here. The annual total, the per-month
//      equivalent and the savings percentage come from the store package or
//      are not shown at all ("Price shown at checkout"). Nobody has confirmed
//      an annual App Store price; a typed one is a guess printed as fact.
//   3. Derived money rounds DOWN to the smallest unit the store's own price
//      string shows, so a per-month or "save" claim is never above what the
//      contractor actually pays or saves.
//
// Pure: no React Native import, so scripts/validate-w5-paywall-*.ts executes
// the real functions.
// ============================================================================

export type PaidTier = 'pro' | 'business' | 'enterprise';

/** Published monthly list rate per tier (marketing/pricing.html prints the same). */
export const LIST_PRICE_MONTHLY: Record<PaidTier, string> = {
  pro: '$29',
  business: '$79',
  enterprise: '$150',
};

/** "$29/mo" — the list rate as the plan cards print it. */
export function listPriceLabel(tier: PaidTier): string {
  return `${LIST_PRICE_MONTHLY[tier]}/mo`;
}

/** What a screen says instead of an annual figure the store has not given us. */
export const PRICE_AT_CHECKOUT = 'Price shown at checkout';

/** The part of a RevenueCat store product these helpers read. */
export interface StorePrice {
  price: number;
  priceString: string;
}

/**
 * Format `amount` the way `template` (a store priceString such as "$289.99",
 * "289,99 €" or "¥2,900") formats its own number: same symbol and position,
 * same decimal separator, same number of decimals, same grouping. The amount
 * is FLOORED to that precision — this is only ever used for derived figures
 * (per-month equivalent, savings) where rounding up would overstate.
 * Returns null when the template carries no number to imitate, or when its
 * number is not one unbroken run (a group separator this parser does not
 * know): splicing a derived figure into the middle of the store's number
 * printed wildly wrong money (CHF 108’299.00 for 108.25). The caller then
 * says PRICE_AT_CHECKOUT instead.
 */
export function formatLikeStorePrice(template: string, amount: number): string | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  // Group separators: . , space, NBSP, narrow NBSP, and the apostrophes Swiss
  // formats use (1'299.00 / 1’299.00).
  const run = /\d(?:[\d., \u00a0\u202f'\u2019]*\d)?/.exec(template);
  if (!run) return null;
  // A digit outside the run means the number was only partly understood.
  if (/\d/.test(template.slice(run.index + run[0].length))) return null;
  const digits = run[0];
  // Decimal part: a trailing "." or "," followed by 1-2 digits. "2,900" has
  // three digits after the comma, so it is a group separator, not decimals.
  const dec = /([.,])(\d{1,2})$/.exec(digits);
  const decimals = dec ? dec[2].length : 0;
  const decimalSep = dec ? dec[1] : '';
  const intPart = dec ? digits.slice(0, dec.index) : digits;
  const groupSep = /[., \u00a0\u202f'\u2019]/.exec(intPart)?.[0] ?? '';

  const scale = 10 ** decimals;
  // Round to 1e-6 before flooring so 24.16 * 100 = 2415.9999999 does not lose a cent.
  const units = Math.floor(Math.round(amount * scale * 1e6) / 1e6);
  const whole = Math.floor(units / scale);
  const frac = units - whole * scale;
  let wholeStr = String(whole);
  if (groupSep) wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep);
  const num = decimals > 0 ? `${wholeStr}${decimalSep}${String(frac).padStart(decimals, '0')}` : wholeStr;
  return template.slice(0, run.index) + num + template.slice(run.index + digits.length);
}

/**
 * The annual package's price per month: price / 12, floored to the cent (or
 * the currency's smallest shown unit), in the package's own currency format.
 * Null when the package has not loaded — the caller then shows
 * PRICE_AT_CHECKOUT, never a typed figure.
 */
export function annualPerMonth(annual: StorePrice | null | undefined): string | null {
  if (!annual || !(annual.price > 0) || !annual.priceString) return null;
  return formatLikeStorePrice(annual.priceString, annual.price / 12);
}

/**
 * Whole-percent saving of the annual plan against twelve monthly payments,
 * floored: floor((1 - annual / (12 x monthly)) x 100). Null when either
 * package is missing or the annual plan saves nothing — the badge is then
 * hidden rather than printing a percentage nobody computed.
 * Worked in integer cents so 289.99 vs 12 x 29.99 is 19%, not 19.999…%.
 */
export function annualSavingsPercent(
  monthly: StorePrice | null | undefined,
  annual: StorePrice | null | undefined,
): number | null {
  if (!monthly || !annual || !(monthly.price > 0) || !(annual.price > 0)) return null;
  const monthlyCents = Math.round(monthly.price * 100);
  const annualCents = Math.round(annual.price * 100);
  const yearAtMonthly = monthlyCents * 12;
  const saved = yearAtMonthly - annualCents;
  if (saved <= 0) return null;
  const pct = Math.floor((saved * 100) / yearAtMonthly);
  return pct > 0 ? pct : null;
}

/**
 * Amount saved over a year on annual vs. twelve monthly payments, floored to
 * the currency's shown unit and formatted like the annual price string. Null
 * when either package is missing or there is no saving.
 */
export function annualSavingsAmount(
  monthly: StorePrice | null | undefined,
  annual: StorePrice | null | undefined,
): string | null {
  if (!monthly || !annual || !(monthly.price > 0) || !(annual.price > 0) || !annual.priceString) return null;
  const savedCents = Math.round(monthly.price * 100) * 12 - Math.round(annual.price * 100);
  if (savedCents <= 0) return null;
  return formatLikeStorePrice(annual.priceString, savedCents / 100);
}
