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
//   - "list"  (default): a Plain-trade row — glyph column, name, one-line
//             description, hairline on top. No surface of its own: it sits on
//             whatever ground the list is on.
//   - "card":            the same content as one standalone bordered link
//             (a door from one screen to another, not a row in a tool list).
//
// PLAIN TRADE (2026-10-05, components/ui/toolList.tsx owns the numbers). The
// leading icon is a 24 pt single-ink glyph at stroke 2 with no chip behind it.
// A row can NOT choose a hue: `tone` used to pick the chip tint, each caller
// set it by hand, and on Tools that made "Photo triage" blue and "Punch list"
// green for no reason a contractor could read. The prop is still accepted so
// callers compile, and it is ignored. Green shows only while the row is
// pressed (glyph + name turn `accentLabel`, the row fills `surfaceAlt`).
// A locked row is hatched and carries its tier as a mono tag at the right.
// Pinned by scripts/validate-tool-list.ts.

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import {
  ToolGlyph, ToolLockTag, toolListStyles, toolChevronColor,
  TOOL_CHEVRON_SIZE, TOOL_CHEVRON_OPACITY,
} from '@/components/ui/toolList';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

export type NavRowTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface NavRowProps {
  /** Icon component rendered in the leading glyph column. Accepts lucide icons
   *  AND the bespoke Mage glyph set — those are plain function components, so
   *  the narrower `LucideIcon` ForwardRef type rejected them and every caller
   *  of this row was forced back onto stock lucide. Same widening, for the
   *  same reason, as components/DesktopSidebar.tsx:39. */
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  /** Primary text. Required. */
  title: string;
  /** Secondary text under the title. Optional. */
  subtitle?: string;
  /** Right-side meta — count, status, "Pro", whatever. Optional. */
  meta?: string;
  /** Pill-shaped badge to the right of the title (e.g. "3 new"). Optional. */
  badge?: string;
  /** IGNORED. Kept so existing callers compile; a row never picks a hue. */
  tone?: NavRowTone;
  /** Locked behind a plan or a role: the glyph is hatched and muted, and
   *  `meta` (the tier) is drawn as a mono tag with a lock. The row still
   *  opens — its destination is the gate. */
  locked?: boolean;
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

function NavRowImpl({
  Icon,
  title,
  subtitle,
  meta,
  badge,
  locked = false,
  variant = 'list',
  chevron = true,
  onPress,
  disabled = false,
  style,
  testID,
}: NavRowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        variant === 'card' ? styles.card : styles.list,
        pressed && (variant === 'card' ? styles.cardPressed : styles.listPressed),
        disabled && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {({ pressed }) => (
        <>
          <ToolGlyph Icon={Icon} locked={locked} color={pressed ? colors.accentLabel : undefined} />

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, pressed && { color: colors.accentLabel }]} numberOfLines={1}>{title}</Text>
              {!!badge && (
                <Text style={[Type.caption2, styles.badge]}>{badge}</Text>
              )}
            </View>
            {!!subtitle && (
              <Text style={styles.subtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            )}
          </View>

          {!!meta && (locked ? (
            <ToolLockTag label={meta} />
          ) : (
            <Text style={[Type.subhead, { color: colors.textSecondary, marginRight: chevron ? 4 : 0 }]}>
              {meta}
            </Text>
          ))}
          {chevron && (
            <ChevronRight
              size={TOOL_CHEVRON_SIZE}
              color={toolChevronColor(colors)}
              strokeWidth={1.75}
              style={{ opacity: TOOL_CHEVRON_OPACITY }}
            />
          )}
        </>
      )}
    </Pressable>
  );
}

export const NavRow = memo(NavRowImpl);

const makeStyles = (t: ThemeColors) => {
  const tool = toolListStyles(t);
  return StyleSheet.create({
    list: tool.row,
    listPressed: tool.rowPressed,
    card: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.lg,
      borderWidth: 1,
      borderColor: t.line,
    },
    cardPressed: { backgroundColor: t.surfaceAlt },
    body: tool.body,
    titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
    title: tool.name,
    subtitle: tool.desc,
    // A word beside the name ("3 new"): mono-weight ink, no pill behind it.
    badge: { color: t.textSecondary, fontWeight: '700' as const },
    disabled: { opacity: 0.45 },
  });
};
