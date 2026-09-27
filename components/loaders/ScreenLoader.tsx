// ScreenLoader — the full-screen loading gate: the theme ground, a 64 pt level
// centred, and an optional caption under it. The replacement for the ~30
// full-screen ActivityIndicator gates (a later codemod wave adopts it) and for
// ReloadVeil's contents (the LAUNCH lane).
//
// `done` plays the level's settle; onSettled fires after it. Theme read
// null-safely (it may render before the ThemeProvider is up).

import React from 'react';
import { Animated, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import LevelMark, { useLevelReveal } from './LevelMark';
import { splashFallbackColors } from './themeFallback';

export interface ScreenLoaderProps {
  caption?: string;
  done?: boolean;
  onSettled?: () => void;
  revealDelayMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export default function ScreenLoader({ caption, done = false, onSettled, revealDelayMs = 200, style, testID = 'screen-loader' }: ScreenLoaderProps) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const words = useLevelReveal(revealDelayMs, done, 'settle');
  // The ground stays opaque until `done`, then leaves with the level (so the
  // content arriving underneath is not hidden behind it until unmount).
  const ground = useLevelReveal(0, done, 'settle');
  return (
    <Animated.View
      testID={testID}
      style={[styles.root, { backgroundColor: colors.bg }, style, { opacity: ground }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption ?? 'Loading'}
      accessibilityState={{ busy: !done }}
    >
      <LevelMark size={64} revealDelayMs={revealDelayMs} done={done} exit="settle" onSettled={onSettled} />
      {!!caption && (
        <Animated.View style={{ opacity: words }}>
          <Text style={[Type.footnoteEmphasized, styles.caption, { color: colors.textSecondary }]} numberOfLines={2}>
            {caption}
          </Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  caption: { marginTop: 12, letterSpacing: 0.26, textAlign: 'center', maxWidth: 320 },
});
