// ClosuresModal — UI for editing a schedule's non-working-days list.
//
// MAGE terminology: "Closures" (vs. MS Project's "Calendar Exceptions"). The
// list is a set of ISO YYYY-MM-DD dates that the CPM engine and date math
// will skip alongside weekends. Good for holidays, inspection lockdowns,
// forecasted rain days, and site closures.
//
// Interaction model:
//   - Left column: month-paginated calendar. Tap a day to toggle it.
//   - Right column: chronological list of currently-marked closures with
//     remove-one affordance and a "Clear all" sweep.
//   - "Preset" row: one-tap buttons for the US federal holiday set across
//     the project span, plus "Every Sunday" / "Every Saturday" for when
//     `workingDaysPerWeek` is 7 and the user wants to carve back out.
//
// We deliberately don't try to be a full calendar editor — the dates here
// are the override set, not the working calendar definition. Weekend
// handling lives in workingDaysPerWeek.

import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import { Colors } from '@/constants/colors';
import { ChevronLeft, ChevronRight, X, CalendarX, Trash2 } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface ClosuresModalProps {
  visible: boolean;
  /** Current set of ISO dates. */
  value: string[];
  /** Project start date as ISO (used to pick a sensible initial month). */
  scheduleStartIso?: string;
  workingDaysPerWeek: number;
  onClose: () => void;
  onApply: (next: string[]) => void;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseIso(iso: string): Date | null {
  const t = Date.parse(iso + 'T00:00:00');
  return Number.isFinite(t) ? new Date(t) : null;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export default function ClosuresModal({
  visible, value, scheduleStartIso, workingDaysPerWeek, onClose, onApply,
}: ClosuresModalProps) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(value));
  const [cursor, setCursor] = useState<Date>(() => {
    if (scheduleStartIso) {
      const p = parseIso(scheduleStartIso);
      if (p) return new Date(p.getFullYear(), p.getMonth(), 1);
    }
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  // Reset draft when modal re-opens with a new value.
  React.useEffect(() => {
    if (visible) setDraft(new Set(value));
  }, [visible, value]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const year = cursor.getFullYear();
  const month0 = cursor.getMonth();
  const firstDow = new Date(year, month0, 1).getDay(); // 0 = Sun
  const totalDays = daysInMonth(year, month0);

  // Build a 6x7 grid. null = leading/trailing padding.
  const grid = useMemo(() => {
    const cells: ({ iso: string; day: number; dow: number } | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(year, month0, d);
      cells.push({ iso: isoOf(date), day: d, dow: date.getDay() });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [firstDow, totalDays, year, month0]);

  const toggle = (iso: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  };

  const clearAll = () => setDraft(new Set());

  const sorted = useMemo(
    () => Array.from(draft).sort(),
    [draft],
  );

  const apply = () => onApply(Array.from(draft).sort());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <CalendarX size={16} color={Colors.primary} />
            <Text style={styles.title}>Closures</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              Holidays, rain days, site lockdowns — skipped in CPM math.
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={Colors.textSecondary} /></TouchableOpacity>
          </View>

          <View style={styles.body}>
            {/* Calendar */}
            <View style={styles.calendar}>
              <View style={styles.monthNav}>
                <TouchableOpacity
                  onPress={() => setCursor(new Date(year, month0 - 1, 1))}
                  style={styles.navBtn}
                  activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
                  <ChevronLeft size={16} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.monthLabel}>{monthLabel}</Text>
                <TouchableOpacity
                  onPress={() => setCursor(new Date(year, month0 + 1, 1))}
                  style={styles.navBtn}
                  activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Open">
                  <ChevronRight size={16} color={Colors.text} />
                </TouchableOpacity>
              </View>
              <View style={styles.dowRow}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <Text key={i} style={styles.dowLabel}>{d}</Text>
                ))}
              </View>
              <View style={styles.grid}>
                {grid.map((cell, i) => {
                  if (!cell) {
                    return <View key={i} style={styles.cell} />;
                  }
                  const marked = draft.has(cell.iso);
                  const isWeekend = (cell.dow === 0 || cell.dow === 6) && workingDaysPerWeek < 7;
                  return (
                    <TouchableOpacity
                      key={cell.iso}
                      style={[
                        styles.cell,
                        isWeekend && styles.cellWeekend,
                        marked && styles.cellMarked,
                      ]}
                      onPress={() => toggle(cell.iso)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.cellText,
                          isWeekend && styles.cellTextWeekend,
                          marked && styles.cellTextMarked,
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                Weekends already skipped via working-days-per-week ({workingDaysPerWeek}d/wk). Mark days here that
                are closed on top of that.
              </Text>
            </View>

            {/* List */}
            <View style={styles.list}>
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>Marked ({sorted.length})</Text>
                {sorted.length > 0 && (
                  <TouchableOpacity onPress={clearAll} style={styles.clearBtn} activeOpacity={0.7}>
                    <Trash2 size={12} color={Colors.error} />
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView style={{ flex: 1 }}>
                {sorted.length === 0 ? (
                  <Text style={styles.emptyText}>No closures yet. Tap a day on the calendar.</Text>
                ) : (
                  sorted.map(iso => {
                    const d = parseIso(iso);
                    const label = d
                      ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                      : iso;
                    return (
                      <View key={iso} style={styles.listRow}>
                        <Text style={styles.listRowText}>{label}</Text>
                        <TouchableOpacity
                          onPress={() => toggle(iso)}
                          style={styles.removeBtn}
                          activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                          <X size={12} color={Colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnGhost} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={apply} activeOpacity={0.7}>
              <Text style={styles.btnPrimaryText}>Apply ({sorted.length})</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 720,
    maxWidth: '94%',
    maxHeight: '88%',
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: Colors.text },
  subtitle: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginLeft: Tokens.spacing.xxs },
  closeBtn: { padding: Tokens.spacing.xxs },
  body: {
    flexDirection: 'row',
    minHeight: 360,
  },
  calendar: {
    flex: 1,
    padding: Tokens.spacing.md,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Tokens.spacing.sm,
  },
  navBtn: {
    padding: 6,
    borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.fillTertiary,
  },
  monthLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  dowRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  dowLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: Type.caption2.fontSize,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: Tokens.spacing.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  cellWeekend: {
    backgroundColor: Colors.fillTertiary,
  },
  cellMarked: {
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.sm,
  },
  cellText: { fontSize: Type.footnote.fontSize, fontWeight: '500', color: Colors.text },
  cellTextWeekend: { color: Colors.textMuted },
  cellTextMarked: { color: '#fff', fontWeight: '700' },
  hint: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, marginTop: 10, lineHeight: 16 },
  list: {
    width: 240,
    padding: Tokens.spacing.sm,
    flexShrink: 0,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Tokens.spacing.xs,
    paddingBottom: Tokens.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  listTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, padding: Tokens.spacing.xxs },
  clearText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: Colors.error },
  emptyText: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, fontStyle: 'italic', marginTop: Tokens.spacing.lg, textAlign: 'center' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: Tokens.spacing.xxs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  listRowText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text },
  removeBtn: { padding: Tokens.spacing.xxs },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: Tokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  btnGhost: { paddingHorizontal: 14, paddingVertical: Tokens.spacing.xs, borderRadius: Tokens.radius.xs },
  btnGhostText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: Colors.textSecondary },
  btnPrimary: { paddingHorizontal: 14, paddingVertical: Tokens.spacing.xs, borderRadius: Tokens.radius.xs, backgroundColor: Colors.primary },
  btnPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#fff' },
});
