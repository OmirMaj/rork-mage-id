import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, X, CheckCircle, Clock, Eye, MessageSquare,
  Trash2, Link2, ChevronDown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { PunchItem, PunchItemStatus, PunchItemPriority } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_CONFIG: Record<PunchItemStatus, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: Colors.error, bg: Colors.errorLight },
  in_progress: { label: 'In Progress', color: Colors.info, bg: Colors.infoLight },
  ready_for_review: { label: 'Review', color: Colors.warning, bg: Colors.warningLight },
  closed: { label: 'Closed', color: Colors.success, bg: Colors.successLight },
};

const PRIORITY_CONFIG: Record<PunchItemPriority, { label: string; color: string }> = {
  low: { label: 'Low', color: Colors.textMuted },
  medium: { label: 'Medium', color: Colors.warning },
  high: { label: 'High', color: Colors.error },
};

export default function PunchListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, getPunchItemsForProject, addPunchItem, updatePunchItem, deletePunchItem, updateProject, subcontractors } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getPunchItemsForProject(projectId ?? ''), [projectId, getPunchItemsForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PunchItem | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [assignedSub, setAssignedSub] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<PunchItemPriority>('medium');
  const [linkedTaskId, setLinkedTaskId] = useState<string>('');
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PunchItemStatus | 'all'>('all');

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const resetForm = useCallback(() => {
    setDescription(''); setLocation(''); setAssignedSub('');
    setDueDate(''); setPriority('medium'); setEditingItem(null);
    setLinkedTaskId('');
  }, []);

  const closedCount = items.filter(i => i.status === 'closed').length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0;
  const allClosed = totalCount > 0 && closedCount === totalCount;

  const filteredItems = useMemo(() => {
    if (filterStatus === 'all') return items;
    return items.filter(i => i.status === filterStatus);
  }, [items, filterStatus]);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) {
      Alert.alert('Missing Description', 'Please describe the punch item.');
      return;
    }
    const linkedTaskName = linkedTask?.title;
    if (editingItem) {
      updatePunchItem(editingItem.id, {
        description: desc, location: location.trim(), assignedSub: assignedSub.trim(),
        dueDate, priority,
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskName: linkedTaskName || undefined,
      });
    } else {
      const item: PunchItem = {
        id: createId('punch'), projectId: projectId ?? '', description: desc,
        location: location.trim(), assignedSub: assignedSub.trim(), dueDate,
        priority, status: 'open',
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskName: linkedTaskName || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addPunchItem(item);
    }
    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [description, location, assignedSub, dueDate, priority, linkedTaskId, linkedTask, editingItem, projectId, addPunchItem, updatePunchItem, resetForm]);

  const handleStatusChange = useCallback((item: PunchItem, newStatus: PunchItemStatus) => {
    const updates: Partial<PunchItem> = { status: newStatus };
    if (newStatus === 'closed') updates.closedAt = new Date().toISOString();
    updatePunchItem(item.id, updates);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [updatePunchItem]);

  const handleReject = useCallback((itemId: string) => {
    const note = rejectionNote.trim();
    updatePunchItem(itemId, { status: 'open', rejectionNote: note || 'Rejected — needs rework' });
    setShowRejectModal(null);
    setRejectionNote('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rejectionNote, updatePunchItem]);

  const handleCloseProject = useCallback(() => {
    if (!allClosed) {
      Alert.alert('Cannot Close', 'All punch items must be resolved before closing the project.');
      return;
    }
    Alert.alert('Close Project', 'Mark this project as closed? This will archive it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close Project',
        onPress: () => {
          updateProject(projectId ?? '', { status: 'closed', closedAt: new Date().toISOString() });
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Project Closed', 'This project has been archived.');
          router.back();
        },
      },
    ]);
  }, [allClosed, projectId, updateProject, router]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Punch List' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Punch List — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Completion</Text>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressSub}>{closedCount} of {totalCount} items closed</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(['all', 'open', 'in_progress', 'ready_for_review', 'closed'] as const).map(s => {
            const count = s === 'all' ? items.length : items.filter(i => i.status === s).length;
            const config = s === 'all' ? { label: 'All', color: Colors.text, bg: Colors.fillTertiary } : STATUS_CONFIG[s];
            return (
              <TouchableOpacity
                key={s}
                style={[styles.filterChip, filterStatus === s && { backgroundColor: config.color }]}
                onPress={() => setFilterStatus(s)}
              >
                <Text style={[styles.filterChipText, filterStatus === s && { color: '#fff' }]}>
                  {s === 'all' ? 'All' : config.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {filteredItems.map(item => {
          const sc = STATUS_CONFIG[item.status];
          const pc = PRIORITY_CONFIG[item.priority];
          return (
            <View key={item.id} style={styles.punchCard}>
              <View style={styles.punchCardTop}>
                <View style={[styles.priorityDot, { backgroundColor: pc.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.punchDesc}>{item.description}</Text>
                  {item.location ? <Text style={styles.punchLocation}>{item.location}</Text> : null}
                </View>
                <View style={[styles.punchBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.punchBadgeText, { color: sc.color }]}>{sc.label}</Text>
                </View>
              </View>

              <View style={styles.punchMeta}>
                {item.assignedSub ? <Text style={styles.punchMetaText}>Sub: {item.assignedSub}</Text> : null}
                {item.dueDate ? <Text style={styles.punchMetaText}>Due: {item.dueDate}</Text> : null}
                <Text style={[styles.punchMetaText, { color: pc.color }]}>{pc.label} Priority</Text>
              </View>

              {item.linkedTaskName ? (
                <View style={styles.linkedTaskBadge}>
                  <Link2 size={11} color={Colors.primary} />
                  <Text style={styles.linkedTaskBadgeText} numberOfLines={1}>Task: {item.linkedTaskName}</Text>
                </View>
              ) : null}

              {item.rejectionNote ? (
                <View style={styles.rejectionBox}>
                  <MessageSquare size={12} color={Colors.error} />
                  <Text style={styles.rejectionText}>{item.rejectionNote}</Text>
                </View>
              ) : null}

              <View style={styles.punchActions}>
                {item.status === 'open' && (
                  <TouchableOpacity style={styles.punchActionBtn} onPress={() => handleStatusChange(item, 'in_progress')}>
                    <Clock size={14} color={Colors.info} />
                    <Text style={[styles.punchActionText, { color: Colors.info }]}>Start</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'in_progress' && (
                  <TouchableOpacity style={styles.punchActionBtn} onPress={() => handleStatusChange(item, 'ready_for_review')}>
                    <Eye size={14} color={Colors.warning} />
                    <Text style={[styles.punchActionText, { color: Colors.warning }]}>Submit for Review</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'ready_for_review' && (
                  <>
                    <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: Colors.successLight }]} onPress={() => handleStatusChange(item, 'closed')}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={[styles.punchActionText, { color: Colors.success }]}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: Colors.errorLight }]} onPress={() => { setShowRejectModal(item.id); setRejectionNote(''); }}>
                      <X size={14} color={Colors.error} />
                      <Text style={[styles.punchActionText, { color: Colors.error }]}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.punchDeleteBtn} onPress={() => {
                  Alert.alert('Delete', 'Delete this punch item?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deletePunchItem(item.id) },
                  ]);
                }}>
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {filteredItems.length === 0 && (
          <View style={styles.emptyState}>
            <CheckCircle size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{filterStatus !== 'all' ? 'No items with this status' : 'No Punch Items'}</Text>
            <Text style={styles.emptyDesc}>Tap + to add items that need to be resolved.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-punch-item">
          <Plus size={16} color={Colors.primary} />
          <Text style={styles.addItemBtnText}>Add Punch Item</Text>
        </TouchableOpacity>

        {allClosed && totalCount > 0 && (
          <TouchableOpacity style={styles.closeProjectBtn} onPress={handleCloseProject} activeOpacity={0.85}>
            <CheckCircle size={18} color="#fff" />
            <Text style={styles.closeProjectBtnText}>Close Project</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editingItem ? 'Edit Item' : 'New Punch Item'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Description *</Text>
                <TextInput style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]} value={description} onChangeText={setDescription} placeholder="What needs to be done..." placeholderTextColor={Colors.textMuted} multiline testID="punch-desc-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Location/Area</Text>
                    <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. Kitchen, Room 3B" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Due Date</Text>
                    <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Assigned Sub</Text>
                {subcontractors.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {subcontractors.map(s => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.subChip, assignedSub === s.companyName && styles.subChipActive]}
                        onPress={() => setAssignedSub(s.companyName)}
                      >
                        <Text style={[styles.subChipText, assignedSub === s.companyName && styles.subChipTextActive]}>{s.companyName}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <TextInput style={styles.input} value={assignedSub} onChangeText={setAssignedSub} placeholder="Sub name" placeholderTextColor={Colors.textMuted} />
                )}

                <Text style={styles.fieldLabel}>Priority</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['low', 'medium', 'high'] as PunchItemPriority[]).map(p => {
                    const pc = PRIORITY_CONFIG[p];
                    return (
                      <TouchableOpacity
                        key={p}
                        style={[styles.priorityBtn, priority === p && { backgroundColor: pc.color }]}
                        onPress={() => setPriority(p)}
                      >
                        <Text style={[styles.priorityBtnText, priority === p && { color: '#fff' }]}>{pc.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {scheduleTasks.length > 0 ? (
                  <>
                    <Text style={styles.fieldLabel}>Link to Schedule Task (optional)</Text>
                    <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
                      <Link2 size={14} color={Colors.primary} />
                      <Text style={[styles.pickerBtnText, !linkedTask && { color: Colors.textMuted }]} numberOfLines={1}>
                        {linkedTask ? linkedTask.title : 'No task linked'}
                      </Text>
                      {linkedTask ? (
                        <TouchableOpacity onPress={() => setLinkedTaskId('')} hitSlop={8}>
                          <X size={14} color={Colors.textMuted} />
                        </TouchableOpacity>
                      ) : (
                        <ChevronDown size={14} color={Colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  </>
                ) : null}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-punch-item">
                    <Text style={styles.saveBtnText}>{editingItem ? 'Update' : 'Add Item'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <View style={styles.rejectOverlay}>
          <View style={[styles.rejectCard, { maxHeight: '70%' as const }]}>
            <View style={styles.formHeader}>
              <Text style={styles.rejectTitle}>Link to Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {scheduleTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.subChip, { marginVertical: 4, alignSelf: 'stretch' as const }, linkedTaskId === t.id && styles.subChipActive]}
                  onPress={() => { setLinkedTaskId(t.id); setShowTaskPicker(false); }}
                >
                  <Text style={[styles.subChipText, linkedTaskId === t.id && styles.subChipTextActive]} numberOfLines={1}>
                    {t.title} {t.phase ? `— ${t.phase}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              {scheduleTasks.length === 0 ? (
                <Text style={[styles.rejectDesc, { textAlign: 'center' as const, padding: 20 }]}>No tasks in the schedule yet.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showRejectModal !== null} transparent animationType="fade" onRequestClose={() => setShowRejectModal(null)}>
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject Item</Text>
            <Text style={styles.rejectDesc}>Provide a reason for rejection:</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
              value={rejectionNote}
              onChangeText={setRejectionNote}
              placeholder="Reason for rejection..."
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowRejectModal(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: Colors.error }]} onPress={() => showRejectModal && handleReject(showRejectModal)} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, textAlign: 'center' as const, marginTop: 60 },
  progressSection: { marginHorizontal: 20, marginTop: 16, marginBottom: 16 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  progressPercent: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  progressTrack: { height: 8, backgroundColor: Colors.fillTertiary, borderRadius: 4, overflow: 'hidden' as const },
  progressFill: { height: 8, backgroundColor: Colors.primary, borderRadius: 4 },
  progressSub: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  filterRow: { paddingHorizontal: 20, gap: 6, marginBottom: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  punchCard: { marginHorizontal: 20, marginBottom: 10, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  punchCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  punchDesc: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, lineHeight: 21 },
  punchLocation: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  punchBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  punchBadgeText: { fontSize: 11, fontWeight: '700' as const },
  punchMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingLeft: 18 },
  punchMetaText: { fontSize: 12, color: Colors.textMuted },
  rejectionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: Colors.errorLight, borderRadius: 8, padding: 10, marginLeft: 18 },
  rejectionText: { flex: 1, fontSize: 12, color: Colors.error, lineHeight: 17 },
  punchActions: { flexDirection: 'row', gap: 8, paddingLeft: 18, flexWrap: 'wrap' },
  punchActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  punchActionText: { fontSize: 12, fontWeight: '600' as const },
  punchDeleteBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '20' },
  addItemBtnText: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary },
  closeProjectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 16, borderRadius: 14, backgroundColor: Colors.success },
  closeProjectBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  formCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  subChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  subChipActive: { backgroundColor: Colors.primary },
  subChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  subChipTextActive: { color: '#fff' },
  priorityBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' },
  priorityBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  rejectOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  rejectCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 22, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  rejectTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.error },
  rejectDesc: { fontSize: 14, color: Colors.textSecondary },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt },
  pickerBtnText: { flex: 1, fontSize: 14, color: Colors.text },
  linkedTaskBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: Colors.primary + '12', alignSelf: 'flex-start', marginLeft: 18 },
  linkedTaskBadgeText: { fontSize: 11, fontWeight: '600' as const, color: Colors.primary, flex: 1 },
  pickerOption: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, backgroundColor: Colors.surfaceAlt, marginBottom: 8 },
  pickerOptionActive: { backgroundColor: Colors.primary + '15', borderWidth: 1, borderColor: Colors.primary },
  pickerOptionText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  pickerOptionMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});
