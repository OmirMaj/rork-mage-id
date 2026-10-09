// utils/roomScan/storeCore.ts — what a saved scan looks like on the device (pure).
//
// STORAGE (utils/roomScan/store.ts does the reads and writes):
//   mageid_room_scans::<projectId>     the project's saved scans (this file's SavedScanList)
//   mageid_room_scan_raw::<scanId>     Apple's JSON string for one scan, untouched
//   mageid_room_scan_tape::<userId>    his taped walls across every scan on this phone
//                                      (utils/roomScan/learnStore.ts; lane SCANORDER)
// All sit under the app-owned `mageid_` prefix, so the tenant-switch sweep
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

import { parseTapePairs, type TapePair } from './learnCore';
import { parseOrderOptions, type OrderOptions, type OrderSnapshot } from './orderListCore';
import type { OrderWrote } from './orderPricingCore';
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
  // ── the order list (lane SCANORDER). All optional: a scan saved before it has none. ──
  /** His choices on the order list (sheet size, stock lengths, coats ...) and the quantities he typed over. */
  order?: OrderOptions;
  /** Prices he typed on order lines, by line key. */
  orderRates?: Record<string, number>;
  /** Order line (condition id) to the estimate line it became, so sending the list twice updates in place. */
  orderPushed?: Record<string, string>;
  /** What each of those estimate lines said the moment the send wrote it, so a later send can tell a line he has since changed by hand and leave it alone. */
  orderWrote?: Record<string, OrderWrote>;
  /** What the list said each time it left the screen (copied, shared, or put in the estimate), newest first. */
  orderSent?: OrderSnapshot[];
  /** Scanned and taped lengths for the walls he typed over (utils/roomScan/learnCore). */
  tapePairs?: TapePair[];
}

/** How many sends of one scan's order list are remembered. */
export const MAX_ORDER_SENDS = 10;

export interface SavedScanList { version: 1; scans: SavedScan[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function numberMap(v: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = n;
  return out;
}

function parseOrderWrote(v: Record<string, unknown>): Record<string, OrderWrote> {
  const out: Record<string, OrderWrote> = {};
  for (const [k, r] of Object.entries(v)) {
    if (!isObj(r) || typeof r.materialId !== 'string' || typeof r.name !== 'string' || typeof r.unit !== 'string') continue;
    if (typeof r.quantity !== 'number' || !Number.isFinite(r.quantity) || typeof r.unitPrice !== 'number' || !Number.isFinite(r.unitPrice)) continue;
    out[k] = { materialId: r.materialId, name: r.name, unit: r.unit, quantity: r.quantity, unitPrice: r.unitPrice };
  }
  return out;
}

function parseOrderSent(rows: unknown[]): OrderSnapshot[] {
  const out: OrderSnapshot[] = [];
  for (const r of rows) {
    if (!isObj(r) || typeof r.at !== 'string' || !Array.isArray(r.lines)) continue;
    if (r.via !== 'copy' && r.via !== 'share' && r.via !== 'estimate') continue;
    out.push({ at: r.at, via: r.via, lines: r.lines.filter((l) => isObj(l) && typeof l.key === 'string' && typeof l.quantity === 'number') as OrderSnapshot['lines'] });
  }
  return out.slice(0, MAX_ORDER_SENDS);
}

/** Add one send to a saved scan's record, newest first, capped. */
export function withOrderSent(saved: SavedScan, snap: OrderSnapshot): SavedScan {
  return { ...saved, orderSent: [snap, ...(saved.orderSent ?? [])].slice(0, MAX_ORDER_SENDS) };
}

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
      ...(isObj(row.order) ? { order: parseOrderOptions(row.order, s.roomType) } : {}),
      ...(isObj(row.orderRates) ? { orderRates: numberMap(row.orderRates) } : {}),
      ...(isObj(row.orderPushed) ? { orderPushed: row.orderPushed as Record<string, string> } : {}),
      ...(isObj(row.orderWrote) ? { orderWrote: parseOrderWrote(row.orderWrote) } : {}),
      ...(Array.isArray(row.orderSent) ? { orderSent: parseOrderSent(row.orderSent) } : {}),
      ...(Array.isArray(row.tapePairs) ? { tapePairs: parseTapePairs(row.tapePairs) } : {}),
    });
  }
  return { version: 1, scans };
}

/**
 * Put one scan in the list (newest first), replacing an older copy of the same scan.
 *
 * `dropped` are the ids of scans the cap pushed off the end. Each has a raw
 * JSON key of its own (roomScanRawKey) that the list no longer points at: the
 * store removes those keys in the same save, or the 41st scan's raw JSON would
 * sit on the phone for ever with nothing to delete it.
 */
export function upsertSavedScan(list: SavedScanList, saved: SavedScan): { list: SavedScanList; dropped: string[] } {
  const all = [saved, ...list.scans.filter((s) => s.scan.id !== saved.scan.id)];
  return {
    list: { version: 1, scans: all.slice(0, MAX_SCANS_PER_PROJECT) },
    dropped: all.slice(MAX_SCANS_PER_PROJECT).map((s) => s.scan.id),
  };
}

export function removeSavedScan(list: SavedScanList, scanId: string): SavedScanList {
  return { version: 1, scans: list.scans.filter((s) => s.scan.id !== scanId) };
}
