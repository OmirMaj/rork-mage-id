// validate-w4-sync-queue-ordering.ts — wave 4, lane sync-queue.
//
// Drives the REAL utils/offlineQueue.ts (and the real syncLedger,
// photoUploadQueue, demoSeed) against in-memory stubs of AsyncStorage,
// supabase-js, react-native and expo-file-system, and pins the behaviour each
// wave-4 finding needed. Every section FAILS against the shipped ab5bab13 code:
//
//   #2   a request that never got an answer (postgrest's 'TypeError: Network
//        request timed out', status 0, a 502/503/504) is queued with no retry
//        spent — and a Postgres 57014 statement timeout / plain 500 is not.
//   #23/#24/#102/#138/#139  a later write of a record never overtakes an
//        earlier one: queued → it queues behind; on the wire → it waits.
//   #4   a child made with its job waits for the job's write, and a child
//        refused while that write is still unsettled is queued, not failed.
//   #1   a refused write is recorded WITH its payload; unsavedWriteIds keeps
//        the row; only Retry resends, only Discard removes.
//   #32  RFI / submittal creates flush one at a time, oldest first.
//   C1   the 'rpc' op rides the record's FIFO group.
//   #122 a primary-key duplicate the caller cannot see is a conflict.
//   #3   the sample punch items carry a blank due date and are typed.
//   #8   the photo queue counts / discards one job's photos, own tenant only.
//
// Run: bun run scripts/validate-w4-sync-queue-ordering.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// ── Stubs ───────────────────────────────────────────────────────────────────
const store = new Map<string, string>();
const unreadable = new Set<string>();
type Call = { table: string; op: string; data: Record<string, unknown> };
type Answer = { error: { message: string; code?: string } | null; status?: number };
const calls: Call[] = [];
let script: (c: Call) => Promise<Answer> = async () => ({ error: null, status: 201 });
let visible: (table: string, id: string) => boolean = () => true;
let selects = 0;
const toasts: string[] = [];
let sessionUser = 'u1';
let authFeed: ((event: string, session: unknown) => void) | null = null;
function setSession(id: string) {
  sessionUser = id;
  authFeed?.('SIGNED_IN', { user: { id }, access_token: `tok-${id}` });
}

async function send(c: Call): Promise<Answer> {
  calls.push(c);
  return script(c);
}

Bun.plugin({
  name: 'w4-sync-queue-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
    build.module('@react-native-async-storage/async-storage', () => ({
      exports: {
        default: {
          getItem: async (k: string) => {
            if (unreadable.has(k)) throw new Error('storage refused');
            return store.get(k) ?? null;
          },
          setItem: async (k: string, v: string) => { store.set(k, v); },
          removeItem: async (k: string) => { store.delete(k); },
        },
      },
      loader: 'object',
    }));
    build.module('expo-file-system/legacy', () => ({
      exports: {
        documentDirectory: null,
        getInfoAsync: async () => ({ exists: false }),
        makeDirectoryAsync: async () => undefined,
        copyAsync: async () => undefined,
        moveAsync: async () => undefined,
        deleteAsync: async () => undefined,
      },
      loader: 'object',
    }));
    build.module('@/utils/storage', () => ({ exports: { uploadProjectPhoto: async () => 'ok' }, loader: 'object' }));
    build.module('@/lib/supabase', () => ({
      exports: {
        isSupabaseConfigured: true,
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: { user: { id: sessionUser }, access_token: `tok-${sessionUser}` } } }),
            // The state feed the queue keeps its session user from; setSession
            // drives it so a scenario can switch users.
            onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
              authFeed = cb;
              return { data: { subscription: { unsubscribe: () => undefined } } };
            },
          },
          rpc: (fn: string, args: Record<string, unknown>) => send({ table: `rpc:${fn}`, op: 'rpc', data: args }),
          from: (table: string) => ({
            insert: (data: Record<string, unknown>) => send({ table, op: 'insert', data }),
            upsert: (data: Record<string, unknown>) => send({ table, op: 'upsert', data }),
            update: (data: Record<string, unknown>) => ({ eq: (_c: string, id: string) => send({ table, op: 'update', data: { ...data, id } }) }),
            delete: () => ({ eq: (_c: string, id: string) => send({ table, op: 'delete', data: { id } }) }),
            select: () => ({ eq: async (_c: string, id: string) => ({ selected: ++selects, data: visible(table, id) ? [{ id }] : [], error: null, status: 200 }) }),
          }),
        },
      },
      loader: 'object',
    }));
    build.module('@/components/animations/NailItToast', () => ({
      exports: { oops: (m: string) => { toasts.push(m); }, nailIt: () => undefined },
      loader: 'object',
    }));
    build.module('@sentry/react-native', () => ({
      exports: { captureMessage: () => undefined, captureException: () => undefined },
      loader: 'object',
    }));
  },
});

