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
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  getPhaseColor,
  getPredecessors,
} from '@/utils/scheduleEngine';
import { runCpm } from '@/utils/cpm';
import { scheduledPlacements, scheduledTaskRange, type ScheduledPlacement } from '@/utils/scheduleOps';
import { getForecastWithFallback, getConditionIcon } from '@/utils/weatherService';
import type { DayForecast } from '@/utils/weatherService';
import { describeForecast } from '@/utils/weatherProvenance';
import {
  SimulatedWeatherBanner,
  WeatherPlaceLine,
  SimulatedDayChip,
} from '@/components/schedule/SimulatedWeatherNotice';
import { Type } from '@/constants/typography';
import { Motion, Tokens } from '@/constants/designTokens';
import { nativeDriver } from '@/components/ui/motion';
import { TileGrid } from '@/components/ui/TileGrid';

interface LookaheadViewProps {
  tasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number, opts?: ProgressUpdateOpts) => void;
  onTaskPress: (task: ScheduleTask) => void;
  /**
   * The project's location string (city / address), used to fetch the REAL
   * forecast for this jobsite. Without it — or without an OpenWeather API key —
   * the weather strip falls back to simulated data and says so, loudly.
   */
  location?: string;
  /**
   * The project's saved coordinates for that address. Passed exactly like
   * TodayView and the Gantt: without them this strip asked for the address
   * TEXT alone and could show a different place (or simulated weather) than
   * the Gantt on the same screen (2026-09-24).
   */
  locationLatitude?: number;
  locationLongitude?: number;
  /**
   * 'stack' (default): one week under another — the phone, the tablet branch.
   * 'desktop' (wave 6c; passed ONLY from the classic tab's desktop branch): the
   * weeks sit side by side in a TileGrid ('nav': three ~400 px cards across a
   * 1,232 px column) instead of three 1,300 px strips.
   */
  layout?: 'stack' | 'desktop';
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

/** The screen's live progress path takes `{ silent: true }` from a card: the
 *  card has already fired its haptic, so the write must not fire a second. */
type ProgressUpdateOpts = { silent?: boolean };
const CARD_WRITE: ProgressUpdateOpts = { silent: true };

