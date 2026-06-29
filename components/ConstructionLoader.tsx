import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { G, Line, Path, Rect, Polyline } from 'react-native-svg';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * House-construction loading animation used across the app wherever a loading
 * indicator is needed — app cold start, context hydration, screen-level
 * spinners, etc. A house BUILDS itself one part at a time: foundation slab →
 * the two walls → the roof → window + door → and finally the amber spark is
 * set on top. The finished house takes a single breath, then fades and loops.
 *
 * This replaces the old stacking-bricks loader — same construction metaphor,
 * but it reads as something getting BUILT (a home/building) rather than an
 * abstract stack, matching the crane "AI" mark's hand-crafted language.
 *
 * Built on the built-in Animated API (no Reanimated dep) against
 * react-native-svg, so it runs on iOS, Android, and web identically. SVG
 * props can't use the native driver, so the driver is JS-side; perf is fine
 * because we animate ~7 small groups.
 *
 * Sizes:
 *   - sm  used inline (cards, list spinners)
 *   - md  default for screens
 *   - lg  app cold-start, big empty states
 *
 * Accessibility: we label the animation container so screen readers announce
 * "Loading" once instead of narrating every frame.
 */

type LoaderSize = 'sm' | 'md' | 'lg';

interface ConstructionLoaderProps {
  size?: LoaderSize;
  /** Optional label rendered beneath the animation. Kept short; this isn't a toast. */
  label?: string;
  /**
   * Optional rotating labels for longer loads — perceived-progress narration.
   * The loader advances through them one at a time (e.g. "Reading your costs…",
   * "Pricing the scope…", "Almost there…") so a slow operation feels like it's
   * making headway instead of hanging. Holds on the last entry. Takes priority
   * over `label` when non-empty.
   */
  labels?: string[];
  /** How long each rotating label is shown before advancing. Default 1400ms. */
  labelIntervalMs?: number;
  /** Wrapper style override — e.g. flex:1 for full-screen centering. */
  style?: ViewStyle;
  /** Primary build color (walls/door/window). Defaults to theme accent. */
  colorTop?: string;
  /** Roof color. Defaults to theme accent. */
  colorMid?: string;
  /** Foundation color. Defaults to theme accent. */
  colorBase?: string;
}

const SIZE_MAP: Record<LoaderSize, { svg: number; labelSize: number }> = {
  sm: { svg: 36, labelSize: 11 },
  md: { svg: 64, labelSize: 13 },
  lg: { svg: 100, labelSize: 15 },
};

const AG = Animated.createAnimatedComponent(G);

// viewBox is 0 0 64 58. Parts build bottom-up, then the spark.
const STAGGER_MS = 150;
const PLACE_MS = 300;
const HOLD_MS = 280;
const FADE_OUT_MS = 280;

export default function ConstructionLoader({
  size = 'md',
  label,
  labels,
  labelIntervalMs = 1400,
  style,
  colorTop,
  colorMid,
  colorBase,
}: ConstructionLoaderProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const dims = SIZE_MAP[size];

  // Rotating-label state — advances through `labels` and holds on the last one.
  const rotating = Array.isArray(labels) && labels.length > 0;
  const [labelIdx, setLabelIdx] = useState(0);
  useEffect(() => {
    if (!rotating || labels!.length <= 1) return;
    setLabelIdx(0);
    const id = setInterval(() => {
      setLabelIdx(i => (i < labels!.length - 1 ? i + 1 : i));
    }, Math.max(400, labelIntervalMs));
    return () => clearInterval(id);
  }, [rotating, labels, labelIntervalMs]);

  const shownLabel = rotating ? labels![Math.min(labelIdx, labels!.length - 1)] : label;

  // One value per built part: foundation, L wall, R wall, roof, window, door, spark.
  const p = useRef([0, 0, 0, 0, 0, 0, 0].map(() => new Animated.Value(0))).current;
  const breathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    const place = (v: Animated.Value) =>
      Animated.timing(v, { toValue: 1, duration: PLACE_MS, easing: Easing.out(Easing.back(1.3)), useNativeDriver: false });
    const fade = (v: Animated.Value) =>
      Animated.timing(v, { toValue: 0, duration: FADE_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: false });

    const cycle = Animated.sequence([
      Animated.stagger(STAGGER_MS, p.map(place)),
      Animated.delay(HOLD_MS),
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1.05, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(breathe, { toValue: 1, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      ]),
      Animated.delay(140),
      Animated.parallel(p.map(fade)),
    ]);
    const loop = Animated.loop(cycle);

    if (mounted) {
      p.forEach(v => v.setValue(0));
      breathe.setValue(1);
      loop.start();
    }
    return () => { mounted = false; loop.stop(); };
  }, [p, breathe]);

  // Each part fades in and rises a few units into place.
  const part = (i: number) => ({
    opacity: p[i],
    translateY: p[i].interpolate({ inputRange: [0, 1], outputRange: [5, 0] }),
  });

  const main = colorTop ?? themeColors.accent;
  const roof = colorMid ?? themeColors.accent;
  const base = colorBase ?? themeColors.accent;
  const spark = themeColors.accent;
  const s = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={shownLabel ?? 'Loading'}
      testID="construction-loader"
    >
      <Animated.View style={{ transform: [{ scale: breathe }] }}>
        <Svg width={dims.svg} height={dims.svg * 58 / 64} viewBox="0 0 64 58" fill="none">
          {/* foundation slab */}
          <AG {...part(0)}><Line x1={8} y1={50} x2={56} y2={50} stroke={base} strokeWidth={3} {...s} /></AG>
          {/* walls */}
          <AG {...part(1)}><Line x1={16} y1={50} x2={16} y2={27} stroke={main} strokeWidth={2.6} {...s} /></AG>
          <AG {...part(2)}><Line x1={48} y1={50} x2={48} y2={27} stroke={main} strokeWidth={2.6} {...s} /></AG>
          {/* roof */}
          <AG {...part(3)}><Polyline points="12,28 32,13 52,28" stroke={roof} strokeWidth={2.6} {...s} /></AG>
          {/* window */}
          <AG {...part(4)}><Rect x={20.5} y={31} width={7} height={7} rx={1} stroke={main} strokeWidth={1.9} {...s} /></AG>
          {/* door */}
          <AG {...part(5)}><Path d="M28 50 L28 38 L36 38 L36 50" stroke={main} strokeWidth={2} {...s} /></AG>
          {/* amber spark, set on top */}
          <AG {...part(6)}>
            <Path d="M32 4 L33.1 7.4 L36.5 8.5 L33.1 9.6 L32 13 L30.9 9.6 L27.5 8.5 L30.9 7.4 Z" fill={spark} />
          </AG>
        </Svg>
      </Animated.View>
      {!!shownLabel && (
        <Text style={[styles.label, { fontSize: dims.labelSize }]} numberOfLines={1}>
          {shownLabel}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    color: t.textSecondary,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
});
