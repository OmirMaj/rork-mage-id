import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import LevelMark, { useLevelReveal } from '@/components/loaders/LevelMark';
import { splashFallbackColors } from '@/components/loaders/themeFallback';
import { LOADER } from '@/utils/levelTimeline';

/**
 * ConstructionLoader — the inline / section loader used across the app. Every
 * size and platform draws "The Level" (components/loaders/LevelMark.tsx): the
 * spirit level from the launch screen, its bubble seeking while work runs.
 *
 * The props API is UNCHANGED so no call site moves (several live in files other
 * lanes own). What changed underneath:
 *   - sm / md / lg → a level 20 / 36 / 64 pt wide (120 is reserved for the
 *     CraneSvg hero sizes and the splash).
 *   - `colorTop` colours the bubble. `colorMid`, `colorBase`, `scene` and
 *     `labelIntervalMs` are accepted and IGNORED (the house / city SVG they
 *     styled is gone).
 *   - The level and its label wait out a 150 ms reveal plateau, so a fast load
 *     shows nothing. Call sites unmount this by conditional return, so there is
 *     no minimum hold or settle here: migrate the call site to
 *     <Loading ready> (components/loaders/Loading.tsx) for the full gate.
 *   - `labels` are HONEST: no timer ever advances them. The loader shows
 *     labels[0] — the only stage that is true at t = 0 — never the last entry
 *     (which may claim nearness, e.g. "Almost there…"). After 8 s a real
 *     elapsed clock (" · 0:12") is appended; it is text, not motion, so if the
 *     JS thread stalls the level still moves on the UI thread.
 *
 * Accessibility: the container announces the label (without the clock) once;
 * the mark itself is decorative.
 */

type LoaderSize = 'sm' | 'md' | 'lg';

interface ConstructionLoaderProps {
  size?: LoaderSize;
  /** Accepted and ignored (the level has one scene). */
  scene?: 'house' | 'city';
  /** Optional label rendered beneath the level. Kept short; this isn't a toast. */
  label?: string;
  /**
   * Stage labels for a long load. Only labels[0] is shown (no timer advances
   * it — see above). Takes priority over `label` when non-empty.
   */
  labels?: string[];
  /** Accepted and ignored (labels no longer rotate). */
  labelIntervalMs?: number;
  /** Wrapper style override — e.g. flex:1 for full-screen centering. */
  style?: ViewStyle;
  /** The bubble colour. Defaults to the theme accent. */
  colorTop?: string;
  /** Accepted and ignored. */
  colorMid?: string;
  /** Accepted and ignored. */
  colorBase?: string;
}

const MARK_W: Record<LoaderSize, number> = { sm: 20, md: 36, lg: 64 };
const LABEL_TYPE: Record<LoaderSize, TextStyle> = { sm: Type.caption1, md: Type.footnote, lg: Type.subhead };
const REVEAL_MS = LOADER.enter.defaultRevealMs;

/** m:ss */
function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function ConstructionLoader({
  size = 'md',
  label,
  labels,
  style,
  colorTop,
}: ConstructionLoaderProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const words = useLevelReveal(REVEAL_MS);

  const shownLabel = Array.isArray(labels) && labels.length > 0 ? labels[0] : label;

  // The elapsed clock: a 1 s text tick, started only when there are words.
  const mountedAt = useRef(Date.now()).current;
  const [now, setNow] = useState(mountedAt);
  useEffect(() => {
    if (!shownLabel) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [shownLabel]);
  const elapsed = now - mountedAt;
  const text = shownLabel && elapsed >= LOADER.workProgress.elapsedAfterMs ? `${shownLabel} · ${clock(elapsed)}` : shownLabel;

  return (
    <View
      style={[styles.container, { gap: size === 'sm' ? 8 : 12 }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={shownLabel ?? 'Loading'}
      testID="construction-loader"
    >
      <LevelMark size={MARK_W[size]} color={colorTop} revealDelayMs={REVEAL_MS} />
      {!!text && (
        <Animated.View style={{ opacity: words }}>
          <Text style={[LABEL_TYPE[size], styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
            {text}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
