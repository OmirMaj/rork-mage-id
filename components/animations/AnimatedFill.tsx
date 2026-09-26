// AnimatedFill — a progress-bar fill that GLIDES to its new width instead of
// jumping. The caller keeps its exact style expression (width included); at
// rest this renders the very same leaf <View style={style} />, so nothing
// changes until the value moves after mount.
//
// On a change the leaf becomes an Animated.View once (it has no children) and
// plays ProjectCard's burn-bar FLIP: the new width is laid out at once and the
// fill is scaled from old/new back to 1 about its left edge — transform only,
// so it runs on the native driver. The rounded ends squash for FILL_MS, which
// is accepted.
//
// CONTRACT: `value` is the SAME number the width uses (the already-clamped
// percentage). It is clamped again here to [0, 100], so a bar pinned at 100%
// stays still when the raw value moves from 120 to 150.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, View, ViewStyle } from 'react-native';
import { nativeDriver, reducedMotion } from '@/components/ui/motion';

// hoist into Motion.duration after round 2
export const FILL_MS = 320;

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function AnimatedFill({ value, style, testID }: { value: number; style: StyleProp<ViewStyle>; testID?: string }) {
  const v = clampPct(value);
  const prev = useRef(v);
  // Lazy, so a re-render never allocates a throwaway Animated.Value.
  const [s] = useState(() => new Animated.Value(1));
  // 0 = at rest (never armed): the plain leaf. Each armed change bumps it, so
  // the glide starts in a passive effect AFTER the Animated leaf is mounted.
  const [run, setRun] = useState(0);

  // A layout effect, so the commit that carries the new width is re-rendered
  // with the old-width scale before it is ever painted.
  useLayoutEffect(() => {
    if (prev.current === v) return;
    const from = prev.current;
    prev.current = v;
    s.stopAnimation();
    if (v > 0 && !reducedMotion()) {
      s.setValue(from / v);
      setRun((r) => r + 1);
    } else {
      s.setValue(1);
    }
  }, [v, s]);

  useEffect(() => {
    if (run === 0) return;
    Animated.timing(s, {
      toValue: 1,
      duration: FILL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
  }, [run, s]);

  if (run === 0) return <View style={style} {...(testID ? { testID } : {})} />;
  return (
    <Animated.View
      style={[style, { transformOrigin: 'left', transform: [{ scaleX: s }] }]}
      {...(testID ? { testID } : {})}
    />
  );
}
