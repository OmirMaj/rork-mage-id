// components/auth/SignatureStroke.tsx — "Dana Ruiz" writes itself on the sample contract.
//
// Five pen strokes (utils/auth/spineSequence SIGNATURE_STROKES), each drawn by
// moving its strokeDashoffset from the stroke's own length to 0. The value is
// the spine's JS-driven `ink` clock (milliseconds into the signature beat), so
// at rest, under Reduce Motion and in jest the whole name is simply there.
// The signature is made up for the sample contract; it is not a real person's.
import React, { useMemo } from 'react';
import { Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SIGNATURE_STROKES, SIGNATURE_VIEWBOX, pathLength } from '@/utils/auth/spineSequence';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SignatureStrokeProps = {
  ink: Animated.Value;
  width: number;
  height: number;
  color?: string;
  strokeWidth?: number;
};

export default function SignatureStroke({ ink, width, height, color = '#1A2B22', strokeWidth = 2.3 }: SignatureStrokeProps) {
  const strokes = useMemo(() => SIGNATURE_STROKES.map(([d, so, sd]) => {
    // A hair over the measured length, so no sliver of the dash gap shows at the start.
    const len = Math.ceil(pathLength(d)) + 2;
    return {
      d,
      len,
      offset: ink.interpolate({ inputRange: [so, so + sd], outputRange: [len, 0], extrapolate: 'clamp' }),
      // Hidden until its stroke begins (a round cap would otherwise show a dot).
      opacity: ink.interpolate({ inputRange: [so, so + 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    };
  }), [ink]);

  return (
    <Svg width={width} height={height} viewBox={SIGNATURE_VIEWBOX} accessible={false} pointerEvents="none">
      {strokes.map((s) => (
        <AnimatedPath
          key={s.d.slice(0, 16)}
          d={s.d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[s.len, s.len]}
          strokeDashoffset={s.offset}
          strokeOpacity={s.opacity}
        />
      ))}
    </Svg>
  );
}
