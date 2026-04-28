// selections — GC-side allowances + AI curation hub. The GC lists the
// categories the homeowner will pick (Kitchen Cabinets, Bathroom Tile,
// Lighting, etc.), sets a budget for each, and taps "Generate AI options".
// Gemini returns 4 real-brand options spread across the budget range;
// homeowner picks one in their portal.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, Trash2, Sparkles, DollarSign, Star, ExternalLink,
  CheckCircle2, AlertTriangle, Clock, Package,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  fetchSelectionsForProject, saveSelectionCategory, deleteSelectionCategory,
  saveSelectionOption, chooseSelectionOption, curateSelectionsAI,
  saveCuratedOptions, summarizeAllowances,
} from '@/utils/selectionsEngine';
import { formatMoney } from '@/utils/formatters';
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
import type { SelectionCategory, SelectionOption } from '@/types';

export default function SelectionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : undefined;

  const [categories, setCategories] = useState<SelectionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [curating, setCurating] = useState<string | null>(null);
  const [addModal, setAddModal] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    const cats = await fetchSelectionsForProject(projectId);
    setCategories(cats);
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const summary = useMemo(() => summarizeAllowances(categories), [categories]);

  const handleAddCategory = useCallback(async (input: { category: string; budget: number; styleBrief: string }) => {
    if (!projectId || !input.category.trim() || input.budget <= 0) return;
    const saved = await saveSelectionCategory({
      projectId,
      category: input.category.trim(),
      styleBrief: input.styleBrief.trim(),
      budget: input.budget,
      displayOrder: categories.length,
    });
    if (saved) {
      setCategories(prev => [...prev, saved]);
      setAddModal(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert('Save failed', 'Could not save the category.');
    }
  }, [projectId, categories.length]);

  const handleCurate = useCallback(async (cat: SelectionCategory) => {
    setCurating(cat.id);
    try {
      const { options } = await curateSelectionsAI({
        category: cat.category,
        styleBrief: cat.styleBrief,
        budget: cat.budget,
      });
      if (options.length === 0) {
        Alert.alert('No options', 'AI didn\'t return any options. Try a more specific style brief.');
        return;
      }
      const ok = await saveCuratedOptions(cat.id, options);
      if (!ok) {
        Alert.alert('Save failed', 'Generated options but could not save them.');
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
    } catch (e) {
      Alert.alert('Curation failed', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setCurating(null);
    }
  }, [refresh]);

  const handleChoose = useCallback(async (categoryId: string, option: SelectionOption) => {
    const ok = await chooseSelectionOption(categoryId, option.id, 'gc');
    if (ok) {
      void Haptics.selectionAsync();
      await refresh();
    }
  }, [refresh]);

  const handleDelete = useCallback((cat: SelectionCategory) => {
    Alert.alert(
      `Delete "${cat.category}"?`,
      'This removes the category and all AI-generated options. The homeowner won\'t see it anymore.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteSelectionCategory(cat.id);
            if (ok) {
              setCategories(prev => prev.filter(c => c.id !== cat.id));
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ],
    );
  }, []);

  // Connector: when the homeowner picks an option that exceeds the
  // allowance, the GC needs a clean way to bill the difference. This
  // hands off to the change-order screen with a pre-filled draft so
  // it's a 1-tap "approve + send" instead of manual re-entry.
  const handleDraftCOForOverage = useCallback((cat: SelectionCategory) => {
    if (!projectId) return;
    const chosen = (cat.options ?? []).find(o => o.isChosen);
    if (!chosen) return;
    const overage = Math.max(0, chosen.total - cat.budget);
    if (overage <= 0) return;
    router.push({
      pathname: '/change-order' as any,
      params: {
        projectId,
        prefillReason: 'allowance_overage',
        prefillDescription: `Allowance overage on ${cat.category}: chose ${chosen.productName}${chosen.brand ? ` · ${chosen.brand}` : ''} at ${formatMoney(chosen.total)} (allowance was ${formatMoney(cat.budget)}).`,
        prefillAmount: String(overage),
      },
    });
  }, [projectId, router]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.emptyTitle}>Project not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Selections &amp; Allowances</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)}>
          <Plus size={14} color="#FFF" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Allowance summary */}
      {categories.length > 0 && (
        <View style={styles.summaryStrip}>
          <SummaryStat label="Allowance" value={formatMoney(summary.totalBudget)} />
          <View style={styles.summaryDiv} />
          <SummaryStat label="Chosen" value={formatMoney(summary.totalChosen)} accent={summary.totalChosen > summary.totalBudget ? Colors.error : Colors.text} />
          <View style={styles.summaryDiv} />
          <SummaryStat
            label={summary.totalOver > 0 ? 'Over' : 'Remaining'}
            value={formatMoney(summary.totalOver > 0 ? summary.totalOver : summary.totalBudget - summary.totalChosen)}
            accent={summary.totalOver > 0 ? Colors.error : Colors.success}
          />
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}>
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        )}

        {!loading && categories.length === 0 && (
          <View style={styles.emptyCard}>
            <Sparkles size={28} color={Colors.primary} />
            <Text style={styles.emptyTitle}>Add your first allowance</Text>
            <Text style={styles.emptyBody}>
              Tell us what the homeowner will pick — Kitchen Cabinets, Bathroom Tile, Lighting,
              Appliances. AI generates 4 real-brand options at every budget tier. Homeowner picks
              in their portal.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={() => setAddModal(true)}>
              <Plus size={14} color="#FFF" />
              <Text style={styles.bigCtaText}>Add allowance</Text>
            </TouchableOpacity>
          </View>
        )}

        {categories.map(cat => (
          <CategoryCard
            key={cat.id}
            category={cat}
            curating={curating === cat.id}
            onCurate={() => handleCurate(cat)}
            onChoose={(opt) => handleChoose(cat.id, opt)}
            onDelete={() => handleDelete(cat)}
            onDraftCO={() => handleDraftCOForOverage(cat)}
          />
        ))}
      </ScrollView>

      {/* Add-category modal */}
      <AddCategoryModal
        visible={addModal}
        onClose={() => setAddModal(false)}
        onAdd={handleAddCategory}
      />

      <EstimateLoadingOverlay
        visible={curating !== null}
        title="AI is curating options…"
        subtitle="Searching real products from real brands. Spreading the budget so you have a budget pick, on-target options, and a premium upgrade."
      />
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={[styles.summaryStatValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function CategoryCard({ category, curating, onCurate, onChoose, onDelete, onDraftCO }: {
  category: SelectionCategory;
  curating: boolean;
  onCurate: () => void;
  onChoose: (opt: SelectionOption) => void;
  onDelete: () => void;
  onDraftCO: () => void;
}) {
  const opts = category.options ?? [];
  const chosen = opts.find(o => o.isChosen);
  const isExceeded = category.status === 'exceeded';
  const isChosen   = category.status === 'chosen';

  return (
    <View style={styles.catCard}>
      <View style={styles.catHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.catName}>{category.category}</Text>
          {category.styleBrief ? (
            <Text style={styles.catBrief} numberOfLines={1}>{category.styleBrief}</Text>
          ) : null}
        </View>
        <View style={styles.catBudget}>
          <Text style={styles.catBudgetLabel}>BUDGET</Text>
          <Text style={styles.catBudgetValue}>{formatMoney(category.budget)}</Text>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={6}>
          <Trash2 size={14} color={Colors.error} />
        </TouchableOpacity>
      </View>

      {chosen && (
        <View style={[styles.chosenBanner, isExceeded && { backgroundColor: Colors.error + '0D', borderColor: Colors.error + '30' }]}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            {isExceeded
              ? <AlertTriangle size={14} color={Colors.error} />
              : <CheckCircle2  size={14} color={Colors.success} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.chosenTitle, isExceeded && { color: Colors.error }]}>
                {isExceeded ? 'Over allowance' : 'Chosen'}: {chosen.productName}
              </Text>
              <Text style={styles.chosenSub}>
                {formatMoney(chosen.total)} · picked by {chosen.chosenByRole === 'homeowner' ? 'homeowner' : 'you'}
                {isExceeded && ` · ${formatMoney(chosen.total - category.budget)} over`}
              </Text>
            </View>
          </View>
          {isExceeded && (
            <TouchableOpacity
              style={styles.draftCoCta}
              onPress={onDraftCO}
              testID={`draft-co-${category.id}`}
            >
              <Text style={styles.draftCoCtaText}>Draft a Change Order for the {formatMoney(chosen.total - category.budget)} overage →</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {opts.length === 0 && !curating && (
        <TouchableOpacity style={styles.curateCta} onPress={onCurate}>
          <Sparkles size={16} color="#FFF" />
          <Text style={styles.curateCtaText}>Generate AI options</Text>
        </TouchableOpacity>
      )}

      {opts.length > 0 && (
        <View style={styles.optionsList}>
          {opts.map(o => (
            <OptionRow
              key={o.id}
              option={o}
              budget={category.budget}
              onPress={() => onChoose(o)}
            />
          ))}
          {!isChosen && !isExceeded && (
            <TouchableOpacity style={styles.regenerateBtn} onPress={onCurate}>
              <Sparkles size={12} color={Colors.primary} />
              <Text style={styles.regenerateText}>Regenerate options</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function OptionRow({ option, budget, onPress }: { option: SelectionOption; budget: number; onPress: () => void }) {
  const overBudget = budget > 0 && option.total > budget;
  const tier = option.total <= budget * 0.75 ? 'BUDGET'
             : option.total <= budget * 1.05 ? 'ON TARGET'
             :                                  'PREMIUM';
  const tierColor = tier === 'BUDGET' ? Colors.success : tier === 'ON TARGET' ? Colors.primary : Colors.warning;

  return (
    <TouchableOpacity
      style={[styles.opt, option.isChosen && styles.optChosen, overBudget && !option.isChosen && styles.optOver]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.optHead}>
        <View style={[styles.tierPill, { backgroundColor: tierColor + '15' }]}>
          <Text style={[styles.tierPillText, { color: tierColor }]}>{tier}</Text>
        </View>
        <Text style={styles.optTotal}>{formatMoney(option.total)}</Text>
      </View>
      <Text style={styles.optName}>{option.productName}</Text>
      {option.brand ? <Text style={styles.optBrand}>{option.brand}</Text> : null}
      {option.description ? (
        <Text style={styles.optDesc} numberOfLines={2}>{option.description}</Text>
      ) : null}
      {option.highlights.length > 0 && (
        <View style={styles.highlightsRow}>
          {option.highlights.slice(0, 3).map((h, i) => (
            <View key={i} style={styles.highlight}>
              <Star size={9} color={Colors.warning} />
              <Text style={styles.highlightText}>{h}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.optFoot}>
        {option.supplier ? <View style={styles.optMeta}><Package size={11} color={Colors.textMuted} /><Text style={styles.optMetaText}>{option.supplier}</Text></View> : null}
        {option.leadTimeDays != null ? <View style={styles.optMeta}><Clock size={11} color={Colors.textMuted} /><Text style={styles.optMetaText}>{option.leadTimeDays}d lead time</Text></View> : null}
        {option.productUrl ? <View style={styles.optMeta}><ExternalLink size={11} color={Colors.textMuted} /><Text style={styles.optMetaText}>Link</Text></View> : null}
        {option.isChosen && <View style={styles.chosenPill}><CheckCircle2 size={11} color={Colors.success} /><Text style={styles.chosenPillText}>CHOSEN</Text></View>}
      </View>
    </TouchableOpacity>
  );
}

function AddCategoryModal({ visible, onClose, onAdd }: {
  visible: boolean;
  onClose: () => void;
  onAdd: (input: { category: string; budget: number; styleBrief: string }) => void;
}) {
  const [category, setCategory] = useState('');
  const [budget, setBudget] = useState('');
  const [styleBrief, setStyleBrief] = useState('');

  useEffect(() => {
    if (visible) {
      setCategory(''); setBudget(''); setStyleBrief('');
    }
  }, [visible]);

  const handleAdd = () => {
    const trimmedCat = category.trim();
    const numericBudget = Number(budget);
    if (!trimmedCat) {
      Alert.alert('Category required', 'Pick a category like "Kitchen Cabinets" or "Bath Tile".');
      return;
    }
    if (!isFinite(numericBudget) || numericBudget <= 0) {
      Alert.alert('Allowance required', 'Set an allowance greater than $0 so AI can curate options at the right price point.');
      return;
    }
    onAdd({ category: trimmedCat, budget: numericBudget, styleBrief: styleBrief.trim() });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Add allowance</Text>
          <Text style={styles.modalBody}>
            Pick a category, set the homeowner's allowance, optionally describe the style. AI uses
            it to curate 4 options.
          </Text>

          <Text style={styles.modalLabel}>Category *</Text>
          <TextInput
            style={styles.modalInput}
            value={category}
            onChangeText={setCategory}
            placeholder="e.g. Kitchen Cabinets, Bathroom Tile, Lighting"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.modalLabel}>Allowance budget *</Text>
          <View style={styles.modalAmountField}>
            <DollarSign size={14} color={Colors.textMuted} />
            <TextInput
              style={styles.modalAmountInput}
              value={budget}
              onChangeText={setBudget}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
            />
          </View>

          <Text style={styles.modalLabel}>Style brief (optional)</Text>
          <TextInput
            style={[styles.modalInput, { minHeight: 70 }]}
            value={styleBrief}
            onChangeText={setStyleBrief}
            placeholder='e.g. "modern farmhouse, off-white, soft-close drawers, no inset"'
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, (!category.trim() || !Number(budget) || Number(budget) <= 0) && styles.modalConfirmDisabled]}
              onPress={handleAdd}
              disabled={!category.trim() || !Number(budget) || Number(budget) <= 0}
            >
              <Plus size={14} color="#FFF" />
              <Text style={styles.modalConfirmText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9,
    backgroundColor: Colors.primary,
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  summaryStrip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  summaryStat: { flex: 1 },
  summaryStatLabel: { fontSize: 9, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  summaryStatValue: { fontSize: 16, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  summaryDiv: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border, marginVertical: 4 },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 28,
    alignItems: 'center', gap: 10, marginTop: 22,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, marginTop: 4 },
  emptyBody:  { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  bigCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11,
    backgroundColor: Colors.primary, marginTop: 8,
  },
  bigCtaText: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  catCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12, gap: 12,
  },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catName: { fontSize: 15, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  catBrief: { fontSize: 11, color: Colors.textMuted, marginTop: 2, fontStyle: 'italic' },
  catBudget: { alignItems: 'flex-end' },
  catBudgetLabel: { fontSize: 9, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6 },
  catBudgetValue: { fontSize: 14, fontWeight: '800', color: Colors.text },

  chosenBanner: {
    flexDirection: 'column', gap: 8,
    padding: 12, borderRadius: 10,
    backgroundColor: Colors.success + '0D',
    borderWidth: 1, borderColor: Colors.success + '30',
  },
  chosenTitle: { fontSize: 13, fontWeight: '800', color: Colors.success },
  chosenSub:   { fontSize: 11, color: Colors.text, marginTop: 2 },

  draftCoCta: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: Colors.error + '12',
    borderWidth: 1, borderColor: Colors.error + '40',
  },
  draftCoCtaText: { fontSize: 12, fontWeight: '800', color: Colors.error, letterSpacing: -0.1 },

  curateCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  curateCtaText: { fontSize: 14, fontWeight: '800', color: '#FFF' },

  optionsList: { gap: 8 },
  opt: {
    backgroundColor: Colors.background, borderRadius: 12, padding: 12,
    borderWidth: 1.5, borderColor: Colors.border, gap: 6,
  },
  optChosen: { borderColor: Colors.success, backgroundColor: Colors.success + '08' },
  optOver:   { borderColor: Colors.warning + '60' },
  optHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  tierPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  optTotal: { fontSize: 16, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  optName:  { fontSize: 13, fontWeight: '700', color: Colors.text },
  optBrand: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  optDesc:  { fontSize: 12, color: Colors.text, lineHeight: 17, marginTop: 2 },
  highlightsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  highlight: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: Colors.warning + '0D', borderWidth: 1, borderColor: Colors.warning + '30',
  },
  highlightText: { fontSize: 9, fontWeight: '700', color: Colors.text },
  optFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  optMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  optMetaText: { fontSize: 10, fontWeight: '600', color: Colors.textMuted },
  chosenPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  chosenPillText: { fontSize: 10, fontWeight: '800', color: Colors.success, letterSpacing: 0.4 },

  regenerateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8, borderRadius: 9,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  regenerateText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  modalBody:  { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  modalLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  modalInput: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: Colors.text,
  },
  modalAmountField: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14,
  },
  modalAmountInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: Colors.text },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: Colors.background, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: Colors.primary },
  modalConfirmDisabled: { opacity: 0.45 },
  modalConfirmText: { fontSize: 14, fontWeight: '800', color: '#FFF' },
});
