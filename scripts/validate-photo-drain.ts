// validate-photo-drain.ts — the opportunistic photo drain must actually drain.
//
// WHY THIS EXISTS. utils/photoUploadQueue.processPhotoUploadQueue coalesces: a
// second caller while a flush is in its (slow, network-bound) phase gets the
// FIRST flush's promise handed back, and that flush's queue snapshot predates
// any photo taken since. queuePhotoUpload's opportunistic drain used to be a
// bare `void processPhotoUploadQueue().catch(() => {})` — so a photo shot
// DURING a flush scheduled a drain, fired it 1500 ms later, coalesced onto the
// older flush, and had the result (`remaining: 1` and all) discarded.
// drainTimer was already null, so nothing re-armed. OfflineSyncManager's
// exponential backoff is idle whenever the user is online and synced — the
// exact situation this drain exists for — so the bytes then sat in
// documentDirectory until the next foreground cycle and were lost outright if
// the app was deleted first. A super shooting a burst one frame at a time got
// only the FIRST photo of each burst into Storage; the client portal, the
// homeowner digest and every other device silently missed the rest.
//
// scripts/validate-photo-upload.ts covers the PURE decision logic in
// photoUploadCore (classification, retry budget, dedupe, cap, reconcile) plus
// static wiring checks. It cannot cover this one, because the defect lives in
// the RN-bound shell — the module imports react-native, AsyncStorage,
// expo-file-system and supabase-js, none of which bun can parse.
//
// So this validator loads that real shell with those five imports replaced by
// in-memory stubs (Bun.plugin virtual modules) and drives it against a fake
// clock. It exercises the actual scheduling code, not a copy of it, and every
// assertion below FAILS against the pre-fix version of photoUploadQueue.ts.
//
// Run: bun run scripts/validate-photo-drain.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Pure, import-free — safe to load statically before the stubs are installed.
import { PHOTO_RLS_MAX_RETRIES } from '../utils/photoUploadCore';

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed and adding one for a single validator is not worth a
// dependency. Only the sliver of Bun.plugin used below is described.
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
function expect<T>(name: string, got: T, want: T) {
  const isOk = JSON.stringify(got) === JSON.stringify(want);
  if (isOk) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

// ── Fake clock ──────────────────────────────────────────────────────────────
// Installed BEFORE the module is imported so its setTimeout calls land here.
// Real 1500 ms waits would make this validator slow AND flaky; controlling the
// clock is what lets us assert "nothing was re-armed", which is impossible to
// prove by waiting.
type FakeTimer = { id: number; fn: () => void; at: number };
let clockNow = 0;
let timerSeq = 1;
let timers: FakeTimer[] = [];
globalThis.setTimeout = ((fn: () => void, ms?: number) => {
  const t: FakeTimer = { id: timerSeq++, fn, at: clockNow + (ms ?? 0) };
  timers.push(t);
  return t.id;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => { timers = timers.filter((t) => t.id !== id); }) as unknown as typeof clearTimeout;

/** Let every already-resolved promise chain run to completion. */
async function settle(rounds = 200): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Advance the fake clock, firing (and settling) each timer that comes due. */
async function advance(ms: number): Promise<void> {
  clockNow += ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= clockNow).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    due.fn();
    await settle();
  }
}

// ── Stub environment ────────────────────────────────────────────────────────
const store = new Map<string, string>();
/** Keys whose READ should blow up, for the A8 "storage refused" scenarios. */
const unreadableKeys = new Set<string>();

/** A hand-controlled upload: the flush parks here until the test releases it. */
type Gate = { resolve: () => void; reject: (e: unknown) => void };
const gates = new Map<string, Gate>();
const uploadStarted: string[] = [];
const uploadSucceeded: string[] = [];
/** Paths that should reject, and with what. Absent ⇒ resolve. */
const uploadFailure = new Map<string, Error>();
/** Paths whose upload should hang until the test opens their gate. */
const uploadHeld = new Set<string>();
/** What the user was told (NailItToast.oops) and what Sentry was told, per drop. */
const droppedNotices: string[] = [];
const sentryNotices: string[] = [];

