// WorkProgress — the honest wait for a long AI job (spec-book read, drawing
// compare): what is REALLY happening, how long it has been, and how long it
// usually takes. Nothing here is invented.
//
//   • `title` is the CURRENT real phase ("Reading the spec book"). It changes
//     only when the caller's work changes phase — never on a timer.
//   • The elapsed clock is a setInterval(1000) TEXT update. If JS stalls for a
//     second nothing looks frozen: the level keeps moving on the UI thread.
//   • `typical` is only a range the caller really knows ("usually 60–90 s").
//   • A determinate rule appears ONLY with a real `count` (pages i of N); it
//     is a scaleX FLIP from the left, never an animated width. No percent.
//   • `steps` appear ONLY when the caller has real phases.
//   • `facts` are a quiet "while we work" footer — facts are not progress.
//
// THE MARK. Native: The Level at 64 (revealDelayMs 0 — known-slow work shows at
// once). Web: the crane at min(width·0.5, 280) through CORE's CraneSvg (which
// routes ≥ 120 to CraneMarkWeb), else the level at 64. Platform.OS is read at
// RENDER, never at module scope (the golden harness flips it).
//
// Theme read whole and null-safe (components/loaders rule, validate-level D).

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Button } from '@/components/ui/Button';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { CraneSvg } from '@/components/CraneLoader';
import LevelMark from '@/components/loaders/LevelMark';
import { splashFallbackColors } from '@/components/loaders/themeFallback';
import { DECELERATE, LOADER } from '@/utils/levelTimeline';
import { WORK_FILL_MS, countLine, elapsedLine, fillScale, formatTook, wrapIndex } from '@/components/loaders/progressMath';
import type { ThemeColors } from '@/constants/colors';

export type ProgressStepState = 'done' | 'current' | 'next' | 'neutral';

export interface WorkStep { label: string; state: 'done' | 'current' | 'next'; tookMs?: number }

export interface WorkProgressProps {
  /** The CURRENT REAL phase ("Reading the spec book"). */
  title: string;
  /** Default: mount time. */
  startedAt?: number;
  /** e.g. 'usually 60–90 s' — only a range the caller really knows. */
  typical?: string;
  /** ONLY when the caller has real phases. */
  steps?: readonly WorkStep[];
  /** ONLY a real count (pages i / N). */
  count?: { done: number; total: number; unit?: string };
  done?: boolean;
  /** Replaces the title once done ("Read 48 pages in 1:12"). */
  summary?: string;
  /** After the summary has held for LOADER.workProgress.summaryHoldMs. */
  onDone?: () => void;
  /** Cancel renders only when this is passed. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** "Keep working — we'll notify you" renders only when this is passed. */
  onBackground?: () => void;
  /** A quiet "while we work" footer (cross-fades every factIntervalMs). Not progress. */
  facts?: readonly string[];
  factIntervalMs?: number;
  style?: ViewStyle;
  testID?: string;
}

const CRANE_MAX_W = 280;
const CRANE_MIN_W = 120;
const COLUMN_MAX_W = 360;
/** The determinate rule's height and the hollow step ring's diameter, pt. */
const RULE_H = 3;
const RING = 6;

/**
 * One row of a REAL step list (WorkProgress, CodeCheckLoader). done = a
 * success tick; current = the level at 20 + an emphasized label; next = a
 * hollow 6 pt ring; neutral = the ring with a secondary label (a list of what
 * is checked, with no claim about how far along it is).
 */
