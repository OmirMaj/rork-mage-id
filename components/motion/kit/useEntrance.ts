// useEntrance — the base every kit part composes: one element arriving.
//
// GOLDEN-STABLE BY CONSTRUCTION (rule R1, the Arrive / useRiseOnOpen pattern).
// The style is NULL until `armed` is first seen true (a live event after mount,
// or a mount the host armed from a live event); it is null again from the first
// render after the entrance finished (a ref flag on native, the clock on web —
// never a setState on completion). Cached data, recalled history and
// re-renders never animate: a part arms once per mount.
//
// NATIVE: opacity rides one Animated.timing whose delay is baked in as a flat
// plateau (never a JS timer); translate / scale ride the same timing, or a
// Motion.spring preset preceded by Animated.delay inside Animated.sequence.
// Every call passes `useNativeDriver: nativeDriver`; every interpolate clamps
// and carries no easing (the native allowlist has none).
//
// WEB: the registered kitCss class (compositor-run CSS) with its delay as a
// string; null on a part with no web key, under Reduce Motion, and (with
// desktopWebOnly) below the desktop gate.
//
// REDUCE MOTION: opacity only, ≤ 100 ms, nothing moves (native); nothing at
// all (web). BUDGET: an arm the app-wide budget refuses renders its end state.

