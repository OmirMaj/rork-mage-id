/**
 * __tests__/sync/offline-queue.test.ts — the sync engine, executed.
 *
 * Final-push audit 2026-09-03, code-health O5 / "ten most valuable tests" #1-#2:
 * `utils/offlineQueue.ts` had ZERO executing tests — `validate-offline-group-
 * abort` pins source text only. Every case below drives the real
 * `processOfflineQueue()` against the repo's Supabase mock (`__tests__/mocks/
 * supabase.ts`, wired by moduleNameMapper) with `supabase.from` re-scripted per
 * test, and asserts the PERSISTED queue afterwards — because the persisted
 * queue is what survives a kill, and that is the contract the jobsite relies on.
 *
 * Audit ids covered: SYNC-F1 (parent-before-child + RLS retry-once), SYNC-F4
 * (23505-as-success + per-group write-back), SYNC-F6 (record-key fallback),
 * HEALTH-F10 (enqueue failure is surfaced), appendix (JWT errors are transient).
 * Review 2026-09-05: B1 (a flush is bound to one session), B2 (a child waits
 * for a parent that has not landed instead of spending its RLS retry), A7
 * (children of a project deleted in the same flush are discarded quietly).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { __setSmokeSession } from '@/__tests__/mocks/supabase';
import {
  addToOfflineQueue,
  clearOfflineQueue,
  doomWatermark,
  expireDoomedProjectIds,
  getOfflineQueue,
  getOwnOfflineQueue,
  onQueueChanged,
  onQueueDropped,
  processOfflineQueue,
  retainOfflineQueueForUser,
  supabaseWrite,
  takeDoomedProjectIds,
  type OfflineMutation,
} from '@/utils/offlineQueue';

jest.mock('@/components/animations/NailItToast', () => ({
  __esModule: true,
  oops: jest.fn(),
  nailIt: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { oops } = require('@/components/animations/NailItToast') as { oops: jest.Mock };
const Sentry = require('@sentry/react-native') as { captureMessage: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

const QUEUE_KEY = 'mageid_offline_queue';
const LAST_USER_KEY = 'mageid_last_user_id';

// B1: every flush runs under a session. USER_A is the device's signed-in user
// for the whole suite unless a test says otherwise.
const USER_A = 'user-a';
const USER_B = 'user-b';
const sessionFor = (id: string) => ({ user: { id }, access_token: `tok-${id}` });

type Call = { table: string; op: 'insert' | 'upsert' | 'update' | 'delete'; data: Record<string, unknown> };
type PgError = { message: string; code?: string };
type Script = (call: Call) => Promise<{ error: PgError | null }>;

const calls: Call[] = [];
let script: Script = async () => ({ error: null });

async function run(call: Call) {
  calls.push(call);
  return script(call);
}

// A postgrest-shaped stand-in narrow enough to script per call. The repo mock's
// builder resolves EMPTY for everything; the sync engine needs outcomes.
function installScript(fn: Script) {
  script = fn;
  (supabase as { from: unknown }).from = jest.fn((table: string) => ({
    insert: (data: Record<string, unknown>) => run({ table, op: 'insert', data }),
    upsert: (data: Record<string, unknown>) => run({ table, op: 'upsert', data }),
    update: (data: Record<string, unknown>) => ({
      eq: (_col: string, id: string) => run({ table, op: 'update', data: { ...data, id } }),
    }),
    delete: () => ({
      eq: (_col: string, id: string) => run({ table, op: 'delete', data: { id } }),
    }),
  }));
}

type Seed = Partial<OfflineMutation> & Pick<OfflineMutation, 'table' | 'operation' | 'data'>;

// Entries are tagged for USER_A unless the seed names `userId` itself
// (`userId: undefined` seeds a pre-tagging, legacy entry).
async function seed(entries: Seed[]): Promise<void> {
  const rows: OfflineMutation[] = entries.map((e, i) => ({
    id: e.id ?? `m${i}`,
    timestamp: e.timestamp ?? 1000 + i,
    retryCount: e.retryCount ?? 0,
    table: e.table,
    operation: e.operation,
    data: e.data,
    ...(e.rlsRetried !== undefined ? { rlsRetried: e.rlsRetried } : {}),
    ...('userId' in e ? (e.userId ? { userId: e.userId } : {}) : { userId: USER_A }),
  }));
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
}

const ok = async () => ({ error: null });
const pg = (message: string, code?: string) => async () => ({ error: { message, code } });
/** Spin the microtask queue until `cond` holds. Used where a test has to let a
 *  flush reach a specific point before interfering with it; a fixed number of
 *  `await Promise.resolve()`s is a guess that silently stops being true the
 *  moment an `await` is added or removed inside the flush. */
