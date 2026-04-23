# Invoicing, Change Orders, Cash Flow & Finance


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Billing and financial subsystem. All invoice entry points now route
through the **Bill-from-Estimate** screen rather than starting blank.

- `app/bill-from-estimate.tsx` — NEW. Estimate-driven invoice creation.
  Reads each line item from `project.linkedEstimate`, computes "already
  billed" by summing prior invoice line items matched by
  `sourceEstimateItemId` (with a legacy name-match fallback), and lets the
  user enter a percent-of-remaining per line. Creates a draft invoice and
  `router.replace`s to `/invoice` for final review.
- `app/invoice.tsx` — invoice editor. Receives `sourceEstimateItemId` +
  `billedPercent` from Bill-from-Estimate so lines can be round-tripped.
- `app/change-order.tsx` — change-order editor.
- `app/aia-pay-app.tsx` — AIA G702/G703 pay-application generator.
- `app/cash-flow.tsx`, `app/payment-predictions.tsx`,
  `app/budget-dashboard.tsx`, `app/retention.tsx`, `app/payments.tsx` —
  finance dashboards.
- `utils/` — `cashFlowEngine.ts`, `cashFlowStorage.ts`, `paymentPrediction.ts`,
  `projectFinancials.ts`, `aiaBilling.ts`, `earnedValueEngine.ts`, `stripe.ts`.


## Files in this bundle

- `app/bill-from-estimate.tsx`
- `app/invoice.tsx`
- `app/change-order.tsx`
- `app/aia-pay-app.tsx`
- `app/cash-flow.tsx`
- `app/payment-predictions.tsx`
- `app/budget-dashboard.tsx`
- `app/retention.tsx`
- `app/payments.tsx`
- `components/AIInvoicePredictor.tsx`
- `components/AIChangeOrderImpact.tsx`
- `components/CashFlowSetup.tsx`
- `components/CashFlowChart.tsx`
- `components/CashFlowAlerts.tsx`
- `utils/cashFlowEngine.ts`
- `utils/cashFlowStorage.ts`
- `utils/paymentPrediction.ts`
- `utils/projectFinancials.ts`
- `utils/aiaBilling.ts`
- `utils/earnedValueEngine.ts`
- `utils/stripe.ts`


---

### `app/bill-from-estimate.tsx`

```tsx
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

```


---

### `app/invoice.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Share, Clipboard,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Trash2, X, Send, CreditCard, Check, BookUser, User, Percent, Unlock, FileSpreadsheet,
  Link2, Copy, Share2, Zap,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AIInvoicePredictor from '@/components/AIInvoicePredictor';
import ContactPickerModal from '@/components/ContactPickerModal';
import { generateInvoicePDF, generateInvoicePDFUri } from '@/utils/pdfGenerator';
import * as Sharing from 'expo-sharing';
import PDFPreSendSheet from '@/components/PDFPreSendSheet';
import type { PDFSendOptions } from '@/components/PDFPreSendSheet';
import { sendEmail, buildInvoiceEmailHtml } from '@/utils/emailService';
import { getEffectiveInvoiceStatus, getDaysPastDue } from '@/utils/projectFinancials';
import { createPaymentLink } from '@/utils/stripe';
import type { InvoiceLineItem, Invoice, PaymentTerms, PaymentMethod, InvoicePayment, RetentionRelease } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: 'due_on_receipt', label: 'Due on Receipt' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
];

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
];

function getDueDate(issueDate: string, terms: PaymentTerms): string {
  const date = new Date(issueDate);
  switch (terms) {
    case 'net_15': date.setDate(date.getDate() + 15); break;
    case 'net_30': date.setDate(date.getDate() + 30); break;
    case 'net_45': date.setDate(date.getDate() + 45); break;
    case 'due_on_receipt': break;
  }
  return date.toISOString();
}

