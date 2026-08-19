// selections — GC-side allowances + AI curation hub. The GC lists the
// categories the homeowner will pick (Kitchen Cabinets, Bathroom Tile,
// Lighting, etc.), sets a budget for each, and taps "Generate AI options".
// Gemini returns 4 real-brand options spread across the budget range;
// homeowner picks one in their portal.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Modal, Image,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, Trash2, DollarSign, Star, ExternalLink,
  CheckCircle2, AlertTriangle, Clock, Package, PenTool,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import {
  fetchSelectionsForProject, saveSelectionCategory, deleteSelectionCategory,
  saveSelectionOption, chooseSelectionOption, curateSelectionsAI,
  saveCuratedOptions, summarizeAllowances,
} from '@/utils/selectionsEngine';
import { resolveSelectionImage } from '@/utils/ogImage';
import { formatMoney } from '@/utils/formatters';
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
import type { SelectionCategory, SelectionOption } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert, showPrompt } from '@/utils/alert';

export default function SelectionsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
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
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      showAlert('Save failed', 'Could not save the category.');
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
        showAlert('No options', 'AI didn\'t return any options. Try a more specific style brief.');
        return;
      }
      // Resolve a product photo for each option (og:image from the AI's product
      // link, Pexels keyword fallback). Non-fatal — null just leaves it photo-less.
      const withImages = await Promise.all(options.map(async (o) => ({
        ...o,
        imageUrl: await resolveSelectionImage({ url: o.productUrl, query: `${o.brand} ${o.productName} ${cat.category}`.trim() }),
      })));
      const ok = await saveCuratedOptions(cat.id, withImages);
      if (!ok) {
        showAlert('Save failed', 'Generated options but could not save them.');
        return;
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
    } catch (e) {
      showAlert('Curation failed', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setCurating(null);
    }
  }, [refresh]);

  // Manual override: GC pastes a product URL and we pull its og:image.
  // iOS-only (Alert.prompt is iOS-only); other platforms re-curate to refresh.
  const onSetOptionPhoto = useCallback((option: SelectionOption, category: string) => {
    if (Platform.OS !== 'ios') {
      showAlert('Paste a link', 'Setting a photo from a link is available on iOS. On other platforms, re-curate to refresh photos.');
      return;
    }
    showPrompt('Set photo from link', "Paste the product page URL — we'll pull its photo.", async (url?: string) => {
      if (!url || !url.trim()) return;
      const imageUrl = await resolveSelectionImage({ url: url.trim() });
      if (!imageUrl) { showAlert('No image found', "Couldn't find a photo at that link."); return; }
      await saveSelectionOption({ id: option.id, categoryId: option.categoryId, productName: option.productName, unitPrice: option.unitPrice, productUrl: url.trim(), imageUrl });
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      await refresh();
    }, 'plain-text');
  }, [refresh]);

  const handleChoose = useCallback(async (categoryId: string, option: SelectionOption) => {
    const ok = await chooseSelectionOption(categoryId, option.id, 'gc');
    if (ok) {
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      await refresh();
    }
  }, [refresh]);

  const handleDelete = useCallback((cat: SelectionCategory) => {
    showAlert(
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
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon={<PenTool size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No selections set up yet"
          message="Selections live inside a project so each allowance ties back to the contract. To open one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Selections in the project tile grid.',
            'Add categories (kitchen tile, lighting, etc.), set allowances, and let AI curate options for the homeowner.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Selections & Allowances</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)}>
          <Plus size={14} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Allowance summary */}
      {categories.length > 0 && (
        <View style={styles.summaryStrip}>
          <SummaryStat label="Allowance" value={formatMoney(summary.totalBudget)} />
          <View style={styles.summaryDiv} />
          <SummaryStat label="Chosen" value={formatMoney(summary.totalChosen)} accent={summary.totalChosen > summary.totalBudget ? themeColors.danger : themeColors.text} />
          <View style={styles.summaryDiv} />
          <SummaryStat
            label={summary.totalOver > 0 ? 'Over' : 'Remaining'}
            value={formatMoney(summary.totalOver > 0 ? summary.totalOver : summary.totalBudget - summary.totalChosen)}
            accent={summary.totalOver > 0 ? themeColors.danger : themeColors.success}
          />
        </View>
      )}

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={themeColors.accent} />
          </View>
        )}

        {!loading && categories.length === 0 && (
          <View style={styles.emptyCard}>
            <MageAIMark size={28} color={themeColors.accent} />
            <Text style={styles.emptyTitle}>Add your first allowance</Text>
            <Text style={styles.emptyBody}>
              Tell us what the homeowner will pick — Kitchen Cabinets, Bathroom Tile, Lighting,
              Appliances. AI generates 4 real-brand options at every budget tier. Homeowner picks
              in their portal.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={() => setAddModal(true)}>
              <Plus size={14} color="#FFF" strokeWidth={1.75} />
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
            onSetOptionPhoto={onSetOptionPhoto}
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={[styles.summaryStatValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function CategoryCard({ category, curating, onCurate, onChoose, onDelete, onDraftCO, onSetOptionPhoto }: {
  category: SelectionCategory;
  curating: boolean;
  onCurate: () => void;
  onChoose: (opt: SelectionOption) => void;
  onDelete: () => void;
  onDraftCO: () => void;
  onSetOptionPhoto: (option: SelectionOption, category: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <TouchableOpacity onPress={onDelete} hitSlop={6} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
      </View>

      {chosen && (
        <View style={[styles.chosenBanner, isExceeded && { backgroundColor: themeColors.danger + '0D', borderColor: themeColors.danger + '30' }]}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            {isExceeded
              ? <AlertTriangle size={14} color={themeColors.danger} strokeWidth={1.75} />
              : <CheckCircle2  size={14} color={themeColors.success} strokeWidth={1.75} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.chosenTitle, isExceeded && { color: themeColors.danger }]}>
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
          <MageAIMark size={16} color="#FFF" />
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
              onSetPhoto={() => onSetOptionPhoto(o, category.category)}
            />
          ))}
          {!isChosen && !isExceeded && (
            <TouchableOpacity style={styles.regenerateBtn} onPress={onCurate}>
              <MageAIMark size={12} color={themeColors.accent} />
              <Text style={styles.regenerateText}>Regenerate options</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function OptionRow({ option, budget, onPress, onSetPhoto }: { option: SelectionOption; budget: number; onPress: () => void; onSetPhoto: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const overBudget = budget > 0 && option.total > budget;
  const tier = option.total <= budget * 0.75 ? 'BUDGET'
             : option.total <= budget * 1.05 ? 'ON TARGET'
             :                                  'PREMIUM';
  const tierColor = tier === 'BUDGET' ? themeColors.success : tier === 'ON TARGET' ? themeColors.accent : Colors.warning;

  return (
    <TouchableOpacity
      style={[styles.opt, option.isChosen && styles.optChosen, overBudget && !option.isChosen && styles.optOver]}
      onPress={onPress}
      onLongPress={onSetPhoto}
      activeOpacity={0.85}
    >
      {option.imageUrl ? (
        <Image source={{ uri: option.imageUrl }} style={styles.optImage} resizeMode="cover" />
      ) : null}
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
              <Star size={9} color={Colors.warning} strokeWidth={1.75} />
              <Text style={styles.highlightText}>{h}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.optFoot}>
        {option.supplier ? <View style={styles.optMeta}><Package size={11} color={themeColors.textMuted} strokeWidth={1.75} /><Text style={styles.optMetaText}>{option.supplier}</Text></View> : null}
        {option.leadTimeDays != null ? <View style={styles.optMeta}><Clock size={11} color={themeColors.textMuted} strokeWidth={1.75} /><Text style={styles.optMetaText}>{option.leadTimeDays}d lead time</Text></View> : null}
        {option.productUrl ? <View style={styles.optMeta}><ExternalLink size={11} color={themeColors.textMuted} strokeWidth={1.75} /><Text style={styles.optMetaText}>Link</Text></View> : null}
        {option.isChosen && <View style={styles.chosenPill}><CheckCircle2 size={11} color={themeColors.success} strokeWidth={1.75} /><Text style={styles.chosenPillText}>CHOSEN</Text></View>}
      </View>
    </TouchableOpacity>
  );
}

function AddCategoryModal({ visible, onClose, onAdd }: {
  visible: boolean;
  onClose: () => void;
  onAdd: (input: { category: string; budget: number; styleBrief: string }) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
      showAlert('Category required', 'Pick a category like "Kitchen Cabinets" or "Bath Tile".');
      return;
    }
    if (!isFinite(numericBudget) || numericBudget <= 0) {
      showAlert('Allowance required', 'Set an allowance greater than $0 so AI can curate options at the right price point.');
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
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.modalLabel}>Allowance budget *</Text>
          <View style={styles.modalAmountField}>
            <DollarSign size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <TextInput
              style={styles.modalAmountInput}
              value={budget}
              onChangeText={setBudget}
              placeholder="0"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="numeric"
            />
          </View>

          <Text style={styles.modalLabel}>Style brief (optional)</Text>
          <TextInput
            style={[styles.modalInput, { minHeight: 70 }]}
            value={styleBrief}
            onChangeText={setStyleBrief}
            placeholder='e.g. "modern farmhouse, off-white, soft-close drawers, no inset"'
            placeholderTextColor={themeColors.textMuted}
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
              <Plus size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.modalConfirmText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9,
    backgroundColor: t.accentFill,
  },
  addBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },

  summaryStrip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
    backgroundColor: t.surface,
  },
  summaryStat: { flex: 1 },
  summaryStatLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  summaryStatValue: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.3 },
  summaryDiv: { width: 1, alignSelf: 'stretch', backgroundColor: t.line, marginVertical: 4 },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 10, marginTop: 22,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody:  { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  bigCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11,
    backgroundColor: t.accentFill, marginTop: 8,
  },
  bigCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '800' },

  catCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12, gap: 12,
  },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catName: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  catBrief: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2, fontStyle: 'italic' },
  catBudget: { alignItems: 'flex-end' },
  catBudgetLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6 },
  catBudgetValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text },

  chosenBanner: {
    flexDirection: 'column', gap: 8,
    padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.success + '0D',
    borderWidth: 1, borderColor: t.success + '30',
  },
  chosenTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.success },
  chosenSub:   { fontSize: Type.caption2.fontSize, color: t.text, marginTop: 2 },

  draftCoCta: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: Tokens.radius.sm,
    backgroundColor: t.danger + '12',
    borderWidth: 1, borderColor: t.danger + '40',
  },
  draftCoCtaText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.danger, letterSpacing: -0.1 },

  curateCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.accentFill,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  curateCtaText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },

  optionsList: { gap: 8 },
  opt: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.card, padding: 12,
    borderWidth: 1.5, borderColor: t.line, gap: 6,
  },
  optImage: { width: '100%', height: 130, borderRadius: 10, marginBottom: 8, backgroundColor: t.surfaceAlt },
  optChosen: { borderColor: t.success, backgroundColor: t.success + '08' },
  optOver:   { borderColor: Colors.warning + '60' },
  optHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full },
  tierPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  optTotal: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  optName:  { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  optBrand: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },
  optDesc:  { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17, marginTop: 2 },
  highlightsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  highlight: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.warning + '0D', borderWidth: 1, borderColor: Colors.warning + '30',
  },
  highlightText: { fontSize: 9, fontWeight: '700', color: t.text },
  optFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  optMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  optMetaText: { fontSize: 10, fontWeight: '600', color: t.textMuted },
  chosenPill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  chosenPillText: { fontSize: 10, fontWeight: '800', color: t.success, letterSpacing: 0.4 },

  regenerateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8, borderRadius: 9,
    borderWidth: 1, borderColor: t.line, borderStyle: 'dashed',
  },
  regenerateText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 10 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text },
  modalBody:  { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 18 },
  modalLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  modalInput: {
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  modalAmountField: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.bg, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 14,
  },
  modalAmountInput: { flex: 1, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: t.bg, alignItems: 'center', borderWidth: 1, borderColor: t.line },
  modalCancelText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: t.accentFill },
  modalConfirmDisabled: { opacity: 0.45 },
  modalConfirmText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
});
