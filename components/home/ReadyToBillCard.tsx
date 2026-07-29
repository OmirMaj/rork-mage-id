// components/home/ReadyToBillCard.tsx
//
// The payoff prompt for the leak→CO autonomy. The Brain drafts change orders
// from job-site notes; this pulls every draft-status CO across all projects
// into one money line on home — "$X in change orders ready to send" — so the
// revenue MAGE found actually gets billed. Self-hides when nothing's waiting.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { FileSignature, ChevronRight } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import { buildReadyToBill } from '@/utils/draftedRevenue';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const MAX_VISIBLE = 4;

export default function ReadyToBillCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { changeOrders, projects } = useProjects();

  const ready = useMemo(
    () => buildReadyToBill({ changeOrders, projects, nowMs: Date.now() }),
    [changeOrders, projects],
  );

  if (ready.count === 0) return null;

  const shown = ready.rows.slice(0, MAX_VISIBLE);
  const subtitle =
    ready.autoCount > 0
      ? `MAGE drafted ${ready.autoCount} of these from your job-site notes`
      : `${ready.count} drafted and waiting to send`;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <FileSignature size={16} color={colors.accent} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headline}>
            {formatMoney(ready.total)} in change orders ready to send
          </Text>
          <View style={styles.subRow}>
            {ready.autoCount > 0 ? <MageAIMark size={11} color={colors.textSecondary} /> : null}
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>
      </View>

      <View style={styles.list}>
        {shown.map((row) => (
          <TouchableOpacity
            key={row.id}
            style={styles.row}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Review change order ${row.coNumber} for ${row.projectName}, ${formatMoney(row.amount)}`}
            onPress={() =>
              router.push({ pathname: '/change-order', params: { projectId: row.projectId, coId: row.id } } as never)
            }
          >
            {row.isAuto ? <MageAIMark size={12} color={colors.accent} /> : <View style={styles.dot} />}
            <Text style={styles.rowTitle} numberOfLines={1}>
              {row.projectName} · CO #{row.coNumber}
            </Text>
            <Text style={styles.rowAmount}>{formatMoney(row.amount)}</Text>
            <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        ))}
      </View>

      {ready.count > MAX_VISIBLE ? (
        <Text style={styles.overflow}>+{ready.count - MAX_VISIBLE} more waiting</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.panel,
      paddingVertical: Tokens.spacing.md,
      paddingHorizontal: Tokens.spacing.md,
      marginHorizontal: Tokens.spacing.md,
      marginTop: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.xs,
      borderWidth: 1,
      borderColor: t.accentSoft,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: Tokens.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent + '15',
      flexShrink: 0,
    },
    headline: { ...Type.subheadEmphasized, color: t.text },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
    subtitle: { ...Type.caption1, color: t.textSecondary, flex: 1 },
    list: { marginTop: Tokens.spacing.sm, gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, paddingVertical: 7 },
    dot: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { ...Type.footnote, color: t.textSecondary, flex: 1 },
    rowAmount: { ...Type.footnoteEmphasized, color: t.text, fontVariant: ['tabular-nums'] },
    overflow: { ...Type.caption1, color: t.textMuted, marginTop: Tokens.spacing.sm },
  });
