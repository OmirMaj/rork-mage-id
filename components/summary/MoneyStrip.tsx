import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DollarSign } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { formatMoneyShort } from '@/utils/formatters';

interface MoneyStripProps {
  budget: number;
  outstanding: number;
  /** null = cash flow not set up → renders '—'. */
  cash4wk: number | null;
  onPressOutstanding: () => void;
  onPressCash: () => void;
}

export function MoneyStrip({ budget, outstanding, cash4wk, onPressOutstanding, onPressCash }: MoneyStripProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.card} testID="summary-money">
      <View style={styles.header}>
        <View style={[styles.iconSq, { backgroundColor: colors.success + '1A' }]}>
          <DollarSign size={15} color={colors.success} strokeWidth={2.2} />
        </View>
        <Text style={styles.headerLabel}>MONEY</Text>
        <Text style={styles.headerMeta}>across all jobs</Text>
      </View>

      <View style={styles.strip}>
        <View style={styles.cell}>
          <Text style={[styles.val, { color: colors.text }]} numberOfLines={1}>{formatMoneyShort(budget)}</Text>
          <Text style={styles.lbl}>BUDGET</Text>
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
            style={[styles.val, { color: cash4wk !== null && cash4wk > 0 ? colors.success : colors.textMuted }]}
            numberOfLines={1}
          >
            {cash4wk === null ? '—' : formatMoneyShort(cash4wk)}
          </Text>
          <Text style={styles.lbl}>CASH · 4WK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: t.line, padding: 14 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 10 },
  iconSq: { width: 26, height: 26, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerLabel: { fontSize: 12, fontWeight: '800' as const, color: t.text, letterSpacing: 0.2 },
  headerMeta: { marginLeft: 'auto' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  strip: { flexDirection: 'row' as const, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, overflow: 'hidden' as const },
  cell: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' as const },
  cellBorder: { borderLeftWidth: 1, borderLeftColor: t.line },
  val: { fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.4 },
  lbl: { fontSize: 9.5, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4, marginTop: 3 },
});
