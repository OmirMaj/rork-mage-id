// utils/platformFees.ts
//
// The ONE table for the MAGE platform payment fee, by tier, in basis points.
// Mirrored byte-for-byte by supabase/functions/create-payment-link/index.ts
// (PLATFORM_FEE_BPS there) and checked by scripts/validate-platform-fees.ts.
//
// Before 2026-09-04 this number was stated four different ways (audit
// MONEY-F8): the edge function charged free 0 / pro 30 / business 50 /
// enterprise 40 bps; the paywall said 1.0% / 0% / 0.5% / 0.4%; Payments Setup
// said "1%"; the Payments screen computed 1% + 2.9% + 30¢ for every tier.
// This table carries what the server actually charges. If the founder wants a
// different schedule (e.g. Pro at 0 bps as the paywall once promised), change it
// HERE and in the edge function together — never in copy.

export type FeeTier = 'free' | 'pro' | 'business' | 'enterprise';

export const PLATFORM_FEE_BPS: Record<FeeTier, number> = {
  free: 0,
  pro: 30,
  business: 50,
  enterprise: 40,
};

/** Stripe's standard US card pricing, used only for on-screen estimates. */
export const STRIPE_CARD_PROCESSING = { percent: 2.9, fixedCents: 30 } as const;

/**
 * Stripe's standard US bank-debit (ACH Direct Debit) pricing: 0.8%, capped at
 * $5 per payment. Copy only — MAGE ID sets no processing price, Stripe does,
 * and the client is offered a bank option only when bank payments are turned
 * on in Stripe. (The platform fee above applies to either method.)
 */
export const STRIPE_ACH_PROCESSING = { percent: 0.8, capCents: 500 } as const;

function centsLabel(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** "cards 2.9% + 30¢; bank transfer (ACH) 0.8%, capped at $5" */
export function stripeProcessingCopy(): string {
  return `cards ${STRIPE_CARD_PROCESSING.percent}% + ${STRIPE_CARD_PROCESSING.fixedCents}¢; `
    + `bank transfer (ACH) ${STRIPE_ACH_PROCESSING.percent}%, capped at ${centsLabel(STRIPE_ACH_PROCESSING.capCents)}`;
}

/**
 * When the money reaches the GC's bank. Stripe pays out on its own schedule:
 * a new account's FIRST payout usually takes about a week, later ones about
 * two business days, and a bank-transfer (ACH) payment takes a few business
 * days to clear before it can be paid out at all. Never "1–2 business days".
 */
export const PAYOUT_TIMING_COPY =
  "Stripe pays out to your bank on its own schedule: the first payout usually takes about a week, "
  + 'later ones about 2 business days. Bank-transfer (ACH) payments take a few business days to clear first.';

/** The one-line version for a benefit list. */
export const PAYOUT_TIMING_SHORT = 'Payouts on Stripe’s schedule: first one about a week, then about 2 business days';

export function platformFeeBps(tier: string | null | undefined): number {
  return PLATFORM_FEE_BPS[(tier ?? 'free') as FeeTier] ?? PLATFORM_FEE_BPS.free;
}

/** "0%", "0.3%", "0.5%", "0.4%" — the label every screen must render from. */
export function platformFeeLabel(tier: string | null | undefined): string {
  const bps = platformFeeBps(tier);
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(pct * 10 % 1 === 0 ? 1 : 2)}%`;
}

/** Platform fee in cents for a gross amount, rounded half-up (matches the edge function). */
export function platformFeeCents(amountCents: number, tier: string | null | undefined): number {
  return Math.max(0, Math.round((amountCents * platformFeeBps(tier)) / 10000));
}

/** Estimated net to the contractor after Stripe card processing and the platform fee. */
export function estimateNetAfterFees(amountCents: number, tier: string | null | undefined): {
  stripeFeeCents: number; platformFeeCents: number; netCents: number;
} {
  const stripeFeeCents = Math.round((amountCents * STRIPE_CARD_PROCESSING.percent) / 100) + STRIPE_CARD_PROCESSING.fixedCents;
  const platform = platformFeeCents(amountCents, tier);
  return { stripeFeeCents, platformFeeCents: platform, netCents: Math.max(0, amountCents - stripeFeeCents - platform) };
}
