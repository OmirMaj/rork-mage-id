// Skeleton — shimmer placeholder for content that's loading.
//
// Why this instead of an ActivityIndicator: skeletons preserve the
// visual rhythm of the UI while data loads, so the content "fades in"
// rather than punching through a loading punch-out. Fintech and luxe
// productivity apps use this everywhere; it's the cheap-vs-premium
// tell on a list screen.
//
// Three primitives:
//   <Skeleton width height radius style />  — single block
//   <SkeletonRow />                          — opinionated row pattern
//                                              (avatar + 2 lines of text)
//   <SkeletonCard />                         — full project-card-shaped block
//
// Animation: a single shared opacity loop (0.4 → 1.0 → 0.4 over 1100ms)
// so 20 skeletons on screen don't run 20 separate timers. Driver is JS
// (opacity on Views) — switch to native if you batch-mount more than ~80.
import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 14, radius = 6, style }: SkeletonProps) {
  const opacity = useSharedShimmer();
  return (
    <Animated.View
      style={[
        {
          width: width as number | `${number}%`,
          height,
          borderRadius: radius,
          backgroundColor: Colors.fillTertiary,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Avatar + two-line skeleton row, sized to look like a list item. */
export function SkeletonRow({ style }: { style?: ViewStyle }) {
  const opacity = useSharedShimmer();
  return (
    <View style={[rowStyles.wrapper, style]}>
      <Animated.View style={[rowStyles.avatar, { opacity }]} />
      <View style={rowStyles.lines}>
        <Animated.View style={[rowStyles.lineLong, { opacity }]} />
        <Animated.View style={[rowStyles.lineShort, { opacity }]} />
      </View>
    </View>
  );
}

/** Full-card skeleton matching the ProjectCard footprint. */
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const opacity = useSharedShimmer();
  return (
    <View style={[cardStyles.card, style]}>
      <View style={cardStyles.row}>
        <Animated.View style={[cardStyles.icon, { opacity }]} />
        <View style={cardStyles.title}>
          <Animated.View style={[cardStyles.lineLong, { opacity }]} />
          <Animated.View style={[cardStyles.lineShort, { opacity }]} />
        </View>
        <Animated.View style={[cardStyles.pill, { opacity }]} />
      </View>
      <View style={cardStyles.divider} />
      <View style={cardStyles.metaRow}>
        <Animated.View style={[cardStyles.metaBlock, { opacity }]} />
        <Animated.View style={[cardStyles.metaBlock, { opacity }]} />
        <Animated.View style={[cardStyles.metaBlock, { opacity }]} />
      </View>
    </View>
  );
}

// Internal — every skeleton on screen reads from the same opacity ref.
// Returns an Animated.Value, not a hook return. We construct it once
// per component and start the shared loop on first mount.
function useSharedShimmer() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
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
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  lines: { flex: 1, gap: 6 },
  lineLong: { height: 12, backgroundColor: Colors.fillTertiary, borderRadius: 6, width: '70%' as const },
  lineShort: { height: 10, backgroundColor: Colors.fillTertiary, borderRadius: 5, width: '40%' as const },
});

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  title: { flex: 1, gap: 6 },
  lineLong: { height: 14, backgroundColor: Colors.fillTertiary, borderRadius: 7, width: '70%' as const },
  lineShort: { height: 10, backgroundColor: Colors.fillTertiary, borderRadius: 5, width: '40%' as const },
  pill: { width: 80, height: 22, borderRadius: 11, backgroundColor: Colors.fillTertiary },
  divider: { height: 0.5, backgroundColor: Colors.borderLight, marginHorizontal: 16 },
  metaRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  metaBlock: {
    flex: 1,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
});

export default Skeleton;
