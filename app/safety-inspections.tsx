import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, X, ClipboardCheck, TriangleAlert, Trash2, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { scoreInspection, inspectionItemsFromTemplate, hazardFromFailedItem } from '@/utils/safety/inspectionScore';
import type { SafetyInspection, InspectionItem, SafetyFormTemplate } from '@/types';
import { showAlert } from '@/utils/alert';

const RESULTS: InspectionItem['result'][] = ['pass', 'fail', 'na'];
const RESULT_LABEL: Record<InspectionItem['result'], string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' };

function resultColor(t: ThemeColors, r: InspectionItem['result']): string {
  if (r === 'pass') return t.success;
  if (r === 'fail') return t.danger;
  return t.textMuted;
}

function cycleResult(items: InspectionItem[], id: string, result: InspectionItem['result']): InspectionItem[] {
  return items.map((it) => (it.id === id ? { ...it, result } : it));
}

export default function SafetyInspectionsScreen() {
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
  return <SafetyInspectionsInner />;
}

function SafetyInspectionsInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getInspectionsForProject, addInspection, updateInspection, deleteInspection, templates, addHazard, hazards } = useSafety();

  const inspections = useMemo(() => getInspectionsForProject(projectId ?? ''), [projectId, getInspectionsForProject]);
  const inspectionTemplates = useMemo(() => templates.filter((t) => t.category === 'inspection'), [templates]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SafetyInspection | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [inspector, setInspector] = useState('');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<InspectionItem[]>([]);

  // Inspection items already spawned as hazards for the inspection being edited,
  // keyed by InspectionItem.id — drives dedup + the "Logged as hazard" state so a
  // still-failed line can't be logged twice on re-open.
  const loggedItemIds = useMemo(() => {
    if (!editing) return new Set<string>();
    return new Set(
      hazards
        .filter((h) => h.sourceInspectionId === editing.id && h.sourceItemId)
        .map((h) => h.sourceItemId as string),
    );
  }, [hazards, editing]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setTitle('');
    setDate(new Date().toISOString().slice(0, 10));
    setInspector('');
    setTemplateId(undefined);
    setItems([]);
  }, []);

  const openNew = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((inspection: SafetyInspection) => {
    setEditing(inspection);
    setTitle(inspection.title);
    setDate(inspection.date);
    setInspector(inspection.inspector);
    setTemplateId(inspection.templateId);
    setItems(inspection.items);
    setShowForm(true);
  }, []);

  const pickTemplate = useCallback((template: SafetyFormTemplate) => {
    setTemplateId(template.id);
    setItems(inspectionItemsFromTemplate(template, generateUUID));
    if (!title.trim()) setTitle(template.name);
  }, [title]);

  const addBlankItem = useCallback(() => {
    setItems((prev) => [...prev, { id: generateUUID(), prompt: '', result: 'na' }]);
  }, []);

  const setItemPrompt = useCallback((id: string, prompt: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, prompt } : it)));
  }, []);

  const setItemResult = useCallback((id: string, result: InspectionItem['result']) => {
    setItems((prev) => cycleResult(prev, id, result));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  // Only a PERSISTED inspection can spawn a hazard: the hazard stores the
  // inspection's real id as sourceInspectionId, so logging from an unsaved draft
  // would leave a dangling reference (and be orphaned entirely if the draft is
  // cancelled). Also dedup on the item id so re-tapping a still-failed line on
  // re-open can't insert a duplicate hazard.
  const handleLogHazard = useCallback((item: InspectionItem) => {
    if (!editing) return;
    if (item.id && loggedItemIds.has(item.id)) return;
    const hz = hazardFromFailedItem(
      { id: editing.id, projectId: editing.projectId, createdBy: userId ?? '' },
      item,
      new Date().toISOString(),
      generateUUID(),
    );
    addHazard(hz);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Hazard logged', `"${item.prompt || 'Failed item'}" was added to the Hazard Log for follow-up.`);
  }, [editing, loggedItemIds, addHazard, userId]);

  const handleSave = useCallback(() => {
    if (!title.trim()) { showAlert('Missing title', 'Give the inspection a title.'); return; }
    const cleaned = items.map((it) => ({ ...it, prompt: it.prompt.trim() })).filter((it) => it.prompt);
    const score = scoreInspection(cleaned).score;
    if (editing) {
      updateInspection(editing.id, { title: title.trim(), date, inspector: inspector.trim(), items: cleaned, score, templateId });
    } else {
      const inspection: SafetyInspection = {
        id: generateUUID(), projectId: projectId ?? '', title: title.trim(), date,
        inspector: inspector.trim(), items: cleaned, score, status: 'complete', templateId,
        createdAt: new Date().toISOString(), createdBy: userId ?? '',
      };
      addInspection(inspection);
    }
    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [title, date, inspector, items, templateId, editing, projectId, userId, addInspection, updateInspection, resetForm]);

  const handleDelete = useCallback((inspection: SafetyInspection) => {
    showAlert('Delete inspection', `Delete "${inspection.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteInspection(inspection.id) },
    ]);
  }, [deleteInspection]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: 'Inspections' }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        {inspections.map((inspection) => {
          const s = scoreInspection(inspection.items);
          const pct = Math.round(s.score * 100);
          return (
            <TouchableOpacity key={inspection.id} style={styles.card} onPress={() => openEdit(inspection)} activeOpacity={0.85}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{inspection.title}</Text>
                  <Text style={styles.cardMeta}>
                    {inspection.date}{inspection.inspector ? ` · ${inspection.inspector}` : ''}
                  </Text>
                </View>
                <View style={styles.scoreChip}>
                  <Text style={styles.scoreChipText}>{pct}%</Text>
                </View>
              </View>
              <View style={styles.countsRow}>
                <Text style={[styles.countText, { color: themeColors.success }]}>{s.pass} pass</Text>
                <Text style={[styles.countText, { color: themeColors.danger }]}>{s.fail} fail</Text>
                <Text style={[styles.countText, { color: themeColors.textMuted }]}>{s.na} n/a</Text>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} style={{ marginLeft: 'auto' as const }} />
              </View>
            </TouchableOpacity>
          );
        })}

        {inspections.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<ClipboardCheck size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No inspections yet"
              message="Run a safety inspection or audit against this project. Pull a checklist from your Forms Library, score each line pass / fail / N/A, and turn any failed item into a tracked hazard."
              actionLabel="New inspection"
              onAction={openNew}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={openNew} activeOpacity={0.7} testID="add-inspection">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>New Inspection</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20, maxHeight: '92%' }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editing ? 'Edit Inspection' : 'New Inspection'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={styles.fieldLabel}>Title *</Text>
                  <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Weekly site safety walk" placeholderTextColor={themeColors.textMuted} testID="inspection-title-input" />

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Date</Text>
                      <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Inspector</Text>
                      <TextInput style={styles.input} value={inspector} onChangeText={setInspector} placeholder="Name" placeholderTextColor={themeColors.textMuted} />
                    </View>
                  </View>

                  {inspectionTemplates.length > 0 && (
                    <>
                      <Text style={styles.fieldLabel}>Checklist template</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                        {inspectionTemplates.map((t) => (
                          <TouchableOpacity
                            key={t.id}
                            style={[styles.templateChip, templateId === t.id && styles.templateChipActive]}
                            onPress={() => pickTemplate(t)}
                          >
                            <Text style={[styles.templateChipText, templateId === t.id && styles.templateChipTextActive]}>
                              {t.name} ({t.fields.length})
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Text style={styles.fieldLabel}>Checklist items</Text>
                  {items.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemTop}>
                        <TextInput
                          style={[styles.input, { flex: 1, marginTop: 0 }]}
                          value={item.prompt}
                          onChangeText={(v) => setItemPrompt(item.id, v)}
                          placeholder="What are you checking?"
                          placeholderTextColor={themeColors.textMuted}
                        />
                        <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.itemDeleteBtn} accessibilityRole="button" accessibilityLabel="Remove item">
                          <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.segmented}>
                        {RESULTS.map((r) => {
                          const active = item.result === r;
                          const color = resultColor(themeColors, r);
                          return (
                            <TouchableOpacity
                              key={r}
                              style={[styles.segment, active && { backgroundColor: color }]}
                              onPress={() => setItemResult(item.id, r)}
                            >
                              <Text style={[styles.segmentText, active ? { color: '#fff' } : { color: themeColors.textSecondary }]}>
                                {RESULT_LABEL[r]}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {item.result === 'fail' && editing && (
                        loggedItemIds.has(item.id) ? (
                          <View style={[styles.logHazardBtn, styles.logHazardBtnDone]}>
                            <TriangleAlert size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                            <Text style={[styles.logHazardText, { color: themeColors.textMuted }]}>Logged as hazard</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.logHazardBtn}
                            onPress={() => handleLogHazard(item)}
                            activeOpacity={0.8}
                          >
                            <TriangleAlert size={14} color={themeColors.danger} strokeWidth={1.75} />
                            <Text style={styles.logHazardText}>Log as hazard</Text>
                          </TouchableOpacity>
                        )
                      )}
                      {item.result === 'fail' && !editing && (
                        <Text style={styles.logHazardHint}>Save the inspection to log this as a hazard.</Text>
                      )}
                    </View>
                  ))}

                  <TouchableOpacity style={styles.addFieldBtn} onPress={addBlankItem} activeOpacity={0.7}>
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addFieldBtnText}>Add item</Text>
                  </TouchableOpacity>
                </ScrollView>

                <View style={styles.formActions}>
                  {editing && (
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => { setShowForm(false); handleDelete(editing); }}>
                      <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-inspection">
                    <Text style={styles.saveBtnText}>{editing ? 'Update' : 'Save'}</Text>
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
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  cardTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  scoreChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '18' },
  scoreChipText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  countsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14 },
  countText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  addItemBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' as const },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 8 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text, marginTop: 4 },
  templateChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  templateChipActive: { backgroundColor: themeColors.accent },
  templateChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  templateChipTextActive: { color: '#fff' },
  itemRow: { marginTop: 10, padding: 12, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, borderWidth: 0.5, borderColor: themeColors.line, gap: 8 },
  itemTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  itemDeleteBtn: { width: 34, height: 34, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '14', alignItems: 'center' as const, justifyContent: 'center' as const },
  segmented: { flexDirection: 'row' as const, gap: 6 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line, alignItems: 'center' as const },
  segmentText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  logHazardBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '14' },
  logHazardBtnDone: { backgroundColor: themeColors.line },
  logHazardText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.danger },
  logHazardHint: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, alignSelf: 'flex-start' as const, fontStyle: 'italic' as const },
  addFieldBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, marginTop: 12, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addFieldBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  formActions: { flexDirection: 'row' as const, gap: 10, marginTop: 12 },
  deleteBtn: { width: 48, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.danger + '14', alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
