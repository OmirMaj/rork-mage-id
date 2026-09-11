// Reports — financial reporting hub. Three reports under one roof:
//   • WIP (Work in Progress) — bank-ready
//   • Profit by project — running margin
//   • A/R Aging — open invoices bucketed by days past due
//
// Each tab supports a "Download PDF" CTA (branded, GC-ready) and a
// "Copy CSV" action for the WIP + AR reports so a CFO can paste into
// QuickBooks/Excel/Sage without rekeying.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronLeft, FileDown, ClipboardList, TrendingUp, AlertTriangle,
  CheckCircle2, ChevronRight, Copy, FileSpreadsheet, ArrowDownToLine,
  DollarSign, Activity, Banknote, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import {
  computeWIPReport, computeProfitReport, computeARAgingReport,
  wipReportToCSV, arAgingReportToCSV, wipRowEarned, wipRowOverbilled, wipRowCostToComplete,
  wipReportRowHasCostBasis, profitRowHasCostBasis,
  type ARAgingReport,
} from '@/utils/financialReports';
import { shareWIPReport, shareProfitReport, shareARAgingReport } from '@/utils/financialReportPdf';
import {
  describePortfolioCostBasis, isWipBilling, normalizeWipEtcMap, wipEtcStorageKey, wipEtcValueMap,
  type WipEstimatedCost,
} from '@/utils/wip';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney } from '@/utils/formatters';
import { copyToClipboard } from '@/utils/clipboard';
import type { CompanyBranding } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

type Tab = 'wip' | 'profit' | 'aging';

