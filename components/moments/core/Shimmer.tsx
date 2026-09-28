// Shimmer.tsx: the idle label's quiet invitation (moments wave, lane CAPSULE).
//
// A 56 pt window (overflow hidden) sweeps across the label with translateX,
// holding a copy of the label in the brighter labelShimmer ink, counter-
// translated by the same amount so the letters line up exactly with the label
// underneath. Both transforms ride the native driver. No gradient, no mask
// module (neither ships OTA).
//
// Sweep 2200 ms, rest 1400 ms, looped. The caller turns it off for good after
// the first touch, under Reduce Motion and while disabled (`active`).

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';
import { MOMENT_TIMING as MT } from '@/utils/moments/motionSpec';

const WINDOW = MT.shimmerWindow;

export interface ShimmerProps {
  text: string;
  /** Idle, never touched, motion on, not disabled. */
  active: boolean;
  /** The label box's width (the rail width). */
  width: number;
  /** labelShimmer */
  color: string;
  /** The label's text style, without its colour. */
  textStyle: StyleProp<TextStyle>;
  /** The label box's padding and centring, identical to the label's own box. */
  boxStyle: StyleProp<ViewStyle>;
}

export function Shimmer(p: ShimmerProps): React.ReactElement | null {
  // Constructed at −WINDOW: Animated.loop's reset returns here each iteration.
  const s = useRef(new Animated.Value(-WINDOW)).current;
  const counter = useMemo(() => Animated.multiply(s, -1), [s]);
  const run = p.active && p.width > 0;

  useEffect(() => {
    if (!run || reducedMotion()) return undefined;
    s.setValue(-WINDOW);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(s, { toValue: p.width, duration: MT.shimmerSweep, easing: Easing.linear, useNativeDriver: nativeDriver }),
        Animated.delay(MT.shimmerRest),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [run, p.width, s]);

  if (!run) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.window, { transform: [{ translateX: s }] }]}
    >
      <Animated.View style={[styles.copy, { width: p.width, transform: [{ translateX: counter }] }, p.boxStyle]}>
        <Text numberOfLines={1} style={[p.textStyle, { color: p.color }]}>{p.text}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: { position: 'absolute', top: 0, bottom: 0, left: 0, width: WINDOW, overflow: 'hidden' },
  copy: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
