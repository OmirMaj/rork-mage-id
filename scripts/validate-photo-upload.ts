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
  PHOTO_RLS_MAX_RETRIES,
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
// Since 20260904100400_storage_membership_policies.sql folder[2] must ALSO be
// a project the caller can edit — which needs the `projects` ROW to exist; see
// the rls-pending block below for what that does to a project created offline.
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

expect('expired JWT is terminal', classifyPhotoUploadError(new Error('JWT expired')), 'terminal');

// ── a storage RLS refusal waits for its parent row — bounded ────────────────
// 20260904100400_storage_membership_policies.sql made `project_photos_upload`
// require the PROJECT ROW (can_access_project(folder[2], 'editor')), not just
// the JWT. A photo taken on a project created offline reaches Storage before
// that project's upsert has flushed through utils/offlineQueue.ts and is
// refused with "new row violates row-level security policy". This file used
// to pin that as TERMINAL — which deleted the bytes on the spot, on the one
// jobsite flow (new project, no signal, photos) the queue exists for. It is
// now re-queued on its own bounded counter: the next drain runs the offline
// queue first, the row lands, and the same upload succeeds.
expect('a storage RLS refusal is rls-pending, not terminal',
  classifyPhotoUploadError(new Error('new row violates row-level security policy')), 'rls-pending');
expect('...also as the raw postgres text',
  classifyPhotoUploadError(new Error('new row violates row-level security policy for table "objects"')), 'rls-pending');
expect('a bare SQLSTATE 42501 (insufficient_privilege) is rls-pending',
  classifyPhotoUploadError(new Error('42501')), 'rls-pending');
expect('a raw StorageApiError carrying status 403 is rls-pending',
  classifyPhotoUploadError({ message: 'Unauthorized', status: 403, statusCode: '403' }), 'rls-pending');
expect('a 401 stays terminal — the session, not the parent row, is the problem',
  classifyPhotoUploadError({ message: 'Unauthorized', status: 401, statusCode: '401' }), 'terminal');
expect('an offline device is still transient even when the message mentions a policy',
  classifyPhotoUploadError(new TypeError('Network request failed (row-level security)')), 'transient');
{
  const d1 = applyPhotoUploadOutcome(task(), 'rls-pending');
  expect('an rls-pending photo stays queued', d1.keep, true);
  expect('...with the wait counted on its own counter', d1.task.rlsRetryCount, 1);
  expect('...without spending the 5xx budget', d1.task.retryCount, 0);
  expect('...and is not reported as a drop', d1.dropped, false);
  // The two budgets must not add up: a 500 after waiting for the parent is
  // the FIRST 5xx strike, not the sixth.
  const d500 = applyPhotoUploadOutcome(task({ rlsRetryCount: PHOTO_RLS_MAX_RETRIES - 1 }), 'retryable');
  expect('a 500 after five waits is only the first 5xx strike', d500.task.retryCount, 1);
  expect('...and leaves the wait count alone', d500.task.rlsRetryCount, PHOTO_RLS_MAX_RETRIES - 1);
  ok('...and the photo is kept', d500.keep && !d500.dropped);
  // Exhaustion. The same message also means "the project upsert was dropped"
  // or "this user lost editor access", which no amount of waiting fixes — so
  // it MUST terminate, and terminate loudly.
  let waiting = task();
  let waits = 0;
  let droppedAtEnd = false;
  for (;;) {
    const d = applyPhotoUploadOutcome(waiting, 'rls-pending');
    waits++;
    if (!d.keep) { droppedAtEnd = d.dropped; break; }
    waiting = d.task;
    if (waits > 50) break;
  }
  expect('a photo refused under RLS on every flush is dropped after PHOTO_RLS_MAX_RETRIES attempts', waits, PHOTO_RLS_MAX_RETRIES);
  expect('...and the last refusal is surfaced as a drop, never silently settled', droppedAtEnd, true);
  expect('the RLS budget is 6', PHOTO_RLS_MAX_RETRIES, 6);
  ok('the RLS budget is wider than the 5xx budget (a parent row takes more drains to land than a server takes to recover)',
    PHOTO_RLS_MAX_RETRIES > PHOTO_MAX_RETRIES);
  expect('a task persisted before the counter existed counts from zero',
    applyPhotoUploadOutcome(task(), 'rls-pending').task.rlsRetryCount, 1);
}

