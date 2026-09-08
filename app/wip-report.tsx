import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, Lock, FileSpreadsheet, X, AlertTriangle, HelpCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useWip } from '@/contexts/WipContext';
import {
  computeWipRow, computeWipPortfolio, flagWipRow,
  suggestCostToDate, suggestBilledToDate, sumApprovedChangeOrders,
  deriveOriginalContract, deriveEstimatedCost, isWipReportableProject,
  deriveOriginalContractWithSource, deriveEstimatedCostWithSource,
  suggestCostToDateWithSource, WIP_SOURCE_LABELS,
} from '@/utils/wip';
import { FeatureExplainerSheet } from '@/components/FeatureExplainerSheet';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { wipPeriodToCSV, shareWipPeriodPdf } from '@/utils/wipExport';
import { copyToClipboard } from '@/utils/clipboard';
import type { WipRowInput, WipSnapshotRow, Project } from '@/types';
import { showAlert } from '@/utils/alert';

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

// Per-project cost-to-date overrides are persisted so the GC's typed
// cost-to-date (incl. self-performed labor) survives across sessions — it was
// previously component-only state that reset every time WIP Report reopened,
// silently falling back to subs+materials and quietly wrong for CPA/bank review.
// Tenant-namespaced by user id so switching accounts on one device never bleeds
// one company's cost figures into another's view.
const WIP_COST_OVERRIDES_KEY = 'mageid_wip_cost_overrides';
function costOverridesKey(userId: string | undefined): string {
  return userId ? `${WIP_COST_OVERRIDES_KEY}_${userId}` : WIP_COST_OVERRIDES_KEY;
}

