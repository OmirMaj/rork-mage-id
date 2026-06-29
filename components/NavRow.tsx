// NavRow — the shared "tap-to-navigate" row used across the app.
//
// Audit found this same atom (icon-square + title + subtitle + optional
// badge + chevron) implemented 5+ times in different files: Project
// Detail tiles, Settings rows, Discover NavigationCards, Notifications
// inbox rows, Report inbox rows. Each has its own JSX, its own styles,
// and they drift visually. One shared component fixes the whole set at
// once and locks consistency forever.
//
// Variants:
//   - "list"  (default): full-width row inside a grouped list, with a
//             leading icon-square and trailing chevron. iOS Settings vibe.
//   - "card":            same content, rendered as a card with rounded
//             corners and a subtle border. Used in dashboards.
//
// Tone:
//   `tone` controls the icon-square color tint. Defaults to neutral
//   — color earns its way onto the screen by communicating status, not
//   decoration. Pass a specific tone only when the row represents a
//   stateful thing (e.g., Field Ops with active work today gets
//   `tone="primary"`; Money with overdue invoices gets `tone="warning"`).

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

export type NavRowTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface NavRowProps {
  /** Lucide icon component — rendered in the leading icon square. */
  Icon: LucideIcon;
  /** Primary text. Required. */
  title: string;
  /** Secondary text under the title. Optional. */
  subtitle?: string;
  /** Right-side meta — count, status, "Pro", whatever. Optional. */
  meta?: string;
  /** Pill-shaped badge to the right of the title (e.g. "3 new"). Optional. */
  badge?: string;
  /** Tone for the icon square. Defaults to neutral grayscale. */
  tone?: NavRowTone;
  /** Visual variant. */
  variant?: 'list' | 'card';
  /** Show the trailing chevron? Defaults to true. */
  chevron?: boolean;
  /** Tap handler. */
  onPress: () => void;
  /** Disable the row. */
  disabled?: boolean;
  /** Optional style override. */
  style?: ViewStyle;
  /** testID for testing / E2E. */
  testID?: string;
}

function toneColor(t: ThemeColors, tone: NavRowTone): string {
  switch (tone) {
    case 'primary':
    case 'accent':
      return t.accent;
    case 'success':
      return t.success;
    case 'warning':
      return t.accent;
    case 'error':
      return t.danger;
    case 'info':
      return t.info;
    case 'neutral':
    default:
      return t.textSecondary;
  }
}

function NavRowImpl({
  Icon,
  title,
  subtitle,
  meta,
  badge,
  tone = 'neutral',
  variant = 'list',
  chevron = true,
  onPress,
  disabled = false,
  style,
  testID,
}: NavRowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tint = toneColor(colors, tone);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      disabled={disabled}
      style={[
        variant === 'card' ? styles.card : styles.list,
        disabled && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      <View style={[styles.iconSquare, { backgroundColor: tint + '15' }]}>
        <Icon size={20} color={tint} strokeWidth={2} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[Type.headline, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          {!!badge && (
            <View style={[styles.badge, { backgroundColor: tint + '15' }]}>
              <Text style={[Type.caption2, { color: tint, fontWeight: '700' }]}>{badge}</Text>
            </View>
          )}
        </View>
        {!!subtitle && (
          <Text style={[Type.footnote, { color: colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>

      {!!meta && (
        <Text style={[Type.subhead, { color: colors.textSecondary, marginRight: chevron ? 4 : 0 }]}>
          {meta}
        </Text>
      )}
      {chevron && <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} />}
    </TouchableOpacity>
  );
}

export const NavRow = memo(NavRowImpl);

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    list: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: t.surface,
    },
    card: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.lg,
      borderWidth: 1,
      borderColor: t.line,
    },
    iconSquare: {
      width: 36,
      height: 36,
      borderRadius: Tokens.radius.md,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    body: { flex: 1, minWidth: 0 },
    titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    badge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: Tokens.radius.full,
    },
    disabled: { opacity: 0.45 },
  });
