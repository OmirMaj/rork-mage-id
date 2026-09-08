import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
  ShieldAlert, CheckCircle2,
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
} from '@/utils/aiaBilling';
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
  const approvedCOs = useMemo(() =>
    (invoice && project ? getChangeOrdersForProject(project.id).filter(co => co.status === 'approved') : []),
    [invoice, project, getChangeOrdersForProject]);

  const [app, setApp] = useState<AIAPayApplication | null>(null);
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
    const all = getAIAPayAppsForProject(project.id);
    // Pick the highest applicationNumber that's strictly less than the one
    // we're about to seed (which equals the count of prior apps + 1).
    const others = all.filter(a => a.invoiceId !== invoice.id);
    return [...others].sort((a, b) => b.applicationNumber - a.applicationNumber)[0] ?? null;
  }, [project, invoice, getAIAPayAppsForProject]);

  const [carriedFromAppNumber, setCarriedFromAppNumber] = useState<number | null>(null);
  // MISS-05: the retainage rate on this certificate is now CARRIED from the
  // source invoice (including a real 0%) instead of falling back to an invented
  // 10%. Track whether the GC has since overridden it, so the screen can say
  // where the number on the G702 actually came from.
  const [retainageEdited, setRetainageEdited] = useState(false);
  const invoiceRetainagePct = invoice ? retainagePercentForInvoice(invoice) : 0;

  useEffect(() => {
    if (!invoice || !project || !settings?.branding) return;
    const seeded = seedAIAPayApplicationFromInvoice(invoice, project, approvedCOs, settings.branding);
    setRetainageEdited(false);
    // Carry-forward: when there's a prior saved pay app, pre-fill each line's
    // fromPreviousApp with what was billed through the end of the prior
    // period (prior.fromPreviousApp + prior.thisPeriod), and pre-fill the
    // G702 "less previous certificates" with the prior period's earned
    // amount net of retainage.
    //
    // The matching itself lives in utils/aiaBilling.carryForwardPriorLines —
    // it keys on the SOV line id and falls back to itemNo, because the
    // schedule of values is no longer numbered over the invoice's lines (see
    // buildAIASovLines), so itemNo alone lands a row off after a CO is
    // approved or on any application saved before that change. It is money
    // math on a bank document, so it is a pure function
    // scripts/validate-invoice-billing.ts executes.
    if (priorAIA && priorAIA.lines.length > 0) {
      const carried = {
        ...seeded,
        applicationNumber: priorAIA.applicationNumber + 1,
        lines: carryForwardPriorLines(seeded.lines, priorAIA.lines),
        // MONEY-F1 (client half): a record hydrated from the server can arrive
        // without `totals`; the second period must not crash on it.
        lessPreviousCertificates: priorAIA.totals?.totalEarnedLessRetainage ?? 0,
      };
      setApp(carried);
      setCarriedFromAppNumber(priorAIA.applicationNumber);
    } else {
      setApp(seeded);
      setCarriedFromAppNumber(null);
    }
  }, [invoice, project, approvedCOs, settings?.branding, priorAIA]);

  const totals = useMemo(() => (app ? computeAIATotals(app) : null), [app]);

  // Audit 2026-09-07 ("Do next" #3). G702 line 3 (Contract Sum to Date) and the
  // G703 column C total are two statements of the same contract. When they
  // disagree, at least one number on the certificate the GC is about to sign is
  // wrong — most often because the project has no linked estimate, so the SOV
  // could only be reconstructed from this one invoice and knows nothing about
  // the scope the invoice didn't touch. Say so on the screen; do not print both
  // figures side by side and let a bank find the gap.
  const sovReconciliation = useMemo(() => (app ? reconcileAIASov(app) : null), [app]);

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
  const savedForThisAppNumber = useMemo(() => {
    if (!project || !app) return null;
    return getAIAPayAppsForProject(project.id).find(a => a.applicationNumber === app.applicationNumber) ?? null;
  }, [project, app, getAIAPayAppsForProject]);
  // MONEY-F2 / F16: `paidAt` is set by the Stripe webhook and hydrated by the
  // context mapper; read defensively so an older local record reads "unpaid".
  const savedPaidAt = (savedForThisAppNumber as (SavedAIAPayApp & { paidAt?: string }) | null)?.paidAt || null;
  const isLocked = !!savedForThisAppNumber?.payLinkUrl || !!savedPaidAt;

  const updateLine = useCallback((lineId: string, patch: Partial<AIASOVLine>) => {
    if (isLocked) return;
    setApp(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => l.id === lineId ? { ...l, ...patch } : l),
    } : prev);
  }, [isLocked]);

  const applyPercentToLine = useCallback((lineId: string, percent: number) => {
    if (isLocked) return;
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
  }, [isLocked]);

  const updateRetainagePctAll = useCallback((pct: number) => {
    if (isLocked) return;
    setRetainageEdited(true);
    setApp(prev => prev ? {
      ...prev,
      retainagePercent: pct,
      lines: prev.lines.map(l => ({ ...l, retainagePercent: pct })),
    } : prev);
  }, [isLocked]);

  // v2.3 wedge A2 — sync schedule progress to AIA lines.
  // v2.4 (Item 4) — Honor per-line linkedTaskId bindings: a line with
  // linkedTaskId set uses THAT task's progress for itself; lines without
  // a binding fall back to the project-level EV %. Gives per-trade billing
  // accuracy when the GC has bound SOV lines to schedule tasks.
  const handleSyncFromSchedule = useCallback(() => {
    if (isLocked) {
      showAlert(
        'Period locked',
        'This pay application has been generated with a payment link. Create the next period to revise.'
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
  }, [project, app, applyPercentToLine, isLocked]);

  // Build a portable SavedAIAPayApp record from the in-memory app + computed
  // totals. Used both for the explicit "Save to Project" tap and as a
  // side-effect of generating the PDF (so the portal always has the latest
  // billing once the GC has gone through the trouble of producing it).
  const buildSavedRecord = useCallback((): SavedAIAPayApp | null => {
    if (!app || !project || !totals) return null;
    const existing = getAIAPayAppsForProject(project.id).find(a => a.applicationNumber === app.applicationNumber);
    return {
      id: existing?.id ?? generateUUID(),
      projectId: project.id,
      invoiceId: invoice?.id,
      applicationNumber: app.applicationNumber,
      applicationDate: app.applicationDate,
      periodTo: app.periodTo,
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
      lessPreviousCertificates: app.lessPreviousCertificates,
      lines: app.lines.map(l => ({
        id: l.id,
        itemNo: l.itemNo,
        description: l.description,
        scheduledValue: l.scheduledValue,
        fromPreviousApp: l.fromPreviousApp,
        thisPeriod: l.thisPeriod,
        materialsPresentlyStored: l.materialsPresentlyStored,
        retainagePercent: l.retainagePercent,
        linkedTaskId: l.linkedTaskId, // v2.4 — preserve per-line schedule binding
      })),
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
  }, [app, project, totals, invoice?.id, getAIAPayAppsForProject]);

  const handleSave = useCallback(async () => {
    if (isLocked) {
      showAlert(
        'Period locked',
        'This pay application has already been generated and a payment link is active. To revise the numbers, create the next period instead.'
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
    // MONEY-F2: never mint a Pay button for a pay app that is already paid.
    if (!payLinkUrl && due > 0 && !savedPaidAt && user?.id) {
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
  }, [buildSavedRecord, addAIAPayApp, user, settings, router, isLocked, savedPaidAt, tier]);

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

  const handleGenerate = useCallback(async () => {
    setShowPreExportConfirm(false);
    if (!app || !settings?.branding) return;
    setGenerating(true);
    try {
      await generateAIAPayAppPDF(app, settings.branding);
      // Persist + attach pay link via the same code path as handleSave so
      // the portal-side rendering of this AIA app gets a Pay button.
      await handleSave();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showAlert('Error', 'Could not generate the pay application PDF.');
    } finally {
      setGenerating(false);
    }
  }, [app, settings?.branding, handleSave]);

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
              onChangeText={v => setApp(p => p ? { ...p, architectName: v } : p)}
              placeholder="Optional"
              placeholderTextColor={themeColors.textMuted}
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
              placeholderTextColor={themeColors.textMuted}
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
          <Text style={styles.retainageSourceNote}>
            Withheld on completed work and stored materials (G702 line 5) — never on sales tax.
          </Text>
        </View>

        {/* Schedule of Values */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Schedule of Values (G703)</Text>
            <View style={styles.sovHeaderActions}>
              <TouchableOpacity
                onPress={handleSyncFromSchedule}
                style={styles.chip}
                activeOpacity={0.8}
                testID="aia-sync-from-schedule"
              >
                <Text style={styles.chipText}>Sync from schedule</Text>
              </TouchableOpacity>
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

              Scheduled Value is READ-ONLY here and the G703 has no
              add/edit/delete (the audit's "Do next" #3 says so in as many
              words), so this copy must never tell the GC to fix the lines on
              this screen. Column C is rebuilt from the project's estimate and
              its approved change orders every time this screen opens — that is
              where the fix actually is, and it is what this says. */}
          <Text style={styles.sovBasisNote} testID="aia-sov-basis">
            {app.sovBasis === 'linked_estimate'
              ? 'Scheduled Value is each line of the linked estimate plus each approved change order — the full contract, not this draw. This Period is what invoice #' + invoice.number + ' bills against it. Column C is not edited here: it is rebuilt from the estimate and the approved COs each time you open this application.'
              : 'This project has no itemized estimate linked, so the Scheduled Value column could only be reconstructed from invoice #' + invoice.number + ' — it covers just the scope this invoice touched. Column C is not edited here: link the job\u2019s estimate to this project (Estimate \u2192 Link to Project), then reopen this application to certify against the whole contract.'}
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
                different stories. Scheduled Value cannot be edited on this screen — correct the project&apos;s
                estimate and its approved change orders, then reopen this application.
              </Text>
            </View>
          )}

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
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: themeColors.line, padding: 14, marginBottom: 8,
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
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: themeColors.line,
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

  totalsCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: themeColors.line,
  },
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
