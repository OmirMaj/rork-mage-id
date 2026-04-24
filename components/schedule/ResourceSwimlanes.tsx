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
import type { ScheduleTask, ProjectResource } from '@/types';

interface ResourceSwimlanesProps {
  tasks: ScheduleTask[];
  resources?: ProjectResource[];
  projectStartDate: Date;
}

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 52;
const LANE_LABEL_WIDTH = 160;
const DEFAULT_COLORS = ['#FF9500', '#007AFF', '#34C759', '#AF52DE', '#FF3B30', '#5856D6', '#00C7BE'];

function addDays(date: Date, d: number): Date {
  const x = new Date(date);
  x.setDate(x.getDate() + d);
  return x;
}

function fmtMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export default function ResourceSwimlanes({ tasks, resources, projectStartDate }: ResourceSwimlanesProps) {
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

  // Month-tick header, plain and cheap.
  const monthTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    let d = 1;
    while (d <= totalDays) {
      const date = addDays(projectStartDate, d - 1);
      ticks.push({ x: (d - 1) * pxPerDay, label: fmtMonth(date) });
      const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const step = Math.max(1, Math.floor((next.getTime() - date.getTime()) / 86400000));
      d += step;
    }
    return ticks;
  }, [totalDays, projectStartDate, pxPerDay]);

  if (lanes.length === 0) {
    return (
      <View style={styles.empty}>
        <Users size={28} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>No resources yet</Text>
        <Text style={styles.emptyText}>
          Assign a crew name or add resources in project settings to see the lane view.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Users size={14} color={Colors.primary} />
        <Text style={styles.toolbarTitle}>Resources</Text>
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
              return (
                <View key={lane.id} style={styles.laneRow}>
                  <View style={[styles.laneLabel, { borderLeftColor: lane.color }]}>
                    <Text style={styles.laneName} numberOfLines={1}>{lane.name}</Text>
                    <Text style={styles.laneCap}>cap {lane.cap}</Text>
                    {overloaded && (
                      <View style={styles.overloadBadge}>
                        <AlertTriangle size={10} color={Colors.error} />
                      </View>
                    )}
                  </View>
                  <View style={{ width: timelineWidth, height: ROW_HEIGHT, position: 'relative' }}>
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
                            backgroundColor: Colors.error + '22',
                          }}
                        />
                      );
                    })}
                    {/* Task pills */}
                    {laneTasks.map(t => {
                      const s = Math.max(1, t.startDay ?? 1);
                      const d = Math.max(1, t.durationDays ?? 1);
                      const x = (s - 1) * pxPerDay;
                      const w = Math.max(8, d * pxPerDay);
                      return (
                        <View
                          key={t.id}
                          style={{
                            position: 'absolute',
                            left: x,
                            top: 8,
                            width: w,
                            height: ROW_HEIGHT - 16,
                            backgroundColor: lane.color + '33',
                            borderLeftWidth: 3,
                            borderLeftColor: lane.color,
                            borderRadius: 4,
                            paddingHorizontal: 6,
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: Colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  toolbarTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  spacer: { flex: 1 },
  zoomValue: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, minWidth: 48, textAlign: 'right' },
  scrollH: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  monthTick: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
  },
  laneRow: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  laneLabel: {
    width: LANE_LABEL_WIDTH,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderLeftWidth: 3,
    height: '100%',
    backgroundColor: Colors.surface,
  },
  laneName: { fontSize: 12, fontWeight: '700', color: Colors.text, flex: 1 },
  laneCap: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },
  overloadBadge: {
    marginLeft: 4,
    padding: 2,
    borderRadius: 10,
    backgroundColor: Colors.error + '22',
  },
  pillText: { fontSize: 11, fontWeight: '600', color: Colors.text },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', maxWidth: 280 },
});
