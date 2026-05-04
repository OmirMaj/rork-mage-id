// EarnedValuePanel — compact "money on the schedule" rollup that shows
// Planned Value (PV), Earned Value (EV), Schedule Performance Index
// (SPI), and Cost Performance Index (CPI) when actual cost is supplied.
//
// Designed to slot into the schedule header / sidebar without stealing
// focus. Big number for PV (the "we should have earned this much by
// now"), with EV + SPI right next to it. Tap to expand and see the
// per-task cost breakdown.

import React, { memo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { DollarSign, TrendingUp, TrendingDown, X, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { formatMoneyCompact, performanceTone, type ScheduleEvSnapshot } from '@/utils/scheduleEarnedValue';
import type { ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const TONE_COLOR: Record<'good' | 'warn' | 'bad', string> = {
  good: Colors.success,
  warn: Colors.warning,
  bad: Colors.error,
};

export interface EarnedValuePanelProps {
  snapshot: ScheduleEvSnapshot;
  tasks: ScheduleTask[];
}

function EarnedValuePanelImpl({ snapshot, tasks }: EarnedValuePanelProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const spiTone = performanceTone(snapshot.spi);
  const cpiTone = snapshot.cpi != null ? performanceTone(snapshot.cpi) : null;
  const SpiIcon = snapshot.spi >= 1 ? TrendingUp : TrendingDown;
  const CpiIcon = snapshot.cpi != null && snapshot.cpi >= 1 ? TrendingUp : TrendingDown;

  // Don't render if there's no budget loaded — hide rather than show $0.
  if (snapshot.totalBudget === 0) return null;

  return (
    <>
      <TouchableOpacity
        style={styles.tile}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          setOpen(true);
        }}
        activeOpacity={0.85}
        testID="ev-panel-open"
      >
        <View style={styles.tileHead}>
          <View style={styles.tileIcon}>
            <DollarSign size={14} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileLabel}>Planned vs. Earned</Text>
            <Text style={styles.tileSub}>
              {formatMoneyCompact(snapshot.totalEarnedValue)} earned · {formatMoneyCompact(snapshot.totalPlannedValue)} planned
            </Text>
          </View>
          <View style={[styles.spiPill, { backgroundColor: TONE_COLOR[spiTone] + '14' }]}>
            <SpiIcon size={11} color={TONE_COLOR[spiTone]} />
            <Text style={[styles.spiText, { color: TONE_COLOR[spiTone] }]}>
              SPI {snapshot.spi.toFixed(2)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Money on the schedule</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Planned Value is what your budget says you should have earned by today. Earned Value is what you&apos;ve actually completed (% × cost).
            </Text>

            {/* KPI tiles */}
            <View style={styles.kpiRow}>
              <View style={styles.kpiCol}>
                <Text style={styles.kpiLabel}>Total budget</Text>
                <Text style={styles.kpiValue}>{formatMoneyCompact(snapshot.totalBudget)}</Text>
              </View>
              <View style={styles.kpiCol}>
                <Text style={styles.kpiLabel}>Planned by today</Text>
                <Text style={styles.kpiValue}>{formatMoneyCompact(snapshot.totalPlannedValue)}</Text>
              </View>
              <View style={styles.kpiCol}>
                <Text style={styles.kpiLabel}>Earned</Text>
                <Text style={[styles.kpiValue, { color: TONE_COLOR[spiTone] }]}>
                  {formatMoneyCompact(snapshot.totalEarnedValue)}
                </Text>
              </View>
            </View>

            {/* Performance indices */}
            <View style={styles.indicesRow}>
              <View style={[styles.indexCard, { borderColor: TONE_COLOR[spiTone] + '40' }]}>
                <View style={[styles.indexIcon, { backgroundColor: TONE_COLOR[spiTone] + '14' }]}>
                  <SpiIcon size={14} color={TONE_COLOR[spiTone]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.indexLabel}>Schedule Performance</Text>
                  <Text style={[styles.indexValue, { color: TONE_COLOR[spiTone] }]}>
                    SPI {snapshot.spi.toFixed(2)}
                  </Text>
                  <Text style={styles.indexHint}>
                    {snapshot.spi >= 1
                      ? 'Ahead of plan'
                      : snapshot.spi >= 0.95
                        ? 'On pace'
                        : snapshot.spi >= 0.85
                          ? 'Slightly behind'
                          : 'Significantly behind'}
                  </Text>
                </View>
              </View>

              {cpiTone && snapshot.cpi != null && (
                <View style={[styles.indexCard, { borderColor: TONE_COLOR[cpiTone] + '40' }]}>
                  <View style={[styles.indexIcon, { backgroundColor: TONE_COLOR[cpiTone] + '14' }]}>
                    <CpiIcon size={14} color={TONE_COLOR[cpiTone]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.indexLabel}>Cost Performance</Text>
                    <Text style={[styles.indexValue, { color: TONE_COLOR[cpiTone] }]}>
                      CPI {snapshot.cpi.toFixed(2)}
                    </Text>
                    <Text style={styles.indexHint}>
                      {snapshot.cpi >= 1 ? 'Under budget' : snapshot.cpi >= 0.95 ? 'On budget' : 'Over budget'}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Per-task list, biggest budget first */}
            <Text style={styles.listHead}>Cost per task</Text>
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {tasks
                .map(task => ({ task, load: snapshot.perTask.get(task.id) }))
                .filter(x => x.load && x.load.budgetedCost > 0)
                .sort((a, b) => (b.load!.budgetedCost - a.load!.budgetedCost))
                .map(({ task, load }) => {
                  const earnedPct = load!.budgetedCost > 0 ? (load!.earnedValue / load!.budgetedCost) * 100 : 0;
                  return (
                    <View key={task.id} style={styles.taskRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taskTitle}>{task.title}</Text>
                        <Text style={styles.taskMeta}>
                          {task.phase} · {task.progress}% complete · {load!.items.length} item{load!.items.length === 1 ? '' : 's'}
                        </Text>
                        <View style={styles.progressBar}>
                          <View style={[styles.progressFill, { width: `${earnedPct}%` }]} />
                        </View>
                      </View>
                      <View style={styles.taskMoneyCol}>
                        <Text style={styles.taskBudget}>{formatMoneyCompact(load!.budgetedCost)}</Text>
                        <Text style={styles.taskEarned}>
                          {formatMoneyCompact(load!.earnedValue)} earned
                        </Text>
                      </View>
                      <ChevronRight size={14} color={Colors.textMuted} />
                    </View>
                  );
                })}
              {snapshot.perTask.size === 0 && (
                <Text style={styles.emptyText}>
                  No estimate items linked to tasks yet. Link line items from the estimate view to power this panel.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

export const EarnedValuePanel = memo(EarnedValuePanelImpl);

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tileIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  tileSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2, lineHeight: 14 },
  spiPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full },
  spiText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '90%' as const,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10, gap: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 4,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  modalSubtitle: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, lineHeight: 17 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiCol: {
    flex: 1, padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  kpiLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  kpiValue: { fontSize: Type.subheadline.fontSize, fontWeight: '900', color: Colors.text, marginTop: 4, letterSpacing: -0.5 },

  indicesRow: { flexDirection: 'row', gap: 8 },
  indexCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
  },
  indexIcon: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  indexLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  indexValue: { fontSize: Type.subheadline.fontSize, fontWeight: '900', marginTop: 2, letterSpacing: -0.3 },
  indexHint: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 1 },

  listHead: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginTop: 6 },
  list: { flex: 1 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 6,
  },
  taskTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text },
  taskMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2 },
  progressBar: {
    height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: 6, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: Colors.primary, borderRadius: 2,
  },
  taskMoneyCol: { alignItems: 'flex-end' },
  taskBudget: { fontSize: Type.footnote.fontSize, fontWeight: '900', color: Colors.text, letterSpacing: -0.2 },
  taskEarned: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },

  emptyText: {
    fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontStyle: 'italic',
    paddingVertical: 24, textAlign: 'center', lineHeight: 18,
  },
});
