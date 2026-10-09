// components/livingModel/replayShared.tsx — the parts of Job Replay that the
// 3D view (web) and the flat view (phone, and the web's fallback) share: the
// clock that plays the job, the scrubber, the legend, the room list and the
// room card. Nothing here draws the model itself.
//
// PLANNED AND REPORTED are two readings and are never mixed
// (utils/livingModel/replayCore.ts). A task with nothing reported says "No
// Progress Reported"; it is never shown at its planned percent.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react-native';
import { useT } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy, type LivingModelCopy } from '@/hooks/useLivingModelCopy';
import { Tokens } from '@/constants/designTokens';
import { Button, SegmentedControl, useReducedMotion } from '@/components/ui';
import { useIsDesktop } from '@/components/ui/desktop';
import { labelOn } from '@/components/ui/ink';
import { liveLinks } from '@/utils/livingModel/linkCore';
import { roomAreaM2, roomBounds } from '@/utils/livingModel/modelCore';
import { livingModelPalette, type LivingModelPalette } from '@/utils/livingModel/palette';
import {
  TODAY_TOLERANCE, offsetOfWeek, roomCard, roomMoment, weekCount, weekOf,
  type ReplayMode, type ReplayTask, type RoomMoment,
} from '@/utils/livingModel/replayCore';
import { dateOfOffset, type ReplayInput } from '@/utils/livingModel/replayInput';
import { BUILD_STAGES, type RoomStage } from '@/utils/livingModel/stageCore';
import type { JobModel, PlacedRoom } from '@/utils/livingModel/types';
import { formatFeetInches, formatSqFt, sqMetresToSqFeet } from '@/utils/livingModel/measure';
import { makeLivingModelStyles } from './styles';

/** How long one week takes to play. */
const MS_PER_WEEK = 1500;

export interface ReplayState {
  offset: number;
  setOffset: (v: number) => void;
  playing: boolean;
  togglePlay: () => void;
  mode: ReplayMode;
  setMode: (m: ReplayMode) => void;
}

/** The clock that plays the job. Under Reduce Motion it steps a week at a time and tweens nothing. */
export function useReplayState(input: ReplayInput): ReplayState {
  const { clock } = input;
  const reduce = useReducedMotion();
  const [offset, setOffsetRaw] = useState(() => Math.min(clock.totalDays, Math.max(0, clock.todayOffset)));
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ReplayMode>('reported');
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const total = clock.totalDays;
  const perWeek = Math.max(1, clock.workingDaysPerWeek);

  const setOffset = useCallback((v: number) => setOffsetRaw(Math.max(0, Math.min(total, v))), [total]);

  useEffect(() => {
    if (!playing) return;
    if (reduce) {
      const id = setInterval(() => {
        const next = Math.min(total, (Math.floor(offsetRef.current / perWeek + 1e-6) + 1) * perWeek);
        setOffsetRaw(next);
        if (next >= total) setPlaying(false);
      }, 900);
      return () => clearInterval(id);
    }
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last == null) last = ts;
      const dt = Math.min(100, ts - last);
      last = ts;
      const next = Math.min(total, offsetRef.current + (dt / MS_PER_WEEK) * perWeek);
      setOffsetRaw(next);
      if (next >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduce, total, perWeek]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && offsetRef.current >= total - 1e-6) setOffsetRaw(0);
      return !p;
    });
  }, [total]);

  return { offset, setOffset, playing, togglePlay, mode, setMode };
}

/** The ticked tasks of each room that are still in the schedule. */
export function useRoomTasks(model: JobModel, input: ReplayInput): Map<string, ReplayTask[]> {
  return useMemo(() => {
    const byId = new Map(input.tasks.map((t) => [t.id, t]));
    const ids = new Set(byId.keys());
    const out = new Map<string, ReplayTask[]>();
    for (const r of model.rooms) out.set(r.id, liveLinks(model, r.id, ids).ids.map((id) => byId.get(id) as ReplayTask));
    return out;
  }, [model, input.tasks]);
}

