// CodeCheckLoader — full-screen wait state for a code compliance check.
//
// THE IDEA. A code check is a document review — MAGE recalls the code that
// likely governs your scope. So the wait shows the output's shape: a drafting
// sheet (title block bottom-right, drafting convention) with a laser line
// sweeping down it, and review marks in the margin that light as it crosses
// each band and then fade.
//
// HONESTY. The screen used to tick its checklist off on 1700 ms timers
// (app/(tabs)/construction-ai passes a timer-driven `activeStep`). That was
// made-up progress. Now the list only claims progress from a REAL `stepIndex`;
// without one it is a plain "What we check" list with no ticks and no current
// row. `activeStep` stays in the props type so the caller still compiles, and
// is never read. Under the headline: the real elapsed time and the typical
// range ("0:07 · usually 5–20 s").
//
// MOTION. Native: ONE linear Animated.loop over 3000 ms on the native driver;
// the laser's eased sweep and the marks' decay are pre-sampled ranges from
// components/loaders/progressMath.ts (the native interpolation allowlist has no
// easing). The laser is invisible at the wrap, so its jump back to the top is
// never seen. Web: no Animated at all — on react-native-web that loop is a JS
// rAF loop that freezes while the screen is busy — the same ranges run as CSS
// keyframes (components/loaders/css/codeCheckCss.ts). Reduce Motion: a static
// sheet, no laser, no marks. Transform and opacity only; theme tokens only.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Svg, { G, Line, Rect, Path } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { ProgressStepRow, type ProgressStepState } from '@/components/loaders/WorkProgress';
import {
  CODE_CHECK_LASER_OPACITY, CODE_CHECK_SWEEP_MS, MARK_STOPS,
  codeCheckLaserOpacity, codeCheckLaserY, codeCheckMarkOpacity, elapsedLine,
} from '@/components/loaders/progressMath';
import { codeCheckLaserStyle, codeCheckMarkStyle } from '@/components/loaders/css/codeCheckCss';
import type { ThemeColors } from '@/constants/colors';

interface Props {
  /** Small caps label above the headline. */
  eyebrow?: string;
  /** The one-line promise of what's being done. */
  headline?: string;
  /** The pass labels, in order. */
  steps: readonly string[];
  /**
   * DEPRECATED, NEVER READ. The caller drives it from a 1700 ms timer, so it
   * is not a real step; honouring it would tick the list off on a clock. Kept
   * only so existing callers compile. Pass `stepIndex` for real progress.
   */
  activeStep?: number;
  /** The index of the step REALLY running. Absent → a neutral "What we check" list. */
  stepIndex?: number;
  /** The typical duration, shown after the elapsed time. */
  typical?: string;
  /** Shown under the eyebrow — usually the address being checked. */
  subject?: string;
  /** Rotating one-liner beneath the checklist (construction facts — not progress). */
  facts?: readonly string[];
  factIntervalMs?: number;
  style?: ViewStyle;
}

export default function CodeCheckLoader({
  eyebrow = 'Code check',
  // AI-F3: the default headline must not imply a code lookup — the Code
  // Check recalls; nothing is read. (The permit roadmap passes its own.)
  headline = 'Recalling the code that likely governs this project',
  steps, stepIndex, typical = 'usually 5–20 s', subject, facts, factIntervalMs = 4200, style,
}: Props) {
  const { colors: t } = useTheme();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();

  // Sheet is sized off the viewport so it genuinely fills the screen rather
  // than sitting in a 260pt card.
  // (Clamped at 0: a not-yet-measured 0 × 0 window must not produce a negative sheet.)
  const sheetW = Math.max(0, Math.min(width - 72, 320));
  const sheetH = Math.max(0, Math.min(Math.round(sheetW * 1.28), Math.round(height * 0.42)));

  // Elapsed from mount: a text update, not motion.
  const mountedAt = useRef(Date.now()).current;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [factIdx, setFactIdx] = useState(0);
  const rotating = Array.isArray(facts) && facts.length > 0;
  useEffect(() => {
    if (!rotating || facts!.length <= 1) return;
    const id = setInterval(
      () => setFactIdx(i => (i + 1) % facts!.length),
      Math.max(2000, factIntervalMs),
    );
    return () => clearInterval(id);
  }, [rotating, facts, factIntervalMs]);

  const real = typeof stepIndex === 'number' && Number.isFinite(stepIndex);
  const stateOf = (i: number): ProgressStepState => {
    if (!real) return 'neutral';
    if (i < stepIndex!) return 'done';
    return i === stepIndex ? 'current' : 'next';
  };

  const line = t.line;
  const ink = t.textMuted;
  // Read at render (never module scope): the golden harness flips Platform.OS.
  const web = Platform.OS === 'web';

  return (
    <View style={[styles.root, { backgroundColor: t.bg }, style]} testID="code-check-loader">
      <View style={styles.head}>
        <Text style={[styles.eyebrow, { color: t.accentLabel }]}>{eyebrow}</Text>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={2} accessibilityLiveRegion="polite">{headline}</Text>
        {subject ? (
          <Text style={[styles.subject, { color: t.textMuted }]} numberOfLines={1}>{subject}</Text>
        ) : null}
        <Text style={[Type.footnote, styles.elapsed, { color: t.textSecondary }]} testID="code-check-elapsed">
          {elapsedLine(now - mountedAt, typical)}
        </Text>
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

        {/* Reduce Motion: the static sheet only. */}
        {reduce ? null : web
          ? <SheetMotionWeb sheetW={sheetW} sheetH={sheetH} colors={t} />
          : <SheetMotionNative sheetW={sheetW} sheetH={sheetH} colors={t} />}
      </View>

      {/* ── the pass, as a list — progress only from a REAL stepIndex ──── */}
      <View style={styles.steps}>
        {real ? null : (
          <Text style={[Type.footnoteEmphasized, styles.stepsHeader, { color: t.textSecondary }]} testID="code-check-steps-header">
            What MAGE Checks
          </Text>
        )}
        {steps.map((s, i) => (
          <ProgressStepRow key={i} label={s} state={stateOf(i)} colors={t} />
        ))}
      </View>

      {rotating ? (
        <View style={styles.factWrap}>
          <Text style={[styles.factLabel, { color: t.textMuted }]}>While You Wait</Text>
          <Text style={[styles.factText, { color: t.textSecondary }]}>{facts![factIdx]}</Text>
        </View>
      ) : null}
    </View>
  );
}

