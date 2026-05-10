// utils/quickbooks/auth.ts — client side of the QuickBooks Online
// OAuth flow. Pairs with the qbo-oauth-start + qbo-oauth-callback
// edge functions which do the secret-bearing legs server-side.
//
// Flow:
//   1. UI tap → startQuickBooksConnect()
//   2. We call qbo-oauth-start which returns Intuit's authorize URL.
//   3. We open that URL via expo-web-browser. The user signs in to
//      Intuit and grants access.
//   4. Intuit redirects to our callback edge function. The function
//      exchanges the auth code for tokens, persists them, and
//      redirects back to APP_DEEP_LINK_URL.
//   5. Our root layout's deep-link listener catches the deep link
//      and refreshes the connection state.
//
// Why expo-web-browser instead of react-native-inappbrowser-reborn:
//   - Already in the dependency tree (used by other social-login
//     flows).
//   - openAuthSessionAsync handles the deep-link round-trip
//     automatically and resolves with { type: 'success' | 'cancel' }
//     so we don't need a separate listener.

import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface QuickBooksConnection {
  id: string;
  realmId: string;
  companyName: string | null;
  environment: 'sandbox' | 'production';
  lastUsedAt: string | null;
  scope: string | null;
  /** ISO string. We don't return the access_token to the client —
   *  it stays server-side. The client knows the connection exists +
   *  when it'll need to refresh, nothing else. */
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
  createdAt: string;
}

export type StartConnectResult =
  | { ok: true; status: 'connected' }
  | { ok: false; status: 'cancelled' | 'failed'; error?: string };

/**
 * Kick off the QBO OAuth flow. Opens an in-app browser, waits for
 * the redirect-to-deep-link round-trip, and resolves once the
 * callback function has persisted tokens. Caller should refresh
 * connection state via fetchQuickBooksConnections() after this
 * resolves with status 'connected'.
 */
export async function startQuickBooksConnect(opts?: { redirectTo?: string }): Promise<StartConnectResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, status: 'failed', error: 'Supabase is not configured.' };
  }

  // Step 1 — ask the edge function for an authorize URL. The
  // function persists a state token bound to the user_id; the
  // callback only accepts auth codes paired with a still-alive
  // state row.
  const { data, error } = await supabase.functions.invoke('qbo-oauth-start', {
    body: { redirectTo: opts?.redirectTo ?? null },
  });
  if (error || !data?.success || !data?.authorizeUrl) {
    return {
      ok: false,
      status: 'failed',
      error: error?.message ?? data?.error ?? 'Could not start the connect flow.',
    };
  }
  const authorizeUrl: string = data.authorizeUrl;

  // Step 2 — open the in-app browser. The deep-link target is
  // mageid://qbo-connected (configured in the callback function as
  // APP_DEEP_LINK_URL). expo-web-browser detects when the URL
  // matches that scheme and resolves the promise.
  const returnUrl = Linking.createURL('qbo-connected');
  try {
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnUrl);
    if (result.type === 'cancel') {
      return { ok: false, status: 'cancelled' };
    }
    if (result.type !== 'success') {
      return { ok: false, status: 'failed', error: 'Browser closed unexpectedly.' };
    }
    // Inspect the deep link's query string to detect server-side
    // failures the callback may have reported.
    const url = result.url ?? '';
    if (url.includes('error=')) {
      const m = /[?&]error=([^&]+)/.exec(url);
      const errCode = m ? decodeURIComponent(m[1]) : 'unknown';
      return { ok: false, status: 'failed', error: errCode };
    }
    return { ok: true, status: 'connected' };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Browser error.',
    };
  }
}

/**
 * Read the current user's QBO connections. RLS limits the query to
 * the signed-in user's rows. We deliberately don't expose
 * access_token or refresh_token — even though RLS would allow it,
 * the column wouldn't be useful client-side, and pulling it into
 * memory expands the blast radius on a leaked device.
 */
export async function fetchQuickBooksConnections(): Promise<QuickBooksConnection[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('quickbooks_connections')
    .select('id, realm_id, company_name, environment, last_used_at, scope, access_token_expires_at, refresh_token_expires_at, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.log('[qbo] fetch failed', error.message);
    return [];
  }
  return (data ?? []).map(r => ({
    id: r.id,
    realmId: r.realm_id,
    companyName: r.company_name,
    environment: r.environment,
    lastUsedAt: r.last_used_at,
    scope: r.scope,
    accessTokenExpiresAt: r.access_token_expires_at,
    refreshTokenExpiresAt: r.refresh_token_expires_at,
    createdAt: r.created_at,
  }));
}

/**
 * Disconnect a single QBO connection. Removes the row server-side
 * (no automatic Intuit-side revoke — the user has to remove our app
 * from intuit.com → My Apps if they want full revocation).
 */
export async function disconnectQuickBooks(connectionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Supabase not configured' };
  const { error } = await supabase.functions.invoke('qbo-disconnect', {
    body: { connectionId },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
