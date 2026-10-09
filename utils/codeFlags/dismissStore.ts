// utils/codeFlags/dismissStore.ts — Code Flags: the "Hide This Flag" memory on
// AsyncStorage. The logic is utils/codeFlags/dismissCore.ts (pure). One shared
// in-memory copy with listeners, so hiding a flag in the sheet removes the
// chip on the line at once.
//
// Loaded only through components/codeFlags (which the two screens load only
// while CODE_FLAGS_ENABLED is true).
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CODE_FLAG_DISMISS_KEY, emptyDismissRecord, parseDismissRecord, withDismissal,
  type CodeFlagDismissRecord,
} from '@/utils/codeFlags/dismissCore';
import type { CodeFlagFamilyId } from '@/utils/codeFlags/rules';

let record: CodeFlagDismissRecord = emptyDismissRecord('');
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function publish(next: CodeFlagDismissRecord) {
  record = next;
  for (const l of [...listeners]) l();
}

export function subscribeDismissals(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function dismissalsSnapshot(): CodeFlagDismissRecord {
  return record;
}

/** Reads the disk copy for this account once (again when the account changes). */
export async function loadDismissals(account: string): Promise<void> {
  if (loadedFor === account) return;
  loadedFor = account;
  publish(emptyDismissRecord(account));
  try {
    const raw = await AsyncStorage.getItem(CODE_FLAG_DISMISS_KEY);
    if (loadedFor === account) publish(parseDismissRecord(raw, account));
  } catch {
    // Device-local convenience: an unreadable copy means nothing is hidden.
  }
}

export async function dismissLine(scope: string, lineKey: string, families: readonly CodeFlagFamilyId[]): Promise<void> {
  const next = withDismissal(record, scope, lineKey, families, new Date().toISOString());
  if (next === record) return;
  publish(next);
  try {
    await AsyncStorage.setItem(CODE_FLAG_DISMISS_KEY, JSON.stringify(next));
  } catch {
    // The in-memory copy still hides the flag for this session.
  }
}

/** Tests only. */
export function resetDismissalsForTest(): void {
  record = emptyDismissRecord('');
  loadedFor = null;
  listeners.clear();
}
