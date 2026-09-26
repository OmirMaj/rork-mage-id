// Landing — a skeleton that was actually on screen hands over to its content
// with a short fade, and the first few rows of a list land on a short stagger
// (slick round 3, lane C).
//
// THE CONTRACT.
//   - At rest nothing changes. useLanding() returns `fade: null` and `row() →
//     null` until it has OBSERVED `loading` go true → false after mount, with
//     the loading phase lasting ≥ LANDING_MIN_LOADING_MS by Date.now(). A
//     skeleton that flashed for less than that has nothing to smooth, and every
//     golden (which pins Date.now) sees a 0 ms loading phase, so nothing arms.
//   - It arms at most ONCE per mount. A later refetch that flips `loading`
//     again replays nothing.
//   - Reduce Motion (iOS/Android setting, web prefers-reduced-motion) never
//     arms.
//   - Once row(i) has returned a style it returns the SAME object for the life
//     of the mount, so a row wrapper is never unwrapped (no remount, no lost
//     row state). A row first asked for after the landing window (scrolled into
//     view later), past the first `rows`, or already on screen before the
//     hand-off, never animates.
//   - Web: rows animate OPACITY ONLY. A transform left at translateY(0) would
//     re-root position:fixed descendants (row menus, popovers). Opacity creates
//     no containing block and, at 1, no stacking context, so the screen-root
//     fade is safe on web too.
//
// OTA only: RN Animated (native driver on native, JS on web), no reanimated.

import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Motion } from '@/constants/designTokens';
import { nativeDriver, reducedMotion, useReducedMotion } from '@/components/ui/motion';

/** A loading phase shorter than this gets no hand-off. */
export const LANDING_MIN_LOADING_MS = 120;
/** A row first requested later than this after arming never animates. */
export const LANDING_WINDOW_MS = 700;
/** How many leading rows land on the stagger. */
export const ROWS = 6;
/** Row fade length. hoist into Motion.duration after round 3 */
const ROW_FADE_MS = 180;
/** First row's start after arming. hoist into Motion.duration after round 3 */
const ROW_START_MS = 40;
/** Stagger between rows. hoist into Motion.duration after round 3 */
const ROW_STEP_MS = 35;
/** How far a row rises (native only). */
const ROW_RISE = 10;

export interface Landing {
  fade: ViewStyle | null;
  row: (index: number) => ViewStyle | null;
}

/** Starts a row's animation once its wrapper has been committed (idempotent). */
const STARTERS = new WeakMap<object, () => void>();

export function useLanding(loading: boolean, opts?: { rows?: number }): Landing {
  const reduce = useReducedMotion();
  const rowsCap = useRef(opts?.rows ?? ROWS);
  rowsCap.current = opts?.rows ?? ROWS;

  // The loading phase, as the last COMMITTED render saw it.
  const prevLoading = useRef(loading);
  const loadingSince = useRef<number | null>(null);
  const armed = useRef(false);
  const armedAt = useRef(0);
  const fadeValue = useRef<Animated.Value | null>(null);
  const fadeStyle = useRef<ViewStyle | null>(null);
  const fadeStarted = useRef(false);
  /** index → the style it got (null = never animates). */
  const rowStyles = useRef(new Map<number, ViewStyle | null>());

  // Detected during render (as useSwapFade does), so the very render that
  // shows the content already carries the start values.
  if (loading && loadingSince.current === null) loadingSince.current = Date.now();
  if (
    !armed.current
    && !loading
    && prevLoading.current
    && loadingSince.current !== null
    && Date.now() - loadingSince.current >= LANDING_MIN_LOADING_MS
    && !reduce
  ) {
    armed.current = true;
    armedAt.current = Date.now();
    const v = new Animated.Value(0);
    fadeValue.current = v;
    fadeStyle.current = { opacity: v } as unknown as ViewStyle;
  }

  useLayoutEffect(() => {
    prevLoading.current = loading;
    if (!loading) loadingSince.current = null;
    const v = fadeValue.current;
    if (!v || fadeStarted.current) return;
    fadeStarted.current = true;
    if (reducedMotion()) { v.setValue(1); return; }
    Animated.timing(v, {
      toValue: 1,
      duration: Motion.duration.swap,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
    // Never a setState on completion: the resting value is already 1.
  }, [loading]);

  const row = useCallback((index: number): ViewStyle | null => {
    const seen = rowStyles.current;
    if (seen.has(index)) return seen.get(index) ?? null;
    if (!armed.current) {
      // Asked for before the hand-off: this row was already on screen, so it
      // never animates (it would blink out and back).
      seen.set(index, null);
      return null;
    }
    const since = Date.now() - armedAt.current;
    if (index < 0 || index >= rowsCap.current || since > LANDING_WINDOW_MS) {
      seen.set(index, null);
      return null;
    }
    const opacity = new Animated.Value(0);
    const web = Platform.OS === 'web';
    const rise = web ? null : new Animated.Value(ROW_RISE);
    const style = (rise
      ? { opacity, transform: [{ translateY: rise }] }
      : { opacity }) as unknown as ViewStyle;
    seen.set(index, style);
    let started = false;
    STARTERS.set(style, () => {
      if (started) return;
      started = true;
      if (reducedMotion()) {
        opacity.setValue(1);
        rise?.setValue(0);
        return;
      }
      const delay = Math.max(0, ROW_START_MS + index * ROW_STEP_MS - (Date.now() - armedAt.current));
      Animated.timing(opacity, {
        toValue: 1,
        duration: ROW_FADE_MS,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: nativeDriver,
      }).start();
      if (rise) {
        Animated.spring(rise, { toValue: 0, delay, ...Motion.spring.rise, useNativeDriver: nativeDriver }).start();
      }
    });
    return style;
  }, []);

  return { fade: fadeStyle.current, row };
}

const FILL: ViewStyle = { flex: 1 };

/**
 * `children` untouched while `style` is null; once armed, the children inside
 * an Animated.View carrying it. Pass `fill` for every SCREEN-ROOT wrap (the
 * roots are flex: 1, and a bare wrapper would collapse them to their content
 * height); never for a row wrap.
 */
export function LandingSlot({
  style,
  fill,
  children,
}: {
  style: ViewStyle | null;
  fill?: boolean;
  children?: React.ReactNode;
}) {
  useLayoutEffect(() => {
    if (style) STARTERS.get(style)?.();
  }, [style]);
  if (!style) return <>{children}</>;
  const s: StyleProp<ViewStyle> = fill ? [FILL, style] : style;
  return <Animated.View style={s}>{children}</Animated.View>;
}
