import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, ChevronDown, Link2, X, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import type { RFIStatus, RFIPriority } from '@/types';

const PRIORITY_OPTIONS: RFIPriority[] = ['low', 'normal', 'urgent'];
const STATUS_OPTIONS: RFIStatus[] = ['open', 'answered', 'closed', 'void'];

export default function RFIScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('rfis_submittals')) {
    return (
      <Paywall
        visible={true}
        feature="RFIs & Submittals"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <RFIScreenInner />;
}

function RFIScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, rfiId, prefillPhotoId } = useLocalSearchParams<{
    projectId: string;
    rfiId?: string;
    prefillPhotoId?: string;
  }>();
  const ctx = useProjects();
  const { getProject, getRFIsForProject, addRFI, updateRFI } = ctx;
  const projectPhotos = (ctx as any).projectPhotos as Array<{ id: string; uri: string }> | undefined;

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingRFIs = useMemo(() => getRFIsForProject(projectId ?? ''), [projectId, getRFIsForProject]);
  const existingRFI = useMemo(() => rfiId ? existingRFIs.find(r => r.id === rfiId) : null, [rfiId, existingRFIs]);

  // When arriving from photo-annotator with `prefillPhotoId`, look up
  // the photo and pre-attach its URI to the new RFI's attachments.
  const prefillPhotoUri = useMemo(() => {
    if (!prefillPhotoId) return null;
    const photo = (projectPhotos ?? []).find(p => p.id === prefillPhotoId);
    return photo?.uri ?? null;
  }, [prefillPhotoId, projectPhotos]);

  const [subject, setSubject] = useState(existingRFI?.subject ?? '');
  const [question, setQuestion] = useState(existingRFI?.question ?? '');
  const [assignedTo, setAssignedTo] = useState(existingRFI?.assignedTo ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingRFI?.submittedBy ?? '');
  const [dateRequired, setDateRequired] = useState(existingRFI?.dateRequired ?? '');
  const [priority, setPriority] = useState<RFIPriority>(existingRFI?.priority ?? 'normal');
  const [status, setStatus] = useState<RFIStatus>(existingRFI?.status ?? 'open');
  const [linkedDrawing, setLinkedDrawing] = useState(existingRFI?.linkedDrawing ?? '');
  const [response, setResponse] = useState(existingRFI?.response ?? '');
  const [linkedTaskId, setLinkedTaskId] = useState(existingRFI?.linkedTaskId ?? '');
  // Local attachments — start with existing RFI attachments OR a fresh
  // array seeded with the prefill photo URI.
  const [attachments, setAttachments] = useState<string[]>(
    existingRFI?.attachments ?? (prefillPhotoUri ? [prefillPhotoUri] : []),
  );
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const handleSave = useCallback(() => {
    if (!subject.trim()) {
      Alert.alert('Missing Subject', 'Please enter a subject for this RFI.');
      return;
    }
    if (!question.trim()) {
      Alert.alert('Missing Question', 'Please enter the RFI question.');
      return;
    }

    const now = new Date().toISOString();

    if (existingRFI) {
      updateRFI(existingRFI.id, {
        subject: subject.trim(),
        question: question.trim(),
        assignedTo: assignedTo.trim(),
        submittedBy: submittedBy.trim(),
        dateRequired,
        priority,
        status,
        linkedDrawing: linkedDrawing.trim(),
        linkedTaskId: linkedTaskId || undefined,
        response: response.trim() || undefined,
        dateResponded: response.trim() && !existingRFI.dateResponded ? now : existingRFI.dateResponded,
      });
    } else {
      addRFI({
        projectId: projectId ?? '',
        subject: subject.trim(),
        question: question.trim(),
        submittedBy: submittedBy.trim(),
        assignedTo: assignedTo.trim(),
        dateSubmitted: now,
        dateRequired: dateRequired || new Date(Date.now() + 14 * 86400000).toISOString(),
        status: 'open',
        priority,
        linkedDrawing: linkedDrawing.trim() || undefined,
        linkedTaskId: linkedTaskId || undefined,
        attachments,
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [subject, question, assignedTo, submittedBy, dateRequired, priority, status, linkedDrawing, response, existingRFI, projectId, addRFI, updateRFI, router, attachments]);

  const priorityColor = priority === 'urgent' ? Colors.error : priority === 'normal' ? Colors.primary : Colors.textSecondary;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: existingRFI ? `RFI #${existingRFI.number}` : 'New RFI' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {project && (
          <Text style={styles.projectLabel}>{project.name}</Text>
        )}

        <Text style={styles.fieldLabel}>Subject *</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Brief description of the question"
          placeholderTextColor={Colors.textMuted}
          testID="rfi-subject"
        />

        <Text style={styles.fieldLabel}>Question *</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={question}
          onChangeText={setQuestion}
          placeholder="Full RFI question body..."
          placeholderTextColor={Colors.textMuted}
          multiline
          textAlignVertical="top"
          testID="rfi-question"
        />

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>Submitted By</Text>
            <TextInput
              style={styles.input}
              value={submittedBy}
              onChangeText={setSubmittedBy}
              placeholder="Name or company"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>Assigned To</Text>
            <TextInput
              style={styles.input}
              value={assignedTo}
              onChangeText={setAssignedTo}
              placeholder="Architect, engineer..."
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Response Required By</Text>
        <TextInput
          style={styles.input}
          value={dateRequired}
          onChangeText={setDateRequired}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Priority</Text>
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={() => setShowPriorityPicker(!showPriorityPicker)}
          activeOpacity={0.7}
        >
          <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
          <Text style={styles.pickerBtnText}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {showPriorityPicker && (
          <View style={styles.pickerOptions}>
            {PRIORITY_OPTIONS.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.pickerOption, priority === p && styles.pickerOptionActive]}
                onPress={() => { setPriority(p); setShowPriorityPicker(false); }}
              >
                <Text style={[styles.pickerOptionText, priority === p && styles.pickerOptionTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {existingRFI && (
          <>
            <Text style={styles.fieldLabel}>Status</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowStatusPicker(!showStatusPicker)}
              activeOpacity={0.7}
            >
              <Text style={styles.pickerBtnText}>{status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}</Text>
              <ChevronDown size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            {showStatusPicker && (
              <View style={styles.pickerOptions}>
                {STATUS_OPTIONS.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.pickerOption, status === s && styles.pickerOptionActive]}
                    onPress={() => { setStatus(s); setShowStatusPicker(false); }}
                  >
                    <Text style={[styles.pickerOptionText, status === s && styles.pickerOptionTextActive]}>
                      {s.charAt(0).toUpperCase() + s.replace('_', ' ').slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <Text style={styles.fieldLabel}>Linked Drawing</Text>
        <TextInput
          style={styles.input}
          value={linkedDrawing}
          onChangeText={setLinkedDrawing}
          placeholder="e.g. A-101"
          placeholderTextColor={Colors.textMuted}
        />

        {(existingRFI && (status === 'answered' || status === 'closed')) && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Response</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={response}
              onChangeText={setResponse}
              placeholder="Official response..."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
          </>
        )}

        {scheduleTasks.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Linked Schedule Task</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
              <Link2 size={15} color={Colors.info} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')} style={styles.unlinkBtn}>
                  <X size={14} color={Colors.error} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="rfi-save">
          <Save size={18} color="#fff" />
          <Text style={styles.saveBtnText}>{existingRFI ? 'Update RFI' : 'Create RFI'}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Task Picker Modal */}
      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTaskPicker(false)}>
          <Pressable style={styles.taskPickerCard} onPress={() => undefined}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>Link Schedule Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]}
                onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}
              >
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity
                  key={task.id}
                  style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]}
                  onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}
                >
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={Colors.primary} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskOptionText, linkedTaskId === task.id && styles.taskOptionTextActive]} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.taskOptionMeta}>{task.phase} · {task.durationDays}d · {task.progress}% done</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 16,
  },
  projectLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  multilineInput: {
    minHeight: 100,
    paddingTop: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pickerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  pickerOptionActive: {
    backgroundColor: Colors.primary,
  },
  pickerOptionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  pickerOptionTextActive: {
    color: '#fff',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  linkedTaskBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: Colors.primary + '10', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, marginTop: 6,
  },
  linkedTaskPhase: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  linkedTaskName: { flex: 1, fontSize: 13, color: Colors.text },
  unlinkBtn: { padding: 2 },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center', alignItems: 'center', padding: 24 },
  taskPickerCard: { backgroundColor: Colors.card ?? Colors.surface, borderRadius: 16, width: '100%', overflow: 'hidden' },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  taskPickerTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder + '80' },
  taskOptionActive: { backgroundColor: Colors.primary + '10' },
  taskOptionText: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: Colors.primary },
  taskOptionMeta: { fontSize: 11, color: Colors.textSecondary ?? Colors.textMuted, marginTop: 1 },
});