export function ProgressStepRow({ label, state, tookMs, colors }: {
  label: string;
  state: ProgressStepState;
  tookMs?: number;
  colors: ThemeColors;
}) {
  const took = state === 'done' && tookMs != null ? formatTook(tookMs) : '';
  return (
    <View style={styles.stepRow} testID={`progress-step-${state}`}>
      <View style={styles.stepSlot}>
        {state === 'done' ? (
          <View testID="progress-step-tick">
            <Check size={14} color={colors.success} strokeWidth={2.5} />
          </View>
        ) : state === 'current' ? (
          <LevelMark size={20} revealDelayMs={0} testID="progress-step-level" />
        ) : (
          <View style={[styles.ring, { borderColor: colors.textMuted }]} />
        )}
      </View>
      <Text
        style={[
          state === 'current' ? Type.subheadEmphasized : Type.footnote,
          styles.stepLabel,
          { color: state === 'current' ? colors.text : state === 'next' ? colors.textMuted : colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {took ? (
        <Text style={[Type.footnote, styles.tabular, { color: colors.textMuted }]}>{took}</Text>
      ) : null}
    </View>
  );
}

export default function WorkProgress({
  title,
  startedAt,
  typical,
  steps,
  count,
  done = false,
  summary,
  onDone,
  onCancel,
  cancelLabel = 'Cancel',
  onBackground,
  facts,
  factIntervalMs = 4200,
  style,
  testID = 'work-progress',
}: WorkProgressProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const reduce = useReducedMotion();
  const { width } = useWindowDimensions();

  // ── elapsed: text only, from startedAt (default: mount), frozen once done ──
  const mountedAt = useRef(Date.now()).current;
  const start = startedAt ?? mountedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done]);

  // ── completion: summary holds, then onDone (at most once per done edge) ──
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!done) return;
    setNow(Date.now());
    const id = setTimeout(() => onDoneRef.current?.(), LOADER.workProgress.summaryHoldMs);
    return () => clearTimeout(id);
  }, [done]);

  // ── the determinate rule: scaleX from the left, a 240 ms FLIP per update ──
  const target = fillScale(count);
  const fill = useRef(new Animated.Value(target)).current;
  const firstFill = useRef(true);
  useEffect(() => {
    if (firstFill.current) { firstFill.current = false; return; }
    if (reduce) { fill.setValue(target); return; }
    const a = Animated.timing(fill, { toValue: target, duration: WORK_FILL_MS, easing: DECELERATE, useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [target, reduce, fill]);

  // ── facts: a quiet footer, cross-faded ──
  const hasFacts = Array.isArray(facts) && facts.length > 0;
  const [factIdx, setFactIdx] = useState(0);
  const factFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!hasFacts || facts!.length <= 1) return;
    const id = setInterval(() => setFactIdx((i) => wrapIndex(i + 1, facts!.length)), Math.max(2000, factIntervalMs));
    return () => clearInterval(id);
  }, [hasFacts, facts, factIntervalMs]);
  const firstFact = useRef(true);
  useEffect(() => {
    if (firstFact.current) { firstFact.current = false; return; }
    if (reduce) { factFade.setValue(1); return; }
    factFade.setValue(0);
    const a = Animated.timing(factFade, { toValue: 1, duration: LOADER.settle.contentMs, easing: DECELERATE, useNativeDriver: nativeDriver });
    a.start();
    return () => a.stop();
  }, [factIdx, reduce, factFade]);

  const shownTitle = done ? summary ?? title : title;
  // Read at render (never module scope): the golden harness flips Platform.OS.
  const web = Platform.OS === 'web';
  const craneW = Math.min(width * 0.5, CRANE_MAX_W);
  const colW = Math.max(0, Math.min(width - 56, COLUMN_MAX_W));
  const mark = web && craneW >= CRANE_MIN_W
    ? <CraneSvg size={craneW} />
    : <LevelMark size={64} revealDelayMs={0} done={done} />;

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View style={[styles.column, { width: colW }]}>
        {/* ONLY the mark + phase + clock are the progressbar. An `accessible`
            View is read as ONE element on iOS and hides its children from
            VoiceOver, so the count, the steps, the Cancel / background actions
            and the facts footer sit BESIDE it, where VoiceOver can reach them. */}
        <View
          style={styles.status}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={shownTitle}
          accessibilityValue={count ? { min: 0, max: Math.max(0, count.total), now: Math.max(0, count.done) } : undefined}
          testID={`${testID}-status`}
        >
          {mark}
          <Text
            style={[Type.headline, styles.phase, { color: colors.text }]}
            numberOfLines={2}
            accessibilityLiveRegion="polite"
            testID={`${testID}-title`}
          >
            {shownTitle}
          </Text>
          <Text style={[Type.footnote, styles.elapsed, styles.tabular, { color: colors.textSecondary }]} testID={`${testID}-elapsed`}>
            {elapsedLine(now - start, typical)}
          </Text>
        </View>

        {count ? (
          <View style={styles.countBlock}>
            <View style={[styles.track, { backgroundColor: colors.line }]}>
              <Animated.View
                testID={`${testID}-fill`}
                style={[styles.fill, { backgroundColor: colors.accent, transform: [{ scaleX: fill }] }]}
              />
            </View>
            <Text style={[Type.footnote, styles.countText, styles.tabular, { color: colors.textSecondary }]}>
              {countLine(count)}
            </Text>
          </View>
        ) : null}

        {steps && steps.length > 0 ? (
          <View style={styles.steps}>
            {steps.map((s, i) => (
              <ProgressStepRow key={`${i}-${s.label}`} label={s.label} state={s.state} tookMs={s.tookMs} colors={colors} />
            ))}
          </View>
        ) : null}

        {onBackground || onCancel ? (
          <View style={styles.actions}>
            {onBackground ? (
              <Button
                label="Keep Working"
                variant="ghost"
                size="sm"
                onPress={onBackground}
                testID={`${testID}-background`}
              />
            ) : null}
            {onCancel ? (
              <Button label={cancelLabel} variant="ghost" size="sm" onPress={onCancel} testID={`${testID}-cancel`} />
            ) : null}
          </View>
        ) : null}

        {hasFacts ? (
          <Animated.View style={[styles.factWrap, { opacity: factFade }]}>
            <Text style={[Type.monoCaption, styles.factEyebrow, { color: colors.textMuted }]}>While You Wait</Text>
            <Text style={[Type.footnote, styles.factText, { color: colors.textSecondary }]}>{facts![wrapIndex(factIdx, facts!.length)]}</Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  column: { alignItems: 'center' },
  // Stretched to the column so its centred children lay out exactly as before.
  status: { alignSelf: 'stretch', alignItems: 'center' },
  phase: { marginTop: 16, textAlign: 'center' },
  elapsed: { marginTop: 6, textAlign: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
  countBlock: { alignSelf: 'stretch', marginTop: 16, alignItems: 'center' },
  track: { alignSelf: 'stretch', height: RULE_H, borderRadius: RULE_H / 2, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject, transformOrigin: 'left' },
  countText: { marginTop: 6, textAlign: 'center' },
  steps: { alignSelf: 'stretch', marginTop: 20, gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepSlot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  ring: { width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1 },
  stepLabel: { flex: 1 },
  actions: { marginTop: 20, alignItems: 'center', gap: 4 },
  factWrap: { marginTop: 28, alignItems: 'center', minHeight: 60, maxWidth: 340 },
  factEyebrow: { letterSpacing: 1.4, marginBottom: 8, textTransform: 'uppercase' },
  factText: { textAlign: 'center' },
});
