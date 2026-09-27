// useLoadingGate — the delay / minimum-hold / exit gate around a loader.
//
//   const g = useLoadingGate(loading, 'section');
//   g.show      keep the loader mounted (through the delay, the hold and the exit)
//   g.exiting   play the exit now (pass as the mark's `done`)
//   g.onExited  the loader calls this when its exit finished
//   g.wasShown  the loader was visible when the work finished (arms <Arrive>)
//   g.revealed  past the reveal delay — a render-time SNAPSHOT (see LoadingGate)
//
// The decisions are the pure reducer in utils/loadingGate.ts. The reveal is
// baked into the mark's plateau, NOT a timer; the remaining hold is the one
// JS timer here. A backstop finishes the exit itself at exitMs +
// GATE_LOST_CALLBACK_MS (500) if the loader's completion callback never
// arrives (a lost native callback must never strand a loader — the
// BrandSplash lesson). It is deliberately long: the normal exit is the mark's
// onSettled, timed from when its settle really starts, and a JS stall as the
// content mounts must not cut that settle mid-fade.

import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from '@/components/ui/motion';
import {
  GATE_LOST_CALLBACK_MS, gateExitMs, gateExited, gateHoldElapsed, gateInitial, gateStep, gateVisible,
  type GateScope, type GateSnapshot,
} from '@/utils/loadingGate';

export interface LoadingGate {
  /** Keep the loader mounted (through the delay, the hold and the exit). */
  show: boolean;
  /** Play the exit now (pass as the mark's `done`). */
  exiting: boolean;
  /**
   * Past the reveal delay AT THIS RENDER — a render-time snapshot
   * (gateVisible(…, Date.now()) computed while rendering), NEVER a trigger.
   * No timer re-renders the host when the delay passes, so it stays false
   * until some other re-render. Do not gate visible words or a11y text on it:
   * use the mark's plateau (useLevelReveal) for anything that must appear on
   * time.
   */
  revealed: boolean;
  /** The loader calls this when its exit finished. */
  onExited: () => void;
  /** The loader was visible when the work finished (arms <Arrive>). */
  wasShown: boolean;
}

export function useLoadingGate(loading: boolean, scope: GateScope): LoadingGate {
  const reduce = useReducedMotion();
  const [snap, setSnap] = useState<GateSnapshot>(() => gateInitial(loading, Date.now()));
  const [prevLoading, setPrevLoading] = useState(loading);

  // Decided DURING render (React's derived-state pattern), so the very render
  // that sees `loading` flip already carries the decision — a skipped loader
  // never paints one more frame, and <Arrive> is armed on its first mount.
  let current = snap;
  if (loading !== prevLoading) {
    current = gateStep(snap, loading, scope, Date.now());
    setPrevLoading(loading);
    setSnap(current);
  }

  const phase = current.gate.phase;
  const holdMs = current.holdMs;

  useEffect(() => {
    if (phase !== 'holding') return;
    const id = setTimeout(() => setSnap((s) => gateHoldElapsed(s)), holdMs);
    return () => clearTimeout(id);
  }, [phase, holdMs]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    const id = setTimeout(() => setSnap((s) => gateExited(s)), gateExitMs(scope, reduce) + GATE_LOST_CALLBACK_MS);
    return () => clearTimeout(id);
  }, [phase, scope, reduce]);

  const onExited = useCallback(() => setSnap((s) => gateExited(s)), []);

  return {
    show: current.show,
    exiting: current.exiting,
    revealed: gateVisible(current.gate, scope, Date.now()),
    onExited,
    wasShown: current.wasShown,
  };
}