export function useRoomMoments(roomTasks: Map<string, ReplayTask[]>, input: ReplayInput, offset: number, mode: ReplayMode): Map<string, RoomMoment> {
  return useMemo(() => {
    const out = new Map<string, RoomMoment>();
    roomTasks.forEach((tasks, roomId) => out.set(roomId, roomMoment(tasks, input.points, offset, input.clock, mode)));
    return out;
  }, [roomTasks, input.points, input.clock, offset, mode]);
}

export function usePalette(): LivingModelPalette {
  const { colors } = useTheme();
  return useMemo(() => livingModelPalette(colors), [colors]);
}

/** "Rough-In 40%" for a room at a moment: its stage, and how far that stage has come. */
export function stageLine(m: RoomMoment | undefined, copy: LivingModelCopy): string {
  if (!m) return copy.stageName('no_tasks');
  const name = copy.stageName(m.stage);
  if (m.stage === 'no_tasks' || m.stage === 'not_started' || m.stage === 'done') return name;
  const v = m.solid[m.stage as keyof typeof m.solid];
  return v != null && v > 0 && v < 1 ? `${name} ${Math.round(v * 100)}%` : name;
}

export function StageLegend() {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const palette = usePalette();
  const stages: RoomStage[] = [...BUILD_STAGES, 'other', 'done'];
  return (
    <View style={styles.legend} accessibilityLabel={copy.legendHeadingLabel} testID="lm-legend">
      {stages.map((s) => (
        <View key={s} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: palette.stage[s] }]} />
          <Text style={styles.legendText}>{copy.stageName(s)}</Text>
        </View>
      ))}
    </View>
  );
}

