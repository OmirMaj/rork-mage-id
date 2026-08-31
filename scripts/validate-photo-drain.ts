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

/** A hand-controlled upload: the flush parks here until the test releases it. */
type Gate = { resolve: () => void; reject: (e: unknown) => void };
const gates = new Map<string, Gate>();
const uploadStarted: string[] = [];
const uploadSucceeded: string[] = [];
/** Paths that should reject, and with what. Absent ⇒ resolve. */
const uploadFailure = new Map<string, Error>();
/** Paths whose upload should hang until the test opens their gate. */
const uploadHeld = new Set<string>();

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
          getItem: async (k: string) => store.get(k) ?? null,
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
    build.module('@/lib/supabase', () => ({
      exports: {
        isSupabaseConfigured: true,
        supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } },
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
  },
});

const { queuePhotoUpload, getPhotoUploadQueue, processPhotoUploadQueue } =
  await import('@/utils/photoUploadQueue');

const DRAIN_MS = 1500;

function shoot(id: string) {
  return queuePhotoUpload({
    photoId: id,
    userId: 'u1',
    projectId: 'p1',
    localUri: `file:///tmp/${id}.jpg`,
    storagePath: `u1/p1/${id}.jpg`,
    contentType: 'image/jpeg',
  });
}

function reset() {
  store.clear();
  gates.clear();
  uploadStarted.length = 0;
  uploadSucceeded.length = 0;
  uploadFailure.clear();
  uploadHeld.clear();
  timers = [];
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
// heuristic alone would leave B stranded.
{
  reset();
  uploadHeld.add('u1/p1/C.jpg');
  uploadFailure.set('u1/p1/C.jpg', new Error('new row violates row-level security policy'));
  await shoot('C');
  await advance(DRAIN_MS);
  await settle();

  await shoot('D');
  await advance(DRAIN_MS);
  await settle();

  gates.get('u1/p1/C.jpg')!.reject(new Error('new row violates row-level security policy'));
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

// ── 6. Static backstop ──────────────────────────────────────────────────────
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
