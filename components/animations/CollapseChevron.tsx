// CollapseChevron — a disclosure chevron that ROTATES when its group opens or
// closes, instead of swapping one icon for another.
//
// At rest (never toggled since mount) and always under Reduce Motion it renders
// exactly the old icon swap, so nothing changes until the first toggle. After
// that it is one ChevronDown inside a non-interactive Animated.View whose
// rotation glides over CHEVRON_MS on the native driver.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import { nativeDriver, reducedMotion, useReducedMotion } from '@/components/ui/motion';

// hoist into Motion.duration after round 2
export const CHEVRON_MS = 160;

type Pair = 'rightDown' | 'downUp';

export function CollapseChevron({
  open,
  size,
  color,
  strokeWidth,
  pair = 'rightDown',
}: {
  open: boolean;
  size: number;
  color: string;
  strokeWidth?: number;
  pair?: Pair;
}) {
  const reduced = useReducedMotion();
  const sw = strokeWidth !== undefined ? { strokeWidth } : {};
  // Lazy, so a re-render never allocates a throwaway Animated.Value.
  const [v] = useState(() => new Animated.Value(open ? 1 : 0));
  const prevOpen = useRef(open);
  const target = useRef(open ? 1 : 0);
  // 0 = at rest (never toggled): the plain icon swap. Each animated toggle
  // bumps it, so the rotation starts in a passive effect AFTER the Animated
  // wrapper is mounted.
  const [run, setRun] = useState(0);
  const armed = run > 0;

  // A layout effect, so the toggled commit is re-rendered with the chevron
  // still at its old angle before anything is painted (no icon-swap frame).
  useLayoutEffect(() => {
    if (prevOpen.current === open) return;
    prevOpen.current = open;
    target.current = open ? 1 : 0;
    v.stopAnimation();
    if (reducedMotion()) {
      v.setValue(target.current);
      return;
    }
    setRun((r) => r + 1);
  }, [open, v]);

  useEffect(() => {
    if (run === 0) return;
    Animated.timing(v, {
      toValue: target.current,
      duration: CHEVRON_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
  }, [run, v]);

  if (!armed || reduced) {
    if (pair === 'downUp') return open ? <ChevronUp size={size} color={color} {...sw} /> : <ChevronDown size={size} color={color} {...sw} />;
    return open ? <ChevronDown size={size} color={color} {...sw} /> : <ChevronRight size={size} color={color} {...sw} />;
  }
  const rotate = v.interpolate({
    inputRange: [0, 1],
    outputRange: pair === 'downUp' ? ['0deg', '180deg'] : ['-90deg', '0deg'],
  });
  return (
    <Animated.View pointerEvents="none" style={{ transform: [{ rotate }] }}>
      <ChevronDown size={size} color={color} {...sw} />
    </Animated.View>
  );
}
