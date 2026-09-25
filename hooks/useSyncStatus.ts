// hooks/useSyncStatus — the honest, whole-device answer to "is my work saved?"
//
// Supersedes hooks/useOfflineQueueDepth for anything that renders a claim to
// the user. That hook counts ONE of the three durable queues and cannot see a
// write that has permanently failed; both facts are documented in
// utils/syncStatusCore.ts. It stays exported and unchanged because it is a
// correct, cheap "how deep is the text queue" reader and other code may want
// exactly that.
//
// ── One read, not four ──────────────────────────────────────────────────────
// The three queues and the failure ledger are four AsyncStorage keys. Reading
// them through their own getters would be four round trips AND would lose the
// distinction between "empty" and "storage refused" — every one of those
// getters catches and returns []. So this hook does ONE `multiGet` and parses
// with the modules' own exported pure parsers:
//
//   mageid_offline_queue          → offlineQueue.partitionQueueForSession
//   mageid_photo_upload_queue     → userId filter (the queue's own rule)
//   mageid_audio_transcribe_queue → audioTranscribeCore.parseAudioQueue
//   mageid_sync_failures          → syncLedger.parseFailures
//
// A throw from multiGet, or a JSON parse failure on any of them, sets
// `readFailed` and the pill says "couldn't check" instead of a green nothing.
//
// ── Tenant scoping ──────────────────────────────────────────────────────────
// Every queue on this device can hold the PREVIOUS contractor's work, kept only
// until the tenant switch drops it (see getOwnOfflineQueue's A3 note). This
// hook counts only entries tagged for the live session, plus — for the text
// queue only, and only through partitionQueueForSession — untagged entries the
// device's last-user marker names as this user's. Photos, dictations and
// failures have no marker fallback: an untagged entry there is nobody's.
//
// ── Cadence ─────────────────────────────────────────────────────────────────
// The queue's own onQueueChanged / onQueueFlushed events, the ledger's change
// event and AppState wake each trigger an immediate re-read, so the count ticks
// down as a flush lands. The poll is only the backstop for a write those events
// miss, so it is 30 s (smoothness pass): this read JSON-parses the whole
// offline queue, the hook is mounted twice, and at 4 s it was a visible hitch
// offline on site with a big queue. A re-read that finds nothing changed sets
// no state, so it re-renders nothing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  currentSessionUserId,
  onQueueChanged,
  onQueueFlushed,
  partitionQueueForSession,
  type OfflineMutation,
} from '@/utils/offlineQueue';
import { PHOTO_QUEUE_KEY, type PhotoUploadTask } from '@/utils/photoUploadCore';
import { AUDIO_QUEUE_KEY, parseAudioQueue } from '@/utils/audioTranscribeCore';
import {
  SYNC_FAILURE_KEY,
  failureLabels,
  ownFailures,
  parseFailures,
  acknowledgeSyncFailures,
  discardUnsavedWrite,
  humanDropReason,
  isRetryableFailure,
  onSyncLedgerChanged,
  retryUnsavedWrite,
  type SyncFailure,
} from '@/utils/syncLedger';
import { computeSyncStatus, unsavedLines, type SyncStatus, type UnsavedLine } from '@/utils/syncStatusCore';

const POLL_INTERVAL_MS = 30_000;
/** Photo and voice-note uploads emit no queue event, so while either queue
 *  holds work the pill re-reads every 4 s (as it always did) and clears within
 *  seconds of the upload finishing. Otherwise the 30 s poll is only a backstop
 *  for the text writes the queue and ledger events already cover. */
const UPLOAD_POLL_MS = 4_000;

/** Duplicated from utils/offlineQueue (a module-private const there) so this
 *  hook can batch all four reads into one multiGet. Pinned by
 *  scripts/validate-sync-status.ts against the literal in that file. */
const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';

/** The device's last-signed-in user marker, written by contexts/AuthContext.
 *  Read for exactly one reason: partitionQueueForSession needs it to decide
 *  whether an UNTAGGED text-queue entry (queued before per-entry tagging
 *  shipped) belongs to this session. Same literal, same reason, as the copy in
 *  utils/offlineQueue.ts. */
const LAST_USER_ID_KEY = 'mageid_last_user_id';

const EMPTY: SyncStatus = computeSyncStatus(
  { depths: { writes: 0, photos: 0, dictations: 0 }, failures: { count: 0, labels: [] }, readFailed: false, signedIn: false },
);

/** #1: the "not saved" sheet's rows, from this session's ledger entries. */
function linesFrom(failures: readonly SyncFailure[]): UnsavedLine[] {
  return unsavedLines(failures.map((f) => ({
    id: f.id,
    label: f.label,
    reason: f.reason,
    at: f.at,
    canRetry: isRetryableFailure(f),
    ...(f.operation ? { operation: f.operation } : {}),
    ...(f.table && f.recordId ? { recordKey: `${f.table}:${f.recordId}` } : {}),
  })));
}

/** Would the user see any difference between these two statuses? Every field
 *  the pill and its sheet read, so an unchanged re-read can keep the old
 *  object and skip the render. */
export function statusEqual(a: SyncStatus, b: SyncStatus): boolean {
  return a.tone === b.tone
    && a.pending === b.pending
    && a.failed === b.failed
    && a.visible === b.visible
    && a.badge === b.badge
    && a.title === b.title
    && a.detail === b.detail
    && a.depths.writes === b.depths.writes
    && a.depths.photos === b.depths.photos
    && a.depths.dictations === b.depths.dictations;
}

/** The same question for the "not saved" sheet's rows: every field a row
 *  renders or acts on, in order. */
export function unsavedEqual(a: readonly UnsavedLine[], b: readonly UnsavedLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.label !== y.label || x.line !== y.line || x.canRetry !== y.canRetry
      || x.writes !== y.writes || x.discards !== y.discards) return false;
  }
  return true;
}

