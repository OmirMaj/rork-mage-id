import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { GitBranch } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getPhaseColor,
  getTaskDateRange,
} from '@/utils/scheduleEngine';
import { getConditionIcon, type DayForecast } from '@/utils/weatherService';
import {
  SimulatedWeatherBanner,
  SimulatedDayChip,
} from '@/components/schedule/SimulatedWeatherNotice';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface VerticalGanttProps {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  onTaskPress: (task: ScheduleTask) => void;
  showBaseline: boolean;
  /**
   * Forecast for the weather icon in each day row. Supplied by the parent —
   * the SAME array the horizontal GanttChart gets, which comes from
   * getForecastWithFallback keyed to the project's location.
   *
   * This used to be `getSimulatedForecast(now, 21)` called locally: the real
   * API was never attempted and every icon in the date column was invented,
   * unlabelled. Omitting the prop now renders NO weather at all rather than
   * fabricating it — a blank column is honest, a made-up one is not.
   */
  forecast?: DayForecast[];
}

interface DayRow {
  date: Date;
  dateStr: string;
  isToday: boolean;
  isWeekend: boolean;
  dayLabel: string;
  weekdayLabel: string;
  tasks: ScheduleTask[];
  weatherIcon?: string;
  isWorkable?: boolean;
  /** Provenance of the day's reading; undefined when there is no reading. */
  weatherSource?: DayForecast['source'];
}

function VerticalGantt({ schedule, tasks, projectStartDate, onTaskPress, showBaseline: _showBaseline, forecast }: VerticalGanttProps) {
  const now = useMemo(() => new Date(), []);
  const totalDays = schedule.totalDurationDays;
  const days = useMemo(() => forecast ?? [], [forecast]);

  const dayRows = useMemo<DayRow[]>(() => {
    const rows: DayRow[] = [];
    const displayDays = Math.min(totalDays + 5, 90);

    for (let d = 0; d < displayDays; d++) {
      const date = new Date(projectStartDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const todayStr = now.toISOString().split('T')[0];
      const isToday = dateStr === todayStr;

      const dayTasks = tasks.filter(t => {
        const range = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
        return date >= range.start && date <= range.end && !t.isMilestone;
      });

      const weather = days.find(f => f.date === dateStr);

      rows.push({
        date,
        dateStr,
        isToday,
        isWeekend,
        dayLabel: formatShortDate(date),
        weekdayLabel: date.toLocaleDateString('en-US', { weekday: 'short' }),
        tasks: dayTasks,
        weatherIcon: weather ? getConditionIcon(weather.condition) : undefined,
        isWorkable: weather?.isWorkable,
        weatherSource: weather?.source,
      });
    }
    return rows;
  }, [tasks, projectStartDate, schedule, totalDays, now, days]);

  const renderTaskBar = useCallback((task: ScheduleTask) => {
    const phaseColor = getPhaseColor(task.phase);

    return (
      <TouchableOpacity
        key={task.id}
        style={[s.taskBar, { backgroundColor: task.isCriticalPath ? Colors.error + '18' : phaseColor + '18' }]}
        onPress={() => onTaskPress(task)}
        activeOpacity={0.7}
      >
        <View style={[s.taskBarFill, { width: `${task.progress}%` as any, backgroundColor: phaseColor + '30' }]} />
        <View style={s.taskBarContent}>
          <View style={s.taskBarIcons}>
            {task.isCriticalPath && <GitBranch size={9} color={Colors.error} strokeWidth={1.75} />}
          </View>
          <Text style={[s.taskBarTitle, { color: phaseColor }]} numberOfLines={1}>{task.title}</Text>
          <Text style={s.taskBarPercent}>{task.progress}%</Text>
        </View>
      </TouchableOpacity>
    );
  }, [onTaskPress]);

  const renderDayRow = useCallback((row: DayRow) => {
    if (row.isWeekend && row.tasks.length === 0) return null;

    return (
      <View key={row.dateStr} style={[s.dayRow, row.isToday && s.dayRowToday, row.isWeekend && s.dayRowWeekend]}>
        {row.isToday && <View style={s.todayIndicator} />}
        <View style={s.dayLabel}>
          <Text style={[s.dayWeekday, row.isToday && s.dayWeekdayToday]}>{row.weekdayLabel}</Text>
          <Text style={[s.dayDate, row.isToday && s.dayDateToday]}>{row.dayLabel}</Text>
          {row.weatherIcon && (
            <Text style={s.dayWeather}>{row.weatherIcon}</Text>
          )}
          {/* Per-day marker, same chip LookaheadView uses. Only the days past
              the live horizon carry it, so a mixed column reads correctly. */}
          {row.weatherSource && <SimulatedDayChip source={row.weatherSource} />}
        </View>
        <View style={s.dayTasks}>
          {row.tasks.length === 0 ? (
            <View style={s.emptyDay} />
          ) : (
            row.tasks.map(renderTaskBar)
          )}
        </View>
      </View>
    );
  }, [renderTaskBar]);

  // Only the rows that actually render count — renderDayRow drops empty
  // weekends, and a day with no forecast entry shows no weather at all.
  const displayedWeatherDays = useMemo(
    () =>
      dayRows
        .filter((r) => !(r.isWeekend && r.tasks.length === 0))
        .map((r) => r.weatherSource)
        .filter((src): src is DayForecast['source'] => src != null)
        .map((source) => ({ source })),
    [dayRows],
  );

  return (
    <View style={s.container}>
      {/* Pinned above the scroller, not inside it — a trust warning that can
          be scrolled out of sight is not a warning. Self-hiding when live. */}
      <SimulatedWeatherBanner days={displayedWeatherDays} style={s.simBannerSpacing} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={s.headerDateCol}>
            <Text style={s.headerLabel}>DATE</Text>
          </View>
          <View style={s.headerTaskCol}>
            <Text style={s.headerLabel}>TASKS</Text>
          </View>
        </View>
        {dayRows.map(renderDayRow)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  // Layout only for the shared marker (components/schedule/SimulatedWeatherNotice).
  simBannerSpacing: { marginHorizontal: 4, marginBottom: 8 },
  header: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  headerDateCol: { width: 80, paddingLeft: 8 },
  headerTaskCol: { flex: 1, paddingLeft: 8 },
  headerLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  dayRow: {
    flexDirection: 'row',
    minHeight: 44,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    alignItems: 'stretch',
  },
  dayRowToday: {
    backgroundColor: Colors.primary + '06',
  },
  dayRowWeekend: {
    backgroundColor: Colors.fillSecondary,
  },
  todayIndicator: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: Colors.error,
    borderRadius: 1.5,
  },
  dayLabel: {
    width: 80,
    paddingVertical: 8,
    paddingLeft: 10,
    justifyContent: 'center',
    gap: 1,
  },
  dayWeekday: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  dayWeekdayToday: { color: Colors.error, fontWeight: '800' as const },
  dayDate: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  dayDateToday: { color: Colors.error, fontWeight: '800' as const },
  dayWeather: { fontSize: Type.caption1.fontSize, marginTop: 1 },
  dayTasks: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 3,
    justifyContent: 'center',
  },
  emptyDay: { height: 20 },
  taskBar: {
    borderRadius: Tokens.radius.sm,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  taskBarFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: Tokens.radius.sm,
  },
  taskBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  taskBarIcons: { flexDirection: 'row', gap: 2 },
  taskBarTitle: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
  },
  taskBarPercent: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textMuted,
  },
});

export default React.memo(VerticalGantt);
