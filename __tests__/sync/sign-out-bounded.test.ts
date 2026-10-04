/**
 * __tests__/sync/sign-out-bounded.test.ts — sign-out is bounded, and the
 * session always leaves the device (utils/signOutTiming, lib/supabase.ts
 * boundedLogoutFetch).
 *
 * "Logging out takes too long." Two things were found in the installed auth-js
 * and neither is reachable by reading our own source, so this file runs the
 * REAL supabase-js client (a relative import — `@/lib/supabase` is the mock
 * everywhere else) against a scripted `fetch`:
 *
 *   • `signOut()` awaits POST /logout inside the auth lock. With a network that
 *     answers nothing, it sat there until the OS gave up, and the local
 *     fallback queued behind the same lock.
 *   • `signOut({ scope: 'local' })` posts /logout too, and when that request
 *     fails for a network reason it returns the error and KEEPS the session.
 *     Offline, the token stayed in storage under a logged-out UI.
 *
 * Each test ends by reading the session back out of the client: that, not the
 * return value, is the thing that must be true.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

const REF = 'nteoqhcswappxxjlpvap';
const STORAGE_KEY = `sb-${REF}-auth-token`;

const realFetch = global.fetch;

function load() {
  jest.resetModules();
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
    ?? require('@react-native-async-storage/async-storage');
  const mod = require('../../lib/supabase') as { supabase: any; markLogoutUnreachable: () => void };
  const timing = require('../../utils/signOutTiming') as typeof import('../../utils/signOutTiming');
  return { AsyncStorage, supabase: mod.supabase, markLogoutUnreachable: mod.markLogoutUnreachable, timing };
}

async function seedSession(AsyncStorage: any): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
    access_token: 'access-token-under-test',
    refresh_token: 'refresh-token-under-test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: 'user-1', aud: 'authenticated', email: 'pm@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  }));
}

async function sessionOnDevice(supabase: any): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/** A network that never answers, but honours an abort (as fetch does). */
function blackHole(calls: string[]) {
  return jest.fn((input: any, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    calls.push(String(input));
    init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  })) as any;
}

/** No network at all: every request fails at once. */
function offline(calls: string[]) {
  return jest.fn(async (input: any) => {
    calls.push(String(input));
    throw new TypeError('Network request failed');
  }) as any;
}

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('sign-out: bounded, and the session always leaves the device', () => {
  test('control: the session is readable before any sign-out', async () => {
    const { AsyncStorage, supabase } = load();
    await seedSession(AsyncStorage);
    expect(await sessionOnDevice(supabase)).toBe('access-token-under-test');
  });

  test('online: the global sign-out is one request, sent as written, and removes the session', async () => {
    const { AsyncStorage, supabase } = load();
    await seedSession(AsyncStorage);
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => { calls.push(String(input)); return new Response(null, { status: 204 }); }) as any;

    const { error } = await supabase.auth.signOut();

    expect(error).toBeNull();
    expect(calls.filter((u) => u.includes('/auth/v1/logout'))).toEqual([expect.stringContaining('/auth/v1/logout?scope=global')]);
    expect(await sessionOnDevice(supabase)).toBeNull();
  });

  test('a network that never answers: the global sign-out gives up at the ceiling, and the local one that follows removes the session without waiting again', async () => {
    const { AsyncStorage, supabase, timing } = load();
    await seedSession(AsyncStorage);
    const calls: string[] = [];
    global.fetch = blackHole(calls);

    const t0 = Date.now();
    const first = await supabase.auth.signOut();
    const globalMs = Date.now() - t0;

    // Bounded: it came back, with an error, close to the ceiling — not a minute later.
    expect(first.error).toBeTruthy();
    expect(globalMs).toBeGreaterThanOrEqual(timing.SIGN_OUT_NETWORK_CEILING_MS - 200);
    expect(globalMs).toBeLessThan(timing.SIGN_OUT_NETWORK_CEILING_MS + 2000);
    // A failed global sign-out leaves the session where it was: this is why
    // AuthContext.logout must fall back to the local one.
    expect(await sessionOnDevice(supabase)).toBe('access-token-under-test');

    const t1 = Date.now();
    const second = await supabase.auth.signOut({ scope: 'local' });
    const localMs = Date.now() - t1;

    expect(second.error).toBeNull();
    expect(localMs).toBeLessThan(1000);
    // The local sign-out did not go back to a network that just proved dead.
    expect(calls.filter((u) => u.includes('/auth/v1/logout'))).toHaveLength(1);
    expect(await sessionOnDevice(supabase)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  }, 15000);

  test('offline: a local sign-out whose request fails still removes the session (it used to keep it)', async () => {
    const { AsyncStorage, supabase } = load();
    await seedSession(AsyncStorage);
    const calls: string[] = [];
    global.fetch = offline(calls);

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    expect(error).toBeNull();
    expect(await sessionOnDevice(supabase)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('offline, known up front: no request is made at all', async () => {
    const { AsyncStorage, supabase, markLogoutUnreachable } = load();
    await seedSession(AsyncStorage);
    const calls: string[] = [];
    global.fetch = blackHole(calls);

    markLogoutUnreachable();
    const t0 = Date.now();
    const { error } = await supabase.auth.signOut({ scope: 'local' });

    expect(error).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(calls).toHaveLength(0);
    expect(await sessionOnDevice(supabase)).toBeNull();
  });

  test('a GLOBAL sign-out is never answered locally: offline it fails fast and reports it', async () => {
    const { AsyncStorage, supabase, markLogoutUnreachable } = load();
    await seedSession(AsyncStorage);
    const calls: string[] = [];
    global.fetch = offline(calls);

    markLogoutUnreachable();
    const { error } = await supabase.auth.signOut();

    // It was sent (only the server can revoke everywhere), it failed, and the
    // caller hears so — pretending it worked would skip the revoke silently.
    expect(calls.filter((u) => u.includes('/auth/v1/logout?scope=global'))).toHaveLength(1);
    expect(error).toBeTruthy();
    expect(await sessionOnDevice(supabase)).toBe('access-token-under-test');
  });

  test('a server that answers a LOCAL sign-out with an error cannot keep the session on the device', async () => {
    const { AsyncStorage, supabase } = load();
    await seedSession(AsyncStorage);
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ msg: 'boom' }), { status: 500 })) as any;

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    expect(error).toBeNull();
    expect(await sessionOnDevice(supabase)).toBeNull();
  });

  test('a server that answers a GLOBAL sign-out with an error is not rewritten: the caller hears it and falls back', async () => {
    const { AsyncStorage, supabase } = load();
    await seedSession(AsyncStorage);
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ msg: 'boom' }), { status: 500 })) as any;

    const { error } = await supabase.auth.signOut();

    expect(error).toBeTruthy();
    expect(await sessionOnDevice(supabase)).toBe('access-token-under-test');
  });
});
