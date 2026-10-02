// components/brain/ask/AskThinking.tsx — the "thinking" row under your question
// (lane AILOOK), like the Claude app: the MAGE mark, three quiet dots, and what
// is actually happening ("Reading your records"). Not a bubble.
//
// HONESTY. It says what it is doing and nothing it cannot know: no progress
// bar, no percentage, no steps, no countdown. After 10 s the words become
// "Still working on it" and that is all.
//
// TIMING (./askMotion.ts):
//   - a 140 ms MOUNT gate: an answer that lands sooner never renders the row
//     (nothing flashes);
//   - in: opacity 0 -> 1 over 160 ms, 6 pt rise, eased out;
//   - out: when the answer lands the row records where it was, lifts out of the
//     layout (absolute, at that spot) and fades over 120 ms, so the answer that
//     arrives in the same commit takes the slot with no jump. Render this as a
//     DIRECT child of the View that holds the turns.
//   - the dots: ONE shared linear clock (Animated.loop around a single linear
//     Animated.timing, isInteraction false, native driver), each dot's pulse
//     and phase baked into its interpolation's output (dotRanges). A looped
//     SEQUENCE would restart through JS every cycle and freeze while the JS
//     thread parses the answer; this one keeps running natively.
// Reduce Motion: no clock, the dots sit still at 0.6; in and out are a 100 ms
// fade with no travel; the 10 s wording change still happens.

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { nativeDriver, motionCurve, useReducedMotion } from '@/components/ui/motion';
import { ASK_MOTION, dotRanges } from './askMotion';

export interface AskThinkingProps {
  visible: boolean;
  label: string;
  stillLabel: string;
  a11yLabel: string;
}

const DOT = ASK_MOTION.thinking.dot;

// ── The dots' shared clock (ref-counted: first dot row starts it, last stops) ──

const dotClock = (() => {
  const value = new Animated.Value(0);
  let loop: Animated.CompositeAnimation | null = null;
  let subscribers = 0;
  return {
    value,
    acquire(): void {
      subscribers += 1;
      if (subscribers !== 1) return;
      value.setValue(0);
      loop = Animated.loop(Animated.timing(value, {
        toValue: 1,
        duration: DOT.periodMs,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: nativeDriver,
      }));
      loop.start();
    },
    release(): void {
      if (subscribers === 0) return;
      subscribers -= 1;
      if (subscribers !== 0) return;
      loop?.stop();
      loop = null;
    },
  };
})();

/** Each dot's interpolations, built once (pure numbers). */
const DOT_RANGES = Array.from({ length: DOT.count }, (_, i) => dotRanges(i));

function Dots({ reduced, color }: { reduced: boolean; color: string }) {
  const styles = useThemedStyles(makeStyles);
  useEffect(() => {
    if (reduced) return undefined;
    dotClock.acquire();
    return () => dotClock.release();
  }, [reduced]);
  return (
    <View style={styles.dots}>
      {DOT_RANGES.map((r, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: color },
            reduced
              ? { opacity: DOT.reducedOpacity }
              : {
                opacity: dotClock.value.interpolate({ ...r.opacity, extrapolate: 'clamp' }),
                transform: [{ scale: dotClock.value.interpolate({ ...r.scale, extrapolate: 'clamp' }) }],
              },
          ]}
        />
      ))}
    </View>
  );
}

type Phase = 'off' | 'in' | 'out';
interface Frame { x: number; y: number; width: number }

