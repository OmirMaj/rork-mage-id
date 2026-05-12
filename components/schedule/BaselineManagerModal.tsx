// components/schedule/BaselineManagerModal.tsx
//
// MS-Project / Primavera P6 parity for named baselines. Replaces the
// previous "tap = capture, long-press = compare against latest" affordance
// with a real management surface:
//
//   • Capture a new baseline with a name + optional note (why was this
//     locked in — "Signed contract", "Approved permit set rev 2", etc.)
//   • List all baselines with date, note, task count
//   • Compare any two baselines side-by-side (P6's "as-bid vs as-permitted"
//     workflow). Variance list shows tasks that shifted, by how many days
//     each end moved.
//   • Activate a baseline as the live ghost-stripe overlay on the Gantt.
//   • Delete / rename a baseline.
//
// Keeps the data model already in ProjectSchedule.baselines — the manager
// is purely a UI; persistence flows back through the existing
// setNamedBaselines + commit pattern in schedule-pro.tsx.

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Platform, Alert,
} from 'react-native';
import {
  Plus, Bookmark, Trash2, X, Check, GitCompare, Pencil, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ScheduleTask } from '@/types';
import {
  captureBaseline,
  applyBaselineToTasks,
  diffAgainstBaseline,
  diffTwoBaselines,
  type NamedBaseline,
  type BaselineDiff,
} from '@/utils/scheduleOps';

interface BaselineManagerModalProps {
  visible: boolean;
  onClose: () => void;
  baselines: NamedBaseline[];
  workingTasks: ScheduleTask[];
  /** The currently-active baseline's id (drives the ghost-stripe overlay). */
  activeBaselineId?: string | null;
  /** Persist a new baselines list. Called when the user captures, renames,
   *  or deletes. The parent updates ProjectSchedule.baselines. */
  onBaselinesChange: (next: NamedBaseline[]) => void;
  /** Apply a baseline to the working tasks (sets each task's
   *  baselineStartDay/baselineEndDay). Drives the ghost stripe. */
  onActivate: (baseline: NamedBaseline) => void;
}

// Two-mode modal: list view (default) and compare view (after picking
// two baselines to diff). Compare view sits on top of the list and exits
// back to list on close.
type Mode =
  | { kind: 'list' }
  | { kind: 'capture' }
  | { kind: 'rename'; baselineId: string }
  | { kind: 'compare-pick' }
  | { kind: 'compare-result'; aId: string; bId?: string };

