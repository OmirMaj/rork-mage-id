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
// day to file. Gaps are reported as facts; a gap-only row opens a report for
// its most recent missing day (audit #114 — it used to open a second report
// for today, which was already filed). The report screen's date picker
// backdates, so a missed day filed later is dated the day it covers.
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
  buildDailyLogGaps, dailyLogGapTarget, dailyLogVoiceDraft, VOICE_NOTE_ONLY, type DailyLogGapRow,
} from '@/utils/portfolio/attentionRows';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatCalendarDay } from '@/utils/calendarDate';
import { useT } from '@/contexts/LanguageContext';

const MAX_VISIBLE = 3;

/**
 * A translated sentence as React children, split at its {placeholders}: one
 * child per value and per run of words, exactly as the pre-i18n JSX
 * (`{a} of {b} working days logged`) rendered. The sentence is still ONE key
 * (the template comes back from t() with its placeholders intact); only the
 * rendering is split, so the rendered tree is unchanged.
 */
function sentenceParts(template: string, values: Record<string, string | number>): (string | number)[] {
  const out: (string | number)[] = [];
  let last = 0;
  template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m: string, name: string, at: number) => {
    if (at > last) out.push(template.slice(last, at));
    out.push(Object.prototype.hasOwnProperty.call(values, name) ? values[name] : m);
    last = at + m.length;
    return m;
  });
  if (last < template.length) out.push(template.slice(last));
  return out;
}

type Row = DailyLogGapRow;

