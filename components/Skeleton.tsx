// Skeleton — placeholder blocks for content that's loading.
//
// Why this instead of an ActivityIndicator: skeletons preserve the
// visual rhythm of the UI while data loads, so the content "fades in"
// rather than punching through a loading punch-out. A skeleton must match
// its real layout exactly — a mismatched one scores worse than a spinner.
//
// Primitives:
//   <Skeleton width height radius style index col />  — single block
//   <SkeletonRow index />                              — avatar + 2 lines of text
//   <SkeletonCard index />                             — ProjectCard-shaped block
//   <ListSkeleton count={n} />                         — n SkeletonCards (card i gets index i)
//   <SkeletonHero index />                             — project-detail's hero: 3 KPIs + a 2 × 3 tile grid
//   <SkeletonTable rows index />                       — a header line + rows of 3 cells
// Hand a skeleton to content with components/loaders/SkeletonReveal.

import React, { useEffect } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { LOADER, skeletonPhase, skeletonWave } from '@/utils/levelTimeline';
import { skeletonWaveStyle } from '@/components/loaders/css/skeletonCss';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
  /** The block's row in the wave (its list index). Omitted: phase 0, in unison with every unindexed block. */
  index?: number;
  /** The block's left-to-right position in its row. */
  col?: number;
}

// Skeletons never announce themselves: a screen reader hears the content when
// it lands, not a row of grey boxes.
const A11Y_HIDDEN = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

/** φ for a block: (row·0.10 + col·0.04) mod 1 — or 0 for every block when the row is not indexed. */
const phaseOf = (index: number | undefined, col: number): number => (index === undefined ? 0 : skeletonPhase(index, col));

export function Skeleton({ width = '100%', height = 14, radius = 6, style, index, col = 0 }: SkeletonProps) {
  const wave = useSkeletonWave();
  const { colors } = useTheme();
  return (
    <Animated.View
      {...A11Y_HIDDEN}
      style={[
        {
          width: width as number | `${number}%`,
          height,
          borderRadius: radius,
          backgroundColor: colors.text,
        },
        wave(phaseOf(index, col)),
        style,
      ]}
    />
  );
}

/** Avatar + two-line skeleton row, sized to look like a list item. */
export function SkeletonRow({ style, index }: { style?: ViewStyle; index?: number }) {
  const wave = useSkeletonWave();
  const { colors } = useTheme();
  const ink = { backgroundColor: colors.text };
  return (
    <View {...A11Y_HIDDEN} style={[rowStyles.wrapper, style]}>
      <Animated.View style={[rowStyles.avatar, ink, wave(phaseOf(index, 0))]} />
      <View style={rowStyles.lines}>
        <Animated.View style={[rowStyles.lineLong, ink, wave(phaseOf(index, 1))]} />
        <Animated.View style={[rowStyles.lineShort, ink, wave(phaseOf(index, 1))]} />
      </View>
    </View>
  );
}

/** Full-card skeleton matching the ProjectCard footprint. */
export function SkeletonCard({ style, index }: { style?: ViewStyle; index?: number }) {
  const wave = useSkeletonWave();
  const { colors } = useTheme();
  const ink = { backgroundColor: colors.text };
  return (
    <View {...A11Y_HIDDEN} style={[cardStyles.card, { backgroundColor: colors.surface, borderColor: colors.line }, style]}>
      <View style={cardStyles.row}>
        <Animated.View style={[cardStyles.icon, ink, wave(phaseOf(index, 0))]} />
        <View style={cardStyles.title}>
          <Animated.View style={[cardStyles.lineLong, ink, wave(phaseOf(index, 1))]} />
          <Animated.View style={[cardStyles.lineShort, ink, wave(phaseOf(index, 1))]} />
        </View>
        <Animated.View style={[cardStyles.pill, ink, wave(phaseOf(index, 2))]} />
      </View>
      <View style={[cardStyles.divider, { backgroundColor: colors.line }]} />
      <View style={cardStyles.metaRow}>
        <Animated.View style={[cardStyles.metaBlock, ink, wave(phaseOf(index, 0))]} />
        <Animated.View style={[cardStyles.metaBlock, ink, wave(phaseOf(index, 1))]} />
        <Animated.View style={[cardStyles.metaBlock, ink, wave(phaseOf(index, 2))]} />
      </View>
    </View>
  );
}

