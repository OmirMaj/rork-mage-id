import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { CalendarClock, ChevronRight, HardDriveDownload } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { cardSurface } from '@/components/ui';
import { chipInitials, groupTodayByJob, type TodayTask } from '@/utils/summaryBriefing';
import { TileGrid } from '@/components/ui/TileGrid';
import { useFieldDayPack } from '@/hooks/useFieldDayPack';

/** Task rows a grouped job card shows before '+K more'. */
export const JOB_CARD_TASK_ROWS = 5;

interface TodayOnSiteProps {
  tasks: TodayTask[];
  jobCount: number;
  /** The tapped task's job and its schedule task id (the phone uses the job). */
  onPressTask: (projectId: string, taskId: string) => void;
  /**
   * Desktop Summary (wave 6c): one card per job — header with the job's
   * colour, name, '{n} tasks · {m} crit' and its crews — in a TileGrid, up to
   * JOB_CARD_TASK_ROWS task rows each and '+K more' to that job's schedule.
   * Default false: the flat list, exactly as before.
   */
  grouped?: boolean;
  /** '+K more' on a grouped job card (the job's schedule). */
  onPressJob?: (projectId: string) => void;
  /** Appended LAST to the card style (the desktop Summary zeroes the side
   *  margins). Undefined on the phone. */
  style?: StyleProp<ViewStyle>;
}

