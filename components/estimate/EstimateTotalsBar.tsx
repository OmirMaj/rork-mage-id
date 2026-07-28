// components/estimate/EstimateTotalsBar.tsx
//
// The sticky bottom totals bar for the contractor estimate view: item/division
// count on the left, then Cost, Markups and the orange Grand Total. Matches
// docs/design/estimate-redesign. Presentational; the caller positions it.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface Props {
  itemCount: number;
  divisionCount: number;
  cost: number;
  markups: number;
  grandTotal: number;
}

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function EstimateTotalsBar({ itemCount, divisionCount, cost, markups, grandTotal }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bar}>
      <View style={styles.col}>
        <Text style={styles.k}>TOTALS</Text>
        <Text style={styles.sm}>{divisionCount} div · {itemCount} {itemCount === 1 ? 'item' : 'items'}</Text>
      </View>
      <View style={styles.col}>
        <Text style={styles.k}>COST</Text>
        <Text style={styles.v}>{money(cost)}</Text>
      </View>
      <View style={styles.col}>
        <Text style={styles.k}>MARKUPS</Text>
        <Text style={styles.v}>{money(markups)}</Text>
      </View>
      <View style={[styles.col, styles.colEnd]}>
        <Text style={styles.k}>GRAND TOTAL</Text>
        <Text style={[styles.v, styles.grand]}>{money(grandTotal)}</Text>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.surfaceAlt,
    borderTopWidth: 1, borderTopColor: t.line,
    paddingHorizontal: 18, paddingVertical: 12,
  },
  col: { gap: 3 },
  colEnd: { alignItems: 'flex-end' },
  k: { fontSize: 9, letterSpacing: 0.7, textTransform: 'uppercase', color: t.textMuted, fontWeight: '700' },
  sm: { fontSize: 11, color: t.textSecondary, fontWeight: '500' },
  v: { fontSize: 13.5, fontWeight: '800', color: t.text },
  grand: { color: t.accent },
});