/** Convenience: render `count` SkeletonCards; card i is row i of the wave. */
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} index={i} />
      ))}
    </>
  );
}

/** project-detail's hero: 3 KPI blocks in a row, then a 2 × 3 tile grid. */
export function SkeletonHero({ index, style }: { index?: number; style?: ViewStyle }) {
  const wave = useSkeletonWave();
  const { colors } = useTheme();
  const ink = { backgroundColor: colors.text };
  const row = (r: number) => (index === undefined ? undefined : index + r);
  return (
    <View {...A11Y_HIDDEN} style={[heroStyles.wrapper, style]}>
      <View style={heroStyles.row}>
        {[0, 1, 2].map((c) => (
          <Animated.View key={c} style={[heroStyles.kpi, ink, wave(phaseOf(row(0), c))]} />
        ))}
      </View>
      {[1, 2].map((r) => (
        <View key={r} style={heroStyles.row}>
          {[0, 1, 2].map((c) => (
            <Animated.View key={c} style={[heroStyles.tile, ink, wave(phaseOf(row(r), c))]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** A table: a header line (40 % wide) + `rows` rows of 3 cells (flex 3 / 1 / 1). */
export function SkeletonTable({ rows = 5, index, style }: { rows?: number; index?: number; style?: ViewStyle }) {
  const wave = useSkeletonWave();
  const { colors } = useTheme();
  const ink = { backgroundColor: colors.text };
  const row = (r: number) => (index === undefined ? undefined : index + r);
  return (
    <View {...A11Y_HIDDEN} style={[tableStyles.wrapper, style]}>
      <Animated.View style={[tableStyles.header, ink, wave(phaseOf(row(0), 0))]} />
      {Array.from({ length: Math.max(0, rows) }).map((_, r) => (
        <View key={r} style={tableStyles.row}>
          {TABLE_FLEX.map((flex, c) => (
            <Animated.View key={c} style={[tableStyles.cell, { flex }, ink, wave(phaseOf(row(r + 1), c))]} />
          ))}
        </View>
      ))}
    </View>
  );
}
const TABLE_FLEX = [3, 1, 1] as const;

// ── The breath wave: ONE native loop for every skeleton on screen ──────────
//
// A block is ink (colors.text) at a low opacity — alpha 0.09 at rest, dipping
// 40 % as a soft wave passes (CORE's skeletonWave, utils/levelTimeline.ts).
// The block's phase φ (row·0.10 + col·0.04) is baked into its interpolation's
// OUTPUT, so the wave travels top-left → bottom-right and rests about half the
// cycle; unindexed blocks all sit at φ = 0 and pulse in unison.
//   - NATIVE: one module-level value and ONE linear Animated.timing inside
//     Animated.loop (the single-timing loop shape RN runs natively — the old
//     loop(sequence(half, half)) was restarted from JS every 900 ms, exactly
//     while a screen was loading). Ref-counted: the first skeleton to mount
//     starts it, the last to unmount stops it. One interpolation per phase.
//   - WEB: no Animated loop at all (a JS loop re-renders every block each
//     frame). Each block carries the registered CSS bucket nearest its phase
//     (components/loaders/css/skeletonCss.ts).
//   - Reduce Motion, either platform: no wave, a static alpha × 0.8.

/** Reduce Motion: the static block opacity (0.09 × 0.8). */
export const SKELETON_STATIC_OPACITY = Math.round(LOADER.skeleton.alpha * LOADER.skeleton.rmFactor * 1e4) / 1e4;

/** The ref-counted loop's bookkeeping, pure so the start/stop rule is testable:
 *  the first subscriber starts it, the last one out stops it. */
export function shimmerCounter(start: () => void, stop: () => void) {
  let subscribers = 0;
  return {
    acquire(): void {
      subscribers += 1;
      if (subscribers === 1) start();
    },
    release(): void {
      if (subscribers === 0) return;
      subscribers -= 1;
      if (subscribers === 0) stop();
    },
    count: (): number => subscribers,
  };
}

let shimmerValue: Animated.Value | null = null;
let shimmerLoop: Animated.CompositeAnimation | null = null;
let shimmerStarts = 0;
let shimmerStops = 0;

function sharedShimmerValue(): Animated.Value {
  if (!shimmerValue) shimmerValue = new Animated.Value(0);
  return shimmerValue;
}

const shimmer = shimmerCounter(
  () => {
    shimmerStarts += 1;
    const v = sharedShimmerValue();
    v.setValue(0);
    shimmerLoop = Animated.loop(Animated.timing(v, {
      toValue: 1,
      duration: LOADER.skeleton.periodMs,
      easing: Easing.linear,
      useNativeDriver: nativeDriver,
      isInteraction: false,
    }));
    shimmerLoop.start();
  },
  () => {
    shimmerStops += 1;
    shimmerLoop?.stop();
    shimmerLoop = null;
  },
);

/** Test / diagnostics: subscribers now, and how often the one loop started / stopped. */
export function skeletonClockStats(): { count: number; starts: number; stops: number } {
  return { count: shimmer.count(), starts: shimmerStarts, stops: shimmerStops };
}

/** One interpolation per distinct phase, shared by every block at that phase. */
const waveNodes = new Map<number, Animated.AnimatedInterpolation<number>>();
function waveNode(phase: number): Animated.AnimatedInterpolation<number> {
  let node = waveNodes.get(phase);
  if (!node) {
    node = sharedShimmerValue().interpolate({ ...skeletonWave(phase), extrapolate: 'clamp' });
    waveNodes.set(phase, node);
  }
  return node;
}

const WEB_REST = { opacity: LOADER.skeleton.alpha };
const STATIC = { opacity: SKELETON_STATIC_OPACITY };

/** Subscribes the caller to the one loop (native, motion on) and returns the
 *  per-block style for a phase: an opacity node, a CSS bucket, or the static opacity. */
function useSkeletonWave(): (phase: number) => Animated.WithAnimatedValue<ViewStyle> | (ViewStyle | null)[] {
  const reduce = useReducedMotion();
  const web = Platform.OS === 'web';
  const animate = !web && !reduce;
  useEffect(() => {
    if (!animate) return;
    shimmer.acquire();
    return () => shimmer.release();
  }, [animate]);
  if (reduce) return () => STATIC;
  if (web) return (phase) => [WEB_REST, skeletonWaveStyle(phase)];
  return (phase) => ({ opacity: waveNode(phase) });
}

const rowStyles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 12,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.card,
  },
  lines: { flex: 1, gap: 6 },
  lineLong: { height: 12, borderRadius: Tokens.radius.xs, width: '70%' as const },
  lineShort: { height: 10, borderRadius: 5, width: '40%' as const },
});

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: Tokens.radius.panel,
    overflow: 'hidden' as const,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 16,
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: Tokens.radius.card,
  },
  title: { flex: 1, gap: 6 },
  lineLong: { height: 14, borderRadius: 7, width: '70%' as const },
  lineShort: { height: 10, borderRadius: 5, width: '40%' as const },
  pill: { width: 80, height: 22, borderRadius: 11 },
  divider: { height: 0.5, marginHorizontal: 16 },
  metaRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  metaBlock: {
    flex: 1,
    height: 30,
    borderRadius: Tokens.radius.sm,
  },
});

const heroStyles = StyleSheet.create({
  wrapper: { gap: 8 },
  row: { flexDirection: 'row' as const, gap: 8 },
  kpi: { flex: 1, height: 48, borderRadius: Tokens.radius.card },
  tile: { flex: 1, height: 72, borderRadius: Tokens.radius.card },
});

const tableStyles = StyleSheet.create({
  wrapper: { gap: 14 },
  header: { width: '40%' as const, height: 12, borderRadius: 4 },
  row: { flexDirection: 'row' as const, gap: 12 },
  cell: { height: 12, borderRadius: 4 },
});

export default Skeleton;