export default function InvoiceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, invoiceId, type: invoiceType } = useLocalSearchParams<{
    projectId: string; invoiceId?: string; type?: string;
  }>();
  const {
    getProject, getInvoicesForProject, addInvoice, updateInvoice, settings, updateSettings,
    getChangeOrdersForProject, contacts, invoices: allInvoices,
  } = useProjects();
  const { tier } = useSubscription();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingInvoices = useMemo(() => getInvoicesForProject(projectId ?? ''), [projectId, getInvoicesForProject]);
  const existingInvoice = useMemo(() => invoiceId ? existingInvoices.find(i => i.id === invoiceId) : null, [invoiceId, existingInvoices]);
  const approvedCOs = useMemo(() => {
    return getChangeOrdersForProject(projectId ?? '').filter(co => co.status === 'approved');
  }, [projectId, getChangeOrdersForProject]);

  const contractTotal = useMemo(() => {
    if (!project) return 0;
    let base = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
    approvedCOs.forEach(co => { base += co.changeAmount; });
    return base;
  }, [project, approvedCOs]);

  const nextInvoiceNumber = useMemo(() => {
    if (existingInvoice) return existingInvoice.number;
    return existingInvoices.length + 1;
  }, [existingInvoices, existingInvoice]);

  const isProgressType = (invoiceType === 'progress') || (existingInvoice?.type === 'progress');

  const initialLineItems = useMemo((): InvoiceLineItem[] => {
    if (existingInvoice) return existingInvoice.lineItems;
    if (!project) return [];
    const linked = project.linkedEstimate;
    if (linked && linked.items.length > 0) {
      return linked.items.map(item => ({
        id: createId('ili'),
        name: item.name,
        description: item.category,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.usesBulk ? item.bulkPrice : item.unitPrice,
        total: item.lineTotal,
      }));
    }
    const legacy = project.estimate;
    if (legacy) {
      return legacy.materials.map(item => ({
        id: createId('ili'),
        name: item.name,
        description: item.category,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        total: item.totalPrice,
      }));
    }
    return [];
  }, [existingInvoice, project]);

  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>(initialLineItems);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(existingInvoice?.paymentTerms ?? 'net_30');
  const [notes, setNotes] = useState(existingInvoice?.notes ?? '');
  const [progressPercent, setProgressPercent] = useState(
    existingInvoice?.progressPercent?.toString() ?? '30'
  );
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('check');
  const [showTermsDropdown, setShowTermsDropdown] = useState(false);
  const [showPDFPreSend, setShowPDFPreSend] = useState(false);
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);
  const [retentionPercent, setRetentionPercent] = useState<string>(
    existingInvoice?.retentionPercent != null ? String(existingInvoice.retentionPercent) : '0'
  );
  const [showRetentionModal, setShowRetentionModal] = useState(false);
  const [retentionReleaseAmount, setRetentionReleaseAmount] = useState('');
  const [retentionReleaseMethod, setRetentionReleaseMethod] = useState<PaymentMethod>('check');
  const [retentionReleaseNote, setRetentionReleaseNote] = useState('');
  const [generatingPayLink, setGeneratingPayLink] = useState(false);

  const pctValue = parseFloat(progressPercent) || 0;
  const retentionPctValue = Math.max(0, Math.min(100, parseFloat(retentionPercent) || 0));

  const subtotal = useMemo(() => {
    const rawTotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    if (isProgressType) return rawTotal * (pctValue / 100);
    return rawTotal;
  }, [lineItems, isProgressType, pctValue]);

  const taxRate = settings.taxRate ?? 7.5;
  const taxAmount = subtotal * (taxRate / 100);
  const totalDue = subtotal + taxAmount;

  const amountPaid = existingInvoice?.amountPaid ?? 0;
  const retentionAmount = useMemo(() => totalDue * (retentionPctValue / 100), [totalDue, retentionPctValue]);
  const retentionReleased = existingInvoice?.retentionReleased ?? 0;
  const retentionPending = Math.max(0, retentionAmount - retentionReleased);
  const netPayable = Math.max(0, totalDue - retentionPending);
  const balanceDue = netPayable - amountPaid;

  const handleRemoveItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const handleSave = useCallback((status: 'draft' | 'sent', recipientName?: string, recipientEmail?: string) => {
    if (!projectId) return;
    if (lineItems.length === 0) {
      Alert.alert('No Items', 'Please add at least one line item.');
      return;
    }

    const now = new Date().toISOString();
    const dueDate = getDueDate(now, paymentTerms);
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    if (existingInvoice) {
      updateInvoice(existingInvoice.id, {
        lineItems,
        paymentTerms,
        notes: notes.trim(),
        subtotal,
        taxRate,
        taxAmount,
        totalDue,
        dueDate,
        status,
        progressPercent: isProgressType ? pctValue : undefined,
        retentionPercent: retentionPctValue || undefined,
        retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Updated', `Invoice #${existingInvoice.number} has been ${status === 'sent' ? `sent${recipientInfo}` : 'saved to project'}.`);
    } else {
      const inv: Invoice = {
        id: createId('inv'),
        number: nextInvoiceNumber,
        projectId: projectId,
        type: isProgressType ? 'progress' : 'full',
        progressPercent: isProgressType ? pctValue : undefined,
        issueDate: now,
        dueDate,
        paymentTerms,
        notes: notes.trim(),
        lineItems,
        subtotal,
        taxRate,
        taxAmount,
        totalDue,
        amountPaid: 0,
        status,
        payments: [],
        retentionPercent: retentionPctValue || undefined,
        retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
        retentionReleased: 0,
        retentionReleases: [],
        createdAt: now,
        updatedAt: now,
      };
      addInvoice(inv);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        status === 'sent' ? 'Sent' : 'Saved to Project',
        status === 'sent'
          ? `Invoice #${nextInvoiceNumber} has been sent${recipientInfo} and saved to the project.`
          : `Invoice #${nextInvoiceNumber} has been saved to the project. You can view it in the project's Invoices section.`,
      );
    }
    router.back();
  }, [projectId, lineItems, paymentTerms, notes, subtotal, taxRate, taxAmount, totalDue, isProgressType, pctValue, retentionPctValue, retentionAmount, existingInvoice, nextInvoiceNumber, addInvoice, updateInvoice, router]);

  const handleSendPress = useCallback(() => {
    setShowSendRecipient(true);
  }, []);

  const handleConfirmSend = useCallback(async () => {
    if (!sendRecipientEmail.trim()) {
      Alert.alert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    setShowSendRecipient(false);

    if (sendRecipientEmail.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const now = new Date().toISOString();
      const dueDate = getDueDate(now, paymentTerms);
      const html = buildInvoiceEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        invoiceNumber: existingInvoice?.number ?? nextInvoiceNumber,
        totalDue,
        dueDate,
        paymentTerms,
        contactName: branding.contactName,
        contactEmail: branding.email,
        contactPhone: branding.phone,
      });

      const result = await sendEmail({
        to: sendRecipientEmail.trim(),
        subject: `${branding.companyName || 'MAGE ID'} - Invoice #${existingInvoice?.number ?? nextInvoiceNumber} - ${project?.name ?? 'Project'}`,
        html,
        replyTo: branding.email || undefined,
      });

      if (!result.success) {
        if (result.error === 'cancelled') {
          return;
        }
        console.warn('[Invoice] Email send failed:', result.error);
        Alert.alert('Email Notice', `Invoice saved but email could not be sent: ${result.error}`);
        return;
      } else {
        console.log('[Invoice] Email sent successfully');
      }
    }

    handleSave('sent', sendRecipientName, sendRecipientEmail);
  }, [handleSave, sendRecipientName, sendRecipientEmail, settings, project, existingInvoice, nextInvoiceNumber, totalDue, paymentTerms]);

  const handleSendPDF = useCallback(async (options: PDFSendOptions) => {
    if (!project || !existingInvoice) return;
    setShowPDFPreSend(false);

    if (options.method === 'email' && options.recipient.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const dueDate = existingInvoice.dueDate || getDueDate(new Date().toISOString(), existingInvoice.paymentTerms);
      const emailHtml = buildInvoiceEmailHtml({
        companyName: branding.companyName,
        recipientName: '',
        projectName: project.name,
        invoiceNumber: existingInvoice.number,
        totalDue: existingInvoice.totalDue,
        dueDate,
        paymentTerms: existingInvoice.paymentTerms,
        message: options.message,
        contactName: branding.contactName,
        contactEmail: branding.email,
        contactPhone: branding.phone,
      });

      const pdfUri = await generateInvoicePDFUri(existingInvoice, project, branding);

      const result = await sendEmail({
        to: options.recipient.trim(),
        subject: `${branding.companyName || 'MAGE ID'} - Invoice #${existingInvoice.number} - ${project.name}`,
        html: emailHtml,
        replyTo: branding.email || undefined,
        attachments: pdfUri ? [pdfUri] : undefined,
      });

      if (result.success) {
        Alert.alert('Email Sent', `Invoice emailed to ${options.recipient}`);
      } else if (result.error === 'cancelled') {
        return;
      } else {
        Alert.alert(
          'Email Issue',
          'Could not send via email. Would you like to share the PDF using another app instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Share PDF',
              onPress: async () => {
                try {
                  const uri = pdfUri ?? await generateInvoicePDFUri(existingInvoice, project, branding);
                  if (uri && await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(uri, {
                      mimeType: 'application/pdf',
                      dialogTitle: `Invoice #${existingInvoice.number}`,
                      UTI: 'com.adobe.pdf',
                    });
                  }
                } catch (shareErr) {
                  console.error('[Invoice] Share fallback failed:', shareErr);
                }
              },
            },
          ]
        );
      }
      return;
    }

    try {
      await generateInvoicePDF(existingInvoice, project, settings.branding ?? {
        companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
      });
    } catch (e) {
      console.error('[Invoice] PDF share error:', e);
      Alert.alert('Error', 'Failed to generate PDF. Please try again.');
    }
  }, [project, existingInvoice, settings]);

  const handleMarkPaid = useCallback(() => {
    const amt = parseFloat(paymentAmount) || 0;
    if (amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }
    if (!existingInvoice) return;

    const payment: InvoicePayment = {
      id: createId('pay'),
      date: new Date().toISOString(),
      amount: amt,
      method: paymentMethod,
    };
    const newPaid = amountPaid + amt;
    const newStatus = newPaid >= totalDue ? 'paid' as const : 'partially_paid' as const;

    updateInvoice(existingInvoice.id, {
      amountPaid: newPaid,
      status: newStatus,
      payments: [...(existingInvoice.payments || []), payment],
    });

    setShowPaymentModal(false);
    setPaymentAmount('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Payment Recorded', `${formatCurrency(amt)} payment recorded. Status: ${newStatus.replace('_', ' ')}`);
    router.back();
  }, [paymentAmount, paymentMethod, existingInvoice, amountPaid, totalDue, updateInvoice, router]);

  // Stripe payment link: generate once per invoice (or regenerate if the link
  // is lost/stale). We persist `payLinkUrl` + `payLinkId` on the invoice so the
  // client portal snapshot picks it up and renders the Pay Now button without
  // needing another round-trip.
  const handleGeneratePayLink = useCallback(async () => {
    if (!existingInvoice || !project) return;
    if (balanceDue <= 0) {
      Alert.alert('Nothing Due', 'This invoice has no outstanding balance.');
      return;
    }

    setGeneratingPayLink(true);
    try {
      // Prefer an email tied to the project's client contact so Stripe
      // pre-fills checkout. Fall back to the send-recipient email if one was
      // captured, otherwise leave undefined.
      const clientContact = contacts.find(c =>
        c.email && project?.name && (
          c.companyName?.toLowerCase().includes(project.name.toLowerCase()) ||
          (project as any).clientContactId === c.id
        ),
      );

      const res = await createPaymentLink({
        invoiceId: existingInvoice.id,
        invoiceNumber: existingInvoice.number,
        projectName: project.name,
        amountCents: Math.round(balanceDue * 100),
        customerEmail: clientContact?.email,
        companyName: settings.branding?.companyName,
      });

      if (!res.success || !res.url || !res.id) {
        Alert.alert('Could Not Create Payment Link', res.error ?? 'Unknown error from Stripe.');
        return;
      }

      updateInvoice(existingInvoice.id, {
        payLinkUrl: res.url,
        payLinkId: res.id,
      });

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Payment Link Ready',
        'A Stripe payment link has been generated and attached to this invoice. Your client will see a Pay Now button in the portal.',
      );
    } catch (err) {
      console.error('[Invoice] Generate pay link failed:', err);
      Alert.alert('Error', 'Failed to generate payment link. Please try again.');
    } finally {
      setGeneratingPayLink(false);
    }
  }, [existingInvoice, project, balanceDue, contacts, settings, updateInvoice]);

  const handleCopyPayLink = useCallback(() => {
    if (!existingInvoice?.payLinkUrl) return;
    try {
      // RN's legacy Clipboard API is deprecated but still ships in Expo Go and
      // avoids pulling in @react-native-clipboard/clipboard. Matches the
      // pattern already used in client-portal-setup.tsx.
      Clipboard.setString(existingInvoice.payLinkUrl);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied', 'Payment link copied to clipboard.');
    } catch (err) {
      console.error('[Invoice] Copy pay link failed:', err);
      Alert.alert('Copy Failed', 'Could not copy to clipboard.');
    }
  }, [existingInvoice]);

  const handleSharePayLink = useCallback(async () => {
    if (!existingInvoice?.payLinkUrl || !project) return;
    const brandingName = settings.branding?.companyName || 'MAGE ID';
    const message =
      `${brandingName} — Invoice #${existingInvoice.number} for ${project.name}\n` +
      `Amount due: ${formatCurrency(balanceDue)}\n\n` +
      `Pay securely here:\n${existingInvoice.payLinkUrl}`;
    try {
      await Share.share({
        message,
        title: `Invoice #${existingInvoice.number}`,
        url: existingInvoice.payLinkUrl,
      });
    } catch (err) {
      console.error('[Invoice] Share pay link failed:', err);
    }
  }, [existingInvoice, project, balanceDue, settings]);

  const handleReleaseRetention = useCallback(() => {
    if (!existingInvoice) return;
    const amt = parseFloat(retentionReleaseAmount) || 0;
    if (amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid release amount.');
      return;
    }
    if (amt > retentionPending + 0.001) {
      Alert.alert('Exceeds Pending', `Only ${formatCurrency(retentionPending)} of retention is pending. Reduce the amount.`);
      return;
    }
    const release: RetentionRelease = {
      id: createId('ret'),
      date: new Date().toISOString(),
      amount: amt,
      method: retentionReleaseMethod,
      note: retentionReleaseNote.trim() || undefined,
    };
    const newReleased = retentionReleased + amt;
    updateInvoice(existingInvoice.id, {
      retentionReleased: newReleased,
      retentionReleases: [...(existingInvoice.retentionReleases || []), release],
    });
    setShowRetentionModal(false);
    setRetentionReleaseAmount('');
    setRetentionReleaseNote('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Retention Released', `${formatCurrency(amt)} marked as released.`);
  }, [existingInvoice, retentionReleaseAmount, retentionReleaseMethod, retentionReleaseNote, retentionPending, retentionReleased, updateInvoice]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Invoice' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Use the effective status so an unpaid-but-past-due invoice flips to "overdue"
  // in the UI without anyone having to run a cron to mutate the record, and a
  // fully-paid invoice reads as "paid" even if the stored status lagged behind.
  const effectiveStatus = existingInvoice ? getEffectiveInvoiceStatus(existingInvoice) : null;
  const daysPastDue = existingInvoice ? getDaysPastDue(existingInvoice) : 0;

  const isLocked = effectiveStatus === 'paid';

  const statusColor = effectiveStatus ? invoiceStatusColors[effectiveStatus] : null;
  const statusLabel = effectiveStatus ? (
    effectiveStatus === 'sent' ? 'Awaiting Payment' :
    effectiveStatus === 'partially_paid' ? 'Partially Paid' :
    effectiveStatus === 'overdue' ? `Overdue${daysPastDue > 0 ? ` • ${daysPastDue}d` : ''}` :
    effectiveStatus === 'paid' ? 'Paid' :
    effectiveStatus === 'draft' ? 'Draft' : effectiveStatus
  ) : '';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: existingInvoice ? `Invoice #${existingInvoice.number}` : 'New Invoice',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>
              {isProgressType ? 'Progress Bill' : 'Full Invoice'} #{nextInvoiceNumber}
            </Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            {existingInvoice && statusColor && (
              <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
                <Text style={[styles.statusText, { color: statusColor.text }]}>
                  {statusLabel}
                </Text>
              </View>
            )}
          </View>

          {isProgressType && !isLocked && (
            <View style={styles.progressSection}>
              <Text style={styles.progressLabel}>Billing Percentage</Text>
              <View style={styles.progressRow}>
                <TextInput
                  style={styles.progressInput}
                  value={progressPercent}
                  onChangeText={setProgressPercent}
                  keyboardType="numeric"
                  testID="progress-percent-input"
                />
                <Text style={styles.progressSign}>% of {formatCurrency(contractTotal)}</Text>
              </View>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${Math.min(pctValue, 100)}%` }]} />
              </View>
            </View>
          )}

          <View style={styles.termsRow}>
            <Text style={styles.fieldLabelInline}>Payment Terms</Text>
            {!isLocked ? (
              <TouchableOpacity
                style={styles.termsSelector}
                onPress={() => setShowTermsDropdown(!showTermsDropdown)}
                activeOpacity={0.7}
              >
                <Text style={styles.termsSelectorText}>
                  {PAYMENT_TERMS_OPTIONS.find(o => o.value === paymentTerms)?.label}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.termsSelectorText}>
                {PAYMENT_TERMS_OPTIONS.find(o => o.value === paymentTerms)?.label}
              </Text>
            )}
          </View>

          {showTermsDropdown && (
            <View style={styles.termsDropdown}>
              {PAYMENT_TERMS_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.termsOption, paymentTerms === opt.value && styles.termsOptionActive]}
                  onPress={() => { setPaymentTerms(opt.value); setShowTermsDropdown(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.termsOptionText, paymentTerms === opt.value && styles.termsOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {paymentTerms === opt.value && <Check size={16} color={Colors.primary} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.termsRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Percent size={14} color={Colors.textSecondary} />
              <Text style={styles.fieldLabelInline}>Retention</Text>
            </View>
            {!isLocked ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TextInput
                  style={styles.retentionInput}
                  value={retentionPercent}
                  onChangeText={setRetentionPercent}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={5}
                />
                <Text style={styles.retentionPct}>%</Text>
              </View>
            ) : (
              <Text style={styles.termsSelectorText}>{retentionPctValue}%</Text>
            )}
          </View>

          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>Line Items</Text>
            {lineItems.map((item) => (
              <View key={item.id} style={styles.lineItemCard}>
                <View style={styles.lineItemHeader}>
                  <Text style={styles.lineItemName} numberOfLines={1}>{item.name}</Text>
                  {!isLocked && (
                    <TouchableOpacity onPress={() => handleRemoveItem(item.id)} activeOpacity={0.7}>
                      <Trash2 size={14} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.lineItemMeta}>
                  <Text style={styles.lineItemMetaText}>
                    {item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}
                  </Text>
                  <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({taxRate}%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(taxAmount)}</Text>
            </View>
            <View style={styles.dividerThick} />
            <View style={styles.totalRow}>
              <Text style={styles.grandLabel}>Contract Total</Text>
              <Text style={styles.grandValue}>{formatCurrency(totalDue)}</Text>
            </View>
            {retentionPctValue > 0 && (
              <>
                <View style={styles.divider} />
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: Colors.warning }]}>Retention Held ({retentionPctValue}%)</Text>
                  <Text style={[styles.totalValue, { color: Colors.warning }]}>-{formatCurrency(retentionPending)}</Text>
                </View>
                {retentionReleased > 0 && (
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: Colors.success }]}>Retention Released</Text>
                    <Text style={[styles.totalValue, { color: Colors.success }]}>{formatCurrency(retentionReleased)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.grandLabel}>Net Payable Now</Text>
                  <Text style={styles.grandValue}>{formatCurrency(netPayable)}</Text>
                </View>
              </>
            )}
            {existingInvoice && amountPaid > 0 && (
              <>
                <View style={styles.divider} />
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: Colors.success }]}>Amount Paid</Text>
                  <Text style={[styles.totalValue, { color: Colors.success }]}>-{formatCurrency(amountPaid)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.grandLabel}>Balance Due</Text>
                  <Text style={[styles.grandValue, { color: balanceDue > 0 ? Colors.error : Colors.success }]}>
                    {formatCurrency(balanceDue)}
                  </Text>
                </View>
              </>
            )}
          </View>

          {existingInvoice && retentionPctValue > 0 && retentionPending > 0 && (
            <TouchableOpacity
              style={styles.releaseRetentionBtn}
              onPress={() => setShowRetentionModal(true)}
              activeOpacity={0.85}
              testID="release-retention-btn"
            >
              <Unlock size={16} color={Colors.warning} />
              <Text style={styles.releaseRetentionBtnText}>Release Retention</Text>
              <Text style={styles.releaseRetentionBtnMeta}>{formatCurrency(retentionPending)} pending</Text>
            </TouchableOpacity>
          )}

          {existingInvoice && existingInvoice.retentionReleases && existingInvoice.retentionReleases.length > 0 && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Retention Release History</Text>
              {existingInvoice.retentionReleases.map((r) => (
                <View key={r.id} style={styles.paymentRow}>
                  <View style={styles.paymentInfo}>
                    <Text style={styles.paymentDate}>{new Date(r.date).toLocaleDateString()}</Text>
                    <Text style={styles.paymentMethodText}>
                      {r.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      {r.note ? ` · ${r.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.paymentAmount, { color: Colors.warning }]}>{formatCurrency(r.amount)}</Text>
                </View>
              ))}
            </View>
          )}

          {existingInvoice && existingInvoice.status !== 'paid' && existingInvoice.status !== 'draft' && (
            <View style={{ paddingHorizontal: 16 }}>
              <AIInvoicePredictor
                invoice={existingInvoice}
                projectName={project?.name ?? ''}
                allInvoices={allInvoices}
                subscriptionTier={tier as any}
              />
            </View>
          )}

          {/* Stripe Payment Link: only meaningful for sent/partially-paid/overdue
              invoices with a positive balance. Drafts shouldn't be collectable
              yet; paid invoices don't need a link. */}
          {existingInvoice && existingInvoice.status !== 'draft' && existingInvoice.status !== 'paid' && balanceDue > 0 && (
            <View style={styles.payLinkCard}>
              <View style={styles.payLinkHeader}>
                <View style={styles.payLinkIconWrap}>
                  <Zap size={18} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payLinkTitle}>Stripe Payment Link</Text>
                  <Text style={styles.payLinkSub}>
                    {existingInvoice.payLinkUrl
                      ? 'Clients can pay by card or ACH via the portal.'
                      : `Let your client pay ${formatCurrency(balanceDue)} online in one tap.`}
                  </Text>
                </View>
              </View>

              {existingInvoice.payLinkUrl ? (
                <>
                  <View style={styles.payLinkUrlBox}>
                    <Link2 size={14} color={Colors.textSecondary} />
                    <Text style={styles.payLinkUrlText} numberOfLines={1} ellipsizeMode="middle">
                      {existingInvoice.payLinkUrl}
                    </Text>
                  </View>
                  <View style={styles.payLinkActions}>
                    <TouchableOpacity
                      style={styles.payLinkActionBtn}
                      onPress={handleCopyPayLink}
                      activeOpacity={0.7}
                      testID="copy-pay-link-btn"
                    >
                      <Copy size={14} color={Colors.primary} />
                      <Text style={styles.payLinkActionText}>Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.payLinkActionBtn}
                      onPress={handleSharePayLink}
                      activeOpacity={0.7}
                      testID="share-pay-link-btn"
                    >
                      <Share2 size={14} color={Colors.primary} />
                      <Text style={styles.payLinkActionText}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.payLinkActionBtn, styles.payLinkRegenBtn]}
                      onPress={handleGeneratePayLink}
                      activeOpacity={0.7}
                      disabled={generatingPayLink}
                      testID="regenerate-pay-link-btn"
                    >
                      {generatingPayLink ? (
                        <ActivityIndicator size="small" color={Colors.textSecondary} />
                      ) : (
                        <Text style={styles.payLinkRegenText}>Regenerate</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.payLinkGenerateBtn}
                  onPress={handleGeneratePayLink}
                  activeOpacity={0.85}
                  disabled={generatingPayLink}
                  testID="generate-pay-link-btn"
                >
                  {generatingPayLink ? (
                    <>
                      <ActivityIndicator size="small" color={Colors.textOnPrimary} />
                      <Text style={styles.payLinkGenerateText}>Generating…</Text>
                    </>
                  ) : (
                    <>
                      <Zap size={16} color={Colors.textOnPrimary} />
                      <Text style={styles.payLinkGenerateText}>Generate Payment Link</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {existingInvoice && existingInvoice.payments && existingInvoice.payments.length > 0 && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Payment History</Text>
              {existingInvoice.payments.map((p) => (
                <View key={p.id} style={styles.paymentRow}>
                  <View style={styles.paymentInfo}>
                    <Text style={styles.paymentDate}>
                      {new Date(p.date).toLocaleDateString()}
                    </Text>
                    <Text style={styles.paymentMethodText}>
                      {p.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </View>
                  <Text style={styles.paymentAmount}>{formatCurrency(p.amount)}</Text>
                </View>
              ))}
            </View>
          )}

          {!isLocked && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={styles.textArea}
                value={notes}
                onChangeText={setNotes}
                placeholder="Payment instructions, terms, etc."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
              />
            </View>
          )}

          {existingInvoice && isProgressType && (
            <TouchableOpacity
              style={styles.aiaCtaCard}
              onPress={() => router.push(`/aia-pay-app?invoiceId=${existingInvoice.id}` as any)}
              activeOpacity={0.85}
            >
              <View style={styles.aiaCtaIconWrap}>
                <FileSpreadsheet size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiaCtaTitle}>Generate AIA G702/G703</Text>
                <Text style={styles.aiaCtaSub}>
                  Create a lender- and architect-ready progress pay application from this invoice.
                </Text>
              </View>
              <Text style={styles.aiaCtaArrow}>›</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {!isLocked && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            {existingInvoice && existingInvoice.status !== 'draft' && existingInvoice.status !== 'paid' && (
              <TouchableOpacity
                style={styles.markPaidBtn}
                onPress={() => { setPaymentAmount(balanceDue.toFixed(2)); setShowPaymentModal(true); }}
                activeOpacity={0.7}
                testID="mark-paid-btn"
              >
                <CreditCard size={16} color={Colors.success} />
                <Text style={styles.markPaidBtnText}>Record Payment</Text>
              </TouchableOpacity>
            )}
            {(!existingInvoice || existingInvoice.status === 'draft') && (
              <>
                <TouchableOpacity
                  style={styles.saveProjectBtn}
                  onPress={() => handleSave('draft')}
                  activeOpacity={0.7}
                  testID="save-invoice-to-project"
                >
                  <Text style={styles.saveProjectBtnText}>Save to Project</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={handleSendPress}
                  activeOpacity={0.7}
                  testID="send-invoice-btn"
                >
                  <Send size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.sendBtnText}>Send & Save</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={showPaymentModal} transparent animationType="slide" onRequestClose={() => setShowPaymentModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Record Payment</Text>
                <TouchableOpacity onPress={() => setShowPaymentModal(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalFieldLabel}>Amount</Text>
              <TextInput
                style={styles.modalInput}
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.modalFieldLabel}>Payment Method</Text>
              <View style={styles.methodGrid}>
                {PAYMENT_METHOD_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.methodChip, paymentMethod === opt.value && styles.methodChipActive]}
                    onPress={() => setPaymentMethod(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.methodChipText, paymentMethod === opt.value && styles.methodChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleMarkPaid} activeOpacity={0.85}>
                <Check size={18} color={Colors.textOnPrimary} />
                <Text style={styles.modalSaveBtnText}>Record Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showRetentionModal} transparent animationType="slide" onRequestClose={() => setShowRetentionModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Release Retention</Text>
                <TouchableOpacity onPress={() => setShowRetentionModal(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.retentionModalMeta}>
                Pending: <Text style={{ color: Colors.warning, fontWeight: '700' }}>{formatCurrency(retentionPending)}</Text>
                {retentionReleased > 0 ? `  ·  Released: ${formatCurrency(retentionReleased)}` : ''}
              </Text>

              <Text style={styles.modalFieldLabel}>Amount to Release</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={[styles.modalInput, { flex: 1 }]}
                  value={retentionReleaseAmount}
                  onChangeText={setRetentionReleaseAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity
                  style={styles.fullReleaseBtn}
                  onPress={() => setRetentionReleaseAmount(retentionPending.toFixed(2))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.fullReleaseBtnText}>Full</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalFieldLabel}>Method</Text>
              <View style={styles.methodGrid}>
                {PAYMENT_METHOD_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.methodChip, retentionReleaseMethod === opt.value && styles.methodChipActive]}
                    onPress={() => setRetentionReleaseMethod(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.methodChipText, retentionReleaseMethod === opt.value && styles.methodChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalFieldLabel}>Note (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={retentionReleaseNote}
                onChangeText={setRetentionReleaseNote}
                placeholder="e.g. Substantial completion, punch list cleared"
                placeholderTextColor={Colors.textMuted}
              />

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleReleaseRetention} activeOpacity={0.85}>
                <Unlock size={18} color={Colors.textOnPrimary} />
                <Text style={styles.modalSaveBtnText}>Release</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showSendRecipient} transparent animationType="slide" onRequestClose={() => setShowSendRecipient(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Send Invoice To</Text>
                <TouchableOpacity onPress={() => setShowSendRecipient(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn}>
                    <X size={12} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Recipient Name</Text>
                  <TextInput
                    style={styles.recipientModalInput}
                    value={sendRecipientName}
                    onChangeText={setSendRecipientName}
                    placeholder="Enter name or pick from contacts"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.recipientModalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {contacts.length > 0 && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={Colors.primary} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sendBtn} onPress={handleConfirmSend} activeOpacity={0.7}>
                  <Send size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.sendBtnText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => { setShowContactPicker(false); setTimeout(() => setShowSendRecipient(true), 350); }}
        contacts={contacts}
        title="Select Recipient"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      {existingInvoice && project && (
        <PDFPreSendSheet
          visible={showPDFPreSend}
          onClose={() => setShowPDFPreSend(false)}
          onSend={handleSendPDF}
          documentType="invoice"
          projectName={project.name}
          documentNumber={existingInvoice.number}
          contacts={contacts}
          pdfNaming={settings.pdfNaming}
          onPdfNumberUsed={() => {
            if (settings.pdfNaming?.enabled) {
              updateSettings({ pdfNaming: { ...settings.pdfNaming, nextNumber: settings.pdfNaming.nextNumber + 1 } });
            }
          }}
        />
      )}
    </View>
  );
}

const invoiceStatusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: Colors.fillTertiary, text: Colors.textSecondary },
  sent: { bg: Colors.infoLight, text: Colors.info },
  partially_paid: { bg: Colors.warningLight, text: Colors.warning },
  paid: { bg: Colors.successLight, text: Colors.success },
  overdue: { bg: Colors.errorLight, text: Colors.error },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '600' as const },
  heroCard: { backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 16, borderRadius: 16, padding: 20, gap: 4 },
  heroLabel: { fontSize: 13, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: 20, fontWeight: '700' as const, color: Colors.textOnPrimary },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700' as const },
  progressSection: { marginHorizontal: 20, marginTop: 16, backgroundColor: Colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
  progressLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressInput: { width: 70, minHeight: 44, borderRadius: 10, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 18, fontWeight: '700' as const, color: Colors.primary, textAlign: 'center' as const },
  progressSign: { fontSize: 14, color: Colors.textSecondary },
  progressBarTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.fillTertiary, overflow: 'hidden' as const },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  termsRow: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  fieldLabelInline: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  termsSelector: { backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  termsSelectorText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  termsDropdown: { marginHorizontal: 20, marginTop: 4, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const },
  termsOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  termsOptionActive: { backgroundColor: Colors.primary + '08' },
  termsOptionText: { fontSize: 15, color: Colors.text },
  termsOptionTextActive: { color: Colors.primary, fontWeight: '600' as const },
  fieldSection: { marginHorizontal: 20, marginTop: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  lineItemCard: { backgroundColor: Colors.card, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: Colors.cardBorder },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  lineItemName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, flex: 1, marginRight: 8 },
  lineItemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineItemMetaText: { fontSize: 12, color: Colors.textSecondary },
  lineItemTotal: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  totalsCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: Colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: Colors.cardBorder },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  totalLabel: { fontSize: 15, color: Colors.textSecondary, fontWeight: '500' as const },
  totalValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 4 },
  dividerThick: { height: 2, backgroundColor: Colors.primary + '30', borderRadius: 1, marginVertical: 6 },
  grandLabel: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  grandValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  textArea: { minHeight: 80, borderRadius: 14, backgroundColor: Colors.card, paddingHorizontal: 14, paddingTop: 12, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: Colors.cardBorder },
  paymentInfo: { gap: 2 },
  paymentDate: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  paymentMethodText: { fontSize: 12, color: Colors.textSecondary },
  paymentAmount: { fontSize: 15, fontWeight: '700' as const, color: Colors.success },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary + '15', borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.textOnPrimary },
  aiaCtaCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 20, marginTop: 8, marginBottom: 20, padding: 14,
    backgroundColor: Colors.primary + '10',
    borderRadius: 14, borderWidth: 1, borderColor: Colors.primary + '25',
  },
  aiaCtaIconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  aiaCtaTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  aiaCtaSub: { fontSize: 12, color: Colors.textMuted, lineHeight: 16 },
  aiaCtaArrow: { fontSize: 24, color: Colors.primary, marginLeft: 4 },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary + '10', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: Colors.primary + '25' },
  selectedRecipientName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  selectedRecipientEmail: { fontSize: 12, color: Colors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.primary + '10' },
  pickContactText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  recipientModalInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  markPaidBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.successLight, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: Colors.success + '30' },
  markPaidBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  modalFieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 48, borderRadius: 14, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  methodChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.fillTertiary },
  methodChipActive: { backgroundColor: Colors.primary },
  methodChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  methodChipTextActive: { color: Colors.textOnPrimary },
  modalSaveBtn: { backgroundColor: Colors.success, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  modalSaveBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  retentionInput: { minWidth: 60, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border, fontSize: 14, fontWeight: '600' as const, color: Colors.text, textAlign: 'right' as const },
  retentionPct: { fontSize: 14, fontWeight: '700' as const, color: Colors.textSecondary },
  releaseRetentionBtn: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: Colors.warning + '15', borderWidth: 1, borderColor: Colors.warning + '40' },
  releaseRetentionBtnText: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: Colors.warning },
  releaseRetentionBtnMeta: { fontSize: 12, fontWeight: '600' as const, color: Colors.warning },
  retentionModalMeta: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  fullReleaseBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.warning + '20', borderWidth: 1, borderColor: Colors.warning + '40' },
  fullReleaseBtnText: { fontSize: 13, fontWeight: '700' as const, color: Colors.warning },
  payLinkCard: {
    marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: 16,
    backgroundColor: Colors.primary + '08',
    borderWidth: 1, borderColor: Colors.primary + '25',
    gap: 12,
  },
  payLinkHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  payLinkIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  payLinkTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  payLinkSub: { fontSize: 12, color: Colors.textMuted, lineHeight: 16 },
  payLinkUrlBox: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  payLinkUrlText: { flex: 1, fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  payLinkActions: { flexDirection: 'row' as const, gap: 8 },
  payLinkActionBtn: {
    flex: 1, minHeight: 40, borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    flexDirection: 'row' as const, gap: 6,
  },
  payLinkActionText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  payLinkRegenBtn: { backgroundColor: Colors.fillTertiary },
  payLinkRegenText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  payLinkGenerateBtn: {
    minHeight: 48, borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    flexDirection: 'row' as const, gap: 8,
  },
  payLinkGenerateText: { fontSize: 15, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

```


---

### `app/change-order.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Trash2, X, FileText, Send, Search, Percent, BookUser, User,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ContactPickerModal from '@/components/ContactPickerModal';
import { getLivePrices, getRegionMultiplier, CATEGORY_META, type MaterialItem } from '@/constants/materials';
import { sendEmail, buildChangeOrderEmailHtml } from '@/utils/emailService';
import AIChangeOrderImpact from '@/components/AIChangeOrderImpact';
import type { ChangeOrderLineItem, ChangeOrder } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChangeOrderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, coId } = useLocalSearchParams<{ projectId: string; coId?: string }>();
  const {
    getProject, getChangeOrdersForProject, addChangeOrder, updateChangeOrder, contacts,
  } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingCOs = useMemo(() => getChangeOrdersForProject(projectId ?? ''), [projectId, getChangeOrdersForProject]);
  const existingCO = useMemo(() => coId ? existingCOs.find(c => c.id === coId) : null, [coId, existingCOs]);

  const originalContractValue = useMemo(() => {
    if (!project) return 0;
    const linked = project.linkedEstimate;
    const legacy = project.estimate;
    let base = linked?.grandTotal ?? legacy?.grandTotal ?? 0;
    const approvedCOs = existingCOs.filter(c => c.status === 'approved' && c.id !== coId);
    approvedCOs.forEach(c => { base += c.changeAmount; });
    return base;
  }, [project, existingCOs, coId]);

  const nextCoNumber = useMemo(() => {
    if (existingCO) return existingCO.number;
    return existingCOs.length + 1;
  }, [existingCOs, existingCO]);

  const [description, setDescription] = useState(existingCO?.description ?? '');
  const [reason, setReason] = useState(existingCO?.reason ?? '');
  const [scheduleImpactDays, setScheduleImpactDays] = useState<string>(
    existingCO?.scheduleImpactDays ? String(existingCO.scheduleImpactDays) : ''
  );
  const [lineItems, setLineItems] = useState<ChangeOrderLineItem[]>(
    existingCO?.lineItems ?? []
  );
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [showEstimateItems, setShowEstimateItems] = useState(false);
  const [showMaterialSearch, setShowMaterialSearch] = useState(false);
  const [materialQuery, setMaterialQuery] = useState('');
  const [selectedPriceType, setSelectedPriceType] = useState<'retail' | 'bulk'>('bulk');
  const [itemMarkup, setItemMarkup] = useState('0');
  const [overridePrice, setOverridePrice] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);

  const { settings } = useProjects();
  const locationMultiplier = useMemo(() => getRegionMultiplier(settings.location), [settings.location]);
  const allMaterials = useMemo(() => getLivePrices(Date.now() / 10000, locationMultiplier), [locationMultiplier]);

  const filteredMaterials = useMemo(() => {
    if (!materialQuery.trim()) return allMaterials.slice(0, 30);
    const q = materialQuery.toLowerCase();
    return allMaterials.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.supplier.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [allMaterials, materialQuery]);

  const changeAmount = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.total, 0);
  }, [lineItems]);

  const newContractTotal = useMemo(() => {
    return originalContractValue + changeAmount;
  }, [originalContractValue, changeAmount]);

  const estimateItems = useMemo(() => {
    if (!project) return [];
    const linked = project.linkedEstimate;
    if (linked && linked.items.length > 0) {
      return linked.items.map(item => ({
        name: item.name,
        unit: item.unit,
        unitPrice: item.usesBulk ? item.bulkPrice : item.unitPrice,
        category: item.category,
      }));
    }
    const legacy = project.estimate;
    if (legacy) {
      return legacy.materials.map(item => ({
        name: item.name,
        unit: item.unit,
        unitPrice: item.unitPrice,
        category: item.category,
      }));
    }
    return [];
  }, [project]);

  const handleAddNewItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter an item name.');
      return;
    }
    const qty = parseFloat(newItemQty) || 0;
    const price = parseFloat(newItemPrice) || 0;
    const markup = parseFloat(itemMarkup) || 0;
    const finalPrice = price * (1 + markup / 100);
    const item: ChangeOrderLineItem = {
      id: createId('coli'),
      name,
      description: newItemDesc.trim() + (overridePrice && overrideReason.trim() ? ` (${overrideReason.trim()})` : ''),
      quantity: qty,
      unit: newItemUnit.trim() || 'ea',
      unitPrice: finalPrice,
      total: qty * finalPrice,
      isNew: true,
    };
    setLineItems(prev => [...prev, item]);
    setNewItemName('');
    setNewItemQty('');
    setNewItemUnit('');
    setNewItemPrice('');
    setNewItemDesc('');
    setItemMarkup('0');
    setOverridePrice(false);
    setOverrideReason('');
    setShowAddItem(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [newItemName, newItemQty, newItemUnit, newItemPrice, newItemDesc, itemMarkup, overridePrice, overrideReason]);

  const handleAddFromMaterials = useCallback((material: MaterialItem) => {
    const price = selectedPriceType === 'bulk' ? material.baseBulkPrice : material.baseRetailPrice;
    const markup = parseFloat(itemMarkup) || 0;
    const finalPrice = price * (1 + markup / 100);
    const originalEstPrice = estimateItems.find(e => e.name === material.name)?.unitPrice;
    const desc = originalEstPrice ? `Original estimate: ${originalEstPrice.toFixed(2)}/${material.unit}` : '';
    const item: ChangeOrderLineItem = {
      id: createId('coli'),
      name: material.name,
      description: desc,
      quantity: 1,
      unit: material.unit,
      unitPrice: finalPrice,
      total: finalPrice,
      isNew: true,
    };
    setLineItems(prev => [...prev, item]);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [selectedPriceType, itemMarkup, estimateItems]);

  const handleAddFromEstimate = useCallback((item: { name: string; unit: string; unitPrice: number }) => {
    const newItem: ChangeOrderLineItem = {
      id: createId('coli'),
      name: item.name,
      description: '',
      quantity: 1,
      unit: item.unit,
      unitPrice: item.unitPrice,
      total: item.unitPrice,
      isNew: false,
    };
    setLineItems(prev => [...prev, newItem]);
    setShowEstimateItems(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleRemoveItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleUpdateItemQty = useCallback((id: string, qtyStr: string) => {
    const qty = parseFloat(qtyStr) || 0;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, quantity: qty, total: qty * item.unitPrice } : item
    ));
  }, []);

  const handleUpdateItemPrice = useCallback((id: string, priceStr: string) => {
    const price = parseFloat(priceStr) || 0;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, unitPrice: price, total: item.quantity * price } : item
    ));
  }, []);

  const handleSave = useCallback((status: 'draft' | 'submitted', recipientName?: string, recipientEmail?: string) => {
    if (!projectId) return;
    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please enter a description for this change order.');
      return;
    }
    if (lineItems.length === 0) {
      Alert.alert('No Items', 'Please add at least one line item.');
      return;
    }

    const now = new Date().toISOString();
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    const parsedImpactDays = parseInt(scheduleImpactDays, 10);
    const impactDays = Number.isFinite(parsedImpactDays) && parsedImpactDays > 0 ? parsedImpactDays : undefined;

    if (existingCO) {
      updateChangeOrder(existingCO.id, {
        description: description.trim(),
        reason: reason.trim(),
        lineItems,
        originalContractValue,
        changeAmount,
        newContractTotal,
        status,
        scheduleImpactDays: impactDays,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Updated', `Change Order #${existingCO.number} has been ${status === 'submitted' ? `submitted for approval${recipientInfo}` : 'saved to project'}.`);
    } else {
      const co: ChangeOrder = {
        id: createId('co'),
        number: nextCoNumber,
        projectId,
        date: now,
        description: description.trim(),
        reason: reason.trim(),
        lineItems,
        originalContractValue,
        changeAmount,
        newContractTotal,
        status,
        createdAt: now,
        updatedAt: now,
        scheduleImpactDays: impactDays,
      };
      addChangeOrder(co);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        status === 'submitted' ? 'Submitted' : 'Saved to Project',
        status === 'submitted'
          ? `Change Order #${nextCoNumber} has been submitted for approval${recipientInfo} and saved to the project.`
          : `Change Order #${nextCoNumber} has been saved to the project. You can view it in the project's Change Orders section.`,
      );
    }

    router.back();
  }, [projectId, description, reason, scheduleImpactDays, lineItems, originalContractValue, changeAmount, newContractTotal, existingCO, nextCoNumber, addChangeOrder, updateChangeOrder, router]);

  const handleSendPress = useCallback(() => {
    setShowSendRecipient(true);
  }, []);

  const handleConfirmSend = useCallback(async () => {
    if (!sendRecipientEmail.trim()) {
      Alert.alert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    setShowSendRecipient(false);

    if (sendRecipientEmail.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const html = buildChangeOrderEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        coNumber: existingCO?.number ?? nextCoNumber,
        description: description.trim(),
        changeAmount,
        newContractTotal,
        contactName: branding.contactName,
        contactEmail: branding.email,
      });

      const result = await sendEmail({
        to: sendRecipientEmail.trim(),
        subject: `${branding.companyName || 'MAGE ID'} - Change Order #${existingCO?.number ?? nextCoNumber} - ${project?.name ?? 'Project'}`,
        html,
        replyTo: branding.email || undefined,
      });

      if (!result.success) {
        if (result.error === 'cancelled') {
          return;
        }
        console.warn('[ChangeOrder] Email send failed:', result.error);
        Alert.alert('Email Notice', `Change order saved but email could not be sent: ${result.error}`);
        return;
      } else {
        console.log('[ChangeOrder] Email sent successfully');
      }
    }

    handleSave('submitted', sendRecipientName, sendRecipientEmail);
  }, [handleSave, sendRecipientName, sendRecipientEmail, settings, project, existingCO, nextCoNumber, description, changeAmount, newContractTotal]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Change Order' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLocked = existingCO?.status === 'approved' || existingCO?.status === 'rejected' || existingCO?.status === 'void';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: existingCO ? `CO #${existingCO.number}` : `New Change Order`,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Change Order #{nextCoNumber}</Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            {existingCO && (
              <View style={[styles.statusBadge, statusColors[existingCO.status]]}>
                <Text style={[styles.statusText, { color: statusTextColors[existingCO.status] }]}>
                  {existingCO.status.charAt(0).toUpperCase() + existingCO.status.slice(1)}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Original Contract</Text>
              <Text style={styles.totalValue}>${originalContractValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: changeAmount >= 0 ? Colors.accent : Colors.success }]}>
                This CO Amount
              </Text>
              <Text style={[styles.totalValueBold, { color: changeAmount >= 0 ? Colors.accent : Colors.success }]}>
                {changeAmount >= 0 ? '+' : ''}{formatCurrency(changeAmount)}
              </Text>
            </View>
            <View style={styles.dividerThick} />
            <View style={styles.totalRow}>
              <Text style={styles.grandLabel}>New Contract Total</Text>
              <Text style={styles.grandValue}>{formatCurrency(newContractTotal)}</Text>
            </View>
          </View>

          {!isLocked && (
            <>
              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={styles.textArea}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe the change..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  testID="co-description-input"
                />
              </View>

              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Reason</Text>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Why is this change needed?"
                  placeholderTextColor={Colors.textMuted}
                  testID="co-reason-input"
                />
              </View>

              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Schedule Impact (days)</Text>
                <TextInput
                  style={styles.input}
                  value={scheduleImpactDays}
                  onChangeText={setScheduleImpactDays}
                  placeholder="Additional days added to project (0 if none)"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  testID="co-schedule-impact-input"
                />
                <Text style={styles.helperText}>When approved, these days extend the project schedule automatically.</Text>
              </View>

              <View style={{ paddingHorizontal: 16 }}>
                <AIChangeOrderImpact
                  changeDescription={description}
                  lineItems={lineItems.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total }))}
                  schedule={project?.schedule ?? null}
                />
              </View>
            </>
          )}

          {isLocked && (
            <View style={styles.fieldSection}>
              <View style={styles.lockedCard}>
                <Text style={styles.lockedTitle}>{existingCO?.description}</Text>
                {existingCO?.reason ? <Text style={styles.lockedSub}>Reason: {existingCO.reason}</Text> : null}
                {existingCO?.scheduleImpactDays ? (
                  <Text style={styles.lockedSub}>
                    Schedule Impact: +{existingCO.scheduleImpactDays} day{existingCO.scheduleImpactDays === 1 ? '' : 's'}
                    {existingCO.scheduleImpactApplied ? ' (applied to schedule)' : ''}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          <View style={styles.fieldSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>Line Items</Text>
              {!isLocked && (
                <View style={styles.addBtnRow}>
                  <TouchableOpacity
                    style={styles.addSearchBtn}
                    onPress={() => { setMaterialQuery(''); setShowMaterialSearch(true); }}
                    activeOpacity={0.7}
                    testID="search-materials-btn"
                  >
                    <Search size={14} color={Colors.success} />
                    <Text style={styles.addSearchBtnText}>Materials</Text>
                  </TouchableOpacity>
                  {estimateItems.length > 0 && (
                    <TouchableOpacity
                      style={styles.addFromBtn}
                      onPress={() => setShowEstimateItems(true)}
                      activeOpacity={0.7}
                    >
                      <FileText size={14} color={Colors.info} />
                      <Text style={styles.addFromBtnText}>Estimate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.addNewBtn}
                    onPress={() => setShowAddItem(true)}
                    activeOpacity={0.7}
                    testID="add-co-item-btn"
                  >
                    <Plus size={14} color={Colors.primary} />
                    <Text style={styles.addNewBtnText}>Custom</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {lineItems.length === 0 && (
              <View style={styles.emptyItems}>
                <Text style={styles.emptyItemsText}>No line items yet. Add items to define this change order.</Text>
              </View>
            )}

            {lineItems.map((item) => (
              <View key={item.id} style={styles.lineItemCard}>
                <View style={styles.lineItemHeader}>
                  <View style={styles.lineItemNameRow}>
                    {item.isNew && <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>}
                    <Text style={styles.lineItemName} numberOfLines={1}>{item.name}</Text>
                  </View>
                  {!isLocked && (
                    <TouchableOpacity onPress={() => handleRemoveItem(item.id)} activeOpacity={0.7}>
                      <Trash2 size={16} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                {!isLocked ? (
                  <View style={styles.lineItemFields}>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Qty</Text>
                      <TextInput
                        style={styles.lineItemInput}
                        value={item.quantity.toString()}
                        onChangeText={(v) => handleUpdateItemQty(item.id, v)}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Unit</Text>
                      <Text style={styles.lineItemUnitText}>{item.unit}</Text>
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Price</Text>
                      <TextInput
                        style={styles.lineItemInput}
                        value={item.unitPrice.toString()}
                        onChangeText={(v) => handleUpdateItemPrice(item.id, v)}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Total</Text>
                      <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.lineItemFields}>
                    <Text style={styles.lockedFieldText}>{item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}</Text>
                    <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        {!isLocked && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={styles.saveProjectBtn}
              onPress={() => handleSave('draft')}
              activeOpacity={0.7}
              testID="save-co-draft"
            >
              <Text style={styles.saveProjectBtnText}>Save to Project</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={handleSendPress}
              activeOpacity={0.7}
              testID="send-co-btn"
            >
              <Send size={16} color={Colors.textOnPrimary} />
              <Text style={styles.sendBtnText}>Send & Save</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={showSendRecipient} transparent animationType="slide" onRequestClose={() => setShowSendRecipient(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Send for Approval To</Text>
                <TouchableOpacity onPress={() => setShowSendRecipient(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn}>
                    <X size={12} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Approver Name</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientName}
                    onChangeText={setSendRecipientName}
                    placeholder="Enter name or pick from contacts"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {contacts.length > 0 && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={Colors.primary} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sendBtn} onPress={handleConfirmSend} activeOpacity={0.7}>
                  <Send size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.sendBtnText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => { setShowContactPicker(false); setTimeout(() => setShowSendRecipient(true), 350); }}
        contacts={contacts}
        title="Select Approver"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      <Modal visible={showAddItem} transparent animationType="slide" onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add New Item</Text>
                <TouchableOpacity onPress={() => setShowAddItem(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Item Name</Text>
              <TextInput style={styles.modalInput} value={newItemName} onChangeText={setNewItemName} placeholder="Item name" placeholderTextColor={Colors.textMuted} />
              <Text style={styles.modalFieldLabel}>Description</Text>
              <TextInput style={styles.modalInput} value={newItemDesc} onChangeText={setNewItemDesc} placeholder="Optional description" placeholderTextColor={Colors.textMuted} />
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Quantity</Text>
                  <TextInput style={styles.modalInput} value={newItemQty} onChangeText={setNewItemQty} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Unit</Text>
                  <TextInput style={styles.modalInput} value={newItemUnit} onChangeText={setNewItemUnit} placeholder="ea, sq ft..." placeholderTextColor={Colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Unit Price</Text>
                  <TextInput style={styles.modalInput} value={newItemPrice} onChangeText={setNewItemPrice} placeholder="0.00" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
                </View>
              </View>
              <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddNewItem} activeOpacity={0.85}>
                <Text style={styles.modalAddBtnText}>Add Item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEstimateItems} transparent animationType="slide" onRequestClose={() => setShowEstimateItems(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '70%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add from Estimate</Text>
              <TouchableOpacity onPress={() => setShowEstimateItems(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {estimateItems.map((item, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.estimateItemRow}
                  onPress={() => handleAddFromEstimate(item)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.estimateItemName}>{item.name}</Text>
                    <Text style={styles.estimateItemMeta}>{item.category} · {formatCurrency(item.unitPrice)}/{item.unit}</Text>
                  </View>
                  <Plus size={18} color={Colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showMaterialSearch} transparent animationType="slide" onRequestClose={() => setShowMaterialSearch(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Search Materials</Text>
              <TouchableOpacity onPress={() => setShowMaterialSearch(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>

            <View style={styles.matSearchBar}>
              <Search size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.matSearchInput}
                value={materialQuery}
                onChangeText={setMaterialQuery}
                placeholder="Search lumber, concrete, HVAC..."
                placeholderTextColor={Colors.textMuted}
                autoFocus
                testID="co-material-search"
              />
              {materialQuery.length > 0 && (
                <TouchableOpacity onPress={() => setMaterialQuery('')}>
                  <X size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.priceTypeRow}>
              <TouchableOpacity
                style={[styles.priceTypeChip, selectedPriceType === 'retail' && styles.priceTypeChipActive]}
                onPress={() => setSelectedPriceType('retail')}
              >
                <Text style={[styles.priceTypeText, selectedPriceType === 'retail' && styles.priceTypeTextActive]}>Retail</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.priceTypeChip, selectedPriceType === 'bulk' && styles.priceTypeChipActive]}
                onPress={() => setSelectedPriceType('bulk')}
              >
                <Text style={[styles.priceTypeText, selectedPriceType === 'bulk' && styles.priceTypeTextActive]}>Bulk</Text>
              </TouchableOpacity>
              <View style={styles.matMarkupRow}>
                <Percent size={12} color={Colors.accent} />
                <TextInput
                  style={styles.matMarkupInput}
                  value={itemMarkup}
                  onChangeText={setItemMarkup}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.matMarkupLabel}>markup</Text>
              </View>
            </View>

            <Text style={styles.matResultCount}>{filteredMaterials.length} results</Text>

            <FlatList
              data={filteredMaterials}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: material }) => {
                const price = selectedPriceType === 'bulk' ? material.baseBulkPrice : material.baseRetailPrice;
                const markup = parseFloat(itemMarkup) || 0;
                const finalPrice = price * (1 + markup / 100);
                const catLabel = CATEGORY_META[material.category]?.label ?? material.category;
                const origEst = estimateItems.find(e => e.name === material.name);
                return (
                  <TouchableOpacity
                    style={styles.matResultRow}
                    onPress={() => handleAddFromMaterials(material)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matResultName} numberOfLines={1}>{material.name}</Text>
                      <View style={styles.matResultMeta}>
                        <Text style={styles.matResultCat}>{catLabel}</Text>
                        <Text style={styles.matResultSupplier}>{material.supplier}</Text>
                      </View>
                      {origEst && (
                        <Text style={styles.matOriginalPrice}>Original estimate: {formatCurrency(origEst.unitPrice)}/{origEst.unit}</Text>
                      )}
                    </View>
                    <View style={styles.matResultPrices}>
                      <Text style={styles.matResultRetail}>${material.baseRetailPrice.toFixed(2)}</Text>
                      <Text style={styles.matResultBulk}>${material.baseBulkPrice.toFixed(2)}</Text>
                      {markup > 0 && <Text style={styles.matResultFinal}>${finalPrice.toFixed(2)}</Text>}
                    </View>
                    <Plus size={18} color={Colors.primary} />
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const statusColors: Record<string, { backgroundColor: string }> = {
  draft: { backgroundColor: Colors.fillTertiary },
  submitted: { backgroundColor: Colors.infoLight },
  under_review: { backgroundColor: Colors.warningLight },
  sent: { backgroundColor: Colors.infoLight },
  approved: { backgroundColor: Colors.successLight },
  rejected: { backgroundColor: Colors.errorLight },
  revised: { backgroundColor: Colors.warningLight },
  void: { backgroundColor: Colors.fillTertiary },
};

const statusTextColors: Record<string, string> = {
  draft: Colors.textSecondary,
  submitted: Colors.info,
  under_review: Colors.warning,
  sent: Colors.info,
  approved: Colors.success,
  rejected: Colors.error,
  revised: Colors.warning,
  void: Colors.textMuted,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '600' as const },
  heroCard: { backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 16, borderRadius: 16, padding: 20, gap: 4 },
  heroLabel: { fontSize: 13, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: 20, fontWeight: '700' as const, color: Colors.textOnPrimary },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700' as const },
  totalsCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: Colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: Colors.cardBorder },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  totalLabel: { fontSize: 15, color: Colors.textSecondary, fontWeight: '500' as const },
  totalValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  totalValueBold: { fontSize: 17, fontWeight: '700' as const },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 4 },
  dividerThick: { height: 2, backgroundColor: Colors.primary + '30', borderRadius: 1, marginVertical: 6 },
  grandLabel: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  grandValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  fieldSection: { marginHorizontal: 20, marginTop: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  helperText: { fontSize: 11, color: Colors.textMuted, marginTop: 6, fontStyle: 'italic' as const },
  input: { minHeight: 48, borderRadius: 14, backgroundColor: Colors.card, paddingHorizontal: 14, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  textArea: { minHeight: 90, borderRadius: 14, backgroundColor: Colors.card, paddingHorizontal: 14, paddingTop: 12, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addBtnRow: { flexDirection: 'row', gap: 8 },
  addFromBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.infoLight },
  addFromBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  addNewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primary + '15' },
  addNewBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  emptyItems: { backgroundColor: Colors.card, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder },
  emptyItemsText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const },
  lineItemCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  lineItemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  newBadge: { backgroundColor: Colors.accent + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  newBadgeText: { fontSize: 9, fontWeight: '700' as const, color: Colors.accent },
  lineItemName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, flex: 1 },
  lineItemFields: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineItemFieldSmall: { flex: 1, gap: 2 },
  lineItemFieldLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  lineItemInput: { minHeight: 36, borderRadius: 8, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 8, fontSize: 14, color: Colors.text },
  lineItemUnitText: { fontSize: 14, color: Colors.textSecondary, paddingVertical: 8 },
  lineItemTotal: { fontSize: 15, fontWeight: '700' as const, color: Colors.primary },
  lockedCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  lockedTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  lockedSub: { fontSize: 13, color: Colors.textSecondary },
  lockedFieldText: { flex: 1, fontSize: 14, color: Colors.textSecondary },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary + '15', borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.textOnPrimary },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary + '10', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: Colors.primary + '25' },
  selectedRecipientName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  selectedRecipientEmail: { fontSize: 12, color: Colors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.primary + '10' },
  pickContactText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  modalFieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 15, color: Colors.text },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalAddBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalAddBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  estimateItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 12 },
  estimateItemName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  estimateItemMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addSearchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.successLight },
  addSearchBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.success },
  matSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 44, borderWidth: 1, borderColor: Colors.cardBorder },
  matSearchInput: { flex: 1, fontSize: 15, color: Colors.text },
  priceTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priceTypeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  priceTypeChipActive: { backgroundColor: Colors.primary },
  priceTypeText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  priceTypeTextActive: { color: Colors.textOnPrimary },
  matMarkupRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' as const, backgroundColor: Colors.fillTertiary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  matMarkupInput: { width: 36, fontSize: 14, fontWeight: '600' as const, color: Colors.text, textAlign: 'center' as const },
  matMarkupLabel: { fontSize: 11, color: Colors.textMuted },
  matResultCount: { fontSize: 11, color: Colors.textMuted, marginTop: 6, marginBottom: 4 },
  matResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 10 },
  matResultName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  matResultMeta: { flexDirection: 'row', gap: 8, marginTop: 2 },
  matResultCat: { fontSize: 11, color: Colors.info, fontWeight: '500' as const },
  matResultSupplier: { fontSize: 11, color: Colors.textMuted },
  matOriginalPrice: { fontSize: 10, color: Colors.warning, fontWeight: '500' as const, marginTop: 2 },
  matResultPrices: { alignItems: 'flex-end', gap: 1 },
  matResultRetail: { fontSize: 11, color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  matResultBulk: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  matResultFinal: { fontSize: 10, color: Colors.accent, fontWeight: '600' as const },
});

```


---

### `app/aia-pay-app.tsx`

```tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileText, Download, Info, Percent, Printer, TrendingUp,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import {
  AIAPayApplication,
  AIASOVLine,
  seedAIAPayApplicationFromInvoice,
  computeAIATotals,
  generateAIAPayAppPDF,
} from '@/utils/aiaBilling';

export default function AIAPayAppScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const {
    invoices, getProject, getChangeOrdersForProject, settings,
  } = useProjects();

  const invoice = useMemo(() => invoices.find(i => i.id === invoiceId), [invoices, invoiceId]);
  const project = useMemo(() => (invoice ? getProject(invoice.projectId) : undefined), [invoice, getProject]);
  const approvedCOs = useMemo(() =>
    (invoice && project ? getChangeOrdersForProject(project.id).filter(co => co.status === 'approved') : []),
    [invoice, project, getChangeOrdersForProject]);

  const [app, setApp] = useState<AIAPayApplication | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!invoice || !project || !settings?.branding) return;
    const seeded = seedAIAPayApplicationFromInvoice(invoice, project, approvedCOs, settings.branding);
    setApp(seeded);
  }, [invoice, project, approvedCOs, settings?.branding]);

  const totals = useMemo(() => (app ? computeAIATotals(app) : null), [app]);

  const updateLine = useCallback((lineId: string, patch: Partial<AIASOVLine>) => {
    setApp(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => l.id === lineId ? { ...l, ...patch } : l),
    } : prev);
  }, []);

  const applyPercentToLine = useCallback((lineId: string, percent: number) => {
    setApp(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map(l => {
          if (l.id !== lineId) return l;
          const totalCompleted = Math.max(0, Math.min(l.scheduledValue, l.scheduledValue * (percent / 100)));
          const thisPeriod = Math.max(0, totalCompleted - l.fromPreviousApp);
          return { ...l, thisPeriod };
        }),
      };
    });
  }, []);

  const updateRetainagePctAll = useCallback((pct: number) => {
    setApp(prev => prev ? {
      ...prev,
      retainagePercent: pct,
      lines: prev.lines.map(l => ({ ...l, retainagePercent: pct })),
    } : prev);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!app || !settings?.branding) return;
    setGenerating(true);
    try {
      await generateAIAPayAppPDF(app, settings.branding);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Error', 'Could not generate the pay application PDF.');
    } finally {
      setGenerating(false);
    }
  }, [app, settings?.branding]);

  if (!invoice || !project) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Pay Application' }} />
        <Info size={32} color={Colors.textMuted} />
        <Text style={styles.loadingText}>Invoice not found.</Text>
      </View>
    );
  }

  if (!app || !totals) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Pay Application' }} />
        <ConstructionLoader size="lg" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'AIA Pay Application',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero summary card */}
        <View style={styles.hero}>
          <View style={styles.heroHeaderRow}>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroLabel}>G702 · G703</Text>
              <Text style={styles.heroTitle}>Pay Application #{app.applicationNumber}</Text>
              <Text style={styles.heroSub}>{project.name}</Text>
            </View>
            <View style={styles.progressBadge}>
              <Text style={styles.progressBadgeNum}>{totals.percentComplete.toFixed(0)}%</Text>
              <Text style={styles.progressBadgeLabel}>Complete</Text>
            </View>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Contract Sum</Text>
              <Text style={styles.heroStatValue}>{formatMoney(app.contractSumToDate)}</Text>
              {app.netChangeByCO !== 0 && (
                <Text style={styles.heroStatSub}>
                  incl. {app.netChangeByCO >= 0 ? '+' : '-'}{formatMoney(Math.abs(app.netChangeByCO))} COs
                </Text>
              )}
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>This Period Due</Text>
              <Text style={[styles.heroStatValue, { color: Colors.primary }]}>
                {formatMoney(totals.currentPaymentDue)}
              </Text>
              <Text style={styles.heroStatSub}>after retainage</Text>
            </View>
          </View>
        </View>

        {/* Header meta */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Application Details</Text>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Owner Name</Text>
            <TextInput
              style={styles.formInput}
              value={app.ownerName}
              onChangeText={v => setApp(p => p ? { ...p, ownerName: v } : p)}
              placeholder="Owner / Client name"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Architect</Text>
            <TextInput
              style={styles.formInput}
              value={app.architectName ?? ''}
              onChangeText={v => setApp(p => p ? { ...p, architectName: v } : p)}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Less Previous Certificates</Text>
            <TextInput
              style={styles.formInput}
              value={String(app.lessPreviousCertificates)}
              onChangeText={v => {
                const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
                setApp(p => p ? { ...p, lessPreviousCertificates: isNaN(n) ? 0 : n } : p);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Retainage %</Text>
            <View style={styles.retainageChips}>
              {[0, 5, 10].map(pct => (
                <TouchableOpacity
                  key={pct}
                  onPress={() => updateRetainagePctAll(pct)}
                  style={[styles.chip, app.retainagePercent === pct && styles.chipActive]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, app.retainagePercent === pct && styles.chipTextActive]}>
                    {pct}%
                  </Text>
                </TouchableOpacity>
              ))}
              <TextInput
                style={[styles.formInput, { width: 70, textAlign: 'center' }]}
                value={String(app.retainagePercent)}
                onChangeText={v => {
                  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
                  updateRetainagePctAll(isNaN(n) ? 0 : Math.max(0, Math.min(50, n)));
                }}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        {/* Schedule of Values */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Schedule of Values (G703)</Text>
            <Text style={styles.sectionTitleCount}>{app.lines.length} items</Text>
          </View>
          <Text style={styles.sectionHint}>
            Tap a line to adjust this period's work completed. Use the % slider to quickly set line progress.
          </Text>

          {app.lines.map(line => {
            const totalCompleted = line.fromPreviousApp + line.thisPeriod + line.materialsPresentlyStored;
            const pct = line.scheduledValue > 0 ? (totalCompleted / line.scheduledValue) * 100 : 0;
            return (
              <View key={line.id} style={styles.sovCard}>
                <View style={styles.sovHeaderRow}>
                  <View style={styles.sovItemNoPill}>
                    <Text style={styles.sovItemNoText}>#{line.itemNo}</Text>
                  </View>
                  <Text style={styles.sovDescription} numberOfLines={2}>{line.description}</Text>
                </View>

                <View style={styles.sovValueRow}>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>Scheduled</Text>
                    <Text style={styles.sovValueNum}>{formatMoney(line.scheduledValue)}</Text>
                  </View>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>This Period</Text>
                    <TextInput
                      style={styles.sovInput}
                      value={line.thisPeriod.toFixed(2)}
                      onChangeText={v => {
                        const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
                        updateLine(line.id, { thisPeriod: isNaN(n) ? 0 : n });
                      }}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>Stored</Text>
                    <TextInput
                      style={styles.sovInput}
                      value={line.materialsPresentlyStored.toFixed(2)}
                      onChangeText={v => {
                        const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
                        updateLine(line.id, { materialsPresentlyStored: isNaN(n) ? 0 : n });
                      }}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                </View>

                <View style={styles.sovProgressRow}>
                  <View style={styles.sovProgressBar}>
                    <View style={[styles.sovProgressFill, { width: `${Math.min(100, pct)}%` as any }]} />
                  </View>
                  <Text style={styles.sovProgressPct}>{pct.toFixed(0)}%</Text>
                </View>

                <View style={styles.sovQuickRow}>
                  {[25, 50, 75, 100].map(q => (
                    <TouchableOpacity
                      key={q}
                      onPress={() => applyPercentToLine(line.id, q)}
                      style={styles.sovQuickBtn}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.sovQuickText}>{q}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}
        </View>

        {/* Running totals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary (G702 Cover)</Text>
          <View style={styles.totalsCard}>
            <Row label="Original Contract Sum" value={formatMoney(app.originalContractSum)} />
            <Row label="Net Change by COs" value={`${app.netChangeByCO >= 0 ? '+' : '-'}${formatMoney(Math.abs(app.netChangeByCO))}`} />
            <Row label="Contract Sum to Date" value={formatMoney(app.contractSumToDate)} bold />
            <Divider />
            <Row label="Total Completed & Stored" value={formatMoney(totals.totalCompletedAndStored)} />
            <Row label={`Retainage (${app.retainagePercent}%)`} value={`-${formatMoney(totals.totalRetainage)}`} dim />
            <Row label="Total Earned Less Retainage" value={formatMoney(totals.totalEarnedLessRetainage)} />
            <Row label="Less Previous Certificates" value={`-${formatMoney(app.lessPreviousCertificates)}`} dim />
            <Divider />
            <Row label="Current Payment Due" value={formatMoney(totals.currentPaymentDue)} highlight />
            <Row label="Balance to Finish" value={formatMoney(totals.balanceToFinish)} dim />
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={styles.generateBtn}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.85}
        >
          {generating
            ? <ActivityIndicator size="small" color="#FFF" />
            : <Printer size={18} color="#FFF" />
          }
          <Text style={styles.generateBtnText}>
            {generating ? 'Generating…' : 'Generate G702/G703 PDF'}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function Row({ label, value, bold, dim, highlight }: { label: string; value: string; bold?: boolean; dim?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.totalsRow}>
      <Text style={[styles.totalsLabel, dim && { color: Colors.textMuted }]}>{label}</Text>
      <Text style={[
        styles.totalsValue,
        bold && { fontWeight: '700' },
        dim && { color: Colors.textMuted },
        highlight && { color: Colors.primary, fontSize: 17, fontWeight: '800' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.totalsDivider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: Colors.background },
  loadingText: { fontSize: 14, color: Colors.textMuted },

  hero: {
    margin: 16, padding: 16, borderRadius: 16,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroTitleBlock: { flex: 1 },
  heroLabel: { fontSize: 10, color: Colors.primary, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  heroTitle: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 2 },
  heroSub: { fontSize: 13, color: Colors.textMuted },
  progressBadge: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 50,
    width: 68, height: 68,
  },
  progressBadgeNum: { fontSize: 18, fontWeight: '800', color: '#FFF', lineHeight: 20 },
  progressBadgeLabel: { fontSize: 9, color: '#FFFFFFCC', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  heroStats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  heroStat: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border },
  heroStatLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  heroStatValue: { fontSize: 18, fontWeight: '800', color: Colors.text },
  heroStatSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },

  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  sectionTitleCount: { fontSize: 12, color: Colors.textMuted },
  sectionHint: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 16 },

  formRow: { marginBottom: 10 },
  formLabel: { fontSize: 12, color: Colors.textMuted, marginBottom: 4, fontWeight: '600' },
  formInput: {
    backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text,
  },

  retainageChips: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  chipTextActive: { color: '#FFF' },

  sovCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: Colors.border,
  },
  sovHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  sovItemNoPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.primary + '15',
  },
  sovItemNoText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  sovDescription: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.text, lineHeight: 18 },

  sovValueRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sovValueCol: { flex: 1 },
  sovValueLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  sovValueNum: { fontSize: 14, fontWeight: '700', color: Colors.text },
  sovInput: {
    backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 8, paddingVertical: 8, fontSize: 13, color: Colors.text,
  },

  sovProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sovProgressBar: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  sovProgressFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 3 },
  sovProgressPct: { fontSize: 11, fontWeight: '700', color: Colors.text, width: 38, textAlign: 'right' },

  sovQuickRow: { flexDirection: 'row', gap: 6 },
  sovQuickBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 6,
    backgroundColor: Colors.background, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  sovQuickText: { fontSize: 11, fontWeight: '600', color: Colors.text },

  totalsCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalsLabel: { fontSize: 13, color: Colors.text },
  totalsValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  totalsDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 16, paddingTop: 12,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14,
  },
  generateBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});

```


---

### `app/cash-flow.tsx`

```tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  Platform, KeyboardAvoidingView, ActivityIndicator, Alert, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, TrendingDown, DollarSign, Plus, X, Trash2, Edit3,
  AlertTriangle, CheckCircle, Sparkles, ChevronDown, ChevronUp,
  Calendar, Clock, Wallet, BarChart3, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useProjects } from '@/contexts/ProjectContext';
import CashFlowChart from '@/components/CashFlowChart';
import CashFlowSetup from '@/components/CashFlowSetup';
import {
  generateForecast, calculateSummary, formatCurrency, formatCurrencyShort,
  getEffectiveStartingBalance,
} from '@/utils/cashFlowEngine';
import type { CashFlowExpense, ExpectedPayment, CashFlowWeek, CashFlowSummary, ExpenseCategory, ExpenseFrequency } from '@/utils/cashFlowEngine';
import {
  loadCashFlowData, saveCashFlowData, isSetupComplete, markSetupComplete,
  getCachedAIAnalysis, setCachedAIAnalysis,
} from '@/utils/cashFlowStorage';
import type { CashFlowData } from '@/utils/cashFlowStorage';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';

// Gemini occasionally swaps shapes — returning strings where objects are expected
// or vice versa. These preprocess coercers normalize the payload so the UI never
// crashes on a bad shape.
const coerceStringArray = z.preprocess(
  (v) => {
    if (Array.isArray(v)) {
      return v.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          // Pull a sensible string out of {action, description, ...}
          const obj = item as Record<string, unknown>;
          return String(obj.action ?? obj.description ?? obj.text ?? obj.title ?? JSON.stringify(obj));
        }
        return String(item ?? '');
      });
    }
    if (typeof v === 'string') return [v];
    if (v && typeof v === 'object') return Object.values(v).map((x) => String(x));
    return [];
  },
  z.array(z.string()).default([]),
);

const recommendationItemSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      // Model returned a plain string — wrap it as an object.
      return { priority: 'important', action: v, impact: '', difficulty: 'moderate' };
    }
    return v;
  },
  z.object({
    priority: z.enum(['urgent', 'important', 'suggestion']).catch('important').default('important'),
    action: z.string().catch('').default(''),
    impact: z.string().catch('').default(''),
    difficulty: z.enum(['easy', 'moderate', 'hard']).catch('moderate').default('moderate'),
  }),
);

const cashFlowAnalysisSchema = z.object({
  overallHealth: z.enum(['healthy', 'caution', 'danger']).catch('caution').default('caution'),
  healthScore: z.number().catch(50).default(50),
  criticalWeeks: z.array(z.object({
    weekNumber: z.number().catch(0).default(0),
    weekDate: z.string().catch('').default(''),
    balance: z.number().catch(0).default(0),
    problem: z.string().catch('').default(''),
  })).default([]),
  recommendations: z.array(recommendationItemSchema).default([]),
  billingOptimizations: coerceStringArray,
  expenseReductions: coerceStringArray,
  summary: z.string().default(''),
});

type AIAnalysis = z.infer<typeof cashFlowAnalysisSchema>;

const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'payroll', label: 'Payroll' },
  { value: 'materials', label: 'Materials' },
  { value: 'equipment_rental', label: 'Equipment Rental' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'loan', label: 'Loan/Financing' },
  { value: 'other', label: 'Other' },
];

const FREQUENCY_OPTIONS: Array<{ value: ExpenseFrequency; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'one_time', label: 'One-time' },
];

const FORECAST_OPTIONS = [
  { weeks: 4, label: '4w' },
  { weeks: 8, label: '8w' },
  { weeks: 12, label: '12w' },
  { weeks: 24, label: '6mo' },
  { weeks: 52, label: '1yr' },
];

const MIN_FORECAST_WEEKS = 1;
const MAX_FORECAST_WEEKS = 260; // 5 years — plenty of headroom for long projects.

export default function CashFlowScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('cash_flow_forecaster')) {
    return (
      <Paywall
        visible={true}
        feature="Cash Flow Forecaster"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <CashFlowScreenInner />;
}

function CashFlowScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices: allInvoices, getInvoicesForProject, changeOrders: allChangeOrders, getChangeOrdersForProject } = useProjects();

  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [cashFlowData, setCashFlowData] = useState<CashFlowData | null>(null);
  const [forecastWeeks, setForecastWeeks] = useState(12);
  const [customWeeksInput, setCustomWeeksInput] = useState('');
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showEditBalance, setShowEditBalance] = useState(false);
  const [editBalanceValue, setEditBalanceValue] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    expenses: false,
    income: false,
    weekDetail: true,
  });

  const [newExpenseName, setNewExpenseName] = useState('');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseCategory, setNewExpenseCategory] = useState<ExpenseCategory>('other');
  const [newExpenseFrequency, setNewExpenseFrequency] = useState<ExpenseFrequency>('monthly');

  const [newPaymentDesc, setNewPaymentDesc] = useState('');
  const [newPaymentAmount, setNewPaymentAmount] = useState('');
  const [newPaymentDate, setNewPaymentDate] = useState('');
  const [newPaymentConfidence, setNewPaymentConfidence] = useState<'confirmed' | 'expected' | 'hopeful'>('expected');

  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiResults, setShowAiResults] = useState(false);

  const relevantInvoices = useMemo(() => {
    if (projectId) return getInvoicesForProject(projectId);
    return allInvoices;
  }, [projectId, allInvoices, getInvoicesForProject]);

  const relevantChangeOrders = useMemo(() => {
    if (projectId) return getChangeOrdersForProject(projectId);
    return allChangeOrders;
  }, [projectId, allChangeOrders, getChangeOrdersForProject]);

  useEffect(() => {
    const init = async () => {
      console.log('[CashFlow] Initializing...');
      const setupDone = await isSetupComplete();
      const data = await loadCashFlowData();
      setCashFlowData(data);
      if (!setupDone) {
        setShowSetup(true);
      }
      const cached = await getCachedAIAnalysis(projectId);
      if (cached) {
        setAiAnalysis(cached.data as AIAnalysis);
      }
      setLoading(false);
    };
    void init();
  }, [projectId]);

  const effectiveStartingBalance = useMemo<number>(() => {
    if (!cashFlowData) return 0;
    return getEffectiveStartingBalance(
      cashFlowData.startingBalance,
      cashFlowData.balanceAsOf,
      relevantInvoices,
    );
  }, [cashFlowData, relevantInvoices]);

  const forecast = useMemo<CashFlowWeek[]>(() => {
    if (!cashFlowData) return [];
    return generateForecast(
      effectiveStartingBalance,
      cashFlowData.expenses,
      relevantInvoices,
      cashFlowData.expectedPayments,
      forecastWeeks,
      cashFlowData.defaultPaymentTerms,
      relevantChangeOrders,
    );
  }, [cashFlowData, effectiveStartingBalance, relevantInvoices, relevantChangeOrders, forecastWeeks]);

  const summary = useMemo<CashFlowSummary>(() => calculateSummary(forecast), [forecast]);

  // Aggregate "Total Pending" across every source of expected money that hasn't landed:
  //   - unpaid invoice balances (totalDue - amountPaid)
  //   - manually-entered expected payments
  //   - approved change orders not yet rolled into an invoice
  // Used for the Expected Income header so the GC can see the real dollar figure,
  // not just a "3 pending" count.
  const totalPending = useMemo(() => {
    const invoiceTotal = relevantInvoices
      .filter(i => i.status !== 'paid')
      .reduce((sum, i) => sum + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0);
    const expectedTotal = (cashFlowData?.expectedPayments ?? [])
      .reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const changeOrderTotal = relevantChangeOrders
      .filter(co => co.status === 'approved')
      .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
    return invoiceTotal + expectedTotal + changeOrderTotal;
  }, [relevantInvoices, cashFlowData?.expectedPayments, relevantChangeOrders]);

  const pendingCount = useMemo(() => {
    const inv = relevantInvoices.filter(i => i.status !== 'paid').length;
    const exp = (cashFlowData?.expectedPayments ?? []).length;
    const co = relevantChangeOrders.filter(c => c.status === 'approved').length;
    return inv + exp + co;
  }, [relevantInvoices, cashFlowData?.expectedPayments, relevantChangeOrders]);

  const selectedWeekData = useMemo(() => {
    if (selectedWeek === null || !forecast[selectedWeek]) return null;
    return forecast[selectedWeek];
  }, [selectedWeek, forecast]);

  const handleSetupComplete = useCallback(async (data: CashFlowData) => {
    setCashFlowData(data);
    await saveCashFlowData(data);
    await markSetupComplete();
    setShowSetup(false);
    console.log('[CashFlow] Setup complete');
  }, []);

  const handleUpdateBalance = useCallback(async () => {
    if (!cashFlowData) return;
    const bal = parseFloat(editBalanceValue) || 0;
    // Stamp balanceAsOf so future invoice payments can be auto-added on top of
    // this balance without the GC having to manually re-edit every time a check clears.
    const updated = { ...cashFlowData, startingBalance: bal, balanceAsOf: new Date().toISOString() };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    setShowEditBalance(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [cashFlowData, editBalanceValue]);

  const handleAddExpense = useCallback(async () => {
    if (!cashFlowData || !newExpenseName.trim()) return;
    const expense: CashFlowExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newExpenseName.trim(),
      amount: parseFloat(newExpenseAmount) || 0,
      frequency: newExpenseFrequency,
      category: newExpenseCategory,
      startDate: new Date().toISOString(),
    };
    const updated = { ...cashFlowData, expenses: [...cashFlowData.expenses, expense] };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    setShowAddExpense(false);
    setNewExpenseName('');
    setNewExpenseAmount('');
    setNewExpenseCategory('other');
    setNewExpenseFrequency('monthly');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [cashFlowData, newExpenseName, newExpenseAmount, newExpenseFrequency, newExpenseCategory]);

  const handleRemoveExpense = useCallback(async (id: string) => {
    if (!cashFlowData) return;
    const updated = { ...cashFlowData, expenses: cashFlowData.expenses.filter(e => e.id !== id) };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [cashFlowData]);

  const handleAddPayment = useCallback(async () => {
    if (!cashFlowData || !newPaymentDesc.trim()) return;
    const daysFromNow = parseInt(newPaymentDate) || 30;
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    const payment: ExpectedPayment = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: newPaymentDesc.trim(),
      amount: parseFloat(newPaymentAmount) || 0,
      expectedDate: date.toISOString(),
      confidence: newPaymentConfidence,
      projectId: projectId,
    };
    const updated = { ...cashFlowData, expectedPayments: [...cashFlowData.expectedPayments, payment] };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    setShowAddPayment(false);
    setNewPaymentDesc('');
    setNewPaymentAmount('');
    setNewPaymentDate('');
    setNewPaymentConfidence('expected');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [cashFlowData, newPaymentDesc, newPaymentAmount, newPaymentDate, newPaymentConfidence, projectId]);

  const handleRemovePayment = useCallback(async (id: string) => {
    if (!cashFlowData) return;
    const updated = { ...cashFlowData, expectedPayments: cashFlowData.expectedPayments.filter(p => p.id !== id) };
    setCashFlowData(updated);
    await saveCashFlowData(updated);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [cashFlowData]);

  const handleAIAnalysis = useCallback(async () => {
    if (forecast.length === 0 || !cashFlowData) return;
    setAiLoading(true);
    setShowAiResults(true);
    try {
      const aiResult = await mageAI({
        prompt: `You are a construction financial advisor. Analyze this contractor's cash flow forecast and provide specific, actionable advice to prevent cash shortages and improve financial health.

FORECAST DATA (next ${forecastWeeks} weeks):
${forecast.map((w, i) => `Week ${i + 1} (${w.weekStart}): Income ${w.totalIncome} | Expenses ${w.totalExpenses} | Net ${w.netCashFlow} | Balance ${w.runningBalance}`).join('\n')}

RECURRING EXPENSES:
${cashFlowData.expenses.map(e => `${e.name}: ${e.amount}/${e.frequency}`).join('\n') || 'None entered'}

PENDING INVOICES:
${relevantInvoices.filter(i => i.status !== 'paid').map(i => `#${i.number}: ${i.totalDue} | Sent: ${i.issueDate} | Terms: ${i.paymentTerms} | Due: ${i.dueDate}`).join('\n') || 'None pending'}

Identify any weeks where the balance goes negative or dangerously low (under $5,000). For each problem, give a SPECIFIC fix — not generic advice. Reference actual invoice numbers, expense names, and dollar amounts. Suggest billing optimizations and expense reductions specific to their actual data.`,
        schema: cashFlowAnalysisSchema,
        tier: 'smart',
        maxTokens: 3500,
      });
      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        return;
      }
      setAiAnalysis(aiResult.data);
      await setCachedAIAnalysis(aiResult.data, projectId);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[CashFlow] AI analysis failed:', err);
      Alert.alert('AI Unavailable', 'Cash flow analysis is unavailable right now. Try again in a moment.');
    } finally {
      setAiLoading(false);
    }
  }, [forecast, cashFlowData, forecastWeeks, relevantInvoices, projectId]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const totalMonthlyExpenses = useMemo(() => {
    if (!cashFlowData) return 0;
    return cashFlowData.expenses.reduce((sum, e) => {
      switch (e.frequency) {
        case 'weekly': return sum + e.amount * 4.33;
        case 'biweekly': return sum + e.amount * 2.17;
        case 'monthly': return sum + e.amount;
        default: return sum;
      }
    }, 0);
  }, [cashFlowData]);

  const freqLabel = (f: ExpenseFrequency) => {
    switch (f) {
      case 'weekly': return '/week';
      case 'biweekly': return '/2wk';
      case 'monthly': return '/mo';
      case 'one_time': return 'once';
    }
  };

  const confidenceBadge = (c: string) => {
    switch (c) {
      case 'confirmed': return { bg: Colors.successLight, text: Colors.success, label: 'Confirmed' };
      case 'expected': return { bg: Colors.infoLight, text: Colors.info, label: 'Expected' };
      default: return { bg: Colors.warningLight, text: Colors.warning, label: 'Hopeful' };
    }
  };

  const healthColor = (health: string) => {
    switch (health) {
      case 'healthy': return Colors.success;
      case 'caution': return Colors.warning;
      default: return Colors.error;
    }
  };

  const priorityConfig = (p: string) => {
    switch (p) {
      case 'urgent': return { bg: Colors.errorLight, text: Colors.error };
      case 'important': return { bg: Colors.warningLight, text: Colors.warning };
      default: return { bg: Colors.infoLight, text: Colors.info };
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Cash Flow' }} />
        <ConstructionLoader size="lg" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: projectId ? 'Project Cash Flow' : 'Cash Flow Forecast',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        headerRight: () => (
          <TouchableOpacity
            onPress={() => setShowSetup(true)}
            style={{ padding: 6 }}
            activeOpacity={0.7}
          >
            <Edit3 size={20} color={Colors.primary} />
          </TouchableOpacity>
        ),
      }} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={styles.heroLeft}>
              <Text style={styles.heroLabel}>
                Current Balance
                {effectiveStartingBalance !== (cashFlowData?.startingBalance ?? 0) ? ' (auto-updated)' : ''}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setEditBalanceValue(cashFlowData?.startingBalance?.toString() ?? '0');
                  setShowEditBalance(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.heroAmount}>
                  {formatCurrency(effectiveStartingBalance)}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.editBalanceBtn}
              onPress={() => {
                setEditBalanceValue(cashFlowData?.startingBalance?.toString() ?? '0');
                setShowEditBalance(true);
              }}
              activeOpacity={0.7}
            >
              <Edit3 size={14} color={Colors.primary} />
              <Text style={styles.editBalanceBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.forecastSelector}>
            {FORECAST_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.weeks}
                style={[styles.forecastChip, forecastWeeks === opt.weeks && styles.forecastChipActive]}
                onPress={() => {
                  setForecastWeeks(opt.weeks);
                  setCustomWeeksInput('');
                  setSelectedWeek(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.forecastChipText, forecastWeeks === opt.weeks && styles.forecastChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.customWeeksChip}>
              <TextInput
                style={styles.customWeeksInput}
                value={customWeeksInput}
                onChangeText={(text) => {
                  const cleaned = text.replace(/[^0-9]/g, '').slice(0, 3);
                  setCustomWeeksInput(cleaned);
                  const n = parseInt(cleaned, 10);
                  if (!isNaN(n) && n >= MIN_FORECAST_WEEKS && n <= MAX_FORECAST_WEEKS) {
                    setForecastWeeks(n);
                    setSelectedWeek(null);
                  }
                }}
                placeholder="#"
                placeholderTextColor="rgba(255,255,255,0.5)"
                keyboardType="number-pad"
                maxLength={3}
                returnKeyType="done"
              />
              <Text style={styles.customWeeksLabel}>wks</Text>
            </View>
          </View>

          <View style={styles.pendingRow}>
            <View style={styles.pendingItem}>
              <Text style={styles.pendingLabel}>Total Pending</Text>
              <Text style={styles.pendingValue}>{formatCurrency(totalPending)}</Text>
            </View>
            <View style={styles.pendingDivider} />
            <View style={styles.pendingItem}>
              <Text style={styles.pendingLabel}>Sources</Text>
              <Text style={styles.pendingValue}>{pendingCount}</Text>
            </View>
          </View>
        </View>

        {forecast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FORECAST</Text>
            <CashFlowChart
              weeks={forecast}
              onWeekPress={setSelectedWeek}
              selectedWeek={selectedWeek}
            />
          </View>
        )}

        {summary.dangerWeeks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.dangerCard}>
              <View style={styles.dangerHeader}>
                <AlertTriangle size={18} color={Colors.error} />
                <Text style={styles.dangerTitle}>Danger Zone</Text>
              </View>
              {summary.dangerWeeks.map((dw, i) => (
                <View key={i} style={styles.dangerRow}>
                  <Text style={styles.dangerDate}>
                    Week {dw.weekNumber} · {new Date(dw.weekDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  <Text style={styles.dangerBalance}>{formatCurrency(dw.balance)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {selectedWeekData && selectedWeek !== null && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              WEEK {selectedWeek + 1} DETAIL · {new Date(selectedWeekData.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
            <View style={styles.weekDetailCard}>
              <View style={styles.weekDetailRow}>
                <View style={styles.weekDetailItem}>
                  <TrendingUp size={16} color={Colors.success} />
                  <Text style={styles.weekDetailLabel}>Income</Text>
                  <Text style={[styles.weekDetailValue, { color: Colors.success }]}>
                    {formatCurrency(selectedWeekData.totalIncome)}
                  </Text>
                </View>
                <View style={styles.weekDetailItem}>
                  <TrendingDown size={16} color={Colors.error} />
                  <Text style={styles.weekDetailLabel}>Expenses</Text>
                  <Text style={[styles.weekDetailValue, { color: Colors.error }]}>
                    {formatCurrency(selectedWeekData.totalExpenses)}
                  </Text>
                </View>
                <View style={styles.weekDetailItem}>
                  <Wallet size={16} color={Colors.info} />
                  <Text style={styles.weekDetailLabel}>Balance</Text>
                  <Text style={[styles.weekDetailValue, { color: selectedWeekData.runningBalance < 0 ? Colors.error : Colors.text }]}>
                    {formatCurrency(selectedWeekData.runningBalance)}
                  </Text>
                </View>
              </View>

              {selectedWeekData.incomeItems.length > 0 && (
                <View style={styles.weekItemsGroup}>
                  <Text style={styles.weekItemsLabel}>Income</Text>
                  {selectedWeekData.incomeItems.map((item, i) => (
                    <View key={i} style={styles.weekItemRow}>
                      <Text style={styles.weekItemName} numberOfLines={1}>{item.description}</Text>
                      <Text style={[styles.weekItemAmount, { color: Colors.success }]}>+{formatCurrency(item.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {selectedWeekData.expenseItems.length > 0 && (
                <View style={styles.weekItemsGroup}>
                  <Text style={styles.weekItemsLabel}>Expenses</Text>
                  {selectedWeekData.expenseItems.map((item, i) => (
                    <View key={i} style={styles.weekItemRow}>
                      <Text style={styles.weekItemName} numberOfLines={1}>{item.description}</Text>
                      <Text style={[styles.weekItemAmount, { color: Colors.error }]}>-{formatCurrency(item.amount)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {selectedWeekData.incomeItems.length === 0 && selectedWeekData.expenseItems.length === 0 && (
                <Text style={styles.emptyWeekText}>No transactions this week</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SUMMARY ({forecastWeeks} WEEKS)</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Total Income</Text>
              <Text style={[styles.summaryItemValue, { color: Colors.success }]}>{formatCurrencyShort(summary.totalIncome)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Total Expenses</Text>
              <Text style={[styles.summaryItemValue, { color: Colors.error }]}>{formatCurrencyShort(summary.totalExpenses)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Net Profit</Text>
              <Text style={[styles.summaryItemValue, { color: summary.netProfit >= 0 ? Colors.success : Colors.error }]}>
                {formatCurrencyShort(summary.netProfit)}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryItemLabel}>Lowest Balance</Text>
              <Text style={[styles.summaryItemValue, { color: summary.lowestBalance < 0 ? Colors.error : Colors.text }]}>
                {formatCurrencyShort(summary.lowestBalance)}
              </Text>
              <Text style={styles.summaryItemSub}>Week {summary.lowestBalanceWeek}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeaderRow} onPress={() => toggleSection('expenses')} activeOpacity={0.7}>
            <DollarSign size={18} color={Colors.error} />
            <Text style={styles.sectionTitle}>Monthly Expenses</Text>
            <Text style={styles.sectionAmount}>{formatCurrencyShort(totalMonthlyExpenses)}/mo</Text>
            {expandedSections.expenses ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
          </TouchableOpacity>

          {expandedSections.expenses && (
            <View style={styles.expandedContent}>
              {cashFlowData?.expenses.map(exp => (
                <View key={exp.id} style={styles.expenseListRow}>
                  <View style={styles.expenseListInfo}>
                    <Text style={styles.expenseListName}>{exp.name}</Text>
                    <Text style={styles.expenseListMeta}>{EXPENSE_CATEGORIES.find(c => c.value === exp.category)?.label} · {freqLabel(exp.frequency)}</Text>
                  </View>
                  <Text style={styles.expenseListAmount}>{formatCurrency(exp.amount)}</Text>
                  <TouchableOpacity onPress={() => handleRemoveExpense(exp.id)} style={styles.expenseDeleteBtn}>
                    <Trash2 size={14} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
              {(!cashFlowData?.expenses || cashFlowData.expenses.length === 0) && (
                <Text style={styles.emptyListText}>No recurring expenses added yet</Text>
              )}
              <TouchableOpacity style={styles.addItemBtn} onPress={() => setShowAddExpense(true)} activeOpacity={0.7}>
                <Plus size={16} color={Colors.primary} />
                <Text style={styles.addItemText}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeaderRow} onPress={() => toggleSection('income')} activeOpacity={0.7}>
            <TrendingUp size={18} color={Colors.success} />
            <Text style={styles.sectionTitle}>Expected Income</Text>
            <Text style={[styles.sectionAmount, { color: Colors.success }]}>
              {formatCurrencyShort(totalPending)} pending
            </Text>
            {expandedSections.income ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
          </TouchableOpacity>

          {expandedSections.income && (
            <View style={styles.expandedContent}>
              {relevantInvoices.filter(i => i.status !== 'paid').map(inv => {
                const remaining = inv.totalDue - inv.amountPaid;
                return (
                  <View key={inv.id} style={styles.incomeListRow}>
                    <View style={styles.incomeListInfo}>
                      <Text style={styles.incomeListName}>Invoice #{inv.number}</Text>
                      <Text style={styles.incomeListMeta}>
                        Due: {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {inv.paymentTerms?.replace('_', ' ')}
                      </Text>
                    </View>
                    <Text style={styles.incomeListAmount}>{formatCurrency(remaining)}</Text>
                  </View>
                );
              })}

              {cashFlowData?.expectedPayments.map(ep => {
                const badge = confidenceBadge(ep.confidence);
                return (
                  <View key={ep.id} style={styles.incomeListRow}>
                    <View style={styles.incomeListInfo}>
                      <Text style={styles.incomeListName}>{ep.description}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.incomeListMeta}>
                          {new Date(ep.expectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                        <View style={[styles.confidenceBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.confidenceBadgeText, { color: badge.text }]}>{badge.label}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.incomeListAmount}>{formatCurrency(ep.amount)}</Text>
                    <TouchableOpacity onPress={() => handleRemovePayment(ep.id)} style={styles.expenseDeleteBtn}>
                      <Trash2 size={14} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              {relevantInvoices.filter(i => i.status !== 'paid').length === 0 && (!cashFlowData?.expectedPayments || cashFlowData.expectedPayments.length === 0) && (
                <Text style={styles.emptyListText}>No income expected. Add invoices or expected payments.</Text>
              )}
              <TouchableOpacity style={styles.addItemBtn} onPress={() => setShowAddPayment(true)} activeOpacity={0.7}>
                <Plus size={16} color={Colors.success} />
                <Text style={[styles.addItemText, { color: Colors.success }]}>Add Expected Payment</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.aiButton}
            onPress={handleAIAnalysis}
            activeOpacity={0.85}
            disabled={aiLoading}
            testID="ai-analysis-btn"
          >
            {aiLoading ? (
              <ActivityIndicator size="small" color={Colors.textOnPrimary} />
            ) : (
              <Sparkles size={18} color={Colors.textOnPrimary} />
            )}
            <Text style={styles.aiButtonText}>
              {aiLoading ? 'Analyzing...' : 'Get AI Advice'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.aiButton, { backgroundColor: Colors.accent, marginTop: 10 }]}
            onPress={() => router.push({ pathname: '/payment-predictions' as any, params: projectId ? { projectId } : {} })}
            activeOpacity={0.85}
            testID="payment-forecast-btn"
          >
            <TrendingUp size={18} color={Colors.textOnPrimary} />
            <Text style={styles.aiButtonText}>Payment Forecast</Text>
          </TouchableOpacity>

          {showAiResults && aiAnalysis && (
            <View style={styles.aiResultsCard}>
              <View style={styles.aiResultsHeader}>
                <Sparkles size={16} color={Colors.primary} />
                <Text style={styles.aiResultsTitle}>AI Cash Flow Analysis</Text>
                <View style={[styles.healthBadge, { backgroundColor: healthColor(aiAnalysis.overallHealth) + '20' }]}>
                  <Text style={[styles.healthBadgeText, { color: healthColor(aiAnalysis.overallHealth) }]}>
                    {aiAnalysis.healthScore}/100
                  </Text>
                </View>
              </View>

              <Text style={styles.aiSummary}>{aiAnalysis.summary}</Text>

              {(aiAnalysis.criticalWeeks ?? []).length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Critical Weeks</Text>
                  {(aiAnalysis.criticalWeeks ?? []).map((cw, i) => (
                    <View key={i} style={styles.criticalWeekRow}>
                      <AlertTriangle size={14} color={Colors.error} />
                      <Text style={styles.criticalWeekText}>
                        Week {cw.weekNumber}: {formatCurrency(cw.balance)} — {cw.problem}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {(aiAnalysis.recommendations ?? []).length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Recommendations</Text>
                  {(aiAnalysis.recommendations ?? []).map((rec, i) => {
                    const pc = priorityConfig(rec.priority);
                    return (
                      <View key={i} style={[styles.recCard, { backgroundColor: pc.bg, borderColor: pc.text + '30' }]}>
                        <View style={styles.recHeader}>
                          <View style={[styles.recPriorityBadge, { backgroundColor: pc.text + '20' }]}>
                            <Text style={[styles.recPriorityText, { color: pc.text }]}>{rec.priority}</Text>
                          </View>
                          <View style={[styles.recDiffBadge, { backgroundColor: Colors.fillTertiary }]}>
                            <Text style={styles.recDiffText}>{rec.difficulty}</Text>
                          </View>
                        </View>
                        <Text style={styles.recAction}>{rec.action}</Text>
                        <Text style={styles.recImpact}>{rec.impact}</Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {(aiAnalysis.billingOptimizations ?? []).length > 0 && (
                <View style={styles.aiSection}>
                  <Text style={styles.aiSectionTitle}>Billing Optimizations</Text>
                  {(aiAnalysis.billingOptimizations ?? []).map((opt, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.bulletText}>{opt}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.aiGenLabel}>✨ AI-generated</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <CashFlowSetup
        visible={showSetup}
        onComplete={handleSetupComplete}
        onClose={() => setShowSetup(false)}
      />

      <Modal visible={showEditBalance} transparent animationType="fade" onRequestClose={() => setShowEditBalance(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Balance</Text>
                <TouchableOpacity onPress={() => setShowEditBalance(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Current Bank Balance</Text>
              <View style={styles.modalInputRow}>
                <Text style={styles.modalDollar}>$</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editBalanceValue}
                  onChangeText={setEditBalanceValue}
                  keyboardType="numeric"
                  autoFocus
                />
              </View>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleUpdateBalance} activeOpacity={0.85}>
                <Text style={styles.modalSaveBtnText}>Update Balance</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddExpense} transparent animationType="slide" onRequestClose={() => setShowAddExpense(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCardBottom, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Expense</Text>
                <TouchableOpacity onPress={() => setShowAddExpense(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalFieldLabel}>Name</Text>
                <TextInput style={styles.modalTextInput} value={newExpenseName} onChangeText={setNewExpenseName} placeholder="e.g. Payroll" placeholderTextColor={Colors.textMuted} />
                <Text style={styles.modalFieldLabel}>Amount</Text>
                <View style={styles.modalInputRow}>
                  <Text style={styles.modalDollar}>$</Text>
                  <TextInput style={styles.modalInput} value={newExpenseAmount} onChangeText={setNewExpenseAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.textMuted} />
                </View>
                <Text style={styles.modalFieldLabel}>Frequency</Text>
                <View style={styles.chipGrid}>
                  {FREQUENCY_OPTIONS.map(opt => (
                    <TouchableOpacity key={opt.value} style={[styles.chip, newExpenseFrequency === opt.value && styles.chipActive]} onPress={() => setNewExpenseFrequency(opt.value)} activeOpacity={0.7}>
                      <Text style={[styles.chipText, newExpenseFrequency === opt.value && styles.chipTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.modalFieldLabel}>Category</Text>
                <View style={styles.chipGrid}>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <TouchableOpacity key={cat.value} style={[styles.chip, newExpenseCategory === cat.value && styles.chipActive]} onPress={() => setNewExpenseCategory(cat.value)} activeOpacity={0.7}>
                      <Text style={[styles.chipText, newExpenseCategory === cat.value && styles.chipTextActive]}>{cat.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleAddExpense} activeOpacity={0.85}>
                <Plus size={18} color={Colors.textOnPrimary} />
                <Text style={styles.modalSaveBtnText}>Add Expense</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddPayment} transparent animationType="slide" onRequestClose={() => setShowAddPayment(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCardBottom, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Expected Payment</Text>
                <TouchableOpacity onPress={() => setShowAddPayment(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Description</Text>
              <TextInput style={styles.modalTextInput} value={newPaymentDesc} onChangeText={setNewPaymentDesc} placeholder="e.g. Deposit from River Oak" placeholderTextColor={Colors.textMuted} />
              <Text style={styles.modalFieldLabel}>Amount</Text>
              <View style={styles.modalInputRow}>
                <Text style={styles.modalDollar}>$</Text>
                <TextInput style={styles.modalInput} value={newPaymentAmount} onChangeText={setNewPaymentAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.textMuted} />
              </View>
              <Text style={styles.modalFieldLabel}>Days from now</Text>
              <TextInput style={styles.modalTextInput} value={newPaymentDate} onChangeText={setNewPaymentDate} keyboardType="numeric" placeholder="30" placeholderTextColor={Colors.textMuted} />
              <Text style={styles.modalFieldLabel}>Confidence</Text>
              <View style={styles.chipGrid}>
                {(['confirmed', 'expected', 'hopeful'] as const).map(c => {
                  const badge = confidenceBadge(c);
                  return (
                    <TouchableOpacity key={c} style={[styles.chip, newPaymentConfidence === c && { backgroundColor: badge.bg, borderColor: badge.text + '30', borderWidth: 1 }]} onPress={() => setNewPaymentConfidence(c)} activeOpacity={0.7}>
                      <Text style={[styles.chipText, newPaymentConfidence === c && { color: badge.text }]}>{badge.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: Colors.success }]} onPress={handleAddPayment} activeOpacity={0.85}>
                <Plus size={18} color={Colors.textOnPrimary} />
                <Text style={styles.modalSaveBtnText}>Add Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  heroCard: { marginHorizontal: 16, marginTop: 16, backgroundColor: Colors.primary, borderRadius: 20, padding: 20, gap: 16 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLeft: { gap: 4 },
  heroLabel: { fontSize: 13, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '800' as const, color: '#FFFFFF', letterSpacing: -1 },
  editBalanceBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  editBalanceBtnText: { fontSize: 13, fontWeight: '600' as const, color: '#FFFFFF' },
  forecastSelector: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  forecastChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)' },
  forecastChipActive: { backgroundColor: '#FFFFFF' },
  forecastChipText: { fontSize: 12, fontWeight: '600' as const, color: 'rgba(255,255,255,0.8)' },
  forecastChipTextActive: { color: Colors.primary },
  customWeeksChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  customWeeksInput: { minWidth: 34, paddingVertical: 0, paddingHorizontal: 2, fontSize: 12, fontWeight: '700' as const, color: '#FFFFFF', textAlign: 'center' as const },
  customWeeksLabel: { fontSize: 12, fontWeight: '600' as const, color: 'rgba(255,255,255,0.8)' },
  pendingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 14 },
  pendingItem: { flex: 1, gap: 2 },
  pendingLabel: { fontSize: 11, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  pendingValue: { fontSize: 18, fontWeight: '800' as const, color: '#FFFFFF', letterSpacing: -0.3 },
  pendingDivider: { width: 1, alignSelf: 'stretch' as const, backgroundColor: 'rgba(255,255,255,0.2)' },
  section: { marginHorizontal: 16, marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  sectionAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.error, marginRight: 4 },
  expandedContent: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginTop: 6, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  expenseListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  expenseListInfo: { flex: 1, gap: 2 },
  expenseListName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  expenseListMeta: { fontSize: 12, color: Colors.textMuted },
  expenseListAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  expenseDeleteBtn: { padding: 6 },
  incomeListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  incomeListInfo: { flex: 1, gap: 2 },
  incomeListName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  incomeListMeta: { fontSize: 12, color: Colors.textMuted },
  incomeListAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  confidenceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confidenceBadgeText: { fontSize: 10, fontWeight: '700' as const },
  emptyListText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 12 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 4 },
  addItemText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  dangerCard: { backgroundColor: Colors.errorLight, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.error + '30', gap: 10 },
  dangerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dangerTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.error },
  dangerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 26 },
  dangerDate: { fontSize: 13, color: Colors.textSecondary },
  dangerBalance: { fontSize: 14, fontWeight: '700' as const, color: Colors.error },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryItem: { flex: 1, minWidth: '45%' as any, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  summaryItemLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' as const },
  summaryItemValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  summaryItemSub: { fontSize: 11, color: Colors.textMuted },
  weekDetailCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  weekDetailRow: { flexDirection: 'row', gap: 8 },
  weekDetailItem: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 10, gap: 4 },
  weekDetailLabel: { fontSize: 11, fontWeight: '500' as const, color: Colors.textMuted },
  weekDetailValue: { fontSize: 16, fontWeight: '800' as const },
  weekItemsGroup: { marginTop: 12, gap: 4 },
  weekItemsLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  weekItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  weekItemName: { flex: 1, fontSize: 13, color: Colors.text, marginRight: 8 },
  weekItemAmount: { fontSize: 13, fontWeight: '700' as const },
  emptyWeekText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  aiButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3 },
  aiButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  aiResultsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 12 },
  aiResultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiResultsTitle: { flex: 1, fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  healthBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  healthBadgeText: { fontSize: 13, fontWeight: '700' as const },
  aiSummary: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  aiSection: { gap: 8, marginTop: 4 },
  aiSectionTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  criticalWeekRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  criticalWeekText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  recCard: { borderRadius: 12, padding: 12, borderWidth: 1, gap: 6 },
  recHeader: { flexDirection: 'row', gap: 6 },
  recPriorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  recPriorityText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  recDiffBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  recDiffText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  recAction: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, lineHeight: 19 },
  recImpact: { fontSize: 12, color: Colors.textSecondary },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  aiGenLabel: { fontSize: 11, color: Colors.textMuted, textAlign: 'right', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, gap: 12 },
  modalCardBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: '80%', gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  modalFieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 8 },
  modalInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 12 },
  modalDollar: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  modalInput: { flex: 1, minHeight: 48, fontSize: 20, fontWeight: '700' as const, color: Colors.text, paddingHorizontal: 8 },
  modalTextInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textOnPrimary },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 12 },
  modalSaveBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

```


---

### `app/payment-predictions.tsx`

```tsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, TrendingUp, AlertTriangle, Clock, CheckCircle2, ChevronRight, Wallet, RefreshCw, Phone,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useProjects } from '@/contexts/ProjectContext';
import { predictInvoicePayments } from '@/utils/paymentPrediction';
import type { PaymentPredictionResult, InvoicePrediction } from '@/utils/paymentPrediction';
import type { Project } from '@/types';

function formatMoney(n: number): string {
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

const RISK_COLOR: Record<InvoicePrediction['riskLevel'], string> = {
  low: Colors.success,
  medium: Colors.warning,
  high: Colors.error,
};

const RISK_LABEL: Record<InvoicePrediction['riskLevel'], string> = {
  low: 'On Track',
  medium: 'Watch',
  high: 'At Risk',
};

export default function PaymentPredictionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId: scopeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices, getInvoicesForProject } = useProjects();

  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<PaymentPredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const relevantInvoices = useMemo(() => {
    if (scopeProjectId) return getInvoicesForProject(scopeProjectId);
    return invoices;
  }, [scopeProjectId, invoices, getInvoicesForProject]);

  const projectsById = useMemo(() => {
    const map: Record<string, Project> = {};
    projects.forEach(p => { map[p.id] = p; });
    return map;
  }, [projects]);

  const unpaidCount = useMemo(() => {
    return relevantInvoices.filter(i => {
      const retentionPending = Math.max(0, (i.retentionAmount ?? 0) - (i.retentionReleased ?? 0));
      const netPayable = Math.max(0, (i.totalDue ?? 0) - retentionPending);
      const out = Math.max(0, netPayable - (i.amountPaid ?? 0));
      return out > 0 && i.status !== 'draft';
    }).length;
  }, [relevantInvoices]);

  const totalOutstanding = useMemo(() => {
    return relevantInvoices.reduce((sum, i) => {
      const retentionPending = Math.max(0, (i.retentionAmount ?? 0) - (i.retentionReleased ?? 0));
      const netPayable = Math.max(0, (i.totalDue ?? 0) - retentionPending);
      const out = Math.max(0, netPayable - (i.amountPaid ?? 0));
      return sum + out;
    }, 0);
  }, [relevantInvoices]);

  const runForecast = useCallback(async () => {
    if (loading) return;
    if (unpaidCount === 0) {
      Alert.alert('All Caught Up', 'No unpaid invoices to forecast right now.');
      return;
    }
    setLoading(true);
    setError(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const r = await predictInvoicePayments(relevantInvoices, projectsById);
      setResult(r);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('[PaymentPredictions] Error:', err);
      setError(err?.message || 'Could not forecast payments.');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [loading, unpaidCount, relevantInvoices, projectsById]);

  const openInvoice = useCallback((invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    router.push({ pathname: '/invoice' as any, params: { projectId: inv.projectId, invoiceId } });
  }, [invoices, router]);

  const sortedPredictions = useMemo(() => {
    if (!result) return [];
    const order: Record<InvoicePrediction['riskLevel'], number> = { high: 0, medium: 1, low: 2 };
    return [...result.perInvoice].sort((a, b) => {
      const r = order[a.riskLevel] - order[b.riskLevel];
      if (r !== 0) return r;
      return b.outstandingAmount - a.outstandingAmount;
    });
  }, [result]);

  const scopeName = scopeProjectId ? (projectsById[scopeProjectId]?.name || 'This project') : 'All projects';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      testID="payment-predictions-screen"
    >
      <View style={styles.header}>
        <View style={styles.heroIcon}>
          <Sparkles size={22} color={Colors.accent} />
        </View>
        <Text style={styles.heroTitle}>Cash-Crunch Forecast</Text>
        <Text style={styles.heroSub}>{scopeName} • {unpaidCount} unpaid invoice{unpaidCount === 1 ? '' : 's'} • {formatMoney(totalOutstanding)} outstanding</Text>
      </View>

      {!result && !loading && (
        <View style={styles.introCard}>
          <Text style={styles.introHeadline}>Predict when each invoice will actually clear.</Text>
          <Text style={styles.introBody}>
            Mage AI analyzes due dates, client payment history, project status, and retention holds to forecast real inflows — so you know which invoices need a call today vs. which are safe to let ride.
          </Text>
          <View style={styles.featureRow}>
            <View style={styles.featureChip}><Clock size={12} color={Colors.primary} /><Text style={styles.featureText}>Per-invoice pay date</Text></View>
            <View style={styles.featureChip}><AlertTriangle size={12} color={Colors.warning} /><Text style={styles.featureText}>Risk scoring</Text></View>
            <View style={styles.featureChip}><Phone size={12} color={Colors.accent} /><Text style={styles.featureText}>Action suggestions</Text></View>
          </View>
          <TouchableOpacity
            style={[styles.runBtn, unpaidCount === 0 && { opacity: 0.5 }]}
            onPress={runForecast}
            disabled={unpaidCount === 0}
            activeOpacity={0.85}
            testID="run-payment-forecast-btn"
          >
            <Sparkles size={16} color="#FFF" />
            <Text style={styles.runBtnText}>Run Forecast</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={styles.loadingCard}>
          <ConstructionLoader size="lg" label={`Analyzing ${unpaidCount} invoice${unpaidCount === 1 ? '' : 's'}…`} />
          <Text style={styles.loadingSub}>Checking payment history, terms, and project status</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.errorCard}>
          <AlertTriangle size={18} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={runForecast} activeOpacity={0.85}>
            <RefreshCw size={14} color={Colors.primary} />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {result && !loading && (
        <>
          <View style={styles.headlineCard}>
            <View style={styles.scoreRow}>
              <View style={[styles.scoreBubble, { backgroundColor: result.collectionRiskScore > 60 ? Colors.error + '18' : result.collectionRiskScore > 35 ? Colors.warning + '18' : Colors.success + '18' }]}>
                <Text style={[styles.scoreNum, { color: result.collectionRiskScore > 60 ? Colors.error : result.collectionRiskScore > 35 ? Colors.warning : Colors.success }]}>
                  {result.collectionRiskScore}
                </Text>
                <Text style={styles.scoreLabel}>Risk Score</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headlineText}>{result.headline}</Text>
                {result.topAction && (
                  <View style={styles.topActionWrap}>
                    <Phone size={12} color={Colors.accent} />
                    <Text style={styles.topActionText}>{result.topAction}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Next 7 days</Text>
                <Text style={styles.metricValue}>{formatMoney(result.expected7dInflow)}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Next 14 days</Text>
                <Text style={styles.metricValue}>{formatMoney(result.expected14dInflow)}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Next 30 days</Text>
                <Text style={styles.metricValue}>{formatMoney(result.expected30dInflow)}</Text>
              </View>
              <View style={[styles.metricBox, { backgroundColor: Colors.error + '10' }]}>
                <Text style={[styles.metricLabel, { color: Colors.error }]}>At risk</Text>
                <Text style={[styles.metricValue, { color: Colors.error }]}>{formatMoney(result.atRiskAmount)}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.listHeading}>Per-Invoice Forecast</Text>
          {sortedPredictions.map(pred => {
            const color = RISK_COLOR[pred.riskLevel];
            return (
              <TouchableOpacity
                key={pred.invoiceId}
                style={[styles.invoiceCard, { borderLeftColor: color }]}
                onPress={() => openInvoice(pred.invoiceId)}
                activeOpacity={0.85}
                testID={`payment-prediction-card-${pred.invoiceId}`}
              >
                <View style={styles.invoiceHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.invoiceTitleRow}>
                      <Text style={styles.invoiceNumber}>Invoice #{pred.invoiceNumber}</Text>
                      <View style={[styles.riskPill, { backgroundColor: color + '18' }]}>
                        <Text style={[styles.riskPillText, { color }]}>{RISK_LABEL[pred.riskLevel]}</Text>
                      </View>
                    </View>
                    <Text style={styles.invoiceProject} numberOfLines={1}>{pred.projectName}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.textMuted} />
                </View>

                <View style={styles.invoiceMetrics}>
                  <View style={styles.invoiceMetricBox}>
                    <Text style={styles.invoiceMetricLabel}>Outstanding</Text>
                    <Text style={styles.invoiceMetricValue}>{formatMoney(pred.outstandingAmount)}</Text>
                  </View>
                  <View style={styles.invoiceMetricBox}>
                    <Text style={styles.invoiceMetricLabel}>Est. pay date</Text>
                    <Text style={styles.invoiceMetricValue}>{formatShortDate(pred.predictedPayDate)}</Text>
                    <Text style={styles.invoiceMetricSub}>in {pred.daysToPay}d</Text>
                  </View>
                  <View style={styles.invoiceMetricBox}>
                    <Text style={styles.invoiceMetricLabel}>On-time</Text>
                    <Text style={[styles.invoiceMetricValue, { color }]}>{pred.onTimeProbability}%</Text>
                  </View>
                </View>

                {pred.reasons.length > 0 && (
                  <View style={styles.reasonsBlock}>
                    {pred.reasons.map((r, idx) => (
                      <View key={idx} style={styles.reasonRow}>
                        <View style={[styles.reasonDot, { backgroundColor: color }]} />
                        <Text style={styles.reasonText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {pred.suggestedAction && (
                  <View style={styles.actionBlock}>
                    <Sparkles size={11} color={Colors.accent} />
                    <Text style={styles.actionText}>{pred.suggestedAction}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.rerunBtn} onPress={runForecast} activeOpacity={0.85} testID="rerun-forecast-btn">
            <RefreshCw size={14} color={Colors.primary} />
            <Text style={styles.rerunBtnText}>Re-run Forecast</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 6, alignItems: 'center' as const },
  heroIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.accent + '18', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 6 },
  heroTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.4 },
  heroSub: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' as const },

  introCard: { margin: 16, padding: 18, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  introHeadline: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.2 },
  introBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  featureRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  featureChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.fillSecondary },
  featureText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' as const },
  runBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.accent, marginTop: 4 },
  runBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },

  loadingCard: { margin: 16, padding: 28, alignItems: 'center' as const, gap: 10, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border },
  loadingText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  loadingSub: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' as const },

  errorCard: { margin: 16, padding: 16, backgroundColor: Colors.error + '10', borderRadius: 12, borderWidth: 1, borderColor: Colors.error + '30', gap: 10, alignItems: 'center' as const },
  errorText: { fontSize: 13, color: Colors.error, textAlign: 'center' as const },
  retryBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  retryBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },

  headlineCard: { margin: 16, padding: 16, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, gap: 14 },
  scoreRow: { flexDirection: 'row' as const, gap: 14, alignItems: 'flex-start' as const },
  scoreBubble: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  scoreNum: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5 },
  scoreLabel: { fontSize: 9, color: Colors.textSecondary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4, marginTop: 2 },
  headlineText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, lineHeight: 19 },
  topActionWrap: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  topActionText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  metricsRow: { flexDirection: 'row' as const, gap: 8, flexWrap: 'wrap' as const },
  metricBox: { flex: 1, minWidth: '22%' as any, padding: 10, borderRadius: 10, backgroundColor: Colors.fillSecondary, gap: 3 },
  metricLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  metricValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.2 },

  listHeading: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginHorizontal: 20, marginTop: 8, marginBottom: 4 },

  invoiceCard: { marginHorizontal: 16, marginVertical: 6, padding: 14, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4, gap: 10 },
  invoiceHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  invoiceTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  invoiceNumber: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  invoiceProject: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  riskPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  riskPillText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  invoiceMetrics: { flexDirection: 'row' as const, gap: 8 },
  invoiceMetricBox: { flex: 1, padding: 8, borderRadius: 8, backgroundColor: Colors.fillSecondary, gap: 2 },
  invoiceMetricLabel: { fontSize: 9, color: Colors.textSecondary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  invoiceMetricValue: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  invoiceMetricSub: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  reasonsBlock: { gap: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.border },
  reasonRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6 },
  reasonDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  reasonText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  actionBlock: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, padding: 8, backgroundColor: Colors.accent + '0D', borderRadius: 8 },
  actionText: { flex: 1, fontSize: 12, color: Colors.text, fontWeight: '500' as const, lineHeight: 17 },

  rerunBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, marginHorizontal: 16, marginTop: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  rerunBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
});

```


---

### `app/budget-dashboard.tsx`

```tsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Platform, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, TrendingDown, DollarSign, Clock, Target, BarChart3,
  Sparkles,
} from 'lucide-react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { calculateEVM, generateCashFlowData } from '@/utils/earnedValueEngine';
import { mageAI } from '@/utils/mageAI';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 64;
const CHART_HEIGHT = 200;
const CHART_PADDING = 40;

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function getMetricColor(value: number): string {
  if (value >= 1.0) return Colors.success;
  if (value >= 0.9) return Colors.warning;
  return Colors.error;
}

export default function BudgetDashboardScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('full_budget_dashboard')) {
    return (
      <Paywall
        visible={true}
        feature="Full Budget Dashboard (EVM)"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <BudgetDashboardScreenInner />;
}

function BudgetDashboardScreenInner() {
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, invoices } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const projectInvoices = useMemo(() => invoices.filter(inv => inv.projectId === (projectId ?? '')), [invoices, projectId]);

  const metrics = useMemo(() => {
    if (!project) return null;
    return calculateEVM(project, projectInvoices, project.schedule);
  }, [project, projectInvoices]);

  const cashFlowData = useMemo(() => {
    if (!project) return [];
    return generateCashFlowData(project, projectInvoices, project.schedule, 10);
  }, [project, projectInvoices]);

  const [forecast, setForecast] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);

  const handleGenerateForecast = useCallback(async () => {
    if (!project || !metrics) return;
    setForecastLoading(true);
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const prompt = `You are a construction project financial analyst. Analyze these Earned Value Management metrics for a ${project.type} project named "${project.name}" with a budget of ${formatCurrency(metrics.budgetAtCompletion)}:

CPI: ${metrics.costPerformanceIndex}
SPI: ${metrics.schedulePerformanceIndex}
Cost Variance: ${formatCurrency(metrics.costVariance)}
Schedule Variance: ${formatCurrency(metrics.scheduleVariance)}
Estimate at Completion: ${formatCurrency(metrics.estimateAtCompletion)}
Percent Complete: ${metrics.percentComplete}%
Actual Cost: ${formatCurrency(metrics.actualCost)}

Write a 3-paragraph project financial health summary covering:
1. Current status assessment
2. Root cause analysis of any variance
3. Recommended corrective actions

Be specific and actionable. Use construction industry terminology.`;

      const aiResult = await mageAI({ prompt, tier: 'fast' });
      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        return;
      }
      setForecast(aiResult.data ?? aiResult.raw ?? '');
      console.log('[EVM] AI forecast generated');
    } catch (err) {
      console.log('[EVM] Forecast generation failed:', err);
      Alert.alert('Error', 'Could not generate forecast. Please try again.');
    } finally {
      setForecastLoading(false);
    }
  }, [project, metrics]);

  const chartPath = useMemo(() => {
    if (cashFlowData.length === 0) return { planned: '', actual: '', forecast: '' };

    const maxVal = Math.max(
      ...cashFlowData.map(d => Math.max(d.plannedCumulative, d.actualCumulative, d.forecastCumulative)),
      1,
    );

    const toX = (i: number) => CHART_PADDING + (i / (cashFlowData.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2);
    const toY = (v: number) => CHART_HEIGHT - CHART_PADDING - ((v / maxVal) * (CHART_HEIGHT - CHART_PADDING * 2));

    const buildPath = (key: 'plannedCumulative' | 'actualCumulative' | 'forecastCumulative') => {
      return cashFlowData.map((d, i) => {
        const x = toX(i);
        const y = toY(d[key]);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      }).join(' ');
    };

    return {
      planned: buildPath('plannedCumulative'),
      actual: buildPath('actualCumulative'),
      forecast: buildPath('forecastCumulative'),
    };
  }, [cashFlowData]);

  if (!project || !metrics) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Budget Dashboard' }} />
        <Text style={styles.emptyText}>Project not found</Text>
      </View>
    );
  }

  const metricCards = [
    { label: 'CPI', value: metrics.costPerformanceIndex.toFixed(2), icon: DollarSign, color: getMetricColor(metrics.costPerformanceIndex) },
    { label: 'SPI', value: metrics.schedulePerformanceIndex.toFixed(2), icon: Clock, color: getMetricColor(metrics.schedulePerformanceIndex) },
    { label: 'Cost Variance', value: formatCurrency(metrics.costVariance), icon: metrics.costVariance >= 0 ? TrendingUp : TrendingDown, color: metrics.costVariance >= 0 ? Colors.success : Colors.error },
    { label: 'Schedule Variance', value: formatCurrency(metrics.scheduleVariance), icon: metrics.scheduleVariance >= 0 ? TrendingUp : TrendingDown, color: metrics.scheduleVariance >= 0 ? Colors.success : Colors.error },
    { label: 'Est. at Completion', value: formatCurrency(metrics.estimateAtCompletion), icon: Target, color: Colors.info },
    { label: 'Variance at Comp.', value: formatCurrency(metrics.varianceAtCompletion), icon: BarChart3, color: metrics.varianceAtCompletion >= 0 ? Colors.success : Colors.error },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Budget Dashboard',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.projectHeader}>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectBudget}>Budget: {formatCurrency(metrics.budgetAtCompletion)}</Text>
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${Math.min(metrics.percentComplete, 100)}%` as any, backgroundColor: getMetricColor(metrics.costPerformanceIndex) }]} />
          </View>
          <Text style={styles.progressText}>{metrics.percentComplete.toFixed(1)}% Complete</Text>
        </View>

        <Text style={styles.sectionTitle}>EVM Metrics</Text>
        <View style={styles.metricsGrid}>
          {metricCards.map((card) => (
            <View key={card.label} style={[styles.metricCard, { borderLeftColor: card.color }]}>
              <View style={styles.metricHeader}>
                <card.icon size={16} color={card.color} />
                <Text style={styles.metricLabel}>{card.label}</Text>
              </View>
              <Text style={[styles.metricValue, { color: card.color }]}>{card.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Cash Flow S-Curve</Text>
        <View style={styles.chartCard}>
          <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
            <Line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={Colors.borderLight} strokeWidth={1} />
            <Line x1={CHART_PADDING} y1={CHART_PADDING} x2={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={Colors.borderLight} strokeWidth={1} />

            {chartPath.planned && <Path d={chartPath.planned} stroke={Colors.info} strokeWidth={2.5} fill="none" />}
            {chartPath.actual && <Path d={chartPath.actual} stroke={Colors.success} strokeWidth={2.5} fill="none" />}
            {chartPath.forecast && <Path d={chartPath.forecast} stroke={Colors.warning} strokeWidth={2} fill="none" strokeDasharray="6,4" />}
          </Svg>
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: Colors.info }]} />
              <Text style={styles.legendText}>Planned</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: Colors.success }]} />
              <Text style={styles.legendText}>Actual</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: Colors.warning }]} />
              <Text style={styles.legendText}>Forecast</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>AI Forecast</Text>
        <View style={styles.forecastCard}>
          {forecast ? (
            <Text style={styles.forecastText}>{forecast}</Text>
          ) : (
            <Text style={styles.forecastPlaceholder}>
              Generate an AI-powered financial health analysis based on your project's EVM data.
            </Text>
          )}
          <TouchableOpacity
            style={styles.forecastBtn}
            onPress={handleGenerateForecast}
            activeOpacity={0.85}
            disabled={forecastLoading}
            testID="generate-forecast"
          >
            {forecastLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Sparkles size={16} color="#fff" />
                <Text style={styles.forecastBtnText}>{forecast ? 'Regenerate Forecast' : 'Generate Forecast'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  scrollContent: {
    padding: 16,
  },
  projectHeader: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    gap: 6,
  },
  projectName: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  projectBudget: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 4,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  metricCard: {
    width: '48%' as any,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    gap: 6,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800' as const,
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  forecastCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    marginBottom: 20,
  },
  forecastText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  forecastPlaceholder: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  forecastBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  forecastBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
});

```


---

### `app/retention.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Lock, Unlock, FolderOpen, ChevronRight, AlertCircle, CheckCircle2,
  TrendingUp, Receipt, ArrowLeft,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Invoice, Project } from '@/types';

function formatCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyPrecise(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ProjectRetention {
  project: Project;
  totalContract: number;
  retentionHeld: number;
  retentionReleased: number;
  retentionPending: number;
  invoicesWithRetention: Invoice[];
}

export default function RetentionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId: scopeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices } = useProjects();
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(scopeProjectId ?? null);

  const projectRetention = useMemo<ProjectRetention[]>(() => {
    const relevantInvoices = invoices.filter(inv => (inv.retentionPercent ?? 0) > 0);
    const byProject: Record<string, Invoice[]> = {};
    relevantInvoices.forEach(inv => {
      if (!byProject[inv.projectId]) byProject[inv.projectId] = [];
      byProject[inv.projectId].push(inv);
    });
    const list: ProjectRetention[] = [];
    Object.entries(byProject).forEach(([pid, invs]) => {
      const project = projects.find(p => p.id === pid);
      if (!project) return;
      if (scopeProjectId && pid !== scopeProjectId) return;
      const totalContract = invs.reduce((s, i) => s + (i.totalDue ?? 0), 0);
      const retentionHeld = invs.reduce((s, i) => s + (i.retentionAmount ?? 0), 0);
      const retentionReleased = invs.reduce((s, i) => s + (i.retentionReleased ?? 0), 0);
      const retentionPending = Math.max(0, retentionHeld - retentionReleased);
      list.push({
        project,
        totalContract,
        retentionHeld,
        retentionReleased,
        retentionPending,
        invoicesWithRetention: invs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      });
    });
    return list.sort((a, b) => b.retentionPending - a.retentionPending);
  }, [projects, invoices, scopeProjectId]);

  const totals = useMemo(() => {
    const totalHeld = projectRetention.reduce((s, p) => s + p.retentionHeld, 0);
    const totalReleased = projectRetention.reduce((s, p) => s + p.retentionReleased, 0);
    const totalPending = projectRetention.reduce((s, p) => s + p.retentionPending, 0);
    const projectsWithRetention = projectRetention.length;
    const fullyReleased = projectRetention.filter(p => p.retentionPending < 0.01 && p.retentionReleased > 0).length;
    return { totalHeld, totalReleased, totalPending, projectsWithRetention, fullyReleased };
  }, [projectRetention]);

  const toggleExpand = (pid: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setExpandedProjectId(prev => (prev === pid ? null : pid));
  };

  const openInvoice = (inv: Invoice) => {
    router.push({ pathname: '/invoice', params: { projectId: inv.projectId, invoiceId: inv.id } } as any);
  };

  const scopedProject = scopeProjectId ? projects.find(p => p.id === scopeProjectId) : null;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: scopedProject ? `${scopedProject.name} · Retention` : 'Retention',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Lock size={28} color={Colors.warning} />
          </View>
          <Text style={styles.heroAmount}>{formatCurrencyPrecise(totals.totalPending)}</Text>
          <Text style={styles.heroLabel}>Retention Pending Release</Text>
          {totals.projectsWithRetention > 0 && (
            <Text style={styles.heroMeta}>
              Across {totals.projectsWithRetention} project{totals.projectsWithRetention === 1 ? '' : 's'}
              {totals.fullyReleased > 0 ? ` · ${totals.fullyReleased} fully released` : ''}
            </Text>
          )}
        </View>

        {/* Metrics */}
        <View style={styles.metricsRow}>
          <View style={[styles.metricCard, { borderColor: Colors.warning + '40' }]}>
            <Lock size={14} color={Colors.warning} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalHeld)}</Text>
            <Text style={styles.metricLabel}>Total Held</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: Colors.success + '40' }]}>
            <Unlock size={14} color={Colors.success} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalReleased)}</Text>
            <Text style={styles.metricLabel}>Released</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: Colors.error + '40' }]}>
            <AlertCircle size={14} color={Colors.error} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalPending)}</Text>
            <Text style={styles.metricLabel}>Pending</Text>
          </View>
        </View>

        {/* Explainer */}
        {projectRetention.length === 0 && (
          <View style={styles.emptyState}>
            <Lock size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Retention Held Yet</Text>
            <Text style={styles.emptyBody}>
              When you set a Retention % on an invoice (e.g. 10%), that amount is held back by the client until punch list is cleared or substantial completion. It will appear here so you can track and release it.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()} activeOpacity={0.8}>
              <ArrowLeft size={14} color={Colors.primary} />
              <Text style={styles.emptyBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Per-project */}
        {projectRetention.map(pr => {
          const expanded = expandedProjectId === pr.project.id;
          const releasePct = pr.retentionHeld > 0 ? Math.round((pr.retentionReleased / pr.retentionHeld) * 100) : 0;
          const isComplete = pr.retentionPending < 0.01 && pr.retentionReleased > 0;
          return (
            <View key={pr.project.id} style={styles.projectCard}>
              <TouchableOpacity
                style={styles.projectHeader}
                onPress={() => toggleExpand(pr.project.id)}
                activeOpacity={0.75}
              >
                <View style={styles.projectIconWrap}>
                  {isComplete ? (
                    <CheckCircle2 size={18} color={Colors.success} />
                  ) : (
                    <FolderOpen size={18} color={Colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName} numberOfLines={1}>{pr.project.name}</Text>
                  <Text style={styles.projectMeta}>
                    {pr.invoicesWithRetention.length} invoice{pr.invoicesWithRetention.length === 1 ? '' : 's'} with retention
                    {isComplete ? ' · Fully released' : ''}
                  </Text>
                </View>
                <View style={styles.projectAmountWrap}>
                  <Text style={[styles.projectAmount, isComplete && { color: Colors.success }]}>
                    {formatCurrency(pr.retentionPending)}
                  </Text>
                  <Text style={styles.projectAmountLabel}>{isComplete ? 'complete' : 'pending'}</Text>
                </View>
                <ChevronRight
                  size={18}
                  color={Colors.textMuted}
                  style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                />
              </TouchableOpacity>

              {/* Progress bar */}
              <View style={styles.progressBarWrap}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(releasePct, 100)}%`, backgroundColor: isComplete ? Colors.success : Colors.warning }]} />
                </View>
                <Text style={styles.progressBarText}>{releasePct}% released</Text>
              </View>

              {expanded && (
                <View style={styles.expandedSection}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Contract Billed</Text>
                    <Text style={styles.detailValue}>{formatCurrencyPrecise(pr.totalContract)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: Colors.warning }]}>Retention Held</Text>
                    <Text style={[styles.detailValue, { color: Colors.warning }]}>{formatCurrencyPrecise(pr.retentionHeld)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: Colors.success }]}>Released</Text>
                    <Text style={[styles.detailValue, { color: Colors.success }]}>{formatCurrencyPrecise(pr.retentionReleased)}</Text>
                  </View>
                  <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 8, marginTop: 4 }]}>
                    <Text style={styles.detailLabelBold}>Pending Release</Text>
                    <Text style={[styles.detailValueBold, { color: isComplete ? Colors.success : Colors.error }]}>
                      {formatCurrencyPrecise(pr.retentionPending)}
                    </Text>
                  </View>

                  <Text style={styles.invoicesSectionLabel}>Invoices</Text>
                  {pr.invoicesWithRetention.map(inv => {
                    const invPending = Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0));
                    const invDone = invPending < 0.01 && (inv.retentionReleased ?? 0) > 0;
                    return (
                      <TouchableOpacity
                        key={inv.id}
                        style={styles.invoiceRow}
                        onPress={() => openInvoice(inv)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.invoiceIconWrap}>
                          <Receipt size={14} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.invoiceTitle}>
                            Invoice #{inv.number} · {inv.retentionPercent}%
                          </Text>
                          <Text style={styles.invoiceMeta}>
                            {new Date(inv.issueDate).toLocaleDateString()}
                            {' · '}
                            {formatCurrency(inv.totalDue)} total
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' as const, gap: 2 }}>
                          <Text style={[styles.invoiceRetention, { color: invDone ? Colors.success : Colors.warning }]}>
                            {formatCurrency(invPending)}
                          </Text>
                          <Text style={styles.invoiceRetentionLabel}>
                            {invDone ? 'released' : 'pending'}
                          </Text>
                        </View>
                        <ChevronRight size={14} color={Colors.textMuted} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {projectRetention.length > 0 && !scopeProjectId && (
          <View style={styles.tipCard}>
            <TrendingUp size={16} color={Colors.primary} />
            <Text style={styles.tipText}>
              Release retention from inside each invoice. Common triggers: substantial completion, punch list clearance, final inspection sign-off.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: 'center' as const, paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.warning + '15', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 8 },
  heroAmount: { fontSize: 36, fontWeight: '800' as const, color: Colors.text, letterSpacing: -1.2 },
  heroLabel: { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' as const },
  heroMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },

  metricsRow: { flexDirection: 'row' as const, gap: 10, paddingHorizontal: 16, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 12, borderWidth: 1, gap: 4, alignItems: 'flex-start' as const },
  metricValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text, marginTop: 4 },
  metricLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const },

  emptyState: { margin: 16, padding: 28, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center' as const, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginTop: 6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  emptyBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.primary + '15', marginTop: 6 },
  emptyBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },

  projectCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const },
  projectHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 14 },
  projectIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  projectName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  projectMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  projectAmountWrap: { alignItems: 'flex-end' as const },
  projectAmount: { fontSize: 16, fontWeight: '800' as const, color: Colors.warning },
  projectAmountLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },

  progressBarWrap: { paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  progressBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  progressBarFill: { height: '100%' as const, borderRadius: 3 },
  progressBarText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const, minWidth: 70, textAlign: 'right' as const },

  expandedSection: { borderTopWidth: 1, borderTopColor: Colors.borderLight, padding: 14, gap: 6 },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 3 },
  detailLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  detailValue: { fontSize: 13, color: Colors.text, fontWeight: '600' as const },
  detailLabelBold: { fontSize: 14, color: Colors.text, fontWeight: '700' as const },
  detailValueBold: { fontSize: 14, fontWeight: '800' as const },

  invoicesSectionLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 10, marginBottom: 4 },
  invoiceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8 },
  invoiceIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.primary + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  invoiceTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  invoiceMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  invoiceRetention: { fontSize: 14, fontWeight: '700' as const },
  invoiceRetentionLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' as const },

  tipCard: { marginHorizontal: 16, marginTop: 8, padding: 14, backgroundColor: Colors.primary + '10', borderRadius: 12, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  tipText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 17, fontWeight: '500' as const },
});

```


---

### `app/payments.tsx`

```tsx
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CreditCard, ArrowDownRight,
  Clock, Check, XCircle, Send, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PROVIDER_INFO } from '@/mocks/payments';
import type { Payment, PaymentStatus, PaymentProvider, Invoice, Project, Contact } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { useProjects } from '@/contexts/ProjectContext';

// Stripe's posted rate — good enough for a rough "net after fees" column on the
// payments dashboard. We never charge this ourselves; Stripe takes it out of
// the deposit. Keeping it here means the GC can see what they actually cleared.
const STRIPE_FEE_PERCENT = 0.029;
const STRIPE_FEE_FIXED = 0.30;

// Map the narrower PaymentMethod used on InvoicePayment to the broader
// PaymentProvider used on the dashboard. credit_card is assumed to flow through
// Stripe — that's the only card-capable integration we've wired.
function methodToProvider(method: string): PaymentProvider {
  switch (method) {
    case 'credit_card': return 'stripe';
    case 'check': return 'check';
    case 'ach': return 'ach';
    case 'cash': return 'cash';
    default: return 'check';
  }
}

function displayClientName(project: Project, contacts: Contact[]): string {
  // Prefer an explicitly linked contact; fall back to the project name so a
  // row is never blank. We don't type-narrow on role here because plenty of
  // real-world contacts get typed as 'owner' / 'property_manager' / whatever.
  const linked = contacts.find(c => c.linkedProjectIds?.includes(project.id));
  if (linked) {
    const full = `${linked.firstName ?? ''} ${linked.lastName ?? ''}`.trim();
    if (full) return full;
    if (linked.companyName) return linked.companyName;
  }
  return project.name;
}

// Build a unified Payment[] from real invoice data.
//
// Three row classes:
//   1. Completed — each InvoicePayment the GC recorded manually.
//   2. Pending (Stripe) — invoice has payLinkUrl out; client hasn't paid yet.
//   3. Pending (other) — invoice is sent but no Stripe link and still owed.
//
// Sorted newest-first so the dashboard always shows the most recent activity.
function derivePayments(
  projects: Project[], invoices: Invoice[], contacts: Contact[],
): Payment[] {
  const rows: Payment[] = [];

  for (const inv of invoices) {
    const project = projects.find(p => p.id === inv.projectId);
    if (!project) continue;
    const clientName = displayClientName(project, contacts);

    // 1. Recorded payments — one row per payment, always 'completed'.
    for (const p of inv.payments ?? []) {
      const provider = methodToProvider(p.method);
      const fee = provider === 'stripe'
        ? Math.round((p.amount * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED) * 100) / 100
        : 0;
      rows.push({
        id: p.id,
        invoiceId: inv.id,
        projectId: project.id,
        projectName: project.name,
        clientName,
        amount: p.amount,
        fee,
        netAmount: Math.round((p.amount - fee) * 100) / 100,
        provider,
        status: 'completed',
        description: `Invoice #${inv.number}`,
        createdAt: p.date,
        completedAt: p.date,
      });
    }

    // 2/3. Outstanding balance row — only for sent/partially_paid/overdue with a
    // positive balance. Draft and fully-paid invoices don't belong on a
    // payments feed.
    const balance = Math.max(0, inv.totalDue - inv.amountPaid);
    if (
      balance > 0 &&
      inv.status !== 'draft' &&
      inv.status !== 'paid'
    ) {
      const hasStripeLink = !!inv.payLinkUrl;
      const estimatedFee = hasStripeLink
        ? Math.round((balance * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED) * 100) / 100
        : 0;
      rows.push({
        id: `pending-${inv.id}`,
        invoiceId: inv.id,
        projectId: project.id,
        projectName: project.name,
        clientName,
        amount: balance,
        fee: estimatedFee,
        netAmount: Math.round((balance - estimatedFee) * 100) / 100,
        provider: hasStripeLink ? 'stripe' : 'check',
        // overdue is still "pending" from our side — the client owes but
        // nothing has bounced. Reserving 'failed' for actual Stripe card
        // declines we'll pick up via webhook later.
        status: 'pending',
        description: hasStripeLink
          ? `Invoice #${inv.number} — Stripe link sent`
          : `Invoice #${inv.number} — awaiting payment`,
        createdAt: inv.issueDate,
      });
    }
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows;
}

const STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: '#E65100', bgColor: '#FFF3E0', icon: Clock },
  processing: { label: 'Processing', color: '#1565C0', bgColor: '#E3F2FD', icon: RefreshCw },
  completed: { label: 'Completed', color: '#2E7D32', bgColor: '#E8F5E9', icon: Check },
  failed: { label: 'Failed', color: '#C62828', bgColor: '#FFEBEE', icon: XCircle },
  refunded: { label: 'Refunded', color: '#546E7A', bgColor: '#ECEFF1', icon: RefreshCw },
};

