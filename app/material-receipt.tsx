// material-receipt.tsx — snap a supplier invoice, get costed line items, feed
// your price book.
//
// The GC photographs a lumber-yard / supply-house invoice; MAGE vision reads
// the line items (analyze-photos task 'receipt'), the GC reviews/edits the
// numbers, and on save the per-unit prices flow into the personal Cost Database
// (utils/costDatabase) — so the next estimate is priced off what materials
// ACTUALLY cost. Optionally links to a purchase-order Commitment for per-PO
// spend tracking.
//
// Pure normalization/recompute in utils/materialReceipt; the single AI call
// routes through utils/photoAnalyzer (analyzeReceipt). Persistence is the
// local-first useMaterialReceipts hook.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, ImagePlus, Receipt, Trash2, Check, AlertTriangle, BookOpen,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import Paywall from '@/components/Paywall';
import { analyzeReceipt } from '@/utils/photoAnalyzer';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import {
  normalizeExtraction, receiptLinesTotal, reconcile, receiptToCostSamples,
} from '@/utils/materialReceipt';
import { formatMoney, formatMoneyFull } from '@/utils/jobCostEngine';
import type { MaterialReceipt, MaterialReceiptLine } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Colors } from '@/constants/colors';
import { showAlert } from '@/utils/alert';
import { track, AnalyticsEvents } from '@/utils/analytics';

export default function MaterialReceiptScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return <Paywall visible feature="Material Receipt Capture" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <MaterialReceiptInner />;
}

function recomputeLine(l: MaterialReceiptLine): MaterialReceiptLine {
  return { ...l, lineTotal: Math.round(l.quantity * l.unitPrice * 100) / 100 };
}

function MaterialReceiptInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; commitmentId?: string }>();
  const { projects, getProject, getCommitmentsForProject } = useProjects();
  const { tier } = useSubscription();
  const { addReceipt, getReceiptsForProject } = useMaterialReceipts();

  // Default the project from params, else the most recent project.
  const initialProjectId = params.projectId ?? projects[0]?.id ?? '';
  const [projectId, setProjectId] = useState(initialProjectId);
  const [commitmentId, setCommitmentId] = useState<string | undefined>(params.commitmentId);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MaterialReceipt | null>(null);
  const [saved, setSaved] = useState(false);

  const project = projectId ? getProject(projectId) : null;
  const poCommitments = useMemo(
    () => (projectId ? getCommitmentsForProject(projectId).filter(c => c.type === 'purchase_order') : []),
    [projectId, getCommitmentsForProject],
  );
  const existing = useMemo(
    () => (projectId ? getReceiptsForProject(projectId) : []),
    [projectId, getReceiptsForProject],
  );

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { showAlert('Camera access needed', 'Grant camera access in Settings.'); return; }
        const res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
        if (res.canceled || !res.assets[0]) return;
        setImageUri(res.assets[0].uri);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { showAlert('Photo access needed', 'Grant photo access in Settings.'); return; }
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 });
        if (res.canceled || !res.assets[0]) return;
        setImageUri(res.assets[0].uri);
      }
      setDraft(null);
      setError(null);
      setSaved(false);
    } catch (e) {
      setError(`Couldn't open the ${source}: ${String((e as Error).message ?? e)}`);
    }
  }, []);

  const extract = useCallback(async () => {
    if (!imageUri || busy) return;
    if (!projectId) { showAlert('Pick a project', 'Choose which project this material is for.'); return; }
    const limit = await checkAILimit(tier, 'smart', 'photoAnalysis');
    if (!limit.allowed) { showAILimitAlert({ limit, router, monthly: true }); return; }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setBusy(true);
    setError(null);
    try {
      const { data } = await analyzeReceipt({ photoUrls: [imageUri], projectName: project?.name });
      await recordAIUsage('smart', 'photoAnalysis');
      const normalized = normalizeExtraction(data, { projectId, commitmentId, imageUri });
      if (normalized.lines.length === 0) {
        setError("MAGE couldn't read any line items — make sure the whole invoice is in frame and legible, then retry.");
        setDraft(null);
        return;
      }
      setDraft(normalized);
    } catch (e) {
      setError(`Extraction failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }, [imageUri, busy, projectId, commitmentId, tier, router, project?.name]);

  // ── Draft edits ──────────────────────────────────────────────
  const patchDraft = useCallback((updates: Partial<MaterialReceipt>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      next.subtotal = receiptLinesTotal(next);
      return next;
    });
  }, []);

  const patchLine = useCallback((id: string, updates: Partial<MaterialReceiptLine>) => {
    setDraft(prev => {
      if (!prev) return prev;
      const lines = prev.lines.map(l => (l.id === id ? recomputeLine({ ...l, ...updates }) : l));
      const subtotal = Math.round(lines.reduce((a, l) => a + l.lineTotal, 0) * 100) / 100;
      return { ...prev, lines, subtotal };
    });
  }, []);

  const removeLine = useCallback((id: string) => {
    setDraft(prev => {
      if (!prev) return prev;
      const lines = prev.lines.filter(l => l.id !== id);
      const subtotal = Math.round(lines.reduce((a, l) => a + l.lineTotal, 0) * 100) / 100;
      return { ...prev, lines, subtotal };
    });
  }, []);

  const sampleCount = useMemo(
    () => (draft ? receiptToCostSamples(draft, project?.name ?? 'Project').length : 0),
    [draft, project?.name],
  );

  const save = useCallback(() => {
    if (!draft) return;
    if (draft.lines.length === 0) { showAlert('Nothing to save', 'Add at least one line item.'); return; }
    const toSave: MaterialReceipt = {
      ...draft,
      projectId,
      commitmentId,
      status: 'reviewed',
      updatedAt: new Date().toISOString(),
    };
    addReceipt(toSave);
    track(AnalyticsEvents.MATERIAL_RECEIPT_SAVED, {
      item_count: draft.lines.length,
      source: 'material_receipt',
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
    setDraft(null);
    setImageUri(null);
  }, [draft, projectId, commitmentId, addReceipt]);

  const recon = draft ? reconcile(draft) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Material Receipt · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Snap a supplier invoice'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Project picker (only when not pinned by params or multiple projects) */}
        {projects.length > 1 && (
          <View style={styles.pickerWrap}>
            <Text style={styles.pickerLabel}>Project</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {projects.map(p => (
                <TouchableOpacity key={p.id} onPress={() => { setProjectId(p.id); setCommitmentId(undefined); }} style={[styles.chip, projectId === p.id && styles.chipOn]}>
                  <Text style={[styles.chipText, projectId === p.id && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Capture */}
        {imageUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
            <TouchableOpacity style={styles.retake} onPress={() => { setImageUri(null); setDraft(null); }} hitSlop={8}>
              <Text style={styles.retakeText}>Replace</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.captureRow}>
            <TouchableOpacity style={styles.captureBtn} onPress={() => pickImage('camera')} activeOpacity={0.85}>
              <Camera size={22} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.captureText}>Snap invoice</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureBtn} onPress={() => pickImage('library')} activeOpacity={0.85}>
              <ImagePlus size={22} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.captureText}>From library</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Extract CTA */}
        {imageUri && !draft && (
          <TouchableOpacity style={[styles.aiBtn, busy && { opacity: 0.7 }]} onPress={extract} disabled={busy} activeOpacity={0.85} testID="receipt-extract">
            {busy ? <ActivityIndicator size="small" color="#FFF" /> : <MageAIMark size={16} color="#FFF" />}
            <Text style={styles.aiBtnText}>{busy ? 'Reading the invoice…' : 'Extract line items'}</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.warn}>
            <AlertTriangle size={15} color={t.danger} strokeWidth={1.75} />
            <Text style={styles.warnText}>{error}</Text>
          </View>
        )}

        {saved && !draft && (
          <View style={[styles.warn, { backgroundColor: t.success + '14' }]}>
            <Check size={15} color={t.success} strokeWidth={1.75} />
            <Text style={[styles.warnText, { color: t.text }]}>Saved. The prices fed your Cost Database — snap another or head back.</Text>
          </View>
        )}

        {/* Draft review */}
        {draft && (
          <View style={styles.draftWrap}>
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Vendor</Text>
                <TextInput value={draft.vendor} onChangeText={v => patchDraft({ vendor: v })} style={styles.field} placeholder="Supplier" placeholderTextColor={t.textMuted} />
              </View>
              <View style={{ width: 120 }}>
                <Text style={styles.fieldLabel}>Date</Text>
                <TextInput value={draft.receiptDate ?? ''} onChangeText={v => patchDraft({ receiptDate: v })} style={styles.field} placeholder="YYYY-MM-DD" placeholderTextColor={t.textMuted} />
              </View>
            </View>

            {/* PO link */}
            {poCommitments.length > 0 && (
              <View style={styles.pickerWrap}>
                <Text style={styles.pickerLabel}>Link to PO (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity onPress={() => setCommitmentId(undefined)} style={[styles.chip, !commitmentId && styles.chipOn]}>
                    <Text style={[styles.chipText, !commitmentId && styles.chipTextOn]}>None</Text>
                  </TouchableOpacity>
                  {poCommitments.map(c => (
                    <TouchableOpacity key={c.id} onPress={() => setCommitmentId(c.id)} style={[styles.chip, commitmentId === c.id && styles.chipOn]}>
                      <Text style={[styles.chipText, commitmentId === c.id && styles.chipTextOn]} numberOfLines={1}>{c.number || c.description || 'PO'}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={styles.sectionTitle}>Line items</Text>
            {draft.lines.map(l => (
              <View key={l.id} style={styles.lineCard}>
                <View style={styles.lineTop}>
                  <TextInput value={l.description} onChangeText={v => patchLine(l.id, { description: v })} style={[styles.field, styles.lineDesc]} placeholder="Item" placeholderTextColor={t.textMuted} />
                  <TouchableOpacity onPress={() => removeLine(l.id)} hitSlop={8} style={styles.lineDel}>
                    <Trash2 size={15} color={t.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <TextInput value={l.category ?? ''} onChangeText={v => patchLine(l.id, { category: v })} style={[styles.field, styles.lineCat]} placeholder="Category (e.g. Framing)" placeholderTextColor={t.textMuted} />
                <View style={styles.lineNums}>
                  <View style={styles.numCol}>
                    <Text style={styles.numLabel}>Qty</Text>
                    <TextInput value={String(l.quantity)} onChangeText={v => patchLine(l.id, { quantity: Number(v.replace(/[^0-9.]/g, '')) || 0 })} keyboardType="decimal-pad" style={styles.numField} />
                  </View>
                  <View style={styles.numCol}>
                    <Text style={styles.numLabel}>Unit</Text>
                    <TextInput value={l.unit} onChangeText={v => patchLine(l.id, { unit: v })} style={styles.numField} />
                  </View>
                  <View style={styles.numCol}>
                    <Text style={styles.numLabel}>$/unit</Text>
                    <TextInput value={String(l.unitPrice)} onChangeText={v => patchLine(l.id, { unitPrice: Number(v.replace(/[^0-9.]/g, '')) || 0 })} keyboardType="decimal-pad" style={styles.numField} />
                  </View>
                  <View style={[styles.numCol, { alignItems: 'flex-end' }]}>
                    <Text style={styles.numLabel}>Total</Text>
                    <Text style={styles.lineTotal}>{formatMoneyFull(l.lineTotal)}</Text>
                  </View>
                </View>
              </View>
            ))}

            {/* Totals + reconcile */}
            <View style={styles.totalsCard}>
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Lines subtotal</Text><Text style={styles.totalVal}>{formatMoneyFull(receiptLinesTotal(draft))}</Text></View>
              {draft.tax != null && <View style={styles.totalRow}><Text style={styles.totalLabel}>Tax</Text><Text style={styles.totalVal}>{formatMoneyFull(draft.tax)}</Text></View>}
              <View style={styles.totalRow}><Text style={[styles.totalLabel, { fontWeight: '800' }]}>Invoice total</Text><Text style={[styles.totalVal, { fontWeight: '800' }]}>{formatMoneyFull(draft.total)}</Text></View>
              {recon && !recon.ok && (
                <Text style={styles.reconWarn}>Heads up: the lines add to {formatMoney(recon.linesTotal)} but the invoice shows {formatMoney(recon.printedTotal)} — check for a missed line.</Text>
              )}
            </View>

            <View style={styles.priceBookNote}>
              <BookOpen size={14} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.priceBookText}>Saving feeds <Text style={{ fontWeight: '800', color: t.text }}>{sampleCount}</Text> price{sampleCount === 1 ? '' : 's'} into your Cost Database.</Text>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.85} testID="receipt-save">
              <Check size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.saveBtnText}>Save receipt</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Existing receipts for this project */}
        {!draft && existing.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <Text style={styles.sectionTitle}>Logged for {project?.name ?? 'this project'}</Text>
            {existing.map(r => (
              <View key={r.id} style={styles.histCard}>
                <Receipt size={16} color={t.textSecondary} strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.histVendor} numberOfLines={1}>{r.vendor}</Text>
                  <Text style={styles.histMeta}>{r.lines.length} item{r.lines.length === 1 ? '' : 's'}{r.receiptDate ? ` · ${r.receiptDate}` : ''}</Text>
                </View>
                <Text style={styles.histTotal}>{formatMoney(receiptLinesTotal(r))}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  pickerWrap: { marginBottom: 14 },
  pickerLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, maxWidth: 180 },
  chipOn: { backgroundColor: t.accent + '1A', borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  chipTextOn: { color: t.accent },

  captureRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 12 },
  captureBtn: {
    flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line,
    paddingVertical: 26,
  },
  captureText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  previewWrap: { marginBottom: 12, borderRadius: Tokens.radius.panel, overflow: 'hidden' as const, position: 'relative' as const },
  preview: { width: '100%' as const, height: 220, backgroundColor: t.surface },
  retake: { position: 'absolute' as const, top: 10, right: 10, backgroundColor: '#000000AA', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.full },
  retakeText: { color: Colors.textOnAccent, fontSize: Type.caption1.fontSize, fontWeight: '700' as const },

  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 14, marginBottom: 8,
  },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  warn: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, backgroundColor: t.danger + '14', borderRadius: Tokens.radius.card, padding: 12, marginBottom: 12, marginTop: 4 },
  warnText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  draftWrap: { marginTop: 6 },
  fieldRow: { flexDirection: 'row' as const, gap: 10, marginBottom: 12 },
  fieldLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '600' as const, marginBottom: 4 },
  field: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 10, paddingVertical: 9, fontSize: Type.subhead.fontSize, color: t.text,
  },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 4 },

  lineCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 10, marginBottom: 8, gap: 7 },
  lineTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  lineDesc: { flex: 1 },
  lineDel: { width: 32, height: 32, alignItems: 'center' as const, justifyContent: 'center' as const },
  lineCat: { paddingVertical: 7, fontSize: Type.caption1.fontSize },
  lineNums: { flexDirection: 'row' as const, gap: 8, alignItems: 'flex-end' as const },
  numCol: { flex: 1 },
  numLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginBottom: 3 },
  numField: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.xs, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 8, paddingVertical: 7, fontSize: Type.footnote.fontSize, color: t.text,
  },
  lineTotal: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text, paddingVertical: 7 },

  totalsCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 14, marginTop: 4, gap: 6 },
  totalRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  totalLabel: { fontSize: Type.subhead.fontSize, color: t.textSecondary },
  totalVal: { fontSize: Type.subhead.fontSize, color: t.text, fontWeight: '600' as const },
  reconWarn: { fontSize: Type.caption1.fontSize, color: t.accentHot, lineHeight: 17, marginTop: 4 },

  priceBookNote: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, marginTop: 12, marginBottom: 8 },
  priceBookText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  saveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.success, borderRadius: Tokens.radius.card, paddingVertical: 14, marginTop: 4,
  },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  histCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 8 },
  histVendor: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  histMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },
  histTotal: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
});