// ── a revoked blob: URL is terminal, not transient ──────────────────────────
// THE IMMORTAL-TASK BUG. A blob:/data: URI is read from browser memory, but a
// failed read still throws `TypeError: Failed to fetch` — which classifies as
// transient, and the transient branch re-queues WITHOUT bumping retryCount.
// Since a blob: URL is revoked on page reload, the task could never succeed and
// could never be dropped: retried on every flush forever, invisible to the
// user, holding a capped FIFO slot that real photos get evicted from.
//
// utils/fileBytes.readFileBytes now converts a failed OBJECT-URL read into this
// distinct message so it can be told apart from a genuinely offline device.
expect('a revoked blob: URL is terminal',
  classifyPhotoUploadError(new Error(
    'photo source expired — the browser released this image when the page reloaded. Re-add the photo.')),
  'terminal');

// It must actually leave the queue, and be reported as dropped so the user is
// told rather than silently losing the photo.
{
  const revoked = task({ localUri: 'blob:http://localhost/9f2c-dead' });
  const decision = applyPhotoUploadOutcome(revoked, 'terminal', PHOTO_MAX_RETRIES);
  expect('a revoked blob leaves the queue', decision.keep, false);
  expect('...and is reported as dropped, not silently settled', decision.dropped, true);
}

// The guarantee this must NOT break: a genuinely offline device keeps its
// photos and never spends retry budget. The Supabase upload happens AFTER the
// read in utils/storage.uploadProjectPhoto, so a network failure there is still
// a plain TypeError and still transient.
{
  const live = task({ localUri: 'blob:http://localhost/9f2c-live' });
  const outcome = classifyPhotoUploadError(new TypeError('Failed to fetch'));
  expect('a network failure uploading a VALID blob is still transient', outcome, 'transient');
  const decision = applyPhotoUploadOutcome(live, outcome, PHOTO_MAX_RETRIES);
  expect('...so the photo stays queued', decision.keep, true);
  expect('...and burns no retry budget', decision.task.retryCount, 0);
}
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
{
  const waited = enqueuePhotoUpload([], task({ id: 'w1', storagePath: 'u/p/w.jpg', rlsRetryCount: 3 })).queue;
  const resaved = enqueuePhotoUpload(waited, task({ id: 'w2', storagePath: 'u/p/w.jpg' }));
  expect('the accrued RLS wait count survives a dedupe too', resaved.queue[0].rlsRetryCount, 3);
  ok('a task that never waited does not grow a counter on dedupe',
    !('rlsRetryCount' in enqueuePhotoUpload(dupBase, task({ id: 'again', storagePath: 'u/p/x.jpg' })).queue[0]));
}
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
// Window widened 200 → 500: the web branch now wraps the read in a try/catch so
// a revoked blob:/data: URL throws a distinct TERMINAL error instead of a
// TypeError that classifies as transient and is then retried forever. The
// assertion's intent is unchanged — web must still read via fetch → arrayBuffer
// — only the distance between the two grew.
ok('readFileBytes still handles web (fetch → arrayBuffer)',
  /Platform\.OS === 'web'[\s\S]{0,500}?arrayBuffer\(\)/.test(fileBytesCode));
