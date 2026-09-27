// Takeoff sync — the offline hold and its teardowns (hooks/useTakeoffConditions).
//
// While this job's last push sits in the offline queue, a later push is HELD
// (not enqueued behind it). A teardown must never leave that held edit outside
// the queue: the sign-out that follows drains the queue and then wipes every
// mageid_* key, so a held edit left out would be lost for good. Each case
// mounts the REAL hook; only takeoffCloudSync's I/O is mocked. `pushes` is the
// order writes reach the queue / the account; the queue replays a record's
// writes oldest-first, so the LAST push for a job is what the account ends on.
//
// Integration round 2: an owed push survives a settle whose verify read FAILED
// (a network flap right after the drain) — a teardown still queues the latest
// doc — and the page going away with no React cleanup (web `pagehide`) fires
// the same FINAL push on local reads alone (no timer is advanced).
import { act, renderHook } from '@testing-library/react-native';
import { runPreSignOutFlushes } from '@/utils/preSignOutFlush';
import { useTakeoffConditions } from '@/hooks/useTakeoffConditions';

const P = '11111111-2222-4333-8444-555555555555';
const P2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const mockS0 = '2026-09-26T12:00:00.000Z';

const mockState = {
  queued: false, online: false, readFails: false, netHangs: false, serverStamp: mockS0 as string, firstStamp: '' as string, kicks: 0,
  listeners: new Set<() => void>(), pushes: [] as { pid: string; ids: string[]; stamp: string; outcome: string }[],
};

jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const mockProject = { name: 'Job', ownerUserId: 'u1' };
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => ({ getProject: () => mockProject }) }));
jest.mock('@/hooks/useProjectRole', () => ({
  useProjectRoleState: () => ({ role: 'owner', isLoading: false, isError: false, isPaused: false }),
}));
jest.mock('@/utils/takeoffCloudSync', () => {
  const actual = jest.requireActual('@/utils/takeoffCloudSync');
  return {
    ...actual,
    canSyncTakeoff: async () => 'ok',
    takeoffSessionUserId: async () => 'u1',
    // netHangs: a network read never answers (a page after `pagehide` gets no response).
    fetchServerTakeoffDoc: async () => {
      if (mockState.netHangs) await new Promise(() => {});
      return mockState.readFails ? 'offline' : { doc: { version: 1, conditions: [], measurements: [], pushed: {} }, updatedAt: mockS0 };
    },
    fetchServerStamp: async () => {
      if (mockState.netHangs) await new Promise(() => {});
      return mockState.online && !mockState.readFails ? mockState.serverStamp : 'offline';
    },
    pushTakeoffDoc: async (pid: string, _uid: string, doc: { conditions: { id: string }[] }, stamp: string) => {
      const ids = doc.conditions.map((c) => c.id);
      if (mockState.online && !mockState.queued) {
        mockState.serverStamp = stamp;
        mockState.pushes.push({ pid, ids, stamp, outcome: 'synced' });
        return 'synced';
      }
      if (!mockState.firstStamp) mockState.firstStamp = stamp;
      mockState.queued = true; // it falls into the offline queue (behind any earlier write of the record)
      mockState.pushes.push({ pid, ids, stamp, outcome: 'queued' });
      return 'queued';
    },
    takeoffWriteQueued: async () => mockState.queued,
    kickTakeoffQueueDrain: () => { mockState.kicks += 1; },
    onTakeoffQueueSignal: (l: () => void) => { mockState.listeners.add(l); return () => { mockState.listeners.delete(l); }; },
    readTakeoffSyncMeta: async () => ({ meta: { localEditedAt: null, pendingStamp: null, lastSyncedAt: null, lastSyncedLocalAt: null }, stored: true }),
    writeTakeoffSyncMeta: async () => {},
    saveConflictCopy: async () => true,
    readConflictCopy: async () => null,
    clearConflictCopy: async () => {},
  };
});

type Doc = { conditions: { id: string }[] };
type Hook = { loaded: boolean; saveLine: string; update: (fn: (d: Doc) => Doc) => void };

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const cond = (id: string) => ({ id, name: id, kind: 'area', unit: 'SF', createdAt: new Date().toISOString() });

