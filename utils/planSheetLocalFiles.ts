// utils/planSheetLocalFiles.ts — plan sheets saved as FILES on the phone, so a
// super in a basement can open today's drawings (audit #80).
//
// WHY FILES, NOT A CACHE. The day pack used to `Image.prefetch` into
// expo-image's disk cache, but the plan viewer and the Plans list render with
// react-native's <Image>, which never reads that cache — and the cache is keyed
// by the signed URL, which changes every time ProjectContext re-mints it, and
// cannot be looked up at all after a cold start offline (imageUri is then a
// bare storage path). A file in the documents directory, keyed by the durable
// storage path, survives all three.
//
// TENANT BOUNDARY. Files live under `<documents>/mageid-plan-sheets/<userId>/`
// and the map that names them is stored under `mageid_plan_sheet_files`, an
// APP_STORAGE_PREFIXES prefix, so AuthContext's sweep drops it on an account
// switch. The lookup also refuses any map whose userId is not the signed-in
// user (fieldDayPackCore.localSheetFileFor), and every warm deletes other
// users' folders. Web has no documents directory and warms nothing.
//
// Pure decisions (parse, lookup, naming, what to keep) live in
// utils/fieldDayPackCore.ts so scripts can drive them under bun.

import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '@/contexts/AuthContext';
import { planSheetStoragePath } from '@/utils/planSheetUrls';
import { hashText } from '@/utils/plans/memoryIndexCore';
import {
  filesToKeep, localSheetFileFor, parsePlanSheetFileMap, planSheetFileName, type PlanSheetFileMap,
} from '@/utils/fieldDayPackCore';

/** `mageid_` prefixed: the tenant sweep removes it on an account switch. */
export const PLAN_SHEET_FILES_KEY = 'mageid_plan_sheet_files';
const ROOT_DIR = 'mageid-plan-sheets/';

const supported = Platform.OS !== 'web';

let current: PlanSheetFileMap | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

function rootDir(): string | null {
  const docs = FileSystem.documentDirectory;
  return docs ? `${docs}${ROOT_DIR}` : null;
}

async function loadOnce(): Promise<void> {
  if (loaded || !supported) return;
  loaded = true;
  try {
    current = parsePlanSheetFileMap(await AsyncStorage.getItem(PLAN_SHEET_FILES_KEY));
  } catch {
    current = null;
  }
  notify();
}

async function persist(map: PlanSheetFileMap): Promise<void> {
  current = map;
  notify();
  try { await AsyncStorage.setItem(PLAN_SHEET_FILES_KEY, JSON.stringify(map)); } catch {/* the in-memory map still answers */}
}

/**
 * Download one sheet into this user's folder and record it. Resolves true ONLY
 * when a file with bytes in it landed — the day pack counts exactly these.
 * The map is updated in memory; call `commitPlanSheetFiles` once the batch is
 * done so concurrent downloads do not race each other's writes.
 */
export async function downloadSheetToDevice(userId: string, uri: string): Promise<boolean> {
  if (!supported || !userId || !/^https?:\/\//i.test(uri)) return false;
  const path = planSheetStoragePath(uri);
  const root = rootDir();
  if (!path || !root) return false;
  const dir = `${root}${userId}/`;
  const target = `${dir}${planSheetFileName(path, s => hashText(s))}`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    const res = await FileSystem.downloadAsync(uri, target);
    if (res.status < 200 || res.status >= 300) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      return false;
    }
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists || !('size' in info) || !info.size) return false;
    await loadOnce();
    const base: PlanSheetFileMap = current && current.userId === userId ? current : { userId, files: {} };
    current = { userId, files: { ...base.files, [path]: { uri: target, savedAt: Date.now() } } };
    return true;
  } catch {
    return false;
  }
}

/**
 * After a warm: keep this pack's sheets, delete every other file of this
 * user's and every other user's folder, and persist the map.
 */
export async function commitPlanSheetFiles(userId: string, allocatedUris: readonly string[]): Promise<void> {
  if (!supported || !userId) return;
  await loadOnce();
  const paths = allocatedUris.map(u => planSheetStoragePath(u)).filter(Boolean);
  const kept = filesToKeep(current, userId, paths);
  const root = rootDir();
  if (root) {
    try {
      const users = await FileSystem.readDirectoryAsync(root).catch(() => [] as string[]);
      for (const u of users) {
        if (u !== userId) await FileSystem.deleteAsync(`${root}${u}`, { idempotent: true }).catch(() => undefined);
      }
      const keepNames = new Set(Object.values(kept.files).map(f => f.uri.slice(f.uri.lastIndexOf('/') + 1)));
      const mine = await FileSystem.readDirectoryAsync(`${root}${userId}/`).catch(() => [] as string[]);
      for (const name of mine) {
        if (!keepNames.has(name)) await FileSystem.deleteAsync(`${root}${userId}/${name}`, { idempotent: true }).catch(() => undefined);
      }
    } catch {/* best effort — the map below is still the truth */}
  }
  await persist(kept);
}

/**
 * The uri to render for a plan sheet: its on-device file when the day pack
 * saved one for the signed-in user, else the sheet's own imageUri. Re-renders
 * when the map loads or a warm commits.
 */
type SheetUriSource = { storagePath?: string; imageUri: string } | null | undefined;

export function useLocalPlanSheetUri(): (sheet: SheetUriSource) => string {
  const { user } = useAuth();
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!supported) return;
    const l = () => setVersion(v => v + 1);
    listeners.add(l);
    void loadOnce();
    return () => { listeners.delete(l); };
  }, []);
  const uid = user?.id ?? null;
  return useCallback((sheet: SheetUriSource): string => {
    if (!sheet) return '';
    const path = sheet.storagePath || planSheetStoragePath(sheet.imageUri);
    // `current` is read at call time: the version bump above re-renders the
    // caller when it changes, and `uid` covers an account switch.
    return localSheetFileFor(current, uid, path) ?? sheet.imageUri;
  }, [uid]);
}