const SwipeableLookaheadCard = React.memo(function SwipeableLookaheadCard({
  task,
  allTasks,
  schedule,
  projectStartDate,
  placement,
  onProgressUpdate,
  onTaskPress,
}: {
  task: ScheduleTask;
  allTasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  /** The engine's es/ef for this task (see LookaheadView's `placements`). */
  placement: ScheduledPlacement | undefined;
  onProgressUpdate: (task: ScheduleTask, progress: number, opts?: ProgressUpdateOpts) => void;
  onTaskPress: (task: ScheduleTask) => void;
}) {
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const phaseColor = getPhaseColor(task.phase);
  const preds = getPredecessors(task, allTasks);
  const isBlocked = preds.some(p => p.status !== 'done');
  const dateRange = scheduledTaskRange(task, placement, projectStartDate, schedule.workingDaysPerWeek, schedule.nonWorkingDates);
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
      Animated.timing(flashOpacity, { toValue: 1, duration: 150, useNativeDriver: nativeDriver }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 400, useNativeDriver: nativeDriver }),
    ]).start();
  }, [flashOpacity]);

  // The PanResponder below is created ONCE, so anything it reads from a render
  // must come through this ref: a closure over the first render's `task`
  // rebuilt the schedule from the task list as it was when the card mounted,
  // silently reverting every other task edited since (smoothness pass, 4a).
  const latest = useRef({ task, onProgressUpdate, flashGreen });
  latest.current = { task, onProgressUpdate, flashGreen };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderGrant: () => {
        startProg.current = latest.current.task.progress;
      },
      onPanResponderMove: (_e, gs) => {
        if (gs.dx > 0) {
          translateX.setValue(Math.min(gs.dx * 0.5, 60));
        }
      },
      onPanResponderRelease: (_e, gs) => {
        const cur = latest.current;
        let next: number | null = null;
        if (gs.dx > 50) {
          const n = Math.min(100, Math.ceil((startProg.current + 25) / 25) * 25);
          if (n !== startProg.current) next = n;
        }
        // Feedback first: the haptic, the flash and the spring-back all start
        // on this frame; the CPM rebuild and save run on the next one.
        if (next !== null && Platform.OS !== 'web') {
          if (next >= 100) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        if (next !== null) cur.flashGreen();
        Animated.spring(translateX, { toValue: 0, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
        if (next !== null) {
          const value = next;
          requestAnimationFrame(() => latest.current.onProgressUpdate(cur.task, value, CARD_WRITE));
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start();
      },
    })
  ).current;

  // Same order on a tap: the haptic and the flash first, the write a frame later.
  const handleIncrement = useCallback(() => {
    const next = Math.min(100, task.progress + 25);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    flashGreen();
    requestAnimationFrame(() => latest.current.onProgressUpdate(task, next, CARD_WRITE));
  }, [task, flashGreen]);

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
                  <AlertTriangle size={9} color={t.dangerLabel} strokeWidth={1.75} />
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
  locationLatitude,
  locationLongitude,
  layout = 'stack',
}: LookaheadViewProps) {
  const isDesktop = layout === 'desktop';
  // Built per theme: the week cards, day columns and their ink baked their
  // t.surface/text/cardBorder at import (audit 2026-09-07).
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const [weekCount, setWeekCount] = useState<3 | 6>(3);
  const now = useMemo(() => new Date(), []);

  // Where the ENGINE schedules each task, on this view's anchor, working week
  // AND site closures. Weeks used to be bucketed by the stored startDay (the
  // pin) walked without closures, so a task pushed by a longer predecessor sat
  // in the week it was first planned for, and a closure never moved anything
  // (audit #51). Same basis as the Gantt and grid (CPM es/ef) and as
  // utils/lastPlanner's lookahead.
  const placements = useMemo(() => scheduledPlacements(runCpm(tasks, {
    scheduleStartDate: toCalendarDayString(projectStartDate),
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    nonWorkingDates: schedule.nonWorkingDates,
  }), true), [tasks, projectStartDate, schedule.workingDaysPerWeek, schedule.nonWorkingDates]);

  /**
   * Real forecast for THIS jobsite. This view used to call
   * getSimulatedForecast() unconditionally — it never even attempted the API,
   * and the simulator ignores the region entirely, so the strip showed
   * calendar-derived fiction with no relation to the site.
   *
   * Now it goes through getForecastWithFallback, the same path and the same
   * location (text + saved coordinates) the Gantt and TodayView use: live
   * OpenWeather (5 real days on the free tier), simulated only for the padded
   * tail — or for everything when there's no location or no answer. Whatever comes back is tagged
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
      { city: location?.trim(), latitude: locationLatitude, longitude: locationLongitude },
      now,
      weekCount * 7,
    ).then((days) => {
      if (!cancelled) setForecast(days);
    });
    return () => { cancelled = true; };
  }, [now, weekCount, location, locationLatitude, locationLongitude]);

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
        const { start, end } = scheduledTaskRange(t, placements.get(t.id), projectStartDate, schedule.workingDaysPerWeek, schedule.nonWorkingDates);
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
  }, [tasks, schedule, projectStartDate, now, weekCount, forecast, placements]);

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
                  {isRisky && <AlertTriangle size={10} color={t.warningLabel} strokeWidth={1.75} />}
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
                    placement={placements.get(task.id)}
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
  }, [tasks, schedule, projectStartDate, placements, onProgressUpdate, onTaskPress, renderWeekHeader]);

  // Only the days actually on screen count. If a padded/simulated day falls
  // outside every rendered week, there is nothing to warn about.
  const displayedDays = useMemo(
    () => weekGroups.flatMap((g) => g.forecast),
    [weekGroups],
  );
  // Where the strip's weather is for, and why any shown day is simulated.
  const weatherDesc = describeForecast(
    { city: location, latitude: locationLatitude, longitude: locationLongitude },
    displayedDays,
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
      <WeatherPlaceLine text={weatherDesc.placeLine} />
      <SimulatedWeatherBanner days={displayedDays} cause={weatherDesc.cause} />

      {isDesktop ? (
        <TileGrid preset="nav" testID="lookahead-week-grid">
          {weekGroups.map((item) => (
            <View key={item.label}>{renderItem({ item })}</View>
          ))}
        </TileGrid>
      ) : (
        <FlatList
          data={weekGroups}
          renderItem={renderItem}
          keyExtractor={(item) => item.label}
          scrollEnabled={false}
          contentContainerStyle={s.weekList}
        />
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 12 },

  segmentControl: {
    flexDirection: 'row',
    backgroundColor: t.neutralSoft,
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
  segmentBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  segmentBtnTextActive: { color: '#FFF' },

  weekList: { gap: 16 },

  weekSection: { gap: 8 },
  weekHeader: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: t.line,
    gap: 8,
  },
  weekHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekLabel: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  weekSummary: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '500' as const },

  weekWeatherRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-around' },
  weekWeatherDay: { alignItems: 'center', gap: 1 },
  weekWeatherDayBad: { opacity: 0.5 },
  weekWeatherDayName: { fontSize: 10, fontWeight: '600' as const, color: t.textMuted },
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
    backgroundColor: t.neutralSoft,
    borderRadius: Tokens.radius.card,
  },
  weekEmptyText: { fontSize: Type.footnote.fontSize, color: t.textMuted },

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
    color: t.text,
    letterSpacing: 0.1,
  },
  crewGroupMeta: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
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
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: t.line,
  },
  taskCardBlocked: { borderColor: '#FF3B3025' },
  taskPhaseBar: { width: 4 },
  taskCardBody: { flex: 1, padding: 12, gap: 6 },
  taskCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskCardTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text, flex: 1, marginRight: 8 },
  blockedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FF3B3012',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
  },
  blockedTagText: { fontSize: 9, fontWeight: '800' as const, color: t.dangerLabel },
  taskCardMeta: { flexDirection: 'row', gap: 10 },
  taskCardCrewText: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  taskCardDayText: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  taskCardProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskCardProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.neutralSoft,
    overflow: 'hidden' as const,
  },
  taskCardProgressFill: { height: '100%', borderRadius: 3 },
  taskCardProgressText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.text, minWidth: 28, textAlign: 'right' as const },
  incrementBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(LookaheadView);
