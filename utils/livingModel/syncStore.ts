// utils/livingModel/syncStore.ts — the device half of saving a job model to
// the account: the sync notes and the model set aside after a both-changed
// choice. The keys are in storeCore.ts; the rules are in syncCore.ts (pure).
//
// NOTHING HERE TALKS TO THE SERVER. The model key is store.ts's: this file
// writes it only through store.saveJobModel, and only in the one trade below.
//
// THE TRADE (swapKeptModel). "Use the Kept Model Instead" puts the kept model
// on screen and sets the one on screen aside. Two keys cannot be written at
// one instant (AsyncStorage.multiSet is one transaction on Android and not on
// iOS), so the kept model is first copied under a third key. A kill between
// the writes then leaves it there, and recoverKeptSwap finishes the trade at
// the next open. Both models exist somewhere at every instant.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readSavedModel } from './modelCore';
import { saveJobModel } from './store';
import { livingModelKeptKey, livingModelKey, livingModelSwapKey, livingModelSyncKey, type LoadState } from './storeCore';
import { modelFingerprint, parseSyncMeta, swapRecovery, type ModelSyncMeta, type SwapNote } from './syncCore';
import type { JobModel } from './types';

/** The sync notes for this person and job. Never rejects: unreadable notes read as "never synced". */
export async function readSyncMeta(userId: string | null | undefined, projectId: string): Promise<ModelSyncMeta> {
  const key = livingModelSyncKey(userId, projectId);
  if (!key) return parseSyncMeta(null);
  try {
    return parseSyncMeta(await AsyncStorage.getItem(key));
  } catch {
    return parseSyncMeta(null);
  }
}

/** Returns false when the device refused the write. The caller keeps the notes in memory for this session either way. */
export async function writeSyncMeta(userId: string | null | undefined, projectId: string, meta: ModelSyncMeta): Promise<boolean> {
  const key = livingModelSyncKey(userId, projectId);
  if (!key) return false;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

/** The model the person did not keep, and which side it came from. */
export interface KeptModel {
  /** 'account' = the account's copy was set aside. 'device' = this device's was. */
  from: 'account' | 'device';
  model: JobModel;
  keptAt: string;
  /** 'teammate' = set aside by the app, not by a choice: a teammate's save took this device's place. Absent for a choice. */
  why?: 'teammate';
}

/** The text a kept model is stored as (the one shape parseKeptModel reads). */
export function keptModelJson(kept: KeptModel): string {
  return JSON.stringify(kept);
}

export function parseKeptModel(raw: string | null | undefined, projectId: string): KeptModel | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || (v.from !== 'account' && v.from !== 'device')) return null;
    const read = readSavedModel(JSON.stringify(v.model ?? null), projectId);
    if (read.state !== 'ok') return null;
    return { from: v.from, model: read.model, keptAt: typeof v.keptAt === 'string' ? v.keptAt : '', ...(v.why === 'teammate' ? { why: 'teammate' as const } : {}) };
  } catch {
    return null;
  }
}

export async function readKeptModel(userId: string | null | undefined, projectId: string): Promise<KeptModel | null> {
  const key = livingModelKeptKey(userId, projectId);
  if (!key) return null;
  try {
    return parseKeptModel(await AsyncStorage.getItem(key), projectId);
  } catch {
    return null;
  }
}

/**
 * Set a model aside. Returns false when the device refused, and then THE
 * CHOICE IS NOT CARRIED OUT: a model is never replaced unless the one it
 * replaces was first kept.
 */
export async function writeKeptModel(userId: string | null | undefined, projectId: string, kept: KeptModel): Promise<boolean> {
  const key = livingModelKeptKey(userId, projectId);
  if (!key) return false;
  try {
    await AsyncStorage.setItem(key, keptModelJson(kept));
    return true;
  } catch {
    return false;
  }
}

/** Remove the model that was set aside. Only ever called from the person's tap on Remove the Kept Model. */
export async function removeKeptModel(userId: string | null | undefined, projectId: string): Promise<boolean> {
  const key = livingModelKeptKey(userId, projectId);
  if (!key) return false;
  try {
    await AsyncStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function parseSwapNote(raw: string | null, projectId: string): SwapNote | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || typeof v.outgoingFingerprint !== 'string' || v.outgoingFingerprint === '') return null;
    const read = readSavedModel(JSON.stringify(v.incoming ?? null), projectId);
    return read.state === 'ok' ? { incoming: read.model, outgoingFingerprint: v.outgoingFingerprint } : null;
  } catch {
    return null;
  }
}

/**
 * "Use the Kept Model Instead": `kept.model` goes on screen and `onScreen` is
 * set aside in its place. Returns the newly kept model, or null when it could
 * not be done, and then nothing was replaced (a write that failed part way is
 * put back). A KILL part way is finished by recoverKeptSwap at the next open.
 */
export async function swapKeptModel(userId: string | null | undefined, projectId: string, onScreen: JobModel, kept: KeptModel, nowIso: string, state: LoadState): Promise<KeptModel | null> {
  const swapKey = livingModelSwapKey(userId, projectId);
  if (!swapKey) return null;
  const aside: KeptModel = { from: 'device', model: onScreen, keptAt: nowIso };
  const note: SwapNote = { incoming: kept.model, outgoingFingerprint: modelFingerprint(onScreen) };
  // (1) The kept model, copied where a kill cannot take it.
  try { await AsyncStorage.setItem(swapKey, JSON.stringify(note)); } catch { return null; }
  // (2) The model on screen, set aside.
  if (!(await writeKeptModel(userId, projectId, aside))) {
    try { await AsyncStorage.removeItem(swapKey); } catch { /* found and discarded at the next open */ }
    return null;
  }
  // (3) The kept model, in its place.
  if (!(await saveJobModel(userId, kept.model, nowIso, state))) {
    await writeKeptModel(userId, projectId, kept);
    try { await AsyncStorage.removeItem(swapKey); } catch { /* found and discarded at the next open */ }
    return null;
  }
  try { await AsyncStorage.removeItem(swapKey); } catch { /* found and discarded at the next open */ }
  return aside;
}

/**
 * Finish a trade the app was killed in the middle of. Called when the screen
 * opens, BEFORE the model and the kept model are read. Does nothing when no
 * trade was under way. Never rejects.
 */
export async function recoverKeptSwap(userId: string | null | undefined, projectId: string, nowIso: string): Promise<void> {
  const swapKey = livingModelSwapKey(userId, projectId);
  const modelKey = livingModelKey(userId, projectId);
  const keptKey = livingModelKeptKey(userId, projectId);
  if (!swapKey || !modelKey || !keptKey) return;
  try {
    const raw = await AsyncStorage.getItem(swapKey);
    if (raw === null) return;
    const note = parseSwapNote(raw, projectId);
    if (note) {
      const onDevice = readSavedModel(await AsyncStorage.getItem(modelKey), projectId);
      const kept = parseKeptModel(await AsyncStorage.getItem(keptKey), projectId);
      const todo = swapRecovery(note, {
        modelFingerprint: onDevice.state === 'ok' ? modelFingerprint(onDevice.model) : null,
        keptFingerprint: kept ? modelFingerprint(kept.model) : null,
      });
      // Not finished and not written: the swap key stays, and the next open tries again.
      if (todo === 'finish' && !(await saveJobModel(userId, note.incoming, nowIso, 'ready'))) return;
    }
    await AsyncStorage.removeItem(swapKey);
  } catch {
    /* the next open tries again */
  }
}