const Q = await import('@/utils/offlineQueue');
const L = await import('@/utils/syncLedger');
const P = await import('@/utils/photoUploadQueue');
const { isTransportError } = await import('@/utils/networkErrors');
const { computeSyncStatus, unsavedLines, discardKindFor, discardConfirmBody } = await import('@/utils/syncStatusCore');
const { seedDemoProject } = await import('@/utils/demoSeed');

Q.configureAutoDrain(null);
const QKEY = 'mageid_offline_queue';

function reset() {
  store.clear();
  unreadable.clear();
  calls.length = 0;
  toasts.length = 0;
  script = async () => ({ error: null, status: 201 });
  visible = () => true;
  setSession('u1');
  store.set('mageid_last_user_id', 'u1');
}
function seed(entries: Array<Partial<import('@/utils/offlineQueue').OfflineMutation> & { table: string; operation: import('@/utils/offlineQueue').OfflineMutation['operation']; data: Record<string, unknown> }>) {
  store.set(QKEY, JSON.stringify(entries.map((e, i) => ({
    id: e.id ?? `m${i}`, timestamp: e.timestamp ?? 1000 + i, retryCount: e.retryCount ?? 0, userId: e.userId ?? 'u1', ...e,
  }))));
}
const queue = (): import('@/utils/offlineQueue').OfflineMutation[] => JSON.parse(store.get(QKEY) ?? '[]');
const ledger = async () => L.readSyncFailuresOrThrow();
async function settleLedger(n = 1) {
  for (let i = 0; i < 50 && (await ledger()).length < n; i++) await new Promise((r) => setTimeout(r, 0));
}
const tick = async (n = 100) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
function gate() { let open!: () => void; const opened = new Promise<void>((r) => { open = r; }); return { opened, open }; }

// ── #2 ──────────────────────────────────────────────────────────────────────
console.log('\n#2 — a request that never got an answer is transient:');
{
  ok('isTransportError reads the re-wrapped postgrest timeout as transport',
    isTransportError(new Error('TypeError: Network request timed out')));
  ok('…but never a Postgres statement timeout (57014)',
    !isTransportError(new Error('canceling statement due to statement timeout')));

  reset();
  script = async () => ({ error: { message: 'TypeError: Network request timed out', code: '' }, status: 0 });
  const out = await Q.supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1' });
  ok("live: a timed-out save is queued, not 'Couldn't save'", out === 'queued' && queue().length === 1 && toasts.length === 0,
    `${out} / queue ${queue().length} / toasts ${toasts.length}`);
  await Q.processOfflineQueue();
  ok('flush: the same timeout keeps the entry with no retry spent', queue().length === 1 && queue()[0].retryCount === 0,
    JSON.stringify(queue()));

  reset();
  script = async () => ({ error: { message: 'Service Unavailable', code: '' }, status: 503 });
  ok('a gateway 503 is queued', (await Q.supabaseWriteDetailed('warranties', 'insert', { id: 'w1' })) === 'queued');

  reset();
  seed([{ table: 'warranties', operation: 'insert', data: { id: 'w1' } }]);
  script = async () => ({ error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 });
  await Q.processOfflineQueue();
  ok('a 57014 / plain 500 still spends the retry budget', queue()[0]?.retryCount === 1, JSON.stringify(queue()));
}

