import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Single source of truth for the project's Supabase URL + anon key.
// Falls back to hardcoded production credentials so the app works even
// when env vars are missing (e.g., fresh clone, EAS build that lost the
// secret, OTA from before env was set). Other modules MUST import
// SUPABASE_URL / SUPABASE_ANON_KEY from here rather than reading
// process.env directly — otherwise they'll have their own empty-string
// fallback bugs (see Phase 25: the AI was broken for weeks because
// utils/mageAI.ts had `|| ''` instead of the real key).
//
// The anon key is INTENTIONALLY public — RLS protects every table.
// Embedding it in the JS bundle is normal for Supabase + RN.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = SUPABASE_ANON_KEY;

// Pre-fix these logged the first 30 chars of the URL and 20 chars of
// the anon key. Combined with Sentry's enableLogs + sendDefaultPii,
// those fragments ended up in production breadcrumbs. Now we just log
// presence — the keys themselves stay out of logs.
console.log('[Supabase] URL configured:', supabaseUrl.length > 0 ? 'yes' : 'NO');
console.log('[Supabase] Anon key configured:', supabaseAnonKey.length > 0 ? 'yes' : 'NO');

export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

let _supabase: SupabaseClient | null = null;

// ── RT-R1: dead-session detection ───────────────────────────────────────────
// supabase-js only refreshes an access token when its `exp` arrives. A token
// the server stops accepting BEFORE then — a signing-key rotation, "sign out
// everywhere" after a password change, an admin-side ban — is never refreshed:
// every read 401s with `bad_jwt` / PGRST301, the hooks swallow the error,
// Home says "All clear" over $0 tiles, and Realtime retries the dead token
// every few seconds. Nothing tells the user to sign in again.
//
// This wrapper sits under every PostgREST / Storage / Functions call the
// client makes (supabase-js hands `global.fetch` to all of them, with the
// bearer already set). On a 401 whose body names a rejected token it calls
// `auth.refreshSession()` ONCE for that access token; if the refresh fails —
// or refreshed tokens keep being rejected — it notifies AuthContext, which
// signs out locally and shows "session expired". GoTrue's own requests
// (`/auth/v1/…`, the refresh included) are passed through untouched so the
// guard can never recurse into itself.
type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/** Subscribe to "the server rejected this session and a refresh did not fix it". */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => { sessionExpiredListeners.delete(listener); };
}

function emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) {
    try { listener(); } catch { /* a listener must never break a request */ }
  }
}

const REJECTED_TOKEN_BODY = /bad_jwt|PGRST301|invalid claim|JWSError|\bJWT\b/i;
// One refresh per distinct access token — never a loop. A chain of refreshed
// tokens that are each rejected in turn is a dead session too; cap it.
//
// Round-3 review, BLOCKING 1: the chain counts REFRESHES, not callers. It is
// advanced inside refreshOnce, once per refresh that actually ran, however
// many concurrent 401s coalesced onto it — ten requests that all left with the
// same token used to count as ten links and sign the user out on a single
// successful refresh. The first accepted user-token response resets it.
const MAX_REJECTED_TOKEN_CHAIN = 2;
let lastRefreshedToken: string | null = null;
let rejectedTokenChain = 0;

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => key.toLowerCase() === name);
    return hit ? hit[1] : null;
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  return key ? record[key] : null;
}

function bearerOf(input: RequestInfo | URL, init?: RequestInit): string | null {
  let raw = headerValue(init?.headers, 'authorization');
  if (!raw && typeof Request !== 'undefined' && input instanceof Request) raw = input.headers.get('authorization');
  return raw ? raw.replace(/^Bearer\s+/i, '') : null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? '';
}

