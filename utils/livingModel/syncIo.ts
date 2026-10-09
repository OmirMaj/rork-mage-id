// utils/livingModel/syncIo.ts — the ONE file of the Living Model that reaches
// the server (lane LIVINGSYNC). The rules are in syncCore.ts (pure); the
// device half is syncStore.ts; hooks/useLivingModelSync.ts runs them.
//
// READS go straight to public.living_models, under its one SELECT policy
// (everyone on the job reads; nobody else).
// THE ONE WRITE is public.living_model_save, and it goes through the app's
// offline queue (utils/offlineQueue supabaseRpcDetailed), never around it: it
// waits behind an earlier save of the same job, falls into the queue when the
// phone is offline, and is replayed in order when it is back. There is no
// `supabase.from(...).insert/update/upsert/delete` here and there must never
// be one (scripts/validate-living-model-sync.ts fails on it).
// THE ONE DELETE is public.living_model_remove, called only from the person's
// confirmed tap on Remove It from My Account. It goes through the same queue
// call so it waits behind a save of the same job that is still on the wire,
// but it is NEVER LEFT QUEUED: when it cannot be sent now it is taken back out
// and the screen says the copy was not removed (a delete that fires hours
// later, after he changed his mind, is not what he confirmed).
// A QUEUED SAVE CAN BE TAKEN BACK (cancelQueuedAccountSave): Keep on This
// Phone removes this job's waiting save from the queue before it is sent.
//
// The supabase client and the queue are required lazily (the house pattern,
// utils/takeoffCloudSync.ts), so the validators can import this file under bun.
//
// A DATABASE WITHOUT THE TABLE answers 'missing' and nothing is queued: the
// model stays on the device, quietly, until the migration is applied.
import type { WriteOutcome } from '@/utils/offlineQueue';
import { isTransportError } from '@/utils/networkErrors';
import {
  LIVING_MODELS_TABLE, LIVING_MODEL_REMOVE_FN, LIVING_MODEL_SAVE_FN, isMissingTable, isSyncableProjectId, parseServerHead, removeArgs, saveArgs,
  type ServerHead,
} from './syncCore';
import type { JobModel } from './types';

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

/** True when there is a backend to talk to at all. */
export function accountReachable(): boolean {
  return cloudModules() !== null;
}

/** The signed-in person as the offline queue sees him (null when signed out or with no backend). */
export async function accountSessionUserId(): Promise<string | null> {
  const cloud = cloudModules();
  if (!cloud) return null;
  try {
    return await cloud.queue.currentSessionUserId();
  } catch {
    return null;
  }
}

export type AccountRead<T> =
  /** The account has no model for this job. */
  | { kind: 'none' }
  | { kind: 'row'; head: ServerHead; value: T }
  /** The table is not in this database yet. */
  | { kind: 'missing' }
  /** The request never reached the server. */
  | { kind: 'offline' }
  /** The server answered with an error that is not "no such table". */
  | { kind: 'error' };

const HEAD_COLUMNS = 'revision, last_write_id, recent_writes, schema_version, updated_at, updated_by';

async function readRow<T>(projectId: string, columns: string, pick: (row: Record<string, unknown>) => T): Promise<AccountRead<T>> {
  const cloud = cloudModules();
  if (!cloud || !isSyncableProjectId(projectId)) return { kind: 'error' };
  try {
    const res = await cloud.sb.supabase.from(LIVING_MODELS_TABLE).select(columns).eq('project_id', projectId).maybeSingle();
    if (res.error) {
      if (isMissingTable(res.error)) return { kind: 'missing' };
      return { kind: isTransportError(res.error) ? 'offline' : 'error' };
    }
    if (!res.data) return { kind: 'none' };
    const head = parseServerHead(res.data);
    if (!head) return { kind: 'error' };
    return { kind: 'row', head, value: pick(res.data as unknown as Record<string, unknown>) };
  } catch (err) {
    return { kind: isTransportError(err) ? 'offline' : 'error' };
  }
}

/** The account row without the model: what revision it is at, who saved it and when. */
export function fetchAccountHead(projectId: string): Promise<AccountRead<null>> {
  return readRow(projectId, HEAD_COLUMNS, () => null);
}

/** The account row with the model, as the server returned it (not yet checked: syncCore and modelCore read it). */
export function fetchAccountModel(projectId: string): Promise<AccountRead<unknown>> {
  return readRow(projectId, `model, ${HEAD_COLUMNS}`, (row) => row.model);
}

/**
 * Send one save, through the offline queue. 'synced' means the function ran
 * and answered; it does NOT mean the save was accepted (a stale save is
 * answered, not raised), so the caller reads the row back. 'queued' means it
 * will be sent later. 'failed' means the server refused the call.
 */
export async function pushAccountModel(projectId: string, model: JobModel, base: number, writeId: string): Promise<WriteOutcome> {
  const cloud = cloudModules();
  if (!cloud || !isSyncableProjectId(projectId)) return 'failed';
  try {
    return await cloud.queue.supabaseRpcDetailed(
      LIVING_MODELS_TABLE, projectId, LIVING_MODEL_SAVE_FN, saveArgs(projectId, model, base, writeId),
      { callerOwnsRefusal: true },
    );
  } catch {
    return 'failed';
  }
}

