// components/home/DailyLogCard.tsx
//
// The daily log's completeness, stated as a number, on the screen the GC opens
// every morning.
//
// Why this exists, and why it is not a streak toy: a log with holes in it
// tells you nothing about the days in the holes, however detailed the days
// around them are. A gap-free boring log beats a sparse detailed one, and a
// missing Tuesday costs more than a Tuesday that says "rain, no work."
//
// So the card states two things and asks for one: how much of the record
// exists, that a day with nothing on it still counts, and that today is the
// day to file. It never offers to backfill a gap — a report typed weeks later
// carries the date it was typed. Gaps are reported as facts.
//
// No score, no badge, no streak flame, no exclamation mark. This is record
// keeping, not a game.
//
// Self-hides when there is nothing to act on — a card that reads "all good"
// every morning teaches the user to ignore it forever
// (see components/home/RecoveredCard.tsx:52). The standing number lives on the
// project's Daily Reports section; this card only appears when today is unfiled
// or the last 30 days have a hole in them.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, ClipboardList } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  computeDailyLogCompletion,
  calendarOfSchedule,
  type DailyLogCompletion,
} from '@/utils/dailyLogCompletion';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const MAX_VISIBLE = 3;

interface Row {
  projectId: string;
  projectName: string;
  c: DailyLogCompletion;
}

export default function DailyLogCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { projects, dailyReports } = useProjects();

  const rows = useMemo<Row[]>(() => {
    const todayISO = new Date().toISOString();
    const out: Row[] = [];
    for (const p of projects ?? []) {
      if (p.status !== 'in_progress') continue;
      const reports = (dailyReports ?? []).filter(r => r.projectId === p.id);
      const c = computeDailyLogCompletion({
        reports,
        calendar: calendarOfSchedule(p.schedule),
        startDateISO: p.schedule?.startDate ?? null,
        todayISO,
      });
      // hasRecord is false until the GC has filed at least one report on this
      // job. Nagging someone about a log they have not started is noise.
      if (!c.hasRecord) continue;
      const needsToday = c.todayExpected && !c.todayFiled;
      if (!needsToday && c.missedDays === 0) continue;
      out.push({ projectId: p.id, projectName: p.name, c });
    }
    // Today's unfiled logs first — that is the only action that can still be
    // taken contemporaneously. Then the biggest holes.
    return out.sort((a, b) => {
      const aToday = a.c.todayExpected && !a.c.todayFiled ? 1 : 0;
      const bToday = b.c.todayExpected && !b.c.todayFiled ? 1 : 0;
      if (aToday !== bToday) return bToday - aToday;
      return b.c.missedDays - a.c.missedDays;
    });
  }, [projects, dailyReports]);

  if (rows.length === 0) return null;

  const owedToday = rows.filter(r => r.c.todayExpected && !r.c.todayFiled).length;
  const totalMissed = rows.reduce((s, r) => s + r.c.missedDays, 0);

  const headline = owedToday > 0
    ? `${owedToday} ${owedToday === 1 ? 'job has' : 'jobs have'} no log for today.`
    : `${totalMissed} working ${totalMissed === 1 ? 'day' : 'days'} in the last 30 ${totalMissed === 1 ? 'has' : 'have'} no log.`;

  const visible = rows.slice(0, MAX_VISIBLE);
  const overflow = rows.length - visible.length;

  const open = (projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push({ pathname: '/daily-report', params: { projectId } } as never);
  };

  return (
    <View style={styles.card} testID="daily-log-card">
      <View style={styles.header}>
        <ClipboardList size={15} color={colors.accent} strokeWidth={2} />
        <Text style={styles.eyebrow}>Daily log · last 30 days</Text>
      </View>

      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.sub}>
        A daily log is worth more for being complete than for being detailed. If nothing happened
        on site, file the day and say so — that still counts. A day filed later carries the date
        you filed it, not the day it covers, so the gap stays.
      </Text>

      <View style={styles.list}>
        {visible.map(r => {
          const needsToday = r.c.todayExpected && !r.c.todayFiled;
          const state = needsToday
            ? 'Today not filed'
            : `${r.c.missedDays} ${r.c.missedDays === 1 ? 'day' : 'days'} missing`;
          return (
            <TouchableOpacity
              key={r.projectId}
              style={styles.row}
              onPress={() => open(r.projectId)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${r.projectName}: ${state}. ${r.c.filedDays} of ${r.c.closedExpectedDays} working days logged. Open daily report.`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>{r.projectName}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {r.c.filedDays} of {r.c.closedExpectedDays} working days logged
                  {r.c.emptyDayFilings > 0 ? ` · ${r.c.emptyDayFilings} with no work on site` : ''}
                </Text>
              </View>
              <Text style={[styles.rowState, needsToday ? styles.rowStateDue : styles.rowStateGap]}>
                {state}
              </Text>
              <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          );
        })}
        {overflow > 0 && <Text style={styles.overflow}>+{overflow} more</Text>}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.md,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: Tokens.spacing.sm },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.9,
    },
    headline: { ...Type.title3, color: t.text },
    sub: { ...Type.footnote, color: t.textSecondary, marginTop: 6, lineHeight: 19 },
    list: { marginTop: Tokens.spacing.md, gap: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    rowText: { flex: 1, gap: 1 },
    rowName: { ...Type.subhead, color: t.text },
    rowMeta: { ...Type.caption1, color: t.textMuted },
    rowState: { ...Type.caption1, fontWeight: '700' },
    rowStateDue: { color: t.accent },
    rowStateGap: { color: t.textSecondary },
    overflow: { ...Type.caption1, color: t.textMuted, paddingTop: 8 },
  });