function PaymentCard({ payment, onPress }: { payment: Payment; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusInfo = STATUS_CONFIG[payment.status];
  const providerInfo = PROVIDER_INFO[payment.provider] ?? PROVIDER_INFO.check;
  const StatusIcon = statusInfo.icon;

  return (
    <Animated.View style={[styles.payCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.payCardInner}
      >
        <View style={styles.payCardHeader}>
          <View style={[styles.providerBadge, { backgroundColor: providerInfo.bgColor }]}>
            <Text style={[styles.providerBadgeLetter, { color: providerInfo.color }]}>
              {providerInfo.label.charAt(0)}
            </Text>
          </View>
          <View style={styles.payCardInfo}>
            <Text style={styles.payCardClient}>{payment.clientName}</Text>
            <Text style={styles.payCardProject} numberOfLines={1}>{payment.projectName}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.payCardAmount, payment.status === 'failed' && { color: '#C62828' }]}>
              {formatMoney(payment.amount)}
            </Text>
            {payment.fee > 0 && (
              <Text style={styles.payCardFee}>-{formatMoney(payment.fee, 2)} fee</Text>
            )}
          </View>
        </View>

        <Text style={styles.payCardDesc} numberOfLines={1}>{payment.description}</Text>

        <View style={styles.payCardFooter}>
          <View style={[styles.payStatusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <StatusIcon size={10} color={statusInfo.color} />
            <Text style={[styles.payStatusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
          <View style={styles.payCardMetaRow}>
            <View style={[styles.providerTag, { backgroundColor: providerInfo.bgColor }]}>
              <Text style={[styles.providerTagText, { color: providerInfo.color }]}>{providerInfo.label}</Text>
            </View>
            <Text style={styles.payCardDate}>
              {new Date(payment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const { projects, invoices, contacts } = useProjects();
  const [selectedTab, setSelectedTab] = useState<'all' | 'pending' | 'completed'>('all');

  // Derive the whole feed from real invoice data. Recomputes cheaply — the
  // three inputs are already memoized by ProjectContext.
  const payments = useMemo(
    () => derivePayments(projects, invoices, contacts),
    [projects, invoices, contacts],
  );

  const filtered = useMemo(() => {
    if (selectedTab === 'all') return payments;
    if (selectedTab === 'pending') return payments.filter(p => p.status === 'pending' || p.status === 'processing');
    return payments.filter(p => p.status === 'completed');
  }, [payments, selectedTab]);

  const stats = useMemo(() => {
    const received = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.netAmount, 0);
    const pending = payments.filter(p => p.status === 'pending' || p.status === 'processing').reduce((s, p) => s + p.amount, 0);
    const totalFees = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.fee, 0);
    const failedCount = payments.filter(p => p.status === 'failed').length;
    return { received, pending, totalFees, failedCount };
  }, [payments]);

  // Tapping any row drops you into the invoice — that's where you record a
  // payment, generate/share a Stripe link, or see payment history. The old
  // "Send Reminder" / "Retry" alerts were fake; no backend existed for them.
  const handlePaymentPress = useCallback((payment: Payment) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (payment.invoiceId) {
      router.push({
        pathname: '/invoice' as any,
        params: { projectId: payment.projectId, invoiceId: payment.invoiceId },
      });
      return;
    }
    // No invoice anchor (shouldn't happen with real data, but belt-and-braces
    // so we never leave the user staring at a dead press).
    const providerInfo = PROVIDER_INFO[payment.provider] ?? PROVIDER_INFO.check;
    Alert.alert(
      'Payment Details',
      `${formatMoney(payment.amount)} • ${providerInfo.label}\n${payment.description}`,
    );
  }, []);

  // Route to the oldest outstanding invoice so the GC can generate a Stripe
  // link from there. Picking the oldest (not newest) matches "collect what's
  // overdue first" intuition and is what the user reported needing most.
  const handleSendInvoice = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const outstanding = invoices
      .filter(inv =>
        (inv.totalDue - inv.amountPaid) > 0 &&
        inv.status !== 'draft' &&
        inv.status !== 'paid',
      )
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

    if (outstanding.length === 0) {
      Alert.alert(
        'Nothing to Collect',
        'No outstanding invoices right now. Create or send an invoice to request payment.',
      );
      return;
    }
    const target = outstanding[0];
    router.push({
      pathname: '/invoice' as any,
      params: { projectId: target.projectId, invoiceId: target.id },
    });
  }, [invoices]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Payments', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCards}>
          <View style={[styles.heroCard, { flex: 1.2 }]}>
            <View style={[styles.heroIconWrap, { backgroundColor: '#E8F5E9' }]}>
              <ArrowDownRight size={18} color="#2E7D32" />
            </View>
            <Text style={[styles.heroValue, { color: '#2E7D32' }]}>{formatMoney(stats.received)}</Text>
            <Text style={styles.heroLabel}>Received</Text>
          </View>
          <View style={styles.heroCard}>
            <View style={[styles.heroIconWrap, { backgroundColor: '#FFF3E0' }]}>
              <Clock size={18} color="#E65100" />
            </View>
            <Text style={[styles.heroValue, { color: '#E65100' }]}>{formatMoney(stats.pending)}</Text>
            <Text style={styles.heroLabel}>Pending</Text>
          </View>
        </View>

        <View style={styles.feeRow}>
          <View style={styles.feeItem}>
            <Text style={styles.feeItemLabel}>Processing Fees</Text>
            <Text style={styles.feeItemValue}>{formatMoney(stats.totalFees, 2)}</Text>
          </View>
          {stats.failedCount > 0 && (
            <View style={[styles.feeItem, { backgroundColor: '#FFEBEE' }]}>
              <Text style={[styles.feeItemLabel, { color: '#C62828' }]}>Failed</Text>
              <Text style={[styles.feeItemValue, { color: '#C62828' }]}>{stats.failedCount}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.sendButton} onPress={handleSendInvoice} activeOpacity={0.85}>
          <Send size={18} color="#fff" />
          <Text style={styles.sendButtonText}>Send Payment Request</Text>
        </TouchableOpacity>

        <View style={styles.tabRow}>
          {(['all', 'pending', 'completed'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, selectedTab === tab && styles.tabActive]}
              onPress={() => setSelectedTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, selectedTab === tab && styles.tabTextActive]}>
                {tab === 'all' ? `All (${payments.length})` : tab === 'pending' ? 'Pending' : 'Completed'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <CreditCard size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No payments found</Text>
            </View>
          ) : (
            filtered.map(payment => (
              <PaymentCard key={payment.id} payment={payment} onPress={() => handlePaymentPress(payment)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroCards: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 16,
    marginBottom: 12,
  },
  heroCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  heroValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  heroLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  feeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 16,
  },
  feeItem: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  feeItemLabel: { fontSize: 13, color: Colors.textSecondary },
  feeItemValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  sendButton: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  sendButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: { backgroundColor: Colors.surface },
  tabText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textMuted },
  tabTextActive: { color: Colors.text },
  listSection: { paddingHorizontal: 16 },
  payCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  payCardInner: { padding: 14, gap: 8 },
  payCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerBadgeLetter: { fontSize: 18, fontWeight: '700' as const },
  payCardInfo: { flex: 1, gap: 2 },
  payCardClient: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  payCardProject: { fontSize: 12, color: Colors.textSecondary },
  payCardAmount: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  payCardFee: { fontSize: 11, color: Colors.textMuted },
  payCardDesc: { fontSize: 13, color: Colors.textSecondary },
  payCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  payStatusText: { fontSize: 11, fontWeight: '600' as const },
  payCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  providerTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  providerTagText: { fontSize: 11, fontWeight: '600' as const },
  payCardDate: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
});

```


---

### `components/AIInvoicePredictor.tsx`

```tsx
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Animated, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, Clock, Lightbulb } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  predictInvoicePayment, getCachedResult, setCachedResult,
  type InvoicePredictionResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Invoice } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  invoice: Invoice;
  projectName: string;
  allInvoices: Invoice[];
  subscriptionTier: SubscriptionTierKey;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const CONFIDENCE_STYLES = {
  high: { color: '#2E7D32', bg: '#E8F5E9', label: 'High' },
  medium: { color: '#E65100', bg: '#FFF3E0', label: 'Medium' },
  low: { color: '#757575', bg: '#F5F5F5', label: 'Low' },
} as const;

export default React.memo(function AIInvoicePredictor({ invoice, projectName, allInvoices, subscriptionTier }: Props) {
  const [result, setResult] = useState<InvoicePredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const shimmerAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isLoading, shimmerAnim]);

  const fetchPrediction = useCallback(async () => {
    if (invoice.status === 'paid' || invoice.status === 'draft') return;

    const cacheKey = `invoice_pred_${invoice.id}`;
    const cached = await getCachedResult<InvoicePredictionResult>(cacheKey, TWENTY_FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast');
    if (!limit.allowed) return;

    setIsLoading(true);
    try {
      const paidInvoices = allInvoices.filter(i => i.status === 'paid' && i.payments.length > 0);
      let avgDaysLate = 0;
      if (paidInvoices.length > 0) {
        const totalDaysLate = paidInvoices.reduce((sum, inv) => {
          const due = new Date(inv.dueDate).getTime();
          const lastPayment = inv.payments[inv.payments.length - 1];
          const paid = lastPayment ? new Date(lastPayment.date).getTime() : due;
          return sum + Math.max(0, Math.round((paid - due) / (1000 * 60 * 60 * 24)));
        }, 0);
        avgDaysLate = Math.round(totalDaysLate / paidInvoices.length);
      }

      const data = await predictInvoicePayment(invoice, projectName, {
        avgDaysLate,
        totalInvoices: paidInvoices.length,
      });
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.log('[AI Invoice] Prediction failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [invoice, projectName, allInvoices, subscriptionTier]);

  useEffect(() => {
    if (invoice.status !== 'paid' && invoice.status !== 'draft') {
      void fetchPrediction();
    }
  }, [invoice.id]);

  if (invoice.status === 'paid' || invoice.status === 'draft') return null;

  if (isLoading && !result) {
    const opacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Sparkles size={12} color={Colors.primary} />
          <Text style={styles.headerTitle}>Payment Prediction</Text>
        </View>
        <Animated.View style={[styles.skeleton, { opacity }]} />
        <Animated.View style={[styles.skeleton, styles.skeletonShort, { opacity }]} />
      </View>
    );
  }

  if (!result) return null;

  const conf = CONFIDENCE_STYLES[result.confidenceLevel] ?? CONFIDENCE_STYLES.medium;
  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.headerTitle}>Payment Prediction</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <View style={styles.predRow}>
        <View style={styles.predItem}>
          <Text style={styles.predLabel}>Due date</Text>
          <Text style={styles.predValue}>{dueDate}</Text>
        </View>
        <View style={styles.predItem}>
          <Text style={styles.predLabel}>Predicted payment</Text>
          <Text style={[styles.predValue, { color: Colors.primary }]}>{result.predictedPaymentDate}</Text>
        </View>
        <View style={[styles.confBadge, { backgroundColor: conf.bg }]}>
          <Text style={[styles.confText, { color: conf.color }]}>{conf.label}</Text>
        </View>
      </View>

      <Text style={styles.reasoning}>{result.reasoning}</Text>

      {result.tip ? (
        <View style={styles.tipRow}>
          <Lightbulb size={12} color={Colors.info} />
          <Text style={styles.tipText}>{result.tip}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  predRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  predItem: {
    flex: 1,
  },
  predLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  predValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  confBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  confText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  reasoning: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.infoLight,
    borderRadius: 8,
    padding: 10,
  },
  tipText: {
    fontSize: 12,
    color: Colors.info,
    flex: 1,
    lineHeight: 17,
    fontWeight: '500' as const,
  },
  skeleton: {
    height: 12,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 6,
    marginBottom: 6,
  },
  skeletonShort: {
    width: '60%',
  },
});

```


---

### `components/AIChangeOrderImpact.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, CalendarDays, DollarSign, ArrowRight, Zap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { analyzeChangeOrderImpact, type ChangeOrderImpactResult } from '@/utils/aiService';
import type { ProjectSchedule } from '@/types';

interface Props {
  changeDescription: string;
  lineItems: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  schedule: ProjectSchedule | null;
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default React.memo(function AIChangeOrderImpact({ changeDescription, lineItems, schedule }: Props) {
  const [result, setResult] = useState<ChangeOrderImpactResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleAnalyze = useCallback(async () => {
    if (isLoading || !changeDescription.trim()) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await analyzeChangeOrderImpact(changeDescription, lineItems, schedule);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
      setIsExpanded(true);
    } catch (err) {
      console.error('[AI CO Impact] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, changeDescription, lineItems, schedule]);

  if (!result) {
    return (
      <TouchableOpacity
        style={[styles.triggerBtn, !changeDescription.trim() && styles.triggerDisabled]}
        onPress={handleAnalyze}
        disabled={isLoading || !changeDescription.trim()}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={changeDescription.trim() ? Colors.primary : Colors.textMuted} />
        )}
        <Text style={[styles.triggerText, !changeDescription.trim() && { color: Colors.textMuted }]}>
          {isLoading ? 'Analyzing Impact...' : 'Analyze Impact with AI'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setIsExpanded(!isExpanded)}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>Change Order Impact Analysis</Text>
        </View>
        <Text style={styles.aiTag}>AI</Text>
      </TouchableOpacity>

      {isExpanded && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <CalendarDays size={14} color={Colors.info} />
              <Text style={styles.sectionTitle}>Schedule Impact</Text>
            </View>
            <Text style={styles.impactValue}>+{result.scheduleDays} days</Text>
            {(result.affectedTasks ?? []).map((task, idx) => (
              <View key={idx} style={styles.taskRow}>
                <ArrowRight size={12} color={Colors.textMuted} />
                <Text style={styles.taskText}>
                  "{task.taskName}" pushed {task.daysAdded}d ({task.currentEnd} → {task.newEnd})
                </Text>
              </View>
            ))}
            <Text style={styles.endDate}>New project end: {result.newProjectEndDate}</Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <DollarSign size={14} color={Colors.success} />
              <Text style={styles.sectionTitle}>Cost Impact</Text>
            </View>
            <View style={styles.costGrid}>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Materials</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact?.materials ?? 0)}</Text>
              </View>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Labor</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact?.labor ?? 0)}</Text>
              </View>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Equipment</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact?.equipment ?? 0)}</Text>
              </View>
              <View style={[styles.costItem, { backgroundColor: `${Colors.primary}10` }]}>
                <Text style={[styles.costLabel, { fontWeight: '700' as const }]}>Total</Text>
                <Text style={[styles.costValue, { color: Colors.primary }]}>{formatCurrency(result.costImpact?.total ?? 0)}</Text>
              </View>
            </View>
          </View>

          {(result.downstreamEffects ?? []).length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Zap size={14} color={Colors.warning} />
                <Text style={styles.sectionTitle}>Downstream Effects</Text>
              </View>
              {(result.downstreamEffects ?? []).map((effect, idx) => (
                <Text key={idx} style={styles.effectText}>• {effect}</Text>
              ))}
            </View>
          )}

          <View style={[styles.section, { backgroundColor: `${Colors.primary}08` }]}>
            <Text style={styles.recTitle}>Recommendation</Text>
            <Text style={styles.recText}>{result.recommendation}</Text>
          </View>

          {(result.compressionOptions ?? []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.recTitle}>Compression Options</Text>
              {(result.compressionOptions ?? []).map((opt, idx) => (
                <View key={idx} style={styles.compRow}>
                  <Text style={styles.compDesc}>{opt.description}</Text>
                  <Text style={styles.compMeta}>
                    Save {opt.daysSaved}d for {formatCurrency(opt.costPremium)} premium
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.reanalyzeBtn} onPress={handleAnalyze} disabled={isLoading}>
            <Text style={styles.reanalyzeText}>{isLoading ? 'Re-analyzing...' : 'Re-analyze'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${Colors.primary}20`,
    marginVertical: 8,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  aiTag: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.primary,
    backgroundColor: `${Colors.primary}12`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  section: {
    padding: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    gap: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  impactValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.error,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginLeft: 4,
  },
  taskText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  endDate: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 4,
  },
  costGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  costItem: {
    flex: 1,
    minWidth: '45%',
    padding: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    alignItems: 'center',
  },
  costLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  costValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  effectText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  recTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  recText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
  },
  compRow: {
    padding: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    gap: 2,
  },
  compDesc: {
    fontSize: 13,
    color: Colors.text,
  },
  compMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  reanalyzeBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  reanalyzeText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
});

```


---

### `components/CashFlowSetup.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { DollarSign, Wallet, Clock, CheckCircle, ChevronRight, Plus, X, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { CashFlowExpense, ExpenseCategory, ExpenseFrequency } from '@/utils/cashFlowEngine';
import type { CashFlowData } from '@/utils/cashFlowStorage';

interface CashFlowSetupProps {
  visible: boolean;
  onComplete: (data: CashFlowData) => void;
  onClose: () => void;
}

const EXPENSE_SUGGESTIONS: Array<{ name: string; category: ExpenseCategory; frequency: ExpenseFrequency }> = [
  { name: 'Payroll', category: 'payroll', frequency: 'weekly' },
  { name: 'Insurance', category: 'insurance', frequency: 'monthly' },
  { name: 'Office Overhead', category: 'overhead', frequency: 'monthly' },
  { name: 'Vehicle Payments', category: 'loan', frequency: 'monthly' },
  { name: 'Equipment Rental', category: 'equipment_rental', frequency: 'monthly' },
];

const TERMS_OPTIONS = [
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'due_on_receipt', label: 'Due on Receipt' },
];

export default function CashFlowSetup({ visible, onComplete, onClose }: CashFlowSetupProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [startingBalance, setStartingBalance] = useState('');
  const [expenses, setExpenses] = useState<CashFlowExpense[]>([]);
  const [defaultTerms, setDefaultTerms] = useState('net_30');

  const handleAddSuggestion = useCallback((suggestion: typeof EXPENSE_SUGGESTIONS[0]) => {
    const exists = expenses.some(e => e.name === suggestion.name);
    if (exists) return;
    const newExpense: CashFlowExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: suggestion.name,
      amount: 0,
      frequency: suggestion.frequency,
      category: suggestion.category,
      startDate: new Date().toISOString(),
    };
    setExpenses(prev => [...prev, newExpense]);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [expenses]);

  const handleUpdateExpenseAmount = useCallback((id: string, amount: string) => {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, amount: parseFloat(amount) || 0 } : e));
  }, []);

  const handleRemoveExpense = useCallback((id: string) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleNext = useCallback(() => {
    if (step < 3) {
      setStep(step + 1);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step > 0) setStep(step - 1);
  }, [step]);

  const handleFinish = useCallback(() => {
    const data: CashFlowData = {
      startingBalance: parseFloat(startingBalance) || 0,
      expenses: expenses.filter(e => e.amount > 0),
      expectedPayments: [],
      defaultPaymentTerms: defaultTerms,
      dailyOverheadCost: 350,
      lastUpdated: new Date().toISOString(),
    };
    onComplete(data);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep(0);
    setStartingBalance('');
    setExpenses([]);
    setDefaultTerms('net_30');
  }, [startingBalance, expenses, defaultTerms, onComplete]);

  const freqLabel = (f: ExpenseFrequency) => {
    switch (f) {
      case 'weekly': return '/week';
      case 'biweekly': return '/2 weeks';
      case 'monthly': return '/month';
      case 'one_time': return 'one-time';
    }
  };

  const renderStep0 = () => (
    <View style={styles.stepContent}>
      <View style={[styles.stepIconWrap, { backgroundColor: Colors.primary + '15' }]}>
        <Wallet size={32} color={Colors.primary} />
      </View>
      <Text style={styles.stepTitle}>Current Bank Balance</Text>
      <Text style={styles.stepDesc}>
        This is your starting point. We'll project forward from here.
      </Text>
      <View style={styles.balanceInputWrap}>
        <Text style={styles.dollarSign}>$</Text>
        <TextInput
          style={styles.balanceInput}
          value={startingBalance}
          onChangeText={setStartingBalance}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={Colors.textMuted}
          testID="starting-balance-input"
        />
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <View style={[styles.stepIconWrap, { backgroundColor: Colors.error + '15' }]}>
        <DollarSign size={32} color={Colors.error} />
      </View>
      <Text style={styles.stepTitle}>Recurring Expenses</Text>
      <Text style={styles.stepDesc}>
        Add your regular business expenses. You can always add more later.
      </Text>

      <View style={styles.suggestionsRow}>
        {EXPENSE_SUGGESTIONS.map(s => {
          const added = expenses.some(e => e.name === s.name);
          return (
            <TouchableOpacity
              key={s.name}
              style={[styles.suggestionChip, added && styles.suggestionChipAdded]}
              onPress={() => handleAddSuggestion(s)}
              activeOpacity={0.7}
              disabled={added}
            >
              {added ? <CheckCircle size={14} color={Colors.success} /> : <Plus size={14} color={Colors.primary} />}
              <Text style={[styles.suggestionText, added && { color: Colors.success }]}>{s.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={styles.expenseList} showsVerticalScrollIndicator={false}>
        {expenses.map(exp => (
          <View key={exp.id} style={styles.expenseRow}>
            <View style={styles.expenseInfo}>
              <Text style={styles.expenseName}>{exp.name}</Text>
              <Text style={styles.expenseFreq}>{freqLabel(exp.frequency)}</Text>
            </View>
            <View style={styles.expenseAmountWrap}>
              <Text style={styles.expenseDollar}>$</Text>
              <TextInput
                style={styles.expenseAmountInput}
                value={exp.amount > 0 ? exp.amount.toString() : ''}
                onChangeText={(v) => handleUpdateExpenseAmount(exp.id, v)}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <TouchableOpacity onPress={() => handleRemoveExpense(exp.id)} style={styles.removeBtn}>
              <Trash2 size={14} color={Colors.error} />
            </TouchableOpacity>
          </View>
        ))}
        {expenses.length === 0 && (
          <Text style={styles.emptyText}>Tap suggestions above to add expenses</Text>
        )}
      </ScrollView>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <View style={[styles.stepIconWrap, { backgroundColor: Colors.info + '15' }]}>
        <Clock size={32} color={Colors.info} />
      </View>
      <Text style={styles.stepTitle}>Default Payment Terms</Text>
      <Text style={styles.stepDesc}>
        When you invoice clients, how long do they typically take to pay?
      </Text>

      <View style={styles.termsGrid}>
        {TERMS_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.termsChip, defaultTerms === opt.value && styles.termsChipActive]}
            onPress={() => setDefaultTerms(opt.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.termsChipText, defaultTerms === opt.value && styles.termsChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderStep3 = () => {
    const totalMonthly = expenses.reduce((sum, e) => {
      switch (e.frequency) {
        case 'weekly': return sum + e.amount * 4.33;
        case 'biweekly': return sum + e.amount * 2.17;
        case 'monthly': return sum + e.amount;
        case 'one_time': return sum;
        default: return sum;
      }
    }, 0);

    return (
      <View style={styles.stepContent}>
        <View style={[styles.stepIconWrap, { backgroundColor: Colors.success + '15' }]}>
          <CheckCircle size={32} color={Colors.success} />
        </View>
        <Text style={styles.stepTitle}>You're All Set!</Text>
        <Text style={styles.stepDesc}>
          As you create invoices and track expenses in MAGE ID, your forecast gets smarter automatically.
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Starting Balance</Text>
            <Text style={styles.summaryValue}>${(parseFloat(startingBalance) || 0).toLocaleString()}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Recurring Expenses</Text>
            <Text style={styles.summaryValue}>{expenses.filter(e => e.amount > 0).length} items</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Est. Monthly Burn</Text>
            <Text style={[styles.summaryValue, { color: Colors.error }]}>
              ${totalMonthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Payment Terms</Text>
            <Text style={styles.summaryValue}>
              {TERMS_OPTIONS.find(t => t.value === defaultTerms)?.label}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const steps = [renderStep0, renderStep1, renderStep2, renderStep3];
  const isLast = step === 3;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={Colors.textMuted} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Cash Flow Setup</Text>
            <Text style={styles.stepIndicator}>{step + 1}/4</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((step + 1) / 4) * 100}%` }]} />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {steps[step]()}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            {step > 0 && (
              <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.7}>
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.nextButton, step === 0 && { flex: 1 }]}
              onPress={isLast ? handleFinish : handleNext}
              activeOpacity={0.85}
            >
              <Text style={styles.nextButtonText}>{isLast ? 'Start Forecasting' : 'Continue'}</Text>
              {!isLast && <ChevronRight size={18} color={Colors.textOnPrimary} />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  stepIndicator: { fontSize: 14, fontWeight: '600' as const, color: Colors.textMuted },
  progressTrack: { height: 4, backgroundColor: Colors.fillTertiary, marginHorizontal: 20, borderRadius: 2, overflow: 'hidden' as const },
  progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
  stepContent: { paddingHorizontal: 20, paddingTop: 32, alignItems: 'center' },
  stepIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  stepTitle: { fontSize: 24, fontWeight: '800' as const, color: Colors.text, textAlign: 'center', marginBottom: 8 },
  stepDesc: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24, paddingHorizontal: 16 },
  balanceInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 16, paddingHorizontal: 20, borderWidth: 2, borderColor: Colors.primary + '30', width: '100%', maxWidth: 280 },
  dollarSign: { fontSize: 28, fontWeight: '800' as const, color: Colors.primary, marginRight: 4 },
  balanceInput: { flex: 1, fontSize: 32, fontWeight: '800' as const, color: Colors.text, minHeight: 64, textAlign: 'center' },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%', marginBottom: 16 },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  suggestionChipAdded: { backgroundColor: Colors.successLight, borderWidth: 1, borderColor: Colors.success + '30' },
  suggestionText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  expenseList: { width: '100%', maxHeight: 280 },
  expenseRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  expenseInfo: { flex: 1, gap: 2 },
  expenseName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  expenseFreq: { fontSize: 12, color: Colors.textMuted },
  expenseAmountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8 },
  expenseDollar: { fontSize: 14, fontWeight: '700' as const, color: Colors.textSecondary },
  expenseAmountInput: { width: 80, minHeight: 36, fontSize: 16, fontWeight: '700' as const, color: Colors.text, textAlign: 'right' },
  removeBtn: { padding: 6 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 },
  termsGrid: { width: '100%', gap: 10 },
  termsChip: { paddingVertical: 16, paddingHorizontal: 20, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.cardBorder, alignItems: 'center' },
  termsChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  termsChipText: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  termsChipTextActive: { color: Colors.primary },
  summaryCard: { width: '100%', backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  summaryLabel: { fontSize: 14, color: Colors.textSecondary },
  summaryValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  summaryDivider: { height: 1, backgroundColor: Colors.borderLight },
  footer: { paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10, backgroundColor: Colors.background, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  backButton: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  nextButton: { flex: 2, minHeight: 50, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  nextButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

```


---

### `components/CashFlowChart.tsx`

```tsx
import React, { useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { Colors } from '@/constants/colors';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatCurrencyShort } from '@/utils/cashFlowEngine';

interface CashFlowChartProps {
  weeks: CashFlowWeek[];
  onWeekPress?: (weekIndex: number) => void;
  selectedWeek?: number | null;
}

const BAR_WIDTH = 44;
const CHART_HEIGHT = 200;
const LABEL_HEIGHT = 28;

const CashFlowChart = React.memo(function CashFlowChart({
  weeks,
  onWeekPress,
  selectedWeek,
}: CashFlowChartProps) {
  const scrollRef = useRef<ScrollView>(null);

  const { maxAbsNet, maxAbsBalance, balancePoints } = useMemo(() => {
    let maxNet = 0;
    let maxBal = 0;
    weeks.forEach(w => {
      maxNet = Math.max(maxNet, Math.abs(w.netCashFlow));
      maxBal = Math.max(maxBal, Math.abs(w.runningBalance));
    });
    if (maxNet === 0) maxNet = 1;
    if (maxBal === 0) maxBal = 1;

    const points = weeks.map((w, i) => {
      const normalized = (w.runningBalance + maxBal) / (2 * maxBal);
      const y = CHART_HEIGHT - (normalized * (CHART_HEIGHT - 20)) - 10;
      const x = i * (BAR_WIDTH + 8) + BAR_WIDTH / 2;
      return { x, y, balance: w.runningBalance };
    });

    return { maxAbsNet: maxNet, maxAbsBalance: maxBal, balancePoints: points };
  }, [weeks]);

  const handleWeekPress = useCallback((index: number) => {
    onWeekPress?.(index);
  }, [onWeekPress]);

  const totalWidth = weeks.length * (BAR_WIDTH + 8) + 16;
  const midY = CHART_HEIGHT / 2;

  return (
    <View style={styles.container}>
      <View style={styles.yAxisLabels}>
        <Text style={styles.yLabel}>{formatCurrencyShort(maxAbsNet)}</Text>
        <Text style={[styles.yLabel, { color: Colors.textMuted }]}>$0</Text>
        <Text style={[styles.yLabel, { color: Colors.error }]}>-{formatCurrencyShort(maxAbsNet)}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ width: Math.max(totalWidth, 300), paddingRight: 16 }}
      >
        <View style={{ height: CHART_HEIGHT + LABEL_HEIGHT }}>
          <View style={[styles.zeroLine, { top: midY }]} />

          {balancePoints.length > 1 && (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {balancePoints.map((pt, i) => {
                if (i === 0) return null;
                const prev = balancePoints[i - 1];
                const dx = pt.x - prev.x;
                const dy = pt.y - prev.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                return (
                  <View
                    key={`line-${i}`}
                    style={{
                      position: 'absolute',
                      left: prev.x,
                      top: prev.y,
                      width: length,
                      height: 2,
                      backgroundColor: Colors.info,
                      transform: [{ rotate: `${angle}deg` }],
                      transformOrigin: 'left center',
                      opacity: 0.7,
                    }}
                  />
                );
              })}
              {balancePoints.map((pt, i) => (
                <View
                  key={`dot-${i}`}
                  style={{
                    position: 'absolute',
                    left: pt.x - 3,
                    top: pt.y - 3,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: Colors.info,
                  }}
                />
              ))}
            </View>
          )}

          <View style={styles.barsContainer}>
            {weeks.map((week, i) => {
              const isPositive = week.netCashFlow >= 0;
              const barHeight = maxAbsNet > 0
                ? (Math.abs(week.netCashFlow) / maxAbsNet) * (CHART_HEIGHT / 2 - 10)
                : 0;
              const isSelected = selectedWeek === i;
              const isDanger = week.runningBalance < 0;

              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.barColumn, isSelected && styles.barColumnSelected]}
                  onPress={() => handleWeekPress(i)}
                  activeOpacity={0.7}
                >
                  <View style={{ height: CHART_HEIGHT, justifyContent: 'center' }}>
                    {isPositive ? (
                      <View style={{ alignItems: 'center', justifyContent: 'flex-end', height: CHART_HEIGHT / 2 - 5 }}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: Math.max(barHeight, 2),
                              backgroundColor: isDanger ? Colors.warning : Colors.success,
                            },
                          ]}
                        />
                      </View>
                    ) : (
                      <>
                        <View style={{ height: CHART_HEIGHT / 2 - 5 }} />
                        <View style={{ alignItems: 'center', height: CHART_HEIGHT / 2 - 5 }}>
                          <View
                            style={[
                              styles.bar,
                              {
                                height: Math.max(barHeight, 2),
                                backgroundColor: Colors.error,
                              },
                            ]}
                          />
                        </View>
                      </>
                    )}
                  </View>
                  <View style={styles.barLabel}>
                    <Text style={[styles.barLabelText, isDanger && { color: Colors.error }]}>
                      W{i + 1}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.success }]} />
          <Text style={styles.legendText}>Positive Week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.error }]} />
          <Text style={styles.legendText}>Negative Week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: Colors.info }]} />
          <Text style={styles.legendText}>Balance</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  yAxisLabels: {
    position: 'absolute',
    left: 4,
    top: 16,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  yLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  zeroLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.border,
  },
  barsContainer: {
    flexDirection: 'row',
    paddingLeft: 8,
    gap: 8,
  },
  barColumn: {
    width: BAR_WIDTH,
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 2,
  },
  barColumnSelected: {
    backgroundColor: Colors.fillSecondary,
  },
  bar: {
    width: 28,
    borderRadius: 4,
    minHeight: 2,
  },
  barLabel: {
    height: LABEL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barLabelText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
});

export default CashFlowChart;

```


---

### `components/CashFlowAlerts.tsx`

```tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { AlertTriangle, TrendingUp, Clock, X, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useRouter } from 'expo-router';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatCurrency } from '@/utils/cashFlowEngine';
import type { Invoice } from '@/types';

export interface CashFlowAlert {
  id: string;
  type: 'critical' | 'warning' | 'positive' | 'payment_due' | 'overdue';
  title: string;
  message: string;
  actionLabel?: string;
}

interface CashFlowAlertsProps {
  forecast: CashFlowWeek[] | null;
  invoices: Invoice[];
}

function generateAlerts(forecast: CashFlowWeek[] | null, invoices: Invoice[]): CashFlowAlert[] {
  const alerts: CashFlowAlert[] = [];
  const now = new Date();

  if (forecast && forecast.length > 0) {
    const negativeWeeks = forecast.filter((w, i) => w.runningBalance < 0 && i < 6);
    if (negativeWeeks.length > 0) {
      const first = negativeWeeks[0];
      const weekIdx = forecast.indexOf(first);
      const weeksAway = weekIdx + 1;
      alerts.push({
        id: `critical-${first.weekStart}`,
        type: 'critical',
        title: `Balance goes negative in ${weeksAway} week${weeksAway > 1 ? 's' : ''}`,
        message: `Projected ${formatCurrency(first.runningBalance)} on ${new Date(first.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Open Cash Flow to see solutions.`,
        actionLabel: 'View Forecast',
      });
    }

    const lowWeeks = forecast.filter((w, i) => w.runningBalance > 0 && w.runningBalance < 5000 && i < 8);
    if (lowWeeks.length > 0 && negativeWeeks.length === 0) {
      const first = lowWeeks[0];
      const weekIdx = forecast.indexOf(first);
      alerts.push({
        id: `warning-${first.weekStart}`,
        type: 'warning',
        title: `Low balance in ${weekIdx + 1} weeks`,
        message: `Balance will drop to ${formatCurrency(first.runningBalance)}. Consider invoicing early.`,
        actionLabel: 'View Forecast',
      });
    }

    const allPositive = forecast.slice(0, 4).every(w => w.runningBalance > 10000);
    if (allPositive && forecast.length > 0) {
      alerts.push({
        id: 'positive-outlook',
        type: 'positive',
        title: 'Strong cash position',
        message: 'Good time to invest in materials or take on new projects.',
      });
    }
  }

  invoices.forEach(inv => {
    if (inv.status === 'paid') return;
    const due = new Date(inv.dueDate);
    const remaining = inv.totalDue - inv.amountPaid;
    if (remaining <= 0) return;

    const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      alerts.push({
        id: `overdue-${inv.id}`,
        type: 'overdue',
        title: `Invoice #${inv.number} is ${diffDays} days overdue`,
        message: `${formatCurrency(remaining)} outstanding. Send a reminder.`,
        actionLabel: 'View Invoice',
      });
    } else if (diffDays >= -1 && diffDays <= 0) {
      alerts.push({
        id: `due-${inv.id}`,
        type: 'payment_due',
        title: `Invoice #${inv.number} due today`,
        message: `${formatCurrency(remaining)} payment expected. Follow up with client.`,
      });
    }
  });

  return alerts.slice(0, 3);
}

const ALERT_CONFIG: Record<CashFlowAlert['type'], { bg: string; border: string; iconColor: string; icon: typeof AlertTriangle }> = {
  critical: { bg: Colors.errorLight, border: Colors.error + '40', iconColor: Colors.error, icon: AlertTriangle },
  warning: { bg: Colors.warningLight, border: Colors.warning + '40', iconColor: Colors.warning, icon: AlertTriangle },
  positive: { bg: Colors.successLight, border: Colors.success + '40', iconColor: Colors.success, icon: TrendingUp },
  payment_due: { bg: Colors.infoLight, border: Colors.info + '40', iconColor: Colors.info, icon: Clock },
  overdue: { bg: Colors.errorLight, border: Colors.error + '40', iconColor: Colors.error, icon: Clock },
};

const AlertCard = React.memo(function AlertCard({
  alert,
  onDismiss,
  onAction,
}: {
  alert: CashFlowAlert;
  onDismiss: (id: string) => void;
  onAction: () => void;
}) {
  const config = ALERT_CONFIG[alert.type];
  const IconComponent = config.icon;

  return (
    <View style={[styles.alertCard, { backgroundColor: config.bg, borderColor: config.border }]}>
      <View style={styles.alertTop}>
        <IconComponent size={18} color={config.iconColor} />
        <Text style={[styles.alertTitle, { color: config.iconColor }]} numberOfLines={1}>
          {alert.title}
        </Text>
        <TouchableOpacity onPress={() => onDismiss(alert.id)} style={styles.dismissBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.alertMessage} numberOfLines={2}>{alert.message}</Text>
      {alert.actionLabel && (
        <TouchableOpacity style={styles.alertAction} onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.alertActionText, { color: config.iconColor }]}>{alert.actionLabel}</Text>
          <ChevronRight size={14} color={config.iconColor} />
        </TouchableOpacity>
      )}
    </View>
  );
});

export default function CashFlowAlerts({ forecast, invoices }: CashFlowAlertsProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const alerts = useMemo(() => generateAlerts(forecast, invoices), [forecast, invoices]);
  const visibleAlerts = useMemo(() => alerts.filter(a => !dismissed.has(a.id)), [alerts, dismissed]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => new Set(prev).add(id));
  }, []);

  const handleAction = useCallback(() => {
    router.push('/cash-flow' as any);
  }, [router]);

  if (visibleAlerts.length === 0) return null;

  return (
    <View style={styles.container}>
      {visibleAlerts.map(alert => (
        <AlertCard
          key={alert.id}
          alert={alert}
          onDismiss={handleDismiss}
          onAction={handleAction}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  alertCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  alertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    paddingLeft: 26,
  },
  alertAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 26,
    marginTop: 2,
  },
  alertActionText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
});

```


---

### `utils/cashFlowEngine.ts`

```ts
import type { Invoice, ChangeOrder } from '@/types';
import { getEffectiveInvoiceStatus } from '@/utils/projectFinancials';

export type ExpenseFrequency = 'weekly' | 'biweekly' | 'monthly' | 'one_time';
export type ExpenseCategory = 'payroll' | 'materials' | 'equipment_rental' | 'subcontractor' | 'insurance' | 'overhead' | 'loan' | 'other';

export interface CashFlowExpense {
  id: string;
  name: string;
  amount: number;
  frequency: ExpenseFrequency;
  category: ExpenseCategory;
  startDate: string;
  endDate?: string;
}

export interface ExpectedPayment {
  id: string;
  description: string;
  amount: number;
  expectedDate: string;
  confidence: 'confirmed' | 'expected' | 'hopeful';
  projectId?: string;
}

export interface CashFlowWeek {
  weekStart: string;
  weekEnd: string;
  incomeItems: Array<{ description: string; amount: number; confidence: string }>;
  expenseItems: Array<{ description: string; amount: number; category: string }>;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  runningBalance: number;
}

export interface CashFlowSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  lowestBalance: number;
  lowestBalanceWeek: number;
  highestBalance: number;
  highestBalanceWeek: number;
  dangerWeeks: Array<{ weekNumber: number; weekDate: string; balance: number }>;
}

/**
 * Effective current cash position = stored starting balance + any invoice
 * payments recorded since the balance was last set. Lets the GC set the balance
 * once ("my bank shows $42k today"), then record payments as checks come in
 * without manually re-typing the balance each time.
 */
export function getEffectiveStartingBalance(
  storedBalance: number,
  balanceAsOf: string | undefined,
  invoices: Invoice[],
): number {
  if (!balanceAsOf) return storedBalance;
  const cutoff = new Date(balanceAsOf).getTime();
  if (Number.isNaN(cutoff)) return storedBalance;

  let additional = 0;
  for (const inv of invoices) {
    for (const p of inv.payments ?? []) {
      const ts = new Date(p.date).getTime();
      if (!Number.isNaN(ts) && ts > cutoff) {
        additional += p.amount ?? 0;
      }
    }
    for (const r of inv.retentionReleases ?? []) {
      const ts = new Date(r.date).getTime();
      if (!Number.isNaN(ts) && ts > cutoff) {
        additional += r.amount ?? 0;
      }
    }
  }
  return storedBalance + additional;
}

function getPaymentTermsDays(terms: string | undefined): number {
  switch (terms) {
    case 'net_15': return 15;
    case 'net_45': return 45;
    case 'due_on_receipt': return 0;
    case 'net_30':
    default: return 30;
  }
}

function isDateInWeek(dateStr: string, weekStart: Date, weekEnd: Date): boolean {
  const d = new Date(dateStr);
  return d >= weekStart && d <= weekEnd;
}

function shouldExpenseOccurInWeek(
  expense: CashFlowExpense,
  weekStart: Date,
  weekEnd: Date,
  weekIndex: number
): boolean {
  const start = new Date(expense.startDate);
  if (start > weekEnd) return false;
  if (expense.endDate) {
    const end = new Date(expense.endDate);
    if (end < weekStart) return false;
  }

  switch (expense.frequency) {
    case 'weekly':
      return true;
    case 'biweekly':
      return weekIndex % 2 === 0;
    case 'monthly': {
      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        if (d.getDate() === 1 || d.getDate() === 15) return true;
      }
      return false;
    }
    case 'one_time':
      return isDateInWeek(expense.startDate, weekStart, weekEnd);
    default:
      return false;
  }
}

export function generateForecast(
  startingBalance: number,
  expenses: CashFlowExpense[],
  invoices: Invoice[],
  expectedPayments: ExpectedPayment[],
  weeksToForecast: number,
  defaultPaymentTerms: string = 'net_30',
  changeOrders: ChangeOrder[] = []
): CashFlowWeek[] {
  console.log('[CashFlowEngine] Generating forecast for', weeksToForecast, 'weeks (COs:', changeOrders.length, ')');
  const weeks: CashFlowWeek[] = [];
  let balance = startingBalance;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let w = 0; w < weeksToForecast; w++) {
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const incomeItems: CashFlowWeek['incomeItems'] = [];
    const expenseItems: CashFlowWeek['expenseItems'] = [];

    invoices.forEach(inv => {
      // Use the effective status so an overdue-but-unpaid invoice still forecasts
      // at its original expected date (and a silently paid-in-full one is excluded).
      const effStatus = getEffectiveInvoiceStatus(inv);
      if (effStatus === 'paid' || effStatus === 'draft') return;
      const termsDays = getPaymentTermsDays(inv.paymentTerms ?? defaultPaymentTerms);
      const issueDate = new Date(inv.issueDate);
      const expectedDate = new Date(issueDate);
      expectedDate.setDate(expectedDate.getDate() + termsDays);
      const remaining = inv.totalDue - inv.amountPaid;
      if (remaining > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
        const confidence =
          effStatus === 'overdue' ? 'hopeful' :
          effStatus === 'partially_paid' ? 'expected' :
          effStatus === 'sent' ? 'expected' : 'hopeful';
        incomeItems.push({
          description: `Invoice #${inv.number} (${inv.projectId?.slice(0, 8) ?? 'N/A'})`,
          amount: remaining,
          confidence,
        });
      }
    });

    // Approved change orders that haven't been invoiced yet show as projected
    // future income. Timing: approval date (updatedAt) + payment terms.
    // Pending / submitted COs show with 'hopeful' confidence at a conservative
    // date — today + 21 days (typical approval delay) + payment terms.
    changeOrders.forEach(co => {
      if (co.status === 'approved') {
        const approvedAt = new Date(co.updatedAt);
        const expectedDate = new Date(approvedAt);
        expectedDate.setDate(expectedDate.getDate() + getPaymentTermsDays(defaultPaymentTerms));
        // Only project future CO cash — past expected dates are assumed to have
        // rolled into invoices already (invoice loop will capture them).
        if (expectedDate < today) return;
        if (co.changeAmount > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
          incomeItems.push({
            description: `Change Order #${co.number} (approved)`,
            amount: co.changeAmount,
            confidence: 'expected',
          });
        }
      } else if (co.status === 'submitted' || co.status === 'under_review') {
        const projectedApproval = new Date(today);
        projectedApproval.setDate(projectedApproval.getDate() + 21);
        const expectedDate = new Date(projectedApproval);
        expectedDate.setDate(expectedDate.getDate() + getPaymentTermsDays(defaultPaymentTerms));
        if (co.changeAmount > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
          incomeItems.push({
            description: `Change Order #${co.number} (pending)`,
            amount: co.changeAmount,
            confidence: 'hopeful',
          });
        }
      }
    });

    expectedPayments.forEach(ep => {
      if (isDateInWeek(ep.expectedDate, weekStart, weekEnd)) {
        incomeItems.push({
          description: ep.description,
          amount: ep.amount,
          confidence: ep.confidence,
        });
      }
    });

    expenses.forEach(exp => {
      if (shouldExpenseOccurInWeek(exp, weekStart, weekEnd, w)) {
        let amount = exp.amount;
        if (exp.frequency === 'monthly') {
          amount = exp.amount;
        }
        expenseItems.push({
          description: exp.name,
          amount,
          category: exp.category,
        });
      }
    });

    const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
    const totalExpenses = expenseItems.reduce((s, e) => s + e.amount, 0);
    const netCashFlow = totalIncome - totalExpenses;
    balance += netCashFlow;

    weeks.push({
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      incomeItems,
      expenseItems,
      totalIncome,
      totalExpenses,
      netCashFlow,
      runningBalance: balance,
    });
  }

  console.log('[CashFlowEngine] Forecast generated:', weeks.length, 'weeks');
  return weeks;
}

export function calculateSummary(weeks: CashFlowWeek[]): CashFlowSummary {
  let lowestBalance = Infinity;
  let lowestBalanceWeek = 0;
  let highestBalance = -Infinity;
  let highestBalanceWeek = 0;
  let totalIncome = 0;
  let totalExpenses = 0;
  const dangerWeeks: CashFlowSummary['dangerWeeks'] = [];

  weeks.forEach((w, i) => {
    totalIncome += w.totalIncome;
    totalExpenses += w.totalExpenses;
    if (w.runningBalance < lowestBalance) {
      lowestBalance = w.runningBalance;
      lowestBalanceWeek = i + 1;
    }
    if (w.runningBalance > highestBalance) {
      highestBalance = w.runningBalance;
      highestBalanceWeek = i + 1;
    }
    if (w.runningBalance < 0) {
      dangerWeeks.push({ weekNumber: i + 1, weekDate: w.weekStart, balance: w.runningBalance });
    }
  });

  return {
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    lowestBalance: lowestBalance === Infinity ? 0 : lowestBalance,
    lowestBalanceWeek,
    highestBalance: highestBalance === -Infinity ? 0 : highestBalance,
    highestBalanceWeek,
    dangerWeeks,
  };
}

export function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs >= 1000
    ? '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '$' + abs.toFixed(0);
  return n < 0 ? '-' + formatted : formatted;
}

export function formatCurrencyShort(n: number): string {
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1000000) formatted = `$${(abs / 1000000).toFixed(1)}M`;
  else if (abs >= 1000) formatted = `$${(abs / 1000).toFixed(0)}K`;
  else formatted = `$${abs.toFixed(0)}`;
  return n < 0 ? '-' + formatted : formatted;
}

```


---

### `utils/cashFlowStorage.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CashFlowExpense, ExpectedPayment } from './cashFlowEngine';

const CASHFLOW_DATA_KEY = 'mage_cashflow_data';
const CASHFLOW_SETUP_KEY = 'mage_cashflow_setup_complete';
const CASHFLOW_AI_CACHE_KEY = 'mage_cashflow_ai_cache';

export interface CashFlowData {
  startingBalance: number;
  // The timestamp the startingBalance was last set. Any invoice payments dated
  // AFTER this get auto-added to the effective current balance — that way the
  // GC doesn't have to manually bump the bank balance every time a check clears.
  balanceAsOf?: string;
  expenses: CashFlowExpense[];
  expectedPayments: ExpectedPayment[];
  defaultPaymentTerms: string;
  dailyOverheadCost: number;
  lastUpdated: string;
}

const DEFAULT_CASHFLOW_DATA: CashFlowData = {
  startingBalance: 0,
  balanceAsOf: new Date().toISOString(),
  expenses: [],
  expectedPayments: [],
  defaultPaymentTerms: 'net_30',
  dailyOverheadCost: 350,
  lastUpdated: new Date().toISOString(),
};

export async function loadCashFlowData(): Promise<CashFlowData> {
  try {
    const stored = await AsyncStorage.getItem(CASHFLOW_DATA_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CashFlowData;
      return { ...DEFAULT_CASHFLOW_DATA, ...parsed };
    }
    return DEFAULT_CASHFLOW_DATA;
  } catch (err) {
    console.log('[CashFlowStorage] Load failed:', err);
    return DEFAULT_CASHFLOW_DATA;
  }
}

export async function saveCashFlowData(data: CashFlowData): Promise<void> {
  try {
    const toSave = { ...data, lastUpdated: new Date().toISOString() };
    await AsyncStorage.setItem(CASHFLOW_DATA_KEY, JSON.stringify(toSave));
    console.log('[CashFlowStorage] Data saved');
  } catch (err) {
    console.log('[CashFlowStorage] Save failed:', err);
  }
}

export async function isSetupComplete(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(CASHFLOW_SETUP_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function markSetupComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(CASHFLOW_SETUP_KEY, 'true');
  } catch (err) {
    console.log('[CashFlowStorage] Setup flag save failed:', err);
  }
}

export interface CachedAIAnalysis {
  data: unknown;
  timestamp: number;
  projectId?: string;
}

export async function getCachedAIAnalysis(projectId?: string): Promise<CachedAIAnalysis | null> {
  try {
    const stored = await AsyncStorage.getItem(CASHFLOW_AI_CACHE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as CachedAIAnalysis;
    const fourHours = 4 * 60 * 60 * 1000;
    if (Date.now() - parsed.timestamp > fourHours) return null;
    if (projectId && parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedAIAnalysis(data: unknown, projectId?: string): Promise<void> {
  try {
    const cache: CachedAIAnalysis = { data, timestamp: Date.now(), projectId };
    await AsyncStorage.setItem(CASHFLOW_AI_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.log('[CashFlowStorage] AI cache save failed:', err);
  }
}

```


---

### `utils/paymentPrediction.ts`

```ts
import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Invoice, Project } from '@/types';

export interface InvoicePrediction {
  invoiceId: string;
  invoiceNumber: number;
  projectName: string;
  outstandingAmount: number;
  onTimeProbability: number; // 0-100
  predictedPayDate: string;  // ISO
  daysToPay: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
  suggestedAction: string;
}

export interface PaymentPredictionResult {
  perInvoice: InvoicePrediction[];
  expected7dInflow: number;
  expected14dInflow: number;
  expected30dInflow: number;
  atRiskAmount: number;
  collectionRiskScore: number; // 0-100, higher = riskier
  headline: string;
  topAction: string;
}

const predictionSchema = z.object({
  perInvoice: z.array(z.object({
    invoiceId: z.string(),
    onTimeProbability: z.number(),
    daysToPay: z.number(),
    riskLevel: z.enum(['low', 'medium', 'high']),
    reasons: z.array(z.string()),
    suggestedAction: z.string(),
  })),
  collectionRiskScore: z.number(),
  headline: z.string(),
  topAction: z.string(),
});

const predictionHint = {
  perInvoice: [
    {
      invoiceId: 'inv-123',
      onTimeProbability: 72,
      daysToPay: 18,
      riskLevel: 'medium',
      reasons: ['Client 6 days past due date', 'Progress invoice, large ticket'],
      suggestedAction: 'Send polite reminder email and confirm receipt of invoice.',
    },
  ],
  collectionRiskScore: 38,
  headline: '3 invoices worth $52,400 are at risk of sliding past 30 days.',
  topAction: 'Call Acme LLC about invoice #12 — it is 9 days past due and they typically pay on day 45.',
};

function outstandingOf(inv: Invoice): number {
  const retentionPending = Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0));
  const netPayable = Math.max(0, (inv.totalDue ?? 0) - retentionPending);
  return Math.max(0, netPayable - (inv.amountPaid ?? 0));
}

function daysBetween(a: string, b: string): number {
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (isNaN(t1) || isNaN(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

function describePaymentHistory(inv: Invoice, allInvoices: Invoice[]): string {
  const sameProject = allInvoices.filter(i => i.projectId === inv.projectId && i.id !== inv.id);
  const paidOnes = sameProject.filter(i => i.status === 'paid' && i.payments.length > 0);
  if (paidOnes.length === 0) return 'No prior paid invoices on this project.';
  const gaps = paidOnes.map(p => {
    const firstPayment = p.payments[p.payments.length - 1];
    return daysBetween(p.issueDate, firstPayment.date);
  }).filter(n => n >= 0);
  if (gaps.length === 0) return 'No prior paid invoices on this project.';
  const avg = Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length);
  return `Avg pay time on prior ${paidOnes.length} invoice${paidOnes.length === 1 ? '' : 's'}: ${avg} days from issue.`;
}

export async function predictInvoicePayments(
  invoices: Invoice[],
  projectsById: Record<string, Project>,
): Promise<PaymentPredictionResult> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // Only predict unpaid / partially paid
  const unpaid = invoices.filter(i => {
    const out = outstandingOf(i);
    return out > 0 && i.status !== 'draft';
  });

  if (unpaid.length === 0) {
    return {
      perInvoice: [],
      expected7dInflow: 0,
      expected14dInflow: 0,
      expected30dInflow: 0,
      atRiskAmount: 0,
      collectionRiskScore: 0,
      headline: 'No unpaid invoices to forecast.',
      topAction: 'Keep the cadence going — issue your next progress invoice when milestones complete.',
    };
  }

  const compact = unpaid.map(inv => {
    const project = projectsById[inv.projectId];
    const outstanding = outstandingOf(inv);
    const daysSinceIssue = daysBetween(inv.issueDate, todayIso);
    const daysToDue = daysBetween(todayIso, inv.dueDate);
    const pastDue = daysToDue < 0 ? Math.abs(daysToDue) : 0;
    return {
      id: inv.id,
      number: inv.number,
      project: project?.name || 'Unknown project',
      projectStatus: project?.status || 'unknown',
      type: inv.type,
      progressPercent: inv.progressPercent,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      paymentTerms: inv.paymentTerms,
      totalDue: inv.totalDue,
      amountPaid: inv.amountPaid,
      outstanding,
      daysSinceIssue,
      daysToDue,
      pastDueDays: pastDue,
      paymentsCount: inv.payments.length,
      retentionPending: Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0)),
      history: describePaymentHistory(inv, invoices),
    };
  });

  const prompt = `You are a construction A/R analyst. For each unpaid invoice, predict payment timing based on client behavior signals and invoice characteristics.

TODAY: ${todayIso}

UNPAID INVOICES (${compact.length}):
${JSON.stringify(compact, null, 2)}

For EACH invoice, return in "perInvoice":
- invoiceId: exactly as provided
- onTimeProbability: 0-100 (probability paid by due date, or within 7 days of today if already past due)
- daysToPay: your realistic estimate of days from TODAY until full payment clears
- riskLevel: "low" (likely paid soon), "medium" (likely 2-4 weeks), "high" (likely 30+ days or write-off risk)
- reasons: 1-3 short bullets citing specific signals (past-due days, payment history, project status, terms)
- suggestedAction: one actionable step the contractor should take right now (call, reminder email, lien notice, offer discount, etc.)

Also return:
- collectionRiskScore: 0-100 portfolio risk (weighted by dollar exposure)
- headline: one sentence summarizing A/R health ("3 invoices worth $X are sliding…")
- topAction: the single highest-leverage action across all invoices

Be concrete. Use specific invoice numbers and project names in headline/topAction. Return JSON only.`;

  const aiResult = await mageAI({
    prompt,
    schema: predictionSchema,
    schemaHint: predictionHint,
    tier: 'smart',
    maxTokens: 2000,
  });

  if (!aiResult.success || !aiResult.data) {
    throw new Error(aiResult.error || 'AI could not forecast payments.');
  }

  let parsed: any = aiResult.data;
  if (typeof parsed === 'string') {
    let cleaned = parsed.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    try { parsed = JSON.parse(cleaned.trim()); } catch { throw new Error('AI returned invalid JSON'); }
  }

  const perInvoiceRaw: any[] = parsed?.perInvoice ?? [];
  const byId = new Map<string, any>();
  perInvoiceRaw.forEach(r => { if (r?.invoiceId) byId.set(r.invoiceId, r); });

  const perInvoice: InvoicePrediction[] = unpaid.map(inv => {
    const aiRow = byId.get(inv.id);
    const project = projectsById[inv.projectId];
    const outstanding = outstandingOf(inv);
    const daysToPay = typeof aiRow?.daysToPay === 'number' ? Math.max(0, Math.round(aiRow.daysToPay)) : 21;
    const predicted = new Date(today.getTime() + daysToPay * 86_400_000).toISOString();
    const riskLevel: 'low' | 'medium' | 'high' = aiRow?.riskLevel === 'low' || aiRow?.riskLevel === 'high' ? aiRow.riskLevel : 'medium';
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      projectName: project?.name || 'Project',
      outstandingAmount: outstanding,
      onTimeProbability: typeof aiRow?.onTimeProbability === 'number'
        ? Math.max(0, Math.min(100, Math.round(aiRow.onTimeProbability)))
        : 50,
      predictedPayDate: predicted,
      daysToPay,
      riskLevel,
      reasons: Array.isArray(aiRow?.reasons) ? aiRow.reasons.slice(0, 3).map((r: any) => String(r)) : [],
      suggestedAction: typeof aiRow?.suggestedAction === 'string'
        ? aiRow.suggestedAction
        : 'Follow up with the client to confirm payment timing.',
    };
  });

  const expected7dInflow = perInvoice
    .filter(p => p.daysToPay <= 7)
    .reduce((s, p) => s + p.outstandingAmount * (p.onTimeProbability / 100), 0);
  const expected14dInflow = perInvoice
    .filter(p => p.daysToPay <= 14)
    .reduce((s, p) => s + p.outstandingAmount * (p.onTimeProbability / 100), 0);
  const expected30dInflow = perInvoice
    .filter(p => p.daysToPay <= 30)
    .reduce((s, p) => s + p.outstandingAmount * (p.onTimeProbability / 100), 0);
  const atRiskAmount = perInvoice
    .filter(p => p.riskLevel === 'high')
    .reduce((s, p) => s + p.outstandingAmount, 0);

  return {
    perInvoice,
    expected7dInflow,
    expected14dInflow,
    expected30dInflow,
    atRiskAmount,
    collectionRiskScore: typeof parsed?.collectionRiskScore === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.collectionRiskScore)))
      : 50,
    headline: typeof parsed?.headline === 'string' ? parsed.headline : `Forecasting ${perInvoice.length} unpaid invoices.`,
    topAction: typeof parsed?.topAction === 'string' ? parsed.topAction : 'Review the highest-risk invoice first.',
  };
}

