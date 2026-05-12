// FilterChipRow — a horizontally-scrollable row of pill-shaped filter buttons.
//
// Stays consistent across the app: same pill shape, selected/unselected states,
// haptic on tap. Phase 1.5: themed via useTheme, selected state uses accent.

import React, { useCallback } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

export interface FilterChip<T extends string = string> {
  /** Stable identifier — what gets passed back via onChange. */
  value: T;
  /** Visible label. Keep short ("All", "Open", "Last 30d", "$5k+"). */
  label: string;
  /** Optional count to render inside the chip ("Open · 3"). */
  count?: number;
  /** Optional accent color override for selected state. Defaults to theme accent. */
  color?: string;
}

interface FilterChipRowProps<T extends string = string> {
  chips: FilterChip<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Hide the horizontal scroll indicator. Default true. */
  hideScrollIndicator?: boolean;
  /** Render with no horizontal padding (caller controls spacing). */
  noPadding?: boolean;
  testID?: string;
}

export default function FilterChipRow<T extends string = string>({
  chips,
  value,
  onChange,
  hideScrollIndicator = true,
  noPadding = false,
  testID,
}: FilterChipRowProps<T>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const handlePress = useCallback((next: T) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onChange(next);
  }, [onChange]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={!hideScrollIndicator}
      contentContainerStyle={[styles.row, noPadding && { paddingHorizontal: 0 }]}
      testID={testID}
    >
      {chips.map(chip => {
        const selected = chip.value === value;
        const accent = chip.color ?? colors.accent;
        return (
          <TouchableOpacity
            key={chip.value}
            onPress={() => handlePress(chip.value)}
            style={[
              styles.chip,
              selected && {
                backgroundColor: accent + '18',
                borderColor: accent,
              },
            ]}
            activeOpacity={0.7}
            testID={`${testID ?? 'chip'}-${chip.value}`}
          >
            <Text style={[styles.label, { color: selected ? accent : colors.textSecondary }]}>
              {chip.label}
            </Text>
            {chip.count !== undefined && (
              <View style={[styles.countBubble, selected && { backgroundColor: accent + '33' }]}>
                <Text style={[styles.countText, { color: selected ? accent : colors.textSecondary }]}>
                  {chip.count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center' as const,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  label: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
  },
  countBubble: {
    backgroundColor: t.line,
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
});