// ── ordering ────────────────────────────────────────────────────────────────
console.log('\n#23/#24/#102/#138/#139 — a later write never overtakes an earlier one:');
{
  reset();
  seed([{ table: 'time_entries', operation: 'insert', data: { id: 't1', status: 'clocked_in' } }]);
  const out = await Q.supabaseWriteDetailed('time_entries', 'update', { id: 't1', status: 'clocked_out' });
  ok('clock-out behind a queued clock-in is queued, nothing sent', out === 'queued' && calls.length === 0, `${out}, ${calls.length} sent`);
  await Q.processOfflineQueue();
  ok('…and the flush replays them in the order he made them',
    calls.map((c) => `${c.op}:${String(c.data.status)}`).join(',') === 'insert:clocked_in,update:clocked_out',
    calls.map((c) => `${c.op}:${String(c.data.status)}`).join(','));

  reset();
  seed([{ table: 'rfis', operation: 'update', data: { id: 'r4', status: 'answered' } }]);
  ok('an online edit behind a queued offline EDIT queues too',
    (await Q.supabaseWriteDetailed('rfis', 'update', { id: 'r4', status: 'closed' })) === 'queued' && calls.length === 0);

  reset();
  seed([{ table: 'punch_items', operation: 'insert', data: { id: 'pi1', project_id: 'p1' } }]);
  ok('a delete behind a queued insert queues (the record cannot come back)',
    (await Q.supabaseWriteDetailed('punch_items', 'delete', { id: 'pi1' })) === 'queued' && calls.length === 0);

  reset();
  seed([{ table: 'rfis', operation: 'insert', data: { id: 'r0' } }]);
  const before = store.get(QKEY);
  unreadable.add(QKEY);
  // Integration round 1: still never SENT (a 0-row "success" is the one wrong
  // answer) — but no longer 'queued' either: the append re-read the queue
  // with the swallowing getOfflineQueue(), got [], and wrote the whole stored
  // queue back as this one entry. Now it is 'failed' and the queue is untouched.
  // Integration round 2 (data-sync): that 'failed' failed EVERY keyed save on a
  // device whose stored queue could not be read, with perfect signal, and each
  // Retry added a line. Nothing in an unreadable queue can be flushed, so
  // there is nothing to overtake: read twice, still unreadable → sent directly.
  // The stored queue is still never overwritten (executed in
  // __tests__/sync/offline-queue.test.ts, with the one-off-hiccup case).
  const unreadableOut = await Q.supabaseWriteDetailed('rfis', 'update', { id: 'r1', status: 'closed' });
  unreadable.delete(QKEY);
  ok('an unreadable queue is not a queue holding an earlier write — the save is sent, and the stored queue is never overwritten',
    unreadableOut === 'synced' && calls.length === 1 && store.get(QKEY) === before, `${unreadableOut} ${calls.length}`);

  reset();
  seed([{ table: 'rfis', operation: 'insert', data: { id: 'r1' }, userId: 'someone-else' }]);
  ok("another tenant's entry never holds this user's write",
    (await Q.supabaseWriteDetailed('rfis', 'update', { id: 'r1', status: 'closed' })) === 'synced');

  reset();
  const g = gate();
  script = async (c) => {
    if (c.op === 'insert') { await g.opened; throw new TypeError('Network request failed'); }
    return { error: null };
  };
  const ins = Q.supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1', notes: 'morning' });
  const upd = Q.supabaseWriteDetailed('daily_reports', 'update', { id: 'dr1', notes: 'final' });
  await tick();
  const sentWhileOnWire = calls.length;
  g.open();
  const [a, b] = await Promise.all([ins, upd]);
  ok('an edit made while the INSERT is on the wire waits for it, then follows it into the queue',
    sentWhileOnWire === 1 && a === 'queued' && b === 'queued' && queue().map((m) => m.data.notes).join(',') === 'morning,final',
    `${sentWhileOnWire} sent, ${a}/${b}, ${queue().map((m) => m.data.notes).join(',')}`);

  reset();
  seed([{ table: 'time_entries', operation: 'insert', data: { id: 't1', status: 'clocked_in' } }]);
  const g2 = gate();
  script = async (c) => { if (c.op === 'insert') await g2.opened; return { error: null }; };
  const flush = Q.processOfflineQueue();
  await tick();
  const direct = Q.supabaseWriteDetailed('time_entries', 'update', { id: 't1', status: 'clocked_out' });
  await tick();
  const heldBehindFlush = calls.length === 1;
  g2.open();
  await flush;
  const dOut = await direct;
  ok("a direct write of a record the flush is sending waits for the flush's write-back",
    heldBehindFlush && dOut === 'synced' && calls.map((c) => c.op).join(',') === 'insert,update',
    `${heldBehindFlush} ${dOut} ${calls.map((c) => c.op).join(',')}`);

  reset();
  Q.configureAutoDrain(1);
  seed([{ table: 'photos', operation: 'insert', data: { id: 'ph1', project_id: 'p1' } }]);
  await Q.supabaseWriteDetailed('rfis', 'update', { id: 'r9', status: 'closed' });
  for (let i = 0; i < 50 && queue().length > 0; i++) await new Promise((r) => setTimeout(r, 2));
  Q.configureAutoDrain(null);
  ok('a direct write that lands while this session has queued work drains it within ~1 s', queue().length === 0,
    JSON.stringify(queue()));
}