```


---

### `utils/projectFinancials.ts`

```ts
// Project financial derivations.
//
// The "contract value" of a project is not a stored field. It's derived every time
// from (a) the base estimate total, plus (b) the sum of all approved change order
// change amounts. Storing it would invite drift between the CO screen, the cash flow
// forecast, the portal snapshot, and anything else that reads it. So this file is the
// single source of truth for anything money-shaped that spans Project + ChangeOrders
// + Invoices.

import type { Project, ChangeOrder, Invoice, InvoiceStatus } from '@/types';

/**
 * Total contract value = base estimate + approved change orders.
 * Unapproved / void / rejected COs do not count.
 */
export function getContractValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  const base = project?.estimate?.grandTotal ?? 0;
  const coSum = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  return base + coSum;
}

/**
 * Base estimate before any change orders (useful for showing the "original"
 * contract total next to the "current" one for transparency).
 */
export function getBaseContractValue(project: Project | null | undefined): number {
  return project?.estimate?.grandTotal ?? 0;
}

/**
 * Pending CO value — COs that are submitted but not yet approved or rejected.
 * Useful for "potential upside" callouts in the UI.
 */
export function getPendingChangeOrderValue(
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  return (changeOrders ?? [])
    .filter(co => co.status === 'submitted' || co.status === 'under_review')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
}

