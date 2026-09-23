// EstimateJobPicker — the inline "which job?" chip row for estimating screens
// that the Estimate hub, the Summary tools sheet and the web sidebar push with
// no projectId (audit #87).
//
// Estimate Risk and Bid vs Actual opened on "Project not found" with Back as
// the only action, and Visual Takeoff could measure a floor but never add it.
// Each screen now defaults to a job (utils/estimateLanding.pickEstimateProject)
// and shows this row so he can switch without backing out. The row only
// offers jobs the screen can do something with (estimateProjectCandidates).

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { cardSurface } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface EstimateJobPickerProps {
  label: string;
  jobs: { id: string; name: string }[];
  selectedId: string | undefined;
  onPick: (id: string) => void;
  testID?: string;
}

export default function EstimateJobPicker({ label, jobs, selectedId, onPick, testID }: EstimateJobPickerProps) {
  const styles = useThemedStyles(makeStyles);
  if (jobs.length === 0) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        {jobs.map(j => {
          const on = j.id === selectedId;
          return (
            <TouchableOpacity
              key={j.id}
              onPress={() => onPick(j.id)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={testID ? `${testID}-${j.id}` : undefined}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{j.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const, marginBottom: 6 },
  row: { gap: 8 },
  chip: {
    ...cardSurface(t, { radius: 'full', pad: 'none' }),
    paddingHorizontal: 12, paddingVertical: 7, maxWidth: 200,
  },
  chipOn: { backgroundColor: t.accent + '1A', borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  chipTextOn: { color: t.accent },
});
