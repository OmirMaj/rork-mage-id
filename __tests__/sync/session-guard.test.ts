/**
 * __tests__/sync/session-guard.test.ts — lib/supabase.ts's dead-session guard.
 *
 * BLOCKING 1 (review 2026-09-05, round 3). The guard signs the user out when
 * the server rejects their access token and a refresh cannot fix it. The bug it
 * had was in the OPPOSITE direction: a single successful refresh could sign a
 * perfectly healthy user out.
 *
 * The app fires many PostgREST reads at once (Home alone hydrates projects,
 * financials, RFIs, invoices, …). When the signing key rotates, all of them
 * 401 with the SAME bearer inside a few milliseconds. Every one of them passed
 * the `lastRefreshedToken === token` check — which sat BEFORE an await — then
 * suspended on `currentAccessToken()`, and every continuation went on to call
 * `refreshOnce`. The chain counter advanced per CALLER, so ten concurrent 401s
 * healed by one refresh counted as ten links, blew MAX_REJECTED_TOKEN_CHAIN,
 * and threw the user to the login screen mid-drive.
 *
 * The fix is two things and this file pins both:
 *   • the guard re-checks `lastRefreshedToken === token` AFTER the await, so
 *     the first continuation claims the token and the rest return;
 *   • the chain counts REFRESHES, advanced inside `refreshOnce` — once per
 *     refresh that actually ran, however many callers coalesced onto it.
 *
 * Why it drives `sessionGuardedFetch` directly rather than the client: the
 * defect only appears when N requests are in flight with one token, which is
 * not reachable through supabase-js's public surface. This is the ONE test file
 * that loads the REAL lib/supabase.ts (a relative import — `@/lib/supabase` is
 * mapped to the mock in jest.config.js for the other 104 call sites).
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

type Guard = {
  sessionGuardedFetch: typeof fetch;
  onSessionExpired: (l: () => void) => () => void;
};

const REST = 'https://nteoqhcswappxxjlpvap.supabase.co/rest/v1/projects?select=*';
const FUNCTIONS = 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/mage-ai';

/** Only `status` and `clone().text()` are read by the guard. */
function reject401(body = '{"code":"PGRST301","message":"JWT expired"}') {
  return { status: 401, clone: () => ({ text: async () => body }) } as unknown as Response;
}
function accept200() {
  return { status: 200, clone: () => ({ text: async () => '[]' }) } as unknown as Response;
}

const realFetch = global.fetch;

/**
 * A fresh copy of the module — module-level `lastRefreshedToken` /
 * `rejectedTokenChain` are exactly what is under test, so no test may inherit
 * another's. Returns the guard plus a scripted auth client.
 */
function loadGuard(opts?: { refresh?: () => Promise<any> }) {
  jest.resetModules();
  const mod = require('../../lib/supabase') as Guard & { supabase: any };

  const state = {
    /** The token supabase-js currently holds. */
    token: 'tok-0' as string | null,
    refreshes: 0,
    getSessionCalls: 0,
    expired: 0,
    /** Set by a test to make `getSession()` report a refusal, not a session. */
    getSessionError: null as any,
  };

  mod.supabase.auth.getSession = async () => {
    state.getSessionCalls++;
    // A real getSession is async. The await is the whole point: every
    // concurrent 401 suspends HERE, and the double-check is what they land on.
    await Promise.resolve();
    if (state.getSessionError) return { data: { session: null }, error: state.getSessionError };
    return { data: { session: state.token ? { access_token: state.token } : null }, error: null };
  };
  mod.supabase.auth.refreshSession = opts?.refresh
    ? async () => { state.refreshes++; return opts.refresh!(); }
    : async () => {
      state.refreshes++;
      state.token = `tok-${state.refreshes}`;
      return { data: { session: { access_token: state.token } }, error: null };
    };

  const unsub = mod.onSessionExpired(() => { state.expired++; });
  return { guard: mod.sessionGuardedFetch, state, unsub, mod };
}

