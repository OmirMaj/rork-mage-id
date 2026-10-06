// Reports — financial reporting hub. Three reports under one roof:
//   • WIP (Work in Progress) — bank-ready
//   • Profit by project — running margin
//   • A/R Aging — open invoices bucketed by days past due
//
// Each tab supports a "Download PDF" CTA (branded, GC-ready) and an
// "Export CSV" action for the WIP + AR reports — a real .csv file handed to the
// share sheet (or downloaded, on web), falling back to the clipboard only where
// the platform cannot deliver a file, so a CFO can open it in
// QuickBooks/Excel/Sage without rekeying.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { Stack, useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronLeft, FileDown, ClipboardList, TrendingUp, AlertTriangle,
  CheckCircle2, ChevronRight, FileSpreadsheet, ArrowDownToLine,
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
  wipReportRowHasCostBasis, profitRowHasCostBasis, reportCsvDocument,
  type ARAgingReport,
} from '@/utils/financialReports';
import {
  shareWIPReport, shareProfitReport, shareARAgingReport, shareReportCsv,
} from '@/utils/financialReportPdf';
import {
  describePortfolioCostBasis, isWipBilling, isOwnCompanyProject, normalizeWipEtcMap, wipEtcStorageKey, wipEtcValueMap,
  type WipEstimatedCost,
} from '@/utils/wip';
import { pdfFailureMessage } from '@/utils/platformFile';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney } from '@/utils/formatters';
import { copyToClipboard } from '@/utils/clipboard';
import type { CompanyBranding } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { ActionBar, TileGrid, segmentedDesktop, useIsDesktop, useIsDesktopWeb } from '@/components/ui';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import { ToolbarActions, type ToolbarAction } from '@/components/desktop/ToolbarActions';
import { printToolbarAction } from '@/components/desktop/printAction';
import { routeHref } from '@/components/desktop/RowLink';
import {
  agingCells, agingFooter, marginCellText, profitCells, profitFooter, reportsWipCells, reportsWipFooter,
} from '@/utils/dashboardTables';

type Tab = 'wip' | 'profit' | 'aging';

/** Why the header's Print / Export CSV are blocked on the WIP tab of a plan
 *  without WIP reporting. The page itself shows the Paywall there, and the
 *  bottom export bar is not drawn at all; the desktop header's actions stay
 *  visible and say why, as every blocked button in this app does. */
const WIP_LOCKED_REASON =
  'The WIP schedule is on the Business plan, so it can’t be printed or exported on this one. '
  + 'Profit and A/R aging stay open on your plan.';

