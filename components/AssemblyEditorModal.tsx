import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Plus, ChevronLeft, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  ASSEMBLY_CATEGORIES,
  type AssemblyItem,
  type AssemblyMaterial,
  type AssemblyLabor,
} from '@/constants/assemblies';
import { generateUUID } from '@/utils/generateId';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssemblyEditorModalProps {
  visible: boolean;
  initial?: AssemblyItem | null;   // null/undefined => create; set => edit
  onClose: () => void;
  onSave: (a: AssemblyItem) => void;
}

// ─── Internal row shapes (strings for controlled inputs) ─────────────────────

interface MaterialRow {
  name: string;
  quantityPerUnit: string;
  unit: string;
  wasteFactor: string;
}

interface LaborRow {
  trade: string;
  hoursPerUnit: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EDITOR_CATEGORIES = ASSEMBLY_CATEGORIES.filter(c => c.id !== 'all');

function blankMaterial(): MaterialRow {
  return { name: '', quantityPerUnit: '1', unit: '', wasteFactor: '0' };
}

function blankLabor(): LaborRow {
  return { trade: '', hoursPerUnit: '1' };
}

function materialToRow(m: AssemblyMaterial): MaterialRow {
  return {
    name: m.name,
    quantityPerUnit: String(m.quantityPerUnit),
    unit: m.unit,
    wasteFactor: String(m.wasteFactor),
  };
}

function laborToRow(l: AssemblyLabor): LaborRow {
  return { trade: l.trade, hoursPerUnit: String(l.hoursPerUnit) };
}

// ─── Component ───────────────────────────────────────────────────────────────

function AssemblyEditorModalImpl({
  visible, initial, onClose, onSave,
}: AssemblyEditorModalProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // ── Form state ────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [category, setCategory] = useState(EDITOR_CATEGORIES[0]?.id ?? 'structural');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [labors, setLabors] = useState<LaborRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reseed whenever modal opens (false → true).
  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setName(initial.name);
      setCategory(initial.category);
      setDescription(initial.description);
      setUnit(initial.unit);
      setNotes(initial.notes);
      // Deep-copy arrays so edits never mutate the parent's initial object.
      setMaterials(initial.materialsPerUnit.map(materialToRow));
      setLabors(initial.laborPerUnit.map(laborToRow));
    } else {
      setName('');
      setCategory(EDITOR_CATEGORIES[0]?.id ?? 'structural');
      setDescription('');
      setUnit('');
      setNotes('');
      setMaterials([]);
      setLabors([]);
    }
    setError(null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: intentionally only on `visible` — we re-seed from `initial` each open.

  // ── Material row handlers ─────────────────────────────────────────────────
  const addMaterial = useCallback(() => {
    setMaterials(prev => [...prev, blankMaterial()]);
  }, []);

  const removeMaterial = useCallback((idx: number) => {
    setMaterials(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateMaterial = useCallback((idx: number, field: keyof MaterialRow, value: string) => {
    setMaterials(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }, []);

  // ── Labor row handlers ────────────────────────────────────────────────────
  const addLabor = useCallback(() => {
    setLabors(prev => [...prev, blankLabor()]);
  }, []);

  const removeLabor = useCallback((idx: number) => {
    setLabors(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateLabor = useCallback((idx: number, field: keyof LaborRow, value: string) => {
    setLabors(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }, []);

  // ── Validate & save ───────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    // 1. name required
    if (!name.trim()) {
      setError('Assembly name is required.');
      return;
    }
    // 2. at least one material OR one labor row
    if (materials.length === 0 && labors.length === 0) {
      setError('Add at least one material or labor row.');
      return;
    }
    // 3. Validate each material row
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (!m.name.trim()) {
        setError(`Material row ${i + 1}: name is required.`);
        return;
      }
      const qty = Number(m.quantityPerUnit);
      if (!Number.isFinite(qty) || qty < 0) {
        setError(`Material row ${i + 1}: quantity must be a number ≥ 0.`);
        return;
      }
      const wf = Number(m.wasteFactor);
      if (!Number.isFinite(wf) || wf < 0) {
        setError(`Material row ${i + 1}: waste factor must be a number ≥ 0.`);
        return;
      }
    }
    // 4. Validate each labor row
    for (let i = 0; i < labors.length; i++) {
      const l = labors[i];
      if (!l.trade.trim()) {
        setError(`Labor row ${i + 1}: trade is required.`);
        return;
      }
      const hrs = Number(l.hoursPerUnit);
      if (!Number.isFinite(hrs) || hrs < 0) {
        setError(`Labor row ${i + 1}: hours must be a number ≥ 0.`);
        return;
      }
    }

    // All valid — build the AssemblyItem
    const coercedMaterials: AssemblyMaterial[] = materials.map(m => ({
      materialId: '',
      name: m.name.trim(),
      quantityPerUnit: Number(m.quantityPerUnit),
      unit: m.unit.trim(),
      wasteFactor: Number(m.wasteFactor),
    }));

    const coercedLabors: AssemblyLabor[] = labors.map(l => ({
      trade: l.trade.trim(),
      hoursPerUnit: Number(l.hoursPerUnit),
    }));

    const assembled: AssemblyItem = {
      id: initial?.id ?? generateUUID(),
      name: name.trim(),
      category,
      description: description.trim(),
      unit: unit.trim(),
      materialsPerUnit: coercedMaterials,
      laborPerUnit: coercedLabors,
      notes: notes.trim(),
    };

    onSave(assembled);
    onClose();
  }, [name, category, description, unit, notes, materials, labors, initial, onSave, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────
  const isEditing = Boolean(initial?.id);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={[styles.card, { paddingBottom: insets.bottom + 16 }]}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.head}>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <ChevronLeft size={18} color={themeColors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>
              {isEditing ? 'Edit Assembly' : 'New Assembly'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color={themeColors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 560 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Name ─────────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Assembly name <Text style={styles.required}>*</Text></Text>
              <TextInput
                value={name}
                onChangeText={v => { setName(v); setError(null); }}
                style={styles.input}
                placeholder="e.g. Frame Interior Wall (2x4)"
                placeholderTextColor={themeColors.textMuted}
                returnKeyType="next"
              />
            </View>

            {/* ── Category ─────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {EDITOR_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.chip, category === cat.id && styles.chipActive]}
                    onPress={() => setCategory(cat.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, category === cat.id && styles.chipTextActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* ── Description ──────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                style={[styles.input, styles.textArea]}
                placeholder="Brief description of scope"
                placeholderTextColor={themeColors.textMuted}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* ── Unit ─────────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Unit</Text>
              <TextInput
                value={unit}
                onChangeText={setUnit}
                style={styles.input}
                placeholder="e.g. per LF, per SF, per EA"
                placeholderTextColor={themeColors.textMuted}
                returnKeyType="next"
              />
            </View>

            {/* ── Materials ────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Materials per unit</Text>
              {materials.map((mat, idx) => (
                <View key={idx} style={styles.rowCard}>
                  <View style={styles.rowCardHeader}>
                    <Text style={styles.rowCardNum}>#{idx + 1}</Text>
                    <TouchableOpacity
                      onPress={() => removeMaterial(idx)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Remove material"
                    >
                      <X size={14} color={themeColors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    value={mat.name}
                    onChangeText={v => { updateMaterial(idx, 'name', v); setError(null); }}
                    style={styles.input}
                    placeholder="Material name *"
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <View style={styles.row3}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subLabel}>Qty / unit</Text>
                      <TextInput
                        value={mat.quantityPerUnit}
                        onChangeText={v => { updateMaterial(idx, 'quantityPerUnit', v); setError(null); }}
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="1"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subLabel}>Unit</Text>
                      <TextInput
                        value={mat.unit}
                        onChangeText={v => updateMaterial(idx, 'unit', v)}
                        style={styles.input}
                        placeholder="each"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subLabel}>Waste %</Text>
                      <TextInput
                        value={mat.wasteFactor}
                        onChangeText={v => { updateMaterial(idx, 'wasteFactor', v); setError(null); }}
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="0.10"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.addRowBtn} onPress={addMaterial} activeOpacity={0.8}>
                <Plus size={14} color={themeColors.accent} />
                <Text style={[styles.addRowBtnText, { color: themeColors.accent }]}>Add material</Text>
              </TouchableOpacity>
            </View>

            {/* ── Labor ────────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Labor per unit</Text>
              {labors.map((lab, idx) => (
                <View key={idx} style={styles.rowCard}>
                  <View style={styles.rowCardHeader}>
                    <Text style={styles.rowCardNum}>#{idx + 1}</Text>
                    <TouchableOpacity
                      onPress={() => removeLabor(idx)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Remove labor"
                    >
                      <X size={14} color={themeColors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.row2}>
                    <View style={{ flex: 2 }}>
                      <Text style={styles.subLabel}>Trade *</Text>
                      <TextInput
                        value={lab.trade}
                        onChangeText={v => { updateLabor(idx, 'trade', v); setError(null); }}
                        style={styles.input}
                        placeholder="e.g. Carpenter"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subLabel}>Hrs / unit</Text>
                      <TextInput
                        value={lab.hoursPerUnit}
                        onChangeText={v => { updateLabor(idx, 'hoursPerUnit', v); setError(null); }}
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="1"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.addRowBtn} onPress={addLabor} activeOpacity={0.8}>
                <Plus size={14} color={themeColors.accent} />
                <Text style={[styles.addRowBtnText, { color: themeColors.accent }]}>Add labor</Text>
              </TouchableOpacity>
            </View>

            {/* ── Notes ────────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                style={[styles.input, styles.textArea]}
                placeholder="Any additional notes or caveats"
                placeholderTextColor={themeColors.textMuted}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* ── Inline error ──────────────────────────────────────────── */}
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <CheckCircle2 size={14} color="#FFF" />
              <Text style={styles.primaryBtnText}>
                {isEditing ? 'Save changes' : 'Create assembly'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const AssemblyEditorModal = memo(AssemblyEditorModalImpl);

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: 8,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2,
  },
  backBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  section: { marginBottom: 14 },
  label: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6,
  },
  required: { color: t.accent },
  subLabel: {
    fontSize: 10, fontWeight: '700', color: t.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 4,
  },

  input: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    padding: 12, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  textArea: {
    minHeight: 60, textAlignVertical: 'top' as const,
  },

  // Category chips
  chipRow: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    borderColor: t.line, backgroundColor: Colors.card,
  },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  chipTextActive: { color: '#FFF' },

  // Row cards for repeatable rows
  rowCard: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    padding: 10, marginBottom: 8, gap: 8,
  },
  rowCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCardNum: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted },

  row2: { flexDirection: 'row', gap: 8 },
  row3: { flexDirection: 'row', gap: 6 },

  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderStyle: 'dashed' as const,
    borderColor: t.accent + '40',
    backgroundColor: t.accent + '08',
    justifyContent: 'center',
  },
  addRowBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' },

  // Error
  errorBanner: {
    backgroundColor: '#FF3B3020',
    borderWidth: 1, borderColor: '#FF3B3060',
    borderRadius: Tokens.radius.md,
    padding: 12, marginBottom: 10,
  },
  errorText: { fontSize: Type.caption1.fontSize, color: '#FF3B30', fontWeight: '600' },

  // Footer
  footer: { flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line },
  secondaryBtn: {
    flex: 1, paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  primaryBtn: {
    flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
  },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
});