export default function DailyLogCard() {
  const { t, tn } = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { projects, dailyReports } = useProjects();

  // The rows are the ONE rule the desktop action rail's "Daily-log gaps"
  // section and /attention also read (utils/portfolio/attentionRows, lifted
  // verbatim from here in wave 6c) — same filter, same order.
  const rows = useMemo<Row[]>(
    () => buildDailyLogGaps(projects, dailyReports, new Date().toISOString()),
    [projects, dailyReports],
  );

  if (rows.length === 0) return null;

  // UX A5: a job whose only report today is a voice note is not "no log" —
  // it has a draft to finish. Counted apart so the headline says so.
  const voiceToday = rows.filter(r => { const v = dailyLogVoiceDraft(r); return !!v && v.date === r.c.today; }).length;
  const owedToday = rows.filter(r => r.c.todayExpected && !r.c.todayFiled).length - voiceToday;
  const totalMissed = rows.reduce((s, r) => s + r.c.missedDays, 0);
  const jobsWithGaps = rows.filter(r => r.c.missedDays > 0).length;
  const voiceJobs = rows.filter(r => !!dailyLogVoiceDraft(r)).length;

  // NAV-10 (runtime audit 2026-09-06): this read
  //   `${totalMissed} working days in the last 30 have no log.`
  // but totalMissed is a SUM ACROSS PROJECTS, while "in the last 30" names a
  // single 30-calendar-day window (utils/dailyLogCompletion.ts:49
  // DEFAULT_WINDOW_DAYS = 30, with per-project missedDays capped at the ~22
  // working days inside it). Three active jobs with a fortnight of holes each
  // printed "42 working days in the last 30 have no log" — a sentence that is
  // false on its face, on the first number the GC reads on the card. It also
  // hid the fact that matters, which is that the gaps are spread across three
  // jobs.
  //
  // A sum only belongs in that sentence when there is exactly one job for it
  // to be a sum of. With more than one, say how many jobs and attribute the
  // total to them ("between them") instead of to the window.
  //
  // Spanish (wave-next W2): each headline is ONE key with its count, so a
  // translator never assembles a sentence from pieces (docs/I18N.md, "Gender and sentence building").
  const gapHeadline = jobsWithGaps === 1
    ? tn('field.dfr.card.gapOneProject', totalMissed, { one: '{count} working day in the last 30 has no daily report.', other: '{count} working days in the last 30 have no daily report.' })
    : t('field.dfr.card.gapManyProjects', '{projects} projects have gaps in the last 30 days, {days} working days in total.', { projects: jobsWithGaps, days: totalMissed });

  const headline = owedToday > 0
    ? tn('field.dfr.card.owedToday', owedToday, { one: '{count} project has no daily report for today.', other: '{count} projects have no daily report for today.' })
    : voiceToday > 0
      ? tn('field.dfr.card.voiceToday', voiceToday, { one: '{count} project has only a voice note for today. Finish it to file the day.', other: '{count} projects have only a voice note for today. Finish it to file the day.' })
      : jobsWithGaps > 0
        ? gapHeadline
        : tn('field.dfr.card.voiceToFinish', voiceJobs, { one: '{count} project has a voice note to finish.', other: '{count} projects have a voice note to finish.' });

  const visible = rows.slice(0, MAX_VISIBLE);
  const overflow = rows.length - visible.length;

  // Audit #114: every row opened a blank report dated TODAY. For a job that
  // owes today that is right; for a gap-only row (today already filed) it sent
  // the GC to a second report for a day that has one — the likeliest way to
  // put two records on one day. A gap row now opens its most recent missing
  // day (missedDates is most-recent-first), which is the gap the row names.
  // The report screen also warns if the day it opens already has a report.
  //
  // Wave 6c: the 'owes today' row also passes new: '1'. On desktop web a bare
  // /daily-report?projectId opens the job's DFR log (lane H), not a report —
  // this row means "file today's", so it asks for a new one (the same target
  // utils/portfolio/attentionRows dailyLogGapTarget gives the action rail and
  // /attention).
  //
  // UX A5: a row whose day has only a voice note opens THAT draft to finish
  // (utils/portfolio/attentionRows dailyLogGapTarget — the rail and
  // /attention use the same target). Such a row never has a gap day of its
  // own: dailyLogVoiceDraft only names one when today is owed or nothing is
  // missing, so `missingDay` is undefined for it.
  const open = (projectId: string, missingDay?: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const voiceRow = rows.find(x => x.projectId === projectId);
    if (voiceRow && dailyLogVoiceDraft(voiceRow)) {
      router.push({ pathname: '/daily-report', params: dailyLogGapTarget(voiceRow) });
      return;
    }
    const target = {
      pathname: '/daily-report' as const,
      params: missingDay ? { projectId, date: missingDay } : { projectId },
    };
    router.push(missingDay ? target : { ...target, params: { ...target.params, new: '1' } });
  };

  return (
    <View style={styles.card} testID="daily-log-card">
      <View style={styles.header}>
        <ClipboardList size={15} color={colors.accent} strokeWidth={2} />
        <Text style={styles.eyebrow}>{t('field.dfr.card.eyebrow', 'Daily report · last 30 days')}</Text>
      </View>

      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.sub}>
        {t('field.dfr.card.why', 'A daily report is worth more for being complete than for being detailed. If nothing happened on site, file the day and say so. That still counts. Tap a project with a gap to file its most recent missing day, dated the day it covers.')}
      </Text>

      <View style={styles.list}>
        {visible.map(r => {
          const needsToday = r.c.todayExpected && !r.c.todayFiled;
          const voice = dailyLogVoiceDraft(r);
          // VOICE_NOTE_ONLY is the shared row label (utils/portfolio/attentionRows;
          // the rail and /attention print it too), so it stays English here
          // until that module takes a language.
          const state = voice
            ? VOICE_NOTE_ONLY
            : needsToday
              ? t('field.dfr.card.todayNotFiled', 'Today not filed')
              : tn('field.dfr.card.daysMissing', r.c.missedDays, { one: '{count} day missing', other: '{count} days missing' });
          const gapDay = needsToday ? undefined : r.c.missedDates[0];
          const gapLabel = gapDay ? formatCalendarDay(gapDay, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
          const logged = t('field.dfr.card.daysLogged', '{filed} of {expected} working days logged', { filed: r.c.filedDays, expected: r.c.closedExpectedDays });
          const rowAction = voice
            ? t('field.dfr.card.openVoiceNote', 'Open the voice note to finish it.')
            : gapLabel
              ? t('field.dfr.card.openReportFor', 'Open a report for {day}.', { day: gapLabel })
              : t('field.dfr.card.openDailyReport', 'Open daily report.');
          // The meta line is a list of facts joined by ' · ', never one sentence.
          const loggedParts = sentenceParts(
            t('field.dfr.card.daysLogged', '{filed} of {expected} working days logged', { filed: '{filed}', expected: '{expected}' }),
            { filed: r.c.filedDays, expected: r.c.closedExpectedDays },
          );
          return (
            <TouchableOpacity
              key={r.projectId}
              style={styles.row}
              onPress={() => open(r.projectId, gapDay)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('field.dfr.card.rowA11y', '{name}: {state}. {logged}. {action}', { name: r.projectName, state, logged, action: rowAction })}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>{r.projectName}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {loggedParts}
                  {r.c.emptyDayFilings > 0 ? ` · ${t('field.dfr.card.noWorkDays', '{days} with no work on site', { days: r.c.emptyDayFilings })}` : ''}
                  {gapLabel ? ` · ${t('field.dfr.card.opensDay', 'opens {day}', { day: gapLabel })}` : ''}
                </Text>
              </View>
              <Text style={[styles.rowState, needsToday || voice ? styles.rowStateDue : styles.rowStateGap]}>
                {state}
              </Text>
              <ChevronRight size={14} color={colors.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          );
        })}
        {overflow > 0 && <Text style={styles.overflow}>{sentenceParts(t('field.dfr.card.more', '+{overflow} more', { overflow: '{overflow}' }), { overflow })}</Text>}
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
