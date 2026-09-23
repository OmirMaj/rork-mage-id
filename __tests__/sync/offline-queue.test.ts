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
  discardQueuedWrites,
  doomWatermark,
  expireDoomedProjectIds,
  getOfflineQueue,
  getOwnOfflineQueue,
  onQueueChanged,
  onQueueDropped,
  processOfflineQueue,
  retainOfflineQueueForUser,
  supabaseWrite,
  supabaseWriteDetailed,
  supabaseRpcDetailed,
  configureAutoDrain,
  takeDoomedProjectIds,
  onProjectDeleteRefused,
  onQueueFlushed,
  type OfflineMutation,
} from '@/utils/offlineQueue';
import {
  discardUnsavedWrite,
  readSyncFailuresOrThrow,
  retryUnsavedWrite,
  unsavedWriteIds,
  countOwnUnsavedRecords,
  unsavedPaymentAppends,
  onUnsavedRetried,
  ownFailures,
} from '@/utils/syncLedger';
import { planProjectsLoad } from '@/utils/projectsLoadGuard';
import { unsavedProjectIdsIn } from '@/utils/projectContextPure';
import { settingsRowWritePending } from '@/utils/settingsLoadGuard';

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

type Call = { table: string; op: 'insert' | 'upsert' | 'update' | 'delete' | 'rpc'; data: Record<string, unknown> };
type PgError = { message: string; code?: string };
type Script = (call: Call) => Promise<{ error: PgError | null; status?: number }>;

const calls: Call[] = [];
let script: Script = async () => ({ error: null });

async function run(call: Call) {
  calls.push(call);
  return script(call);
}

// Wave 4 #122: after a primary-key duplicate the queue re-reads the id as the
// caller. `visible` answers that read; by default every row is visible (the
// SYNC-F4 "already landed" case).
let visible: (table: string, id: string) => boolean = () => true;

