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
//   (`Colors.textMuted`) — color earns its way onto the screen by
//   communicating status, not decoration. Pass a specific tone only when
//   the row represents a stateful thing (e.g., Field Ops with active
//   work today gets `tone="primary"`; Money with overdue invoices gets
//   `tone="warning"`).

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export type NavRowTone =
  | 'neutral'
  | 'primary'      // brand green   — generic / brand actions
  | 'success'      // vivid green   — approvals, sign-offs
  | 'warning'      // orange        — time-sensitive, deadlines
  | 'error'        // red           — violations, expiries
  | 'info'         // blue          — documents, reports
  | 'accent'       // accent orange — sales / pipeline
  | 'violet'       // purple        — AI features
  | 'teal'         // teal          — estimates, change orders
  | 'rose'         // pink-rose     — people / directories
  | 'amber'        // gold          — permits / code
  | 'indigo'       // indigo        — insurance / claims
  | 'emerald'      // jewel green   — tax / money
  | 'sky';         // light blue    — discovery / explore

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

const TONE_COLORS: Record<NavRowTone, string> = {
  neutral: Colors.textSecondary,
  primary: Colors.primary,
  success: Colors.success,
  warning: Colors.warning,
  error: Colors.error,
  info: Colors.info,
  accent: Colors.accent,
  // Extended palette — each hue has a semantic anchor, never decorative.
  // Choices come from iOS system + Material A700 mid-tones tuned for the
  // 15%-alpha pale chip behind a 100%-opacity glyph (Apple's Settings
  // pattern). All readable on white surface.
  violet:  '#7C3AED',  // AI features
  teal:    '#0D9488',  // estimates / change orders
  rose:    '#E11D48',  // people / contacts
  amber:   '#D97706',  // permits / code citations
  indigo:  '#4F46E5',  // insurance / coverage
  emerald: '#059669',  // tax, draws, money export
  sky:     '#0284C7',  // discovery / explore
};

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
  const tint = TONE_COLORS[tone];

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
          <Text style={[Type.headline, { color: Colors.text }]} numberOfLines={1}>{title}</Text>
          {!!badge && (
            <View style={[styles.badge, { backgroundColor: tint + '15' }]}>
              <Text style={[Type.caption2, { color: tint, fontWeight: '700' }]}>{badge}</Text>
            </View>
          )}
        </View>
        {!!subtitle && (
          <Text style={[Type.footnote, { color: Colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>

      {!!meta && (
        <Text style={[Type.subhead, { color: Colors.textSecondary, marginRight: chevron ? 4 : 0 }]}>
          {meta}
        </Text>
      )}
      {chevron && <ChevronRight size={18} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
}

export const NavRow = memo(NavRowImpl);

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  iconSquare: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Tokens.radius.full,
  },
  disabled: { opacity: 0.45 },
});
