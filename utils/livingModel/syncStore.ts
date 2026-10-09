// utils/livingModel/syncStore.ts — the device half of saving a job model to
// the account: the sync notes and the model set aside after a both-changed
// choice. The keys are in storeCore.ts; the rules are in syncCore.ts (pure).
//
// NOTHING HERE TALKS TO THE SERVER, and nothing here touches the model key
// itself (store.ts owns that one).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readSavedModel } from './modelCore';
import { livingModelKeptKey, livingModelSyncKey } from './storeCore';
import { parseSyncMeta, type ModelSyncMeta } from './syncCore';
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
