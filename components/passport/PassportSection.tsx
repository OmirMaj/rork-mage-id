// components/passport/PassportSection.tsx
//
// One labelled block inside the homeowner's Home Passport — an icon, a title,
// an optional count chip, and the rows. Purely presentational; every visual
// value comes from the design system (ThemeColors / Type / Tokens).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export function PassportSection({
  title,
  icon: Icon,
  count,
  emptyLabel,
  moreLabel,
  children,
}: {
  title: string;
  icon: LucideIcon;
  /** Total records in this section — shown as a chip next to the title. */
  count?: number;
  /** Rendered instead of children when there is nothing to show. */
  emptyLabel?: string;
  /** "+3 more" style trailer when the caller truncated the list. */
  moreLabel?: string;
  children?: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeSectionStyles);
  const isEmpty = count != null ? count === 0 : !children;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Icon size={Tokens.iconSize.small.size} color={t.accent} strokeWidth={2} />
        <Text style={styles.title}>{title}</Text>
        {count != null ? (
          <View style={styles.countChip}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {isEmpty ? (
        <Text style={styles.empty}>{emptyLabel ?? 'Nothing on record yet.'}</Text>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
      {!isEmpty && moreLabel ? <Text style={styles.more}>{moreLabel}</Text> : null}
    </View>
  );
}

/** A single record line: primary label, supporting line, and a trailing chip. */
export function PassportRow({
  label,
  detail,
  trailing,
  trailingTone = 'neutral',
  icon: Icon,
}: {
  label: string;
  detail?: string;
  trailing?: string;
  trailingTone?: 'neutral' | 'good' | 'warn' | 'bad';
  icon?: LucideIcon;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeSectionStyles);
  const tone = {
    neutral: { fg: t.textSecondary, bg: t.surfaceAlt },
    good: { fg: t.success, bg: t.successSoft },
    warn: { fg: t.warningLabel, bg: t.warningSoft },
    bad: { fg: t.dangerLabel, bg: t.dangerSoft },
  }[trailingTone];

  return (
    <View style={styles.row}>
      {Icon ? (
        <Icon size={Tokens.iconSize.small.size} color={t.textMuted} strokeWidth={2} />
      ) : null}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {detail ? <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {trailing ? (
        <View style={[styles.rowChip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.rowChipText, { color: tone.fg }]} numberOfLines={1}>{trailing}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeSectionStyles = (t: ThemeColors) =>
  StyleSheet.create({
    section: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      ...Tokens.continuousCorners,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.sm,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    title: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      fontWeight: '700',
      flex: 1,
    },
    countChip: {
      minWidth: 22,
      alignItems: 'center',
      paddingHorizontal: Tokens.spacing.xxs + 2,
      paddingVertical: 1,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.surfaceAlt,
    },
    countText: { ...Type.caption2, color: t.textSecondary, fontWeight: '700' },
    body: { marginTop: Tokens.spacing.xs },
    empty: { ...Type.footnote, color: t.textMuted, marginTop: Tokens.spacing.xxs },
    more: { ...Type.caption1, color: t.textMuted, marginTop: Tokens.spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.xs,
      paddingVertical: Tokens.spacing.xxs + 2,
    },
    rowText: { flex: 1, gap: 1 },
    rowLabel: { ...Type.footnoteEmphasized, color: t.text },
    rowDetail: { ...Type.caption1, color: t.textSecondary },
    rowChip: {
      paddingHorizontal: Tokens.spacing.xs,
      paddingVertical: 3,
      borderRadius: Tokens.radius.full,
      maxWidth: 132,
    },
    rowChipText: { ...Type.caption2, fontWeight: '700' },
  });

export default PassportSection;
