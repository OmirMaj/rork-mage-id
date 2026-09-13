import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, ActivityIndicator, Modal,
  type LayoutChangeEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, useBrainFabLift } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Info, Printer, Check, Save,
  ShieldAlert, CheckCircle2, Lock, Pencil, Plus, Trash2, ChevronUp, ChevronDown,
  RefreshCw, Stamp, PackageCheck,
} from 'lucide-react-native';
import { MagePayApp } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';
import {
  AIAPayApplication,
  AIASOVLine,
  seedAIAPayApplicationFromInvoice,
  computeAIATotals,
  generateAIAPayAppPDF,
  retainagePercentForInvoice,
  reconcileAIASov,
  carryForwardPriorLines,
  nextApplicationNumber,
  selectPriorApplication,
  splitApprovedCOsByPeriod,
  summarizeChangeOrders,
  findOverBilledLines,
  storedRetainagePercentForApp,
  installStoredMaterialOnLine,
  newSovLine,
  moveSovLine,
  renumberSovLines,
  roundCents,
  // Screen logic that used to be inline and therefore only greppable. See the
  // "THE SCREEN'S OWN LOGIC, LIFTED OUT WHERE IT CAN BE EXECUTED" section in
  // utils/aiaBilling.ts for why: an adversarial review reinstated the column-F
  // blocker inside the two inline line mappers and every guard stayed green.
  applicationFromSavedRecord,
  sovLineToSaved,
  payAppEditability,
  lineOverBill,
  applyApprovedCOsToApplication,
  mergeRefreshedContract,
  isCalendarDay,
  claimInitKey,
  sovLineDeletionRefusal,
  totalOverBill,
  payAppReviewNotice,
  coFiguresAdvice,
  resolveSovBasis,
} from '@/utils/aiaBilling';
// The one definition of "what is still owed on this invoice", net of held
// retention — the same helper the portal and the invoice screen gate their Pay
// buttons on, so the pay application cannot disagree with them about whether
// the period has been collected.
import { invoiceOutstanding } from '@/utils/invoiceBilling';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { RevenueEarlyAccessCard } from '@/components/RevenueEarlyAccessCard';
import { Banknote, FileSignature } from 'lucide-react-native';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { useAuth } from '@/contexts/AuthContext';
import { createPaymentLink } from '@/utils/stripe';
import { fetchStripeConnectStatus } from '@/utils/stripeConnect';
import type { SavedAIAPayApp } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { showAlert } from '@/utils/alert';

