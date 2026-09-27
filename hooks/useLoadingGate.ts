// useLoadingGate — the delay / minimum-hold / exit gate around a loader.
//
//   const g = useLoadingGate(loading, 'section');
//   g.show      keep the loader mounted (through the delay, the hold and the exit)
//   g.exiting   play the exit now (pass as the mark's `done`)
//   g.onExited  the loader calls this when its exit finished
//   g.wasShown  the loader was visible when the work finished (arms <Arrive>)
//   g.revealed  past the reveal delay (for captions / a11y; read at render)
//
// The decisions are the pure reducer in utils/loadingGate.ts. The reveal is
// baked into the mark's plateau, NOT a timer; the remaining hold is the one
// JS timer here. A backstop finishes the exit itself at exitMs + 150 if the
// loader's completion callback never arrives (a lost native callback must
// never strand a loader — the BrandSplash lesson).

import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from '@/components/ui/motion';
import {
  GATE_BACKSTOP_MS, gateExitMs, gateExited, gateHoldElapsed, gateInitial, gateStep, gateVisible,
  type GateScope, type GateSnapshot,
} from '@/utils/loadingGate';

export interface LoadingGate {
  show: boolean;
  exiting: boolean;
  revealed: boolean;
  onExited: () => void;
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
    const id = setTimeout(() => setSnap((s) => gateExited(s)), gateExitMs(scope, reduce) + GATE_BACKSTOP_MS);
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
