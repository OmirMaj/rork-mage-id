import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { StaggerList, ThinkingDots } from '@/components/motion/kit';

interface ThinkingStatesProps {
  /** The labels of what this run works from, e.g. moat-teaching lines. */
  steps: string[];
  /** Whether the run is in flight. When false, nothing renders. */
  active: boolean;
  /** The calm dots above the steps. Default true; a host with its own dots
   *  (EstimateLoadingOverlay) passes false. */
  showDots?: boolean;
}

// Designed feedback, not a spinner — and not a fake progress clock. Every step
// shows at once, laid down top to bottom (the kit's StaggerList: the first 8
// new rows rise 8 pt, 35 ms apart, then the list holds). Nothing here times
// the steps: they are what this one AI call works from, not a sequence the app
// measures, so none of them is ever shown as "finished". The dots ride the
// kit's one shared native clock, so they keep moving while JS parses a long
// answer. Reduce Motion: the rows fade in together over 100 ms; the dots
// sit still.
export default function ThinkingStates({ steps, active, showDots = true }: ThinkingStatesProps) {
  const styles = useThemedStyles(makeStyles);

  if (!active || steps.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {showDots ? <ThinkingDots dotStyle={styles.dotTone} testID="thinking-states-dots" /> : null}
      <StaggerList
        items={steps}
        keyOf={(s) => s}
        armed={active}
        style={styles.list}
        renderItem={(s, _i, enter) => (
          <Animated.View style={[styles.row, enter]}>
            <View style={styles.dot} />
            <Text style={styles.label} numberOfLines={2}>{s}</Text>
          </Animated.View>
        )}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flexDirection: 'column', alignItems: 'center', gap: 8 },
  list: { gap: 6, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent },
  dotTone: { backgroundColor: t.accent },
  label: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600', flexShrink: 1 },
});
