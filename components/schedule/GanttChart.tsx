import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Flag, GitBranch, CloudRain } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getStatusColor,
  getPhaseColor,
} from '@/utils/scheduleEngine';
import { findWeatherRisk, type DayForecast } from '@/utils/weatherService';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface GanttChartProps {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  onTaskPress: (task: ScheduleTask) => void;
  showBaseline: boolean;
  /**
   * Optional forecast used to overlay weather warnings on tasks flagged
   * with `isWeatherSensitive`. When absent, no badges are rendered — the
   * chart stays visually identical to its pre-weather behavior. Callers
   * that want real-time weather coverage should pass the same forecast
   * they compute for the schedule screen so both views stay consistent.
   */
  forecast?: DayForecast[];
}

function GanttChart({ schedule, tasks, projectStartDate, onTaskPress, showBaseline, forecast }: GanttChartProps) {
  const totalDays = schedule.totalDurationDays;
  const ganttWidth = Math.max(SCREEN_WIDTH * 1.5, totalDays * 14 + 200);

  const phaseGroups = useMemo(() => {
    const groups: Record<string, ScheduleTask[]> = {};
    for (const task of tasks) {
      if (!groups[task.phase]) groups[task.phase] = [];
      groups[task.phase].push(task);
    }
    return groups;
  }, [tasks]);

  const todayOffset = useMemo(() => {
    const now = new Date();
    const diff = Math.ceil((now.getTime() - projectStartDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0 || diff > totalDays) return null;
    return (diff / totalDays) * 100;
  }, [projectStartDate, totalDays]);

  const renderGanttRow = useCallback((task: ScheduleTask) => {
    const statusColor = getStatusColor(task.status);
    const barLeft = totalDays > 0 ? ((task.startDay - 1) / totalDays) * 100 : 0;
    const barWidth = totalDays > 0 ? Math.max((task.durationDays / totalDays) * 100, 1.5) : 3;

    const weatherRisk =
      task.isWeatherSensitive && forecast && forecast.length > 0
        ? findWeatherRisk(
            projectStartDate,
            task.startDay,
            task.durationDays,
            forecast,
          )
        : null;

    const baselineTask = showBaseline && schedule.baseline
      ? schedule.baseline.tasks.find(b => b.id === task.id)
      : null;
    const baselineLeft = baselineTask && totalDays > 0
      ? ((baselineTask.startDay - 1) / totalDays) * 100 : null;
    const baselineWidth = baselineTask && totalDays > 0
      ? Math.max(((baselineTask.endDay - baselineTask.startDay) / totalDays) * 100, 1.5) : null;

    return (
      <TouchableOpacity
        key={task.id}
        style={s.ganttRow}
        onPress={() => onTaskPress(task)}
        activeOpacity={0.7}
      >
        <View style={s.ganttLabel}>
          <View style={s.ganttLabelIcons}>
            {task.isMilestone && <Flag size={9} color="#FF9500" />}
            {task.isCriticalPath && <GitBranch size={9} color={Colors.error} />}
            {weatherRisk && <CloudRain size={9} color="#F5A623" />}
          </View>
          <Text style={s.ganttLabelText} numberOfLines={1}>{task.title}</Text>
          <Text style={s.ganttLabelPercent}>{task.progress}%</Text>
        </View>
        <View style={s.ganttBarArea}>
          {baselineLeft !== null && baselineWidth !== null && (
            <View
              style={[
                s.ganttBaselineBar,
                { left: `${baselineLeft}%` as any, width: `${baselineWidth}%` as any },
              ]}
            />
          )}
          {task.isMilestone ? (
            <View
              style={[
                s.ganttDiamond,
                { left: `${barLeft}%` as any, backgroundColor: '#007AFF' },
              ]}
            />
          ) : (
            <View
              style={[
                s.ganttBar,
                {
                  left: `${barLeft}%` as any,
                  width: `${barWidth}%` as any,
                  backgroundColor: task.isCriticalPath ? Colors.error : statusColor,
                },
              ]}
            >
              {task.progress > 0 && (
                <View style={[s.ganttBarProgress, { width: `${task.progress}%` as any }]} />
              )}
            </View>
          )}
          {weatherRisk && (
            <View
              style={[
                s.ganttWeatherBadge,
                { left: `${Math.min(barLeft + barWidth, 99)}%` as any },
              ]}
              testID={`gantt-weather-warning-${task.id}`}
            >
              <Text style={s.ganttWeatherIcon}>{weatherRisk.icon}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [totalDays, schedule, showBaseline, onTaskPress, forecast, projectStartDate]);

  return (
    <View style={s.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator style={s.horizontalScroll}>
        <View style={{ width: ganttWidth }}>
          <View style={s.headerRow}>
            <View style={s.headerLabel}>
              <Text style={s.headerLabelText}>Task</Text>
            </View>
            <View style={s.headerTimeline}>
              {Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
                const weekStart = addDays(projectStartDate, i * 7);
                return (
                  <View key={i} style={[s.weekColumn, { width: `${(7 / totalDays) * 100}%` as any }]}>
                    <Text style={s.weekLabel}>{formatShortDate(weekStart)}</Text>
                  </View>
                );
              })}
              {todayOffset !== null && (
                <View style={[s.todayLine, { left: `${todayOffset}%` as any }]} />
              )}
            </View>
          </View>

          {Object.entries(phaseGroups).map(([phase, phaseTasks]) => (
            <View key={phase}>
              <View style={[s.phaseHeader, { borderLeftColor: getPhaseColor(phase) }]}>
                <Text style={s.phaseHeaderText}>{phase}</Text>
                <Text style={s.phaseHeaderCount}>{phaseTasks.length}</Text>
              </View>
              {phaseTasks.map(renderGanttRow)}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  horizontalScroll: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    height: 32,
  },
  headerLabel: {
    width: 130,
    justifyContent: 'center',
    paddingLeft: 12,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  headerLabelText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  headerTimeline: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative' as any,
  },
  weekColumn: {
    borderRightWidth: 0.5,
    borderRightColor: Colors.borderLight,
    justifyContent: 'center',
    paddingLeft: 4,
  },
  weekLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  todayLine: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FF3B30',
    zIndex: 10,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surfaceAlt,
    borderLeftWidth: 3,
  },
  phaseHeaderText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  phaseHeaderCount: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  ganttRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  ganttLabel: {
    width: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  ganttLabelIcons: {
    flexDirection: 'row',
    gap: 2,
  },
  ganttLabelText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  ganttLabelPercent: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  ganttBarArea: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  ganttBar: {
    position: 'absolute' as const,
    height: 16,
    borderRadius: 4,
    minWidth: 4,
    overflow: 'hidden' as const,
  },
  ganttBarProgress: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
  },
  ganttBaselineBar: {
    position: 'absolute' as const,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(120,120,128,0.2)',
    top: 14,
  },
  ganttDiamond: {
    position: 'absolute' as const,
    width: 10,
    height: 10,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  ganttWeatherBadge: {
    position: 'absolute' as const,
    top: -2,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFF4E0',
    borderWidth: 1,
    borderColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ganttWeatherIcon: {
    fontSize: 8,
  },
});

export default React.memo(GanttChart);
