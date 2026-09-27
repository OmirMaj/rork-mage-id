import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { nativeDriver } from '@/components/ui/motion';
import LevelMark, { useLevelReveal } from '@/components/loaders/LevelMark';
import CraneMarkWeb from '@/components/loaders/CraneMarkWeb';
import { splashFallbackColors } from '@/components/loaders/themeFallback';
import { LOADER } from '@/utils/levelTimeline';

/**
 * CraneLoader — the full-screen loader for long waits (estimate pricing,
 * drawing + spec-book AI analysis), and `CraneSvg`, the bare loading graphic
 * other surfaces place in their own boxes.
 *
 * Both now draw "The Level" (components/loaders/LevelMark.tsx) on iOS/Android:
 * plain Views on the native driver, one shared native clock, so a pegged JS
 * thread cannot stall it. The animated SVG tower crane stays on the WEB at
 * 120 px and up (components/loaders/CraneMarkWeb.tsx; below 120 a crane cannot
 * hold its detail, and at 28 px it was invisible). Props and boxes are
 * UNCHANGED, so no call site moves. Colours are theme tokens.
 */

const VB_W = 340;
const VB_H = 300;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The level's width inside a CraneSvg box of width `size` (288 → 120, 180 → 108, 28 → 28). */
export function craneMarkWidth(size: number): number {
  return size < 60 ? size : clamp(Math.round(size * 0.6), 36, 120);
}

/**
 * The bare loading graphic in today's crane box: EXACTLY size × size·300/340,
 * so EstimateLoadingOverlay (288), crew (180) and the building-record cards
 * (28) never move. Native: the level centred in the box. Web: the SVG crane at
 * 120 px and up, else the same box + level. Platform.OS is read HERE, at
 * render (never at module scope): the golden harness flips it at runtime.
 * `animate={false}` renders a static, centred level.
 */
export function CraneSvg({ size, animate = true }: { size: number; animate?: boolean }) {
  if (Platform.OS === 'web' && size >= 120) return <CraneMarkWeb size={size} />;
  return (
    <View testID="crane-svg" style={[styles.box, { width: size, height: (size * VB_H) / VB_W }]}>
      <LevelMark size={craneMarkWidth(size)} animate={animate} />
    </View>
  );
}

interface CraneLoaderProps {
  /** Status line under the level (a plain status, never the brand wordmark). */
  label?: string;
  /** Rotating one-liners shown beneath (construction facts / tips — "did you know", not progress). */
  facts?: readonly string[];
  /** How long each fact is shown. Default 3800ms. */
  factIntervalMs?: number;
  /** Wrapper override — defaults to full-screen (flex: 1). */
  style?: ViewStyle;
}

const REVEAL_MS = LOADER.enter.defaultRevealMs;

// The boot and reload loaders are explicit now (app/_layout.tsx mounts
// BootShell / ScreenLoader, ReloadVeil draws ScreenLoader), so the old
// `label === 'MAGE ID'` routing heuristic is gone and the default label is a
// plain status line.
export default function CraneLoader({ label = 'Loading', facts, factIntervalMs = 3800, style }: CraneLoaderProps) {
  return <CraneStatus label={label} facts={facts} factIntervalMs={factIntervalMs} style={style} />;
}

function CraneStatus({ label, facts, factIntervalMs, style }: Required<Pick<CraneLoaderProps, 'label' | 'factIntervalMs'>> & Pick<CraneLoaderProps, 'facts' | 'style'>) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const { width } = useWindowDimensions();
  const factFade = useRef(new Animated.Value(1)).current;
  const reveal = useLevelReveal(REVEAL_MS);

  const rotating = Array.isArray(facts) && facts.length > 0;
  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => {
    if (!rotating || facts!.length <= 1) return;
    const id = setInterval(() => setFactIdx(i => (i + 1) % facts!.length), Math.max(1500, factIntervalMs));
    return () => clearInterval(id);
  }, [rotating, facts, factIntervalMs]);
  useEffect(() => {
    factFade.setValue(0);
    Animated.timing(factFade, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }).start();
  }, [factIdx, factFade]);

  // Read at render (never module scope): the golden harness flips Platform.OS.
  const web = Platform.OS === 'web';
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }, style]} testID="crane-loader">
      {/* The level runs the same 150 ms reveal plateau as the words' wrapper. */}
      {web ? <CraneSvg size={Math.min(width * 0.5, 280)} /> : <LevelMark size={64} revealDelayMs={REVEAL_MS} />}
      <Animated.View style={[styles.column, { opacity: reveal }]}>
        <Text style={[Type.headline, styles.status, { color: colors.text }]} numberOfLines={2}>{label}</Text>
        {rotating && (
          <Animated.View style={[styles.factWrap, { opacity: factFade }]}>
            <Text style={[Type.monoCaption, styles.factEyebrow, { color: colors.textMuted }]}>WHILE WE WORK</Text>
            <Text style={[Type.footnote, styles.factText, { color: colors.textSecondary }]}>{facts![factIdx]}</Text>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  column: { alignItems: 'center', maxWidth: 360 },
  status: { marginTop: 16, textAlign: 'center' },
  factWrap: { marginTop: 28, alignItems: 'center', minHeight: 60, maxWidth: 340 },
  factEyebrow: { letterSpacing: 1.4, marginBottom: 8 },
  factText: { textAlign: 'center' },
});
