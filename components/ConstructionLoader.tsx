import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';

/**
 * Stacking-bricks construction animation used across the app wherever a
 * loading indicator is needed — app cold start, context hydration, screen-
 * level spinners, etc. Three blocks rise into position one at a time (with
 * a spring-like ease), the whole stack takes a single breath, then resets
 * and loops.
 *
 * Built on the built-in Animated API (no Reanimated dep) so it runs on
 * iOS, Android, and web identically. The animation driver is NOT native
 * because opacity + translate + scale on the same View would split drivers;
 * perf is still fine because we're animating ~4 Views at 60fps.
 *
 * Sizes:
 *   - sm  used inline (cards, list spinners)   → 32×32 total
 *   - md  default for screens                  → 60×60 total
 *   - lg  app cold-start, big empty states     → 96×96 total
 *
 * Accessibility: we label the animation container so screen readers
 * announce "Loading" once instead of narrating every frame.
 */

type LoaderSize = 'sm' | 'md' | 'lg';

interface ConstructionLoaderProps {
  size?: LoaderSize;
  /** Optional label rendered beneath the animation. Kept short; this isn't a toast. */
  label?: string;
  /** Wrapper style override — e.g. flex:1 for full-screen centering. */
  style?: ViewStyle;
  /** Override colors if you need the loader on a non-default background. */
  colorTop?: string;
  colorMid?: string;
  colorBase?: string;
}

const SIZE_MAP: Record<LoaderSize, { brickW: number; brickH: number; gap: number; labelSize: number }> = {
  sm: { brickW: 26, brickH: 7, gap: 2, labelSize: 11 },
  md: { brickW: 48, brickH: 12, gap: 3, labelSize: 13 },
  lg: { brickW: 80, brickH: 20, gap: 4, labelSize: 15 },
};

// Timing constants tuned to feel "construction-paced": confident, deliberate,
// not frantic. Total cycle ≈ 1.8s — long enough to feel intentional, short
// enough that nobody wonders if the app has hung.
const STAGGER_MS = 180;
const HOLD_MS = 260;
const FADE_OUT_MS = 260;
const BREATHE_UP_MS = 220;
const BREATHE_DOWN_MS = 220;

export default function ConstructionLoader({
  size = 'md',
  label,
  style,
  colorTop,
  colorMid,
  colorBase,
}: ConstructionLoaderProps) {
  const dims = SIZE_MAP[size];
  const brick1 = useRef(new Animated.Value(0)).current; // base (bottom)
  const brick2 = useRef(new Animated.Value(0)).current; // middle
  const brick3 = useRef(new Animated.Value(0)).current; // top
  const breathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;

    const buildOne = (val: Animated.Value) =>
      Animated.timing(val, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.back(1.4)), // slight overshoot → "placed"
        useNativeDriver: true,
      });

    const fadeOut = (val: Animated.Value) =>
      Animated.timing(val, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      });

    const cycle = Animated.sequence([
      Animated.stagger(STAGGER_MS, [buildOne(brick1), buildOne(brick2), buildOne(brick3)]),
      Animated.delay(HOLD_MS),
      // Single breath — the stack takes a quick inhale/exhale to feel alive.
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1.06,
          duration: BREATHE_UP_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: BREATHE_DOWN_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(120),
      Animated.parallel([fadeOut(brick1), fadeOut(brick2), fadeOut(brick3)]),
    ]);

    const loop = Animated.loop(cycle);

    const tick = () => {
      if (!mounted) return;
      // Reset opacity-tracked values before each loop. `Animated.loop` already
      // resets but we go belt-and-suspenders because the cycle mutates three
      // different values at different times.
      brick1.setValue(0);
      brick2.setValue(0);
      brick3.setValue(0);
      breathe.setValue(1);
    };

    tick();
    loop.start();
    return () => {
      mounted = false;
      loop.stop();
    };
  }, [brick1, brick2, brick3, breathe]);

  const buildBrickStyle = (val: Animated.Value) => {
    return {
      opacity: val,
      transform: [
        {
          translateY: val.interpolate({
            inputRange: [0, 1],
            outputRange: [dims.brickH + dims.gap + 4, 0],
          }),
        },
        { scale: breathe },
      ],
    };
  };

  const top = colorTop ?? Colors.primary;
  const mid = colorMid ?? Colors.primary + 'CC';
  const base = colorBase ?? Colors.primary + '99';

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
      testID="construction-loader"
    >
      <View
        style={[
          styles.stack,
          {
            width: dims.brickW + 8,
            height: dims.brickH * 3 + dims.gap * 2,
          },
        ]}
      >
        {/* Top brick — narrower by design to suggest a "roof" taper */}
        <Animated.View
          style={[
            styles.brick,
            {
              width: dims.brickW * 0.7,
              height: dims.brickH,
              backgroundColor: top,
              borderRadius: Math.max(2, dims.brickH * 0.2),
              top: 0,
            },
            buildBrickStyle(brick3),
          ]}
        />
        {/* Middle brick */}
        <Animated.View
          style={[
            styles.brick,
            {
              width: dims.brickW * 0.88,
              height: dims.brickH,
              backgroundColor: mid,
              borderRadius: Math.max(2, dims.brickH * 0.2),
              top: dims.brickH + dims.gap,
            },
            buildBrickStyle(brick2),
          ]}
        />
        {/* Base brick */}
        <Animated.View
          style={[
            styles.brick,
            {
              width: dims.brickW,
              height: dims.brickH,
              backgroundColor: base,
              borderRadius: Math.max(2, dims.brickH * 0.2),
              top: (dims.brickH + dims.gap) * 2,
            },
            buildBrickStyle(brick1),
          ]}
        />
      </View>
      {!!label && (
        <Text style={[styles.label, { fontSize: dims.labelSize }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stack: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    position: 'relative',
  },
  brick: {
    position: 'absolute',
    alignSelf: 'center',
  },
  label: {
    color: Colors.textSecondary,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
});
