// notifyClient — thin client-side wrapper around the `notify` edge function.
//
// The notify function is normally fired by AFTER INSERT/UPDATE triggers
// in Postgres (via pg_net.http_post), so the GC's app doesn't usually
// need to call it directly. There are a few cases where we want a
// deterministic, low-latency notification right after the user takes an
// action (e.g. GC delivers the closeout binder). For those, we POST
// here with the user's session token — RLS gates the read paths the
// edge function uses behind service role anyway.
//
// Fire-and-forget by design — we don't want a failed email to block UX.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Notify event types this helper supports.
 * Keep in sync with the switch statement in supabase/functions/notify/index.ts.
 */
export type NotifyEventType =
  | 'portal_message'
  | 'budget_proposal'
  | 'co_approval'
  | 'sub_invoice_submitted'
  | 'sub_invoice_reviewed'
  | 'nearby_rfp_posted'
  | 'rfp_awarded'
  | 'contract_signed'
  | 'selection_chosen'
  | 'bid_question_asked'
  | 'bid_question_answered'
  | 'closeout_binder_sent';

export interface NotifyPayload {
  // Common keys the dispatcher looks at — all optional, supply whatever
  // the receiving event needs. Snake_case here because the edge function
  // already reads payload[snake_case].
  project_id?: string;
  project_name?: string;
  portal_id?: string;
  gc_user_id?: string;
  contractor_user_id?: string;
  // Event-specific fields go here (catch-all index signature).
  [key: string]: unknown;
}

/**
 * Fire a notification event. Resolves to true on a 2xx response, false
 * otherwise. Never throws — by design, notify failures should never
 * crash the user's flow.
 */
export async function notifyEvent(event: NotifyEventType, payload: NotifyPayload): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  if (!SUPABASE_ANON_KEY) {
    console.warn('[notifyClient] no anon key; skipping');
    return false;
  }
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token ?? SUPABASE_ANON_KEY;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        event,
        payload,
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.warn('[notifyClient]', event, 'failed', r.status, text.slice(0, 160));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[notifyClient]', event, 'threw', e);
    return false;
  }
}
