import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';

interface ThinkingStatesProps {
  /** Ordered labels to reveal one at a time, e.g. moat-teaching lines. */
  steps: string[];
  /** Whether the sequence is running. When false, resets to the first step. */
  active: boolean;
  /** Milliseconds between advancing to the next step. Default 1800. */
  intervalMs?: number;
}

// Designed feedback, not a spinner. Advances through labeled steps so the
// wait teaches the moat while it works. Stops on the last step (does not loop)
// so the copy reads as a real sequence, not a carousel.
export default function ThinkingStates({ steps, active, intervalMs = 1800 }: ThinkingStatesProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) { setIndex(0); return; }
    setIndex(0);
    const id = setInterval(() => {
      setIndex(i => (i < steps.length - 1 ? i + 1 : i));
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, steps.length, intervalMs]);

  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [index, opacity]);

  if (!active || steps.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.dot} />
      <Animated.Text style={[styles.label, { opacity }]} numberOfLines={2}>
        {steps[Math.min(index, steps.length - 1)]}
      </Animated.Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent },
  label: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600', textAlign: 'center' },
});