export default function ReportsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const {
    projects, invoices, changeOrders, commitments, settings,
    // THE COST SOURCES THIS SCREEN ALWAYS HELD AND NEVER PASSED (audit
    // 2026-09-11). computeWIPReport / computeProfitReport take a
    // JobCostActualSources and their own doc says, in these words, that an
    // omitted argument "paints a bleeding job green" — and both call sites
    // here omitted it, on the tab (Profit) that every free and Pro user lands
    // on by default. Cost-to-date was subcontract payments and nothing else:
    // no materials, no self-perform labour, no machine time, no permit fees.
    //
    // app/job-costing.tsx has wired exactly these six for two audits. The only
    // thing missing was this line.
    equipment, permits, aiaPayApps,
  } = useProjects();
  const { receipts } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier } = useLaborRates();
  const { user } = useAuth();
  const userId = user?.id;

  // WIP is the bank-ready Business deliverable — gate it exactly like
  // /wip-report does (canAccess('wip_reporting')). Non-Business users can
  // still open the Profit + A/R Aging tabs; selecting WIP shows the Paywall
  // instead of the report chrome, and WIP export actions are blocked.
  const wipUnlocked = canAccess('wip_reporting');
  // Land sub-Business users on Profit so the default tab isn't a locked wall.
  const [tab, setTab] = useState<Tab>(wipUnlocked ? 'wip' : 'profit');
  const [generating, setGenerating] = useState(false);

  // Built once and spread whole into both reports, so the two tabs of this
  // screen cannot end up measuring against different costs — the failure this
  // module's header spends forty lines on, one level up.
  const costSources = useMemo(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, equipment, permits,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, equipment, permits]);
  // THE COST TO COMPLETE THE GC TYPED ON /wip-report (axis 8, adversarial
  // review 2026-09-11). It is the input that stops an overrun job reporting
  // 100% complete, and for one day it reached the /wip-report engine ONLY: the
  // same job read EAC $800,000 / 77.5% / $426,250 earned there and EAC $620,000
  // / 100% / $550,000 earned here, in this tab's CSV and in its PDF. Two
  // bank-facing schedules disagreeing about cost at completion is the defect
  // this whole area's parity work exists to close.
  //
  // Same AsyncStorage map, same key builder, same parser — all three live in
  // utils/wip.ts precisely so a second screen can reach them. No server leg
  // yet (the wip_cost_overrides table has no column for it), so an ETC typed on
  // the laptop is not on the phone; /wip-report's drill-in says so in words and
  // this tab inherits whatever that device holds.
  //
  // RE-READ ON FOCUS, not once per mount (adversarial review 2026-09-11). This
  // was a `useEffect` keyed on the user id, so a cost to complete typed on
  // /wip-report and then navigated back from was NOT reflected here until the
  // screen remounted — the two engines fed different maps in one session, which
  // is the same two-schedules-disagree state on a live device that the map
  // exists to close. There is no server leg and no context for it yet (see the
  // handoff), so focus is the cheapest correct trigger: /wip-report writes the
  // key on every commit, and this screen is only reachable by navigating to it.
  const [etcEntries, setEtcEntries] = useState<Record<string, number>>({});
  const loadEtc = useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(wipEtcStorageKey(userId));
        if (cancelled) return;
        // An ABSENT key clears the map rather than leaving the last one in
        // place: the GC may have cleared every entry, and a stale map here
        // would keep applying a forecast he has withdrawn.
        setEtcEntries(raw ? wipEtcValueMap(normalizeWipEtcMap(JSON.parse(raw))) : {});
      } catch { /* fresh install / bad cache → the derived forecast stands */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  // On mount and on every user switch, and again whenever the screen is focused.
  useEffect(() => {
    setEtcEntries({});
    return loadEtc();
  }, [loadEtc]);
  useFocusEffect(loadEtc);

  // AIA pay applications: the contract chain and billed-to-date both read them
  // (axes 5 and 6). Without them a GC billing through G702/G703 read $0 billed
  // on this tab while /wip-report read the real figure.
  const wip    = useMemo(() => computeWIPReport(projects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries), [projects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries]);
  const profit = useMemo(() => computeProfitReport(projects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries), [projects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries]);
  const aging  = useMemo(() => computeARAgingReport(invoices, projects), [invoices, projects]);

  const branding = useMemo<CompanyBranding>(() => ({
    companyName:   settings?.branding?.companyName ?? 'MAGE ID',
    contactName:   settings?.branding?.contactName ?? '',
    phone:         settings?.branding?.phone ?? '',
    email:         settings?.branding?.email ?? '',
    address:       settings?.branding?.address ?? '',
    licenseNumber: settings?.branding?.licenseNumber ?? '',
    tagline:       settings?.branding?.tagline ?? '',
    logoUri:       settings?.branding?.logoUri,
  }), [settings]);

  // WHAT THE ACTIVE TAB WOULD ACTUALLY EXPORT (polish audit 2026-09-10).
  // The empty guard lives inside each tab body, while the action bar sits in
  // the parent — so on a brand-new account /reports correctly rendered "No
  // active projects" and still offered "Copy CSV" and "Download & share PDF"
  // beside it. A WIP schedule of zeros is a document a lender reads as a sworn
  // statement of position; the app must not hand one out.
  const exportableRows = tab === 'wip' ? wip.rows.length
                       : tab === 'profit' ? profit.rows.length
                       : aging.rows.length;
  const nothingToExport = exportableRows === 0;
  const issuedInvoices = invoices.filter(isWipBilling).length;
  // A blocked button says why (standing rule). One sentence per tab, naming
  // the prerequisite rather than the failure.
  const blockedReason = tab === 'wip'
    ? 'A WIP schedule needs at least one active project with a cost-and-markup estimate. There is nothing to put on this report yet.'
    : tab === 'profit'
      ? 'A profit report needs at least one project with an estimate. There is nothing to put on this report yet.'
      // NOT "nothing is owed to you" — on an account with no invoices at all
      // that is a verdict read off absent data, the same class as the
      // "Every invoice is fully paid. Nice work." this tab used to print with
      // zero invoices on file. Name the prerequisite instead. The population is
      // ISSUED invoices (utils/wip.isWipBilling — a draft is a document the
      // client has never seen), because an account holding nothing but drafts
      // has collected nothing and must not be told it has.
      : issuedInvoices === 0
        ? 'An A/R aging report ages the invoices a client still owes you. You have not issued one yet.'
        : 'An A/R aging report lists invoices still owed to you. Every invoice you have issued is collected in full.';

  const handleSharePdf = useCallback(async () => {
    if (tab === 'wip' && !wipUnlocked) return; // WIP export is Business-gated
    if (nothingToExport) { showAlert('Nothing to report yet', blockedReason); return; }
    setGenerating(true);
    try {
      if (tab === 'wip') {
        await shareWIPReport(wip, branding);
      } else if (tab === 'profit') {
        await shareProfitReport(profit.rows, profit.totalRevenue, profit.totalProfit,
          profit.weightedMargin, branding, profit.noCostBasisCount, profit.noCostBasisRevenue);
      } else {
        await shareARAgingReport(aging, branding);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      showAlert('PDF failed', err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      setGenerating(false);
    }
  }, [tab, wip, profit, aging, branding, wipUnlocked, nothingToExport, blockedReason]);

  const handleCopyCsv = useCallback(async () => {
    if (tab === 'wip' && !wipUnlocked) return; // WIP CSV is Business-gated
    if (nothingToExport) { showAlert('Nothing to report yet', blockedReason); return; }
    const csv = tab === 'wip' ? wipReportToCSV(wip)
              : tab === 'aging' ? arAgingReportToCSV(aging)
              : ''; // profit doesn't ship a CSV — it's tiny + the PDF is the deliverable
    if (!csv) return;
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok ? 'CSV is on your clipboard. Paste into Excel/QuickBooks/Sage.' : 'Could not copy CSV.',
    );
  }, [tab, wip, aging, wipUnlocked, nothingToExport, blockedReason]);

  // WIP tab selected but tier doesn't unlock it → full-screen Paywall,
  // mirroring app/wip-report.tsx. The report chrome (data, PDF, CSV) never
  // renders, so the Business-only deliverable stays behind the gate.
  const wipLocked = tab === 'wip' && !wipUnlocked;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Financial Reports</Text>
          <Text style={styles.title}>Bank-Ready Reports</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TabBtn label="WIP"      icon={ClipboardList} active={tab === 'wip'}    onPress={() => setTab('wip')} />
        <TabBtn label="Profit"   icon={TrendingUp}    active={tab === 'profit'} onPress={() => setTab('profit')} />
        <TabBtn label="A/R Aging" icon={AlertTriangle} active={tab === 'aging'}  onPress={() => setTab('aging')} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {/* Centered icon-circle hero — matches the new design language so
            Reports reads as a sibling of the AI-feature screens. */}
        <View style={styles.reportsHero}>
          <View style={styles.reportsHeroIcon}>
            <TrendingUp size={26} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.reportsHeroTitle}>Bank-Ready Reports</Text>
          <Text style={styles.reportsHeroSub}>
            WIP, profit margin, and A/R aging — auto-compiled across every project. Export to CSV or PDF in one tap.
          </Text>
        </View>

        {tab === 'wip' && !wipLocked && <WIPView    report={wip} />}
        {tab === 'profit'               && <ProfitView profit={profit} />}
        {tab === 'aging'                && <AgingView  report={aging} anyIssued={issuedInvoices > 0} />}
      </ScrollView>

      {/* WIP is Business-only. Render the same Paywall wip-report.tsx uses.
          Closing it drops the user back onto the Profit tab (still usable). */}
      {wipLocked && (
        <Paywall
          visible={true}
          feature="WIP Reporting"
          requiredTier="business"
          onClose={() => setTab('profit')}
        />
      )}

      {/* Action bar — hidden on the locked WIP tab so no WIP export leaks. */}
      {!wipLocked && (
      <View style={[styles.actionBarWrap, { paddingBottom: insets.bottom + 12 }]}>
      {/* A blocked button says why, VISIBLY — the repo's own pattern
          (app/cash-flow.tsx:1157). The empty guard lives inside the tab body
          and these controls live out here, so without this line the buttons
          were the only thing contradicting the EmptyState above them. */}
      {nothingToExport ? (
        <Text style={styles.blockedNote} testID="reports-export-blocked">{blockedReason}</Text>
      ) : null}
      <View style={styles.actionBar}>
        {tab !== 'profit' && (
          <TouchableOpacity
            style={[styles.actionBtnSecondary, nothingToExport && styles.actionBtnBlocked]}
            onPress={handleCopyCsv}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: nothingToExport }}
            accessibilityHint={nothingToExport ? blockedReason : undefined}
          >
            <Copy size={14} color={nothingToExport ? themeColors.textMuted : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.actionBtnSecondaryText, nothingToExport && { color: themeColors.textMuted }]}>Copy CSV</Text>
          </TouchableOpacity>
        )}
        {/* The handler refuses AND explains, in case a platform lets the press
            through despite the disabled state above. Belt to the visible note's
            braces — the same shape app/equipment-detail.tsx:178 describes. */}
        <TouchableOpacity
          style={[styles.actionBtnPrimary, tab === 'profit' && { flex: 1 }, nothingToExport && styles.actionBtnBlocked]}
          onPress={handleSharePdf}
          disabled={generating}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: nothingToExport }}
          accessibilityHint={nothingToExport ? blockedReason : undefined}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <FileDown size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.actionBtnPrimaryText}>
                {Platform.OS === 'web' ? 'Open PDF preview' : 'Download & share PDF'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      </View>
      )}
    </View>
  );
}

