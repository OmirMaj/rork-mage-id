// utils/livingModel/store.ts — the reads and writes for a job model. The key
// and the reasons are in storeCore.ts (pure).
//
// NOTHING HERE RUNS ON ITS OWN. A write happens after the person changes the
// model on the screen; a read happens when he opens it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyJobModel, parseJobModel } from './modelCore';
import { MAX_MODEL_CHARS, livingModelKey } from './storeCore';
import type { JobModel } from './types';

/** The saved model for this person and project, or an empty one. Never another project's and never half a model. */
export async function loadJobModel(userId: string | null | undefined, projectId: string): Promise<JobModel> {
  const key = livingModelKey(userId, projectId);
  if (!key) return emptyJobModel(projectId);
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(key); } catch { /* treated as nothing saved */ }
  return parseJobModel(raw, projectId) ?? emptyJobModel(projectId);
}

/** Save the model on this device. Returns false when it could not be written, so the screen can say so. */
export async function saveJobModel(userId: string | null | undefined, model: JobModel, nowIso: string): Promise<boolean> {
  const key = livingModelKey(userId, model.projectId);
  if (!key) return false;
  try {
    const json = JSON.stringify({ ...model, updatedAt: nowIso });
    if (json.length > MAX_MODEL_CHARS) return false;
    await AsyncStorage.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}
