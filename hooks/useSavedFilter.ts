// useSavedFilter — persistent filter state per (user × list).
//
// Why this exists: every list screen in the app (RFIs, punch items,
// subs, bid offers, my-RFPs) re-resets its filters on each visit.
// Power users want "My open RFIs" and "Overdue invoices last 30d"
// to stick. This hook is a drop-in replacement for `useState` that
// reads from AsyncStorage on mount and writes on change.
//
// Storage key: `saved_filter:${scope}` — `scope` is a string like
// "rfi-list" or "bid-offers". One key per list. The persisted shape
// is whatever the caller stores (typed via the generic T).
//
// Two-sided support:
//   GC side: `useSavedFilter('rfi-list', {...})` for the RFI list
//   Homeowner side: `useSavedFilter('my-rfps', {...})` for the
//                    posted-jobs list
//
// Cost: zero (AsyncStorage already in the bundle).
//
// Example:
//   const [filter, setFilter, isHydrated] = useSavedFilter('rfi-list', {
//     status: 'open',
//     projectId: null,
//     priority: 'all',
//   });

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'saved_filter:';

export function useSavedFilter<T>(
  scope: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);
  // We use a ref to track if the user-driven update happened after
  // hydration, so the first AsyncStorage read doesn't trigger an
  // unnecessary write of the default value.
  const userInitiatedRef = useRef(false);

  const storageKey = STORAGE_PREFIX + scope;

  // Load on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled) return;
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw) as T;
            setValue(parsed);
          } catch {
            // Corrupt data — fall back to default, clear bad entry.
            void AsyncStorage.removeItem(storageKey);
          }
        }
      } catch (err) {
        if (__DEV__) console.warn(`[useSavedFilter] load ${scope} failed:`, err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey, scope]);

  // Persist on change — but only after the initial hydration. We
  // don't want the default-value write to clobber what's in storage
  // for a brief moment before the load resolves.
  useEffect(() => {
    if (!hydrated || !userInitiatedRef.current) return;
    void (async () => {
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify(value));
      } catch (err) {
        if (__DEV__) console.warn(`[useSavedFilter] save ${scope} failed:`, err);
      }
    })();
  }, [value, hydrated, storageKey, scope]);

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    userInitiatedRef.current = true;
    setValue(next);
  }, []);

  return [value, setAndPersist, hydrated];
}

/**
 * Clear all saved filters for a given scope. Useful for the "Reset
 * filters" affordance on a list screen.
 */
export async function clearSavedFilter(scope: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_PREFIX + scope);
  } catch (err) {
    if (__DEV__) console.warn(`[useSavedFilter] clear ${scope} failed:`, err);
  }
}