async function waitFor(cond: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns && !cond(); i++) await Promise.resolve();
  if (!cond()) throw new Error('waitFor: condition never held');
}
const netFail = async () => { throw new TypeError('Network request failed'); };
const rlsFor = (table: string) => pg(`new row violates row-level security policy for table "${table}"`, '42501');

beforeEach(async () => {
  await AsyncStorage.clear();
  calls.length = 0;
  installScript(ok);
  __setSmokeSession(sessionFor(USER_A));
  // A7: the doomed-project handoff is module state (read-once, in memory). A
  // test that dooms a project and never reads the verdict must not leave it
  // sitting there for the next one.
  takeDoomedProjectIds();
});

afterAll(() => {
  __setSmokeSession(null);
});

describe('offline queue — classification (O5 #1)', () => {
  test('PGRST205 schema-cache miss keeps the entry with retryCount unchanged', async () => {
    await seed([{ table: 'deliveries', operation: 'insert', data: { id: 'd1' } }]);
    installScript(pg("Could not find the table 'public.deliveries' in the schema cache", 'PGRST205'));

    const res = await processOfflineQueue();

    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(0);
    expect(res.remaining).toBe(1);
    expect(oops).not.toHaveBeenCalled();
  });

  test('23514 check violation is dropped and notifyDroppedWrites fires once naming the table', async () => {
    await seed([{ table: 'invoices', operation: 'insert', data: { id: 'i1', total: -1 } }]);
    installScript(pg('new row for relation "invoices" violates check constraint "invoices_total_check"', '23514'));

    const res = await processOfflineQueue();

    expect(await getOfflineQueue()).toHaveLength(0);
    expect(res.failed).toBe(1);
    expect(oops).toHaveBeenCalledTimes(1);
    expect(String(oops.mock.calls[0][0])).toContain('invoices');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  test('a thrown network error keeps the entry unchanged', async () => {
    await seed([{ table: 'rfis', operation: 'insert', data: { id: 'r1' } }]);
    installScript(netFail);

    await processOfflineQueue();

    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(0);
  });

  test('JWT / expired-token errors are transient, not terminal (audit appendix)', async () => {
    await seed([{ table: 'punch_items', operation: 'insert', data: { id: 'p1' } }]);
    installScript(pg('JWT expired', 'PGRST301'));

    await processOfflineQueue();

    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(0);
    expect(oops).not.toHaveBeenCalled();
  });
});

describe('offline queue — parent before child (SYNC-F1)', () => {
  test('every projects group runs to completion before any child group, regardless of enqueue order', async () => {
    // The child was enqueued FIRST (older timestamp) — FIFO alone would send it
    // before its parent exists.
    await seed([
      { id: 'child', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, timestamp: 1 },
      { id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p1', name: 'Truck job' }, timestamp: 2 },
    ]);
    let parentDone = false;
    let childSawParentDone = false;
    installScript(async (c) => {
      if (c.table === 'projects') {
        await new Promise((r) => setTimeout(r, 5)); // the big payload is the slow one
        parentDone = true;
        return { error: null };
      }
      childSawParentDone = parentDone;
      return { error: null };
    });

    const res = await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['projects', 'daily_reports']);
    expect(childSawParentDone).toBe(true);
    expect(res.processed).toBe(2);
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('project_financials groups run after projects and before the rest', async () => {
    await seed([
      { table: 'photos', operation: 'insert', data: { id: 'ph1', project_id: 'p1' }, timestamp: 1 },
      { table: 'project_financials', operation: 'upsert', data: { project_id: 'p1', budget: 10 }, timestamp: 2 },
      { table: 'projects', operation: 'upsert', data: { id: 'p1' }, timestamp: 3 },
    ]);

    await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['projects', 'project_financials', 'photos']);
  });

  test('an RLS rejection on a child INSERT is retried once (retryCount bumped, group kept), then dropped', async () => {
    await seed([{ id: 'c', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p-missing' } }]);
    installScript(rlsFor('daily_reports'));

    await processOfflineQueue();
    let q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(1);
    expect(oops).not.toHaveBeenCalled();

    // Second flush, same rejection: the parent genuinely never arrived.
    await processOfflineQueue();
    q = await getOfflineQueue();
    expect(q).toHaveLength(0);
    expect(oops).toHaveBeenCalledTimes(1);
  });

  test('an RLS rejection on a row with no project reference stays terminal', async () => {
    await seed([{ table: 'profiles', operation: 'insert', data: { id: 'u2' } }]);
    installScript(rlsFor('profiles'));

    await processOfflineQueue();

    expect(await getOfflineQueue()).toHaveLength(0);
    expect(oops).toHaveBeenCalledTimes(1);
  });
});

describe('offline queue — children wait for their parent (B2 / A7)', () => {
  test('a child is NOT dispatched — and its RLS retry is NOT spent — while its projects upsert keeps timing out', async () => {
    // The slow-uplink case the review named: the big projects upsert times out
    // twice while the small child insert would reach the server each time and
    // be rejected by RLS (the parent row is not there yet). Pre-fix the first
    // rejection burned `rlsRetried`, and the second dropped the child as
    // terminal — before the parent had ever landed.
    await seed([
      { id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p1', name: 'Truck job' }, timestamp: 1 },
      { id: 'child', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, timestamp: 2 },
    ]);
    installScript(async (c) => {
      if (c.table === 'projects') throw new TypeError('Network request failed');
      return rlsFor(c.table)();
    });

    await processOfflineQueue();
    await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['projects', 'projects']);
    const held = (await getOfflineQueue()).find((m) => m.id === 'child');
    expect(held).toBeDefined();
    expect(held?.retryCount).toBe(0);
    expect(held?.rlsRetried).toBeUndefined();
    expect(oops).not.toHaveBeenCalled();

    // Third flush: the uplink holds, the parent lands, and the child follows.
    calls.length = 0;
    installScript(ok);
    const res = await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['projects', 'daily_reports']);
    expect(res.processed).toBe(2);
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('a child whose project upsert was DROPPED this flush is held untouched for the next flush', async () => {
    await seed([
      { id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p1', budget: -1 }, timestamp: 1 },
      { id: 'child', table: 'photos', operation: 'insert', data: { id: 'ph1', project_id: 'p1' }, timestamp: 2 },
    ]);
    installScript(async (c) => (c.table === 'projects'
      ? { error: { message: 'new row for relation "projects" violates check constraint "projects_budget_check"', code: '23514' } }
      : { error: null }));

    const res = await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['projects']);
    expect(res.failed).toBe(1);                       // the parent, reported once
    const q = await getOfflineQueue();
    expect(q.map((m) => m.id)).toEqual(['child']);
    expect(q[0].retryCount).toBe(0);
    expect(q[0].rlsRetried).toBeUndefined();
  });

  test('children of a project DELETED in the same flush are discarded — no dispatch, no toast (A7)', async () => {
    await seed([
      { id: 'dfr', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, timestamp: 1 },
      { id: 'fin', table: 'project_financials', operation: 'upsert', data: { project_id: 'p1', budget: 10 }, timestamp: 2 },
      { id: 'del', table: 'projects', operation: 'delete', data: { id: 'p1' }, timestamp: 3 },
      { id: 'other', table: 'rfis', operation: 'insert', data: { id: 'r1', project_id: 'p2' }, timestamp: 4 },
    ]);

    const res = await processOfflineQueue();

    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['projects:delete', 'rfis:insert']);
    expect(res.failed).toBe(0);
    expect(oops).not.toHaveBeenCalled();
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('a project INSERT dropped for good takes its children with it, in ONE toast (A5)', async () => {
    // The parent row has never been on the server (a re-sent insert that HAD
    // landed reads as 23505 = success, never as a drop), so can_access_project
    // can never pass for these children. Holding them for the next flush only
    // buys them one more RLS refusal and a second toast a day later; they go
    // now, counted as failed, named in the same report as the parent.
    await seed([
      { id: 'parent', table: 'projects', operation: 'insert', data: { id: 'p1' }, timestamp: 1 },
      { id: 'dfr', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, timestamp: 2 },
      { id: 'fin', table: 'project_financials', operation: 'upsert', data: { project_id: 'p1', budget: 10 }, timestamp: 3 },
      { id: 'other', table: 'rfis', operation: 'insert', data: { id: 'r1', project_id: 'p2' }, timestamp: 4 },
    ]);
    installScript(async (c) => (c.table === 'projects' ? rlsFor('projects')() : { error: null }));

    const seen: { tables: string[]; reason: string }[] = [];
    const off = onQueueDropped((dropped, reason) => { seen.push({ tables: dropped.map((m) => m.table), reason }); });
    const res = await processOfflineQueue();
    off();

    // Neither child was dispatched — no RLS budget spent proving the obvious.
    expect(calls.map((c) => c.table)).toEqual(['projects', 'rfis']);
    expect(res.failed).toBe(3);                        // parent + 2 children
    expect(seen).toHaveLength(1);                      // ONE report, not one per group
    expect(seen[0].tables.sort()).toEqual(['daily_reports', 'project_financials', 'projects']);
    expect(oops).toHaveBeenCalledTimes(1);
    // The unrelated project's write is untouched by any of it.
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('a project UPSERT dropped for its PAYLOAD does not doom children (A5 boundary)', async () => {
    // A check violation on an upsert is usually an EDIT of a project that
    // already exists on the server; its queued children can still land. Those
    // keep the B2 hold instead of being dropped — see the test above this one.
    await seed([
      { id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p1', budget: -1 }, timestamp: 1 },
      { id: 'dfr', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, timestamp: 2 },
    ]);
    installScript(async (c) => (c.table === 'projects'
      ? { error: { message: 'violates check constraint "projects_budget_check"', code: '23514' } }
      : { error: null }));

    const res = await processOfflineQueue();

    expect(res.failed).toBe(1);                        // the parent alone
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['dfr']);
  });

  test('children wait (untouched) when the project delete itself did not land', async () => {
    await seed([
      { id: 'del', table: 'projects', operation: 'delete', data: { id: 'p1' }, timestamp: 1 },
      { id: 'dfr', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, timestamp: 2 },
    ]);
    installScript(async (c) => (c.table === 'projects' ? netFail() : { error: null }));

    await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['projects']);
    expect((await getOfflineQueue()).map((m) => m.id).sort()).toEqual(['del', 'dfr']);
  });
});

describe('offline queue — a doomed project dooms its queued PHOTOS too (A7)', () => {
  // The offline queue drops a doomed project's own children with it, but a
  // photo's bytes live in utils/photoUploadQueue.ts, which this module must not
  // import (that queue imports this one). Without the handoff below the photos
  // were dispatched anyway, burned every PHOTO_RLS_MAX_RETRIES against a row
  // that will never exist, and raised a SECOND toast a day after the parent's.
  // The photo drain's own end of this is covered at runtime by
  // scripts/validate-photo-drain.ts (§10); what is pinned here is the verdict.
  test('a projects INSERT dropped for good is handed over, and the verdict is read once', async () => {
    await seed([{ id: 'parent', table: 'projects', operation: 'insert', data: { id: 'p9' }, timestamp: 1 }]);
    installScript(rlsFor('projects'));

    const res = await processOfflineQueue();

    expect(res.failed).toBe(1);
    expect([...takeDoomedProjectIds()]).toEqual(['p9']);
    // Consumed by the drain that acts on it — a later drain must not drop a
    // photo for a project the user has since re-created under the same id.
    expect([...takeDoomedProjectIds()]).toEqual([]);
  });

  test('a project whose write merely did not LAND this flush is not doomed', async () => {
    // B2 already holds its children for the next flush; dooming them here would
    // throw away a jobsite's photos over one bad uplink.
    await seed([{ id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p9' }, timestamp: 1 }]);
    installScript(netFail);

    await processOfflineQueue();

    expect([...takeDoomedProjectIds()]).toEqual([]);
  });

  test('a verdict expires with the drain that could have used it — but only if it predates it', async () => {
    // A8 (round 5): the photo drain reads a watermark before it starts and
    // spends everything at or below it when it finishes, so a verdict recorded
    // while the photo queue was EMPTY does not outlive the process (and does
    // not drop a photo taken for that project an hour later). The end-to-end
    // path — a real drain doing the expiring — is scripts/validate-photo-drain
    // §12; the counter's own contract is here.
    await seed([{ id: 'p1', table: 'projects', operation: 'insert', data: { id: 'p1' }, timestamp: 1 }]);
    installScript(rlsFor('projects'));
    await processOfflineQueue();

    const mark = doomWatermark();          // what a drain starting now would carry

    // A second flush dooms another project WHILE that drain is in the air.
    await seed([{ id: 'p2', table: 'projects', operation: 'insert', data: { id: 'p2' }, timestamp: 2 }]);
    await processOfflineQueue();

    expect(expireDoomedProjectIds(mark)).toEqual(['p1']);   // the drain's own to spend
    expect([...takeDoomedProjectIds()]).toEqual(['p2']);    // the next drain's
  });

  test('a project UPSERT dropped for its PAYLOAD is not doomed either (A5 boundary)', async () => {
    // The row probably exists on the server already; its photos can still land.
    await seed([{ id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p9', budget: -1 }, timestamp: 1 }]);
    installScript(pg('violates check constraint "projects_budget_check"', '23514'));

    const res = await processOfflineQueue();

    expect(res.failed).toBe(1);
    expect([...takeDoomedProjectIds()]).toEqual([]);
  });
});

describe('offline queue — bound to one session (B1)', () => {
  test('addToOfflineQueue tags the entry with the signed-in user, and leaves it untagged with no session', async () => {
    await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r1' } });
    __setSmokeSession(null);
    await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r2' } });

    const q = await getOfflineQueue();
    expect(q.map((m) => [m.data.id, m.userId])).toEqual([['r1', USER_A], ['r2', undefined]]);
  });

  test('with no session nothing is sent and every entry stays exactly as it was', async () => {
    await seed([
      { id: 'a', table: 'rfis', operation: 'insert', data: { id: 'r1' }, retryCount: 2 },
      { id: 'b', table: 'projects', operation: 'upsert', data: { id: 'p1' } },
    ]);
    const before = await AsyncStorage.getItem(QUEUE_KEY);
    __setSmokeSession(null);

    const res = await processOfflineQueue();

    expect(calls).toHaveLength(0);
    // A3: with no session, nothing is anyone's — the entries are reported as
    // `foreign`, never as `remaining`. `remaining` is what OfflineSyncManager
    // re-arms its backoff on, and a signed-out device retrying forever is a
    // wake-lock, not a sync strategy.
    expect(res).toEqual({ processed: 0, failed: 0, remaining: 0, foreign: 2 });
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBe(before);
    expect(oops).not.toHaveBeenCalled();
  });

  test("entries queued by user A are not sent under user B's session; they stay queued untouched", async () => {
    // The window the review named: gotrue's SIGNED_IN flips isAuthenticated and
    // starts a drain before completeSignIn has dropped the previous tenant's
    // queue. B's own entry (enqueued mid-window) still goes; A's do not.
    await seed([
      { id: 'a1', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' }, userId: USER_A },
      { id: 'a2', table: 'projects', operation: 'upsert', data: { id: 'p1' }, userId: USER_A },
      { id: 'b1', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_B },
    ]);
    __setSmokeSession(sessionFor(USER_B));

    const res = await processOfflineQueue();

    expect(calls.map((c) => c.table)).toEqual(['rfis']);
    expect(res.processed).toBe(1);
    // A3: A's two entries are `foreign`, not `remaining`. Counting them as
    // remaining re-armed OfflineSyncManager's backoff forever (no number of
    // retries under B's JWT will ever send them) and made the sign-out dialog
    // and the sync pill tell B about work that was never theirs.
    expect(res.remaining).toBe(0);
    expect(res.foreign).toBe(2);
    const q = await getOfflineQueue();
    expect(q.map((m) => [m.id, m.userId, m.retryCount])).toEqual([['a1', USER_A, 0], ['a2', USER_A, 0]]);
    expect(oops).not.toHaveBeenCalled();
  });

  test('an untagged (pre-tagging) entry is flushed only when the last-user marker names the session user — and is tagged on its way through', async () => {
    await seed([
      { id: 'legacy-ok', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: undefined },
      { id: 'legacy-held', table: 'rfis', operation: 'insert', data: { id: 'r2' }, userId: undefined },
    ]);
    await AsyncStorage.setItem(LAST_USER_KEY, USER_A);
    installScript(async (c) => (c.data.id === 'r2' ? netFail() : { error: null }));

    await processOfflineQueue();

    expect(calls.map((c) => c.data.id)).toEqual(['r1', 'r2']);
    const q = await getOfflineQueue();
    expect(q.map((m) => [m.id, m.userId])).toEqual([['legacy-held', USER_A]]);
  });

  test('an untagged entry is kept untouched when the marker is absent or names someone else', async () => {
    await seed([{ id: 'legacy', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: undefined }]);

    await processOfflineQueue();                       // no marker at all
    expect(calls).toHaveLength(0);

    await AsyncStorage.setItem(LAST_USER_KEY, USER_B);
    const res = await processOfflineQueue();           // marker names another user
    expect(calls).toHaveLength(0);
    expect(res.remaining).toBe(0);                     // A3: not ours to send…
    expect(res.foreign).toBe(1);                       // …so not ours to count either
    const q = await getOfflineQueue();
    expect(q.map((m) => [m.id, m.userId])).toEqual([['legacy', undefined]]);
  });

  test('getOwnOfflineQueue — what the depth pill and the sign-out dialog count (A3)', async () => {
    await seed([
      { id: 'a1', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_A },
      { id: 'b1', table: 'rfis', operation: 'insert', data: { id: 'r2' }, userId: USER_B },
      { id: 'legacy', table: 'rfis', operation: 'insert', data: { id: 'r3' }, userId: undefined },
    ]);

    // Untagged entries need the device marker to vouch for them, exactly as a
    // flush would treat them — the number shown must equal the number sendable.
    expect((await getOwnOfflineQueue()).map((m) => m.id)).toEqual(['a1']);
    await AsyncStorage.setItem(LAST_USER_KEY, USER_A);
    expect((await getOwnOfflineQueue()).map((m) => m.id)).toEqual(['a1', 'legacy']);

    __setSmokeSession(null);
    expect(await getOwnOfflineQueue()).toEqual([]);     // signed out: nothing is anyone's
    __setSmokeSession(sessionFor(USER_A));
  });

  test('the session ending mid-flush stops dispatch: the next batch is never sent and stays queued', async () => {
    // Six singleton groups = two batches at MAX_CONCURRENCY 5. The session dies
    // on the first send; batch 2 must never leave the device.
    await seed(Array.from({ length: 6 }, (_, i) => ({
      id: `g${i + 1}`, table: 'rfis', operation: 'insert' as const, data: { id: `r${i + 1}` }, timestamp: i + 1,
    })));
    installScript(async () => {
      __setSmokeSession(null);
      return { error: null };
    });

    const res = await processOfflineQueue();

    expect(calls.length).toBeLessThanOrEqual(5);
    expect(calls.map((c) => c.data.id)).not.toContain('r6');
    expect(res.processed).toBe(calls.length);
    expect(res.failed).toBe(0);
    const q = await getOfflineQueue();
    expect(q.map((m) => m.id)).toContain('g6');
    expect(q.every((m) => m.retryCount === 0)).toBe(true);
    expect(q.length).toBe(6 - calls.length);
    expect(oops).not.toHaveBeenCalled();
  });

  test("the session changing hands mid-flush stops a group: the record's queued update is kept, not sent under the new user", async () => {
    await seed([
      { id: 'ins', table: 'change_orders', operation: 'insert', data: { id: 'co1', project_id: 'p1', amount: 5000 }, timestamp: 1 },
      { id: 'upd', table: 'change_orders', operation: 'update', data: { id: 'co1', amount: 7500 }, timestamp: 2 },
    ]);
    installScript(async (c) => {
      if (c.op === 'insert') __setSmokeSession(sessionFor(USER_B)); // user B signs in on the shared device
      return { error: null };
    });

    const res = await processOfflineQueue();

    expect(calls.map((c) => c.op)).toEqual(['insert']);
    expect(res.processed).toBe(1);
    expect(res.failed).toBe(0);
    const q = await getOfflineQueue();
    expect(q.map((m) => [m.id, m.userId, m.retryCount])).toEqual([['upd', USER_A, 0]]);
    expect(oops).not.toHaveBeenCalled();
  });
});

describe('offline queue — re-sent inserts and per-group write-back (SYNC-F4)', () => {
  test('23505 on a primary key is success: the insert is removed and the dependent update still runs', async () => {
    await seed([
      { id: 'ins', table: 'change_orders', operation: 'insert', data: { id: 'co1', project_id: 'p1', amount: 5000 }, timestamp: 1 },
      { id: 'upd', table: 'change_orders', operation: 'update', data: { id: 'co1', amount: 7500, status: 'approved' }, timestamp: 2 },
    ]);
    installScript(async (c) => {
      if (c.op === 'insert') {
        return { error: { message: 'duplicate key value violates unique constraint "change_orders_pkey"', code: '23505' } };
      }
      return { error: null };
    });

    const res = await processOfflineQueue();

    expect(calls.map((c) => c.op)).toEqual(['insert', 'update']);
    expect(calls[1].data).toMatchObject({ id: 'co1', amount: 7500 });
    expect(await getOfflineQueue()).toHaveLength(0);
    expect(res.processed).toBe(2);
    expect(res.failed).toBe(0);
    expect(oops).not.toHaveBeenCalled();
  });

  test('23505 on a NON-primary-key unique constraint is still a real conflict (dropped + reported)', async () => {
    await seed([{ table: 'invoices', operation: 'insert', data: { id: 'i9', project_id: 'p1', number: 4 } }]);
    installScript(pg('duplicate key value violates unique constraint "invoices_project_id_number_key"', '23505'));

    await processOfflineQueue();

    expect(await getOfflineQueue()).toHaveLength(0);
    expect(oops).toHaveBeenCalledTimes(1);
  });

  test("a finished group's ids are gone from storage before the next group runs (kill window = one group)", async () => {
    await seed([
      { id: 'child', table: 'photos', operation: 'insert', data: { id: 'ph1', project_id: 'p1' }, timestamp: 1 },
      { id: 'parent', table: 'projects', operation: 'upsert', data: { id: 'p1' }, timestamp: 2 },
    ]);
    let idsSeenByChild: string[] | null = null;
    installScript(async (c) => {
      if (c.table === 'projects') return { error: null };
      // Simulates the kill: the second group never completes. What matters is
      // what storage held at the moment it STARTED.
      idsSeenByChild = (await getOfflineQueue()).map((m) => m.id);
      throw new TypeError('Network request failed');
    });

    await processOfflineQueue();

    expect(idsSeenByChild).toEqual(['child']);
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['child']);
  });

  test('a mutation enqueued mid-flush survives the write-back', async () => {
    await seed([{ id: 'a', table: 'rfis', operation: 'insert', data: { id: 'r1' } }]);
    installScript(async () => {
      await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r2' } });
      return { error: null };
    });

    await processOfflineQueue();

    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].data.id).toBe('r2');
  });
});

describe('offline queue — record key fallback (SYNC-F6)', () => {
  test('two upserts for one project with no data.id serialize (older first) instead of racing', async () => {
    await seed([
      { table: 'building_access_rules', operation: 'upsert', data: { project_id: 'p1', rules: 'v1' }, timestamp: 1 },
      { table: 'building_access_rules', operation: 'upsert', data: { project_id: 'p1', rules: 'v2' }, timestamp: 2 },
      { table: 'rfis', operation: 'insert', data: { id: 'r1' }, timestamp: 3 },
    ]);
    const inFlight = new Map<string, number>();
    const maxInFlight = new Map<string, number>();
    installScript(async (c) => {
      inFlight.set(c.table, (inFlight.get(c.table) ?? 0) + 1);
      maxInFlight.set(c.table, Math.max(maxInFlight.get(c.table) ?? 0, inFlight.get(c.table) ?? 0));
      await new Promise((r) => setTimeout(r, 5));
      inFlight.set(c.table, (inFlight.get(c.table) ?? 0) - 1);
      return { error: null };
    });

    await processOfflineQueue();

    expect(maxInFlight.get('building_access_rules')).toBe(1);
    const rules = calls.filter((c) => c.table === 'building_access_rules').map((c) => c.data.rules);
    expect(rules).toEqual(['v1', 'v2']);
    expect(await getOfflineQueue()).toHaveLength(0);
  });
});

describe('offline queue — enqueue failure is surfaced (HEALTH-F10 / O5 #2)', () => {
  test('addToOfflineQueue rejects and reports when AsyncStorage.setItem throws', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('SQLITE_FULL'));

    await expect(
      addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r1' } }),
    ).rejects.toThrow('SQLITE_FULL');

    expect(oops).toHaveBeenCalledTimes(1);
    expect(String(oops.mock.calls[0][0])).toContain('rfis');
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('supabaseWrite resolves false (never throws) when the offline enqueue itself fails', async () => {
    installScript(netFail);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('SQLITE_FULL'));

    await expect(supabaseWrite('rfis', 'insert', { id: 'r1' })).resolves.toBe(false);
    expect(oops).toHaveBeenCalledTimes(1);
  });
});

describe('offline queue — emptying it is a locked operation (A2)', () => {
  test('a flush in flight cannot resurrect a queue cleared behind it', async () => {
    // The sign-out race, exactly: flushQueuesBeforeSignOut is bounded by a 20 s
    // ceiling, the wipe runs when the ceiling wins, and the flush is still in
    // its network phase holding a pre-wipe snapshot. Pre-A2 the wipe was an
    // AsyncStorage.multiRemove and the flush's write-back RE-CREATED the key
    // moments later, holding the previous tenant's entries on a shared device.
    //
    // Group 1 fails TRANSIENTLY on purpose. A flush that outlives the 20 s
    // ceiling is a flush on a bad uplink, so its groups come back with entries
    // to KEEP — and a kept entry is what the write-back would carry across the
    // wipe. A version of this test where both groups simply succeed leaves
    // `keptById` empty and proves much less.
    await seed([
      { id: 'g1', table: 'rfis', operation: 'insert', data: { id: 'r1' }, timestamp: 1 },
      { id: 'g2', table: 'rfis', operation: 'insert', data: { id: 'r2' }, timestamp: 2 },
    ]);
    let release!: () => void;
    const parked = new Promise<void>((r) => { release = r; });
    installScript(async (c) => {
      if (c.data.id === 'r1') {
        await parked;                                   // group 1 hangs in "the network"…
        throw new TypeError('Network request failed');  // …and comes back with work to keep
      }
      return { error: null };
    });

    const flush = processOfflineQueue();
    // Let the flush actually get its groups into "the network" before the wipe
    // lands. Without this the clear can beat the flush's own queue read, the
    // flush finds an empty queue, dispatches nothing, and the test proves
    // nothing at all — which is exactly what it did before this line existed.
    await waitFor(() => calls.length === 2);
    await clearOfflineQueue();                          // the wipe wins the ceiling
    release();
    const res = await flush;

    expect(calls.map((c) => c.data.id).sort()).toEqual(['r1', 'r2']);
    // Nothing written back at all — not the kept entry, and not even an empty
    // array. The key must stay REMOVED: a re-created `mageid_offline_queue` on
    // a shared device is the artefact this whole lock discipline exists to
    // prevent, and `[]` is still the previous tenant's key coming back.
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(await getOfflineQueue()).toHaveLength(0);
    expect(res.remaining).toBe(0);
    expect(oops).not.toHaveBeenCalled();                // a kept entry is not a dropped one
  });

  test('clearOfflineQueue empties the key and reports depth 0 to listeners', async () => {
    await seed([{ id: 'a', table: 'rfis', operation: 'insert', data: { id: 'r1' } }]);
    const seen: number[] = [];
    const off = onQueueChanged((depth) => { seen.push(depth); });

    await clearOfflineQueue();
    off();

    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(seen).toEqual([0]);
  });

  test('retainOfflineQueueForUser keeps only entries TAGGED for the arriving user', async () => {
    // AuthContext's marker-less path (BLOCKING 2). An UNTAGGED entry goes too:
    // the last-user marker written moments later would let the next flush adopt
    // it, and on a marker-less install it may be the previous tenant's write.
    await seed([
      { id: 'mine', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_A },
      { id: 'theirs', table: 'rfis', operation: 'insert', data: { id: 'r2' }, userId: USER_B },
      { id: 'legacy', table: 'rfis', operation: 'insert', data: { id: 'r3' }, userId: undefined },
    ]);

    const counts = await retainOfflineQueueForUser(USER_A);

    expect(counts).toEqual({ kept: 1, dropped: 2, readFailed: false });
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['mine']);
  });

  test('retainOfflineQueueForUser removes the key entirely when nothing is the arriving user\'s', async () => {
    await seed([{ id: 'theirs', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_B }]);

    expect(await retainOfflineQueueForUser(USER_A)).toEqual({ kept: 0, dropped: 1, readFailed: false });
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  test('dropUntagged: false keeps the untagged entries and still drops the foreign ones', async () => {
    // A8 (round 5): the caller's assertion that nothing untagged here can be
    // another tenant's — AuthContext's mount backfill on NATIVE, where no
    // session can reach the app without having written the marker. An entry
    // tagged for someone else goes regardless: it could never flush here.
    await seed([
      { id: 'mine', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_A },
      { id: 'theirs', table: 'rfis', operation: 'insert', data: { id: 'r2' }, userId: USER_B },
      { id: 'legacy', table: 'rfis', operation: 'insert', data: { id: 'r3' }, userId: undefined },
    ]);

    const counts = await retainOfflineQueueForUser(USER_A, { dropUntagged: false });

    expect(counts).toEqual({ kept: 2, dropped: 1, readFailed: false });
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['mine', 'legacy']);
  });

  test('the default is unchanged when no options are passed at all', async () => {
    // The two callers differ only by this argument, so the default is the
    // behaviour of the one that does NOT pass it (onNewSessionEstablished).
    const legacy = [{ id: 'legacy', table: 'rfis' as const, operation: 'insert' as const, data: { id: 'r1' }, userId: undefined }];

    await seed(legacy);
    expect(await retainOfflineQueueForUser(USER_A)).toEqual({ kept: 0, dropped: 1, readFailed: false });

    await seed(legacy);
    expect(await retainOfflineQueueForUser(USER_A, {})).toEqual({ kept: 0, dropped: 1, readFailed: false });

    await seed(legacy);
    expect(await retainOfflineQueueForUser(USER_A, { dropUntagged: true })).toEqual({ kept: 0, dropped: 1, readFailed: false });
  });

  test('a queue that cannot be READ reports readFailed and is left exactly as it was', async () => {
    // A8: this used to come back as {kept: 0, dropped: 0} — the same answer as
    // "nothing here was yours" — and AuthContext stamped the last-user marker
    // over a queue nobody had been able to look at, making every untagged entry
    // in it adoptable by the session that had just arrived.
    await seed([
      { id: 'mine', table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_A },
      { id: 'theirs', table: 'rfis', operation: 'insert', data: { id: 'r2' }, userId: USER_B },
    ]);
    const before = await AsyncStorage.getItem(QUEUE_KEY);
    const getItem = AsyncStorage.getItem as unknown as jest.Mock;
    const real = getItem.getMockImplementation()!;
    getItem.mockImplementation(async (key: string) => {
      if (key === QUEUE_KEY) throw new Error('SQLITE_FULL: database or disk is full');
      return real(key);
    });

    let counts;
    try {
      counts = await retainOfflineQueueForUser(USER_A);
    } finally {
      getItem.mockImplementation(real);
    }

    expect(counts).toEqual({ kept: 0, dropped: 0, readFailed: true });
    // Untouched: not narrowed, not removed. USER_B's entry is still there
    // precisely because nothing was proven about it.
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBe(before);
  });

  test('a queue whose JSON is corrupt reads as a failure, not as an empty queue', async () => {
    await AsyncStorage.setItem(QUEUE_KEY, '{not json');

    expect(await retainOfflineQueueForUser(USER_A)).toEqual({ kept: 0, dropped: 0, readFailed: true });
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBe('{not json');
  });
});

describe('offline queue — change listeners', () => {
  test('onQueueChanged fires after an enqueue and after a write-back, with the new depth', async () => {
    const seen: number[] = [];
    const off = onQueueChanged((depth) => { seen.push(depth); });

    await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r1' } });
    await processOfflineQueue();
    off();
    await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r2' } });

    expect(seen).toEqual([1, 0]);
  });
});
