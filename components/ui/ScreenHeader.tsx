// components/ui/ScreenHeader.tsx — ONE header. Three doors into it.
//
// WHY THIS EXISTS (2026-09-07 app-experience audit, "worth doing" 1).
//
// The app had three separately-maintained header components covering ~58
// screens between them, and they had drifted on every axis that makes a header
// feel like the same product twice:
//
//   components/PageHeader.tsx        Fraunces 28, h1, search field, status pill
//   components/FeatureHeader.tsx     Fraunces 22, h1, eyebrow, (?) chip, subtitle
//   components/ToolScreenChrome.tsx  system sans 17/700, NO h1, back chevron,
//                                    its own eyebrow metrics, a bottom rule
//
// Two of the three opened in anonymous bold sans until this audit counted the
// drift; only one promoted its title to an <h1> on web; and the eyebrow above
// the title was 11/700/1.4 in one and 11/600/0.4 in another for no reason
// anybody could name. Fixing them one at a time is what produced the split in
// the first place — the surrounding screens keep resetting the impression.
//
// So the STRUCTURE, the a11y contract, the serif rule and the spacing live here
// exactly once. The three modules above are now thin adapters that keep their
// public props (they have ~58 importers between them, and a mechanical import
// rewrite is a separate, reviewable change) and render this.
//
// Variants differ ONLY where the row genuinely differs:
//
//   'page'     a tab masthead. No back affordance — a tab is a root. Serif 28,
//              optional inline status pill, an optional non-interactive search
//              field on wide screens, an actions cluster.
//   'feature'  an in-screen "what is this screen" header. Serif 22, an eyebrow
//              for the formal industry term, a one-line plain-English subtitle,
//              and an optional (?) chip that opens an explainer.
//   'tool'     the same header with a back chevron on the left and a hairline
//              under it. Serif 22 — constants/typography.ts sizes
//              `serifHeadline` for exactly this row.
//
// Pinned by scripts/validate-type-identity.ts.

import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, type ViewStyle } from 'react-native';
import { Search, ChevronLeft, HelpCircle } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens, Spacing } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

export type ScreenHeaderVariant = 'page' | 'feature' | 'tool';

export interface ScreenHeaderProps {
  title: string;
  variant?: ScreenHeaderVariant;
  /** Tiny uppercase context line above the title (formal term, "AI PUNCH · MAGE ID"). */
  eyebrow?: string;
  /** One line under the title. */
  subtitle?: string;
  /** Inline chip immediately right of the title (e.g. sync status). 'page' only. */
  statusPill?: React.ReactNode;
  /** Right-hand cluster: icon buttons on 'page', a single action on 'tool'. */
  actions?: React.ReactNode;
  /** Renders the back chevron. 'tool' only — a tab is a root and never gets one. */
  onBack?: () => void;
  /** Renders a (?) chip that calls this. */
  onExplainerPress?: () => void;
  /** Non-interactive search field on wide screens. 'page' only. */
  onSearchPress?: () => void;
  hideSearch?: boolean;
  searchPlaceholder?: string;
  /** Hairline under the header. Defaults on for 'tool', off elsewhere. */
  rule?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function ScreenHeader({
  title,
  variant = 'feature',
  eyebrow,
  subtitle,
  statusPill,
  actions,
  onBack,
  onExplainerPress,
  onSearchPress,
  hideSearch,
  searchPlaceholder = 'Search projects, invoices, RFIs…',
  rule,
  style,
  testID,
}: ScreenHeaderProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const responsive = useResponsiveLayout();

  const isPage = variant === 'page';
  const isTool = variant === 'tool';
  const showSearchField = isPage && !hideSearch && !responsive.isPhone && !!onSearchPress;
  const showRule = rule ?? isTool;
  // An empty right column is still a flex item, so the root's `gap` would
  // reserve 12-16pt of trailing space on every header that has no actions —
  // which is most of them, and would silently narrow every title by that much.
  const hasRight = showSearchField || !!onExplainerPress || !!actions || isTool;

  return (
    <View
      style={[
        styles.root,
        isPage ? styles.rootPage : isTool ? styles.rootTool : styles.rootFeature,
        showRule && styles.rule,
        style,
      ]}
      testID={testID}
    >
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="tool-header-back"
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.textCol}>
        {eyebrow ? (
          <Text style={[Type.eyebrow, { color: colors.textMuted }]} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <View style={styles.titleRow}>
          {/* Audit-2026-05-21 W2 (HIGH): accessibilityRole="header" +
              aria-level=1 promotes this to an <h1> on web. Pre-fix every page
              rendered with NO h1, killing reader-mode, screen readers, browser
              bookmarks and SEO. Native ignores both. It used to be on two of
              the three headers; here every screen inherits it.

              Fraunces, never fontWeight: constants/typography.ts's rule is that
              a SCREEN TITLE is the serif, and Fraunces_700Bold already carries
              its weight — an override makes the platform synthesise a fake bold
              on top of a real one. */}
          <Text
            style={[isPage ? Type.serifTitle : Type.serifHeadline, styles.title, { color: colors.text }]}
            numberOfLines={isPage || isTool ? 1 : 2}
            accessibilityRole="header"
            aria-level={1 as never}
          >
            {title}
          </Text>
          {isPage ? statusPill : null}
        </View>
        {subtitle ? (
          <Text
            style={[isPage ? styles.subtitlePage : styles.subtitleFeature, { color: colors.textSecondary }]}
            numberOfLines={isPage ? 1 : undefined}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {hasRight ? (
      <View style={styles.right}>
        {showSearchField ? (
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
        {onExplainerPress ? (
          <TouchableOpacity
            onPress={onExplainerPress}
            activeOpacity={0.7}
            style={styles.chip}
            testID={testID ? `${testID}-explainer-chip` : 'feature-header-chip'}
            accessibilityRole="button"
            accessibilityLabel={`Learn more about ${title}`}
          >
            <HelpCircle size={16} color={colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        ) : null}
        {actions}
        {/* A tool header with no action still needs the spacer, or the title
            sits off-centre against the back chevron. */}
        {isTool && !actions && !onExplainerPress ? <View style={styles.backBtn} /> : null}
      </View>
      ) : null}
    </View>
  );
}

export default ScreenHeader;

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: {
      flexDirection: 'row' as const,
      minWidth: 0,
    },
    rootPage: {
      alignItems: 'center' as const,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.md,
      gap: Spacing.md,
    },
    rootFeature: {
      alignItems: 'flex-start' as const,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
      gap: Spacing.sm,
    },
    rootTool: {
      alignItems: 'center' as const,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    rule: {
      borderBottomWidth: 1,
      borderBottomColor: t.line,
    },
    backBtn: {
      width: 38,
      height: 38,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    textCol: {
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
      flexShrink: 1,
    },
    subtitlePage: {
      fontSize: Type.footnote.fontSize,
      fontWeight: '500' as const,
    },
    subtitleFeature: {
      ...Type.subhead,
      marginTop: 2,
    },
    right: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
    },
    chip: {
      width: 32,
      height: 32,
      borderRadius: Tokens.radius.panel,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: t.surfaceAlt,
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
