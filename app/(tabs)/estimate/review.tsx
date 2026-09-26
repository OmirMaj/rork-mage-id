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
import { toClientEstimateView } from '@/utils/clientEstimateView';
import { acceptanceSentence, proposalPaymentLines } from '@/utils/paymentTerms';
import { addCalendarDays, toCalendarDayString } from '@/utils/calendarDate';
import { PROFILE_FAILED_TITLE } from '@/utils/settingsLoadGuard';
import { useClientDocumentGate, useSavedPaymentTerms } from '@/hooks/useClientDocumentGate';
import ClientDocumentAskSheet from '@/components/ClientDocumentAskSheet';
import { Button, Card, segmentedDesktop } from '@/components/ui';
import { buildClientEstimateSharePayload, encodeClientEstimateToken } from '@/utils/clientEstimateShareToken';
import { buildShareUrl } from '@/utils/webAppOrigin';
import type { LinkedEstimate, PaymentSplit } from '@/types';
import { CATEGORY_META } from '@/constants/materials';
import { priceEstimatorCart } from '@/utils/estimateMarkup';
import { formatMoney } from '@/utils/formatters';
import { buildCostDatabase, lookupRate } from '@/utils/costDatabase';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { ScopeGapsCard } from '@/components/scopeGaps/ScopeGapsCard';
import type { ScopeLine } from '@/utils/scopeCoverage';
import type { PricedScopeGap } from '@/utils/scopeGaps';
import { useProjects } from '@/contexts/ProjectContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
// Static, not `await import(...)`: the clipboard write has to start inside the
// press on web (navigator.clipboard refuses a write that is not a user
// gesture), and a dynamic import is an await before it.
import { copyToClipboard } from '@/utils/clipboard';
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
  const { cart, laborCart, assemblyCart, globalMarkup, addToCart } = useMaterialCart();
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
  // The WHOLE estimate, not just the materials cart. handleAddAssembly and
  // handleLoadTemplate write only to assemblyCart/laborCart, so a real
  // estimate could have a grand total, division rows and metrics computed
  // below and still be counted as empty here. (itemCount is declared after
  // this line, hence the inline sum.)
  const hasAnyLineItem = cart.length + laborCart.length + assemblyCart.length > 0;
  const showTotalsBar = hasAnyLineItem && mode === 'contractor';
  useBrainFabLift(showTotalsBar ? totalsBarH : 0);
  // Scrolling down slides the FAB away so it stops covering division rows.
  const fabScroll = useBrainFabScroll();

  // ONE PRICING FUNCTION with estimate/full.tsx (utils/estimateMarkup
  // priceEstimatorCart): every row's sell rounded to the cent once, every total
  // the sum of those rows, labor and assemblies carrying the global markup on
  // top of their loaded cost. This screen used to re-type the estimator's raw
  // formula and total the unrounded floats, so its rows and totals could land
  // a cent away from the estimator's for the same cart.
  const priced = useMemo(
    () => priceEstimatorCart(cart, laborCart, assemblyCart, globalMarkup),
    [cart, laborCart, assemblyCart, globalMarkup],
  );
  const directCost = priced.directCostTotal;
  const markups = priced.markupTotal;
  const laborTotal = priced.laborSell;
  const assemblyTotal = priced.assemblySell;
  const itemCount = cart.length + laborCart.length + assemblyCart.length;

  // Scope Code Gaps (step-3 L1): the whole estimate as scope lines — the
  // materials, the labor trades and the assemblies — so a code item that is
  // already in it reads as covered.
  const scopeGapLines = useMemo<ScopeLine[]>(() => [
    ...cart.map(i => ({ name: i.material.name, category: i.material.category, quantity: i.quantity, unit: i.material.unit })),
    ...laborCart.map(l => ({ name: l.labor.trade, category: 'Labor', quantity: l.hours, unit: 'hrs' })),
    ...assemblyCart.map(a => ({ name: a.assembly.name, category: 'Assemblies', quantity: 1, unit: a.assembly.unit })),
  ], [cart, laborCart, assemblyCart]);

  // A code item goes into the cart at HIS learned rate (the same scopeRateFor
  // entry the card priced it with — the cart stores the category KEY and the
  // divisions memo maps it to the label, so the re-lookup finds the same
  // entry) and only with a real quantity; never at a guessed price.
  const addGapToCart = useCallback((gap: PricedScopeGap): boolean => {
    if (!gap.priced || gap.unitRate == null || gap.quantity == null) return false;
    addToCart({
      id: `codegap:${gap.rule.id}`,
      name: gap.rule.topic,
      category: gap.rule.price.trade,
      unit: gap.rule.price.unit,
      baseRetailPrice: gap.unitRate,
      baseBulkPrice: gap.unitRate,
      bulkMinQty: 999999,
      supplier: 'Your price book',
      sourceLabel: 'Code item · your learned rate',
    }, gap.quantity);
    return true;
  }, [addToCart]);

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
    const rows = cart.map((item, i) => {
      const total = priced.materials[i].sell;
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
      total: Math.round(g.items.reduce((s, r) => s + r.total, 0) * 100) / 100,
      items: g.items.map(r => ({ name: r.name, qty: r.qty, unit: r.unit, total: r.total, rateEntry: r.rateEntry })),
    }));
    // Labor and assemblies are their own scope groups so the contractor scope
    // table sums to the same grand total the header shows (materials + labor +
    // assemblies), instead of silently omitting them.
    const extra: DivisionRow[] = [];
    if (laborCart.length) {
      extra.push({
        key: 'labor', number: null, title: 'Labor', total: laborTotal,
        // Per-row totals carry the markup so the group's rows sum to the
        // group total, which sums to the grand total the header shows.
        items: laborCart.map((l, i) => ({ name: l.labor.trade, qty: l.hours, unit: 'hrs', total: priced.labor[i].sell, rateEntry: null })),
      });
    }
    if (assemblyCart.length) {
      extra.push({
        key: 'assemblies', number: null, title: 'Assemblies', total: assemblyTotal,
        items: assemblyCart.map((a, i) => ({ name: a.assembly.name, qty: 1, unit: a.assembly.unit, total: priced.assemblies[i].sell, rateEntry: null })),
      });
    }
    return [...materialGroups, ...extra];
  }, [cart, costDb, mode, laborCart, assemblyCart, laborTotal, assemblyTotal, priced]);

  // Client-safe projection — build a LinkedEstimate from the cart (base line
  // totals + grand total) and run the validated transform. It strips every
  // internal number; the client view only ever sees what it returns.
  const clientView = useMemo(() => {
    // lineTotal is each row's SELL on the cent grid (priceEstimatorCart) — the
    // same convention estimate/full.tsx writes into a linked estimate — so
    // Σ lineTotal === grandTotal, toClientEstimateView's scale factor is
    // exactly 1, and every scope group is the sum of the cents the contractor
    // view shows for its rows. It used to hand the projection COST rows and
    // let it spread the markup proportionally, which re-rounded every group.
    const items: LinkedEstimate['items'] = cart.map((item, i) => {
      const csi = classifyToCSIDivision(item.material.name)
        ?? classifyToCSIDivision(item.material.category)
        ?? undefined;
      return {
        materialId: item.material.id, name: item.material.name, category: item.material.category,
        unit: item.material.unit, quantity: item.quantity, unitPrice: priced.materials[i].base,
        bulkPrice: item.material.baseBulkPrice, markup: item.markup, usesBulk: item.usesBulk,
        lineTotal: priced.materials[i].sell, supplier: item.material.supplier ?? '', csiDivision: csi,
      };
    });
    // Fold labor and assemblies in the same shape estimate/full.tsx uses when it
    // links an estimate to a project, so the client view and the estimator
    // agree. toClientEstimateView strips cost, markup and unit price before the
    // client sees anything.
    laborCart.forEach((l, i) => {
      items.push({
        materialId: l.labor.id, name: l.labor.trade, category: 'Labor',
        unit: 'hrs', quantity: l.hours, unitPrice: l.adjustedRate,
        bulkPrice: l.adjustedRate, markup: globalMarkup, usesBulk: false,
        lineTotal: priced.labor[i].sell, supplier: l.labor.category, csiDivision: undefined,
      });
    });
    assemblyCart.forEach((a, i) => {
      items.push({
        materialId: a.assembly.id, name: a.assembly.name, category: 'Assemblies',
        unit: a.assembly.unit, quantity: 1, unitPrice: a.totalCost,
        bulkPrice: a.totalCost, markup: globalMarkup, usesBulk: false,
        lineTotal: priced.assemblies[i].sell, supplier: '', csiDivision: undefined,
      });
    });
    const est: LinkedEstimate = {
      id: 'live', items, globalMarkup,
      baseTotal: priced.directCostTotal, markupTotal: priced.markupTotal, grandTotal: priced.grandTotal,
      createdAt: '',
    };
    return toClientEstimateView(est);
  }, [cart, laborCart, assemblyCart, globalMarkup, priced]);

  // "Ask when it matters": the link prints a payment schedule, so it prints the
  // GC's OWN split — never a guessed 10% deposit. Resolved from his saved
  // profile here only to decide what the GC-only preview says; the link itself
  // is built from the split the gate hands its continuation (see below).
  const gate = useClientDocumentGate();
  // Through useSavedPaymentTerms, not resolvePaymentSplit on raw settings:
  // before his profile loads `settings` is DEFAULT, and this preview said
  // "not set yet" about terms he had set (finding 106).
  const savedTerms = useSavedPaymentTerms();
  const savedSplit = savedTerms.split;

  // Build the client-safe proposal link and copy it. The token is built from
  // clientView only, so the shared URL can never carry costs or markups.
  //
  // Split in two because the two halves have different timing needs:
  //   · the clipboard write STARTS in the press (web refuses a write outside a
  //     user gesture) — the gate runs `then` synchronously in the last press;
  //   · the haptic + "Proposal link copied" alert present native UI, so they
  //     wait for the ask sheet to finish sliding away on iOS (`afterDismiss`),
  //     and run straight after the copy everywhere else / when nothing asked.
  // `split` is the gate's answer, passed in: savePaymentTerms has only just
  // written it, so this closure's `settings` may still be the old one.
  //
  // The link also carries how to say yes (#123): his saved phone and email
  // (only when saved — never a placeholder) and the same closing sentence the
  // PDF prints, from the SAME split. And it carries the 30-day validity the
  // PDF and the wizard state, as a calendar day. It carries no client name and
  // no inclusions/exclusions list: this screen is a material cart with no
  // client on it and no scope list the GC has seen, and a link must not print
  // a name or a promise the preview above never showed him.
  const copyProposalLink = useCallback((split: PaymentSplit) => {
    const gcName = settings?.branding?.companyName || undefined;
    const payload = buildClientEstimateSharePayload(clientView, {
      projectName: gcName ? `${gcName} — Estimate` : 'Project Estimate',
      gcName,
      paymentSchedule: proposalPaymentLines(clientView.projectTotal, split),
      validThrough: toCalendarDayString(addCalendarDays(new Date(), 30)),
      gcPhone: settings?.branding?.phone,
      gcEmail: settings?.branding?.email,
      acceptance: acceptanceSentence(split),
    });
    const token = encodeClientEstimateToken(payload);
    const url = buildShareUrl('shared-estimate', token,
      Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null);
    const copied = copyToClipboard(url);
    track(AnalyticsEvents.ESTIMATE_SHARED, {
      method: 'proposal_link',
      source: 'estimate_review',
      grand_total: clientView?.projectTotal ?? 0,
    });
    return { url, copied };
  }, [clientView, settings]);

  const handleShareProposal = useCallback(() => {
    // Filled by the continuation; read by afterDismiss. Closing the sheet
    // without answering drops both, so nothing is copied and nothing is said.
    let started: { url: string; copied: Promise<boolean> } | null = null;
    gate.run(
      { terms: true, purpose: 'proposal_link', total: clientView.projectTotal },
      (a) => { started = copyProposalLink(a.split); },
      {
        afterDismiss: () => {
          const s = started;
          if (!s) return;
          void s.copied.then((ok) => {
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showAlert(
              ok ? 'Proposal link copied' : 'Proposal link',
              ok
                ? 'Client-safe link copied to your clipboard. Paste it into a text or email — no login needed, and it shows no costs, markups or margin.'
                : s.url,
            );
          });
        },
      },
    );
  }, [gate, clientView, copyProposalLink]);

  // "Set now" on the GC-only note: the same sheet, nothing paused behind it.
  const handleSetTermsNow = useCallback(() => {
    gate.run({ terms: true, purpose: 'proposal_link', total: clientView.projectTotal }, () => {});
  }, [gate, clientView]);

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
        {itemCount === 0 ? (
          <View style={styles.empty}>
            <PackageOpen size={40} color={colors.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No line items yet</Text>
            <Text style={styles.emptyDesc}>Add materials in the Full Estimator and they roll up here with metrics, markup and scope.</Text>
          </View>
        ) : (
          <>
            <View style={[styles.toggle, isDesktop && segmentedDesktop.container]}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Contractor view"
                aria-selected={mode === 'contractor'}
                style={[styles.seg, isDesktop && segmentedDesktop.segment, mode === 'contractor' && styles.segOn]}
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
                style={[styles.seg, isDesktop && segmentedDesktop.segment, mode === 'client' && styles.segOn]}
                onPress={() => switchMode('client')}
                activeOpacity={0.8}
                testID="review-mode-client"
              >
                <Text style={[styles.segText, mode === 'client' && styles.segTextOn]}>Client</Text>
              </TouchableOpacity>
            </View>

            {/* An estimate with nothing on top of cost, said out loud. The
                metric grid below reports "Markups $0" truthfully but a zero in
                a row of numbers does not read as an alarm, and this screen is
                one tap from a client-safe share link. Contractor mode only —
                it is the one thing here the client must never see. */}
            {mode === 'contractor' && directCost > 0 && markups < 0.005 ? (
              <View style={styles.atCostBand} testID="review-at-cost-band">
                <Text style={styles.atCostTitle}>This estimate has no profit in it</Text>
                {/* Says what it MEASURED — that this estimate carries no
                    markup — rather than quoting a percentage. The band fires
                    on the realized markup, and a materials-only cart whose
                    lines have each been zeroed realizes nothing while the
                    global chip above still reads 20%. "Your markup is 0%" was
                    then a number contradicting the control on the previous
                    screen; the money claim underneath it was always true. */}
                <Text style={styles.atCostBody}>
                  Nothing is added on top of cost here, so the {formatMoney(directCost)} below is exactly
                  what the work costs you. Set a markup in the Full Estimator before you send it.
                </Text>
              </View>
            ) : null}

            {mode === 'contractor' ? <ScopeGapsCard mode="cart" lines={scopeGapLines} storageKey="cart:current" onAddLine={addGapToCart} /> : null}
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
                <EstimateClientView
                  view={clientView}
                  paymentSchedule={savedSplit ? proposalPaymentLines(clientView.projectTotal, savedSplit) : undefined}
                />
                {/* Not set: the preview prints NO schedule (a guessed one reads
                    as his terms) and says so. This note sits outside
                    EstimateClientView and never enters the share token — only
                    the GC sees it. */}
                {savedTerms.status !== 'ready' ? (
                  // Not known yet — never "not set". Loading says so; a failed
                  // read says so and offers Retry (a "Set now" here would
                  // only answer "One second").
                  <Card radius="md" pad={14} style={styles.termsNote} testID="review-terms-loading">
                    <Text style={styles.termsNoteText}>
                      {savedTerms.status === 'loading'
                        ? 'Loading your payment terms\u2026'
                        : `Payment schedule \u2014 ${PROFILE_FAILED_TITLE.toLowerCase()}. Check your signal.`}
                    </Text>
                    {savedTerms.status === 'failed' ? (
                      <Button
                        label="Retry"
                        variant="secondary"
                        size="sm"
                        onPress={savedTerms.retry}
                        testID="review-terms-retry"
                      />
                    ) : null}
                  </Card>
                ) : !savedSplit ? (
                  <Card radius="md" pad={14} style={styles.termsNote} testID="review-terms-not-set">
                    <Text style={styles.termsNoteText}>
                      Payment schedule — not set yet. You’ll be asked before you share.
                    </Text>
                    <Button
                      label="Set now"
                      variant="secondary"
                      size="sm"
                      onPress={handleSetTermsNow}
                      testID="review-set-terms-now"
                    />
                  </Card>
                ) : null}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Share proposal"
                  accessibilityHint="Copies a client-safe link with no costs or markups"
                  style={styles.shareBtn}
                  onPress={handleShareProposal}
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

      <ClientDocumentAskSheet {...gate.sheet} />

      {showTotalsBar && (
        <View style={[styles.totalsBarWrap, { paddingBottom: insets.bottom }]} onLayout={onTotalsBarLayout}>
          <EstimateTotalsBar
            itemCount={itemCount}
            divisionCount={divisions.length}
            cost={directCost}
            markups={markups}
            grandTotal={priced.grandTotal}
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
  atCostBand: {
    backgroundColor: t.dangerSoft,
    borderColor: t.danger + '55',
    borderWidth: 1,
    borderRadius: Tokens.radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  atCostTitle: { ...Type.subhead, fontWeight: '700' as const, color: t.dangerLabel, marginBottom: 2 },
  atCostBody: { ...Type.caption1, color: t.dangerLabel, lineHeight: 17 },
  toggle: { flexDirection: 'row', gap: 4, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, padding: 4, marginBottom: 16 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Tokens.radius.sm },
  segOn: { backgroundColor: t.accentFill },
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
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, borderRadius: Tokens.radius.md, paddingVertical: 15, marginTop: 22 },
  termsNote: { marginTop: 14, gap: 10, alignItems: 'flex-start' },
  termsNoteText: { ...Type.footnote, color: t.textSecondary },
  shareBtnText: { ...Type.subheadEmphasized, color: t.surface },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { color: t.text, fontSize: Type.headline.fontSize, fontWeight: '700' },
  emptyDesc: { color: t.textSecondary, fontSize: Type.subhead.fontSize, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
