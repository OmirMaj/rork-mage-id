// components/estimate/EstimateDivisionTable.tsx
//
// The contractor-view scope list: estimate line items grouped into CSI
// divisions, each an expandable row with a trade-colored tile, number, title
// and marked-up total. Matches docs/design/estimate-redesign (mobile
// contractor). Presentational — the caller supplies the grouped rows.

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronRight, ChevronDown, Layers } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';

export interface DivisionItemRow {
  name: string;
  qty: number;
  unit: string;
  total: number;
}
export interface DivisionRow {
  /** CSI number ('03') or 'other'. */
  key: string;
  /** Display number ('03') or null for unassigned. */
  number: string | null;
  title: string;
  total: number;
  items: DivisionItemRow[];
}

// CSI division → on-brand tile color. Deliberately avoids the purple trade
// tokens (steel/closeout) per the redesign's no-purple rule; unmapped
// divisions fall back to slate.
const DIVISION_COLOR: Record<string, string> = {
  '01': '#FF6A1A', '02': '#66BB6A', '03': '#90A4AE', '04': '#4FC3F7',
  '05': '#FFA726', '06': '#8D6E63', '07': '#EF5350', '08': '#26C6DA',
  '09': '#5FBF6B', '22': '#26C6DA', '23': '#FFA726', '26': '#4FC3F7',
  '31': '#66BB6A', '32': '#66BB6A', '33': '#90A4AE',
};
function divisionColor(key: string): string {
  return DIVISION_COLOR[key] ?? '#90A4AE';
}
function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function EstimateDivisionTable({ divisions }: { divisions: DivisionRow[] }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = useCallback((key: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (divisions.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>SCOPE</Text>
        <Text style={styles.headerCount}>{divisions.length} {divisions.length === 1 ? 'division' : 'divisions'}</Text>
      </View>
      <View style={styles.card}>
        {divisions.map((d, i) => {
          const color = divisionColor(d.key);
          const isOpen = !!open[d.key];
          const last = i === divisions.length - 1;
          return (
            <View key={d.key}>
              <TouchableOpacity
                style={[styles.row, (!isOpen && !last) && styles.rowBorder]}
                activeOpacity={0.7}
                onPress={() => toggle(d.key)}
                testID={`division-row-${d.key}`}
              >
                <View style={styles.chev}>
                  {isOpen ? <ChevronDown size={15} color={color} strokeWidth={2.2} /> : <ChevronRight size={15} color="#6C7480" strokeWidth={2.2} />}
                </View>
                <View style={[styles.tile, { backgroundColor: color + '28' }]}>
                  <Layers size={15} color={color} strokeWidth={2} />
                </View>
                <View style={styles.nameWrap}>
                  {d.number && <Text style={styles.no}>{d.number}</Text>}
                  <Text style={styles.title} numberOfLines={1}>{d.title}</Text>
                </View>
                <Text style={[styles.total, isOpen && styles.totalOpen]}>{money(d.total)}</Text>
              </TouchableOpacity>

              {isOpen && (
                <View style={[styles.exp, !last && styles.rowBorder]}>
                  {d.items.map((it, j) => (
                    <View key={`${d.key}-${j}`} style={[styles.itemRow, j < d.items.length - 1 && styles.itemBorder]}>
                      <View style={styles.itemNameWrap}>
                        <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                        <Text style={styles.itemQty}>{it.qty} {it.unit}</Text>
                      </View>
                      <Text style={styles.itemTotal}>{money(it.total)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 },
  headerLabel: { fontSize: 10.5, letterSpacing: 1.2, color: t.textMuted, fontWeight: '800' },
  headerCount: { fontSize: 11.5, color: t.textMuted },
  card: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: t.line },
  chev: { width: 15, alignItems: 'center' },
  tile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  no: { fontSize: 13.5, color: t.textMuted, fontWeight: '700' },
  title: { fontSize: 13.5, color: t.text, fontWeight: '600', flexShrink: 1 },
  total: { fontSize: 13.5, color: t.text, fontWeight: '700' },
  totalOpen: { color: t.accent },
  exp: { backgroundColor: t.surfaceAlt, paddingHorizontal: 13 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, paddingLeft: 43 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: t.line },
  itemNameWrap: { flex: 1 },
  itemName: { fontSize: 12.5, color: t.textSecondary },
  itemQty: { fontSize: 10.5, color: t.textMuted, marginTop: 2 },
  itemTotal: { fontSize: 12.5, color: t.textSecondary, fontWeight: '600' },
});
