// utils/roomScan/learnStore.ts — the reads and writes for "What Your Tape
// Says". The maths is in learnCore.ts (pure).
//
// ONE KEY PER PERSON:  mageid_room_scan_tape::<userId>
// Under the app-owned `mageid_` prefix, so the tenant-switch sweep
// (utils/localCacheKeys) removes it and the next person on a shared phone
// never sees it, and with the user's id in the key so two accounts that were
// both signed in on one phone never read each other's tape.
//
// IT STAYS ON THE PHONE. Nothing here is uploaded, sent to a model, or put in
// a table: there is no server call in this file. What a later cloud phase
// would need is written down in docs/scan-the-room-native-checklist.md.
//
// NOTHING HERE RUNS ON ITS OWN. Pairs are written when he saves a scan (the
// Save Scan tap, or a confirmed send that saves) and removed when he deletes
// that scan from its confirm sheet. A scan the saved-list cap pushes off the
// phone (utils/roomScan/storeCore MAX_SCANS_PER_PROJECT) takes its pairs with
// it in the same save: `forgetScansTapePairs`.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseTapePairs, removeScansPairs, upsertTapePairs, type TapePair } from './learnCore';

export const ROOM_SCAN_TAPE_KEY_PREFIX = 'mageid_room_scan_tape::';
export const tapeLogKey = (userId: string): string => `${ROOM_SCAN_TAPE_KEY_PREFIX}${userId}`;

/** His taped walls on this phone. Empty when nobody is signed in or nothing is stored. */
export async function loadTapePairs(userId: string | null | undefined): Promise<TapePair[]> {
  if (!userId) return [];
  try { return parseTapePairs(await AsyncStorage.getItem(tapeLogKey(userId))); } catch { return []; }
}

/** Keep the pairs of one saved scan. Returns the list now stored, or null when the phone could not write it. */
export async function recordTapePairs(userId: string | null | undefined, pairs: readonly TapePair[]): Promise<TapePair[] | null> {
  if (!userId) return null;
  try {
    const next = upsertTapePairs(await loadTapePairs(userId), pairs);
    await AsyncStorage.setItem(tapeLogKey(userId), JSON.stringify({ version: 1, pairs: next }));
    return next;
  } catch {
    return null;
  }
}

/** Remove the pairs of scans that are no longer on this phone: a deleted scan, or scans the saved-list cap pushed off. Returns the list now stored, or null when nothing was written. */
export async function forgetScansTapePairs(userId: string | null | undefined, scanIds: readonly string[]): Promise<TapePair[] | null> {
  if (!userId) return null;
  if (scanIds.length === 0) return null;
  try {
    const next = removeScansPairs(await loadTapePairs(userId), scanIds);
    await AsyncStorage.setItem(tapeLogKey(userId), JSON.stringify({ version: 1, pairs: next }));
    return next;
  } catch { return null; /* the scan itself is gone; the pairs go at the next tenant switch */ }
}

/** Remove a deleted scan's pairs. */
export async function forgetScanTapePairs(userId: string | null | undefined, scanId: string): Promise<void> {
  await forgetScansTapePairs(userId, [scanId]);
}
