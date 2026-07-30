import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, X, ClipboardList, Trash2, ChevronUp, ChevronDown } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import type { SafetyFormTemplate, SafetyFormField, SafetyFormFieldType } from '@/types';
import { showAlert } from '@/utils/alert';

const FIELD_TYPES: SafetyFormFieldType[] = ['text', 'checkbox', 'select', 'signature', 'photo'];

const CATEGORIES: SafetyFormTemplate['category'][] = ['jha', 'inspection', 'general'];
const CATEGORY_LABEL: Record<SafetyFormTemplate['category'], string> = {
  jha: 'JHA',
  inspection: 'Inspection',
  general: 'General',
};

const FIELD_TYPE_LABEL: Record<SafetyFormFieldType, string> = {
  text: 'Text',
  checkbox: 'Checkbox',
  select: 'Select',
  signature: 'Signature',
  photo: 'Photo',
};

function moveField(fields: SafetyFormField[], index: number, dir: -1 | 1): SafetyFormField[] {
  const j = index + dir;
  if (j < 0 || j >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

export default function SafetyFormsScreen() {
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
  return <SafetyFormsInner />;
}

function SafetyFormsInner() {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { templates, addTemplate, updateTemplate, deleteTemplate } = useSafety();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SafetyFormTemplate | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<SafetyFormTemplate['category']>('general');
  const [fields, setFields] = useState<SafetyFormField[]>([]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setName('');
    setCategory('general');
    setFields([]);
  }, []);

  const openNew = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((tpl: SafetyFormTemplate) => {
    setEditing(tpl);
    setName(tpl.name);
    setCategory(tpl.category);
    setFields(tpl.fields.map((f) => ({ ...f })));
    setShowForm(true);
  }, []);

  const addFieldRow = useCallback(() => {
    setFields((prev) => [...prev, { id: generateUUID(), label: '', type: 'text', required: false }]);
  }, []);

  const updateFieldRow = useCallback((id: string, changes: Partial<SafetyFormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  }, []);

  const removeFieldRow = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const reorderField = useCallback((index: number, dir: -1 | 1) => {
    setFields((prev) => moveField(prev, index, dir));
  }, []);

  const handleSave = useCallback(() => {
    const cleaned = fields.filter((f) => f.label.trim()).map((f) => ({
      ...f, label: f.label.trim(),
      options: f.type === 'select' ? (f.options ?? []).filter(Boolean) : undefined,
    }));
    if (!name.trim() || cleaned.length === 0) { showAlert('Incomplete', 'A form needs a name and at least one labeled field.'); return; }
    if (editing) {
      updateTemplate(editing.id, { name: name.trim(), category, fields: cleaned });
    } else {
      const template: SafetyFormTemplate = {
        id: generateUUID(), name: name.trim(), category, fields: cleaned,
        createdAt: new Date().toISOString(), createdBy: userId ?? '',
      };
      addTemplate(template);
    }
    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [name, category, fields, editing, userId, addTemplate, updateTemplate, resetForm]);

  const handleDelete = useCallback((tpl: SafetyFormTemplate) => {
    showAlert('Delete form', `Delete "${tpl.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(tpl.id) },
    ]);
  }, [deleteTemplate]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: 'Forms Library' }} />
      <ScrollView contentContainerStyle={[{ paddingBottom: insets.bottom + 40 }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        {templates.map((tpl) => (
          <TouchableOpacity key={tpl.id} style={styles.card} onPress={() => openEdit(tpl)} activeOpacity={0.85}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{tpl.name}</Text>
                <Text style={styles.cardMeta}>{tpl.fields.length} field{tpl.fields.length === 1 ? '' : 's'}</Text>
              </View>
              <View style={[styles.categoryChip, { backgroundColor: themeColors.accent + '18' }]}>
                <Text style={[styles.categoryChipText, { color: themeColors.accent }]}>{CATEGORY_LABEL[tpl.category]}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {templates.length === 0 && (
          <View style={{ minHeight: 340 }}>
            <EmptyState
              icon={<ClipboardList size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No forms yet"
              message="Build reusable checklists and forms — JHAs, inspection checklists, or custom sign-off sheets. Add labeled fields once and reuse them across projects."
              actionLabel="Create first form"
              onAction={openNew}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={openNew} activeOpacity={0.7} testID="add-form">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Add Form</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20, maxHeight: '92%' }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editing ? 'Edit Form' : 'New Form'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={styles.fieldLabel}>Form name *</Text>
                  <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Daily fall-protection checklist" placeholderTextColor={themeColors.textMuted} testID="form-name-input" />

                  <Text style={styles.fieldLabel}>Category</Text>
                  <View style={styles.segmented}>
                    {CATEGORIES.map((cat) => {
                      const active = category === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.segment, active && styles.segmentActive]}
                          onPress={() => setCategory(cat)}
                        >
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{CATEGORY_LABEL[cat]}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Fields</Text>
                  {fields.length === 0 ? (
                    <Text style={styles.hintText}>No fields yet — add at least one below.</Text>
                  ) : null}
                  {fields.map((f, index) => (
                    <View key={f.id} style={styles.fieldRow}>
                      <View style={styles.fieldRowTop}>
                        <TextInput
                          style={[styles.input, { flex: 1, marginTop: 0 }]}
                          value={f.label}
                          onChangeText={(t) => updateFieldRow(f.id, { label: t })}
                          placeholder="Field label"
                          placeholderTextColor={themeColors.textMuted}
                        />
                        <TouchableOpacity
                          style={styles.reorderBtn}
                          onPress={() => reorderField(index, -1)}
                          disabled={index === 0}
                          accessibilityRole="button"
                          accessibilityLabel="Move field up"
                        >
                          <ChevronUp size={16} color={index === 0 ? themeColors.textMuted : themeColors.textSecondary} strokeWidth={2} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.reorderBtn}
                          onPress={() => reorderField(index, 1)}
                          disabled={index === fields.length - 1}
                          accessibilityRole="button"
                          accessibilityLabel="Move field down"
                        >
                          <ChevronDown size={16} color={index === fields.length - 1 ? themeColors.textMuted : themeColors.textSecondary} strokeWidth={2} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.reorderBtn}
                          onPress={() => removeFieldRow(f.id)}
                          accessibilityRole="button"
                          accessibilityLabel="Delete field"
                        >
                          <Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} />
                        </TouchableOpacity>
                      </View>

                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                        {FIELD_TYPES.map((ft) => {
                          const active = f.type === ft;
                          return (
                            <TouchableOpacity
                              key={ft}
                              style={[styles.typeChip, active && styles.typeChipActive]}
                              onPress={() => updateFieldRow(f.id, { type: ft })}
                            >
                              <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{FIELD_TYPE_LABEL[ft]}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {f.type === 'select' ? (
                        <TextInput
                          style={styles.input}
                          value={(f.options ?? []).join(', ')}
                          onChangeText={(t) => updateFieldRow(f.id, { options: t.split(',').map((o) => o.trim()) })}
                          placeholder="Options, comma-separated"
                          placeholderTextColor={themeColors.textMuted}
                        />
                      ) : null}

                      <View style={styles.requiredRow}>
                        <Text style={styles.requiredLabel}>Required</Text>
                        <Switch
                          value={f.required}
                          onValueChange={(v) => updateFieldRow(f.id, { required: v })}
                          trackColor={{ false: themeColors.line, true: themeColors.accent }}
                        />
                      </View>
                    </View>
                  ))}

                  <TouchableOpacity style={styles.addFieldBtn} onPress={addFieldRow} activeOpacity={0.7} testID="add-field">
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addFieldBtnText}>Add field</Text>
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
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-form">
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
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line },
  cardTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  categoryChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  categoryChipText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  addItemBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' as const },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 8 },
  hintText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text, marginTop: 4 },
  segmented: { flexDirection: 'row' as const, gap: 6, marginTop: 6 },
  segment: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  segmentActive: { backgroundColor: themeColors.accent },
  segmentText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  segmentTextActive: { color: '#fff' },
  fieldRow: { marginTop: 12, padding: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  fieldRowTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  reorderBtn: { width: 40, height: 44, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  typeChipActive: { backgroundColor: themeColors.accent },
  typeChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  typeChipTextActive: { color: '#fff' },
  requiredRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 4 },
  requiredLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  addFieldBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, marginTop: 14, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addFieldBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  formActions: { flexDirection: 'row' as const, gap: 10, marginTop: 12 },
  deleteBtn: { width: 48, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.danger + '14', alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