/**
 * Total already collected from the client (invoices.amountPaid summed).
 * Includes retention releases if they've been recorded as payments.
 */
export function getPaidToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? []).reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
}

/**
 * Total invoiced — what has been billed regardless of payment status.
 * Excludes drafts (which represent work not yet submitted for payment).
 */
export function getInvoicedToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + (inv.totalDue ?? 0), 0);
}

/**
 * Outstanding = invoiced – paid. The amount the GC is waiting on.
 */
export function getOutstandingBalance(invoices: Invoice[] | null | undefined): number {
  const billed = getInvoicedToDate(invoices);
  const paid = getPaidToDate(invoices);
  return Math.max(0, billed - paid);
}

/**
 * Unbilled = contract value – invoiced. Work not yet turned into invoices.
 */
export function getUnbilledValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  const billed = getInvoicedToDate(invoices);
  return Math.max(0, contractValue - billed);
}

/**
 * Effective invoice status — computed rather than stored, because a stored
 * `status = 'sent'` invoice is actually overdue once its due date passes but
 * nobody's running a cron to mutate the record. Use this anywhere you render
 * a status badge so the UI always reflects reality.
 */
export function getEffectiveInvoiceStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === 'draft') return 'draft';
  if (invoice.status === 'paid') return 'paid';
  if (invoice.amountPaid >= invoice.totalDue && invoice.totalDue > 0) return 'paid';
  if (invoice.amountPaid > 0 && invoice.amountPaid < invoice.totalDue) return 'partially_paid';

  // Overdue check — 'sent' with a due date in the past.
  if (invoice.status === 'sent' && invoice.dueDate) {
    const dueTs = new Date(invoice.dueDate).getTime();
    if (!Number.isNaN(dueTs) && dueTs < Date.now()) return 'overdue';
  }
  return invoice.status;
}

