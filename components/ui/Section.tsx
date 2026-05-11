// Section — titled stack primitive.
//
// Used at the top of every screen group and every modal body. Standard
// shape: small uppercase eyebrow + title + optional subtitle + optional
// "See all" right action, then stacked children below.
//
// Replaces ~30 local `function Section(...)` definitions scattered
// across the app (e.g. inline in tools/index.tsx, project-detail.tsx,
// dashboard-hero, settings screens). Each one has drift: some use
// Type.title3, some use bare 18pt; some put the eyebrow above the
// title, others omit it; some right-align a "See all" link, others
// don't.
//
// Section just lays out the header + child stack. Children that are
// rows should be NavRows; children that are tiles should be Cards.

import React, { memo, type ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface SectionRightAction {
  /** Short verb or phrase ("See all", "Edit", "Add"). */
  label: string;
  onPress: () => void;
  testID?: string;
}

export interface SectionProps {
  /** Required title. Rendered in Type.title3. */
  title: string;
  /** Small uppercase tag above the title. Use for categorical labels
   *  ("AI HUB", "MONEY"). Skip for screen-section headers. */
  eyebrow?: string;
  /** Subtitle below the title. Use sparingly — most sections don't need it. */
  subtitle?: string;
  /** Optional right-side action ("See all", "Edit"). */
  rightAction?: SectionRightAction;
  /** Vertical gap between children. Defaults to "sm" (12pt). Pass "none"
   *  for flush stacks (e.g. a list of NavRows inside a flat Card). */
  spacing?: keyof typeof Tokens.spacing | number | 'none';
  /** Vertical gap between the header and the first child. Defaults to
   *  "md" (16pt). */
  headerGap?: keyof typeof Tokens.spacing | number;
  /** Style override for the outer container. */
  style?: StyleProp<ViewStyle>;
  /** testID for E2E. */
  testID?: string;
  children?: ReactNode;
}

function resolveSpacing(s: SectionProps['spacing']): number {
  if (s === undefined) return Tokens.spacing.sm;
  if (s === 'none') return 0;
  if (typeof s === 'number') return s;
  return Tokens.spacing[s];
}
function resolveHeaderGap(s: SectionProps['headerGap']): number {
  if (s === undefined) return Tokens.spacing.md;
  if (typeof s === 'number') return s;
  return Tokens.spacing[s];
}

function SectionImpl({
  title,
  eyebrow,
  subtitle,
  rightAction,
  spacing,
  headerGap,
  style,
  testID,
  children,
}: SectionProps) {
  const gap = resolveSpacing(spacing);
  const headGap = resolveHeaderGap(headerGap);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          {eyebrow ? (
            <Text
              style={[Type.eyebrow, { color: Colors.textSecondary }]}
              accessibilityRole="text"
            >
              {eyebrow}
            </Text>
          ) : null}
          <Text
            style={[Type.title3, { color: Colors.text }]}
            accessibilityRole="header"
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[Type.footnote, { color: Colors.textSecondary, marginTop: 2 }]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {rightAction ? (
          <Pressable
            onPress={rightAction.onPress}
            hitSlop={8}
            style={({ pressed }) => [
              styles.rightAction,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={rightAction.label}
            testID={rightAction.testID ?? 'section-right-action'}
          >
            <Text
              style={[Type.subheadEmphasized, { color: Colors.accent }]}
            >
              {rightAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          marginTop: headGap,
          gap: gap > 0 ? gap : undefined,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export const Section = memo(SectionImpl);

const styles = StyleSheet.create({
  container: {
    // Sections don't carry their own padding — the screen / Sheet owns
    // outer padding so Sections stack cleanly without doubled spacing.
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Tokens.spacing.sm,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  rightAction: {
    paddingVertical: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.xs,
  },
  pressed: {
    opacity: 0.55,
  },
});
