// hooks/useSavedAiTakeoff.ts — the AI Takeoff saved on THIS browser for a job
// (lane TK-b). Read-only: it never writes, never clears, never runs AI.
//
// It reads the raw `mageid_takeoff::<projectId>` string itself instead of
// calling utils/takeoffStorage.loadTakeoff, because loadTakeoff folds every
// failure (a corrupt blob, a thrown read) into null — which would tell him
// "nothing saved" when something is there and broken — and it CLEARS an aged
// takeoff, which this read-only panel must never do. The prefix below must
// equal takeoffStorage's KEY_PREFIX (scripts/validate-takeoff-ai-suggestions
// pins the two literals together).
//
// A job switch cancels a stale read (seq pattern).

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistedTakeoff } from '@/utils/takeoffStorage';
import { parseSavedAiTakeoff } from '@/utils/takeoff/aiSuggestions';

const AI_TAKEOFF_KEY_PREFIX = 'mageid_takeoff::';

export type SavedAiTakeoffState = 'loading' | 'none' | 'stale' | 'failed' | 'ready';

export interface UseSavedAiTakeoff {
  state: SavedAiTakeoffState;
  saved: PersistedTakeoff | null;
  savedAt: string | null;
  reload: () => void;
}

type Snap = Omit<UseSavedAiTakeoff, 'reload'>;
const LOADING: Snap = { state: 'loading', saved: null, savedAt: null };

export function useSavedAiTakeoff(projectId: string | null): UseSavedAiTakeoff {
  // Tagged with the job it was read for, so a job switch never shows the last job's rows for a frame.
  const [snap, setSnap] = useState<{ pid: string | null; s: Snap }>({ pid: projectId, s: LOADING });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const set = (s: Snap) => setSnap({ pid: projectId, s });
    if (!projectId) { set({ state: 'none', saved: null, savedAt: null }); return undefined; }
    set(LOADING);
    const done = (raw: string | null, threw: boolean) => {
      if (seq.current !== my) return;
      if (threw) { set({ state: 'failed', saved: null, savedAt: null }); return; }
      const p = parseSavedAiTakeoff(raw, Date.now());
      if (p.state === 'ready') set({ state: 'ready', saved: p.saved, savedAt: p.saved.savedAt });
      else if (p.state === 'stale') set({ state: 'stale', saved: null, savedAt: p.savedAt });
      else set({ state: p.state, saved: null, savedAt: null });
    };
    try {
      AsyncStorage.getItem(AI_TAKEOFF_KEY_PREFIX + projectId).then((raw) => done(raw, false), () => done(null, true));
    } catch {
      done(null, true);
    }
    return () => { if (seq.current === my) seq.current++; };
  }, [projectId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...(snap.pid === projectId ? snap.s : LOADING), reload };
}
