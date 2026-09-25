// motion.ts — the app's one motion system (smoothness pass, lane 1).
//
// WHAT IT IS. A handful of primitives every screen builds on, so the whole app
// moves the same way: springs with a tiny overshoot at most (never a bounce),
// content that swaps with a short fade, entries that rise a few points into
// place, and soft colour glides on the web. Nothing here glows, nothing here
// waits: every duration is under a quarter second.
//
// WHAT IT IS NOT. react-native-reanimated is stubbed out of the binary
// (metro.config.js → stubs/react-native-reanimated-absent.js) and this pass
// ships OTA only, so everything below is plain RN Animated (the native driver
// on native), LayoutAnimation, and react-native-web's CSS passthrough.
//
// THE CONTRACT EVERY CALLER RELIES ON.
//   - At rest nothing changes. Every hook returns null until a USER-DRIVEN
//     transition (a sheet opening, a key changing) has been observed after
//     mount, so a first render — and every golden snapshot — is byte-identical
//     to the tree without it.
//   - Reduce Motion turns all of it off: iOS/Android read AccessibilityInfo,
//     the web reads `prefers-reduced-motion`. Under it every hook returns null,
//     webMotion() returns null and layoutNext() does nothing.
//   - Every `as unknown as ViewStyle` cast for a CSS-only value lives in this
//     file and nowhere else.
//
// Springs come from Motion.spring in constants/designTokens.ts (stiffness /
// damping / mass only). scripts/validate-motion.ts holds the rules: damping
// ratio, no scaleXY, keyframes only here, CSS durations as strings, and a
// ratchet on bounciness/friction/bounce/elastic.

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { Motion } from '@/constants/designTokens';

/**
 * The Animated native driver, wherever it exists. On web `useNativeDriver:
 * true` falls back to JS AND logs a warning on every animation, so every new
 * Animated call passes this instead of a literal.
 */
export const nativeDriver = Platform.OS !== 'web';

// ─────────────────────────────────────────────────────────────────────────────
// Reduce Motion — one module-level store, one OS listener for the whole app.
// ─────────────────────────────────────────────────────────────────────────────

let reduced = false;
let reducedInit = false;
const reducedListeners = new Set<() => void>();

function setReduced(next: boolean): void {
  if (next === reduced) return;
  reduced = next;
  reducedListeners.forEach((fn) => {
    try { fn(); } catch { /* a listener must never break the others */ }
  });
}

type MediaQueryLike = {
  matches: boolean;
  addEventListener?: (type: 'change', fn: (e: { matches: boolean }) => void) => void;
  addListener?: (fn: (e: { matches: boolean }) => void) => void;
};

function initReduced(): void {
  if (reducedInit) return;
  reducedInit = true;
  try {
    if (Platform.OS === 'web') {
      // NEVER RN-web's AccessibilityInfo here: without matchMedia it answers
      // TRUE, so a jsdom test would silently switch every motion off. No
      // matchMedia → false.
      const w = typeof window !== 'undefined' ? (window as unknown as { matchMedia?: (q: string) => MediaQueryLike }) : undefined;
      const mq = w?.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (!mq) return;
      reduced = !!mq.matches;
      const onChange = (e: { matches: boolean }) => setReduced(!!e.matches);
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else mq.addListener?.(onChange);
      return;
    }
    // Native. The value is false until the OS answers. BrandSplash notes that
    // isReduceMotionEnabled() can hang, so the answer is raced against a 1 s
    // fallback to false; a late answer is still honoured through the listener
    // below, which carries every later change.
    let answered = false;
    const fallback = setTimeout(() => {
      if (!answered) { answered = true; setReduced(false); }
    }, 1000);
    const p = AccessibilityInfo.isReduceMotionEnabled?.();
    if (p && typeof p.then === 'function') {
      p.then(
        (v) => { answered = true; clearTimeout(fallback); setReduced(!!v); },
        () => { answered = true; clearTimeout(fallback); },
      );
    } else {
      clearTimeout(fallback);
    }
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduced(!!v));
  } catch {
    // jest, a missing module, a hostile environment: motion stays on.
  }
}

