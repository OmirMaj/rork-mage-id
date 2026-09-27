// utils/takeoffCloudSync.ts — the I/O half of the desktop takeoff's cloud sync
// (public.takeoff_docs, one doc per job, 20260926180000). The pure merge is
// utils/takeoff/takeoffDocMerge.ts; the wiring is hooks/useTakeoffConditions.ts.
// It lives OUTSIDE utils/takeoff/ on purpose: that folder must stay pure
// (scripts/validate-takeoff-conditions.ts), and every storage call the sync
// adds lives here — the hook keeps exactly its two guarded AsyncStorage calls.
//
// Writes go through utils/offlineQueue supabaseWriteDetailed. The supabase
// client and the queue are required lazily (house pattern, utils/syncLedger),
// so scripts/validate-cloud-sync.ts can import TAKEOFF_SAVE_LINES under bun.
//
// Keys (both mageid_, so the tenant sweep erases them with the doc itself):
//   mageid_takeoff_sync::<projectId>      the TakeoffSyncMeta JSON
//   mageid_takeoff_conflict::<projectId>  this browser's copy from before a
//                                         conflict merge kept the server's

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WriteOutcome } from '@/utils/offlineQueue';
import { isTransportError } from '@/utils/networkErrors';
import { isSampleProject } from '@/utils/sampleGuard';
import { seatCanWrite, type SeatReadStatus, type SyncSeatRole } from '@/utils/syncSeat';
import { parseTakeoffDoc, type TakeoffDoc } from '@/utils/takeoff/conditions';
import { EMPTY_TAKEOFF_SYNC_META, takeoffDocRow, type TakeoffSyncMeta } from '@/utils/takeoff/takeoffDocMerge';

export type TakeoffSaveState = 'local' | 'seat' | 'syncing' | 'synced' | 'offline' | 'failed' | 'refused';
export type TakeoffSyncVerdict = 'ok' | 'local' | 'seat' | 'seat_unknown';

/**
 * The takeoff panel's save line, by state. 'Saved to your account' ONLY when
 * a push was verified by a read-back (or the account read matched this
 * browser) with nothing pending.
 */
export const TAKEOFF_SAVE_LINES: Record<TakeoffSaveState, string> = {
  local: 'Saved on this browser',
  seat: 'Saved on this browser — your seat on this job can’t save takeoffs to the account',
  syncing: 'Saved on this browser — syncing to your account',
  synced: 'Saved to your account — open it on any computer',
  offline: 'Saved on this browser — it syncs to your account when you’re back online',
  failed: 'Saved on this browser — couldn’t reach your account; it will sync when it can',
  refused: 'Saved on this browser only — your account didn’t accept this save',
};

/**
 * The save line for a 'seat_unknown' verdict, by WHY the role is null (#90):
 * 'syncing' only while the role read is in flight; a failed read, a read
 * paused offline, or a settled null (not on this job) says so instead.
 */
export const SEAT_UNKNOWN_LINE: Record<SeatReadStatus, TakeoffSaveState> = {
  loading: 'syncing',
  failed: 'failed',
  offline: 'offline',
  none: 'seat',
};

/** Appended to a conflict notice when this browser's earlier copy was backed up. */
export const TAKEOFF_BACKUP_SUFFIX = ' This browser’s earlier copy is kept — you can restore it.';

