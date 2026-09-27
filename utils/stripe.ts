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
//     amountCents: Math.round(netBalanceDue(invoice) * 100), // retention-net (utils/invoiceBilling)
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
   * production. The tier-aware platform fee is also applied automatically
   * when this is set.
   */
  stripeAccountId?: string;
  /**
   * GC's current MAGE subscription tier, for telemetry/labels only. The fee
   * the edge function applies comes from the SERVER-resolved tier and the one
   * schedule in utils/platformFees.ts (PLATFORM_FEE_BPS — mirrored byte-for-
   * byte in create-payment-link and diffed by scripts/validate-platform-fees).
   * Audit 2026-09-03 MONEY-F8: this comment used to state its own rate table.
   */
  userTier?: 'free' | 'pro' | 'business' | 'enterprise';
  /**
   * Which table `invoiceId` refers to. Defaults to 'invoice' on the server
   * when omitted, so regular invoice callers need not pass it. AIA pay apps
   * pass 'aia_pay_app' so the edge function verifies ownership against the
   * aia_pay_apps table and the webhook reconciles the payment there.
   */
  recordType?: 'invoice' | 'aia_pay_app';
}

export interface CreatePaymentLinkResult {
  success: boolean;
  url?: string;
  id?: string;
  error?: string;
  /**
   * The function's refusal code, read from the non-2xx body
   * (supabase-js collapses every non-2xx into one generic sentence; the reason
   * hangs off `error.context`). 'payment_pending', 'sample_project',
   * 'not_connected', and — health MONEY-PAYLINK-AMOUNT-TRUST — 'balance_changed'
   * (the amount is above what the SERVER says is owed) and 'nothing_due'.
   * For those two, `error` is the sentence to show and `serverBalanceCents`
   * is the server's figure.
   */
  code?: string;
  /** Integer cents the server row says is owed, on 'balance_changed' / 'nothing_due'. */
  serverBalanceCents?: number;
}

/** The two refusals where the SERVER balance, not the device's, decides. */
export const PAY_LINK_BALANCE_CODES = ['balance_changed', 'nothing_due'] as const;
export type PayLinkBalanceCode = typeof PAY_LINK_BALANCE_CODES[number];
export function isPayLinkBalanceCode(code: unknown): code is PayLinkBalanceCode {
  return code === 'balance_changed' || code === 'nothing_due';
}

/** Same words as the server's payLinkRefusalMessage, for a body without one. */
export function payLinkBalanceFallback(
  code: PayLinkBalanceCode,
  serverBalanceCents?: number,
  recordType: 'invoice' | 'aia_pay_app' = 'invoice',
): string {
  const noun = recordType === 'aia_pay_app' ? 'pay application' : 'invoice';
  if (code === 'nothing_due') return `Nothing is owed on this ${noun} any more.`;
  const now = typeof serverBalanceCents === 'number'
    ? ` (now $${(serverBalanceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
    : '';
  return `This ${noun}'s balance changed on the server${now}. Refresh the ${noun} before sending.`;
}

/**
 * A background re-mint the SERVER refused because its balance has not caught
 * up with this device yet — a write that is still queued, not a payment that
 * landed elsewhere. Returns the sentence to show, or null when the refusal is
 * not that case (any other failure keeps its existing handling).
 *
 *  - 'retention_release': the release raised the balance on this device; the
 *    server still holds the pre-release figure until the queued write lands.
 *  - 'certificate': a certificate recorded ABOVE the amount applied for; the
 *    server compares against line 8 until the certificate sidecar lands.
 */
export function payLinkRemintRefusalNotice(
  code: unknown,
  context: 'retention_release' | 'certificate',
): string | null {
  if (code !== 'balance_changed') return null;
  if (context === 'retention_release') {
    return 'The release is saved on this device but has not reached the server yet, so the pay link was not replaced. '
      + 'The client portal hides the old link. Once the release has synced, tap Regenerate pay link or send the invoice.';
  }
  return 'The server has not received the architect’s certificate yet, so it still checks the pay link against the amount applied for. '
    + 'Try replacing the pay link again in a moment.';
}

/**
 * Read a create-payment-link non-2xx body ONCE (a Response body can be read a
 * single time) into a result. Pure apart from the body read, so the validator
 * drives it with a fake FunctionsHttpError.
 */
export async function paymentLinkErrorResult(
  error: unknown,
  recordType: 'invoice' | 'aia_pay_app' = 'invoice',
): Promise<CreatePaymentLinkResult> {
  const err = error as { message?: unknown; context?: { json?: () => Promise<unknown> } } | null;
  const fallback = typeof err?.message === 'string' && err.message ? err.message : 'Couldn’t create the pay link';
  const ctx = err?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json() as { error?: unknown; code?: unknown; serverBalanceCents?: unknown; message?: unknown } | null;
      const bodyError = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : '';
      const code = typeof body?.code === 'string' && body.code.trim() ? body.code.trim() : bodyError;
      if (isPayLinkBalanceCode(code)) {
        const cents = typeof body?.serverBalanceCents === 'number' && Number.isFinite(body.serverBalanceCents)
          ? Math.max(0, Math.round(body.serverBalanceCents))
          : undefined;
        // The server's own sentence (_shared/payLinkBalance payLinkRefusalMessage)
        // names the balance it compared against. Not imported here: that file
        // is Deno-side and imports paymentMath with a `.ts` path the app
        // bundle does not take. The fallback says the same thing.
        const serverSentence = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : '';
        return { success: false, code, serverBalanceCents: cents, error: serverSentence || payLinkBalanceFallback(code, cents, recordType) };
      }
      if (bodyError || code) return { success: false, error: bodyError || code, code: code || undefined };
    } catch {
      // Not JSON, or already read — fall through to the transport message.
    }
  }
  return { success: false, error: fallback };
}

export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<CreatePaymentLinkResult> {
  // Fail early with a clean error rather than letting Supabase throw cryptically
  // when envs are missing. The UI surfaces this message verbatim.
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Payments aren’t set up in this version of the app.',
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
        userTier: params.userTier,
        // Omit entirely when unset so existing invoice callers send an
        // identical body; the edge function defaults to 'invoice'.
        ...(params.recordType ? { recordType: params.recordType } : {}),
      },
    });

    if (error) {
      console.error('[Stripe] Edge function error:', error);
      return paymentLinkErrorResult(error, params.recordType ?? 'invoice');
    }

    const result = data as CreatePaymentLinkResult | null;
    if (!result?.success || !result.url || !result.id) {
      return {
        success: false,
        error: result?.error || 'Stripe didn’t return a pay link',
      };
    }

    console.log('[Stripe] Created payment link', result.id);
    return { success: true, url: result.url, id: result.id };
  } catch (err) {
    console.error('[Stripe] Invoke threw:', err);
    return { success: false, error: String(err) };
  }
}
