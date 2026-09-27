// loadingGate.ts — when a loader is allowed to appear, how long it must stay,
// and how it leaves. A pure reducer: timestamps in, decisions out, so
// scripts/validate-level.ts can prove every case without a timer.
//
// The rule, per scope:
//   - DELAY: a loader never appears before `delayMs`. Work that finishes inside
//     the delay shows NOTHING (action 'skip': the loader unmounts with no
//     animation and the content appears with no Arrive — the common cached read).
//   - MINIMUM: once visible, it stays at least `minMs`, so a loader never
//     flashes for one frame (action { kind: 'hold', ms }).
//   - EXIT: 'settle' (the level damps to dead centre, then fades) or 'fade'
//     (inline / button / skeleton: a plain 120 ms fade).
//
// NO react-native import (bun validators import this file directly).

export type GateScope = 'button' | 'inline' | 'section' | 'screen' | 'skeleton' | 'knownSlow';
export type GateExit = 'fade' | 'settle';
export interface GateScopeConfig { readonly delayMs: number; readonly minMs: number; readonly exit: GateExit }

/**
 * The scope table (the judges' binding numbers). Button: the busy VISUAL waits
 * 120 ms, but the host switches `disabled` + accessibilityState.busy on at the
 * PRESS, never at 120. knownSlow (AI work of 3 s or more) shows at once.
 */
export const GATE: Readonly<Record<GateScope, GateScopeConfig>> = {
  button: { delayMs: 120, minMs: 400, exit: 'fade' },
  inline: { delayMs: 150, minMs: 400, exit: 'fade' },
  section: { delayMs: 150, minMs: 400, exit: 'settle' },
  screen: { delayMs: 200, minMs: 500, exit: 'settle' },
  skeleton: { delayMs: 100, minMs: 400, exit: 'fade' },
  knownSlow: { delayMs: 0, minMs: 600, exit: 'settle' },
};

export type GatePhase = 'idle' | 'pending' | 'shown' | 'holding' | 'exiting' | 'done';

export interface GateState {
  phase: GatePhase;
  /** When loading started (ms). */
  startedAt: number;
  /** When the loader became visible, once known (a restart keeps it). null = startedAt + delayMs. */
  shownAt: number | null;
}

export type GateAction = 'skip' | 'exit' | { kind: 'hold'; ms: number };

export const IDLE_GATE: GateState = { phase: 'idle', startedAt: 0, shownAt: null };

/** Loading began at `now`. */
export function gateStart(now: number): GateState {
  return { phase: 'pending', startedAt: now, shownAt: null };
}

/** Is the loader past its reveal delay at `now`? */
export function gateVisible(state: GateState, scope: GateScope, now: number): boolean {
  if (state.phase === 'idle' || state.phase === 'done') return false;
  if (state.shownAt != null) return true;
  return now - state.startedAt >= GATE[scope].delayMs;
}

/** Loading finished at `now`: skip, hold for the rest of the minimum, or exit. */
export function gateReady(state: GateState, scope: GateScope, now: number): { state: GateState; action: GateAction } {
  const { delayMs, minMs } = GATE[scope];
  if (state.shownAt == null && now - state.startedAt < delayMs) {
    return { state: { ...state, phase: 'done' }, action: 'skip' };
  }
  const shownAt = state.shownAt ?? state.startedAt + delayMs;
  const visibleFor = now - shownAt;
  if (visibleFor < minMs) {
    return { state: { ...state, phase: 'holding', shownAt }, action: { kind: 'hold', ms: minMs - visibleFor } };
  }
  return { state: { ...state, phase: 'exiting', shownAt }, action: 'exit' };
}

/**
 * Loading turned true again while the loader is holding or exiting: back to
 * 'shown' with NO second delay (it is already on screen — ReloadVeil's
 * re-activation rule). Any other phase is returned unchanged.
 */
export function gateRestart(state: GateState, now: number): GateState {
  if (state.phase !== 'holding' && state.phase !== 'exiting') return state;
  return { ...state, phase: 'shown', shownAt: state.shownAt ?? now };
}

/** How long the scope's exit animation runs (the hook's lost-callback backstop adds GATE_LOST_CALLBACK_MS). */
export function gateExitMs(scope: GateScope, reduceMotion: boolean): number {
  if (reduceMotion) return 160;
  // settle: vis starts at +200 and runs 140 ms (gone at +340); fade: 120 ms.
  return GATE[scope].exit === 'settle' ? 340 : 120;
}

/** The backstop that finishes an exit whose completion callback never arrived. */
export const GATE_BACKSTOP_MS = 150;

/**
 * The LOST-callback backstop, past the exit: the gate hook's own exiting timer,
 * and LevelMark's guard while it waits on amp.stopAnimation's async native
 * round trip. Long on purpose — the normal completion is the mark's onSettled,
 * timed from when its settle ACTUALLY starts (a JS stall right as content
 * mounts must not cut the settle mid-fade); this only rescues a callback that
 * never arrives.
 */
export const GATE_LOST_CALLBACK_MS = 500;

// ── The hook's snapshot reducer (pure, so the validator can walk it) ─────────

export interface GateSnapshot {
  gate: GateState;
  /** Keep the loader mounted (through the delay, the hold and the exit). */
  show: boolean;
  /** Play the exit now. */
  exiting: boolean;
  /** The loader was visible when the work finished (arms Arrive). */
  wasShown: boolean;
  /** The remaining hold, while phase is 'holding'. */
  holdMs: number;
}

export function gateInitial(loading: boolean, now: number): GateSnapshot {
  if (!loading) return { gate: IDLE_GATE, show: false, exiting: false, wasShown: false, holdMs: 0 };
  return { gate: gateStart(now), show: true, exiting: false, wasShown: false, holdMs: 0 };
}

/** `loading` changed to the given value at `now`. */
export function gateStep(snap: GateSnapshot, loading: boolean, scope: GateScope, now: number): GateSnapshot {
  const p = snap.gate.phase;
  if (loading) {
    if (p === 'holding' || p === 'exiting') {
      return { ...snap, gate: gateRestart(snap.gate, now), show: true, exiting: false, holdMs: 0 };
    }
    if (p === 'pending' || p === 'shown') return snap;
    return { gate: gateStart(now), show: true, exiting: false, wasShown: false, holdMs: 0 };
  }
  if (p !== 'pending' && p !== 'shown') return snap;
  const { state, action } = gateReady(snap.gate, scope, now);
  if (action === 'skip') return { gate: state, show: false, exiting: false, wasShown: false, holdMs: 0 };
  if (action === 'exit') return { gate: state, show: true, exiting: true, wasShown: true, holdMs: 0 };
  return { gate: state, show: true, exiting: false, wasShown: true, holdMs: action.ms };
}

/** The hold timer fired: play the exit. */
export function gateHoldElapsed(snap: GateSnapshot): GateSnapshot {
  if (snap.gate.phase !== 'holding') return snap;
  return { ...snap, gate: { ...snap.gate, phase: 'exiting' }, exiting: true, holdMs: 0 };
}

/** The loader reported its exit finished (or the backstop fired). */
export function gateExited(snap: GateSnapshot): GateSnapshot {
  if (snap.gate.phase !== 'exiting') return snap;
  return { ...snap, gate: { ...snap.gate, phase: 'done' }, show: false, exiting: false };
}
