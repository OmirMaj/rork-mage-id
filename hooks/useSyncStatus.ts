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
// A 4 s poll (matching useOfflineQueueDepth), plus an immediate re-read on
// AppState wake and on the queue's own onQueueChanged / onQueueFlushed events,
// so the count ticks down as a flush lands rather than up to 4 s later.

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
} from '@/utils/syncLedger';
import { computeSyncStatus, type SyncStatus } from '@/utils/syncStatusCore';

const POLL_INTERVAL_MS = 4000;

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

export interface SyncStatusHandle extends SyncStatus {
  /** Forget the recorded failures. An ACKNOWLEDGEMENT, not a recovery — the
   *  data is gone from the queue and the user has to re-enter it. Call sites
   *  must say so. Re-reads immediately so the badge clears at once. */
  acknowledgeFailures: () => Promise<void>;
  /** Force a re-read (e.g. a screen the user just pulled to refresh). */
  refresh: () => Promise<void>;
}

export function useSyncStatus(): SyncStatusHandle {
  const [status, setStatus] = useState<SyncStatus>(EMPTY);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    let next: SyncStatus;
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

        const failures = ownFailures(parseFailures(raw.get(SYNC_FAILURE_KEY)), userId);

        next = computeSyncStatus(
          {
            depths: { writes, photos, dictations },
            failures: { count: failures.length, labels: failureLabels(failures) },
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
    if (mountedRef.current) setStatus(next);
  }, []);

  const acknowledgeFailures = useCallback(async () => {
    await acknowledgeSyncFailures();
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
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      sub.remove();
      offChanged();
      offFlushed();
    };
  }, [refresh]);

  return { ...status, acknowledgeFailures, refresh };
}
