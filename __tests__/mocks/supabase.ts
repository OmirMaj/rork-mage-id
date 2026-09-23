/**
 * __tests__/mocks/supabase.ts — the network edge, stubbed.
 *
 * Wired in via `moduleNameMapper` in jest.config.js (`^@/lib/supabase$`), which
 * is where all 104 call sites in the app import it from.
 *
 * Per the spec this is one of the ONLY things the smoke suite mocks. The 16
 * providers run for real; they just talk to this instead of the internet. The
 * shape here mirrors postgrest-js closely enough that provider hydration code
 * takes its normal path — a chainable builder that is also a thenable, so both
 * `await supabase.from('x').select('*')` and
 * `await supabase.from('x').select('*').eq('id', 1).single()` resolve.
 *
 * Almost everything resolves EMPTY. The populated state is seeded by the
 * fixture into AsyncStorage (the device cache every context hydrates from).
 *
 * The exception is SERVER_MIRROR below. Wave 3 (#112/#90/#23) made a successful
 * zero-row SELECT answered to the user's live bearer the server's answer: it
 * replaces the device cache, keeping only rows still in the offline queue. So a
 * mock that says "the server holds nothing" while the fixture says "the device
 * holds a synced RFI" is no longer a populated account — it is an account whose
 * rows were all deleted elsewhere, and the loaders (correctly) clear them. For
 * the child lists the fixture seeds, an unfiltered list SELECT therefore answers
 * with what the synced device cache holds, as a real cold start would: the
 * server and the cache agree. Read at query time, so a test that overrides a
 * key after primeWorld (or the empty world, which seeds none) carries through.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

type QueryResult = { data: unknown; error: null; count: number | null; status: number; statusText: string };

const emptyResult = (): QueryResult => ({
  data: null,
  error: null,
  count: 0,
  status: 200,
  statusText: 'OK',
});

const emptyListResult = (): QueryResult => ({ ...emptyResult(), data: [] });

/**
 * Tables whose unfiltered list SELECT mirrors the device cache key the fixture
 * seeds. `projects` is left out on purpose: its loader has its own two-read
 * revocation guard and already keeps the cache on an empty answer.
 */
const SERVER_MIRROR: Record<string, string> = {
  commitments: 'mageid_commitments',
  rfis: 'mageid_rfis',
  permits: 'mageid_permits',
  punch_items: 'mageid_punch_items',
  daily_reports: 'mageid_daily_reports',
};

/** Shallow camelCase -> snake_case key rename: the server shape of a cached row. */
const toServerRow = (row: unknown): unknown => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return out;
};

async function mirroredRows(table: string): Promise<unknown[]> {
  const key = SERVER_MIRROR[table];
  if (!key) return [];
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(toServerRow) : [];
  } catch {
    return [];
  }
}

/** The signed-in user's subscriptions row, mirrored from `mageid_subscription_tier`. */
async function subscriptionRow(): Promise<unknown> {
  try {
    const tier = await AsyncStorage.getItem('mageid_subscription_tier');
    if (tier !== 'pro' && tier !== 'business' && tier !== 'enterprise') return null;
    return { tier, end_date: null, tier_source: 'manual', manual_tier: tier };
  } catch {
    return null;
  }
}

/**
 * A postgrest-like builder. Every unknown method returns `this` so arbitrary
 * chains work; the terminal shape is decided by which of select/insert/... was
 * called and whether `.single()`/`.maybeSingle()` narrowed it.
 */
function makeBuilder(table?: string): any {
  let resolvesToList = true;
  // Only a plain `.select(...)` list read (ordering allowed) mirrors the cache;
  // a write or any filter keeps the empty answer.
  let isSelect = false;
  let isWrite = false;
  let filtered = false;
  const READ_ONLY_CHAIN = new Set(['select', 'order', 'limit', 'range', 'returns']);
  const WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
  // Forward-declared so every chainable method can return the PROXY, not the
  // bare target. Returning the target was a real bug caught by the Stage-2
  // probe: `.from('projects').select('*')` worked but `.order(...)` on the
  // result threw "order is not a function", because `select` handed back an
  // object the proxy's catch-all `get` was no longer wrapping.
  let proxy: any;

  const builder: any = {
    then(onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) {
      // The server's subscriptions row agrees with the seeded tier mirror.
      // SubscriptionContext treats a server "no row" as a definitive Free
      // (audit wave 5, #2 review) and consults the mirror only while the
      // server has not answered, so the seeded tier must come from here.
      if (!resolvesToList && isSelect && !isWrite && table === 'subscriptions') {
        return subscriptionRow()
          .then((row): QueryResult => ({ ...emptyResult(), data: row, count: row ? 1 : 0 }))
          .then(onFulfilled, onRejected);
      }
      if (resolvesToList && isSelect && !isWrite && !filtered && table && SERVER_MIRROR[table]) {
        return mirroredRows(table)
          .then((rows): QueryResult => ({ ...emptyListResult(), data: rows, count: rows.length }))
          .then(onFulfilled, onRejected);
      }
      const result = resolvesToList ? emptyListResult() : emptyResult();
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    catch(onRejected: (e: unknown) => unknown) {
      return Promise.resolve(emptyListResult()).catch(onRejected);
    },
    finally(onFinally: () => void) {
      return Promise.resolve(emptyListResult()).finally(onFinally);
    },
    single() {
      resolvesToList = false;
      return proxy;
    },
    maybeSingle() {
      resolvesToList = false;
      return proxy;
    },
    csv() {
      resolvesToList = false;
      return proxy;
    },
    abortSignal() {
      return proxy;
    },
    throwOnError() {
      return proxy;
    },
  };

  // Anything else (select, insert, update, upsert, delete, eq, neq, in, gt,
  // order, limit, range, filter, or, match, is, contains, ...) chains.
  proxy = new Proxy(builder, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'select') isSelect = true;
      else if (WRITES.has(prop)) isWrite = true;
      else if (!READ_ONLY_CHAIN.has(prop)) filtered = true;
      return () => proxy;
    },
  });
  return proxy;
}