/**
 * PostgREST outcomes for the REAL utils/offlineQueue flush.
 *
 * A7 (§11) drives `processOfflineQueue()` for real — the photo queue learns
 * that a project is doomed only through that module's own verdict, so faking
 * the verdict would test the fake. utils/offlineQueue is NOT stubbed here (it
 * imports only AsyncStorage and @/lib/supabase, both of which are), so the one
 * thing it still needs is a scriptable `supabase.from`.
 */
let pgScript: (table: string, op: string) => Promise<{ error: { message: string; code?: string } | null }> =
  async () => ({ error: null });

Bun.plugin({
  name: 'photo-drain-stubs',
  setup(build) {
    build.module('react-native', () => ({
      exports: { Platform: { OS: 'ios' } },
      loader: 'object',
    }));
    build.module('@react-native-async-storage/async-storage', () => ({
      exports: {
        default: {
          getItem: async (k: string) => {
            if (unreadableKeys.has(k)) throw new Error('SQLITE_FULL: database or disk is full');
            return store.get(k) ?? null;
          },
          setItem: async (k: string, v: string) => { store.set(k, v); },
          removeItem: async (k: string) => { store.delete(k); },
        },
      },
      loader: 'object',
    }));
    // documentDirectory: null makes persistLocalCopy return the original URI
    // untouched, so no real filesystem is involved anywhere in this test.
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
    // The session MUST carry an access_token. utils/offlineQueue.bearerStillLive
    // reads exactly that field, and photoUploadQueue consults it on every
    // terminal / rls-pending refusal (A4): a refusal answered to a request that
    // carried no user token is not a verdict, so the flush keeps the task and
    // stops. A user-only session therefore made EVERY refusal in this file
    // "no bearer" — scenario 2's held upload was re-gated by the next flush and
    // that flush never resolved, wedging `inFlight` for the rest of the run.
    build.module('@/lib/supabase', () => ({
      exports: {
        isSupabaseConfigured: true,
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'tok-u1' } } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
          },
          // Only utils/offlineQueue reaches for this (see pgScript above); the
          // photo queue's own network edge is @/utils/storage, stubbed below.
          from: (table: string) => ({
            insert: () => pgScript(table, 'insert'),
            upsert: () => pgScript(table, 'upsert'),
            update: () => ({ eq: () => pgScript(table, 'update') }),
            delete: () => ({ eq: () => pgScript(table, 'delete') }),
          }),
        },
      },
      loader: 'object',
    }));
    build.module('@/utils/storage', () => ({
      exports: {
        uploadProjectPhoto: (_localUri: string, storagePath: string) => {
          uploadStarted.push(storagePath);
          const failure = uploadFailure.get(storagePath);
          if (uploadHeld.has(storagePath)) {
            return new Promise<string>((res, rej) => {
              gates.set(storagePath, {
                resolve: () => { uploadSucceeded.push(storagePath); res('ok'); },
                reject: (e) => rej(e),
              });
            });
          }
          if (failure) return Promise.reject(failure);
          uploadSucceeded.push(storagePath);
          return Promise.resolve('ok');
        },
      },
      loader: 'object',
    }));
    // notifyDroppedPhotos lazy-requires both of these. Stubbed so a drop is
    // observable here instead of vanishing into its try/catch.
    build.module('@/components/animations/NailItToast', () => ({
      exports: { oops: (msg: string) => { droppedNotices.push(msg); }, nailIt: () => undefined },
      loader: 'object',
    }));
    build.module('@sentry/react-native', () => ({
      exports: { captureMessage: (msg: string) => { sentryNotices.push(msg); } },
      loader: 'object',
    }));
  },
});

const { queuePhotoUpload, getOwnPhotoUploadQueue, getPhotoUploadQueue, processPhotoUploadQueue, retainPhotoUploadQueueForUser } =
  await import('@/utils/photoUploadQueue');
