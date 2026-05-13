// ResourceSwimlanes — an alternate view of the schedule where rows are
// resources (crews/people) and cells show which tasks each is working on.
//
// Why it exists: MSP's "Resource Usage" view is the one place builders go
// to spot over-subscribed crews before the field sees it. MAGE keeps the
// idea but trims the data to what a GC actually reads — one row per
// resource, time on the x-axis, task pills in the lanes, and a red tint
// on any day that exceeds the resource's concurrent-task cap.
//
// Data sources:
//   - `ProjectResource[]` (structured pool) — has capacity + color
//   - `task.resourceIds[]` — structured assignment
//   - `task.crew` — legacy free-text field; we fall back to crew-name
//     buckets when no structured resources exist so old schedules still
//     render something useful.
//
// View-only for now. Drag-to-reassign is a future iteration — the grid
// already lets users edit `resourceIds` / `crew` directly.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { Users, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ScheduleTask, ProjectResource } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { colorForTask } from '@/utils/scheduleColors';

interface ResourceSwimlanesProps {
  tasks: ScheduleTask[];
  resources?: ProjectResource[];
  projectStartDate: Date;
  /** Optional — shown in the toolbar so the user has project context.
   *  When omitted, the toolbar just says "Resources". */
  projectName?: string;
}

// Per-track height when we stagger overlapping pills vertically (see
// computeTracks below). Lane row height grows with track count so pills
// never visually collide. Bumped from 22→30 so the trade-colored pills
// have real presence instead of looking like 1px hairlines.
const TRACK_HEIGHT = 30;
const TRACK_GAP = 4;
const ROW_PADDING = 14;
const ROW_HEIGHT_MIN = 76;
const HEADER_HEIGHT = 44;
const LANE_LABEL_WIDTH = 180;
const DEFAULT_COLORS = ['#FF9500', '#007AFF', '#34C759', '#AF52DE', '#FF3B30', '#5856D6', '#00C7BE'];
// Minimum gap between adjacent month-tick labels, in pixels. When two
// labels would land closer than this, we skip the later one — keeps the
// month axis from collapsing into "MAR 2026R 2026" visual sludge.
const MIN_MONTH_TICK_GAP = 56;

/**
 * Greedy bin-pack: assign each task to the lowest-numbered track where it
 * doesn't overlap a prior task in that track. Returns one entry per task
 * (in input order) with the assigned `track` plus the total `trackCount`
 * the caller needs to size the lane row.
 */
function computeTracks(tasks: ReadonlyArray<{ startDay?: number; durationDays?: number }>): {
  trackByIndex: number[];
  trackCount: number;
} {
  const ends: number[] = []; // ends[i] = day after the last task in track i finishes
  const trackByIndex: number[] = [];
  for (const t of tasks) {
    const start = Math.max(1, t.startDay ?? 1);
    const end = start + Math.max(1, t.durationDays ?? 1);
    let placed = -1;
    for (let i = 0; i < ends.length; i++) {
      if (ends[i] <= start) {
        ends[i] = end;
        placed = i;
        break;
      }
    }
    if (placed < 0) {
      ends.push(end);
      placed = ends.length - 1;
    }
    trackByIndex.push(placed);
  }
  return { trackByIndex, trackCount: Math.max(1, ends.length) };
}

function addDays(date: Date, d: number): Date {
  const x = new Date(date);
  x.setDate(x.getDate() + d);
  return x;
}

function fmtMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export default function ResourceSwimlanes({ tasks, resources, projectStartDate, projectName }: ResourceSwimlanesProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [pxPerDay, setPxPerDay] = useState(12);

  // Build the lane list. Prefer structured ProjectResource entries so the
  // user's own color + capacity settings flow through. If there aren't
  // any, fall back to unique crew strings so legacy projects still render.
  const lanes = useMemo(() => {
    type Lane = { id: string; name: string; color: string; cap: number };
    const byId = new Map<string, Lane>();
    if (resources && resources.length > 0) {
      resources.forEach((r, i) => {
        byId.set(r.id, {
          id: r.id,
          name: r.name,
          color: r.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          cap: r.maxConcurrent ?? 1,
        });
      });
    } else {
      // Legacy fallback — derive lanes from unique crew strings.
      const seen = new Set<string>();
      let i = 0;
      for (const t of tasks) {
        const c = (t.crew || '').trim();
        if (!c || seen.has(c)) continue;
        seen.add(c);
        byId.set(c, {
          id: c,
          name: c,
          color: DEFAULT_COLORS[i++ % DEFAULT_COLORS.length],
          cap: 1,
        });
      }
    }
    return Array.from(byId.values());
  }, [resources, tasks]);

  // Group tasks by lane. A task with multiple resources appears in every
  // lane it's assigned to so the user sees true load.
  const tasksByLane = useMemo(() => {
    const map = new Map<string, ScheduleTask[]>();
    for (const lane of lanes) map.set(lane.id, []);
    const hasStructured = !!(resources && resources.length > 0);
    for (const task of tasks) {
      if (hasStructured) {
        for (const rid of task.resourceIds || []) {
          if (map.has(rid)) map.get(rid)!.push(task);
        }
      } else {
        const c = (task.crew || '').trim();
        if (c && map.has(c)) map.get(c)!.push(task);
      }
    }
    return map;
  }, [lanes, tasks, resources]);

  // Total days axis. Use the furthest task finish + tail so lanes extend a
  // little past project end.
  const totalDays = useMemo(() => {
    let max = 30;
    for (const t of tasks) {
      const end = (t.startDay ?? 1) + Math.max(0, t.durationDays ?? 0);
      if (end > max) max = end;
    }
    return max + 14;
  }, [tasks]);

  const timelineWidth = totalDays * pxPerDay;

  // Per-lane daily load. Used to tint overloaded days red.
  const laneLoad = useMemo(() => {
    const result = new Map<string, number[]>();
    for (const lane of lanes) {
      const load = new Array(totalDays + 1).fill(0);
      const kids = tasksByLane.get(lane.id) ?? [];
      for (const t of kids) {
        const s = Math.max(1, t.startDay ?? 1);
        const d = Math.max(1, t.durationDays ?? 1);
        for (let i = s; i < s + d && i <= totalDays; i++) load[i]++;
      }
      result.set(lane.id, load);
    }
    return result;
  }, [lanes, tasksByLane, totalDays]);

  // Month-tick header. Anchored to the first-of-the-month so the labels
  // line up with the natural calendar boundary instead of the
  // project-start offset. We also enforce a minimum pixel gap between
  // adjacent labels so they never visually overlap at low zoom levels —
  // the previous version printed labels at every monthly stride
  // regardless of column width, which produced the "MAR 2026R 2026"
  // overlap the user reported.
  const monthTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    // First tick at the project start itself so the very left edge has a
    // month context, then subsequent ticks at each calendar month boundary.
    ticks.push({ x: 0, label: fmtMonth(projectStartDate) });
    const startY = projectStartDate.getFullYear();
    const startM = projectStartDate.getMonth();
    // Walk forward one month at a time. Convert each "first of month" back
    // to a day offset within the project axis.
    for (let i = 1; i <= 24; i++) {
      const tickDate = new Date(startY, startM + i, 1);
      const dayOffset = Math.floor((tickDate.getTime() - projectStartDate.getTime()) / 86400000);
      if (dayOffset > totalDays) break;
      const x = dayOffset * pxPerDay;
      const prevX = ticks[ticks.length - 1]?.x ?? -Infinity;
      // Skip this label if it would crowd the previous one — better to
      // show fewer labels than to print sludge.
      if (x - prevX < MIN_MONTH_TICK_GAP) continue;
      ticks.push({ x, label: fmtMonth(tickDate) });
    }
    return ticks;
  }, [totalDays, projectStartDate, pxPerDay]);

  if (lanes.length === 0) {
    return (
      <View style={styles.empty}>
        <Users size={28} color={themeColors.textMuted} />
        <Text style={styles.emptyTitle}>No resources yet</Text>
        <Text style={styles.emptyText}>
          Assign a crew name or add resources in project settings to see the lane view.
        </Text>
      </View>
    );
  }

  // Quick summary stats for the toolbar — gives the page a sense of
  // weight even when there's only one lane to render.
  const totalTasks = tasks.length;
  const overloadedCount = lanes.filter(lane => {
    const load = laneLoad.get(lane.id) ?? [];
    return load.some(v => v > lane.cap);
  }).length;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Users size={16} color={themeColors.accent} />
        <View style={styles.toolbarTitleBlock}>
          <Text style={styles.toolbarTitle} numberOfLines={1}>
            {projectName ? `${projectName} · Resources` : 'Resources'}
          </Text>
          <Text style={styles.toolbarSub}>
            {lanes.length} {lanes.length === 1 ? 'crew' : 'crews'} · {totalTasks} tasks
            {overloadedCount > 0 ? ` · ${overloadedCount} overloaded` : ''}
          </Text>
        </View>
        <View style={styles.spacer} />
        <Text style={styles.zoomValue}>{Math.round(pxPerDay)}px/d</Text>
        {Platform.OS === 'web' ? (
          React.createElement('input' as any, {
            type: 'range',
            min: 3,
            max: 40,
            step: 1,
            value: Math.round(pxPerDay),
            onChange: (e: any) => setPxPerDay(Number(e.target.value) || 12),
            style: { width: 120, cursor: 'pointer' },
            'aria-label': 'Zoom',
          })
        ) : null}
      </View>
      <ScrollView horizontal style={styles.scrollH} contentContainerStyle={{ minWidth: LANE_LABEL_WIDTH + timelineWidth }}>
        <View>
          {/* Month tick header */}
          <View style={styles.headerRow}>
            <View style={{ width: LANE_LABEL_WIDTH }} />
            <View style={{ width: timelineWidth, height: HEADER_HEIGHT, position: 'relative' }}>
              {monthTicks.map((t, i) => (
                <Text key={i} style={[styles.monthTick, { left: t.x + 4, top: 16 }]}>{t.label}</Text>
              ))}
            </View>
          </View>
          {/* Lanes */}
          <ScrollView style={{ maxHeight: 520 }}>
            {lanes.map(lane => {
              const laneTasks = tasksByLane.get(lane.id) ?? [];
              const load = laneLoad.get(lane.id) ?? [];
              const overloaded = load.some(v => v > lane.cap);
              // Stagger overlapping pills onto separate vertical tracks so
              // two crew-A tasks on the same week don't visually collide.
              const { trackByIndex, trackCount } = computeTracks(laneTasks);
              const rowHeight = Math.max(
                ROW_HEIGHT_MIN,
                ROW_PADDING * 2 + trackCount * TRACK_HEIGHT + Math.max(0, trackCount - 1) * TRACK_GAP,
              );
              return (
                <View key={lane.id} style={[styles.laneRow, { height: rowHeight }]}>
                  <View style={[styles.laneLabel, { borderLeftColor: lane.color }]}>
                    <Text style={styles.laneName} numberOfLines={1}>{lane.name}</Text>
                    <Text style={styles.laneCap}>cap {lane.cap}</Text>
                    {overloaded && (
                      <View style={styles.overloadBadge}>
                        <AlertTriangle size={10} color={themeColors.danger} />
                      </View>
                    )}
                  </View>
                  <View style={{ width: timelineWidth, height: rowHeight, position: 'relative' }}>
                    {/* Overload tint bands: for each day where load > cap, draw a red column. */}
                    {load.map((v, day) => {
                      if (v <= lane.cap) return null;
                      return (
                        <View
                          key={`ov-${day}`}
                          style={{
                            position: 'absolute',
                            left: (day - 1) * pxPerDay,
                            top: 0,
                            width: pxPerDay,
                            bottom: 0,
                            backgroundColor: themeColors.danger + '22',
                          }}
                        />
                      );
                    })}
                    {/* Task pills, staggered by track + trade-colored.
                        We use the per-task trade color (Colors.tradeColors)
                        instead of the lane color so the user can scan a
                        single lane and pick out concrete vs framing vs
                        electrical at a glance. */}
                    {laneTasks.map((t, i) => {
                      const s = Math.max(1, t.startDay ?? 1);
                      const d = Math.max(1, t.durationDays ?? 1);
                      const x = (s - 1) * pxPerDay;
                      const w = Math.max(8, d * pxPerDay);
                      const track = trackByIndex[i] ?? 0;
                      const top = ROW_PADDING + track * (TRACK_HEIGHT + TRACK_GAP);
                      const tradeColor = colorForTask(t);
                      return (
                        <View
                          key={t.id}
                          style={{
                            position: 'absolute',
                            left: x,
                            top,
                            width: w,
                            height: TRACK_HEIGHT,
                            backgroundColor: tradeColor + '2a',
                            borderLeftWidth: 3,
                            borderLeftColor: tradeColor,
                            borderRadius: 6,
                            paddingHorizontal: 8,
                            justifyContent: 'center',
                          }}
                        >
                          <Text numberOfLines={1} style={styles.pillText}>{t.title}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: Colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  toolbarTitleBlock: { flex: 1, minWidth: 0 },
  toolbarTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  toolbarSub: { fontSize: 11, color: t.textSecondary, fontWeight: '500', marginTop: 2 },
  spacer: { flex: 1 },
  zoomValue: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary, minWidth: 48, textAlign: 'right' },
  scrollH: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    backgroundColor: Colors.surfaceAlt,
  },
  monthTick: {
    position: 'absolute',
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
  },
  laneRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  laneLabel: {
    width: LANE_LABEL_WIDTH,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderLeftWidth: 3,
    height: '100%',
    backgroundColor: t.surface,
  },
  laneName: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text, flex: 1 },
  laneCap: { fontSize: 10, color: t.textSecondary, fontWeight: '600' },
  overloadBadge: {
    marginLeft: 4,
    padding: 2,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '22',
  },
  pillText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.text },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  emptyTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, marginTop: 8 },
  emptyText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center', maxWidth: 280 },
});