export default function ReportsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Desktop: the tab row becomes a left-aligned segmented control and the
  // header carries Print / Export CSV (a native tablet may show them too — its
  // press is the share sheet, already correct). Desktop WEB only: the hero
  // duplicating the title goes (structure, never on a phone or native).
  const isDesktop = useIsDesktop();
  const isDesktopWeb = useIsDesktopWeb();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const {
    projects, invoices: allInvoices, changeOrders, commitments, settings,
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
  const { rates: laborRates, overtimeMultiplier, overtimeRule } = useLaborRates();
  const { user } = useAuth();
  const userId = user?.id;

  // WIP is the bank-ready Business deliverable — gate it exactly like
  // /wip-report does (canAccess('wip_reporting')). Non-Business users can
  // still open the Profit + A/R Aging tabs; selecting WIP shows the Paywall
  // instead of the report chrome, and WIP export actions are blocked.
  const wipUnlocked = canAccess('wip_reporting');
  // Land sub-Business users on Profit so the default tab isn't a locked wall.
  // A caller can name the tab (`/reports?tab=aging`): the "who owes me" entry
  // points want the A/R list, not whichever report happens to be first. A
  // requested WIP on a plan without it still falls back to Profit.
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(() => {
    if (requestedTab === 'aging' || requestedTab === 'profit') return requestedTab;
    return wipUnlocked ? 'wip' : 'profit';
  });
  const [generating, setGenerating] = useState(false);

  // Built once and spread whole into both reports, so the two tabs of this
  // screen cannot end up measuring against different costs — the failure this
  // module's header spends forty lines on, one level up.
  const costSources = useMemo(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits]);
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

  // THIS COMPANY'S BOOK, NOT EVERY JOB IT CAN SEE (#18, audit 2026-09-22).
  // `projects` is every project RLS lets this account read — including a
  // partner GC's job he was invited onto as an editor or viewer, estimate and
  // all. All three tabs used to loop over that whole list, so the partner's
  // $900,000 contract and its profit landed in this GC's WIP totals, his
  // portfolio margin and (through its invoices) his A/R aging — on the PDF he
  // hands his bank. Narrowed ONCE, here, with the shared utils/wip rule, and
  // the same two lists feed all three reports so the tabs cannot disagree
  // about whose book they describe. The shared jobs are counted, not hidden:
  // the WIP and Profit tabs say how many were left out.
  const ownProjects = useMemo(
    () => projects.filter(p => isOwnCompanyProject(p, userId)),
    [projects, userId],
  );
  // `invoices` below IS the narrowed list — the unfiltered one is `allInvoices`,
  // so nothing further down this screen can reach another company's receivables.
  const invoices = useMemo(() => {
    // By exclusion rather than inclusion: an invoice whose project is not on
    // this device at all (a deleted job) is still this account's receivable,
    // exactly as it was before; only a KNOWN other-company job's invoices go.
    const theirs = new Set(projects.filter(p => !isOwnCompanyProject(p, userId)).map(p => p.id));
    return allInvoices.filter(inv => !theirs.has(inv.projectId));
  }, [projects, allInvoices, userId]);
  // Two counts, because the two reports keep different populations: the WIP
  // schedule leaves closed jobs off entirely (so a closed shared job is not
  // "left out" of it), while the Profit report keeps closed jobs — so a closed
  // job another company shared with him IS excluded from Profit and has to be
  // counted in its "Not on this report" line (integration review, wave 5).
  const sharedJobCount = useMemo(
    () => projects.filter(p => p.status !== 'closed' && !isOwnCompanyProject(p, userId)).length,
    [projects, userId],
  );
  const sharedJobCountAll = useMemo(
    () => projects.filter(p => !isOwnCompanyProject(p, userId)).length,
    [projects, userId],
  );

  // AIA pay applications: the contract chain and billed-to-date both read them
  // (axes 5 and 6). Without them a GC billing through G702/G703 read $0 billed
  // on this tab while /wip-report read the real figure.
  const wip    = useMemo(() => computeWIPReport(ownProjects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries), [ownProjects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries]);
  const profit = useMemo(() => computeProfitReport(ownProjects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries), [ownProjects, invoices, changeOrders, commitments, costSources, aiaPayApps, etcEntries]);
  const aging  = useMemo(() => computeARAgingReport(invoices, ownProjects), [invoices, ownProjects]);

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
    if (nothingToExport) { showAlert('Nothing to Report Yet', blockedReason); return; }
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
      // The success haptic above is only reached when the share RESOLVED. On
      // the web a blocked pop-up now throws (utils/platformFile.openPrint-
      // WindowOrThrow, #147) instead of doing nothing and buzzing "done", and
      // pdfFailureMessage lets that one sentence — "allow pop-ups" — through
      // while any other failure keeps this screen's own wording.
      showAlert('Couldn’t Generate PDF', pdfFailureMessage(err, 'Couldn’t generate the PDF. Try again.'));
    } finally {
      setGenerating(false);
    }
  }, [tab, wip, profit, aging, branding, wipUnlocked, nothingToExport, blockedReason]);

  const handleCopyCsv = useCallback(async () => {
    if (tab === 'wip' && !wipUnlocked) return; // WIP CSV is Business-gated
    if (nothingToExport) { showAlert('Nothing to Report Yet', blockedReason); return; }
    const csv = tab === 'wip' ? wipReportToCSV(wip)
              : tab === 'aging' ? arAgingReportToCSV(aging)
              : ''; // profit doesn't ship a CSV — it's tiny + the PDF is the deliverable
    if (!csv) return;
    // A FILE FIRST, THE CLIPBOARD ONLY AS A FALLBACK — F18 (audit 2026-09-11).
    // This was clipboard-only while the PDF button beside it has handed a
    // document to the share sheet since it shipped. On a phone the clipboard
    // reaches nothing: the GC's next move after "Copy CSV" is to email the
    // schedule to his bookkeeper, and there is no attachment to email. The
    // flagship /wip-report screen was fixed in the same audit; this is the
    // identical defect one sidebar row away, on the SAME WIP schedule.
    //
    // The file name and the share-sheet title travel as ONE named document
    // (utils/financialReports.reportCsvDocument) rather than as two positional
    // strings: the verifier transposed them here with every guard green, and
    // the attachment would have shipped as "WIP Schedule 2026-08-31" with no
    // .csv extension. There is now no order to get wrong.
    const doc = reportCsvDocument(tab === 'wip' ? 'wip' : 'aging', tab === 'wip' ? wip.asOf : aging.asOf);
    try {
      const delivered = await shareReportCsv(doc, csv);
      if (delivered !== 'unavailable') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // 'downloaded' already reached the user and 'shared' opened the share
        // sheet; an alert on top of either is noise. Only the fallback speaks.
        return;
      }
    } catch {
      // A failed write must not silently become a successful copy without the
      // reader being told which one happened — fall through and say so.
    }
    const ok = await copyToClipboard(csv);
    if (ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'CSV Copied' : 'Couldn’t Export CSV',
      ok
        ? "This device couldn't hand over a file, so the schedule is on your clipboard. Paste it "
          + 'into Excel, QuickBooks or Sage.'
        : "Couldn't save or copy the CSV.",
    );
  }, [tab, wip, aging, wipUnlocked, nothingToExport, blockedReason]);

  // WIP tab selected but tier doesn't unlock it → full-screen Paywall,
  // mirroring app/wip-report.tsx. The report chrome (data, PDF, CSV) never
  // renders, so the Business-only deliverable stays behind the gate.
  const wipLocked = tab === 'wip' && !wipUnlocked;

  // THE HEADER'S PRINT AND EXPORT CSV (desktop — contract D18). Object form:
  // the bottom bar keeps the one JSX press per export handler that
  // validate-wip's pinButton counts. Print runs the same PDF path as that bar
  // (on the web: the print preview), synchronously inside the click so the
  // pop-up keeps its user activation. Export CSV is left out on Profit, which
  // ships no CSV. A blocked action stays visible and says why.
  const toolbarBlockedReason = nothingToExport ? blockedReason : (wipLocked ? WIP_LOCKED_REASON : null);
  const toolbar = useMemo((): ToolbarAction[] => [
    printToolbarAction({
      onPrint: () => { void handleSharePdf(); },
      blockedReason: toolbarBlockedReason,
      testID: 'reports-print',
    }),
    ...(tab === 'profit' ? [] : [{
      key: 'csv',
      label: 'Export CSV',
      icon: FileSpreadsheet,
      onPress: () => { void handleCopyCsv(); },
      disabled: !!toolbarBlockedReason,
      disabledReason: toolbarBlockedReason,
      testID: 'reports-toolbar-csv',
    }]),
  ], [handleSharePdf, handleCopyCsv, toolbarBlockedReason, tab]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Financial Reports</Text>
          <Text style={styles.title}>Reports for Your Bank</Text>
        </View>
        {isDesktop && <ToolbarActions actions={toolbar} testID="reports-toolbar" />}
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, isDesktop && segmentedDesktop.container]}>
        <TabBtn label="WIP"      icon={ClipboardList} active={tab === 'wip'}    onPress={() => setTab('wip')} />
        <TabBtn label="Profit"   icon={TrendingUp}    active={tab === 'profit'} onPress={() => setTab('profit')} />
        <TabBtn label="A/R Aging" icon={AlertTriangle} active={tab === 'aging'}  onPress={() => setTab('aging')} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {/* Centered icon-circle hero — matches the new design language so
            Reports reads as a sibling of the AI-feature screens. On desktop
            web it only repeated the header's title above the report, so it
            goes there. */}
        {isDesktopWeb ? null : (
        <View style={styles.reportsHero}>
          <View style={styles.reportsHeroIcon}>
            <TrendingUp size={26} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.reportsHeroTitle}>Reports for Your Bank</Text>
          <Text style={styles.reportsHeroSub}>
            WIP, profit margin, and A/R aging, compiled across every project. Export to CSV or PDF in one tap.
          </Text>
        </View>
        )}

        {tab === 'wip' && !wipLocked && <WIPView    report={wip} sharedJobCount={sharedJobCount} />}
        {tab === 'profit'               && <ProfitView profit={profit} sharedJobCount={sharedJobCountAll} />}
        {tab === 'aging'                && (
          <AgingView
            report={aging}
            anyIssued={issuedInvoices > 0}
            // Every aging row is "record this check" or "send a reminder" —
            // both live on the invoice screen, so the row opens it. Same
            // navigation as app/payment-predictions.tsx openInvoice.
            onOpenInvoice={(r) => router.push({
              pathname: '/invoice' as never,
              params: { projectId: r.projectId, invoiceId: r.invoiceId } as never,
            })}
          />
        )}
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
      <View style={[styles.actionBarWrap, { paddingBottom: insets.bottom + 12 }]} {...(Platform.OS === 'web' ? ({ dataSet: { print: 'hide' } } as object) : {})}>
      {/* A blocked button says why, VISIBLY — the repo's own pattern
          (app/cash-flow.tsx:1157). The empty guard lives inside the tab body
          and these controls live out here, so without this line the buttons
          were the only thing contradicting the EmptyState above them. */}
      {nothingToExport ? (
        <Text style={styles.blockedNote} testID="reports-export-blocked">{blockedReason}</Text>
      ) : null}
      <ActionBar style={styles.actionBar} width="dashboard">
        {tab !== 'profit' && (
          <TouchableOpacity
            style={[styles.actionBtnSecondary, nothingToExport && styles.actionBtnBlocked]}
            onPress={handleCopyCsv}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: nothingToExport }}
            accessibilityHint={nothingToExport ? blockedReason : undefined}
          >
            {/* A SPREADSHEET, NOT A CLIPBOARD (F18). The action hands over a
                .csv file now and only falls back to copying when the platform
                has no way to deliver one, so a copy icon labelled "Copy CSV"
                would be describing the fallback as the behaviour. */}
            <FileSpreadsheet size={14} color={nothingToExport ? themeColors.textMuted : themeColors.text} strokeWidth={1.75} />
            <Text style={[styles.actionBtnSecondaryText, nothingToExport && { color: themeColors.textMuted }]}>Export CSV</Text>
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
                {Platform.OS === 'web' ? 'Open PDF Preview' : 'Download and Share PDF'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ActionBar>
      </View>
      )}
    </View>
  );
}

