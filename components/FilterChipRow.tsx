// FilterChipRow — a horizontally-scrollable row of pill-shaped filter buttons.
//
// Stays consistent across the app: same pill shape, selected/unselected states,
// haptic on tap. Phase 1.5: themed via useTheme, selected state uses accent.
//
// DESKTOP (wave 6b). A mouse wheel cannot move a horizontal ScrollView, and
// this rail hid its scrollbar — so on a desktop the chips past the right edge
// were unreachable and nothing said they existed. Behind the desktop gate the
// rail renders a WRAPPING row instead (every chip visible, every chip
// clickable), chips size to their content (height 32, max 240). A rail that
// can grow without bound (report-inbox's per-project chips) shows the first
// `desktopMaxChips` plus the selected one, and a "N more" chip that reveals the
// rest — a disclosure rather than a menu, so nothing is ever out of reach.
// The phone keeps the ScrollView exactly as before (same tree, same styles).

import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useIsDesktop } from '@/components/ui/desktop';
import { chipDesktop, chipRailDesktop } from '@/components/ui/ChipRail';

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
  /** Desktop only: past this many chips the rest fold behind a "N more" chip.
   *  Default 12. The selected chip is always shown. */
  desktopMaxChips?: number;
  testID?: string;
}

/** Which chips a desktop rail shows: the first `max`, plus the selected chip if
 *  it sits past the fold. Everything when expanded or when it all fits. */
export function visibleDesktopChips<T extends string>(
  chips: FilterChip<T>[],
  value: T,
  max: number,
  expanded: boolean,
): { shown: FilterChip<T>[]; hidden: number } {
  if (expanded || chips.length <= max) return { shown: chips, hidden: 0 };
  const shown = chips.slice(0, Math.max(1, max - 1));
  const selected = chips.find((c) => c.value === value);
  if (selected && !shown.includes(selected)) shown.push(selected);
  return { shown, hidden: chips.length - shown.length };
}

export default function FilterChipRow<T extends string = string>({
  chips,
  value,
  onChange,
  hideScrollIndicator = true,
  noPadding = false,
  desktopMaxChips = 12,
  testID,
}: FilterChipRowProps<T>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isDesktop = useIsDesktop();
  const [expanded, setExpanded] = useState(false);

  const handlePress = useCallback((next: T) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onChange(next);
  }, [onChange]);

  if (isDesktop) {
    const { shown, hidden } = visibleDesktopChips(chips, value, desktopMaxChips, expanded);
    const foldable = chips.length > desktopMaxChips;
    return (
      <View style={[styles.row, chipRailDesktop, noPadding && { paddingHorizontal: 0 }]} testID={testID}>
        {shown.map(chip => {
          const selected = chip.value === value;
          const accent = chip.color ?? colors.accent;
          return (
            <TouchableOpacity
              key={chip.value}
              onPress={() => handlePress(chip.value)}
              style={[
                styles.chip,
                chipDesktop,
                selected && {
                  backgroundColor: accent + '18',
                  borderColor: accent,
                },
              ]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`${testID ?? 'chip'}-${chip.value}`}
            >
              <Text numberOfLines={1} style={[styles.label, { color: selected ? accent : colors.textSecondary }]}>
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
        {foldable && (
          <TouchableOpacity
            onPress={() => setExpanded(e => !e)}
            style={[styles.chip, chipDesktop]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            testID={`${testID ?? 'chip'}-more`}
          >
            <Text numberOfLines={1} style={[styles.label, { color: colors.textSecondary }]}>
              {expanded ? 'Show fewer' : `${hidden} more`}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

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
