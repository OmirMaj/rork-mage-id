import React, { useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  Animated,
  PanResponder,
  Image,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  CheckCircle2,
  Plus,
  Camera,
  MessageSquare,
  Clock,
  AlertTriangle,
  ChevronRight,
  Trophy,
  Sun,
  ImageIcon,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getPhaseColor,
  getTaskDateRange,
  getPredecessors,
  getSuccessors,
} from '@/utils/scheduleEngine';
import { getSimulatedForecast, getConditionIcon } from '@/utils/weatherService';

interface TodayViewProps {
  tasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
  onPhotoPress?: (task: ScheduleTask) => void;
  onPhotoAdded?: (task: ScheduleTask, photo: { uri: string; timestamp: string; note?: string }) => void;
  healthScore: number;
  daysRemaining: number;
}

const SwipeableActiveCard = React.memo(function SwipeableActiveCard({
  task,
  schedule,
  projectStartDate,
  allTasks,
  onProgressUpdate,
  onTaskPress,
  onPhotoAdded,
}: {
  task: ScheduleTask;
  schedule: ProjectSchedule;
  projectStartDate: Date;
  allTasks: ScheduleTask[];
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
  onPhotoAdded?: (task: ScheduleTask, photo: { uri: string; timestamp: string; note?: string }) => void;
}) {
  const phaseColor = getPhaseColor(task.phase);
  const dateRange = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
  const totalDays = task.durationDays;
  const daysPassed = Math.max(
    1,
    Math.ceil((new Date().getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24))
  );
  const dayOfN = Math.min(daysPassed, totalDays);

  const preds = getPredecessors(task, allTasks);
  const predsComplete = preds.every(p => p.status === 'done');
  const predsInProgress = preds.some(p => p.status === 'in_progress');

  const succs = getSuccessors(task.id, allTasks);
  const willUnblock = succs.filter(s => {
    const sPreds = getPredecessors(s, allTasks);
    const otherPreds = sPreds.filter(p => p.id !== task.id);
    return otherPreds.every(p => p.status === 'done');
  });

  const translateX = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const readyGlow = useRef(new Animated.Value(0)).current;
  const cardWidth = useRef(0);
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
          const increment = 25;
          const next = Math.min(100, Math.ceil((startProg.current + increment) / 25) * 25);
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
    const next = Math.min(100, task.progress + 10);
    onProgressUpdate(task, next);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (next >= 100 && willUnblock.length > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(readyGlow, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(readyGlow, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]),
        { iterations: 3 }
      ).start();
    }
  }, [task, onProgressUpdate, willUnblock, readyGlow]);

  const handleComplete = useCallback(() => {
    onProgressUpdate(task, 100);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [task, onProgressUpdate]);

  const handlePhotoCapture = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        const libResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: true,
        });
        if (!libResult.canceled && libResult.assets[0]) {
          onPhotoAdded?.(task, {
            uri: libResult.assets[0].uri,
            timestamp: new Date().toISOString(),
          });
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        allowsEditing: true,
      });

      if (!result.canceled && result.assets[0]) {
        onPhotoAdded?.(task, {
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
        });
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.log('[TodayView] Photo capture error:', err);
      try {
        const libResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: true,
        });
        if (!libResult.canceled && libResult.assets[0]) {
          onPhotoAdded?.(task, {
            uri: libResult.assets[0].uri,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (libErr) {
        console.log('[TodayView] Library pick error:', libErr);
      }
    }
  }, [task, onPhotoAdded]);

  const photoCount = task.photos?.length ?? 0;

  return (
    <View
      style={s.swipeWrapper}
      onLayout={(e) => { cardWidth.current = e.nativeEvent.layout.width; }}
    >
      <View style={s.swipeBg}>
        <ChevronRight size={16} color="#FFF" />
        <Text style={s.swipeBgText}>+25%</Text>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={s.activeCard}
          onPress={() => onTaskPress(task)}
          activeOpacity={0.85}
        >
          <View style={[s.activeCardPhaseBar, { backgroundColor: phaseColor }]} />
          <View style={s.activeCardContent}>
            <View style={s.activeCardHeader}>
              <Text style={s.activeCardTitle} numberOfLines={1}>{task.title}</Text>
              <View style={s.dayIndicator}>
                <Text style={s.dayIndicatorText}>Day {dayOfN} of {totalDays}</Text>
              </View>
            </View>

            {task.crew ? (
              <Text style={s.activeCardCrew}>{task.crew}{task.crewSize ? ` (${task.crewSize})` : ''}</Text>
            ) : null}

            {preds.length > 0 && (
              <View style={s.predRow}>
                {predsComplete ? (
                  <View style={s.predBadgeGreen}>
                    <CheckCircle2 size={10} color="#34C759" />
                    <Text style={s.predBadgeTextGreen}>Predecessors done</Text>
                  </View>
                ) : predsInProgress ? (
                  <View style={s.predBadgeYellow}>
                    <Clock size={10} color="#FF9500" />
                    <Text style={s.predBadgeTextYellow}>Predecessors in progress</Text>
                  </View>
                ) : (
                  <View style={s.predBadgeRed}>
                    <AlertTriangle size={10} color="#FF3B30" />
                    <Text style={s.predBadgeTextRed}>Blocked</Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity
              style={s.progressBarContainer}
              onPress={handleIncrement}
              activeOpacity={0.8}
            >
              <View style={s.progressTrack}>
                <View
                  style={[s.progressFill, { width: `${task.progress}%` as any, backgroundColor: phaseColor }]}
                />
              </View>
              <Text style={[s.progressPercent, { color: phaseColor }]}>{task.progress}%</Text>
            </TouchableOpacity>

            <View style={s.quickActions}>
              <TouchableOpacity style={s.quickActionBtn} onPress={handleIncrement}>
                <Plus size={14} color={Colors.primary} />
                <Text style={s.quickActionLabel}>+10%</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.quickActionBtn, s.quickActionBtnComplete]}
                onPress={handleComplete}
              >
                <CheckCircle2 size={14} color="#34C759" />
                <Text style={[s.quickActionLabel, { color: '#34C759' }]}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickActionBtn} onPress={handlePhotoCapture}>
                <Camera size={14} color={Colors.info} />
                {photoCount > 0 && (
                  <Text style={[s.quickActionLabel, { color: Colors.info }]}>{photoCount}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.quickActionBtn} onPress={() => onTaskPress(task)}>
                <MessageSquare size={14} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {photoCount > 0 && (
              <View style={s.photoStrip}>
                {task.photos!.slice(-3).map((photo, idx) => (
                  <View key={idx} style={s.photoThumb}>
                    <Image source={{ uri: photo.uri }} style={s.photoThumbImg} />
                  </View>
                ))}
                {photoCount > 3 && (
                  <View style={s.photoMore}>
                    <ImageIcon size={10} color={Colors.textMuted} />
                    <Text style={s.photoMoreText}>+{photoCount - 3}</Text>
                  </View>
                )}
              </View>
            )}
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

function TodayView({
  tasks,
  schedule,
  projectStartDate,
  onProgressUpdate,
  onTaskPress,
  onPhotoAdded,
  healthScore,
  daysRemaining,
}: TodayViewProps) {
  const now = useMemo(() => new Date(), []);

  const forecast = useMemo(() => getSimulatedForecast(now, 4), [now]);
  const todayWeather = forecast[0];

  const activeTasks = useMemo(() => {
    return tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false;
      const { start, end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      return start <= now && end >= now;
    });
  }, [tasks, projectStartDate, schedule, now]);

  const comingUpTasks = useMemo(() => {
    const threeDaysOut = new Date(now);
    threeDaysOut.setDate(threeDaysOut.getDate() + 3);
    return tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false;
      const { start } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      return start > now && start <= threeDaysOut;
    }).slice(0, 8);
  }, [tasks, projectStartDate, schedule, now]);

  const overdueTasks = useMemo(() => {
    return tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false;
      const { end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      return end < now && t.progress < 100;
    });
  }, [tasks, projectStartDate, schedule, now]);

  const completedToday = useMemo(() => {
    return tasks.filter(t => t.status === 'done').slice(0, 5);
  }, [tasks]);

  const blockedComingUp = useMemo(() => {
    return comingUpTasks.filter(t => {
      const preds = getPredecessors(t, tasks);
      return preds.some(p => p.status !== 'done');
    });
  }, [comingUpTasks, tasks]);

  const dateFormatted = useMemo(() => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    };
    return now.toLocaleDateString('en-US', options);
  }, [now]);

  const renderActiveItem = useCallback(
    ({ item }: { item: ScheduleTask }) => (
      <SwipeableActiveCard
        task={item}
        schedule={schedule}
        projectStartDate={projectStartDate}
        allTasks={tasks}
        onProgressUpdate={onProgressUpdate}
        onTaskPress={onTaskPress}
        onPhotoAdded={onPhotoAdded}
      />
    ),
    [schedule, projectStartDate, tasks, onProgressUpdate, onTaskPress, onPhotoAdded]
  );

  return (
    <View style={s.container}>
      <View style={s.todayHeader}>
        <View style={s.todayHeaderLeft}>
          <Text style={s.todayDate}>{dateFormatted}</Text>
          <View style={s.todayBadges}>
            <View style={s.healthMini}>
              <View style={[s.healthMiniDot, { backgroundColor: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : '#FF3B30' }]} />
              <Text style={s.healthMiniText}>{healthScore}</Text>
            </View>
            <View style={s.daysLeftMini}>
              <Clock size={10} color={Colors.textSecondary} />
              <Text style={s.daysLeftMiniText}>{daysRemaining}d left</Text>
            </View>
          </View>
        </View>
        {todayWeather && (
          <View style={s.weatherCard}>
            <Text style={s.weatherIcon}>{getConditionIcon(todayWeather.condition)}</Text>
            <Text style={s.weatherTemp}>{todayWeather.tempHigh}°F</Text>
            <Text style={s.weatherPrecip}>{todayWeather.precipChance}%💧</Text>
          </View>
        )}
      </View>

      {forecast.length > 1 && (
        <View style={s.forecastRow}>
          {forecast.slice(1).map((f) => {
            const d = new Date(f.date);
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            return (
              <View key={f.date} style={[s.forecastDay, !f.isWorkable && s.forecastDayBad]}>
                <Text style={s.forecastDayName}>{dayName}</Text>
                <Text style={s.forecastDayIcon}>{getConditionIcon(f.condition)}</Text>
                <Text style={s.forecastDayTemp}>{f.tempHigh}°</Text>
              </View>
            );
          })}
        </View>
      )}

      {overdueTasks.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeaderOverdue}>
            <AlertTriangle size={14} color="#FF3B30" />
            <Text style={s.sectionTitleOverdue}>Overdue ({overdueTasks.length})</Text>
          </View>
          {overdueTasks.map(task => {
            const { end } = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
            const daysOver = Math.ceil((now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
            return (
              <TouchableOpacity
                key={task.id}
                style={s.overdueCard}
                onPress={() => onTaskPress(task)}
                activeOpacity={0.7}
              >
                <View style={s.overdueLeft}>
                  <Text style={s.overdueTitle} numberOfLines={1}>{task.title}</Text>
                  <Text style={s.overdueMeta}>{daysOver}d overdue · {task.progress}% done</Text>
                </View>
                <View style={s.overdueActions}>
                  <TouchableOpacity
                    style={s.overdueResolveBtn}
                    onPress={() => onProgressUpdate(task, 100)}
                  >
                    <Text style={s.overdueResolveBtnText}>Mark Done</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Sun size={14} color={Colors.accent} />
          <Text style={s.sectionTitle}>Active Now ({activeTasks.length})</Text>
        </View>
        {activeTasks.length > 0 && (
          <View style={s.swipeHint}>
            <ChevronRight size={10} color={Colors.textMuted} />
            <Text style={s.swipeHintText}>Swipe right on a task to update progress</Text>
          </View>
        )}
        {activeTasks.length === 0 ? (
          <View style={s.emptyActive}>
            <CheckCircle2 size={28} color={Colors.success} />
            <Text style={s.emptyActiveText}>No tasks active today</Text>
          </View>
        ) : (
          <FlatList
            data={activeTasks}
            renderItem={renderActiveItem}
            keyExtractor={item => item.id}
            scrollEnabled={false}
            contentContainerStyle={s.activeList}
          />
        )}
      </View>

      {comingUpTasks.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <ChevronRight size={14} color={Colors.info} />
            <Text style={s.sectionTitle}>Coming Up (Next 3 Days)</Text>
          </View>
          {comingUpTasks.map(task => {
            const { start } = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
            const isBlocked = blockedComingUp.includes(task);
            return (
              <TouchableOpacity
                key={task.id}
                style={[s.compactCard, isBlocked && s.compactCardBlocked]}
                onPress={() => onTaskPress(task)}
                activeOpacity={0.7}
              >
                <View style={[s.compactDot, { backgroundColor: getPhaseColor(task.phase) }]} />
                <View style={s.compactInfo}>
                  <Text style={s.compactTitle} numberOfLines={1}>{task.title}</Text>
                  <Text style={s.compactMeta}>
                    {formatShortDate(start)} · {task.durationDays}d{task.crew ? ` · ${task.crew}` : ''}
                  </Text>
                </View>
                {isBlocked && (
                  <View style={s.blockedBadge}>
                    <AlertTriangle size={10} color="#FF3B30" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {completedToday.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeaderGreen}>
            <Trophy size={14} color="#34C759" />
            <Text style={s.sectionTitleGreen}>Completed ({completedToday.length})</Text>
          </View>
          {completedToday.map(task => (
            <View key={task.id} style={s.completedCard}>
              <CheckCircle2 size={14} color="#34C759" />
              <Text style={s.completedTitle} numberOfLines={1}>{task.title}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 16 },

  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  todayHeaderLeft: { flex: 1, gap: 6 },
  todayDate: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  todayBadges: { flexDirection: 'row', gap: 8 },
  healthMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  healthMiniDot: { width: 6, height: 6, borderRadius: 3 },
  healthMiniText: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  daysLeftMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  daysLeftMiniText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },

  weatherCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    minWidth: 70,
    gap: 2,
  },
  weatherIcon: { fontSize: 22 },
  weatherTemp: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  weatherPrecip: { fontSize: 10, color: Colors.textSecondary },

  forecastRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-around',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  forecastDay: { alignItems: 'center', gap: 2, flex: 1 },
  forecastDayBad: { opacity: 0.6 },
  forecastDayName: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  forecastDayIcon: { fontSize: 16 },
  forecastDayTemp: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },

  section: { gap: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  sectionHeaderOverdue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitleOverdue: { fontSize: 15, fontWeight: '700' as const, color: '#FF3B30' },
  sectionHeaderGreen: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitleGreen: { fontSize: 15, fontWeight: '700' as const, color: '#34C759' },

  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4,
  },
  swipeHintText: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' as const },

  emptyActive: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  emptyActiveText: { fontSize: 14, color: Colors.textSecondary },

  activeList: { gap: 10 },

  swipeWrapper: {
    position: 'relative' as const,
    borderRadius: 16,
    overflow: 'hidden' as const,
  },
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C759',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    gap: 4,
  },
  swipeBgText: { fontSize: 13, fontWeight: '800' as const, color: '#FFF' },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C75920',
    borderRadius: 16,
  },

  activeCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  activeCardPhaseBar: { width: 5 },
  activeCardContent: { flex: 1, padding: 14, gap: 8 },
  activeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activeCardTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, flex: 1, marginRight: 8 },
  dayIndicator: {
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  dayIndicatorText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  activeCardCrew: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },

  predRow: { flexDirection: 'row' },
  predBadgeGreen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#34C75912',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  predBadgeTextGreen: { fontSize: 10, fontWeight: '600' as const, color: '#34C759' },
  predBadgeYellow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF950012',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  predBadgeTextYellow: { fontSize: 10, fontWeight: '600' as const, color: '#FF9500' },
  predBadgeRed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF3B3012',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  predBadgeTextRed: { fontSize: 10, fontWeight: '600' as const, color: '#FF3B30' },

  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.fillSecondary,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%', borderRadius: 5 },
  progressPercent: { fontSize: 14, fontWeight: '800' as const, minWidth: 36, textAlign: 'right' as const },

  quickActions: { flexDirection: 'row', gap: 8 },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  quickActionBtnComplete: { backgroundColor: '#34C75912' },
  quickActionLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },

  photoStrip: { flexDirection: 'row', gap: 6, marginTop: 2 },
  photoThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden' as const,
    backgroundColor: Colors.fillTertiary,
  },
  photoThumbImg: { width: 40, height: 40, borderRadius: 8 },
  photoMore: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  photoMoreText: { fontSize: 9, fontWeight: '700' as const, color: Colors.textMuted },

  overdueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF3B3008',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FF3B3020',
    gap: 10,
  },
  overdueLeft: { flex: 1, gap: 2 },
  overdueTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  overdueMeta: { fontSize: 12, color: '#FF3B30', fontWeight: '500' as const },
  overdueActions: { flexDirection: 'row', gap: 6 },
  overdueResolveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#34C75918',
  },
  overdueResolveBtnText: { fontSize: 12, fontWeight: '700' as const, color: '#34C759' },

  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  compactCardBlocked: { borderColor: '#FF3B3030' },
  compactDot: { width: 8, height: 8, borderRadius: 4 },
  compactInfo: { flex: 1, gap: 2 },
  compactTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  compactMeta: { fontSize: 12, color: Colors.textSecondary },
  blockedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF3B3012',
    alignItems: 'center',
    justifyContent: 'center',
  },

  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#34C75908',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#34C75918',
  },
  completedTitle: { flex: 1, fontSize: 14, fontWeight: '500' as const, color: Colors.text },
});

export default React.memo(TodayView);