function TabBtn({ label, icon: Icon, active, onPress }: { label: string; icon: typeof TrendingUp; active: boolean; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isDesktop = useIsDesktop();
  return (
    <TouchableOpacity style={[styles.tabBtn, isDesktop && segmentedDesktop.segment, active && styles.tabBtnActive]} onPress={onPress} activeOpacity={0.85}>
      <Icon size={14} color={active ? themeColors.accent : themeColors.textMuted} />
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── WIP view ────────────────────────────────────────────────────────

/**
 * What a report LEFT OUT, in one sentence (#18 / #19, audit 2026-09-22). The
 * population rule now drops another company's shared jobs and unsigned bids,
 * and a job must never vanish from a bank document without a word — the totals
 * got smaller, and this is the line that says why. '' when nothing was left out.
 */
function reportExclusionLine(
  shared: number,
  unsigned: number,
  unsignedContract: number,
): string {
  const parts: string[] = [];
  if (shared > 0) {
    parts.push(`${shared} ${shared === 1 ? 'project' : 'projects'} shared with you by another company `
      + `(${shared === 1 ? 'its' : 'their'} contract, not yours)`);
  }
  if (unsigned > 0) {
    parts.push(`${unsigned} unsigned bid${unsigned === 1 ? '' : 's'} (${formatMoney(unsignedContract, 2)}): `
      + 'pipeline, not backlog. A bid joins once it is invoiced, billed on a pay app, has an approved '
      + 'change order or a signed subcontract, or has cost recorded against it');
  }
  return parts.length ? `Not on this report: ${parts.join('; ')}.` : '';
}

type WIPReportRow = ReturnType<typeof computeWIPReport>['rows'][number];

function WIPView({ report, sharedJobCount }: { report: ReturnType<typeof computeWIPReport>; sharedJobCount: number }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const exclusion = reportExclusionLine(
    sharedJobCount, report.excluded?.unsigned ?? 0, report.excluded?.unsignedContract ?? 0,
  );
  // Desktop: the WIP schedule as a table. Every cell is the engine field the
  // row card and the CSV print (utils/dashboardTables.reportsWipCells); the
  // totals row is the CSV's own TOTAL line (reportsWipFooter), never a sum of
  // the visible rows. A margin cell goes through marginCellText only.
  const wipColumns: DataTableColumn<WIPReportRow>[] = [
    { key: 'job', label: 'Project', flex: 1, minWidth: 180, sortValue: (r) => r.projectName, value: (r) => r.projectName },
    { key: 'contract', label: 'Revised Contract', width: 110, numeric: true, sortValue: (r) => reportsWipCells(r).contract, value: (r) => formatMoney(reportsWipCells(r).contract) },
    { key: 'estFinal', label: 'Est. Final Cost', width: 110, numeric: true, hideBelow: 1050, sortValue: (r) => reportsWipCells(r).estFinal, value: (r) => formatMoney(reportsWipCells(r).estFinal) },
    {
      key: 'costToDate', label: 'Cost to Date', width: 110, numeric: true,
      sortValue: (r) => reportsWipCells(r).costToDate,
      // Unknown prints '—' (the table's own unknown cell), never $0.
      value: (r) => { const c = reportsWipCells(r).costToDate; return c == null ? null : formatMoney(c); },
    },
    { key: 'pct', label: '% complete', width: 64, numeric: true, sortValue: (r) => reportsWipCells(r).pctComplete, value: (r) => `${reportsWipCells(r).pctComplete.toFixed(0)}%` },
    { key: 'earned', label: 'Earned', width: 110, numeric: true, sortValue: (r) => reportsWipCells(r).earned, value: (r) => formatMoney(reportsWipCells(r).earned) },
    { key: 'billed', label: 'Billed', width: 110, numeric: true, sortValue: (r) => reportsWipCells(r).billed, value: (r) => formatMoney(reportsWipCells(r).billed) },
    {
      key: 'billing', label: 'Billing', width: 130, numeric: true,
      sortValue: (r) => { const b = reportsWipCells(r).billing; return b.kind === 'over' ? b.amount : b.kind === 'under' ? -b.amount : 0; },
      render: (r) => {
        const b = reportsWipCells(r).billing;
        return (
          <Text style={[styles.tableCellText, b.kind === 'even' && { color: themeColors.textMuted }]} numberOfLines={1}>
            {b.kind === 'over' ? `Over ${formatMoney(b.amount)}` : b.kind === 'under' ? `Under ${formatMoney(b.amount)}` : 'On Earned Value'}
          </Text>
        );
      },
    },
    { key: 'retainage', label: 'Retainage', width: 100, numeric: true, hideBelow: 1150, sortValue: (r) => reportsWipCells(r).retainage, value: (r) => formatMoney(reportsWipCells(r).retainage) },
    {
      key: 'margin', label: 'Margin', width: 80, numeric: true,
      sortValue: (r) => reportsWipCells(r).margin,
      render: (r) => {
        const m = reportsWipCells(r).margin;
        return m == null
          ? <Text style={[styles.tableCellText, { color: themeColors.textMuted }]} numberOfLines={1}>No Cost Basis</Text>
          : <Text style={[styles.tableCellText, marginTextTone(m, themeColors)]} numberOfLines={1}>{marginCellText(m)}</Text>;
      },
    },
  ];
  const wipFoot = reportsWipFooter(report.totals);
  if (report.rows.length === 0) {
    return (
      <>
        <EmptyState icon={ClipboardList} title="No Active Projects" body="The WIP report covers your own signed, active projects. Add or activate a project to fill it in." />
        {exclusion ? <Text style={styles.basisLine} testID="wip-excluded">{exclusion}</Text> : null}
      </>
    );
  }
  return (
    <>
      {/* Portfolio header */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <Text style={styles.summaryEyebrow}>WIP TOTAL · {report.rows.length} project{report.rows.length === 1 ? '' : 's'}</Text>
        </View>
        <TileGrid preset="kpi" phoneStyle={styles.summaryGrid}>
          <SummaryStat label="Revised Contract" value={formatMoney(report.totals.revisedContract)} accent={themeColors.text} />
          <SummaryStat label="Billed"            value={formatMoney(report.totals.billedToDate)} accent={themeColors.text} />
          <SummaryStat label="Retainage Held"    value={formatMoney(report.totals.retainageHeld)} accent={Colors.warning} />
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
            label="Projected Profit"
            value={formatMoney(report.totals.measurableProjectedProfit)}
            accent={report.totals.measurableProjectedProfit >= 0 ? themeColors.success : themeColors.danger}
          />
        </TileGrid>
        {/* …and the exclusion is NAMED. Suppressing a figure without saying it
            was suppressed is its own quiet lie, and both exports already carry
            this sentence. */}
        {report.totals.noCostBasisCount > 0 ? (
          <Text style={styles.basisLine} testID="wip-no-cost-basis">
            {`Measured on the projects that have a cost basis. ${report.totals.noCostBasisCount} contract`
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
        {exclusion ? <Text style={styles.basisLine} testID="wip-excluded">{exclusion}</Text> : null}
      </View>

      <DataTable
        tableId="reports-wip"
        testID="reports-wip"
        columns={wipColumns}
        rows={report.rows}
        rowKey={(r) => r.projectId}
        footerTotals={{
          job: 'Total',
          contract: formatMoney(wipFoot.revisedContract),
          estFinal: formatMoney(wipFoot.estimatedFinalCost),
          costToDate: formatMoney(wipFoot.costToDate),
          earned: formatMoney(wipFoot.earnedRevenue),
          billed: formatMoney(wipFoot.billedToDate),
          // Over and under each on their own line, as the CSV's two columns —
          // a WIP total never nets one against the other.
          billing: (
            <View style={styles.tableCellEnd}>
              {wipFoot.overbilled > 0 ? <Text style={styles.tableFootText}>{`Over ${formatMoney(wipFoot.overbilled)}`}</Text> : null}
              {wipFoot.unbilled > 0 ? <Text style={styles.tableFootText}>{`Under ${formatMoney(wipFoot.unbilled)}`}</Text> : null}
              {wipFoot.overbilled > 0 || wipFoot.unbilled > 0 ? null : <Text style={[styles.tableFootText, { color: themeColors.textMuted }]}>On earned value</Text>}
            </View>
          ),
          retainage: formatMoney(wipFoot.retainageHeld),
          // Struck on the measurable jobs, like the CSV TOTAL; unmeasured → '—'.
          margin: wipFoot.measurable ? marginCellText(wipFoot.projectedMargin) : null,
        }}
        renderCard={r => (
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
                <Text style={[styles.marginPillText, styles.marginPillNoneText]}>No Cost Basis</Text>
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
        )}
      />
    </>
  );
}

// ─── Profit view ─────────────────────────────────────────────────────

type ProfitReportRow = ReturnType<typeof computeProfitReport>['rows'][number];

/** The health dot's word, from the band legend above the rows. */
const HEALTH_WORD: Record<ProfitReportRow['health'], string> = { green: 'Good', yellow: 'Watch', red: 'Risk' };

function ProfitView({ profit, sharedJobCount }: { profit: ReturnType<typeof computeProfitReport>; sharedJobCount: number }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const exclusion = reportExclusionLine(sharedJobCount, profit.excluded.unsigned, profit.excluded.unsignedContract);
  // Desktop: the running margins as a table (utils/dashboardTables.profitCells).
  // Its totals are the two headline figures only — profit and margin, both
  // struck on the measurable jobs. Revenue carries no total on purpose.
  const profitColumns: DataTableColumn<ProfitReportRow>[] = [
    {
      key: 'job', label: 'Project', flex: 1, minWidth: 180, sortValue: (r) => r.projectName,
      render: (r) => (
        <View style={styles.tableJobCell}>
          <View style={[styles.healthDot, healthTone(r.health, themeColors)]} />
          <Text style={styles.tableJobText} numberOfLines={1}>{r.projectName}</Text>
        </View>
      ),
    },
    { key: 'revenue', label: 'Revenue', width: 110, numeric: true, sortValue: (r) => profitCells(r).revenue, value: (r) => formatMoney(profitCells(r).revenue) },
    { key: 'costToDate', label: 'Cost to Date', width: 110, numeric: true, sortValue: (r) => profitCells(r).costToDate, value: (r) => formatMoney(profitCells(r).costToDate) },
    { key: 'estFinal', label: 'Est. Final Cost', width: 110, numeric: true, sortValue: (r) => profitCells(r).estFinal, value: (r) => formatMoney(profitCells(r).estFinal) },
    {
      key: 'projectedProfit', label: 'Projected Profit', width: 120, numeric: true,
      sortValue: (r) => profitCells(r).profit,
      render: (r) => {
        const p = profitCells(r).profit;
        return p == null
          ? <Text style={[styles.tableCellText, { color: themeColors.textMuted }]}>—</Text>
          : <Text style={[styles.tableCellText, { color: p >= 0 ? themeColors.success : themeColors.danger }]} numberOfLines={1}>{formatMoney(p)}</Text>;
      },
    },
    {
      key: 'margin', label: 'Margin', width: 80, numeric: true,
      sortValue: (r) => profitCells(r).margin,
      render: (r) => {
        const m = profitCells(r).margin;
        return m == null
          ? <Text style={[styles.tableCellText, { color: themeColors.textMuted }]} numberOfLines={1}>No Cost Basis</Text>
          : <Text style={[styles.tableCellText, marginTextTone(m, themeColors)]} numberOfLines={1}>{marginCellText(m)}</Text>;
      },
    },
    { key: 'health', label: 'Health', width: 90, sortValue: (r) => r.health, value: (r) => HEALTH_WORD[profitCells(r).health] },
  ];
  const profitFoot = profitFooter(profit);
  if (profit.rows.length === 0) {
    return (
      <>
        <EmptyState icon={TrendingUp} title="No Projects Yet" body="Live margins across your own signed projects show here. Add a project to see them." />
        {exclusion ? <Text style={styles.basisLine} testID="profit-excluded">{exclusion}</Text> : null}
      </>
    );
  }
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>Running Portfolio Margin</Text>
        <View style={styles.profitHero}>
          <Text style={styles.profitHeroAmount}>{formatMoney(profit.totalProfit)}</Text>
          <Text style={[styles.profitHeroPct, marginTextTone(profit.weightedMargin, themeColors)]}>
            {profit.weightedMargin.toFixed(1)}% margin
          </Text>
        </View>
        <Text style={styles.profitHeroSub}>
          on {formatMoney(profit.measurableRevenue)} of revised contract value
          {profit.noCostBasisCount > 0
            ? `. ${profit.noCostBasisCount} project${profit.noCostBasisCount === 1 ? '' : 's'} worth `
              + `${formatMoney(profit.noCostBasisRevenue)} excluded, because a contract with no cost `
              + 'estimate, no signed commitment and nothing spent has no measurable margin'
            : ''}
        </Text>
        {/* Same basis line as the WIP tab, from the same helper — this is the
            tab a sub-Business user lands on, so it is the one that most needs
            to say what it measured against. */}
        <CostBasisLine rows={profit.rows} />
        {exclusion ? <Text style={styles.basisLine} testID="profit-excluded">{exclusion}</Text> : null}
      </View>

      <View style={styles.bandRow}>
        <Band color={themeColors.success} label=" ≥ 12% (good)" />
        <Band color={Colors.warningLabel} label=" 5–11% (watch)" />
        <Band color={themeColors.danger}   label=" < 5% (risk)" />
      </View>

      <DataTable
        tableId="reports-profit"
        testID="reports-profit"
        columns={profitColumns}
        rows={profit.rows}
        rowKey={(r) => r.projectId}
        footerTotals={{
          job: 'Portfolio',
          projectedProfit: profitFoot.projectedProfit == null ? null : formatMoney(profitFoot.projectedProfit),
          margin: profitFoot.margin == null ? null : marginCellText(profitFoot.margin),
        }}
        renderCard={r => (
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
                <Text style={[styles.marginPillText, styles.marginPillNoneText]}>No Cost Basis</Text>
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
              No cost estimate, no signed commitment and nothing spent on this project, so there is no
              margin to measure. It is excluded from the portfolio profit and margin above.
            </Text>
          )}
        </View>
        )}
      />
    </>
  );
}

// ─── AR Aging view ───────────────────────────────────────────────────

function AgingView({ report, anyIssued, onOpenInvoice }: {
  report: ARAgingReport;
  anyIssued: boolean;
  onOpenInvoice: (row: ARAgingReport['rows'][number]) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Desktop: the open invoices as a worklist table (utils/dashboardTables.
  // agingCells — the card's own words and inks). Each row is a real link to
  // its invoice (Cmd-click opens a new tab); a plain click opens it in place,
  // through the same callback the card uses.
  const agingColumns: DataTableColumn<ARAgingReport['rows'][number]>[] = [
    { key: 'invoiceNumber', label: 'Invoice #', width: 70, sortValue: (r) => agingCells(r).invoiceNumber, value: (r) => `#${agingCells(r).invoiceNumber}` },
    { key: 'job', label: 'Project', flex: 1, minWidth: 160, sortValue: (r) => agingCells(r).job, value: (r) => agingCells(r).job },
    { key: 'issued', label: 'Issued', width: 96, hideBelow: 1100, sortValue: (r) => agingCells(r).issued, value: (r) => new Date(r.issueDate).toLocaleDateString() },
    { key: 'due', label: 'Due', width: 96, sortValue: (r) => agingCells(r).due, value: (r) => new Date(r.dueDate).toLocaleDateString() },
    { key: 'total', label: 'Total', width: 110, numeric: true, sortValue: (r) => agingCells(r).total, value: (r) => formatMoney(agingCells(r).total) },
    { key: 'paid', label: 'Paid', width: 110, numeric: true, hideBelow: 1050, sortValue: (r) => agingCells(r).paid, value: (r) => formatMoney(agingCells(r).paid) },
    { key: 'retainage', label: 'Retainage', width: 100, numeric: true, sortValue: (r) => agingCells(r).retainage, value: (r) => formatMoney(agingCells(r).retainage) },
    {
      key: 'outstanding', label: 'Outstanding', width: 120, numeric: true,
      sortValue: (r) => agingCells(r).outstanding,
      render: (r) => {
        const c = agingCells(r);
        return (
          <Text
            style={[styles.tableCellText, c.late && { color: themeColors.danger }, c.retainageOnly && { color: themeColors.textMuted }]}
            numberOfLines={1}
          >
            {formatMoney(c.outstanding)}
          </Text>
        );
      },
    },
    { key: 'daysPastDue', label: 'Days Past Due', width: 72, numeric: true, sortValue: (r) => agingCells(r).daysPastDue, value: (r) => agingCells(r).daysPastDue },
    {
      key: 'bucket', label: 'Bucket', width: 110,
      render: (r) => {
        const c = agingCells(r);
        const pill = c.bucketTone === 'muted' ? styles.bucketPillMuted : c.bucketTone === 'warn' ? styles.bucketPillWarn : styles.bucketPillBad;
        return (
          <View style={[styles.bucketPill, pill]}>
            <Text style={styles.bucketPillText} numberOfLines={1}>{c.bucketWord}</Text>
          </View>
        );
      },
    },
  ];
  const agingFoot = agingFooter(report.totals);
  if (report.rows.length === 0) {
    // "Every invoice is fully paid. Nice work." was printed on an account with
    // NO invoices at all — a success verdict computed from absent data, on the
    // screen that answers "who owes me money". Aging can only be empty two
    // ways, and they are not the same news, so say which one this is.
    const collected = anyIssued;
    return <EmptyState
      icon={collected ? CheckCircle2 : FileText}
      title={collected ? 'Nothing Outstanding' : 'No Invoices Yet'}
      body={collected
        ? 'Every invoice you have sent is collected in full. Nothing is aging.'
        : 'A/R aging buckets the invoices a client still owes you. Issue one from a project and it lands here the day it is sent. A draft owes you nothing, so it is not counted.'}
      tone={collected ? 'good' : undefined}
    />;
  }
  // RETAINAGE IS A RECEIVABLE, AND IT WAS NOWHERE ON THIS TAB (#102, audit
  // 2026-09-22). The engine keeps a settled invoice that still HOLDS retention
  // on the list on purpose ("disclosed under Retainage Held"), carries the
  // figure per row and in the totals — and this view printed neither. A
  // $110,000 invoice with 10% held and $99,000 paid read "Outstanding $0" in
  // danger red, "Current", counted as an outstanding invoice, with no mention
  // of the $11,000 the owner still owes at closeout. The same $0.50 floor
  // computeARAgingReport applies decides "collectible" here, so the screen,
  // the PDF and the CSV agree on which rows are retainage-only.
  const collectible = report.rows.filter(r => r.outstanding > 0.5).length;
  const retainageOnly = report.rows.length - collectible;
  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryEyebrow}>
          OUTSTANDING · {collectible} invoice{collectible === 1 ? '' : 's'}
          {retainageOnly > 0 ? ` · ${retainageOnly} retainage-only` : ''}
        </Text>
        <Text style={styles.agingHeroAmount}>{formatMoney(report.totals.totalOutstanding)}</Text>
        {report.totals.retainageHeld > 0.5 ? (
          <Text style={styles.agingHeroSub} testID="aging-retainage-held">
            {`Plus ${formatMoney(report.totals.retainageHeld)} retainage held until closeout: a receivable, not aged.`}
          </Text>
        ) : null}
        <View style={styles.bucketRow}>
          <Bucket label="Current" value={report.totals.current}     tone="muted" />
          <Bucket label="0–30"    value={report.totals['0-30']}      tone="warn" />
          <Bucket label="31–60"   value={report.totals['31-60']}     tone="warn" />
          <Bucket label="61–90"   value={report.totals['61-90']}     tone="bad" />
          <Bucket label="90+"     value={report.totals['90+']}       tone="bad" />
        </View>
      </View>

      <DataTable
        tableId="reports-aging"
        testID="reports-aging"
        columns={agingColumns}
        rows={report.rows}
        rowKey={(r) => r.invoiceId}
        onRowOpen={onOpenInvoice}
        getRowHref={(r) => routeHref('/invoice', { projectId: r.projectId, invoiceId: r.invoiceId })}
        defaultSort={{ key: 'daysPastDue', dir: 'desc' }}
        footerTotals={{
          job: 'Total',
          retainage: formatMoney(agingFoot.retainage),
          outstanding: formatMoney(agingFoot.outstanding),
        }}
        renderCard={r => {
        const isRetainageOnly = r.outstanding <= 0.5;
        // Danger ink only for money that is actually LATE. A current balance is
        // not in danger, and a retainage-only row owes nothing collectible.
        const outstandingLate = r.outstanding > 0.5 && r.bucket !== 'current';
        const bucketStyle =
          isRetainageOnly           ? styles.bucketPillMuted :
          r.bucket === 'current'    ? styles.bucketPillMuted :
          r.bucket === '0-30'       ? styles.bucketPillWarn :
          r.bucket === '31-60'      ? styles.bucketPillWarn :
                                      styles.bucketPillBad;
        const heldSpoken = r.retainageHeld > 0.5
          ? `, ${formatMoney(r.retainageHeld, 2)} retainage held to closeout`
          : '';
        return (
          // A worklist, not a printout: the row opens the invoice, where Mark
          // Paid, the pay link and Send already live. No inline duplicates of
          // those actions here — one place to act on an invoice.
          <TouchableOpacity
            key={r.invoiceId}
            style={[styles.row, Platform.OS === 'web' && styles.rowLinkWeb]}
            onPress={() => onOpenInvoice(r)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Open invoice ${r.invoiceNumber} for ${r.projectName}, ${formatMoney(r.outstanding, 2)} outstanding${heldSpoken}`}
            testID={`aging-row-${r.invoiceId}`}
          >
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>#{r.invoiceNumber} · {r.projectName}</Text>
              <View style={[styles.bucketPill, bucketStyle]}>
                <Text style={styles.bucketPillText}>
                  {isRetainageOnly ? 'Retainage Only' : r.bucket === 'current' ? 'Current' : `${r.daysPastDue}d past due`}
                </Text>
              </View>
              <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </View>
            <View style={styles.kvGrid}>
              <KV k="Issued"       v={new Date(r.issueDate).toLocaleDateString()} />
              <KV k="Due"          v={new Date(r.dueDate).toLocaleDateString()} />
              <KV k="Total due"    v={formatMoney(r.totalDue)} />
              <KV k="Paid"         v={formatMoney(r.amountPaid)} />
              {/* Total − Paid − Retainage held = Outstanding: the row foots, the
                  way the CSV and the PDF foot. */}
              <KV k="Retainage held" v={formatMoney(r.retainageHeld)} muted={r.retainageHeld <= 0.5} />
              <KV k="Outstanding"  v={formatMoney(r.outstanding)} bold
                  tone={outstandingLate ? 'bad' : undefined} muted={isRetainageOnly} />
            </View>
          </TouchableOpacity>
        );
        }}
      />
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

function SummaryStat({ label, value, accent, style }: { label: string; value: string; accent?: string; style?: StyleProp<ViewStyle> }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // `style` is what TileGrid clones onto each tile on desktop (the computed
  // column width); undefined on a phone, so the tile is today's 47% item.
  return (
    <View style={[styles.summaryStatItem, style]}>
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
  agingHeroSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 17 },
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
  // Web only: the aging row is a link, so it should look like one under the
  // mouse. (cursor is a react-native-web style key, not in RN's types.)
  rowLinkWeb: { cursor: 'pointer' } as object,
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

  // The desktop tables' own cells (drawn only inside a desktop DataTable).
  tableCellText: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontVariant: ['tabular-nums'], textAlign: 'right' },
  tableFootText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, fontVariant: ['tabular-nums'], textAlign: 'right' },
  tableCellEnd: { alignItems: 'flex-end', gap: 2 },
  tableJobCell: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  tableJobText: { fontSize: Type.bodyCompact.fontSize, color: t.text, flexShrink: 1 },
});
