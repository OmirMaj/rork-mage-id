// ToppingOutMark — the native loading mark. Five floor modules (a slab on two
// column stubs) rise into place bottom-up on a hairline ground line; the fifth
// is the accent beam, the "topping-out" moment. The finished tower holds,
// fades out as one, and the loop wraps while nothing is visible — no seam.
//
// WHY IT EXISTS. The SVG crane it replaces on iOS/Android ran on the JS driver
// (SVG props cannot use the native driver) and its load visibly came off the
// hook: react-native-svg's native setNativeProps drops originX/originY, so the
// sway rotated about the SVG origin instead of the hook. This mark is plain
// Views animating opacity + translateY only, driven by ONE Animated.Value and
// ONE linear Animated.timing inside Animated.loop — the one loop shape RN runs
// natively with iterations — so once started it lives on the UI thread and a
// pegged JS thread (cold start, pricing an estimate) cannot drop a frame.
// Every curve is pre-sampled in utils/loaderTimeline.ts (no `easing` on
// interpolate; it is not on the native allowlist).
//
// Footprint: size × size·300/340, the crane's exact box, so no call site moves.
// Decorative: the host supplies the words. Colours: theme tokens only.
// scripts/validate-loader.ts holds every rule above.

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PixelRatio, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import {
  CYCLE_MS, FLOORS, PULSE_MS, floorRanges, pulseRange,
} from '@/utils/loaderTimeline';

const snap = (v: number) => PixelRatio.roundToNearestPixel(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FLOOR_IDS = Array.from({ length: FLOORS }, (_, i) => i);

export default function ToppingOutMark({
  size,
  animate = true,
  testID = 'topping-out-mark',
}: {
  size: number;
  animate?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  const u = size / 100;

  const anim = useMemo(() => FLOOR_IDS.map((i) => {
    const r = floorRanges(i);
    return {
      opacity: t.interpolate({ ...r.opacity, extrapolate: 'clamp' }),
      translateY: t.interpolate({
        inputRange: r.translateY.inputRange,
        outputRange: r.translateY.outputRange.map((v) => v * u),
        extrapolate: 'clamp',
      }),
    };
  }), [t, u]);
  const pulse = useMemo(() => t.interpolate({ ...pulseRange, extrapolate: 'clamp' }), [t]);

  useEffect(() => {
    if (!animate) return;
    t.setValue(0);
    const loop = Animated.loop(Animated.timing(t, {
      toValue: 1,
      duration: reduce ? PULSE_MS : CYCLE_MS,
      easing: Easing.linear,
      useNativeDriver: nativeDriver,
    }));
    loop.start();
    return () => loop.stop();
  }, [animate, reduce, t]);

  const steel = colors.textMuted;
  const groundTop = snap(78 * u);
  const floorH = snap(12 * u);
  const colW = snap(clamp(1.8 * u, 1.5, 5));
  const inset = snap(4 * u);

  const floors = FLOOR_IDS.map((i) => {
    const beam = i === FLOORS - 1;
    const left = snap((beam ? 27 : 30) * u);
    const width = snap((beam ? 46 : 40) * u);
    const slabH = snap(beam ? clamp(3 * u, 2.5, 8) : clamp(2.4 * u, 2, 7));
    const colH = Math.max(0, floorH - slabH);
    const box = {
      position: 'absolute' as const,
      left,
      width,
      top: snap(78 * u - (i + 1) * 12 * u),
      height: floorH,
    };
    // (a) static, (b) Reduce Motion (the wrapper pulses; nothing moves),
    // (c) the per-floor native-driven rise.
    const motion = !animate || reduce
      ? { opacity: 1 }
      : { opacity: anim[i].opacity, transform: [{ translateY: anim[i].translateY }] };
    return (
      <Animated.View key={i} testID={`${testID}-floor-${i}`} style={[box, motion]}>
        <View style={{ height: slabH, width, borderRadius: snap(0.6 * u), backgroundColor: beam ? colors.accent : steel }} />
        <View style={{ position: 'absolute', top: slabH, left: inset, width: colW, height: colH, backgroundColor: steel }} />
        <View style={{ position: 'absolute', top: slabH, right: inset, width: colW, height: colH, backgroundColor: steel }} />
      </Animated.View>
    );
  });

  return (
    <Animated.View
      testID={testID}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        { width: size, height: (size * 300) / 340 },
        animate && reduce ? { opacity: pulse } : null,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          top: groundTop,
          left: snap(14 * u),
          width: snap(72 * u),
          height: Math.max(1, snap(0.5 * u)),
          backgroundColor: colors.line,
        }}
      />
      {floors}
    </Animated.View>
  );
}