// The real text queue — §11 needs its verdict, not a stand-in for it.
const { processOfflineQueue, takeDoomedProjectIds } = await import('@/utils/offlineQueue');

const DRAIN_MS = 1500;

function shoot(id: string, opts?: { userId?: string; projectId?: string }) {
  const userId = opts?.userId ?? 'u1';
  const projectId = opts?.projectId ?? 'p1';
  return queuePhotoUpload({
    photoId: id,
    userId,
    projectId,
    localUri: `file:///tmp/${id}.jpg`,
    storagePath: `${userId}/${projectId}/${id}.jpg`,
    contentType: 'image/jpeg',
  });
}

function reset() {
  store.clear();
  unreadableKeys.clear();
  gates.clear();
  uploadStarted.length = 0;
  uploadSucceeded.length = 0;
  uploadFailure.clear();
  uploadHeld.clear();
  droppedNotices.length = 0;
  sentryNotices.length = 0;
  timers = [];
  pgScript = async () => ({ error: null });
  takeDoomedProjectIds();   // a verdict one scenario left unread is not the next one's
}

console.log('\nphoto upload — opportunistic drain:');

// ── 1. The finding: a photo shot DURING a flush still reaches Storage ────────
{
  reset();
  uploadHeld.add('u1/p1/A.jpg');       // A's upload parks in its "network phase"
  await shoot('A');
  await advance(DRAIN_MS);             // A's drain fires and starts flushing
  await settle();
  expect('the first photo starts uploading', uploadStarted, ['u1/p1/A.jpg']);

  await shoot('B');                    // shot while A is still in the air
  await advance(DRAIN_MS);             // B's drain fires — and COALESCES onto A's flush
  await settle();
  expect('B is not attempted by the flush that predates it', uploadStarted, ['u1/p1/A.jpg']);

  gates.get('u1/p1/A.jpg')!.resolve(); // A's upload completes
  await settle();

  ok('the coalesced drain re-armed itself once A settled', timers.length === 1,
    'this is the bug: drainTimer was already null and the coalesced result was thrown away');

  await advance(DRAIN_MS);
  await settle();
  expect('B uploads without waiting for a foreground cycle', uploadSucceeded,
    ['u1/p1/A.jpg', 'u1/p1/B.jpg']);
  expect('and the queue is empty afterwards', (await getPhotoUploadQueue()).length, 0);
}

// ── 2. …even when the coalesced flush uploaded NOTHING ──────────────────────
// Isolates the re-arm to the "a photo exists this flush never saw" signal: A
// fails terminally, so the flush reports uploaded: 0 and a `uploaded > 0`
// heuristic alone would leave B stranded. (A genuinely terminal error — an RLS
// refusal is no longer one; see scenarios 6 and 7.)
{
  reset();
  uploadHeld.add('u1/p1/C.jpg');
  uploadFailure.set('u1/p1/C.jpg', new Error('Bucket not found'));
  await shoot('C');
  await advance(DRAIN_MS);
  await settle();

  await shoot('D');
  await advance(DRAIN_MS);
  await settle();

  gates.get('u1/p1/C.jpg')!.reject(new Error('Bucket not found'));
  await settle();
  await advance(DRAIN_MS);
  await settle();

  expect('a photo queued behind a FAILED flush still uploads', uploadSucceeded, ['u1/p1/D.jpg']);
}

// ── 3. A whole burst taken during one flush is not truncated to its first ────
{
  reset();
  uploadHeld.add('u1/p1/E.jpg');
  await shoot('E');
  await advance(DRAIN_MS);
  await settle();
  await shoot('F');
  await shoot('G');
  await shoot('H');
  await advance(DRAIN_MS);
  await settle();
  gates.get('u1/p1/E.jpg')!.resolve();
  await settle();
  await advance(DRAIN_MS);
  await settle();
  expect('every frame of the burst lands in Storage, not just the first',
    uploadSucceeded.slice().sort(),
    ['u1/p1/E.jpg', 'u1/p1/F.jpg', 'u1/p1/G.jpg', 'u1/p1/H.jpg']);
}

