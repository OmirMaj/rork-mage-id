// ============================================================================
// components/PageHeader.tsx
//
// Unified page-header strip used at the top of every primary tab. Replaces
// the old pattern of two stacked rows (a "navBar" with logo + icons, then a
// separate large title underneath) with a single horizontal toolbar:
//
//   [ Title         status-pill ]      [ search   actions ]
//
// Models the SaaS-dashboard reference the user shared (Nexus Corp), where
// section title + freshness chip live on the left and search + actions live
// on the right, all in one row. Reads as a real toolbar instead of two
// disconnected rows of UI.
//
// On phone widths the search input collapses into the actions stack so
// nothing wraps. The search slot is optional — pass `null` to omit.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet, TextInput, Platform, type ViewStyle } from 'react-native';
import { Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

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
  const responsive = useResponsiveLayout();
  // Search field only renders inline on tablet+ widths. On phone we let
  // the existing icon-button in the actions cluster handle search so the
  // header doesn't wrap.
  const showSearchField = !hideSearch && !responsive.isPhone;

  return (
    <View style={[styles.root, style]}>
      <View style={styles.left}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {statusPill}
        </View>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={styles.right}>
        {showSearchField && onSearchPress ? (
          <View
            style={styles.searchField}
            onTouchEnd={onSearchPress}
            // @ts-expect-error — RN Web accepts onClick for div-equivalent surfaces
            onClick={Platform.OS === 'web' ? onSearchPress : undefined}
          >
            <Search size={15} color={Colors.textMuted} strokeWidth={1.8} />
            <TextInput
              style={styles.searchInput}
              placeholder={searchPlaceholder}
              placeholderTextColor={Colors.textMuted}
              editable={false}
              pointerEvents="none"
              value=""
            />
            {Platform.OS === 'web' && (
              <View style={styles.kbdWrap}>
                <Text style={styles.kbd}>⌘K</Text>
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

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 16,
  },
  left: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  // PageHeader title — used across 50+ feature screens. Pre-fix this
  // was Apple HIG Title1 in SF Pro. Switched to Fraunces display so
  // every feature surface carries the brand voice (matches Summary /
  // Tools / Discover / AI Hub heading treatment).
  title: {
    ...Type.displaySm,
    color: Colors.ink,
    flexShrink: 1,
  },
  subtitle: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Inline search field — looks like an input but is actually a button that
  // opens the universal search palette. Editable={false} + pointerEvents=none
  // on the TextInput ensures keyboard doesn't open; the onTouchEnd fires
  // openSearch instead. Reads as a search box, behaves as a CTA.
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillTertiary,
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.08)',
    minWidth: 240,
    maxWidth: 320,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  searchInput: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: Colors.text,
    padding: 0,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any, outlineStyle: 'none' as any } : {}),
  },
  kbdWrap: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(60,60,67,0.08)',
  },
  kbd: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.3,
  },
});
