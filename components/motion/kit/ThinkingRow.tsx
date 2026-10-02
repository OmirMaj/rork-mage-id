// ThinkingRow (+ ThinkingDots) — the calm "thinking" row of the Chat Message Stack.
//
// - visible → a 140 ms MOUNT gate: an answer that lands inside 140 ms never
//   mounts the row at all (no flash).
// - mounted: opacity 0→1 over 160 ms + translateY 6→0, eased out. Layout is
//   [leading][dots][label] in a row, NOT inside a bubble; the host passes the
//   leading mark and the text / dot styles — the kit holds no colour.
// - 10 s after visible turned true the label cross-fades (160 ms) to
//   `stillLabel`. Nothing else is ever claimed: no %, no steps, no countdown.
// - visible → false: the row records its y while mounted and leaves as an
//   ABSOLUTE overlay at that y, fading out over 120 ms (ease-in), so the answer
//   can take the slot in the same commit with no layout jump. Hosts render
//   ThinkingRow as a direct child of the View that holds the turns.
//
// THE DOTS run on ONE shared, ref-counted linear clock (levelClock.ts's shape):
// one Animated.loop around ONE linear Animated.timing, isInteraction false,
// native driver. Each dot's pulse is pre-sampled into 25-point output ranges
// with its phase baked in, so the dots never freeze while the JS thread parses
// a long answer (a looped Animated.sequence restarts through JS every cycle).
// Web: the dotPulse keyframe at 0 / 160 / 320 ms (the compositor runs it).
//
// Reduce Motion: no clock; dots static at 0.6; entrance and exit are 100 ms
// fades; the 10 s label switch still happens.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, StyleSheet, View,
  type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import LevelMark from '@/components/loaders/LevelMark';
import { CHAT_STACK, dotRanges } from '@/utils/motion/kit/chatStack';
import { planThinkingRow, stepFor } from '@/utils/motion/kit/plans';
import { kitFadeOut, kitTravel, kitWebStyle } from './css/kitCss';
import { useEntrance } from './useEntrance';

const DOT = CHAT_STACK.thinking.dot;

// ── the shared dot clock ─────────────────────────────────────────────────────

const dotValue = new Animated.Value(0);
let dotLoop: Animated.CompositeAnimation | null = null;
let dotSubscribers = 0;
let dotStarts = 0;
let dotStops = 0;

function acquireDotClock(): void {
  dotSubscribers += 1;
  if (dotSubscribers !== 1) return;
  dotStarts += 1;
  dotValue.setValue(0);
  dotLoop = Animated.loop(Animated.timing(dotValue, {
    toValue: 1,
    duration: DOT.periodMs,
    easing: Easing.linear,
    isInteraction: false,
    useNativeDriver: nativeDriver,
  }));
  dotLoop.start();
}

function releaseDotClock(): void {
  if (dotSubscribers === 0) return;
  dotSubscribers -= 1;
  if (dotSubscribers !== 0) return;
  dotStops += 1;
  dotLoop?.stop();
  dotLoop = null;
}

/** The shared dot clock while `active` (native only; the web runs CSS). */
export function useDotClock(active: boolean): Animated.Value | null {
  const on = active && Platform.OS !== 'web';
  useEffect(() => {
    if (!on) return;
    acquireDotClock();
    return () => releaseDotClock();
  }, [on]);
  return on ? dotValue : null;
}

/** Tests / diagnostics: subscribers and start / stop tallies of the dot clock. */
export function dotClockStats(): { count: number; starts: number; stops: number } {
  return { count: dotSubscribers, starts: dotStarts, stops: dotStops };
}

// ── the dots ─────────────────────────────────────────────────────────────────

export type ThinkingDotsProps = { dotStyle?: StyleProp<ViewStyle>; testID?: string };

