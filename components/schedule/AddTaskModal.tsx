// components/schedule/AddTaskModal.tsx — Phase 27 audit.
//
// Add Task popup. Replaces the previous "click → silently create a task
// called 'New task' with defaults" flow that lived inside schedule-pro's
// handleAddTask. Now every "+ Add Task" affordance (toolbar button,
// GridPane footer, phone FAB) opens this modal, and the actual schedule
// mutation only fires after the user submits the form.
//
// Fields:
//   - Title (required)
//   - Duration in days (number ≥ 0)
//   - Crew (optional free text — flows into the existing crew column)
//   - Trade (optional — picked from Colors.tradeColors via TRADE_KEYS)
//   - Notes (optional)
//
// Start day, predecessors, status, and progress are NOT in this form —
// they're better edited inline after creation when the user can see the
// schedule context. Start defaults to "right after the last task" via
// the caller's commit logic, matching the legacy handleAddTask shape.

import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { TRADE_KEYS, tradeLabel, type TradeKey } from '@/utils/scheduleColors';

export interface NewTaskValues {
  title: string;
  durationDays: number;
  crew?: string;
  tradeKey?: TradeKey;
  notes?: string;
}

interface AddTaskModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreate: (values: NewTaskValues) => void;
}

export function AddTaskModal({ visible, onCancel, onCreate }: AddTaskModalProps) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('1');
  const [crew, setCrew] = useState('');
  const [tradeKey, setTradeKey] = useState<TradeKey>('general');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  // Reset state every time the modal opens so a previous draft doesn't
  // leak into the next task.
  useEffect(() => {
    if (visible) {
      setTitle('');
      setDuration('1');
      setCrew('');
      setTradeKey('general');
      setNotes('');
      setError(null);
      setTradeOpen(false);
    }
  }, [visible]);

  const submit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }
    const parsedDuration = Number.parseFloat(duration);
    if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
      setError('Duration must be 0 or more days');
      return;
    }
    onCreate({
      title: trimmedTitle,
      durationDays: Math.round(parsedDuration),
      crew: crew.trim() || undefined,
      tradeKey,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => { /* swallow taps inside */ }}>
          <Text style={styles.title}>Add task</Text>
          <Text style={styles.sub}>Fill in what you know — you can edit anything later.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              autoFocus
              value={title}
              onChangeText={(t) => { setTitle(t); if (error) setError(null); }}
              onSubmitEditing={submit}
              returnKeyType="next"
              placeholder="e.g. Rough plumbing"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
              testID="add-task-title"
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.flex1]}>
              <Text style={styles.label}>Duration (days)</Text>
              <TextInput
                value={duration}
                onChangeText={(t) => { setDuration(t); if (error) setError(null); }}
                keyboardType="decimal-pad"
                style={styles.input}
                testID="add-task-duration"
              />
            </View>
            <View style={[styles.field, styles.flex2]}>
              <Text style={styles.label}>Crew</Text>
              <TextInput
                value={crew}
                onChangeText={setCrew}
                placeholder="Optional — crew name or sub"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                testID="add-task-crew"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Trade</Text>
            <Pressable onPress={() => setTradeOpen(true)} style={styles.dropdown} testID="add-task-trade">
              <View style={[styles.dot, { backgroundColor: Colors.tradeColors[tradeKey] }]} />
              <Text style={styles.dropdownText}>{tradeLabel(tradeKey)}</Text>
              <Text style={styles.chev}>▾</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
              style={[styles.input, styles.notesInput]}
              multiline
              testID="add-task-notes"
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancelBtn} testID="add-task-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.submitBtn} testID="add-task-submit">
              <Text style={styles.submitText}>Create task</Text>
            </Pressable>
          </View>

          <Modal visible={tradeOpen} transparent animationType="fade" onRequestClose={() => setTradeOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => setTradeOpen(false)}>
              <Pressable style={styles.tradeSheet} onPress={() => { /* swallow */ }}>
                {TRADE_KEYS.map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => { setTradeKey(k); setTradeOpen(false); }}
                    style={styles.tradeOpt}
                  >
                    <View style={[styles.dot, { backgroundColor: Colors.tradeColors[k] }]} />
                    <Text style={styles.tradeOptLabel}>{tradeLabel(k)}</Text>
                    {tradeKey === k ? <Text style={styles.tradeCheck}>✓</Text> : null}
                  </Pressable>
                ))}
              </Pressable>
            </Pressable>
          </Modal>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 22,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  sub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 14,
  },
  field: { marginBottom: 12 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  row: { flexDirection: 'row', gap: 10 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
  },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dropdownText: { flex: 1, color: Colors.text, fontSize: 14 },
  chev: { color: Colors.textSecondary, fontSize: 14 },
  tradeSheet: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 6,
  },
  tradeOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  tradeOptLabel: { flex: 1, color: Colors.text, fontSize: 14 },
  tradeCheck: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  error: {
    color: Colors.pillLate,
    fontSize: 12,
    marginBottom: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
  },
  cancelText: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.tradeColors.general,
  },
  submitText: { color: '#0B0D10', fontWeight: '700', fontSize: 13 },
});