/** One request that leaves with `token`. */
function send(guard: typeof fetch, token: string, url = REST) {
  return guard(url, { headers: { Authorization: `Bearer ${token}` } });
}

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('session guard — a healthy refresh must not sign anyone out (BLOCKING 1)', () => {
  test('ten concurrent 401s on ONE token cause exactly ONE refresh and no sign-out', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;

    await Promise.all(Array.from({ length: 10 }, () => send(guard, 'tok-0')));

    // The double-check after the await is what makes this 1 and not 10.
    expect(state.refreshes).toBe(1);
    // …and because the chain counts refreshes, one refresh is one link — well
    // under MAX_REJECTED_TOKEN_CHAIN. Pre-fix this was 10 and the user was out.
    expect(state.expired).toBe(0);
    unsub();
  });

  test('each of the ten callers reads the session exactly once — none re-reads or loops', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;

    await Promise.all(Array.from({ length: 10 }, () => send(guard, 'tok-0')));

    // Every caller reads the session once — the pre-await check cannot know it
    // will lose the race — but only one proceeds past the read. Ten reads for
    // ten callers is the ceiling being pinned here; anything above it means a
    // caller went round again.
    expect(state.getSessionCalls).toBe(10);
    expect(state.refreshes).toBe(1);
    unsub();
  });

  test('a caller whose session read lands AFTER the refresh, still reporting the stale token, does not refresh again', async () => {
    // The post-await double-check is LOAD-BEARING, not belt-and-braces, and this
    // is the case that proves it. `refreshInFlight` is nulled in refreshOnce's
    // `finally` — which runs BEFORE the verdict block and long before the
    // caller's `await refreshOnce(...)` resolves — so a straggler that arrives
    // after the refresh has completed finds NOTHING in flight to coalesce onto.
    // Its own `getSession()` may still hand back the token it left with (the
    // read raced the write of the fresh session). Without the double-check it
    // walks straight past `current.token !== token`, calls refreshOnce again,
    // and spends a second refresh token for nothing — which under refresh-token
    // reuse detection can kill the very session the guard is trying to save.
    let releaseStragglers!: () => void;
    const stragglersHeld = new Promise<void>((r) => { releaseStragglers = r; });
    const { guard, state, unsub, mod } = loadGuard();

    let reads = 0;
    mod.supabase.auth.getSession = async () => {
      state.getSessionCalls++;
      if (++reads > 1) await stragglersHeld;  // resumes only once the refresh is over
      // …and STILL reports the token the request left with.
      return { data: { session: { access_token: 'tok-0' } }, error: null };
    };
    global.fetch = jest.fn(async () => reject401()) as any;

    const first = send(guard, 'tok-0');
    const stragglers = Array.from({ length: 3 }, () => send(guard, 'tok-0'));
    // `first` resolves only after `await refreshOnce(token)` has returned, so by
    // the time the stragglers wake there is provably no refresh in flight.
    void first.then(() => { releaseStragglers(); });

    await Promise.all([first, ...stragglers]);

    expect(state.getSessionCalls).toBe(4);   // all four passed the pre-await check
    expect(state.refreshes).toBe(1);         // …and exactly one refresh happened
    expect(state.expired).toBe(0);
    unsub();
  });

  test('a second burst on the SAME dead token never refreshes again', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;

    await Promise.all(Array.from({ length: 5 }, () => send(guard, 'tok-0')));
    await Promise.all(Array.from({ length: 5 }, () => send(guard, 'tok-0')));

    expect(state.refreshes).toBe(1); // lastRefreshedToken still holds tok-0
    expect(state.expired).toBe(0);
    unsub();
  });

  test('a request that left with a token supabase-js has since rotated is stale, not dead', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;
    state.token = 'tok-current';

    await send(guard, 'tok-older'); // in flight across an auto-refresh

    expect(state.refreshes).toBe(0); // refreshing again would spend a refresh token for nothing
    expect(state.expired).toBe(0);
    unsub();
  });
});

