// CountRoll — a counter that STEPS through real partial sums (pattern 3).
//
// Money is never tweened digit by digit. CountRoll shows the real running
// totals S1…Sn (integer cents, `steps`, the last one the total), one step per
// landed card, six at most (from the sixth on, the sixth step IS the total).
// Each step: the old figure leaves (translateY 0→−6, opacity 1→0, 90 ms
// ease-in) while the new one arrives (6→0, 0→1, 140 ms ease-out) — two stacked
// Text layers, text changing ≤ 6 times, never per frame. An invisible sizer
// holding the FINAL string reserves the width (tabular numbers): zero layout
// shift. The accessible value is the FINAL string at every step.
//
// Use TapeRollNumber for ONE total that changes; CountRoll when the parts
// arrive in front of the reader.
//
// At rest (never armed) it is a plain Text of the final figure. Reduce Motion
// (or a refused budget): the final figure at once.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { shownSteps, stepSchedule } from '@/utils/motion/kit/accumulate';
import { KIT_DIST, KIT_MS } from '@/utils/motion/kit/kitSpec';
import { planCountRoll } from '@/utils/motion/kit/plans';
import { kitWebStyle } from './css/kitCss';
import { acquire, release } from './budget';
import { useEntrance } from './useEntrance';

export type CountRollProps = {
  /** The real partial sums in integer cents; the last one is the total. */
  steps: readonly number[];
  format: (cents: number) => string;
  armed: boolean;
  /** When each shown step lands (ms from the arm); default k·70 + 110. */
  stepTimes?: readonly number[];
  style?: StyleProp<TextStyle>;
  testID?: string;
};

type Run = { shown: number[]; times: number[]; granted: boolean };

export function CountRoll({ steps, format, armed, stepTimes, style, testID }: CountRollProps) {
  const reduce = useReducedMotion();
  const final = steps.length ? format(steps[steps.length - 1]) : '';
  const run = useRef<Run | null>(null);
  const [k, setK] = useState(-1);

  if (armed && !run.current) {
    const shown = shownSteps(steps);
    const plan = planCountRoll(reduce, shown.length, stepTimes ?? stepSchedule(shown.length));
    const moving = plan.steps.filter((s) => s.target === 'value' && s.durationMs > 0);
    const times = moving.map((s) => s.delayMs);
    const total = (times[times.length - 1] ?? 0) + KIT_MS.rollIn;
    const granted = moving.length > 0 && acquire(1, total) > 0;
    run.current = { shown, times, granted };
  }

  useEffect(() => {
    const r = run.current;
    if (!r || !r.granted) return;
    const timers = r.times.map((t, i) => setTimeout(() => setK(i), t));
    const end = setTimeout(() => release(1), (r.times[r.times.length - 1] ?? 0) + KIT_MS.rollIn);
    return () => { timers.forEach(clearTimeout); clearTimeout(end); };
    // Armed once per mount: the schedule never restarts on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.current]);

  const r = run.current;
  if (!r || !r.granted) {
    return <Text testID={testID} style={style}>{final}</Text>;
  }
  const at = Math.min(k, r.shown.length - 1);
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={final}>
      <Text style={[style, styles.tabular, styles.sizer]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {final}
      </Text>
      {at > 0 ? <RollOut key={`out-${at}`} text={format(r.shown[at - 1])} style={style} /> : null}
      {at >= 0 ? <RollIn key={`in-${at}`} text={format(r.shown[at])} style={style} /> : null}
    </View>
  );
}

function RollIn({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const motion = useEntrance(true, { fadeMs: KIT_MS.rollIn, fromY: KIT_DIST.roll, web: 'rollIn6' }, { budget: false });
  return (
    <Animated.Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[style, styles.tabular, styles.layer, motion as StyleProp<TextStyle>]}>
      {text}
    </Animated.Text>
  );
}

function RollOut({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const web = Platform.OS === 'web';
  const v = useRef<Animated.Value | null>(web ? null : new Animated.Value(0)).current;
  useLayoutEffect(() => {
    if (!v) return;
    const a = Animated.timing(v, { toValue: 1, duration: KIT_MS.rollOut, easing: motionCurve.in, useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [v]);
  const motion: StyleProp<ViewStyle> = v
    ? ({
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }),
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -KIT_DIST.roll], extrapolate: 'clamp' }) }],
      } as unknown as ViewStyle)
    : [{ opacity: 0 }, kitWebStyle('rollOut6')];
  return (
    <Animated.Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[style, styles.tabular, styles.layer, motion as StyleProp<TextStyle>]}>
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  sizer: { opacity: 0 },
  layer: { position: 'absolute', left: 0, right: 0, top: 0 },
});

export default CountRoll;
