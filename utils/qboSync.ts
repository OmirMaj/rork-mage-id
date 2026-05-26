import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';

export interface QboStatus {
  status: 'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'error';
  realmId?: string;
  environment?: 'sandbox' | 'production';
  companyName?: string | null;
  lastSyncAt?: string | null;
  counts?: { synced: number; pending: number; error: number };
}

/** Start the OAuth flow. Opens an in-app browser to Intuit. The completion
 *  path depends on whether iOS intercepts the HTTPS callback URL:
 *
 *  A) iOS intercepts (Universal Links configured): openAuthSessionAsync
 *     returns `{type: 'success', url: 'https://app.mageid.app/...?code=...'}`.
 *     We parse the params and call completeQuickBooksCallback() ourselves.
 *
 *  B) iOS does NOT intercept (current state — no Universal Links):
 *     the in-app browser navigates to app.mageid.app/integrations/qbo/callback,
 *     where the web build's callback page completes the OAuth via JS and
 *     then deep-links back to `rork-app://qbo-setup`. iOS catches that
 *     custom scheme, closes the browser session, and returns
 *     `{type: 'success', url: 'rork-app://qbo-setup'}`. The URL has no
 *     code/realmId/state — we fall through and let the caller's polling
 *     loop confirm the connection.
 *
 *  Both paths converge on `{ok: true}` plus a polling step in qbo-setup. */
export async function connectQuickBooks(): Promise<{ ok: boolean; companyName?: string | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; authorizeUrl?: string; error?: string }>(
    'qbo-connect-start', { body: {} },
  );
  if (error || !data?.success || !data.authorizeUrl) {
    return { ok: false, error: error?.message ?? data?.error ?? 'Could not start QuickBooks connection.' };
  }
  try {
    if (Platform.OS === 'web') {
      // On web, redirect in the SAME tab. The /integrations/qbo/callback
      // route in this same app will pick up the redirect and complete the
      // OAuth via completeQuickBooksCallback().
      window.location.href = data.authorizeUrl;
      return { ok: true };
    }
    const result = await WebBrowser.openAuthSessionAsync(
      data.authorizeUrl,
      'https://app.mageid.app/integrations/qbo/callback',
    );
    if (result.type === 'cancel') {
      return { ok: false, error: 'Cancelled' };
    }
    // Path A: iOS intercepted the HTTPS callback (Universal Links) — try
    // the native token exchange. Best-effort: if the web page already
    // consumed the code, this fails silently and the caller's polling
    // loop will confirm the connection.
    if (result.type === 'success' && result.url) {
      try {
        const url = new URL(result.url);
        const code = url.searchParams.get('code');
        const realmId = url.searchParams.get('realmId');
        const state = url.searchParams.get('state');
        if (code && realmId && state) {
          const finish = await completeQuickBooksCallback({ code, realmId, state });
          if (finish.ok) return { ok: true, companyName: finish.companyName };
        }
      } catch { /* fall through to polling */ }
    }
    // Path B: dismiss / success-without-code — the web callback page already
    // saved the connection OR the user closed the browser early. Either way,
    // the caller's polling loop is the source of truth. Treat as ok so the
    // poll runs.
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Browser could not open.' };
  }
}

/** Complete the OAuth callback by posting code/realmId/state to the
 *  qbo-connect-callback edge function. The edge fn validates the signed
 *  state HMAC, exchanges the code for tokens at Intuit, persists them, and
 *  returns the company name for display.
 *
 *  Trust root: the signed state token (NOT a user JWT). The edge fn has
 *  verify_jwt=false so this call works from an unauthenticated browser
 *  (e.g., the in-app browser inside ASWebAuthenticationSession). */
export async function completeQuickBooksCallback(opts: { code: string; realmId: string; state: string; environment?: 'sandbox' | 'production' }): Promise<{ ok: boolean; companyName?: string | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; companyName?: string | null; error?: string }>(
    'qbo-connect-callback', { body: opts },
  );
  if (error || !data?.success) return { ok: false, error: error?.message ?? data?.error ?? 'Connection failed.' };
  return { ok: true, companyName: data.companyName };
}

export async function fetchQboStatus(): Promise<QboStatus> {
  const { data, error } = await supabase.functions.invoke<QboStatus & { success: boolean }>(
    'qbo-connect-status', { body: {} },
  );
  if (error || !data) return { status: 'disconnected' };
  return data;
}

/** Fire-and-forget push (used by useQboSync from financial mutations). */
export async function triggerQboSync(kind: 'project' | 'invoice' | 'payment' | 'item', op: 'upsert' | 'delete', objectId: string): Promise<void> {
  try { await supabase.functions.invoke('qbo-sync', { body: { kind, op, objectId } }); }
  catch { /* fire-and-forget; status flows via the qbo_sync_status field on the row */ }
}
