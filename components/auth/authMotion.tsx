// authMotion.tsx — motion for the front door (sign in / sign up).
//
// Lane A1 (slick round 3) owns the ENTRANCE part below: useLaunchEntrance,
// Slot and useLaunchTarget. Lane A2 appends the form motion after it.
//
// THE ENTRANCE. On a cold start BrandSplash covers the app with ink, then hands
// off: its "MAGE ID" flies onto this screen's own wordmark and the ink
// dissolves while the screen's blocks rise in on a short stagger. The screen
// is under the ink while it waits, so its blocks start hidden without a flash.
//
// AT REST NOTHING CHANGES. The entrance arms only if the screen's FIRST render
// sees the launch curtain down ('covered' / 'lifting'). Mounted any other time
// (a push from login to signup, a hot reload, jest, a later visit) it is
// unarmed for life: slot() is null, the wordmark shows, the tree is identical
// to the screen without this hook. Reduce Motion never arms it.
//
// NOTHING STAYS HIDDEN. The curtain heals itself to 'open' (launchCurtain.ts);
// 'open' before the stagger ran snaps every block to rest, and a local timer
// does the same (and re-renders) even if no notification ever arrives.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, type LayoutChangeEvent, type Text, type ViewStyle } from 'react-native';
import { Motion } from '@/constants/designTokens';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';
import {
  LAUNCH_STALE_MS,
  getLaunchPhase,
  getLaunchTarget,
  registerLaunchTarget,
  useLaunchPhase,
  type LaunchRect,
} from '@/components/launch/launchCurtain';

// hoist into Motion.duration after round 3
const ENTRANCE_START_MS = 120;
// hoist into Motion.duration after round 3
const ENTRANCE_STEP_MS = 40;
// hoist into Motion.duration after round 3
const ENTRANCE_FADE_MS = 200;
const ENTRANCE_RISE = 12;
const MAX_SLOTS = 10;

interface SlotValues { opacity: Animated.Value; translateY: Animated.Value; style: ViewStyle }

export interface LaunchEntrance {
  /** True when this screen's first render saw the launch curtain down. */
  armed: boolean;
  /** The i-th block's entrance style, or null (unarmed, or i ≥ 10). */
  slot: (i: number) => ViewStyle | null;
  /** False only while the splash wordmark is still flying onto this one. */
  showWordmark: boolean;
}

export function useLaunchEntrance(count: number): LaunchEntrance {
  // Decided ONCE, at the first render.
  const [armed] = useState(() => {
    const p = getLaunchPhase();
    return (p === 'covered' || p === 'lifting') && !reducedMotion();
  });
  const [values] = useState<SlotValues[] | null>(() => {
    if (!armed) return null;
    return Array.from({ length: Math.min(Math.max(0, count), MAX_SLOTS) }, () => {
      const opacity = new Animated.Value(0);
      const translateY = new Animated.Value(ENTRANCE_RISE);
      return { opacity, translateY, style: { opacity, transform: [{ translateY }] } };
    });
  });
  const [healed, setHealed] = useState(false);
  const phase = useLaunchPhase();
  const doneRef = useRef(!armed);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const rest = useCallback(() => {
    animRef.current?.stop();
    values?.forEach((v) => { v.opacity.setValue(1); v.translateY.setValue(0); });
  }, [values]);

  useEffect(() => {
    if (!armed || doneRef.current || !values) return;
    if (phase === 'open' || reducedMotion()) {
      doneRef.current = true;
      rest();
      return;
    }
    if (phase !== 'lifting' && phase !== 'landed') return;
    doneRef.current = true;
    const anim = Animated.parallel(values.map((v, i) => Animated.sequence([
      Animated.delay(ENTRANCE_START_MS + i * ENTRANCE_STEP_MS),
      Animated.parallel([
        Animated.timing(v.opacity, {
          toValue: 1, duration: ENTRANCE_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver,
        }),
        Animated.spring(v.translateY, { toValue: 0, ...Motion.spring.rise, useNativeDriver: nativeDriver }),
      ]),
    ])));
    animRef.current = anim;
    // An interrupted stagger lands at rest, never part-way.
    anim.start(({ finished }) => { if (!finished) values.forEach((v) => { v.opacity.setValue(1); v.translateY.setValue(0); }); });
  }, [armed, phase, values, rest]);

  // Second guard: even with no notification at all, nothing stays hidden.
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        rest();
      }
      // Only while the curtain is still stuck 'covered'. A 'lifting' phase
      // always lands within FLY_CAP_MS (and the curtain heals itself), so
      // un-hiding here would show the real wordmark before the flying one
      // arrives on a slow cold start.
      if (getLaunchPhase() === 'covered') setHealed(true);
    }, LAUNCH_STALE_MS);
    return () => clearTimeout(t);
  }, [armed, rest]);

  useEffect(() => () => { animRef.current?.stop(); }, []);

  const slot = useCallback(
    (i: number): ViewStyle | null => (values && i >= 0 && i < values.length ? values[i].style : null),
    [values],
  );

  const showWordmark = !armed || healed || phase === 'landed' || phase === 'open';
  return { armed, slot, showWordmark };
}

/** Wraps children in an Animated.View only when a style is given. */
export function Slot({ style, children }: { style: ViewStyle | null; children: React.ReactNode }) {
  if (!style) return <>{children}</>;
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The screen's "MAGE ID" Text: reports its window rect to the launch curtain
 * so the splash wordmark can fly onto it. Registers only while a launch is in
 * progress; on unmount it clears the rect only if it is still this one.
 *
 * Spread `layoutProps` onto the Text: it carries `onLayout` ONLY when this
 * screen's first render saw the curtain down, and is an empty object otherwise,
 * so the unarmed Text has exactly the props it had before (a full-tree snapshot
 * prints a function prop).
 */
export function useLaunchTarget(): {
  ref: React.RefObject<Text | null>;
  onLayout: (e: LayoutChangeEvent) => void;
  layoutProps: { onLayout?: (e: LayoutChangeEvent) => void };
} {
  const [live] = useState(() => getLaunchPhase() !== 'open');
  const ref = useRef<Text | null>(null);
  const mineRef = useRef<LaunchRect | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (mineRef.current && getLaunchTarget() === mineRef.current) registerLaunchTarget(null);
      mineRef.current = null;
    };
  }, []);

  const onLayout = useCallback((_e: LayoutChangeEvent) => {
    if (getLaunchPhase() === 'open') return;
    const measure = () => {
      const node = ref.current as unknown as {
        measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
      } | null;
      if (!aliveRef.current || !node?.measureInWindow) return;
      node.measureInWindow((x, y, width, height) => {
        if (!aliveRef.current) return;
        const rect = { x, y, width, height };
        registerLaunchTarget(rect);
        if (getLaunchTarget() === rect) mineRef.current = rect;
      });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else measure();
  }, []);

  const layoutProps = useMemo(() => (live ? { onLayout } : {}), [live, onLayout]);
  return { ref, onLayout, layoutProps };
}
