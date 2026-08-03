// validate-photo-upload.ts — pins the photo-upload queue and guards the fix.
//
// WHY: `uploadProjectPhoto` existed in utils/storage.ts and was never called by
// anything. Every jobsite photo wrote its raw local `file://` path straight
// into the `photos` table instead, so the `project-photos` bucket had ZERO
// objects, ever, while the table filled with URIs that mean nothing on any
// other device, after a reinstall, on web, or in the client portal. Photos are
// legal documentation on a construction job — that is silent data loss, and the
// nastiest kind, because everything looks fine on the phone that took them.
//
// This validator pins the pure decision logic in utils/photoUploadCore.ts AND
// fails if the regression creeps back into the write path — a device-local URI
// being handed to a database column, a web bail-out returning null before
// anything uploads, or fetch().blob() reappearing on native (the bug that made
// every native upload write 0 bytes, fixed in 537d74d).
//
// Run: bun run scripts/validate-photo-upload.ts
import { readFileSync } from 'node:fs';
import {
  PHOTO_BUCKET,
  PHOTO_MAX_QUEUE,
  PHOTO_MAX_RETRIES,
  applyPhotoUploadOutcome,
  buildPhotoStoragePath,
  classifyPhotoUploadError,
  contentTypeForExt,
  enqueuePhotoUpload,
  isDeviceLocalUri,
  isHttpUrl,
  isUploadSettled,
  looksLikeStoragePath,
  photoExtFromUri,
  reconcilePhotoQueue,
  sortPhotoQueue,
  type PhotoUploadTask,
} from '../utils/photoUploadCore';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const isOk = JSON.stringify(got) === JSON.stringify(want);
  if (isOk) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

function task(over: Partial<PhotoUploadTask> = {}): PhotoUploadTask {
  return {
    id: 'pq-1', photoId: 'photo-1', userId: 'user-1', projectId: 'proj-1',
    localUri: 'file:///tmp/a.jpg', storagePath: 'user-1/proj-1/photo-1.jpg',
    contentType: 'image/jpeg', queuedAt: 1000, retryCount: 0, ...over,
  };
}

console.log('\nphoto upload queue:');

// ── URI classification: the actual bug ──────────────────────────────────────
// Anything true here must NEVER reach a database column.
ok('file:// is device-local', isDeviceLocalUri('file:///var/mobile/.../IMG_1.jpg'));
ok('blob: is device-local (the web picker)', isDeviceLocalUri('blob:http://localhost:8081/abc-123'));
ok('data: is device-local', isDeviceLocalUri('data:image/jpeg;base64,AAAA'));
ok('ph:// is device-local (iOS photo library)', isDeviceLocalUri('ph://ABC-123/L0/001'));
ok('content:// is device-local (Android SAF)', isDeviceLocalUri('content://media/external/images/1'));
ok('https is NOT device-local', !isDeviceLocalUri('https://x.supabase.co/storage/v1/a.jpg'));
ok('a bucket path is NOT device-local', !isDeviceLocalUri('user-1/proj-1/photo-1.jpg'));
ok('undefined is not device-local', !isDeviceLocalUri(undefined));
ok('http url detected', isHttpUrl('http://a.b/c.jpg') && isHttpUrl('https://a.b/c.jpg'));

// looksLikeStoragePath drives read-time signing — a false positive would try to
// sign a URL, a false negative would render a raw path as an image source.
ok('storage path recognized', looksLikeStoragePath('user-1/proj-1/photo-1.jpg'));
ok('signed URL is not a storage path', !looksLikeStoragePath('https://x.co/storage/v1/object/sign/a?token=b'));
ok('file:// is not a storage path', !looksLikeStoragePath('file:///tmp/a.jpg'));
ok('too-shallow key is not a storage path', !looksLikeStoragePath('proj-1/photo.jpg'));
ok('absolute posix path is not a storage path', !looksLikeStoragePath('/var/mobile/a/b/c.jpg'));
ok('empty is not a storage path', !looksLikeStoragePath('') && !looksLikeStoragePath(undefined));

