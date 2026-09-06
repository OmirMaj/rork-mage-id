import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Plus,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { parseCalendarDay } from '@/utils/calendarDate';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  getPhaseColor,
  getTaskDateRange,
  getPredecessors,
} from '@/utils/scheduleEngine';
import { getForecastWithFallback, getConditionIcon } from '@/utils/weatherService';
import type { DayForecast } from '@/utils/weatherService';
import {
  SimulatedWeatherBanner,
  SimulatedDayChip,
} from '@/components/schedule/SimulatedWeatherNotice';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface LookaheadViewProps {
  tasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
  /**
   * The project's location string (city / address), used to fetch the REAL
   * forecast for this jobsite. Without it — or without an OpenWeather API key —
   * the weather strip falls back to simulated data and says so, loudly.
   */
  location?: string;
}

interface WeekGroup {
  weekStart: Date;
  weekEnd: Date;
  label: string;
  tasks: ScheduleTask[];
  forecast: DayForecast[];
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const SwipeableLookaheadCard = React.memo(function SwipeableLookaheadCard({
  task,
  allTasks,
  schedule,
  projectStartDate,
  onProgressUpdate,
  onTaskPress,
}: {
  task: ScheduleTask;
  allTasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
}) {
  const phaseColor = getPhaseColor(task.phase);
  const preds = getPredecessors(task, allTasks);
  const isBlocked = preds.some(p => p.status !== 'done');
  const dateRange = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
  const totalDays = task.durationDays;
  const daysPassed = Math.max(
    0,
    Math.ceil((new Date().getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24))
  );
  const dayOfN = Math.min(Math.max(1, daysPassed), totalDays);

  const translateX = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const startProg = useRef(task.progress);

  const flashGreen = useCallback(() => {
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [flashOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderGrant: () => {
        startProg.current = task.progress;
      },
      onPanResponderMove: (_e, gs) => {
        if (gs.dx > 0) {
          translateX.setValue(Math.min(gs.dx * 0.5, 60));
        }
      },
      onPanResponderRelease: (_e, gs) => {
        if (gs.dx > 50) {
          const next = Math.min(100, Math.ceil((startProg.current + 25) / 25) * 25);
          if (next !== startProg.current) {
            onProgressUpdate(task, next);
            flashGreen();
            if (next >= 100 && Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else if (Platform.OS !== 'web') {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
          }
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
      },
    })
  ).current;

  const handleIncrement = useCallback(() => {
    const next = Math.min(100, task.progress + 25);
    onProgressUpdate(task, next);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [task, onProgressUpdate]);

  return (
    <View style={s.swipeWrapper}>
      <View style={s.swipeBg}>
        <ChevronRight size={14} color="#FFF" strokeWidth={1.75} />
        <Text style={s.swipeBgText}>+25%</Text>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[s.taskCard, isBlocked && s.taskCardBlocked]}
          onPress={() => onTaskPress(task)}
          activeOpacity={0.7}
        >
          <View style={[s.taskPhaseBar, { backgroundColor: phaseColor }]} />
          <View style={s.taskCardBody}>
            <View style={s.taskCardTop}>
              <Text style={s.taskCardTitle} numberOfLines={1}>{task.title}</Text>
              {isBlocked && (
                <View style={s.blockedTag}>
                  <AlertTriangle size={9} color={Colors.error} strokeWidth={1.75} />
                  <Text style={s.blockedTagText}>BLOCKED</Text>
                </View>
              )}
            </View>
            <View style={s.taskCardMeta}>
              {task.crew ? (
                <Text style={s.taskCardCrewText}>{task.crew}{task.crewSize ? ` (${task.crewSize})` : ''}</Text>
              ) : null}
              <Text style={s.taskCardDayText}>Day {dayOfN}/{totalDays}</Text>
            </View>
            <View style={s.taskCardProgressRow}>
              <View style={s.taskCardProgressTrack}>
                <View style={[s.taskCardProgressFill, { width: `${task.progress}%` as any, backgroundColor: phaseColor }]} />
              </View>
              <Text style={s.taskCardProgressText}>{task.progress}%</Text>
              <TouchableOpacity style={s.incrementBtn} onPress={handleIncrement} accessibilityRole="button" accessibilityLabel="Add"><Plus size={12} color={Colors.primary} strokeWidth={1.75} /></TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>

        <Animated.View
          style={[s.flashOverlay, { opacity: flashOpacity }]}
          pointerEvents="none"
        />
      </Animated.View>
    </View>
  );
});

function LookaheadView({
  tasks,
  schedule,
  projectStartDate,
  onProgressUpdate,
  onTaskPress,
  location,
}: LookaheadViewProps) {
  const [weekCount, setWeekCount] = useState<3 | 6>(3);
  const now = useMemo(() => new Date(), []);

  /**
   * Real forecast for THIS jobsite. This view used to call
   * getSimulatedForecast() unconditionally — it never even attempted the API,
   * and the simulator ignores the region entirely, so the strip showed
   * calendar-derived fiction with no relation to the site.
   *
   * Now it goes through getForecastWithFallback, the same path the Gantt uses:
   * live OpenWeather for `location` when EXPO_PUBLIC_OPENWEATHER_API_KEY is
   * set (5 real days on the free tier), simulated only for the padded tail —
   * or for everything when there's no key. Whatever comes back is tagged
   * per-day, and any non-live day shown here is marked (see the banner below).
   *
   * Starts empty rather than pre-seeding with simulated data: an empty strip
   * for one frame is honest, a fake one is not.
   */
  const [forecast, setForecast] = useState<DayForecast[]>([]);

  useEffect(() => {
    let cancelled = false;
    setForecast([]);
    void getForecastWithFallback(
      { city: location?.trim() },
      now,
      weekCount * 7,
    ).then((days) => {
      if (!cancelled) setForecast(days);
    });
    return () => { cancelled = true; };
  }, [now, weekCount, location]);

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const groups: WeekGroup[] = [];
    const monday = getMonday(now);

    for (let w = 0; w < weekCount; w++) {
      const weekStart = new Date(monday);
      weekStart.setDate(weekStart.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 4);

      const weekTasks = tasks.filter(t => {
        if (t.isMilestone && t.durationDays === 0) return false;
        const { start, end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
        return start <= weekEnd && end >= weekStart;
      });

      const weekForecast = forecast.filter(f => {
        const d = parseCalendarDay(f.date); // UX-F10: a calendar day, not UTC midnight
        return !!d && d >= weekStart && d <= weekEnd;
      });

      const monthDay = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endDay = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      groups.push({
        weekStart,
        weekEnd,
        label: `${monthDay} – ${endDay}`,
        tasks: weekTasks,
        forecast: weekForecast,
      });
    }
    return groups;
  }, [tasks, schedule, projectStartDate, now, weekCount, forecast]);

  const renderWeekHeader = useCallback((week: WeekGroup) => {
    const taskCount = week.tasks.length;
    const crewSet = new Set(week.tasks.map(t => t.crew).filter(Boolean));
    const blocked = week.tasks.filter(t => {
      const preds = getPredecessors(t, tasks);
      return preds.some(p => p.status !== 'done');
    }).length;

    return (
      <View style={s.weekHeader}>
        <View style={s.weekHeaderTop}>
          <Text style={s.weekLabel}>{week.label}</Text>
          <Text style={s.weekSummary}>
            {taskCount} tasks · {crewSet.size} crews{blocked > 0 ? ` · ${blocked} blocked` : ''}
          </Text>
        </View>
        {week.forecast.length > 0 && (
          <View style={s.weekWeatherRow}>
            {week.forecast.map(f => {
              const d = parseCalendarDay(f.date); // UX-F10
              const dayName = d ? d.toLocaleDateString('en-US', { weekday: 'short' }) : f.date;
              const hasWeatherSensitive = week.tasks.some(t => t.isWeatherSensitive);
              const isRisky = !f.isWorkable && hasWeatherSensitive;
              return (
                <View key={f.date} style={[s.weekWeatherDay, !f.isWorkable && s.weekWeatherDayBad]}>
                  <Text style={s.weekWeatherDayName}>{dayName}</Text>
                  <Text style={s.weekWeatherIcon}>{getConditionIcon(f.condition)}</Text>
                  {/* Per-day provenance chip — says WHICH days are invented, so
                      a part-live / part-padded week can't be read as all-real. */}
                  <SimulatedDayChip source={f.source} />
                  {isRisky && <AlertTriangle size={10} color={Colors.warning} strokeWidth={1.75} />}
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }, [tasks]);

  const renderItem = useCallback(({ item }: { item: WeekGroup }) => {
    // Group the week's tasks by crew/trade so handoffs read at a glance.
    // GCs already mentally model the week as "framers Mon-Wed, electrical
    // Thu, plumbing Fri" — flat lists force them to do that grouping in
    // their head every time. Falls back to phase when crew is unset
    // (which is most cases on a fresh schedule).
    const groups = new Map<string, ScheduleTask[]>();
    for (const t of item.tasks) {
      const key = (t.crew?.trim() || t.phase || 'General').trim();
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }
    const orderedGroups = [...groups.entries()].sort((a, b) => {
      // Sort by earliest task start within the group, so the week reads
      // chronologically across handoffs.
      const aStart = Math.min(...a[1].map(t => t.startDay));
      const bStart = Math.min(...b[1].map(t => t.startDay));
      return aStart - bStart;
    });

    return (
      <View style={s.weekSection}>
        {renderWeekHeader(item)}
        {item.tasks.length === 0 ? (
          <View style={s.weekEmpty}>
            <Text style={s.weekEmptyText}>No tasks this week</Text>
          </View>
        ) : (
          orderedGroups.map(([groupKey, groupTasks]) => {
            const headcount = groupTasks.reduce((sum, t) => sum + (t.crewSize ?? 0), 0);
            const groupColor = getPhaseColor(groupTasks[0].phase);
            return (
              <View key={groupKey} style={s.crewGroup}>
                <View style={s.crewGroupHeader}>
                  <View style={[s.crewGroupDot, { backgroundColor: groupColor }]} />
                  <Text style={s.crewGroupName} numberOfLines={1}>{groupKey}</Text>
                  <Text style={s.crewGroupMeta}>
                    {groupTasks.length} task{groupTasks.length === 1 ? '' : 's'}
                    {headcount > 0 ? ` · ${headcount} on crew` : ''}
                  </Text>
                </View>
                {groupTasks.map(task => (
                  <SwipeableLookaheadCard
                    key={task.id}
                    task={task}
                    allTasks={tasks}
                    schedule={schedule}
                    projectStartDate={projectStartDate}
                    onProgressUpdate={onProgressUpdate}
                    onTaskPress={onTaskPress}
                  />
                ))}
              </View>
            );
          })
        )}
      </View>
    );
  }, [tasks, schedule, projectStartDate, onProgressUpdate, onTaskPress, renderWeekHeader]);

  // Only the days actually on screen count. If a padded/simulated day falls
  // outside every rendered week, there is nothing to warn about.
  const displayedDays = useMemo(
    () => weekGroups.flatMap((g) => g.forecast),
    [weekGroups],
  );

  return (
    <View style={s.container}>
      <View style={s.segmentControl}>
        <TouchableOpacity
          style={[s.segmentBtn, weekCount === 3 && s.segmentBtnActive]}
          onPress={() => setWeekCount(3)}
        >
          <Text style={[s.segmentBtnText, weekCount === 3 && s.segmentBtnTextActive]}>3 Week</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.segmentBtn, weekCount === 6 && s.segmentBtnActive]}
          onPress={() => setWeekCount(6)}
        >
          <Text style={[s.segmentBtnText, weekCount === 6 && s.segmentBtnTextActive]}>6 Week</Text>
        </TouchableOpacity>
      </View>

      {/* Unmissable, always-on marker — not a tooltip. Sits directly above the
          week strip that shows the invented conditions, so the label and the
          data it disclaims can't be seen apart. Gated on the days actually
          RENDERED, not the raw fetch, and self-hiding for a fully live week. */}
      <SimulatedWeatherBanner days={displayedDays} />

      <FlatList
        data={weekGroups}
        renderItem={renderItem}
        keyExtractor={(item) => item.label}
        scrollEnabled={false}
        contentContainerStyle={s.weekList}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 12 },

  segmentControl: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.card,
    padding: 3,
    alignSelf: 'flex-start',
  },
  segmentBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
  },
  segmentBtnActive: { backgroundColor: Colors.primary },
  segmentBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  segmentBtnTextActive: { color: '#FFF' },

  weekList: { gap: 16 },

  weekSection: { gap: 8 },
  weekHeader: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 8,
  },
  weekHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekLabel: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: Colors.text },
  weekSummary: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, fontWeight: '500' as const },

  weekWeatherRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-around' },
  weekWeatherDay: { alignItems: 'center', gap: 1 },
  weekWeatherDayBad: { opacity: 0.5 },
  weekWeatherDayName: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted },
  weekWeatherIcon: { fontSize: Type.bodyCompact.fontSize },
  weatherRisk: { fontSize: 10 },

  // ── Simulated-weather marker ───────────────────────────────────────────
  // Lives in components/schedule/SimulatedWeatherNotice.tsx now — the banner
  // and the per-day chip are shared with TodayView, VerticalGantt and the
  // schedule task-detail panel so there is exactly ONE treatment for invented
  // weather. Do not re-add local copies here.

  weekEmpty: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.card,
  },
  weekEmptyText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted },

