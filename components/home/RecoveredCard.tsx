// components/home/RecoveredCard.tsx
//
// The receipt for the subscription. ReadyToBillCard says "here's what to send";
// this says "here's what you already collected because MAGE was watching."
//
// It is the answer to the only question that matters at renewal — "is this thing
// worth $29 a month?" — and it answers with a number the contractor can check
// against their own bank account rather than a feature list.
//
// The discipline lives in utils/recoveredValue: a change order counts here ONLY
// if MAGE drafted it from a profit-leak scan AND the owner approved it. COs the
// contractor wrote themselves are their win, not ours. Nothing here is an
// estimate, a projection, or a "potential" — every dollar shown was signed.
//
// Self-hides until there is a real win to report, because a card that says
// "$0 recovered" on day one teaches the user to ignore it forever.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, TrendingUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import { computeRecoveredValue, recoveredPendingLine } from '@/utils/recoveredValue';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/** Rolling window. A lifetime total only ever grows, which makes it noise. */
const WINDOW_DAYS = 90;
const MAX_VISIBLE = 3;

export default function RecoveredCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { changeOrders, projects } = useProjects();

  const recovered = useMemo(
    () => computeRecoveredValue(projects, changeOrders, {
      windowDays: WINDOW_DAYS,
      nowISO: new Date().toISOString(),
    }),
    [projects, changeOrders],
  );

  // Nothing earned yet → render nothing. See the header note.
  if (recovered.count === 0) return null;

  const pendingLine = recoveredPendingLine(recovered);
  const visible = recovered.rows.slice(0, MAX_VISIBLE);
  const overflow = recovered.rows.length - visible.length;

  const open = (projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push({ pathname: '/change-order', params: { projectId } } as never);
  };

  return (
    <View style={styles.card} testID="recovered-card">
      <View style={styles.header}>
        <MageAIMark size={15} color={colors.accent} />
        <Text style={styles.eyebrow}>Found by MAGE · last 90 days</Text>
      </View>

      <View style={styles.moneyRow}>
        <TrendingUp size={20} color={colors.success} strokeWidth={2.25} />
        <Text style={styles.money}>{formatMoney(recovered.total)}</Text>
      </View>
      <Text style={styles.sub}>
        billed from {recovered.count} change order{recovered.count === 1 ? '' : 's'} MAGE drafted off
        your job-site notes — approved and signed by your client.
      </Text>

      {pendingLine ? <Text style={styles.pending}>{pendingLine}</Text> : null}

      <View style={styles.list}>
        {visible.map(r => (
          <TouchableOpacity
            key={r.id}
            style={styles.row}
            onPress={() => open(r.projectId)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Change order ${r.coNumber} on ${r.projectName}, ${formatMoney(r.amount)}`}
          >
            <Text style={styles.rowName} numberOfLines={1}>
              CO #{r.coNumber} · {r.projectName}
            </Text>
            <Text style={styles.rowAmount}>{formatMoney(r.amount)}</Text>
            <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        ))}
        {overflow > 0 && (
          <Text style={styles.overflow}>+{overflow} more</Text>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.md,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: Tokens.spacing.sm },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.9,
    },
    moneyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    money: { ...Type.title1, color: t.text },
    sub: { ...Type.footnote, color: t.textSecondary, marginTop: 4, lineHeight: 19 },
    pending: { ...Type.footnote, color: t.accent, marginTop: 8, fontWeight: '600' },
    list: { marginTop: Tokens.spacing.md, gap: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    rowName: { ...Type.subhead, color: t.text, flex: 1 },
    rowAmount: { ...Type.subheadEmphasized, color: t.success },
    overflow: { ...Type.caption1, color: t.textMuted, paddingTop: 8 },
  });