// ── Path construction ───────────────────────────────────────────────────────
// RLS on project-photos is `(storage.foldername(name))[1] = auth.uid()::TEXT`
// (supabase/schema.sql) — folder[1] MUST be the user id or every upload 403s.
expect('path is <userId>/<projectId>/<photoId>.<ext>',
  buildPhotoStoragePath('u1', 'p1', 'ph1', 'jpg'), 'u1/p1/ph1.jpg');
expect('folder[1] is the user id (RLS requirement)',
  buildPhotoStoragePath('u1', 'p1', 'ph1', 'jpg').split('/')[0], 'u1');
expect('path is deterministic — same inputs, same object (idempotent retries)',
  buildPhotoStoragePath('u1', 'p1', 'ph1', 'jpg'), buildPhotoStoragePath('u1', 'p1', 'ph1', 'jpg'));
expect('path separators in ids are neutralized (no folder escape)',
  buildPhotoStoragePath('u1', '../../etc', 'ph1', 'jpg'), 'u1/.._.._etc/ph1.jpg');
ok('punch photos get their own key under the same project',
  buildPhotoStoragePath('u1', 'p1', 'punch-x', 'jpg') !== buildPhotoStoragePath('u1', 'p1', 'x', 'jpg'));

expect('extension read from the uri', photoExtFromUri('file:///tmp/IMG_1.png'), 'png');
expect('query string ignored', photoExtFromUri('file:///tmp/IMG_1.jpg?w=1024'), 'jpg');
expect('heic preserved (iOS default capture format)', photoExtFromUri('file:///tmp/IMG_1.HEIC'), 'heic');
expect('data: uri reads its mime', photoExtFromUri('data:image/png;base64,AAAA'), 'png');
expect('unknown extension falls back to jpg', photoExtFromUri('file:///tmp/IMG_1.bin'), 'jpg');
expect('no extension falls back to jpg', photoExtFromUri('blob:http://localhost/abc'), 'jpg');
expect('content type matches extension', contentTypeForExt('png'), 'image/png');
expect('unknown content type falls back to jpeg', contentTypeForExt('bin'), 'image/jpeg');

// ── Error classification: retry vs terminal vs transient ────────────────────
// The single most important rule: a device that is merely OFFLINE must never
// burn its retry budget, or a week on a no-signal jobsite deletes the photos.
expect('TypeError (RN fetch failure) is transient',
  classifyPhotoUploadError(new TypeError('Network request failed')), 'transient');
expect('"Network request failed" is transient',
  classifyPhotoUploadError(new Error('Network request failed')), 'transient');
expect('"Failed to fetch" (web) is transient',
  classifyPhotoUploadError(new Error('Failed to fetch')), 'transient');
expect('a timeout is transient', classifyPhotoUploadError(new Error('Request timed out')), 'transient');

expect('RLS denial is terminal',
  classifyPhotoUploadError(new Error('new row violates row-level security policy')), 'terminal');
expect('expired JWT is terminal', classifyPhotoUploadError(new Error('JWT expired')), 'terminal');
expect('unauthorized is terminal', classifyPhotoUploadError(new Error('Unauthorized')), 'terminal');
expect('missing local file is terminal (bytes are gone; retrying can never help)',
  classifyPhotoUploadError(new Error('ENOENT: no such file or directory')), 'terminal');
expect('empty file is terminal (the 0-byte-upload signature)',
  classifyPhotoUploadError(new Error('empty file — nothing to upload')), 'terminal');
expect('bucket not found is terminal',
  classifyPhotoUploadError(new Error('Bucket not found')), 'terminal');

expect('409 already-exists counts as UPLOADED, not failed',
  classifyPhotoUploadError(new Error('The resource already exists')), 'already-uploaded');
expect('a 500 is merely retryable',
  classifyPhotoUploadError(new Error('Internal Server Error')), 'retryable');
expect('a plain string error still classifies', classifyPhotoUploadError('boom'), 'retryable');
expect('a supabase error object (not an Error) still classifies',
  classifyPhotoUploadError({ message: 'Network request failed' }), 'transient');
