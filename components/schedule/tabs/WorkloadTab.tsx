// components/schedule/tabs/WorkloadTab.tsx — Phase 27 (real impl).
//
// Resource-by-week heatmap. Rows are unique crews/resources. Columns are
// weeks across the project span. Each cell counts how many tasks the
// resource is on during that week; cells tint amber when load ≥ 2 and
// red when load > capacity (an overallocation).
//
// Data sources, in order of preference:
//   1. project.schedule.resources[] (structured pool with name + cap)
//   2. unique task.crew strings (legacy fallback — capacity defaults to 1)
//
// Spec source: 2026-05-12-pro-scheduler-redesign-design.md §6 (Workload).

import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useScheduler } from '../SchedulerContext';
import type { ProjectResource } from '@/types';

interface WorkloadTabProps {
  resources?: ProjectResource[];
  onFixOverloads?: () => void;
}

interface Lane {
  id: string;
  name: string;
  cap: number;
}

const LANE_LABEL_WIDTH = 160;
const CELL_W = 56;
const ROW_H = 36;

export function WorkloadTab({ resources, onFixOverloads }: WorkloadTabProps) {
  const { tasks } = useScheduler();
  const styles = useThemedStyles(makeStyles);

  const lanes = useMemo<Lane[]>(() => {
    if (resources && resources.length > 0) {
      return resources.map(r => ({
        id: r.id,
        name: r.name,
        cap: r.maxConcurrent ?? 1,
      }));
    }
    const seen = new Set<string>();
    const out: Lane[] = [];
    for (const t of tasks) {
      const c = (t.crew || '').trim();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.push({ id: c, name: c, cap: 1 });
    }
    return out;
  }, [resources, tasks]);

  const totalDays = useMemo(() => {
    let max = 14;
    for (const t of tasks) {
      const end = (t.startDay ?? 1) + Math.max(0, t.durationDays ?? 0);
      if (end > max) max = end;
    }
    return max + 7;
  }, [tasks]);

  const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

  const load = useMemo(() => {
    const hasStructured = !!(resources && resources.length > 0);
    const matrix = new Map<string, number[]>();
    for (const lane of lanes) {
      matrix.set(lane.id, new Array(totalWeeks).fill(0));
    }
    for (const task of tasks) {
      const start = Math.max(1, task.startDay ?? 1);
      const dur = Math.max(1, task.durationDays ?? 1);
      const startWeek = Math.floor((start - 1) / 7);
      const endWeek = Math.floor((start - 1 + dur - 1) / 7);
      const laneIds = hasStructured
        ? (task.resourceIds ?? [])
        : [(task.crew || '').trim()].filter(Boolean);
      for (const lid of laneIds) {
        const row = matrix.get(lid);
        if (!row) continue;
        for (let w = startWeek; w <= endWeek && w < totalWeeks; w++) {
          row[w] += 1;
        }
      }
    }
    return matrix;
  }, [lanes, tasks, totalWeeks, resources]);

  // Over-capacity = any cell where a lane's weekly load exceeds its cap —
  // the same `v > lane.cap` threshold the heatmap uses to tint cells red.
  const hasOverload = useMemo(() => {
    for (const lane of lanes) {
      const row = load.get(lane.id) ?? [];
      if (row.some(v => v > lane.cap)) return true;
    }
    return false;
  }, [lanes, load]);

  if (lanes.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No resources yet</Text>
        <Text style={styles.emptyText}>
          Assign a crew name to each task — or add resources in project settings — and
          this heatmap will fill in.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Workload</Text>
        <Text style={styles.toolbarHint}>
          Amber ≥ 2 concurrent tasks · Red exceeds capacity
        </Text>
        {hasOverload && onFixOverloads && (
          <Pressable
            onPress={onFixOverloads}
            style={styles.fixBtn}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Fix overloads"
          >
            <Text style={styles.fixBtnText}>Fix overloads</Text>
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.headerRow}>
            <View style={{ width: LANE_LABEL_WIDTH }} />
            {Array.from({ length: totalWeeks }, (_, w) => (
              <View key={w} style={[styles.headerCell, { width: CELL_W }]}>
                <Text style={styles.headerText}>W{w + 1}</Text>
              </View>
            ))}
          </View>
          <ScrollView style={{ maxHeight: 560 }}>
            {lanes.map(lane => {
              const row = load.get(lane.id) ?? [];
              const totalLoad = row.reduce((s, v) => s + v, 0);
              return (
                <View key={lane.id} style={styles.row}>
                  <View style={[styles.label, { width: LANE_LABEL_WIDTH }]}>
                    <Text style={styles.labelName} numberOfLines={1}>{lane.name}</Text>
                    <Text style={styles.labelCap}>cap {lane.cap} · {totalLoad}h-load</Text>
                  </View>
                  {row.map((v, w) => (
                    <View
                      key={w}
                      style={[
                        styles.cell,
                        { width: CELL_W },
                        // Threshold tiers, evaluated against this lane's
                        // actual cap (not a hardcoded "≥ 2" which broke
                        // when cap=1: a load of 1 was "below" cap but
                        // still tinted warn-amber alongside cells of 2+).
                        v > lane.cap && styles.cellOver,
                        v > 0 && v === lane.cap && styles.cellWarn,
                        v > 0 && v < lane.cap && styles.cellLight,
                      ]}
                    >
                      <Text style={[styles.cellText, v > lane.cap && styles.cellTextOver]}>
                        {v > 0 ? v : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: themeColors.bg },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  toolbarTitle: { fontSize: 13, fontWeight: '700', color: themeColors.text },
  toolbarHint: { fontSize: 11, color: themeColors.textSecondary, flex: 1 },
  fixBtn: {
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.xxs + 2,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.accentFill,
  },
  fixBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: Colors.textOnAccent },
  headerRow: {
    flexDirection: 'row',
    height: 36,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
    backgroundColor: themeColors.surfaceAlt,
  },
  headerCell: { alignItems: 'center', justifyContent: 'center' },
  headerText: { fontSize: 10, fontWeight: '700', color: themeColors.textSecondary, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColors.line,
  },
  label: {
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: themeColors.surface,
    borderRightWidth: 1,
    borderRightColor: themeColors.line,
  },
  labelName: { fontSize: 12, fontWeight: '700', color: themeColors.text },
  labelCap: { fontSize: 9, color: themeColors.textSecondary, fontWeight: '600' },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: themeColors.line,
  },
  cellLight: { backgroundColor: Colors.fillTertiary },
  cellWarn: { backgroundColor: Colors.pillAtRisk + '33' },
  cellOver: { backgroundColor: Colors.pillLate + '55' },
  cellText: { fontSize: 11, fontWeight: '600', color: themeColors.text },
  cellTextOver: { color: themeColors.text, fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: themeColors.text },
  emptyText: { fontSize: 12, color: themeColors.textSecondary, textAlign: 'center', maxWidth: 320 },
});