export default function AIAPayAppScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { tier } = useSubscription();
  const { colors: themeColors } = useTheme();
  if (!canAccess('aia_pay_app')) {
    return (
      <Paywall
        visible={true}
        feature="AIA G702/G703 Pay Applications"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <AIAPayAppScreenInner />;
}

function AIAPayAppScreenInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // The sticky bar below is position:absolute, so bottom padding cannot clear
  // it — measure it and lift the FAB by its height instead.
  const [bottomBarH, setBottomBarH] = useState(0);
  const onBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBottomBarH(e.nativeEvent.layout.height);
  }, []);
  useBrainFabLift(bottomBarH);
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useSubscription();
  // This screen is INVOICE-keyed: a G702/G703 certifies one billing period, and
  // the period is the progress invoice. Opened from the sidebar (FINANCIALS ▸
  // AIA Pay Apps), Tools or universal search there is no invoiceId, and until
  // 2026-09-07 that produced a card telling a GC with three live jobs to go
  // find an invoice himself. Now it resolves in two steps — pick the project,
  // then pick the period — and `projectId` is accepted as a param because
  // app/client-outbox.tsx:182 already links here with one.
  const { invoiceId: paramInvoiceId, projectId: paramProjectId } = useLocalSearchParams<{
    invoiceId?: string; projectId?: string;
  }>();
  const {
    invoices, getProject, getChangeOrdersForProject, settings, projects,
    addAIAPayApp, getAIAPayAppsForProject,
  } = useProjects();

  const { user } = useAuth();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [pickedInvoiceId, setPickedInvoiceId] = useState<string | null>(null);
  // Set by "Different project" on the period chooser — without it a projectId
  // in the URL would pin the screen to one job forever.
  const [forceProjectPick, setForceProjectPick] = useState(false);
  const projectId = pickedProjectId ?? paramProjectId ?? '';

  /** The project's billing periods, newest first. */
  const progressInvoices = useMemo(
    () => invoices
      .filter(i => i.projectId === projectId && i.type === 'progress')
      .sort((a, b) => b.number - a.number),
    [invoices, projectId],
  );

  const invoice = useMemo(() => {
    const named = pickedInvoiceId ?? paramInvoiceId;
    if (named) {
      const hit = invoices.find(i => i.id === named);
      if (hit) return hit;
    }
    // No period named. One progress invoice on the job is not a choice, so
    // don't make the GC tap it — open straight into the pay app.
    return progressInvoices.length === 1 ? progressInvoices[0] : undefined;
  }, [invoices, paramInvoiceId, pickedInvoiceId, progressInvoices]);

  const project = useMemo(
    () => (invoice ? getProject(invoice.projectId) : (projectId ? getProject(projectId) : undefined)),
    [invoice, projectId, getProject],
  );
  /** The URL named a project (or an invoice) that no longer exists. */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;

  const pickProject = useCallback((id: string) => {
    setPickedProjectId(id);
    setPickedInvoiceId(null);
    setForceProjectPick(false);
  }, []);
  /** Every saved pay application on this job. The sequence, the prior period,
   *  and this period's own record all come out of this one list. */
  const savedForProject = useMemo(
    () => (project ? getAIAPayAppsForProject(project.id) : []),
    [project, getAIAPayAppsForProject],
  );

  /**
   * THE SAVED RECORD FOR **THIS INVOICE**.
   *
   * This is the identity that survives a reopen, and resolving it BEFORE
   * deriving an application number is the fix for the worst defect in this
   * screen. The chain that used to run: the prior-application lookup filtered
   * out only this invoice's record, so on a five-application job reopening
   * App #2 found App #5 as "prior" and numbered itself #6; the saved-record
   * lookup then matched on applicationNumber, found nothing, and left isLocked
   * false; Save therefore MINTED A SECOND LIVE STRIPE PAYMENT LINK for money
   * already certified, wrote a phantom App #6 record, and — because
   * getAIAPayAppsForProject sorts applicationNumber descending — handed
   * payApps[0] to the WIP report's contract baseline, moving the contract
   * value on a schedule a surety reads. One reopen-and-save did all of that.
   *
   * Keyed on invoiceId, never on applicationNumber: the number is DERIVED and
   * a derived key cannot identify the record it was derived from.
   */
  const savedForThisInvoice = useMemo(
    () => (invoice ? savedForProject.find(a => a.invoiceId === invoice.id) ?? null : null),
    [savedForProject, invoice],
  );

  /** The number this period IS (reopen) or WILL BE (new period). */
  const resolvedApplicationNumber = useMemo(
    () => nextApplicationNumber(savedForProject, invoice?.id),
    [savedForProject, invoice?.id],
  );

  /**
   * PERIOD TO for the change-order filter. A saved record's own periodTo is
   * authoritative — that is the period the architect certified against, and
   * reopening it must not sweep in change orders approved two months later.
   */
  const seedPeriodTo = savedForThisInvoice?.periodTo || invoice?.issueDate;

  const [app, setApp] = useState<AIAPayApplication | null>(null);

  /**
   * ONE PERIOD END, NOT TWO.
   *
   * G702 line 2, line 3, the change-order rows on the G703, the printed
   * four-row CHANGE ORDER SUMMARY and the "held back until next period" banner
   * are five statements of a single fact, and they must all read the same
   * date. They did not: the CO split ran on `seedPeriodTo` (the saved record's
   * period end, or the INVOICE's issue date for a new application) while the
   * printed summary ran on `app.periodTo` — the field this same wave had just
   * given the GC. Using it made the certificate contradict itself on one page:
   * invoice issued 2026-04-10, PERIOD TO set back to 2026-03-31, CO #1
   * approved 2026-02-10 (+$50,000) and CO #2 approved 2026-04-05 (+$20,000)
   * printed NET CHANGE BY CHANGE ORDERS of $70,000 on line 2 and $50,000 in
   * the summary — measured by executing the shipped functions, not inferred.
   */
  const effectivePeriodTo = app?.periodTo || seedPeriodTo;

  const coSplit = useMemo(
    () => (invoice && project
      ? splitApprovedCOsByPeriod(getChangeOrdersForProject(project.id), effectivePeriodTo)
      : { inPeriod: [], afterPeriod: [] }),
    [invoice, project, getChangeOrdersForProject, effectivePeriodTo],
  );
  // G702 line 2 is the net change approved THROUGH the end of this period.
  const approvedCOs = coSplit.inPeriod;
  const [generating, setGenerating] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showFirstUseDisclaimer, setShowFirstUseDisclaimer] = useState(false);
  const [showPreExportConfirm, setShowPreExportConfirm] = useState(false);

  // First-time user notice — explains AIA trademark + GC responsibility.
  // Once dismissed, never shown again on this device. Stored in AsyncStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const seen = await AsyncStorage.getItem('mage_aia_disclaimer_v1');
        if (!cancelled && !seen) setShowFirstUseDisclaimer(true);
      } catch { /* ok */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismissFirstUseDisclaimer = useCallback(async () => {
    setShowFirstUseDisclaimer(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('mage_aia_disclaimer_v1', new Date().toISOString());
    } catch { /* ok */ }
  }, []);

  // Most recent saved pay app for this project that is NOT this one. Drives
  // the carry-forward affordance — every monthly AIA pay app should
  // pre-populate `fromPreviousApp` and `lessPreviousCertificates` from the
  // prior period's totals, otherwise the GC has to re-type every line's
  // billed-to-date amount each month. That's the single biggest friction
  // point GCs cite about pay-app software (Procore, Sage, Foundation
  // reviews all complain about it).
  const priorAIA = useMemo(() => {
    if (!project || !invoice) return null;
    // THE PERIOD BEFORE THIS ONE, not merely the newest record.
    //
    // The old lookup took the highest applicationNumber among everything
    // except this invoice's record, with no comparison against the period
    // being billed, so a GC who certified period #5 first and then went back
    // to do #4 carried forward FROM #5 — the LATER period's billed-through in
    // #4's column D. Selection is period-first now (see
    // selectPriorApplication for why that only became possible once PERIOD TO
    // was a field the GC fills in), falling back to the sequence so column D
    // is never silently zeroed on a job that has been billed.
    return selectPriorApplication(savedForProject, {
      excludeInvoiceId: invoice.id,
      thisApplicationNumber: resolvedApplicationNumber,
      // The period the GC has actually set, not the one this screen opened
      // with — see effectivePeriodTo. Identical at mount; different the moment
      // he corrects PERIOD TO, which is when picking the right prior period
      // starts to matter.
      thisPeriodTo: effectivePeriodTo,
    });
  }, [project, invoice, savedForProject, resolvedApplicationNumber, effectivePeriodTo]);

  const [carriedFromAppNumber, setCarriedFromAppNumber] = useState<number | null>(null);
  // MISS-05: the retainage rate on this certificate is now CARRIED from the
  // source invoice (including a real 0%) instead of falling back to an invented
  // 10%. Track whether the GC has since overridden it, so the screen can say
  // where the number on the G702 actually came from.
  const [retainageEdited, setRetainageEdited] = useState(false);
  const invoiceRetainagePct = invoice ? retainagePercentForInvoice(invoice) : 0;

  /**
   * Rebuild the editable application from the record that was SAVED for this
   * invoice. The mapping itself lives in utils/aiaBilling
   * (`applicationFromSavedRecord`) so the validator can execute it: this used
   * to be a 25-field object literal written by hand, it silently omitted
   * `sovBasis`, and a review reinstated the column-F blocker inside it without
   * turning a single guard red.
   */
  const applicationFromSaved = useCallback(
    (rec: SavedAIAPayApp): AIAPayApplication => applicationFromSavedRecord(rec),
    [],
  );

  /**
   * Seed a brand-new period from the invoice + contract + prior period.
   *
   * `periodTo` / `applicationDate` are passed through rather than left to the
   * seeder's invoice-issue-date fallback. They are identical on a first seed
   * (nothing has set them yet) and different on the refresh path, where `app`
   * carries the dates the GC typed — without them the refresh rebuilt the
   * change-order rows against the INVOICE's date while the rest of the
   * certificate spoke about his period. The seeder grew both options in this
   * same wave and neither was ever passed.
   */
  const seedFreshApplication = useCallback((): AIAPayApplication | null => {
    if (!invoice || !project || !settings?.branding) return null;
    const seeded = seedAIAPayApplicationFromInvoice(invoice, project, approvedCOs, settings.branding, {
      applicationNumber: resolvedApplicationNumber,
      periodTo: app?.periodTo || undefined,
      applicationDate: app?.applicationDate || undefined,
      // The window opens the day after the prior period closed — the same rule
      // the portal narrative already derives, believed rather than inferred
      // once it is stored.
      periodFrom: app?.periodFrom || (priorAIA?.periodTo
        ? new Date(new Date(priorAIA.periodTo).getTime() + 86400000).toISOString().slice(0, 10)
        : undefined),
    });
    if (!priorAIA || priorAIA.lines.length === 0) return seeded;
    return {
      ...seeded,
      lines: carryForwardPriorLines(seeded.lines, priorAIA.lines),
      // Line 7 is "Line 6 from prior Certificate" — the CERTIFIED figure when
      // the architect sent one back, and only the amount APPLIED FOR when he
      // did not. Seeding the requested figure over a certificate that came
      // back reduced is how a GC ends up permanently short by the difference,
      // in a number he believes is automatic.
      lessPreviousCertificates: priorAIA.amountCertified
        ?? priorAIA.totals?.totalEarnedLessRetainage
        // MONEY-F1 (client half): a record hydrated from the server can arrive
        // without `totals`; the second period must not crash on it.
        ?? 0,
      storedRetainagePercent: priorAIA.storedRetainagePercent,
    };
  }, [invoice, project, settings?.branding, approvedCOs, resolvedApplicationNumber, priorAIA,
    app?.periodTo, app?.applicationDate, app?.periodFrom]);

  /**
   * INITIALISE ONCE PER CERTIFICATE, NOT ON EVERY CONTEXT REFRESH.
   *
   * The effect below (re)builds `app` from scratch, so anything that makes it
   * re-run throws away every figure the GC has typed and not yet saved. Its
   * inputs are context callbacks whose identity changes with the underlying
   * lists — `getChangeOrdersForProject` on any change-order write,
   * `getAIAPayAppsForProject` on any pay-app write, `project` on any project
   * write, including background writes from OfflineSyncManager and from other
   * screens. So a sync landing while the GC is halfway through entering a
   * fourteen-line schedule of values used to silently reset the form under his
   * hands: pre-fix it re-derived from the invoice (the blocker above), and a
   * naive hydrate-on-change would have re-derived from the stored record
   * instead — quieter, still data loss.
   *
   * The identity of what is being edited is (this invoice, the saved record
   * backing it). That is the key. A row object replaced by a refetch keeps the
   * same id, so the editor is left alone; picking a different period, or the
   * first Save minting a record, genuinely changes what is on screen and
   * re-initialises.
   */
  const initialisedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!invoice || !project || !settings?.branding) return;
    const key = `${invoice.id}|${savedForThisInvoice?.id ?? 'new'}`;
    // Gate AND stamp in one call. As two lines here, a reviewer deleted the
    // stamp and the whole data-loss defect came back with every guard green —
    // see claimInitKey.
    if (!claimInitKey(initialisedFor, key)) return;
    setRetainageEdited(false);
    // A SAVED CERTIFICATE IS THE RECORD. Hydrate it; never re-derive over it.
    //
    // This screen used to seed from the invoice on EVERY mount and never read
    // the saved record back, so navigating away and returning silently
    // rewrote a document a bank had funded against. Column F was the worst
    // casualty — nothing in an invoice can reproduce a stored-materials figure
    // the GC typed, so it returned to zero on every line, and Generate PDF
    // (which saves) wrote the zeros over the stored record.
    if (savedForThisInvoice) {
      setApp(applicationFromSaved(savedForThisInvoice));
      setCarriedFromAppNumber(null);
      return;
    }
    const seeded = seedFreshApplication();
    if (!seeded) {
      // Nothing was built, so nothing is initialised — let the next render try.
      initialisedFor.current = null;
      return;
    }
    setApp(seeded);
    setCarriedFromAppNumber(priorAIA && priorAIA.lines.length > 0 ? priorAIA.applicationNumber : null);
  }, [invoice, project, settings?.branding, savedForThisInvoice, applicationFromSaved, seedFreshApplication, priorAIA]);

  const totals = useMemo(() => (app ? computeAIATotals(app) : null), [app]);

  // Audit 2026-09-07 ("Do next" #3). G702 line 3 (Contract Sum to Date) and the
  // G703 column C total are two statements of the same contract. When they
  // disagree, at least one number on the certificate the GC is about to sign is
  // wrong — most often because the project has no linked estimate, so the SOV
  // could only be reconstructed from this one invoice and knows nothing about
  // the scope the invoice didn't touch. Say so on the screen; do not print both
  // figures side by side and let a bank find the gap.
  const sovReconciliation = useMemo(() => (app ? reconcileAIASov(app) : null), [app]);

  // Nothing anywhere warned when a line was billed past its scheduled value.
  // Practice norm, not a printed form rule — the G703-1992 sheet states no
  // such constraint — but an architect returns a continuation sheet showing a
  // line over 100%, and the GC waits another 30-day cycle for money he has
  // already spent. Warn; never clamp the input.
  const overBilledLines = useMemo(() => (app ? findOverBilledLines(app) : []), [app]);
  // The cover can over-certify while every line reads clean (an off-contract
  // row, a CO billed before approval), and line 4 against line 3 is the first
  // comparison the architect makes.
  // Through the shared helper, not a second copy of the same subtraction.
  // `totalOverBill` was exported, documented and never called while the screen
  // re-implemented it inline — two copies of a money comparison, one of them
  // dead and unguarded.
  const totalOverBilled = useMemo(() => (app ? totalOverBill(app) : 0), [app]);

  /**
   * The four-row CHANGE ORDER SUMMARY the printed G702 carries.
   *
   * Driven from `effectivePeriodTo`, the SAME date the CO split and G702 line
   * 2 use. It used to read `app.periodTo` while line 2 was frozen against the
   * invoice's issue date, which is how one page could print two different NET
   * CHANGE BY CHANGE ORDERS figures.
   */
  const coSummaryForPdf = useMemo(
    () => (project
      ? summarizeChangeOrders(getChangeOrdersForProject(project.id), app?.periodFrom, effectivePeriodTo)
      : undefined),
    [project, getChangeOrdersForProject, app?.periodFrom, effectivePeriodTo],
  );

  /**
   * WHERE COLUMN C CAME FROM, and the fallback for records saved before it was
   * persisted. Hydrating a saved application left this undefined, so the
   * provenance note under the schedule of values took its else branch on EVERY
   * reopened certificate and told a GC whose job does have a linked estimate
   * to go and link one. That note is the honesty instrumentation this feature
   * is differentiated by.
   */
  const sovBasis = resolveSovBasis(app?.sovBasis, (project?.linkedEstimate?.items?.length ?? 0) > 0);

  /**
   * THE TABLE THAT ACTUALLY PRINTS — one value, named once.
   *
   * `buildAIAPayAppHtml` reads `app.changeOrderSummary` (utils/aiaBilling.ts:1696)
   * and every handoff to it — the reprint, the generate, and the record
   * `buildSavedRecord` freezes — resolved `app.changeOrderSummary ??
   * coSummaryForPdf` at its own call site. Three copies of one decision, and
   * the guard below compared a FOURTH thing: the live recompute, which is not
   * what a reopened certificate prints.
   *
   * That gap is reachable on real data. A record SAVED before the
   * `effectivePeriodTo` fix froze a summary split on `app.periodTo` next to a
   * `netChangeByCO` split on the invoice's issue date — the two-figures defect,
   * persisted. Reopening it prints both numbers, and a guard watching
   * `coSummaryForPdf` sees two figures that agree and says nothing. Comparing
   * the summary that is HANDED to the builder is the assertion that catches it.
   */
  // --- BEGIN printed co summary ---
  // Lifted and EXECUTED by scripts/validate-invoice-billing.ts. A regex can
  // see which expression is written here; only running it can show that the
  // guard watches the SAME object the print path hands the builder. Keep the
  // sentinels — the validator exits 1 if they go missing.
  const printedCoSummary = app?.changeOrderSummary ?? coSummaryForPdf;

  /** Line 2 and the summary on the same page must state one figure. */
  const coFiguresAgree = !app || !printedCoSummary
    || Math.abs(roundCents(printedCoSummary.netChange - app.netChangeByCO)) <= 0.01;
  // --- END printed co summary ---

  // Audit-2026-05-21 (#28.1 HIGH): edit-after-send lock for AIA pay-apps.
  //
  // Pre-fix this screen accepted edits at any time. After a GC tapped
  // "Generate" — which writes a SavedAIAPayApp record + auto-creates a
  // Stripe pay link for the homeowner — the screen would happily let
  // the GC change SOV percentages, retainage, or line items, then
  // re-Generate, producing a NEW PDF + a NEW pay link with different
  // numbers. The architect's already-certified copy (sealed via
  // seal-document) and the GC's live data drift, and the next period's
  // pay-app would seed from the corrupted "billed-through" totals.
  // Real audit / fraud risk on commercial projects.
  //
  // Lock signal: an existing SavedAIAPayApp at the same applicationNumber
  // AND payLinkUrl is set. payLinkUrl = pay link generated = "sent for
  // payment" = locked. Plain "save to project" (without a Stripe link,
  // e.g. GC hasn't connected Stripe) is NOT a lock event — that path is
  // a draft and stays editable.
  //
  // Once locked, the user's path forward is to create the NEXT period
  // (applicationNumber + 1) instead of editing this one. The carry-
  // forward logic in the seeding useEffect already handles this — every
  // monthly pay-app seeds from the prior one's billed-through totals.
  //
  // Defense in depth: this UI lock is now backed by a DB-level state machine.
  // Migration 20260728120000_lock_certified_aia_pay_apps.sql adds a BEFORE
  // UPDATE trigger that freezes the financial columns once pay_link_url is set,
  // so direct-API or stale-bundle edits to a certified pay-app are rejected at
  // the database — while the webhook's paid_at and the portal_state sync still
  // go through.
  //
  // 2026-09-11: the lookup is now BY INVOICE, not by application number. See
  // savedForThisInvoice above for the chain a derived key set off. The name is
  // kept because the rest of the screen reads it as "the stored record for
  // what is on screen", which is exactly what it now reliably is.
  //
  // Note on the DB half: migration 20260728120000's trigger keys on
  // `certified_at`, not on `pay_link_url` as the comment above used to say —
  // read the migration, not this comment, before relying on the server lock.
  const savedForThisAppNumber = savedForThisInvoice;
  // MONEY-F2 / F16: `paidAt` is set by the Stripe webhook and hydrated by the
  // context mapper; read defensively so an older local record reads "unpaid".
  const savedPaidAt = (savedForThisAppNumber as (SavedAIAPayApp & { paidAt?: string }) | null)?.paidAt || null;
  const isLocked = !!savedForThisAppNumber?.payLinkUrl || !!savedPaidAt;

  /**
   * REVIEW MODE — what the GC sent, as it was sent.
   *
   * Until now there was NO read-only view of a certified pay application
   * anywhere in the product. app/documents.tsx lists saved pay apps and routes
   * the tap straight back into this editor, so a GC could not look at what he
   * had submitted without the screen re-deriving it in front of him.
   *
   * So: any application that has been saved opens in review, rendering the
   * STORED record. A locked one (pay link minted, or paid) can never leave
   * review. An unsent draft can — the draft-stays-editable choice below is
   * deliberate and documented, and this preserves it — but leaving review is
   * now an explicit tap rather than something that happens by navigating.
   * That is what makes the numbering fix safe even if the numbering is ever
   * wrong again: nothing overwrites a stored certificate without the GC
   * choosing to edit it.
   */
  const [editRequested, setEditRequested] = useState(false);
  // The rule itself is a pure function so the validator can EXECUTE it: an
  // adversarial review replaced this whole line with `false` — deleting review
  // mode, and separately the read-only lock — and the guard suite, which only
  // grepped for `const isReviewMode =`, matched the mutated line character for
  // character and stayed green.
  const { isReviewMode, isReadOnly, canRecordCertification } = payAppEditability({
    hasSavedRecord: !!savedForThisAppNumber,
    isLocked,
    editRequested,
    isPaid: !!savedPaidAt,
  });
  /** The architect's response is recordable even on a locked certificate. */
  const certReadOnly = !canRecordCertification;
  /**
   * What review mode SAYS. F20 asked for a hard edit-after-send lock; the
   * reasoning for saying it instead of locking is in payAppReviewNotice, and
   * turns on `portalState.lastSentSnapshot` — the portal renders the copy that
   * was SENT, so an edit after a send cannot reach the client until the GC
   * sends again.
   */
  const reviewNotice = useMemo(() => payAppReviewNotice({
    isLocked,
    savedAt: savedForThisAppNumber?.savedAt,
    portalStatus: savedForThisAppNumber?.portalState?.status,
    sentAt: savedForThisAppNumber?.portalState?.sentAt,
  }), [isLocked, savedForThisAppNumber]);
  // A different period was chosen: drop the "I want to edit" intent so the
  // next application does not open straight into the editor.
  useEffect(() => { setEditRequested(false); }, [invoice?.id]);

  /**
   * PERIOD TO restates the change orders. See effectivePeriodTo above for the
   * two-different-NET-CHANGE-figures defect this closes: line 2, line 3 and
   * the G703's change-order rows were frozen at seed time while the printed
   * CHANGE ORDER SUMMARY was computed from this field.
   */
  // --- BEGIN period handlers ---
  // Both handlers are lifted and EXECUTED by
  // scripts/validate-invoice-billing.ts against a captured setApp reducer, so
  // the two-NET-CHANGE-figures defect is pinned by running the code rather than
  // by grepping for it. Keep the sentinels; the validator exits 1 without them.
  const setPeriodTo = useCallback((v: string) => {
    if (isReadOnly || !project) return;
    const cos = getChangeOrdersForProject(project.id);
    setApp((prev) => {
      if (!prev) return prev;
      const next = { ...prev, periodTo: v };
      // An unparseable date means splitApprovedCOsByPeriod would sweep every
      // approved CO onto the certificate. Leave the contract scalars alone
      // until the date is a date; the field says so underneath.
      if (!isCalendarDay(v)) return next;
      return applyApprovedCOsToApplication(next, splitApprovedCOsByPeriod(cos, v).inPeriod);
    });
  }, [isReadOnly, project, getChangeOrdersForProject]);

  /**
   * PERIOD FROM splits the CHANGE ORDER SUMMARY, so changing it must restate
   * the table for the same reason changing PERIOD TO does.
   *
   * The other half of the two-figures defect, and the one the netChange guard
   * cannot see. `buildSavedRecord` deliberately FREEZES the four-row summary
   * into the record so a reprint does not sweep in a change order entered late
   * — and the print path reads `printedCoSummary`, which prefers it, so
   * the frozen table wins on every reopened certificate. Editing PERIOD FROM
   * alone therefore moved the printed header's window (the "from …" line under
   * PERIOD TO) while the ADDITIONS/DEDUCTIONS split beneath it still described
   * the OLD window; `coFiguresAgree` compares netChange, which a re-split does
   * not move, so nothing said so. Dropping the frozen table on a period edit
   * lets the live summary — built from `app.periodFrom` and the same
   * `effectivePeriodTo` line 2 uses — print instead.
   */
  const setPeriodFrom = useCallback((v: string) => {
    if (isReadOnly) return;
    setApp(prev => (prev ? { ...prev, periodFrom: v || undefined, changeOrderSummary: undefined } : prev));
  }, [isReadOnly]);
  // --- END period handlers ---

  const updateLine = useCallback((lineId: string, patch: Partial<AIASOVLine>) => {
    if (isReadOnly) return;
    setApp(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => l.id === lineId ? { ...l, ...patch } : l),
    } : prev);
  }, [isReadOnly]);

  const applyPercentToLine = useCallback((lineId: string, percent: number) => {
    if (isReadOnly) return;
    setApp(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map(l => {
          if (l.id !== lineId) return l;
          const totalCompleted = Math.max(0, Math.min(l.scheduledValue, l.scheduledValue * (percent / 100)));
          // STORED MATERIAL COUNTS TOWARD THE PERCENTAGE. Column H on the G703
          // is G ÷ C where G is D + E + F, and the bar directly beneath this
          // button computes the same thing — so omitting F here meant tapping
          // 75% on a line with $40,000 stored made the bar immediately read
          // 95%. The GC either over-billed by the stored figure believing the
          // button, or stopped trusting the fastest control on the screen.
          const thisPeriod = Math.max(0, totalCompleted - l.fromPreviousApp - l.materialsPresentlyStored);
          return { ...l, thisPeriod: roundCents(thisPeriod) };
        }),
      };
    });
  }, [isReadOnly]);

  const updateRetainagePctAll = useCallback((pct: number) => {
    if (isReadOnly) return;
    setRetainageEdited(true);
    setApp(prev => prev ? {
      ...prev,
      retainagePercent: pct,
      lines: prev.lines.map(l => ({ ...l, retainagePercent: pct })),
    } : prev);
  }, [isReadOnly]);

  /**
   * G702 line 5b's rate — a SEPARATE blank on the form from 5a's.
   *
   * The two exist because the owner's exposure on material sitting in a yard
   * is not his exposure on work in place; contracts routinely hold 10% on one
   * and nothing on the other. With one rate, a GC billing $180,000 of millwork
   * certified $18,000 withheld that he was contractually owed that period, and
   * the only workaround was to drop the whole certificate to a blended rate,
   * which then misstates 5a.
   */
  const updateStoredRetainagePctAll = useCallback((pct: number | undefined) => {
    if (isReadOnly) return;
    setRetainageEdited(true);
    setApp(prev => prev ? {
      ...prev,
      storedRetainagePercent: pct,
      lines: prev.lines.map(l => ({ ...l, storedRetainagePercent: pct })),
    } : prev);
  }, [isReadOnly]);

  // ── Schedule-of-values editor ──────────────────────────────────────────────
  // A schedule of values is negotiated with the owner and organised by CSI
  // division; it routinely differs from the estimate's line structure. There
  // was no add, delete, rename, reorder or item-number control of any kind —
  // the screen's own comment conceded it — which also made per-line retainage
  // (the entire reason G703 column I exists) and stored-material carry-forward
  // unreachable in practice.
  const [sovEditing, setSovEditing] = useState(false);

  const addSovLine = useCallback(() => {
    if (isReadOnly) return;
    setApp(prev => prev ? { ...prev, lines: [...prev.lines, newSovLine(prev.lines, prev.retainagePercent)] } : prev);
    setSovEditing(true);
  }, [isReadOnly]);

  /**
   * THE REFUSAL IS DECIDED OUTSIDE THE UPDATER, DELIBERATELY.
   *
   * This used to call `showAlert` from inside `setApp(prev => …)`. A React
   * state updater must be pure: StrictMode invokes it twice in development, so
   * the GC got the warning twice, and any future re-render-triggered replay
   * would fire it again. It also made the refusal untestable outside a
   * renderer — the only guard possible was a grep for the copy, which cannot
   * see where the call sits.
   *
   * `sovLineDeletionRefusal` is a pure function of the line, so the guard
   * EXECUTES the rule; the updater is left doing nothing but the delete.
   */
  const deleteSovLine = useCallback((lineId: string) => {
    if (isReadOnly || !app) return;
    const refusal = sovLineDeletionRefusal(app.lines.find(l => l.id === lineId));
    if (refusal) {
      showAlert(refusal.title, refusal.body);
      return;
    }
    setApp(prev => (prev ? { ...prev, lines: prev.lines.filter(l => l.id !== lineId) } : prev));
  }, [isReadOnly, app]);

  const moveLine = useCallback((lineId: string, delta: number) => {
    if (isReadOnly) return;
    setApp(prev => prev ? { ...prev, lines: moveSovLine(prev.lines, lineId, delta) } : prev);
  }, [isReadOnly]);

  const renumberLines = useCallback(() => {
    if (isReadOnly) return;
    setApp(prev => prev ? { ...prev, lines: renumberSovLines(prev.lines) } : prev);
  }, [isReadOnly]);

  /** Move stored material into completed work because it got installed. */
  const installStored = useCallback((lineId: string, amount: number) => {
    if (isReadOnly) return;
    setApp(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => (l.id === lineId ? installStoredMaterialOnLine(l, amount) : l)),
    } : prev);
  }, [isReadOnly]);

  /**
   * Pull contract drift (new estimate lines, newly approved COs) into an
   * already-saved DRAFT, on an explicit tap.
   *
   * This is the ONLY way a saved application's schedule of values changes now.
   * Previously it happened on every open, silently, so a March certificate
   * reopened in June grew three change orders approved in April and May and
   * the architect's signed copy no longer matched the screen.
   *
   * THE MERGE IS `mergeRefreshedContract`, not a spread of the fresh
   * application. The version this replaces started from `...fresh` and then
   * re-applied a hand-picked list of header fields, so a tap silently dropped
   * AMOUNT CERTIFIED, the certified date and explanation, the notes and any
   * hand-set LESS PREVIOUS CERTIFICATES — and, because `fresh.lines` is
   * rebuilt from the estimate, every line the GC had added with the new SOV
   * editor and every item number he had typed. The button is offered only on a
   * saved draft, which is exactly the certificate someone has come back to and
   * annotated.
   */
  const refreshFromContract = useCallback(() => {
    if (isReadOnly || !app) return;
    const fresh = seedFreshApplication();
    if (!fresh) return;
    showAlert(
      'Refresh the schedule of values?',
      'On lines the contract still has, Scheduled Value and Description are replaced with the estimate’s and the change orders approved through this period; Contract Sum to Date is recomputed. New estimate lines and change orders are added at the bottom. Everything else stays: lines you added, your item numbers, every amount you entered, both retainage rates, and the architect’s certificate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refresh',
          onPress: () => setApp(prev => (prev ? mergeRefreshedContract(prev, fresh) : prev)),
        },
      ],
    );
  }, [isReadOnly, app, seedFreshApplication]);

  // v2.3 wedge A2 — sync schedule progress to AIA lines.
  // v2.4 (Item 4) — Honor per-line linkedTaskId bindings: a line with
  // linkedTaskId set uses THAT task's progress for itself; lines without
  // a binding fall back to the project-level EV %. Gives per-trade billing
  // accuracy when the GC has bound SOV lines to schedule tasks.
  const handleSyncFromSchedule = useCallback(() => {
    if (isReadOnly) {
      showAlert(
        'Period locked',
        isLocked
          ? 'This pay application has been generated with a payment link. Create the next period to revise.'
          : 'You are viewing the saved certificate. Tap Edit draft to change it.'
      );
      return;
    }
    if (!project?.schedule || !project.linkedEstimate || !app) {
      showAlert(
        'No schedule data',
        'Link a schedule with a linked estimate to use this action.'
      );
      return;
    }
    const metrics = legacyEvmMetrics(project, [], project.schedule);
    const projectPct = Math.round(metrics.percentComplete);
    const anyLinked = app.lines.some(l => l.linkedTaskId);
    if (projectPct <= 0 && !anyLinked) {
      showAlert(
        'No progress yet',
        'Schedule shows 0% complete. Update task progress first.'
      );
      return;
    }
    const tasksById = new Map(project.schedule.tasks.map(t => [t.id, t]));
    let appliedCount = 0;
    app.lines.forEach(line => {
      let pct = projectPct;
      if (line.linkedTaskId) {
        const linked = tasksById.get(line.linkedTaskId);
        if (linked) pct = Math.round(linked.progress ?? 0);
      }
      if (pct > 0) {
        applyPercentToLine(line.id, pct);
        appliedCount++;
      }
    });
    if (appliedCount === 0) {
      showAlert(
        'No progress yet',
        'Neither project EV nor any linked task has progress > 0.'
      );
      return;
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, app, applyPercentToLine, isReadOnly, isLocked]);

  // Build a portable SavedAIAPayApp record from the in-memory app + computed
  // totals. Used both for the explicit "Save to Project" tap and as a
  // side-effect of generating the PDF (so the portal always has the latest
  // billing once the GC has gone through the trouble of producing it).
  const buildSavedRecord = useCallback((): SavedAIAPayApp | null => {
    if (!app || !project || !totals) return null;
    // The record for THIS INVOICE, not for whatever currently shares this
    // application number — see savedForThisInvoice. Reusing the id is what
    // makes a re-save an update of the certificate rather than a second one.
    const existing = savedForThisInvoice;
    return {
      id: existing?.id ?? generateUUID(),
      projectId: project.id,
      invoiceId: invoice?.id,
      applicationNumber: app.applicationNumber,
      applicationDate: app.applicationDate,
      periodTo: app.periodTo,
      periodFrom: app.periodFrom,
      contractDate: app.contractDate,
      ownerName: app.ownerName,
      contractorName: app.contractorName,
      architectName: app.architectName,
      projectName: app.projectName,
      projectLocation: app.projectLocation,
      contractForDescription: app.contractForDescription,
      originalContractSum: app.originalContractSum,
      netChangeByCO: app.netChangeByCO,
      contractSumToDate: app.contractSumToDate,
      retainagePercent: app.retainagePercent,
      storedRetainagePercent: app.storedRetainagePercent,
      lessPreviousCertificates: app.lessPreviousCertificates,
      amountCertified: app.amountCertified,
      certifiedDate: app.certifiedDate,
      certifiedExplanation: app.certifiedExplanation,
      // Freeze the four-row CHANGE ORDER SUMMARY into the record. Without it a
      // reprint recomputes the table from today's change-order list, so a CO
      // approved inside the period but entered a month later silently appears
      // on a certificate the architect already signed.
      changeOrderSummary: printedCoSummary,
      notarize: app.notarize,
      notaryState: app.notaryState,
      notaryCounty: app.notaryCounty,
      // Where column C came from, so a reopened certificate keeps telling the
      // truth about its own schedule of values. Without it the hydrate left
      // sovBasis undefined and every reopened application printed "this
      // project has no itemized estimate linked".
      sovBasis: app.sovBasis,
      // The shared mapper, not an inline literal — see sovLineToSaved. The
      // inline version was where a review reinstated the column-F blocker
      // with the whole guard suite still green.
      lines: app.lines.map(sovLineToSaved),
      notes: app.notes,
      totals: {
        totalScheduledValue: totals.totalScheduledValue,
        totalCompletedAndStored: totals.totalCompletedAndStored,
        totalRetainage: totals.totalRetainage,
        totalEarnedLessRetainage: totals.totalEarnedLessRetainage,
        currentPaymentDue: totals.currentPaymentDue,
        balanceToFinish: totals.balanceToFinish,
        percentComplete: totals.percentComplete,
      },
      savedAt: new Date().toISOString(),
    };
  }, [app, project, totals, invoice?.id, savedForThisInvoice, printedCoSummary]);

  const handleSave = useCallback(async () => {
    if (isReadOnly) {
      showAlert(
        isLocked ? 'Period locked' : 'Viewing the saved certificate',
        isLocked
          ? 'This pay application has already been generated and a payment link is active. To revise the numbers, create the next period instead.'
          : 'This is the certificate as it was saved. Tap Edit draft if you need to change it.'
      );
      return;
    }
    const rec = buildSavedRecord();
    if (!rec) return;

    // Auto-attach a Stripe pay link for `currentPaymentDue` if the GC has
    // Connect onboarded. Mirrors the invoice flow at app/invoice.tsx:350-385.
    // Pre-audit (May 2026), AIA pay apps generated PDFs but had no payment
    // wiring at all — homeowners got a print-only document while regular
    // invoices had Pay buttons. We close the asymmetry here.
    let payLinkUrl = rec.payLinkUrl;
    let payLinkId = rec.payLinkId;
    let stripeNotConnected = false;
    let stripeFailureReason: string | null = null;
    const due = rec.totals?.currentPaymentDue ?? 0;
    // ONE BILLING PERIOD IS ONE OBLIGATION — the write-side half.
    //
    // A G702 and the progress invoice it certifies are the same money. The
    // Stripe webhook's creditInvoice used to clear the INVOICE's pay-link
    // columns and touch nothing on the AIA side, so a bookkeeper who paid the
    // invoice was left looking at a live Pay button for the same period.
    // Closed in three places now: creditInvoice settles every unpaid
    // aia_pay_apps row on that invoice and deactivates its Stripe link (the
    // mirror of handleAiaPayAppCompleted); the portal and the snapshot builder
    // refuse to render the button; and this refuses to MINT a new link for
    // money already collected — which no read-side suppression can undo once
    // Stripe has it.
    //
    // Only minting is refused. An existing link is left on the record on
    // purpose: `isLocked` is computed from it, and nulling it here would
    // UNLOCK a certificate that has already been through Stripe.
    const sourceInvoiceSettled = !!invoice && invoiceOutstanding(invoice) <= 0.01;
    // MONEY-F2: never mint a Pay button for a pay app that is already paid.
    if (!payLinkUrl && due > 0 && !savedPaidAt && !sourceInvoiceSettled && user?.id) {
      try {
        const status = await fetchStripeConnectStatus(user.id);
        if (status.success && status.chargesEnabled && status.accountId) {
          const res = await createPaymentLink({
            invoiceId: rec.id,
            // rec.id is a SavedAIAPayApp id (aia_pay_apps.id), NOT an
            // invoices.id — tell the edge fn to verify ownership against the
            // aia_pay_apps table and route the webhook there. Without this the
            // Pay button 404s "Invoice not found".
            recordType: 'aia_pay_app',
            invoiceNumber: rec.applicationNumber,
            projectName: rec.projectName ?? 'Project',
            amountCents: Math.round(due * 100),
            // No customer email at this point — the homeowner email is
            // captured at portal-link share time, not here. Stripe will
            // collect at checkout.
            customerEmail: '',
            companyName: rec.contractorName ?? settings?.branding?.companyName ?? 'Contractor',
            stripeAccountId: status.accountId,
            userTier: tier,
          });
          if (res.success && res.url && res.id) {
            payLinkUrl = res.url;
            payLinkId = res.id;
          } else {
            console.warn('[AIA] Auto-generate payment link failed:', res.error);
            stripeFailureReason = res.error ?? 'unknown';
          }
        } else {
          console.log('[AIA] Skipping payment link — Stripe Connect not set up for this user');
          stripeNotConnected = true;
        }
      } catch (err) {
        console.warn('[AIA] Auto-generate payment link threw:', err);
        stripeFailureReason = (err as Error)?.message ?? 'network error';
      }
    }

    // MONEY-F2: remember the amount the link charges (portal shows Pay only
    // while it still equals what is owed).
    addAIAPayApp({ ...rec, payLinkUrl, payLinkId, payLinkAmount: payLinkUrl ? Math.round(due * 100) / 100 : undefined });
    // Saving is not "I am done editing". Without this the record appears, the
    // screen notices it, and the form the GC is mid-way through filling in
    // goes read-only under his hands the instant he taps Save. Review mode is
    // for a certificate he has COME BACK to; leaving the editor open here
    // costs nothing, because the record is now the thing that gets hydrated on
    // the next open. A minted pay link still locks it, via isLocked.
    setEditRequested(true);
    setSavedFlash(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSavedFlash(false), 2200);

    // Surface the Stripe outcome AFTER save so the GC isn't surprised by
    // a print-only AIA on the homeowner portal. Pre-audit this was a
    // silent console.warn — the GC believed the pay app shipped with a
    // Pay button and homeowners just saw a static PDF. Now they get a
    // real choice: set up Stripe, or accept that AIA goes out without
    // one-tap pay.
    if (stripeNotConnected && due > 0) {
      showAlert(
        'Saved — but no Pay button',
        'You haven\'t connected Stripe yet, so this AIA pay application was saved without a one-tap Pay button on the client portal. Set up Stripe to add Pay buttons to AIA apps and invoices going forward.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Set up Stripe', onPress: () => router.push('/payments-setup' as never) },
        ],
      );
    } else if (stripeFailureReason && due > 0) {
      showAlert(
        'Saved — Pay button could not be attached',
        `Stripe didn't reach us when generating the payment link (${stripeFailureReason}). The AIA is saved; you can re-share later when Stripe is reachable to attach a Pay button.`,
        [{ text: 'OK', style: 'default' }],
      );
    }
  }, [buildSavedRecord, addAIAPayApp, user, settings, router, isLocked, isReadOnly, savedPaidAt, tier, invoice]);

  /**
   * PERSIST THE ARCHITECT'S RESPONSE, and nothing else.
   *
   * handleSave refuses in review mode and mints pay links; neither is right
   * for AMOUNT CERTIFIED, which arrives after the application was sent and is
   * the one thing a locked certificate must still be able to learn. This
   * writes the three response fields onto the STORED record — no totals, no
   * lines, no contract scalars, no Stripe — so the DB freeze trigger sees an
   * update that touches nothing it protects.
   *
   * The server half is migration 20260911090000: the trigger froze
   * `snapshot_totals` wholesale, and these three fields ride in its
   * `__mageCertificate` sidecar, so before it is applied this write is
   * rejected with check_violation and the response lives on this device only.
   */
  const handleSaveCertification = useCallback(() => {
    if (!app || certReadOnly) return;
    const existing = savedForThisInvoice;
    if (!existing) {
      // Never saved: there is no stored record to annotate, so the ordinary
      // save is both correct and the only thing that can work.
      void handleSave();
      return;
    }
    addAIAPayApp({
      ...existing,
      amountCertified: app.amountCertified,
      certifiedDate: app.certifiedDate,
      certifiedExplanation: app.certifiedExplanation,
    });
    setSavedFlash(true);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setSavedFlash(false), 2200);
  }, [app, certReadOnly, savedForThisInvoice, addAIAPayApp, handleSave]);

  /** Has the GC changed the architect's response since it was last stored? */
  const certificationDirty = !!app && !!savedForThisInvoice && (
    (app.amountCertified ?? null) !== (savedForThisInvoice.amountCertified ?? null)
    || (app.certifiedDate ?? null) !== (savedForThisInvoice.certifiedDate ?? null)
    || (app.certifiedExplanation ?? null) !== (savedForThisInvoice.certifiedExplanation ?? null)
  );

  // Tap "Generate PDF" → show pre-export confirmation first (liability
  // reducer). Once user confirms they reviewed the totals, we actually
  // generate.
  const requestGenerate = useCallback(() => {
    if (isLocked) {
      showAlert(
        'Period locked',
        'This pay application has already been generated. Create the next period to produce a new PDF + pay link.'
      );
      return;
    }
    if (!app || !settings?.branding) return;
    setShowPreExportConfirm(true);
  }, [app, settings?.branding, isLocked]);

  /** Reprint a saved certificate exactly as stored. No save, no pay link, no
   *  re-derivation — the whole point of review mode. */
  const handleReprint = useCallback(async () => {
    if (!app || !settings?.branding) return;
    setGenerating(true);
    try {
      // The STORED summary wins. A live recompute is only the fallback for a
      // draft that has never been saved.
      await generateAIAPayAppPDF(
        { ...app, changeOrderSummary: printedCoSummary },
        settings.branding,
      );
    } catch {
      showAlert('Error', 'Could not generate the pay application PDF.');
    } finally {
      setGenerating(false);
    }
  }, [app, settings?.branding, printedCoSummary]);

  const handleGenerate = useCallback(async () => {
    setShowPreExportConfirm(false);
    if (!app || !settings?.branding) return;
    setGenerating(true);
    try {
      await generateAIAPayAppPDF(
        { ...app, changeOrderSummary: printedCoSummary },
        settings.branding,
      );
      // Persist + attach pay link via the same code path as handleSave so
      // the portal-side rendering of this AIA app gets a Pay button.
      await handleSave();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showAlert('Error', 'Could not generate the pay application PDF.');
    } finally {
      setGenerating(false);
    }
  }, [app, settings?.branding, handleSave, printedCoSummary]);

  // Step 1 — which job.
  if (!project || forceProjectPick) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'AIA Pay Apps' }} />
        <ToolProjectPicker
          toolName="AIA Pay Apps"
          message="A G702 / G703 certifies one billing period against one job's schedule of values."
          projects={projects}
          onPick={pickProject}
          staleProjectId={staleProjectId}
          icon={<MagePayApp size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Inside that project, create a Progress Invoice from your estimate or schedule of values.',
            'Come back here (or tap Generate AIA Pay App on the invoice) to fill G702/G703 and route it for sign-off.',
          ]}
        />
      </View>
    );
  }

  // Step 2 — which billing period. Only reachable with 0 or 2+ progress
  // invoices; exactly one resolves above without asking.
  if (!invoice) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'AIA Pay Apps' }} />
        <ScrollView contentContainerStyle={styles.periodPickContent} showsVerticalScrollIndicator={false}>
          {progressInvoices.length === 0 ? (
            // The blocked case, said plainly: this is not "nothing here", it is
            // "there is no period to certify". A G702 is a certificate ABOUT a
            // progress invoice — it cannot be the first document on a job.
            <EmptyState
              icon={<MagePayApp size={36} color={themeColors.accent} />}
              title={`${project.name} has no progress invoice yet`}
              message="A pay application certifies a billing period, and the period is a progress invoice — MAGE fills G702/G703 from that invoice's schedule of values, so there is nothing to certify until one exists."
              actionLabel="Create a progress invoice"
              onAction={() => router.push({
                pathname: '/bill-from-estimate' as never,
                params: { projectId: project.id, type: 'progress' } as never,
              })}
            />
          ) : (
            <>
              <Text style={styles.periodPickLead}>
                {project.name} has {progressInvoices.length} progress invoices. A pay
                application certifies one period — pick the one you are billing.
              </Text>
              <Text style={styles.periodPickTitle}>Pick a billing period</Text>
              {progressInvoices.map(inv => (
                <TouchableOpacity
                  key={inv.id}
                  style={styles.periodPickRow}
                  onPress={() => setPickedInvoiceId(inv.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Invoice ${inv.number}, ${formatMoney(inv.totalDue)}, issued ${inv.issueDate}`}
                  testID={`aia-pick-invoice-${inv.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.periodPickRowTitle} numberOfLines={1}>
                      Invoice #{inv.number} · {formatMoney(inv.totalDue)}
                    </Text>
                    <Text style={styles.periodPickRowMeta} numberOfLines={1}>
                      Issued {inv.issueDate}
                      {typeof inv.progressPercent === 'number' ? ` · ${inv.progressPercent}% complete` : ''}
                    </Text>
                  </View>
                  <MagePayApp size={18} color={themeColors.accent} />
                </TouchableOpacity>
              ))}
            </>
          )}
          <TouchableOpacity
            style={styles.periodPickAlt}
            onPress={() => setForceProjectPick(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Pick a different project"
            testID="aia-pick-other-project"
          >
            <Text style={styles.periodPickAltText}>Different project</Text>
          </TouchableOpacity>
        </ScrollView>
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
          title: 'Progress Billing',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        {...fabScroll}
        style={[styles.container, { backgroundColor: themeColors.bg }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        <FeatureHeader
          eyebrow="AIA G702 / G703"
          title="Bill the bank"
          subtitle="Turn your % complete into the AIA pay application your owner&apos;s lender expects. Auto-fills contract sum, retainage, and the schedule of values."
          explainer={{
            term: 'AIA Pay Application',
            definition: 'The American Institute of Architects (AIA) G702 and G703 forms are the industry-standard pay-application format used on most commercial and many residential bank-financed projects. The G702 is the cover sheet showing total contract value, % complete, and amount requested; the G703 is the line-item schedule of values backing it up.',
            whenToUse: [
              'Your owner or their bank/lender requires AIA-format billing',
              'You need to bill in stages tied to actual completion percentage',
              'Retainage (a % held back until completion) is part of your contract',
            ],
          }}
        />

        {/* REVIEW MODE — the saved certificate, as saved.
            There was no read-only view of a submitted pay application
            anywhere in the product: app/documents.tsx lists them and routes
            the tap straight into this editor, which then re-derived the
            document in front of the GC. Now a saved application opens as the
            STORED record; editing an unsent draft is an explicit tap. */}
        {isReviewMode && (
          <View style={styles.reviewBanner} testID="aia-review-banner">
            <View style={styles.reviewBannerRow}>
              <Lock size={16} color={themeColors.accent} strokeWidth={2} />
              <Text style={styles.reviewBannerTitle}>{reviewNotice.title}</Text>
            </View>
            <Text style={styles.reviewBannerBody}>{reviewNotice.body}</Text>
            <View style={styles.reviewBannerActions}>
              <TouchableOpacity
                style={styles.sovFooterBtn}
                onPress={handleReprint}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Print this saved pay application"
                testID="aia-reprint"
              >
                <Printer size={15} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.sovFooterBtnText}>Print as saved</Text>
              </TouchableOpacity>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.sovFooterBtn}
                  onPress={() => setEditRequested(true)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Edit this draft pay application"
                  testID="aia-edit-draft"
                >
                  <Pencil size={15} color={themeColors.accent} strokeWidth={2} />
                  <Text style={styles.sovFooterBtnText}>{reviewNotice.editLabel}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Audit-2026-05-21 (#28.1 HIGH): edit-after-send lock banner.
            Surfaces the locked state immediately so the GC knows why
            edits are being refused. CTA bounces back to the invoice so
            they can navigate to the next billing period. */}
        {isLocked && (
          <View style={styles.lockedBanner}>
            <Text style={styles.lockedBannerTitle}>
              Period #{app.applicationNumber} locked
            </Text>
            <Text style={styles.lockedBannerBody}>
              {savedPaidAt
                ? `This pay application was paid on ${new Date(savedPaidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — ${formatMoney(savedForThisAppNumber?.totals?.currentPaymentDue ?? 0, 2)}. The portal no longer shows a Pay button for it. To bill the next period, create the next application — carry-forward will seed it from this period's billed-through totals.`
                : `This pay application has been generated with a payment link active for ${formatMoney(savedForThisAppNumber?.totals?.currentPaymentDue ?? 0, 2)}. To revise the numbers, create the next period instead — carry-forward will seed the next pay-app from this period's billed-through totals.`}
            </Text>
            <TouchableOpacity
              style={styles.lockedBannerCta}
              onPress={() => router.back()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Back to invoice to create next period"
            >
              <Text style={styles.lockedBannerCtaText}>Back to invoice →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* A LINK WITH NO RECORDED AMOUNT IS UNPAYABLE AND UNRECOVERABLE.
            The portal refuses to render a Pay button for a link whose minted
            amount it cannot check (a Payment Link charges the one figure it
            was created for, whatever the balance is today), and this record is
            locked, so there is no save that would regenerate it. Say so here
            rather than leave the owner looking at a card with no button and
            the GC wondering why nobody has paid. */}
        {isLocked && !!savedForThisAppNumber?.payLinkUrl && savedForThisAppNumber?.payLinkAmount == null && !savedPaidAt && (
          <View style={styles.sovWarnBanner} testID="aia-paylink-amount-unknown">
            <ShieldAlert size={16} color={Colors.warningLabel} strokeWidth={2} />
            <Text style={styles.sovWarnText}>
              This application carries a payment link from before MAGE recorded what each link
              charges, so the portal will not show a Pay button for it — a Stripe link collects the
              one amount it was created with, and this record cannot say what that was. Collect this
              period through the invoice&apos;s own Pay button instead.
            </Text>
          </View>
        )}

        {/* Hero summary card */}
        <View style={styles.hero}>
          <View style={styles.heroHeaderRow}>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroLabel}>G702 · G703</Text>
              <Text style={styles.heroTitle}>Pay Application #{app.applicationNumber}</Text>
              <Text style={styles.heroSub}>{project.name}</Text>
              {savedForThisAppNumber && (
                <PortalStatusPill portalState={savedForThisAppNumber.portalState} itemUpdatedAt={savedForThisAppNumber.savedAt} />
              )}
            </View>
            <View style={styles.progressBadge}>
              <Text style={styles.progressBadgeNum}>{totals.percentComplete.toFixed(0)}%</Text>
              <Text style={styles.progressBadgeLabel}>Complete</Text>
            </View>
          </View>
          {carriedFromAppNumber !== null && (
            <View style={styles.carriedRow}>
              <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={2.4} />
              <Text style={styles.carriedText}>
                Carried forward from Pay App #{carriedFromAppNumber} — every line&apos;s &ldquo;from previous&rdquo; amount and the G702 &ldquo;less previous certificates&rdquo; total are pre-filled. Just enter this period&apos;s percent-complete per line.
              </Text>
            </View>
          )}

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
              <Text style={[styles.heroStatValue, { color: themeColors.accent }]}>
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
              editable={!isReadOnly}
              onChangeText={v => setApp(p => p ? { ...p, ownerName: v } : p)}
              placeholder="Owner / Client name"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Architect</Text>
            <TextInput
              style={styles.formInput}
              value={app.architectName ?? ''}
              editable={!isReadOnly}
              onChangeText={v => setApp(p => p ? { ...p, architectName: v } : p)}
              placeholder="Optional"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          {/* APPLICATION NO. is a strict 1..N sequence on ONE contract, and
              lenders reconcile draws by it. It used to be the source INVOICE's
              number — which counts deposits and mobilization bills too — so a
              GC's first ever G702 could open at "#3" beside "Less Previous
              Certificates $0.00", two facts that cannot both be true, and
              there was no field anywhere to correct it. It is derived from the
              project's own pay-app sequence now, and editable for a GC
              migrating a job mid-stream. */}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Application No.</Text>
            <TextInput
              style={styles.formInput}
              value={String(app.applicationNumber)}
              editable={!isReadOnly}
              onChangeText={v => {
                const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                setApp(p => p ? { ...p, applicationNumber: Number.isNaN(n) ? 1 : Math.max(1, n) } : p);
              }}
              keyboardType="number-pad"
              testID="aia-application-number"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          {/* APPLICATION NO. is a strict 1..N sequence on ONE contract and a
              lender reconciles draws by it, so two certificates at one number
              is never a thing the GC means. The de-dupe in addAIAPayApp no
              longer keys on this number, so the collision is survivable — but
              it still has to be said. */}
          {savedForProject.some(a =>
            a.id !== savedForThisInvoice?.id && a.applicationNumber === app.applicationNumber) && (
            <Text style={styles.fieldError} testID="aia-appno-collision">
              Another saved pay application on this job is already #{app.applicationNumber}. A lender
              reconciles draws by this number — give this one its own.
            </Text>
          )}
          {app.applicationNumber !== resolvedApplicationNumber && (
            <Text style={styles.retainageSourceNote} testID="aia-appno-override">
              MAGE would number this #{resolvedApplicationNumber} from this job&apos;s saved pay
              applications. You have set it to #{app.applicationNumber} — keep it that way only
              if earlier applications on this contract were billed outside MAGE.
            </Text>
          )}

          {/* PERIOD TO and APPLICATION DATE are two different dates on the
              form — the last day of the work being certified, and the day the
              contractor signs. Both used to be seeded from the invoice's issue
              date with no field to change either, so PERIOD TO was never the
              end of a billing period. The change-order filter and the
              prior-period ordering both key on PERIOD TO, so it has to mean
              what the form says it means. */}
          {/* EVERY ONE OF THESE DEGRADES SILENTLY ON A BAD STRING. dayKey
              returns null for anything that is not YYYY-MM-DD, so
              selectPriorApplication drops to sequence ordering with no signal;
              onOrBeforeDay returns TRUE, so splitApprovedCOsByPeriod sweeps
              every approved change order onto the certificate with no signal.
              Typing "3/31/26" therefore silently undid both of the fixes these
              fields were added for. They are checked with the same predicate
              the consumers use, and the error is stated at the field. */}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Period From</Text>
            <TextInput
              style={styles.formInput}
              value={app.periodFrom ?? ''}
              editable={!isReadOnly}
              onChangeText={setPeriodFrom}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              testID="aia-period-from"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          {!!app.periodFrom && !isCalendarDay(app.periodFrom) && (
            <Text style={styles.fieldError} testID="aia-period-from-error">
              Not a date MAGE can read. Use YYYY-MM-DD (for example 2026-03-01). Until it is, the
              CHANGE ORDER SUMMARY files every approved change order under &ldquo;previous
              months&rdquo; because it cannot tell which month they landed in.
            </Text>
          )}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Period To</Text>
            <TextInput
              style={styles.formInput}
              value={app.periodTo ?? ''}
              editable={!isReadOnly}
              onChangeText={setPeriodTo}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              testID="aia-period-to"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          {!isCalendarDay(app.periodTo) && (
            <Text style={styles.fieldError} testID="aia-period-to-error">
              Period end is not a date MAGE can read. Use YYYY-MM-DD (for example 2026-03-31).
              Until it is, EVERY approved change order is included on this certificate and the
              prior period is picked by application number rather than by date.
            </Text>
          )}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Application Date</Text>
            <TextInput
              style={styles.formInput}
              value={app.applicationDate ?? ''}
              editable={!isReadOnly}
              onChangeText={v => setApp(p => p ? { ...p, applicationDate: v } : p)}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              testID="aia-application-date"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          {!isCalendarDay(app.applicationDate) && (
            <Text style={styles.fieldError} testID="aia-application-date-error">
              Not a date MAGE can read. Use YYYY-MM-DD (for example 2026-04-02); the G702 prints
              this as the day you signed.
            </Text>
          )}
          {/* CONTRACT DATE is printed in the G702 header. It used to be
              hardcoded `undefined` by the seeder with no control anywhere, so
              the box printed an em dash on every certificate forever. */}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Contract Date</Text>
            <TextInput
              style={styles.formInput}
              value={app.contractDate ?? ''}
              editable={!isReadOnly}
              onChangeText={v => setApp(p => p ? { ...p, contractDate: v || undefined } : p)}
              placeholder="YYYY-MM-DD — the date the contract was signed"
              autoCapitalize="none"
              testID="aia-contract-date"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          {!!app.contractDate && !isCalendarDay(app.contractDate) && (
            <Text style={styles.fieldError} testID="aia-contract-date-error">
              Not a date MAGE can read. Use YYYY-MM-DD (for example 2025-11-14).
            </Text>
          )}
          {coSplit.afterPeriod.length > 0 && (
            <Text style={styles.retainageSourceNote} testID="aia-co-after-period">
              {coSplit.afterPeriod.length} approved change order{coSplit.afterPeriod.length === 1 ? '' : 's'}{' '}
              ({coSplit.afterPeriod.map(co => `#${co.number}`).join(', ')}) were approved AFTER{' '}
              {/* The date THIS SPLIT actually used. It used to print
                  `app.periodTo` while coSplit ran on the invoice's issue date,
                  so the banner could say "approved AFTER 2026-04-30" about a
                  change order approved on the 20th. */}
              {effectivePeriodTo || 'this period'}, so they are not on this certificate. They will appear on
              Application #{app.applicationNumber + 1}.
            </Text>
          )}

          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Less Previous Certificates</Text>
            <MoneyField
              style={styles.formInput}
              value={app.lessPreviousCertificates}
              editable={!isReadOnly}
              onCommit={n => setApp(p => p ? { ...p, lessPreviousCertificates: n } : p)}
              testID="aia-less-previous"
            />
          </View>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Retainage %</Text>
            <View style={styles.retainageChips}>
              {[0, 5, 10].map(pct => (
                <TouchableOpacity
                  key={pct}
                  onPress={() => updateRetainagePctAll(pct)}
                  // A chip that looks tappable and silently does nothing is a
                  // dead end; every mutating handler already refuses in review
                  // mode, so say so at the control instead of swallowing the tap.
                  disabled={isReadOnly}
                  style={[styles.chip, app.retainagePercent === pct && styles.chipActive, isReadOnly && styles.chipOff]}
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
                editable={!isReadOnly}
                onChangeText={v => {
                  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
                  updateRetainagePctAll(isNaN(n) ? 0 : Math.max(0, Math.min(50, n)));
                }}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          {/* MISS-05: say where this rate came from. It used to default to a
              fabricated 10% whenever the invoice carried no percentage, so a GC
              who bills without retainage certified 10% held to his lender. */}
          <Text style={styles.retainageSourceNote} testID="aia-retainage-source">
            {retainageEdited
              ? `Set here — the source invoice bills ${invoiceRetainagePct}% retainage.`
              : invoiceRetainagePct > 0
                ? `Carried from invoice #${invoice.number} (${invoiceRetainagePct}%). Change it if this contract holds a different rate.`
                : `Invoice #${invoice.number} withheld no retainage, so this certificate holds none. Set the contract's rate if it holds any.`}
          </Text>
          {/* G702 line 5b is its OWN percentage blank, not a repeat of 5a.
              One rate for both bases meant a GC on a contract holding 10% on
              work in place and nothing on stored material certified $18,000
              withheld on $180,000 of millwork that he was owed that period —
              and the only workaround was a blended rate, which then misstates
              5a. The note below used to state the conflation as policy. */}
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Stored Material Retainage % (5b)</Text>
            <View style={styles.retainageChips}>
              <TouchableOpacity
                onPress={() => updateStoredRetainagePctAll(undefined)}
                disabled={isReadOnly}
                style={[styles.chip, app.storedRetainagePercent == null && styles.chipActive, isReadOnly && styles.chipOff]}
                activeOpacity={0.8}
                testID="aia-stored-retainage-same"
              >
                <Text style={[styles.chipText, app.storedRetainagePercent == null && styles.chipTextActive]}>
                  Same as 5a
                </Text>
              </TouchableOpacity>
              {[0, 5, 10].map(pct => (
                <TouchableOpacity
                  key={pct}
                  onPress={() => updateStoredRetainagePctAll(pct)}
                  disabled={isReadOnly}
                  style={[styles.chip, app.storedRetainagePercent === pct && styles.chipActive, isReadOnly && styles.chipOff]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, app.storedRetainagePercent === pct && styles.chipTextActive]}>
                    {pct}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={styles.retainageSourceNote}>
            5a withholds {app.retainagePercent}% of completed work (columns D + E); 5b withholds{' '}
            {storedRetainagePercentForApp(app)}% of stored material (column F)
            {app.storedRetainagePercent == null ? ' — the same rate, because this contract does not distinguish them' : ''}.
            Retainage is never withheld on sales tax.
          </Text>
        </View>

        {/* ── Certificate for Payment ──────────────────────────────────────
            A201 §9.5 and §9.6 let the architect certify an amount DIFFERENT
            from the amount applied for, and the G702 carries an AMOUNT
            CERTIFIED line for exactly that. It matters twice: the owner pays
            the certified figure, and the NEXT application's line 7 is "Line 6
            from prior Certificate" — the certified amount, not the requested
            one. With nowhere to record it, an architect certifying $58,200
            against a $64,000 application left the GC permanently $5,800 short
            in a number he believed was automatic. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Architect&apos;s Certificate</Text>
          {/* RECORDABLE ON A LOCKED CERTIFICATE, deliberately. A GC with
              Stripe Connect gets a pay link on the first Save, so isReadOnly
              is true on every certificate an architect ever answers — gating
              these controls on it made AMOUNT CERTIFIED unreachable in the
              only flow it exists for, and left the next period's line 7
              seeding from the amount applied for. See payAppEditability. */}
          <Text style={styles.sectionHint}>
            Fill this in when the certificate comes back — you can do this after the application
            has gone out. Next period&apos;s &ldquo;Less Previous Certificates&rdquo; seeds from the
            certified figure when there is one.
          </Text>
          <View style={styles.formRow}>
            <Text style={styles.formLabel}>Amount Certified</Text>
            {app.amountCertified == null ? (
              <TouchableOpacity
                style={[styles.chip, certReadOnly && styles.chipOff]}
                onPress={() => setApp(p => p ? { ...p, amountCertified: totals.currentPaymentDue } : p)}
                disabled={certReadOnly}
                activeOpacity={0.8}
                testID="aia-record-certified"
              >
                <Text style={styles.chipText}>Not yet certified — record it</Text>
              </TouchableOpacity>
            ) : (
              <MoneyField
                style={styles.formInput}
                value={app.amountCertified}
                editable={!certReadOnly}
                onCommit={n => setApp(p => p ? { ...p, amountCertified: n } : p)}
                testID="aia-amount-certified"
              />
            )}
          </View>
          {app.amountCertified != null && (
            <>
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>Certified Date</Text>
                <TextInput
                  style={styles.formInput}
                  value={app.certifiedDate ?? ''}
                  editable={!certReadOnly}
                  onChangeText={v => setApp(p => p ? { ...p, certifiedDate: v || undefined } : p)}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  testID="aia-certified-date"
                  placeholderTextColor={themeColors.textMuted}
                />
              </View>
              {!!app.certifiedDate && !isCalendarDay(app.certifiedDate) && (
                <Text style={styles.fieldError} testID="aia-certified-date-error">
                  Not a date MAGE can read. Use YYYY-MM-DD (for example 2026-04-08).
                </Text>
              )}
              {Math.abs(roundCents(app.amountCertified - totals.currentPaymentDue)) > 0.01 && (
                <>
                  <View style={styles.sovWarnBanner} testID="aia-certified-variance">
                    <ShieldAlert size={16} color={Colors.warningLabel} strokeWidth={2} />
                    <Text style={styles.sovWarnText}>
                      Certified {app.amountCertified > totals.currentPaymentDue ? 'above' : 'below'} the{' '}
                      {formatMoney(totals.currentPaymentDue, 2)} applied for, by{' '}
                      {formatMoney(Math.abs(roundCents(app.amountCertified - totals.currentPaymentDue)), 2)}.
                      The form asks you to attach an explanation and to initial every figure on the G702
                      and the continuation sheet that changed to match.
                    </Text>
                  </View>
                  <View style={styles.formRow}>
                    <Text style={styles.formLabel}>Explanation</Text>
                    <TextInput
                      style={styles.formInput}
                      value={app.certifiedExplanation ?? ''}
                      editable={!certReadOnly}
                      onChangeText={v => setApp(p => p ? { ...p, certifiedExplanation: v || undefined } : p)}
                      placeholder="Why the certified amount differs"
                      testID="aia-certified-explanation"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                </>
              )}
            </>
          )}
          {/* The ordinary Save refuses in review mode and mints Stripe links.
              Neither is right for the architect's answer, so it has its own
              write: the three response fields onto the STORED record, nothing
              else. */}
          {certificationDirty && !certReadOnly && (
            <TouchableOpacity
              style={styles.certSaveBtn}
              onPress={handleSaveCertification}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Save the architect's certified amount"
              testID="aia-save-certification"
            >
              <Save size={15} color={themeColors.accent} strokeWidth={2} />
              <Text style={styles.sovFooterBtnText}>Save the architect&apos;s response</Text>
            </TouchableOpacity>
          )}

          {/* AIA's own instructions: the Contractor should sign G702, HAVE IT
              NOTARIZED, and submit it with the G703. On public work and most
              lender-funded private work an un-notarized application is
              returned and the draw slips a cycle. Off by default — a
              residential GC should not print empty notary lines forever. */}
          <TouchableOpacity
            style={styles.notaryToggleRow}
            onPress={() => !isReadOnly && setApp(p => p ? { ...p, notarize: !p.notarize } : p)}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!app.notarize }}
            testID="aia-notarize-toggle"
          >
            <View style={[styles.checkbox, app.notarize && styles.checkboxOn]}>
              {app.notarize ? <Check size={13} color={themeColors.bg} strokeWidth={3} /> : null}
            </View>
            <Stamp size={15} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.notaryToggleText}>
              Print a notary block (State / County / subscribed and sworn)
            </Text>
          </TouchableOpacity>
          {app.notarize && (
            <>
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>State of</Text>
                <TextInput
                  style={styles.formInput}
                  value={app.notaryState ?? ''}
                  editable={!isReadOnly}
                  onChangeText={v => setApp(p => p ? { ...p, notaryState: v || undefined } : p)}
                  placeholder="Leave blank for the notary to write in"
                  placeholderTextColor={themeColors.textMuted}
                  testID="aia-notary-state"
                />
              </View>
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>County of</Text>
                <TextInput
                  style={styles.formInput}
                  value={app.notaryCounty ?? ''}
                  editable={!isReadOnly}
                  onChangeText={v => setApp(p => p ? { ...p, notaryCounty: v || undefined } : p)}
                  placeholder="Leave blank for the notary to write in"
                  placeholderTextColor={themeColors.textMuted}
                  testID="aia-notary-county"
                />
              </View>
            </>
          )}
        </View>

        {/* Schedule of Values */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Schedule of Values (G703)</Text>
            <View style={styles.sovHeaderActions}>
              {!isReadOnly && (
                <TouchableOpacity
                  onPress={handleSyncFromSchedule}
                  style={styles.chip}
                  activeOpacity={0.8}
                  testID="aia-sync-from-schedule"
                >
                  <Text style={styles.chipText}>Sync from schedule</Text>
                </TouchableOpacity>
              )}
              {!isReadOnly && (
                <TouchableOpacity
                  onPress={() => setSovEditing(v => !v)}
                  style={[styles.chip, sovEditing && styles.chipActive]}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={sovEditing ? 'Done editing the schedule of values' : 'Edit the schedule of values'}
                  testID="aia-sov-edit-toggle"
                >
                  <Text style={[styles.chipText, sovEditing && styles.chipTextActive]}>
                    {sovEditing ? 'Done' : 'Edit lines'}
                  </Text>
                </TouchableOpacity>
              )}
              {!isReadOnly && savedForThisAppNumber && (
                <TouchableOpacity
                  onPress={refreshFromContract}
                  style={styles.chip}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh the schedule of values from the estimate and approved change orders"
                  testID="aia-refresh-contract"
                >
                  <RefreshCw size={13} color={themeColors.text} strokeWidth={2} />
                </TouchableOpacity>
              )}
              <Text style={styles.sectionTitleCount}>{app.lines.length} items</Text>
            </View>
          </View>
          <Text style={styles.sectionHint}>
            Tap a line to adjust this period&apos;s work completed. Use the % slider to quickly set line progress.
          </Text>

          {/* Where column C came from. "Scheduled" is the whole contract line;
              "This Period" is this month's draw. They are equal only on a final
              billing — the pre-fix seeding set both from the same invoice line,
              which opened every certificate at 100% Complete.

              This copy used to end "Column C is not edited here", which was
              true when the G703 had no editor. It has one now — a schedule of
              values is negotiated with the owner and routinely does not match
              the estimate's line structure — so the note says where column C
              CAME FROM and points at both ways to change it. */}
          <Text style={styles.sovBasisNote} testID="aia-sov-basis">
            {sovBasis === 'linked_estimate'
              ? 'Scheduled Value is each line of the linked estimate plus each approved change order — the full contract, not this draw. This Period is what invoice #' + invoice.number + ' bills against it. Tap Edit lines to negotiate the schedule of values itself; anything you change there stays put, because a saved application is no longer rebuilt from the estimate when you reopen it.'
              : 'This project has no itemized estimate linked, so the Scheduled Value column could only be reconstructed from invoice #' + invoice.number + ' — it covers just the scope this invoice touched. Either link the job\u2019s estimate (Estimate \u2192 Link to Project) and refresh, or tap Edit lines and enter the agreed schedule of values directly.'}
          </Text>

          {sovReconciliation && !sovReconciliation.reconciled && (
            <View style={styles.sovWarnBanner} testID="aia-sov-reconciliation">
              <ShieldAlert size={16} color={Colors.warningLabel} strokeWidth={2} />
              <Text style={styles.sovWarnText}>
                The schedule of values totals {formatMoney(sovReconciliation.totalScheduledValue, 2)} but
                Contract Sum to Date is {formatMoney(sovReconciliation.contractSumToDate, 2)} —
                a {formatMoney(Math.abs(sovReconciliation.difference), 2)}{' '}
                {sovReconciliation.difference > 0 ? 'overage' : 'gap'}. % Complete is computed from this
                column and Balance to Finish from the contract sum, so they are telling a bank two
                different stories. Fix it in the project&apos;s estimate and its approved change orders and
                tap the refresh button above, or tap Edit lines and correct the schedule of values here.
              </Text>
            </View>
          )}

          {/* DEFENCE IN DEPTH for the two-NET-CHANGE-figures defect. Line 2
              and the printed four-row summary are driven from one date now, so
              this should be unreachable — say so loudly rather than print a
              page that contradicts itself if it ever is. */}
          {!coFiguresAgree && printedCoSummary && (
            <View style={styles.sovWarnBanner} testID="aia-co-figures-disagree">
              <ShieldAlert size={16} color={Colors.warningLabel} strokeWidth={2} />
              <Text style={styles.sovWarnText}>
                G702 line 2 says {formatMoney(app.netChangeByCO, 2)} of net change by change
                orders, but the CHANGE ORDER SUMMARY totals {formatMoney(printedCoSummary.netChange, 2)}.{' '}
                {/* The advice used to be one sentence naming PERIOD TO and the
                    refresh button. Both are gone on a read-only certificate —
                    which is every saved one until the GC taps Edit, and every
                    paid one for good. coFiguresAdvice answers for the state
                    the screen is actually in. */}
                {coFiguresAdvice({ isReadOnly, isLocked, editLabel: reviewNotice.editLabel })}
              </Text>
            </View>
          )}

          {(overBilledLines.length > 0 || totalOverBilled > 0.01) && (
            <View style={styles.sovWarnBanner} testID="aia-overbill-banner">
              <ShieldAlert size={16} color={Colors.warningLabel} strokeWidth={2} />
              <Text style={styles.sovWarnText}>
                {overBilledLines.length > 0 && (
                  `${overBilledLines.length} line${overBilledLines.length === 1 ? ' is' : 's are'} billed past ${overBilledLines.length === 1 ? 'its' : 'their'} scheduled value` +
                  ` (${overBilledLines.slice(0, 3).map(l => `#${l.itemNo} by ${formatMoney(l.overBy, 2)}`).join(', ')}` +
                  `${overBilledLines.length > 3 ? `, +${overBilledLines.length - 3} more` : ''}). `
                )}
                {totalOverBilled > 0.01 && (
                  `Total Completed & Stored exceeds Contract Sum to Date by ${formatMoney(totalOverBilled, 2)}. `
                )}
                Billing over a schedule of values is not printed as a rule on the G703, but it is what
                gets a pay application returned. Correct the amounts, or raise the scheduled values with
                an approved change order first.
              </Text>
            </View>
          )}

          {app.lines.map((line, lineIdx) => {
            const totalCompleted = line.fromPreviousApp + line.thisPeriod + line.materialsPresentlyStored;
            const pct = line.scheduledValue > 0 ? (totalCompleted / line.scheduledValue) * 100 : 0;
            // ONE definition, shared with findOverBilledLines — the row that
            // paints itself red and the banner that counts the rows must not
            // be two implementations of the same sentence.
            const over = lineOverBill(line);
            const isOver = over > 0;
            return (
              <View key={line.id} style={[styles.sovCard, isOver && styles.sovCardOver]}>
                <View style={styles.sovHeaderRow}>
                  {sovEditing && !isReadOnly ? (
                    <TextInput
                      style={styles.sovItemNoInput}
                      value={line.itemNo}
                      editable={!isReadOnly}
                      onChangeText={v => updateLine(line.id, { itemNo: v })}
                      placeholder="1.0"
                      placeholderTextColor={themeColors.textMuted}
                      testID={`aia-itemno-${line.id}`}
                    />
                  ) : (
                    <View style={styles.sovItemNoPill}>
                      <Text style={styles.sovItemNoText}>#{line.itemNo}</Text>
                    </View>
                  )}
                  {sovEditing && !isReadOnly ? (
                    <TextInput
                      style={[styles.formInput, { flex: 1 }]}
                      value={line.description}
                      editable={!isReadOnly}
                      onChangeText={v => updateLine(line.id, { description: v })}
                      placeholder="Description of work"
                      placeholderTextColor={themeColors.textMuted}
                      testID={`aia-desc-${line.id}`}
                    />
                  ) : (
                    <Text style={styles.sovDescription} numberOfLines={2}>{line.description}</Text>
                  )}
                </View>

                {sovEditing && !isReadOnly && (
                  <View style={styles.sovEditRow}>
                    <TouchableOpacity
                      onPress={() => moveLine(line.id, -1)}
                      disabled={lineIdx === 0}
                      style={[styles.sovEditBtn, lineIdx === 0 && styles.sovEditBtnOff]}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${line.description || line.itemNo} up`}
                      testID={`aia-move-up-${line.id}`}
                    >
                      <ChevronUp size={15} color={themeColors.textSecondary} strokeWidth={2} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveLine(line.id, 1)}
                      disabled={lineIdx === app.lines.length - 1}
                      style={[styles.sovEditBtn, lineIdx === app.lines.length - 1 && styles.sovEditBtnOff]}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${line.description || line.itemNo} down`}
                      testID={`aia-move-down-${line.id}`}
                    >
                      <ChevronDown size={15} color={themeColors.textSecondary} strokeWidth={2} />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity
                      onPress={() => deleteSovLine(line.id)}
                      style={styles.sovEditBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${line.description || line.itemNo}`}
                      testID={`aia-delete-${line.id}`}
                    >
                      <Trash2 size={15} color={Colors.warningLabel} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                )}

                {/* G703 COLUMN I — "Retainage (If variable rate)" — was
                    modelled on the line, summed into G702 line 5 and printed
                    on the continuation sheet, and NOTHING in the app could set
                    it: the only controls wrote one rate to every line at once,
                    so the column existed and was unreachable. A contract that
                    holds a different percentage on one trade is ordinary. */}
                {sovEditing && !isReadOnly && (
                  <View style={styles.sovRetainageRow}>
                    <Text style={styles.sovValueLabel}>Retainage on this line</Text>
                    <TextInput
                      style={[styles.formInput, { width: 66, textAlign: 'center' }]}
                      value={String(line.retainagePercent)}
                      editable={!isReadOnly}
                      onChangeText={(v) => {
                        const n = parseFloat(v.replace(/[^0-9.]/g, ''));
                        updateLine(line.id, { retainagePercent: isNaN(n) ? 0 : Math.max(0, Math.min(50, n)) });
                      }}
                      keyboardType="decimal-pad"
                      testID={`aia-line-retainage-${line.id}`}
                    />
                    <Text style={styles.sovValueLabel}>% · stored</Text>
                    <TextInput
                      style={[styles.formInput, { width: 66, textAlign: 'center' }]}
                      value={line.storedRetainagePercent == null ? '' : String(line.storedRetainagePercent)}
                      editable={!isReadOnly}
                      onChangeText={(v) => {
                        const cleaned = v.replace(/[^0-9.]/g, '');
                        const n = parseFloat(cleaned);
                        updateLine(line.id, {
                          storedRetainagePercent: cleaned === '' || isNaN(n)
                            ? undefined
                            : Math.max(0, Math.min(50, n)),
                        });
                      }}
                      keyboardType="decimal-pad"
                      placeholder="same"
                      placeholderTextColor={themeColors.textMuted}
                      testID={`aia-line-stored-retainage-${line.id}`}
                    />
                  </View>
                )}

                <View style={styles.sovValueRow}>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>Scheduled</Text>
                    {sovEditing && !isReadOnly ? (
                      <MoneyField
                        style={styles.sovInput}
                        value={line.scheduledValue}
                        onCommit={n => updateLine(line.id, { scheduledValue: n })}
                        testID={`aia-scheduled-${line.id}`}
                      />
                    ) : (
                      <Text style={styles.sovValueNum}>{formatMoney(line.scheduledValue)}</Text>
                    )}
                  </View>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>This Period</Text>
                    <MoneyField
                      style={styles.sovInput}
                      value={line.thisPeriod}
                      editable={!isReadOnly}
                      onCommit={n => updateLine(line.id, { thisPeriod: n })}
                      testID={`aia-this-period-${line.id}`}
                    />
                  </View>
                  <View style={styles.sovValueCol}>
                    <Text style={styles.sovValueLabel}>Stored</Text>
                    <MoneyField
                      style={styles.sovInput}
                      value={line.materialsPresentlyStored}
                      editable={!isReadOnly}
                      onCommit={n => updateLine(line.id, { materialsPresentlyStored: n })}
                      testID={`aia-stored-${line.id}`}
                    />
                  </View>
                </View>

                <View style={styles.sovProgressRow}>
                  <View style={styles.sovProgressBar}>
                    {/* The bar used to render Math.min(100, pct), so the one
                        screen where an over-bill is TYPED was also the one
                        screen that hid it: 118% showed as a full bar. It runs
                        past 100% in a warning colour now. */}
                    <View
                      style={[
                        styles.sovProgressFill,
                        { width: `${Math.min(100, pct)}%` as any },
                        isOver && styles.sovProgressFillOver,
                      ]}
                    />
                  </View>
                  <Text style={[styles.sovProgressPct, isOver && styles.sovProgressPctOver]}>
                    {pct.toFixed(0)}%
                  </Text>
                </View>

                {isOver && (
                  <Text style={styles.sovOverText} testID={`aia-overbill-${line.id}`}>
                    Billed {formatMoney(over, 2)} past this line&apos;s scheduled value. Architects
                    routinely return a continuation sheet showing a line over 100% — either correct
                    this period&apos;s amount, or raise the scheduled value with a change order first.
                  </Text>
                )}

                {line.materialsPresentlyStored > 0 && !isReadOnly && (
                  <TouchableOpacity
                    style={styles.sovInstalledBtn}
                    onPress={() => installStored(line.id, line.materialsPresentlyStored)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark stored material installed on ${line.description || line.itemNo}`}
                    testID={`aia-install-stored-${line.id}`}
                  >
                    <PackageCheck size={14} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.sovInstalledText}>
                      Installed this period — move {formatMoney(line.materialsPresentlyStored, 2)} from
                      Stored into This Period
                    </Text>
                  </TouchableOpacity>
                )}

                {!isReadOnly && (
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
                )}

                {/* Column F had no quick control at all while column E had
                    four, so stored material was the one figure on the
                    certificate that could only be typed — on the field that
                    could not accept a typed number. */}
                {!isReadOnly && (
                  <View style={styles.sovQuickRow}>
                    <Text style={styles.sovQuickLabel}>Stored</Text>
                    {[25, 50, 75].map(q => (
                      <TouchableOpacity
                        key={q}
                        onPress={() => updateLine(line.id, {
                          materialsPresentlyStored: roundCents(
                            Math.max(0, Math.min(
                              line.scheduledValue * (q / 100),
                              line.scheduledValue - line.fromPreviousApp - line.thisPeriod,
                            )),
                          ),
                        })}
                        style={styles.sovQuickBtn}
                        activeOpacity={0.7}
                        testID={`aia-stored-quick-${q}-${line.id}`}
                      >
                        <Text style={styles.sovQuickText}>{q}%</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={() => updateLine(line.id, { materialsPresentlyStored: 0 })}
                      style={styles.sovQuickBtn}
                      activeOpacity={0.7}
                      testID={`aia-stored-quick-clear-${line.id}`}
                    >
                      <Text style={styles.sovQuickText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          {!isReadOnly && (
            <View style={styles.sovEditorFooter}>
              <TouchableOpacity
                onPress={addSovLine}
                style={styles.sovFooterBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Add a schedule of values line"
                testID="aia-add-sov-line"
              >
                <Plus size={15} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.sovFooterBtnText}>Add line</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={renumberLines}
                style={styles.sovFooterBtn}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Renumber every line 1 to N"
                testID="aia-renumber"
              >
                <Text style={styles.sovFooterBtnText}>Renumber 1…N</Text>
              </TouchableOpacity>
            </View>
          )}
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
            {/* A deductive change-order line carries NEGATIVE retainage, which
                can make the certificate's total retainage a net add-back. The
                hardcoded "-" prefix printed "--$250.00" on that certificate,
                so the sign is chosen from the number. */}
            <Row
              label={`Retainage (${app.retainagePercent}% of work in place)`}
              value={totals.totalRetainage < 0
                ? `+${formatMoney(Math.abs(totals.totalRetainage))}`
                : `-${formatMoney(totals.totalRetainage)}`}
              dim
            />
            <Row label="Total Earned Less Retainage" value={formatMoney(totals.totalEarnedLessRetainage)} />
            <Row label="Less Previous Certificates" value={`-${formatMoney(app.lessPreviousCertificates)}`} dim />
            <Divider />
            <Row label="Current Payment Due" value={formatMoney(totals.currentPaymentDue)} highlight />
            <Row label="Balance to Finish" value={formatMoney(totals.balanceToFinish)} dim />
          </View>

          {/* Fintech revenue CTAs — surfaced contextually next to the
              dollar figures. Pay-app moments are the highest-value moment
              for both factoring and lien-waiver products. */}
          {totals.currentPaymentDue > 0 && (
            <>
              <RevenueEarlyAccessCard
                eventKey="revenue.factoring.altline"
                icon={Banknote}
                headline={`Advance ${formatMoney(totals.currentPaymentDue * 0.9)} on this pay app today`}
                body="Pay-app funds sit with the owner until they certify and release. A factoring partner would front the balance against this certified amount instead."
                footer="Partner LOI in progress · early access shipping Q3 2026"
                testID="aia-factoring-cta"
              />
              <RevenueEarlyAccessCard
                eventKey="revenue.lien_waiver.escrow"
                icon={FileSignature}
                headline="Auto-generate lien waivers at payment"
                body="When this pay app is funded, MAGE drafts conditional & unconditional waivers for every sub paid out of it. E-sign in one tap. Optional bank-held escrow for big jobs."
                footer="Built on existing lien-waiver tool · escrow needs partner bank"
                testID="aia-lienwaiver-cta"
              />
            </>
          )}
        </View>
      </ScrollView>

      {savedForThisAppNumber && (
        <SendToClientButton
          kind="aia_pay_app"
          itemId={savedForThisAppNumber.id}
          projectId={savedForThisAppNumber.projectId}
          portalState={savedForThisAppNumber.portalState}
          itemUpdatedAt={savedForThisAppNumber.savedAt}
          canSend={app.lines.length > 0}
          canSendReason={app.lines.length === 0 ? 'Add schedule of values lines before sending.' : undefined}
        />
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={onBottomBarLayout}>
        {isReviewMode ? (
          // Review mode reprints the STORED record. No save, no pay link, no
          // re-derivation — that is the whole point of it.
          <View style={styles.bottomBarRow}>
            <TouchableOpacity
              style={[styles.generateBtn, { flex: 1 }]}
              onPress={handleReprint}
              disabled={generating}
              activeOpacity={0.85}
              testID="aia-reprint-bottom"
            >
              {generating
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Printer size={18} color="#FFF" strokeWidth={1.75} />
              }
              <Text style={styles.generateBtnText}>
                {generating ? 'Generating…' : 'Print as saved'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.bottomBarRow}>
          <TouchableOpacity
            style={[styles.saveBtn, savedFlash && styles.saveBtnDone]}
            onPress={handleSave}
            activeOpacity={0.85}
          >
            {savedFlash
              ? <Check size={18} color={themeColors.accent} strokeWidth={1.75} />
              : <Save size={18} color={themeColors.accent} strokeWidth={1.75} />
            }
            <Text style={styles.saveBtnText}>
              {savedFlash ? 'Saved to project' : 'Save to project'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.generateBtn, { flex: 1 }]}
            onPress={requestGenerate}
            disabled={generating}
            activeOpacity={0.85}
          >
            {generating
              ? <ActivityIndicator size="small" color="#FFF" />
              : <Printer size={18} color="#FFF" strokeWidth={1.75} />
            }
            <Text style={styles.generateBtnText}>
              {generating ? 'Generating…' : 'Generate PDF'}
            </Text>
          </TouchableOpacity>
        </View>
        )}
        <Text style={styles.bottomBarHint}>
          Saved pay applications appear in your client portal so owners and architects can review and download.
        </Text>
      </View>

      {/* First-use AIA disclaimer — shown once per device, then never again. */}
      <Modal
        visible={showFirstUseDisclaimer}
        transparent
        animationType="fade"
        onRequestClose={dismissFirstUseDisclaimer}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <ShieldAlert size={26} color="#C26A00" strokeWidth={1.75} />
            </View>
            <Text style={styles.modalTitle}>Heads up — quick legal note</Text>
            <Text style={styles.modalBody}>
              MAGE ID generates draft pay applications styled after AIA G702 / G703.{' '}
              <Text style={styles.modalBodyEmph}>
                AIA® and &quot;AIA Document G702/G703&quot; are registered trademarks of The American Institute of Architects, which is not affiliated with MAGE ID.
              </Text>
              {'\n\n'}
              Some lenders or architects only accept the official AIA Contract Documents. Verify all amounts, retainage, and certification language with the parties involved before submission.
              {'\n\n'}
              <Text style={styles.modalBodyEmph}>
                You are solely responsible for the accuracy of every figure on the document you submit.
              </Text>
            </Text>
            <TouchableOpacity style={styles.modalCta} onPress={dismissFirstUseDisclaimer}>
              <Text style={styles.modalCtaText}>I understand</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pre-export confirmation — shown every time before generating. */}
      <Modal
        visible={showPreExportConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPreExportConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <ShieldAlert size={24} color="#C26A00" strokeWidth={1.75} />
            </View>
            <Text style={styles.modalTitle}>Ready to certify?</Text>
            <Text style={styles.modalBody}>
              Have you reviewed every line item, total, and retainage value on this pay application?
              {'\n\n'}
              <Text style={styles.modalBodyEmph}>
                Once submitted, you certify these figures are accurate. The contractor named on this document is solely responsible for what&apos;s on it.
              </Text>
            </Text>
            <View style={styles.modalCtaRow}>
              <TouchableOpacity
                style={styles.modalCtaSecondary}
                onPress={() => setShowPreExportConfirm(false)}
              >
                <Text style={styles.modalCtaSecondaryText}>Let me re-check</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCta} onPress={handleGenerate}>
                <Text style={styles.modalCtaText}>I&apos;ve reviewed it · Generate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * A money TextInput that can actually accept a typed number.
 *
 * THE BUG THIS EXISTS TO KILL. The two money fields on the schedule of values
 * were bound `value={line.thisPeriod.toFixed(2)}` — a CONTROLLED input whose
 * value is re-derived from numeric state on every keystroke. Type "4": state
 * becomes 4, the input is forced back to "4.00", and the caret lands after the
 * reformatted text. Type "5": the string is now "4.005", which parses to 4, so
 * the input is forced back to "4.00" again. Typing 4500 records $4.00. These
 * were the only two `value={…toFixed(2)}` TextInput bindings in the repo;
 * every other money field in the app (app/invoice.tsx) holds a raw string.
 *
 * The contract here: hold the raw edit string locally, commit the parsed
 * number on every change so the totals stay live, and re-format ONLY on blur.
 * A change to `value` that did NOT come from this field (a quick-% tap, "Sync
 * from schedule", an install-stored move) drops the draft so the field shows
 * the new truth instead of a stale keystroke.
 */
function MoneyField({
  value, onCommit, editable = true, style, testID, placeholder,
}: {
  value: number;
  onCommit: (n: number) => void;
  editable?: boolean;
  style?: any;
  testID?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const lastCommitted = React.useRef(value);
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setDraft(null);
    }
  }, [value]);
  return (
    <TextInput
      style={style}
      value={draft ?? value.toFixed(2)}
      editable={editable}
      onChangeText={(v) => {
        setDraft(v);
        const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
        const next = Number.isNaN(n) ? 0 : n;
        lastCommitted.current = next;
        onCommit(next);
      }}
      onBlur={() => setDraft(null)}
      keyboardType="decimal-pad"
      selectTextOnFocus
      testID={testID}
      placeholder={placeholder}
    />
  );
}

function Row({ label, value, bold, dim, highlight }: { label: string; value: string; bold?: boolean; dim?: boolean; highlight?: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.totalsRow}>
      <Text style={[styles.totalsLabel, dim && { color: themeColors.textMuted }]}>{label}</Text>
      <Text style={[
        styles.totalsValue,
        bold && { fontWeight: '700' },
        dim && { color: themeColors.textMuted },
        highlight && { color: themeColors.accent, fontSize: Type.body.fontSize, fontWeight: '800' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.totalsDivider} />;
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  // Carry-forward indicator — sits between the hero header and the stats
  // strip. Tells the GC the prior period's billings were rolled in so they
  // know NOT to manually re-enter them.
  carriedRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1,
    borderColor: themeColors.accent + '30',
  },
  carriedText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: themeColors.text,
    fontWeight: '500' as const,
  },
  container: { flex: 1, backgroundColor: themeColors.bg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: themeColors.bg },

  // Step-2 chooser: "which billing period". Deliberately the same rhythm as
  // ToolProjectPicker's rows (components/ToolScreenChrome.tsx) — it is the
  // second half of one decision, not a different kind of screen.
  periodPickContent: { padding: 16, paddingBottom: 48 },
  periodPickLead: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 19, marginBottom: 16 },
  periodPickTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 10 },
  periodPickRow: {
    ...cardSurface(themeColors, { radius: 'card', pad: 14 }),
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginBottom: 8,
  },
  periodPickRowTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  periodPickRowMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  periodPickAlt: { alignItems: 'center' as const, paddingVertical: 12, marginTop: 4 },
  periodPickAltText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  loadingText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textMuted },

  // Audit-2026-05-21 (#28.1) — locked-period banner styles. Amber accent
  // matches the FeatureHeader eyebrow + signals "warning, not error."
  lockedBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.accent + '15',
    borderWidth: 1,
    borderColor: themeColors.accent + '40',
  },
  lockedBannerTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    marginBottom: 4,
  },
  lockedBannerBody: {
    fontSize: Type.footnote.fontSize,
    lineHeight: 18,
    color: themeColors.textSecondary,
    marginBottom: 10,
  },
  lockedBannerCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: themeColors.accentFill,
  },
  lockedBannerCtaText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },

  hero: {
    margin: 16, padding: 16, borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.accent + '10',
    borderWidth: 1, borderColor: themeColors.accent + '30',
  },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroTitleBlock: { flex: 1 },
  heroLabel: { fontSize: 10, color: themeColors.accent, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  heroTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: themeColors.text, marginBottom: 2 },
  heroSub: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },
  progressBadge: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: themeColors.accentFill, borderRadius: 50,
    width: 68, height: 68,
  },
  progressBadgeNum: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: '#FFF', lineHeight: 20 },
  progressBadgeLabel: { fontSize: 9, color: '#FFFFFFCC', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  heroStats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  heroStat: { flex: 1, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 12, borderWidth: 1, borderColor: themeColors.line },
  heroStatLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontWeight: '600', marginBottom: 4 },
  heroStatValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text },
  heroStatSub: { fontSize: 10, color: themeColors.textMuted, marginTop: 2 },

  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: themeColors.text, marginBottom: 4 },
  sectionTitleCount: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  sovHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 16 },

  formRow: { marginBottom: 10 },
  formLabel: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 4, fontWeight: '600' },
  formInput: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.bodyCompact.fontSize, color: themeColors.text,
  },

  retainageChips: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  retainageSourceNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16, marginTop: 6 },
  sovBasisNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16, marginBottom: 10 },
  sovWarnBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    padding: 12,
    marginBottom: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.warning + '15',
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  sovWarnText: { flex: 1, fontSize: Type.footnote.fontSize, lineHeight: 18, color: themeColors.text },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  chipActive: { backgroundColor: themeColors.accentFill, borderColor: themeColors.accent },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text },
  chipTextActive: { color: '#FFF' },

  sovCard: {
    ...cardSurface(themeColors, { radius: 'lg', pad: 12 }),
    marginBottom: 10,
  },
  sovHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  sovItemNoPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.accent + '15',
  },
  sovItemNoText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent },
  sovDescription: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text, lineHeight: 18 },

  sovValueRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sovValueCol: { flex: 1 },
  sovValueLabel: { fontSize: 10, color: themeColors.textMuted, fontWeight: '600', marginBottom: 4 },
  sovValueNum: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text },
  sovInput: {
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 8, paddingVertical: 8, fontSize: Type.footnote.fontSize, color: themeColors.text,
  },

  sovProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sovProgressBar: { flex: 1, height: 6, backgroundColor: themeColors.line, borderRadius: 3, overflow: 'hidden' },
  sovProgressFill: { height: '100%', backgroundColor: themeColors.success, borderRadius: 3 },
  sovProgressPct: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.text, width: 38, textAlign: 'right' },

  sovQuickRow: { flexDirection: 'row', gap: 6 },
  sovQuickBtn: {
    flex: 1, paddingVertical: 6, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.bg, alignItems: 'center',
    borderWidth: 1, borderColor: themeColors.line,
  },
  sovQuickText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: themeColors.text },
  sovQuickLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textMuted,
    alignSelf: 'center' as const, width: 44,
  },

  // Over-billed line: the card, the bar and the numeral all say so. The bar
  // used to clamp at 100%, which meant the one screen where an over-bill is
  // typed was also the screen that hid it.
  sovCardOver: { borderColor: Colors.warning + '80', backgroundColor: Colors.warning + '0C' },
  sovProgressFillOver: { backgroundColor: Colors.warning },
  sovProgressPctOver: { color: Colors.warningLabel },
  sovOverText: {
    fontSize: Type.caption2.fontSize, lineHeight: 16, color: Colors.warningLabel,
    fontWeight: '600', marginBottom: 8,
  },

  sovItemNoInput: {
    width: 58, paddingHorizontal: 6, paddingVertical: 6, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.text,
    textAlign: 'center' as const,
  },
  sovEditRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 10 },
  sovEditBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  sovEditBtnOff: { opacity: 0.35 },
  chipOff: { opacity: 0.4 },
  sovEditorFooter: { flexDirection: 'row' as const, gap: 8, marginTop: 2 },
  sovFooterBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 10, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  sovFooterBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.accent },

  /** A date the consumers cannot parse, stated at the field rather than
   *  silently swallowed by dayKey / onOrBeforeDay. */
  fieldError: {
    fontSize: Type.caption1.fontSize, color: Colors.warningLabel,
    lineHeight: 16, marginTop: 4, marginBottom: 6,
  },
  certSaveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 10, marginTop: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  sovRetainageRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 10,
  },

  sovInstalledBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8,
    borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12',
    borderWidth: 1, borderColor: themeColors.accent + '33',
  },
  sovInstalledText: { flex: 1, fontSize: Type.caption2.fontSize, lineHeight: 16, color: themeColors.text, fontWeight: '600' },

  notaryToggleRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingVertical: 10, marginTop: 4,
  },
  notaryToggleText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  checkbox: {
    width: 20, height: 20, borderRadius: Tokens.radius.xs,
    borderWidth: 1.5, borderColor: themeColors.line,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  checkboxOn: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },

  reviewBanner: {
    padding: 14, marginHorizontal: 16, marginBottom: 12, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  reviewBannerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 6 },
  reviewBannerTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: themeColors.text },
  reviewBannerBody: { fontSize: Type.footnote.fontSize, lineHeight: 18, color: themeColors.textSecondary },
  reviewBannerActions: { flexDirection: 'row' as const, gap: 8, marginTop: 10 },

  totalsCard: cardSurface(themeColors, { radius: 'lg', pad: 14 }),
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalsLabel: { fontSize: Type.footnote.fontSize, color: themeColors.text },
  totalsValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: themeColors.text },
  totalsDivider: { height: 1, backgroundColor: themeColors.line, marginVertical: 6 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: themeColors.bg,
    borderTopWidth: 1, borderTopColor: themeColors.line,
    paddingHorizontal: 16, paddingTop: 12,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: themeColors.accentFill, borderRadius: Tokens.radius.card,
    paddingVertical: 14,
  },
  generateBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: '#FFF' },
  bottomBarRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 14, paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  saveBtnDone: { backgroundColor: themeColors.accent + '20', borderColor: themeColors.accent },
  saveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.accent },
  bottomBarHint: {
    fontSize: Type.caption2.fontSize, color: themeColors.textMuted, textAlign: 'center',
    marginTop: 8, lineHeight: 15,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(11,13,16,0.55)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: themeColors.bg,
    borderRadius: 20,
    padding: 24,
    maxWidth: 440, width: '100%',
    borderWidth: 1, borderColor: themeColors.line,
  },
  modalIconWrap: {
    width: 48, height: 48, borderRadius: Tokens.radius.lg,
    backgroundColor: '#FFF4E0',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: themeColors.text, marginBottom: 12, letterSpacing: -0.3 },
  modalBody: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 20 },
  modalBodyEmph: { fontWeight: '700', color: themeColors.text },
  modalCta: {
    backgroundColor: themeColors.text,
    paddingVertical: 13, paddingHorizontal: 18,
    borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 16,
    flex: 1,
  },
  modalCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
  modalCtaRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCtaSecondary: {
    backgroundColor: themeColors.surface,
    paddingVertical: 13, paddingHorizontal: 18,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center', justifyContent: 'center',
    flex: 1,
  },
  modalCtaSecondaryText: { color: themeColors.text, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
});