// ── 4. Offline must NOT become a 1500 ms hot loop ────────────────────────────
// The obvious fix — re-arm whenever `remaining > 0` — re-arms forever on a
// jobsite with no signal, re-attempting multi-MB bodies every 1.5 s. Offline
// retry belongs to OfflineSyncManager's exponential backoff. This pins that the
// drain stays quiet when a flush made no progress.
{
  reset();
  uploadFailure.set('u1/p1/X.jpg', new TypeError('Network request failed'));
  await shoot('X');
  await advance(DRAIN_MS);
  await settle();
  expect('the offline photo stays queued', (await getPhotoUploadQueue()).length, 1);
  expect('...and burns no retry budget', (await getPhotoUploadQueue())[0].retryCount, 0);
  ok('an offline drain does not re-arm itself (no 1.5 s hot loop)', timers.length === 0,
    `${timers.length} timer(s) armed — a bare "remaining > 0" re-arm hammers a no-signal device`);
}

// ── 5. Coalescing itself must survive ───────────────────────────────────────
// The re-entrancy guard is what stops two overlapping flushes uploading the
// same multi-MB body twice. "Fixing" the drain by dropping the guard would
// trade this bug for a worse one, so pin that OfflineSyncManager's startup /
// foreground triggers still fold into a running flush.
{
  reset();
  uploadHeld.add('u1/p1/Y.jpg');
  await shoot('Y');
  await advance(DRAIN_MS);
  await settle();
  void processPhotoUploadQueue();      // ≈ app foregrounded mid-flush
  void processPhotoUploadQueue();      // ≈ OfflineSyncManager backoff fired too
  await settle();
  expect('overlapping triggers fold into the running flush',
    uploadStarted.filter((p) => p === 'u1/p1/Y.jpg').length, 1);
  gates.get('u1/p1/Y.jpg')!.resolve();
  await settle();
  await advance(DRAIN_MS * 4);
  await settle();
  expect('...and the photo is uploaded exactly once in total',
    uploadStarted.filter((p) => p === 'u1/p1/Y.jpg').length, 1);
  expect('...leaving nothing queued', (await getPhotoUploadQueue()).length, 0);
}

// ── 6. A storage RLS refusal WAITS for the project row — it is not a drop ───
// 20260904100400_storage_membership_policies.sql: project_photos_upload needs
// the `projects` row (can_access_project(folder[2], 'editor')). A photo taken
// on a project created offline reaches Storage before that project's upsert
// has flushed and is refused with "new row violates row-level security
// policy". Pre-fix that classified terminal → the bytes were deleted on the
// spot and the user toasted to "re-take" a photo of work that may be covered
// up by now. Now the photo is kept, on its own counter, and re-attempted on
// the next drain — which runs AFTER the offline queue, so the row is there.
{
  reset();
  uploadFailure.set('u1/p1/R.jpg', new Error('new row violates row-level security policy'));
  await shoot('R');
  await advance(DRAIN_MS);
  await settle();
  const after1 = await getPhotoUploadQueue();
  expect('the refused photo is still queued', after1.map((t) => t.photoId), ['R']);
  expect('...with the wait counted on its own counter', after1[0]?.rlsRetryCount, 1);
  expect('...and the 5xx budget untouched', after1[0]?.retryCount, 0);
  expect('...and nobody was told it was dropped', droppedNotices.length, 0);
  ok('a refusal does not re-arm the opportunistic drain (waiting for the parent is OfflineSyncManager\'s backoff, not a 1.5 s loop)',
    timers.length === 0, `${timers.length} timer(s) armed`);

  // The offline queue lands the project row; the next drain succeeds.
  uploadFailure.delete('u1/p1/R.jpg');
  await processPhotoUploadQueue();
  await settle();
  expect('the very same upload succeeds once the project row exists', uploadSucceeded, ['u1/p1/R.jpg']);
  expect('...and leaves the queue', (await getPhotoUploadQueue()).length, 0);
}