// ── #4 ──────────────────────────────────────────────────────────────────────
console.log('\n#4 — a child made with its job waits for the job:');
{
  reset();
  const g = gate();
  script = async (c) => { if (c.table === 'projects') await g.opened; return { error: null }; };
  const job = Q.supabaseWriteDetailed('projects', 'upsert', { id: 'p1' });
  const child = Q.supabaseWriteDetailed('invoices', 'insert', { id: 'i1', project_id: 'p1' });
  await tick();
  const onlyJobSent = calls.map((c) => c.table).join(',') === 'projects';
  g.open();
  await Promise.all([job, child]);
  ok('the child is sent only after the job write on the wire settles',
    onlyJobSent && calls.map((c) => c.table).join(',') === 'projects,invoices', calls.map((c) => c.table).join(','));

  reset();
  script = async (c) => {
    if (c.table === 'projects') throw new TypeError('Network request failed');
    return { error: { message: 'new row violates row-level security policy for table "daily_reports"', code: '42501' } };
  };
  const [jo, co] = await Promise.all([
    Q.supabaseWriteDetailed('projects', 'upsert', { id: 'p1' }),
    Q.supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1', project_id: 'p1' }),
  ]);
  ok('a child refused while its job is queued is queued behind it (not failed, no toast)',
    jo === 'queued' && co === 'queued' && toasts.length === 0 && queue().map((m) => m.table).join(',') === 'projects,daily_reports',
    `${jo}/${co} toasts=${toasts.length} ${queue().map((m) => m.table).join(',')}`);
}