describe('session guard — a session that really is dead still ends', () => {
  test('a refresh the server REFUSES signs the user out at once', async () => {
    const { guard, state, unsub } = loadGuard({
      refresh: async () => ({ data: { session: null }, error: { name: 'AuthApiError', message: 'Invalid Refresh Token' } }),
    });
    global.fetch = jest.fn(async () => reject401()) as any;

    await Promise.all(Array.from({ length: 4 }, () => send(guard, 'tok-0')));

    expect(state.refreshes).toBe(1);
    expect(state.expired).toBe(1); // one verdict, delivered by refreshOnce — not one per caller
    unsub();
  });

  test('refreshed tokens that are each rejected in turn hit the chain cap', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;

    // Each round: the token the client now holds is rejected, the guard
    // refreshes, and the fresh token is rejected on the next round.
    await send(guard, 'tok-0');
    expect(state.expired).toBe(0);
    await send(guard, 'tok-1');
    expect(state.expired).toBe(0);
    await send(guard, 'tok-2');

    expect(state.refreshes).toBe(3);
    expect(state.expired).toBe(1); // MAX_REJECTED_TOKEN_CHAIN = 2
    unsub();
  });

  test('an accepted PostgREST response resets the chain, so the cap needs a fresh run of rejections', async () => {
    const { guard, state, unsub } = loadGuard();
    const responses: Response[] = [];
    global.fetch = jest.fn(async () => responses.shift() ?? reject401()) as any;

    await send(guard, 'tok-0');          // refresh 1
    await send(guard, 'tok-1');          // refresh 2 — one short of the cap
    responses.push(accept200());
    await send(guard, 'tok-2');          // the server accepts it: the chain is over
    await send(guard, 'tok-2');          // rejected again — refresh 3, chain restarts at 1

    expect(state.refreshes).toBe(3);
    expect(state.expired).toBe(0);
    unsub();
  });

  test('a 200 from a NON-verdict path does not reset the chain', async () => {
    const { guard, state, unsub } = loadGuard();
    const script: Response[] = [];
    global.fetch = jest.fn(async () => script.shift() ?? reject401()) as any;

    await send(guard, 'tok-0');                     // refresh 1
    await send(guard, 'tok-1');                     // refresh 2
    script.push(accept200());
    await send(guard, 'tok-2', FUNCTIONS);          // an edge function said 200 — no verdict either way
    await send(guard, 'tok-2');                     // refresh 3 → over the cap

    expect(state.expired).toBe(1);
    unsub();
  });

  test("getSession answering with a REFUSAL — not merely \"no session\" — is itself the verdict", async () => {
    // `currentAccessToken()` has nothing to hand back in two very different
    // situations, and the guard must tell them apart:
    //   • no session on the device (a sign-out raced the request) → say nothing;
    //     that is the sibling test in "what is NOT a verdict" below.
    //   • supabase-js's OWN auto-refresh was just REFUSED, so it dropped the
    //     session and getSession reports the error → the session is dead, the
    //     user is still staring at a screen that says "All clear", and nothing
    //     else in the app will ever tell them. That is `current.dead`, and this
    //     is the only test that reaches it.
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;
    state.token = null;
    state.getSessionError = { name: 'AuthApiError', message: 'Invalid Refresh Token: Already Used' };

    await send(guard, 'tok-0');

    expect(state.refreshes).toBe(0);  // nothing left on the device to refresh…
    expect(state.expired).toBe(1);    // …but the refusal already happened, so the login screen is told
    unsub();
  });

  test('an UNREACHABLE getSession is not that verdict — a dropped signal must not sign anyone out', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;
    state.token = null;
    state.getSessionError = { name: 'AuthRetryableFetchError', message: 'Network request failed' };

    await send(guard, 'tok-0');

    expect(state.refreshes).toBe(0);
    expect(state.expired).toBe(0);
    unsub();
  });
});

describe('session guard — what is NOT a verdict', () => {
  test('an unreachable refresh does not sign anyone out, and the next 401 tries again', async () => {
    let attempt = 0;
    const { guard, state, unsub } = loadGuard({
      refresh: async () => {
        attempt++;
        if (attempt === 1) throw new TypeError('Network request failed');
        return { data: { session: { access_token: 'tok-live' } }, error: null };
      },
    });
    global.fetch = jest.fn(async () => reject401()) as any;

    await send(guard, 'tok-0');
    expect(state.expired).toBe(0);

    // lastRefreshedToken was forgotten, so the same token may try once more.
    await send(guard, 'tok-0');
    expect(state.refreshes).toBe(2);
    expect(state.expired).toBe(0);
    unsub();
  });

  test('a deliberate sign-out racing a request is never reported as "session expired"', async () => {
    const { guard, state, unsub } = loadGuard({
      refresh: async () => ({ data: { session: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } }),
    });
    global.fetch = jest.fn(async () => reject401()) as any;

    await send(guard, 'tok-0');

    expect(state.expired).toBe(0);
    unsub();
  });

  test('an Edge Function 401 is not a verdict on the user token', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401('{"code":401,"message":"Invalid JWT"}')) as any;

    await send(guard, 'tok-0', FUNCTIONS);

    expect(state.refreshes).toBe(0);
    expect(state.expired).toBe(0);
    unsub();
  });

  test('a 401 whose body does not name a rejected token is left alone', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401('{"message":"row-level security"}')) as any;

    await send(guard, 'tok-0');

    expect(state.refreshes).toBe(0);
    expect(state.expired).toBe(0);
    unsub();
  });

  test('nothing left on the device to refresh: no refresh, no false alarm', async () => {
    const { guard, state, unsub } = loadGuard();
    global.fetch = jest.fn(async () => reject401()) as any;
    state.token = null;

    await send(guard, 'tok-0');

    expect(state.refreshes).toBe(0);
    expect(state.expired).toBe(0);
    unsub();
  });
});
