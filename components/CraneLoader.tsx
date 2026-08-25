import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Svg, { G, Line, Rect, Path } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';

/**
 * CraneLoader — the full-screen loading animation: a tower crane that hoists a
 * steel beam into place while, optionally, construction facts rotate below it.
 * Used for cold start and for long waits like estimate pricing / drawing +
 * spec-book AI analysis, where the old small centered spinner left most of the
 * screen empty.
 *
 * Built on the RN Animated API + react-native-svg (NOT reanimated) so it ships
 * over-the-air to every build. The cable stays fastened to the trolley and pays
 * OUT as the hook lowers (one shared `hoist` value drives the cable length and
 * the load position in lockstep); the trolley traverses the jib and the load
 * sways like a real pendulum. Colours come from the theme — no raw hex.
 *
 * `CraneSvg` is the bare animated crane at a given pixel size — reuse it inside
 * cards (e.g. the estimate overlay). `CraneLoader` is the full-screen wrapper
 * (wordmark + crane + rotating facts).
 */

const AG = Animated.createAnimatedComponent(G);
const ALine = Animated.createAnimatedComponent(Line);

const VB_W = 340;
const VB_H = 300;

/** The bare animated crane graphic, scaled to `size` (its width in px). */
export function CraneSvg({ size }: { size: number }) {
  const { colors } = useTheme();
  const traverse = useRef(new Animated.Value(0)).current;
  const hoist = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ease = Easing.inOut(Easing.ease);
    const traverseLoop = Animated.loop(Animated.sequence([
      Animated.timing(traverse, { toValue: 1, duration: 3600, easing: ease, useNativeDriver: false }),
      Animated.timing(traverse, { toValue: 0, duration: 3600, easing: ease, useNativeDriver: false }),
    ]));
    // Lower (hoist→1), dwell to "place", raise (hoist→0), dwell.
    const hoistLoop = Animated.loop(Animated.sequence([
      Animated.timing(hoist, { toValue: 1, duration: 1400, easing: ease, useNativeDriver: false }),
      Animated.delay(420),
      Animated.timing(hoist, { toValue: 0, duration: 1400, easing: ease, useNativeDriver: false }),
      Animated.delay(420),
    ]));
    const swayLoop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 1800, easing: ease, useNativeDriver: false }),
      Animated.timing(sway, { toValue: 0, duration: 1800, easing: ease, useNativeDriver: false }),
    ]));
    traverseLoop.start(); hoistLoop.start(); swayLoop.start();
    return () => { traverseLoop.stop(); hoistLoop.stop(); swayLoop.stop(); };
  }, [traverse, hoist, sway]);

  const steel = colors.textMuted;
  const accent = colors.accent;
  const height = (size * VB_H) / VB_W;

  const trolleyX = traverse.interpolate({ inputRange: [0, 1], outputRange: [-24, 28] });
  const cableY2 = hoist.interpolate({ inputRange: [0, 1], outputRange: [116, 200] });
  const loadTY = hoist.interpolate({ inputRange: [0, 1], outputRange: [0, 84] });
  const swayDeg = sway.interpolate({ inputRange: [0, 1], outputRange: [-3.2, 3.2] });

  return (
    <Svg width={size} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
      <Line x1={14} y1={272} x2={326} y2={272} stroke={steel} strokeWidth={1.3} strokeLinecap="round" opacity={0.5} />
      <Path d="M60,272 L66,256 L96,256 L102,272" stroke={steel} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* mast */}
      <G stroke={steel} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Line x1={70} y1={256} x2={70} y2={74} />
        <Line x1={92} y1={256} x2={92} y2={74} />
        <Line x1={70} y1={256} x2={92} y2={218} /><Line x1={92} y1={256} x2={70} y2={218} />
        <Line x1={70} y1={218} x2={92} y2={180} /><Line x1={92} y1={218} x2={70} y2={180} />
        <Line x1={70} y1={180} x2={92} y2={142} /><Line x1={92} y1={180} x2={70} y2={142} />
        <Line x1={70} y1={142} x2={92} y2={104} /><Line x1={92} y1={142} x2={70} y2={104} />
        <Line x1={70} y1={104} x2={92} y2={74} /><Line x1={92} y1={104} x2={70} y2={74} />
      </G>

      {/* operator cab */}
      <Rect x={66} y={56} width={30} height={16} rx={2} fill={colors.surface} stroke={steel} strokeWidth={1.4} />
      {/* apex */}
      <G stroke={steel} strokeWidth={2} strokeLinecap="round"><Line x1={81} y1={34} x2={70} y2={56} /><Line x1={81} y1={34} x2={92} y2={56} /></G>

      {/* counter-jib + weight */}
      <G stroke={steel} strokeWidth={2} strokeLinecap="round"><Line x1={70} y1={56} x2={30} y2={56} /><Line x1={81} y1={34} x2={34} y2={56} /><Line x1={68} y1={66} x2={40} y2={66} /></G>
      <Rect x={22} y={54} width={16} height={18} rx={1} fill={colors.surface} stroke={steel} strokeWidth={1.5} />

      {/* jib truss */}
      <G stroke={steel} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Line x1={92} y1={56} x2={300} y2={56} />
        <Line x1={100} y1={70} x2={278} y2={70} />
        <Line x1={81} y1={34} x2={300} y2={56} />
        <Line x1={120} y1={56} x2={120} y2={70} /><Line x1={160} y1={56} x2={160} y2={70} />
        <Line x1={200} y1={56} x2={200} y2={70} /><Line x1={240} y1={56} x2={240} y2={70} />
        <Line x1={278} y1={56} x2={278} y2={70} />
        <Line x1={120} y1={70} x2={160} y2={56} /><Line x1={160} y1={70} x2={200} y2={56} />
        <Line x1={200} y1={70} x2={240} y2={56} /><Line x1={240} y1={70} x2={278} y2={56} />
      </G>

      {/* moving trolley + rigging + load */}
      <AG translateX={trolleyX}>
        <Rect x={196} y={68} width={16} height={7} rx={1.5} fill={steel} />
        <ALine x1={204} y1={75} x2={204} y2={cableY2} stroke={steel} strokeWidth={1.3} />
        <AG translateY={loadTY}>
          <AG rotation={swayDeg} originX={204} originY={116}>
            <Path d="M204,113 L204,121 q0,5 -4,5 q-3,0 -3,-3" stroke={steel} strokeWidth={1.6} fill="none" strokeLinecap="round" />
            <Line x1={204} y1={121} x2={189} y2={132} stroke={steel} strokeWidth={1} opacity={0.7} />
            <Line x1={204} y1={121} x2={219} y2={132} stroke={steel} strokeWidth={1} opacity={0.7} />
            <Rect x={185} y={131} width={38} height={5} rx={1} fill={colors.surface} stroke={accent} strokeWidth={2} />
            <Line x1={204} y1={136} x2={204} y2={150} stroke={accent} strokeWidth={1.3} opacity={0.7} />
            <Rect x={189} y={150} width={30} height={5} rx={1} fill={colors.surface} stroke={accent} strokeWidth={2} />
          </AG>
        </AG>
      </AG>
    </Svg>
  );
}