// ── #1 ──────────────────────────────────────────────────────────────────────
console.log('\n#1 — a refused write stays on the phone until Retry or Discard:');
{
  reset();
  script = async () => ({ error: { message: 'null value in column "due_date" of relation "punch_items" violates not-null constraint', code: '23502' }, status: 400 });
  const out = await Q.supabaseWriteDetailed('punch_items', 'insert', { id: 'pi1', project_id: 'p1', description: 'Loose fixture' });
  await settleLedger();
  const [f] = await ledger();
  ok('a live refusal is failed, toasted, AND recorded with its payload',
    out === 'failed' && toasts.length === 1 && f?.table === 'punch_items' && f?.recordId === 'pi1'
      && f?.operation === 'insert' && (f?.row as { description?: string } | undefined)?.description === 'Loose fixture' && f?.userId === 'u1',
    JSON.stringify(f));
  ok('…in plain words', f?.reason === 'a required field was missing', f?.reason);
  ok('unsavedWriteIds keeps it for the loaders', (await L.unsavedWriteIds('punch_items')).has('pi1'));
  setSession('u2');
  ok("…and only for the user who made it", !(await L.unsavedWriteIds('punch_items')).has('pi1'));
  setSession('u1');
  calls.length = 0;
  script = async () => ({ error: null, status: 201 });
  const r = await L.retryUnsavedWrite(f.id);
  ok('Retry resends it exactly as it was and clears the line',
    r === 'synced' && calls.length === 1 && calls[0].data.description === 'Loose fixture' && (await ledger()).length === 0,
    `${r} ${JSON.stringify(calls)}`);

  reset();
  script = async () => ({ error: { message: 'new row violates check constraint', code: '23514' }, status: 400 });
  await Q.supabaseWriteDetailed('warranties', 'insert', { id: 'w1' });
  await settleLedger();
  const id = (await ledger())[0].id;
  calls.length = 0;
  ok('Discard removes it and sends nothing', (await L.discardUnsavedWrite(id)) === 1 && calls.length === 0
    && !(await L.unsavedWriteIds('warranties')).has('w1'));

  reset();
  seed([{ id: 'm-drop', table: 'daily_reports', operation: 'insert', data: { id: 'dr7', project_id: 'p1', notes: 'x' } }]);
  script = async () => ({ error: { message: 'new row violates check constraint "c"', code: '23514' }, status: 400 });
  await Q.processOfflineQueue();
  await settleLedger();
  const [d] = await ledger();
  ok('a flush drop is recorded with its row, so it can be retried too',
    d?.id === 'm-drop' && d?.recordId === 'dr7' && (d?.row as { notes?: string } | undefined)?.notes === 'x', JSON.stringify(d));

  const lines = unsavedLines([
    { id: 'a', label: 'RFI', reason: 'r', at: 1, canRetry: true, recordKey: 'rfis:1' },
    { id: 'b', label: 'RFI', reason: 'r2', at: 2, canRetry: false, recordKey: 'rfis:1' },
  ]);
  ok('one sheet line per record, retryable only if every write of it is',
    lines.length === 1 && lines[0].canRetry === false && lines[0].writes === 2 && lines[0].line.startsWith('Not saved to MAGE — '),
    JSON.stringify(lines));
  const s = computeSyncStatus({ depths: { writes: 0, photos: 0, dictations: 0 }, failures: { count: 2, labels: ['x'], retryable: 2 }, readFailed: false, signedIn: true });
  ok('the red copy offers Retry and still says nothing is sent without it',
    /Retry/.test(s.detail) && /will not be sent/.test(s.detail) && /Discard/.test(s.detail), s.detail);
}

