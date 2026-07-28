// components/estimate/EstimateClientView.tsx
//
// The client-facing projection of the estimate — project total, scope rolled
// up by system, and allowances. Renders ONLY a ClientEstimateView, which by
// construction omits costs/markups/margin/unit-prices/suppliers/Brain flags
// (see utils/clientEstimateView.ts). Matches docs/design/estimate-redesign
// (mobile client). Presentational.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { ClientEstimateView, PaymentMilestone } from '@/utils/clientEstimateView';

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function EstimateClientView({ view, projectName, paymentSchedule }: { view: ClientEstimateView; projectName?: string; paymentSchedule?: PaymentMilestone[] }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View>
      <View style={styles.lockChip}>
        <Lock size={13} color="#6C7480" strokeWidth={2} />
        <Text style={styles.lockText}>Costs, markups & margin are hidden in client view</Text>
      </View>

      <Text style={styles.totalLabel}>PROJECT TOTAL</Text>
      <Text style={styles.total}>{money(view.projectTotal)}</Text>
      {!!projectName && <Text style={styles.prep}>Fixed-price proposal · {projectName}</Text>}

      <Text style={styles.sectionLabel}>SCOPE OF WORK</Text>
      <View style={styles.card}>
        {view.scopeGroups.map((g, i) => (
          <View key={g.key} style={[styles.row, i < view.scopeGroups.length - 1 && styles.rowBorder]}>
            <Text style={styles.rowName} numberOfLines={1}>{g.label}</Text>
            <Text style={styles.rowAmt}>{money(g.total)}</Text>
          </View>
        ))}
      </View>

      {view.allowances.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>ALLOWANCES INCLUDED</Text>
          <View style={styles.card}>
            {view.allowances.map((a, i) => (
              <View key={`${a.name}-${i}`} style={[styles.row, i < view.allowances.length - 1 && styles.rowBorder]}>
                <Text style={styles.rowName} numberOfLines={1}>{a.name}</Text>
                <Text style={styles.rowAllowAmt}>{money(a.amount)}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {!!paymentSchedule?.length && (
        <>
          <Text style={styles.sectionLabel}>PAYMENT SCHEDULE</Text>
          <View style={styles.card}>
            {paymentSchedule.map((m, i) => (
              <View key={`${m.label}-${i}`} style={[styles.payRow, i < paymentSchedule.length - 1 && styles.rowBorder]}>
                <View style={styles.payLeft}>
                  <Text style={styles.payLabel}>{m.label}</Text>
                  <Text style={styles.payDetail}>{m.detail}</Text>
                </View>
                <Text style={[styles.payAmt, i === 0 && styles.payAmtNow]}>{m.amount !== undefined ? money(m.amount) : 'Monthly'}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  lockChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.sm, paddingHorizontal: 11, paddingVertical: 8, marginBottom: 18,
  },
  lockText: { fontSize: 11, color: t.textMuted, flex: 1 },
  totalLabel: { fontSize: 10.5, letterSpacing: 1, color: t.textMuted, fontWeight: '700', marginBottom: 5 },
  total: { fontSize: 40, fontWeight: '800', color: t.text, letterSpacing: -1 },
  prep: { fontSize: 12, color: t.textSecondary, marginTop: 8 },
  sectionLabel: { fontSize: 10.5, letterSpacing: 1.2, color: t.textMuted, fontWeight: '800', marginTop: 24, marginBottom: 9 },
  card: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: t.line },
  rowName: { fontSize: 13.5, color: t.text, fontWeight: '600', flex: 1 },
  rowAmt: { fontSize: 13.5, color: t.text, fontWeight: '700' },
  rowAllowAmt: { fontSize: 13, color: t.textSecondary, fontWeight: '600' },
  payRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  payLeft: { flex: 1 },
  payLabel: { fontSize: 13.5, color: t.text, fontWeight: '600' },
  payDetail: { fontSize: 11, color: t.textMuted, marginTop: 2 },
  payAmt: { fontSize: 13.5, color: t.text, fontWeight: '700' },
  payAmtNow: { color: t.accent },
});