function TabBtn({ label, icon: Icon, active, onPress }: { label: string; icon: typeof TrendingUp; active: boolean; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress} activeOpacity={0.85}>
      <Icon size={14} color={active ? themeColors.accent : themeColors.textMuted} />
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── WIP view ────────────────────────────────────────────────────────

function WIPView({ report }: { report: ReturnType<typeof computeWIPReport> }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (report.rows.length === 0) {
    return <EmptyState icon={ClipboardList} title="No active projects" body="WIP reports compile across active projects. Add or activate a project to populate this report." />;
  }
  return (
    <>
      {/* Portfolio header */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <Text style={styles.summaryEyebrow}>WIP TOTAL — {report.rows.length} project{report.rows.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.summaryGrid}>
          <SummaryStat label="Revised contract" value={formatMoney(report.totals.revisedContract)} accent={themeColors.text} />
          <SummaryStat label="Billed"            value={formatMoney(report.totals.billedToDate)} accent={themeColors.text} />
          <SummaryStat label="Retainage held"    value={formatMoney(report.totals.retainageHeld)} accent={Colors.warning} />
          {/* MEASURABLE, not the whole book (F14, adversarial review
              2026-09-11). `projectedProfit` sums every row INCLUDING jobs that
              carry a contract and no cost at all — a target budget or a GMP cap
              with no estimate, no signed commitment and nothing spent — whose
              "profit" is their entire contract at a 100% margin. This screen
              printed $1,100,000 here while its own CSV and its own PDF printed
              $200,000 for the same book, beside a 20% margin struck on the
              measurable subset. Two numbers for one book, on one screen, is the
              exact defect this whole area exists to close. */}
          <SummaryStat
            label="Projected profit"
            value={formatMoney(report.totals.measurableProjectedProfit)}
            accent={report.totals.measurableProjectedProfit >= 0 ? themeColors.success : themeColors.danger}
          />
        </View>
        {/* …and the exclusion is NAMED. Suppressing a figure without saying it
            was suppressed is its own quiet lie, and both exports already carry
            this sentence. */}
        {report.totals.noCostBasisCount > 0 ? (
          <Text style={styles.basisLine} testID="wip-no-cost-basis">
            {`Measured on the jobs that have a cost basis. ${report.totals.noCostBasisCount} contract`
              + `${report.totals.noCostBasisCount === 1 ? '' : 's'} worth `
              + `${formatMoney(report.totals.noCostBasisContract)} `
              + `${report.totals.noCostBasisCount === 1 ? 'carries' : 'carry'} no cost estimate, no signed `
              + 'commitment and nothing spent, so it has no measurable margin and is excluded from the '
              + 'profit and margin above.'}
          </Text>
        ) : null}
        {/* A screen may not call itself bank-ready and also decline to say
            where its numbers came from. "Est. final cost $173,702" used to
            arrive here with no explanation of why it sat $42,200 above the
            estimate the other WIP schedule struck its margin against. */}
        <CostBasisLine rows={report.rows} />
      </View>

      {report.rows.map(r => (
        <View key={r.projectId} style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowTitle} numberOfLines={1}>{r.projectName}</Text>
            {/* The noun, not just the number. A bare "-11.9 %" beside a
                "% Complete 0%" row is unreadable — margin, completion,
                variance and overrun all render the same, and colour is
                exactly what does not survive a screenshot or a mono print. */}
            {/* A job with a contract and no cost basis has NO margin — its
                pill read "100.0% margin" while the CSV printed an empty cell
                for the same row. Same rule, same row, three surfaces. */}
            {wipReportRowHasCostBasis(r) ? (
              <View style={[styles.marginPill, marginTone(r.projectedMargin, themeColors)]}>
                <Text style={[styles.marginPillText, marginTextTone(r.projectedMargin, themeColors)]}>
                  {r.projectedMargin.toFixed(1)}% margin
                </Text>
              </View>
            ) : (
              <View style={[styles.marginPill, styles.marginPillNone]}>
                <Text style={[styles.marginPillText, styles.marginPillNoneText]}>no cost basis</Text>
              </View>
            )}
          </View>

          <View style={styles.kvGrid}>
            <KV k="Contract"        v={formatMoney(r.contractValue)} />
            <KV k="Approved COs"    v={formatMoney(r.approvedChangeOrders)} />
            <KV k="Revised"         v={formatMoney(r.revisedContract)} bold />
            {/* COST TO DATE AND EARNED REVENUE were computed and rendered
                nowhere (audit 2026-09-11). % Complete is cost ÷ cost-at-
                completion, so a reader could see the ratio and neither of the
                two numbers it came from, and `unbilled` — the figure a lender
                reads first — reached the CSV and never this grid. */}
            <KV k="Cost to date"    v={r.costToDate == null ? '—' : formatMoney(r.costToDate)} />
            <KV k="Est. final cost" v={formatMoney(r.estimatedFinalCost)} />
            <KV k="Cost to complete" v={wipRowCostToComplete(r) == null ? '—' : formatMoney(wipRowCostToComplete(r) as number)} />
            <KV k="% Complete"      v={`${r.percentComplete.toFixed(0)}%`} />
            <KV k="Earned revenue"  v={formatMoney(wipRowEarned(r))} />
            <KV k="Billed"          v={formatMoney(r.billedToDate)} />
            <KV k="Paid"            v={formatMoney(r.paidToDate)} />
            {/* One signed line rather than two, so a job that is exactly on
                billing reads as "On billing" instead of printing "$0 under",
                which asserts a measurement nobody made. */}
            <KV k={wipRowOverbilled(r) > 0 ? 'Overbilled' : r.unbilled > 0 ? 'Underbilled' : 'Billing'}
                v={wipRowOverbilled(r) > 0
                  ? formatMoney(wipRowOverbilled(r))
                  : r.unbilled > 0 ? formatMoney(r.unbilled) : 'On earned value'}
                muted={wipRowOverbilled(r) === 0 && r.unbilled === 0} />
            <KV k="Retainage"       v={formatMoney(r.retainageHeld)} muted={r.retainageHeld === 0} />
            {wipReportRowHasCostBasis(r) ? (
              <KV k="Projected profit"
                  v={formatMoney(r.projectedProfit)}
                  tone={r.projectedProfit >= 0 ? 'good' : 'bad'}
                  bold />
            ) : (
              <KV k="Projected profit" v="—" muted />
            )}
          </View>
          {wipReportRowHasCostBasis(r) ? null : (
            <Text style={styles.basisLine}>
              This contract has no cost estimate, no signed commitment and nothing spent, so MAGE
              cannot measure a profit or a margin on it. It is excluded from the portfolio figures
              above and from the CSV and PDF totals.
            </Text>
          )}
        </View>
      ))}
    </>
  );
}

// ─── Profit view ─────────────────────────────────────────────────────

function ProfitView({ profit }: { profit: ReturnType<typeof computeProfitReport> }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (profit.rows.length === 0) {
    return <EmptyState icon={TrendingUp} title="No projects yet" body="Profit dashboard pulls live margins across every project. Add one to get started." />;
  }
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>RUNNING PORTFOLIO MARGIN</Text>
        <View style={styles.profitHero}>
          <Text style={styles.profitHeroAmount}>{formatMoney(profit.totalProfit)}</Text>
          <Text style={[styles.profitHeroPct, marginTextTone(profit.weightedMargin, themeColors)]}>
            {profit.weightedMargin.toFixed(1)}% margin
          </Text>
        </View>
        <Text style={styles.profitHeroSub}>
          on {formatMoney(profit.measurableRevenue)} of revised contract value
          {profit.noCostBasisCount > 0
            ? ` — ${profit.noCostBasisCount} project${profit.noCostBasisCount === 1 ? '' : 's'} worth `
              + `${formatMoney(profit.noCostBasisRevenue)} excluded, because a contract with no cost `
              + 'estimate, no signed commitment and nothing spent has no measurable margin'
            : ''}
        </Text>
        {/* Same basis line as the WIP tab, from the same helper — this is the
            tab a sub-Business user lands on, so it is the one that most needs
            to say what it measured against. */}
        <CostBasisLine rows={profit.rows} />
      </View>

      <View style={styles.bandRow}>
        <Band color={themeColors.success} label=" ≥ 12% (good)" />
        <Band color={Colors.warningLabel} label=" 5–11% (watch)" />
        <Band color={themeColors.danger}   label=" < 5% (risk)" />
      </View>

      {profit.rows.map(r => (
        <View key={r.projectId} style={styles.row}>
          <View style={styles.rowHead}>
            <View style={[styles.healthDot, healthTone(r.health, themeColors)]} />
            <Text style={styles.rowTitle} numberOfLines={1}>{r.projectName}</Text>
            {/* Same rule as the WIP tab one chip away — this is the tab every
                free and Pro user lands on, so it is the version of the
                fabricated 100% margin most users would actually meet. */}
            {profitRowHasCostBasis(r) ? (
              <View style={[styles.marginPill, marginTone(r.projectedMargin, themeColors)]}>
                <Text style={[styles.marginPillText, marginTextTone(r.projectedMargin, themeColors)]}>
                  {r.projectedMargin.toFixed(1)}% margin
                </Text>
              </View>
            ) : (
              <View style={[styles.marginPill, styles.marginPillNone]}>
                <Text style={[styles.marginPillText, styles.marginPillNoneText]}>no cost basis</Text>
              </View>
            )}
          </View>
          <View style={styles.kvGrid}>
            <KV k="Revenue"         v={formatMoney(r.revenue)} />
            <KV k="Cost to date"    v={formatMoney(r.costToDate)} />
            <KV k="Est. final cost" v={formatMoney(r.estimatedFinalCost)} />
            {profitRowHasCostBasis(r) ? (
              <KV k="Projected profit" v={formatMoney(r.projectedProfit)}
                  tone={r.projectedProfit >= 0 ? 'good' : 'bad'} bold />
            ) : (
              <KV k="Projected profit" v="—" muted />
            )}
          </View>
          {profitRowHasCostBasis(r) ? null : (
            <Text style={styles.basisLine}>
              No cost estimate, no signed commitment and nothing spent on this job, so there is no
              margin to measure. It is excluded from the portfolio profit and margin above.
            </Text>
          )}
        </View>
      ))}
    </>
  );
}