// ── 7. …but a refusal that never resolves is BOUNDED, and reported ──────────
// The same message also means "the project upsert was dropped" or "no editor
// access". Waiting forever would pin a dead task in the capped FIFO; the wait
// terminates after PHOTO_RLS_MAX_RETRIES flushes and the user is told.
{
  reset();
  uploadFailure.set('u1/p1/S.jpg', new Error('new row violates row-level security policy'));
  await shoot('S');
  await advance(DRAIN_MS);          // flush 1 — the opportunistic drain
  await settle();
  let flushes = 1;
  while ((await getPhotoUploadQueue()).length > 0 && flushes < 20) {
    await processPhotoUploadQueue(); // ≈ each later OfflineSyncManager drain
    await settle();
    flushes++;
  }
  expect('a photo refused on every flush is dropped after exactly PHOTO_RLS_MAX_RETRIES attempts', flushes, PHOTO_RLS_MAX_RETRIES);
  expect('...and the upload was attempted that many times, no more', uploadStarted.length, PHOTO_RLS_MAX_RETRIES);
  expect('...and the user is told once', droppedNotices.length, 1);
  ok('...and Sentry hears WHY (the project row never synced), not a generic "terminal error"',
    sentryNotices.length === 1 && /refused under storage RLS/.test(sentryNotices[0]),
    `got: ${JSON.stringify(sentryNotices)}`);
}

// ── 8. A1: a photo whose project row is STILL QUEUED is never dispatched ────
// Scenario 7 above is the fallback — bounded, but it costs a real round trip
// and one of PHOTO_RLS_MAX_RETRIES per flush for a refusal that was certain
// before we started. The `projects` insert sitting in utils/offlineQueue.ts is
// proof the row is not on the server yet, so the task is held out of the flush
// entirely: no upload attempted, no counter moved, and the write-back puts it
// back verbatim. The moment the project row lands the very same task uploads.
{
  reset();
  // What the text queue looks like while a project created offline waits: an
  // unrelated child insert too, so the scan cannot just take the first entry.
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-1', table: 'daily_reports', operation: 'insert', data: { id: 'dfr-1', project_id: 'p1' }, timestamp: 1, retryCount: 0, userId: 'u1' },
    { id: 'oq-2', table: 'projects', operation: 'upsert', data: { id: 'p1', name: 'Henderson' }, timestamp: 2, retryCount: 0, userId: 'u1' },
  ]));
  await shoot('P');
  await advance(DRAIN_MS);
  await settle();

  expect('no upload is attempted while the project row is still queued', uploadStarted, []);
  const held = await getPhotoUploadQueue();
  expect('the photo is still queued', held.length, 1);
  expect('...with its retry budget untouched', held[0].retryCount, 0);
  expect('...and no storage-RLS strike against it', held[0].rlsRetryCount ?? 0, 0);
  expect('...and the user is not told anything was dropped', droppedNotices.length, 0);
  ok('holding does not re-arm the 1.5 s drain (the parent lands on OfflineSyncManager\'s pass)',
    timers.length === 0, `${timers.length} timer(s) armed`);

  // The offline queue drains: the `projects` upsert lands and leaves.
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-1', table: 'daily_reports', operation: 'insert', data: { id: 'dfr-1', project_id: 'p1' }, timestamp: 1, retryCount: 0, userId: 'u1' },
  ]));
  await processPhotoUploadQueue();
  await settle();
  expect('the very same photo uploads once its project row has landed', uploadSucceeded, ['u1/p1/P.jpg']);
  expect('and the queue is empty afterwards', (await getPhotoUploadQueue()).length, 0);
}

// A `projects` DELETE in the text queue is not a reason to hold: the row it
// removes is already on the server, so the photo's RLS check can pass today.
{
  reset();
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-3', table: 'projects', operation: 'delete', data: { id: 'p1' }, timestamp: 1, retryCount: 0, userId: 'u1' },
  ]));
  await shoot('Q');
  await advance(DRAIN_MS);
  await settle();
  expect('only a queued projects INSERT/UPSERT holds a photo back', uploadSucceeded, ['u1/p1/Q.jpg']);
}

