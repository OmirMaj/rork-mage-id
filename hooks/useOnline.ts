// useOnline.ts: is this device offline right now? (moments Step 0, lane MOMSTEP0)
//
// The app has no NetInfo. Connectivity comes from react-query's onlineManager
// (the browser's online/offline events on web, AppState + the default
// listener on native), the same source app/plans.tsx and
// app/compare-drawings.tsx read inline today. Every legal slide or signing
// ceremony passes useOffline() as its `offline` prop, so the control is
// disabled with "You're offline. Signing needs a connection." before anyone
// drags it. The flag can be wrong (a captive portal reads as online), which is
// why the online-only writes in utils/offlineQueue.ts still answer 'refused'
// or 'unknown' on their own: this is the early word, not the proof.

import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange);
const offlineSnapshot = () => !onlineManager.isOnline();
// Server render / first web paint: assume online, the live value follows.
const offlineServerSnapshot = () => false;

/** true while the device is offline. Re-renders on every change. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, offlineSnapshot, offlineServerSnapshot);
}

/** The same answer for code outside React (a data-layer write deciding not to send). */
export function isOfflineNow(): boolean {
  try {
    return !onlineManager.isOnline();
  } catch {
    // A read that fails must never block a write: the server decides.
    return false;
  }
}
