// utils/clientPricing.ts — single source of truth for the property-owner
// pricing model and the placeholder credit ledger used by the in-app
// paywall before real Stripe billing lands.
//
// Pricing model (set by product, May 2026):
//   - $25 to post a single RFP (one-off). The fee filters tire-kickers
//     and captures value at the moment of highest intent — when the
//     owner is committing to actually start a project. Marketplace stays
//     free to browse so contractors get a real audience.
//   - $19/mo "Pro" subscription for individual landlords — unlimited
//     RFP posts + post-award management (milestones, docs, change orders).
//   - $49/mo "Property Manager" tier — multi-property dashboard +
//     team seats, for PMs and small REITs.
//   - 14-day free trial on either subscription tier (no card on file).
//
// IMPORTANT: All amounts in cents (Stripe-native). The presentation layer
// formats them with formatMoney(cents/100). Keeping cents avoids the FP
// rounding bugs that always show up the moment "$24.99" becomes 24.99 +
// 5.50 sales tax in a JS number.
//
// THIS COMMIT ships gating + placeholder UI only. The "Pay $25" and
// "Start trial" buttons grant a local credit recorded in AsyncStorage so
// the user can flow through /post-rfp to verify the gate end-to-end.
// Real Stripe charges + RevenueCat client tier wire up in a follow-up.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const CLIENT_PRICING = {
  /** One-off fee charged per RFP a property owner posts. Cents. */
  RFP_POST_FEE_CENTS: 2_500,
  /** Pro client subscription (individual landlord) monthly price. Cents. */
  CLIENT_PRO_MONTHLY_CENTS: 1_900,
  /** Property-manager client subscription monthly price. Cents. */
  CLIENT_PM_MONTHLY_CENTS: 4_900,
  /** Days of free trial on either client subscription tier. */
  TRIAL_DAYS: 14,
} as const;

export type ClientSubscriptionTier = 'free' | 'client_pro' | 'client_pm';

// ── AsyncStorage keys ────────────────────────────────────────────────────
// `mageid_*` prefix mirrors the rest of the auth/credentials code; we
// don't reuse the `buildwise_*` legacy prefix or the `tertiary_*` per-
// project prefix because client pricing state is per-account, not per-
// project. These keys are wiped by AuthContext on logout via the
// LOCAL_USER_CACHE_KEYS list (already includes the user-role mirror;
// we add the credit ledger + trial state below in a follow-up if real
// billing isn't shipped first).
const RFP_POST_CREDITS_KEY = 'mageid_client_rfp_credits_v1';
const CLIENT_SUB_STATE_KEY = 'mageid_client_sub_state_v1';

/** Records that the user has prepaid for one RFP post. The post-rfp
 *  submit flow calls `consumeRfpPostCredit()` and only proceeds if the
 *  return is true. Used as a placeholder until Stripe is wired in. */
export async function recordRfpPostCredit(): Promise<void> {
  const raw = await AsyncStorage.getItem(RFP_POST_CREDITS_KEY);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  await AsyncStorage.setItem(RFP_POST_CREDITS_KEY, String(current + 1));
}

/** Atomically consumes one credit. Returns true if the user had a credit
 *  to spend; false otherwise. The post-rfp screen treats false as
 *  "open the paywall." */
export async function consumeRfpPostCredit(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(RFP_POST_CREDITS_KEY);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (current <= 0) return false;
  await AsyncStorage.setItem(RFP_POST_CREDITS_KEY, String(current - 1));
  return true;
}

/** Read-only counter for the UI ("You have 3 prepaid posts"). */
export async function getRfpPostCreditBalance(): Promise<number> {
  const raw = await AsyncStorage.getItem(RFP_POST_CREDITS_KEY);
  return raw ? Number.parseInt(raw, 10) || 0 : 0;
}

// ── Client subscription state (placeholder) ──────────────────────────────
// Tracks the local view of whether the user is on a client subscription
// or trial. When real billing lands, this becomes a thin cache around
// the Stripe / RevenueCat source of truth — the same way contractor tier
// is derived from RC entitlements today.

export interface ClientSubState {
  tier: ClientSubscriptionTier;
  /** ISO timestamp when the trial ends. Null if not in a trial. */
  trialEndsAt: string | null;
  /** When the subscription was last updated locally. */
  updatedAt: string;
}

const EMPTY_CLIENT_SUB_STATE: ClientSubState = {
  tier: 'free',
  trialEndsAt: null,
  updatedAt: new Date(0).toISOString(),
};

export async function loadClientSubState(): Promise<ClientSubState> {
  try {
    const raw = await AsyncStorage.getItem(CLIENT_SUB_STATE_KEY);
    if (!raw) return EMPTY_CLIENT_SUB_STATE;
    const parsed = JSON.parse(raw) as Partial<ClientSubState>;
    return {
      tier: parsed.tier ?? 'free',
      trialEndsAt: parsed.trialEndsAt ?? null,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return EMPTY_CLIENT_SUB_STATE;
  }
}

export async function saveClientSubState(next: ClientSubState): Promise<void> {
  await AsyncStorage.setItem(CLIENT_SUB_STATE_KEY, JSON.stringify(next));
}

/** Convenience: starts a trial of the given tier. Used by the placeholder
 *  paywall — when real billing exists this routes through Stripe / RC. */
export async function startClientTrial(tier: Exclude<ClientSubscriptionTier, 'free'>): Promise<ClientSubState> {
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + CLIENT_PRICING.TRIAL_DAYS);
  const next: ClientSubState = {
    tier,
    trialEndsAt: trialEnds.toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClientSubState(next);
  return next;
}

/** Returns true if the trial timestamp is in the future. Pure function so
 *  the UI can derive trial state from a loaded ClientSubState without
 *  needing its own clock. */
export function isClientTrialActive(state: ClientSubState, now: Date = new Date()): boolean {
  if (!state.trialEndsAt) return false;
  return new Date(state.trialEndsAt).getTime() > now.getTime();
}

/** True if the user has an active client subscription or is in a trial. */
export function hasActiveClientSubscription(state: ClientSubState, now: Date = new Date()): boolean {
  if (state.tier === 'free') return false;
  // Paid (non-trial) subscriptions have no trialEndsAt; treat as active.
  if (!state.trialEndsAt) return true;
  return isClientTrialActive(state, now);
}

export function formatClientPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
