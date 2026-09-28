/**
 * IDEAS-1 · SPEED — the Instant Open device cache and the first-screen signal,
 * mounted for real (components/QueryCachePersist.tsx over a real QueryClient,
 * the community AsyncStorage mock, useAuth driven by the test).
 *
 *  1. THE COLD-START CASE: auth starts { isLoading: true, user: null }, a blob
 *     for A is on the device; auth resolves to A → the probe's FIRST render
 *     with A already has the restored data (isLoading false) and its queryFn
 *     had not run; then it refetches (a restored copy is never trusted fresh).
 *  2. The same launch resolving to signed-out restores nothing, and a later
 *     null → A restores nothing and does NOT remount the children.
 *  3. A → B mid-session never unmounts the children and never shows A's data
 *     under B.
 *  4. A blob for A is never hydrated for B, and is deleted.
 *  5. A write scheduled for A is dropped when the user becomes null, and the
 *     blob is gone.
 *  6. No first-mount hold (integration round 2): the children render at once,
 *     even when the read hangs — and a read not settled by the first resolved
 *     auth restores nothing.
 *  7. A key the allow-list excludes ('projects') is never restored, even when a
 *     blob carries it.
 *  8. The first-screen signal: BidsProvider's first load waits (isLoading
 *     stays true), markFirstUseful releases it and sends ONE honest event.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '9.9.9' }, nativeApplicationVersion: '9.9.9' },
}));

jest.mock('@/contexts/AuthContext', () => {
  const R = jest.requireActual('react') as typeof import('react');
  const Ctx = R.createContext<{ user: { id: string } | null; isLoading: boolean }>({ user: null, isLoading: true });
  return { __esModule: true, __AuthCtx: Ctx, useAuth: () => R.useContext(Ctx) };
});

// eslint-disable-next-line import/first
import * as AuthMock from '@/contexts/AuthContext';
// eslint-disable-next-line import/first
import QueryCachePersist from '@/components/QueryCachePersist';
// eslint-disable-next-line import/first
import { PERSIST_KEY, PERSIST_ALLOW, buildBlob, makeBuster } from '@/utils/queryPersist';
// eslint-disable-next-line import/first
import { markFirstUseful, __resetStartupTimingForTests, FIRST_SCREEN_EVENT } from '@/utils/startupTiming';
// eslint-disable-next-line import/first
import { setAnalyticsProvider } from '@/utils/analytics';
// eslint-disable-next-line import/first
import { BidsProvider, useBids } from '@/contexts/BidsContext';

type AuthState = { user: { id: string } | null; isLoading: boolean };
const AuthCtx = (AuthMock as unknown as { __AuthCtx: React.Context<AuthState> }).__AuthCtx;
const useAuth = (AuthMock as unknown as { useAuth: () => AuthState }).useAuth;

const ROOT = PERSIST_ALLOW[0];
const A = 'user-a';
const B = 'user-b';
const BUSTER = makeBuster('9.9.9');

function seedBlob(uid: string, extra: { key: unknown[]; data: unknown }[] = []) {
  const entries = [{ key: [ROOT, uid], data: { status: `connected-${uid}` } }, ...extra];
  const blob = buildBlob(uid, {
    mutations: [],
    queries: entries.map((e) => ({
      queryKey: e.key,
      queryHash: JSON.stringify(e.key),
      state: {
        data: e.data, dataUpdateCount: 1, dataUpdatedAt: Date.now() - 60_000, error: null, errorUpdateCount: 0,
        errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false,
        status: 'success', fetchStatus: 'idle',
      },
    })),
  }, Date.now() - 60_000, BUSTER);
  return AsyncStorage.setItem(PERSIST_KEY, JSON.stringify(blob));
}

type RenderRec = { uid: string | null; isLoading: boolean; data: unknown; fetchesSoFar: number };

function makeProbe() {
  const renders: RenderRec[] = [];
  const counters = { mounts: 0 };
  const queryFn = jest.fn(async ({ queryKey }: { queryKey: readonly unknown[] }) => ({ status: `server-${String(queryKey[1])}` }));
  function Probe() {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    useEffect(() => { counters.mounts += 1; }, []);
    const q = useQuery({ queryKey: [ROOT, uid], queryFn, enabled: !!uid });
    renders.push({ uid, isLoading: q.isLoading, data: q.data, fetchesSoFar: queryFn.mock.calls.length });
    return <Text>{uid ?? 'signed-out'}</Text>;
  }
  return { Probe, renders, counters, queryFn };
}

function mountHarness(client: QueryClient, Child: React.ComponentType, initial: AuthState) {
  let setAuth: (a: AuthState) => void = () => {};
  function Harness() {
    const [auth, set] = React.useState<AuthState>(initial);
    setAuth = set;
    return (
      <QueryClientProvider client={client}>
        <AuthCtx.Provider value={auth}>
          <QueryCachePersist client={client}>
            <Child />
          </QueryCachePersist>
        </AuthCtx.Provider>
      </QueryClientProvider>
    );
  }
  const tree = render(<Harness />);
  return { tree, setAuth: (a: AuthState) => act(() => { setAuth(a); }) };
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

async function flush(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  __resetStartupTimingForTests();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('QueryCachePersist — the cold-start restore', () => {
  it('hydrates before the first render with the resolved user, then refetches', async () => {
    await seedBlob(A);
    const client = newClient();
    const { Probe, renders, queryFn } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    await flush(); // the blob read settles
    expect(renders.length).toBeGreaterThan(0);
    await h.setAuth({ user: { id: A }, isLoading: false });
    const firstA = renders.find((r) => r.uid === A);
    expect(firstA).toBeDefined();
    expect(firstA!.isLoading).toBe(false);
    expect(firstA!.data).toEqual({ status: `connected-${A}` });
    expect(firstA!.fetchesSoFar).toBe(0);
    await flush(10);
    expect(queryFn).toHaveBeenCalledTimes(1); // invalidated on restore → refetched
    expect(renders[renders.length - 1].data).toEqual({ status: `server-${A}` });
  });

  it('a launch that resolves signed-out restores nothing; a later sign-in restores nothing and does not remount', async () => {
    await seedBlob(A);
    const client = newClient();
    const { Probe, renders, counters } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    await flush();
    await h.setAuth({ user: null, isLoading: false });
    expect(client.getQueryCache().find({ queryKey: [ROOT, A], exact: true })).toBeUndefined();
    await h.setAuth({ user: { id: A }, isLoading: false });
    const firstA = renders.find((r) => r.uid === A);
    expect(firstA!.data).toBeUndefined();
    expect(counters.mounts).toBe(1);
  });

  it('A → B mid-session: children never unmount and B never sees A\'s data', async () => {
    await seedBlob(A);
    const client = newClient();
    const { Probe, renders, counters } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    await flush();
    await h.setAuth({ user: { id: A }, isLoading: false });
    await flush(10);
    await h.setAuth({ user: { id: B }, isLoading: false });
    await flush(10);
    expect(counters.mounts).toBe(1);
    const underB = renders.filter((r) => r.uid === B);
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.every((r) => r.data === undefined || (r.data as { status: string }).status === `server-${B}`)).toBe(true);
  });

  it('a blob for A is never hydrated for B, and is deleted', async () => {
    await seedBlob(A);
    const client = newClient();
    const { Probe, renders } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    await flush();
    await h.setAuth({ user: { id: B }, isLoading: false });
    const firstB = renders.find((r) => r.uid === B);
    expect(firstB!.data).toBeUndefined();
    expect(client.getQueryCache().find({ queryKey: [ROOT, A], exact: true })).toBeUndefined();
    await flush();
    // Deleted — or already replaced by B's own copy once B's read landed; never A's.
    const raw = await AsyncStorage.getItem(PERSIST_KEY);
    expect(raw === null || JSON.parse(raw).userId === B).toBe(true);
  });

  it('never restores a key the allow-list excludes, even when the blob carries it', async () => {
    await seedBlob(A, [{ key: ['projects', A], data: [{ id: 'p1', name: 'Stale job' }] }]);
    const client = newClient();
    const { Probe, renders } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    await flush();
    await h.setAuth({ user: { id: A }, isLoading: false });
    expect(renders.find((r) => r.uid === A)!.data).toEqual({ status: `connected-${A}` });
    expect(client.getQueryCache().find({ queryKey: ['projects', A], exact: true })).toBeUndefined();
  });

  it('renders the children at once, even when the read hangs; an unsettled read restores nothing', async () => {
    await seedBlob(A);
    // The mock's own jest.fn: a one-shot hang, no spy (restoring a spy over a
    // jest.fn would wipe the mock's implementation for later tests).
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    const client = newClient();
    const { Probe, renders, counters } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    // No hold: on screen in the very first render, before any timer or read.
    expect(h.tree.queryByText('signed-out')).not.toBeNull();
    await h.setAuth({ user: { id: A }, isLoading: false });
    // The read never settled, so A's blob was not restored.
    expect(renders.find((r) => r.uid === A)!.data).toBeUndefined();
    await h.setAuth({ user: null, isLoading: false });
    expect(counters.mounts).toBe(1);
  });
});

describe('QueryCachePersist — writes', () => {
  it('writes the signed-in user\'s allow-listed queries, and drops a write scheduled for A once the user is null', async () => {
    const client = newClient();
    const { Probe } = makeProbe();
    const h = mountHarness(client, Probe, { user: null, isLoading: true });
    await flush();
    await h.setAuth({ user: { id: A }, isLoading: false });
    await flush(10); // A's read lands → a write
    await flush(1100);
    const raw = await AsyncStorage.getItem(PERSIST_KEY);
    expect(raw).not.toBeNull();
    const blob = JSON.parse(raw!);
    expect(blob.userId).toBe(A);
    expect(blob.state.queries.map((q: { queryKey: unknown[] }) => q.queryKey[0])).toEqual([ROOT]);

    // A change schedules the next write inside the throttle window…
    await act(async () => { client.setQueryData([ROOT, A], { status: 'changed' }); });
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    // …and the user leaves before it fires.
    await h.setAuth({ user: null, isLoading: false });
    await flush(3000);
    expect(setItem.mock.calls.filter((c) => c[0] === PERSIST_KEY)).toHaveLength(0);
    expect(await AsyncStorage.getItem(PERSIST_KEY)).toBeNull();
  });
});

describe('the first-screen signal', () => {
  it('BidsProvider\'s first load waits (isLoading true), markFirstUseful releases it and sends one event', async () => {
    const events: { name: string; props?: Record<string, unknown> }[] = [];
    setAnalyticsProvider({ track: (name, props) => { events.push({ name, props }); } });
    const client = newClient();
    const seen: boolean[] = [];
    function BidsProbe() {
      const { isLoading } = useBids();
      seen.push(isLoading);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <AuthCtx.Provider value={{ user: null, isLoading: false }}>
          <BidsProvider><BidsProbe /></BidsProvider>
        </AuthCtx.Provider>
      </QueryClientProvider>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(seen[seen.length - 1]).toBe(true);
    expect(client.getQueryCache().find({ queryKey: ['public_bids'] })?.state.fetchStatus ?? 'idle').toBe('idle');

    await act(async () => { markFirstUseful('home', { restoredFromDevice: false }); });
    await flush(10);
    await flush(10);
    expect(seen[seen.length - 1]).toBe(false);

    markFirstUseful('home');
    const sent = events.filter((e) => e.name === FIRST_SCREEN_EVENT);
    expect(sent).toHaveLength(1);
    const p = sent[0].props!;
    expect(Number.isInteger(p.ms)).toBe(true);
    expect(['bundle_start', 'js_module', 'navigation_start']).toContain(p.basis);
    expect(p.screen).toBe('home');
    expect(p.restored_from_device).toBe(false);
    expect(p.deferred_count).toBe(2);
    expect(typeof p.platform).toBe('string');
  });

  it('releases on its own by the 1500 ms cap even if nobody marks the first screen', async () => {
    const client = newClient();
    const seen: boolean[] = [];
    function BidsProbe() {
      seen.push(useBids().isLoading);
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <AuthCtx.Provider value={{ user: null, isLoading: false }}>
          <BidsProvider><BidsProbe /></BidsProvider>
        </AuthCtx.Provider>
      </QueryClientProvider>,
    );
    await flush(1600);
    await flush(10);
    expect(seen[seen.length - 1]).toBe(false);
  });
});