  // Crew/trade grouping inside each week. Hairline separator + small
  // crew label keeps the visual weight tilted toward the task cards.
  crewGroup: {
    gap: 6,
    marginTop: 4,
  },
  crewGroupHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  crewGroupDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  crewGroupName: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.1,
  },
  crewGroupMeta: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    textAlign: 'right' as const,
  },

  swipeWrapper: {
    position: 'relative' as const,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden' as const,
  },
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.success,
    borderRadius: Tokens.radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 3,
  },
  swipeBgText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: '#FFF' },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C75920',
    borderRadius: Tokens.radius.lg,
  },

  taskCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  taskCardBlocked: { borderColor: '#FF3B3025' },
  taskPhaseBar: { width: 4 },
  taskCardBody: { flex: 1, padding: 12, gap: 6 },
  taskCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskCardTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text, flex: 1, marginRight: 8 },
  blockedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FF3B3012',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
  },
  blockedTagText: { fontSize: 9, fontWeight: '800' as const, color: Colors.error },
  taskCardMeta: { flexDirection: 'row', gap: 10 },
  taskCardCrewText: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, fontWeight: '500' as const },
  taskCardDayText: { fontSize: Type.caption2.fontSize, color: Colors.textMuted },
  taskCardProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskCardProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.fillSecondary,
    overflow: 'hidden' as const,
  },
  taskCardProgressFill: { height: '100%', borderRadius: 3 },
  taskCardProgressText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.text, minWidth: 28, textAlign: 'right' as const },
  incrementBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(LookaheadView);
