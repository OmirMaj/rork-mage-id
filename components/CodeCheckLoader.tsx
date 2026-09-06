// CodeCheckLoader — full-screen wait state for a code compliance check.
//
// WHAT IT REPLACES. A gavel icon spinning 360° over a pulsing circle in a small
// centred card, floating above the half-dimmed form. That is the generic
// AI-app loading pattern: it says "something is happening" without saying WHAT,
// and a rotating icon reads as filler.
//
// THE IDEA. A code check is literally a document review — MAGE reads your scope
// against the code that governs it. So the wait shows that: a drafting sheet
// (title block bottom-right, drafting convention) with a scan beam sweeping
// down it, leaving review marks in the margin as it passes each band. The five
// real steps sit below as a checklist that ticks off, so the GC can see how far
// through the pass they are — a progress ladder, not a mystery spinner.
//
// The sheet is drawn once in SVG and never animated; only three Animated.Views
// move (beam, marks, glow). Everything runs on the native driver — transform
// and opacity only, no animated SVG props — so it stays smooth while the AI
// request is in flight.
//
// Reanimated-free (RN Animated + react-native-svg), theme tokens only, no raw
// hex, no emoji. Same constraints as components/CraneLoader.tsx.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Svg, { G, Line, Rect, Path } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/** Where each review mark sits down the sheet, 0..1. The beam lights one as it
 *  crosses. Uneven on purpose — evenly spaced reads mechanical. */
const MARK_STOPS = [0.18, 0.33, 0.47, 0.62, 0.79];

interface Props {
  /** Small caps label above the headline. */
  eyebrow?: string;
  /** The one-line promise of what's being done. */
  headline?: string;
  /** The five (or however many) pass labels, in order. */
  steps: readonly string[];
  /** Index of the step currently running. */
  activeStep: number;
  /** Shown under the eyebrow — usually the address being checked. */
  subject?: string;
  /** Rotating one-liner beneath the checklist (construction facts). */
  facts?: readonly string[];
  factIntervalMs?: number;
  style?: ViewStyle;
}