// ── #32 ─────────────────────────────────────────────────────────────────────
console.log('\n#32 — RFI / submittal creates keep his order:');
{
  reset();
  seed([
    { table: 'rfis', operation: 'insert', data: { id: 'a', project_id: 'p1' }, timestamp: 1 },
    { table: 'rfis', operation: 'insert', data: { id: 'b', project_id: 'p1' }, timestamp: 2 },
    { table: 'rfis', operation: 'insert', data: { id: 'c', project_id: 'p1' }, timestamp: 3 },
  ]);
  let live = 0, peak = 0;
  script = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return { error: null }; };
  await Q.processOfflineQueue();
  ok('the flush sends them one at a time, oldest first', peak === 1 && calls.map((c) => c.data.id).join('') === 'abc',
    `peak ${peak}, order ${calls.map((c) => c.data.id).join('')}`);

  reset();
  seed([
    { table: 'submittals', operation: 'insert', data: { id: 'a', project_id: 'p1' }, timestamp: 1 },
    { table: 'submittals', operation: 'insert', data: { id: 'b', project_id: 'p1' }, timestamp: 2 },
  ]);
  script = async () => { throw new TypeError('Network request failed'); };
  await Q.processOfflineQueue();
  ok('once one stays queued, the later creates of that project wait with it', calls.length === 1 && queue().length === 2);

  reset();
  seed([{ table: 'rfis', operation: 'insert', data: { id: 'a', project_id: 'p1' } }]);
  ok('live: a create behind a queued create of the same project queues',
    (await Q.supabaseWriteDetailed('rfis', 'insert', { id: 'b', project_id: 'p1' })) === 'queued' && calls.length === 0);
}

// ── CONTRACT 1 ──────────────────────────────────────────────────────────────
console.log('\nCONTRACT 1 — the rpc op rides the record group:');
{
  reset();
  seed([{ table: 'invoices', operation: 'insert', data: { id: 'inv1', project_id: 'p1' } }]);
  const out = await Q.supabaseRpcDetailed('invoices', 'inv1', 'invoice_append_payment', { p_invoice_id: 'inv1', p_entry: {} });
  const e = queue()[1];
  ok('supabaseRpcDetailed queues behind the queued INSERT with data.id = recordId',
    out === 'queued' && e?.operation === 'rpc' && e?.data.id === 'inv1' && e?.rpc?.fn === 'invoice_append_payment', JSON.stringify(e));
  await Q.processOfflineQueue();
  ok('…and the flush calls supabase.rpc after the insert', calls.map((c) => c.op).join(',') === 'insert,rpc' && queue().length === 0,
    calls.map((c) => c.op).join(','));

  reset();
  seed([{ table: 'invoices', operation: 'rpc', data: { id: 'inv1' }, rpc: { fn: 'invoice_append_payment', args: {} } }]);
  ok('an invoice UPDATE never overtakes a queued payment append',
    (await Q.supabaseWriteDetailed('invoices', 'update', { id: 'inv1', status: 'paid' })) === 'queued' && calls.length === 0);
}

// ── #122 ────────────────────────────────────────────────────────────────────
console.log('\n#122 — a duplicate he cannot see is a conflict:');
{
  reset();
  seed([
    { table: 'safety_incidents', operation: 'insert', data: { id: 'case1', project_id: 'p1' }, timestamp: 1 },
    { table: 'safety_incidents', operation: 'update', data: { id: 'case1', days_away: 3 }, timestamp: 2 },
  ]);
  visible = () => false;
  script = async () => ({ error: { message: 'duplicate key value violates unique constraint "safety_incidents_pkey"', code: '23505' } });
  const res = await Q.processOfflineQueue();
  await settleLedger(2);
  ok("flush: dropped as 'not_visible_conflict' with its dependents, never counted as landed",
    res.failed === 2 && calls.length === 1 && (await ledger()).every((f) => f.reason === 'not_visible_conflict'),
    `${JSON.stringify(res)} ${JSON.stringify((await ledger()).map((f) => f.reason))}`);

  reset();
  script = async () => ({ error: { message: 'duplicate key value violates unique constraint "daily_reports_pkey"', code: '23505' } });
  ok('live: a visible duplicate (re-send of a timed-out insert) is success',
    (await Q.supabaseWriteDetailed('daily_reports', 'insert', { id: 'dr1' })) === 'synced');
  visible = () => false;
  ok('live: an invisible one is failed',
    (await Q.supabaseWriteDetailed('safety_incidents', 'insert', { id: 'c9' })) === 'failed');

  // Round-1 review: a table whose INSERT admits rows its SELECT does not show
  // back to the author (portal_messages, change_order_approvals, messages,
  // project_financials in production) must keep the old rule — a re-read there
  // cannot tell his own landing from someone else's row.
  reset();
  selects = 0;
  visible = () => false;
  script = async () => ({ error: { message: 'duplicate key value violates unique constraint "portal_messages_pkey"', code: '23505' } });
  ok('live: outside the own-row-conflict tables a _pkey duplicate is still his landed re-send',
    (await Q.supabaseWriteDetailed('portal_messages', 'insert', { id: 'pm1' })) === 'synced'
      && selects === 0, `selects ${selects}`);
  reset();
  seed([{ table: 'change_order_approvals', operation: 'insert', data: { id: 'coa1' } }]);
  visible = () => false;
  script = async () => ({ error: { message: 'duplicate key value violates unique constraint "change_order_approvals_pkey"', code: '23505' } });
  const r2 = await Q.processOfflineQueue();
  ok('flush: …and is not dropped as a conflict there either',
    r2.failed === 0 && queue().length === 0 && (await ledger()).length === 0, JSON.stringify(r2));
  ok('the re-check runs on exactly the five author-scoped safety tables',
    [...Q.OWN_ROW_CONFLICT_TABLES].sort().join(',') === 'hazards,jhas,safety_incidents,safety_inspections,toolbox_talks',
    [...Q.OWN_ROW_CONFLICT_TABLES].join(','));
}