function reset() {
  mockState.queued = false; mockState.online = false; mockState.readFails = false; mockState.netHangs = false; mockState.serverStamp = mockS0; mockState.firstStamp = ''; mockState.kicks = 0;
  mockState.listeners.clear(); mockState.pushes = [];
}
async function open(result: { current: Hook }) {
  for (let i = 0; i < 40 && !(result.current.loaded && /Saved to your account/.test(result.current.saveLine)); i++) await wait(50);
  expect(result.current.saveLine).toMatch(/Saved to your account/);
}
const add = (result: { current: Hook }, id: string) =>
  act(() => result.current.update((d) => ({ ...d, conditions: [...d.conditions, cond(id)] })));
/** Back online: the queue replays oldest-first, so the LAST queued write is what lands; then the signal fires.
 *  `flap`: the network drops again right after the drain, so every read (the verify, the merge) fails. */
async function flushQueue(opts: { flap?: boolean } = {}) {
  mockState.online = true;
  const queued = mockState.pushes.filter((p) => p.outcome === 'queued');
  mockState.serverStamp = queued.length ? queued[queued.length - 1].stamp : mockState.serverStamp;
  mockState.queued = false;
  if (opts.flap) mockState.readFails = true;
  for (const l of [...mockState.listeners]) l();
  await wait(600);
}
/** Only microtasks — no timer is advanced (what a page gets after `pagehide`). */
const microtasks = () => act(async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); });
/** A web window for the hook's pagehide / online listeners (the jest env has none). */
function stubWindow() {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const hadWindow = !!g.window;
  const w = (g.window ?? (g.window = {})) as Record<string, unknown>;
  const saved = { add: w.addEventListener, remove: w.removeEventListener };
  const ls = new Map<string, Set<() => void>>();
  w.addEventListener = (t: string, fn: () => void) => { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t)!.add(fn); };
  w.removeEventListener = (t: string, fn: () => void) => { ls.get(t)?.delete(fn); };
  return {
    fire: (t: string) => { for (const fn of [...(ls.get(t) ?? [])]) fn(); },
    count: (t: string) => ls.get(t)?.size ?? 0,
    restore: () => {
      if (!hadWindow) { delete g.window; return; }
      w.addEventListener = saved.add; w.removeEventListener = saved.remove;
    },
  };
}
const forJob = (pid: string) => mockState.pushes.filter((p) => p.pid === pid);
const lastFor = (pid: string) => forJob(pid).map((p) => p.ids).pop() ?? [];
const stampsRise = (pid: string) => forJob(pid).every((p, i, a) => i === 0 || Date.parse(p.stamp) > Date.parse(a[i - 1].stamp));