ok('settled outcomes are exactly success + already-uploaded',
  isUploadSettled('success') && isUploadSettled('already-uploaded') &&
  !isUploadSettled('transient') && !isUploadSettled('terminal') && !isUploadSettled('retryable'));

// ── Outcome → keep/drop decision ────────────────────────────────────────────
expect('success dequeues', applyPhotoUploadOutcome(task(), 'success').keep, false);
expect('success is not a drop', applyPhotoUploadOutcome(task(), 'success').dropped, false);
expect('already-uploaded dequeues without a warning',
  applyPhotoUploadOutcome(task(), 'already-uploaded'), { keep: false, task: task(), dropped: false });

const offline = applyPhotoUploadOutcome(task({ retryCount: 3 }), 'transient');
ok('offline keeps the task queued', offline.keep);
expect('offline does NOT consume the retry budget', offline.task.retryCount, 3);
ok('offline is never reported as a drop', !offline.dropped);

const denied = applyPhotoUploadOutcome(task(), 'terminal');
ok('terminal dequeues', !denied.keep);
ok('terminal is surfaced as a drop (never silent)', denied.dropped);

const flaky = applyPhotoUploadOutcome(task({ retryCount: 0 }), 'retryable');
ok('retryable keeps the task', flaky.keep);
expect('retryable bumps the retry count', flaky.task.retryCount, 1);
const exhausted = applyPhotoUploadOutcome(task({ retryCount: PHOTO_MAX_RETRIES - 1 }), 'retryable');
ok('retry budget is bounded — the last failure drops', !exhausted.keep && exhausted.dropped);
expect('retry budget is 5', PHOTO_MAX_RETRIES, 5);
// A photo that is retryable-failing forever must not loop: prove the budget
// actually terminates by running it to exhaustion.
let walker = task({ retryCount: 0 });
let rounds = 0;
for (;;) {
  const d = applyPhotoUploadOutcome(walker, 'retryable');
  rounds++;
  if (!d.keep) break;
  walker = d.task;
  if (rounds > 50) break;
}
expect('a permanently-failing photo terminates after MAX_RETRIES attempts', rounds, PHOTO_MAX_RETRIES);

// ── Enqueue / dequeue ordering ──────────────────────────────────────────────
let q: PhotoUploadTask[] = [];
q = enqueuePhotoUpload(q, task({ id: 'a', storagePath: 'u/p/a.jpg', queuedAt: 300 })).queue;
q = enqueuePhotoUpload(q, task({ id: 'b', storagePath: 'u/p/b.jpg', queuedAt: 100 })).queue;
q = enqueuePhotoUpload(q, task({ id: 'c', storagePath: 'u/p/c.jpg', queuedAt: 200 })).queue;
expect('enqueue appends', q.map(t => t.id), ['a', 'b', 'c']);
expect('drain order is oldest-photo-first, not insertion order',
  sortPhotoQueue(q).map(t => t.id), ['b', 'c', 'a']);
expect('sort does not mutate the queue', q.map(t => t.id), ['a', 'b', 'c']);
expect('ties break deterministically (no flapping order)',
  sortPhotoQueue([task({ id: 'z', queuedAt: 5 }), task({ id: 'y', queuedAt: 5 })]).map(t => t.id), ['y', 'z']);

// ── Dedupe ──────────────────────────────────────────────────────────────────
// The path is deterministic per photo, so a re-save / double-tap / remount that
// replays the add would otherwise upload the same bytes N times.
const dupBase = enqueuePhotoUpload([], task({ id: 'first', storagePath: 'u/p/x.jpg', queuedAt: 100, retryCount: 2 })).queue;
const dup = enqueuePhotoUpload(dupBase, task({ id: 'second', storagePath: 'u/p/x.jpg', queuedAt: 900, localUri: 'file:///tmp/newer.jpg' }));
ok('re-queueing the same photo is reported as a dedupe', dup.deduped);
expect('dedupe does not grow the queue', dup.queue.length, 1);
expect('the newer localUri wins (it is the file actually on disk)', dup.queue[0].localUri, 'file:///tmp/newer.jpg');
expect('the original queuedAt is kept so a retried photo cannot starve newer ones', dup.queue[0].queuedAt, 100);
expect('the accrued retry count is kept (dedupe is not a budget reset)', dup.queue[0].retryCount, 2);
const notDup = enqueuePhotoUpload(dupBase, task({ id: 'other', storagePath: 'u/p/y.jpg' }));
ok('a different photo is NOT deduped', !notDup.deduped && notDup.queue.length === 2);

