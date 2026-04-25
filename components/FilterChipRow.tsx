// FilterChipRow — a horizontally-scrollable row of pill-shaped filter
// buttons. Used to filter long lists in Project Detail (RFIs, invoices,
// COs, DFRs, photos, etc.) by status, date range, or category.
//
// Stays consistent across the app: same pill shape, selected/unselected
// states, haptic on tap. Pass it `chips` and `value` and a setter — it
// handles the rest.
//
// Single-select model. For multi-select, render two of these stacked or
// branch into a separate component; we keep this primitive simple.
import React, { useCallback } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';

export interface FilterChip<T extends string = string> {
  /** Stable identifier — what gets passed back via onChange. */
  value: T;
  /** Visible label. Keep short ("All", "Open", "Last 30d", "$5k+"). */
  label: string;
  /** Optional count to render inside the chip ("Open · 3"). */
  count?: number;
  /** Optional accent color override for selected state. Defaults to primary. */
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
        const accent = chip.color ?? Colors.primary;
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
            <Text style={[styles.label, selected && { color: accent }]}>
              {chip.label}
            </Text>
            {chip.count !== undefined && (
              <View style={[styles.countBubble, selected && { backgroundColor: accent + '33' }]}>
                <Text style={[styles.countText, selected && { color: accent }]}>
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

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: Colors.fillSecondary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  countBubble: {
    backgroundColor: Colors.fillTertiary,
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
});
