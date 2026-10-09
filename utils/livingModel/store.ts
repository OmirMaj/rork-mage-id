// utils/livingModel/store.ts — the reads and writes for a job model. The key
// and the reasons are in storeCore.ts (pure).
//
// NOTHING HERE RUNS ON ITS OWN. A write happens after the person changes the
// model on the screen; a read happens when he opens it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSavedScans, roomScansKey, type SavedScan } from '@/utils/roomScan/storeCore';
import { emptyJobModel, readSavedModel } from './modelCore';
import { MAX_MODEL_CHARS, livingModelBackupKey, livingModelKey, mayWriteModel, type LoadState } from './storeCore';
import type { JobModel } from './types';

export interface LoadedModel {
  /** The saved model, or an empty one. Never another project's and never half a model. */
  model: JobModel;
  /** 'unreadable' when text is stored and could not be read: the screen says so and nothing is written over it. */
  state: LoadState;
}

/**
 * Read the model for this person and project. Never rejects. When text is
 * stored and cannot be read, it is copied as it is under the backup key (if the
 * device lets us) and the answer is 'unreadable' with an empty model to look
 * at; the stored text itself is left where it is.
 */
export async function loadJobModel(userId: string | null | undefined, projectId: string): Promise<LoadedModel> {
  const key = livingModelKey(userId, projectId);
  if (!key) return { model: emptyJobModel(projectId), state: 'ready' };
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(key); } catch { /* treated as nothing saved */ }
  const read = readSavedModel(raw, projectId);
  if (read.state === 'ok') return { model: read.model, state: 'ready' };
  if (read.state === 'empty') return { model: emptyJobModel(projectId), state: 'ready' };
  await keepUnreadText(userId, projectId, raw as string);
  return { model: emptyJobModel(projectId), state: 'unreadable' };
}

/** Copy text that could not be read under the backup key, untouched. Returns false when the device refused. */
export async function keepUnreadText(userId: string | null | undefined, projectId: string, raw: string): Promise<boolean> {
  const backup = livingModelBackupKey(userId, projectId);
  if (!backup) return false;
  try {
    await AsyncStorage.setItem(backup, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save the model on this device. Returns false when it could not be written,
 * so the screen can say so. Refused outright while unread text sits under the
 * model key (`state` 'unreadable'): the person has to choose Start a New Model first.
 */
export async function saveJobModel(userId: string | null | undefined, model: JobModel, nowIso: string, state: LoadState): Promise<boolean> {
  const key = livingModelKey(userId, model.projectId);
  if (!key || !mayWriteModel(state)) return false;
  try {
    const json = JSON.stringify({ ...model, updatedAt: nowIso });
    if (json.length > MAX_MODEL_CHARS) return false;
    await AsyncStorage.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}
/**
 * The scans saved for this project on this device (the scanner's own list,
 * read only). The scanner keeps scans on the phone that made them, so on the
 * web this is empty until scans sync.
 */
export async function loadProjectScans(projectId: string): Promise<SavedScan[]> {
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(roomScansKey(projectId)); } catch { /* treated as nothing saved */ }
  return parseSavedScans(raw).scans;
}