interface MotionProps { sheetW: number; sheetH: number; colors: ThemeColors }

/** iOS / Android: ONE linear native loop; every curve is a pre-sampled range. */
function SheetMotionNative({ sheetW, sheetH, colors }: MotionProps) {
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(scan, {
        toValue: 1,
        duration: CODE_CHECK_SWEEP_MS,
        easing: Easing.linear,
        useNativeDriver: nativeDriver,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [scan]);

  const laserY = useMemo(() => scan.interpolate(codeCheckLaserY(sheetH)), [scan, sheetH]);
  const laserOpacity = useMemo(() => scan.interpolate(codeCheckLaserOpacity), [scan]);
  const marks = useMemo(
    () => MARK_STOPS.map(stop => scan.interpolate({ ...codeCheckMarkOpacity(stop), extrapolate: 'clamp' })),
    [scan],
  );

  return (
    <>
      {MARK_STOPS.map((stop, i) => (
        <Animated.View
          key={i}
          testID={`code-check-mark-${i}`}
          style={[
            styles.mark,
            { top: sheetH * stop - 7, borderColor: colors.accent, backgroundColor: colors.accentSoft, opacity: marks[i] },
          ]}
        >
          <View style={[styles.markTick, { backgroundColor: colors.accent }]} />
        </Animated.View>
      ))}
      <Animated.View
        pointerEvents="none"
        testID="code-check-laser"
        style={[styles.laserWrap, { width: sheetW, opacity: laserOpacity, transform: [{ translateY: laserY }] }]}
      >
        <View style={[styles.laserLine, { backgroundColor: colors.accent }]} />
      </Animated.View>
    </>
  );
}

/** Web: no Animated at all — the same ranges as CSS keyframes (codeCheckCss.ts). */
function SheetMotionWeb({ sheetW, sheetH, colors }: MotionProps) {
  const laser = codeCheckLaserStyle(sheetH);
  return (
    <>
      {MARK_STOPS.map((stop, i) => (
        <View
          key={i}
          testID={`code-check-mark-${i}`}
          style={[
            styles.mark,
            { top: sheetH * stop - 7, borderColor: colors.accent, backgroundColor: colors.accentSoft },
            codeCheckMarkStyle(i),
          ]}
        >
          <View style={[styles.markTick, { backgroundColor: colors.accent }]} />
        </View>
      ))}
      {/* RN-web 0.21 warns on the pointerEvents PROP; the style key is its web spelling. */}
      <View testID="code-check-laser" style={[styles.laserWrap, styles.noHit, { width: sheetW }, laser]}>
        <View style={[styles.laserLine, { backgroundColor: colors.accent }]} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },

  head: { alignItems: 'center', marginBottom: 26 },
  eyebrow: { ...Type.monoCaption, letterSpacing: 1.6, textTransform: 'uppercase' },
  title: {
    ...Type.serifTitle,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300,
  },
  subject: { fontSize: Type.footnote.fontSize, marginTop: 8, maxWidth: 300, textAlign: 'center' },
  elapsed: { marginTop: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },

  sheetWrap: { position: 'relative', overflow: 'hidden', borderRadius: Tokens.radius.sm },

  laserWrap: { position: 'absolute', left: 0, top: 0, height: 1.5 },
  noHit: { pointerEvents: 'none' },
  laserLine: { height: 1.5, alignSelf: 'stretch', opacity: CODE_CHECK_LASER_OPACITY },

  mark: {
    position: 'absolute',
    right: 8,
    width: 14, height: 14, borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  markTick: { width: 6, height: 6, borderRadius: 1.5 },

  steps: { marginTop: 28, alignSelf: 'stretch', maxWidth: 340, gap: 9 },
  stepsHeader: { marginBottom: 2 },

  factWrap: { marginTop: 30, alignItems: 'center', maxWidth: 320 },
  factLabel: { ...Type.monoCaption, letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase' },
  factText: { fontSize: Type.footnote.fontSize, lineHeight: 19, textAlign: 'center' },
});
