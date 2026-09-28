// useCommitCapsule.ts: the Commit Capsule's brain (moments wave, lane CAPSULE).
//
// ONE shape carries the whole commit and is never cut (morph.md 0): it
// stretches under the thumb, docks into a circle, turns into the busy ring,
// draws the check and re-expands into the result pill. A failed write visibly
// UN-commits: the shape pulls itself home and the words say what did not
// happen. This hook owns every value, the gesture, the state machine and the
// beat-by-beat timeline; CapsuleShape draws the pieces and the skins
// (SlideToConfirm here, SignatureLine in components/moments/signing) lay them
// out.
//
// THE RULES (binding; CAPSULE spec, both judges):
//   - Motion is RN Animated on the native driver, transform and opacity only.
//     The drag is the LEGACY PanGestureHandler with an Animated.event on
//     translationX; GestureDetector reaches the UI thread only through
//     reanimated, which metro stubs out. Colour = cross-fades between stacked
//     opaque layers. Every spring is inside ζ [0.75, 1.05].
//   - Success visuals (success tone, check, success haptic, result pill) ONLY
//     on a real `confirmed` (resolvePlan decides; nothing else maps to it).
//   - commit() sets phase 'busy' synchronously FIRST, so a double release or a
//     double Confirm cannot commit twice. A generation counter aborts every
//     pending beat on reset/unmount; a result that lands after unmount goes to
//     onResultAfterUnmount and nothing else (no setState after unmount).
//   - Every sequencing step runs on a gen-gated timer of the same duration as
//     the animation it follows, never on an animation's completion callback:
//     a native completion can be dropped (and never fires under jest).
//   - Reduce Motion keeps direct manipulation and the critically damped
//     snap-back and turns off shimmer, lock scale, dock/contract, expand and
//     settle; every haptic and announcement is kept.

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, findNodeHandle, Platform, type LayoutChangeEvent } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { nativeDriver, reducedMotion, useReducedMotion } from '@/components/ui/motion';
import {
  legalQueuedLine,
  resolvePlan,
  runCommit,
  type CommitResult,
  type CommitWriteOptions,
  type ResolvePlan,
} from '@/utils/moments/commitResult';
import { CAPSULE_GEOMETRY, CAPSULE_RULES, MOMENT_EASE, MOMENT_SPRING, MOMENT_TIMING as MT, type SpringCfg } from '@/utils/moments/motionSpec';
import { disabledTable, lockStep, notchStep, resist, resistanceTable, shouldCommit } from '@/utils/moments/capsuleMath';
import { momentCopy } from '@/utils/moments/copy';
import { announce, momentHaptic } from '@/utils/moments/haptics';
import { inputModality, installFocusModality, subscribeInputModality } from '@/utils/moments/focusModality';
import type { CapsuleTone } from '@/utils/moments/colors';
import { useScreenReaderMode } from '@/components/moments/core/useScreenReaderMode';

export type { CapsuleTone };
export type CapsuleSkin = 'track' | 'line';
export type CapsuleSize = 'lg' | 'md';
export type CapsuleResultIcon = 'check' | 'lock' | 'flag';
export type CapsulePhase = 'idle' | 'drag' | 'nudge' | 'hold' | 'sr' | 'busy' | 'resolving' | 'done';

export interface CapsuleCopy {
  /** "Slide to approve · +$4,200.00" (the words always state action + amount). */
  label: string;
  /** "Approving…" */
  busyLabel: string;
  /** "Approve, $4,200.00": accessibilityLabel of the button mode. */
  srLabel: string;
  /** "Confirm approve · +$4,200.00": the Confirm segment's text. */
  srConfirm: string;
  /** Default MOMENT_COPY.srHint. */
  srHint?: string;
}

export interface CapsuleGeometryLive { W: number; T: number; D: number; H: number; inset: number; Wb: number }

export interface CapsuleValues {
  /** Raw gesture translation (+ offset); the ONLY value the gesture writes. */
  x: Animated.Value;
  /** Raw translation while disabled. */
  nudgeX: Animated.Value;
  /** Resisted travel = x.interpolate(resistanceTable(T)) + nudge rubber. */
  f: Animated.AnimatedInterpolation<number>;
  /** inset + D + f */
  lead: Animated.AnimatedAddition<number>;
  /** Left edge; rest = inset. */
  trail: Animated.Value;
  /** clamp(f / T, 0, 1) */
  progress: Animated.AnimatedInterpolation<number>;
  tone: { success: Animated.Value; danger: Animated.Value; neutral: Animated.Value };
  icon: { chev: Animated.Value; release: Animated.Value; lock: Animated.Value; bang: Animated.Value;
          clock: Animated.Value; result: Animated.Value };
  /** spin loops 0 -> 1 every 900 ms (rotate 0 -> 360deg). */
  ring: Animated.Value; spin: Animated.Value;
  checkShort: Animated.Value; checkLong: Animated.Value; checkY: Animated.Value;
  headScale: Animated.Value; capsuleOpacity: Animated.Value; arm: Animated.Value;
  label: Animated.Value; busy: Animated.Value; result: Animated.Value; resultX: Animated.Value;
  reason: Animated.Value; reasonY: Animated.Value; lockRim: Animated.Value; sr: Animated.Value;
  /** The "what happens next" line under the track (additive). */
  next: Animated.Value;
}

export interface ConfirmedContext {
  result: Extract<CommitResult, { status: 'confirmed' }>;
  values: CapsuleValues; geometry: CapsuleGeometryLive; reduced: boolean;
  /** false once reset/unmounted/superseded */
  alive: () => boolean;
  /** rejects (MOMENT_ABORT) when !alive */
  wait: (ms: number) => Promise<void>;
}

export const MOMENT_ABORT: unique symbol = Symbol('moment-abort');