// ── #3 ──────────────────────────────────────────────────────────────────────
console.log('\n#3 — sample punch items can be saved:');
{
  const punches: Array<Record<string, unknown>> = [];
  const noop = () => undefined;
  await seedDemoProject({
    flavor: 'small',
    addProject: noop, addInvoice: noop, addDailyReport: noop, addProjectPhoto: noop, addRFI: noop, addChangeOrder: noop,
    addPunchItem: (p) => { punches.push(p as unknown as Record<string, unknown>); },
  });
  ok('every sample punch item sends a blank due date and no sub',
    punches.length > 0 && punches.every((p) => p.dueDate === '' && p.assignedSub === ''), JSON.stringify(punches[0]));
  const seedSrc = readFileSync(join(ROOT, 'utils', 'demoSeed.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('…and punchTemplate is typed, not cast (the cast hid the missing column)', !/as unknown as PunchItem/.test(seedSrc));
}

// ── #8 carry ────────────────────────────────────────────────────────────────
console.log('\n#8/#128 carry — the photo queue for one job:');
{
  reset();
  const task = (id: string, projectId: string, userId: string) => ({
    id, photoId: id, userId, projectId, localUri: `file:///${id}.jpg`, storagePath: `${userId}/${projectId}/${id}.jpg`,
    contentType: 'image/jpeg', queuedAt: 1, retryCount: 0,
  });
  store.set('mageid_photo_upload_queue', JSON.stringify([
    task('a', 'p1', 'u1'), task('b', 'p1', 'u1'), task('c', 'p2', 'u1'), task('d', 'p1', 'other'),
  ]));
  ok('countQueuedPhotoUploadsForProject counts this session’s photos for that job only',
    (await P.countQueuedPhotoUploadsForProject('p1')) === 2);
  const n = await P.discardQueuedPhotoUploads((t) => (t.projectId === 'p1' ? 'You left Henderson Remodel' : null));
  const left = JSON.parse(store.get('mageid_photo_upload_queue') ?? '[]') as Array<{ id: string }>;
  await settleLedger(2);
  ok('discardQueuedPhotoUploads drops only this session’s matching photos, and says so',
    n === 2 && left.map((t) => t.id).join(',') === 'c,d' && toasts.some((t) => t.includes('You left Henderson Remodel'))
      && (await ledger()).filter((f) => f.kind === 'photo').length === 2,
    `${n} ${left.map((t) => t.id).join(',')} ${JSON.stringify(toasts)}`);
}

// ── #1 round-1 review: the cap never removes an unsaved record ──────────────
console.log('\n#1 — the ledger cap trims notes, never an unsaved record:');
{
  const w = (i: number): import('@/utils/syncLedger').SyncFailure => ({
    id: `w${i}`, kind: 'write', label: 'Daily report', reason: 'refused', at: i, userId: 'u1',
    table: 'daily_reports', recordId: `dr${i}`, operation: 'insert', row: { id: `dr${i}` },
  });
  const note = (i: number): import('@/utils/syncLedger').SyncFailure => ({
    id: `n${i}`, kind: 'photo', label: 'Photo', reason: 'retried 5 times', at: 1000 + i, userId: 'u1',
  });
  const merged = L.mergeFailures([], [...Array.from({ length: 50 }, (_, i) => w(i)), ...Array.from({ length: 60 }, (_, i) => note(i))]);
  const ids = L.unsavedIdsIn(merged, 'daily_reports');
  ok('50 retryable failures leave all 50 ids for the loaders to keep', ids.size === 50, `kept ${ids.size}`);
  ok('…and all 50 can still be retried', merged.filter(L.isRetryableFailure).length === 50);
  ok('…while notes are still capped at the newest MAX_SYNC_FAILURES',
    merged.filter((f) => !L.isRetryableFailure(f)).length === L.MAX_SYNC_FAILURES
      && merged.filter((f) => f.kind === 'photo').every((f) => f.at >= 1000 + 60 - L.MAX_SYNC_FAILURES));

  // through the real recorder, one refusal batch past the cap
  reset();
  await L.recordSyncFailures(Array.from({ length: 45 }, (_, i) => w(i)));
  ok('recordSyncFailures keeps a 45-record refusal batch whole', (await L.unsavedWriteIds('daily_reports')).size === 45,
    String((await L.unsavedWriteIds('daily_reports')).size));
}

// ── #1 round-1 review: Discard says what it throws away ─────────────────────
console.log('\n#1 — Discard is worded per operation:');
{
  ok('an INSERT anywhere = create', discardKindFor(['update', 'insert']) === 'create');
  ok('a failed edit = edit', discardKindFor(['update']) === 'edit' && discardKindFor(['rpc', 'update']) === 'edit');
  ok('a failed delete = delete', discardKindFor(['update', 'delete']) === 'delete');
  ok('an upsert or a note = unknown', discardKindFor(['upsert']) === 'unknown' && discardKindFor([undefined]) === 'unknown');
  ok('create copy: never saved, removed from this phone', /never saved to MAGE/.test(discardConfirmBody('create')));
  ok('edit copy does not claim the record was never saved',
    !/never saved/.test(discardConfirmBody('edit')) && /keeps the last saved version/.test(discardConfirmBody('edit')));
  ok('delete copy says the record comes back',
    !/never saved/.test(discardConfirmBody('delete')) && /reappear/.test(discardConfirmBody('delete')));
  const lines = unsavedLines([
    { id: 'a', label: 'RFI', reason: 'refused', at: 2, canRetry: true, operation: 'update', recordKey: 'rfis:r1' },
    { id: 'b', label: 'RFI', reason: 'refused', at: 3, canRetry: true, operation: 'delete', recordKey: 'rfis:r2' },
  ]);
  ok('each sheet line carries its discard kind',
    lines.find((l) => l.id === 'a')?.discards === 'edit' && lines.find((l) => l.id === 'b')?.discards === 'delete',
    JSON.stringify(lines));
  const pill = readFileSync(join(ROOT, 'components', 'OfflineSyncPill.tsx'), 'utf8');
  ok('the pill’s Discard confirm uses the per-operation body, not one create-only sentence',
    /discardConfirmBody\(line\.discards\)/.test(pill) && !/`It was never saved to MAGE\. Discarding/.test(pill));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
