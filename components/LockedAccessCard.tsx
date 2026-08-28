// LockedAccessCard — the placeholder a financial surface shows to a field-role
// collaborator. Honest, calm, and non-accusatory: field access is a feature the
// GC turned on, not a permission the user got caught lacking. Used anywhere
// costs/margins are blinded (utils/roleBlinding).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  /** What's hidden, e.g. "Job costing" or "Margin". Keeps the message specific. */
  what?: string;
  /** Optional override for the explanatory line. */
  detail?: string;
  style?: object;
}

export default function LockedAccessCard({ what = 'Financials', detail, style }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, style]} testID="locked-access-card">
      <View style={styles.iconWrap}>
        <LockKeyhole size={20} color={styles.icon.color} strokeWidth={1.75} />
      </View>
      <Text style={styles.title}>{what} is hidden on field access</Text>
      <Text style={styles.detail}>
        {detail ??
          'You have field access to this project — schedule, tasks, daily reports, photos and RFIs. Costs and margins stay with the project owner.'}
      </Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    padding: 20,
    alignItems: 'center' as const,
    gap: 8,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 2,
  },
  icon: { color: t.textMuted },
  title: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    textAlign: 'center' as const,
  },
  detail: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 18,
    textAlign: 'center' as const,
  },
});
