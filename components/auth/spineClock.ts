// components/auth/spineClock.ts — one clock per spine, read through the plan's beats.
//
// Every opacity / transform on a spine is an interpolation of ONE Animated.Value
// that counts milliseconds (utils/auth/spineSequence.ts holds the beats). One
// timing animation, on the native driver where there is one, plays the whole
// sequence once per mount. The signature is the one exception: its
// strokeDashoffset is an SVG prop the native driver cannot reach, so it runs
// on its own JS-driven value for its ~0.9 s.
//
// Reduce Motion (and jest, whose goldens record the composed state) skip the
// play: the clock is set past every beat, so the screen shows the final state
// at once. Nothing here ever blocks a touch: the spine is decoration, its views
// are pointerEvents="none", and the buttons beside it never wait for it.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';
import {
  SPINE_FINAL_CLOCK, ramp, signatureSpan, type Beat, type Curve,
} from '@/utils/auth/spineSequence';

/** True under jest: goldens record the composed (final) state, never a frame mid-play. */
function inJest(): boolean {
  return typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;
}

/**
 * The driver for the signature's strokeDashoffset. An SVG prop cannot ride the
 * native driver at all, so this one timing is JS-driven by necessity (~0.9 s,
 * once). Named rather than a bare `false` so it reads as that decision; every
 * other value here uses `nativeDriver` from motion.ts.
 */
export const SVG_PROP_DRIVER = false;

export type SpineClock = {
  /** Milliseconds since the sequence began (native-driven where possible). */
  clock: Animated.Value;
  /** Milliseconds into the signature's own beat (JS-driven: an SVG prop). */
  ink: Animated.Value;
  /** Whether this mount plays the sequence (false: final state at once). */
  playing: boolean;
};

/**
 * Whether a mount plays the sequence: never under Reduce Motion, never under
 * jest (goldens record the final state); `animate` (tests only) overrides both.
 */
export function decidePlay(animate: boolean | undefined, underJest: boolean, reduced: boolean): boolean {
  return animate ?? (!underJest && !reduced);
}

/**
 * Decide once, at mount, whether to play; then play once.
 * `animate` overrides the decision (tests), never Reduce Motion's "off" for real users.
 */
export function useSpineClock(totalMs: number, signature: Beat | null, animate?: boolean): SpineClock {
  const [playing] = useState(() => decidePlay(animate, inJest(), reducedMotion()));
  const clock = useRef(new Animated.Value(playing ? 0 : SPINE_FINAL_CLOCK)).current;
  const ink = useRef(new Animated.Value(playing ? 0 : signatureSpan())).current;

  useEffect(() => {
    if (!playing) return undefined;
    const run = Animated.timing(clock, {
      toValue: totalMs, duration: totalMs, easing: Easing.linear, useNativeDriver: nativeDriver,
    });
    run.start();
    let pen: Animated.CompositeAnimation | null = null;
    if (signature) {
      // An SVG stroke prop: JS-driven by necessity (a native-driven value cannot feed it).
      pen = Animated.timing(ink, {
        toValue: signatureSpan(), duration: signatureSpan(), delay: signature.at,
        easing: Easing.linear, useNativeDriver: SVG_PROP_DRIVER,
      });
      pen.start();
    }
    return () => {
      run.stop();
      pen?.stop();
    };
    // Plays once per mount: the plan and the decision never change after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { clock, ink, playing };
}

/** One beat as an interpolation of the clock, holding `from` before and `to` after. */
export function beatValue(
  clock: Animated.Value, beat: Beat, from: number, to: number, curve: Curve = 'out',
): Animated.AnimatedInterpolation<number> {
  return clock.interpolate({ ...ramp(beat, from, to, curve), extrapolate: 'clamp' });
}

/** The card / chip entrance: fades in from a little right and below, a touch large. */
export function arriveStyle(clock: Animated.Value, beat: Beat, dx = 40, dy = 20, s = 1.05) {
  return {
    opacity: beatValue(clock, beat, 0, 1),
    transform: [
      { translateX: beatValue(clock, beat, dx, 0) },
      { translateY: beatValue(clock, beat, dy, 0) },
      { scale: beatValue(clock, beat, s, 1) },
    ],
  };
}

/** A fade, optionally rising a few points. */
export function fadeStyle(clock: Animated.Value, beat: Beat, rise = 0, curve: Curve = 'out') {
  if (!rise) return { opacity: beatValue(clock, beat, 0, 1, curve) };
  return {
    opacity: beatValue(clock, beat, 0, 1, curve),
    transform: [{ translateY: beatValue(clock, beat, rise, 0, curve) }],
  };
}

/** A pop: fades in from 90 % scale (the design's `pop`). */
export function popStyle(clock: Animated.Value, beat: Beat, from = 0.9) {
  return {
    opacity: beatValue(clock, beat, 0, 1),
    transform: [{ scale: beatValue(clock, beat, from, 1) }],
  };
}
