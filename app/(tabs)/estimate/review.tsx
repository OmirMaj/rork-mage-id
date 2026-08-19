import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PackageOpen, Share2 } from 'lucide-react-native';
import { BrandBackdrop, OnInk } from '@/components/BrandBackdrop';
import { EstimateSummaryHeader } from '@/components/estimate/EstimateSummaryHeader';
import { EstimateMetricGrid } from '@/components/estimate/EstimateMetricGrid';
import { EstimateSummaryCard } from '@/components/estimate/EstimateSummaryCard';
import { EstimateCostBreakdown } from '@/components/estimate/EstimateCostBreakdown';
import { EstimateDivisionTable, type DivisionRow } from '@/components/estimate/EstimateDivisionTable';
import { EstimateTotalsBar } from '@/components/estimate/EstimateTotalsBar';
import { EstimateClientView } from '@/components/estimate/EstimateClientView';
import { useBrainFabScroll, useBrainFabLift } from '@/components/brain/brainFabState';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { classifyToCSIDivision, groupByCSIDivision } from '@/utils/csiMasterFormat';
import { toClientEstimateView, defaultPaymentSchedule } from '@/utils/clientEstimateView';
import { buildClientEstimateSharePayload, encodeClientEstimateToken } from '@/utils/clientEstimateShareToken';
import type { LinkedEstimate } from '@/types';
import { CATEGORY_META } from '@/constants/materials';
import { buildCostDatabase, lookupRate } from '@/utils/costDatabase';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { track, AnalyticsEvents } from '@/utils/analytics';

