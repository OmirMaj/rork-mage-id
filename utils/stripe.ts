// Stripe client helper
//
// Thin wrapper around the `create-payment-link` Supabase edge function.
// Keeps Stripe secret-key handling entirely server-side — the client only ever
// sees the generated public payment URL.
//
// Usage:
//   const res = await createPaymentLink({
//     invoiceId: invoice.id,
//     invoiceNumber: invoice.number,
//     projectName: project.name,
//     amountCents: Math.round((invoice.totalDue - invoice.amountPaid) * 100),
//     customerEmail: client?.email,
//     companyName: settings.branding?.companyName,
//   });
//   if (res.success) updateInvoice(invoice.id, { payLinkUrl: res.url, payLinkId: res.id });

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface CreatePaymentLinkParams {
  invoiceId: string;
  invoiceNumber: string | number;
  projectName: string;
  /** Integer cents — the helper does NOT multiply by 100 for you. */
  amountCents: number;
  currency?: string;           // default 'usd'
  description?: string;        // shown above the submit button on the pay page
  customerEmail?: string;      // prefills the checkout email field
  companyName?: string;        // attached to the Stripe Product metadata
  /**
   * Connected Express account id (acct_xxx) for the contractor receiving
   * the money. When present, the Payment Link is created on that account
   * and money flows to their bank — not the platform's. Required for
   * production. The 1% platform fee is also applied automatically when
   * this is set.
   */
  stripeAccountId?: string;
}

export interface CreatePaymentLinkResult {
  success: boolean;
  url?: string;
  id?: string;
  error?: string;
}

export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<CreatePaymentLinkResult> {
  // Fail early with a clean error rather than letting Supabase throw cryptically
  // when envs are missing. The UI surfaces this message verbatim.
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Payment service not configured (Supabase not initialized).',
    };
  }

  // Client-side guards that mirror the edge function's validation. Catching
  // these before the round-trip gives a faster, clearer UX.
  if (!params.invoiceId) {
    return { success: false, error: 'Missing invoice id' };
  }
  if (params.invoiceNumber === undefined || params.invoiceNumber === null) {
    return { success: false, error: 'Missing invoice number' };
  }
  if (!params.projectName) {
    return { success: false, error: 'Missing project name' };
  }
  if (!Number.isFinite(params.amountCents)) {
    return { success: false, error: 'Invalid amount' };
  }
  if (params.amountCents < 50) {
    return { success: false, error: 'Minimum charge is $0.50.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('create-payment-link', {
      body: {
        invoiceId: params.invoiceId,
        invoiceNumber: params.invoiceNumber,
        projectName: params.projectName,
        amountCents: Math.round(params.amountCents),
        currency: params.currency,
        description: params.description,
        customerEmail: params.customerEmail,
        companyName: params.companyName,
        stripeAccountId: params.stripeAccountId,
      },
    });

    if (error) {
      console.error('[Stripe] Edge function error:', error);
      return { success: false, error: error.message || 'Failed to create payment link' };
    }

    const result = data as CreatePaymentLinkResult | null;
    if (!result?.success || !result.url || !result.id) {
      return {
        success: false,
        error: result?.error || 'Stripe did not return a payment link',
      };
    }

    console.log('[Stripe] Created payment link', result.id);
    return { success: true, url: result.url, id: result.id };
  } catch (err) {
    console.error('[Stripe] Invoke threw:', err);
    return { success: false, error: String(err) };
  }
}