// ─── AR Aging view ───────────────────────────────────────────────────

function AgingView({ report, anyIssued }: { report: ARAgingReport; anyIssued: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (report.rows.length === 0) {
    // "Every invoice is fully paid. Nice work." was printed on an account with
    // NO invoices at all — a success verdict computed from absent data, on the
    // screen that answers "who owes me money". Aging can only be empty two
    // ways, and they are not the same news, so say which one this is.
    const collected = anyIssued;
    return <EmptyState
      icon={collected ? CheckCircle2 : FileText}
      title={collected ? 'Nothing outstanding' : 'No invoices yet'}
      body={collected
        ? 'Every invoice you have sent is collected in full — nothing is aging.'
        : 'A/R aging buckets the invoices a client still owes you. Issue one from a project and it lands here the day it is sent — a draft owes you nothing, so it is not counted.'}
      tone={collected ? 'good' : undefined}
    />;
  }
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>OUTSTANDING — {report.rows.length} invoice{report.rows.length === 1 ? '' : 's'}</Text>
        <Text style={styles.agingHeroAmount}>{formatMoney(report.totals.totalOutstanding)}</Text>
        <View style={styles.bucketRow}>
          <Bucket label="Current" value={report.totals.current}     tone="muted" />
          <Bucket label="0–30"    value={report.totals['0-30']}      tone="warn" />
          <Bucket label="31–60"   value={report.totals['31-60']}     tone="warn" />
          <Bucket label="61–90"   value={report.totals['61-90']}     tone="bad" />
          <Bucket label="90+"     value={report.totals['90+']}       tone="bad" />
        </View>
      </View>

      {report.rows.map(r => {
        const bucketStyle =
          r.bucket === 'current' ? styles.bucketPillMuted :
          r.bucket === '0-30'    ? styles.bucketPillWarn :
          r.bucket === '31-60'   ? styles.bucketPillWarn :
                                   styles.bucketPillBad;
        return (
          <View key={r.invoiceId} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>#{r.invoiceNumber} · {r.projectName}</Text>
              <View style={[styles.bucketPill, bucketStyle]}>
                <Text style={styles.bucketPillText}>
                  {r.bucket === 'current' ? 'Current' : `${r.daysPastDue}d past due`}
                </Text>
              </View>
            </View>
            <View style={styles.kvGrid}>
              <KV k="Issued"       v={new Date(r.issueDate).toLocaleDateString()} />
              <KV k="Due"          v={new Date(r.dueDate).toLocaleDateString()} />
              <KV k="Total due"    v={formatMoney(r.totalDue)} />
              <KV k="Paid"         v={formatMoney(r.amountPaid)} />
              <KV k="Outstanding"  v={formatMoney(r.outstanding)} bold tone="bad" />
            </View>
          </View>
        );
      })}
    </>
  );
}

