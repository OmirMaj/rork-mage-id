import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Platform } from 'react-native';
import { CheckCircle2, Circle, Plus } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';

export interface ChecklistItem { id: string; label: string; done: boolean }

interface TaskChecklistProps {
  items: ChecklistItem[];
  onToggle: (id: string) => void;
  onAdd: (label: string) => void;
}

export function TaskChecklist({ items, onToggle, onAdd }: TaskChecklistProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [draft, setDraft] = useState('');
  const doneCount = items.filter((i) => i.done).length;

  const submit = () => {
    const v = draft.trim();
    if (v) {
      onAdd(v);
      setDraft('');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>TASK CHECKLIST</Text>
        <Text style={styles.count}>{doneCount}/{items.length}</Text>
      </View>
      {items.map((it) => (
        <TouchableOpacity key={it.id} style={styles.row} activeOpacity={0.7} onPress={() => onToggle(it.id)} testID={`checklist-${it.id}`}>
          {it.done ? <CheckCircle2 size={20} color={colors.success} strokeWidth={1.75} /> : <Circle size={20} color={colors.textMuted} strokeWidth={1.75} />}
          <Text style={[styles.label, it.done ? styles.labelDone : null]} numberOfLines={2}>{it.label}</Text>
        </TouchableOpacity>
      ))}
      <View style={styles.addRow}>
        <Plus size={18} color={colors.accent} strokeWidth={1.75} />
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a step…"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          onSubmitEditing={submit}
          blurOnSubmit={Platform.OS !== 'web'}
        />
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14, marginTop: 12 },
  header: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 },
  title: { fontSize: 11, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 0.8 },
  count: { fontSize: 13, fontWeight: '800' as const, color: t.text },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.line },
  label: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: t.text },
  labelDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  addRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.line, marginTop: 2 },
  input: { flex: 1, fontSize: 14, color: t.text, paddingVertical: 2 },
});