export interface SyncStatusHandle extends SyncStatus {
  /** One row per unsaved record, for the sheet behind a red badge. */
  unsaved: UnsavedLine[];
  /** Resend one record's unsaved writes (the only path that resends). */
  retryUnsaved: (id: string) => Promise<'synced' | 'queued' | 'failed'>;
  /** Remove one record's unsaved writes from this device's record — its row
   *  is then dropped by the next list read. The only path that removes one. */
  discardUnsaved: (id: string) => Promise<void>;
  /** Forget the recorded failures. An ACKNOWLEDGEMENT, not a recovery — the
   *  data is gone from the queue and the user has to re-enter it. Call sites
   *  must say so. Re-reads immediately so the badge clears at once. */
  acknowledgeFailures: () => Promise<void>;
  /** Force a re-read (e.g. a screen the user just pulled to refresh). */
  refresh: () => Promise<void>;
}

export function useSyncStatus(): SyncStatusHandle {
  const [status, setStatus] = useState<SyncStatus>(EMPTY);
  const [unsaved, setUnsaved] = useState<UnsavedLine[]>([]);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    let next: SyncStatus;
    let lines: UnsavedLine[] = [];
    try {
      const userId = await currentSessionUserId();
      if (!userId) {
        next = EMPTY;
      } else {
        const pairs = await AsyncStorage.multiGet([
          OFFLINE_QUEUE_KEY, PHOTO_QUEUE_KEY, AUDIO_QUEUE_KEY, SYNC_FAILURE_KEY, LAST_USER_ID_KEY,
        ]);
        const raw = new Map(pairs.map(([k, v]) => [k, v] as const));
        let readFailed = false;

        // Text queue. partitionQueueForSession owns the marker rule.
        let writes = 0;
        try {
          const stored = raw.get(OFFLINE_QUEUE_KEY);
          const queue = stored ? (JSON.parse(stored) as OfflineMutation[]) : [];
          const marker = raw.get(LAST_USER_ID_KEY) ?? null;
          writes = partitionQueueForSession(Array.isArray(queue) ? queue : [], userId, marker).own.length;
        } catch { readFailed = true; }

        // Photo queue. Same ownership rule as getOwnPhotoUploadQueue: tagged
        // for this session or it is not ours. No marker fallback.
        let photos = 0;
        try {
          const stored = raw.get(PHOTO_QUEUE_KEY);
          const queue = stored ? (JSON.parse(stored) as PhotoUploadTask[]) : [];
          photos = (Array.isArray(queue) ? queue : []).filter((t) => t?.userId === userId).length;
        } catch { readFailed = true; }

        // Dictation queue. Only entries still awaiting transcription count as
        // unsynced work — a 'ready' task already HAS its text and is waiting
        // for the surface that asked for it to collect it, which is not a sync
        // problem and must not be counted as one.
        let dictations = 0;
        try {
          dictations = parseAudioQueue(raw.get(AUDIO_QUEUE_KEY))
            .filter((t) => t.userId === userId && t.status === 'pending').length;
        } catch { readFailed = true; }

        // Internal drop phrases ("terminal error or retry exhaustion") read as
        // plain words before they reach the badge's list or the sheet.
        const failures = ownFailures(parseFailures(raw.get(SYNC_FAILURE_KEY)), userId)
          .map((f) => ({ ...f, reason: humanDropReason(f.reason) }));
        lines = linesFrom(failures);

        next = computeSyncStatus(
          {
            depths: { writes, photos, dictations },
            failures: {
              count: failures.length,
              labels: failureLabels(failures),
              retryable: failures.filter(isRetryableFailure).length,
            },
            readFailed,
            signedIn: true,
          },
          Platform.OS === 'web' ? 'web' : 'native',
        );
      }
    } catch {
      // multiGet itself threw: we could not look at all. Say that, rather than
      // keeping a stale count or showing a clear device.
      next = computeSyncStatus(
        { depths: { writes: 0, photos: 0, dictations: 0 }, failures: { count: 0, labels: [] }, readFailed: true, signedIn: true },
        Platform.OS === 'web' ? 'web' : 'native',
      );
    }
    if (mountedRef.current) {
      // Keep the previous object when nothing changed: React then bails out,
      // and neither the pill nor Home re-renders on a quiet poll.
      setStatus((prev) => (statusEqual(prev, next) ? prev : next));
      setUnsaved((prev) => (unsavedEqual(prev, lines) ? prev : lines));
    }
  }, []);

  const acknowledgeFailures = useCallback(async () => {
    await acknowledgeSyncFailures();
    await refresh();
  }, [refresh]);

  const retryUnsaved = useCallback(async (id: string) => {
    const out = await retryUnsavedWrite(id);
    await refresh();
    return out;
  }, [refresh]);

  const discardUnsaved = useCallback(async (id: string) => {
    await discardUnsavedWrite(id);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (n: AppStateStatus) => {
      if (n === 'active') void refresh();
    });
    const offChanged = onQueueChanged(() => { void refresh(); });
    const offFlushed = onQueueFlushed(() => { void refresh(); });
    const offLedger = onSyncLedgerChanged(() => { void refresh(); });
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      sub.remove();
      offChanged();
      offFlushed();
      offLedger();
    };
  }, [refresh]);

  const uploadsPending = status.depths.photos + status.depths.dictations > 0;
  useEffect(() => {
    if (!uploadsPending) return;
    const fast = setInterval(() => { void refresh(); }, UPLOAD_POLL_MS);
    return () => clearInterval(fast);
  }, [uploadsPending, refresh]);

  return { ...status, unsaved, acknowledgeFailures, retryUnsaved, discardUnsaved, refresh };
}