/** What became of a queued save the person took back. */
export type CancelOutcome =
  /** A waiting save was taken out of the queue: it will not be sent. */
  | 'removed'
  /** Nothing of this job's was waiting. */
  | 'none'
  /** The queue could not be read: a waiting save may still go out. */
  | 'unknown';

/**
 * Take this job's waiting save back out of the offline queue (Keep on This
 * Phone). Only this account's living_model_save for this project; nothing
 * else in the queue is touched. It cannot recall a request already on the wire.
 */
export async function cancelQueuedAccountSave(projectId: string, userId: string | null | undefined): Promise<CancelOutcome> {
  const cloud = cloudModules();
  if (!cloud || !userId || !isSyncableProjectId(projectId)) return 'none';
  try {
    const res = await cloud.queue.cancelQueuedRpc(LIVING_MODELS_TABLE, projectId, LIVING_MODEL_SAVE_FN, userId);
    if (res.readFailed) return 'unknown';
    return res.removed > 0 ? 'removed' : 'none';
  } catch {
    return 'unknown';
  }
}

export type RemoveOutcome =
  /** The account answered and now holds no copy for this job. */
  | 'removed'
  /** The account could not be reached, or it answered and a copy is still there. Nothing is left waiting. */
  | 'not_removed';

/**
 * Delete this job's copy from the account: the person's own confirmed tap and
 * nothing else. Sent now or not at all (a call that fell into the queue is
 * taken straight back out), and called removed only after the row was read
 * and found gone. Touches nothing on the device.
 */
export async function removeAccountModel(projectId: string, userId: string | null | undefined): Promise<RemoveOutcome> {
  const cloud = cloudModules();
  if (!cloud || !userId || !isSyncableProjectId(projectId)) return 'not_removed';
  try {
    const outcome = await cloud.queue.supabaseRpcDetailed(
      LIVING_MODELS_TABLE, projectId, LIVING_MODEL_REMOVE_FN, removeArgs(projectId),
      { callerOwnsRefusal: true },
    );
    if (outcome !== 'synced') {
      await cloud.queue.cancelQueuedRpc(LIVING_MODELS_TABLE, projectId, LIVING_MODEL_REMOVE_FN, userId);
      return 'not_removed';
    }
    const back = await fetchAccountHead(projectId);
    return back.kind === 'none' ? 'removed' : 'not_removed';
  } catch {
    try { await cloud.queue.cancelQueuedRpc(LIVING_MODELS_TABLE, projectId, LIVING_MODEL_REMOVE_FN, userId); } catch { /* nothing more to do */ }
    return 'not_removed';
  }
}

/**
 * His yes to the scan question, recorded on the account so it can be shown
 * later (public.legal_acceptances, kind 'scan_room_upload': the version and a
 * SHA-256 of the exact words he read, in the language he read them in; the
 * server stamps who and when). Best effort and never in the way: it returns at
 * once, never throws, and the save does not wait for it. Before the migration
 * that adds the kind is applied the server refuses it and the note stays on
 * the phone to be sent later (utils/legalAcceptance).
 */
export function recordScanUploadYes(userId: string | null | undefined, lang: 'en' | 'es'): void {
  if (!userId || !cloudModules()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legal = require('@/utils/legalAcceptance') as typeof import('@/utils/legalAcceptance');
    legal.recordScanRoomUpload(userId, lang);
  } catch {
    /* never in the way of the save */
  }
}

export interface QueueHolds {
  /** A save of this job's model is still in the queue. */
  modelSave: boolean;
  /** The project itself has not reached the server yet (made offline): a save now would be refused. */
  projectInsert: boolean;
}

/** What this session's offline queue still holds for the job. null when the queue could not be read. */
export async function accountQueueHolds(projectId: string): Promise<QueueHolds | null> {
  const cloud = cloudModules();
  if (!cloud) return { modelSave: false, projectInsert: false };
  try {
    const { entries, readFailed } = await cloud.queue.getOwnOfflineQueueDetailed();
    if (readFailed) return null;
    return {
      modelSave: entries.some((m) => m.table === LIVING_MODELS_TABLE && m.data?.id === projectId && (m.operation !== 'rpc' || m.rpc?.fn === LIVING_MODEL_SAVE_FN)),
      projectInsert: entries.some((m) => m.table === 'projects' && m.data?.id === projectId && (m.operation === 'insert' || m.operation === 'upsert')),
    };
  } catch {
    return null;
  }
}

/** Start one drain of the queue now (single-flight inside the queue). */
export function kickAccountQueueDrain(): void {
  const cloud = cloudModules();
  if (!cloud) return;
  try {
    void cloud.queue.processOfflineQueue().catch(() => { /* OfflineSyncManager retries */ });
  } catch {
    /* no queue module */
  }
}

/**
 * Called when the offline queue moved (an enqueue, a flush, a drop, the
 * sign-out clear). The signal proves nothing by itself: the hook reads the
 * queue and the account again. Returns the unsubscribe.
 */
export function onAccountQueueSignal(listener: () => void): () => void {
  const cloud = cloudModules();
  if (!cloud) return () => {};
  const offs: (() => void)[] = [];
  try {
    offs.push(cloud.queue.onQueueChanged(() => listener()));
    offs.push(cloud.queue.onQueueFlushed((tables) => { if (tables.has(LIVING_MODELS_TABLE) || tables.has('projects')) listener(); }));
  } catch {
    /* no queue module */
  }
  return () => { for (const off of offs) off(); };
}
