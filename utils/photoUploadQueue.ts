// utils/photoUploadQueue.ts — durable, offline-first queue that gets photo
// BYTES into Supabase Storage.
//
// Read utils/photoUploadCore.ts first — it holds every decision this file
// makes (path construction, error classification, retry budget, dedupe, cap,
// write-back reconciliation) as pure functions so bun can test them. This file
// is only the AsyncStorage + expo-file-system + supabase-js shell around them.
//
// Contract with the UI: enqueueing NEVER blocks and NEVER fails a user action.
// A photo appears in the gallery instantly from its local URI; this queue moves
// the bytes whenever the network next allows. Nothing here is on the render
// path.
//
// Why the queue holds a PATH and not bytes: the existing text-mutation queue
// (utils/offlineQueue.ts) is AsyncStorage-backed. Multi-MB base64 images in
// AsyncStorage would blow its budget (and Android's per-row SQLite cursor
// limit) within a handful of photos. So a task is a few hundred bytes of
// metadata and the bytes are read off disk at upload time.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
// Legacy entrypoint: this file uses documentDirectory / getInfoAsync /
// makeDirectoryAsync / copyAsync / deleteAsync, which live on the old API and
// are NOT re-exported from the SDK 54 root. Same import the other 13
// filesystem callsites in this repo already use.
import * as FileSystem from 'expo-file-system/legacy';
import { isSupabaseConfigured } from '@/lib/supabase';
import { uploadProjectPhoto } from '@/utils/storage';
// A4 (round 3): who is signed in comes from the same auth-feed-backed value
// the text queue uses — never a per-call getSession() that can stall on a
// captive network — and A1 reads that queue to hold photos whose project row
// has not been sent yet.
import {
  bearerStillLive,
  currentSessionUserId,
  doomWatermark,
  expireDoomedProjectIds,
  getOfflineQueue,
  takeDoomedProjectIds,
  type RetainOptions,
  type RetainResult,
} from '@/utils/offlineQueue';
import {
  PHOTO_QUEUE_KEY,
  PHOTO_MAX_QUEUE,
  PHOTO_MAX_RETRIES,
  PHOTO_RLS_MAX_RETRIES,
  applyPhotoUploadOutcome,
  classifyPhotoUploadError,
  enqueuePhotoUpload,
  isDeviceLocalUri,
  reconcilePhotoQueue,
  sortPhotoQueue,
  type PhotoUploadTask,
} from '@/utils/photoUploadCore';

/**
 * Our own copy of every pending photo. ImagePicker / expo-camera hand back
 * URIs in the app's CACHE directory, which iOS and Android are free to purge
 * under storage pressure. A photo queued on a Monday with no signal would
 * simply be GONE by Wednesday. Copying into documentDirectory (which the OS
 * does not reclaim) is what makes "never lost if the upload can't run now"
 * actually true. The copy is deleted the moment the upload settles.
 */
const PENDING_DIR = `${FileSystem.documentDirectory ?? ''}mageid-photo-queue/`;

// Same serialization discipline as offlineQueue: every read-modify-write of the
// persisted queue runs one-at-a-time, so a photo enqueued DURING a flush can't
// be clobbered by the flush's write-back. The lock is NOT held across the
// (slow, network-bound) upload phase.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.then(() => undefined, () => undefined);
  return run;
}

/** The persisted queue, or a THROW if storage could not produce one — the twin
 *  of offlineQueue.readOfflineQueueOrThrow, and for the same reason (A8): the
 *  retain path below must be able to tell "storage refused" from "there was
 *  nothing to keep" before AuthContext stamps the last-user marker over it. */
async function readPhotoUploadQueueOrThrow(): Promise<PhotoUploadTask[]> {
  const stored = await AsyncStorage.getItem(PHOTO_QUEUE_KEY);
  return stored ? (JSON.parse(stored) as PhotoUploadTask[]) : [];
}

export async function getPhotoUploadQueue(): Promise<PhotoUploadTask[]> {
  try {
    return await readPhotoUploadQueueOrThrow();
  } catch {
    return [];
  }
}