import { useLayoutEffect, useRef } from 'react';
import { Animated, Platform, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { KIT_MS, KIT_SPRING, type KitSpringName } from '@/utils/motion/kit/kitSpec';
import { webMsFor } from '@/utils/motion/kit/springMath';
import { plateauEase, plateauFraction } from '@/utils/motion/kit/stagger';
import { kitWebStyle, type KitWebKey } from './css/kitCss';
import { acquire, release } from './budget';

export type EntranceSpec = {
  delayMs?: number;
  /** The opacity timing (and the move's, when there is no spring). */
  fadeMs: number;
  fromOpacity?: number;
  fromY?: number;
  fromX?: number;
  fromScale?: number;
  /** A rule drawing itself (scaleX from this to 1; transformOrigin is the host's). */
  fromScaleX?: number;
  spring?: KitSpringName | null;
  /** The web class for this entrance (null / absent: no web motion). */
  web?: KitWebKey | null;
  /** A pre-registered web style instead of a key (kitTravel / kitFadeOut). */
  webStyle?: ViewStyle | null;
  /** The web animation's real length, when webStyle is used (ms, delay included). */
  webMs?: number;
};

export type EntranceOpts = {
  onDone?: () => void;
  desktopWebOnly?: boolean;
  /** Leave false only for a node already counted by its host. */
  budget?: boolean;
};

const WEB_MS: Partial<Record<KitWebKey, number>> = {
  rise8: 220, rise8B: 220, fade: 160, fadeB: 160, send56: 280, send44: 280, pairX6: 160, pop98: 280,
  tagTL: 220, tagTR: 220, tagBR: 220, tagBL: 220, check60: 180, rollIn6: 140, rollOut6: 90, drawL: 240, drawC: 240, lift2: 520,
};

type Run = {
  at: number;
  totalMs: number;
  granted: boolean;
  style: ViewStyle | null;
  started: boolean;
  done: boolean;
  op: Animated.Value | null;
  mv: Animated.Value | null;
  anim: Animated.CompositeAnimation | null;
};

/** The spec Reduce Motion runs: opacity only, ≤ 100 ms, the host's delay kept (a gate). */
export function reducedEntrance(spec: EntranceSpec): EntranceSpec {
  return {
    delayMs: spec.delayMs ?? 0,
    fadeMs: Math.min(spec.fadeMs > 0 ? spec.fadeMs : KIT_MS.reducedFade, KIT_MS.reducedFade),
    fromOpacity: spec.fromOpacity ?? 0,
    fromY: 0, fromX: 0, fromScale: 1, fromScaleX: 1, spring: null, web: null, webStyle: null,
  };
}

function moves(s: EntranceSpec): boolean {
  return !!(s.fromY || s.fromX || (s.fromScale !== undefined && s.fromScale !== 1) || (s.fromScaleX !== undefined && s.fromScaleX !== 1));
}

function nativeStyle(s: EntranceSpec, run: Run): ViewStyle {
  const fromOpacity = s.fromOpacity ?? 0;
  const style: Record<string, unknown> = {};
  if (fromOpacity !== 1) {
    const op = new Animated.Value(0);
    run.op = op;
    style.opacity = fromOpacity === 0 ? op : op.interpolate({ inputRange: [0, 1], outputRange: [fromOpacity, 1], extrapolate: 'clamp' });
  }
  if (moves(s)) {
    const mv = new Animated.Value(0);
    run.mv = mv;
    const transform: Record<string, unknown>[] = [];
    if (s.fromX) transform.push({ translateX: mv.interpolate({ inputRange: [0, 1], outputRange: [s.fromX, 0], extrapolate: 'clamp' }) });
    if (s.fromY) transform.push({ translateY: mv.interpolate({ inputRange: [0, 1], outputRange: [s.fromY, 0], extrapolate: 'clamp' }) });
    if (s.fromScale !== undefined && s.fromScale !== 1) transform.push({ scale: mv.interpolate({ inputRange: [0, 1], outputRange: [s.fromScale, 1], extrapolate: 'clamp' }) });
    if (s.fromScaleX !== undefined && s.fromScaleX !== 1) transform.push({ scaleX: mv.interpolate({ inputRange: [0, 1], outputRange: [s.fromScaleX, 1], extrapolate: 'clamp' }) });
    style.transform = transform;
  }
  return style as ViewStyle;
}

/** How long the entrance runs (delay included), in ms. */
export function entranceMs(s: EntranceSpec): number {
  const delay = Math.max(0, s.delayMs ?? 0);
  const move = s.spring && moves(s) ? webMsFor(s.spring) : 0;
  return delay + Math.max(s.fadeMs, move);
}

export function useEntrance(armed: boolean, spec: EntranceSpec, opts: EntranceOpts = {}): ViewStyle | null {
  const reduce = useReducedMotion();
  const desktopWeb = useIsDesktopWeb();
  const run = useRef<Run | null>(null);
  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;
  const web = Platform.OS === 'web';

  // Armed during render, once per mount, so the very render that shows the
  // element already carries its start pose (no flash of the end state).
  if (armed && !run.current) {
    const s = reduce ? reducedEntrance(spec) : spec;
    const r: Run = { at: Date.now(), totalMs: 0, granted: false, style: null, started: false, done: false, op: null, mv: null, anim: null };
    if (!moves(s) && ((s.fromOpacity ?? 0) === 1 || !(s.fadeMs > 0))) {
      // Nothing to show moving (a row that lands with no motion): never armed.
    } else if (web) {
      const webStyle = reduce ? null : spec.webStyle ?? (spec.web ? kitWebStyle(spec.web, spec.delayMs ?? 0) : null);
      const off = !webStyle || (opts.desktopWebOnly === true && !desktopWeb);
      r.totalMs = spec.webMs ?? ((spec.delayMs ?? 0) + (spec.web ? WEB_MS[spec.web] ?? spec.fadeMs : spec.fadeMs));
      r.granted = !off && (opts.budget === false || acquire(1, r.totalMs) > 0);
      if (r.granted) r.style = webStyle;
    } else {
      r.totalMs = entranceMs(s);
      r.granted = opts.budget === false || acquire(1, r.totalMs) > 0;
      if (r.granted) r.style = nativeStyle(s, r);
    }
    if (!r.granted) r.done = true;
    run.current = r;
  }

  useLayoutEffect(() => {
    const r = run.current;
    if (!r || r.started) return;
    r.started = true;
    if (!r.granted) {
      onDone.current?.();
      return;
    }
    const finish = (finished: boolean) => {
      r.done = true;
      if (opts.budget !== false) release(1);
      if (finished) onDone.current?.();
    };
    if (web) {
      // The CSS runs on the compositor. Only a host that needs to KNOW the end
      // (ChatTurn's onEntered) gets a detached clock: a timing on a value no
      // style reads, so nothing re-renders while it runs.
      if (!onDone.current) return;
      const clock = Animated.timing(new Animated.Value(0), { toValue: 1, duration: r.totalMs, useNativeDriver: nativeDriver, isInteraction: false });
      r.anim = clock;
      clock.start(({ finished }) => finish(finished));
      return;
    }
    const s = reduce ? reducedEntrance(spec) : spec;
    const delay = Math.max(0, s.delayMs ?? 0);
    const easing = plateauEase(plateauFraction(delay, s.fadeMs), motionCurve.out);
    const parts: Animated.CompositeAnimation[] = [];
    if (r.op) parts.push(Animated.timing(r.op, { toValue: 1, duration: delay + s.fadeMs, easing, useNativeDriver: nativeDriver }));
    if (r.mv) {
      parts.push(s.spring
        ? Animated.sequence([Animated.delay(delay), Animated.spring(r.mv, { toValue: 1, ...KIT_SPRING[s.spring], useNativeDriver: nativeDriver })])
        : Animated.timing(r.mv, { toValue: 1, duration: delay + s.fadeMs, easing, useNativeDriver: nativeDriver }));
    }
    if (parts.length === 0) { finish(true); return; }
    const all = parts.length === 1 ? parts[0] : Animated.parallel(parts);
    r.anim = all;
    all.start(({ finished }) => finish(finished));
  });

  useLayoutEffect(() => () => { run.current?.anim?.stop(); }, []);

  const r = run.current;
  if (!r || !r.granted || r.done) return null;
  // Web: the class comes off on the first render after the CSS has run (fill
  // backwards: the element already shows its own style).
  if (web && Date.now() - r.at >= r.totalMs) return null;
  return r.style;
}