export function ThinkingDots({ dotStyle, testID }: ThinkingDotsProps) {
  const reduce = useReducedMotion();
  const clock = useDotClock(!reduce);
  const web = Platform.OS === 'web';
  return (
    <View testID={testID} style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: DOT.count }, (_, i) => {
        let motion: StyleProp<ViewStyle> = { opacity: DOT.reducedOpacity };
        if (!reduce && web) {
          motion = [{ opacity: DOT.low, transform: [{ scale: DOT.scaleLow }] }, kitWebStyle('dotPulse', i * DOT.staggerMs)];
        } else if (clock) {
          const r = dotRanges(i);
          motion = {
            opacity: clock.interpolate({ ...r.opacity, extrapolate: 'clamp' }),
            transform: [{ scale: clock.interpolate({ ...r.scale, extrapolate: 'clamp' }) }],
          } as unknown as ViewStyle;
        }
        return <Animated.View key={i} style={[styles.dot, dotStyle, motion]} />;
      })}
    </View>
  );
}

// ── the row ──────────────────────────────────────────────────────────────────

export type ThinkingRowProps = {
  visible: boolean;
  label: string;
  stillLabel: string;
  a11yLabel: string;
  leading?: React.ReactNode;
  mark?: 'dots' | 'level';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  dotStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

type Phase = 'hidden' | 'shown' | 'leaving';

export function ThinkingRow(props: ThinkingRowProps) {
  const reduce = useReducedMotion();
  const plan = planThinkingRow(reduce);
  const gateMs = stepFor(plan, 'row')?.delayMs ?? CHAT_STACK.thinking.delayMs;
  const stillMs = stepFor(plan, 'label')?.delayMs ?? CHAT_STACK.thinking.stillWorkingAfterMs;
  const [phase, setPhase] = useState<Phase>('hidden');
  const [still, setStill] = useState(false);
  const [gen, setGen] = useState(0);
  const y = useRef(0);

  useEffect(() => {
    if (!props.visible) {
      setPhase((p) => (p === 'shown' ? 'leaving' : p === 'leaving' ? 'leaving' : 'hidden'));
      return;
    }
    setStill(false);
    const gate = setTimeout(() => { setGen((g) => g + 1); setPhase('shown'); }, gateMs);
    const later = setTimeout(() => setStill(true), stillMs);
    return () => { clearTimeout(gate); clearTimeout(later); };
  }, [props.visible, gateMs, stillMs]);

  if (phase === 'hidden') return null;
  return (
    <ThinkingBody
      key={gen}
      {...props}
      reduce={reduce}
      still={still}
      leaving={phase === 'leaving'}
      y={y}
      onGone={() => setPhase((p) => (p === 'leaving' ? 'hidden' : p))}
    />
  );
}

type BodyProps = ThinkingRowProps & {
  reduce: boolean;
  still: boolean;
  leaving: boolean;
  y: React.MutableRefObject<number>;
  onGone: () => void;
};

function ThinkingBody({ label, stillLabel, a11yLabel, leading, mark = 'dots', style, textStyle, dotStyle, testID, reduce, still, leaving, y, onGone }: BodyProps) {
  const plan = planThinkingRow(reduce);
  const row = stepFor(plan, 'row');
  const exit = stepFor(plan, 'row-exit');
  const enterMs = row?.durationMs ?? CHAT_STACK.thinking.fadeMs;
  const fromY = row?.from.translateY ?? 0;
  const exitMs = exit?.durationMs ?? CHAT_STACK.thinkingOut.fadeMs;
  const web = Platform.OS === 'web';
  const enter = useEntrance(true, {
    fadeMs: enterMs,
    fromY,
    webStyle: kitTravel(0, CHAT_STACK.thinking.fromY, CHAT_STACK.thinking.fadeMs, 0, { opacity: 0 }),
    webMs: CHAT_STACK.thinking.fadeMs,
  });

  const out = useRef<Animated.Value | null>(null);
  if (leaving && !out.current && !web) out.current = new Animated.Value(1);
  const gone = useRef(onGone);
  gone.current = onGone;
  useLayoutEffect(() => {
    if (!leaving) return;
    if (web) {
      const t = setTimeout(() => gone.current(), exitMs);
      return () => clearTimeout(t);
    }
    const v = out.current;
    if (!v) { gone.current(); return; }
    const a = Animated.timing(v, { toValue: 0, duration: exitMs, easing: motionCurve.in, useNativeDriver: nativeDriver });
    a.start(({ finished }) => { if (finished) gone.current(); });
    return () => a.stop();
  }, [leaving, web, exitMs]);

  const onLayout = (e: LayoutChangeEvent) => {
    if (!leaving) y.current = e.nativeEvent.layout.y;
  };

  let motion: StyleProp<ViewStyle> = enter;
  if (leaving) {
    const overlay: ViewStyle = { position: 'absolute', top: y.current, left: 0, right: 0 };
    motion = web
      ? [overlay, { opacity: 0 }, reduce ? null : kitFadeOut(exitMs)]
      : [overlay, { opacity: out.current ?? 0 } as unknown as ViewStyle];
  }

  return (
    <Animated.View
      testID={testID}
      onLayout={onLayout}
      pointerEvents={leaving ? 'none' : 'auto'}
      accessible
      accessibilityLabel={a11yLabel}
      accessibilityLiveRegion="polite"
      style={[styles.row, style, motion]}
    >
      {leading}
      {mark === 'level' ? <LevelMark size={20} animate={!reduce} /> : <ThinkingDots dotStyle={dotStyle} />}
      <View style={styles.labels}>
        {still ? (
          <>
            <LabelLayer key="still" text={stillLabel} textStyle={textStyle} reduce={reduce} />
            <LabelLeaving text={label} textStyle={textStyle} reduce={reduce} />
          </>
        ) : (
          <Animated.Text style={textStyle} numberOfLines={2}>{label}</Animated.Text>
        )}
      </View>
    </Animated.View>
  );
}

/** The arriving label: fades in over 160 ms (100 reduced). */
function LabelLayer({ text, textStyle, reduce }: { text: string; textStyle?: StyleProp<TextStyle>; reduce: boolean }) {
  const s = stepFor(planThinkingRow(reduce), 'label');
  const motion = useEntrance(true, { fadeMs: s?.durationMs ?? CHAT_STACK.thinking.fadeMs, web: 'fade' }, { budget: false });
  return <Animated.Text style={[textStyle, motion as StyleProp<TextStyle>]} numberOfLines={2}>{text}</Animated.Text>;
}

/** The leaving label: an overlay fading out over the same time, then left at 0. */
function LabelLeaving({ text, textStyle, reduce }: { text: string; textStyle?: StyleProp<TextStyle>; reduce: boolean }) {
  const s = stepFor(planThinkingRow(reduce), 'label');
  const ms = s?.durationMs ?? CHAT_STACK.thinking.fadeMs;
  const web = Platform.OS === 'web';
  const v = useRef<Animated.Value | null>(web ? null : new Animated.Value(1)).current;
  useLayoutEffect(() => {
    if (!v) return;
    const a = Animated.timing(v, { toValue: 0, duration: ms, easing: motionCurve.in, useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [v, ms]);
  const motion: StyleProp<TextStyle> = web
    ? [{ opacity: 0 }, reduce ? null : (kitFadeOut(ms) as unknown as TextStyle)]
    : ({ opacity: v } as unknown as TextStyle);
  return (
    <Animated.Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      numberOfLines={1}
      style={[textStyle, styles.leavingLabel, motion]}
    >
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: DOT.gap },
  dot: { width: DOT.size, height: DOT.size, borderRadius: DOT.size / 2 },
  labels: { flexShrink: 1 },
  leavingLabel: { position: 'absolute', left: 0, top: 0 },
});

export default ThinkingRow;
