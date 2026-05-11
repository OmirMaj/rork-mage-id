// TakeoffAccuracyPanel — surfaces a roll-up of how often the user
// corrected the AI's quantities, by category. The user benefits twice:
//   1. Sees patterns ("AI under-counted windows by ~12%") so they can
//      gut-check next time around without redoing every cell.
//   2. The data set is the seed for a future feedback loop that ships
//      corrections back to MAGE to fine-tune the prompt over time.
//      For now we keep it local — the "Help improve MAGE" button is
//      visually present but disabled until the backend slot lands.

import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { TrendingUp, TrendingDown, Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { TakeoffResult } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface TakeoffAccuracyPanelProps {
  takeoff: TakeoffResult;
  /** Same shape used by the takeoff screen — `${section}:${id}` → number. */
  overrides: Record<string, number>;
}

interface CategoryStat {
  category: string;
  edited: number;
  total: number;
  /** Average signed % error: positive means AI under-counted, negative means over-counted. */
  avgPctError: number;
}

function pctError(ai: number, user: number): number {
  if (!Number.isFinite(ai) || ai === 0) return 0;
  return (user - ai) / ai;
}

function getCategoryStats(takeoff: TakeoffResult, overrides: Record<string, number>): CategoryStat[] {
  const groups: { key: string; section: string; items: { id: string; value: number }[] }[] = [
    { key: 'walls', section: 'Walls (LF)', items: takeoff.walls.map(w => ({ id: w.id, value: w.lengthFt })) },
    { key: 'floor', section: 'Floor areas (SF)', items: takeoff.floorAreas.map(f => ({ id: f.id, value: f.areaSqFt })) },
    { key: 'doors', section: 'Doors (EA)', items: takeoff.doors.map(d => ({ id: d.id, value: d.count })) },
    { key: 'windows', section: 'Windows (EA)', items: takeoff.windows.map(w => ({ id: w.id, value: w.count })) },
    { key: 'finish', section: 'Finishes', items: takeoff.finishes.map(f => ({ id: f.id, value: f.quantity })) },
    { key: 'fixture', section: 'Fixtures (EA)', items: takeoff.fixtures.map(f => ({ id: f.id, value: f.count })) },
    { key: 'bulk', section: 'Bulk', items: takeoff.bulkMaterials.map(b => ({ id: b.id, value: b.quantity })) },
  ];
  const out: CategoryStat[] = [];
  for (const g of groups) {
    if (g.items.length === 0) continue;
    let edited = 0;
    let pctSum = 0;
    for (const it of g.items) {
      const k = `${g.key}:${it.id}`;
      const userVal = overrides[k];
      if (Number.isFinite(userVal) && userVal !== it.value) {
        edited++;
        pctSum += pctError(it.value, userVal);
      }
    }
    if (edited === 0) continue;
    out.push({
      category: g.section,
      edited,
      total: g.items.length,
      avgPctError: pctSum / edited,
    });
  }
  return out;
}

function TakeoffAccuracyPanelImpl({ takeoff, overrides }: TakeoffAccuracyPanelProps) {
  const stats = useMemo(() => getCategoryStats(takeoff, overrides), [takeoff, overrides]);
  const totalEdited = stats.reduce((s, x) => s + x.edited, 0);

  if (totalEdited === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Your corrections</Text>
        <Text style={styles.sub}>{totalEdited} edit{totalEdited === 1 ? '' : 's'} across {stats.length} categor{stats.length === 1 ? 'y' : 'ies'}.</Text>
      </View>
      <View style={styles.list}>
        {stats.map(s => {
          const pct = s.avgPctError * 100;
          const Icon = pct >= 0 ? TrendingUp : TrendingDown;
          const tone = Math.abs(pct) < 5 ? Colors.success
            : Math.abs(pct) < 15 ? Colors.warning : Colors.error;
          return (
            <View key={s.category} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{s.category}</Text>
                <Text style={styles.rowSub}>{s.edited} of {s.total} edited</Text>
              </View>
              <View style={[styles.deltaPill, { backgroundColor: tone + '15' }]}>
                <Icon size={11} color={tone} />
                <Text style={[styles.deltaText, { color: tone }]}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          Positive % means the AI under-counted (you raised the number). Negative means it over-counted.
        </Text>
      </View>
      {/* Feedback CTA removed pre-launch — was labeled "(coming soon)" with
          a disabled button, which is anti-pattern. Will return when the
          accuracy-feedback pipeline ships. */}
    </View>
  );
}

export const TakeoffAccuracyPanel = memo(TakeoffAccuracyPanelImpl);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 14,
    gap: 10,
  },
  head: { gap: Tokens.spacing.hairline },
  title: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  sub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, lineHeight: 15 },
  list: { gap: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: Tokens.spacing.xs, paddingHorizontal: 10, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text },
  rowSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 1 },
  deltaPill: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, paddingHorizontal: Tokens.spacing.xs, paddingVertical: 3, borderRadius: Tokens.radius.full },
  deltaText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.2 },
  legend: { padding: Tokens.spacing.xs, borderRadius: Tokens.radius.sm, backgroundColor: Colors.background },
  legendText: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic', lineHeight: 14 },
  helpBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
  },
  helpBtnDisabled: { opacity: 0.55 },
  helpBtnText: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontWeight: '700' },
});
