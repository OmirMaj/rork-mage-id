import React, { useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { G, Line, Rect, Path } from 'react-native-svg';
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
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';

/**
 * MageBootScreen — the full-screen cold-start animation.
 *
 * A whole city skyline BUILDS itself edge-to-edge across the lower half of the
 * screen: towers rise off the ground line left→right, their windows light amber
 * a beat after each lands, and the tallest is crowned with the brand spark —
 * under the "MAGE ID" wordmark. Runs on react-native-reanimated (worklets on the
 * UI thread) so it stays smooth through the exact cold-start moment the JS
 * thread is busy hydrating the app. Replaces the small centered loader that left
 * the screen mostly empty.
 */

const AnimatedG = Reanimated.createAnimatedComponent(G);

// Skyline in a wide viewBox; scaled to the full device width at render.
const VB_W = 320;
const VB_H = 172;
const GROUND_Y = 150;

// x, width, roof-y (top). A varied skyline; index 5 is the tallest (spark).
const TOWERS: { x: number; w: number; top: number }[] = [
  { x: 6, w: 20, top: 98 },
  { x: 30, w: 24, top: 60 },
  { x: 58, w: 18, top: 110 },
  { x: 80, w: 26, top: 46 },
  { x: 110, w: 20, top: 80 },
  { x: 134, w: 22, top: 28 },
  { x: 160, w: 18, top: 92 },
  { x: 182, w: 24, top: 54 },
  { x: 210, w: 20, top: 102 },
  { x: 234, w: 26, top: 40 },
  { x: 264, w: 18, top: 86 },
  { x: 286, w: 24, top: 66 },
];
const TALLEST = 5;

function windowsFor(b: { x: number; w: number; top: number }): { x: number; y: number }[] {
  const cols = b.w >= 20 ? [b.x + 4, b.x + b.w - 7.5] : [b.x + b.w / 2 - 1.6];
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < 9; r++) {
    const wy = b.top + 9 + r * 9;
    if (wy > GROUND_Y - 7) break;
    for (const wx of cols) out.push({ x: wx, y: wy });
  }
  return out;
}

// One build cycle: staggered rise (0 → BUILD_END), hold, fade back, short gap.
const BUILD_MS = 2200;
const HOLD_MS = 1000;
const FADE_MS = 700;
const GAP_MS = 380;
const APPEAR_SPAN = 0.34;

/** A tower that rises off the ground, then its windows light up a beat later. */
function Tower({
  progress,
  index,
  count,
  b,
  stroke,
  windowFill,
  windows,
  hasSpark,
  sparkColor,
}: {
  progress: SharedValue<number>;
  index: number;
  count: number;
  b: { x: number; w: number; top: number };
  stroke: string;
  windowFill: string;
  windows: { x: number; y: number }[];
  hasSpark: boolean;
  sparkColor: string;
}) {
  const riseProps = useAnimatedProps(() => {
    const step = (1 - APPEAR_SPAN) / Math.max(1, count - 1);
    const from = index * step;
    const to = from + APPEAR_SPAN;
    const o = interpolate(progress.value, [from, to], [0, 1], Extrapolation.CLAMP);
    return { opacity: o, translateY: (1 - o) * 14 };
  });
  const windowProps = useAnimatedProps(() => {
    const step = (1 - APPEAR_SPAN) / Math.max(1, count - 1);
    const from = index * step;
    const lit = interpolate(progress.value, [from + APPEAR_SPAN * 0.7, from + APPEAR_SPAN], [0, 1], Extrapolation.CLAMP);
    return { opacity: lit };
  });
  return (
    <AnimatedG animatedProps={riseProps}>
      <Rect x={b.x} y={b.top} width={b.w} height={GROUND_Y - b.top} rx={1.5} stroke={stroke} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
      {hasSpark && (
        <Path
          d={`M${b.x + b.w / 2} ${b.top - 15} L${b.x + b.w / 2 + 1.7} ${b.top - 9.5} L${b.x + b.w / 2 + 7} ${b.top - 8} L${b.x + b.w / 2 + 1.7} ${b.top - 6.5} L${b.x + b.w / 2} ${b.top - 1} L${b.x + b.w / 2 - 1.7} ${b.top - 6.5} L${b.x + b.w / 2 - 7} ${b.top - 8} L${b.x + b.w / 2 - 1.7} ${b.top - 9.5} Z`}
          fill={sparkColor}
        />
      )}
      <AnimatedG animatedProps={windowProps}>
        {windows.map((wn, j) => (
          <Rect key={j} x={wn.x} y={wn.y} width={3} height={3} rx={0.6} fill={windowFill} />
        ))}
      </AnimatedG>
    </AnimatedG>
  );
}

export default function MageBootScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = makeStyles();

  const progress = useSharedValue(0);
  const breathe = useSharedValue(0.9);
  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withDelay(GAP_MS, withTiming(1, { duration: BUILD_MS, easing: Easing.out(Easing.cubic) })),
        withDelay(HOLD_MS, withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) })),
      ),
      -1,
    );
    // The wordmark breathes gently so the screen feels alive while it loads.
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.72, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [progress, breathe]);

  const tagStyle = useAnimatedStyle(() => ({ opacity: breathe.value }));

  const svgW = width;
  const svgH = (width * VB_H) / VB_W;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]} testID="cold-start-loader">
      <View style={styles.brand}>
        <Text style={[Type.serifLargeTitle, { color: colors.text }]}>MAGE ID</Text>
        <Reanimated.Text style={[Type.monoCaption, styles.tag, { color: colors.textMuted }, tagStyle]}>
          Building your workspace…
        </Reanimated.Text>
      </View>

      <View style={styles.skyline} pointerEvents="none">
        <Svg width={svgW} height={svgH} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
          <Line x1={4} y1={GROUND_Y} x2={VB_W - 4} y2={GROUND_Y} stroke={colors.accent} strokeWidth={2.6} strokeLinecap="round" />
          {TOWERS.map((b, i) => (
            <Tower
              key={i}
              progress={progress}
              index={i}
              count={TOWERS.length}
              b={b}
              stroke={colors.accent}
              windowFill={colors.accent}
              windows={windowsFor(b)}
              hasSpark={i === TALLEST}
              sparkColor={colors.accent}
            />
          ))}
        </Svg>
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    gap: 8,
    // Sit the wordmark in the upper third so the skyline has room below it.
    marginBottom: '18%',
  },
  tag: {
    letterSpacing: 0.4,
  },
  skyline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
});
