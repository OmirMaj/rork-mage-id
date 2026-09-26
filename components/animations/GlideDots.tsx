// GlideDots — a row of step dots whose active pill STRETCHES to the next step.
//
// AT REST it renders exactly the inline row it replaces: a row View (the
// caller's `style`) holding `count` Views, each [dotStyle, i === active &&
// activeStyle]. Nothing else, so a first render — and every golden — is
// byte-identical to the old inline dots.
//
// ON AN `active` CHANGE after mount (not under Reduce Motion) it runs the
// SegmentedControl recipe (components/ui/SegmentedControl.tsx): ONE absolutely
// positioned pill whose two edges L and R run on separate springs
// (edgeSprings: the leading edge on Motion.spring.glideLead, the trailing edge
// on glideTrail), drawn as translateX = (L+R)/2 − w0/2 and scaleX = (R−L)/w0 on
// the native driver. While it flies the dots sit in the NEW layout, all in the
// inactive colour; on the spring's end the pill unmounts in the same commit
// that paints the new active dot. A change mid-glide carries on from the
// current edges. Reduce Motion: today's instant swap.
//
// The rects are ARITHMETIC. Every dot left of the active one is inactive, so
// the active dot's x is origin + index · (dotW + gap) in the old layout and in
// the new one, and it is activeW wide in both; the row's total width is the
// same, so both rects share one frame. `origin` is dot 0's measured x/y (0
// until it lays out), which covers a centred row (the pips) and a
// self-centred one (the step dots) alike.
//
// SEAM (the spec's STEP 1 note): the pill starts on the OLD active dot's rect.
// Moving right, the dot it leaves has already shrunk to dotW underneath it and
// the pill covers that spot plus a sliver of the next dot, all in the active
// colour, for the first frames; the new active dot is painted inactive until
// the pill lands on it. Shipped as the arithmetic `from` (no re-anchoring).

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { nativeDriver, reducedMotion, useReducedMotion } from '@/components/ui/motion';
import { edgeSprings } from '@/components/ui/SegmentedControl';

export interface GlideDotsProps {
  count: number;
  /** Index of the active dot (out of range = none active). */
  active: number;
  /** Width of an inactive dot. */
  dotW: number;
  /** Width of the active dot. */
  activeW: number;
  /** Dot height (the pill's radius is height / 2). */
  height: number;
  /** The row's gap between dots. */
  gap: number;
  /** Inactive colour — every dot paints it while the pill flies. */
  color: string;
  /** Active colour — the pill's fill. */
  activeColor: string;
  /** The row's own style (today's row style). */
  style?: StyleProp<ViewStyle>;
  /** Today's dot style. */
  dotStyle: StyleProp<ViewStyle>;
  /** Today's active-dot style. */
  activeStyle: StyleProp<ViewStyle>;
  testID?: string;
}

/** The active dot's rect (x, width) for `index`, relative to dot 0's x. */
export function activeDotSpan(index: number, dotW: number, activeW: number, gap: number): { x: number; w: number } {
  return { x: index * (dotW + gap), w: activeW };
}

export default function GlideDots({
  count, active, dotW, activeW, height, gap, color, activeColor, style, dotStyle, activeStyle, testID,
}: GlideDotsProps) {
  const reduce = useReducedMotion();
  const L = useRef(new Animated.Value(0)).current;
  const R = useRef(new Animated.Value(0)).current;
  const [gliding, setGliding] = useState(false);
  const flight = useRef(false);
  const prevActive = useRef(active);
  const origin = useRef({ x: 0, y: 0 });

  // A layout effect, so the frame that would paint the new active dot is
  // replaced by the pill before anything reaches the screen.
  useLayoutEffect(() => {
    const prev = prevActive.current;
    prevActive.current = active;
    if (prev === active) return;
    const valid = (i: number) => i >= 0 && i < count;
    if (reducedMotion() || !valid(prev) || !valid(active)) {
      if (flight.current) {
        flight.current = false;
        L.stopAnimation();
        R.stopAnimation();
        setGliding(false);
      }
      return;
    }
    const from = activeDotSpan(prev, dotW, activeW, gap);
    const to = activeDotSpan(active, dotW, activeW, gap);
    if (flight.current) {
      // Mid-flight: carry on from wherever the edges are now.
      L.stopAnimation();
      R.stopAnimation();
    } else {
      L.setValue(from.x);
      R.setValue(from.x + from.w);
    }
    const springs = edgeSprings(to.x > from.x);
    flight.current = true;
    setGliding(true);
    Animated.parallel([
      Animated.spring(L, { toValue: to.x, ...springs.leftSpring, useNativeDriver: nativeDriver }),
      Animated.spring(R, { toValue: to.x + to.w, ...springs.rightSpring, useNativeDriver: nativeDriver }),
    ]).start(({ finished }) => {
      if (!finished) return; // superseded by a newer glide, which owns the state
      flight.current = false;
      setGliding(false);
    });
  }, [active, count, dotW, activeW, gap, L, R]);

  useEffect(() => () => {
    L.stopAnimation();
    R.stopAnimation();
  }, [L, R]);

  const transform = useMemo(
    () => [
      { translateX: Animated.subtract(Animated.multiply(Animated.add(L, R), 0.5), activeW / 2) },
      { scaleX: Animated.divide(Animated.subtract(R, L), activeW) },
    ],
    [L, R, activeW],
  );

  const onFirstLayout = (e: LayoutChangeEvent) => {
    origin.current = { x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y };
  };

  const flying = gliding && !reduce;
  const dots = [];
  for (let i = 0; i < count; i++) {
    dots.push(
      <View
        key={i}
        onLayout={i === 0 ? onFirstLayout : undefined}
        style={[dotStyle, i === active && activeStyle, flying && i === active && { backgroundColor: color }]}
      />,
    );
  }

  return (
    <View style={style} testID={testID}>
      {dots}
      {flying ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            left: origin.current.x,
            top: origin.current.y,
            width: activeW,
            height,
            borderRadius: height / 2,
            backgroundColor: activeColor,
            transform,
          }}
        />
      ) : null}
    </View>
  );
}