// Redesigned estimate REVIEW — the approved ink+amber summary view reading the
// live material cart. Non-destructive: the catalog/cart estimator at
// /(tabs)/estimate/full is untouched; this proves the new direction on device
// before it becomes the primary surface (docs/design/estimate-redesign).
export default function EstimateReviewScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { cart, laborCart, assemblyCart, globalMarkup } = useMaterialCart();
  const { settings, projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();
  const laborSamples = useLaborCostSamples();
  const { seeds } = useCostSeeds();
  const layout = useResponsiveLayout();
  const isDesktop = layout.isDesktop;
  const [mode, setMode] = useState<'contractor' | 'client'>('contractor');

  const switchMode = useCallback((m: 'contractor' | 'client') => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setMode(m);
  }, []);

  // CLIENT-VIEW FIREWALL (hero band).
  // The hero sits ABOVE the ScrollView, outside the `mode === 'contractor'`
  // branch and outside the `cart.length === 0` branch that carries the toggle —
  // so it is the one node on this screen that renders in BOTH modes. Its eyebrow
  // used to inline `{globalMarkup}% MARKUP`, which meant flipping to Client
  // still published the contractor's markup at the top of the page while every
  // other surface (totals bar :showTotalsBar, division rate provenance, the
  // shared-proposal token) was correctly gated. The markup is therefore resolved
  // HERE, from `mode`, and never inlined into the hero JSX again.
  const heroEyebrow = mode === 'contractor'
    ? `ESTIMATE · ${globalMarkup}% MARKUP`
    : 'ESTIMATE';

  // The totals bar is pinned to the bottom, which is exactly where the global
  // Brain FAB rests — the iOS visual audit (2026-08-16, defect #5) caught the
  // FAB drawn straight over GRAND TOTAL and its value. Bottom padding cannot
  // fix a fixed bar, so measure the bar and raise the FAB by its height. The
  // FAB's resting offset already clears the tab bar with a margin, so lifting
  // by exactly the bar height keeps that same margin above the bar.
  const [totalsBarH, setTotalsBarH] = useState(0);
  const onTotalsBarLayout = useCallback((e: LayoutChangeEvent) => {
    setTotalsBarH(e.nativeEvent.layout.height);
  }, []);
  const showTotalsBar = cart.length > 0 && mode === 'contractor';
  useBrainFabLift(showTotalsBar ? totalsBarH : 0);
  // Scrolling down slides the FAB away so it stops covering division rows.
  const fabScroll = useBrainFabScroll();

  // Labor and assemblies are direct costs carried at cost (no markup applied to
  // them), exactly as estimate/full.tsx totals them: grandTotal = materials
  // (with markup) + labor + assemblies. Before this, review.tsx summed the
  // material cart alone and under-reported every estimate by labor + assemblies.
  const laborTotal = useMemo(
    () => laborCart.reduce((s, i) => s + i.adjustedRate * i.hours, 0), [laborCart]);
  const assemblyTotal = useMemo(
    () => assemblyCart.reduce((s, i) => s + i.totalCost, 0), [assemblyCart]);

  const { directCost, markups, itemCount } = useMemo(() => {
    const base = cart.reduce((sum, item) => {
      const p = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      return sum + p * item.quantity;
    }, 0);
    const withMarkup = cart.reduce((sum, item) => {
      const p = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      return sum + p * (1 + item.markup / 100) * item.quantity;
    }, 0);
    return {
      directCost: base + laborTotal + assemblyTotal,
      markups: withMarkup - base,
      itemCount: cart.length + laborCart.length + assemblyCart.length,
    };
  }, [cart, laborCart.length, assemblyCart.length, laborTotal, assemblyTotal]);

  // The learned price book — only consulted for the CONTRACTOR view's
  // rate-provenance chips. See the divisions memo below for why it is gated.
  const costDb = useMemo(
    () => buildCostDatabase(projects, commitments, receipts, laborSamples, seeds),
    [projects, commitments, receipts, laborSamples, seeds],
  );

  // Group the cart into CSI divisions for the contractor scope table. Materials
  // carry no explicit csiDivision, so classify from name then category.
  //
  // CLIENT-VIEW FIREWALL: rate provenance ("measured on 4 jobs" / "you set
  // this") is INTERNAL — it exposes how the cost was derived, which is exactly
  // the class of information client view exists to withhold. So the entry is
  // resolved only while mode === 'contractor'; in client mode `rateEntry` is
  // never even computed, and RateProvenanceChip renders nothing without it.
  const divisions: DivisionRow[] = useMemo(() => {
    const contractorView = mode === 'contractor';
    const rows = cart.map(item => {
      const p = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const total = p * (1 + item.markup / 100) * item.quantity;
      const csi = classifyToCSIDivision(item.material.name)
        ?? classifyToCSIDivision(item.material.category)
        ?? undefined;
      // Key it exactly as the cart is written into a LinkedEstimate (the
      // CATEGORY_META label, then the material unit) — that is what the cost
      // book is later built from, so a hit here is genuinely this line's rate.
      const rateEntry = contractorView
        ? lookupRate(costDb, CATEGORY_META[item.material.category]?.label ?? item.material.category, item.material.unit)
        : null;
      return { csiDivision: csi, name: item.material.name, qty: item.quantity, unit: item.material.unit, total, rateEntry };
    });
    const materialGroups: DivisionRow[] = groupByCSIDivision(rows).map(g => ({
      key: g.division?.number ?? 'other',
      number: g.division?.number ?? null,
      title: g.division?.title ?? 'Other scope',
      total: g.items.reduce((s, r) => s + r.total, 0),
      items: g.items.map(r => ({ name: r.name, qty: r.qty, unit: r.unit, total: r.total, rateEntry: r.rateEntry })),
    }));
    // Labor and assemblies are their own scope groups so the contractor scope
    // table sums to the same grand total the header shows (materials + labor +
    // assemblies), instead of silently omitting them.
    const extra: DivisionRow[] = [];
    if (laborCart.length) {
      extra.push({
        key: 'labor', number: null, title: 'Labor', total: laborTotal,
        items: laborCart.map(l => ({ name: l.labor.trade, qty: l.hours, unit: 'hrs', total: l.adjustedRate * l.hours, rateEntry: null })),
      });
    }
    if (assemblyCart.length) {
      extra.push({
        key: 'assemblies', number: null, title: 'Assemblies', total: assemblyTotal,
        items: assemblyCart.map(a => ({ name: a.assembly.name, qty: 1, unit: a.assembly.unit, total: a.totalCost, rateEntry: null })),
      });
    }
    return [...materialGroups, ...extra];
  }, [cart, costDb, mode, laborCart, assemblyCart, laborTotal, assemblyTotal]);

  // Client-safe projection — build a LinkedEstimate from the cart (base line
  // totals + grand total) and run the validated transform. It strips every
  // internal number; the client view only ever sees what it returns.
  const clientView = useMemo(() => {
    const items = cart.map(item => {
      const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const csi = classifyToCSIDivision(item.material.name)
        ?? classifyToCSIDivision(item.material.category)
        ?? undefined;
      return {
        materialId: item.material.id, name: item.material.name, category: item.material.category,
        unit: item.material.unit, quantity: item.quantity, unitPrice: base,
        bulkPrice: item.material.baseBulkPrice, markup: item.markup, usesBulk: item.usesBulk,
        lineTotal: base * item.quantity, supplier: item.material.supplier ?? '', csiDivision: csi,
      };
    });
    // Fold labor and assemblies in the same shape estimate/full.tsx uses when it
    // links an estimate to a project, so the client view and the estimator agree.
    // Both carry markup 0 (they are already at cost).
    for (const l of laborCart) {
      const lineTotal = l.adjustedRate * l.hours;
      items.push({
        materialId: l.labor.id, name: l.labor.trade, category: 'Labor',
        unit: 'hrs', quantity: l.hours, unitPrice: l.adjustedRate,
        bulkPrice: l.adjustedRate, markup: 0, usesBulk: false,
        lineTotal, supplier: l.labor.category, csiDivision: undefined,
      });
    }
    for (const a of assemblyCart) {
      items.push({
        materialId: a.assembly.id, name: a.assembly.name, category: 'Assemblies',
        unit: a.assembly.unit, quantity: 1, unitPrice: a.totalCost,
        bulkPrice: a.totalCost, markup: 0, usesBulk: false,
        lineTotal: a.totalCost, supplier: '', csiDivision: undefined,
      });
    }
    const baseTotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const grandTotal = directCost + markups;
    const est: LinkedEstimate = {
      id: 'live', items, globalMarkup, baseTotal, markupTotal: grandTotal - baseTotal, grandTotal, createdAt: '',
    };
    return toClientEstimateView(est);
  }, [cart, laborCart, assemblyCart, globalMarkup, directCost, markups]);

  // Build the client-safe proposal link and copy it. The token is built from
  // clientView only, so the shared URL can never carry costs or markups.
  const handleShareProposal = useCallback(async () => {
    const gcName = settings?.branding?.companyName || undefined;
    const payload = buildClientEstimateSharePayload(clientView, {
      projectName: gcName ? `${gcName} — Estimate` : 'Project Estimate',
      gcName,
      paymentSchedule: defaultPaymentSchedule(clientView.projectTotal),
    });
    const token = encodeClientEstimateToken(payload);
    const base = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://mageid.app';
    const url = `${base}/shared-estimate?t=${token}`;
    const ok = await (await import('@/utils/clipboard')).copyToClipboard(url);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    track(AnalyticsEvents.ESTIMATE_SHARED, {
      method: 'proposal_link',
      source: 'estimate_review',
      grand_total: clientView?.projectTotal ?? 0,
    });
    showAlert(
      ok ? 'Proposal link copied' : 'Proposal link',
      ok
        ? 'Client-safe link copied to your clipboard. Paste it into a text or email — no login needed, and it shows no costs, markups or margin.'
        : url,
    );
  }, [clientView, settings]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Estimate Review' }} />
      <View style={[styles.hero, { paddingTop: insets.top + 18 }]}>
        <BrandBackdrop />
        <Text style={styles.heroEyebrow} testID="review-hero-eyebrow">{heroEyebrow}</Text>
        <Text style={styles.heroTitle}>Review</Text>
        <Text style={styles.heroSub}>Your working estimate, at a glance.</Text>
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={[
          { padding: 16, paddingBottom: insets.bottom + (showTotalsBar ? 88 : 40) },
          isDesktop && styles.scrollDesktop,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {cart.length === 0 ? (
          <View style={styles.empty}>
            <PackageOpen size={40} color={colors.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No line items yet</Text>
            <Text style={styles.emptyDesc}>Add materials in the Full Estimator and they roll up here with metrics, markup and scope.</Text>
          </View>
        ) : (
          <>
            <View style={styles.toggle}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Contractor view"
                aria-selected={mode === 'contractor'}
                style={[styles.seg, mode === 'contractor' && styles.segOn]}
                onPress={() => switchMode('contractor')}
                activeOpacity={0.8}
                testID="review-mode-contractor"
              >
                <Text style={[styles.segText, mode === 'contractor' && styles.segTextOn]}>Contractor</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Client view"
                aria-selected={mode === 'client'}
                style={[styles.seg, mode === 'client' && styles.segOn]}
                onPress={() => switchMode('client')}
                activeOpacity={0.8}
                testID="review-mode-client"
              >
                <Text style={[styles.segText, mode === 'client' && styles.segTextOn]}>Client</Text>
              </TouchableOpacity>
            </View>

            {mode === 'contractor' ? (
              isDesktop ? (
                <View>
                  <EstimateMetricGrid directCost={directCost} markups={markups} itemCount={itemCount} wide />
                  <View style={styles.desktopRow}>
                    <View style={styles.desktopMain}>
                      <EstimateDivisionTable divisions={divisions} />
                    </View>
                    <View style={styles.desktopRail}>
                      <EstimateSummaryCard directCost={directCost} markups={markups} />
                      <View style={{ height: 14 }} />
                      <EstimateCostBreakdown divisions={divisions} />
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <EstimateSummaryHeader directCost={directCost} markups={markups} itemCount={itemCount} />
                  <EstimateDivisionTable divisions={divisions} />
                </>
              )
            ) : (
              <View style={isDesktop ? styles.clientDesktopWrap : undefined}>
                <EstimateClientView view={clientView} paymentSchedule={defaultPaymentSchedule(clientView.projectTotal)} />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Share proposal"
                  accessibilityHint="Copies a client-safe link with no costs or markups"
                  style={styles.shareBtn}
                  onPress={() => { void handleShareProposal(); }}
                  activeOpacity={0.85}
                  testID="review-share-proposal"
                >
                  <Share2 size={16} color={colors.surface} strokeWidth={2} />
                  <Text style={styles.shareBtnText}>Share proposal</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {showTotalsBar && (
        <View style={[styles.totalsBarWrap, { paddingBottom: insets.bottom }]} onLayout={onTotalsBarLayout}>
          <EstimateTotalsBar
            itemCount={itemCount}
            divisionCount={divisions.length}
            cost={directCost}
            markups={markups}
            grandTotal={directCost + markups}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  hero: { paddingHorizontal: 20, paddingBottom: 20, overflow: 'hidden' },
  // Type.eyebrow is the house uppercase micro-label (11 / 700 / 1.4 tracking).
  // Hand-rolled weight '800' is off the four-weight ladder in typography.ts.
  // The three hero foregrounds are `OnInk`, not ThemeColors, because `hero`
  // renders <BrandBackdrop /> — an OPAQUE ink field (#0B0D10 → #14181D) that is
  // identical in light and dark mode. See components/BrandBackdrop.tsx.
  heroEyebrow: { ...Type.eyebrow, color: OnInk.eyebrow, marginBottom: 4 },
  // Fraunces display face — same hero band as the estimate hub + wizard.
  heroTitle: { ...Type.serifTitle, color: OnInk.title },
  heroSub: { ...Type.subhead, color: OnInk.subtitle, marginTop: 4 },
  toggle: { flexDirection: 'row', gap: 4, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, padding: 4, marginBottom: 16 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Tokens.radius.sm },
  segOn: { backgroundColor: t.accent },
  segText: { fontSize: 13, fontWeight: '700', color: t.textMuted },
  segTextOn: { color: t.surface },
  totalsBarWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.surfaceAlt },
  desktopRow: { flexDirection: 'row', gap: 16, marginTop: 12, alignItems: 'flex-start' },
  desktopMain: { flex: 1.7, minWidth: 0 },
  desktopRail: { width: 340 },
  // Desktop page column. The contractor view is a division TABLE + rail, so it
  // wants width; the client proposal reads as a document, so it keeps a cap —
  // just a far less cramped one than the old 640.
  scrollDesktop: { width: '100%', maxWidth: 1500, alignSelf: 'center', paddingHorizontal: 24 },
  clientDesktopWrap: { maxWidth: 900, alignSelf: 'center', width: '100%' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.md, paddingVertical: 15, marginTop: 22 },
  shareBtnText: { ...Type.subheadEmphasized, color: t.surface },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { color: t.text, fontSize: Type.headline.fontSize, fontWeight: '700' },
  emptyDesc: { color: t.textSecondary, fontSize: Type.subhead.fontSize, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