export function AskThinking({ visible, label, stillLabel, a11yLabel }: AskThinkingProps): React.JSX.Element | null {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('off');
  const [still, setStill] = useState(false);
  const phaseRef = useRef<Phase>('off');
  phaseRef.current = phase;
  const frame = useRef<Frame | null>(null);
  const [outFrame, setOutFrame] = useState<Frame | null>(null);
  const shown = useRef(new Animated.Value(0)).current;
  const swap = useRef(new Animated.Value(1)).current;
  const a11yRef = useRef(a11yLabel);
  a11yRef.current = a11yLabel;
  // Read when a phase starts; a flip mid-fade does not restart it.
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // visible -> the 140 ms gate, then in; the 10 s wording change.
  // not visible -> out (if it ever came in).
  useEffect(() => {
    if (visible) {
      if (phaseRef.current === 'out') { shown.stopAnimation(); setPhase('off'); }
      setStill(false);
      const gate = setTimeout(() => setPhase('in'), ASK_MOTION.thinking.delayMs);
      const later = setTimeout(() => setStill(true), ASK_MOTION.thinking.stillWorkingAfterMs);
      return () => { clearTimeout(gate); clearTimeout(later); };
    }
    if (phaseRef.current === 'in') {
      setOutFrame(frame.current);
      setPhase('out');
    }
    return undefined;
  }, [visible, shown]);

  // The entrance, and the one VoiceOver announcement per question.
  useEffect(() => {
    const rm = reducedRef.current;
    if (phase === 'in') {
      shown.setValue(0);
      const anim = Animated.timing(shown, {
        toValue: 1,
        duration: rm ? ASK_MOTION.reduced.fadeMs : ASK_MOTION.thinking.fadeMs,
        easing: motionCurve.out,
        useNativeDriver: nativeDriver,
      });
      anim.start();
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility?.(a11yRef.current);
      return () => anim.stop();
    }
    if (phase === 'out') {
      const ms = rm ? ASK_MOTION.reduced.fadeMs : ASK_MOTION.thinkingOut.fadeMs;
      const anim = Animated.timing(shown, { toValue: 0, duration: ms, easing: motionCurve.in, useNativeDriver: nativeDriver });
      anim.start();
      // The unmount runs on a timer of the same length, not on the animation's
      // callback, so it happens even where an animation never reports back.
      const done = setTimeout(() => { setPhase('off'); setStill(false); setOutFrame(null); }, ms);
      return () => { anim.stop(); clearTimeout(done); };
    }
    return undefined;
  }, [phase, shown]);

  // "Still working on it": a cross-fade of the words (opacity only).
  useEffect(() => {
    if (!still) return undefined;
    swap.setValue(0);
    const anim = Animated.timing(swap, {
      toValue: 1,
      duration: reducedRef.current ? ASK_MOTION.reduced.fadeMs : ASK_MOTION.thinking.fadeMs,
      easing: motionCurve.inOut,
      useNativeDriver: nativeDriver,
    });
    anim.start();
    return () => anim.stop();
  }, [still, swap]);

  if (phase === 'off') return null;

  const onLayout = (e: LayoutChangeEvent) => {
    if (phaseRef.current !== 'in') return;
    const { x, y, width } = e.nativeEvent.layout;
    frame.current = { x, y, width };
  };

  const enterStyle = reduced
    ? { opacity: shown }
    : { opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [ASK_MOTION.thinking.fromY, 0], extrapolate: 'clamp' }) }] };
  const leaving = phase === 'out' && outFrame
    ? { position: 'absolute' as const, left: outFrame.x, top: outFrame.y, width: outFrame.width }
    : null;

  return (
    <Animated.View
      style={[styles.row, leaving, enterStyle]}
      pointerEvents={phase === 'out' ? 'none' : 'auto'}
      onLayout={onLayout}
      accessible
      accessibilityLabel={a11yLabel}
      accessibilityLiveRegion="polite"
      testID="ask-thinking"
    >
      <MageAIMark size={16} color={t.accent} accentColor={t.accent} />
      <Dots reduced={reduced} color={t.textMuted} />
      <View>
        <Animated.Text style={[styles.label, still ? { opacity: swap } : null]}>
          {still ? stillLabel : label}
        </Animated.Text>
        {still && (
          <Animated.Text
            style={[styles.label, styles.labelOut, { opacity: swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' }) }]}
            importantForAccessibility="no"
          >
            {label}
          </Animated.Text>
        )}
      </View>
    </Animated.View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, minHeight: 20 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: DOT.gap },
  dot: { width: DOT.size, height: DOT.size, borderRadius: DOT.size / 2 },
  label: { ...Type.footnote, color: t.textSecondary },
  labelOut: { position: 'absolute', left: 0, top: 0 },
});
