import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { G, Line, Path, Rect, Polyline } from 'react-native-svg';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
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
 * Runs on react-native-reanimated: the whole timeline (staggered build, hold,
 * breathe, fade) lives in ONE shared value driven by worklets on the UI thread,
 * and each SVG part reads it via useAnimatedProps. This keeps 60fps even during
 * cold start when the JS thread is saturated hydrating the app — the old
 * Animated-API version interpolated SVG props on the JS thread and dropped
 * frames exactly then. Same hand-crafted house/skyline; buttery motion.
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
  /** 'house' (default) — a single home builds itself. 'city' — a skyline rises. */
  scene?: 'house' | 'city';
  /** Optional label rendered beneath the animation. */
  label?: string;
  /** Optional rotating labels for longer loads — perceived-progress narration. */
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

const AnimatedG = Reanimated.createAnimatedComponent(G);

// One build cycle: a staggered appear (0 → BUILD_END of progress), a hold, then
// a fade back to 0, then a short gap before the next build. Progress is a single
// 0→1 shared value; the fade is the same value returning to 0.
const BUILD_MS = 1500;
const HOLD_MS = 560;
const FADE_MS = 460;
const GAP_MS = 260;
// Parts finish appearing by this fraction of progress; the tail leaves room so
// the last part settles before the hold.
const APPEAR_SPAN = 0.4;

/** A single built part: fades in and rises into place during its staggered slice
 *  of the shared `progress`. useAnimatedProps lives here (one per instance) so
 *  the hook rules hold while we still render parts in a loop. */
function BuildPart({
  progress,
  index,
  count,
  rise,
  children,
}: {
  progress: SharedValue<number>;
  index: number;
  count: number;
  rise: number;
  children: React.ReactNode;
}) {
  const animatedProps = useAnimatedProps(() => {
    const step = (1 - APPEAR_SPAN) / Math.max(1, count - 1);
    const from = index * step;
    const to = from + APPEAR_SPAN;
    const o = interpolate(progress.value, [from, to], [0, 1], Extrapolation.CLAMP);
    return { opacity: o, translateY: (1 - o) * rise };
  });
  return <AnimatedG animatedProps={animatedProps}>{children}</AnimatedG>;
}

/** A skyline tower: rises off the ground line, then its windows light up a beat
 *  after it lands. Two animated-prop hooks, both inside this instance. */
function CityBuilding({
  progress,
  index,
  count,
  b,
  stroke,
  windowFill,
  windows,
}: {
  progress: SharedValue<number>;
  index: number;
  count: number;
  b: { x: number; w: number; top: number };
  stroke: string;
  windowFill: string;
  windows: { x: number; y: number }[];
}) {
  const riseProps = useAnimatedProps(() => {
    const step = (1 - APPEAR_SPAN) / Math.max(1, count - 1);
    const from = index * step;
    const to = from + APPEAR_SPAN;
    const o = interpolate(progress.value, [from, to], [0, 1], Extrapolation.CLAMP);
    return { opacity: o, translateY: (1 - o) * 10 };
  });
  const windowProps = useAnimatedProps(() => {
    const step = (1 - APPEAR_SPAN) / Math.max(1, count - 1);
    const from = index * step;
    // Windows snap on after the building is most of the way up.
    const lit = interpolate(progress.value, [from + APPEAR_SPAN * 0.7, from + APPEAR_SPAN], [0, 1], Extrapolation.CLAMP);
    return { opacity: lit };
  });
  return (
    <AnimatedG animatedProps={riseProps}>
      <Rect x={b.x} y={b.top} width={b.w} height={64 - b.top} rx={1} stroke={stroke} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
      <AnimatedG animatedProps={windowProps}>
        {windows.map((wn, j) => (
          <Rect key={j} x={wn.x} y={wn.y} width={2.7} height={2.7} rx={0.5} fill={windowFill} />
        ))}
      </AnimatedG>
    </AnimatedG>
  );
}

