// MageBuildScene — MAGE ID's full-screen construction loader. A tower crane
// erects a 3-storey building floor-by-floor: foundation → columns → floor slabs
// → roof → windows + door → and the amber spark caps it. The crane's hoist
// lowers to each level as the beam eases into place, then it loops.
//
// This is the big-canvas counterpart to ConstructionLoader (the small inline
// house): use it for full-screen loading states (e.g. the AI estimate overlay).
// Built on the React Native Animated API + react-native-svg (no reanimated
// dep, ships over-the-air). JS-driven; ~11 animated nodes, fine for a loader.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { G, Line, Path, Rect, Polyline, Circle } from 'react-native-svg';

const AG = Animated.createAnimatedComponent(G);
const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);

export interface MageBuildSceneProps {
  /** Rendered width in px. Height is derived (3:2.25). */
  size?: number;
  /** Crane + building line color. Use the theme text color so it adapts. */
  color?: string;
  /** The capping spark. Defaults to brand amber. */
  accentColor?: string;
}

// Hook depth (cy) the hoist lowers to before each part lands, in viewBox units.
const HOOK_Y = [120, 104, 102, 82, 80, 60, 58, 70, 46];

export default function MageBuildScene({
  size = 300,
  color = '#0B0D10',
  accentColor = '#FF6A1A',
}: MageBuildSceneProps) {
  const p = useRef([0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => new Animated.Value(0))).current;
  const cableY = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    const ease = Easing.bezier(0.42, 0, 0.25, 1);
    const out = Easing.out(Easing.cubic);
    const lower = (to: number) => Animated.timing(cableY, { toValue: to, duration: 240, easing: ease, useNativeDriver: false });
    const place = (i: number) => Animated.timing(p[i], { toValue: 1, duration: 300, easing: out, useNativeDriver: false });

    const steps: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < p.length; i++) {
      steps.push(lower(HOOK_Y[i]));
      steps.push(place(i));
    }
    const reset = Animated.parallel([
      ...p.map(v => Animated.timing(v, { toValue: 0, duration: 320, easing: ease, useNativeDriver: false })),
      Animated.timing(cableY, { toValue: 40, duration: 320, easing: ease, useNativeDriver: false }),
    ]);
    const anim = Animated.loop(Animated.sequence([...steps, Animated.delay(1100), reset, Animated.delay(200)]));
    anim.start();
    return () => anim.stop();
  }, [p, cableY]);

  const beam = (i: number) => ({
    opacity: p[i],
    translateY: p[i].interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
  });
  const ln = { stroke: color, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const cols = (y1: number, y2: number) => (
    <>
      <Line x1={98} y1={y1} x2={98} y2={y2} strokeWidth={3} {...ln} />
      <Line x1={162} y1={y1} x2={162} y2={y2} strokeWidth={3} {...ln} />
    </>
  );

  return (
    <Svg width={size} height={size * 150 / 200} viewBox="0 0 200 150" fill="none">
      {/* ground */}
      <Line x1={12} y1={130} x2={188} y2={130} strokeWidth={3} {...ln} />

      {/* —— static tower crane —— */}
      <Line x1={26} y1={130} x2={26} y2={26} strokeWidth={2} {...ln} />
      <Line x1={34} y1={130} x2={34} y2={26} strokeWidth={2} {...ln} />
      <Polyline points="26,118 34,108 26,98 34,88 26,78 34,68 26,58 34,48 26,38 34,28" strokeWidth={1.2} fill="none" {...ln} />
      <Polyline points="24,26 30,14 36,26" strokeWidth={1.6} fill="none" {...ln} />
      <Line x1={30} y1={20} x2={180} y2={20} strokeWidth={2.4} {...ln} />
      <Line x1={40} y1={27} x2={170} y2={27} strokeWidth={1.3} {...ln} />
      <Polyline points="40,27 52,20 64,27 76,20 88,27 100,20 112,27 124,20 136,27 148,20 160,27 170,21" strokeWidth={1} fill="none" {...ln} />
      <Line x1={30} y1={21} x2={8} y2={21} strokeWidth={2.2} {...ln} />
      <Rect x={3} y={16.5} width={7} height={9} rx={1} fill={color} />
      <Line x1={30} y1={14} x2={178} y2={20} strokeWidth={0.7} {...ln} />
      <Line x1={30} y1={14} x2={9} y2={21} strokeWidth={0.7} {...ln} />
      <Rect x={126} y={16.5} width={8} height={5} rx={0.8} fill={color} />

      {/* —— animated hoist cable + hook —— */}
      <ALine x1={130} y1={21.5} x2={130} y2={cableY} strokeWidth={1} {...ln} />
      <ACircle cx={130} cy={cableY} r={1.6} fill={color} />

      {/* —— building, raised floor by floor —— */}
      <AG {...beam(0)}><Line x1={92} y1={128} x2={168} y2={128} strokeWidth={5} {...ln} /></AG>
      <AG {...beam(1)}>{cols(128, 108)}</AG>
      <AG {...beam(2)}><Line x1={94} y1={106} x2={166} y2={106} strokeWidth={4} {...ln} /></AG>
      <AG {...beam(3)}>{cols(106, 86)}</AG>
      <AG {...beam(4)}><Line x1={94} y1={84} x2={166} y2={84} strokeWidth={4} {...ln} /></AG>
      <AG {...beam(5)}>{cols(84, 64)}</AG>
      <AG {...beam(6)}>
        <Line x1={94} y1={62} x2={166} y2={62} strokeWidth={4} {...ln} />
        <Line x1={97} y1={62} x2={97} y2={57} strokeWidth={2.4} {...ln} />
        <Line x1={163} y1={62} x2={163} y2={57} strokeWidth={2.4} {...ln} />
      </AG>
      <AG {...beam(7)}>
        <Path d="M124 128 L124 114 L136 114 L136 128" strokeWidth={2.6} fill="none" {...ln} />
        <Rect x={108} y={90} width={14} height={10} rx={1} strokeWidth={1.7} fill="none" {...ln} />
        <Rect x={138} y={90} width={14} height={10} rx={1} strokeWidth={1.7} fill="none" {...ln} />
        <Rect x={108} y={68} width={14} height={10} rx={1} strokeWidth={1.7} fill="none" {...ln} />
        <Rect x={138} y={68} width={14} height={10} rx={1} strokeWidth={1.7} fill="none" {...ln} />
      </AG>
      <AG {...beam(8)}>
        <Path d="M130 47 L131.4 52 L136.4 53.4 L131.4 54.8 L130 59.8 L128.6 54.8 L123.6 53.4 L128.6 52 Z" fill={accentColor} />
      </AG>
    </Svg>
  );
}
