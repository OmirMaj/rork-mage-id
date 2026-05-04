// subScheduleUpdatesStorage — local persistence for the Sub Schedule
// Collab feature. Subs post daily updates against tasks on a shared
// schedule URL; both sides (sub posting + GC reading) cache locally.
//
// Storage layout:
//   tertiary_sub_updates::<projectId>   → SubScheduleUpdate[]
// Newest-first, capped at 1,000 entries (~3 years of daily updates
// across 25 active subs).
//
// Backend follow-up: when we wire a Supabase table, this module is the
// single touch-point. The append/load/delete API stays stable; the
// implementation grows a remote-sync layer.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SubScheduleUpdate } from '@/types';

const KEY_PREFIX = 'tertiary_sub_updates::';
const MAX_ENTRIES = 1_000;

function keyFor(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export async function loadSubUpdates(projectId: string): Promise<SubScheduleUpdate[]> {
  if (!projectId) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SubScheduleUpdate[];
  } catch (e) {
    console.log('[subUpdates] load failed', e);
    return [];
  }
}

export async function appendSubUpdate(
  projectId: string,
  update: SubScheduleUpdate,
): Promise<SubScheduleUpdate[]> {
  const existing = await loadSubUpdates(projectId);
  const next = [update, ...existing].slice(0, MAX_ENTRIES);
  try {
    await AsyncStorage.setItem(keyFor(projectId), JSON.stringify(next));
  } catch (e) {
    console.log('[subUpdates] save failed', e);
  }
  return next;
}

export async function deleteSubUpdate(
  projectId: string,
  id: string,
): Promise<SubScheduleUpdate[]> {
  const existing = await loadSubUpdates(projectId);
  const next = existing.filter(u => u.id !== id);
  try {
    await AsyncStorage.setItem(keyFor(projectId), JSON.stringify(next));
  } catch (e) {
    console.log('[subUpdates] delete failed', e);
  }
  return next;
}

/**
 * Latest update per (taskId, subName). Used for the GC overlay so we
 * show the freshest progress signal per task per sub.
 */
export function rollupLatest(updates: SubScheduleUpdate[]): Map<string, SubScheduleUpdate> {
  const map = new Map<string, SubScheduleUpdate>();
  for (const u of updates) {
    const key = `${u.taskId}::${u.subName.toLowerCase()}`;
    const prev = map.get(key);
    if (!prev || new Date(u.postedAt).getTime() > new Date(prev.postedAt).getTime()) {
      map.set(key, u);
    }
  }
  return map;
}
