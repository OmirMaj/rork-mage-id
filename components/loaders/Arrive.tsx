// Arrive — content landing after a loader: opacity 0→1 + translateY 6→0 over
// 200 ms decelerate, starting at the settle's +200 (so it lands by +400 while
// the level fades), or at once after a fade exit. Reduce Motion: opacity only,
// 160 ms. Native driver.
//
// GOLDEN-STABLE BY CONSTRUCTION. Not armed on mount → the wrapper's style is
// NULL (a tree that never loaded renders exactly as before). Armed → the
// motion runs once, and once it has finished the style is null again from the
// next render on (the arm-on-change pattern of components/ui/motion.ts
// useRiseOnOpen: never a setState on completion; the resting values ARE the
// null style). Web: always null (web motion is CSS).

import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { DECELERATE, LOADER, plateau } from '@/utils/levelTimeline';

export interface ArriveProps {
  /** Arm on mount (the loader was visible). Read once. */
  armed: boolean;
  /** What the loader did: 'settle' → start at +200; 'fade' → start at once. */
  after?: 'settle' | 'fade';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}

export default function Arrive({ armed, after = 'settle', style, testID, children }: ArriveProps) {
  const reduce = useReducedMotion();
  const armedAtMount = useRef(armed && Platform.OS !== 'web').current;
  const finished = useRef(!armedAtMount);
  const v = useRef<Animated.Value | null>(armedAtMount ? new Animated.Value(0) : null).current;
  const motion = useRef<Animated.WithAnimatedValue<ViewStyle> | null>(null);
  if (v && !motion.current) {
    motion.current = reduce
      ? { opacity: v }
      : { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [LOADER.settle.contentRise, 0], extrapolate: 'clamp' }) }] };
  }

  useLayoutEffect(() => {
    if (!v) return;
    const S = LOADER.settle;
    const at = reduce || after === 'fade' ? 0 : S.contentAtMs;
    const dur = reduce ? LOADER.rmSettleMs : S.contentMs;
    const total = at + dur;
    const a = Animated.timing(v, { toValue: 1, duration: total, easing: plateau(at / total, DECELERATE), useNativeDriver: nativeDriver });
    a.start(() => { finished.current = true; });
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const arriveStyle = finished.current ? null : motion.current;
  return (
    <Animated.View testID={testID} style={style ? [style, arriveStyle] : arriveStyle}>
      {children}
    </Animated.View>
  );
}
