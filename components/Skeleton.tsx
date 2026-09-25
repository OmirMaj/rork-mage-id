// Skeleton — shimmer placeholder for content that's loading.
//
// Why this instead of an ActivityIndicator: skeletons preserve the
// visual rhythm of the UI while data loads, so the content "fades in"
// rather than punching through a loading punch-out. Fintech and luxe
// productivity apps use this everywhere; it's the cheap-vs-premium
// tell on a list screen.
//
// Primitives:
//   <Skeleton width height radius style />  — single block
//   <SkeletonRow />                          — avatar + 2 lines of text
//   <SkeletonCard />                         — full project-card-shaped block
//   <ListSkeleton count={n} />               — n SkeletonCards in a row

import React, { useEffect } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { nativeDriver, useReducedMotion, webMotion } from '@/components/ui/motion';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

// Skeletons never announce themselves: a screen reader hears the content when
// it lands, not a row of grey boxes.
const A11Y_HIDDEN = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

export function Skeleton({ width = '100%', height = 14, radius = 6, style }: SkeletonProps) {
  const { block, root } = useSharedShimmer();
  const { colors } = useTheme();
  return (
    <Animated.View
      {...A11Y_HIDDEN}
      style={[
        {
          width: width as number | `${number}%`,
          height,
          borderRadius: radius,
          backgroundColor: colors.line,
          opacity: block,
        },
        root,
        style,
      ]}
    />
  );
}

/** Avatar + two-line skeleton row, sized to look like a list item. */
export function SkeletonRow({ style }: { style?: ViewStyle }) {
  const { block: opacity, root } = useSharedShimmer();
  const { colors } = useTheme();
  return (
    <View {...A11Y_HIDDEN} style={[rowStyles.wrapper, root, style]}>
      <Animated.View style={[rowStyles.avatar, { opacity, backgroundColor: colors.line }]} />
      <View style={rowStyles.lines}>
        <Animated.View style={[rowStyles.lineLong, { opacity, backgroundColor: colors.line }]} />
        <Animated.View style={[rowStyles.lineShort, { opacity, backgroundColor: colors.line }]} />
      </View>
    </View>
  );
}

/** Full-card skeleton matching the ProjectCard footprint. */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const { block: opacity, root } = useSharedShimmer();
  const { colors } = useTheme();
  return (
    <View {...A11Y_HIDDEN} style={[cardStyles.card, { backgroundColor: colors.surface, borderColor: colors.line }, root, style]}>
      <View style={cardStyles.row}>
        <Animated.View style={[cardStyles.icon, { opacity, backgroundColor: colors.line }]} />
        <View style={cardStyles.title}>
          <Animated.View style={[cardStyles.lineLong, { opacity, backgroundColor: colors.line }]} />
          <Animated.View style={[cardStyles.lineShort, { opacity, backgroundColor: colors.line }]} />
        </View>
        <Animated.View style={[cardStyles.pill, { opacity, backgroundColor: colors.line }]} />
      </View>
      <View style={[cardStyles.divider, { backgroundColor: colors.line }]} />
      <View style={cardStyles.metaRow}>
        <Animated.View style={[cardStyles.metaBlock, { opacity, backgroundColor: colors.line }]} />
        <Animated.View style={[cardStyles.metaBlock, { opacity, backgroundColor: colors.line }]} />
        <Animated.View style={[cardStyles.metaBlock, { opacity, backgroundColor: colors.line }]} />
      </View>
    </View>
  );
}

/** Convenience: render `count` SkeletonCards. */
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </>
  );
}

// ── The shimmer: ONE pulse for every skeleton on screen ─────────────────────
//
// Each skeleton used to start its own loop, so the cards on a loading screen
// pulsed out of step with each other. Now:
//   - NATIVE: one module-level value and one loop (0.5 ↔ 0.85, 900 ms each way,
//     on the native driver), started by the first skeleton to mount and
//     stopped by the last to unmount. Every block reads the same value.
//   - WEB: no Animated loop at all (a JS loop re-renders every skeleton each
//     frame). The root carries the CSS `pulse` keyframe from motion.ts instead;
//     the blocks sit at full opacity inside it.
//   - Reduce Motion, either platform: no pulse, a static 0.6.

export const SHIMMER_LOW = 0.5;
export const SHIMMER_HIGH = 0.85;
export const SHIMMER_STATIC = 0.6;
/** Each half of the pulse; the web keyframe in motion.ts runs the same 900 ms. */
const SHIMMER_HALF_MS = 900;

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

function sharedShimmerValue(): Animated.Value {
  if (!shimmerValue) shimmerValue = new Animated.Value(SHIMMER_LOW);
  return shimmerValue;
}

const shimmer = shimmerCounter(
  () => {
    const v = sharedShimmerValue();
    const half = (toValue: number) => Animated.timing(v, {
      toValue,
      duration: SHIMMER_HALF_MS,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: nativeDriver,
    });
    shimmerLoop = Animated.loop(Animated.sequence([half(SHIMMER_HIGH), half(SHIMMER_LOW)]));
    shimmerLoop.start();
  },
  () => {
    shimmerLoop?.stop();
    shimmerLoop = null;
  },
);

/** `block`: the opacity every placeholder block uses. `root`: the style the
 *  skeleton's outermost view adds (the web pulse; null elsewhere). */
function useSharedShimmer(): { block: Animated.Value | number; root: ViewStyle | null } {
  const reduce = useReducedMotion();
  const web = Platform.OS === 'web';
  const animate = !web && !reduce;
  useEffect(() => {
    if (!animate) return;
    shimmer.acquire();
    return () => shimmer.release();
  }, [animate]);
  if (web) {
    const pulse = webMotion('pulse');
    return { block: pulse ? 1 : SHIMMER_STATIC, root: pulse };
  }
  return { block: reduce ? SHIMMER_STATIC : sharedShimmerValue(), root: null };
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

export default Skeleton;
