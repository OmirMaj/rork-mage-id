import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { G, Line, Rect, Path } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';

/**
 * MageBootScreen — the full-screen cold-start animation.
 *
 * A whole city skyline BUILDS itself edge-to-edge across the lower half of the
 * screen: towers rise off the ground line left→right, their windows light amber
 * a beat after each lands, and the tallest is crowned with the brand spark —
 * under the "MAGE ID" wordmark. Replaces the small centered loader that left the
 * screen mostly empty.
 *
 * Built on the RN Animated API + react-native-svg (NOT reanimated) so it runs on
 * every shipped build — including ones that predate the reanimated native module.
 * SVG props animate on the JS thread; the wordmark's breathe uses the native
 * driver (opacity on a Text).
 */

const AG = Animated.createAnimatedComponent(G);

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

const STAGGER_MS = 120;
const PLACE_MS = 360;
const HOLD_MS = 950;
const FADE_MS = 520;
const GAP_MS = 320;

export default function MageBootScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  // One value per tower (0 → 1 as it rises). Shared loop staggers them.
  const vals = useRef(TOWERS.map(() => new Animated.Value(0))).current;
  const breathe = useRef(new Animated.Value(0.72)).current;

  useEffect(() => {
    const place = (v: Animated.Value) =>
      Animated.timing(v, { toValue: 1, duration: PLACE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    const fade = (v: Animated.Value) =>
      Animated.timing(v, { toValue: 0, duration: FADE_MS, easing: Easing.in(Easing.quad), useNativeDriver: false });

    const cycle = Animated.sequence([
      Animated.stagger(STAGGER_MS, vals.map(place)),
      Animated.delay(HOLD_MS),
      Animated.parallel(vals.map(fade)),
      Animated.delay(GAP_MS),
    ]);
    const loop = Animated.loop(cycle);
    // Wordmark breathes (opacity) on the native driver so it never janks.
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0.7, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    vals.forEach((v) => v.setValue(0));
    loop.start();
    breatheLoop.start();
    return () => { loop.stop(); breatheLoop.stop(); };
  }, [vals, breathe]);

  const rise = (i: number) => ({
    opacity: vals[i],
    translateY: vals[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
  });
  const lit = (i: number) => vals[i].interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] });

  const svgW = width;
  const svgH = (width * VB_H) / VB_W;
  const accent = colors.accent;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]} testID="cold-start-loader">
      <View style={styles.brand}>
        <Text style={[Type.serifLargeTitle, { color: colors.text }]}>MAGE ID</Text>
        <Animated.Text style={[Type.monoCaption, styles.tag, { color: colors.textMuted, opacity: breathe }]}>
          Building your workspace…
        </Animated.Text>
      </View>

      <View style={styles.skyline} pointerEvents="none">
        <Svg width={svgW} height={svgH} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
          <Line x1={4} y1={GROUND_Y} x2={VB_W - 4} y2={GROUND_Y} stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
          {TOWERS.map((b, i) => (
            <AG key={i} {...rise(i)}>
              <Rect x={b.x} y={b.top} width={b.w} height={GROUND_Y - b.top} rx={1.5} stroke={accent} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
              {i === TALLEST && (
                <Path
                  d={`M${b.x + b.w / 2} ${b.top - 15} L${b.x + b.w / 2 + 1.7} ${b.top - 9.5} L${b.x + b.w / 2 + 7} ${b.top - 8} L${b.x + b.w / 2 + 1.7} ${b.top - 6.5} L${b.x + b.w / 2} ${b.top - 1} L${b.x + b.w / 2 - 1.7} ${b.top - 6.5} L${b.x + b.w / 2 - 7} ${b.top - 8} L${b.x + b.w / 2 - 1.7} ${b.top - 9.5} Z`}
                  fill={accent}
                />
              )}
              <AG opacity={lit(i)}>
                {windowsFor(b).map((wn, j) => (
                  <Rect key={j} x={wn.x} y={wn.y} width={3} height={3} rx={0.6} fill={accent} />
                ))}
              </AG>
            </AG>
          ))}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    gap: 8,
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
