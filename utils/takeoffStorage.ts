// takeoffStorage — persists takeoff results + user edits to AsyncStorage.
//
// The user's most common flow is: run a takeoff, eyeball the numbers, walk
// away to grab a coffee, come back and resume editing. Without persistence,
// closing the screen burns the result + their edits. With it, the takeoff
// stays put per project until they explicitly clear it.
//
// Storage layout:
//   tertiary_takeoff::<projectId>          → { result, overrides, modelUsed, savedAt, fileName }
//   tertiary_takeoff::standalone           → same shape; for runs without a project
//
// We DO NOT enqueue these through the offline queue — they're local-only
// state. If the user is offline the takeoff function won't run, full stop.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TakeoffResult } from '@/types';
import type { TakeoffModel } from '@/utils/takeoffAnalyzer';
import type { RenderedPlanPage } from '@/utils/pdfRenderClient';

const KEY_PREFIX = 'tertiary_takeoff::';
const STANDALONE_KEY = 'standalone';

export interface PersistedTakeoff {
  result: TakeoffResult;
  /** Per-row overrides keyed as `${section}:${id}` → number. */
  overrides: Record<string, number>;
  /** Set of row keys (`${section}:${id}`) the user explicitly rejected.
   *  Rejected rows drop out of totals, buyout generation, and estimate
   *  conversion — closes the "AI over-detects" complaint that hits every
   *  takeoff tool in the category. Optional for back-compat with older
   *  saved takeoffs that pre-date this field. */
  rejected?: Record<string, true>;
  modelUsed: TakeoffModel | null;
  pages: RenderedPlanPage[];
  fileName: string | null;
  /** ISO timestamp. Used to age out stale takeoffs (>30 days). */
  savedAt: string;
}

function keyFor(projectId: string | undefined): string {
  return `${KEY_PREFIX}${projectId ?? STANDALONE_KEY}`;
}

export async function loadTakeoff(projectId?: string): Promise<PersistedTakeoff | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTakeoff;
    // Light shape check — a takeoff missing core arrays is corrupt.
    if (!parsed.result || !Array.isArray(parsed.result.walls)) return null;
    // Age out > 60 days. Plans get re-issued; old takeoffs go stale.
    const savedAt = new Date(parsed.savedAt).getTime();
    if (Number.isFinite(savedAt) && Date.now() - savedAt > 60 * 24 * 60 * 60 * 1000) {
      void clearTakeoff(projectId);
      return null;
    }
    return parsed;
  } catch (e) {
    console.log('[takeoffStorage] load failed', e);
    return null;
  }
}

export async function saveTakeoff(
  projectId: string | undefined,
  data: Omit<PersistedTakeoff, 'savedAt'>,
): Promise<void> {
  try {
    const toSave: PersistedTakeoff = { ...data, savedAt: new Date().toISOString() };
    await AsyncStorage.setItem(keyFor(projectId), JSON.stringify(toSave));
  } catch (e) {
    console.log('[takeoffStorage] save failed', e);
  }
}

export async function clearTakeoff(projectId?: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(projectId));
  } catch (e) {
    console.log('[takeoffStorage] clear failed', e);
  }
}

/** List every persisted takeoff key. Used by the buyout flow to pick existing data. */
export async function listTakeoffKeys(): Promise<string[]> {
  try {
    const all = await AsyncStorage.getAllKeys();
    return Array.from(all).filter(k => k.startsWith(KEY_PREFIX));
  } catch {
    return [];
  }
}