describe('takeoff sync — the offline hold never outlives the workspace', () => {
  beforeEach(reset);

  it('mounted: the second push is held (one queued copy), a drain is kicked, and the latest doc lands after the flush', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    expect(mockState.pushes.map((p) => p.ids)).toEqual([['c1']]);
    expect(mockState.kicks).toBeGreaterThanOrEqual(1);
    expect(result.current.saveLine).toMatch(/back online/);
    await flushQueue();
    expect(lastFor(P)).toEqual(['c1', 'c2']);
    expect(result.current.saveLine).toMatch(/Saved to your account/);
    unmount();
  });

  it('unmount with an edit still debouncing: the latest doc goes into the queue, stamped past the held write', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    add(result, 'c3'); unmount(); await wait(400);
    expect(lastFor(P)).toEqual(['c1', 'c2', 'c3']);
    expect(forJob(P).length).toBe(2);
    expect(stampsRise(P)).toBe(true);
    await flushQueue();
    expect(lastFor(P)).toEqual(['c1', 'c2', 'c3']);
  });

  it('unmount with a push already held and nothing pending: the held doc still goes into the queue', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    expect(forJob(P).length).toBe(1);
    unmount(); await wait(400);
    expect(lastFor(P)).toEqual(['c1', 'c2']);
    expect(stampsRise(P)).toBe(true);
  });

  it('job switch while held: the old job’s latest doc goes into the queue', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ pid }: { pid: string }) => useTakeoffConditions(pid) as unknown as Hook, { initialProps: { pid: P } },
    );
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    rerender({ pid: P2 }); await wait(600);
    expect(lastFor(P)).toEqual(['c1', 'c2']);
    expect(stampsRise(P)).toBe(true);
    unmount();
  });

  it('sign-out while mounted: the pre-sign-out flush puts the held doc in the queue before the drain', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    expect(forJob(P).length).toBe(1);
    await act(async () => { await runPreSignOutFlushes(); });
    expect(lastFor(P)).toEqual(['c1', 'c2']);
    expect(stampsRise(P)).toBe(true);
    unmount();
  });

  it('the verify read fails right after the drain, then UNMOUNT: the owed push still goes out and the account ends on the latest doc', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    await flushQueue({ flap: true });
    expect(lastFor(P)).toEqual(['c1']);
    expect(result.current.saveLine).not.toMatch(/Saved to your account/);
    unmount(); await wait(400);
    expect(lastFor(P)).toEqual(['c1', 'c2']);
    expect(stampsRise(P)).toBe(true);
  });

  it('the verify read fails right after the drain, then the PRE-SIGN-OUT flush: the latest doc goes out before the drain', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    add(result, 'c2'); await wait(1700);
    await flushQueue({ flap: true });
    expect(lastFor(P)).toEqual(['c1']);
    await act(async () => { await runPreSignOutFlushes(); });
    expect(lastFor(P)).toEqual(['c1', 'c2']);
    expect(stampsRise(P)).toBe(true);
    unmount();
  });

  it('the verify read fails, then the network is back (online): ONE push is re-armed and the line reaches the account', async () => {
    const win = stubWindow();
    let unmount = () => {};
    try {
      const r = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
      const result = r.result;
      unmount = () => { unmount = () => {}; r.unmount(); };
      await open(result);
      add(result, 'c1'); await wait(1700);
      add(result, 'c2'); await wait(1700);
      await flushQueue({ flap: true });
      expect(lastFor(P)).toEqual(['c1']);
      mockState.readFails = false;
      act(() => { win.fire('online'); });
      await wait(1900);
      expect(lastFor(P)).toEqual(['c1', 'c2']);
      expect(result.current.saveLine).toMatch(/Saved to your account/);
      const n = forJob(P).length;
      act(() => { win.fire('online'); });
      await wait(1900);
      expect(forJob(P).length).toBe(n);
      unmount();
    } finally { unmount(); win.restore(); }
  });

  it('the page goes away (pagehide, no React cleanup) with a push held and nothing pending: the held doc is queued on microtasks alone', async () => {
    const win = stubWindow();
    let unmount = () => {};
    try {
      const r = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
      const result = r.result;
      unmount = () => { unmount = () => {}; r.unmount(); };
      await open(result);
      expect(win.count('pagehide')).toBe(1);
      add(result, 'c1'); await wait(1700);
      add(result, 'c2'); await wait(1700);
      expect(forJob(P).length).toBe(1);
      mockState.netHangs = true;
      act(() => { win.fire('pagehide'); });
      await microtasks();
      mockState.netHangs = false;
      expect(lastFor(P)).toEqual(['c1', 'c2']);
      expect(forJob(P).map((p) => p.outcome)).toEqual(['queued', 'queued']);
      expect(stampsRise(P)).toBe(true);
      unmount();
      expect(win.count('pagehide')).toBe(0);
    } finally { unmount(); win.restore(); }
  });

  it('the page goes away (pagehide) with an edit still debouncing: the latest doc is queued, stamped past the held write', async () => {
    const win = stubWindow();
    let unmount = () => {};
    try {
      const r = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
      const result = r.result;
      unmount = () => { unmount = () => {}; r.unmount(); };
      await open(result);
      add(result, 'c1'); await wait(1700);
      add(result, 'c2'); await wait(1700);
      add(result, 'c3');
      mockState.netHangs = true;
      act(() => { win.fire('pagehide'); });
      await microtasks();
      mockState.netHangs = false;
      expect(lastFor(P)).toEqual(['c1', 'c2', 'c3']);
      expect(forJob(P).length).toBe(2);
      expect(stampsRise(P)).toBe(true);
      unmount();
    } finally { unmount(); win.restore(); }
  });

  it('nothing owed: a teardown adds no copy', async () => {
    const { result, unmount } = renderHook(() => useTakeoffConditions(P) as unknown as Hook);
    await open(result);
    add(result, 'c1'); await wait(1700);
    expect(forJob(P).length).toBe(1);
    unmount(); await wait(400);
    expect(forJob(P).length).toBe(1);
  });
});