/** Is Reduce Motion on? A synchronous read; the first call starts listening. */
export function reducedMotion(): boolean {
  initReduced();
  return reduced;
}

/** Called whenever Reduce Motion flips. Returns the unsubscribe. */
export function subscribeReducedMotion(fn: () => void): () => void {
  initReduced();
  reducedListeners.add(fn);
  return () => { reducedListeners.delete(fn); };
}

/** Reduce Motion as React state: re-renders the caller when it flips. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotion, () => false);
}

// ─────────────────────────────────────────────────────────────────────────────
// layoutNext — a list row added or removed eases instead of jumping.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animate the NEXT commit's layout: a row appearing fades in, the rows below it
 * slide to their new place, a row leaving fades out.
 *
 * Call it on the line IMMEDIATELY before the setState it animates — never in
 * an effect. LayoutAnimation animates the whole next commit, so an unrelated
 * render in between would take the animation instead.
 *
 * NEVER scaleXY. A create/delete scaleXY SIGABRTs on Fabric when the subtree
 * carries a transform (see the comment above the LayoutAnimation call in
 * app/project-detail.tsx) — opacity only. validate-motion fails on one.
 *
 * A no-op on web (LayoutAnimation does nothing there) and under Reduce Motion.
 */
export function layoutNext(): void {
  if (Platform.OS === 'web' || reducedMotion()) return;
  try {
    LayoutAnimation.configureNext({
      duration: Motion.duration.layout,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
  } catch {
    // An animation is decoration; a failure must never block the state change.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// useRiseOnOpen — a sheet card rises the last few points into place.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * null until this hook has SEEN `visible` go false → true after mount (so a
 * first render and every golden is unchanged). From then on it returns
 * `{ transform: [{ translateY }] }` for good, resting at 0: each open starts
 * `distance` points low and springs up with Motion.spring.rise (ζ≈0.96, no
 * bounce). Under Reduce Motion, and on web, it is always null.
 *
 * The transform lives on the CARD, never on the Modal root: a transform on an
 * ancestor re-roots position:fixed children on web.
 */
export function useRiseOnOpen(visible: boolean, distance = 28): ViewStyle | null {
  const reduce = useReducedMotion();
  const prev = useRef(visible);
  const armed = useRef(false);
  const value = useRef<Animated.Value | null>(null);
  const style = useRef<ViewStyle | null>(null);

  // Detected during render so the very render that opens the sheet already
  // carries the transform the layout effect below drives.
  // Web: never. A transform left at translateY(0) on the card would re-root
  // every position:fixed child (a dropdown inside the sheet); the desktop sheet
  // rises with the CSS popIn keyframe instead, which leaves nothing at rest.
  if (!prev.current && visible && !reduce && Platform.OS !== 'web') armed.current = true;
  if (armed.current && !value.current) {
    value.current = new Animated.Value(0);
    style.current = { transform: [{ translateY: value.current }] };
  }

  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = visible;
    const v = value.current;
    if (was || !visible || !v || reducedMotion()) return;
    v.setValue(distance);
    Animated.spring(v, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }).start();
    // Never a setState on completion: the resting value is already 0.
  }, [visible, distance]);

  return reduce ? null : style.current;
}

// ─────────────────────────────────────────────────────────────────────────────
// useSwapFade — content that changes under the same frame fades in.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pass the key of what is showing (the selected tab, the segment value). null
 * until the key first changes after mount; from then on `{ opacity }`, and each
 * change fades the new content in over
 * Motion.duration.swap with an ease-out. Opacity (and filter) only — no
 * transform — so it can share an Animated.View with useRiseOnOpen. Under
 * Reduce Motion it is always null.
 */