export interface UseCommitCapsuleOptions {
  skin: CapsuleSkin; size?: CapsuleSize; tone?: CapsuleTone; threshold?: number;
  copy: CapsuleCopy;
  /** non-null = disabled with reason (legal+offline passes offlineLegalReason()) */
  disabledReason?: string | null;
  /** wrapped in runCommit(write, writeOptions) by the hook */
  write: () => Promise<CommitResult>;
  writeOptions: CommitWriteOptions;
  resultIcon?: CapsuleResultIcon; settle?: boolean; holdMs?: number;
  /** after the result hold (holdMs) */
  onDone?: (r: CommitResult) => void;
  /** the instant a result is known (before visuals) */
  onResolved?: (r: CommitResult) => void;
  /** the screen closed mid-commit: caller shows NailIt / toast */
  onResultAfterUnmount?: (r: CommitResult) => void;
  /**
   * Step 0: an answer that arrived AFTER the timeout already resolved the
   * moment (runCommit's onLateResult). A late confirmed write reaches the
   * screen so it can refresh the record and say so; the capsule itself never
   * replays a result it already showed.
   */
  onLateResult?: (r: CommitResult) => void;
  /** line skin: lock the pad, dim fields */
  onCommitStart?: () => void;
  /** refused or timeout: unlock the pad */
  onUncommit?: (r: CommitResult) => void;
  /**
   * skin override for 'success' ONLY (line -> seal). Answers 'neutral' when the
   * skin resolved the confirmed answer as a plain line (no seal): the capsule's
   * own display then takes the cap role, never 'success'.
   */
  playConfirmed?: (ctx: ConfirmedContext) => Promise<void | 'neutral'>;
  /** line skin: head hidden (arm 0) while disabled; X shows instead */
  hideWhenDisabled?: boolean;
  testID?: string;
}

/** What the result slot shows (additive): the title/detail and which ink it takes. */
export interface CapsuleDisplay {
  title: string;
  detail?: string;
  /** success -> onSuccess, neutral -> onNeutral, cap -> capOn[tone] */
  role: 'success' | 'neutral' | 'cap';
}

export interface CommitCapsule {
  phase: CapsulePhase; values: CapsuleValues; geometry: CapsuleGeometryLive | null;
  onRailLayout: (e: LayoutChangeEvent) => void;
  gestureProps: { onGestureEvent: (...args: any[]) => void; onHandlerStateChange: (e: any) => void;
                  activeOffsetX: number[]; failOffsetY: number[]; hitSlop: number; enabled: boolean };
  /** VoiceOver/TalkBack on -> button mode */
  screenReader: boolean;
  srOpen: boolean; openConfirm: () => void; confirm: () => void; cancel: () => void;
  /** focus target (setAccessibilityFocus) */
  confirmRef: React.RefObject<any>;
  /** role, label, hint, state, accessibilityActions [{name:'activate'}], onAccessibilityAction */
  headA11yProps: object;
  /** web/desktop (onFocus is additive) */
  keyboard: { onKeyDown: (e: any) => void; onKeyUp: (e: any) => void; onBlur: () => void; onFocus: () => void };
  /** Cmd+Enter: plays the 700 ms fill, then commits (never an instant commit) */
  playHoldToCommit: () => void;
  /** stays until the next touch */
  reason: { text: string; tone: 'danger' | 'warning' } | null;
  result: CommitResult | null; disabled: boolean; reset: () => void; markTouched: () => void; touched: boolean;
  // ── additive (authored with the contract) ──
  /** The plan the last result played. */
  plan: ResolvePlan | null;
  /** The result slot's text and ink role, or null. */
  display: CapsuleDisplay | null;
  /** The "what happens next" line under the track, or null. */
  nextLine: string | null;
  /** The element that carries headA11yProps (focus returns here on Cancel). */
  headRef: React.RefObject<any>;
  /** The head has KEYBOARD focus (draw the focus ring). A mouse press that
   *  focuses the head on web never sets it (utils/moments/focusModality). */
  focused: boolean;
  /** Reduce Motion as the hook read it this render. */
  reduced: boolean;
  /** The shimmer may run (idle, never touched, not disabled, motion on). */
  shimmer: boolean;
  /** The threshold in use (0.85, compact 0.70, or the caller's). */
  threshold: number;
}

// ─────────────────────────────────────────────────────────────────────────────

const EASE_OUT = Easing.bezier(MOMENT_EASE.out[0], MOMENT_EASE.out[1], MOMENT_EASE.out[2], MOMENT_EASE.out[3]);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** "Approving…" -> "Approving" (the announcement never reads an ellipsis). */
export function stripEllipsis(s: string): string {
  return s.replace(/(…|\.\.\.)\s*$/, '').trim();
}

type Base = Omit<CapsuleValues, 'f' | 'lead' | 'progress'>;

/** Every plain value and its resting number; reset() walks this, never a named value. */
function restingOf(inset: number, arm: number) {
  return {
    x: 0, nudgeX: 0, trail: inset,
    tone: { success: 0, danger: 0, neutral: 0 },
    icon: { chev: 1, release: 0, lock: 0, bang: 0, clock: 0, result: 0 },
    ring: 0, spin: 0, checkShort: 0, checkLong: 0, checkY: 0,
    headScale: 1, capsuleOpacity: 1, arm,
    label: 1, busy: 0, result: 0, resultX: 8,
    reason: 0, reasonY: MT.reasonRise, lockRim: 0, sr: 0, next: 0,
  };
}
type Resting = ReturnType<typeof restingOf>;

function makeBase(rest: Resting): Base {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === 'number') out[k] = new Animated.Value(v);
    else {
      const inner: Record<string, Animated.Value> = {};
      for (const [ik, iv] of Object.entries(v as Record<string, number>)) inner[ik] = new Animated.Value(iv);
      out[k] = inner;
    }
  }
  return out as unknown as Base;
}

/** Walk every value: fn(value, restingNumber). */
function eachValue(base: Base, rest: Resting, fn: (v: Animated.Value, r: number) => void): void {
  const b = base as unknown as Record<string, Animated.Value | Record<string, Animated.Value>>;
  for (const [k, r] of Object.entries(rest)) {
    const v = b[k];
    if (typeof r === 'number') fn(v as Animated.Value, r);
    else for (const [ik, ir] of Object.entries(r as Record<string, number>)) fn((v as Record<string, Animated.Value>)[ik], ir);
  }
}

