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
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadProjectPhoto } from '@/utils/storage';
import {
  PHOTO_QUEUE_KEY,
  PHOTO_MAX_QUEUE,
  PHOTO_MAX_RETRIES,
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

export async function getPhotoUploadQueue(): Promise<PhotoUploadTask[]> {
  try {
    const stored = await AsyncStorage.getItem(PHOTO_QUEUE_KEY);
    return stored ? (JSON.parse(stored) as PhotoUploadTask[]) : [];
  } catch {
    return [];
  }
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

// Re-entrancy guard, mirroring offlineQueue.processOfflineQueue. Startup,
// AppState-foreground and the backoff drain can all fire while a flush is still
// in its network phase; two overlapping flushes would read the same snapshot
// and upload the same bytes twice.
let inFlight: Promise<{ uploaded: number; failed: number; remaining: number }> | null = null;

export function processPhotoUploadQueue(): Promise<{ uploaded: number; failed: number; remaining: number }> {
  if (inFlight) return inFlight;
  inFlight = runPhotoUploadQueue().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runPhotoUploadQueue(): Promise<{ uploaded: number; failed: number; remaining: number }> {
  // Lower the flag BEFORE the snapshot read below, never after. A photo
  // enqueued in the gap is then double-counted — it is in our snapshot AND
  // re-raises the flag — which costs one extra flush that finds an empty queue
  // and returns immediately. Lowering it after the read would instead SWALLOW
  // that photo: it would be outside the snapshot and have no flag left to
  // trigger a re-arm. Erring toward a redundant flush is the only safe
  // direction here; photos are legal documentation on a job.
  photoQueuedSinceSnapshot = false;

  if (!isSupabaseConfigured) return { uploaded: 0, failed: 0, remaining: 0 };

  const queue = await getPhotoUploadQueue();
  if (queue.length === 0) return { uploaded: 0, failed: 0, remaining: 0 };

  // A signed-out device must not fire uploads that will all 401 and burn the
  // retry budget — leave everything queued until a session exists.
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return { uploaded: 0, failed: 0, remaining: queue.length };
  } catch {
    return { uploaded: 0, failed: 0, remaining: queue.length };
  }

  console.log('[PhotoQueue] Processing', queue.length, 'queued photo upload(s)');
  const sorted = sortPhotoQueue(queue);

  const kept: PhotoUploadTask[] = [];
  const settled: PhotoUploadTask[] = [];
  const droppedTasks: PhotoUploadTask[] = [];
  let uploaded = 0;
  let failed = 0;

  async function runOne(task: PhotoUploadTask): Promise<void> {
    let outcome: ReturnType<typeof classifyPhotoUploadError> = 'success';
    try {
      await uploadProjectPhoto(task.localUri, task.storagePath, task.contentType);
    } catch (err) {
      outcome = classifyPhotoUploadError(err);
      if (outcome === 'transient') {
        console.log('[PhotoQueue] Offline/transient — keeping photo queued:', task.storagePath);
      } else if (outcome !== 'already-uploaded') {
        console.warn('[PhotoQueue] Upload failed:', task.storagePath, err);
      }
    }
    const decision = applyPhotoUploadOutcome(task, outcome, PHOTO_MAX_RETRIES);
    if (decision.keep) {
      kept.push(decision.task);
      return;
    }
    if (decision.dropped) {
      failed++;
      droppedTasks.push(decision.task);
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
    await Promise.all(sorted.slice(i, i + MAX_CONCURRENCY).map(runOne));
  }

  // Reclaim disk for everything we're done with — uploaded or given up on.
  for (const t of [...settled, ...droppedTasks]) void discardPendingCopy(t);
  if (droppedTasks.length > 0) {
    notifyDroppedPhotos(droppedTasks.length, 'terminal error or retry exhaustion');
  }

  // Atomic write-back under the lock, reconciled against whatever is persisted
  // NOW so photos taken during this flush survive it.
  const flushIds = new Set(sorted.map((t) => t.id));
  const keptById = new Map(kept.map((t) => [t.id, t] as const));
  const remaining = await withQueueLock(async () => {
    const current = await getPhotoUploadQueue();
    const next = reconcilePhotoQueue(current, flushIds, keptById);
    await setPhotoUploadQueue(next);
    return next.length;
  });

  console.log('[PhotoQueue] Done. Uploaded:', uploaded, 'Failed:', failed, 'Remaining:', remaining);
  return { uploaded, failed, remaining };
}
