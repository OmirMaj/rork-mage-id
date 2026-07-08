import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Megaphone, Plus, X, Trash2, PenLine, CheckCircle, Users, ChevronLeft,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type { ToolboxTalk, SafetyAttendee } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';

export default function SafetyToolboxScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyToolboxInner />;
}

function SafetyToolboxInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { getToolboxTalksForProject, addToolboxTalk, updateToolboxTalk, deleteToolboxTalk } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getToolboxTalksForProject(projectId ?? ''), [projectId, getToolboxTalksForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingTalk, setEditingTalk] = useState<ToolboxTalk | null>(null);
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [presenter, setPresenter] = useState('');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState<SafetyAttendee[]>([]);
  const [attendeeName, setAttendeeName] = useState('');

  const resetForm = useCallback(() => {
    setEditingTalk(null);
    setTopic(''); setPresenter(''); setNotes('');
    setDate(new Date().toISOString().slice(0, 10));
    setAttendees([]); setAttendeeName('');
  }, []);

  // ── Attendee editor ──────────────────────────────────────────────────
  const addAttendee = useCallback(() => {
    const n = attendeeName.trim();
    if (!n) return;
    setAttendees(prev => [...prev, { name: n }]);
    setAttendeeName('');
  }, [attendeeName]);

  const removeAttendee = useCallback((idx: number) => {
    setAttendees(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const toggleAttendeeSigned = useCallback((idx: number) => {
    setAttendees(prev => prev.map((a, i) => i === idx
      ? { ...a, signedAt: a.signedAt ? undefined : new Date().toISOString() }
      : a));
  }, []);

  const openEdit = useCallback((talk: ToolboxTalk) => {
    setEditingTalk(talk);
    setTopic(talk.topic);
    setDate(talk.date);
    setPresenter(talk.presenter);
    setNotes(talk.notes);
    setAttendees(talk.attendees);
    setAttendeeName('');
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    const tp = topic.trim();
    if (!tp) { Alert.alert('Missing topic', 'What was the talk about?'); return; }
    const now = new Date().toISOString();
    if (editingTalk) {
      updateToolboxTalk(editingTalk.id, { topic: tp, date, presenter: presenter.trim(), notes: notes.trim(), attendees });
    } else {
      const talk: ToolboxTalk = {
        id: generateUUID(), projectId: projectId ?? '', topic: tp, date, presenter: presenter.trim(),
        notes: notes.trim(), attendees, aiTopicSource: 'manual', createdBy: '', createdAt: now, updatedAt: now,
      };
      addToolboxTalk(talk);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [topic, date, presenter, notes, attendees, editingTalk, projectId, addToolboxTalk, updateToolboxTalk, resetForm]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert('Delete toolbox talk', 'Delete this toolbox talk?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteToolboxTalk(id) },
    ]);
  }, [deleteToolboxTalk]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Toolbox Talks' }} />
        <EmptyState
          icon={<Megaphone size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Open a project first"
          message="Toolbox talks are tied to a project so each one carries its topic, presenter, and attendee sign-ins. To start one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Open Toolbox Talks and hit + to add one.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `Toolbox Talks — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.map(item => {
          const signed = item.attendees.filter(a => a.signedAt).length;
          return (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.85} onPress={() => openEdit(item)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.topic}</Text>
                  <Text style={styles.cardMeta}>
                    {[item.presenter, item.date].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <View style={styles.attendeeSummary}>
                <Users size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
                <Text style={styles.cardSummary}>
                  {item.attendees.length} attendee{item.attendees.length === 1 ? '' : 's'} ({signed} signed)
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {items.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<Megaphone size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No toolbox talks yet"
              message="Log the pre-shift safety huddle: the topic, who presented, and who signed in. Keep a paper trail crews and inspectors can trust."
              actionLabel="Add first talk"
              onAction={() => { resetForm(); setShowForm(true); }}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-toolbox">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Add Toolbox Talk</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Toolbox talk form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Back" style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{editingTalk ? 'Edit Talk' : 'New Toolbox Talk'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Topic *</Text>
                <TextInput style={styles.input} value={topic} onChangeText={setTopic} placeholder="e.g. Ladder safety" placeholderTextColor={themeColors.textMuted} testID="toolbox-topic-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Presenter</Text>
                    <TextInput style={styles.input} value={presenter} onChangeText={setPresenter} placeholder="e.g. Foreman" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Key points covered in the talk..."
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>Attendees</Text>
                </View>
                <View style={styles.attendeeAddRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={attendeeName}
                    onChangeText={setAttendeeName}
                    placeholder="Attendee name"
                    placeholderTextColor={themeColors.textMuted}
                    onSubmitEditing={addAttendee}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.attendeeAddBtn} onPress={addAttendee} accessibilityRole="button" accessibilityLabel="Add attendee">
                    <Plus size={18} color={themeColors.accent} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {attendees.map((a, idx) => (
                  <View key={`${a.name}-${idx}`} style={styles.attendeeRow}>
                    <Text style={styles.attendeeName} numberOfLines={1}>{a.name}</Text>
                    <TouchableOpacity
                      style={[styles.signToggle, a.signedAt ? { backgroundColor: themeColors.successSoft } : null]}
                      onPress={() => toggleAttendeeSigned(idx)}
                      accessibilityRole="button"
                      accessibilityLabel={a.signedAt ? 'Signed' : 'Mark signed'}
                    >
                      {a.signedAt
                        ? <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                        : <PenLine size={14} color={themeColors.textSecondary} strokeWidth={1.75} />}
                      <Text style={[styles.signToggleText, { color: a.signedAt ? themeColors.success : themeColors.textSecondary }]}>
                        {a.signedAt ? 'Signed' : 'Sign'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeAttendee(idx)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove attendee">
                      <X size={16} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                ))}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-toolbox">
                    <Text style={styles.saveBtnText}>{editingTalk ? 'Update' : 'Add Talk'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  cardSummary: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  attendeeSummary: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '18', alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  attendeeAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attendeeAddBtn: { width: 44, height: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '12', alignItems: 'center', justifyContent: 'center' },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, borderWidth: 0.5, borderColor: themeColors.line },
  attendeeName: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text, fontWeight: '600' as const },
  signToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  signToggleText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
