import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Flag, CheckCircle2 } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { parseCalendarDay } from '@/utils/calendarDate';

const MS_DAY = 24 * 60 * 60 * 1000;

interface ProgressTabProps {
  tasks: ScheduleTask[];
  startDate: string;
}

function weighted(ts: ScheduleTask[]): number {
  const dur = ts.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
  if (dur === 0) return 0;
  return Math.round(ts.reduce((s, t) => s + (t.progress || 0) * Math.max(1, t.durationDays || 1), 0) / dur);
}

export function ProgressTab({ tasks, startDate }: ProgressTabProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // parseCalendarDay, not new Date(): a bare 'YYYY-MM-DD' parses as UTC
  // midnight and floors to the PREVIOUS local day at negative offsets, so every
  // date here rendered a day early. Same fix as MobileGantt / TaskDetailSheet /
  // SchedulerHeader / MobileScheduleList.
  const baseMs = useMemo(() => {
    const d = parseCalendarDay(startDate) ?? new Date();
    d.setHours(0, 0, 0, 0); return d.getTime();
  }, [startDate]);

  const overall = useMemo(() => weighted(tasks), [tasks]);
  const phases = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, ScheduleTask[]>();
    for (const t of tasks) { const p = t.phase || 'Other'; if (!by.has(p)) { by.set(p, []); order.push(p); } by.get(p)!.push(t); }
    return order.map((p) => ({ phase: p, pct: weighted(by.get(p)!), count: by.get(p)!.length }));
  }, [tasks]);
  const milestones = useMemo(
    () => tasks.filter((t) => t.isMilestone).sort((a, b) => (a.startDay ?? 1) - (b.startDay ?? 1)),
    [tasks],
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.heroPct}>{overall}%</Text>
        <Text style={styles.heroLbl}>OVERALL COMPLETE</Text>
        <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${Math.min(100, overall)}%` }]} /></View>
      </View>

      <Text style={styles.section}>BY PHASE</Text>
      <View style={styles.card}>
        {/* Honest empty state — with zero tasks this card rendered as a bare
            white pill (sim-audit #12). Mirrors the milestones card below. */}
        {phases.length === 0 && (
          <Text style={styles.empty}>No phases yet — add work packages to the schedule.</Text>
        )}
        {phases.map((p, i) => (
          <View key={p.phase} style={[styles.prow, i > 0 ? styles.rowDivider : null]}>
            <View style={[styles.dot, { backgroundColor: getPhaseColor(p.phase) }]} />
            <Text style={styles.pname} numberOfLines={1}>{p.phase}</Text>
            <View style={styles.miniTrack}><View style={[styles.miniFill, { width: `${Math.min(100, p.pct)}%`, backgroundColor: getPhaseColor(p.phase) }]} /></View>
            <Text style={styles.pval}>{p.pct}%</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>MILESTONES</Text>
      <View style={styles.card}>
        {milestones.length === 0 ? (
          <Text style={styles.empty}>No milestones set.</Text>
        ) : milestones.map((m, i) => {
          // startDay is 1-indexed (day 1 = schedule start); shift -1 to a day-offset.
          const d = new Date(baseMs + ((m.startDay ?? 1) - 1) * MS_DAY);
          const done = m.status === 'done';
          return (
            <View key={m.id} style={[styles.prow, i > 0 ? styles.rowDivider : null]}>
              {done ? <CheckCircle2 size={16} color={colors.success} strokeWidth={1.75} /> : <Flag size={16} color={colors.accent} strokeWidth={1.75} />}
              <Text style={[styles.pname, done ? { color: colors.textMuted } : null]} numberOfLines={1}>{m.title}</Text>
              <Text style={styles.mdate}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  hero: { backgroundColor: t.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: t.line, padding: 18, alignItems: 'center' as const, marginBottom: 16 },
  heroPct: { fontSize: 40, fontWeight: '800' as const, color: t.text, letterSpacing: -1 },
  heroLbl: { fontSize: 11, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 0.8, marginTop: 2, marginBottom: 12 },
  heroTrack: { width: '100%' as const, height: 8, backgroundColor: t.line, borderRadius: 4, overflow: 'hidden' as const },
  heroFill: { height: '100%' as const, backgroundColor: t.accent, borderRadius: 4 },
  section: { fontSize: 11, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 16 },
  prow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, paddingVertical: 9 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pname: { flex: 1, fontSize: 13, fontWeight: '700' as const, color: t.text },
  miniTrack: { width: 70, height: 6, backgroundColor: t.line, borderRadius: 3, overflow: 'hidden' as const },
  miniFill: { height: '100%' as const, borderRadius: 3 },
  pval: { fontSize: 12, fontWeight: '800' as const, color: t.textSecondary, width: 36, textAlign: 'right' as const },
  mdate: { fontSize: 12, fontWeight: '700' as const, color: t.accentLabel },
  empty: { fontSize: 13, color: t.textMuted, fontWeight: '500' as const, textAlign: 'center' as const, paddingVertical: 6 },
});
