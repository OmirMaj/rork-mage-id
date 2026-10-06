// utils/roomScan/store.ts — the reads and writes for saved scans. The shapes
// and the keys are in storeCore.ts (pure); read its header for what is kept,
// where, and why nothing is sent to the server in this lane.
//
// NOTHING HERE RUNS ON ITS OWN. Every write is called from a tap: Save Scan on
// the plan, the confirm sheet on the priced draft, or the confirm sheet on
// Delete Scan.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  parseSavedScans, removeSavedScan, roomScanRawKey, roomScansKey, upsertSavedScan,
  type SavedScan, type SavedScanList,
} from './storeCore';

export async function loadSavedScans(projectId: string): Promise<SavedScanList> {
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(roomScansKey(projectId)); } catch { /* treated as nothing saved */ }
  return parseSavedScans(raw);
}

/** Save one scan with its project. Returns false when the phone could not write it, so the screen can say so. */
export async function saveScan(saved: SavedScan, rawJson?: string | null): Promise<boolean> {
  try {
    const before = await loadSavedScans(saved.scan.projectId);
    const { list, dropped } = upsertSavedScan(before, saved);
    await AsyncStorage.setItem(roomScansKey(saved.scan.projectId), JSON.stringify(list));
    if (rawJson) await AsyncStorage.setItem(roomScanRawKey(saved.scan.id), rawJson);
    // A scan the cap pushed off the list takes its raw JSON with it.
    for (const id of dropped) {
      try { await AsyncStorage.removeItem(roomScanRawKey(id)); } catch { /* the scan itself is saved; a stray raw key is swept at the next tenant switch */ }
    }
    return true;
  } catch {
    return false;
  }
}

/** Delete one saved scan and its raw JSON from this phone. Called only from the delete confirm sheet. */
export async function deleteScan(projectId: string, scanId: string): Promise<boolean> {
  try {
    const list = await loadSavedScans(projectId);
    await AsyncStorage.setItem(roomScansKey(projectId), JSON.stringify(removeSavedScan(list, scanId)));
    await AsyncStorage.removeItem(roomScanRawKey(scanId));
    return true;
  } catch {
    return false;
  }
}

/** SHA-256 of Apple's JSON string, so a saved scan can be shown to be the one the phone produced. '' when hashing fails. */
export async function hashRawScan(rawJson: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawJson);
  } catch {
    return '';
  }
}
