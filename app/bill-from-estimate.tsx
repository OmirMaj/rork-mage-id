import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ClipboardList, ArrowRight, CheckCircle2, Circle, Info, Percent, DollarSign,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Invoice, InvoiceLineItem, LinkedEstimateItem, MaterialLineItem } from '@/types';

/**
 * Bill from Estimate — generates a progress/full invoice from a project's
 * estimate instead of starting from a blank form.
 *
 * Why this screen exists:
 * Previously the invoice screen opened as an empty editor and the user had to
 * decide what to bill for from memory. For projects with an estimate that's
 * silly — the contract value IS the estimate, and invoices should draw down
 * against it. This screen shows each estimate line item with how much has
 * already been billed (summed across prior invoices), how much is remaining,
 * and a "bill this round" input. The resulting draft invoice opens in the
 * standard /invoice editor for any final edits before sending.
 *
 * Match strategy: we use `sourceEstimateItemId` when present (set by this
 * screen on every line it creates) and fall back to a name match for legacy
 * invoice line items created before this flow existed.
 */

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function money(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

type EstimateRowSource =
  | { kind: 'linked'; item: LinkedEstimateItem }
  | { kind: 'legacy'; item: MaterialLineItem };

interface Row {
  key: string;                 // stable match key (materialId or name)
  name: string;
  category: string;
  unit: string;
  quantity: number;            // full contracted qty
  unitPrice: number;           // effective price used for invoice line total
  lineTotal: number;           // full contract line value
  alreadyBilled: number;       // $ already invoiced against this row
  remaining: number;           // $ still to bill
  billPercent: number;         // 0-100, percent of REMAINING user wants to bill
}

export default function BillFromEstimateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, type } = useLocalSearchParams<{ projectId: string; type?: string }>();
  const { getProject, getInvoicesForProject, addInvoice, settings } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingInvoices = useMemo(() => getInvoicesForProject(projectId ?? ''), [projectId, getInvoicesForProject]);
  const nextInvoiceNumber = existingInvoices.length + 1;
  const isProgressDefault = type === 'progress';

  // Build source rows from the linked (new-style) estimate first, then fall
  // back to the legacy Project.estimate.materials if the project pre-dates the
  // linked-estimate model.
  const sources: EstimateRowSource[] = useMemo(() => {
    if (!project) return [];
    if (project.linkedEstimate && project.linkedEstimate.items.length > 0) {
      return project.linkedEstimate.items.map(item => ({ kind: 'linked' as const, item }));
    }
    if (project.estimate && project.estimate.materials.length > 0) {
      return project.estimate.materials.map(item => ({ kind: 'legacy' as const, item }));
    }
    return [];
  }, [project]);

  // For each estimate row, compute how much has ALREADY been billed across
  // existing invoices. Prefer `sourceEstimateItemId` for a clean match;
  // otherwise fall back to a name match so invoices created before this flow
  // existed are still accounted for.
  const rows: Row[] = useMemo(() => {
    return sources.map(src => {
      if (src.kind === 'linked') {
        const item = src.item;
        const key = item.materialId || item.name;
        const effectivePrice = item.usesBulk ? item.bulkPrice : item.unitPrice;
        const full = item.lineTotal;
        const already = existingInvoices
          .filter(inv => inv.status !== 'draft')
          .flatMap(inv => inv.lineItems)
          .filter(li => li.sourceEstimateItemId
            ? li.sourceEstimateItemId === key
            : li.name === item.name)
          .reduce((sum, li) => sum + li.total, 0);
        const remaining = Math.max(0, full - already);
        return {
          key,
          name: item.name,
          category: item.category,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: effectivePrice,
          lineTotal: full,
          alreadyBilled: already,
          remaining,
          billPercent: remaining > 0 ? (isProgressDefault ? 30 : 100) : 0,
        };
      }
      const item = src.item;
      const key = item.name; // legacy has no materialId stored at the top-level
      const full = item.totalPrice;
      const already = existingInvoices
        .filter(inv => inv.status !== 'draft')
        .flatMap(inv => inv.lineItems)
        .filter(li => li.sourceEstimateItemId
          ? li.sourceEstimateItemId === key
          : li.name === item.name)
        .reduce((sum, li) => sum + li.total, 0);
      const remaining = Math.max(0, full - already);
      return {
        key,
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: full,
        alreadyBilled: already,
        remaining,
        billPercent: remaining > 0 ? (isProgressDefault ? 30 : 100) : 0,
      };
    });
  }, [sources, existingInvoices, isProgressDefault]);

  const [billPercents, setBillPercents] = useState<Record<string, number>>(
    () => Object.fromEntries(rows.map(r => [r.key, r.billPercent])),
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries(rows.map(r => [r.key, r.remaining > 0])),
  );

  const amountsByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      if (!selected[r.key]) { map[r.key] = 0; continue; }
      const pct = clampPct(billPercents[r.key] ?? 0);
      map[r.key] = Math.round(r.remaining * (pct / 100) * 100) / 100;
    }
    return map;
  }, [rows, selected, billPercents]);

  const subtotal = useMemo(() => Object.values(amountsByKey).reduce((a, b) => a + b, 0), [amountsByKey]);
  const taxRate = settings.taxRate ?? 7.5;
  const taxAmount = subtotal * (taxRate / 100);
  const totalDue = subtotal + taxAmount;

  const applyPreset = useCallback((preset: number) => {
    const next: Record<string, number> = {};
    for (const r of rows) {
      next[r.key] = r.remaining > 0 ? preset : 0;
    }
    setBillPercents(next);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rows]);

  const toggleSelected = useCallback((key: string) => {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const setRowPct = useCallback((key: string, raw: string) => {
    const n = parseFloat(raw);
    setBillPercents(prev => ({ ...prev, [key]: clampPct(Number.isFinite(n) ? n : 0) }));
  }, []);

  const handleCreateDraft = useCallback(() => {
    if (!project || !projectId) return;
    const activeRows = rows.filter(r => selected[r.key] && (amountsByKey[r.key] ?? 0) > 0);
    if (activeRows.length === 0) {
      Alert.alert('Nothing to Bill', 'Select at least one line item and enter a billing percent greater than zero.');
      return;
    }

    const now = new Date().toISOString();
    const lineItems: InvoiceLineItem[] = activeRows.map(r => {
      const pct = clampPct(billPercents[r.key] ?? 0);
      const billAmount = amountsByKey[r.key] ?? 0;
      // Reconstruct a plausible "quantity" for this invoice line. We bill in
      // dollar terms (pct of remaining), so we derive a display quantity by
      // preserving the unit price and dividing — this keeps the PDF
      // quantity × unitPrice = total invariant. When the whole remaining is
      // being billed, this collapses to the original units.
      const qty = r.unitPrice > 0 ? Math.round((billAmount / r.unitPrice) * 1000) / 1000 : 0;
      return {
        id: createId('ili'),
        name: r.name,
        description: `${r.category} · ${pct.toFixed(0)}% of remaining${r.alreadyBilled > 0 ? ` (${money(r.alreadyBilled)} prior)` : ''}`,
        quantity: qty || r.quantity * (pct / 100),
        unit: r.unit,
        unitPrice: r.unitPrice,
        total: billAmount,
        sourceEstimateItemId: r.key,
        billedPercent: pct,
      };
    });

    // Default to "progress" type when any row is partial, else "full".
    const anyPartial = activeRows.some(r => clampPct(billPercents[r.key] ?? 0) < 100);
    const invoiceType: 'full' | 'progress' = isProgressDefault || anyPartial ? 'progress' : 'full';

    const inv: Invoice = {
      id: createId('inv'),
      number: nextInvoiceNumber,
      projectId,
      type: invoiceType,
      progressPercent: invoiceType === 'progress'
        ? Math.round((subtotal / (rows.reduce((s, r) => s + r.lineTotal, 0) || 1)) * 100)
        : undefined,
      issueDate: now,
      dueDate: now, // will be recalculated by the invoice editor from paymentTerms
      paymentTerms: 'net_30',
      notes: '',
      lineItems,
      subtotal,
      taxRate,
      taxAmount,
      totalDue,
      amountPaid: 0,
      status: 'draft',
      payments: [],
      retentionReleased: 0,
      retentionReleases: [],
      createdAt: now,
      updatedAt: now,
    };

    addInvoice(inv);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Replace, not push — user should land on the editor, and Back should
    // take them all the way back to the project detail they came from rather
    // than back to this picker.
    router.replace({ pathname: '/invoice' as any, params: { projectId, invoiceId: inv.id } });
  }, [project, projectId, rows, selected, billPercents, amountsByKey, subtotal, taxRate, taxAmount, totalDue, nextInvoiceNumber, addInvoice, router, isProgressDefault]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Bill from Estimate' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const contractTotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const totalAlreadyBilled = rows.reduce((s, r) => s + r.alreadyBilled, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);

  // No estimate data → explain and give the user a way to still create a
  // blank invoice through the regular editor.
  if (rows.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{
          title: 'Bill from Estimate',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }} />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}>
          <View style={styles.emptyCard}>
            <ClipboardList size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No estimate yet</Text>
            <Text style={styles.emptyBody}>
              This project doesn&apos;t have an estimate with line items. Build one first so invoices draw
              down against the contract value automatically — or create a blank invoice for a
              one-off charge.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.replace({ pathname: '/invoice' as any, params: { projectId, type: isProgressDefault ? 'progress' : 'full' } })}
              activeOpacity={0.85}
              testID="bill-from-estimate-blank-invoice"
            >
              <Text style={styles.primaryBtnText}>Create Blank Invoice</Text>
              <ArrowRight size={16} color={Colors.textOnPrimary} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Bill from Estimate',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 180, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero: contract total vs already billed vs remaining */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{project.name}</Text>
            <Text style={styles.heroTitle}>
              {isProgressDefault ? 'Progress Bill' : 'Invoice'} #{nextInvoiceNumber}
            </Text>
            <View style={styles.heroRow}>
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricLabel}>Contract</Text>
                <Text style={styles.heroMetricValue}>{money(contractTotal)}</Text>
              </View>
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricLabel}>Already billed</Text>
                <Text style={[styles.heroMetricValue, { color: Colors.info }]}>{money(totalAlreadyBilled)}</Text>
              </View>
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricLabel}>Remaining</Text>
                <Text style={[styles.heroMetricValue, { color: Colors.success }]}>{money(totalRemaining)}</Text>
              </View>
            </View>
            {totalAlreadyBilled > 0 && (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${clampPct((totalAlreadyBilled / (contractTotal || 1)) * 100)}%` },
                  ]}
                />
              </View>
            )}
          </View>

          {/* Quick presets — set every row's "bill this round" % in one tap */}
          <View style={styles.presetRow}>
            <Text style={styles.presetLabel}>Quick fill</Text>
            {[25, 50, 75, 100].map(p => (
              <TouchableOpacity
                key={p}
                style={styles.presetBtn}
                onPress={() => applyPreset(p)}
                activeOpacity={0.7}
                testID={`preset-${p}`}
              >
                <Text style={styles.presetBtnText}>{p}%</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.helpBanner}>
            <Info size={14} color={Colors.info} />
            <Text style={styles.helpBannerText}>
              Tap a row to include or exclude it. Enter a percent of the remaining balance you want
              to bill this round — the totals below update live.
            </Text>
          </View>

          {/* Line items */}
          {rows.map(r => {
            const isSelected = selected[r.key];
            const pct = billPercents[r.key] ?? 0;
            const amount = amountsByKey[r.key] ?? 0;
            const isFullyBilled = r.remaining <= 0.009;
            const billedPctOfLine = r.lineTotal > 0 ? (r.alreadyBilled / r.lineTotal) * 100 : 0;
            return (
              <View
                key={r.key}
                style={[
                  styles.rowCard,
                  !isSelected && styles.rowCardInactive,
                  isFullyBilled && styles.rowCardDone,
                ]}
              >
                <TouchableOpacity
                  style={styles.rowHeader}
                  onPress={() => !isFullyBilled && toggleSelected(r.key)}
                  disabled={isFullyBilled}
                  activeOpacity={0.7}
                  testID={`row-toggle-${r.key}`}
                >
                  {isFullyBilled ? (
                    <CheckCircle2 size={18} color={Colors.success} />
                  ) : isSelected ? (
                    <CheckCircle2 size={18} color={Colors.primary} />
                  ) : (
                    <Circle size={18} color={Colors.textMuted} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={2}>{r.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {r.category} · {r.quantity} {r.unit} × {money(r.unitPrice)}
                    </Text>
                  </View>
                  <Text style={styles.rowLineTotal}>{money(r.lineTotal)}</Text>
                </TouchableOpacity>

                {/* Billing status line */}
                <View style={styles.rowStatusLine}>
                  <Text style={styles.rowStatusText}>
                    {isFullyBilled
                      ? 'Fully billed'
                      : `Billed ${money(r.alreadyBilled)} of ${money(r.lineTotal)} (${billedPctOfLine.toFixed(0)}%)`}
                  </Text>
                  <Text style={[styles.rowStatusText, { color: Colors.success }]}>
                    {money(r.remaining)} remaining
                  </Text>
                </View>
                {r.lineTotal > 0 && (
                  <View style={styles.rowProgressTrack}>
                    <View
                      style={[
                        styles.rowProgressFillBilled,
                        { width: `${clampPct(billedPctOfLine)}%` },
                      ]}
                    />
                    {isSelected && !isFullyBilled && (
                      <View
                        style={[
                          styles.rowProgressFillNow,
                          {
                            left: `${clampPct(billedPctOfLine)}%`,
                            width: `${clampPct((amount / r.lineTotal) * 100)}%`,
                          },
                        ]}
                      />
                    )}
                  </View>
                )}

                {/* Per-row "bill this round" control */}
                {isSelected && !isFullyBilled && (
                  <View style={styles.rowControlGrid}>
                    <View style={styles.rowPctCol}>
                      <Text style={styles.rowControlLabel}>Bill this round</Text>
                      <View style={styles.rowPctInputWrap}>
                        <TextInput
                          style={styles.rowPctInput}
                          value={String(pct)}
                          onChangeText={v => setRowPct(r.key, v)}
                          keyboardType="decimal-pad"
                          testID={`row-pct-${r.key}`}
                        />
                        <Percent size={14} color={Colors.textMuted} />
                      </View>
                      <View style={styles.miniPresetRow}>
                        {[25, 50, 100].map(p => (
                          <TouchableOpacity
                            key={p}
                            style={[styles.miniPreset, pct === p && styles.miniPresetActive]}
                            onPress={() => setBillPercents(prev => ({ ...prev, [r.key]: p }))}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.miniPresetText, pct === p && styles.miniPresetTextActive]}>{p}%</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={styles.rowAmtCol}>
                      <Text style={styles.rowControlLabel}>Line amount</Text>
                      <View style={styles.rowAmtWrap}>
                        <DollarSign size={14} color={Colors.success} />
                        <Text style={styles.rowAmtText}>{money(amount).replace('$', '')}</Text>
                      </View>
                      <Text style={styles.rowAmtHint}>
                        {pct.toFixed(0)}% of {money(r.remaining)}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Sticky totals / create button */}
        <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <View style={styles.footerTotals}>
            <View style={styles.footerTotalRow}>
              <Text style={styles.footerTotalLabel}>Subtotal</Text>
              <Text style={styles.footerTotalValue}>{money(subtotal)}</Text>
            </View>
            <View style={styles.footerTotalRow}>
              <Text style={styles.footerTotalLabel}>Tax ({taxRate}%)</Text>
              <Text style={styles.footerTotalValue}>{money(taxAmount)}</Text>
            </View>
            <View style={[styles.footerTotalRow, styles.footerTotalRowBold]}>
              <Text style={styles.footerTotalLabelBold}>Total due</Text>
              <Text style={styles.footerTotalValueBold}>{money(totalDue)}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, subtotal <= 0 && styles.primaryBtnDisabled]}
            onPress={handleCreateDraft}
            disabled={subtotal <= 0}
            activeOpacity={0.85}
            testID="bill-from-estimate-create"
          >
            <Text style={styles.primaryBtnText}>Continue to Invoice</Text>
            <ArrowRight size={16} color={Colors.textOnPrimary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  notFoundText: { fontSize: 16, color: Colors.textSecondary, marginBottom: 12 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  backBtnText: { color: Colors.textOnPrimary, fontWeight: '600' as const },

  hero: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  heroLabel: { fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  heroRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  heroMetric: { flex: 1, backgroundColor: Colors.surfaceAlt, padding: 10, borderRadius: 10 },
  heroMetricLabel: { fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase' as const, marginBottom: 3 },
  heroMetricValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden' as const,
    marginTop: 4,
  },
  progressFill: { height: '100%', backgroundColor: Colors.info, borderRadius: 3 },

  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presetLabel: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' as const, marginRight: 4 },
  presetBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  presetBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '700' as const },

  helpBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start' as const,
    gap: 8,
    backgroundColor: Colors.infoLight,
    padding: 10,
    borderRadius: 10,
  },
  helpBannerText: { flex: 1, fontSize: 12, color: Colors.info, lineHeight: 16 },

  rowCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  rowCardInactive: { opacity: 0.6 },
  rowCardDone: { opacity: 0.55, backgroundColor: Colors.successLight },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  rowMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  rowLineTotal: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },

  rowStatusLine: { flexDirection: 'row', justifyContent: 'space-between' as const },
  rowStatusText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' as const },
  rowProgressTrack: {
    height: 5,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 3,
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  rowProgressFillBilled: {
    position: 'absolute' as const,
    left: 0, top: 0, bottom: 0,
    backgroundColor: Colors.info,
    borderRadius: 3,
  },
  rowProgressFillNow: {
    position: 'absolute' as const,
    top: 0, bottom: 0,
    backgroundColor: Colors.success,
    borderRadius: 3,
  },

  rowControlGrid: { flexDirection: 'row', gap: 10 },
  rowPctCol: { flex: 1 },
  rowAmtCol: { flex: 1 },
  rowControlLabel: { fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase' as const, marginBottom: 6 },
  rowPctInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  rowPctInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    padding: 0,
  },
  miniPresetRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  miniPreset: {
    flex: 1,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  miniPresetActive: { backgroundColor: Colors.primary },
  miniPresetText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' as const },
  miniPresetTextActive: { color: Colors.textOnPrimary },

  rowAmtWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
  },
  rowAmtText: { fontSize: 16, fontWeight: '700' as const, color: Colors.success },
  rowAmtHint: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },

  footer: {
    position: 'absolute' as const,
    left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  footerTotals: { gap: 4 },
  footerTotalRow: { flexDirection: 'row', justifyContent: 'space-between' as const },
  footerTotalRowBold: { borderTopWidth: 1, borderTopColor: Colors.cardBorder, paddingTop: 6, marginTop: 4 },
  footerTotalLabel: { fontSize: 13, color: Colors.textSecondary },
  footerTotalValue: { fontSize: 13, color: Colors.text, fontWeight: '600' as const },
  footerTotalLabelBold: { fontSize: 15, color: Colors.text, fontWeight: '700' as const },
  footerTotalValueBold: { fontSize: 17, color: Colors.text, fontWeight: '700' as const },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryBtnDisabled: { backgroundColor: Colors.textMuted, opacity: 0.5 },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '700' as const },

  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginTop: 6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
});