// ─── Tiny presentational components ──────────────────────────────────

/**
 * The cost basis behind whatever margin sits above it.
 *
 * Both report tabs feed it the rows they are showing, and the sentence comes out
 * of utils/wip.describePortfolioCostBasis — the same helper app/wip-report.tsx
 * and the PDF use, so the three surfaces cannot end up explaining one schedule
 * three different ways. A row that predates `costAtCompletion` renders nothing
 * rather than a guess.
 */
function CostBasisLine(
  { rows }: { rows: { costAtCompletion?: WipEstimatedCost; costToDate?: number }[] },
) {
  const styles = useThemedStyles(makeStyles);
  const withBasis = rows.filter(r => r.costAtCompletion != null);
  if (withBasis.length === 0) return null;
  const bases = withBasis.map(r => r.costAtCompletion as WipEstimatedCost);
  // COST already paid out, summed across the same rows the basis describes, so
  // the sentence can say when the book has already spent past the cost at
  // completion it is striking margin against. If ANY of those rows cannot say
  // what it has cost, the sum is passed as undefined rather than short — a
  // partial spend compared against a full cost reads as "you are fine", which
  // is the reassurance this line exists to withhold.
  const incurred = withBasis.every(r => r.costToDate != null)
    ? withBasis.reduce((sum, r) => sum + (r.costToDate ?? 0), 0)
    : undefined;
  return (
    <Text style={styles.basisLine} testID="reports-cost-basis">
      {describePortfolioCostBasis(bases, incurred)}
    </Text>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryStatItem}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={[styles.summaryStatValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function KV({ k, v, bold, tone, muted }: { k: string; v: string; bold?: boolean; tone?: 'good' | 'bad'; muted?: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[
        styles.kvVal,
        bold ? styles.kvValBold : null,
        tone === 'good' ? { color: themeColors.success } : null,
        tone === 'bad' ? { color: themeColors.danger } : null,
        muted ? { color: themeColors.textMuted } : null,
      ]}>
        {v}
      </Text>
    </View>
  );
}

function Band({ color, label }: { color: string; label: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.band}>
      <View style={[styles.bandDot, { backgroundColor: color }]} />
      <Text style={styles.bandText}>{label}</Text>
    </View>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'warn' | 'bad' }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const color = tone === 'muted' ? themeColors.text : tone === 'warn' ? Colors.warning : themeColors.danger;
  return (
    <View style={styles.bucket}>
      <Text style={styles.bucketLabel}>{label}</Text>
      <Text style={[styles.bucketValue, { color }]}>{formatMoney(value)}</Text>
    </View>
  );
}

function EmptyState({ icon: Icon, title, body, tone }: { icon: typeof TrendingUp; title: string; body: string; tone?: 'good' }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.emptyCard, tone === 'good' ? { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' } : null]}>
      <Icon size={28} color={tone === 'good' ? themeColors.success : themeColors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// Tone helpers — colour rules for margin and health. Accept ThemeColors so
// dark-mode gets the brighter token variants instead of hardcoded light-mode hex.
function marginTone(pct: number, t: ThemeColors) {
  if (pct >= 12) return { backgroundColor: t.success + '15' };
  if (pct >=  5) return { backgroundColor: Colors.warning + '15' };
  return                 { backgroundColor: t.danger + '15' };
}
function marginTextTone(pct: number, t: ThemeColors) {
  if (pct >= 12) return { color: t.success };
  if (pct >=  5) return { color: Colors.warningLabel };
  return                 { color: t.danger };
}
function healthTone(h: 'green' | 'yellow' | 'red', t: ThemeColors) {
  if (h === 'green')  return { backgroundColor: t.success };
  if (h === 'yellow') return { backgroundColor: Colors.warning };
  return                       { backgroundColor: t.danger };
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 2 },
  reportsHero: { alignItems: 'center' as const, gap: 6, marginBottom: 18, paddingHorizontal: 8 },
  reportsHeroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: t.accent + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  reportsHeroTitle: { fontSize: 24, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  reportsHeroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 8 },

  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
    backgroundColor: t.bg,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  tabBtnActive: { backgroundColor: t.accent + '12', borderColor: t.accent },
  tabBtnText:   { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textMuted },
  tabBtnTextActive: { color: t.accent },

  summaryCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 16,
    borderWidth: 1, borderColor: t.line, marginBottom: 14, gap: 10,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryEyebrow: { fontSize: 10, fontWeight: '800', color: t.accent, letterSpacing: 1.2, textTransform: 'uppercase' },
  summaryGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryStatItem: { width: '47%', paddingVertical: 4 },
  summaryStatLabel: { fontSize: 10, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  summaryStatValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.3 },
  basisLine: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16,
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line,
  },

  profitHero: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 4 },
  profitHeroAmount: { fontSize: Type.title1.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.6 },
  profitHeroPct:    { fontSize: Type.callout.fontSize, fontWeight: '800' },
  profitHeroSub:    { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  bandRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  band:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bandDot: { width: 8, height: 8, borderRadius: 4 },
  bandText:{ fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },

  agingHeroAmount: { fontSize: 26, fontWeight: '800', color: t.danger, letterSpacing: -0.6, marginTop: 4 },
  bucketRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  bucket:    { flex: 1, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  bucketLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  bucketValue: { fontSize: Type.caption1.fontSize, fontWeight: '800', marginTop: 3, letterSpacing: -0.2 },
  bucketPill:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  bucketPillMuted: { backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  bucketPillWarn:  { backgroundColor: Colors.warning + '15' },
  bucketPillBad:   { backgroundColor: t.danger   + '15' },
  bucketPillText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: t.text },

  row: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 10,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rowTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  marginPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Tokens.radius.full },
  marginPillText: { fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 0.3 },
  // The pill a job with NO measurable margin wears. Deliberately toneless —
  // green/amber/red are verdicts, and there is nothing here to pass a verdict
  // on; it must not read as "0% margin" either.
  marginPillNone: { backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  marginPillNoneText: { color: t.textMuted },
  healthDot: { width: 10, height: 10, borderRadius: 5 },

  kvGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kv: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvKey: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  kvVal: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' },
  kvValBold: { fontWeight: '800', fontSize: Type.footnote.fontSize },

  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody:  { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  actionBarWrap: {
    paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surface,
  },
  actionBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 4 },
  blockedNote: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16,
    paddingHorizontal: 16, paddingBottom: 6,
  },
  actionBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  actionBtnSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  // Reads as unavailable without becoming untappable — tapping it says why.
  actionBtnBlocked: { opacity: 0.45, shadowOpacity: 0 },
  actionBtnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 11, backgroundColor: t.accentFill,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 4,
  },
  actionBtnPrimaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
});