export function useSwapFade(key: string): ViewStyle | null {
  const reduce = useReducedMotion();
  const prevKey = useRef(key);
  const armed = useRef(false);
  const value = useRef<Animated.Value | null>(null);
  const style = useRef<ViewStyle | null>(null);

  if (prevKey.current !== key && !reduce) armed.current = true;
  if (armed.current && !value.current) {
    const v = new Animated.Value(1);
    value.current = v;
    // Opacity only, on every platform. A web blur would stay at blur(0px)
    // inline after the fade, and any filter other than none re-roots
    // position:fixed children and forces a compositing layer.
    style.current = { opacity: v } as unknown as ViewStyle;
  }

  useLayoutEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    const v = value.current;
    if (!v || reducedMotion()) return;
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: Motion.duration.swap,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
  }, [key]);

  return reduce ? null : style.current;
}

// ─────────────────────────────────────────────────────────────────────────────
// Web CSS motion — keyframe entries and colour glides, registered once.
// ─────────────────────────────────────────────────────────────────────────────
//
// RULES (each one cost somebody an afternoon):
//   - Keyframes compile ONLY through StyleSheet.create: an inline style object
//     with animationKeyframes is silently dropped by react-native-web.
//   - Every duration is a CSS STRING ('140ms'); a bare number becomes px.
//   - Every keyframe transform is a STRING ('translateY(6px) scale(0.98)').
//   - Fill mode 'backwards' only, never 'both': a transform retained after the
//     animation re-parents position:fixed children (menus, toasts, sheets).
//   - A component that also renders in a phone-web golden (web 390/820) gates
//     these on useIsDesktopWeb(), not on Platform.OS alone.

export type WebMotionKey =
  | 'fadeIn'
  | 'popIn'
  | 'dropIn'
  | 'slideInRight'
  | 'pulse'
  | 'bgGlide'
  | 'rotateGlide';

const EASE_OUT = Motion.css.easeOut;

function entry(from: Record<string, string | number>, duration: string, extra: Record<string, string> = {}): ViewStyle {
  const to: Record<string, string | number> = {};
  for (const k of Object.keys(from)) to[k] = k === 'opacity' ? 1 : 'none';
  return {
    animationKeyframes: [{ from, to }],
    animationDuration: duration,
    animationTimingFunction: EASE_OUT,
    animationFillMode: 'backwards',
    ...extra,
  } as unknown as ViewStyle;
}

function glide(property: string, duration: string): ViewStyle {
  return {
    transitionProperty: property,
    transitionDuration: duration,
    transitionTimingFunction: EASE_OUT,
  } as unknown as ViewStyle;
}

/** The raw CSS for each key, before registration. */
const RAW: Record<WebMotionKey, ViewStyle> = {
  fadeIn: entry({ opacity: 0 }, '140ms'),
  popIn: entry({ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, '180ms'),
  dropIn: entry({ opacity: 0, transform: 'translateY(-4px) scale(0.98)' }, '140ms', { transformOrigin: 'top' }),
  slideInRight: entry({ opacity: 0, transform: 'translateX(16px)' }, '200ms'),
  pulse: {
    animationKeyframes: [{ from: { opacity: 0.5 }, to: { opacity: 0.85 } }],
    animationDuration: '900ms',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
    animationFillMode: 'backwards',
  } as unknown as ViewStyle,
  bgGlide: glide('background-color, border-color, box-shadow, filter', '120ms'),
  rotateGlide: glide('transform', '160ms'),
};

/** Registered once, so each key compiles to one class. */
const REGISTERED = StyleSheet.create(RAW);

/**
 * The registered CSS motion for `key` on web; null on native and under Reduce
 * Motion. Platform is read at CALL time (tests mock it per test).
 */
export function webMotion(key: WebMotionKey): ViewStyle | null {
  if (Platform.OS !== 'web' || reducedMotion()) return null;
  return REGISTERED[key];
}

/**
 * `base` with the motion for `key` merged in and registered as ONE style (a
 * keyframe must be registered through StyleSheet.create to compile). Returns
 * `base` unchanged where webMotion(key) is null. Callers memoise the call: each
 * one registers a new class.
 */
export function registerWithMotion(base: ViewStyle, key: WebMotionKey): ViewStyle {
  if (webMotion(key) === null) return base;
  return StyleSheet.create({ s: { ...base, ...RAW[key] } }).s;
}
