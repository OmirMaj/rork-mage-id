// utils/roomScan/storeCore.ts — what a saved scan looks like on the device (pure).
//
// STORAGE (utils/roomScan/store.ts does the reads and writes):
//   mageid_room_scans::<projectId>     the project's saved scans (this file's SavedScanList)
//   mageid_room_scan_raw::<scanId>     Apple's JSON string for one scan, untouched
// Both sit under the app-owned `mageid_` prefix, so the tenant-switch sweep
// (utils/localCacheKeys) removes them and one account's rooms are never shown
// to the next person on a shared phone. `bun run test:storage-hygiene` and
// scripts/validate-scan-room.ts both check the prefix.
//
// THE RECORD IS THE ROOM MODEL, NOT A 3D FILE. A plan, the quantities and the
// draft are all rebuilt from the model. The USDZ, when the phone wrote one, is
// a temp file and is not kept by this lane.
//
// NOT IN THE CLOUD YET. There is no room_scans table, so this lane writes no
// row: a scan lives on the phone it was made on until the table in
// docs/scan-the-room-native-checklist.md is applied and a sync lane is built
// on utils/offlineQueue. Sending a write for a table that does not exist would
// be dropped by the queue.

import type { RecipeKey } from './recipesCore';
import type { RoomScan } from './types';

export const ROOM_SCANS_KEY_PREFIX = 'mageid_room_scans::';
export const ROOM_SCAN_RAW_KEY_PREFIX = 'mageid_room_scan_raw::';

export const roomScansKey = (projectId: string): string => `${ROOM_SCANS_KEY_PREFIX}${projectId}`;
export const roomScanRawKey = (scanId: string): string => `${ROOM_SCAN_RAW_KEY_PREFIX}${scanId}`;

/** A saved list is capped so one project cannot fill the phone's storage. */
export const MAX_SCANS_PER_PROJECT = 40;

export interface SavedScan {
  scan: RoomScan;
  /** Draft line (condition id) to the estimate line it became, so pricing the same scan again updates in place. */
  pushed: Record<string, string>;
  manualRates: Partial<Record<RecipeKey, number>>;
  excluded: RecipeKey[];
  savedAt: string;
  /** Set when the draft went into the estimate. */
  pricedAt: string | null;
}

export interface SavedScanList { version: 1; scans: SavedScan[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Never throws. A row that is not a scan is dropped. */
export function parseSavedScans(raw: string | null | undefined): SavedScanList {
  const empty: SavedScanList = { version: 1, scans: [] };
  if (!raw) return empty;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return empty; }
  if (!isObj(v) || !Array.isArray(v.scans)) return empty;
  const scans: SavedScan[] = [];
  for (const row of v.scans) {
    if (!isObj(row) || !isObj(row.scan)) continue;
    const s = row.scan as unknown as RoomScan;
    if (typeof s.id !== 'string' || !s.id || !Array.isArray(s.walls) || !Array.isArray(s.openings) || !Array.isArray(s.edits)) continue;
    scans.push({
      scan: s,
      pushed: isObj(row.pushed) ? (row.pushed as Record<string, string>) : {},
      manualRates: isObj(row.manualRates) ? (row.manualRates as SavedScan['manualRates']) : {},
      excluded: Array.isArray(row.excluded) ? (row.excluded.filter((k) => typeof k === 'string') as RecipeKey[]) : [],
      savedAt: typeof row.savedAt === 'string' ? row.savedAt : '',
      pricedAt: typeof row.pricedAt === 'string' ? row.pricedAt : null,
    });
  }
  return { version: 1, scans };
}

/** Put one scan in the list (newest first), replacing an older copy of the same scan. */
export function upsertSavedScan(list: SavedScanList, saved: SavedScan): SavedScanList {
  const rest = list.scans.filter((s) => s.scan.id !== saved.scan.id);
  return { version: 1, scans: [saved, ...rest].slice(0, MAX_SCANS_PER_PROJECT) };
}

export function removeSavedScan(list: SavedScanList, scanId: string): SavedScanList {
  return { version: 1, scans: list.scans.filter((s) => s.scan.id !== scanId) };
}