/**
 * Days past due for an overdue invoice. Returns 0 if not overdue.
 */
export function getDaysPastDue(invoice: Invoice): number {
  const eff = getEffectiveInvoiceStatus(invoice);
  if (eff !== 'overdue') return 0;
  if (!invoice.dueDate) return 0;
  const dueTs = new Date(invoice.dueDate).getTime();
  if (Number.isNaN(dueTs)) return 0;
  const diffMs = Date.now() - dueTs;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Percent complete by billing — how far through the contract has the GC billed?
 * Used in budget summary widgets and the client portal.
 */
export function getPercentBilled(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  if (contractValue <= 0) return 0;
  const billed = getInvoicedToDate(invoices);
  return Math.min(100, Math.round((billed / contractValue) * 100));
}

/**
 * Percent complete by cash — how much of the contract has actually been paid?
 */
export function getPercentPaid(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  if (contractValue <= 0) return 0;
  const paid = getPaidToDate(invoices);
  return Math.min(100, Math.round((paid / contractValue) * 100));
}

/**
 * Compact financial summary the UI layer can destructure.
 */
export interface ProjectFinancialSummary {
  baseContract: number;
  approvedChangeOrderTotal: number;
  pendingChangeOrderTotal: number;
  contractValue: number;
  invoiced: number;
  paidToDate: number;
  outstanding: number;
  unbilled: number;
  pctBilled: number;
  pctPaid: number;
  hasOverdueInvoices: boolean;
  overdueAmount: number;
}

export function summarizeProjectFinancials(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): ProjectFinancialSummary {
  const baseContract = getBaseContractValue(project);
  const approvedCO = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  const pendingCO = getPendingChangeOrderValue(changeOrders);
  const contractValue = baseContract + approvedCO;
  const invoiced = getInvoicedToDate(invoices);
  const paidToDate = getPaidToDate(invoices);
  const outstanding = Math.max(0, invoiced - paidToDate);
  const unbilled = Math.max(0, contractValue - invoiced);

  const overdueInvoices = (invoices ?? []).filter(
    inv => getEffectiveInvoiceStatus(inv) === 'overdue',
  );
  const overdueAmount = overdueInvoices.reduce(
    (sum, inv) => sum + Math.max(0, inv.totalDue - inv.amountPaid),
    0,
  );

  return {
    baseContract,
    approvedChangeOrderTotal: approvedCO,
    pendingChangeOrderTotal: pendingCO,
    contractValue,
    invoiced,
    paidToDate,
    outstanding,
    unbilled,
    pctBilled: contractValue > 0 ? Math.min(100, Math.round((invoiced / contractValue) * 100)) : 0,
    pctPaid: contractValue > 0 ? Math.min(100, Math.round((paidToDate / contractValue) * 100)) : 0,
    hasOverdueInvoices: overdueInvoices.length > 0,
    overdueAmount,
  };
}

```


---

### `utils/aiaBilling.ts`

```ts
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding, Project, Invoice, ChangeOrder } from '@/types';

