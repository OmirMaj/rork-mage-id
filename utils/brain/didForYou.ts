// AsyncStorage append log for the morning brief "did-for-you" entries.
// Key: mageid_brain_ledger (registered in LOCAL_USER_CACHE_KEYS in B0).
// FIFO cap 200. Pure parse/append/prune.
// Dies on re-auth — ACCEPTED: brief only needs yesterday.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const DID_FOR_YOU_KEY = 'mageid_brain_ledger';
const MAX_ENTRIES = 200;

export interface DidForYouEntry {
  id: string;
  at: string;    // ISO timestamp
  text: string;
  projectId?: string;
}

export function parseDidForYouEntries(raw: string | null): DidForYouEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as DidForYouEntry[] : [];
  } catch {
    return [];
  }
}

export function appendDidForYouEntry(
  existing: DidForYouEntry[],
  entry: DidForYouEntry,
): DidForYouEntry[] {
  const updated = [...existing, entry];
  // FIFO: keep newest MAX_ENTRIES
  return updated.length > MAX_ENTRIES ? updated.slice(updated.length - MAX_ENTRIES) : updated;
}

// Fire-and-forget write — G4: never throws
export function recordDidForYou(text: string, projectId?: string): void {
  (async () => {
    try {
      const raw = await AsyncStorage.getItem(DID_FOR_YOU_KEY);
      const existing = parseDidForYouEntries(raw);
      const entry: DidForYouEntry = {
        id: `dfy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(),
        text,
        projectId,
      };
      const updated = appendDidForYouEntry(existing, entry);
      await AsyncStorage.setItem(DID_FOR_YOU_KEY, JSON.stringify(updated));
    } catch {
      // G4: swallow silently
    }
  })();
}