export default function CodeCheckLoader({
  eyebrow = 'CODE CHECK',
  // AI-F3: the default headline must not imply a code lookup — the Code
  // Check recalls; nothing is read. (The permit roadmap passes its own.)
  headline = 'Recalling the code that likely governs this job',
  steps, activeStep, subject, facts, factIntervalMs = 4200, style,
}: Props) {
  const { colors: t } = useTheme();
  const { width, height } = useWindowDimensions();

  // Sheet is sized off the viewport so it genuinely fills the screen rather
  // than sitting in a 260pt card.
  const sheetW = Math.min(width - 72, 320);
  const sheetH = Math.min(Math.round(sheetW * 1.28), Math.round(height * 0.42));

  const scan = useRef(new Animated.Value(0)).current;
  const [factIdx, setFactIdx] = useState(0);
  const rotating = Array.isArray(facts) && facts.length > 0;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        // Brief hold at the bottom so the sheet reads as "reviewed" before the
        // next pass, instead of snapping back instantly.
        Animated.delay(420),
        Animated.timing(scan, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => { loop.stop(); scan.setValue(0); };
  }, [scan]);

  useEffect(() => {
    if (!rotating || facts!.length <= 1) return;
    const id = setInterval(
      () => setFactIdx(i => (i + 1) % facts!.length),
      Math.max(2000, factIntervalMs),
    );
    return () => clearInterval(id);
  }, [rotating, facts, factIntervalMs]);

  const beamY = scan.interpolate({ inputRange: [0, 1], outputRange: [0, sheetH] });
  // Beam fades in at the top and out at the bottom so it doesn't pop.
  const beamOpacity = scan.interpolate({
    inputRange: [0, 0.06, 0.92, 1],
    outputRange: [0, 1, 1, 0],
  });

  const marks = useMemo(
    () => MARK_STOPS.map(stop => ({
      stop,
      // Each mark fades in just as the beam reaches it, then stays lit.
      opacity: scan.interpolate({
        inputRange: [Math.max(0, stop - 0.04), stop, 1],
        outputRange: [0, 1, 1],
        extrapolate: 'clamp',
      }),
    })),
    [scan],
  );

  const line = t.line;
  const ink = t.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }, style]}>
      <View style={styles.head}>
        <Text style={[styles.eyebrow, { color: t.accentLabel }]}>{eyebrow}</Text>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>{headline}</Text>
        {subject ? (
          <Text style={[styles.subject, { color: t.textMuted }]} numberOfLines={1}>{subject}</Text>
        ) : null}
      </View>

      {/* ── the sheet ─────────────────────────────────────────────────── */}
      <View style={[styles.sheetWrap, { width: sheetW, height: sheetH }]}>
        <Svg width={sheetW} height={sheetH} viewBox={`0 0 ${sheetW} ${sheetH}`}>
          {/* page */}
          <Rect
            x={0.5} y={0.5} width={sheetW - 1} height={sheetH - 1}
            rx={3} fill={t.surface} stroke={line} strokeWidth={1}
          />
          {/* drafting border — a real sheet has an inset frame */}
          <Rect
            x={10} y={10} width={sheetW - 20} height={sheetH - 20}
            fill="none" stroke={line} strokeWidth={0.75}
          />

          {/* plan geometry: a simple footprint with an interior wall + door swing */}
          <G opacity={0.9}>
            <Rect
              x={28} y={30} width={sheetW - 120} height={sheetH * 0.3}
              fill="none" stroke={ink} strokeWidth={1.5}
            />
            <Line
              x1={28 + (sheetW - 120) * 0.55} y1={30}
              x2={28 + (sheetW - 120) * 0.55} y2={30 + sheetH * 0.3}
              stroke={ink} strokeWidth={1.5}
            />
            {/* door swing arc — the detail that makes it read as a plan */}
            <Path
              d={`M ${28 + (sheetW - 120) * 0.55} ${30 + sheetH * 0.3 - 26}
                  a 26 26 0 0 0 -26 26`}
              fill="none" stroke={ink} strokeWidth={1} opacity={0.75}
            />
            {/* dimension line under the footprint */}
            <Line x1={28} y1={30 + sheetH * 0.3 + 14} x2={sheetW - 92} y2={30 + sheetH * 0.3 + 14}
              stroke={ink} strokeWidth={0.75} opacity={0.6} />
            <Line x1={28} y1={30 + sheetH * 0.3 + 9} x2={28} y2={30 + sheetH * 0.3 + 19}
              stroke={ink} strokeWidth={0.75} opacity={0.6} />
            <Line x1={sheetW - 92} y1={30 + sheetH * 0.3 + 9} x2={sheetW - 92} y2={30 + sheetH * 0.3 + 19}
              stroke={ink} strokeWidth={0.75} opacity={0.6} />
          </G>

          {/* ruled note lines — the spec text being read */}
          <G opacity={0.45}>
            {Array.from({ length: 7 }).map((_, i) => (
              <Line
                key={i}
                x1={28}
                y1={30 + sheetH * 0.42 + i * 14}
                x2={i % 3 === 2 ? sheetW - 120 : sheetW - 78}
                y2={30 + sheetH * 0.42 + i * 14}
                stroke={ink}
                strokeWidth={1}
              />
            ))}
          </G>

          {/* title block, bottom-right — drafting convention */}
          <G>
            <Rect
              x={sheetW - 108} y={sheetH - 66} width={98} height={56}
              fill="none" stroke={line} strokeWidth={1}
            />
            <Line x1={sheetW - 108} y1={sheetH - 48} x2={sheetW - 10} y2={sheetH - 48}
              stroke={line} strokeWidth={0.75} />
            <Line x1={sheetW - 108} y1={sheetH - 30} x2={sheetW - 10} y2={sheetH - 30}
              stroke={line} strokeWidth={0.75} />
            <Line x1={sheetW - 62} y1={sheetH - 30} x2={sheetW - 62} y2={sheetH - 10}
              stroke={line} strokeWidth={0.75} />
          </G>
        </Svg>

        {/* review marks in the right margin — lit as the beam passes */}
        {marks.map((m, i) => (
          <Animated.View
            key={i}
            style={[
              styles.mark,
              {
                top: sheetH * m.stop - 7,
                borderColor: t.accent,
                backgroundColor: t.accentSoft,
                opacity: m.opacity,
              },
            ]}
          >
            <View style={[styles.markTick, { backgroundColor: t.accent }]} />
          </Animated.View>
        ))}

        {/* the scan beam */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.beamWrap,
            { width: sheetW, opacity: beamOpacity, transform: [{ translateY: beamY }] },
          ]}
        >
          <View style={[styles.beamGlow, { backgroundColor: t.accent }]} />
          <View style={[styles.beamLine, { backgroundColor: t.accent }]} />
        </Animated.View>
      </View>

      {/* ── the pass, as a checklist ──────────────────────────────────── */}
      <View style={styles.steps}>
        {steps.map((s, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <View key={i} style={styles.stepRow}>
              <View
                style={[
                  styles.stepDot,
                  { borderColor: done || active ? t.accent : t.line },
                  done && { backgroundColor: t.accent },
                  active && { backgroundColor: t.accentSoft },
                ]}
              />
              <Text
                style={[
                  styles.stepText,
                  { color: done ? t.textMuted : active ? t.text : t.textMuted },
                  active && styles.stepTextActive,
                ]}
                numberOfLines={1}
              >
                {s}
              </Text>
            </View>
          );
        })}
      </View>

      {rotating ? (
        <View style={styles.factWrap}>
          <Text style={[styles.factLabel, { color: t.textMuted }]}>WHILE YOU WAIT</Text>
          <Text style={[styles.factText, { color: t.textSecondary }]}>{facts![factIdx]}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },

  head: { alignItems: 'center', marginBottom: 26 },
  eyebrow: { ...Type.monoCaption, letterSpacing: 1.6 },
  title: {
    ...Type.serifTitle,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300,
  },
  subject: { fontSize: Type.footnote.fontSize, marginTop: 8, maxWidth: 300, textAlign: 'center' },

  sheetWrap: { position: 'relative', overflow: 'hidden', borderRadius: Tokens.radius.sm },

  beamWrap: { position: 'absolute', left: 0, top: 0, height: 24, justifyContent: 'flex-end' },
  beamGlow: { height: 22, width: '100%', opacity: 0.16 },
  beamLine: { height: 1.5, width: '100%' },

  mark: {
    position: 'absolute',
    right: 8,
    width: 14, height: 14, borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  markTick: { width: 6, height: 6, borderRadius: 1.5 },

  steps: { marginTop: 28, alignSelf: 'stretch', maxWidth: 340, gap: 9 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  stepText: { flex: 1, fontSize: Type.footnote.fontSize },
  stepTextActive: { fontWeight: '600' },

  factWrap: { marginTop: 30, alignItems: 'center', maxWidth: 320 },
  factLabel: { ...Type.monoCaption, letterSpacing: 1.2, marginBottom: 6 },
  factText: { fontSize: Type.footnote.fontSize, lineHeight: 19, textAlign: 'center' },
});