// ── 10. B1: the photo queue is bound to ONE session ─────────────────────────
// The tenant boundary on this queue had ZERO executing coverage: deleting the
// `t.userId === sessionUserId` filter in runPhotoUploadQueue, or the identical
// one in getOwnPhotoUploadQueue, left every test and validator in the repo
// green. On a shared device that filter is the only thing between the previous
// tenant's jobsite photos and an upload under this user's JWT — and the only
// thing stopping a "2 photos will be lost" dialog counting someone else's work.
{
  reset();
  await shoot('T', { userId: 'u2', projectId: 'p9' });   // the previous tenant's photo
  await shoot('M');                                       // …and this session's own

  expect('a UI counts only the session user\'s photos, never the other tenant\'s',
    (await getOwnPhotoUploadQueue()).map((t) => t.photoId), ['M']);
  expect('...while the persisted queue still holds both', (await getPhotoUploadQueue()).length, 2);

  const res = await processPhotoUploadQueue();
  await settle();

  expect('only the session user\'s bytes are uploaded', uploadStarted, ['u1/p1/M.jpg']);
  const left = await getPhotoUploadQueue();
  expect('the other tenant\'s task stays queued, untouched',
    left.map((t) => `${t.userId}:${t.photoId}:${t.retryCount}`), ['u2:T:0']);
  expect('...and nobody is told anything was dropped', droppedNotices.length, 0);
  // A3: reported as `foreign`, never as `remaining` — OfflineSyncManager re-arms
  // its backoff on `remaining`, and no retry under this JWT would ever send it.
  expect('...and it is reported as foreign, not as this session\'s remaining work',
    [res.uploaded, res.remaining, res.foreign], [1, 0, 1]);
  expect('nothing of the other tenant\'s is this session\'s to count',
    (await getOwnPhotoUploadQueue()).length, 0);
}

// ── 11. A7: a photo whose project was REJECTED FOR GOOD goes with it ────────
// utils/offlineQueue drops a doomed project's queued text children with the
// parent (A5) but cannot reach the photo queue — that queue imports it, so the
// dependency cannot run the other way. Without the handover the photos were
// dispatched anyway: each burned all PHOTO_RLS_MAX_RETRIES against a `projects`
// row that will never exist, then raised its OWN "re-take them" toast, a day
// after the parent's. Driven through the real processOfflineQueue() so the
// verdict under test is the one production produces.
{
  reset();
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-p7', table: 'projects', operation: 'insert', data: { id: 'p7' }, timestamp: 1, retryCount: 0, userId: 'u1' },
  ]));
  pgScript = async (table) => (table === 'projects'
    ? { error: { message: 'new row violates row-level security policy for table "projects"', code: '42501' } }
    : { error: null });
  await shoot('Z', { projectId: 'p7' });                 // a photo of that project
  await shoot('W');                                       // …and one of a healthy project

  const text = await processOfflineQueue();
  expect('the projects insert is dropped for good', text.failed, 1);
  droppedNotices.length = 0;                              // the text flush's own report
  sentryNotices.length = 0;
  pgScript = async () => ({ error: null });

  const res = await processPhotoUploadQueue();
  await settle();

  expect('the doomed photo is never dispatched against a row that will never exist',
    uploadStarted, ['u1/p1/W.jpg']);
  expect('...it is counted as failed, and the healthy one still uploads',
    [res.uploaded, res.failed, res.remaining, res.foreign], [1, 1, 0, 0]);
  expect('...and it is out of the queue, not left to be re-dropped next flush',
    (await getPhotoUploadQueue()).length, 0);
  expect('...reported in ONE flush-level notice, not one per photo', droppedNotices.length, 1);
  ok('...that says WHY — its project\'s own write was rejected',
    sentryNotices.length === 1 && /project whose own queued write was rejected/.test(sentryNotices[0]),
    `got: ${JSON.stringify(sentryNotices)}`);
}

