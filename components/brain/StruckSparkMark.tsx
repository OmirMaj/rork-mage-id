// components/brain/StruckSparkMark.tsx
//
// "Struck Spark" — the Ask MAGE mark the founder picked (option E in
// design-previews/ai-button-options.html). A four-point spark with flat cut
// tips, like plate steel off the torch, plus a small pointed spark above-right.
// Every AI product uses a sparkle; the flat tips are what make this one ours.
//
// Two layers live here:
//   • StruckSparkMark — the bare SVG glyph, reusable anywhere (no motion).
//   • StruckSparkFace / StruckSparkRings — the BrainFab's glyph pair and its
//     teal voice ring, with the design's state motion:
//       idle     still. Nothing moves on its own (the smoothness-pass rule).
//       holding  a teal ring opens round the disc, three ripples run out of it
//                and the spark throbs with your voice (long-press → voice note).
//       thinking the spark turns a quarter, pauses, turns again; the small
//                spark blinks.
//     Loops run ONLY while a state is on and stop the moment it ends. All
//     motion is transform/opacity on the native driver. Reduce Motion shows a
//     still per state that still says what it is (the design's .rm rules).

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { nativeDriver, useReducedMotion } from '@/components/ui';

/** The flat-tipped spark (design SP2), 24×24 viewBox. */
export const STRUCK_SPARK_PATH =
  'M11.2 .8h1.6l1.1 9.3 9.3 1.1v1.6l-9.3 1.1-1.1 9.3h-1.6l-1.1-9.3-9.3-1.1v-1.6l9.3-1.1z';
/** The small pointed spark beside it (design SP), 24×24 viewBox. */
export const POINTED_SPARK_PATH =
  'M12 .8 13.9 10.1 23.2 12 13.9 13.9 12 23.2 10.1 13.9.8 12 10.1 10.1Z';
/** The design's mint (--mint2) for the small spark, on the green disc in both themes. */
export const SPARK_MINT = '#B9E4C1';

export function StruckSparkMark({
  size = 24,
  color = '#FFFFFF',
  pointed = false,
}: { size?: number; color?: string; pointed?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={pointed ? POINTED_SPARK_PATH : STRUCK_SPARK_PATH} fill={color} />
    </Svg>
  );
}

// Geometry: the design's 58pt disc placements scaled to the FAB's 56pt
// (×0.966) — main 28 at (13,17) → 27 at (12.5,16.5); mini 10 at (36,10) → 10
// at (35,9.5). The main spark sits a touch low-left, the mini high-right.
export const SPARK_MAIN = { size: 27, left: 12.5, top: 16.5 } as const;
export const SPARK_MINI = { size: 10, left: 35, top: 9.5 } as const;

const OUT = Easing.bezier(0.22, 1, 0.36, 1);      // --out
const SINE = Easing.bezier(0.37, 0, 0.63, 1);     // --sine

type Ease = (t: number) => number;
/**
 * A keyframe track for ONE linear 0→1 clock: each segment [t0, t1, v0, v1,
 * ease] is sampled (8 steps) so a single Animated.timing loop can carry the
 * design's multi-step, eased keyframes on the native driver (the motion kit's
 * K6.2 rule: a loop wraps one Animated.timing, never a sequence).
 */
function track(segments: Array<[number, number, number, number, Ease]>) {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  segments.forEach(([t0, t1, v0, v1, ease], si) => {
    for (let k = si === 0 ? 0 : 1; k <= 8; k++) {
      inputRange.push(t0 + ((t1 - t0) * k) / 8);
      outputRange.push(v0 + (v1 - v0) * ease(k / 8));
    }
  });
  return { inputRange, outputRange };
}
const HOLD: Ease = () => 0;
// throb .9s: scale 1 → 1.12 → 1 (sine).
const THROB = track([[0, 0.5, 1, 1.12, SINE], [0.5, 1, 1.12, 1, SINE]]);
// ratchet 2.4s: 0→90° by 32% (out), hold to 50%, 90→180° by 82% (out), hold to 100%.
const RATCHET = track([[0, 0.32, 0, 90, OUT], [0.32, 0.5, 90, 90, HOLD], [0.5, 0.82, 90, 180, OUT], [0.82, 1, 180, 180, HOLD]]);
const RATCHET_DEG = { inputRange: RATCHET.inputRange, outputRange: RATCHET.outputRange.map(d => `${d}deg`) };
// blink2 1.2s alternate (a 2.4s round trip): opacity 1 → .25 → 1 (sine).
const BLINK = track([[0, 0.5, 1, 0.25, SINE], [0.5, 1, 0.25, 1, SINE]]);