// ── Cap behavior ────────────────────────────────────────────────────────────
let capped: PhotoUploadTask[] = [];
let allDropped: PhotoUploadTask[] = [];
for (let i = 0; i < 6; i++) {
  const r = enqueuePhotoUpload(capped, task({ id: `t${i}`, storagePath: `u/p/${i}.jpg`, queuedAt: i }), 4);
  capped = r.queue;
  allDropped = allDropped.concat(r.dropped);
}
expect('queue never exceeds the cap', capped.length, 4);
expect('the cap sheds OLDEST first (FIFO), keeping the most recent photos',
  capped.map(t => t.id), ['t2', 't3', 't4', 't5']);
expect('shed entries are returned so their files can be reclaimed and the user warned',
  allDropped.map(t => t.id), ['t0', 't1']);
ok('cap is a positive bound', PHOTO_MAX_QUEUE > 0);
expect('bucket is the private project-photos bucket', PHOTO_BUCKET, 'project-photos');

// ── A queued item survives a failed flush ───────────────────────────────────
// The flush is slow and network-bound, so photos get taken DURING it. Writing
// back the flush's own list would erase them — this is the reconciliation that
// prevents it.
const before: PhotoUploadTask[] = [
  task({ id: 'done', storagePath: 'u/p/done.jpg' }),
  task({ id: 'offline', storagePath: 'u/p/offline.jpg' }),
  task({ id: 'gone', storagePath: 'u/p/gone.jpg' }),
];
const persistedNow = [...before, task({ id: 'shot-during-flush', storagePath: 'u/p/mid.jpg' })];
const keptFromFlush = applyPhotoUploadOutcome(before[1], 'transient').task;
const after = reconcilePhotoQueue(
  persistedNow,
  new Set(['done', 'offline', 'gone']),
  new Map([['offline', keptFromFlush]]),
);
expect('a photo that failed to upload STAYS queued; an uploaded one leaves; a photo taken mid-flush is preserved',
  after.map(t => t.id), ['offline', 'shot-during-flush']);
expect('the surviving task is byte-identical (offline never mutates it)', after[0], before[1]);

// A whole flush failing offline must leave the queue completely intact.
const allOffline = reconcilePhotoQueue(
  before, new Set(before.map(t => t.id)), new Map(before.map(t => [t.id, t] as const)),
);
expect('a totally failed flush loses nothing', allOffline.map(t => t.id), ['done', 'offline', 'gone']);
expect('an empty flush is a no-op', reconcilePhotoQueue(before, new Set(), new Map()).length, 3);

// ── Regression guards on the write path ─────────────────────────────────────
const storageSrc = readFileSync('utils/storage.ts', 'utf8');
ok('uploadProjectPhoto no longer bails out on web (photos must upload from the browser too)',
  !/uploadProjectPhoto[\s\S]{0,400}?Platform\.OS === 'web'/.test(storageSrc),
  'a web bail-out returning null is why web photos never reached Storage');