// ──────────────────────────────────────────────────────────────────────────────
// AIA G702/G703 progress pay application generator
// G702 = cover summary (totals, retention, amount due this period)
// G703 = continuation sheet (schedule of values line-by-line with % complete)
// ──────────────────────────────────────────────────────────────────────────────

export interface AIASOVLine {
  id: string;
  itemNo: string;          // "1.0", "2.1", etc.
  description: string;
  scheduledValue: number;  // column C
  fromPreviousApp: number; // column D — work completed before this period
  thisPeriod: number;      // column E — work completed this period
  materialsPresentlyStored: number; // column F
  retainagePercent: number; // default from cover
}

export interface AIAPayApplication {
  applicationNumber: number;
  applicationDate: string;  // ISO
  periodTo: string;          // ISO — end of billing period
  contractDate?: string;

  ownerName: string;
  contractorName: string;
  architectName?: string;
  projectName: string;
  projectLocation?: string;
  contractForDescription?: string;

  originalContractSum: number;
  netChangeByCO: number;        // sum of approved COs through this period
  contractSumToDate: number;    // = originalContractSum + netChangeByCO

  retainagePercent: number;     // typically 5-10

  // Previous certificate values (from prior pay apps, if known)
  lessPreviousCertificates: number;

  lines: AIASOVLine[];
  notes?: string;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Compute the derived totals for a G702 cover from the SOV lines.
 */
export function computeAIATotals(app: AIAPayApplication) {
  const totalCompletedAndStored = app.lines.reduce(
    (s, l) => s + l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored,
    0,
  );
  const totalScheduledValue = app.lines.reduce((s, l) => s + l.scheduledValue, 0);
  const retainageOnCompleted = app.lines.reduce(
    (s, l) => s + (l.fromPreviousApp + l.thisPeriod) * (l.retainagePercent / 100),
    0,
  );
  const retainageOnStored = app.lines.reduce(
    (s, l) => s + l.materialsPresentlyStored * (l.retainagePercent / 100),
    0,
  );
  const totalRetainage = retainageOnCompleted + retainageOnStored;
  const totalEarnedLessRetainage = totalCompletedAndStored - totalRetainage;
  const currentPaymentDue = totalEarnedLessRetainage - app.lessPreviousCertificates;
  const balanceToFinish = app.contractSumToDate - totalEarnedLessRetainage;
  const percentComplete = totalScheduledValue > 0
    ? (totalCompletedAndStored / totalScheduledValue) * 100
    : 0;

  return {
    totalCompletedAndStored,
    totalScheduledValue,
    retainageOnCompleted,
    retainageOnStored,
    totalRetainage,
    totalEarnedLessRetainage,
    currentPaymentDue,
    balanceToFinish,
    percentComplete,
  };
}

/**
 * Prefill an AIA pay application from a MAGE ID invoice + project + approved COs.
 * Lines are seeded from the invoice's lineItems, with `thisPeriod` = line total (contractor
 * can edit on the screen).
 */
export function seedAIAPayApplicationFromInvoice(
  invoice: Invoice,
  project: Project,
  approvedCOs: ChangeOrder[],
  branding: CompanyBranding,
  opts?: {
    lessPreviousCertificates?: number;
    retainagePercent?: number;
    applicationNumber?: number;
    architectName?: string;
    ownerName?: string;
  },
): AIAPayApplication {
  const retainagePercent = opts?.retainagePercent ?? invoice.retentionPercent ?? 10;
  const originalContractSum = project.estimate?.grandTotal ?? 0;
  const netChangeByCO = approvedCOs.reduce((s, co) => s + co.changeAmount, 0);
  const contractSumToDate = originalContractSum + netChangeByCO;

  const lines: AIASOVLine[] = invoice.lineItems.map((li, i) => ({
    id: li.id,
    itemNo: String(i + 1),
    description: [li.name, li.description].filter(Boolean).join(' — '),
    scheduledValue: li.total,
    fromPreviousApp: 0,
    thisPeriod: li.total,
    materialsPresentlyStored: 0,
    retainagePercent,
  }));

  return {
    applicationNumber: opts?.applicationNumber ?? invoice.number,
    applicationDate: invoice.issueDate,
    periodTo: invoice.issueDate,
    contractDate: undefined,
    ownerName: opts?.ownerName ?? '',
    contractorName: branding.companyName ?? 'Contractor',
    architectName: opts?.architectName,
    projectName: project.name,
    projectLocation: project.location,
    contractForDescription: project.description,
    originalContractSum,
    netChangeByCO,
    contractSumToDate,
    retainagePercent,
    lessPreviousCertificates: opts?.lessPreviousCertificates ?? 0,
    lines,
    notes: invoice.notes,
  };
}

/**
 * Build the HTML for a G702+G703 pay application. Paginates naturally via @media print.
 */
export function buildAIAPayAppHtml(
  app: AIAPayApplication,
  branding: CompanyBranding,
): string {
  const totals = computeAIATotals(app);

  const logoBlock = branding.logoUri
    ? `<img src="${escapeHtml(branding.logoUri)}" class="logo" alt="logo" />`
    : '';

  const g703Rows = app.lines.map((l, i) => {
    const totalCompleted = l.fromPreviousApp + l.thisPeriod;
    const totalCompletedAndStored = totalCompleted + l.materialsPresentlyStored;
    const pct = l.scheduledValue > 0
      ? (totalCompletedAndStored / l.scheduledValue) * 100
      : 0;
    const balanceToFinish = l.scheduledValue - totalCompletedAndStored;
    const retainage = totalCompletedAndStored * (l.retainagePercent / 100);
    return `
      <tr class="${i % 2 === 0 ? 'alt' : ''}">
        <td class="ctr">${escapeHtml(l.itemNo)}</td>
        <td>${escapeHtml(l.description)}</td>
        <td class="num">${fmt(l.scheduledValue)}</td>
        <td class="num">${fmt(l.fromPreviousApp)}</td>
        <td class="num">${fmt(l.thisPeriod)}</td>
        <td class="num">${fmt(l.materialsPresentlyStored)}</td>
        <td class="num">${fmt(totalCompletedAndStored)}</td>
        <td class="num">${pct.toFixed(1)}%</td>
        <td class="num">${fmt(balanceToFinish)}</td>
        <td class="num">${fmt(retainage)}</td>
      </tr>
    `;
  }).join('');

  // G703 footer totals row
  const sumCol = (key: 'scheduledValue' | 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored') =>
    app.lines.reduce((s, l) => s + (l[key] as number), 0);

  const g703TotalScheduled = sumCol('scheduledValue');
  const g703TotalFromPrev = sumCol('fromPreviousApp');
  const g703TotalThisPeriod = sumCol('thisPeriod');
  const g703TotalStored = sumCol('materialsPresentlyStored');
  const g703TotalCompletedStored = g703TotalFromPrev + g703TotalThisPeriod + g703TotalStored;
  const g703TotalRetainage = app.lines.reduce(
    (s, l) => s + (l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored) * (l.retainagePercent / 100),
    0,
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: #111;
    margin: 0;
    padding: 0;
  }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  .form-header {
    border: 2px solid #111;
    padding: 8px 12px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .form-header .title-block { flex: 1; }
  .form-header h1 {
    margin: 0 0 2px 0;
    font-size: 14px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .form-header .form-number {
    font-size: 9px;
    color: #555;
    letter-spacing: 1px;
  }
  .logo { max-height: 44px; max-width: 140px; object-fit: contain; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .info-box {
    border: 1px solid #111;
    padding: 6px 10px;
  }
  .info-box .label {
    display: block;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
    margin-bottom: 2px;
  }
  .info-box .value { font-size: 11px; font-weight: 600; }

  .app-meta {
    border: 1px solid #111;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 10px;
  }

  table { width: 100%; border-collapse: collapse; }
  table.cover th, table.cover td {
    border: 1px solid #111;
    padding: 4px 8px;
    vertical-align: top;
    font-size: 10px;
  }
  table.cover td.num, table.cover th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.cover .line-label {
    font-weight: 600;
    background: #f5f5f5;
  }
  table.cover .grand {
    background: #111;
    color: #fff;
    font-weight: 700;
    font-size: 11px;
  }

  .cert-block {
    border: 1px solid #111;
    padding: 10px;
    margin-top: 10px;
    font-size: 9px;
    line-height: 1.4;
  }
  .cert-block .cert-body {
    margin-bottom: 20px;
  }
  .cert-block .sig-row {
    display: flex;
    gap: 20px;
    margin-top: 20px;
  }
  .cert-block .sig-col {
    flex: 1;
    border-top: 1px solid #111;
    padding-top: 4px;
    font-size: 9px;
  }

  /* G703 continuation sheet */
  table.g703 {
    font-size: 8.5px;
    margin-top: 6px;
  }
  table.g703 th, table.g703 td {
    border: 1px solid #111;
    padding: 3px 4px;
    vertical-align: top;
  }
  table.g703 thead th {
    background: #111;
    color: #fff;
    font-weight: 700;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  table.g703 tr.alt td { background: #f9f9f9; }
  table.g703 td.num, table.g703 th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.g703 td.ctr, table.g703 th.ctr { text-align: center; }
  table.g703 tfoot td {
    font-weight: 700;
    background: #111;
    color: #fff;
  }

  .page-footer {
    position: fixed;
    bottom: 0.25in;
    left: 0.5in;
    right: 0.5in;
    text-align: center;
    font-size: 8px;
    color: #666;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>

<!-- ═════════ PAGE 1: G702 COVER ═════════ -->
<div class="page">
  <div class="form-header">
    <div class="title-block">
      <h1>Application and Certificate for Payment</h1>
      <div class="form-number">AIA-Style Document G702 · Progress Billing</div>
    </div>
    ${logoBlock}
  </div>

  <div class="grid-2">
    <div class="info-box">
      <span class="label">To Owner</span>
      <div class="value">${escapeHtml(app.ownerName || '—')}</div>
    </div>
    <div class="info-box">
      <span class="label">From Contractor</span>
      <div class="value">${escapeHtml(app.contractorName)}</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="info-box">
      <span class="label">Project</span>
      <div class="value">${escapeHtml(app.projectName)}</div>
      ${app.projectLocation ? `<div style="font-size:9px;color:#555;margin-top:2px">${escapeHtml(app.projectLocation)}</div>` : ''}
    </div>
    <div class="info-box">
      <span class="label">Via Architect</span>
      <div class="value">${escapeHtml(app.architectName || '—')}</div>
    </div>
  </div>

  <div class="app-meta">
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Application No.</span>
      <div style="font-size:14px;font-weight:700;">#${app.applicationNumber}</div>
    </div>
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Period To</span>
      <div style="font-size:11px;font-weight:600;">${fmtDate(app.periodTo)}</div>
    </div>
    <div>
      <span class="label" style="font-size:8px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Application Date</span>
      <div style="font-size:11px;font-weight:600;">${fmtDate(app.applicationDate)}</div>
    </div>
  </div>

  <!-- Application summary -->
  <table class="cover">
    <tbody>
      <tr>
        <td class="line-label" style="width:70%;">1. Original Contract Sum</td>
        <td class="num">$ ${fmt(app.originalContractSum)}</td>
      </tr>
      <tr>
        <td class="line-label">2. Net Change by Change Orders</td>
        <td class="num">${app.netChangeByCO >= 0 ? '' : '-'}$ ${fmt(Math.abs(app.netChangeByCO))}</td>
      </tr>
      <tr>
        <td class="line-label">3. Contract Sum to Date (Line 1 ± 2)</td>
        <td class="num">$ ${fmt(app.contractSumToDate)}</td>
      </tr>
      <tr>
        <td class="line-label">4. Total Completed &amp; Stored to Date (Column G on G703)</td>
        <td class="num">$ ${fmt(totals.totalCompletedAndStored)}</td>
      </tr>
      <tr>
        <td class="line-label">5. Retainage</td>
        <td class="num"></td>
      </tr>
      <tr>
        <td style="padding-left:24px;">&nbsp;&nbsp;&nbsp;a. ${app.retainagePercent}% of Completed Work</td>
        <td class="num">$ ${fmt(totals.retainageOnCompleted)}</td>
      </tr>
      <tr>
        <td style="padding-left:24px;">&nbsp;&nbsp;&nbsp;b. ${app.retainagePercent}% of Stored Material</td>
        <td class="num">$ ${fmt(totals.retainageOnStored)}</td>
      </tr>
      <tr>
        <td style="padding-left:24px;"><b>&nbsp;&nbsp;&nbsp;Total Retainage</b></td>
        <td class="num"><b>$ ${fmt(totals.totalRetainage)}</b></td>
      </tr>
      <tr>
        <td class="line-label">6. Total Earned Less Retainage (Line 4 − 5)</td>
        <td class="num">$ ${fmt(totals.totalEarnedLessRetainage)}</td>
      </tr>
      <tr>
        <td class="line-label">7. Less Previous Certificates for Payment</td>
        <td class="num">$ ${fmt(app.lessPreviousCertificates)}</td>
      </tr>
      <tr class="grand">
        <td>8. CURRENT PAYMENT DUE</td>
        <td class="num">$ ${fmt(totals.currentPaymentDue)}</td>
      </tr>
      <tr>
        <td class="line-label">9. Balance to Finish, Including Retainage (Line 3 − 6)</td>
        <td class="num">$ ${fmt(totals.balanceToFinish)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Change order summary -->
  <table class="cover" style="margin-top:10px;">
    <thead>
      <tr>
        <th>Change Order Summary</th>
        <th class="num">Additions</th>
        <th class="num">Deductions</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Net change by Change Orders</td>
        <td class="num">$ ${fmt(Math.max(0, app.netChangeByCO))}</td>
        <td class="num">$ ${fmt(Math.max(0, -app.netChangeByCO))}</td>
      </tr>
    </tbody>
  </table>

  <!-- Certification -->
  <div class="cert-block">
    <div class="cert-body">
      <b>CONTRACTOR'S CERTIFICATION:</b> The undersigned Contractor certifies that to the best of the Contractor's knowledge, information and belief the Work covered by this Application for Payment has been completed in accordance with the Contract Documents, that all amounts have been paid by the Contractor for Work for which previous Certificates for Payment were issued and payments received from the Owner, and that current payment shown herein is now due.
    </div>
    <div class="sig-row">
      <div class="sig-col">
        <div style="font-weight:600;">Contractor</div>
        <div style="color:#666;font-size:8px;">${escapeHtml(app.contractorName)}</div>
      </div>
      <div class="sig-col">
        <div style="font-weight:600;">By</div>
        <div style="color:#666;font-size:8px;">Signature · Date</div>
      </div>
    </div>
    <div class="sig-row" style="margin-top:10px;">
      <div class="sig-col">
        <div style="font-weight:600;">Architect / Owner Certification</div>
        <div style="color:#666;font-size:8px;">Amount Certified: $ ______________</div>
      </div>
      <div class="sig-col">
        <div style="font-weight:600;">By</div>
        <div style="color:#666;font-size:8px;">Signature · Date</div>
      </div>
    </div>
  </div>

  ${app.notes ? `<div style="margin-top:10px;font-size:9px;color:#333;"><b>Notes:</b> ${escapeHtml(app.notes)}</div>` : ''}

  <div class="page-footer">
    Generated by MAGE ID · Application #${app.applicationNumber} · Page 1 of 2 · G702 Cover
  </div>
</div>

<!-- ═════════ PAGE 2: G703 CONTINUATION SHEET ═════════ -->
<div class="page">
  <div class="form-header">
    <div class="title-block">
      <h1>Continuation Sheet</h1>
      <div class="form-number">AIA-Style Document G703 · Schedule of Values · App #${app.applicationNumber}</div>
    </div>
    ${logoBlock}
  </div>

  <div class="grid-2" style="grid-template-columns: 2fr 1fr; gap:10px; margin-bottom:8px;">
    <div class="info-box">
      <span class="label">Project</span>
      <div class="value">${escapeHtml(app.projectName)}</div>
    </div>
    <div class="info-box">
      <span class="label">Period To</span>
      <div class="value">${fmtDate(app.periodTo)}</div>
    </div>
  </div>

  <table class="g703">
    <thead>
      <tr>
        <th class="ctr" rowspan="2">A<br/>Item</th>
        <th rowspan="2">B<br/>Description of Work</th>
        <th class="num" rowspan="2">C<br/>Scheduled Value</th>
        <th class="num" colspan="2">Work Completed</th>
        <th class="num" rowspan="2">F<br/>Materials Presently Stored</th>
        <th class="num" rowspan="2">G<br/>Total Completed &amp; Stored</th>
        <th class="num" rowspan="2">%<br/>(G ÷ C)</th>
        <th class="num" rowspan="2">H<br/>Balance to Finish</th>
        <th class="num" rowspan="2">I<br/>Retainage</th>
      </tr>
      <tr>
        <th class="num">D<br/>From Previous</th>
        <th class="num">E<br/>This Period</th>
      </tr>
    </thead>
    <tbody>
      ${g703Rows || '<tr><td colspan="10" style="text-align:center;color:#888;padding:20px;">No schedule of values lines.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2" class="ctr">GRAND TOTAL</td>
        <td class="num">${fmt(g703TotalScheduled)}</td>
        <td class="num">${fmt(g703TotalFromPrev)}</td>
        <td class="num">${fmt(g703TotalThisPeriod)}</td>
        <td class="num">${fmt(g703TotalStored)}</td>
        <td class="num">${fmt(g703TotalCompletedStored)}</td>
        <td class="num">${totals.percentComplete.toFixed(1)}%</td>
        <td class="num">${fmt(g703TotalScheduled - g703TotalCompletedStored)}</td>
        <td class="num">${fmt(g703TotalRetainage)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="page-footer">
    Generated by MAGE ID · Application #${app.applicationNumber} · Page 2 of 2 · G703 Continuation
  </div>
</div>

</body>
</html>`;
}

export async function generateAIAPayAppPDF(
  app: AIAPayApplication,
  branding: CompanyBranding,
): Promise<void> {
  const html = buildAIAPayAppHtml(app, branding);
  const title = `${app.projectName} · Pay App #${app.applicationNumber}`;

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
        setTimeout(() => newWindow.print(), 400);
      }
    }
    return;
  }

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: title,
        UTI: 'com.adobe.pdf',
      });
    } else {
      await Print.printAsync({ uri });
    }
  } catch (err) {
    console.error('[AIA] Error generating pay application PDF:', err);
    throw err;
  }
}

```


---

### `utils/earnedValueEngine.ts`

```ts
import type { Project, Invoice, ProjectSchedule, EarnedValueMetrics } from '@/types';

export function calculateEVM(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
): EarnedValueMetrics {
  console.log('[EVM] Calculating earned value metrics for project:', project.name);

  let bac = 0;
  if (project.linkedEstimate) {
    bac = project.linkedEstimate.grandTotal;
  } else if (project.estimate) {
    bac = project.estimate.grandTotal;
  }

  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const ac = projectInvoices.reduce((sum, inv) => sum + inv.amountPaid, 0);

  let percentComplete = 0;
  if (schedule && schedule.tasks.length > 0) {
    const totalProgress = schedule.tasks.reduce((sum, t) => sum + (t.progress || 0), 0);
    percentComplete = totalProgress / schedule.tasks.length;
  }

  const ev = bac * (percentComplete / 100);

  let elapsedRatio = 0;
  if (project.createdAt && schedule) {
    const startDate = new Date(project.createdAt).getTime();
    const now = Date.now();
    const totalPlannedMs = (schedule.totalDurationDays || 1) * 24 * 60 * 60 * 1000;
    const elapsedMs = now - startDate;
    elapsedRatio = Math.min(elapsedMs / totalPlannedMs, 1);
  }
  const pv = bac * elapsedRatio;

  const sv = ev - pv;
  const cv = ev - ac;
  const spi = pv !== 0 ? ev / pv : 1.0;
  const cpi = ac !== 0 ? ev / ac : 1.0;
  const eac = cpi !== 0 ? bac / cpi : bac;
  const etc = eac - ac;
  const vac = bac - eac;

  const metrics: EarnedValueMetrics = {
    budgetAtCompletion: bac,
    plannedValue: pv,
    earnedValue: ev,
    actualCost: ac,
    scheduleVariance: sv,
    costVariance: cv,
    schedulePerformanceIndex: Math.round(spi * 100) / 100,
    costPerformanceIndex: Math.round(cpi * 100) / 100,
    estimateAtCompletion: Math.round(eac * 100) / 100,
    estimateToComplete: Math.round(etc * 100) / 100,
    varianceAtCompletion: Math.round(vac * 100) / 100,
    percentComplete: Math.round(percentComplete * 10) / 10,
    calculatedAt: new Date().toISOString(),
  };

  console.log('[EVM] Metrics calculated — CPI:', metrics.costPerformanceIndex, 'SPI:', metrics.schedulePerformanceIndex);
  return metrics;
}

export function generateCashFlowData(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
  periods: number = 12,
): { period: string; plannedCumulative: number; actualCumulative: number; forecastCumulative: number }[] {
  const bac = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  const totalDays = schedule?.totalDurationDays ?? 180;
  const daysPerPeriod = Math.ceil(totalDays / periods);
  const startDate = new Date(project.createdAt);

  const projectInvoices = invoices
    .filter(inv => inv.projectId === project.id)
    .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

  const data: { period: string; plannedCumulative: number; actualCumulative: number; forecastCumulative: number }[] = [];

  let actualCumulative = 0;
  const metrics = calculateEVM(project, invoices, schedule);
  const cpi = metrics.costPerformanceIndex || 1;

  for (let i = 0; i < periods; i++) {
    const periodStart = new Date(startDate.getTime() + i * daysPerPeriod * 86400000);
    const periodEnd = new Date(startDate.getTime() + (i + 1) * daysPerPeriod * 86400000);

    const plannedRatio = Math.min((i + 1) / periods, 1);
    const plannedCumulative = bac * plannedRatio;

    const periodPayments = projectInvoices.filter(inv => {
      const d = new Date(inv.issueDate).getTime();
      return d >= periodStart.getTime() && d < periodEnd.getTime();
    });
    actualCumulative += periodPayments.reduce((sum, inv) => sum + inv.amountPaid, 0);

    const forecastCumulative = cpi !== 0 ? plannedCumulative / cpi : plannedCumulative;

    data.push({
      period: `Wk ${i + 1}`,
      plannedCumulative: Math.round(plannedCumulative),
      actualCumulative: Math.round(actualCumulative),
      forecastCumulative: Math.round(forecastCumulative),
    });
  }

  return data;
}

```


---

### `utils/stripe.ts`

```ts
// Stripe client helper
//
// Thin wrapper around the `create-payment-link` Supabase edge function.
// Keeps Stripe secret-key handling entirely server-side — the client only ever
// sees the generated public payment URL.
//
// Usage:
//   const res = await createPaymentLink({
//     invoiceId: invoice.id,
//     invoiceNumber: invoice.number,
//     projectName: project.name,
//     amountCents: Math.round((invoice.totalDue - invoice.amountPaid) * 100),
//     customerEmail: client?.email,
//     companyName: settings.branding?.companyName,
//   });
//   if (res.success) updateInvoice(invoice.id, { payLinkUrl: res.url, payLinkId: res.id });

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface CreatePaymentLinkParams {
  invoiceId: string;
  invoiceNumber: string | number;
  projectName: string;
  /** Integer cents — the helper does NOT multiply by 100 for you. */
  amountCents: number;
  currency?: string;           // default 'usd'
  description?: string;        // shown above the submit button on the pay page
  customerEmail?: string;      // prefills the checkout email field
  companyName?: string;        // attached to the Stripe Product metadata
}

export interface CreatePaymentLinkResult {
  success: boolean;
  url?: string;
  id?: string;
  error?: string;
}

export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<CreatePaymentLinkResult> {
  // Fail early with a clean error rather than letting Supabase throw cryptically
  // when envs are missing. The UI surfaces this message verbatim.
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Payment service not configured (Supabase not initialized).',
    };
  }

  // Client-side guards that mirror the edge function's validation. Catching
  // these before the round-trip gives a faster, clearer UX.
  if (!params.invoiceId) {
    return { success: false, error: 'Missing invoice id' };
  }
  if (params.invoiceNumber === undefined || params.invoiceNumber === null) {
    return { success: false, error: 'Missing invoice number' };
  }
  if (!params.projectName) {
    return { success: false, error: 'Missing project name' };
  }
  if (!Number.isFinite(params.amountCents)) {
    return { success: false, error: 'Invalid amount' };
  }
  if (params.amountCents < 50) {
    return { success: false, error: 'Minimum charge is $0.50.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('create-payment-link', {
      body: {
        invoiceId: params.invoiceId,
        invoiceNumber: params.invoiceNumber,
        projectName: params.projectName,
        amountCents: Math.round(params.amountCents),
        currency: params.currency,
        description: params.description,
        customerEmail: params.customerEmail,
        companyName: params.companyName,
      },
    });

    if (error) {
      console.error('[Stripe] Edge function error:', error);
      return { success: false, error: error.message || 'Failed to create payment link' };
    }

    const result = data as CreatePaymentLinkResult | null;
    if (!result?.success || !result.url || !result.id) {
      return {
        success: false,
        error: result?.error || 'Stripe did not return a payment link',
      };
    }

    console.log('[Stripe] Created payment link', result.id);
    return { success: true, url: result.url, id: result.id };
  } catch (err) {
    console.error('[Stripe] Invoke threw:', err);
    return { success: false, error: String(err) };
  }
}

```