export default function WipReportScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('wip_reporting')) {
    return (
      <Paywall
        visible={true}
        feature="WIP Reporting"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <WipReportScreenInner />;
}

function WipReportScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();

  const {
    projects,
    getChangeOrdersForProject,
    getCommitmentsForProject,
    getInvoicesForProject,
    getAIAPayAppsForProject,
  } = useProjects();
  const { periods, addPeriod, lockPeriod } = useWip();
  const { getReceiptsForProject } = useMaterialReceipts();
  const { user } = useAuth();
  const userId = user?.id;

  // Per-project cost-to-date overrides (keyed by project id). Persisted to
  // AsyncStorage (tenant-namespaced) so a typed cost-to-date survives session
  // reopens instead of resetting to the subs+materials suggestion.
  const [costOverrides, setCostOverrides] = useState<Record<string, number>>({});
  // Gate persistence on hydration so the initial empty state doesn't clobber
  // stored overrides before they load in.
  const overridesHydratedRef = useRef(false);

  // Hydrate stored overrides whenever the tenant changes. Clear first so a prior
  // account's cost figures never linger into a new session.
  useEffect(() => {
    let cancelled = false;
    overridesHydratedRef.current = false;
    setCostOverrides({});
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(costOverridesKey(userId));
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, number>;
          if (parsed && typeof parsed === 'object') setCostOverrides(parsed);
        }
      } catch { /* fresh install / bad cache → start empty */ }
      finally { if (!cancelled) overridesHydratedRef.current = true; }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Persist on every change once hydrated. Cheap write; overrides are a small map.
  useEffect(() => {
    if (!overridesHydratedRef.current) return;
    void AsyncStorage.setItem(costOverridesKey(userId), JSON.stringify(costOverrides))
      .catch(() => { /* non-fatal cache write */ });
  }, [costOverrides, userId]);
  const [drillProjectId, setDrillProjectId] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Controlled buffer for the drill-in cost-to-date field so a typed-but-not-
  // blurred value is captured on close (uncontrolled defaultValue + onEndEditing
  // silently dropped edits when the user tapped X without dismissing the keyboard).
  const [drillCostText, setDrillCostText] = useState<string>('');

  // Audit 2026-09-07 ("Do next" #2, axis 4). This was `() => projects` — every
  // project, CLOSED ones included — while utils/financialReports.computeWIPReport,
  // one sidebar row away, has always skipped closed jobs. So the two bank-facing
  // WIP schedules in this app listed different jobs and restated backlog that no
  // longer exists on a document a surety sizes a bond from. The population is
  // now the shared predicate; neither surface gets its own opinion.
  const activeProjects: Project[] = useMemo(
    () => projects.filter(isWipReportableProject),
    [projects],
  );
  const closedCount = projects.length - activeProjects.length;

  // Build a live WIP input for one project from existing collections.
  const buildInput = useCallback((project: Project): WipRowInput => {
    const cos = getChangeOrdersForProject(project.id);
    const commitments = getCommitmentsForProject(project.id);
    const invoices = getInvoicesForProject(project.id);
    const payApps = getAIAPayAppsForProject(project.id);
    const receipts = getReceiptsForProject(project.id);
    const suggestedCost = suggestCostToDate(commitments, receipts);
    return {
      // Revenue baseline (contract) and cost budget come from DISTINCT sources
      // so est gross profit doesn't collapse to ~0 when both fall back to
      // targetBudget: contract from AIA/CO/targetBudget, cost from the estimate.
      originalContract: deriveOriginalContract(project, cos, payApps),
      approvedChangeOrders: sumApprovedChangeOrders(cos),
      // Pass the CO figures so the COST budget grows with them too. Without
      // this the revenue side gains the change order and the cost side does
      // not, which reports every CO at 100% margin.
      totalEstimatedCost: deriveEstimatedCost(project, commitments, {
        approvedChangeOrders: sumApprovedChangeOrders(cos),
        originalContract: deriveOriginalContract(project, cos, payApps),
      }),
      costToDate: costOverrides[project.id] ?? suggestedCost,
      billedToDate: suggestBilledToDate(invoices, payApps),
    };
  }, [costOverrides, getChangeOrdersForProject, getCommitmentsForProject, getInvoicesForProject, getAIAPayAppsForProject, getReceiptsForProject]);

  const liveRows: WipSnapshotRow[] = useMemo(
    () => activeProjects.map((p) => {
      const input = buildInput(p);
      return { projectId: p.id, projectName: p.name, input, output: computeWipRow(input) };
    }),
    [activeProjects, buildInput],
  );

  const portfolio = useMemo(() => computeWipPortfolio(liveRows), [liveRows]);

  // Prior locked period, for the profit-fade watch.
  const priorPeriod = useMemo(
    () => periods.filter((p) => p.lockedAt)
      .sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))[0],
    [periods],
  );

  // Provenance for the drill-in (audit 2026-09-07, "Worth doing" #26). Every
  // figure on this schedule comes off a fallback chain — deriveOriginalContract
  // alone has seven branches — and a GC could not learn that the $1.4M
  // "contract" his banker is reading came from a GMP cap he typed once during
  // setup. That is the surety's first question. Same chains as buildInput, read
  // through the …WithSource siblings so the number and the explanation cannot
  // drift apart.
  const buildProvenance = useCallback((project: Project) => {
    const cos = getChangeOrdersForProject(project.id);
    const commitments = getCommitmentsForProject(project.id);
    const payApps = getAIAPayAppsForProject(project.id);
    const receipts = getReceiptsForProject(project.id);
    const contract = deriveOriginalContractWithSource(project, cos, payApps);
    return {
      contract,
      cost: deriveEstimatedCostWithSource(project, commitments, {
        approvedChangeOrders: sumApprovedChangeOrders(cos),
        originalContract: contract.value,
      }),
      costToDate: suggestCostToDateWithSource(commitments, receipts),
      overridden: costOverrides[project.id] !== undefined,
    };
  }, [costOverrides, getChangeOrdersForProject, getCommitmentsForProject, getAIAPayAppsForProject, getReceiptsForProject]);

  const [explainerOpen, setExplainerOpen] = useState(false);

  const drillProject = activeProjects.find((p) => p.id === drillProjectId) ?? null;
  const drillProvenance = drillProject ? buildProvenance(drillProject) : null;
  const drillInput = drillProject ? buildInput(drillProject) : null;
  const drillOutput = drillInput ? computeWipRow(drillInput) : null;
  const drillPriorRow = priorPeriod?.rows.find((r) => r.projectId === drillProjectId)?.output;
  const drillFlags = drillOutput ? flagWipRow(drillOutput, drillPriorRow) : null;

  // Open the drill modal and seed the controlled cost buffer from the current
  // (override-or-suggested) cost-to-date so the field starts at the live value.
  const openDrill = useCallback((projectId: string) => {
    const proj = activeProjects.find((p) => p.id === projectId);
    const seeded = proj ? buildInput(proj).costToDate : 0;
    setDrillCostText(String(Math.round(seeded)));
    setDrillProjectId(projectId);
  }, [activeProjects, buildInput]);

  // Commit the typed cost-to-date into the per-project override. Called on blur
  // AND on close so an edit isn't lost if the keyboard is never dismissed.
  const commitDrillCost = useCallback(() => {
    if (!drillProjectId) return;
    const v = Number(drillCostText.replace(/[^0-9.]/g, ''));
    setCostOverrides((prev) => ({ ...prev, [drillProjectId]: Number.isFinite(v) ? v : 0 }));
  }, [drillProjectId, drillCostText]);

  const closeDrill = useCallback(() => {
    commitDrillCost();
    Keyboard.dismiss();
    setDrillProjectId(null);
  }, [commitDrillCost]);

  const handleSnapshot = useCallback(() => {
    const periodEndDate = new Date().toISOString().slice(0, 10);
    addPeriod({ periodEndDate, rows: liveRows, portfolioTotals: portfolio });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Period saved', `WIP snapshot for ${periodEndDate} created. Lock it to freeze for CPA/bank review.`);
  }, [addPeriod, liveRows, portfolio]);

  const handleLock = useCallback(() => {
    const target = selectedPeriodId ? periods.find((p) => p.id === selectedPeriodId) : periods[0];
    if (!target) { showAlert('No period', 'Save a period snapshot first, then lock it.'); return; }
    if (target.lockedAt) { showAlert('Already locked', 'This period is immutable. Create a new period to make changes.'); return; }
    showAlert('Lock period?', `Locking freezes ${target.periodEndDate}. It can no longer be edited.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', style: 'destructive', onPress: () => { lockPeriod(target.id); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }, [selectedPeriodId, periods, lockPeriod]);

  const exportPeriod = useMemo(() => {
    if (selectedPeriodId) return periods.find((p) => p.id === selectedPeriodId) ?? null;
    // Fall back to a live (unsaved) period shape for export.
    return {
      id: 'live', periodEndDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(), rows: liveRows, portfolioTotals: portfolio,
    };
  }, [selectedPeriodId, periods, liveRows, portfolio]);

  const handleExportCsv = useCallback(async () => {
    if (!exportPeriod) return;
    const csv = wipPeriodToCSV(exportPeriod);
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(ok ? 'CSV copied' : 'Copy failed', ok ? 'Paste into Excel / QuickBooks / Sage.' : 'Could not copy CSV.');
  }, [exportPeriod]);

  const handleExportPdf = useCallback(async () => {
    if (!exportPeriod) return;
    try { await shareWipPeriodPdf(exportPeriod, 'MAGE ID'); }
    catch { showAlert('Export failed', 'Could not generate the WIP PDF.'); }
  }, [exportPeriod]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Financial Reporting</Text>
          <Text style={styles.title}>WIP Report</Text>
        </View>
        {/* Audit 2026-09-07 ("Worth doing" #22): this screen printed
            Overbilling in red and Underbilling in blue with no legend and no
            definition, to residential GCs who have never seen a WIP schedule —
            and underbilling is the one a surety actually asks about. */}
        <TouchableOpacity
          onPress={() => setExplainerOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="What is a WIP schedule?"
          testID="wip-explainer-chip"
        >
          <HelpCircle size={20} color={themeColors.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
        <TrendingUp size={22} color={themeColors.accent} strokeWidth={1.75} />
      </View>

      <FeatureExplainerSheet
        visible={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        term="WIP Schedule (Work-In-Progress)"
        definition={
          'A WIP schedule compares what you have EARNED on each job against what you have BILLED for it. '
          + 'Earned revenue is the contract times percent complete, and percent complete is cost-to-date '
          + 'divided by your total estimated cost. Overbilling means you have billed MORE than you have '
          + 'earned — the client is funding you ahead of the work, which is good for cash but is a liability '
          + 'you still owe in labor and materials. Underbilling means you have earned MORE than you have '
          + 'billed — you are financing your client with your own money, and it is the first thing a surety '
          + 'or a lender looks for.'
        }
        whenToUse={[
          'Every month before you close the books — lock the period so the figures cannot move afterward',
          'When a bank or a bonding agent asks for a WIP schedule (they will ask for it by that name)',
          'When a job feels profitable but the bank account disagrees — underbilling is usually why',
        ]}
      />

      <ScrollView {...fabScroll} contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]}>
        {/* Portfolio totals */}
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          <Row label="Revised contract" value={money(portfolio.revisedContract)} styles={styles} />
          <Row label="Earned revenue" value={money(portfolio.earnedRevenue)} styles={styles} />
          <Row label="Billed to date" value={money(portfolio.billedToDate)} styles={styles} />
          <Row label="Overbilling" value={money(portfolio.overbilling)} styles={styles} />
          <Row label="Underbilling" value={money(portfolio.underbilling)} styles={styles} />
          <Row label="Backlog" value={money(portfolio.backlog)} styles={styles} />
          <Row label="Weighted margin" value={pct(portfolio.weightedMarginPct)} styles={styles} />
        </View>

        {/* Period selector */}
        <View style={[styles.card, isDesktop && styles.cardDesktop]}>
          <Text style={styles.sectionTitle}>Periods</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity
              style={[styles.periodChip, selectedPeriodId === null && styles.periodChipActive]}
              onPress={() => setSelectedPeriodId(null)}>
              <Text style={styles.periodChipText}>Live</Text>
            </TouchableOpacity>
            {periods.map((p) => (
              <TouchableOpacity key={p.id}
                style={[styles.periodChip, selectedPeriodId === p.id && styles.periodChipActive]}
                onPress={() => setSelectedPeriodId(p.id)}>
                {p.lockedAt ? <Lock size={12} color={themeColors.textMuted} strokeWidth={2} /> : null}
                <Text style={styles.periodChipText}>{p.periodEndDate}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleSnapshot}>
              <Text style={styles.actionBtnText}>Save period</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleLock}>
              <Lock size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Lock</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleExportCsv}>
              <FileSpreadsheet size={14} color={themeColors.text} strokeWidth={2} />
              <Text style={styles.actionBtnText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleExportPdf}>
              <Text style={styles.actionBtnText}>Export PDF</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Per-project rows (live) */}
        <View style={[styles.card, isDesktop && styles.cardFullDesktop]}>
          <Text style={styles.sectionTitle}>Projects</Text>
          {/* The two colours below carry the whole meaning of this table, and
              until now nothing on the screen said what they meant. */}
          <View style={styles.legendRow} testID="wip-legend">
            <Text style={styles.legendText}>
              <Text style={styles.over}>Over</Text> = billed more than earned (client is ahead of you) ·{' '}
              <Text style={styles.under}>Under</Text> = earned more than billed (you are financing the client)
            </Text>
          </View>
          {closedCount > 0 ? (
            <Text style={styles.muted}>
              {closedCount} closed project{closedCount === 1 ? ' is' : 's are'} excluded — a WIP schedule
              carries work in progress only.
            </Text>
          ) : null}
          {liveRows.length === 0 ? (
            <Text style={styles.muted}>No active projects.</Text>
          ) : liveRows.map((r) => {
            const prior = priorPeriod?.rows.find((pr) => pr.projectId === r.projectId)?.output;
            const flags = flagWipRow(r.output, prior);
            const flagged = flags.profitFade || flags.billingSwing || flags.scheduleDivergence;
            return (
              <TouchableOpacity key={r.projectId} style={styles.projectRow} onPress={() => openDrill(r.projectId)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>{r.projectName}</Text>
                  <Text style={styles.muted}>{pct(r.output.percentComplete)} complete · {money(r.output.earnedRevenue)} earned</Text>
                  <Text style={styles.muted}>
                    Cost-to-date {money(r.input.costToDate)}
                    {costOverrides[r.projectId] === undefined ? ' · est. (tap to add labor)' : ''}
                  </Text>
                </View>
                {flagged ? <AlertTriangle size={16} color={themeColors.danger} strokeWidth={2} /> : null}
                <Text style={r.output.overbilling > 0 ? styles.over : styles.under}>
                  {r.output.overbilling > 0 ? `Over ${money(r.output.overbilling)}` : `Under ${money(r.output.underbilling)}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Per-project drill-in modal */}
      <Modal visible={drillProjectId !== null} transparent animationType="slide" onRequestClose={closeDrill}>
        <View style={styles.modalOverlay}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }} keyboardShouldPersistTaps="handled">
            <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>{drillProject?.name ?? 'Project'}</Text>
                <TouchableOpacity onPress={closeDrill} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              {drillInput && drillOutput ? (
                <>
                  <Text style={styles.muted}>Cost-to-date (subs + materials; add self-performed labor)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={drillCostText}
                    onChangeText={setDrillCostText}
                    placeholder="0"
                    placeholderTextColor={themeColors.textMuted}
                    onEndEditing={commitDrillCost}
                  />
                  <Row label="Revised contract" value={money(drillOutput.revisedContract)} styles={styles} />
                  <Row label="% complete" value={pct(drillOutput.percentComplete)} styles={styles} />
                  <Row label="Earned revenue" value={money(drillOutput.earnedRevenue)} styles={styles} />
                  <Row label="Overbilling" value={money(drillOutput.overbilling)} styles={styles} />
                  <Row label="Underbilling" value={money(drillOutput.underbilling)} styles={styles} />
                  <Row label="Est gross profit" value={money(drillOutput.estGrossProfit)} styles={styles} />
                  <Row label="Est gross margin" value={pct(drillOutput.estGrossMarginPct)} styles={styles} />
                  <Row label="Profit to date" value={money(drillOutput.profitToDate)} styles={styles} />
                  <Row label="Cost to complete" value={money(drillOutput.costToComplete)} styles={styles} />
                  <Row label="Backlog" value={money(drillOutput.backlog)} styles={styles} />

                  {/* Where each number came from. A banker's first question is
                      "what is this contract figure?" and until now the answer
                      lived only in deriveOriginalContract's branch order. */}
                  {drillProvenance ? (
                    <View style={styles.sourceBox} testID="wip-provenance">
                      <Text style={styles.sourceTitle}>Where these numbers come from</Text>
                      <Text style={styles.sourceLine}>
                        Contract {money(drillProvenance.contract.value)} —{' '}
                        {WIP_SOURCE_LABELS[drillProvenance.contract.source]}
                        {drillInput.approvedChangeOrders !== 0
                          ? `, plus ${money(drillInput.approvedChangeOrders)} of approved change orders`
                          : ''}
                      </Text>
                      <Text style={styles.sourceLine}>
                        Cost budget {money(drillProvenance.cost.value)} —{' '}
                        {WIP_SOURCE_LABELS[drillProvenance.cost.source]}
                      </Text>
                      <Text style={styles.sourceLine}>
                        {drillProvenance.overridden
                          ? `Cost-to-date ${money(drillInput.costToDate)} — entered by you. `
                            + `The app can only see ${money(drillProvenance.costToDate.value)} `
                            + `(${money(drillProvenance.costToDate.committed)} subs paid + `
                            + `${money(drillProvenance.costToDate.materials)} material receipts).`
                          : `Cost-to-date ${money(drillProvenance.costToDate.value)} — `
                            + `${money(drillProvenance.costToDate.committed)} subs paid + `
                            + `${money(drillProvenance.costToDate.materials)} material receipts. `
                            + 'Self-performed labor is NOT included, so this is a lower bound — type the real figure above.'}
                      </Text>
                    </View>
                  ) : null}

                  {drillOutput.anticipatedLoss ? (
                    <View style={styles.flagBox}>
                      <View style={styles.flagRow}>
                        <AlertTriangle size={14} color={themeColors.danger} strokeWidth={2} />
                        <Text style={styles.flagText}>
                          Loss job: the full estimated loss is booked now (GAAP), not pro-rated by % complete.
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {drillFlags && drillFlags.reasons.length > 0 ? (
                    <View style={styles.flagBox}>
                      {drillFlags.reasons.map((reason) => (
                        <View key={reason} style={styles.flagRow}>
                          <AlertTriangle size={14} color={themeColors.danger} strokeWidth={2} />
                          <Text style={styles.flagText}>{reason}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // WIP is a financial table — wide on desktop.
  // Desktop: Portfolio + Periods sit side by side and the Projects table spans
  // the full row, instead of three cards stacked in a narrow middle column.
  contentDesktop: {
    width: '100%', maxWidth: 1400, alignSelf: 'center' as const,
    flexDirection: 'row' as const, flexWrap: 'wrap' as const,
    alignItems: 'flex-start' as const, gap: 16,
  },
  cardDesktop: { flexGrow: 1, flexBasis: 420, marginBottom: 0 },
  cardFullDesktop: { flexBasis: '100%' as const, marginBottom: 0 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' as const },
  title: { fontSize: Type.title2.fontSize, color: t.text, fontWeight: '700' as const },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: t.line, gap: 6,
  },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dataLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  dataValue: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  muted: { fontSize: Type.footnote.fontSize, color: t.textMuted },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  projectName: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  over: { fontSize: Type.footnote.fontSize, color: t.danger, fontWeight: '700' as const },
  under: { fontSize: Type.footnote.fontSize, color: t.info, fontWeight: '700' as const },
  periodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  periodChipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  periodChipText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  formCard: {
    backgroundColor: t.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, gap: 6,
  },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 10, color: t.text, fontSize: Type.body.fontSize, marginBottom: 8,
  },
  legendRow: { paddingBottom: 8 },
  legendText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  sourceBox: {
    marginTop: 12, padding: 12, gap: 6,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
  },
  sourceTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  sourceLine: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  flagBox: { marginTop: 10, gap: 6 },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flagText: { fontSize: Type.footnote.fontSize, color: t.danger, flex: 1 },
});