export const TAKEOFF_SYNC_META_PREFIX = 'mageid_takeoff_sync::';
export const TAKEOFF_CONFLICT_PREFIX = 'mageid_takeoff_conflict::';
export const takeoffSyncMetaKey = (projectId: string): string => `${TAKEOFF_SYNC_META_PREFIX}${projectId}`;
export const takeoffConflictKey = (projectId: string): string => `${TAKEOFF_CONFLICT_PREFIX}${projectId}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OfflineQueueModule = typeof import('@/utils/offlineQueue');
type SupabaseModule = typeof import('@/lib/supabase');

function cloudModules(): { queue: OfflineQueueModule; sb: SupabaseModule } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sb = require('@/lib/supabase') as SupabaseModule;
    if (!sb.isSupabaseConfigured) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const queue = require('@/utils/offlineQueue') as OfflineQueueModule;
    return { queue, sb };
  } catch {
    return null;
  }
}

/** The signed-in user as the offline queue sees him (null when signed out / no backend). */
export async function takeoffSessionUserId(): Promise<string | null> {
  const cloud = cloudModules();
  if (!cloud) return null;
  try {
    return await cloud.queue.currentSessionUserId();
  } catch {
    return null;
  }
}

/**
 * May this browser sync this job's takeoff? RLS writes takeoff_docs at
 * can_access_project(…, 'editor'), so a field or viewer seat is 'seat'.
 * 'seat_unknown' (role still loading / unreadable) fetches and pushes nothing.
 */
export async function canSyncTakeoff(
  projectId: string | null,
  project: { name?: string | null } | null | undefined,
  role: SyncSeatRole,
): Promise<TakeoffSyncVerdict> {
  if (!cloudModules() || !projectId || !UUID_RE.test(projectId) || !project) return 'local';
  if (isSampleProject(project as Parameters<typeof isSampleProject>[0])) return 'local';
  if (!(await takeoffSessionUserId())) return 'local';
  const can = seatCanWrite(role, 'editor');
  if (can === false) return 'seat';
  if (can === null) return 'seat_unknown';
  return 'ok';
}

type ReadFail = 'error' | 'offline';
const failOf = (err: unknown): ReadFail => (isTransportError(err) ? 'offline' : 'error');

/** The account copy: the doc and its stamp, null when there is none. */
export async function fetchServerTakeoffDoc(
  projectId: string,
): Promise<{ doc: unknown; updatedAt: string } | null | ReadFail> {
  const cloud = cloudModules();
  if (!cloud) return 'error';
  try {
    const res = await cloud.sb.supabase
      .from('takeoff_docs')
      .select('doc, updated_at')
      .eq('project_id', projectId)
      .maybeSingle();
    if (res.error) return failOf(res.error);
    const row = res.data as { doc?: unknown; updated_at?: unknown } | null;
    if (!row) return null;
    if (typeof row.updated_at !== 'string') return 'error';
    return { doc: row.doc, updatedAt: row.updated_at };
  } catch (err) {
    return failOf(err);
  }
}

/** The verify read after a push: the row's stamp only. */
export async function fetchServerStamp(projectId: string): Promise<string | null | ReadFail> {
  const cloud = cloudModules();
  if (!cloud) return 'error';
  try {
    const res = await cloud.sb.supabase
      .from('takeoff_docs')
      .select('updated_at')
      .eq('project_id', projectId)
      .maybeSingle();
    if (res.error) return failOf(res.error);
    const row = res.data as { updated_at?: unknown } | null;
    if (!row) return null;
    return typeof row.updated_at === 'string' ? row.updated_at : 'error';
  } catch (err) {
    return failOf(err);
  }
}

export async function pushTakeoffDoc(projectId: string, userId: string, doc: TakeoffDoc, stamp: string): Promise<WriteOutcome> {
  const cloud = cloudModules();
  if (!cloud) return 'failed';
  try {
    return await cloud.queue.supabaseWriteDetailed('takeoff_docs', 'upsert', { ...takeoffDocRow(projectId, userId, doc, stamp) });
  } catch {
    return 'failed';
  }
}

// ── meta ────────────────────────────────────────────────────────────────────
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function parseTakeoffSyncMeta(raw: string | null | undefined): TakeoffSyncMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return {
      localEditedAt: strOrNull(v.localEditedAt),
      pendingStamp: strOrNull(v.pendingStamp),
      lastSyncedAt: strOrNull(v.lastSyncedAt),
      lastSyncedLocalAt: strOrNull(v.lastSyncedLocalAt),
    };
  } catch {
    return null;
  }
}

/** `stored` is false when this browser never kept meta for the job (a takeoff from before the sync). */
export async function readTakeoffSyncMeta(projectId: string): Promise<{ meta: TakeoffSyncMeta; stored: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(takeoffSyncMetaKey(projectId));
    const meta = parseTakeoffSyncMeta(raw);
    return meta ? { meta, stored: true } : { meta: { ...EMPTY_TAKEOFF_SYNC_META }, stored: false };
  } catch {
    return { meta: { ...EMPTY_TAKEOFF_SYNC_META }, stored: false };
  }
}

export async function writeTakeoffSyncMeta(projectId: string, meta: TakeoffSyncMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(takeoffSyncMetaKey(projectId), JSON.stringify(meta));
  } catch {
    /* storage full / blocked: the in-memory meta still steers this session */
  }
}

// ── the conflict copy ───────────────────────────────────────────────────────
export async function saveConflictCopy(projectId: string, doc: TakeoffDoc): Promise<boolean> {
  try {
    await AsyncStorage.setItem(takeoffConflictKey(projectId), JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export async function readConflictCopy(projectId: string): Promise<TakeoffDoc | null> {
  try {
    const raw = await AsyncStorage.getItem(takeoffConflictKey(projectId));
    return raw ? parseTakeoffDoc(raw) : null;
  } catch {
    return null;
  }
}

export async function clearConflictCopy(projectId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(takeoffConflictKey(projectId));
  } catch {
    /* nothing to do */
  }
}
