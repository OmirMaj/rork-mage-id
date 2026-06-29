import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Plus, ChevronLeft, CheckCircle2, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { LABOR_RATES } from '@/constants/laborRates';
import type { RateOverride } from '@/utils/rateOverrides';
import { generateUUID } from '@/utils/generateId';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateOverrideModalProps {
  visible: boolean;
  overrides: RateOverride[];
  /** estimate screen's in-scope catalog */
  materials: { id: string; name?: string; baseBulkPrice?: number }[];
  onClose: () => void;
  onAdd: (o: RateOverride) => void;
  onUpdate: (o: RateOverride) => void;
  onDelete: (id: string) => void;
}

// ─── Sub-form mode ────────────────────────────────────────────────────────────

type SubFormKind = 'labor' | 'material';

interface SubFormState {
  editingId: string | null;   // null ⇒ add-new
  kind: SubFormKind;
  selectedKey: string;        // trade id (labor) or material id (material)
  valueStr: string;           // numeric as string, coerced at save
}

function blankSubForm(kind: SubFormKind): SubFormState {
  return { editingId: null, kind, selectedKey: '', valueStr: '' };
}

// ─── Component ───────────────────────────────────────────────────────────────

function RateOverrideModalImpl({
  visible, overrides, materials, onClose, onAdd, onUpdate, onDelete,
}: RateOverrideModalProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // ── Sub-form state (null = list view) ─────────────────────────────────────
  const [subForm, setSubForm] = useState<SubFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reseed whenever modal opens (false → true).
  useEffect(() => {
    if (!visible) return;
    setSubForm(null);
    setError(null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: intentionally only on `visible` — re-seed from scratch each open.

  // ── Sub-form handlers ─────────────────────────────────────────────────────
  const openAddLabor = useCallback(() => {
    setSubForm(blankSubForm('labor'));
    setError(null);
  }, []);

  const openAddMaterial = useCallback(() => {
    setSubForm(blankSubForm('material'));
    setError(null);
  }, []);

  const openEditOverride = useCallback((o: RateOverride) => {
    // Deep copy — no parent mutation.
    const copy: RateOverride = { ...o };
    setSubForm({
      editingId: copy.id,
      kind: copy.kind,
      selectedKey: copy.key,
      valueStr: String(copy.value),
    });
    setError(null);
  }, []);

  const cancelSubForm = useCallback(() => {
    setSubForm(null);
    setError(null);
  }, []);

  // ── Validate & commit sub-form ────────────────────────────────────────────
  const handleSubFormSave = useCallback(() => {
    if (!subForm) return;

    if (!subForm.selectedKey) {
      setError(subForm.kind === 'labor' ? 'Select a trade.' : 'Select a material.');
      return;
    }
    const numValue = Number(subForm.valueStr);
    if (!Number.isFinite(numValue) || numValue <= 0) {
      setError('Enter a valid price greater than 0.');
      return;
    }

    if (subForm.kind === 'labor') {
      const laborRate = LABOR_RATES.find(r => r.trade === subForm.selectedKey);
      const override: RateOverride = {
        id: subForm.editingId ?? generateUUID(),
        kind: 'labor',
        key: subForm.selectedKey,
        value: numValue,
        label: laborRate?.trade ?? subForm.selectedKey,
      };
      if (subForm.editingId) {
        onUpdate(override);
      } else {
        onAdd(override);
      }
    } else {
      const mat = materials.find(m => m.id === subForm.selectedKey);
      const override: RateOverride = {
        id: subForm.editingId ?? generateUUID(),
        kind: 'material',
        key: subForm.selectedKey,
        value: numValue,
        label: mat?.name ?? subForm.selectedKey,
      };
      if (subForm.editingId) {
        onUpdate(override);
      } else {
        onAdd(override);
      }
    }

    setSubForm(null);
    setError(null);
  }, [subForm, materials, onAdd, onUpdate]);

  // ── Delete with confirm ───────────────────────────────────────────────────
  const handleDelete = useCallback((id: string, displayLabel: string) => {
    Alert.alert(
      'Delete Override',
      `Remove the override for "${displayLabel}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => onDelete(id),
        },
      ],
    );
  }, [onDelete]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const laborOverrides = overrides.filter(o => o.kind === 'labor');
  const materialOverrides = overrides.filter(o => o.kind === 'material');

  // ── Sub-form selectors ────────────────────────────────────────────────────
  const renderLaborSelector = () => (
    <View style={styles.section}>
      <Text style={styles.label}>Trade <Text style={styles.required}>*</Text></Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {LABOR_RATES.map(lr => (
          <TouchableOpacity
            key={lr.trade}
            style={[styles.chip, subForm?.selectedKey === lr.trade && styles.chipActive]}
            onPress={() => {
              setSubForm(prev => prev ? { ...prev, selectedKey: lr.trade } : prev);
              setError(null);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, subForm?.selectedKey === lr.trade && styles.chipTextActive]}>
              {lr.trade}
            </Text>
            <Text style={[styles.chipSub, subForm?.selectedKey === lr.trade && styles.chipTextActive]}>
              ${lr.hourlyRate}/hr default
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderMaterialSelector = () => (
    <View style={styles.section}>
      <Text style={styles.label}>Material <Text style={styles.required}>*</Text></Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {materials.map(mat => (
          <TouchableOpacity
            key={mat.id}
            style={[styles.chip, subForm?.selectedKey === mat.id && styles.chipActive]}
            onPress={() => {
              setSubForm(prev => prev ? { ...prev, selectedKey: mat.id } : prev);
              setError(null);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, subForm?.selectedKey === mat.id && styles.chipTextActive]}>
              {mat.name ?? mat.id}
            </Text>
            {mat.baseBulkPrice != null && (
              <Text style={[styles.chipSub, subForm?.selectedKey === mat.id && styles.chipTextActive]}>
                ${mat.baseBulkPrice} default
              </Text>
            )}
          </TouchableOpacity>
        ))}
        {materials.length === 0 && (
          <Text style={styles.emptyHint}>No materials in scope.</Text>
        )}
      </ScrollView>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────
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
              onPress={subForm ? cancelSubForm : onClose}
              hitSlop={8}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={subForm ? 'Back' : 'Close'}
            >
              <ChevronLeft size={18} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
            <Text style={styles.title}>
              {subForm
                ? subForm.editingId
                  ? `Edit ${subForm.kind === 'labor' ? 'Labor' : 'Material'} Rate`
                  : `Add ${subForm.kind === 'labor' ? 'Labor' : 'Material'} Rate`
                : 'Cost-Book Overrides'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {subForm ? (
            /* ── Sub-form ─────────────────────────────────────────────────── */
            <>
              <ScrollView
                style={{ maxHeight: 520 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {subForm.kind === 'labor' ? renderLaborSelector() : renderMaterialSelector()}

                {/* Price input */}
                <View style={styles.section}>
                  <Text style={styles.label}>
                    {subForm.kind === 'labor' ? 'Override rate ($/hr)' : 'Override unit price ($)'}
                    {' '}<Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    value={subForm.valueStr}
                    onChangeText={v => {
                      setSubForm(prev => prev ? { ...prev, valueStr: v } : prev);
                      setError(null);
                    }}
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder={subForm.kind === 'labor' ? 'e.g. 35.00' : 'e.g. 4.50'}
                    placeholderTextColor={themeColors.textMuted}
                    returnKeyType="done"
                  />
                </View>

                {/* Inline error */}
                {error ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}
              </ScrollView>

              {/* Sub-form footer */}
              <View style={styles.footer}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={cancelSubForm}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleSubFormSave}
                  activeOpacity={0.85}
                >
                  <CheckCircle2 size={14} color="#FFF" strokeWidth={1.75} />
                  <Text style={styles.primaryBtnText}>
                    {subForm.editingId ? 'Save changes' : 'Add override'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            /* ── List view ────────────────────────────────────────────────── */
            <>
              <ScrollView
                style={{ maxHeight: 520 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Labor overrides section */}
                <View style={styles.section}>
                  <Text style={styles.label}>Labor rates</Text>
                  {laborOverrides.length === 0 && (
                    <Text style={styles.emptyHint}>No labor overrides yet.</Text>
                  )}
                  {laborOverrides.map(o => {
                    const display = o.label ?? o.key;
                    return (
                      <View key={o.id} style={styles.overrideRow}>
                        <View style={styles.overrideInfo}>
                          <Text style={styles.overrideTitle}>{display}</Text>
                          <Text style={styles.overrideSub}>${o.value}/hr</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => openEditOverride(o)}
                          hitSlop={8}
                          style={styles.rowIconBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${display}`}
                        >
                          <ChevronLeft
                            size={14}
                            color={themeColors.accent}
                            style={{ transform: [{ rotate: '180deg' }] }} strokeWidth={1.75}
                          />
                          <Text style={[styles.rowBtnText, { color: themeColors.accent }]}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(o.id, display)}
                          hitSlop={8}
                          style={[styles.rowIconBtn, styles.rowIconBtnDelete]}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${display}`}
                        >
                          <Trash2 size={13} color="#FF3B30" strokeWidth={1.75} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  <TouchableOpacity style={styles.addRowBtn} onPress={openAddLabor} activeOpacity={0.8}>
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={[styles.addRowBtnText, { color: themeColors.accent }]}>＋ Labor rate</Text>
                  </TouchableOpacity>
                </View>

                {/* Material overrides section */}
                <View style={styles.section}>
                  <Text style={styles.label}>Material prices</Text>
                  {materialOverrides.length === 0 && (
                    <Text style={styles.emptyHint}>No material overrides yet.</Text>
                  )}
                  {materialOverrides.map(o => {
                    const display = o.label ?? o.key;
                    return (
                      <View key={o.id} style={styles.overrideRow}>
                        <View style={styles.overrideInfo}>
                          <Text style={styles.overrideTitle}>{display}</Text>
                          <Text style={styles.overrideSub}>${o.value}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => openEditOverride(o)}
                          hitSlop={8}
                          style={styles.rowIconBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${display}`}
                        >
                          <ChevronLeft
                            size={14}
                            color={themeColors.accent}
                            style={{ transform: [{ rotate: '180deg' }] }} strokeWidth={1.75}
                          />
                          <Text style={[styles.rowBtnText, { color: themeColors.accent }]}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(o.id, display)}
                          hitSlop={8}
                          style={[styles.rowIconBtn, styles.rowIconBtnDelete]}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${display}`}
                        >
                          <Trash2 size={13} color="#FF3B30" strokeWidth={1.75} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  <TouchableOpacity style={styles.addRowBtn} onPress={openAddMaterial} activeOpacity={0.8}>
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={[styles.addRowBtnText, { color: themeColors.accent }]}>＋ Material price</Text>
                  </TouchableOpacity>
                </View>

                {/* Inline error (shown when list view has one, defensive) */}
                {error ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}
              </ScrollView>

              {/* List-view footer */}
              <View style={styles.footer}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={onClose}
                  activeOpacity={0.85}
                >
                  <CheckCircle2 size={14} color="#FFF" strokeWidth={1.75} />
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const RateOverrideModal = memo(RateOverrideModalImpl);

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

  input: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    padding: 12, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },

  // Category chips (trade / material selectors)
  chipRow: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
    borderColor: t.line, backgroundColor: Colors.card,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  chipTextActive: { color: '#FFF' },
  chipSub: {
    fontSize: 9, fontWeight: '500', color: t.textMuted, marginTop: 2,
  },

  // Override list rows
  overrideRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 8, gap: 8,
  },
  overrideInfo: { flex: 1 },
  overrideTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  overrideSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  rowIconBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '12',
  },
  rowIconBtnDelete: {
    backgroundColor: '#FF3B3012',
  },
  rowBtnText: { fontSize: Type.caption2.fontSize, fontWeight: '700' },

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

  emptyHint: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic',
    marginBottom: 8,
  },

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