export function ReplayControls({ input, state, onSetStartDate }: {
  input: ReplayInput;
  state: ReplayState;
  /** Opens the schedule, where the start date is set. Shown only while the schedule has none. */
  onSetStartDate?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const isDesktop = useIsDesktop();
  const { clock } = input;
  const { offset, setOffset, playing, togglePlay, mode, setMode } = state;
  const weeks = weekCount(clock);
  const week = weekOf(offset, clock);
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  wRef.current = w;
  const total = clock.totalDays;
  const setRef = useRef(setOffset);
  setRef.current = setOffset;
  const start = useRef(0);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { if (wRef.current > 0) { start.current = e.nativeEvent.locationX; setRef.current((start.current / wRef.current) * total); } },
    onPanResponderMove: (_e, g) => { if (wRef.current > 0) setRef.current(((start.current + g.dx) / wRef.current) * total); },
  }), [total]);
  const onTrack = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  const x = (d: number) => (total > 0 ? Math.max(0, Math.min(1, d / total)) * w : 0);
  const atToday = clock.hasStartDate && Math.abs(offset - clock.todayOffset) < TODAY_TOLERANCE;
  const todayX = x(clock.todayOffset);
  const ticks = useMemo(() => {
    const stepW = weeks > 16 ? Math.ceil(weeks / 8) : weeks > 8 ? 2 : 1;
    const out: number[] = [];
    for (let i = stepW; i <= weeks; i += stepW) out.push(i);
    return out;
  }, [weeks]);

  return (
    <View style={styles.controls} testID="lm-controls">
      <View style={styles.controlsTop}>
        <Pressable style={styles.playBtn} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playing ? copy.pauseLabel : copy.playLabel} testID="lm-play">
          {playing ? <Pause size={20} color={labelOn(colors.accentFill)} /> : <Play size={20} color={labelOn(colors.accentFill)} />}
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setOffset(offsetOfWeek(Math.max(0, weekOf(offset - 1e-3, clock) - 1), clock))} accessibilityRole="button" accessibilityLabel={copy.previousWeekLabel} testID="lm-prev-week">
          <ChevronLeft size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.weekText} testID="lm-week">{copy.weekLabel(week, weeks)}</Text>
        <Pressable style={styles.iconBtn} onPress={() => setOffset(offsetOfWeek(Math.min(weeks, Math.floor(offset / clock.workingDaysPerWeek + 1e-6) + 1), clock))} accessibilityRole="button" accessibilityLabel={copy.nextWeekLabel} testID="lm-next-week">
          <ChevronRight size={18} color={colors.text} />
        </Pressable>
        {clock.hasStartDate ? (
          <Pressable style={[styles.todayTag, !atToday && { backgroundColor: colors.surfaceAlt }]} onPress={() => setOffset(clock.todayOffset)} accessibilityRole="button" accessibilityLabel={copy.todayLabel} testID="lm-today">
            <Text style={[styles.todayTagText, !atToday && { color: colors.text }]}>{copy.todayLabel}</Text>
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
        <SegmentedControl<ReplayMode>
          options={[{ value: 'planned', label: copy.plannedLabel }, { value: 'reported', label: copy.reportedLabel }]}
          value={mode}
          onChange={setMode}
          size="sm"
          style={isDesktop ? undefined : styles.modeSeg}
          accessibilityLabel={copy.modeA11yLabel}
          testID="lm-mode"
        />
      </View>
      <View
        style={styles.track}
        onLayout={onTrack}
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={copy.weekLabel(week, weeks)}
        accessibilityValue={{ min: 1, max: weeks, now: week }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => setOffset(offsetOfWeek(week + (e.nativeEvent.actionName === 'increment' ? 1 : -1), clock))}
        testID="lm-track"
      >
        <View style={styles.trackRail} pointerEvents="none" />
        {clock.hasStartDate && todayX < w ? <View pointerEvents="none" style={[styles.trackPlan, { left: todayX, width: Math.max(0, w - todayX), borderTopRightRadius: Tokens.radius.full, borderBottomRightRadius: Tokens.radius.full }]} /> : null}
        <View pointerEvents="none" style={[styles.trackPast, { width: Math.min(x(offset), clock.hasStartDate ? todayX : 0) }]} />
        {clock.hasStartDate ? <View pointerEvents="none" style={[styles.trackToday, { left: todayX - 1 }]} /> : null}
        <View pointerEvents="none" style={[styles.trackKnob, { left: x(offset) }]} />
      </View>
      <View style={styles.ticks} pointerEvents="none">
        <Text style={styles.tickText}>{copy.weekShortLabel(1)}</Text>
        {ticks.slice(-1).map((n) => <Text key={n} style={styles.tickText}>{copy.weekShortLabel(n)}</Text>)}
      </View>
      {!clock.hasStartDate ? (
        <View style={styles.noStart} testID="lm-no-start">
          <Text style={styles.warn}>{copy.noStartBody}</Text>
          {onSetStartDate ? <Button label={copy.setStartLabel} variant="secondary" size="sm" onPress={onSetStartDate} testID="lm-set-start" /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function ReplayRoomList({ model, level, moments, selectedId, onSelect }: {
  model: JobModel;
  level: number;
  moments: Map<string, RoomMoment>;
  selectedId: string | null;
  onSelect: (roomId: string | null) => void;
}) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const palette = usePalette();
  const rooms = model.rooms.filter((r) => r.level === level);
  return (
    <View style={styles.panel} testID="lm-replay-rooms">
      <Text style={styles.panelHeading}>{copy.roomsHeadingLabel}</Text>
      {rooms.map((r, i) => {
        const m = moments.get(r.id);
        const line = stageLine(m, copy);
        const on = r.id === selectedId;
        return (
          <Pressable
            key={r.id}
            style={[styles.row, i === 0 && styles.rowFirst, on && styles.rowOn]}
            onPress={() => onSelect(on ? null : r.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={copy.roomA11yLabel(r.name, line)}
            testID={`lm-replay-room-${i}`}
          >
            <View style={[styles.swatch, { backgroundColor: palette.stage[m?.stage ?? 'no_tasks'] }]} />
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{m?.ghostStage ? `${line} · ${copy.planStageSub(copy.stageName(m.ghostStage))}` : line}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RoomCardPanel({ room, tasks, input, mode, offset, onClose }: {
  room: PlacedRoom;
  tasks: ReplayTask[];
  input: ReplayInput;
  mode: ReplayMode;
  /** Where the scrubber is. The card's figures are for this moment, and the card says which. */
  offset: number;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const palette = usePalette();
  const { lang } = useT();
  const card = useMemo(() => roomCard(tasks, input.points, input.clock, offset, mode), [tasks, input.points, input.clock, offset, mode]);
  const b = roomBounds(room);
  const area = roomAreaM2(room);
  const weeks = weekCount(input.clock);
  const week = weekOf(card.offset, input.clock);
  // The same calendar the schedule screen uses: its week and its closed days.
  const dateOf = (at: number): string | null => {
    const d = dateOfOffset(input, at);
    return d ? d.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric' }) : null;
  };
  const whenLine = card.when === 'today' ? copy.asOfTodaySub
    : card.when === 'undated' && card.reading === 'reported' ? copy.undatedReportedSub
      : copy.forWeekSub(week, weeks);
  const numberLabel = card.reading === 'plan_ahead' ? copy.planAheadLabel : card.reading === 'reported' ? copy.roomReportedLabel : copy.roomPlannedLabel;
  return (
    <View style={styles.panel} testID="lm-room-card">
      <View style={styles.hudRow}>
        <Text style={[styles.panelHeading, styles.spacer]}>{room.name}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={copy.closeLabel} testID="lm-room-card-close">
          <X size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      {b ? <Text style={styles.rowSub}>{copy.roomSizeSub(formatFeetInches(b.maxX - b.minX), formatFeetInches(b.maxY - b.minY), area != null ? formatSqFt(sqMetresToSqFeet(area)) : null)}</Text> : null}
      {room.source === 'scan' ? <Text style={styles.warn}>{copy.scanCaveatBody}</Text> : null}
      {tasks.length === 0 ? <Text style={styles.para} testID="lm-room-no-tasks">{copy.noTasksRoomBody}</Text> : (
        <>
          <Text style={styles.eyebrow} testID="lm-card-when">{whenLine}</Text>
          {card.reading === 'plan_ahead' ? <Text style={styles.warn} testID="lm-card-plan-only">{copy.planOnlyBody}</Text> : null}
          <View style={styles.hudRow}>
            <Text style={[styles.rowLabel, styles.spacer]}>{numberLabel}</Text>
            <Text style={styles.rowValue} testID="lm-card-pct">{`${card.pct}%`}</Text>
          </View>
          <View style={styles.bar}><View style={[card.reading === 'reported' ? styles.barFill : styles.barFillPlan, { width: `${card.pct}%` }]} /></View>
          <Text style={styles.note} testID="lm-card-average">{card.reading === 'reported' ? copy.averageReportedBody(card.taskCount) : copy.averagePlannedBody(card.taskCount)}</Text>
          {card.reading === 'reported' && card.unreported > 0 ? <Text style={styles.note} testID="lm-room-unreported">{copy.unreportedBody(card.unreported)}</Text> : null}
          <View style={styles.nextBox}>
            <Text style={styles.eyebrow}>{copy.nextHereLabel}</Text>
            <Text style={styles.nextText}>{card.next ? copy.nextBody(card.next.title, weekOf(card.next.startOffset + 1e-3, input.clock)) : copy.allDoneBody}</Text>
          </View>
          <Text style={styles.eyebrow}>{copy.tasksInRoomLabel}</Text>
          {card.rows.map((row, i) => {
            const from = dateOf(row.startOffset);
            const to = dateOf(Math.max(row.startOffset, row.endOffset - 1));
            return (
              <View key={row.id} style={[styles.row, i === 0 && styles.rowFirst]} testID={`lm-card-task-${i}`}>
                <View style={[styles.swatch, { backgroundColor: palette.stage[row.stage] }]} />
                <View style={styles.rowMain}>
                  <Text style={styles.rowLabel} numberOfLines={2}>{row.title}</Text>
                  <Text style={styles.rowSub}>{`${copy.stageName(row.stage)} · ${from && to ? copy.plannedDatesSub(from, to) : copy.plannedWeeksSub(weekOf(row.startOffset + 1e-3, input.clock), weekOf(row.endOffset, input.clock))}`}</Text>
                </View>
                {card.reading === 'plan_ahead' ? <Text style={styles.mutedValue}>{copy.plannedPctSub(row.plannedPct)}</Text> : row.reportedPct == null
                  ? <Text style={styles.mutedValue}>{copy.noProgressLabel}</Text>
                  : <Text style={row.reportedPct >= 100 ? styles.doneText : styles.rowValue}>{copy.reportedPctSub(row.reportedPct)}</Text>}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}