export default function BaselineManagerModal(props: BaselineManagerModalProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { visible, onClose, baselines, workingTasks, activeBaselineId, onBaselinesChange, onActivate } = props;
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [draftName, setDraftName] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [comparePickerSlot, setComparePickerSlot] = useState<'a' | 'b'>('a');
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMode({ kind: 'list' });
    setDraftName('');
    setDraftNote('');
    setCompareA(null);
    setCompareB(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // ── Capture ────────────────────────────────────────────────────
  const startCapture = useCallback(() => {
    setDraftName(`v${baselines.length + 1}`);
    setDraftNote('');
    setMode({ kind: 'capture' });
  }, [baselines.length]);

  const handleCapture = useCallback(() => {
    const name = draftName.trim() || `v${baselines.length + 1}`;
    const snap: NamedBaseline = {
      ...captureBaseline(workingTasks, name),
      note: draftNote.trim() || undefined,
    };
    const next = [...baselines, snap];
    onBaselinesChange(next);
    onActivate(snap);
    setMode({ kind: 'list' });
    setDraftName('');
    setDraftNote('');
  }, [draftName, draftNote, baselines, workingTasks, onBaselinesChange, onActivate]);

  // ── Rename ─────────────────────────────────────────────────────
  const startRename = useCallback((baselineId: string) => {
    const target = baselines.find(b => b.id === baselineId);
    if (!target) return;
    setDraftName(target.name);
    setDraftNote(target.note ?? '');
    setMode({ kind: 'rename', baselineId });
  }, [baselines]);

  const handleRename = useCallback(() => {
    if (mode.kind !== 'rename') return;
    const name = draftName.trim();
    if (!name) return;
    const next = baselines.map(b =>
      b.id === mode.baselineId ? { ...b, name, note: draftNote.trim() || undefined } : b,
    );
    onBaselinesChange(next);
    setMode({ kind: 'list' });
  }, [mode, draftName, draftNote, baselines, onBaselinesChange]);

  // ── Delete ─────────────────────────────────────────────────────
  const handleDelete = useCallback((baselineId: string) => {
    const target = baselines.find(b => b.id === baselineId);
    if (!target) return;
    const confirmMsg = `Delete baseline "${target.name}"? This can't be undone.`;
    if (Platform.OS === 'web') {
      if (!window.confirm?.(confirmMsg)) return;
    } else {
      Alert.alert('Delete baseline', confirmMsg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onBaselinesChange(baselines.filter(b => b.id !== baselineId)),
        },
      ]);
      return;
    }
    onBaselinesChange(baselines.filter(b => b.id !== baselineId));
  }, [baselines, onBaselinesChange]);

  // ── Activate ───────────────────────────────────────────────────
  const handleActivate = useCallback((baseline: NamedBaseline) => {
    onActivate(baseline);
  }, [onActivate]);

  // ── Compare ────────────────────────────────────────────────────
  const startCompare = useCallback(() => {
    if (baselines.length === 0) return;
    setCompareA(baselines[baselines.length - 1].id);
    setCompareB(null);
    setComparePickerSlot('b');
    setMode({ kind: 'compare-pick' });
  }, [baselines]);

  const compareDiff = useMemo<BaselineDiff[]>(() => {
    if (mode.kind !== 'compare-result') return [];
    const a = baselines.find(b => b.id === mode.aId);
    if (!a) return [];
    const raw = mode.bId
      ? (() => {
          const b = baselines.find(x => x.id === mode.bId);
          return b ? diffTwoBaselines(a, b) : [];
        })()
      : diffAgainstBaseline(workingTasks, a);

    // diffTwoBaselines returns the task id as `title` (it doesn't have
    // the live task list). Resolve it back to the human title from
    // workingTasks so the variance list reads "Concrete Pour - Level 2"
    // instead of "task-1234567890". Falls back to the id if the task
    // was deleted between baselines.
    const titleById = new Map(workingTasks.map(t => [t.id, t.title]));
    return raw.map(d => ({ ...d, title: titleById.get(d.taskId) ?? d.title }));
  }, [mode, baselines, workingTasks]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Bookmark size={18} color={themeColors.accent} />
            <Text style={styles.title}>
              {mode.kind === 'list' ? 'Baselines' :
               mode.kind === 'capture' ? 'New baseline' :
               mode.kind === 'rename' ? 'Rename baseline' :
               mode.kind === 'compare-pick' ? 'Compare baselines' :
               'Variance'}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={themeColors.textMuted} />
            </TouchableOpacity>
          </View>

          {mode.kind === 'list' && (
            <ListView
              baselines={baselines}
              activeBaselineId={activeBaselineId}
              onCapture={startCapture}
              onCompare={startCompare}
              onActivate={handleActivate}
              onRename={startRename}
              onDelete={handleDelete}
            />
          )}

          {mode.kind === 'capture' && (
            <CaptureView
              draftName={draftName}
              draftNote={draftNote}
              onChangeName={setDraftName}
              onChangeNote={setDraftNote}
              onSubmit={handleCapture}
              onCancel={() => setMode({ kind: 'list' })}
              taskCount={workingTasks.length}
            />
          )}

          {mode.kind === 'rename' && (
            <CaptureView
              draftName={draftName}
              draftNote={draftNote}
              onChangeName={setDraftName}
              onChangeNote={setDraftNote}
              onSubmit={handleRename}
              onCancel={() => setMode({ kind: 'list' })}
              taskCount={workingTasks.length}
              isRename
            />
          )}

          {mode.kind === 'compare-pick' && (
            <ComparePicker
              baselines={baselines}
              compareA={compareA}
              compareB={compareB}
              comparePickerSlot={comparePickerSlot}
              setComparePickerSlot={setComparePickerSlot}
              setCompareA={setCompareA}
              setCompareB={setCompareB}
              onCancel={() => setMode({ kind: 'list' })}
              onSubmit={() => {
                if (!compareA) return;
                setMode({ kind: 'compare-result', aId: compareA, bId: compareB ?? undefined });
              }}
            />
          )}

          {mode.kind === 'compare-result' && (
            <CompareResult
              baselines={baselines}
              workingTasks={workingTasks}
              aId={mode.aId}
              bId={mode.bId}
              diff={compareDiff}
              onBack={() => setMode({ kind: 'compare-pick' })}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── List view ────────────────────────────────────────────────────────
function ListView(props: {
  baselines: NamedBaseline[];
  activeBaselineId?: string | null;
  onCapture: () => void;
  onCompare: () => void;
  onActivate: (b: NamedBaseline) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { baselines, activeBaselineId, onCapture, onCompare, onActivate, onRename, onDelete } = props;

  return (
    <>
      <Text style={styles.helper}>
        Snapshot the plan as a named version. Compare any two baselines, or compare a baseline against today&apos;s plan to see variance.
      </Text>

      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {baselines.length === 0 ? (
          <View style={styles.emptyBox}>
            <Bookmark size={20} color={themeColors.textMuted} />
            <Text style={styles.emptyText}>
              No baselines yet. Capture one to lock in the current plan as a target.
            </Text>
          </View>
        ) : (
          [...baselines].reverse().map(b => {
            const isActive = b.id === activeBaselineId;
            const date = new Date(b.savedAt);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return (
              <View key={b.id} style={[styles.baselineRow, isActive && styles.baselineRowActive]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.baselineRowTop}>
                    <Text style={styles.baselineName} numberOfLines={1}>{b.name}</Text>
                    {isActive && (
                      <View style={styles.activeChip}>
                        <Check size={10} color={themeColors.accent} strokeWidth={3} />
                        <Text style={styles.activeChipText}>ACTIVE</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.baselineMeta}>
                    {dateStr} · {b.tasks.length} task{b.tasks.length === 1 ? '' : 's'}
                  </Text>
                  {b.note ? <Text style={styles.baselineNote} numberOfLines={2}>{b.note}</Text> : null}
                </View>
                <View style={styles.baselineActions}>
                  {!isActive && (
                    <TouchableOpacity onPress={() => onActivate(b)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Activate ${b.name}`}>
                      <ChevronRight size={14} color={themeColors.accent} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => onRename(b.id)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Rename ${b.name}`}>
                    <Pencil size={13} color={themeColors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(b.id)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Delete ${b.name}`}>
                    <Trash2 size={13} color={themeColors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footerRow}>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnSecondary]} onPress={onCompare} disabled={baselines.length === 0} accessibilityRole="button">
          <GitCompare size={14} color={baselines.length === 0 ? themeColors.textMuted : themeColors.text} />
          <Text style={[styles.footerBtnText, baselines.length === 0 && { color: themeColors.textMuted }]}>Compare</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnPrimary]} onPress={onCapture} accessibilityRole="button">
          <Plus size={14} color="#FFF" />
          <Text style={[styles.footerBtnText, { color: '#FFF' }]}>Capture new</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ── Capture / Rename view ─────────────────────────────────────────────
function CaptureView(props: {
  draftName: string;
  draftNote: string;
  onChangeName: (s: string) => void;
  onChangeNote: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  taskCount: number;
  isRename?: boolean;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      <Text style={styles.helper}>
        {props.isRename
          ? 'Update the name and optional note. The snapshot itself stays unchanged.'
          : `Snapshot the plan now (${props.taskCount} tasks). Add a note explaining why this baseline was locked in — "Signed contract", "Approved permit set rev 2", etc.`}
      </Text>

      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        value={props.draftName}
        onChangeText={props.onChangeName}
        placeholder="v1, Signed, Approved rev 2…"
        placeholderTextColor={themeColors.textMuted}
        style={styles.input}
        autoFocus
      />

      <Text style={styles.fieldLabel}>Note (optional)</Text>
      <TextInput
        value={props.draftNote}
        onChangeText={props.onChangeNote}
        placeholder="Why was this baseline taken?"
        placeholderTextColor={themeColors.textMuted}
        style={[styles.input, { minHeight: 70, paddingTop: 10, textAlignVertical: 'top' as const }]}
        multiline
      />

      <View style={styles.footerRow}>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnSecondary]} onPress={props.onCancel} accessibilityRole="button">
          <Text style={styles.footerBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnPrimary]} onPress={props.onSubmit} accessibilityRole="button">
          <Check size={14} color="#FFF" />
          <Text style={[styles.footerBtnText, { color: '#FFF' }]}>{props.isRename ? 'Save' : 'Capture'}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ── Compare picker ────────────────────────────────────────────────────
function ComparePicker(props: {
  baselines: NamedBaseline[];
  compareA: string | null;
  compareB: string | null;
  comparePickerSlot: 'a' | 'b';
  setComparePickerSlot: (s: 'a' | 'b') => void;
  setCompareA: (id: string) => void;
  setCompareB: (id: string | null) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { baselines, compareA, compareB, comparePickerSlot, setCompareA, setCompareB, onCancel, onSubmit, setComparePickerSlot } = props;
  const aLabel = compareA ? baselines.find(b => b.id === compareA)?.name : null;
  const bLabel = compareB ? baselines.find(b => b.id === compareB)?.name : 'Today\'s plan';

  return (
    <>
      <Text style={styles.helper}>
        Pick two baselines to compare, or pick one and leave B empty to compare against today&apos;s working plan.
      </Text>

      <View style={styles.compareSlotsRow}>
        <TouchableOpacity
          style={[styles.compareSlot, comparePickerSlot === 'a' && styles.compareSlotActive]}
          onPress={() => setComparePickerSlot('a')}
        >
          <Text style={styles.compareSlotLabel}>A</Text>
          <Text style={styles.compareSlotValue} numberOfLines={1}>{aLabel ?? 'Pick a baseline'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.compareSlot, comparePickerSlot === 'b' && styles.compareSlotActive]}
          onPress={() => setComparePickerSlot('b')}
        >
          <Text style={styles.compareSlotLabel}>B</Text>
          <Text style={styles.compareSlotValue} numberOfLines={1}>{bLabel}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
        {comparePickerSlot === 'b' && (
          <TouchableOpacity
            style={[styles.pickerRow, compareB === null && styles.pickerRowSelected]}
            onPress={() => setCompareB(null)}
          >
            <Text style={styles.pickerRowName}>Today&apos;s plan</Text>
            <Text style={styles.pickerRowMeta}>working tasks</Text>
          </TouchableOpacity>
        )}
        {[...baselines].reverse().map(b => {
          const isSelected = comparePickerSlot === 'a' ? compareA === b.id : compareB === b.id;
          return (
            <TouchableOpacity
              key={b.id}
              style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
              onPress={() => {
                if (comparePickerSlot === 'a') setCompareA(b.id);
                else setCompareB(b.id);
              }}
            >
              <Text style={styles.pickerRowName} numberOfLines={1}>{b.name}</Text>
              <Text style={styles.pickerRowMeta}>{new Date(b.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footerRow}>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnSecondary]} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.footerBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.footerBtn, styles.footerBtnPrimary, !compareA && { opacity: 0.4 }]}
          onPress={onSubmit}
          disabled={!compareA}
          accessibilityRole="button"
        >
          <GitCompare size={14} color="#FFF" />
          <Text style={[styles.footerBtnText, { color: '#FFF' }]}>Show variance</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ── Compare result ────────────────────────────────────────────────────
function CompareResult(props: {
  baselines: NamedBaseline[];
  workingTasks: ScheduleTask[];
  aId: string;
  bId?: string;
  diff: BaselineDiff[];
  onBack: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { baselines, aId, bId, diff, onBack } = props;
  const a = baselines.find(b => b.id === aId);
  const bLabel = bId ? baselines.find(x => x.id === bId)?.name : 'today\'s plan';
  const moved = diff.length;

  return (
    <>
      <Text style={styles.helper}>
        <Text style={{ fontWeight: '700' }}>{a?.name ?? '—'}</Text> vs <Text style={{ fontWeight: '700' }}>{bLabel ?? '—'}</Text> · {moved} task{moved === 1 ? '' : 's'} shifted
      </Text>

      {diff.length === 0 ? (
        <View style={styles.emptyBox}>
          <Check size={20} color={themeColors.success} />
          <Text style={styles.emptyText}>Plans match exactly. No variance.</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 4 }} showsVerticalScrollIndicator={false}>
          {diff.map(d => {
            const sign = d.endDelta > 0 ? '+' : '';
            const color = d.endDelta > 0 ? themeColors.danger : d.endDelta < 0 ? themeColors.success : themeColors.textMuted;
            return (
              <View key={d.taskId} style={styles.diffRow}>
                <Text style={styles.diffName} numberOfLines={1}>{d.title}</Text>
                <Text style={[styles.diffDelta, { color }]}>
                  {sign}{d.endDelta}d
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.footerRow}>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnSecondary]} onPress={onBack} accessibilityRole="button">
          <Text style={styles.footerBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end' as const,
  },
  card: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    gap: 12,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  title: {
    flex: 1,
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.3,
  },
  helper: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 19,
  },

  emptyBox: {
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 28,
  },
  emptyText: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
    paddingHorizontal: 24,
  },

  baselineRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 12,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
  },
  baselineRowActive: {
    borderColor: t.accent,
    backgroundColor: t.accent + '08',
  },
  baselineRowTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  baselineName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  activeChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: t.accent + '18',
  },
  activeChipText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: t.accent,
    letterSpacing: 0.5,
  },
  baselineMeta: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
  baselineNote: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
  baselineActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  iconBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },

  fieldLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: t.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
    marginTop: 4,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
  },

  compareSlotsRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  compareSlot: {
    flex: 1,
    padding: 12,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
  },
  compareSlotActive: {
    borderColor: t.accent,
  },
  compareSlotLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: t.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  compareSlotValue: {
    marginTop: 4,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },

  pickerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pickerRowSelected: {
    borderColor: t.accent,
    backgroundColor: t.accent + '10',
  },
  pickerRowName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  pickerRowMeta: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
  },

  diffRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.surfaceAlt,
    gap: 12,
  },
  diffName: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
  },
  diffDelta: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums'] as ('tabular-nums')[],
  },

  footerRow: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingTop: 6,
  },
  footerBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    borderRadius: Tokens.radius.lg,
  },
  footerBtnPrimary: {
    backgroundColor: t.accent,
  },
  footerBtnSecondary: {
    backgroundColor: t.surfaceAlt,
  },
  footerBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
});