export function TodayOnSite({ tasks, jobCount, onPressTask, grouped = false, onPressJob, style }: TodayOnSiteProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // OFFLINE READINESS, stated on the card that names the day's work.
  //
  // The text on this card is already readable with no signal — projects and
  // their schedule tasks persist through ProjectContext's write-through cache,
  // as do the punch list, the subs and the contacts. What was NOT guaranteed
  // was the drawings, and nothing anywhere told the user either way. The hook
  // reads a record of what the day pack actually warmed (measured, not
  // requested) and how old it is; `summary` is the only string we are allowed
  // to show, and it downgrades itself to "may be out of date" and then to
  // "expired" on its own. See utils/fieldDayPackCore.ts.
  //
  // Read-only, self-contained: the parent passes no prop for this, so the card
  // can state its own freshness without every caller learning about packs.
  //
  // `jobCount` goes in as the DENOMINATOR. "Saved for offline: 4 sheets across
  // 1 job" is a true sentence and a false impression on a two-job day where the
  // second job has nothing on the device — the super reads coverage and drives
  // to the site that has none. With the day's count, the line names the
  // shortfall instead of leaving it to be inferred.
  const dayPack = useFieldDayPack(jobCount);

  return (
    <View style={[styles.card, style]} testID="summary-today">
      <View style={styles.header}>
        <View style={[styles.iconSq, { backgroundColor: colors.accentSoft }]}>
          <CalendarClock size={15} color={colors.accent} strokeWidth={2.2} />
        </View>
        <Text style={styles.headerLabel}>TODAY ON SITE</Text>
        <Text style={styles.headerMeta}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'} · {jobCount} job{jobCount === 1 ? '' : 's'}
        </Text>
      </View>

      {tasks.length === 0 ? (
        <Text style={styles.empty}>Nothing scheduled on site today.</Text>
      ) : grouped ? (
        <TileGrid preset="nav" testID="summary-today-jobs">
          {groupTodayByJob(tasks).map((g) => {
            const more = g.tasks.length - JOB_CARD_TASK_ROWS;
            return (
              <View key={g.projectId} style={styles.jobCard} testID={`summary-today-job-${g.projectId}`}>
                <View style={styles.jobHead}>
                  <View style={[styles.chip, { backgroundColor: g.projectColor }]}>
                    <Text style={styles.chipText}>{chipInitials(g.projectName)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.title} numberOfLines={1}>{g.projectName}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {g.tasks.length} task{g.tasks.length === 1 ? '' : 's'} · {g.critCount} crit
                      {g.crews.length > 0 ? ` · ${g.crews.join(' · ')}` : ''}
                    </Text>
                  </View>
                </View>
                {g.tasks.slice(0, JOB_CARD_TASK_ROWS).map((t, i) => (
                  <TouchableOpacity
                    key={`${t.taskId}-${i}`}
                    style={[styles.jobRow, styles.rowDivider]}
                    activeOpacity={0.7}
                    onPress={() => onPressTask(t.projectId, t.taskId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.taskTitle}, ${g.projectName}${t.isCritical ? ', critical' : ''}`}
                    testID={`summary-today-job-row-${g.projectId}-${i}`}
                  >
                    <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{t.taskTitle}</Text>
                    {t.isCritical ? (
                      <View style={[styles.flag, { backgroundColor: colors.danger + '18' }]}>
                        <Text style={[styles.flagText, { color: colors.danger }]}>CRIT</Text>
                      </View>
                    ) : (
                      <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} />
                    )}
                  </TouchableOpacity>
                ))}
                {more > 0 ? (
                  <TouchableOpacity
                    style={[styles.jobRow, styles.rowDivider]}
                    activeOpacity={0.7}
                    onPress={() => onPressJob?.(g.projectId)}
                    disabled={!onPressJob}
                    accessibilityRole="button"
                    accessibilityLabel={`${more} more on ${g.projectName}: open its schedule`}
                    testID={`summary-today-job-more-${g.projectId}`}
                  >
                    <Text style={[styles.moreText, { color: colors.accentLabel }]}>+{more} more</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </TileGrid>
      ) : (
        tasks.map((t, i) => (
          <TouchableOpacity
            key={`${t.projectId}-${t.taskTitle}-${i}`}
            style={[styles.row, i > 0 ? styles.rowDivider : null]}
            activeOpacity={0.7}
            onPress={() => onPressTask(t.projectId, t.taskId)}
            testID={`summary-today-row-${i}`}
          >
            <View style={[styles.chip, { backgroundColor: t.projectColor }]}>
              <Text style={styles.chipText}>{chipInitials(t.projectName)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{t.taskTitle}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {t.projectName}{t.context ? ` · ${t.context}` : ''}
              </Text>
            </View>
            {t.isCritical ? (
              <View style={[styles.flag, { backgroundColor: colors.danger + '18' }]}>
                <Text style={[styles.flagText, { color: colors.danger }]}>CRIT</Text>
              </View>
            ) : (
              <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>
        ))
      )}

      {/* Only shown when there IS work today — an offline-readiness line under
          "Nothing scheduled on site today" is noise about a day with nothing
          to be ready for — and only once the hook has something true to say.
          An empty `summary` means the record has not been read yet, or the
          platform has no offline guarantee to describe; rendering a
          placeholder there would flash "nothing is saved" at a user whose
          plans are in fact on the device. */}
      {tasks.length > 0 && dayPack.summary.length > 0 ? (
        <View style={styles.offlineRow} testID="summary-today-offline">
          <HardDriveDownload size={12} color={colors.textMuted} strokeWidth={1.9} />
          <Text style={styles.offlineText} numberOfLines={2}>{dayPack.summary}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { ...cardSurface(t, { radius: 'xl', pad: 14 }), marginHorizontal: 16, marginBottom: 12 },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, marginBottom: 10 },
  iconSq: { width: 26, height: 26, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerLabel: { fontSize: 12, fontWeight: '800' as const, color: t.text, letterSpacing: 0.2 },
  headerMeta: { marginLeft: 'auto' as const, fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  empty: { fontSize: 13, color: t.textMuted, fontWeight: '500' as const, paddingVertical: 8, textAlign: 'center' as const },
  offlineRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: t.line,
  },
  offlineText: { flex: 1, fontSize: 10.5, fontWeight: '600' as const, color: t.textMuted, letterSpacing: 0.05 },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, paddingVertical: 9 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  chip: { width: 30, height: 30, borderRadius: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  chipText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' as const, letterSpacing: -0.2 },
  title: { fontSize: 13.5, fontWeight: '700' as const, color: t.text, letterSpacing: -0.1 },
  sub: { fontSize: 11, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  flag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  flagText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.3 },
  // Grouped (desktop) job cards.
  jobCard: {
    ...cardSurface(t, { pad: 'none' }),
    backgroundColor: t.surfaceAlt, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4,
  },
  jobHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, paddingBottom: 8 },
  jobRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 8 },
  moreText: { fontSize: 12, fontWeight: '700' as const },
});
