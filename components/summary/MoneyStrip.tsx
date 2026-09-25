import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { DollarSign } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { formatMoneyShort } from '@/utils/formatters';
import { cashBalanceTone } from '@/utils/cashFlowEngine';

interface MoneyStripProps {
  /**
   * CONTRACT: the contract value of the jobs IN PROGRESS — each job's
   * estimate plus its approved change orders (utils/projectFinancials
   * getContractValue). This card used to print BUDGET, the estimate total of
   * every open job, drafts and unsold bids included (wave 6c, C2).
   */
  contractInProgress: number;
  /** Estimates not yet sold (draft + estimated jobs), shown muted under the
   *  contract figure as '+$X pipeline' when there is any. */
  pipeline: number;
  outstanding: number;
  /** null = cash flow not set up → renders '—'. */
  cash4wk: number | null;
  /** When the starting balance behind cash4wk was last set (ISO instant). */
  cashAsOf?: string | null;
  onPressOutstanding: () => void;
  onPressCash: () => void;
  /** Appended LAST to the card style. Undefined on the phone. */
  style?: StyleProp<ViewStyle>;
}

/** "as of Sep 1" — the balance date is an instant the GC stamped, so a local
 *  date read is the right one. Null when there is nothing parseable. */
function cashAsOfLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `bal. as of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function MoneyStrip({ contractInProgress, pipeline, outstanding, cash4wk, cashAsOf, onPressOutstanding, onPressCash, style }: MoneyStripProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tone = cashBalanceTone(cash4wk);
  const cashColor = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.textMuted;
  const asOf = cashAsOfLabel(cashAsOf);

  return (
    <View style={[styles.card, style]} testID="summary-money">
      <View style={styles.header}>
        <View style={[styles.iconSq, { backgroundColor: colors.success + '1A' }]}>
          <DollarSign size={15} color={colors.success} strokeWidth={2.2} />
        </View>
        <Text style={styles.headerLabel}>MONEY</Text>
        <Text style={styles.headerMeta}>jobs in progress</Text>
      </View>

      <View style={styles.strip}>
        <View style={styles.cell}>
          <Text style={[styles.val, { color: colors.text }]} numberOfLines={1}>{formatMoneyShort(contractInProgress)}</Text>
          <Text style={styles.lbl}>CONTRACT</Text>
          {pipeline > 0 ? (
            <Text style={styles.asOf} numberOfLines={1}>+{formatMoneyShort(pipeline)} pipeline</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.cell, styles.cellBorder]}
          activeOpacity={0.7}
          onPress={onPressOutstanding}
          testID="summary-money-outstanding"
        >
          <Text style={[styles.val, { color: outstanding > 0 ? colors.danger : colors.textMuted }]} numberOfLines={1}>
            {formatMoneyShort(outstanding)}
          </Text>
          <Text style={styles.lbl}>OUTSTANDING</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cell, styles.cellBorder]}
          activeOpacity={0.7}
          onPress={onPressCash}
          testID="summary-money-cash"
        >
          <Text
            style={[styles.val, { color: cashColor }]}
            numberOfLines={1}
          >
            {cash4wk === null ? '—' : formatMoneyShort(cash4wk)}
          </Text>
          <Text style={styles.lbl}>CASH · 4WK</Text>
          {asOf ? <Text style={styles.asOf} numberOfLines={1}>{asOf}</Text> : null}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { ...cardSurface(t, { radius: 'xl', pad: 14 }), marginHorizontal: 16, marginBottom: 12 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 10 },
  iconSq: { width: 26, height: 26, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerLabel: { fontSize: 12, fontWeight: '800' as const, color: t.text, letterSpacing: 0.2 },
  headerMeta: { marginLeft: 'auto' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  strip: { flexDirection: 'row' as const, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, overflow: 'hidden' as const },
  cell: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' as const },
  cellBorder: { borderLeftWidth: 1, borderLeftColor: t.line },
  val: { fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.4 },
  asOf: { fontSize: 9.5, fontWeight: '600' as const, color: t.textMuted, marginTop: 2 },
  lbl: { fontSize: 9.5, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4, marginTop: 3 },
});
