// stripeConnect.ts
//
// Client-side wrapper around the connect-onboarding + connect-status
// edge functions. Used by Settings → Payments to:
//   • Start (or resume) Stripe Connect Express onboarding for the
//     current GC. Returns a hosted Stripe URL we open in an in-app
//     browser.
//   • Poll the GC's connection status so the UI can show
//     "Not connected", "Pending verification", or "Connected ✓".
//
// We deliberately do NOT cache anything here. The Settings screen
// caches via React Query so a back-and-forth between screens stays
// fresh without spamming Stripe.
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { stripeAccountStateFrom, type StripeAccountState } from '@/utils/billingFlowCore';

export type ConnectStatus = 'none' | 'incomplete' | 'pending' | 'connected';

export interface OnboardingParams {
  userId: string;
  email: string;
  /** URL Stripe redirects to once the GC finishes the onboarding flow. */
  returnUrl: string;
  /** URL Stripe redirects to if the link expires before completion. */
  refreshUrl: string;
  /** Pre-fills the business name on the form. */
  companyName?: string;
}

export interface OnboardingResult {
  success: boolean;
  /** Hosted onboarding URL — open in an in-app browser. Empty if alreadyEnabled. */
  url?: string;
  accountId?: string;
  alreadyEnabled?: boolean;
  error?: string;
}

export interface ConnectStatusResult {
  success: boolean;
  status?: ConnectStatus;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  error?: string;
}

/**
 * The connect-onboarding / connect-status functions answer with short codes
 * ("unauthenticated", "signed-in account has no email address"). A code a
 * person can act on gets its own sentence; anything else falls back to the
 * caller's generic line.
 */
function actionableStripeReason(code: unknown, flow: 'setup' | 'status'): string | null {
  if (typeof code !== 'string') return null;
  if (code === 'unauthenticated' || code === 'userId does not match caller') {
    return flow === 'setup' ? 'Sign in again, then start setup.' : 'Sign in again to check Stripe.';
  }
  if (code === 'signed-in account has no email address') {
    return 'Add an email address to your account, then start setup.';
  }
  return null;
}

/** A non-2xx reply arrives as FunctionsHttpError with the body on `context`. */
async function codeFromInvokeError(error: unknown): Promise<unknown> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
    if (!ctx || typeof ctx.json !== 'function') return null;
    const body = (await ctx.json()) as { error?: unknown } | null;
    return body?.error ?? null;
  } catch {
    return null;
  }
}

export async function startStripeConnectOnboarding(
  params: OnboardingParams,
): Promise<OnboardingResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'MAGE ID can’t reach Stripe from this build. Try again later.' };
  }
  if (!params.userId || !params.email) {
    return { success: false, error: 'Sign in again, then start setup.' };
  }
  try {
    const { data, error } = await supabase.functions.invoke('connect-onboarding', {
      body: params,
    });
    if (error) {
      console.error('[StripeConnect] onboarding error:', error);
      const known = actionableStripeReason(await codeFromInvokeError(error), 'setup');
      return { success: false, error: known ?? 'Couldn’t start Stripe setup. Check your connection and try again.' };
    }
    const result = data as OnboardingResult | null;
    if (!result?.success) {
      return { success: false, error: actionableStripeReason(result?.error, 'setup') ?? 'Couldn’t start Stripe setup. Try again.' };
    }
    return result;
  } catch (err) {
    console.error('[StripeConnect] onboarding threw:', err);
    return { success: false, error: 'Couldn’t start Stripe setup. Check your connection and try again.' };
  }
}

export async function fetchStripeConnectStatus(
  userId: string,
): Promise<ConnectStatusResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'MAGE ID can’t reach Stripe from this build. Try again later.' };
  }
  if (!userId) return { success: false, error: 'Sign in again to check Stripe.' };
  try {
    const { data, error } = await supabase.functions.invoke('connect-status', {
      body: { userId },
    });
    if (error) {
      console.error('[StripeConnect] status error:', error);
      const known = actionableStripeReason(await codeFromInvokeError(error), 'status');
      return { success: false, error: known ?? 'Couldn’t check Stripe. Check your connection and try again.' };
    }
    const result = data as ConnectStatusResult | null;
    if (!result?.success) {
      return { success: false, error: actionableStripeReason(result?.error, 'status') ?? 'Couldn’t check Stripe. Try again.' };
    }
    return result;
  } catch (err) {
    console.error('[StripeConnect] status threw:', err);
    return { success: false, error: 'Couldn’t check Stripe. Check your connection and try again.' };
  }
}

/**
 * #36 — the GC's connected account as ONE of three answers, never two.
 * `unreachable` (offline, the status function down) used to read as "not
 * connected", which sent invoices with no Pay button under a plain "sent"
 * toast and told him falsely he had never connected Stripe. The mapping is
 * pure (utils/billingFlowCore.stripeAccountStateFrom) so the validators
 * execute it; this is only the network half.
 */
export async function resolveStripeAccount(userId: string | null | undefined): Promise<StripeAccountState> {
  if (!userId) return { kind: 'unreachable', error: 'not signed in' };
  return stripeAccountStateFrom(await fetchStripeConnectStatus(userId));
}