interface CraneLoaderProps {
  /** Wordmark / title above the crane. */
  label?: string;
  /** Rotating one-liners shown beneath the crane (construction facts / tips). */
  facts?: readonly string[];
  /** How long each fact is shown. Default 3800ms. */
  factIntervalMs?: number;
  /** Wrapper override — defaults to full-screen (flex: 1). */
  style?: ViewStyle;
}

export default function CraneLoader({ label = 'MAGE ID', facts, factIntervalMs = 3800, style }: CraneLoaderProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const factFade = useRef(new Animated.Value(1)).current;

  const rotating = Array.isArray(facts) && facts.length > 0;
  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => {
    if (!rotating || facts!.length <= 1) return;
    const id = setInterval(() => setFactIdx(i => (i + 1) % facts!.length), Math.max(1500, factIntervalMs));
    return () => clearInterval(id);
  }, [rotating, facts, factIntervalMs]);
  useEffect(() => {
    factFade.setValue(0);
    Animated.timing(factFade, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [factIdx, factFade]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }, style]} testID="crane-loader">
      <Text style={[Type.serifLargeTitle, styles.word, { color: colors.text }]}>{label}</Text>
      <CraneSvg size={Math.min(width * 0.86, 360)} />
      {rotating && (
        <Animated.View style={[styles.factWrap, { opacity: factFade }]}>
          <Text style={[Type.monoCaption, styles.factEyebrow, { color: colors.accent }]}>WHILE WE WORK</Text>
          <Text style={[styles.factText, { color: colors.textSecondary }]}>{facts![factIdx]}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  word: { marginBottom: '8%' },
  factWrap: { marginTop: '10%', alignItems: 'center', minHeight: 60, maxWidth: 340 },
  factEyebrow: { letterSpacing: 1.4, marginBottom: 8 },
  factText: { fontSize: Type.subhead.fontSize, lineHeight: 22, textAlign: 'center', fontWeight: '500' },
});