// 'unreachable' = the refresh never got an answer (signal dropped between the
// 401 and the refresh). That is not a dead session and must not sign anyone
// out; the guard forgets the token so the next rejection tries again.
// 'no-session' = there is nothing on this device to refresh any more (a
// sign-out raced the request; GoTrue answers AuthSessionMissingError). Not a
// rejection either: a deliberate sign-out must never be reported as "your
// session expired".
type RefreshResult = 'refreshed' | 'rejected' | 'unreachable' | 'no-session';
let refreshInFlight: Promise<RefreshResult> | null = null;

function isUnreachable(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; status?: number; message?: string };
  return e.name === 'AuthRetryableFetchError'
    || e.status === 0
    || err instanceof TypeError
    || /network request failed|failed to fetch|network/i.test(e.message ?? '');
}

function isSessionMissing(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'AuthSessionMissingError' || /auth session missing/i.test(e.message ?? '');
}

function classifyRefreshFailure(err: unknown): RefreshResult {
  if (isSessionMissing(err)) return 'no-session';
  return isUnreachable(err) ? 'unreachable' : 'rejected';
}

// Coalesced: every caller that arrives while a refresh is in flight gets the
// SAME promise, and the verdict — the chain bookkeeping, "session expired" —
// is delivered here, once, by the one body that ran. Callers act only on the
// non-verdict outcomes (forget the token so a later 401 may try again).
function refreshOnce(rejectedToken: string): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    let result: RefreshResult;
    try {
      const { data, error } = await _supabase!.auth.refreshSession();
      if (error) {
        result = classifyRefreshFailure(error);
      } else {
        const fresh = data?.session?.access_token;
        result = !!fresh && fresh !== rejectedToken ? 'refreshed' : 'rejected';
      }
    } catch (err) {
      result = classifyRefreshFailure(err);
    } finally {
      refreshInFlight = null;
    }
    if (result === 'rejected') {
      rejectedTokenChain = 0;
      emitSessionExpired();
    } else if (result === 'refreshed') {
      rejectedTokenChain += 1;
      if (rejectedTokenChain > MAX_REJECTED_TOKEN_CHAIN) {
        rejectedTokenChain = 0;
        emitSessionExpired();
      }
    }
    return result;
  })();
  return refreshInFlight;
}

// The access token supabase-js holds RIGHT NOW: null when there is no session
// (or it could not be read). Reads local state; the only network it can touch
// is GoTrue's own refresh when the stored token has already expired, which the
// guard passes through untouched. `dead` is true when that refresh was REFUSED
// (not merely unreachable) — supabase-js has then already removed the session
// and emitted SIGNED_OUT, and the login screen still deserves to know why.
async function currentAccessToken(): Promise<{ token: string | null; dead: boolean }> {
  try {
    const { data, error } = await _supabase!.auth.getSession();
    const token = data?.session?.access_token ?? null;
    return { token, dead: token === null && !!error && !isUnreachable(error) && !isSessionMissing(error) };
  } catch (err) {
    return { token: null, dead: !isUnreachable(err) && !isSessionMissing(err) };
  }
}

// Only PostgREST and Storage can indict the session. An Edge Function deployed
// with verify_jwt answers `{"code":401,"message":"Invalid JWT"}` from the
// gateway for reasons that have nothing to do with the user's token (a function
// meant for service-role or cron callers, a key mismatch) — that body matches
// REJECTED_TOKEN_BODY and used to read as a dead session. Functions 401s pass
// through untouched; the app's constant REST polling catches a truly dead
// token within seconds anyway.
const VERDICT_PATHS = ['/rest/v1/', '/storage/v1/'] as const;

