// MageCraneBuild — MAGE ID's animated AI mark: a tower crane that builds the
// word "AI". The trolley runs the jib, lowers each beam, and the structure
// assembles — the A (two legs + crossbar) then the I (steel I-beam) — and the
// amber spark is set on top. Then it loops.
//
// This is the brand's "AI is being built for you" motion. It replaces the
// generic Sparkles bubble. Driven by the React Native Animated API (no
// react-native-reanimated dependency, so it ships over-the-air) against
// react-native-svg's animated primitives. JS-driven (svg props can't use the
// native driver) but lightweight — one trolley value + seven beam values.
//
// Pass `color` for the crane/letters (e.g. white on the dark bubble) and
// `accentColor` for the amber spark. `loop={false}` plays once and holds the
// finished "AI".

import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { G, Line, Path, Rect, Circle, Polyline } from 'react-native-svg';

const AG = Animated.createAnimatedComponent(G);

export interface MageCraneBuildProps {
  size?: number;
  /** Crane + letters color. On the dark bubble this is white/paper. */
  color?: string;
  /** The amber spark. */
  accentColor?: string;
  /** Loop forever (default) or play once and hold the built "AI". */
  loop?: boolean;
}

// Drop points the trolley travels to, in viewBox units, before each beam lands.
const TROLLEY = { aLeft: 24, aRight: 33, aCross: 28, i: 42, spark: 28 } as const;

export default function MageCraneBuild({
  size = 40,
  color = '#FFFFFF',
  accentColor = '#FF6A1A',
  loop = true,
}: MageCraneBuildProps) {
  // One value per assembled beam (0 → 1 = faded + dropped into place).
  const b = useRef([0, 0, 0, 0, 0, 0, 0].map(() => new Animated.Value(0))).current;
  const trolleyX = useRef(new Animated.Value(TROLLEY.spark)).current;

  useEffect(() => {
    const ease = Easing.bezier(0.42, 0, 0.25, 1);
    const out = Easing.out(Easing.cubic);
    const move = (to: number, duration: number) =>
      Animated.timing(trolleyX, { toValue: to, duration, easing: ease, useNativeDriver: false });
    const place = (i: number, duration: number) =>
      Animated.timing(b[i], { toValue: 1, duration, easing: out, useNativeDriver: false });

    const build = Animated.sequence([
      move(TROLLEY.aLeft, 280), place(0, 340),
      move(TROLLEY.aRight, 280), place(1, 340),
      move(TROLLEY.aCross, 220), place(2, 340),
      move(TROLLEY.i, 320), place(3, 320), place(4, 300), place(5, 300),
      move(TROLLEY.spark, 300), place(6, 360),
    ]);

    if (!loop) {
      build.start();
      return () => build.stop();
    }

    const reset = Animated.parallel([
      ...b.map(v => Animated.timing(v, { toValue: 0, duration: 320, easing: ease, useNativeDriver: false })),
      Animated.timing(trolleyX, { toValue: TROLLEY.spark, duration: 320, easing: ease, useNativeDriver: false }),
    ]);

    const anim = Animated.loop(
      Animated.sequence([build, Animated.delay(900), reset, Animated.delay(150)]),
    );
    anim.start();
    return () => anim.stop();
  }, [b, trolleyX, loop]);

  // opacity = the value itself; the beam also drops in from 6 units above.
  const beam = (i: number) => ({
    opacity: b[i],
    translateY: b[i].interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
  });
  const stroke = { stroke: color, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* —— static crane —— */}
      <Line x1={16} y1={50} x2={48} y2={50} strokeWidth={2} {...stroke} />
      <Line x1={14} y1={50} x2={14} y2={12} strokeWidth={3} {...stroke} />
      <Line x1={12} y1={14} x2={48} y2={14} strokeWidth={2.2} {...stroke} />
      <Polyline points="10,14 14,7 18,14" fill="none" strokeWidth={1.4} {...stroke} />
      <Line x1={14} y1={7} x2={48} y2={14} strokeWidth={0.8} {...stroke} />
      <Line x1={14} y1={7} x2={12} y2={14} strokeWidth={0.8} {...stroke} />

      {/* —— trolley + cable + hook (runs the jib) —— */}
      <AG translateX={trolleyX}>
        <Rect x={-2.6} y={11} width={5.2} height={4} rx={0.8} fill={color} />
        <Line x1={0} y1={15} x2={0} y2={19} strokeWidth={1} {...stroke} />
        <Circle cx={0} cy={19} r={1.1} fill={color} />
      </AG>

      {/* —— the A —— */}
      <AG {...beam(0)}><Line x1={22} y1={48} x2={28} y2={26} strokeWidth={3.2} {...stroke} /></AG>
      <AG {...beam(1)}><Line x1={34} y1={48} x2={28} y2={26} strokeWidth={3.2} {...stroke} /></AG>
      <AG {...beam(2)}><Line x1={24.5} y1={39} x2={31.5} y2={39} strokeWidth={3} {...stroke} /></AG>

      {/* —— the I (steel I-beam) —— */}
      <AG {...beam(3)}><Line x1={42} y1={26} x2={42} y2={48} strokeWidth={3.2} {...stroke} /></AG>
      <AG {...beam(4)}><Line x1={37} y1={26} x2={47} y2={26} strokeWidth={3.2} {...stroke} /></AG>
      <AG {...beam(5)}><Line x1={37} y1={48} x2={47} y2={48} strokeWidth={3.2} {...stroke} /></AG>

      {/* —— the amber spark, set on top —— */}
      <AG {...beam(6)}>
        <Path d="M28 14 L29 17.2 L32.2 18.2 L29 19.2 L28 22.4 L27 19.2 L23.8 18.2 L27 17.2 Z" fill={accentColor} />
      </AG>
    </Svg>
  );
}