export default function ConstructionLoader({
  size = 'md',
  scene = 'house',
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
  // (Independent of the animation, which runs on the UI thread regardless.)
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

  // The whole timeline in one shared value: build (0→1) · hold · fade (1→0) · gap.
  const progress = useSharedValue(0);
  const breathe = useSharedValue(1);
  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: BUILD_MS, easing: Easing.out(Easing.cubic) }),
        withDelay(HOLD_MS, withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) })),
        withDelay(GAP_MS, withTiming(0, { duration: 0 })),
      ),
      -1,
    );
    breathe.value = withRepeat(
      withSequence(
        withDelay(BUILD_MS, withTiming(1.05, { duration: 360, easing: Easing.inOut(Easing.quad) })),
        withTiming(1, { duration: 360, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [progress, breathe]);

  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  const main = colorTop ?? themeColors.accent;
  const roof = colorMid ?? themeColors.accent;
  const base = colorBase ?? themeColors.accent;
  const spark = themeColors.accent;
  const isCity = scene === 'city';

  // City geometry (ground line + 6 towers, windows computed per tower).
  const GROUND_Y = 64;
  const CITY: { x: number; w: number; top: number }[] = [
    { x: 8, w: 15, top: 46 }, { x: 26, w: 17, top: 32 }, { x: 46, w: 13, top: 18 },
    { x: 62, w: 19, top: 38 }, { x: 84, w: 13, top: 26 }, { x: 100, w: 14, top: 48 },
  ];
  const windowsFor = (b: { x: number; w: number; top: number }) => {
    const cols = b.w >= 12 ? [b.x + 3, b.x + b.w - 5.6] : [b.x + b.w / 2 - 1.3];
    const out: { x: number; y: number }[] = [];
    for (let r = 0; r < 3; r++) {
      const wy = b.top + 6 + r * 8;
      if (wy > GROUND_Y - 5) break;
      for (const wx of cols) out.push({ x: wx, y: wy });
    }
    return out;
  };

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={shownLabel ?? 'Loading'}
      testID="construction-loader"
    >
      <Reanimated.View style={breatheStyle}>
        {isCity ? (
          <Svg width={dims.svg * 1.35} height={dims.svg * 1.35 * 72 / 120} viewBox="0 0 120 72" fill="none">
            <Line x1={4} y1={GROUND_Y} x2={116} y2={GROUND_Y} stroke={base} strokeWidth={2.6} strokeLinecap="round" />
            {CITY.map((b, i) => (
              <CityBuilding key={i} progress={progress} index={i} count={CITY.length} b={b} stroke={main} windowFill={spark} windows={windowsFor(b)} />
            ))}
          </Svg>
        ) : (
          <Svg width={dims.svg} height={dims.svg * 58 / 64} viewBox="0 0 64 58" fill="none">
            <BuildPart progress={progress} index={0} count={7} rise={5}>
              <Line x1={8} y1={50} x2={56} y2={50} stroke={base} strokeWidth={3} strokeLinecap="round" />
            </BuildPart>
            <BuildPart progress={progress} index={1} count={7} rise={5}>
              <Line x1={16} y1={50} x2={16} y2={27} stroke={main} strokeWidth={2.6} strokeLinecap="round" />
            </BuildPart>
            <BuildPart progress={progress} index={2} count={7} rise={5}>
              <Line x1={48} y1={50} x2={48} y2={27} stroke={main} strokeWidth={2.6} strokeLinecap="round" />
            </BuildPart>
            <BuildPart progress={progress} index={3} count={7} rise={5}>
              <Polyline points="12,28 32,13 52,28" stroke={roof} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </BuildPart>
            <BuildPart progress={progress} index={4} count={7} rise={5}>
              <Rect x={20.5} y={31} width={7} height={7} rx={1} stroke={main} strokeWidth={1.9} fill="none" strokeLinejoin="round" />
            </BuildPart>
            <BuildPart progress={progress} index={5} count={7} rise={5}>
              <Path d="M28 50 L28 38 L36 38 L36 50" stroke={main} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </BuildPart>
            <BuildPart progress={progress} index={6} count={7} rise={5}>
              <Path d="M32 4 L33.1 7.4 L36.5 8.5 L33.1 9.6 L32 13 L30.9 9.6 L27.5 8.5 L30.9 7.4 Z" fill={spark} />
            </BuildPart>
          </Svg>
        )}
      </Reanimated.View>
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