// Exported for __tests__/sync/session-guard.test.ts, which drives this wrapper
// directly: the concurrency it has to survive (N requests leaving with the same
// token, all 401ing, ONE refresh) cannot be reproduced through the client.
export const sessionGuardedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const token = bearerOf(input, init);
  const url = urlOf(input);
  // Only a request that could have indicted the session may exonerate it. A
  // 200 from anywhere else must NOT clear the chain — in particular GoTrue's
  // own traffic: `refreshSession()` sends the anon key today, but the day a
  // supabase-js release puts the user's access token on that request instead,
  // every successful refresh would silently reset the counter it is supposed
  // to advance, and MAX_REJECTED_TOKEN_CHAIN would never be reached again.
  const canIndict = VERDICT_PATHS.some((p) => url.includes(p));
  if (response.status !== 401) {
    // A user token that the server accepted — any earlier rejection is over.
    if (canIndict && token && token !== supabaseAnonKey) rejectedTokenChain = 0;
    return response;
  }
  if (!token || token === supabaseAnonKey) return response;      // anon request: nothing to refresh
  if (url.includes('/auth/v1/')) return response;                  // GoTrue's own calls — never recurse
  if (!canIndict) return response;                                 // Functions & co: no verdict
  let body = '';
  try { body = await response.clone().text(); } catch { /* unreadable body — not a token rejection we can prove */ }
  if (!REJECTED_TOKEN_BODY.test(body)) return response;
  if (lastRefreshedToken === token) return response;               // already refreshed for this token: once
  // A request that left with a token supabase-js has since rotated (its own
  // auto-refresh, or a refresh this guard already ran) is STALE, not dead: the
  // client already holds a fresher token and the next request will use it.
  // Refreshing again would spend a refresh token for nothing — and under
  // refresh-token reuse detection could kill the very session it meant to
  // save. Nothing on the device at all → nothing to refresh, nobody to warn —
  // unless supabase-js itself just had its refresh refused, which IS the
  // verdict this guard exists to deliver.
  const current = await currentAccessToken();
  // Round-3 BLOCKING 1: re-check AFTER the await. Every 401 that landed while
  // the first caller was reading the session passed the check above with the
  // same token; the first continuation to run claims it below, and the rest
  // return here instead of each calling refreshOnce for it.
  if (lastRefreshedToken === token) return response;
  if (current.token === null) {
    lastRefreshedToken = token;                                    // nothing to refresh for it, whoever else asks
    if (current.dead) emitSessionExpired();
    return response;
  }
  if (current.token !== token) {
    lastRefreshedToken = token;                                    // stale token: never refresh for it
    return response;
  }
  lastRefreshedToken = token;
  console.warn('[Supabase] Server rejected the access token — refreshing the session once');
  const result = await refreshOnce(token);
  if (result === 'unreachable' || result === 'no-session') {
    lastRefreshedToken = null;                                     // not a verdict — retry on the next 401
  }
  // 'rejected' and the chain cap are verdicts, delivered once by refreshOnce.
  return response;
};

if (isSupabaseConfigured) {
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
    global: { fetch: sessionGuardedFetch },
  });
  console.log('[Supabase] Client initialized successfully.');
} else {
  console.error('[Supabase] CRITICAL: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. Supabase features will NOT work.');
}

export function supabaseGuard(): SupabaseClient {
  if (!isSupabaseConfigured || !_supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY environment variables.');
  }
  return _supabase;
}

export const supabase: SupabaseClient = isSupabaseConfigured
  ? _supabase!
  : new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        if (prop === 'auth') {
          return new Proxy({} as SupabaseClient['auth'], {
            get(_t, authProp) {
              if (authProp === 'onAuthStateChange') {
                return (_cb: unknown) => ({ data: { subscription: { unsubscribe: () => {} } } });
              }
              if (authProp === 'getSession') {
                return async () => ({ data: { session: null }, error: null });
              }
              return async () => ({ data: null, error: new Error('Supabase not configured') });
            },
          });
        }
        if (prop === 'from') {
          return () => new Proxy({} as Record<string, unknown>, {
            get() {
              return () => new Proxy({} as Record<string, unknown>, {
                get() {
                  return async () => ({ data: null, error: { message: 'Supabase not configured' } });
                },
              });
            },
          });
        }
        if (prop === 'channel') {
          return () => ({
            on: function () { return this; },
            subscribe: () => 'closed',
          });
        }
        if (prop === 'removeChannel') {
          return async () => {};
        }
        return undefined;
      },
    });
