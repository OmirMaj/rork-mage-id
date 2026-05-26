// supabase/functions/_shared/qbo.ts — OAuth + HTTP helpers for QuickBooks Online.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const INTUIT_CLIENT_ID     = Deno.env.get("INTUIT_CLIENT_ID")     || "";
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET") || "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")         || "";
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

export const TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const REVOKE_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export function qboApiBase(env: 'sandbox' | 'production'): string {
  return env === 'sandbox'
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export interface QboConnectionRow {
  user_id: string;
  realm_id: string;
  environment: 'sandbox' | 'production';
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  company_name: string | null;
  status: 'connecting' | 'connected' | 'reauth_required' | 'error' | 'disconnected';
  last_sync_at: string | null;
  last_error: string | null;
}

export function svc() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase service-role not configured.");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Load the caller's connection by user_id. Returns null if not connected. */
export async function loadConnection(userId: string): Promise<QboConnectionRow | null> {
  const { data, error } = await svc().from('qbo_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`qbo_connections read failed: ${error.message}`);
  return data as QboConnectionRow | null;
}

/** Persist new tokens after a refresh or initial exchange. Intuit rotates the
 *  refresh token on every call — persist BOTH atomically. */
export async function saveTokens(userId: string, patch: {
  access_token: string; refresh_token: string; access_expires_at: string;
  realm_id?: string; environment?: 'sandbox' | 'production';
  company_name?: string | null; status?: QboConnectionRow['status']; last_error?: string | null;
}): Promise<void> {
  const { error } = await svc().from('qbo_connections').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw new Error(`qbo_connections write failed: ${error.message}`);
}

/** Refresh the access token IF expiring within 5 minutes. Updates the row. */
export async function ensureFreshAccess(conn: QboConnectionRow): Promise<QboConnectionRow> {
  const exp = new Date(conn.access_expires_at).getTime();
  if (Date.now() < exp - 5 * 60_000) return conn;
  return await refreshAccessToken(conn);
}

/** Exchange the refresh token for a new access (+refresh) token. */
export async function refreshAccessToken(conn: QboConnectionRow): Promise<QboConnectionRow> {
  if (!INTUIT_CLIENT_ID || !INTUIT_CLIENT_SECRET) {
    throw new Error("Intuit OAuth not configured: set INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET in Supabase secrets.");
  }
  const basic = btoa(`${INTUIT_CLIENT_ID}:${INTUIT_CLIENT_SECRET}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let r: Response;
  try {
    r = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(conn.refresh_token)}`,
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    // invalid_grant => the user must re-auth, BUT only if our refresh_token
    // is still the one of record. Under concurrent refresh, two callers can
    // race: the second sees invalid_grant because the first already rotated
    // the token. Don't clobber the freshly-stored tokens.
    if (/invalid_grant/i.test(text)) {
      const current = await loadConnection(conn.user_id);
      if (!current || current.refresh_token === conn.refresh_token) {
        await saveTokens(conn.user_id, {
          access_token: conn.access_token,
          refresh_token: conn.refresh_token,
          access_expires_at: conn.access_expires_at,
          status: 'reauth_required',
          last_error: 'QuickBooks needs to be reconnected (refresh token expired).',
        });
      }
    }
    throw new Error(`Intuit token refresh ${r.status}: ${text.slice(0, 300)}`);
  }
  const j = await r.json() as { access_token: string; refresh_token: string; expires_in: number };
  const next: QboConnectionRow = {
    ...conn,
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    access_expires_at: new Date(Date.now() + (j.expires_in - 30) * 1000).toISOString(),
  };
  await saveTokens(conn.user_id, {
    access_token: next.access_token,
    refresh_token: next.refresh_token,
    access_expires_at: next.access_expires_at,
    status: 'connected',
    last_error: null,
  });
  return next;
}

/** Call a QBO V3 endpoint. Auto-refreshes once on 401; otherwise throws on non-2xx. */
export async function qboFetch(conn: QboConnectionRow, path: string, init: RequestInit = {}): Promise<unknown> {
  let live = await ensureFreshAccess(conn);
  const url = `${qboApiBase(live.environment)}/v3/company/${encodeURIComponent(live.realm_id)}${path}`;
  const doFetch = async (c: QboConnectionRow): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      return await fetch(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          'Authorization': `Bearer ${c.access_token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  };
  let res = await doFetch(live);
  if (res.status === 401) {
    live = await refreshAccessToken(live);
    res = await doFetch(live);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`QBO ${res.status} ${path}: ${parseQboError(text)}`);
  }
  return await res.json();
}

/** Extract a useful message from Intuit's verbose Fault envelope. */
export function parseQboError(text: string): string {
  try {
    const j = JSON.parse(text);
    const msgs: string[] = [];
    const errs = j?.Fault?.Error ?? j?.fault?.error ?? [];
    for (const e of errs) {
      if (e?.Message) msgs.push(e.Message);
      else if (e?.message) msgs.push(e.message);
      if (e?.Detail) msgs.push(e.Detail);
      else if (e?.detail) msgs.push(e.detail);
    }
    if (msgs.length) return msgs.join(' · ');
  } catch { /* not JSON */ }
  return text.slice(0, 300);
}

/** Stable hash of a sync-relevant object, used to skip redundant pushes. */
export async function qboHash(obj: unknown): Promise<string> {
  const enc = new TextEncoder().encode(stableStringify(obj));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

/** State signing for the OAuth start→callback handoff (HMAC-SHA256). */
// State HMAC secret. PREFER setting INTUIT_STATE_SECRET to a dedicated 32-byte
// random value so rotating the OAuth client secret doesn't invalidate
// in-flight OAuth state tokens (which would confuse users mid-connect).
const STATE_SECRET = Deno.env.get("INTUIT_STATE_SECRET") || INTUIT_CLIENT_SECRET;
const STATE_TTL_MS = 10 * 60_000;
export async function signState(userId: string): Promise<string> {
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${userId}|${exp}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(`${payload}|${hex}`).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export async function verifyState(state: string): Promise<{ userId: string } | null> {
  try {
    const decoded = atob(state.replace(/-/g, '+').replace(/_/g, '/'));
    const [userId, expStr, hex] = decoded.split('|');
    if (!userId || !expStr || !hex) return null;
    if (Date.now() > Number(expStr)) return null;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(STATE_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    // Decode incoming hex signature to bytes for constant-time verify().
    const pairs = hex.match(/.{2}/g);
    if (!pairs || pairs.length * 2 !== hex.length) return null;
    const sig = new Uint8Array(pairs.map(b => parseInt(b, 16)));
    const ok = await crypto.subtle.verify(
      'HMAC', key, sig, new TextEncoder().encode(`${userId}|${expStr}`),
    );
    return ok ? { userId } : null;
  } catch { return null; }
}
