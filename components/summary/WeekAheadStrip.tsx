import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BarChart3, AlertTriangle } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { Type } from '@/constants/typography';
import { useProjects } from '@/contexts/ProjectContext';
import { findCrossProjectClashes, digestClashes, summarizeClashDays } from '@/utils/crossProjectLoad';
import type { WeekLoad } from '@/utils/summaryBriefing';

interface WeekAheadStripProps {
  week: WeekLoad;
  onPress?: () => void;
}

const TRACK_H = 64; // px height of the chart area

export function WeekAheadStrip({ week, onPress }: WeekAheadStripProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const maxCount = Math.max(1, ...week.days.map((d) => d.count));

  // The bars above count tasks, and a bar of height 3 looks the same whether it
  // is three subs or one drywall sub standing on two jobs at once. WeekLoad is
  // already portfolio-wide, but it is resource-BLIND — it carries per-day counts
  // and nothing about who those days belong to — so the clash cannot be
  // recovered from the prop. That is why this component reaches for the projects
  // itself rather than taking the answer from its caller.
  const { projects, getSubcontractor } = useProjects();
  const resolveSubName = useCallback(
    (id: string) => getSubcontractor(id)?.companyName,
    [getSubcontractor],
  );
  const clashes = useMemo(() => {
    const first = week.days[0]?.date;
    const last = week.days[week.days.length - 1]?.date;
    if (!first || !last) return [];
    return digestClashes(findCrossProjectClashes(projects, { startISO: first, endISO: last, resolveSubName }));
  }, [projects, week.days, resolveSubName]);

  const headerAndChart = (
    <>
      <View style={styles.header}>
        <View style={[styles.iconSq, { backgroundColor: colors.info + '1A' }]}>
          <BarChart3 size={15} color={colors.info} strokeWidth={2.2} />
        </View>
        <Text style={styles.headerLabel}>THIS WEEK</Text>
        <Text style={styles.headerMeta}>
          {week.totalTasks} task{week.totalTasks === 1 ? '' : 's'} · {week.milestoneCount} milestone{week.milestoneCount === 1 ? '' : 's'}
        </Text>
      </View>

      {week.totalTasks === 0 ? (
        <Text style={styles.empty}>No scheduled work this week.</Text>
      ) : (
        <View style={styles.chartRow}>
          {week.days.map((d, i) => {
            const barPx = d.count === 0 ? 5 : Math.max(8, Math.round((d.count / maxCount) * (TRACK_H - 6)));
            const barColor = d.isToday ? colors.accent : d.isWeekend ? colors.line : colors.accentSoft;
            return (
              <View key={i} style={styles.col}>
                <View style={styles.barArea}>
                  {d.hasMilestone && (
                    <View style={[styles.dia, { bottom: barPx + 4, backgroundColor: colors.accent }]} />
                  )}
                  <View style={[styles.bar, { height: barPx, backgroundColor: barColor }]} />
                </View>
                {d.isToday ? (
                  <View style={[styles.todayTag, { backgroundColor: colors.accentFill }]}>
                    <Text style={styles.todayTagText}>TODAY</Text>
                  </View>
                ) : (
                  <Text style={[styles.wd, d.isWeekend ? { color: colors.textMuted } : null]}>
                    {d.weekdayLabel}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {clashes.length > 0 && (
        <View style={styles.clashBlock}>
          <View style={styles.clashHead}>
            <AlertTriangle size={13} color={colors.dangerLabel} strokeWidth={2.2} />
            <Text style={styles.clashHeadText}>
              {clashes.length === 1 ? 'DOUBLE-BOOKED' : `${clashes.length} DOUBLE-BOOKED`}
            </Text>
          </View>
          {clashes.map((c) => (
            <Text key={c.resourceKey} style={styles.clashLine} numberOfLines={2}>
              <Text style={styles.clashName}>{c.resourceLabel}</Text>
              {` — ${c.jobNames.join(' + ')} · ${summarizeClashDays(c.dateISOs)}`}
            </Text>
          ))}
          <Text style={styles.clashHint}>Same crew, two jobs, one day. One of them is going to be short.</Text>
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress} testID="summary-week">
        {headerAndChart}
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.card} testID="summary-week">
      {headerAndChart}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { ...cardSurface(t, { radius: 'xl', pad: 14 }), marginHorizontal: 16, marginBottom: 12 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 6 },
  iconSq: { width: 26, height: 26, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerLabel: { fontSize: 12, fontWeight: '800' as const, color: t.text, letterSpacing: 0.2 },
  headerMeta: { marginLeft: 'auto' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  empty: { fontSize: 13, color: t.textMuted, fontWeight: '500' as const, paddingVertical: 10, textAlign: 'center' as const },
  chartRow: { flexDirection: 'row' as const, gap: 7, alignItems: 'flex-end' as const, marginTop: 8 },
  col: { flex: 1, alignItems: 'center' as const, gap: 6 },
  barArea: { width: '100%' as const, height: TRACK_H, justifyContent: 'flex-end' as const, alignItems: 'center' as const, position: 'relative' as const },
  bar: { width: '100%' as const, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  dia: { position: 'absolute' as const, left: '50%' as const, marginLeft: -4, width: 8, height: 8, borderRadius: 1, transform: [{ rotate: '45deg' }] },
  wd: { fontSize: 10, fontWeight: '700' as const, color: t.textSecondary },
  todayTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  todayTagText: { fontSize: 8, fontWeight: '800' as const, color: '#FFFFFF', letterSpacing: 0.2 },
  // dangerSoft/dangerLabel, not a baked hex: the tint has to follow the theme,
  // and dangerLabel is the contrast-checked text colour over it.
  clashBlock: { marginTop: 12, backgroundColor: t.dangerSoft, borderRadius: Tokens.radius.card, padding: 10, gap: 4 },
  clashHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  clashHeadText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: t.dangerLabel, letterSpacing: 0.4 },
  clashLine: { fontSize: Type.caption1.fontSize, color: t.dangerLabel, lineHeight: Type.caption1.lineHeight },
  clashName: { fontWeight: '800' as const },
  clashHint: { fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: Type.caption2.lineHeight, marginTop: 2 },
});