/** Run `clock` 0→1 forever (linear; the curve lives in the track). Returns the stop. */
function spin(clock: Animated.Value, duration: number): () => void {
  clock.setValue(0);
  const loop = Animated.loop(Animated.timing(clock, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: nativeDriver }));
  loop.start();
  return () => loop.stop();
}

/** The glyph pair inside the disc, with the hold throb and the thinking ratchet/blink. */
export function StruckSparkFace({ holding = false, thinking = false }: { holding?: boolean; thinking?: boolean }) {
  const still = useReducedMotion();
  const throb = useRef(new Animated.Value(0)).current;    // clock → THROB scale
  const turn = useRef(new Animated.Value(0)).current;     // clock → RATCHET rotate
  const blink = useRef(new Animated.Value(0)).current;    // clock → BLINK mini opacity

  useEffect(() => {
    throb.stopAnimation(); throb.setValue(0);
    if (!holding || thinking || still) return;
    return spin(throb, 900);
  }, [holding, thinking, still, throb]);

  useEffect(() => {
    turn.stopAnimation(); turn.setValue(0);
    blink.stopAnimation(); blink.setValue(0);
    // Reduce Motion: the main spark holds still and the small one sits dimmed (below).
    if (!thinking || still) return;
    const stopTurn = spin(turn, 2400);
    const stopBlink = spin(blink, 2400);
    return () => { stopTurn(); stopBlink(); };
  }, [thinking, still, turn, blink]);

  const mainTransform = [
    { scale: throb.interpolate(THROB) },
    { rotate: turn.interpolate(RATCHET_DEG) },
  ];
  const miniOpacity = thinking && still ? 0.3 : blink.interpolate(BLINK);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.main, { transform: mainTransform }]}>
        <StruckSparkMark size={SPARK_MAIN.size} color="#FFFFFF" />
      </Animated.View>
      <Animated.View style={[styles.mini, { opacity: miniOpacity }]}>
        <StruckSparkMark size={SPARK_MINI.size} color={SPARK_MINT} pointed />
      </Animated.View>
    </View>
  );
}

/**
 * The teal voice ring + ripples round the disc while it is held. Drawn behind
 * the disc by the caller (it extends 7pt past the 56pt circle and never
 * hit-tests). `diameter` is the disc's.
 */
export function StruckSparkRings({ holding, color, diameter }: { holding: boolean; color: string; diameter: number }) {
  const still = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;
  const ripples = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    ring.stopAnimation();
    ripples.forEach(r => { r.stopAnimation(); r.setValue(0); });
    if (still) { ring.setValue(holding ? 1 : 0); return; }
    Animated.timing(ring, { toValue: holding ? 1 : 0, duration: holding ? 400 : 220, easing: OUT, useNativeDriver: nativeDriver }).start();
    if (!holding) return;
    // ripple 1.8s, staggered .6s: scale 1.05 → 1.7, opacity .6 → 0.
    const loops = ripples.map((r, i) => Animated.sequence([
      Animated.delay(i * 600),
      Animated.loop(Animated.timing(r, { toValue: 1, duration: 1800, easing: OUT, useNativeDriver: nativeDriver })),
    ]));
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [holding, still, ring, ripples]);

  const round = { borderRadius: diameter / 2, borderColor: color };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.ring, round,
          { borderRadius: diameter / 2 + 7, opacity: ring, transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }] },
        ]}
      />
      {ripples.map((r, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ripple, round,
            still
              // Reduce Motion: one ripple, still, a step out from the ring.
              ? { opacity: holding && i === 0 ? 0.4 : 0, transform: [{ scale: 1.28 }] }
              : {
                  // 0 (at rest, and through a ripple's stagger delay) is invisible;
                  // the first frame of the run snaps it to .6, then it fades out.
                  opacity: r.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 0.6, 0] }),
                  transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.7] }) }],
                },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  main: { position: 'absolute', left: SPARK_MAIN.left, top: SPARK_MAIN.top, width: SPARK_MAIN.size, height: SPARK_MAIN.size },
  mini: { position: 'absolute', left: SPARK_MINI.left, top: SPARK_MINI.top, width: SPARK_MINI.size, height: SPARK_MINI.size },
  ring: { position: 'absolute', top: -7, left: -7, right: -7, bottom: -7, borderWidth: 2.5 },
  ripple: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2 },
});