// …and the boundary: a project whose write merely has not LANDED yet keeps its
// photos (that is the §8 hold), so the doom must not be a synonym for "queued".
{
  reset();
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-p8', table: 'projects', operation: 'upsert', data: { id: 'p8' }, timestamp: 1, retryCount: 0, userId: 'u1' },
  ]));
  pgScript = async () => { throw new TypeError('Network request failed'); };
  await shoot('V', { projectId: 'p8' });

  await processOfflineQueue();
  pgScript = async () => ({ error: null });
  await processPhotoUploadQueue();
  await settle();

  expect('a photo whose project upsert merely timed out is HELD, not dropped',
    (await getPhotoUploadQueue()).map((t) => t.photoId), ['V']);
  expect('...with nothing spent on it', (await getPhotoUploadQueue())[0]?.retryCount, 0);
  expect('...and nobody told it was lost', droppedNotices.length, 0);
}

// ── 12. A8: the doomed-project verdict does not outlive the drain ───────────
// takeDoomedProjectIds() is reached only once a drain has photos of its own to
// settle. A `projects` insert refused for good usually has NO photos queued
// behind it, so that verdict used to be recorded and then never read — sitting
// in module memory for the life of the process, and dropping on sight any photo
// taken for that project id later ("re-take them"), against a flush the user had
// long since dealt with. Every drain now spends whatever predates it.
{
  reset();
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-p20', table: 'projects', operation: 'insert', data: { id: 'p20' }, timestamp: 1, retryCount: 0, userId: 'u1' },
  ]));
  pgScript = async (table) => (table === 'projects'
    ? { error: { message: 'new row violates row-level security policy for table "projects"', code: '42501' } }
    : { error: null });

  const text = await processOfflineQueue();
  expect('the projects insert is dropped for good, with no photos behind it', text.failed, 1);
  droppedNotices.length = 0;
  pgScript = async () => ({ error: null });

  // A drain with an EMPTY photo queue — the pre-fix dead end.
  await processPhotoUploadQueue();
  await settle();

  // The photo the user takes afterwards, for the same project.
  await shoot('L', { projectId: 'p20' });
  await advance(DRAIN_MS);
  await settle();

  expect('a photo taken AFTER the verdict is dispatched, not killed by it',
    uploadStarted, ['u1/p20/L.jpg']);
  expect('...and nobody is told a photo was dropped', droppedNotices.length, 0);
}

// …and the boundary: a verdict recorded WHILE a drain was in the air belongs to
// the NEXT drain, not to the one that could not have seen it. Without the
// watermark (a blanket clear at the end of every drain) this photo is dispatched
// against a row that will never exist, burning PHOTO_RLS_MAX_RETRIES.
{
  reset();
  uploadHeld.add('u1/p21/N.jpg');
  await shoot('N', { projectId: 'p21' });
  const inAir = processPhotoUploadQueue();   // reads its watermark, then parks
  await settle();
  expect('the drain is in its network phase', uploadStarted, ['u1/p21/N.jpg']);

  // A text flush lands mid-drain and dooms a DIFFERENT project.
  store.set('mageid_offline_queue', JSON.stringify([
    { id: 'oq-p22', table: 'projects', operation: 'insert', data: { id: 'p22' }, timestamp: 1, retryCount: 0, userId: 'u1' },
  ]));
  pgScript = async (table) => (table === 'projects'
    ? { error: { message: 'new row violates row-level security policy for table "projects"', code: '42501' } }
    : { error: null });
  await processOfflineQueue();
  pgScript = async () => ({ error: null });
  droppedNotices.length = 0;

  gates.get('u1/p21/N.jpg')!.resolve();
  await inAir;
  await settle();

  // p22's photo was queued before that flush; the next drain must still drop it.
  await shoot('O', { projectId: 'p22' });
  await advance(DRAIN_MS);
  await settle();

  expect('a verdict recorded mid-drain survives for the drain that follows',
    uploadStarted, ['u1/p21/N.jpg']);
  expect('...and that photo is dropped, not dispatched', (await getPhotoUploadQueue()).length, 0);
  expect('...with the one flush-level notice', droppedNotices.length, 1);
}

