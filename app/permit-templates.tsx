// permit-templates.tsx — Filing Reuse Engine (vision-doc P9).
//
// "Most GCs do similar projects repeatedly. Each filing is substantially
// identical to the last 5. Pre-fix the GC redoes everything from scratch
// every time."
//
// This screen lets the GC:
//   - List their saved permit templates, sorted by most-recently-used
//   - Create a new template from scratch (form modal)
//   - Edit / delete an existing template
//   - Optionally tap "Use template" — would route to /permits with
//     prefill params (left as a v1.1 wire — for now we just display
//     the templates and let the user copy fields manually)
//
// The template structure mirrors the Permit type's reusable fields:
// type, jurisdiction, scope, fee, phase, special-inspection category.
// Project-specific fields (project_id, addresses, exact dates) are
// NOT in the template — those are filled at instantiation.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plus, FileText, X, Check, Trash2, Bookmark, ChevronDown,
  Building, Zap, Droplet, Wind, Hammer, Mountain, Flame,
  Home as HomeIcon, ClipboardCheck, FileQuestion,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { usePermitTemplates, type PermitTemplate } from '@/hooks/usePermitTemplates';
import EmptyState from '@/components/ui/EmptyState';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { PermitType } from '@/types';

const PERMIT_TYPES: { key: PermitType; label: string; icon: typeof Building }[] = [
  { key: 'building', label: 'Building', icon: Building },
  { key: 'electrical', label: 'Electrical', icon: Zap },
  { key: 'plumbing', label: 'Plumbing', icon: Droplet },
  { key: 'mechanical', label: 'Mechanical', icon: Wind },
  { key: 'demolition', label: 'Demolition', icon: Hammer },
  { key: 'grading', label: 'Grading', icon: Mountain },
  { key: 'fire', label: 'Fire', icon: Flame },
  { key: 'occupancy', label: 'Occupancy', icon: HomeIcon },
  { key: 'special_inspection', label: 'Special insp.', icon: ClipboardCheck },
  { key: 'other', label: 'Other', icon: FileQuestion },
];

function iconFor(type: PermitType) {
  return PERMIT_TYPES.find(t => t.key === type)?.icon ?? FileQuestion;
}

function labelFor(type: PermitType): string {
  return PERMIT_TYPES.find(t => t.key === type)?.label ?? type;
}

