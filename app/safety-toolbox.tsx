import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Megaphone, Plus, X, Trash2, PenLine, CheckCircle, Users, ChevronLeft, Lock,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user } = useAuth();
  const author = ((user?.name && user.name.trim()) || user?.email || '').trim();
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

  // A talk becomes an immutable record once anyone has signed in. Signatures
  // are append-only: you can still add + sign new attendees, but the topic,
  // presenter, date, and notes are locked, and an existing signature can't be
  // removed or un-signed. Editing a signed sign-in sheet would invalidate the
  // record inspectors rely on.
  const isLocked = useMemo(
    () => !!editingTalk && editingTalk.attendees.some(a => !!a.signedAt),
    [editingTalk],
  );

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
    setAttendees(prev => {
      // A recorded signature is immutable — signed attendees can't be pulled
      // off the sheet. Unsigned rows are still free to remove.
      if (prev[idx]?.signedAt) {
        Alert.alert('Signed in — locked', 'A signed attendee is part of the record and can\'t be removed.');
        return prev;
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const toggleAttendeeSigned = useCallback((idx: number) => {
    setAttendees(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      // Signing is append-only: once signed, it stays signed. Only an unsigned
      // attendee can be signed in.
      if (a.signedAt) {
        Alert.alert('Signed in — locked', 'A signature can\'t be undone once recorded.');
        return a;
      }
      return { ...a, signedAt: new Date().toISOString() };
    }));
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
        notes: notes.trim(), attendees, aiTopicSource: 'manual', createdBy: author, createdAt: now, updatedAt: now,
      };
      addToolboxTalk(talk);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [topic, date, presenter, notes, attendees, editingTalk, projectId, addToolboxTalk, updateToolboxTalk, resetForm, author]);

  const handleDelete = useCallback((id: string) => {
    const talk = items.find(x => x.id === id);
    if (talk && talk.attendees.some(a => !!a.signedAt)) {
      Alert.alert('Signed — locked', 'A toolbox talk with signed attendees is part of the safety record and can\'t be deleted.');
      return;
    }
    Alert.alert('Delete toolbox talk', 'Delete this toolbox talk?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteToolboxTalk(id) },
    ]);
  }, [deleteToolboxTalk, items]);

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
                {signed > 0 ? (
                  <View style={styles.lockedChip}>
                    <Lock size={11} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedChipText}>Locked</Text>
                  </View>
                ) : null}
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
                  <Text style={[styles.formTitle, { flex: 1 }]}>{isLocked ? 'Signed Talk' : editingTalk ? 'Edit Talk' : 'New Toolbox Talk'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {isLocked ? (
                  <View style={styles.lockedBanner}>
                    <Lock size={14} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedBannerText}>
                      Signed — locked. Attendee sign-ins are append-only; the topic, presenter, date, and notes can’t be edited.
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>Topic *</Text>
                <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={topic} onChangeText={setTopic} editable={!isLocked} placeholder="e.g. Ladder safety" placeholderTextColor={themeColors.textMuted} testID="toolbox-topic-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Presenter</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={presenter} onChangeText={setPresenter} editable={!isLocked} placeholder="e.g. Foreman" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={date} onChangeText={setDate} editable={!isLocked} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }, isLocked ? styles.inputLocked : null]}
                  value={notes}
                  onChangeText={setNotes}
                  editable={!isLocked}
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
  attendeeSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  lockedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '14' },
  lockedChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  lockedBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '30', marginBottom: 4 },
  lockedBannerText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
  inputLocked: { opacity: 0.6 },
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
