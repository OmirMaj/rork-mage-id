// utils/invoiceReminders.ts — client wrapper around the invoice-dunning edge
// function's single-invoice mode.
//
// The dunning cron has always been able to email one invoice
// (`POST { invoiceId }`), but it was gated to the pg_cron shared secret, so
// the GC could not reach it. It now also accepts an authenticated user JWT and
// verifies that the caller OWNS the invoice before sending anything.
//
// The manual send deliberately reuses the same eligibility + stage machinery
// as the cron (utils/billingFlowCore.ts, mirrored server-side): a "send now"
// can re-send at the CURRENT stage after a 24h window, but can never skip a
// stage, never invents a stage the days-overdue hasn't earned, and never
// bypasses an unsubscribe.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ReminderBlockReason } from '@/utils/billingFlowCore';

export interface SendReminderResult {
  success: boolean;
  /** 'sent' — an email actually went out and the marker advanced. */
  outcome?: 'sent' | 'skipped';
  /** Server-side skip reason. Mirrors ReminderBlockReason plus 'no_recipient'. */
  reason?: ReminderBlockReason | 'no_recipient' | 'send_failed';
  /** Dunning stage after the send (unchanged on a skip). */
  stage?: number;
  /** ISO timestamp of the confirmed send. */
  sentAt?: string;
  /** Address the reminder went to, for the success toast. */
  recipient?: string;
  error?: string;
}

/**
 * supabase-js collapses every non-2xx into "Edge Function returned a non-2xx
 * status code", which tells the GC nothing. The real reason is in the response
 * body hanging off `error.context` — read it best-effort so a 404 (invoice not
 * synced yet) doesn't look like the same failure as a 500.
 */
async function serverErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try {
    const body = await ctx.json() as { error?: unknown };
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * Send the payment reminder for ONE invoice, right now.
 *
 * Returns `{ success: true, outcome: 'skipped', reason }` when the server
 * declined (paid, not overdue, unsubscribed, inside the 24h window) — that is
 * a normal, explainable outcome, not an error. `success: false` means the call
 * itself failed and the GC should retry.
 */
export async function sendInvoiceReminderNow(invoiceId: string): Promise<SendReminderResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Not connected. Reminders need an internet connection.' };
  }
  if (!invoiceId) return { success: false, error: 'Missing invoice.' };
  try {
    const { data, error } = await supabase.functions.invoke<SendReminderResult>('invoice-dunning', {
      body: { invoiceId, manual: true },
    });
    if (error) {
      const serverMsg = await serverErrorMessage(error);
      console.warn('[invoiceReminders] invoke error:', serverMsg ?? error.message);
      // A brand-new invoice may still be sitting in the offline queue, so the
      // service-role fn genuinely cannot see it yet. Say that, rather than
      // implying the reminder machinery is broken.
      if (serverMsg === 'invoice not found') {
        return { success: false, error: 'This invoice hasn’t finished syncing yet. Reconnect, give it a moment, and try again.' };
      }
      if (serverMsg === 'forbidden' || serverMsg === 'unauthorized') {
        return { success: false, error: 'You’re not signed in to the account that owns this invoice.' };
      }
      return { success: false, error: serverMsg ?? error.message ?? 'Could not send the reminder.' };
    }
    if (!data) return { success: false, error: 'No response from the reminder service.' };
    return data;
  } catch (err) {
    console.warn('[invoiceReminders] invoke threw:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