// ── 13. A8: narrowing the photo queue for an arriving session ───────────────
// AuthContext calls this immediately before it stamps the last-user marker.
// Two things it has to get right: WHICH tasks an arriving session keeps (the
// platform gate — see contexts/AuthContext.tsx and __tests__/sync/
// auth-marker-backfill.test.tsx), and telling "storage refused" apart from
// "nothing here was yours" so the marker is not stamped over a queue nobody
// could read.
{
  reset();
  await shoot('R1', { userId: 'u1' });
  await shoot('R2', { userId: 'u2' });   // another tenant's

  const res = await retainPhotoUploadQueueForUser('u1');

  expect('the default keeps only this user\'s tasks', [res.kept, res.dropped, res.readFailed], [1, 1, false]);
  expect('...and the other tenant\'s is gone from storage',
    (await getPhotoUploadQueue()).map((t) => t.photoId), ['R1']);
}
{
  reset();
  await shoot('S1', { userId: 'u1' });
  await shoot('S2', { userId: 'u2' });
  // A task from before the queue carried a user at all. Hand-written: the
  // enqueue path refuses one without a userId, which is the point.
  const withLegacy = JSON.parse(store.get('mageid_photo_upload_queue')!) as Record<string, unknown>[];
  withLegacy.push({ ...withLegacy[0], id: 'legacy', photoId: 'S3', storagePath: 'u1/p1/S3.jpg', userId: undefined });
  store.set('mageid_photo_upload_queue', JSON.stringify(withLegacy));

  const res = await retainPhotoUploadQueueForUser('u1', { dropUntagged: false });

  expect('dropUntagged: false keeps the untagged task and still drops the foreign one',
    [res.kept, res.dropped, res.readFailed], [2, 1, false]);
  expect('...leaving exactly those two',
    (await getPhotoUploadQueue()).map((t) => t.photoId), ['S1', 'S3']);
}
{
  reset();
  await shoot('U1', { userId: 'u1' });
  await shoot('U2', { userId: 'u2' });
  const before = store.get('mageid_photo_upload_queue');
  unreadableKeys.add('mageid_photo_upload_queue');

  const res = await retainPhotoUploadQueueForUser('u1');
  unreadableKeys.delete('mageid_photo_upload_queue');

  expect('an unreadable queue reports readFailed, not an empty one',
    [res.kept, res.dropped, res.readFailed], [0, 0, true]);
  ok('...and the queue is byte-for-byte what it was — nothing narrowed, nothing unlinked',
    store.get('mageid_photo_upload_queue') === before,
    `got: ${store.get('mageid_photo_upload_queue')}`);
}

// ── 9. Static backstop ──────────────────────────────────────────────────────
const src = readFileSync(join(ROOT, 'utils/photoUploadQueue.ts'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the drain still consults its own result instead of discarding it',
  /processPhotoUploadQueue\(\)\s*\n?\s*\.then\(/.test(code),
  'a bare `void processPhotoUploadQueue().catch(...)` is the original defect');
ok('the re-entrancy guard is intact',
  /if\s*\(inFlight\)\s*return inFlight/.test(code),
  'removing coalescing would upload the same bytes twice');
// Scoped to runPhotoUploadQueue's body — queuePhotoUpload reads the queue too,
// and comparing against ITS call would make this assertion vacuously true.
const runBody = code.slice(code.indexOf('async function runPhotoUploadQueue'));
const lowerAt = runBody.indexOf('photoQueuedSinceSnapshot = false');
const readAt = runBody.indexOf('await getPhotoUploadQueue()');
ok('the unseen-photo flag is lowered BEFORE the queue snapshot is read',
  lowerAt !== -1 && readAt !== -1 && lowerAt < readAt,
  'lowering it after the read swallows a photo enqueued in the gap');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
