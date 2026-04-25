// useOfflineQueueDepth
//
// Polls the AsyncStorage offline queue and returns how many mutations are
// still waiting to flush. Surfaces queue depth so a UI pill can show field
// crews "3 reports queued — will sync when you're back on wifi" instead of
// silently sitting on data and making them wonder if work was saved.
//
// We deliberately poll (every 4s) rather than subscribe. The queue is local
// AsyncStorage, not an event stream — there's no subscription primitive. A
// global event-bus pattern would work but the polling overhead is one
// AsyncStorage read every 4s, which is dramatically cheaper than the
// per-tap re-renders we're already paying for in zustand. Not worth the
// abstraction.
//
// We also re-check on AppState wake (the OfflineSyncManager is about to
// drain the queue, so the user wants to see the depth tick down in real time).

import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getOfflineQueue } from '@/utils/offlineQueue';

const POLL_INTERVAL_MS = 4000;

export function useOfflineQueueDepth(): number {
  const [depth, setDepth] = useState<number>(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const q = await getOfflineQueue();
      if (mountedRef.current) setDepth(q.length);
    } catch {
      // Failing to read the queue is non-fatal — we just keep the last value.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void refresh();
    });
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      sub.remove();
    };
  }, [refresh]);

  return depth;
}