ok('uploadProjectPhoto does not persist a signed URL (they expire; the DB stores the path)',
  !/uploadProjectPhoto[\s\S]{0,600}?createSignedUrl\(/.test(storageSrc),
  'a 7-day signed URL in the database silently 400s a week later');
ok('uploadProjectPhoto is actually CALLED somewhere',
  /uploadProjectPhoto/.test(readFileSync('utils/photoUploadQueue.ts', 'utf8')),
  'the original bug was a correct uploader with zero call sites');

const fileBytesSrc = readFileSync('utils/fileBytes.ts', 'utf8');
// Strip comments — fileBytes.ts documents the old broken line verbatim, and
// prose describing a bug must not read as the bug.
const fileBytesCode = fileBytesSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('readFileBytes still handles web (fetch → arrayBuffer)',
  /Platform\.OS === 'web'[\s\S]{0,200}?arrayBuffer\(\)/.test(fileBytesCode));
ok('readFileBytes never uses fetch().blob() (an RN Blob uploads as ZERO bytes)',
  !/\.blob\(\)/.test(fileBytesCode),
  'reintroducing fetch().blob() on native silently writes empty objects — 537d74d');

// The write path must launder every photo column through durablePhotoValue().
// A bare `uri: <something>.uri` is how the original bug got into the table.
const ctxSrc = readFileSync('contexts/ProjectContext.tsx', 'utf8');
ok('the photos insert persists a durable path, not the render URI',
  /supabaseWrite\('photos', 'insert'[\s\S]{0,300}?uri: durablePhotoValue\(/.test(ctxSrc));
ok('punch_items persists a durable path',
  /photo_uri: durablePhotoValue\(/.test(ctxSrc));
ok('daily_reports photo array is sanitized before it is written',
  (ctxSrc.match(/photos: dfrPhotoRows\(/g) ?? []).length >= 2);
ok('no photo column is written straight from a raw uri field',
  !/\buri: (finalPhoto|photo|p)\.uri\b/.test(ctxSrc) && !/\bphoto_uri: (item|pi)\.photoUri\b/.test(ctxSrc),
  'writing the local URI to the server is the bug this whole file exists for');
ok('every capture surface funnels through the one staging helper',
  (ctxSrc.match(/stagePhotoUpload\(/g) ?? []).length >= 4,
  'gallery, punch items and DFR photos must all stage the same way');

// ── Wiring: a queue nothing drains is just a slower way to lose photos ──────
ok('the photo queue is drained by OfflineSyncManager',
  /processPhotoUploadQueue/.test(readFileSync('app/_layout.tsx', 'utf8')),
  'without a drain trigger, queued photos never upload');
ok('queueing also kicks an opportunistic drain',
  /scheduleOpportunisticDrain/.test(readFileSync('utils/photoUploadQueue.ts', 'utf8')),
  'a user who stays in the foreground would otherwise wait for a background/foreground cycle');
ok('the photo queue is wiped on tenant switch, like the offline write queue',
  /mageid_photo_upload_queue/.test(readFileSync('contexts/AuthContext.tsx', 'utf8')),
  'a pending upload must not follow one user onto the next tenant on a shared device');

// ── Testability invariant ───────────────────────────────────────────────────
// bun cannot parse `react-native`, so the moment this core imports it (directly
// or transitively) every assertion above stops running. Same rule that keeps
// utils/alertCore.ts and utils/base64Bytes.ts testable.
const coreSrc = readFileSync('utils/photoUploadCore.ts', 'utf8');
// Comments in these files legitimately discuss react-native and image bytes —
// compare against CODE only, or the prose explaining a rule trips the rule.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const coreCode = stripComments(coreSrc);
const queueCode = stripComments(readFileSync('utils/photoUploadQueue.ts', 'utf8'));
const coreImports = [...coreCode.matchAll(/^\s*import\s[\s\S]*?from\s+'([^']+)'/gm)].map(m => m[1]);
expect('the core has no imports at all — nothing can drag react-native in', coreImports, []);
ok('the RN-bound shell is a separate module', /from 'react-native'/.test(queueCode));

// The queue must not hold image BYTES — it is AsyncStorage-backed and that
// budget is measured in a few MB, total.
ok('queue entries carry a path, never bytes',
  !/base64|Uint8Array|arrayBuffer/.test(coreCode),
  'putting image data in an AsyncStorage-backed queue blows its budget in a handful of photos');
ok('a task records the local path and the destination path',
  /localUri: string/.test(coreCode) && /storagePath: string/.test(coreCode));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
