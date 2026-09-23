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

import { supabase, isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

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
  | 'closeout_binder_sent'
  // Invitation to bid (utils/bidInvites.ts). The payload carries the sub's
  // address and the tokenized /bid-invite/ URL; the invite row is already on
  // the server by the time this fires, so the link in the mail resolves.
  | 'bid_invite_sent';

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
 * What happened to one notify call. `handled` is true only when the dispatcher
 * said it handled the event; `reason` names why not:
 *   - a dispatcher refusal, read from the 200 envelope's `result.reason`
 *     (`unknown_event`, `no_gc_resolved`, and — once w5-join-server lands it —
 *     `suppressed_unsubscribed` / `email_send_failed` / `no_recipient` from
 *     the bid_invite_sent branch);
 *   - or a transport failure: `not_configured`, `http_<status>`, `unreachable`.
 * A screen that must say WHY an email did not go ("<email> unsubscribed from
 * invitation emails — text them the link") needs the reason, not a boolean
 * (#94): a generic "could not hand the email off" sends the GC to re-send a
 * mail that can never arrive. Which reasons are worth retrying is
 * utils/bidInvitePending.isRetryableNotifyReason's call.
 */
export interface NotifyOutcome {
  handled: boolean;
  reason?: string;
}

/**
 * Fire a notification event and report exactly what the dispatcher said. Never
 * throws — by design, notify failures should never crash the user's flow.
 *
 * A 2xx is NOT enough. `notify` answers an event its switch does not know with
 * `{ok:false, reason:'unknown_event'}` and no `httpStatus`, which the serve
 * wrapper turns into HTTP 200 `{"success":true,"result":{"ok":false,…}}` — and
 * the same shape carries `no_gc_resolved` and `no_gc_profile`. Reading only
 * `Response.ok` therefore reports "sent" for mail that was never composed:
 * utils/bidInvites.ts believed that and told the GC his subs had been emailed
 * when nothing left the building. The envelope is the answer; the status code
 * is only the transport.
 */
export async function notifyEventDetailed(event: NotifyEventType, payload: NotifyPayload): Promise<NotifyOutcome> {
  if (!isSupabaseConfigured) return { handled: false, reason: 'not_configured' };
  if (!SUPABASE_ANON_KEY) {
    console.warn('[notifyClient] no anon key; skipping');
    return { handled: false, reason: 'not_configured' };
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
    const text = await r.text().catch(() => '');
    if (!r.ok) {
      console.warn('[notifyClient]', event, 'failed', r.status, text.slice(0, 160));
      return { handled: false, reason: `http_${r.status}` };
    }
    // Unreadable body on a 2xx: the request landed, and we have nothing that
    // says the dispatcher refused it. Treat that as sent rather than inventing
    // a failure the user would act on.
    let envelope: { success?: unknown; error?: unknown; result?: { ok?: unknown; reason?: unknown } } | null = null;
    try { envelope = text ? JSON.parse(text) : null; } catch { envelope = null; }
    if (!envelope || typeof envelope !== 'object') return { handled: true };
    const handled = envelope.success !== false && envelope.result?.ok !== false;
    if (!handled) {
      const why = envelope.result?.reason ?? envelope.error ?? 'refused';
      console.warn('[notifyClient]', event, 'not handled', why);
      return { handled: false, reason: typeof why === 'string' ? why : 'refused' };
    }
    return { handled: true };
  } catch (e) {
    console.warn('[notifyClient]', event, 'threw', e);
    return { handled: false, reason: 'unreachable' };
  }
}

/**
 * Fire a notification event. Resolves to true only when the dispatcher actually
 * accepted and handled the event; false otherwise. The boolean wrapper every
 * existing caller uses — see notifyEventDetailed for the reason.
 */
export async function notifyEvent(event: NotifyEventType, payload: NotifyPayload): Promise<boolean> {
  const outcome = await notifyEventDetailed(event, payload);
  if (!outcome.handled) return false;
  return true;
}