function tw(v: Animated.Value, toValue: number, duration: number): void {
  Animated.timing(v, { toValue, duration, easing: EASE_OUT, useNativeDriver: nativeDriver }).start();
}

function sp(v: Animated.Value, toValue: number, cfg: SpringCfg, velocity?: number): void {
  Animated.spring(v, {
    toValue,
    stiffness: cfg.stiffness,
    damping: cfg.damping,
    mass: cfg.mass,
    velocity: velocity ?? 0,
    useNativeDriver: nativeDriver,
  }).start();
}

type Pending = { g: number; result: CommitResult | null; delivered: boolean };

export function useCommitCapsule(o: UseCommitCapsuleOptions): CommitCapsule {
  const skin = o.skin;
  const size: CapsuleSize = o.size ?? 'lg';
  const geo = skin === 'line' ? CAPSULE_GEOMETRY.line : CAPSULE_GEOMETRY[size];
  const compact = skin === 'track' && size === 'md';
  const threshold = o.threshold ?? (compact ? CAPSULE_RULES.thresholdCompact : CAPSULE_RULES.threshold);
  const holdMs = o.holdMs ?? (compact ? MT.holdMsCompact : MT.holdMs);
  const settleOn = o.settle ?? !compact;
  const resultIcon: CapsuleResultIcon = o.resultIcon ?? 'check';
  const hideArm = skin === 'line' && !!o.hideWhenDisabled;

  const reduced = useReducedMotion();
  const screenReader = useScreenReaderMode();

  const optsRef = useRef(o);
  optsRef.current = o;
  const screenReaderRef = useRef(screenReader);
  screenReaderRef.current = screenReader;

  // ── values ────────────────────────────────────────────────────────────────
  const restRef = useRef<Resting | null>(null);
  if (!restRef.current) restRef.current = restingOf(geo.inset, hideArm && o.disabledReason ? 0 : 1);
  const baseRef = useRef<Base | null>(null);
  if (!baseRef.current) baseRef.current = makeBase(restRef.current);
  const v = baseRef.current;

  const [W, setW] = useState<number | null>(null);
  const geometry = useMemo<CapsuleGeometryLive | null>(() => {
    if (W == null) return null;
    return { W, T: Math.max(40, W - 2 * geo.inset - geo.D), D: geo.D, H: geo.H, inset: geo.inset, Wb: Math.max(0, W - 2 * geo.inset) };
  }, [W, geo.inset, geo.D, geo.H]);
  const geomRef = useRef(geometry);
  geomRef.current = geometry;

  const T = geometry?.T ?? 40;
  const values = useMemo<CapsuleValues>(() => {
    const rt = resistanceTable(T);
    const dt = disabledTable();
    const f = Animated.add(
      v.x.interpolate({ inputRange: rt.inputRange, outputRange: rt.outputRange, extrapolate: 'clamp' }),
      v.nudgeX.interpolate({ inputRange: dt.inputRange, outputRange: dt.outputRange, extrapolate: 'clamp' }),
    ).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'extend' });
    const lead = Animated.add(f, geo.inset + geo.D);
    const progress = f.interpolate({ inputRange: [0, T], outputRange: [0, 1], extrapolate: 'clamp' });
    return { ...v, f, lead, progress };
  }, [v, T, geo.inset, geo.D]);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // ── state ─────────────────────────────────────────────────────────────────
  const [phase, setPhaseState] = useState<CapsulePhase>('idle');
  const phaseRef = useRef<CapsulePhase>('idle');
  const [srOpen, setSrOpen] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [plan, setPlan] = useState<ResolvePlan | null>(null);
  const [display, setDisplay] = useState<CapsuleDisplay | null>(null);
  const [nextLine, setNextLine] = useState<string | null>(null);
  const [reason, setReason] = useState<{ text: string; tone: 'danger' | 'warning' } | null>(null);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  /** The head holds DOM focus (keyboard or mouse); `focused` is the keyboard half. */
  const hasFocusRef = useRef(false);

  const mountedRef = useRef(false);
  const genRef = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const lockedRef = useRef(false);
  const lastNRef = useRef(0);
  const lastTxRef = useRef(0);
  const offsetRef = useRef(0);
  const touchedRef = useRef(false);
  const reasonOnRef = useRef(false);
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdListenerRef = useRef<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const confirmRef = useRef<any>(null);
  const headRef = useRef<any>(null);

  // disabled never flips mid-gesture or mid-commit: it is latched while idle.
  const disabledNow = !!o.disabledReason;
  const disabledRef = useRef(disabledNow);
  if (phaseRef.current === 'idle') disabledRef.current = disabledNow;
  const disabled = disabledRef.current;

  const setPhase = (p: CapsulePhase) => {
    phaseRef.current = p;
    if (mountedRef.current) setPhaseState(p);
  };

  // ── timers (gen-gated) ───────────────────────────────────────────────────
  const alive = (g: number) => genRef.current === g && mountedRef.current;
  const later = (g: number, ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (alive(g)) fn();
    }, ms);
    timersRef.current.add(id);
  };
  const wait = (g: number, ms: number) => new Promise<void>((res, rej) => {
    if (!alive(g)) { rej(MOMENT_ABORT); return; }
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (alive(g)) res(); else rej(MOMENT_ABORT);
    }, ms);
    timersRef.current.add(id);
  });

  // ── small pieces ─────────────────────────────────────────────────────────
  const startSpin = () => {
    if (spinRef.current) return;
    v.spin.setValue(0);
    const a = Animated.loop(Animated.timing(v.spin, { toValue: 1, duration: MT.ringRev, easing: Easing.linear, useNativeDriver: nativeDriver }));
    spinRef.current = a;
    a.start();
  };
  const stopSpin = () => {
    spinRef.current?.stop();
    spinRef.current = null;
  };

  const markTouched = () => {
    if (touchedRef.current) return;
    touchedRef.current = true;
    if (mountedRef.current) setTouched(true);
  };

  const hideReason = () => {
    if (!reasonOnRef.current) return;
    reasonOnRef.current = false;
    tw(v.reason, 0, MT.reasonOut);
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (!mountedRef.current || reasonOnRef.current) return;
      // Line skin: the label takes the reason's slot now. It fades in (0 -> 1
      // over reasonIn) rather than popping at the full opacity the failure path
      // left on v.label; under Reduce Motion it is simply there (1). Skipped when
      // a commit or the SR bar has already taken the label away.
      const ph = phaseRef.current;
      if (skin === 'line' && (ph === 'idle' || ph === 'nudge' || ph === 'drag' || ph === 'hold')) {
        v.label.stopAnimation();
        if (reducedMotion()) v.label.setValue(1);
        else {
          v.label.setValue(0);
          tw(v.label, 1, MT.reasonIn);
        }
      }
      setReason(null);
    }, MT.reasonOut);
    timersRef.current.add(id);
  };

  const focusLater = (ref: React.RefObject<any>, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      const node = ref.current;
      if (!node || !mountedRef.current) return;
      try {
        if (Platform.OS === 'web') { node.focus?.(); return; }
        const tag = findNodeHandle(node);
        if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
      } catch { /* focus is a courtesy */ }
    }, ms);
    timersRef.current.add(id);
  };

  const setLock = (on: boolean, quiet?: boolean) => {
    if (lockedRef.current === on) return;
    lockedRef.current = on;
    tw(v.lockRim, on ? 1 : 0, MT.lockFade);
    tw(v.icon.chev, on ? 0 : 1, MT.lockFade);
    tw(v.icon.release, on ? 1 : 0, MT.lockFade);
    if (!reducedMotion()) sp(v.headScale, on ? CAPSULE_RULES.lockScale : CAPSULE_RULES.grabScale, MOMENT_SPRING.headScale);
    if (!quiet) momentHaptic(on ? 'medium' : 'selection');
  };

  const track = (p: number) => {
    const ns = notchStep(lastNRef.current, p, threshold);
    lastNRef.current = ns.n;
    if (ns.fire) momentHaptic('selection');
    const nl = lockStep(lockedRef.current, p, threshold);
    if (nl !== lockedRef.current) setLock(nl);
  };

  const removeHoldListener = () => {
    if (holdListenerRef.current != null) {
      v.x.removeListener(holdListenerRef.current);
      holdListenerRef.current = null;
    }
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  /** Disabled: warning haptic once per attempt, the label pulses, the reason is spoken. */
  const disabledAttempt = () => {
    momentHaptic('warning');
    v.label.setValue(MT.reasonPulseFrom);
    tw(v.label, 1, MT.reasonPulse);
    announce(optsRef.current.disabledReason ?? '');
  };

  const showNext = (g: number, text: string | undefined, delay: number) => {
    if (!text) return;
    setNextLine(text);
    later(g, delay, () => tw(v.next, 1, MT.resultIn));
  };

  const finish = (g: number, r: CommitResult) => {
    setPhase('done');
    later(g, holdMs, () => { try { optsRef.current.onDone?.(r); } catch { /* caller's problem */ } });
  };

  // ── delivery (onResolved / onResultAfterUnmount exactly once per commit) ──
  const deliver = (p: Pending) => {
    if (p.delivered || !p.result) return;
    p.delivered = true;
    const r = p.result;
    try {
      if (!mountedRef.current) optsRef.current.onResultAfterUnmount?.(r);
      else optsRef.current.onResolved?.(r);
    } catch { /* a caller's handler must never break the capsule */ }
  };

  // ── resolve plans ────────────────────────────────────────────────────────
  async function resolveSuccessMotion(g: number, r: Extract<CommitResult, { status: 'confirmed' }>, geom: CapsuleGeometryLive) {
    tw(v.ring, 0, MT.ringOut);
    later(g, MT.ringOut + 20, stopSpin);
    tw(v.busy, 0, MT.labelOut);
    tw(v.tone.success, 1, MT.toneSuccess);
    await wait(g, MT.checkShortAt);
    tw(v.checkShort, 1, MT.checkShort);
    await wait(g, MT.checkLongAt - MT.checkShortAt);
    tw(v.checkLong, 1, MT.checkLong);
    later(g, MT.expandAt - MT.checkLongAt, () => sp(v.trail, geom.inset, MOMENT_SPRING.expand));
    await wait(g, MT.successHapticAt - MT.checkLongAt);
    // The frame the check completes: the success haptic and the words, together.
    momentHaptic('success');
    announce(r.announce ?? r.title);
    setDisplay({ title: r.title, detail: r.detail, role: 'success' });
    v.resultX.setValue(8);
    later(g, MT.resultInAt - MT.successHapticAt, () => {
      tw(v.result, 1, MT.resultIn);
      tw(v.resultX, 0, MT.resultIn);
    });
    showNext(g, r.next, MT.resultInAt - MT.successHapticAt + MT.resultIn);
    await wait(g, MT.settleAt - MT.successHapticAt);
    if (settleOn) {
      tw(v.checkY, MT.settleDy, MT.settleLift);
      await wait(g, MT.settleLift);
      sp(v.checkY, 0, MOMENT_SPRING.settle);
    }
    finish(g, r);
  }

  async function resolveSuccessReduced(g: number, r: Extract<CommitResult, { status: 'confirmed' }>) {
    tw(v.ring, 0, MT.ringOut);
    later(g, MT.ringOut + 20, stopSpin);
    tw(v.tone.success, 1, MT.reducedHold);
    v.checkShort.setValue(1);
    v.checkLong.setValue(1);
    tw(v.result, 0, 80);
    await wait(g, 80);
    setDisplay({ title: r.title, detail: r.detail, role: 'success' });
    v.resultX.setValue(0);
    tw(v.result, 1, 120);
    momentHaptic('success');
    announce(r.announce ?? r.title);
    showNext(g, r.next, 120);
    finish(g, r);
  }

  async function resolveConfirmedBySkin(g: number, r: Extract<CommitResult, { status: 'confirmed' }>, geom: CapsuleGeometryLive,
    play: (ctx: ConfirmedContext) => Promise<void | 'neutral'>) {
    const ctx: ConfirmedContext = {
      result: r, values: valuesRef.current, geometry: geom, reduced: reducedMotion(),
      alive: () => alive(g), wait: (ms: number) => wait(g, ms),
    };
    const how = await play(ctx);
    if (!alive(g)) return;
    stopSpin();
    setDisplay({ title: r.title, detail: r.detail, role: how === 'neutral' ? 'cap' : 'success' });
    showNext(g, r.next, 0);
    finish(g, r);
  }

  async function resolveNeutralDone(g: number, r: Extract<CommitResult, { status: 'confirmed' }>, geom: CapsuleGeometryLive) {
    tw(v.ring, 0, MT.ringOut);
    later(g, MT.ringOut + 20, stopSpin);
    if (reducedMotion()) {
      tw(v.icon.result, 1, MT.reducedHold);
      tw(v.result, 0, 80);
      await wait(g, 80);
      setDisplay({ title: r.title, detail: r.detail, role: 'cap' });
      v.resultX.setValue(0);
      tw(v.result, 1, 120);
      momentHaptic('medium');
      announce(r.announce ?? r.title);
      showNext(g, r.next, 120);
      finish(g, r);
      return;
    }
    tw(v.busy, 0, MT.labelOut);
    await wait(g, MT.neutralIconAt);
    tw(v.icon.result, 1, MT.neutralIconIn);
    later(g, MT.neutralExpandAt, () => sp(v.trail, geom.inset, MOMENT_SPRING.expand));
    await wait(g, MT.neutralHapticAt);
    momentHaptic('medium');
    announce(r.announce ?? r.title);
    setDisplay({ title: r.title, detail: r.detail, role: 'cap' });
    v.resultX.setValue(8);
    later(g, 40, () => {
      tw(v.result, 1, MT.resultIn);
      tw(v.resultX, 0, MT.resultIn);
    });
    showNext(g, r.next, 40 + MT.resultIn);
    await wait(g, MT.resultInAt);
    finish(g, r);
  }

  async function resolveQueued(g: number, r: Extract<CommitResult, { status: 'queued' }>, geom: CapsuleGeometryLive) {
    const label = r.title ?? momentCopy().queued;
    const rm = reducedMotion();
    tw(v.ring, 0, MT.ringOut);
    later(g, MT.ringOut + 20, stopSpin);
    tw(v.busy, 0, MT.labelOut);
    tw(v.tone.neutral, 1, rm ? MT.reducedHold : MT.toneSuccess);
    if (rm) { tw(v.result, 0, 80); await wait(g, 80); } else await wait(g, MT.queuedIconAt);
    tw(v.icon.clock, 1, MT.neutralIconIn);
    momentHaptic('light');
    announce(r.announce ?? label);
    setDisplay({ title: label, role: 'neutral' });
    v.resultX.setValue(rm ? 0 : 8);
    if (!rm) {
      later(g, MT.queuedExpandAt, () => sp(v.trail, geom.inset, MOMENT_SPRING.expand));
      await wait(g, MT.queuedResultAt);
      tw(v.resultX, 0, MT.resultIn);
    }
    tw(v.result, 1, MT.resultIn);
    showNext(g, r.next, MT.resultIn);
    finish(g, r);
  }

  async function resolveUncommit(g: number, r: CommitResult, p: ResolvePlan, geom: CapsuleGeometryLive) {
    const timeout = p === 'timeout';
    const text = r.status === 'timeout' ? r.message : r.status === 'refused' ? r.reason : legalQueuedLine(optsRef.current.writeOptions);
    const toneV = timeout ? v.tone.neutral : v.tone.danger;
    const haptic = timeout ? 'warning' : 'error';
    try { optsRef.current.onUncommit?.(r); } catch { /* the pad must still unlock visually */ }
    setReason({ text, tone: timeout ? 'warning' : 'danger' });
    reasonOnRef.current = true;
    tw(v.ring, 0, MT.ringOut);
    later(g, MT.ringOut + 20, stopSpin);
    const spoken = r.announce ?? text;
    if (reducedMotion()) {
      tw(toneV, 1, MT.reducedHold);
      tw(v.icon.bang, 1, MT.reducedHold);
      momentHaptic(haptic);
      announce(spoken);
      await wait(g, MT.reducedFailHold);
      tw(v.capsuleOpacity, 0, MT.reducedFade);
      await wait(g, MT.reducedFade);
      v.x.stopAnimation();
      v.x.setValue(0);
      v.trail.setValue(geom.inset);
      toneV.setValue(0);
      v.icon.bang.setValue(0);
      v.icon.chev.setValue(1);
      v.result.setValue(0);
      v.busy.setValue(0);
      v.reason.setValue(1);
      v.reasonY.setValue(0);
      // Both skins: the line's Over layer shows reason OR label, never both, so
      // restoring the label here only matters once the reason clears.
      v.label.setValue(1);
      setDisplay(null);
      tw(v.capsuleOpacity, 1, MT.reducedFade);
      setPhase('idle');
      return;
    }
    tw(toneV, 1, MT.failTone);
    later(g, MT.failIconAt, () => {
      tw(v.icon.bang, 1, MT.failIcon);
      momentHaptic(haptic);
      announce(spoken);
    });
    await wait(g, MT.failHomeLeadAt);
    // The trailing edge home first (fast), then the head (slow): it pulls itself home.
    sp(v.trail, geom.inset, MOMENT_SPRING.homeLead);
    tw(v.busy, 0, MT.reasonIn);
    tw(v.result, 0, MT.labelOut);
    v.reasonY.setValue(MT.reasonRise);
    tw(v.reason, 1, MT.reasonIn);
    tw(v.reasonY, 0, MT.reasonIn);
    await wait(g, MT.failHomeTrailAt - MT.failHomeLeadAt);
    sp(v.x, 0, MOMENT_SPRING.homeTrail);
    tw(toneV, 0, MT.failToneBack);
    later(g, MT.failChevAt - MT.failHomeTrailAt, () => {
      tw(v.icon.bang, 0, MT.failIcon);
      tw(v.icon.chev, 1, MT.neutralIconIn);
    });
    later(g, MT.failLabelAt - MT.failHomeTrailAt, () => {
      tw(v.label, 1, MT.reasonIn); // both skins (see the Reduce Motion path)
      setDisplay(null);
      setPhase('idle');
    });
  }

  // ── commit ────────────────────────────────────────────────────────────────
  async function sequence(g: number, vx: number, resultP: Promise<CommitResult>, pending: Pending) {
    const geom = geomRef.current;
    if (!geom) return;
    const opts = optsRef.current;
    const minBusy = opts.writeOptions.minBusyMs ?? MT.minBusy;
    let r: CommitResult;
    if (reducedMotion()) {
      tw(v.capsuleOpacity, 0, MT.reducedFade);
      await wait(g, MT.reducedFade);
      v.x.stopAnimation();
      v.x.setValue(geom.T);
      v.trail.stopAnimation();
      v.trail.setValue(skin === 'line' ? geom.inset + geom.T : geom.inset);
      for (const k of ['chev', 'release'] as const) { v.icon[k].stopAnimation(); v.icon[k].setValue(0); }
      v.lockRim.stopAnimation(); v.lockRim.setValue(0);
      v.headScale.stopAnimation(); v.headScale.setValue(1);
      v.label.stopAnimation(); v.label.setValue(0);
      if (skin === 'track') {
        setDisplay({ title: opts.copy.busyLabel, role: 'cap' });
        v.resultX.setValue(0);
        v.result.setValue(1);
      } else {
        v.busy.setValue(1);
      }
      v.ring.setValue(1);
      startSpin();
      tw(v.capsuleOpacity, 1, MT.reducedFade);
      await wait(g, MT.reducedFade);
      momentHaptic('rigid');
      [r] = await Promise.all([resultP, wait(g, MT.reducedHold)]);
    } else {
      sp(v.x, geom.T, MOMENT_SPRING.dock, vx);
      tw(v.icon.chev, 0, MT.iconFade);
      tw(v.icon.release, 0, MT.iconFade);
      tw(v.lockRim, 0, MT.lockRimOut);
      sp(v.headScale, 1, MOMENT_SPRING.headScale);
      later(g, MT.rigidHapticAt, () => momentHaptic('rigid'));
      await wait(g, MT.contractAt);
      tw(v.busy, 1, MT.busyIn);
      tw(v.label, 0, MT.labelOut);
      sp(v.trail, geom.inset + geom.T, MOMENT_SPRING.contractTrail);
      later(g, MT.ringAt - MT.contractAt, () => {
        tw(v.ring, 1, MT.ringIn);
        startSpin();
      });
      [r] = await Promise.all([resultP, wait(g, Math.max(0, minBusy - MT.contractAt))]);
    }
    if (!alive(g)) return;
    setPhase('resolving');
    const p = resolvePlan(r, { legal: opts.writeOptions.legal, resultIcon });
    setResult(r);
    setPlan(p);
    pending.result = r;
    deliver(pending);
    const play = opts.playConfirmed;
    if (p === 'success' && r.status === 'confirmed') {
      if (play) await resolveConfirmedBySkin(g, r, geom, play);
      else if (reducedMotion()) await resolveSuccessReduced(g, r);
      else await resolveSuccessMotion(g, r, geom);
    } else if (p === 'neutral-done' && r.status === 'confirmed') {
      await resolveNeutralDone(g, r, geom);
    } else if (p === 'queued' && r.status === 'queued') {
      await resolveQueued(g, r, geom);
    } else {
      await resolveUncommit(g, r, p === 'timeout' ? 'timeout' : 'uncommit', geom);
    }
  }

  const commit = (vx: number) => {
    const ph = phaseRef.current;
    if (!(ph === 'idle' || ph === 'drag' || ph === 'hold' || ph === 'sr')) return;
    if (disabledRef.current || !geomRef.current) return;
    // FIRST, synchronously: a second release or Confirm now finds 'busy'.
    setPhase('busy');
    const g = ++genRef.current;
    lockedRef.current = false;
    removeHoldListener();
    const opts = optsRef.current;
    announce(stripEllipsis(opts.copy.busyLabel));
    try { opts.onCommitStart?.(); } catch { /* the commit goes on */ }
    const pending: Pending = { g, result: null, delivered: false };
    pendingRef.current = pending;
    const resultP = runCommit(opts.write, {
      ...opts.writeOptions,
      // The latest listener at the moment the late answer lands, never a stale render's.
      onLateResult: (late) => { try { optsRef.current.onLateResult?.(late); } catch { /* a caller's handler must never break the capsule */ } },
    });
    resultP.then((r) => {
      pending.result = r;
      // Unmounted (or reset) before the timeline could resolve it: hand it over now.
      if (!mountedRef.current || genRef.current !== g) deliver(pending);
    });
    sequence(g, vx, resultP, pending).catch((e) => {
      if (e !== MOMENT_ABORT && __DEV__) console.warn('[moments] commit sequence failed', e);
    });
  };

  // ── gesture ───────────────────────────────────────────────────────────────
  const began = () => {
    if (phaseRef.current !== 'idle') return;
    markTouched();
    hideReason();
    lastTxRef.current = 0;
    lastNRef.current = 0;
    lockedRef.current = false;
    if (disabledRef.current) {
      setPhase('nudge');
      v.nudgeX.stopAnimation((val: number) => {
        if (Math.abs(val) > 0.01) { v.nudgeX.setOffset(val); v.nudgeX.setValue(0); }
      });
      return;
    }
    setPhase('drag');
    offsetRef.current = 0;
    // A grab during a snap-back never jumps: the head is caught where it is.
    v.x.stopAnimation((val: number) => {
      if (Math.abs(val) > 0.01) { offsetRef.current = val; v.x.setOffset(val); v.x.setValue(0); }
    });
    momentHaptic('selection');
    if (!reducedMotion()) sp(v.headScale, CAPSULE_RULES.grabScale, MOMENT_SPRING.headScale);
  };

  const ended = (tx: number, vx: number, allowCommit: boolean) => {
    const ph = phaseRef.current;
    if (ph === 'nudge') {
      v.nudgeX.setValue(tx);
      v.nudgeX.flattenOffset();
      setPhase('idle');
      disabledAttempt();
      sp(v.nudgeX, 0, MOMENT_SPRING.snapBack, vx);
      return;
    }
    if (ph !== 'drag') return;
    // JS mirror = native BEFORE any spring: value first (offset kept), then flatten.
    v.x.setValue(tx);
    v.x.flattenOffset();
    const xv = offsetRef.current + tx;
    offsetRef.current = 0;
    const geom = geomRef.current;
    const Tn = geom?.T ?? 40;
    const fv = resist(xv, Tn);
    const p = clamp(fv / Tn, 0, 1);
    if (allowCommit && geom && shouldCommit({ locked: lockedRef.current, progress: p, vx, f: fv, T: Tn })) {
      commit(vx);
      return;
    }
    setPhase('idle');
    setLock(false, true);
    if (!reducedMotion()) sp(v.headScale, 1, MOMENT_SPRING.headScale);
    sp(v.x, 0, MOMENT_SPRING.snapBack, vx);
  };

  const onDrag = (e: any) => {
    const tx = Number(e?.nativeEvent?.translationX ?? 0);
    lastTxRef.current = tx;
    if (phaseRef.current !== 'drag') return;
    const geom = geomRef.current;
    if (!geom) return;
    track(clamp(resist(offsetRef.current + tx, geom.T) / geom.T, 0, 1));
  };

  const onState = (e: any) => {
    const ne = e?.nativeEvent ?? {};
    const st = ne.state;
    if (st === State.BEGAN) began();
    else if (st === State.END || st === State.CANCELLED || st === State.FAILED) {
      const tx = typeof ne.translationX === 'number' ? ne.translationX : lastTxRef.current;
      ended(tx, st === State.END && typeof ne.velocityX === 'number' ? ne.velocityX : 0, st === State.END);
    }
  };

  // ── keyboard hold / sheet hotkey ─────────────────────────────────────────
  const keyNudge = () => {
    disabledAttempt();
    setPhase('nudge');
    tw(v.nudgeX, MT.nudgePx, MT.nudgeOut);
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (!mountedRef.current) return;
      sp(v.nudgeX, 0, MOMENT_SPRING.snapBack);
      if (phaseRef.current === 'nudge') setPhase('idle');
    }, MT.nudgeOut);
    timersRef.current.add(id);
  };

  const startHold = () => {
    if (phaseRef.current !== 'idle') return;
    markTouched();
    hideReason();
    if (disabledRef.current) { keyNudge(); return; }
    const geom = geomRef.current;
    if (!geom) return;
    setPhase('hold');
    lastNRef.current = 0;
    lockedRef.current = false;
    momentHaptic('selection');
    removeHoldListener();
    holdListenerRef.current = v.x.addListener(({ value }) => {
      if (phaseRef.current === 'hold') track(clamp(resist(value, geom.T) / geom.T, 0, 1));
    });
    Animated.timing(v.x, { toValue: geom.T, duration: MT.holdFill, easing: EASE_OUT, useNativeDriver: nativeDriver }).start();
    // It commits when the fill lands: a timer of the fill's own length.
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (mountedRef.current && phaseRef.current === 'hold') commit(0);
    }, MT.holdFill);
  };

  const cancelHold = () => {
    if (phaseRef.current !== 'hold') return;
    removeHoldListener();
    v.x.stopAnimation();
    setPhase('idle');
    setLock(false, true);
    sp(v.x, 0, MOMENT_SPRING.snapBack);
  };

  // ── screen reader ────────────────────────────────────────────────────────
  const openConfirm = () => {
    if (phaseRef.current !== 'idle') return;
    const opts = optsRef.current;
    if (disabledRef.current) { announce(opts.disabledReason ?? ''); return; }
    const geom = geomRef.current;
    markTouched();
    hideReason();
    setPhase('sr');
    setSrOpen(true);
    tw(v.label, 0, MT.labelOut);
    tw(v.icon.chev, 0, MT.labelOut);
    if (skin === 'track' && geom) {
      const target = (geom.W - 2 * geom.inset) * CAPSULE_RULES.srConfirmFrac - geom.D;
      if (reducedMotion()) v.x.setValue(target);
      else tw(v.x, target, MT.srOpen);
    }
    tw(v.sr, 1, MT.srBar);
    announce(`${opts.copy.srConfirm}. Button. Cancel. Button.`);
    focusLater(confirmRef, 60);
  };

  const confirm = () => {
    if (phaseRef.current !== 'sr') return;
    setSrOpen(false);
    tw(v.sr, 0, MT.labelOut);
    commit(0);
  };

  const cancel = () => {
    if (phaseRef.current !== 'sr') return;
    setSrOpen(false);
    tw(v.sr, 0, MT.srClose);
    tw(v.label, 1, MT.reasonIn);
    tw(v.icon.chev, 1, MT.neutralIconIn);
    if (reducedMotion()) v.x.setValue(0);
    else sp(v.x, 0, MOMENT_SPRING.snapBack);
    setPhase('idle');
    focusLater(headRef, 60);
  };

  const reset = () => {
    genRef.current += 1;
    removeHoldListener();
    stopSpin();
    const rest = restRef.current!;
    const armRest = hideArm && optsRef.current.disabledReason ? 0 : 1;
    eachValue(v, rest, (val, r) => {
      val.stopAnimation();
      val.setOffset(0);
      val.setValue(val === v.arm ? armRest : r);
    });
    lockedRef.current = false;
    lastNRef.current = 0;
    offsetRef.current = 0;
    reasonOnRef.current = false;
    setPhase('idle');
    if (mountedRef.current) {
      setSrOpen(false);
      setResult(null);
      setPlan(null);
      setDisplay(null);
      setNextLine(null);
      setReason(null);
    }
  };

  // ── latest-function bridge: stable callbacks call the newest closures ────
  const fnRef = useRef({ onDrag, onState, startHold, cancelHold, openConfirm, confirm, cancel, reset, markTouched });
  fnRef.current = { onDrag, onState, startHold, cancelHold, openConfirm, confirm, cancel, reset, markTouched };

  const listener = useCallback((e: any) => fnRef.current.onDrag(e), []);
  const nudgeListener = useCallback((e: any) => { lastTxRef.current = Number(e?.nativeEvent?.translationX ?? 0); }, []);
  const dragEvent = useMemo(
    () => Animated.event([{ nativeEvent: { translationX: v.x } }], { useNativeDriver: nativeDriver, listener }),
    [v.x, listener],
  );
  const nudgeEvent = useMemo(
    () => Animated.event([{ nativeEvent: { translationX: v.nudgeX } }], { useNativeDriver: nativeDriver, listener: nudgeListener }),
    [v.nudgeX, nudgeListener],
  );
  const onHandlerStateChange = useCallback((e: any) => fnRef.current.onState(e), []);

  const onRailLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e?.nativeEvent?.layout?.width ?? 0);
    if (w > 0) setW((prev) => (prev === w ? prev : w));
  }, []);

  const stableOpen = useCallback(() => fnRef.current.openConfirm(), []);
  const stableConfirm = useCallback(() => fnRef.current.confirm(), []);
  const stableCancel = useCallback(() => fnRef.current.cancel(), []);
  const stableReset = useCallback(() => fnRef.current.reset(), []);
  const stableTouched = useCallback(() => fnRef.current.markTouched(), []);
  const playHoldToCommit = useCallback(() => fnRef.current.startHold(), []);

  const keyboard = useMemo(() => {
    const keyOf = (e: any): string => String(e?.nativeEvent?.key ?? e?.key ?? '');
    const isRepeat = (e: any): boolean => !!(e?.nativeEvent?.repeat ?? e?.repeat);
    return {
      onKeyDown: (e: any) => {
        const key = keyOf(e);
        if (key === 'Escape') { fnRef.current.cancelHold(); return; }
        if (key !== ' ' && key !== 'Enter' && key !== 'Spacebar') return;
        e?.preventDefault?.();
        if (isRepeat(e)) return;
        if (screenReaderRef.current) { fnRef.current.openConfirm(); return; }
        fnRef.current.startHold();
      },
      onKeyUp: (e: any) => {
        const key = keyOf(e);
        if (key === ' ' || key === 'Enter' || key === 'Spacebar') fnRef.current.cancelHold();
      },
      onBlur: () => {
        hasFocusRef.current = false;
        setFocused(false);
        fnRef.current.cancelHold();
      },
      // Chrome and Edge focus the head's <button> on a mouse press: only a
      // focus the keyboard drove rings it (the :focus-visible rule).
      onFocus: () => {
        hasFocusRef.current = true;
        setFocused(inputModality() === 'keyboard');
      },
    };
  }, []);

  // Web: track the input driver, and let the ring follow it while the head is
  // focused (a mouse press drops it, a key brings it back).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    installFocusModality();
    return subscribeInputModality((m) => {
      if (hasFocusRef.current && mountedRef.current) setFocused(m === 'keyboard');
    });
  }, []);

  // ── line skin: the head hides while disabled ─────────────────────────────
  const armFirst = useRef(true);
  useEffect(() => {
    // A hidden head leaves the tab order (CapsuleShape), so it cannot keep a
    // ring it would show again the moment it comes back.
    if (hideArm && disabled) {
      hasFocusRef.current = false;
      setFocused(false);
    }
    if (armFirst.current) { armFirst.current = false; return; }
    if (!hideArm) return;
    const want = disabled ? 0 : 1;
    if (reducedMotion()) v.arm.setValue(want);
    else if (want) sp(v.arm, 1, MOMENT_SPRING.headScale);
    else tw(v.arm, 0, 140);
  }, [disabled, hideArm, v.arm]);

  // ── mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      spinRef.current?.stop();
      spinRef.current = null;
      if (holdTimerRef.current != null) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (holdListenerRef.current != null) v.x.removeListener(holdListenerRef.current);
      holdListenerRef.current = null;
      // A result already known but not yet shown goes to the caller now.
      const p = pendingRef.current;
      if (p && p.result && !p.delivered) {
        p.delivered = true;
        try { optsRef.current.onResultAfterUnmount?.(p.result); } catch { /* caller's problem */ }
      }
    };
  }, [v.x]);

  // ── accessibility ────────────────────────────────────────────────────────
  const copy = o.copy;
  const reasonText = o.disabledReason ?? '';
  const a11yLabel = disabled
    ? reasonText
    : phase === 'busy' || phase === 'resolving'
      ? copy.busyLabel
      : phase === 'done' && display
        ? display.title
        : copy.srLabel;
  const headA11yProps = {
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: a11yLabel,
    accessibilityHint: disabled ? reasonText : (copy.srHint ?? momentCopy().srHint),
    accessibilityState: { disabled, busy: phase === 'busy' || phase === 'resolving' },
    accessibilityActions: [{ name: 'activate' as const }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e?.nativeEvent?.actionName === 'activate') fnRef.current.openConfirm();
    },
  };

  const gestureEnabled = !screenReader && (phase === 'idle' || phase === 'drag' || phase === 'nudge');

  return {
    phase,
    values,
    geometry,
    onRailLayout,
    gestureProps: {
      onGestureEvent: (disabled ? nudgeEvent : dragEvent) as (...args: any[]) => void,
      onHandlerStateChange,
      activeOffsetX: [CAPSULE_RULES.activeOffsetX[0], CAPSULE_RULES.activeOffsetX[1]],
      failOffsetY: [CAPSULE_RULES.failOffsetY[0], CAPSULE_RULES.failOffsetY[1]],
      hitSlop: CAPSULE_RULES.hitSlop,
      enabled: gestureEnabled,
    },
    screenReader,
    srOpen,
    openConfirm: stableOpen,
    confirm: stableConfirm,
    cancel: stableCancel,
    confirmRef,
    headA11yProps,
    keyboard,
    playHoldToCommit,
    reason,
    result,
    disabled,
    reset: stableReset,
    markTouched: stableTouched,
    touched,
    plan,
    display,
    nextLine,
    headRef,
    focused,
    reduced,
    shimmer: phase === 'idle' && !touched && !reduced && !disabled && !screenReader,
    threshold,
  };
}