/**
 * The signed-in session, controlled by the test harness.
 *
 * Both smoke states are AUTHENTICATED. "Empty" in the spec means "contexts
 * hydrate from nothing" — no projects, no RFIs — not "logged out". A
 * logged-out run would be worthless: RootLayoutNav bounces every unauthed
 * path to /login, so all ~190 protected routes would silently render the
 * login screen and pass. Auth is the precondition for the suite testing
 * anything at all.
 */
let currentSession: unknown = null;

// A4 (round 3): utils/offlineQueue.ts keeps the signed-in user from the auth
// client's state feed instead of calling getSession() per enqueue, so the mock
// feeds its subscribers the way gotrue does. Synchronously, on purpose: a test
// flips the session from INSIDE a scripted insert and the flush must see it
// before its next send. The harness only flips the session between mounts, so
// AuthContext's own subscriber is never live when this fires there.
type AuthStateListener = (event: string, session: unknown) => void;
const authStateListeners = new Set<AuthStateListener>();

export function __setSmokeSession(session: unknown): void {
  currentSession = session;
  for (const listener of [...authStateListeners]) {
    try { listener(session ? 'SIGNED_IN' : 'SIGNED_OUT', session); } catch { /* a listener must never break the harness */ }
  }
}

export function __getSmokeSession(): unknown {
  return currentSession;
}

const authMock = {
  getSession: async () => ({ data: { session: currentSession }, error: null }),
  getUser: async () => ({ data: { user: (currentSession as any)?.user ?? null }, error: null }),
  onAuthStateChange: (cb?: unknown) => {
    const listener = typeof cb === 'function' ? (cb as AuthStateListener) : null;
    if (listener) authStateListeners.add(listener);
    return { data: { subscription: { unsubscribe: () => { if (listener) authStateListeners.delete(listener); } } } };
  },
  signInWithPassword: async () => ({ data: { user: null, session: null }, error: null }),
  signInWithOAuth: async () => ({ data: { provider: null, url: null }, error: null }),
  signInWithIdToken: async () => ({ data: { user: null, session: null }, error: null }),
  signUp: async () => ({ data: { user: null, session: null }, error: null }),
  signOut: async () => ({ error: null }),
  setSession: async () => ({ data: { user: null, session: null }, error: null }),
  updateUser: async () => ({ data: { user: null }, error: null }),
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
  resend: async () => ({ data: {}, error: null }),
  refreshSession: async () => ({ data: { user: null, session: null }, error: null }),
  admin: {
    deleteUser: async () => ({ data: null, error: null }),
    listUsers: async () => ({ data: { users: [] }, error: null }),
  },
};

const storageFileApi = {
  upload: async () => ({ data: null, error: null }),
  uploadToSignedUrl: async () => ({ data: null, error: null }),
  download: async () => ({ data: null, error: null }),
  remove: async () => ({ data: [], error: null }),
  list: async () => ({ data: [], error: null }),
  createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
  createSignedUrls: async () => ({ data: [], error: null }),
  getPublicUrl: () => ({ data: { publicUrl: '' } }),
  move: async () => ({ data: null, error: null }),
  copy: async () => ({ data: null, error: null }),
};

const channelMock: any = {
  on: () => channelMock,
  subscribe: (cb?: (status: string) => void) => {
    // Do NOT invoke the callback — realtime never connects under test, and
    // synchronously reporting SUBSCRIBED would make providers believe they
    // have a live socket.
    void cb;
    return channelMock;
  },
  unsubscribe: async () => 'ok',
  send: async () => 'ok',
  track: async () => 'ok',
  untrack: async () => 'ok',
  presenceState: () => ({}),
  topic: 'mock',
};

export const SUPABASE_URL = 'https://smoke-test.invalid.supabase.co';
export const SUPABASE_ANON_KEY = 'smoke-test-anon-key';
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Deliberately TRUE. Reporting "not configured" would send providers down
// their degraded branch and the suite would never exercise the real path.
export const isSupabaseConfigured = true;

export const supabase: any = {
  from: (table?: string) => makeBuilder(table),
  rpc: () => makeBuilder(),
  schema: () => ({ from: () => makeBuilder(), rpc: () => makeBuilder() }),
  auth: authMock,
  storage: {
    from: () => storageFileApi,
    listBuckets: async () => ({ data: [], error: null }),
    getBucket: async () => ({ data: null, error: null }),
  },
  functions: {
    invoke: async () => ({ data: null, error: null }),
    setAuth: () => {},
  },
  channel: () => channelMock,
  removeChannel: async () => 'ok',
  removeAllChannels: async () => [],
  getChannels: () => [],
  realtime: { channels: [] },
};

export function supabaseGuard() {
  return supabase;
}

// RT-R1: lib/supabase.ts's dead-session registry (a 401 the refresh could not
// fix). Mirrored here so AuthContext's subscription takes its real path under
// jest instead of relying on its `typeof onSessionExpired !== 'function'`
// escape hatch; __emitSessionExpired lets a test fire it.
type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => { sessionExpiredListeners.delete(listener); };
}

export function __emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) {
    try { listener(); } catch { /* a listener must never break the emitter */ }
  }
}

export default supabase;
