// LEGACY-SVG-CRANE: moved verbatim by CORE; the WEB lane rebuilds this file as composited CSS divs and deletes this marker.
//
// CraneMarkWeb — the web's animated SVG tower crane (≥ 120 px only; below that
// CraneSvg draws the level). Moved here unchanged from components/CraneLoader.tsx
// (its old CraneSvgWeb) so CraneLoader imports no react-native-svg. Its JS-driven
// Animated.sequence loops are exactly what scripts/validate-level.ts rule D bans
// under components/loaders/**, so rule D skips this ONE path while the marker
// above is present; the WEB lane rebuilds it as composited divs + CSS keyframes
// and removes the marker, and from then on rule D applies in full.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { G, Line, Rect, Path } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';

const AG = Animated.createAnimatedComponent(G);
const ALine = Animated.createAnimatedComponent(Line);

const VB_W = 340;
const VB_H = 300;

export default function CraneMarkWeb({ size }: { size: number }) {
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
    <Svg testID="crane-mark-web" width={size} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
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