// A3 (round 3): the photos the CURRENT session can still upload — the twin of
// offlineQueue.getOwnOfflineQueue, and what a UI must count. The persisted
// queue can also hold another tenant's tasks (kept for the tenant switch to
// drop); telling this user "2 photos will be lost" about someone else's
// jobsite is both wrong and alarming. No session → nothing is anyone's.
export async function getOwnPhotoUploadQueue(): Promise<PhotoUploadTask[]> {
  const sessionUserId = await currentSessionUserId();
  if (!sessionUserId) return [];
  return (await getPhotoUploadQueue()).filter((t) => t.userId === sessionUserId);
}

async function setPhotoUploadQueue(queue: PhotoUploadTask[]): Promise<void> {
  await AsyncStorage.setItem(PHOTO_QUEUE_KEY, JSON.stringify(queue));
}

/**
 * A photo was permanently discarded. Silent loss is the worst failure mode for
 * an offline-first app and photos are legal documentation on a construction
 * job — surface it and forward to Sentry. Lazy requires keep this module
 * side-effect free at load (same pattern as offlineQueue.notifyDroppedWrites).
 */
function notifyDroppedPhotos(count: number, reason: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { oops } = require('@/components/animations/NailItToast');
    oops(`${count} photo(s) couldn't be uploaded and were dropped. Please re-take them.`);
  } catch {/* toast host not mounted — nothing actionable */}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[PhotoQueue] dropped ${count} photo upload(s) (${reason})`, 'warning');
  } catch {/* ignore */}
}

/** Best-effort removal of our durable copy once a task is finished with. */
async function discardPendingCopy(task: PhotoUploadTask): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!task.localUri.startsWith(PENDING_DIR)) return; // not ours — never delete the user's original
  try {
    await FileSystem.deleteAsync(task.localUri, { idempotent: true });
  } catch {/* ignore — a leftover file is harmless */}
}

// A2 (round 3): the ONLY way to empty the photo queue — the twin of
// offlineQueue.clearOfflineQueue. Under the same lock as the flush's
// write-back, so a flush that outlives the sign-out ceiling cannot read the
// queue before the wipe and write its snapshot back after it. The durable
// copies go with their tasks: on a tenant switch they are the previous
// user's jobsite photos sitting in this app's documents folder.
export async function clearPhotoUploadQueue(): Promise<void> {
  const cleared = await withQueueLock(async () => {
    const current = await getPhotoUploadQueue();
    await AsyncStorage.removeItem(PHOTO_QUEUE_KEY);
    return current;
  });
  for (const t of cleared) void discardPendingCopy(t);
}

// Same lock discipline for AuthContext's marker-less keep path: keep only the
// tasks queued by `userId`, drop (and unlink) the rest. `dropUntagged: false`
// spares a task with no `userId` at all — see RetainOptions in
// utils/offlineQueue.ts for when a caller may assert that.
//
// (A photo task has carried its uploading user since the queue shipped —
// queuePhotoUpload refuses one without it — so an untagged task here can only
// come off a pre-field install. The option exists so both queues answer the
// arriving session with the same rule, decided in one place.)
export async function retainPhotoUploadQueueForUser(userId: string, opts: RetainOptions = {}): Promise<RetainResult> {
  const res = await withQueueLock(async () => {
    const dropUntagged = opts.dropUntagged ?? true;
    let current: PhotoUploadTask[];
    try {
      current = await readPhotoUploadQueueOrThrow();
    } catch (err) {
      // A8: storage refused. Nothing inspected, nothing written, no bytes
      // unlinked — and the caller is told, so it does not read the zeroes below
      // as "there was nothing of anyone's here".
      console.warn('[PhotoQueue] Could not read the queue to narrow it — leaving it untouched:', err);
      return { gone: [] as PhotoUploadTask[], kept: 0, readFailed: true };
    }
    const own = current.filter((t) => t.userId === userId || (!t.userId && !dropUntagged));
    if (own.length === current.length) return { gone: [] as PhotoUploadTask[], kept: own.length, readFailed: false };
    if (own.length === 0) await AsyncStorage.removeItem(PHOTO_QUEUE_KEY);
    else await setPhotoUploadQueue(own);
    // By identity against what we kept, not by re-testing the predicate: with
    // `dropUntagged: false` an untagged task passes `t.userId !== userId` too,
    // and unlinking its bytes is exactly what this call was told not to do.
    const keptSet = new Set(own);
    return { gone: current.filter((t) => !keptSet.has(t)), kept: own.length, readFailed: false };
  });
  for (const t of res.gone) void discardPendingCopy(t);
  return { kept: res.kept, dropped: res.gone.length, readFailed: res.readFailed };
}

/**
 * Copy a freshly-picked image into documentDirectory so the OS can't reclaim
 * it before we get signal. Returns the durable URI, or the original on any
 * failure (a queued upload from a cache URI is still far better than none) and
 * on web, where there is no filesystem — a blob: URL stays valid for the life
 * of the document, and a browser is essentially always online when it isn't.
 */
async function persistLocalCopy(localUri: string, storagePath: string): Promise<string> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return localUri;
  if (!localUri.startsWith('file://')) return localUri; // ph:// / content:// can't be copied directly
  try {
    const info = await FileSystem.getInfoAsync(PENDING_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true });
    const target = `${PENDING_DIR}${storagePath.replace(/\//g, '_')}`;
    // Stage into a unique temp file and MOVE it into place, rather than
    // delete-then-copy. Two surfaces can legitimately stage the same photo at
    // once — a daily report mirrors its photos into the gallery, so both paths
    // resolve to the same deterministic key — and with delete-then-copy a flush
    // landing in that window would read a target that momentarily does not
    // exist, classify ENOENT as terminal, and DROP the photo. A move leaves the
    // target as either the old complete file or the new one, never absent.
    const staged = `${target}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.part`;
    await FileSystem.copyAsync({ from: localUri, to: staged });
    await FileSystem.moveAsync({ from: staged, to: target });
    return target;
  } catch (err) {
    console.warn('[PhotoQueue] Could not stage a durable copy; queueing the original URI:', err);
    return localUri;
  }
}

