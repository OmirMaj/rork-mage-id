// TimeEntriesContext — mounts the ONE time-entry store for the whole app.
//
// Why a provider (audit round 2, field-ops #8): useTimeEntries used to keep its
// entries in per-mount useState, and it had two mounts that never talked — the
// Time Tracking screen and the global voice mic (UniversalMicButton, on every
// screen via BrainSurface). Each wrote its whole array to mageid_time_entries,
// so a voice log from the mic's launch-time copy erased the morning's clock-ins
// from the mirror job cost reads; and each posted its own shift alerts, so
// clock-out on the screen could not cancel the mic's and a "clock him out"
// push arrived after the shift ended. The store is now mounted here, once.
//
// Mount position (app/_layout.tsx): below QueryClientProvider (the store
// invalidates the time-entries mirror query) and below AuthProvider (it reads
// the user to scope, sync and wipe entries), and above BrainSurface and
// RootLayoutNav, which hold its two consumers.
//
// The store and its React context live in hooks/useTimeEntries.ts, so
// useTimeEntries() keeps its import path for every caller and this module is
// the only one that imports the other direction.

import React from 'react';
import { TimeEntriesStoreContext, useTimeEntriesStore } from '@/hooks/useTimeEntries';

export function TimeEntriesProvider({ children }: { children: React.ReactNode }) {
  const store = useTimeEntriesStore();
  return <TimeEntriesStoreContext.Provider value={store}>{children}</TimeEntriesStoreContext.Provider>;
}

export { useTimeEntries } from '@/hooks/useTimeEntries';
