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

export async function startStripeConnectOnboarding(
  params: OnboardingParams,
): Promise<OnboardingResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase not initialized' };
  }
  if (!params.userId || !params.email) {
    return { success: false, error: 'Missing user info' };
  }
  try {
    const { data, error } = await supabase.functions.invoke('connect-onboarding', {
      body: params,
    });
    if (error) {
      console.error('[StripeConnect] onboarding error:', error);
      return { success: false, error: error.message ?? 'Onboarding failed' };
    }
    const result = data as OnboardingResult | null;
    if (!result?.success) {
      return { success: false, error: result?.error ?? 'Stripe onboarding failed' };
    }
    return result;
  } catch (err) {
    console.error('[StripeConnect] onboarding threw:', err);
    return { success: false, error: String(err) };
  }
}

export async function fetchStripeConnectStatus(
  userId: string,
): Promise<ConnectStatusResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase not initialized' };
  }
  if (!userId) return { success: false, error: 'Missing userId' };
  try {
    const { data, error } = await supabase.functions.invoke('connect-status', {
      body: { userId },
    });
    if (error) {
      console.error('[StripeConnect] status error:', error);
      return { success: false, error: error.message ?? 'Status check failed' };
    }
    const result = data as ConnectStatusResult | null;
    if (!result?.success) {
      return { success: false, error: result?.error ?? 'Stripe status failed' };
    }
    return result;
  } catch (err) {
    console.error('[StripeConnect] status threw:', err);
    return { success: false, error: String(err) };
  }
}
