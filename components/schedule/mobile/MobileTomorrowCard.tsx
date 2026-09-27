// ============================================================================
// components/schedule/mobile/MobileTomorrowCard.tsx — "What's tomorrow?" on
// the iPhone schedule (UX wave B5, phone half).
//
// TodayView (tablet and classic desktop) got a Tomorrow block in B5, but the
// phone's schedule tab is MobileScheduleScreen, which never mounts TodayView,
// so the answer was missing exactly where a super reads it at 3 pm. Same pure
// rule (utils/tomorrowBlock: the next WORKING day on this schedule's calendar
// and the tasks on it), same door (/tomorrow-lineup, gated on
// schedule_gantt_pdf through useProjectAccess, so a team member's grant on the
// project counts). Locked, the door says which plan it is on instead of
// disappearing. Nothing on the day: said plainly, no send button.
//
// Compact on purpose: three task titles and "+N more", because the full list
// is right below it on the same screen.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarDays, Lock, Send } from 'lucide-react-native';
import { Button, cardSurface } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { tomorrowBlock } from '@/utils/tomorrowBlock';
import { tomorrowLineupHref } from '@/utils/uxRoutes';

/** Task titles shown before "+N more". */
export const TOMORROW_CARD_MAX_TASKS = 3;

/** Plan names as the paywall shows them (VOICE: Free, Pro, Business, Enterprise). */
const PLAN_NAME: Record<string, string> = { free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };

export function MobileTomorrowCard({
  projectId,
  schedule,
  tasks,
}: {
  projectId: string;
  schedule: Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates'>;
  /** The tasks the screen is showing (the live copy), not a stale snapshot. */
  tasks: ScheduleTask[];
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const access = useProjectAccess(projectId);
  // Derived on every render: it is a filter over the tasks, and the screen
  // can stay open past midnight, when "tomorrow" moves.
  const block = tomorrowBlock({ ...schedule, tasks }, new Date());
  const lineupOpen = access.canAccess('schedule_gantt_pdf');
  const tier = access.requiredTierFor('schedule_gantt_pdf');
  const plan = PLAN_NAME[tier] ?? 'Pro';
  const shown = block.tasks.slice(0, TOMORROW_CARD_MAX_TASKS);
  const more = block.tasks.length - shown.length;

  return (
    <View style={styles.card} testID="schedule-tomorrow">
      <View style={styles.header}>
        <CalendarDays size={14} color={colors.info} strokeWidth={1.75} />
        <Text style={styles.title}>Tomorrow · {block.dayLabel}</Text>
      </View>
      {block.emptyNote ? (
        <Text style={styles.note} testID="schedule-tomorrow-empty">{block.emptyNote}</Text>
      ) : (
        <View style={styles.list}>
          {shown.map(task => (
            <Text key={task.id} style={styles.task} numberOfLines={1}>
              {task.title}{task.isMilestone ? ' · Milestone' : ''}{task.crew ? ` · ${task.crew}` : ''}
            </Text>
          ))}
          {more > 0 ? <Text style={styles.note}>{`+${more} more`}</Text> : null}
        </View>
      )}
      {block.canSend ? (
        <>
          <Button
            label={lineupOpen ? 'Send lineup' : `Send lineup · needs ${plan}`}
            variant={lineupOpen ? 'primary' : 'secondary'}
            fullWidth
            iconLeft={lineupOpen
              ? <Send size={14} color={Colors.textOnAccent} strokeWidth={1.75} />
              : <Lock size={14} color={colors.textSecondary} strokeWidth={1.75} />}
            onPress={() => router.push(tomorrowLineupHref(projectId))}
            testID="schedule-tomorrow-lineup"
          />
          {!lineupOpen ? (
            <Text style={styles.note} testID="schedule-tomorrow-locked">
              {`Tomorrow's lineup (a ready-to-send text per sub) is on the ${plan} plan. Tap to see it.`}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    ...cardSurface(t, { radius: 'lg', pad: 12 }),
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  list: { gap: 4 },
  task: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },
  note: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
});
