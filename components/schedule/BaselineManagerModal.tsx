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
            <Bookmark size={18} color={Colors.primary} />
            <Text style={styles.title}>
              {mode.kind === 'list' ? 'Baselines' :
               mode.kind === 'capture' ? 'New baseline' :
               mode.kind === 'rename' ? 'Rename baseline' :
               mode.kind === 'compare-pick' ? 'Compare baselines' :
               'Variance'}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={Colors.textMuted} />
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
  const { baselines, activeBaselineId, onCapture, onCompare, onActivate, onRename, onDelete } = props;

  return (
    <>
      <Text style={styles.helper}>
        Snapshot the plan as a named version. Compare any two baselines, or compare a baseline against today&apos;s plan to see variance.
      </Text>

      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: Tokens.spacing.xs, paddingBottom: Tokens.spacing.xs }} showsVerticalScrollIndicator={false}>
        {baselines.length === 0 ? (
          <View style={styles.emptyBox}>
            <Bookmark size={20} color={Colors.textMuted} />
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
                        <Check size={10} color={Colors.primary} strokeWidth={3} />
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
                      <ChevronRight size={14} color={Colors.primary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => onRename(b.id)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Rename ${b.name}`}>
                    <Pencil size={13} color={Colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(b.id)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Delete ${b.name}`}>
                    <Trash2 size={13} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.footerRow}>
        <TouchableOpacity style={[styles.footerBtn, styles.footerBtnSecondary]} onPress={onCompare} disabled={baselines.length === 0} accessibilityRole="button">
          <GitCompare size={14} color={baselines.length === 0 ? Colors.textMuted : Colors.text} />
          <Text style={[styles.footerBtnText, baselines.length === 0 && { color: Colors.textMuted }]}>Compare</Text>
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
        placeholderTextColor={Colors.textMuted}
        style={styles.input}
        autoFocus
      />

      <Text style={styles.fieldLabel}>Note (optional)</Text>
      <TextInput
        value={props.draftNote}
        onChangeText={props.onChangeNote}
        placeholder="Why was this baseline taken?"
        placeholderTextColor={Colors.textMuted}
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
          <Check size={20} color={Colors.success} />
          <Text style={styles.emptyText}>Plans match exactly. No variance.</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: Tokens.spacing.xxs }} showsVerticalScrollIndicator={false}>
          {diff.map(d => {
            const sign = d.endDelta > 0 ? '+' : '';
            const color = d.endDelta > 0 ? Colors.error : d.endDelta < 0 ? Colors.success : Colors.textMuted;
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

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end' as const,
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    gap: Tokens.spacing.sm,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    paddingBottom: Tokens.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  title: {
    flex: 1,
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  helper: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    lineHeight: 19,
  },

  emptyBox: {
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    paddingVertical: 28,
  },
  emptyText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    paddingHorizontal: Tokens.spacing.xl,
  },

  baselineRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: Tokens.spacing.sm,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  baselineRowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  baselineRowTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  baselineName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  activeChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: Tokens.spacing.hairline,
    borderRadius: 999,
    backgroundColor: Colors.primary + '18',
  },
  activeChipText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  baselineMeta: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: Tokens.spacing.hairline,
  },
  baselineNote: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.xxs,
    fontStyle: 'italic' as const,
  },
  baselineActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
  },
  iconBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },

  fieldLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
    marginTop: Tokens.spacing.xxs,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.text,
  },

  compareSlotsRow: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
  },
  compareSlot: {
    flex: 1,
    padding: Tokens.spacing.sm,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  compareSlotActive: {
    borderColor: Colors.primary,
  },
  compareSlotLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  compareSlotValue: {
    marginTop: Tokens.spacing.xxs,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },

  pickerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 10,
    paddingHorizontal: Tokens.spacing.sm,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pickerRowSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  pickerRowName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  pickerRowMeta: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
  },

  diffRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.sm,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.surfaceAlt,
    gap: Tokens.spacing.sm,
  },
  diffName: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.text,
  },
  diffDelta: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums'] as ('tabular-nums')[],
  },

  footerRow: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
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
    backgroundColor: Colors.primary,
  },
  footerBtnSecondary: {
    backgroundColor: Colors.fillTertiary,
  },
  footerBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
});
