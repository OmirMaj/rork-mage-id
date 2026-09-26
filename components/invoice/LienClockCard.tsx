// components/invoice/LienClockCard.tsx — THE NY LIEN-DEADLINE CLOCK on an
// invoice that is 30+ days overdue (mounted by app/invoice.tsx).
//
// The dates come from utils/lienRightsClock (pure, validated by
// scripts/validate-lien-rights-clock.ts): the last day of work is the latest
// daily report on THIS job, and New York's windows are the ones read on the
// official NY Senate page for Lien Law § 10.
//
// It waits for dailyReportsLoaded: before the daily log is read, "no daily
// report" would be a 'not checked' dressed up as a 'none'.
//
// A date reminder, not legal advice. Nothing is filed or sent from here.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Scale } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card, EyebrowLabel } from '@/components/ui';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import { UNVERIFIED_SENTENCE, lienClockFor } from '@/utils/lienRightsClock';

export const LIEN_ATTORNEY_LINE = 'This is a date reminder, not legal advice — confirm with your attorney.';
export const LIEN_PUBLIC_JOB_LINE =
  'These are the private-job dates. A public job (city, state, school, authority) has a much shorter deadline — ask your attorney today.';

export function LienClockCard({ projectId }: { projectId: string }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getProject, getDailyReportsForProject, dailyReportsLoaded } = useProjects();
  const project = projectId ? getProject(projectId) : null;

  if (!dailyReportsLoaded) {
    return (
      <View testID="lienclock-card" style={styles.wrap}>
        <Text style={styles.muted}>Reading your daily log…</Text>
      </View>
    );
  }
  if (!project) return null;

  const clock = lienClockFor({
    project,
    dailyReports: getDailyReportsForProject(project.id),
    today: todayCalendarDay(),
  });

  let body: React.ReactNode;
  if (clock.kind === 'ny') {
    const day = (d: string) => formatCalendarDay(d);
    const sfPassed = clock.daysLeftSingleFamily < 0;
    const bothPassed = clock.daysLeft < 0;
    const status = bothPassed
      ? 'Both dates have passed — talk to your attorney now.'
      : sfPassed
        ? `The 4-month date has passed. ${clock.daysLeft} day${clock.daysLeft === 1 ? '' : 's'} left to the 8-month date.`
        : `${clock.daysLeft} day${clock.daysLeft === 1 ? '' : 's'} left.`;
    body = (
      <>
        <Text style={styles.headline}>
          {`Lien deadline: last work on site ${day(clock.lastWorkDay)} (from your daily log). New York: file by ${day(clock.deadline)} — or by ${day(clock.deadlineSingleFamily)} if this is a single-family dwelling.`}
        </Text>
        <Text style={[styles.status, (sfPassed || bothPassed) && { color: t.dangerLabel }]} testID="lienclock-status">{status}</Text>
        <Text style={styles.body}>{LIEN_PUBLIC_JOB_LINE}</Text>
        <TouchableOpacity
          onPress={() => { void Linking.openURL(clock.rule.url).catch(() => undefined); }}
          accessibilityRole="link"
          testID="lienclock-cite"
        >
          <Text style={styles.cite}>{`Cited: ${clock.rule.statute} · checked ${formatCalendarDay(clock.rule.checkedOn)}`}</Text>
        </TouchableOpacity>
      </>
    );
  } else if (clock.kind === 'ny_unverified') {
    body = <Text style={styles.headline}>{UNVERIFIED_SENTENCE}</Text>;
  } else {
    body = <Text style={styles.headline}>{clock.reason}</Text>;
  }

  return (
    <View testID="lienclock-card" style={styles.wrap}>
      <Card pad={Tokens.spacing.md} radius="md">
        <View style={styles.headRow}>
          <Scale size={14} color={t.textMuted} strokeWidth={1.75} />
          <EyebrowLabel tone="neutral" showDot={false}>Lien deadline</EyebrowLabel>
        </View>
        {body}
        <Text style={styles.muted}>{LIEN_ATTORNEY_LINE}</Text>
      </Card>
    </View>
  );
}

export default LienClockCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headline: { ...Type.subhead, color: t.text, marginTop: 6 },
  status: { ...Type.subheadEmphasized, color: t.text, marginTop: 6 },
  body: { ...Type.footnote, color: t.textSecondary, marginTop: 6 },
  cite: { ...Type.footnoteEmphasized, color: t.textSecondary, marginTop: 8, textDecorationLine: 'underline' },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 6 },
});
