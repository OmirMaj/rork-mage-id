// webhooks.ts — outbound webhook client helpers.
//
// Fire-and-forget dispatcher that POSTs the event payload to the
// `webhook-dispatch` Supabase edge function, which fans out to every
// matching endpoint the user has configured.
//
// All firings are best-effort: never throw, never block the UI. If
// the dispatch fails (network, function 500), we log in dev and move
// on. Receivers verify HMAC signatures so failed dispatches don't
// pollute their inbox.

import { supabase } from '@/lib/supabase';

export type WebhookEvent =
  | 'invoice_paid'
  | 'rfi_answered'
  | 'project_created'
  | 'subscription_purchased'
  | 'subscription_cancelled'
  | 'change_order_approved'
  | 'dfr_submitted'
  | 'bid_received'        // homeowner side
  | 'bid_submitted'       // GC side
  | 'permit_qa_used'
  | 'test';

export interface WebhookEndpoint {
  id: string;
  url: string;
  label: string;
  signing_secret: string;
  event_filter: WebhookEvent[] | null;
  enabled: boolean;
  last_fired_at: string | null;
  last_status: number | null;
  last_error: string | null;
  fire_count: number;
  fail_count: number;
  created_at: string;
}

/**
 * Dispatch a webhook event to all of the current user's enabled
 * endpoints that subscribe to this event. Never throws.
 */
export async function dispatchWebhook(
  event: WebhookEvent,
  data: Record<string, unknown> = {},
): Promise<{ dispatched: number; failed: number } | null> {
  try {
    const { data: result, error } = await supabase.functions.invoke('webhook-dispatch', {
      body: { event, data },
    });
    if (error) {
      if (__DEV__) console.warn('[webhooks] dispatch failed:', error);
      return null;
    }
    return result as { dispatched: number; failed: number };
  } catch (err) {
    if (__DEV__) console.warn('[webhooks] dispatch threw:', err);
    return null;
  }
}

/**
 * Generate a strong random signing secret (32 bytes → 64 hex chars).
 * Used when creating a new endpoint; shown once for the user to copy
 * into their receiver's signature-verification config.
 */
export function generateSigningSecret(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback — should never hit in RN, but be safe.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** List all webhook endpoints owned by the current user. */
export async function listEndpoints(): Promise<WebhookEndpoint[]> {
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    if (__DEV__) console.warn('[webhooks] list failed:', error);
    return [];
  }
  return (data ?? []) as WebhookEndpoint[];
}

/** Create a new webhook endpoint. Generates a signing secret. */
export async function createEndpoint(opts: {
  url: string;
  label: string;
  eventFilter?: WebhookEvent[] | null;
}): Promise<WebhookEndpoint | null> {
  const signing_secret = generateSigningSecret();
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .insert({
      url: opts.url,
      label: opts.label,
      signing_secret,
      event_filter: opts.eventFilter ?? null,
      enabled: true,
    })
    .select('*')
    .single();
  if (error) {
    if (__DEV__) console.warn('[webhooks] create failed:', error);
    return null;
  }
  return data as WebhookEndpoint;
}

/** Toggle an endpoint enabled/disabled. */
export async function toggleEndpoint(id: string, enabled: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('webhook_endpoints')
    .update({ enabled })
    .eq('id', id);
  return !error;
}

/** Delete an endpoint. */
export async function deleteEndpoint(id: string): Promise<boolean> {
  const { error } = await supabase.from('webhook_endpoints').delete().eq('id', id);
  return !error;
}