// ...and that terminal conversion must stay wired, or the immortal-task bug
// comes back silently. Both strings live in CODE, so they survive the
// comment-strip above.
ok('readFileBytes converts a failed object-URL read into a terminal error',
  /blob:\|data:/.test(fileBytesCode) && /photo source expired/.test(fileBytesCode),
  'without this a revoked blob: URL reads as transient and is retried forever');
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
// The key itself moved to utils/localCacheKeys.ts (OFFLINE_WRITE_QUEUE_KEYS)
// when wipeLocalUserCache became a prefix sweep. Assert both halves so neither
// can quietly drop the other.
ok('the photo queue rides the offline-write-queue exemption',
  /'mageid_photo_upload_queue'/.test(readFileSync('utils/localCacheKeys.ts', 'utf8')),
  'it is a pending WRITE, not a cache — it must not be dropped on a same-user re-auth');
// A2 (2026-09-05): this used to pin `multiRemove(OFFLINE_WRITE_QUEUE_KEYS` in
// AuthContext. That multiRemove is gone on purpose — it ran OUTSIDE the queue's
// lock, so a flush that outlived the 20 s sign-out ceiling wrote its pre-wipe
// snapshot back and re-created the key with the previous tenant's photos. The
// wipe now calls clearPhotoUploadQueue(), which empties the key under the same
// lock the write-back takes (and unlinks the durable copies in
// documentDirectory, which the multiRemove never did). Same guarantee, new
// route — so the pin follows the route.
ok('the photo queue is wiped on tenant switch, like the offline write queue',
  /await clearPhotoUploadQueue\(\);/.test(readFileSync('contexts/AuthContext.tsx', 'utf8')),
  'a pending upload must not follow one user onto the next tenant on a shared device');
ok('…and that wipe is lock-safe, so a still-running flush cannot resurrect it',
  /export async function clearPhotoUploadQueue\(\): Promise<void> \{\s*const cleared = await withQueueLock\(/
    .test(readFileSync('utils/photoUploadQueue.ts', 'utf8')),
  'an unlocked removal races the flush write-back that is still in the air');

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

// ── The RLS wait is wired through the shell, and ordered right in the core ──
ok('the shell applies the RLS budget (not the 5xx one) to a refused upload',
  /applyPhotoUploadOutcome\(task, outcome, PHOTO_MAX_RETRIES, PHOTO_RLS_MAX_RETRIES\)/.test(queueCode),
  'without the fourth argument the wait silently falls back to the default budget');
ok('the shell tells the user something distinct when the wait is exhausted',
  /refused under storage RLS/.test(queueCode),
  'a Sentry line reading "terminal error" hides that the project row never synced');
{
  const termStart = coreCode.indexOf('function isTerminal(');
  const classifyStart = coreCode.indexOf('export function classifyPhotoUploadError');
  const termBody = termStart === -1 || classifyStart === -1 ? '' : coreCode.slice(termStart, classifyStart);
  ok('isTerminal was located', termBody.length > 0);
  ok('the core no longer lists "row-level security" among the terminal messages',
    termBody.length > 0 && !/row-level security/.test(termBody),
    'that string is how the membership-policy refusal reads; terminal means the bytes are deleted');
  const classifyBody = classifyStart === -1 ? '' : coreCode.slice(classifyStart);
  const rlsAt = classifyBody.indexOf('isRlsRejection(err, msg)');
  const termAt = classifyBody.indexOf('isTerminal(msg)');
  const transientAt = classifyBody.indexOf('isTransient(err, msg)');
  ok('classifyPhotoUploadError checks the RLS refusal AFTER transient and BEFORE terminal',
    rlsAt !== -1 && termAt !== -1 && transientAt !== -1 && transientAt < rlsAt && rlsAt < termAt,
    'order is the fix: terminal first would still delete the photo, RLS before transient would spend the wait budget offline');
}

// The queue must not hold image BYTES — it is AsyncStorage-backed and that
// budget is measured in a few MB, total.
ok('queue entries carry a path, never bytes',
  !/base64|Uint8Array|arrayBuffer/.test(coreCode),
  'putting image data in an AsyncStorage-backed queue blows its budget in a handful of photos');
ok('a task records the local path and the destination path',
  /localUri: string/.test(coreCode) && /storagePath: string/.test(coreCode));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
