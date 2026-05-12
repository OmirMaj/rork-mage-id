// ============================================================================
// components/PageHeader.tsx
//
// Unified page-header strip used at the top of every primary tab.
//
//   [ Title         status-pill ]      [ search   actions ]
//
// Phase 1.5: migrated to themed styles + Fraunces serif title + mono eyebrow.
// The title now uses Type.serifTitle for a more editorial feel that matches
// the marketing site. Theme-aware throughout.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet, TextInput, Platform, type ViewStyle } from 'react-native';
import { Search } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens, Spacing } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface PageHeaderProps {
  title: string;
  /** Optional inline chip rendered immediately right of the title (e.g. sync status). */
  statusPill?: React.ReactNode;
  /** Optional icon-button cluster on the right (bell, +, etc.). */
  actions?: React.ReactNode;
  /** When set, renders a non-interactive search field that calls this on focus / press. */
  onSearchPress?: () => void;
  /** Hides the inline search field — useful on tabs that don't need it. */
  hideSearch?: boolean;
  /** Optional override for the placeholder shown in the search field. */
  searchPlaceholder?: string;
  /** Optional one-line subtitle under the title (e.g. "Updated 4m ago"). */
  subtitle?: string;
  style?: ViewStyle;
}

const PageHeader = React.memo(function PageHeader({
  title,
  statusPill,
  actions,
  onSearchPress,
  hideSearch,
  searchPlaceholder = 'Search projects, invoices, RFIs…',
  subtitle,
  style,
}: PageHeaderProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const responsive = useResponsiveLayout();
  const showSearchField = !hideSearch && !responsive.isPhone;

  return (
    <View style={[styles.root, style]}>
      <View style={styles.left}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          {statusPill}
        </View>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={styles.right}>
        {showSearchField && onSearchPress ? (
          <View
            style={styles.searchField}
            onTouchEnd={onSearchPress}
            // @ts-expect-error — RN Web accepts onClick for div-equivalent surfaces
            onClick={Platform.OS === 'web' ? onSearchPress : undefined}
          >
            <Search size={15} color={colors.textMuted} strokeWidth={1.8} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textMuted}
              editable={false}
              pointerEvents="none"
              value=""
            />
            {Platform.OS === 'web' && (
              <View style={styles.kbdWrap}>
                <Text style={[styles.kbd, { color: colors.textSecondary }]}>⌘K</Text>
              </View>
            )}
          </View>
        ) : null}
        {actions}
      </View>
    </View>
  );
});

export default PageHeader;

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.md,
      gap: Spacing.md,
    },
    left: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    titleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      minWidth: 0,
    },
    title: {
      ...Type.serifTitle,
      flexShrink: 1,
    },
    subtitle: {
      fontSize: Type.footnote.fontSize,
      fontWeight: '500' as const,
    },
    right: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
    },
    searchField: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.line,
      minWidth: 240,
      maxWidth: 320,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
    },
    searchInput: {
      flex: 1,
      fontSize: Type.footnote.fontSize,
      padding: 0,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' as any, outlineStyle: 'none' as any } : {}),
    },
    kbdWrap: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: t.line,
    },
    kbd: {
      fontSize: 10,
      fontWeight: '600' as const,
      letterSpacing: 0.3,
    },
  });
