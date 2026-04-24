// TaskInspector — right-side slide-in panel showing one task's full detail.
//
// MAGE's equivalent of MSP's "Task Details" form, but tuned for the split
// grid+gantt view: when a user clicks a bar (or grid row), the inspector
// docks on the right with the full field set so they can tweak notes,
// resources, anchors, and status without losing the timeline context.
//
// Intentionally read-heavy first, edit-light: deep edits still go through
// the grid (which owns cell validation, undo, bulk ops). The inspector
// exposes the handful of one-off fields that the grid doesn't surface
// cleanly — notably notes, status, dependency list, and the raw CPM
// numbers for a "why is this task where it is" moment.
//
// Not a modal — this stays visible while the user still interacts with
// everything else. Slides in from the right on web; on native the width
// matches a phone's portrait so it acts like a full-screen drawer.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { X, Anchor, Flag, Users, CalendarClock, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

interface TaskInspectorProps {
  task: ScheduleTask | null;
  allTasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  onClose: () => void;
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
}

function dayToDate(startDate: Date, day: number): string {
  if (!Number.isFinite(day)) return '—';
  const d = new Date(startDate);
  d.setDate(d.getDate() + day - 1);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_OPTIONS: { value: NonNullable<ScheduleTask['status']>; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not started', color: Colors.textMuted },
  { value: 'in_progress', label: 'In progress', color: Colors.primary },
  { value: 'on_hold', label: 'On hold', color: Colors.warning },
  { value: 'done', label: 'Done', color: Colors.success },
];

export default function TaskInspector({
  task, allTasks, cpm, projectStartDate, onClose, onEdit,
}: TaskInspectorProps) {
  // Look up dependencies by id so we can show a readable list. Use the
  // typed link array if present; fall back to the legacy string ids.
  const depRows = useMemo(() => {
    if (!task) return [] as { id: string; title: string; type: string; lag: number }[];
    const byId = new Map(allTasks.map(t => [t.id, t]));
    const out: { id: string; title: string; type: string; lag: number }[] = [];
    if (task.dependencyLinks && task.dependencyLinks.length > 0) {
      for (const link of task.dependencyLinks) {
        const pred = byId.get(link.taskId);
        if (!pred) continue;
        out.push({
          id: pred.id,
          title: pred.title || 'Untitled',
          type: link.type || 'FS',
          lag: link.lagDays ?? 0,
        });
      }
    } else if (task.dependencies) {
      for (const did of task.dependencies) {
        const pred = byId.get(did);
        if (!pred) continue;
        out.push({ id: pred.id, title: pred.title || 'Untitled', type: 'FS', lag: 0 });
      }
    }
    return out;
  }, [task, allTasks]);

  if (!task) return null;

  const cpmRow = cpm.perTask.get(task.id);
  const anchorPretty = task.anchorType && task.anchorType !== 'none'
    ? task.anchorType.replace(/-/g, ' ')
    : null;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Info size={16} color={Colors.primary} />
        <Text style={styles.headerTitle} numberOfLines={1}>{task.title || 'Untitled task'}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <X size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Schedule block — raw CPM numbers. Makes the "why" of the bar
            position legible without the user having to open settings. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <Row label="Early start"  value={cpmRow ? dayToDate(projectStartDate, cpmRow.es) : '—'} />
          <Row label="Early finish" value={cpmRow ? dayToDate(projectStartDate, cpmRow.ef) : '—'} />
          <Row label="Late start"   value={cpmRow ? dayToDate(projectStartDate, cpmRow.ls) : '—'} />
          <Row label="Late finish"  value={cpmRow ? dayToDate(projectStartDate, cpmRow.lf) : '—'} />
          <Row label="Total float"  value={cpmRow ? `${cpmRow.totalFloat}d` : '—'}
            valueColor={cpmRow?.isCritical ? Colors.error : Colors.text} />
          <Row label="Free float"   value={cpmRow ? `${cpmRow.freeFloat}d` : '—'} />
          <Row label="Duration"     value={`${task.durationDays ?? 0}d`} />
        </View>

        {/* Status picker — quick single-tap update without opening the grid. */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Flag size={12} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Status</Text>
          </View>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => {
              const active = (task.status ?? 'not_started') === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.statusChip, active && { backgroundColor: opt.color + '22', borderColor: opt.color }]}
                  onPress={() => onEdit(task.id, { status: opt.value })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.statusDot, { backgroundColor: opt.color }]} />
                  <Text style={[styles.statusChipText, active && { color: opt.color, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Progress (%) as a segmented 0/25/50/75/100 chooser — covers the
              90% case without a slider widget. Fine-tuning still happens in
              the grid's Progress column. */}
          <Text style={[styles.subLabel, { marginTop: 10 }]}>Progress</Text>
          <View style={styles.progressRow}>
            {[0, 25, 50, 75, 100].map(p => {
              const active = (task.progress ?? 0) === p;
              return (
                <TouchableOpacity
                  key={p}
                  onPress={() => onEdit(task.id, { progress: p })}
                  style={[styles.progressChip, active && styles.progressChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.progressChipText, active && styles.progressChipTextActive]}>{p}%</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Anchor summary — read-only here; the grid owns anchor editing. */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Anchor size={12} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Anchor</Text>
          </View>
          {anchorPretty ? (
            <>
              <Row label="Type" value={anchorPretty} />
              <Row label="Date" value={task.anchorDate || '—'} />
            </>
          ) : (
            <Text style={styles.emptyText}>No anchor. CPM decides this task&apos;s dates.</Text>
          )}
        </View>

        {/* Dependencies list */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <CalendarClock size={12} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>Predecessors</Text>
          </View>
          {depRows.length === 0 ? (
            <Text style={styles.emptyText}>No predecessors.</Text>
          ) : (
            depRows.map(d => (
              <View key={d.id} style={styles.depRow}>
                <Text style={styles.depTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={styles.depMeta}>
                  {d.type}{d.lag !== 0 ? ` ${d.lag > 0 ? '+' : ''}${d.lag}d` : ''}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Crew / resources */}
        {(task.crew || (task.resourceIds && task.resourceIds.length > 0)) && (
          <View style={styles.section}>
            <View style={styles.sectionHeadRow}>
              <Users size={12} color={Colors.textSecondary} />
              <Text style={styles.sectionTitle}>Crew</Text>
            </View>
            {task.crew && <Row label="Crew" value={task.crew} />}
          </View>
        )}

        {/* Notes */}
        {task.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{task.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 340,
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
    ...(Platform.OS === 'web' ? ({
      boxShadow: '-4px 0 12px rgba(0,0,0,0.06)',
    } as any) : {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: -2, height: 0 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text },
  closeBtn: { padding: 4 },
  body: { flex: 1 },
  section: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 10,
  },
  rowLabel: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  rowValue: { fontSize: 12, fontWeight: '600', color: Colors.text, maxWidth: 180, textAlign: 'right' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.fillTertiary,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  subLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  progressRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  progressChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: Colors.fillTertiary,
  },
  progressChipActive: { backgroundColor: Colors.primary },
  progressChipText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  progressChipTextActive: { color: '#fff' },
  emptyText: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
  depRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 10,
  },
  depTitle: { fontSize: 12, color: Colors.text, flex: 1 },
  depMeta: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  notesText: { fontSize: 12, color: Colors.text, lineHeight: 18 },
});