// A postgrest-shaped stand-in narrow enough to script per call. The repo mock's
// builder resolves EMPTY for everything; the sync engine needs outcomes.
function installScript(fn: Script) {
  script = fn;
  (supabase as { rpc: unknown }).rpc = jest.fn((fn: string, args: Record<string, unknown>) => run({ table: `rpc:${fn}`, op: 'rpc', data: args }));
  (supabase as { from: unknown }).from = jest.fn((table: string) => ({
    select: () => ({
      eq: async (_col: string, id: string) => ({ data: visible(table, id) ? [{ id }] : [], error: null, status: 200 }),
    }),
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
    ...(e.rpc ? { rpc: e.rpc } : {}),
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

beforeAll(() => {
  // A post-write drain on a 1 s timer would flush the NEXT test's seeded
  // queue; the one test that exercises it turns it back on.
  configureAutoDrain(null);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  calls.length = 0;
  visible = () => true;
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

describe('offline queue — a cap-overflow drop is reported as THIS user\'s (ledger)', () => {
  // WHY THIS EXISTS. A permanently-dropped write is only visible to the field
  // user through utils/syncLedger, which is written from notifyDroppedWrites
  // and read back through `ownFailures` — and ownFailures ignores an UNTAGGED
  // entry, deliberately (no marker fallback: showing the wrong contractor a
  // lost-paperwork warning is worse than showing nobody one).
  //
  // The cap-overflow path used to hand notifyDroppedWrites the RAW queue rows.
  // A legacy untagged entry — one queued before per-entry tagging shipped —
  // was therefore recorded as nobody's and vanished from the red badge, while
  // the SAME entry was being counted in the amber pending total, because the
  // pending count adopts it via the device's last-user marker. The depth ticked
  // down, nothing turned red, and the user's report was gone: the precise
  // failure mode the ledger was built to end.
  test('an untagged legacy entry dropped at the cap is attributed to the session', async () => {
    // 1000 = MAX_QUEUE. Every row untagged, as a pre-tagging queue would be,
    // with the device's last-user marker naming the signed-in user.
    const legacy = Array.from({ length: 1000 }, (_, i) => ({
      id: `legacy-${i}`, timestamp: 1000 + i, retryCount: 0,
      table: 'daily_reports', operation: 'insert' as const, data: { id: `d${i}` },
    }));
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(legacy));
    await AsyncStorage.setItem(LAST_USER_KEY, USER_A);

    const seen: OfflineMutation[] = [];
    const off = onQueueDropped((dropped) => { seen.push(...dropped); });
    await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r1' } });
    off();

    expect(seen.map((m) => m.id)).toEqual(['legacy-0']);
    expect(seen[0].userId).toBe(USER_A);

    // And the count it disappeared from agrees: getOwnOfflineQueue adopts the
    // remaining untagged rows for the same session, so the two paths cannot
    // disagree about who the dropped one belonged to.
    const own = await getOwnOfflineQueue();
    expect(own).toHaveLength(1000);
    expect(own.every((m) => m.userId === USER_A)).toBe(true);
    expect(own.some((m) => m.id === 'legacy-0')).toBe(false);
  });

  test('…but a drop the marker does NOT name stays untagged, and nobody is warned', async () => {
    const legacy = Array.from({ length: 1000 }, (_, i) => ({
      id: `legacy-${i}`, timestamp: 1000 + i, retryCount: 0,
      table: 'daily_reports', operation: 'insert' as const, data: { id: `d${i}` },
    }));
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(legacy));
    await AsyncStorage.setItem(LAST_USER_KEY, USER_B);

    const seen: OfflineMutation[] = [];
    const off = onQueueDropped((dropped) => { seen.push(...dropped); });
    await addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r1' } });
    off();

    expect(seen.map((m) => m.id)).toEqual(['legacy-0']);
    expect(seen[0].userId).toBeUndefined();
    // Same rule on the count side: these are not this session's entries.
    expect(await getOwnOfflineQueue()).toHaveLength(1);
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

// ── Wave 4 (sync-queue lane) ────────────────────────────────────────────────
// #2 transport errors, the ordering guard (#23/#24/#102/#138/#139), the #4
// child backstop, the #1 unsaved-write ledger, #32 numbered creates, the rpc
// op (CONTRACT 1) and the #122 not-visible conflict — each driven through the
// real write path and the real flush.

/** A gate a script can park on until the test releases it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}
const timedOut = async () => ({ error: { message: 'TypeError: Network request timed out', code: '' }, status: 0 });

describe('wave 4 — a request that never got an answer is transient (#2)', () => {
  test("live: postgrest's 'TypeError: Network request timed out' (status 0) is queued, not failed", async () => {
    installScript(timedOut);
    await expect(supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1' })).resolves.toBe('queued');
    const q = await getOfflineQueue();
    expect(q.map((m) => m.data.id)).toEqual(['dr1']);
    expect(oops).not.toHaveBeenCalled();
  });

  test('flush: the same timeout keeps the entry with NO retry spent', async () => {
    await seed([{ table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1' } }]);
    installScript(timedOut);
    await processOfflineQueue();
    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(0);
  });

  test('a gateway 503 is transient; a plain 500 stays on the retry budget', async () => {
    installScript(async () => ({ error: { message: 'upstream unavailable', code: '' }, status: 503 }));
    await expect(supabaseWriteDetailed('warranties', 'insert', { id: 'w1' })).resolves.toBe('queued');
    await AsyncStorage.clear();
    await seed([{ table: 'warranties', operation: 'insert', data: { id: 'w1' } }]);
    installScript(async () => ({ error: { message: 'internal error', code: 'XX000' }, status: 500 }));
    await processOfflineQueue();
    expect((await getOfflineQueue())[0].retryCount).toBe(1);
  });

  test("Postgres 57014 'statement timeout' is the server answering — it spends a retry", async () => {
    await seed([{ table: 'warranties', operation: 'insert', data: { id: 'w1' } }]);
    installScript(async () => ({ error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 }));
    await processOfflineQueue();
    expect((await getOfflineQueue())[0].retryCount).toBe(1);
  });
});

describe('wave 4 — a later write never overtakes an earlier one of the same record', () => {
  test('clock-out after an offline clock-in: the UPDATE queues behind the queued INSERT, nothing is sent', async () => {
    await seed([{ id: 'in', table: 'time_entries', operation: 'insert', data: { id: 't1', status: 'clocked_in' } }]);

    const out = await supabaseWriteDetailed('time_entries', 'update', { id: 't1', status: 'clocked_out' });

    expect(out).toBe('queued');
    expect(calls).toHaveLength(0);
    const q = await getOfflineQueue();
    expect(q.map((m) => m.operation)).toEqual(['insert', 'update']);

    await processOfflineQueue();
    expect(calls.map((c) => `${c.op}:${String(c.data.status)}`)).toEqual(['insert:clocked_in', 'update:clocked_out']);
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('an online edit behind a queued offline EDIT queues too (closed never reverts to answered)', async () => {
    await seed([{ id: 'p1e', table: 'rfis', operation: 'update', data: { id: 'r4', status: 'answered' } }]);
    await expect(supabaseWriteDetailed('rfis', 'update', { id: 'r4', status: 'closed' })).resolves.toBe('queued');
    await processOfflineQueue();
    expect(calls.map((c) => c.data.status)).toEqual(['answered', 'closed']);
  });

  test('a delete behind a queued insert queues (the record does not come back)', async () => {
    await seed([{ table: 'punch_items', operation: 'insert', data: { id: 'pi1', project_id: 'p1' } }]);
    await expect(supabaseWriteDetailed('punch_items', 'delete', { id: 'pi1' })).resolves.toBe('queued');
    expect(calls).toHaveLength(0);
    expect((await getOfflineQueue()).map((m) => m.operation)).toEqual(['insert', 'delete']);
  });

  // Integration round 1: still never SENT — but 'failed', not 'queued'. The
  // round-0 'queued' came from an append that re-read the queue as [] and
  // wrote the whole stored queue back as this one entry.
  // Integration round 2: round 1 made an unreadable queue "hold" every write,
  // so a device whose stored queue could not be read failed EVERY keyed save
  // with perfect signal. Nothing in a queue no one can read can be flushed, so
  // there is nothing to overtake: a queue that stays unreadable is sent past;
  // a one-off read failure is read again and the ordering rule applies.
  test('a queue that stays unreadable is not a queue holding an earlier write — sent, the stored queue untouched', async () => {
    await seed([{ id: 'held', table: 'rfis', operation: 'insert', data: { id: 'r0' } }]);
    const real = (AsyncStorage.getItem as jest.Mock).getMockImplementation();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => {
      if (k === QUEUE_KEY) throw new Error('storage refused');
      return real ? real(k) : null;
    });
    try {
      const out = await supabaseWriteDetailed('rfis', 'update', { id: 'r1', status: 'closed' });
      expect(out).toBe('synced');
      expect(calls.map((c) => c.op)).toEqual(['update']);
    } finally {
      (AsyncStorage.getItem as jest.Mock).mockImplementation(real);
    }
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['held']);
  });

  test('a one-off read failure is read again — an earlier queued write of the record still holds the new one', async () => {
    await seed([{ id: 'held', table: 'rfis', operation: 'insert', data: { id: 'r1' } }]);
    const real = (AsyncStorage.getItem as jest.Mock).getMockImplementation();
    let refused = 0;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => {
      if (k === QUEUE_KEY && refused === 0) { refused += 1; throw new Error('storage hiccup'); }
      return real ? real(k) : null;
    });
    try {
      await expect(supabaseWriteDetailed('rfis', 'update', { id: 'r1', status: 'closed' })).resolves.toBe('queued');
      expect(calls).toHaveLength(0);
    } finally {
      (AsyncStorage.getItem as jest.Mock).mockImplementation(real);
    }
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['held', expect.any(String)]);
  });

  test("another tenant's queued entry for the same id does not hold this user's write", async () => {
    await seed([{ table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: USER_B }]);
    await expect(supabaseWriteDetailed('rfis', 'update', { id: 'r1', status: 'closed' })).resolves.toBe('synced');
    expect(calls.map((c) => c.op)).toEqual(['update']);
  });

  test('a write made while the INSERT is still on the wire waits for it, then follows it into the queue', async () => {
    const g = gate();
    installScript(async (c) => {
      if (c.op === 'insert') { await g.opened; throw new TypeError('Network request failed'); }
      return { error: null };
    });
    const insert = supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1', notes: 'morning' });
    const update = supabaseWriteDetailed('daily_reports', 'update', { id: 'dr1', notes: 'final' });
    await waitFor(() => calls.length === 1);
    expect(calls[0].op).toBe('insert'); // the update has NOT been sent past it
    g.open();
    await expect(insert).resolves.toBe('queued');
    await expect(update).resolves.toBe('queued');
    expect(calls).toHaveLength(1);
    expect((await getOfflineQueue()).map((m) => m.data.notes)).toEqual(['morning', 'final']);
  });

  test("a direct write of a record the flush is sending waits for the flush's write-back", async () => {
    await seed([{ table: 'time_entries', operation: 'insert', data: { id: 't1', status: 'clocked_in' } }]);
    const g = gate();
    installScript(async (c) => {
      if (c.op === 'insert') await g.opened;
      return { error: null };
    });
    const flush = processOfflineQueue();
    await waitFor(() => calls.length === 1);
    const direct = supabaseWriteDetailed('time_entries', 'update', { id: 't1', status: 'clocked_out' });
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(calls).toHaveLength(1); // still parked behind the flush's group
    g.open();
    await flush;
    await expect(direct).resolves.toBe('synced');
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update']);
  });

  test('a direct write that lands while this session still has queued work drains it soon', async () => {
    configureAutoDrain(5);
    try {
      await seed([{ table: 'photos', operation: 'insert', data: { id: 'ph1', project_id: 'p1' } }]);
      await expect(supabaseWriteDetailed('rfis', 'update', { id: 'r9', status: 'closed' })).resolves.toBe('synced');
      await new Promise((r) => setTimeout(r, 40));
      await waitFor(() => calls.some((c) => c.table === 'photos'), 2000);
      expect(await getOfflineQueue()).toHaveLength(0);
    } finally {
      configureAutoDrain(null);
    }
  });
});

describe('wave 4 — a child made with its job waits for the job (#4)', () => {
  test("a child refused by RLS while its job's write fell into the queue is queued behind it", async () => {
    installScript(async (c) => {
      if (c.table === 'projects') throw new TypeError('Network request failed');
      if (c.table === 'invoices') return { error: { message: 'insert or update on table "invoices" violates foreign key constraint "invoices_project_id_fkey"', code: '23503' } };
      return { error: null };
    });
    const job = supabaseWriteDetailed('projects', 'upsert', { id: 'p1', name: 'Sample' });
    const child = supabaseWriteDetailed('invoices', 'insert', { id: 'i1', project_id: 'p1' });
    await expect(job).resolves.toBe('queued');
    await expect(child).resolves.toBe('queued');
    expect(oops).not.toHaveBeenCalled();
    const q = await getOfflineQueue();
    expect(q.map((m) => m.table)).toEqual(['projects', 'invoices']);
    expect(q[1].rlsRetried).toBeFalsy();
  });

  test('the child is sent only after the job write on the wire has settled', async () => {
    const g = gate();
    installScript(async (c) => {
      if (c.table === 'projects') await g.opened;
      return { error: null };
    });
    const job = supabaseWriteDetailed('projects', 'upsert', { id: 'p1' });
    const child = supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1' });
    await waitFor(() => calls.length === 1);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(calls.map((c) => c.table)).toEqual(['projects']);
    g.open();
    await expect(job).resolves.toBe('synced');
    await expect(child).resolves.toBe('synced');
    expect(calls.map((c) => c.table)).toEqual(['projects', 'daily_reports']);
  });

  test('with no job write anywhere, an RLS refusal is a real failure — toasted AND recorded with its row', async () => {
    installScript(rlsFor('punch_items'));
    await expect(supabaseWriteDetailed('punch_items', 'insert', { id: 'pi1', project_id: 'p1', description: 'Loose fixture' })).resolves.toBe('failed');
    expect(oops).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ table: 'punch_items', recordId: 'pi1', operation: 'insert', userId: USER_A });
    expect(ledger[0].row).toMatchObject({ description: 'Loose fixture' });
  });
});

describe('wave 4 — an unsaved write stays on the phone until Retry or Discard (#1)', () => {
  async function failOne(): Promise<string> {
    installScript(pg('null value in column "due_date" of relation "punch_items" violates not-null constraint', '23502'));
    await supabaseWriteDetailed('punch_items', 'insert', { id: 'pi1', project_id: 'p1' });
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    return (await readSyncFailuresOrThrow())[0].id;
  }

  test('unsavedWriteIds names the record the server refused — the loaders keep it', async () => {
    await failOne();
    expect([...(await unsavedWriteIds('punch_items'))]).toEqual(['pi1']);
    expect([...(await unsavedWriteIds('rfis'))]).toEqual([]);
    const [entry] = await readSyncFailuresOrThrow();
    expect(entry.reason).toBe('a required field was missing');
  });

  test("another user's unsaved write is not this session's to keep", async () => {
    await failOne();
    __setSmokeSession(sessionFor(USER_B));
    try {
      expect([...(await unsavedWriteIds('punch_items'))]).toEqual([]);
    } finally {
      __setSmokeSession(sessionFor(USER_A));
    }
  });

  test('Retry resends the row exactly as it was and clears the line when it lands', async () => {
    const id = await failOne();
    calls.length = 0;
    installScript(ok);
    await expect(retryUnsavedWrite(id)).resolves.toBe('synced');
    expect(calls).toEqual([{ table: 'punch_items', op: 'insert', data: { id: 'pi1', project_id: 'p1' } }]);
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
  });

  test('Discard removes the line (and nothing is sent)', async () => {
    const id = await failOne();
    calls.length = 0;
    await expect(discardUnsavedWrite(id)).resolves.toBe(1);
    expect(calls).toHaveLength(0);
    expect(await unsavedWriteIds('punch_items')).toEqual(new Set());
  });

  test('a flush drop is recorded with its row, so it can be retried too', async () => {
    await seed([{ id: 'm-drop', table: 'daily_reports', operation: 'insert', data: { id: 'dr7', project_id: 'p1', notes: 'x' } }]);
    installScript(pg('new row for relation "daily_reports" violates check constraint "x"', '23514'));
    await processOfflineQueue();
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    const [entry] = await readSyncFailuresOrThrow();
    expect(entry).toMatchObject({ id: 'm-drop', table: 'daily_reports', recordId: 'dr7', operation: 'insert' });
    expect(entry.row).toMatchObject({ notes: 'x' });
  });
});

describe('wave 4 — RFIs and submittals are created in the order he made them (#32)', () => {
  test('the flush sends one project\'s RFI creates one at a time, oldest first', async () => {
    await seed([
      { table: 'rfis', operation: 'insert', data: { id: 'a', project_id: 'p1' }, timestamp: 1 },
      { table: 'rfis', operation: 'insert', data: { id: 'b', project_id: 'p1' }, timestamp: 2 },
      { table: 'rfis', operation: 'insert', data: { id: 'c', project_id: 'p1' }, timestamp: 3 },
    ]);
    let live = 0, peak = 0;
    installScript(async () => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 3));
      live--;
      return { error: null };
    });
    await processOfflineQueue();
    expect(peak).toBe(1);
    expect(calls.map((c) => c.data.id)).toEqual(['a', 'b', 'c']);
  });

  test('once one create stays queued, the later creates of that project wait with it', async () => {
    await seed([
      { table: 'submittals', operation: 'insert', data: { id: 'a', project_id: 'p1' }, timestamp: 1 },
      { table: 'submittals', operation: 'insert', data: { id: 'b', project_id: 'p1' }, timestamp: 2 },
    ]);
    installScript(netFail);
    await processOfflineQueue();
    expect(calls.map((c) => c.data.id)).toEqual(['a']);
    expect(await getOfflineQueue()).toHaveLength(2);
  });

  test('live: a create behind a queued create of the same project queues instead of taking a lower number', async () => {
    await seed([{ table: 'rfis', operation: 'insert', data: { id: 'a', project_id: 'p1' } }]);
    await expect(supabaseWriteDetailed('rfis', 'insert', { id: 'b', project_id: 'p1' })).resolves.toBe('queued');
    expect(calls).toHaveLength(0);
  });
});

describe('wave 4 — record-scoped rpc (CONTRACT 1)', () => {
  test('a payment append behind a queued invoice INSERT queues and replays after it, in one group', async () => {
    await seed([{ table: 'invoices', operation: 'insert', data: { id: 'inv1', project_id: 'p1' } }]);
    const out = await supabaseRpcDetailed('invoices', 'inv1', 'invoice_append_payment', { p_invoice_id: 'inv1', p_entry: { amount: 100 } });
    expect(out).toBe('queued');
    const q = await getOfflineQueue();
    expect(q[1]).toMatchObject({ table: 'invoices', operation: 'rpc', data: { id: 'inv1' }, rpc: { fn: 'invoice_append_payment' } });

    await processOfflineQueue();
    expect(calls.map((c) => c.op)).toEqual(['insert', 'rpc']);
    expect(calls[1]).toMatchObject({ table: 'rpc:invoice_append_payment', data: { p_invoice_id: 'inv1' } });
    expect(await getOfflineQueue()).toHaveLength(0);
  });

  test('an invoice UPDATE never overtakes a queued payment append', async () => {
    await seed([{ table: 'invoices', operation: 'rpc', data: { id: 'inv1' }, rpc: { fn: 'invoice_append_payment', args: {} } }]);
    await expect(supabaseWriteDetailed('invoices', 'update', { id: 'inv1', status: 'paid' })).resolves.toBe('queued');
    expect(calls).toHaveLength(0);
  });

  test('a transient rpc failure is queued; a 42501 under a live bearer is dropped and reported', async () => {
    installScript(timedOut);
    await expect(supabaseRpcDetailed('invoices', 'inv1', 'invoice_append_payment', {})).resolves.toBe('queued');
    installScript(pg('not_invoice_owner', '42501'));
    await processOfflineQueue();
    expect(await getOfflineQueue()).toHaveLength(0);
    expect(oops).toHaveBeenCalledTimes(1);
  });

  // Integration round 1: the invoice screen owns a refused payment append (it
  // takes the entry back and says "nothing was recorded"). A Not-saved line
  // as well would offer a Retry that appends the same check a second time.
  test('a refused append the caller owns is neither ledgered nor toasted; without the option it is both', async () => {
    installScript(pg('invoice_not_found', 'P0002'));
    await expect(supabaseRpcDetailed('invoices', 'inv1', 'invoice_append_payment', { p_invoice_id: 'inv1', p_entry: { id: 'pay1' } }, { callerOwnsRefusal: true }))
      .resolves.toBe('failed');
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect(oops).not.toHaveBeenCalled();
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
    expect(await unsavedWriteIds('invoices')).toEqual(new Set());

    await expect(supabaseRpcDetailed('invoices', 'inv1', 'invoice_append_payment', { p_invoice_id: 'inv1', p_entry: { id: 'pay2' } }))
      .resolves.toBe('failed');
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(oops).toHaveBeenCalledTimes(1);
    expect(await readSyncFailuresOrThrow()).toHaveLength(1);
  });
});

describe('wave 4 — a duplicate id he cannot see is a conflict, not "already landed" (#122)', () => {
  test('flush: a _pkey 23505 on a row invisible to him is dropped as not_visible_conflict with its dependents', async () => {
    await seed([
      { id: 'ins', table: 'safety_incidents', operation: 'insert', data: { id: 'case1', project_id: 'p1' }, timestamp: 1 },
      { id: 'upd', table: 'safety_incidents', operation: 'update', data: { id: 'case1', days_away: 3 }, timestamp: 2 },
    ]);
    visible = () => false;
    installScript(pg('duplicate key value violates unique constraint "safety_incidents_pkey"', '23505'));
    const res = await processOfflineQueue();
    expect(calls.map((c) => c.op)).toEqual(['insert']); // the update is never sent onto someone else's row
    expect(res.failed).toBe(2);
    expect(await getOfflineQueue()).toHaveLength(0);
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger.map((f) => f.reason)).toEqual(['not_visible_conflict', 'not_visible_conflict']);
  });

  test('live: the same collision reports failed, never synced', async () => {
    visible = () => false;
    installScript(pg('duplicate key value violates unique constraint "safety_incidents_pkey"', '23505'));
    await expect(supabaseWriteDetailed('safety_incidents', 'insert', { id: 'case1', project_id: 'p1' })).resolves.toBe('failed');
  });

  test('live: a visible duplicate (a re-send of a timed-out insert) is success', async () => {
    installScript(pg('duplicate key value violates unique constraint "daily_reports_pkey"', '23505'));
    await expect(supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1' })).resolves.toBe('synced');
  });

  test('outside the author-scoped safety tables the old rule stands: a hidden _pkey duplicate is his landed re-send', async () => {
    // portal_messages admits client-authored inserts its SELECT never shows
    // back; a re-read there would call a real landing a conflict.
    visible = () => false;
    installScript(pg('duplicate key value violates unique constraint "portal_messages_pkey"', '23505'));
    await expect(supabaseWriteDetailed('portal_messages', 'insert', { id: 'pm1', portal_id: 'x' })).resolves.toBe('synced');
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration round 1 (data-sync lens). Each case is a replay the critic ran
// against the round-0 code, where it lost data.
describe('integration round 1 — nothing overtakes an unsaved write of the same record', () => {
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  const stmtTimeout = pg('canceling statement due to statement timeout', '57014');

  test('an edit of a record whose INSERT was refused is parked, never sent as a 0-row update; Retry sends the insert WITH the edit', async () => {
    installScript(stmtTimeout);
    await expect(supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1', notes: 'morning draft' })).resolves.toBe('failed');
    calls.length = 0;
    oops.mockClear();
    installScript(ok);
    await expect(supabaseWriteDetailed('daily_reports', 'update', { id: 'dr1', notes: 'final — crane delivery 2pm' })).resolves.toBe('failed');
    expect(calls).toHaveLength(0); // round 0: a 0-row UPDATE reported 'synced'
    expect(String(oops.mock.calls[0]?.[0])).toContain('Not sent yet (Daily report)');
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger).toHaveLength(1); // folded into the parked insert
    expect(ledger[0]).toMatchObject({ operation: 'insert', recordId: 'dr1', reason: 'the server refused it' });
    expect([...(await unsavedWriteIds('daily_reports'))]).toEqual(['dr1']);

    await expect(retryUnsavedWrite(ledger[0].id)).resolves.toBe('synced');
    expect(calls).toEqual([{ table: 'daily_reports', op: 'insert', data: { id: 'dr1', project_id: 'p1', notes: 'final — crane delivery 2pm' } }]);
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
  });

  test('a delete behind a refused insert is appended; Retry replays insert then delete, oldest first', async () => {
    installScript(stmtTimeout);
    await supabaseWriteDetailed('punch_items', 'insert', { id: 'pi9', project_id: 'p1' });
    installScript(ok);
    calls.length = 0;
    await expect(supabaseWriteDetailed('punch_items', 'delete', { id: 'pi9' })).resolves.toBe('failed');
    expect(calls).toHaveLength(0);
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger.map((f) => f.operation).sort()).toEqual(['delete', 'insert']);
    await expect(retryUnsavedWrite(ledger[0].id)).resolves.toBe('synced');
    expect(calls.map((c) => c.op)).toEqual(['insert', 'delete']);
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
  });

  test('the flush parks a queued write of a record whose earlier write is unsaved — it is not sent', async () => {
    installScript(stmtTimeout);
    await supabaseWriteDetailed('change_orders', 'insert', { id: 'co1', project_id: 'p1', amount: 5000 });
    await seed([{ id: 'late', table: 'change_orders', operation: 'update', data: { id: 'co1', amount: 7500 }, timestamp: Date.now() + 5 }]);
    installScript(ok);
    calls.length = 0;
    const res = await processOfflineQueue();
    expect(calls).toHaveLength(0);
    expect(res.failed).toBe(1);
    expect(await getOfflineQueue()).toHaveLength(0);
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].row).toMatchObject({ id: 'co1', amount: 7500, project_id: 'p1' });
  });

  test('a line leaves the ledger only after its resend lands; a refused Retry keeps the ONE line it had', async () => {
    installScript(stmtTimeout);
    await supabaseWriteDetailed('rfis', 'insert', { id: 'r1', project_id: 'p1' });
    const [line] = await readSyncFailuresOrThrow();
    let release!: (v: { error: PgError | null }) => void;
    installScript(() => new Promise((r) => { release = r; }));
    const retry = retryUnsavedWrite(line.id);
    await waitFor(() => typeof release === 'function' && calls.length > 0, 2000);
    // Mid-resend a list read must still keep the row (round 0 removed it first).
    expect([...(await unsavedWriteIds('rfis'))]).toEqual(['r1']);
    release({ error: { message: 'canceling statement due to statement timeout', code: '57014' } });
    await expect(retry).resolves.toBe('failed');
    const after = await readSyncFailuresOrThrow();
    expect(after.map((f) => f.id)).toEqual([line.id]);
  });

  test('a payment append the caller owns, on an invoice with an unsaved write, fails without sending or adding a line', async () => {
    installScript(stmtTimeout);
    await supabaseWriteDetailed('invoices', 'update', { id: 'inv1', notes: 'x' });
    installScript(ok);
    calls.length = 0;
    await expect(supabaseRpcDetailed('invoices', 'inv1', 'invoice_append_payment', { p_invoice_id: 'inv1', p_entry: { id: 'pay1', amount: 5000 } }, { callerOwnsRefusal: true }))
      .resolves.toBe('failed');
    expect(calls).toHaveLength(0);
    expect(await readSyncFailuresOrThrow()).toHaveLength(1);
  });

  test('a queued append the flush drops is labelled with its amount, and the invoice screen can see it waiting', async () => {
    await seed([{ id: 'ap', table: 'invoices', operation: 'rpc', data: { id: 'inv2' }, rpc: { fn: 'invoice_append_payment', args: { p_invoice_id: 'inv2', p_entry: { id: 'pay-A', amount: 5000 } } } }]);
    installScript(pg('not_invoice_owner', '42501'));
    await processOfflineQueue();
    await settle();
    const [entry] = await readSyncFailuresOrThrow();
    expect(entry.label).toBe('Invoice payment of $5,000.00');
    expect(await unsavedPaymentAppends('inv2')).toEqual([5000]);
    expect(await countOwnUnsavedRecords()).toBe(1);
  });
});

describe('integration round 1 — a write is tagged for the account that MADE it', () => {
  test('a request in flight across a sign-out and another sign-in is never queued as the new user', async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    installScript(() => new Promise((r) => { release = r; }));
    const out = supabaseWriteDetailed('punch_items', 'update', { id: 'pi1', title: 'A' });
    await waitFor(() => typeof release === 'function' && calls.length > 0, 2000);
    __setSmokeSession(sessionFor(USER_B));
    Sentry.captureMessage.mockClear();
    release({ error: { message: 'TypeError: Network request timed out' }, status: 0 });
    // Integration round 3: with B signed in, A's write is dropped (Sentry
    // note) instead of sitting in the queue for B's whole session.
    await expect(out).resolves.toBe('failed');
    expect(await getOfflineQueue()).toHaveLength(0);
    expect(await getOwnOfflineQueue()).toHaveLength(0); // never B's to flush
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  test('…while NO ONE is signed in, it is still queued for its writer', async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    installScript(() => new Promise((r) => { release = r; }));
    const out = supabaseWriteDetailed('punch_items', 'update', { id: 'pi1', title: 'A' });
    await waitFor(() => typeof release === 'function' && calls.length > 0, 2000);
    __setSmokeSession(null);
    release({ error: { message: 'TypeError: Network request timed out' }, status: 0 });
    await expect(out).resolves.toBe('queued');
    expect((await getOfflineQueue()).map((m) => m.userId)).toEqual([USER_A]);
  });

  test("a refusal that lands after B signed in is recorded nowhere in B's session — no line, no toast, a Sentry note", async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    installScript(() => new Promise((r) => { release = r; }));
    const out = supabaseWriteDetailed('daily_reports', 'update', { id: 'dr2', notes: "A's report text" });
    await waitFor(() => typeof release === 'function' && calls.length > 0, 2000);
    __setSmokeSession(sessionFor(USER_B));
    oops.mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
    release({ error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 });
    await expect(out).resolves.toBe('failed');
    // Wave-4 final fix: round 3 wrote A's whole row (the report text) into
    // B's session storage as A's line. Same rule as the transient path.
    expect(await readSyncFailuresOrThrow()).toEqual([]);
    expect(JSON.stringify(await readSyncFailuresOrThrow())).not.toContain("A's report text");
    expect(await unsavedWriteIds('daily_reports')).toEqual(new Set());
    expect(oops).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  test("…while NO ONE is signed in, the refusal is still A's line, for A's next session", async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    installScript(() => new Promise((r) => { release = r; }));
    const out = supabaseWriteDetailed('daily_reports', 'update', { id: 'dr3', notes: "A's report text" });
    await waitFor(() => typeof release === 'function' && calls.length > 0, 2000);
    __setSmokeSession(null);
    oops.mockClear();
    release({ error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 });
    await expect(out).resolves.toBe('failed');
    expect((await readSyncFailuresOrThrow()).map((f) => f.userId)).toEqual([USER_A]);
    expect(oops).not.toHaveBeenCalled();
  });
});

describe('integration round 1 — the queue is never rebuilt from an unreadable read', () => {
  test('an enqueue while the stored queue cannot be read fails instead of overwriting it', async () => {
    await seed([
      { id: 'keep1', table: 'rfis', operation: 'insert', data: { id: 'r1' } },
      { id: 'keep2', table: 'rfis', operation: 'insert', data: { id: 'r2' } },
    ]);
    const real = (AsyncStorage.getItem as jest.Mock).getMockImplementation();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === QUEUE_KEY) throw new Error('CursorWindow: row too big');
      return real ? real(key) : null;
    });
    try {
      await expect(addToOfflineQueue({ table: 'rfis', operation: 'insert', data: { id: 'r3' } })).rejects.toThrow('CursorWindow');
    } finally {
      if (real) (AsyncStorage.getItem as jest.Mock).mockImplementation(real);
    }
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['keep1', 'keep2']);
  });

  test('an operation this build does not know is kept, not counted as sent and dropped', async () => {
    await seed([{ id: 'future', table: 'invoices', operation: 'frobnicate' as OfflineMutation['operation'], data: { id: 'inv1' } }]);
    const res = await processOfflineQueue();
    expect(calls).toHaveLength(0);
    expect(res.processed).toBe(0);
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['future']);
  });

  test('writes swept for a job he left are recorded as notes — no Retry, the row is not kept', async () => {
    await seed([{ id: 'gone', table: 'daily_reports', operation: 'update', data: { id: 'dr5', project_id: 'p-left' } }]);
    await expect(discardQueuedWrites((m) => (m.data?.project_id === 'p-left' ? 'You left Henderson Remodel' : null))).resolves.toBe(1);
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    const [note] = await readSyncFailuresOrThrow();
    expect(note).toMatchObject({ id: 'gone', reason: 'You left Henderson Remodel' });
    expect(note.row).toBeUndefined();
    expect(note.table).toBeUndefined();
    expect(await unsavedWriteIds('daily_reports')).toEqual(new Set());
    expect(await countOwnUnsavedRecords()).toBe(0);
  });
});

describe('integration round 2 — a dropped write is in the queue or the ledger at every instant', () => {
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  const CHECK = { error: { message: 'new row for relation "daily_reports" violates check constraint "daily_reports_weather_check"', code: '23514' }, status: 400 };

  test('mid-flush, a group just dropped is already under Not saved: an edit then is parked, and Retry sends the INSERT with it', async () => {
    await seed([
      { id: 'q1', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p1', notes: 'morning draft' } },
      { id: 'q2', table: 'daily_reports', operation: 'insert', data: { id: 'dr2', project_id: 'p1', notes: 'other report' } },
    ]);
    let open!: () => void;
    const slow = new Promise<void>((r) => { open = r; });
    installScript(async (c) => {
      if (c.data.id === 'dr2') await slow;
      return c.op === 'insert' && c.data.id === 'dr1' ? CHECK : { error: null, status: 201 };
    });
    const flush = processOfflineQueue();
    await waitFor(() => calls.some((c) => c.data.id === 'dr2'), 2000);
    await settle();
    // dr1's group has written back; its line must already exist (round 1
    // wrote it only after every tier finished, and did not wait for it).
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['q2']);
    expect([...(await unsavedWriteIds('daily_reports'))]).toEqual(['dr1']);
    calls.length = 0;
    await expect(supabaseWriteDetailed('daily_reports', 'update', { id: 'dr1', notes: 'final — crane delivery 2pm' })).resolves.toBe('failed');
    expect(calls).toHaveLength(0); // round 1: a 0-row UPDATE that said 'synced'
    open();
    await flush;
    await settle();
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger).toHaveLength(1);
    installScript(ok);
    calls.length = 0;
    await expect(retryUnsavedWrite(ledger[0].id)).resolves.toBe('synced');
    expect(calls).toEqual([{ table: 'daily_reports', op: 'insert', data: { id: 'dr1', project_id: 'p1', notes: 'final — crane delivery 2pm' } }]);
  });

  test('the flush toast is still ONE per flush, and the lines are not written twice', async () => {
    await seed([
      { id: 'a', table: 'punch_items', operation: 'insert', data: { id: 'x1', project_id: 'p1' } },
      { id: 'b', table: 'punch_items', operation: 'insert', data: { id: 'x2', project_id: 'p1' } },
    ]);
    installScript(pg('new row violates check constraint "punch_items_status_check"', '23514'));
    await processOfflineQueue();
    await settle();
    expect(oops).toHaveBeenCalledTimes(1);
    expect((await readSyncFailuresOrThrow()).map((f) => f.id).sort()).toEqual(['a', 'b']);
  });
});

describe('integration round 2 — the writer is taken when the write is MADE, not after its waits', () => {
  test("A's second edit, waiting on the record's slot across A → B, is never sent under B — nor left queued in B's session", async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    let n = 0;
    installScript(() => { n += 1; return n === 1 ? new Promise((r) => { release = r; }) : Promise.resolve({ error: null, status: 204 }); });
    const w1 = supabaseWriteDetailed('punch_items', 'update', { id: 'p1', description: 'A first edit' });
    const w2 = supabaseWriteDetailed('punch_items', 'update', { id: 'p1', description: "A's second edit" });
    await waitFor(() => typeof release === 'function', 2000);
    __setSmokeSession(null);
    __setSmokeSession(sessionFor(USER_B));
    oops.mockClear();
    release({ error: { message: 'TypeError: Network request timed out' }, status: 0 });
    // Integration round 3: B is signed in — A's writes are dropped (the
    // switch already dropped A's other queued entries), not queued for B's
    // whole session where the loaders' queued-id reads would pin A's edit.
    await expect(w1).resolves.toBe('failed');
    await expect(w2).resolves.toBe('failed');
    expect(calls.map((c) => c.data.description)).toEqual(['A first edit']); // round 1: sent again under B
    expect(await getOfflineQueue()).toHaveLength(0);
    expect(await getOwnOfflineQueue()).toHaveLength(0);
    expect(oops).not.toHaveBeenCalled();
  });

  test("…and across a plain sign-out (no one live) A's waiting edit is queued as A's", async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    let n = 0;
    installScript(() => { n += 1; return n === 1 ? new Promise((r) => { release = r; }) : Promise.resolve({ error: null, status: 204 }); });
    const w1 = supabaseWriteDetailed('punch_items', 'update', { id: 'p1', description: 'A first edit' });
    const w2 = supabaseWriteDetailed('punch_items', 'update', { id: 'p1', description: "A's second edit" });
    await waitFor(() => typeof release === 'function', 2000);
    __setSmokeSession(null);
    release({ error: { message: 'TypeError: Network request timed out' }, status: 0 });
    await expect(w1).resolves.toBe('queued');
    await expect(w2).resolves.toBe('queued');
    const q = await getOfflineQueue();
    expect(q.map((m) => [m.userId, m.data.description])).toEqual([[USER_A, 'A first edit'], [USER_A, "A's second edit"]]);
  });

  test("…so a refusal can never put A's row into B's Not-saved ledger", async () => {
    let release!: (v: { error: PgError | null; status?: number }) => void;
    let n = 0;
    installScript(() => {
      n += 1;
      return n === 1 ? new Promise((r) => { release = r; }) : Promise.resolve({ error: { message: 'new row violates row-level security policy for table "punch_items"', code: '42501' }, status: 403 });
    });
    const w1 = supabaseWriteDetailed('punch_items', 'update', { id: 'p2', description: 'A first edit' });
    const w2 = supabaseWriteDetailed('punch_items', 'update', { id: 'p2', description: "A's private note" });
    await waitFor(() => typeof release === 'function', 2000);
    __setSmokeSession(null);
    __setSmokeSession(sessionFor(USER_B));
    release({ error: { message: 'TypeError: Network request timed out' }, status: 0 });
    await w1;
    await w2;
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger.filter((f) => f.userId === USER_B)).toEqual([]);
    expect((await unsavedWriteIds('punch_items')).has('p2')).toBe(false);
  });
});

describe('integration round 2 — rows keyed on project_id are one record in the ledger too', () => {
  test('a refused project_financials upsert parks the next one; Retry sends the NEWEST budget, never the stale one over it', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await expect(supabaseWriteDetailed('project_financials', 'upsert', { project_id: 'p1', user_id: USER_A, target_budget: 100000 })).resolves.toBe('failed');
    const [line] = await readSyncFailuresOrThrow();
    expect(line).toMatchObject({ recordId: 'p1', label: 'Project budget & terms' });
    installScript(ok);
    calls.length = 0;
    await expect(supabaseWriteDetailed('project_financials', 'upsert', { project_id: 'p1', user_id: USER_A, target_budget: 150000 })).resolves.toBe('failed');
    expect(calls).toHaveLength(0); // round 1: sent, then Retry landed 100000 over it
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('synced');
    expect(calls.map((c) => c.data.target_budget)).toEqual([150000]);
  });

  test('the flush parks a queued project_financials write behind its unsaved one', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await supabaseWriteDetailed('project_financials', 'upsert', { project_id: 'p1', target_budget: 1 });
    await seed([{ id: 'pf2', table: 'project_financials', operation: 'upsert', data: { project_id: 'p1', target_budget: 2 }, timestamp: Date.now() + 5 }]);
    installScript(ok);
    calls.length = 0;
    await processOfflineQueue();
    expect(calls).toHaveLength(0);
    expect(await getOfflineQueue()).toHaveLength(0);
  });
});

describe('integration round 2 — an unreadable queue does not stop every save', () => {
  const corrupt = () => AsyncStorage.setItem(QUEUE_KEY, '[{"id":"x"');

  test('with the stored queue corrupt, a save with signal is sent directly', async () => {
    await corrupt();
    await expect(supabaseWriteDetailed('daily_reports', 'update', { id: 'dr1', notes: 'crane 2pm' })).resolves.toBe('synced');
    expect(calls.map((c) => c.op)).toEqual(['update']);
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
  });

  test('a Retry whose resend cannot be queued keeps its ONE line — no second line per tap', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await supabaseWriteDetailed('daily_reports', 'update', { id: 'dr1', notes: 'crane 2pm' });
    const [line] = await readSyncFailuresOrThrow();
    await corrupt();
    installScript(netFail);
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('failed');
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('failed');
    expect((await readSyncFailuresOrThrow()).map((f) => f.id)).toEqual([line.id]);
  });
});

describe('integration round 3 — a record is keyed on its own table\'s primary key', () => {
  const notice = (portal: string, body: string) => ({ portal_id: portal, project_id: 'p1', author_type: 'gc', body, created_at: new Date().toISOString() });

  test('two id-less portal notices of one job are two records: a refused one holds nothing behind it, and Discard takes only itself', async () => {
    installScript(async (c) => (c.data.portal_id === 'portal-OLD'
      ? { error: { message: 'new row violates row-level security policy for table "portal_messages"', code: '42501' }, status: 403 }
      : { error: null, status: 201 }));
    await expect(supabaseWriteDetailed('portal_messages', 'insert', notice('portal-OLD', 'New daily report'))).resolves.toBe('failed');
    await expect(supabaseWriteDetailed('portal_messages', 'insert', notice('portal-NEW', 'New invoice'))).resolves.toBe('synced');
    await expect(supabaseWriteDetailed('portal_messages', 'insert', notice('portal-NEW', '3 new updates'))).resolves.toBe('synced');
    const ledger = await readSyncFailuresOrThrow();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].recordId).toBeUndefined(); // no key → nothing parks behind it
    await expect(discardUnsavedWrite(ledger[0].id)).resolves.toBe(1);
  });

  test('two sub portals of one job are two records: the plumber\'s page is sent, never folded over the electrician\'s refused one', async () => {
    let first = true;
    installScript(async () => {
      if (first) { first = false; return { error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 }; }
      return { error: null, status: 201 };
    });
    const snap = (sub: string, v: string) => ({ sub_portal_id: sub, project_id: 'p1', snapshot: { v }, updated_at: new Date().toISOString() });
    await expect(supabaseWriteDetailed('sub_portal_snapshots', 'upsert', snap('sub-electrician', 'electrician'))).resolves.toBe('failed');
    await expect(supabaseWriteDetailed('sub_portal_snapshots', 'upsert', snap('sub-plumber', 'plumber'))).resolves.toBe('synced');
    const [line] = await readSyncFailuresOrThrow();
    expect(line).toMatchObject({ recordId: 'sub-electrician', label: 'Sub portal page' });
    expect(line.row?.sub_portal_id).toBe('sub-electrician');
    calls.length = 0;
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('synced');
    expect(calls.map((c) => c.data.sub_portal_id)).toEqual(['sub-electrician']);
  });

  test('the flush groups by the same key: a stuck sub portal page does not hold another sub\'s page of the job', async () => {
    await seed([
      { id: 's1', table: 'sub_portal_snapshots', operation: 'upsert', data: { sub_portal_id: 'sub-e', project_id: 'p1', snapshot: {} } },
      { id: 's2', table: 'sub_portal_snapshots', operation: 'upsert', data: { sub_portal_id: 'sub-p', project_id: 'p1', snapshot: {} } },
    ]);
    installScript(async (c) => (c.data.sub_portal_id === 'sub-e' ? netFail() : { error: null, status: 201 }));
    await processOfflineQueue();
    expect((await getOfflineQueue()).map((m) => m.id)).toEqual(['s1']);
    expect(calls.map((c) => c.data.sub_portal_id).sort()).toEqual(['sub-e', 'sub-p']);
  });
});

describe('integration round 3 — a job under Not saved is kept whole by the projects load', () => {
  test('refused budget 150k → the re-read keeps 150k → the next sync folds 150k → Retry lands 150k', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    const fin = (budget: number) => ({ project_id: 'p1', user_id: USER_A, target_budget: budget });
    await expect(supabaseWriteDetailed('project_financials', 'upsert', fin(150000))).resolves.toBe('failed');
    // The loader's pending set: the queue (empty), then the ledger.
    const pending = unsavedProjectIdsIn(ownFailures(await readSyncFailuresOrThrow(), USER_A), new Set());
    expect(pending.has('p1')).toBe(true);
    const plan = planProjectsLoad([{ id: 'p1', targetBudget: 100000 }], [{ id: 'p1', targetBudget: 150000 }], { seq: 0, byId: new Map() } as never, 0, { pending });
    expect(plan.projects[0].targetBudget).toBe(150000); // round 2: 100000 — the server's stale row
    installScript(ok);
    calls.length = 0;
    await expect(supabaseWriteDetailed('project_financials', 'upsert', fin(plan.projects[0].targetBudget))).resolves.toBe('failed'); // parked
    const [line] = await readSyncFailuresOrThrow();
    expect(line.row?.target_budget).toBe(150000);
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('synced');
    expect(calls.map((c) => c.data.target_budget)).toEqual([150000]);
  });

  test('a projects id named only for a refused rpc does not pin the row; a queued write of it does', () => {
    const own = [{ kind: 'write', table: 'projects', recordId: 'p2', operation: 'rpc' }];
    expect(unsavedProjectIdsIn(own, new Set()).has('p2')).toBe(false);
    expect(unsavedProjectIdsIn(own, new Set(['p2'])).has('p2')).toBe(true);
  });
});

describe('integration round 3 — a Retry that lands tells its listeners', () => {
  test('a flush-refused payment append, then a Retry that lands: the listener hears the invoices line', async () => {
    await seed([{ id: 'q-e1', table: 'invoices', operation: 'rpc', data: { id: 'inv1' }, rpc: { fn: 'invoice_append_payment', args: { p_invoice_id: 'inv1', p_entry: { id: 'e1', amount: 5000 } } } }]);
    let refuse = true;
    installScript(async () => (refuse
      ? { error: { message: 'permission denied for function invoice_append_payment', code: '42501' }, status: 403 }
      : { error: null, status: 200 }));
    await processOfflineQueue();
    const [line] = await readSyncFailuresOrThrow();
    expect(line.label).toBe('Invoice payment of $5,000.00');
    const heard: string[][] = [];
    const off = onUnsavedRetried((sent, outcome) => { heard.push([outcome, ...sent.map((f) => `${f.table}:${f.recordId}`)]); });
    refuse = false;
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('synced');
    off();
    expect(heard).toEqual([['synced', 'invoices:inv1']]); // round 2: nothing — the invoice stayed unpaid on the phone
  });

  test('a Retry refused again tells no one', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await supabaseWriteDetailed('daily_reports', 'update', { id: 'dr9', notes: 'x' });
    const [line] = await readSyncFailuresOrThrow();
    const heard: unknown[] = [];
    const off = onUnsavedRetried((sent) => { heard.push(sent); });
    await expect(retryUnsavedWrite(line.id)).resolves.toBe('failed');
    off();
    expect(heard).toEqual([]);
  });
});

describe('integration round 3 — the profile row: one refused save does not hold every later profile write', () => {
  const settingsRow = (tax: number) => ({ id: USER_A, location: 'Texas', tax_rate: tax });

  test('a push-token write passes a refused settings save; a later settings write still parks behind it', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await expect(supabaseWriteDetailed('profiles', 'update', settingsRow(8.25))).resolves.toBe('failed');
    const [line] = await readSyncFailuresOrThrow();
    expect(line.label).toBe('Profile & settings');
    installScript(ok);
    calls.length = 0;
    oops.mockClear();
    await expect(supabaseWriteDetailed('profiles', 'update', { id: USER_A, push_token: 'ExponentPushToken[x]' })).resolves.toBe('synced');
    expect(calls.map((c) => c.data.push_token)).toEqual(['ExponentPushToken[x]']);
    expect(oops).not.toHaveBeenCalled();
    await expect(supabaseWriteDetailed('profiles', 'update', settingsRow(9))).resolves.toBe('failed'); // shares tax_rate → parked
    expect(calls).toHaveLength(1);
    const lines = await readSyncFailuresOrThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0].row?.tax_rate).toBe(9); // folded: Retry lands his newest
  });

  test('the flush sends a queued push token past the unsaved settings line and parks a queued settings edit', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await supabaseWriteDetailed('profiles', 'update', settingsRow(8.25));
    await seed([
      { id: 'pt', table: 'profiles', operation: 'update', data: { id: USER_A, push_token: 'tok' }, timestamp: Date.now() + 5 },
      { id: 'st', table: 'profiles', operation: 'update', data: { id: USER_A, location: 'Ohio' }, timestamp: Date.now() + 6 },
    ]);
    installScript(ok);
    calls.length = 0;
    await processOfflineQueue();
    expect(calls.map((c) => Object.keys(c.data).sort().join(','))).toEqual(['id,push_token']);
    expect(await getOfflineQueue()).toHaveLength(0);
    const lines = await readSyncFailuresOrThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0].row).toMatchObject({ location: 'Ohio', tax_rate: 8.25 });
  });

  test('outside profiles the plain rule stands: a disjoint column edit of a refused record still parks', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await supabaseWriteDetailed('change_orders', 'update', { id: 'co1', status: 'approved' });
    installScript(ok);
    calls.length = 0;
    await expect(supabaseWriteDetailed('change_orders', 'update', { id: 'co1', description: 'x' })).resolves.toBe('failed');
    expect(calls).toHaveLength(0);
  });

  test('the settings load keeps the device copy while a settings save is under Not saved (not for a push-token line)', async () => {
    installScript(pg('canceling statement due to statement timeout', '57014'));
    await supabaseWriteDetailed('profiles', 'update', settingsRow(8.25));
    const asEntries = (await readSyncFailuresOrThrow()).map((f) => ({ table: f.table!, operation: f.operation!, data: f.row! }));
    expect(settingsRowWritePending(asEntries, USER_A)).toBe(true);
    expect(settingsRowWritePending([{ table: 'profiles', operation: 'update', data: { id: USER_A, push_token: 't' } }], USER_A)).toBe(false);
  });
});

// ── Wave 5 (w5-join-core) — the refusals the server now answers by name ─────
// CONTRACT 21: a NEW project past the free plan's one is refused 23514 with
// 'Free tier is limited to 1 project…' — no "violates" in it, so it used to
// burn every retry. CONTRACT 22: a delete of a job with OSHA incidents is
// refused 23001 'project_has_safety_records' — never 23503, which is how a
// child whose job is not on the server yet reads (and must keep reading).
describe('wave 5 — known refusals are terminal with their reasons', () => {
  const CAP = pg('Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.', '23514');
  const SAFETY = pg('project_has_safety_records', '23001');
  const settle = async () => {
    for (let i = 0; i < 20 && (await readSyncFailuresOrThrow()).length === 0; i++) await new Promise((r) => setTimeout(r, 0));
  };

  test('flush: a projects INSERT refused by the cap is dropped on the FIRST answer, kept under Not saved with its row', async () => {
    await seed([{ id: 'm-cap', table: 'projects', operation: 'insert', data: { id: 'p2', name: 'Second job' } }]);
    installScript(CAP);
    const res = await processOfflineQueue();
    expect(calls).toHaveLength(1);
    expect(res.failed).toBe(1);
    expect(await getOfflineQueue()).toHaveLength(0);
    await settle();
    const [line] = await readSyncFailuresOrThrow();
    expect(line).toMatchObject({ id: 'm-cap', table: 'projects', recordId: 'p2', operation: 'insert', reason: 'Free plan allows 1 project — upgrade, or delete a job first' });
    expect(line.row).toMatchObject({ name: 'Second job' });
    expect(String(oops.mock.calls[0]?.[0] ?? '')).toContain('Free plan allows 1 project');
  });

  test('flush: the owner UPSERT refused by the cap is terminal too, and its queued children go with it (recorded, not lost)', async () => {
    await seed([
      { id: 'm-job', table: 'projects', operation: 'upsert', data: { id: 'p2', name: 'Second job' }, timestamp: 1 },
      { id: 'm-dr', table: 'daily_reports', operation: 'insert', data: { id: 'dr1', project_id: 'p2' }, timestamp: 2 },
    ]);
    installScript(CAP);
    await processOfflineQueue();
    expect(calls.map((c) => c.table)).toEqual(['projects']);
    expect(await getOfflineQueue()).toHaveLength(0);
    await settle();
    const lines = await readSyncFailuresOrThrow();
    expect(lines.find((l) => l.id === 'm-job')).toMatchObject({ reason: 'Free plan allows 1 project — upgrade, or delete a job first', operation: 'upsert' });
    expect(lines.find((l) => l.id === 'm-dr')).toMatchObject({ table: 'daily_reports', recordId: 'dr1' });
  });

  test('flush: a projects DELETE refused for safety records is a NOTE (no Retry) and the job is announced for restoring', async () => {
    await seed([{ id: 'm-del', table: 'projects', operation: 'delete', data: { id: 'p9' } }]);
    installScript(SAFETY);
    const heard: string[] = [];
    const off = onProjectDeleteRefused((pid) => { heard.push(pid); });
    // Fix round 1: SafetyContext pruned the job's OSHA lists on the local
    // delete; the refusal names those tables on the flush channel so it
    // re-reads them from the server.
    const flushed: string[][] = [];
    const offFlush = onQueueFlushed((tables) => { flushed.push([...tables].sort()); });
    try {
      const res = await processOfflineQueue();
      expect(res.failed).toBe(1);
      expect(calls).toHaveLength(1);
      expect(await getOfflineQueue()).toHaveLength(0);
      expect(heard).toEqual(['p9']);
      await settle();
      const [line] = await readSyncFailuresOrThrow();
      expect(line.reason).toBe('This job has safety records — it was not deleted');
      expect(line.table).toBeUndefined();
      expect(line.row).toBeUndefined();
      // Not a delete line: nothing keeps the job hidden on the phone.
      expect([...(await unsavedWriteIds('projects'))]).toEqual([]);
      expect(flushed).toContainEqual(['hazards', 'jhas', 'safety_incidents', 'safety_inspections', 'toolbox_talks']);
    } finally {
      off();
      offFlush();
    }
  });

  test('live: an owner upsert refused by the cap answers failed, recorded with its row and the cap sentence', async () => {
    installScript(CAP);
    await expect(supabaseWriteDetailed('projects', 'upsert', { id: 'p3', name: 'Third job' })).resolves.toBe('failed');
    await settle();
    const [line] = await readSyncFailuresOrThrow();
    expect(line).toMatchObject({ table: 'projects', recordId: 'p3', operation: 'upsert', reason: 'Free plan allows 1 project — upgrade, or delete a job first' });
    expect(String(oops.mock.calls[0]?.[0] ?? '')).toContain('Free plan allows 1 project');
  });

  test('live: a delete refused for safety records is a note, and the job is announced', async () => {
    installScript(SAFETY);
    const heard: string[] = [];
    const off = onProjectDeleteRefused((pid) => { heard.push(pid); });
    const flushed: string[][] = [];
    const offFlush = onQueueFlushed((tables) => { flushed.push([...tables].sort()); });
    try {
      await expect(supabaseWriteDetailed('projects', 'delete', { id: 'p4' })).resolves.toBe('failed');
      await settle();
      const [line] = await readSyncFailuresOrThrow();
      expect(line.reason).toBe('This job has safety records — it was not deleted');
      expect(line.table).toBeUndefined();
      expect(heard).toEqual(['p4']);
      // SafetyContext re-reads the job's OSHA lists it pruned on the local delete.
      expect(flushed).toContainEqual(['hazards', 'jhas', 'safety_incidents', 'safety_inspections', 'toolbox_talks']);
    } finally {
      off();
      offFlush();
    }
  });

  test('a 23503 on a CHILD row stays parent-missing: queued behind its job, not terminal', async () => {
    installScript(async (c) => {
      if (c.table === 'projects') throw new TypeError('Network request failed');
      return { error: { message: 'insert or update on table "daily_reports" violates foreign key constraint "daily_reports_project_id_fkey"', code: '23503' } };
    });
    await expect(supabaseWriteDetailed('projects', 'upsert', { id: 'p5' })).resolves.toBe('queued');
    await expect(supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr5', project_id: 'p5' })).resolves.toBe('queued');
    expect((await getOfflineQueue()).map((m) => m.table)).toEqual(['projects', 'daily_reports']);
    expect(await readSyncFailuresOrThrow()).toHaveLength(0);
  });

  test('flush: a 23503 on a child spends ONE retry and stays queued (not dropped as a known refusal)', async () => {
    await seed([{ id: 'm-c', table: 'daily_reports', operation: 'insert', data: { id: 'dr6', project_id: 'p-missing' } }]);
    installScript(pg('insert or update on table "daily_reports" violates foreign key constraint "daily_reports_project_id_fkey"', '23503'));
    await processOfflineQueue();
    const q = await getOfflineQueue();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(1);
  });
});