export interface QueuePhotoInput {
  photoId: string;
  userId: string;
  projectId: string;
  localUri: string;
  storagePath: string;
  contentType: string;
}

/**
 * Queue a photo's bytes for upload. Fire-and-forget — callers `void` this and
 * carry on rendering. Never throws.
 */
export async function queuePhotoUpload(input: QueuePhotoInput): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (!input.userId || !input.localUri || !input.storagePath) return;
  // A remote URL has nothing to upload (e.g. a photo rehydrated from the
  // server and re-saved). Only device-local bytes belong in this queue.
  if (!isDeviceLocalUri(input.localUri)) return;

  try {
    const durableUri = await persistLocalCopy(input.localUri, input.storagePath);
    const task: PhotoUploadTask = {
      id: `pq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      photoId: input.photoId,
      userId: input.userId,
      projectId: input.projectId,
      localUri: durableUri,
      storagePath: input.storagePath,
      contentType: input.contentType,
      queuedAt: Date.now(),
      retryCount: 0,
    };
    await withQueueLock(async () => {
      const current = await getPhotoUploadQueue();
      const { queue, dropped } = enqueuePhotoUpload(current, task, PHOTO_MAX_QUEUE);
      await setPhotoUploadQueue(queue);
      if (dropped.length > 0) {
        console.warn(`[PhotoQueue] cap ${PHOTO_MAX_QUEUE} exceeded — dropped ${dropped.length} oldest photo(s)`);
        for (const d of dropped) void discardPendingCopy(d);
        notifyDroppedPhotos(dropped.length, 'queue cap exceeded');
      }
    });
    // Raised only AFTER the photo is persisted, so the flag can never mean
    // anything but "a task exists on disk that a running flush's snapshot
    // predates". Raising it before the write would let a flush that snapshots
    // in the gap clear it and lose the photo. See scheduleOpportunisticDrain.
    photoQueuedSinceSnapshot = true;
    scheduleOpportunisticDrain();
  } catch (err) {
    console.warn('[PhotoQueue] Failed to queue photo upload:', err);
  }
}

let drainTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Raised by queuePhotoUpload once a task is on disk, lowered by
 * runPhotoUploadQueue the instant it takes its snapshot. `true` therefore means
 * exactly one thing: a queued photo exists that the currently-running flush
 * cannot see.
 *
 * WHY IT EXISTS. processPhotoUploadQueue coalesces — a second caller gets the
 * FIRST flush's promise back, and that flush's queue snapshot predates the new
 * photo. So a photo taken during a flush used to: schedule a drain, fire it
 * 1500 ms later, be handed the older flush's promise, and have the result
 * (`remaining: 1` and all) thrown away by a bare `.catch()`. drainTimer was
 * already null, so nothing re-armed, and OfflineSyncManager's backoff is idle
 * whenever the user is online and synced — which is the normal case this drain
 * was written for. The bytes then sat in documentDirectory until the next
 * foreground cycle, and were lost outright if the app was deleted first: a
 * super shooting a burst one frame at a time got only the FIRST photo of each
 * burst into Storage, and the client portal / homeowner digest / every other
 * device silently missed the rest.
 */
let photoQueuedSinceSnapshot = false;

/**
 * Try to upload right away instead of waiting for the next foreground.
 *
 * OfflineSyncManager drains on startup / foreground / backoff, but its backoff
 * only re-arms while something is still queued — so a photo taken by a user who
 * is online and stays in the app would otherwise sit on disk until they
 * backgrounded it, and be lost outright if they deleted the app first.
 *
 * Debounced because a daily-report save enqueues its whole roll in one tick and
 * we want ONE flush, not eight. Offline, the attempt simply classifies as
 * transient and costs nothing — there is no connectivity API here, so trying is
 * how we find out (exactly how supabaseWrite behaves).
 *
 * Scheduling alone is not enough: the flush this fires may be COALESCED into an
 * older one that cannot see the photo we were scheduled for. So the drain now
 * inspects its own result and re-arms itself once when there is provably more
 * to do — see photoQueuedSinceSnapshot above.
 */
function scheduleOpportunisticDrain(): void {
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void processPhotoUploadQueue()
      .then((res) => {
        // Re-arm only on positive evidence that another pass can achieve
        // something:
        //   • photoQueuedSinceSnapshot — we coalesced onto a flush that had
        //     already read the queue, so our photo was never attempted.
        //   • uploaded > 0 && remaining > 0 — the uplink is demonstrably alive
        //     and the flush still left work behind (a burst that hiccupped
        //     part-way through).
        //
        // Deliberately NOT a bare `remaining > 0`: offline, EVERY flush ends
        // with remaining > 0 forever, which would turn this into a 1500 ms hot
        // loop re-attempting multi-MB uploads on a jobsite with no signal.
        // Retrying an offline device is OfflineSyncManager's exponential
        // backoff's job, not this function's. Both clauses above terminate —
        // the first needs a brand-new photo, the second needs a photo to have
        // actually left the queue, and the queue is capped at PHOTO_MAX_QUEUE.
        if (photoQueuedSinceSnapshot || (res.uploaded > 0 && res.remaining > 0)) {
          scheduleOpportunisticDrain();
        }
      })
      .catch(() => {/* the queue keeps the work */});
  }, 1500);
}

/** What a flush did. `remaining` counts THIS session's photos still queued;
 *  `foreign` the tasks left untouched because they were queued by someone else
 *  (or, with no session at all, every task). A3: same contract as
 *  offlineQueue's FlushResult — the sync manager backs off on `remaining`
 *  alone, never on another tenant's leftovers. */
export interface PhotoFlushResult { uploaded: number; failed: number; remaining: number; foreign: number }

// Re-entrancy guard, mirroring offlineQueue.processOfflineQueue. Startup,
// AppState-foreground and the backoff drain can all fire while a flush is still
// in its network phase; two overlapping flushes would read the same snapshot
// and upload the same bytes twice.
let inFlight: Promise<PhotoFlushResult> | null = null;

export function processPhotoUploadQueue(): Promise<PhotoFlushResult> {
  if (inFlight) return inFlight;
  // A8 (review 2026-09-05, round 5): the doomed-project verdict is THIS drain's
  // to spend. runPhotoUploadQueue takes it only once it has photos of its own
  // to settle, so on every other path — an empty queue above all, which is the
  // usual state right after a `projects` insert is refused — it used to be left
  // behind for good: never shrinking, and still lethal to a photo taken for
  // that project id long afterwards. The mark is read BEFORE the run so a
  // verdict recorded while this drain was in its network phase is not spent by
  // it; that one belongs to the drain that follows.
  const doomMark = doomWatermark();
  inFlight = runPhotoUploadQueue()
    .then((res) => {
      const spent = expireDoomedProjectIds(doomMark);
      if (spent.length > 0) {
        console.log('[PhotoQueue] Verdict spent: no queued photos for', spent.length, 'doomed project(s)');
      }
      return res;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runPhotoUploadQueue(): Promise<PhotoFlushResult> {
  // Lower the flag BEFORE the snapshot read below, never after. A photo
  // enqueued in the gap is then double-counted — it is in our snapshot AND
  // re-raises the flag — which costs one extra flush that finds an empty queue
  // and returns immediately. Lowering it after the read would instead SWALLOW
  // that photo: it would be outside the snapshot and have no flag left to
  // trigger a re-arm. Erring toward a redundant flush is the only safe
  // direction here; photos are legal documentation on a job.
  photoQueuedSinceSnapshot = false;

  if (!isSupabaseConfigured) return { uploaded: 0, failed: 0, remaining: 0, foreign: 0 };

  const queue = await getPhotoUploadQueue();
  if (queue.length === 0) return { uploaded: 0, failed: 0, remaining: 0, foreign: 0 };

  // A signed-out device must not fire uploads that will all 401 and burn the
  // retry budget — leave everything queued until a session exists.
  //
  // B1 (review 2026-09-05): and the flush is bound to THAT session. Every task
  // names its uploading user (folder[1] of the storage path, which RLS
  // enforces), so a task queued by anyone but the session user is left in
  // storage untouched — never pushed under the next tenant's JWT on a shared
  // device — and the session is re-read before every batch: the moment it ends
  // or changes hands, dispatch stops and the rest stays queued, nothing
  // dropped. AuthContext's sign-in paths drop a previous tenant's queue on the
  // tenant switch; this is what keeps the window before that drop closed.
  const sessionUserId = await currentSessionUserId();
  if (!sessionUserId) return { uploaded: 0, failed: 0, remaining: 0, foreign: queue.length };

  // A3: ours vs. not ours, for whichever list is persisted at the time.
  const splitOwn = (tasks: readonly PhotoUploadTask[]): { remaining: number; foreign: number } => {
    let own = 0;
    for (const t of tasks) if (t.userId === sessionUserId) own++;
    return { remaining: own, foreign: tasks.length - own };
  };

  const own = sortPhotoQueue(queue).filter((t) => t.userId === sessionUserId);
  if (own.length < queue.length) {
    console.log('[PhotoQueue] Skipping', queue.length - own.length, 'queued photo(s) that belong to another session');
  }
  if (own.length === 0) return { uploaded: 0, failed: 0, ...splitOwn(queue) };

  // A7 (round 4): the projects the text flush just dropped for good — its
  // verdict, handed over through utils/offlineQueue.takeDoomedProjectIds()
  // because that module cannot import this one. `projects` never reached the
  // server (or is not this user's to touch), so project_photos_upload's
  // can_access_project can never pass for these bytes. Dispatching them buys
  // PHOTO_RLS_MAX_RETRIES round trips and a SECOND toast a day later; they go
  // now, counted as failed, named in this flush's one report — the same call
  // the offline queue makes for a doomed project's text children.
  //
  // Taken AFTER the ownership split, so a drain that never gets this far has
  // not silently swallowed a verdict mid-way. It does not OUTLIVE this drain
  // either way: processPhotoUploadQueue expires whatever is left unconsumed
  // when the run ends (A8) — the alternative was a verdict from an empty-queue
  // drain sitting in memory for the life of the process and dropping a photo
  // taken for that project an hour later.
  const doomedProjects = takeDoomedProjectIds();
  const doomed = doomedProjects.size > 0 ? own.filter((t) => doomedProjects.has(t.projectId)) : [];
  const survivors = doomed.length > 0 ? own.filter((t) => !doomedProjects.has(t.projectId)) : own;
  if (doomed.length > 0) {
    console.warn('[PhotoQueue] Dropping', doomed.length, 'photo(s) with the project whose own write was rejected');
  }

  // A1 (round 3): parents before bytes, decided HERE rather than at Storage.
  // project_photos_upload needs the `projects` row, and a project created
  // offline is a queued insert/upsert in utils/offlineQueue.ts until its flush
  // lands. That queue is read ONCE, and every task whose project is still in
  // it is held: not part of this flush at all, so reconcile writes it back
  // verbatim — no upload attempted, none of its PHOTO_RLS_MAX_RETRIES spent on
  // a refusal that was certain. It waits for the drain in which the row lands.
  const pendingProjects = new Set<string>();
  try {
    for (const m of await getOfflineQueue()) {
      if (m.table === 'projects' && (m.operation === 'insert' || m.operation === 'upsert') && typeof m.data?.id === 'string') {
        pendingProjects.add(m.data.id);
      }
    }
  } catch { /* unreadable text queue — gate nothing; Storage decides */ }
  const sorted = survivors.filter((t) => !pendingProjects.has(t.projectId));
  if (sorted.length < survivors.length) {
    console.log('[PhotoQueue] Holding', survivors.length - sorted.length, 'photo(s) until their project row lands');
  }
  // A7: a flush with nothing to upload still has to settle the doomed tasks —
  // remove them from storage, unlink their bytes, and report them.
  if (sorted.length === 0 && doomed.length === 0) return { uploaded: 0, failed: 0, ...splitOwn(queue) };

  if (sorted.length > 0) console.log('[PhotoQueue] Processing', sorted.length, 'queued photo upload(s)');

  const kept: PhotoUploadTask[] = [];
  const settled: PhotoUploadTask[] = [];
  const droppedTasks: PhotoUploadTask[] = [...doomed];
  let uploaded = 0;
  let failed = doomed.length;
  let rlsExhausted = 0;
  // A4: raised when a refusal turned out to have been answered to a request
  // with no user token on it — the rest of the flush is left queued.
  let noBearer = false;

  async function runOne(task: PhotoUploadTask): Promise<void> {
    let outcome: ReturnType<typeof classifyPhotoUploadError> = 'success';
    try {
      await uploadProjectPhoto(task.localUri, task.storagePath, task.contentType);
    } catch (err) {
      outcome = classifyPhotoUploadError(err);
      // A4: Storage refused a request that carried NO user token (the access
      // token expired and gotrue could not refresh it, so supabase-js sent the
      // anon key). That is not a verdict on the photo: keep it unchanged and
      // stop the flush; the next drain runs under a live bearer or not at all.
      if ((outcome === 'terminal' || outcome === 'rls-pending') && !(await bearerStillLive())) {
        console.warn('[PhotoQueue] Refused with no live bearer — not a verdict, leaving the rest queued:', task.storagePath);
        noBearer = true;
        kept.push(task);
        return;
      }
      if (outcome === 'transient') {
        console.log('[PhotoQueue] Offline/transient — keeping photo queued:', task.storagePath);
      } else if (outcome === 'rls-pending') {
        // Storage's membership policy needs the `projects` row; on a project
        // created offline that row is usually still in utils/offlineQueue.ts.
        // Every drain runs that queue FIRST, so the next pass normally lands
        // it — kept, on its own bounded counter (PHOTO_RLS_MAX_RETRIES).
        console.log('[PhotoQueue] Storage refused the upload under RLS — project row not synced yet? Retrying after the next flush:', task.storagePath);
      } else if (outcome !== 'already-uploaded') {
        console.warn('[PhotoQueue] Upload failed:', task.storagePath, err);
      }
    }
    const decision = applyPhotoUploadOutcome(task, outcome, PHOTO_MAX_RETRIES, PHOTO_RLS_MAX_RETRIES);
    if (decision.keep) {
      kept.push(decision.task);
      return;
    }
    if (decision.dropped) {
      failed++;
      droppedTasks.push(decision.task);
      if (outcome === 'rls-pending') {
        rlsExhausted++;
        console.warn('[PhotoQueue] Storage refused the upload under RLS on', PHOTO_RLS_MAX_RETRIES, 'flushes — project row never synced, or no editor access. Dropping:', task.storagePath);
      }
    } else {
      uploaded++;
      settled.push(decision.task);
    }
  }

  // Bounded concurrency. Deliberately lower than offlineQueue's 5: these are
  // multi-MB bodies, and saturating a jobsite LTE link makes every upload time
  // out rather than making any of them finish.
  const MAX_CONCURRENCY = 2;
  for (let i = 0; i < sorted.length; i += MAX_CONCURRENCY) {
    // B1: still the session this flush started under? If not, every task not
    // yet attempted is kept exactly as it is (unchanged object → reconcile
    // writes it back verbatim) and the loop ends. Same when the last batch
    // found no live bearer behind the session (A4).
    if (noBearer) {
      kept.push(...sorted.slice(i));
      break;
    }
    if ((await currentSessionUserId()) !== sessionUserId) {
      console.warn('[PhotoQueue] Session ended or changed hands mid-flush — leaving the rest queued');
      kept.push(...sorted.slice(i));
      break;
    }
    await Promise.all(sorted.slice(i, i + MAX_CONCURRENCY).map(runOne));
  }

  // Reclaim disk for everything we're done with — uploaded or given up on.
  for (const t of [...settled, ...droppedTasks]) void discardPendingCopy(t);
  if (droppedTasks.length > 0) {
    // A7: ONE report per flush, whatever mix of reasons it holds — a doomed
    // project's photos are named alongside the rest, not in a toast of their own.
    const why: string[] = [];
    if (rlsExhausted > 0) {
      why.push(`${rlsExhausted} refused under storage RLS ${PHOTO_RLS_MAX_RETRIES}x (project row never synced, or no editor access)`);
    }
    if (doomed.length > 0) {
      why.push(`${doomed.length} dropped with a project whose own queued write was rejected`);
    }
    notifyDroppedPhotos(
      droppedTasks.length,
      why.length > 0 ? `terminal error or retry exhaustion; ${why.join('; ')}` : 'terminal error or retry exhaustion',
    );
  }

  // Atomic write-back under the lock, reconciled against whatever is persisted
  // NOW so photos taken during this flush survive it. A7: the doomed tasks are
  // part of this flush too — without their ids here reconcile would preserve
  // them verbatim and the next drain would drop them all over again.
  const flushIds = new Set([...sorted, ...doomed].map((t) => t.id));
  const keptById = new Map(kept.map((t) => [t.id, t] as const));
  const persisted = await withQueueLock(async () => {
    const current = await getPhotoUploadQueue();
    // A2: emptied under this lock while the flush was in flight
    // (clearPhotoUploadQueue) — nothing to reconcile into, nothing written.
    if (current.length === 0) return [] as PhotoUploadTask[];
    const next = reconcilePhotoQueue(current, flushIds, keptById);
    await setPhotoUploadQueue(next);
    return next;
  });
  const { remaining, foreign } = splitOwn(persisted);

  console.log('[PhotoQueue] Done. Uploaded:', uploaded, 'Failed:', failed, 'Remaining:', remaining, 'Foreign:', foreign);
  return { uploaded, failed, remaining, foreign };
}
