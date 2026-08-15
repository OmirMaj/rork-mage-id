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
 * Everything resolves EMPTY. The populated state comes from the fixture
 * hydrating AsyncStorage, not from here — the app is offline-first (see
 * utils/offlineQueue.ts) and reads local cache first, so seeding storage is
 * both simpler and closer to how a real cold start behaves.
 */

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
 * A postgrest-like builder. Every unknown method returns `this` so arbitrary
 * chains work; the terminal shape is decided by which of select/insert/... was
 * called and whether `.single()`/`.maybeSingle()` narrowed it.
 */
function makeBuilder(): any {
  let resolvesToList = true;
  // Forward-declared so every chainable method can return the PROXY, not the
  // bare target. Returning the target was a real bug caught by the Stage-2
  // probe: `.from('projects').select('*')` worked but `.order(...)` on the
  // result threw "order is not a function", because `select` handed back an
  // object the proxy's catch-all `get` was no longer wrapping.
  let proxy: any;

  const builder: any = {
    then(onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) {
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
      return () => proxy;
    },
  });
  return proxy;
}

const noopSubscription = { unsubscribe: () => {} };

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

export function __setSmokeSession(session: unknown): void {
  currentSession = session;
}

export function __getSmokeSession(): unknown {
  return currentSession;
}

const authMock = {
  getSession: async () => ({ data: { session: currentSession }, error: null }),
  getUser: async () => ({ data: { user: (currentSession as any)?.user ?? null }, error: null }),
  onAuthStateChange: (_cb?: unknown) => ({ data: { subscription: noopSubscription } }),
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
  from: () => makeBuilder(),
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

export default supabase;
