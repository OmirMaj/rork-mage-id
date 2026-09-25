// components/schedule/desktop/ScheduleSignals.tsx — Schedule Pro's signals
// row on a desktop browser (wave 6c, lane DB).
//
// WHY. The founder on his 1512 × 945 MacBook: "the scheduler does not work
// well". Above the grid Schedule Pro stacked six bands — the header, the
// earned-value card, the stale-refs banner, sub updates, the weather banner
// and the "Tell me what to change" pill — so ~425 px of chrome left ~9 task
// rows. The four that are SIGNALS (something to look at, not something to
// type into) now share ONE 40 px row of 32 px chips, each opening the sheet it
// used to be a card for:
//
//   SPI 0.92 · CPI 1.04   · 3 stale estimate refs · Clean up   · 2 conflicts
//   Sub updates · 4 today · 1 blocker   · 2 tasks hit bad weather · Review
//
// When no chip has anything to say the row is 0 px — no empty band. Sub
// updates and weather load / compute their own presence, so they stay mounted
// and report it up (onPresenceChange); the SCREEN holds that state and passes
// it back (subPresent / weatherPresent) so the row knows whether to open.
//
// Desktop only: the screen renders this in its desktop tree; the phone never
// sees it (the card variants there are untouched).

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { AlertTriangle, Eraser } from 'lucide-react-native';
import { ChipRail } from '@/components/ui/ChipRail';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { EarnedValuePanel } from '@/components/schedule/EarnedValuePanel';
import { SubUpdatesPanel } from '@/components/schedule/SubUpdatesPanel';
import { WeatherReschedulePrompt, type WeatherReschedulePromptProps } from '@/components/schedule/WeatherReschedulePrompt';
import type { ScheduleEvSnapshot } from '@/utils/scheduleEarnedValue';
import type { ScheduleTask } from '@/types';
import type { CpmConflict } from '@/utils/cpm';

export interface ScheduleSignalsProps {
  projectId: string;
  tasks: ScheduleTask[];
  evSnapshot: ScheduleEvSnapshot;
  staleRefCount: number;
  onCleanupStaleRefs: () => void;
  conflicts: CpmConflict[];
  /** Focus (and scroll to) a task — the conflicts chip sends the first one. */
  onFocusTask: (taskId: string) => void;
  weather: Pick<WeatherReschedulePromptProps, 'forecasts' | 'projectStartDate' | 'onPushTasks' | 'dailyReports'>;
  /** Presence of the two self-loading chips, held by the screen. */
  subPresent: boolean;
  weatherPresent: boolean;
  onSubPresence: (present: boolean) => void;
  onWeatherPresence: (present: boolean) => void;
}

/** Which chips have something to say (pure; the row is 0 px when none). */
export function signalsPresent(p: {
  totalBudget: number; staleRefCount: number; conflictCount: number; subPresent: boolean; weatherPresent: boolean;
}): boolean {
  return p.totalBudget > 0 || p.staleRefCount > 0 || p.conflictCount > 0 || p.subPresent || p.weatherPresent;
}

export function ScheduleSignals(props: ScheduleSignalsProps) {
  const {
    projectId, tasks, evSnapshot, staleRefCount, onCleanupStaleRefs, conflicts, onFocusTask,
    weather, subPresent, weatherPresent, onSubPresence, onWeatherPresence,
  } = props;
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const any = signalsPresent({
    totalBudget: evSnapshot.totalBudget, staleRefCount, conflictCount: conflicts.length, subPresent, weatherPresent,
  });
  const firstConflictTask = conflicts.find((c) => c.taskIds.length > 0)?.taskIds[0];

  // Sub updates and weather must stay MOUNTED to find out whether they have
  // anything to say, so with nothing to show the row sits in a 0 px box. The
  // tree is the SAME either way (only the wrapper's style changes): moving
  // the two self-loading chips between parents would remount them — a fresh
  // storage read, and a sheet he had open closing under him.
  return (
    <View style={any ? null : styles.collapsed} testID={any ? 'schedule-signals' : 'schedule-signals-empty'}>
      <ChipRail mode="wrap" style={styles.rail} contentContainerStyle={styles.row}>
        {evSnapshot.totalBudget > 0 ? <EarnedValuePanel snapshot={evSnapshot} tasks={tasks} variant="chip" /> : null}
        {staleRefCount > 0 ? (
          <Pressable
            onPress={onCleanupStaleRefs}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`${staleRefCount} stale estimate reference${staleRefCount === 1 ? '' : 's'} — clean up`}
            testID="cleanup-stale-estimate-refs"
          >
            <Eraser size={12} color={t.accentLabel} strokeWidth={1.75} />
            <Text style={styles.chipText} numberOfLines={1}>
              {staleRefCount} stale estimate ref{staleRefCount === 1 ? '' : 's'} · Clean up
            </Text>
          </Pressable>
        ) : null}
        {conflicts.length > 0 ? (
          <Pressable
            onPress={() => { if (firstConflictTask) onFocusTask(firstConflictTask); }}
            disabled={!firstConflictTask}
            style={[styles.chip, styles.chipWarn]}
            accessibilityRole="button"
            accessibilityLabel={`${conflicts.length} schedule conflict${conflicts.length === 1 ? '' : 's'}: ${conflicts[0].message}`}
            testID="schedule-conflicts-chip"
          >
            <AlertTriangle size={12} color={t.danger} strokeWidth={1.75} />
            <Text style={[styles.chipText, styles.chipWarnText]} numberOfLines={1}>
              {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} · {conflicts[0].message}
            </Text>
          </Pressable>
        ) : null}
        <SubUpdatesPanel projectId={projectId} tasks={tasks} variant="chip" onPresenceChange={onSubPresence} />
        <WeatherReschedulePrompt tasks={tasks} {...weather} variant="chip" onPresenceChange={onWeatherPresence} />
      </ChipRail>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  // 32 px chips + Layout.rowGap / 2 above and below = the 40 px row.
  rail: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, backgroundColor: t.bg },
  row: {
    paddingHorizontal: Layout.gutter,
    paddingVertical: Layout.rowGap / 2,
    minHeight: Layout.control.row,
  },
  collapsed: { height: 0, overflow: 'hidden' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: Layout.chip.height, maxWidth: Layout.chip.maxWidth, flexShrink: 0,
    paddingHorizontal: 12, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.line,
  },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.accentLabel, flexShrink: 1 },
  chipWarn: { backgroundColor: t.dangerSoft },
  chipWarnText: { color: t.dangerLabel },
});
