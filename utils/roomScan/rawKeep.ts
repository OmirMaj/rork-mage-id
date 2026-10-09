// utils/roomScan/rawKeep.ts — the raw scan is kept the moment the phone hands
// it over, and the owner can send it back as a file.
//
// WHY THE RAW IS KEPT BEFORE ANYTHING ELSE. Apple does not document the JSON a
// CapturedRoom encodes to, so the first real scans may not parse. A scan that
// cannot be read is the most useful one to have. So, straight after the
// scanner closes and BEFORE the parser runs:
//   mageid_room_scan_raw::<scanId>   Apple's JSON, exactly as the module
//                                    returned it (the same key Save Scan uses);
//   mageid_room_scan_last            one small record: which scan that was, and
//                                    the Scan Facts report (scanDebugCore).
// Both are under the app-owned `mageid_` prefix, so the tenant-switch sweep
// removes them (utils/localCacheKeys.ts). Only ONE unsaved raw scan is ever
// kept: writing a new one removes the one before it unless that scan was saved
// (a saved scan owns its raw key, and Delete Scan removes it).
//
// Nothing here is uploaded. The file is written to the app's cache folder and
// handed to the system share sheet, and only from a tap on Share Raw Scan Data.
//
// expo-file-system and expo-sharing are imported the way the rest of the app
// imports them (utils/contractSealing.ts and two dozen others): both have been
// in every shipped build, so this file loads on an old build too. The ROOM SCAN
// module is the one that may be missing, and only utils/roomScan/native.ts
// names it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { NativeScanSummary } from './native';
import { rawScanFileBody, rawScanFileName, type ScanFactsReport } from './scanDebugCore';
import { loadSavedScans } from './store';
import { roomScanRawKey } from './storeCore';

export const ROOM_SCAN_LAST_KEY = 'mageid_room_scan_last';

export interface LastRawScan {
  version: 1;
  scanId: string;
  projectId: string;
  facts: ScanFactsReport;
  summary: NativeScanSummary | null;
}

/** The record of the last scan this phone made, or null. Never throws. */
export async function loadLastRawScan(): Promise<LastRawScan | null> {
  try {
    const text = await AsyncStorage.getItem(ROOM_SCAN_LAST_KEY);
    if (!text) return null;
    const v = JSON.parse(text) as LastRawScan;
    if (!v || v.version !== 1 || typeof v.scanId !== 'string' || !v.facts) return null;
    return v;
  } catch {
    return null;
  }
}

/** Apple's JSON for a scan, exactly as it was kept. '' when there is none. Never throws. */
export async function loadRawScan(scanId: string): Promise<string> {
  try { return (await AsyncStorage.getItem(roomScanRawKey(scanId))) ?? ''; } catch { return ''; }
}

/**
 * Keep the raw JSON and its facts. Called once per finished scan, before the
 * parser's answer is used for anything. Returns false when the phone could not
 * write it; the scan goes on either way (the raw is still in memory).
 */
export async function keepRawScan(raw: string, facts: ScanFactsReport, summary: NativeScanSummary | null): Promise<boolean> {
  try {
    const before = await loadLastRawScan();
    if (before && before.scanId !== facts.scanId) {
      const saved = await loadSavedScans(before.projectId);
      if (!saved.scans.some((s) => s.scan.id === before.scanId)) {
        try { await AsyncStorage.removeItem(roomScanRawKey(before.scanId)); } catch { /* a stray raw key is swept at the next tenant switch */ }
      }
    }
    if (raw) await AsyncStorage.setItem(roomScanRawKey(facts.scanId), raw);
    const record: LastRawScan = { version: 1, scanId: facts.scanId, projectId: facts.projectId, facts, summary };
    await AsyncStorage.setItem(ROOM_SCAN_LAST_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export type RawShareOutcome = 'shared' | 'unavailable' | 'failed';

/**
 * Write the scan file to the cache folder and open the system share sheet on
 * it. `day` is the calendar day for the file name. Resolves with what happened;
 * never throws. (The share sheet does not say whether he picked a target, so
 * 'shared' means the sheet opened and closed without an error.)
 */
export async function shareRawScanFile(a: {
  facts: ScanFactsReport;
  summary: NativeScanSummary | null;
  raw: string;
  roomName: string;
  day: string | null;
  dialogTitle: string;
}): Promise<{ outcome: RawShareOutcome; fileName: string; errorText: string }> {
  const fileName = rawScanFileName(a.day, a.roomName);
  try {
    if (!(await Sharing.isAvailableAsync())) return { outcome: 'unavailable', fileName, errorText: '' };
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!dir) return { outcome: 'unavailable', fileName, errorText: '' };
    const uri = `${dir}${fileName}`;
    await FileSystem.writeAsStringAsync(uri, rawScanFileBody(a.facts, a.summary, a.roomName, a.raw), { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: a.dialogTitle, UTI: 'public.json' });
    return { outcome: 'shared', fileName, errorText: '' };
  } catch (e) {
    return { outcome: 'failed', fileName, errorText: e instanceof Error ? e.message : String(e) };
  }
}