export default function PermitTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const { templates, addTemplate, updateTemplate, deleteTemplate, loading } = usePermitTemplates();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<PermitTemplate | null>(null);

  const sorted = useMemo(() =>
    [...templates].sort((a, b) => {
      // Most-recently-used first. Templates with no use yet sort
      // descending by createdAt (newest unused on top).
      if (a.lastUsedAt && !b.lastUsedAt) return -1;
      if (!a.lastUsedAt && b.lastUsedAt) return 1;
      if (a.lastUsedAt && b.lastUsedAt) {
        return Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt);
      }
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    }),
    [templates],
  );

  const handleDelete = useCallback((t: PermitTemplate) => {
    Alert.alert(
      'Delete template',
      `Remove "${t.name}"? This won't affect permits already created from it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTemplate(t.id),
        },
      ],
    );
  }, [deleteTemplate]);

  if (!loading && templates.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: 'Permit templates',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
          }}
        />
        <EmptyState
          icon={<Bookmark size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No filing templates yet"
          message="Save a permit setup as a template once — type, jurisdiction, typical scope, fee — and re-use it for every similar project. Brooklyn kitchen renos, basement finishes, ADUs."
        />
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 16 }]}
          activeOpacity={0.85}
          onPress={() => setComposerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="New template"
        >
          <Plus size={20} color={Colors.background} />
          <Text style={styles.fabText}>New template</Text>
        </TouchableOpacity>
        <TemplateComposerModal
          visible={composerOpen}
          editing={null}
          onClose={() => setComposerOpen(false)}
          onSave={(input) => {
            addTemplate(input);
            setComposerOpen(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Permit templates',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView contentContainerStyle={{ paddingTop: Tokens.spacing.sm, paddingBottom: insets.bottom + 88 }}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Templates</Text>
          <Text style={styles.headerCount}>{templates.length}</Text>
        </View>
        <Text style={styles.headerSub}>
          Reusable filing patterns. Save once, file in 30 minutes instead of 6 hours.
        </Text>

        {sorted.map(t => {
          const Icon = iconFor(t.type);
          return (
            <TouchableOpacity
              key={t.id}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => setEditing(t)}
            >
              <View style={[styles.iconWrap, { backgroundColor: Colors.primary + '15' }]}>
                <Icon size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{t.name}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>
                  {labelFor(t.type)} · {t.jurisdiction}
                  {t.typicalFee ? ` · ${formatMoney(t.typicalFee)} typical fee` : ''}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {t.useCount === 0
                    ? 'Not used yet'
                    : `Used ${t.useCount} time${t.useCount === 1 ? '' : 's'}${t.lastUsedAt ? ` · last ${new Date(t.lastUsedAt).toLocaleDateString()}` : ''}`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDelete(t)}
                style={styles.cardKebab}
                accessibilityLabel="Delete template"
              >
                <Trash2 size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={() => setComposerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="New template"
        testID="template-add"
      >
        <Plus size={20} color={Colors.background} />
        <Text style={styles.fabText}>New template</Text>
      </TouchableOpacity>

      <TemplateComposerModal
        visible={composerOpen || !!editing}
        editing={editing}
        onClose={() => { setComposerOpen(false); setEditing(null); }}
        onSave={(input) => {
          if (editing) {
            updateTemplate(editing.id, input);
            setEditing(null);
          } else {
            addTemplate(input);
            setComposerOpen(false);
          }
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
        }}
      />
    </View>
  );
}

// ─── Composer modal ─────────────────────────────────────────────
function TemplateComposerModal({
  visible, editing, onClose, onSave,
}: {
  visible: boolean;
  editing: PermitTemplate | null;
  onClose: () => void;
  onSave: (input: Omit<PermitTemplate, 'id' | 'useCount' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<PermitType>(editing?.type ?? 'building');
  const [jurisdiction, setJurisdiction] = useState(editing?.jurisdiction ?? '');
  const [scopeTemplate, setScopeTemplate] = useState(editing?.scopeTemplate ?? '');
  const [typicalFee, setTypicalFee] = useState(editing?.typicalFee?.toString() ?? '');
  const [phase, setPhase] = useState(editing?.phase ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  // Reset state when the editing target changes.
  React.useEffect(() => {
    if (visible) {
      setName(editing?.name ?? '');
      setType(editing?.type ?? 'building');
      setJurisdiction(editing?.jurisdiction ?? '');
      setScopeTemplate(editing?.scopeTemplate ?? '');
      setTypicalFee(editing?.typicalFee?.toString() ?? '');
      setPhase(editing?.phase ?? '');
      setNotes(editing?.notes ?? '');
    }
  }, [visible, editing]);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give this template a name (e.g. "Brooklyn kitchen reno - Alt 2").');
      return;
    }
    if (!jurisdiction.trim()) {
      Alert.alert('Jurisdiction required', 'NYC DOB, Nassau County, etc.');
      return;
    }
    onSave({
      name: name.trim(),
      type,
      jurisdiction: jurisdiction.trim(),
      scopeTemplate: scopeTemplate.trim() || undefined,
      typicalFee: Number(typicalFee) || undefined,
      phase: phase.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }, [name, type, jurisdiction, scopeTemplate, typicalFee, phase, notes, onSave]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {editing ? 'Edit template' : 'New template'}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSave} testID="template-save">
            <Check size={18} color={Colors.background} />
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.label}>Template name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Brooklyn kitchen reno - Alt 2"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.label}>Permit type</Text>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setTypePickerOpen(o => !o)}
            activeOpacity={0.85}
          >
            <Text style={styles.fieldText}>{labelFor(type)}</Text>
            <ChevronDown size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          {typePickerOpen && (
            <View style={styles.pickerList}>
              {PERMIT_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={styles.pickerItem}
                    onPress={() => {
                      setType(t.key);
                      setTypePickerOpen(false);
                    }}
                  >
                    <Icon size={14} color={Colors.textMuted} />
                    <Text style={styles.pickerItemText}>{t.label}</Text>
                    {t.key === type ? <Check size={14} color={Colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.label}>Jurisdiction</Text>
          <TextInput
            value={jurisdiction}
            onChangeText={setJurisdiction}
            placeholder="NYC DOB, Nassau County, Town of Hempstead"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <View style={{ flexDirection: 'row' as const, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Typical fee</Text>
              <TextInput
                value={typicalFee}
                onChangeText={setTypicalFee}
                placeholder="850"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Phase</Text>
              <TextInput
                value={phase}
                onChangeText={setPhase}
                placeholder="Foundation, Rough-in..."
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>Scope template (optional)</Text>
          <TextInput
            value={scopeTemplate}
            onChangeText={setScopeTemplate}
            placeholder="Pre-fills the new permit's scope text. Use generic phrasing — replace project-specific details at filing time."
            placeholderTextColor={Colors.textMuted}
            multiline
            style={[styles.input, styles.multilineInput]}
          />

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Common gotchas, approver preferences, expediter contact info..."
            placeholderTextColor={Colors.textMuted}
            multiline
            style={[styles.input, styles.multilineInput]}
          />

          <Text style={styles.helperText}>
            {editing
              ? `Used ${editing.useCount} time${editing.useCount === 1 ? '' : 's'}.`
              : 'Templates persist offline — save now, fill in details over time.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: Tokens.spacing.md,
    marginTop: 6,
  },
  headerTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  headerCount: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  headerSub: {
    paddingHorizontal: Tokens.spacing.md,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: Tokens.spacing.sm,
  },

  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cardTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  cardSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.hairline,
  },
  cardMeta: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: Tokens.spacing.xxs,
  },
  cardKebab: { padding: 6 },

  fab: {
    position: 'absolute' as const,
    right: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: Tokens.spacing.sm,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  fabText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.background,
  },

  modalRoot: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalClose: { padding: Tokens.spacing.xxs },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text },
  modalSave: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
  },
  modalSaveText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: Colors.background },
  modalBody: { padding: Tokens.spacing.md, gap: 6, paddingBottom: 60 },

  label: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    marginTop: 14,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  fieldText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '600' as const, flex: 1 },
  pickerList: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  pickerItemText: { flex: 1, fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '500' as const },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  multilineInput: { minHeight: 80, textAlignVertical: 'top' as const, paddingTop: 10 },
  helperText: {
    marginTop: Tokens.spacing.md,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
});
