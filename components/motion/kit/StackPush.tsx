// StackPush — Chapter to Stacked Detail (pattern 4).
//
// A chapter card (a numeral, a title) cross-fades (160 ms) into a stack of
// detail cards. Depth k sits 8·k pt up, 0.04·k smaller and 0.2·k fainter, k ≤ 2:
// three layers are rendered, never more. Advance: the front card leaves
// (translateX 0 → −24 + opacity 1 → 0 over 160 ms, ease-in) and every card
// behind steps forward one depth on rise. Back: the reverse — the previous card
// comes in from the left and the others recede.
//
// The stack's size is fixed: the front card is in flow and sizes the container
// (the host sizes the card); the cards behind are absolute layers of the same
// box — no reflow per step. They are decoration: hidden from accessibility and
// touches. Scale only ever applies to a card (≤ 720 pt), never a screen.
//
// Reduce Motion: one flat card, a 100 ms swap-fade; the host shows "2 of 5".
// Web: pose keyframes (compositor CSS), the element's own style is the end pose.

import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { KIT_CAPS, KIT_SPRING } from '@/utils/motion/kit/kitSpec';
import { webMsFor } from '@/utils/motion/kit/springMath';
import { depthPose, planStackPush, stepFor, type Pose } from '@/utils/motion/kit/plans';
import { kitPose, type KitPose } from './css/kitCss';

export type StackPushProps = {
  /** The front card; −1 shows the chapter card. */
  index: number;
  count: number;
  renderCard: (i: number) => React.ReactNode;
  chapter?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const toKit = (p: Pose): KitPose => ({ opacity: p.opacity, x: p.translateX, y: p.translateY, scale: p.scale });

/** A static pose as an RN style (no transform at all at rest). */
function staticPose(p: Pose): ViewStyle | null {
  const t: Record<string, number>[] = [];
  if (p.translateX) t.push({ translateX: p.translateX });
  if (p.translateY) t.push({ translateY: p.translateY });
  if (p.scale !== 1) t.push({ scale: p.scale });
  if (p.opacity === 1 && t.length === 0) return null;
  return { opacity: p.opacity, ...(t.length ? { transform: t } : null) } as ViewStyle;
}

/** An animated pose between two poses on a 0→1 value (clamped, no easing). */
function animatedPose(v: Animated.Value, a: Pose, b: Pose): ViewStyle {
  const i = (x: number, y: number) => v.interpolate({ inputRange: [0, 1], outputRange: [x, y], extrapolate: 'clamp' });
  return {
    opacity: i(a.opacity, b.opacity),
    transform: [{ translateX: i(a.translateX, b.translateX) }, { translateY: i(a.translateY, b.translateY) }, { scale: i(a.scale, b.scale) }],
  } as unknown as ViewStyle;
}

type Dir = 0 | 1 | -1;

export function StackPush({ index, count, renderCard, chapter, style, testID }: StackPushProps) {
  const prev = useRef(index);
  const change = useRef<{ dir: Dir; from: number; gen: number }>({ dir: 0, from: index, gen: 0 });
  if (prev.current !== index) {
    change.current = { dir: index > prev.current ? 1 : -1, from: prev.current, gen: change.current.gen + 1 };
    prev.current = index;
  }
  return (
    <View testID={testID} style={style}>
      <StackFrame
        key={change.current.gen}
        index={index}
        count={count}
        dir={change.current.dir}
        from={change.current.from}
        renderCard={renderCard}
        chapter={chapter}
      />
    </View>
  );
}

function StackFrame({ index, count, dir, from, renderCard, chapter }: {
  index: number; count: number; dir: Dir; from: number; renderCard: (i: number) => React.ReactNode; chapter?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const web = Platform.OS === 'web';
  const plan = planStackPush(reduce, dir === -1 ? -1 : 1);
  const v = useRef(new Animated.Value(0)).current;
  const q = useRef(new Animated.Value(0)).current;
  const live = useRef(dir !== 0).current;
  const fromChapter = from < 0 || index < 0;

  useLayoutEffect(() => {
    if (!live || web) return;
    const leaving = stepFor(plan, 'leaving');
    const fade = Animated.timing(q, { toValue: 1, duration: leaving?.durationMs || 160, easing: motionCurve.in, useNativeDriver: nativeDriver });
    const move = reduce || fromChapter
      ? Animated.timing(v, { toValue: 1, duration: stepFor(plan, 'front')?.durationMs || 160, easing: motionCurve.out, useNativeDriver: nativeDriver })
      : Animated.spring(v, { toValue: 1, ...KIT_SPRING.rise, useNativeDriver: nativeDriver });
    const a = Animated.parallel([fade, move]);
    a.start();
    return () => a.stop();
    // Once per frame (the frame is keyed by the change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = (i: number) => (i < 0 ? chapter ?? null : renderCard(i));
  const layers = reduce || index < 0 ? 1 : Math.min(KIT_CAPS.stackLayers, Math.max(1, count - index));
  const riseMs = webMsFor('rise');

  // The pose each layer moves FROM, for this change.
  const fromPose = (k: number): Pose => {
    if (!live) return depthPose(k);
    if (reduce || fromChapter) return { ...depthPose(k), opacity: 0 };
    if (dir === 1) return k === 2 ? { ...depthPose(2), opacity: 0 } : depthPose(k + 1);
    return k === 0 ? { ...depthPose(0), opacity: 0, translateX: -24 } : depthPose(k - 1);
  };
  const layerStyle = (k: number): StyleProp<ViewStyle> => {
    const to = reduce ? depthPose(0) : depthPose(k);
    const f = fromPose(k);
    const still = staticPose(to);
    if (!live) return still;
    if (web) return reduce ? still : [still, kitPose(toKit(f), toKit(to), fromChapter ? 160 : riseMs)];
    return animatedPose(v, f, to);
  };

  const leavingIndex = live && (dir === 1 || reduce || fromChapter) ? from : null;
  const leavingTo: Pose = reduce || fromChapter ? { ...depthPose(0), opacity: 0 } : { ...depthPose(0), opacity: 0, translateX: -24 };
  const leavingStyle: StyleProp<ViewStyle> = web
    ? [staticPose(leavingTo), reduce ? null : kitPose(toKit(depthPose(0)), toKit(leavingTo), 160, 'in')]
    : animatedPose(q, depthPose(0), leavingTo);

  const behind = Array.from({ length: layers - 1 }, (_, j) => layers - 1 - j); // 2, 1
  return (
    <View>
      {behind.map((k) => (
        <Animated.View
          key={`d${k}`}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, layerStyle(k)]}
        >
          {card(index + k)}
        </Animated.View>
      ))}
      <Animated.View style={layerStyle(0)}>{card(index)}</Animated.View>
      {leavingIndex != null ? (
        <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, leavingStyle]}>
          {card(leavingIndex)}
        </Animated.View>
      ) : null}
    </View>
  );
}

export default StackPush;
