import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, ActivityIndicator, type LayoutChangeEvent} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, useBrainFabLift, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Trash2, X, Send, CreditCard, Check, BookUser, User, Percent, Unlock, FileSpreadsheet,
  Link2, Copy, Share2, FileText, Receipt, BellRing, Square, SquareCheck,
} from 'lucide-react-native';
import { MageAIMark, MageInvoice } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { shareText } from '@/utils/shareText';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Button } from '@/components/ui/Button';
import { cardSurface } from '@/components/ui';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import AIInvoicePredictor from '@/components/AIInvoicePredictor';
import ContactPickerModal from '@/components/ContactPickerModal';
import { generateInvoicePDF, generateInvoicePDFUri } from '@/utils/pdfGenerator';
import { legacyEvmMetrics } from '@/utils/scheduleEarnedValue';
import * as Sharing from 'expo-sharing';
import PDFPreSendSheet from '@/components/PDFPreSendSheet';
import type { PDFSendOptions } from '@/components/PDFPreSendSheet';
import { sendEmail, buildInvoiceEmailHtml } from '@/utils/emailService';
import { useFinancingReferrals } from '@/hooks/useFinancingReferrals';
import { financingEmailBlockHtml, isFinancingAvailable } from '@/utils/financing';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import { parseInvoiceFromTranscript, mergeText } from '@/utils/voiceFormParsers';
import { getEffectiveInvoiceStatus, getDaysPastDue } from '@/utils/projectFinancials';
import { createPaymentLink } from '@/utils/stripe';
import { RevenueEarlyAccessCard } from '@/components/RevenueEarlyAccessCard';
import { Banknote, HandCoins } from 'lucide-react-native';
import { fetchStripeConnectStatus, resolveStripeAccount } from '@/utils/stripeConnect';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useAuth } from '@/contexts/AuthContext';
import { loadCashFlowSettings } from '@/utils/cashFlowStorage';
import { nailIt } from '@/components/animations/NailItToast';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import type { InvoiceLineItem, Invoice, InvoiceStatus, PaymentTerms, PaymentMethod, InvoicePayment } from '@/types';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { buildRetainageReleasePatch, PAYMENT_TERM_DAYS } from '@/utils/retainage';
import { resolveRetainagePercent, retainageAnswerPatch, isRecordedRetainageRate } from '@/utils/retainageSource';

// Happy-path lifecycle for an invoice. partially_paid + overdue map back to
// "Sent" in the visual since the invoice is mid-flight to "Paid"; the
// dueAt prop on StatusPipeline already colors the days-pill red when past
// the due date so overdue is communicated visually without breaking the
// pipeline into a side branch.
const INVOICE_PIPELINE_STAGES: PipelineStage<InvoiceStatus>[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid', terminal: true },
];

function mapInvoiceStatus(s: InvoiceStatus): InvoiceStatus {
  if (s === 'partially_paid' || s === 'overdue') return 'sent';
  return s;
}
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { copyToClipboard } from '@/utils/clipboard';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { safeJsonParse } from '@/utils/safeJson';
import {
  progressSubtotal,
  netBalanceDue,
  invoiceIsSettled,
  roundCents,
  retainageOnWorkValue,
  pendingRetentionHeld,
  taxBasisRetentionOverhold,
} from '@/utils/invoiceBilling';
import { billFromEstimateUnitPrice } from '@/utils/billFromEstimateCore';
import { isGcOnlyEstimateLine, CLIENT_CONTINGENCY_LABEL } from '@/utils/clientEstimateView';
import { formatMoney } from '@/utils/formatters';
import { markMilestoneInvoiced, markMilestonePaidByInvoice } from '@/utils/contractEngine';
import {
  reminderEligibility, reminderBlockMessage, reminderSentLabel, dunningStageLabel,
  payLinkAmountBlock, payLinkFailureReason, sentWithoutPayButtonMessage,
  nextInvoiceNumberFrom, sessionIssuedInvoiceMax, noteIssuedInvoiceNumber, reminderRecipient,
  milestoneContractTermsCaption, recordPaymentDecision, parsePositiveMoney, parsePercentInput,
  paymentReceivedDay, type RecordedPaymentFields, paymentPendingHolds,
  invoicesVisibleInPortal, invoicePayableInPortal, PORTAL_INVOICES_HIDDEN_HINT, reminderCarriesPortalLink,
  INVOICE_INSERT_QUEUED_REASON, INVOICE_INSERT_UNCONFIRMED_REASON, invoiceInsertRefusedMessage, invoiceUnsavedOnServerMessage,
  STRIPE_UNREACHABLE_REASON, PAYMENT_PENDING_MINT_REASON, STRIPE_NOT_CONNECTED_REASON, invoiceRoleGate, invoiceRoleBlockedCopy,
  INVOICE_OWNER_ONLY_REASON, type InvoiceRoleGate, invoiceTaxSeed, invoiceTaxSourceLabel,
} from '@/utils/billingFlowCore';
import { afterRecordedPayment, type ServerInvoiceSettlement } from '@/utils/invoiceWrites';
import { supabase } from '@/lib/supabase';
import { parseMoneyInput } from '@/utils/cashFlowEngine';
import { formatCalendarDay, todayCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import DatePickerModal from '@/components/DatePickerModal';
import { getOfflineQueue } from '@/utils/offlineQueue';
import { unsavedWriteIds, unsavedPaymentAppends, requestSyncSheet, hasUnsavedChainForSession } from '@/utils/syncLedger';
import { pendingIdsForTable } from '@/utils/projectContextPure';
import { sendInvoiceReminderNow } from '@/utils/invoiceReminders';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '@/utils/alert';
import { qboClosedFlagOf, qboClosedFlagAlertReason } from '@/utils/qboClosedFlag';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';
import { pdfFailureMessage } from '@/utils/platformFile';

function createId(_prefix: string): string {
  return generateUUID();
}

// HEALTH-F5: sign-correct money — one formatter (utils/formatters), no local Math.abs copy.
const formatCurrency = (n: number): string => formatMoney(n, 2);

// The per-device session invoice-number max (#3 part c) lives in
// utils/billingFlowCore so app/bill-from-estimate.tsx shares it.

/**
 * The billing contact a send stores on the invoice (#47), so reminders go to
 * the address the invoice actually went to. Optional fields the shared types
 * gain in wave 3; declared here so this screen compiles either way.
 */
type InvoiceBillTo = { billToEmail?: string; billToName?: string };

const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: 'due_on_receipt', label: 'Due on Receipt' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
];

// <invoice-terms-default> — keep byte-identical in app/invoice.tsx and
// app/bill-from-estimate.tsx; scripts/validate-invoice-terms.ts executes both
// copies and fails if they drift.
//
// The GC already told the app how he gets paid: cash-flow setup asks for his
// payment terms (CashFlowData.defaultPaymentTerms), and the forecast times
// every receivable by it. New invoices used to open on a hard-coded Net 30
// anyway, so a GC on Net 15 issued Net 30 paper while his forecast expected
// the money two weeks earlier. This turns his setting into the default.
//
// It is only HIS setting when he finished cash-flow setup and the value came
// from a real record (server row or device cache). The three origins keep the
// picker's caption honest:
//   cash_flow_setup — his finished setup names one of the four terms.
//   fallback        — a real record answered, and it holds no usable terms
//                     (setup unfinished, or a value like net_60 / "2/10 net 30"
//                     that is never forced onto the nearest term).
//   unconfirmed     — nothing answered. `source: 'default'` is the loader's
//                     own net_30 placeholder, and the loader returns it both
//                     for "no row" and for "the server read failed with no
//                     device cache" (utils/cashFlowStorage swallows the error),
//                     so it cannot be told apart from an outage and must not
//                     be captioned as "you have no setting".
// The two vocabularies are the same four keys today; the normaliser tolerates
// spacing/case drift ("Net 15", "net-15", "NET15") because the column is free
// text.
type InvoiceTermsDefault = {
  terms: 'net_15' | 'net_30' | 'net_45' | 'due_on_receipt';
  // 'contract' never comes out of this block: app/invoice.tsx sets it when a
  // signed contract row already fixed the terms (utils/billingFlowCore
  // milestoneContractTerms), and nothing in cash-flow setup may overwrite it.
  origin: 'cash_flow_setup' | 'fallback' | 'unconfirmed' | 'contract';
};
type CashFlowTermsSettings = { data?: { defaultPaymentTerms?: unknown } | null; setupComplete?: boolean; source?: string } | null | undefined;
function invoiceTermsDefaultFromCashFlow(settings: CashFlowTermsSettings): InvoiceTermsDefault {
  const unconfirmed: InvoiceTermsDefault = { terms: 'net_30', origin: 'unconfirmed' };
  const fallback: InvoiceTermsDefault = { terms: 'net_30', origin: 'fallback' };
  if (!settings || settings.source === 'default') return unconfirmed;
  if (settings.setupComplete !== true) return fallback;
  const raw = settings.data?.defaultPaymentTerms;
  if (typeof raw !== 'string') return fallback;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const net = /^net_?(\d+)$/.exec(key);
  const normalised = net ? `net_${Number(net[1])}` : key.replace(/^(due_)?(up)?on_receipt$/, 'due_on_receipt');
  if (normalised === 'net_15' || normalised === 'net_30' || normalised === 'net_45' || normalised === 'due_on_receipt') {
    return { terms: normalised, origin: 'cash_flow_setup' };
  }
  return fallback;
}
// The server read-through, bounded. Offline, the Supabase fetch can hang far
// longer than a GC will wait on an invoice, so past the budget the read counts
// as failed — the caption then says his setup could not be reached rather than
// sitting on "Checking…" forever. The loader is passed in so this block stays
// free of imports and the validator can execute it with a fake.
const INVOICE_TERMS_SERVER_WAIT_MS = 5000;
async function readServerInvoiceTerms(
  load: () => Promise<CashFlowTermsSettings>,
  waitMs: number = INVOICE_TERMS_SERVER_WAIT_MS,
): Promise<InvoiceTermsDefault | 'failed'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'failed'>(resolve => { timer = setTimeout(() => resolve('failed'), waitMs); });
    const read = load().then(invoiceTermsDefaultFromCashFlow, () => 'failed' as const);
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
// Combines the two reads. The device cache answers in milliseconds, but after a
// sign-in, a tenant switch (wipeLocalUserCache sweeps mage_cashflow_*) or on a
// fresh browser it is EMPTY — so for a signed-in GC an empty/unusable cache is
// not an answer: we keep waiting on the server (null = still loading) instead
// of flashing Net 30 and a "no setting" caption he would then see corrected.
// A cache that DOES carry his terms is shown at once; a server answer, when it
// arrives, is fresher and wins.
type ServerInvoiceTerms = 'not_signed_in' | 'pending' | 'failed' | InvoiceTermsDefault;
function settleInvoiceTermsDefault(
  cache: InvoiceTermsDefault | null,
  server: ServerInvoiceTerms,
): InvoiceTermsDefault | null {
  if (typeof server === 'object') return server;
  if (cache?.origin === 'cash_flow_setup') return cache;
  if (server === 'pending') return null;
  if (server === 'not_signed_in' && cache) return cache;
  return { terms: 'net_30', origin: 'unconfirmed' };
}
// </invoice-terms-default>
// Outside the shared block (bill-from-estimate awaits the read at tap time
// instead): what the editor says when Save / Send is tapped before the new
// invoice's default terms have settled.
const TERMS_LOADING_TITLE = 'Checking payment terms';
const TERMS_LOADING_MESSAGE = 'Reading the payment terms from your cash-flow setup so this invoice carries them. It takes a few seconds at most — tap again once the terms show.';

/**
 * The three answers worth a tap on the retainage ask. 5% and 10% are the rates
 * actually written into private construction contracts (Illinois' Prompt Payment
 * Act caps private retainage at 10% and steps it to 5% at half-complete — see
 * RETAINAGE_SOURCES in utils/retainage), and "none held" is the answer the app
 * previously ASSUMED on every job by seeding the editor with 0.
 *
 * These are shortcuts, not a default: none of them is preselected, and the sheet
 * cannot be answered by ignoring it.
 */
const RETAINAGE_ASK_CHOICES: { value: number; label: string; meta: string; a11y: string }[] = [
  { value: 0, label: '0%', meta: 'None held', a11y: 'This contract holds no retainage' },
  { value: 5, label: '5%', meta: 'Common', a11y: 'This contract holds five percent' },
  { value: 10, label: '10%', meta: 'Common', a11y: 'This contract holds ten percent' },
];

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
];

// The day counts come from utils/retainage.PAYMENT_TERM_DAYS, which
// app/retention.tsx's project-level release reads too: a release restarts the
// payment clock, and two surfaces restarting it by two different switches is a
// drift waiting to happen. The `new Date(issueDate)` site stays here — four
// other call sites need this function, and scripts/validate-calendar-date.ts
// carries a dated ALLOWED entry for exactly this snippet.
function getDueDate(issueDate: string, terms: PaymentTerms): string {
  const date = new Date(issueDate);
  date.setDate(date.getDate() + (PAYMENT_TERM_DAYS[terms] ?? 0));
  return date.toISOString();
}

export default function InvoiceScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { projectId: paramProjectId, invoiceId } = useLocalSearchParams<{ projectId?: string; invoiceId?: string }>();
  const { projects: allProjects, invoices: allInvoiceRows } = useProjects();
  const { user: authUser } = useAuth();
  // #38 — the role decision runs BEFORE the tier paywall, as on change orders
  // (#41): a collaborator on a free plan would otherwise meet an "Invoicing —
  // Pro" paywall that upgrading could never fix. The job is the URL's, else
  // the named invoice's; with neither (sidebar) the editor's picker asks and
  // InvoiceInner runs the same gate on the picked job.
  const gateProjectId = paramProjectId || (invoiceId ? allInvoiceRows.find(i => i.id === invoiceId)?.projectId : undefined) || undefined;
  const roleState = useProjectRoleState(gateProjectId);
  const gateProject = gateProjectId ? allProjects.find(p => p.id === gateProjectId) : undefined;
  const roleGate = invoiceRoleGate({
    hasProject: !!gateProjectId,
    role: roleState.role,
    isLoading: roleState.isLoading,
    isError: roleState.isError,
    isPaused: roleState.isPaused,
    stampedRole: gateProject?.myRole,
    ownedLocally: !!gateProject?.ownerUserId && !!authUser?.id && gateProject.ownerUserId === authUser.id,
  });
  if (roleGate !== 'open') {
    return <InvoiceRoleBlocked gate={roleGate} pausedReason={roleState.reason} onRetry={roleState.refetch} />;
  }
  if (!canAccess('change_orders_invoicing')) {
    return (
      <Paywall
        visible={true}
        feature="Invoicing"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <InvoiceInner />;
}

/**
 * #38 — what a collaborator (or a role still resolving) sees instead of the
 * invoice editor. Says why; spins only while the role is loading; offers a
 * retry after a failed read; a paused (offline) read shows its reason.
 */
function InvoiceRoleBlocked({ gate, pausedReason, onRetry }: {
  gate: Exclude<InvoiceRoleGate, 'open'>;
  pausedReason?: string;
  onRetry: () => void;
}) {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const copy = invoiceRoleBlockedCopy(gate, pausedReason);
  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]} testID="invoice-role-blocked">
      <Stack.Screen options={{ title: 'Invoices' }} />
      <View style={styles.roleBlockedBody}>
        {gate === 'loading' ? (
          <>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text style={styles.roleBlockedText}>{copy.body}</Text>
          </>
        ) : (
          <>
            <Text style={styles.roleBlockedTitle}>{copy.title}</Text>
            <Text style={styles.roleBlockedText}>{copy.body}</Text>
            {gate === 'error' || gate === 'paused' ? (
              <Button label="Try again" onPress={onRetry} variant="secondary" testID="invoice-role-retry" />
            ) : null}
            <Button label="Go back" onPress={() => router.back()} variant="secondary" testID="invoice-role-back" />
          </>
        )}
      </View>
    </View>
  );
}

function InvoiceInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // The action bar is position:absolute, so bottom padding cannot clear it —
  // measure it and lift the FAB by its height instead.
  const [bottomBarH, setBottomBarH] = useState(0);
  const onBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBottomBarH(e.nativeEvent.layout.height);
  }, []);
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  // prefillLines / prefillNotes come from the floating-mic flow when
  // the GC said something like "invoice them for demolition twenty-eight
  // hundred". JSON-encoded so we don't have to re-parse the AI's
  // structured output on this side.
  // milestoneId / contractId arrive from the contract screen's one-tap
  // "Create invoice" on a payment milestone. They are carried through the
  // editor and only acted on once the invoice is ACTUALLY created — opening
  // this screen and backing out must leave the milestone billable.
  // contractTerms / milestoneTrigger / depositNoRetainage come with them when
  // the signed contract already decided this row's terms or retainage
  // (billingFlowCore.milestoneBillEffect, audits #31/#32).
  const {
    projectId: paramProjectId, invoiceId, type: invoiceType, prefillLines, prefillNotes, milestoneId, contractId,
    termsOrigin: termsOriginParam, contractTerms: contractTermsParam, milestoneTrigger, depositNoRetainage: depositParam,
  } = useLocalSearchParams<{
    projectId: string; invoiceId?: string; type?: string; termsOrigin?: string;
    prefillLines?: string; prefillNotes?: string;
    milestoneId?: string; contractId?: string;
    contractTerms?: string; milestoneTrigger?: string; depositNoRetainage?: string;
  }>();
  // Only for a NEW invoice billing a milestone: an existing invoice's terms and
  // rate are facts about a document, never re-derived from a route param.
  const contractTerms: PaymentTerms | null =
    !invoiceId && milestoneId && contractTermsParam === 'due_on_receipt' ? 'due_on_receipt' : null;
  const isDepositInvoice = !invoiceId && !!milestoneId && depositParam === '1';
  const {
    projects, getProject, getInvoicesForProject, addInvoice, updateInvoice, settings, updateSettings,
    getChangeOrdersForProject, contacts, invoices: allInvoices, updateProject, getAIAPayAppsForProject,
    sendToClientPortal, awaitInvoiceInsert, recordInvoicePayment,
  } = useProjects();
  // Latest-callback ref (#45): the Send awaits an email between creating the
  // invoice and posting it, and the callback captured at tap time may predate
  // the render that knows about the new invoice.
  const sendToClientPortalRef = useRef(sendToClientPortal);
  useEffect(() => { sendToClientPortalRef.current = sendToClientPortal; }, [sendToClientPortal]);
  const { tier } = useSubscription();
  const { user } = useAuth();
  const { ensureReferral } = useFinancingReferrals(user?.id);

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** Whether this project's client portal can show the invoice (#45) — on AND
   *  its Invoices section not switched off (#43: the snapshot omits invoices
   *  entirely when showInvoices is off, so "post to portal" posted nothing). */
  const portalEnabled = invoicesVisibleInPortal(project?.clientPortal);
  /** The portal is on but hides invoices — the checkbox says so (#43). */
  const portalHidesInvoices = !!project?.clientPortal?.enabled && !portalEnabled;
  // #38: the gate again on THIS job — the route gate ran on the URL's job, and
  // a job picked here (sidebar entry) has not been checked yet.
  const innerRoleState = useProjectRoleState(projectId || undefined);
  const innerRoleGate = invoiceRoleGate({
    hasProject: !!project,
    role: innerRoleState.role,
    isLoading: innerRoleState.isLoading,
    isError: innerRoleState.isError,
    isPaused: innerRoleState.isPaused,
    stampedRole: project?.myRole,
    ownedLocally: !!project?.ownerUserId && !!user?.id && project.ownerUserId === user.id,
  });
  const billingBlocked = innerRoleGate !== 'open';
  // #34: one send at a time. A ref, not only state: a double tap on the
  // sheet's Send runs both handlers from ONE render, where state has not
  // changed yet — both built a new draft under the same number N. The state
  // copy drives the disabled / "Sending…" controls.
  const sendingRef = useRef(false);
  const [sendInFlight, setSendInFlight] = useState(false);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const existingInvoices = useMemo(() => getInvoicesForProject(projectId ?? ''), [projectId, getInvoicesForProject]);
  const existingInvoice = useMemo(() => invoiceId ? existingInvoices.find(i => i.id === invoiceId) : null, [invoiceId, existingInvoices]);
  const approvedCOs = useMemo(() => {
    return getChangeOrdersForProject(projectId ?? '').filter(co => co.status === 'approved');
  }, [projectId, getChangeOrdersForProject]);

  const contractTotal = useMemo(() => {
    if (!project) return 0;
    let base = effectiveEstimateTotal(project);
    approvedCOs.forEach(co => { base += co.changeAmount; });
    return base;
  }, [project, approvedCOs]);

  const nextInvoiceNumber = useMemo(() => {
    if (existingInvoice) return existingInvoice.number;
    // Max+1, not length+1: a deleted invoice (or a just-added one from
    // the synchronous create-then-edit send) would otherwise reuse a
    // number that's already on a client-facing invoice. Also past every
    // number this device issued this session (nextInvoiceNumberFrom).
    return nextInvoiceNumberFrom(existingInvoices, sessionIssuedInvoiceMax.get(projectId ?? '') ?? 0);
  }, [existingInvoices, existingInvoice, projectId]);

  const isProgressType = (invoiceType === 'progress') || (existingInvoice?.type === 'progress');

  const initialLineItems = useMemo((): InvoiceLineItem[] => {
    if (existingInvoice) return existingInvoice.lineItems;
    // Voice-mic prefill: when the floating mic landed us here with
    // parsed line items in the URL, seed the form with them so the
    // GC sees their dictation reflected immediately.
    if (prefillLines) {
      const parsed = safeJsonParse<{ name?: string; description?: string; quantity?: number; unit?: string; unitPrice?: number }[]>(prefillLines, []);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(li => ({
          id: createId('ili'),
          name: li.name || 'Voice line item',
          description: li.description || '',
          quantity: li.quantity ?? 1,
          unit: li.unit || 'lump',
          unitPrice: li.unitPrice ?? 0,
          total: (li.quantity ?? 1) * (li.unitPrice ?? 0),
        }));
      }
    }
    // Quick Invoice mode: seed ONE empty line item instead of dragging
    // every estimate row in. Lets the GC type "$1,200 — final cleanup"
    // and send without scrolling through 50 unrelated items.
    if (invoiceType === 'quick') {
      return [{
        id: createId('ili'),
        name: '',
        description: '',
        quantity: 1,
        unit: 'lump',
        unitPrice: 0,
        total: 0,
      }];
    }
    if (!project) return [];
    const linked = project.linkedEstimate;
    if (linked && linked.items.length > 0) {
      return linked.items.map(item => {
        // #9: a GC-only Cost X-Ray line (xray.clientVisible === false) is his
        // contingency for a suspected hidden condition, and this invoice goes
        // to the client (PDF, email, portal). It bills as one lump-sum
        // 'Contingency' line, the same shape Bill from Estimate writes: no
        // finding, and no quantity / unit ("200 LF") that could hint at one.
        // The renamed line no longer matches the estimate by name, so it is
        // stamped with the estimate row's key instead. Bill from Estimate's
        // already-billed sum and the G703 (utils/aiaBilling billedAgainst)
        // match a keyed line by key, so the line is still counted as billed.
        if (isGcOnlyEstimateLine(item)) {
          const total = Math.round(item.lineTotal * 100) / 100;
          return {
            id: createId('ili'),
            name: CLIENT_CONTINGENCY_LABEL,
            description: CLIENT_CONTINGENCY_LABEL,
            quantity: 1,
            unit: 'LS',
            unitPrice: total,
            total,
            sourceEstimateItemId: item.materialId || item.name,
          };
        }
        return {
          id: createId('ili'),
          name: item.name,
          description: item.category,
          quantity: item.quantity,
          // The estimate stores a PRE-markup unitPrice but a markup-INCLUSIVE
          // lineTotal. Copying both verbatim makes the printed row not foot
          // (100 × $10 shown beside a $1,200 total). Fold markup into the shown
          // unit price so quantity × unitPrice = total; `total` stays the source
          // of truth, so this changes nothing about what the client is charged.
          // The unit price is UNROUNDED (utils/billFromEstimateCore): rounding it
          // to cents breaks the foot on any line whose sell price is not
          // cent-exact (3 × $33.33 ≠ $100.00). Only the line total is rounded.
          unit: item.unit,
          unitPrice: billFromEstimateUnitPrice(item.lineTotal, item.quantity, item.usesBulk ? item.bulkPrice : item.unitPrice),
          total: Math.round(item.lineTotal * 100) / 100,
        };
      });
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
    // No estimate, no prefill — start with one empty line. Beats
    // an empty array which forces the user to find the "+" button.
    return [{
      id: createId('ili'),
      name: '',
      description: '',
      quantity: 1,
      unit: 'lump',
      unitPrice: 0,
      total: 0,
    }];
  }, [existingInvoice, project, invoiceType, prefillLines]);

  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>(initialLineItems);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(existingInvoice?.paymentTerms ?? contractTerms ?? 'net_30');
  // Where the terms on screen came from, so the picker can say it. `loading`
  // only exists for a NEW invoice (no invoiceId) while his cash-flow setup is
  // read; a draft handed over by /bill-from-estimate arrives with the origin it
  // already resolved in `termsOrigin`. `touched` is his own pick — once he has
  // chosen, no late-arriving load may overwrite it (a GC choice always wins).
  const [termsOrigin, setTermsOrigin] = useState<'loading' | InvoiceTermsDefault['origin'] | null>(
    invoiceId
      ? (termsOriginParam === 'cash_flow_setup' || termsOriginParam === 'fallback' || termsOriginParam === 'unconfirmed' ? termsOriginParam : null)
      : contractTerms ? 'contract' : 'loading',
  );
  const termsTouchedRef = useRef(false);
  useEffect(() => {
    // NEVER for an existing invoice: its terms are a fact about a document
    // that already exists, not a preference to refresh from settings.
    if (invoiceId) return;
    // NOR when the signed contract fixed them (#31). Seeding the state is not
    // enough: settle() overwrites anything he has not touched, so a late
    // cash-flow answer would put Net 30 back under a "Due on signing" line.
    if (contractTerms) return;
    let cancelled = false;
    let cache: InvoiceTermsDefault | null = null;
    let server: ServerInvoiceTerms = user?.id ? 'pending' : 'not_signed_in';
    // Every answer goes through settleInvoiceTermsDefault, which returns null
    // while an empty cache is still waiting on the server — the picker stays on
    // "Checking…" rather than showing Net 30 and then jumping to his terms.
    const settle = () => {
      if (cancelled || termsTouchedRef.current) return;
      const resolved = settleInvoiceTermsDefault(cache, server);
      if (!resolved) return;
      setPaymentTerms(resolved.terms);
      setTermsOrigin(resolved.origin);
    };
    void (async () => {
      try { cache = invoiceTermsDefaultFromCashFlow(await loadCashFlowSettings()); } catch { cache = null; }
      settle();
    })();
    const uid = user?.id;
    if (uid) {
      void (async () => {
        server = await readServerInvoiceTerms(() => loadCashFlowSettings(uid));
        settle();
      })();
    }
    return () => { cancelled = true; };
  }, [invoiceId, user?.id, contractTerms]);
  const pickPaymentTerms = useCallback((terms: PaymentTerms) => {
    termsTouchedRef.current = true;
    setPaymentTerms(terms);
    setTermsOrigin(null);
  }, []);
  const [notes, setNotes] = useState(existingInvoice?.notes ?? prefillNotes ?? '');
  const [progressPercent, setProgressPercent] = useState(() => {
    if (existingInvoice?.progressPercent != null) {
      return existingInvoice.progressPercent.toString();
    }
    // v2.3 wedge A1 — prefill from the canonical EV pipeline.
    // legacyEvmMetrics returns percentComplete = (EV/BAC × 100) cost-weighted.
    // Falls back to 30 only when there's no schedule or no linked estimate.
    if (project?.schedule && project.linkedEstimate) {
      const metrics = legacyEvmMetrics(project, [], project.schedule);
      if (metrics.percentComplete > 0) {
        return Math.round(metrics.percentComplete).toString();
      }
    }
    return '30';
  });
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  // One payment at a time, the #34 pattern. invoice_append_payment
  // de-duplicates by entry id only and every tap mints a new id, while the
  // sheet stays up through the ledger reads, the append and the re-read — on
  // job-site signal, seconds. A second tap of Record Payment in that window
  // recorded the same check twice, and nothing in the app can take an entry
  // back out (invoices_ledger_guard re-merges it). A ref, not only state: a
  // fast double tap runs both handlers from ONE render. The state copy drives
  // the disabled "Recording…" button.
  const recordingPaymentRef = useRef(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  // "Open Not saved" from the sheet closes it so iOS can present the other
  // Modal. The next open (after Retry / Discard) comes back to what he typed —
  // the amount, the day received and the check # — instead of the full
  // balance and today, which he would then record without noticing.
  const resumePaymentSheetRef = useRef(false);
  // Whether this invoice is still the screen in front. A payment's chain (the
  // append, the list refetch, the server row read) takes seconds on job-site
  // signal; if he closed the sheet and left meanwhile, the router.back() at
  // its end closed whatever screen he had opened since. True from mount (the
  // screen is pushed focused); the focus effect's cleanup and the unmount
  // clear it.
  const screenInFrontRef = useRef(true);
  useFocusEffect(useCallback(() => {
    screenInFrontRef.current = true;
    return () => { screenInFrontRef.current = false; };
  }, []));
  useEffect(() => () => { screenInFrontRef.current = false; }, []);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('check');
  // #133: the day the money ARRIVED (a local calendar day he picks; today by
  // default) and the check number — what his bookkeeper matches the deposit on.
  const [paymentReceivedDate, setPaymentReceivedDate] = useState(() => todayCalendarDay());
  const [paymentReference, setPaymentReference] = useState('');
  const [showReceivedDatePicker, setShowReceivedDatePicker] = useState(false);
  const [showTermsDropdown, setShowTermsDropdown] = useState(false);
  const [showPDFPreSend, setShowPDFPreSend] = useState(false);
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  // #45: an emailed invoice is also posted to the client portal unless he
  // unticks it — otherwise the portal (and the reminder's "View invoice")
  // showed nothing for an invoice the client had in their inbox.
  const [postToPortal, setPostToPortal] = useState(true);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);
  /**
   * Retainage seed, and where it came from — resolved by ONE function
   * (utils/retainageSource), never by this screen privately.
   *
   * The carry-forward this replaced was correct for invoice #2 onward and is
   * still layer 2 of the stack, unchanged. What it could not do is invoice #1:
   * there is nothing to carry from, app/bill-from-estimate.tsx calls addInvoice
   * BEFORE this editor mounts, and the old seed therefore fell to the string
   * '0'. An invoice billed at 0% by omission is money he never asked for back —
   * the owner's AP deducts the 10% anyway, and MAGE spends the rest of the job
   * showing a receivable the owner considers settled.
   *
   * So the resolver adds two more reads he has already paid for — the contract
   * term on the project, and the newest saved G702 pay app — and when all four
   * come up empty it says so (`needsAsk`) instead of presenting 0 as a choice.
   * Nothing is invented at any layer.
   */
  const projectPayApps = useMemo(
    () => getAIAPayAppsForProject(projectId ?? ''),
    [projectId, getAIAPayAppsForProject],
  );
  const retainageSeed = useMemo(() => resolveRetainagePercent({
    invoice: existingInvoice,
    priorInvoices: existingInvoices,
    excludeInvoiceId: invoiceId,
    project,
    payApps: projectPayApps,
  }), [existingInvoice, existingInvoices, invoiceId, project, projectPayApps]);

  // Where the job's rate comes from IGNORING this invoice's own saved rate.
  // app/bill-from-estimate.tsx stamps the resolved rate onto the draft before
  // this editor mounts, so for that draft `retainageSeed` is always 'set on
  // this invoice' and the provenance — including the "#1 held 0%, your
  // contract says 10%" conflict label (audit round 2 #26) — was lost. The
  // provenance note below reads this for an unlocked draft instead.
  const retainageBasis = useMemo(() => resolveRetainagePercent({
    priorInvoices: existingInvoices,
    excludeInvoiceId: invoiceId,
    project,
    payApps: projectPayApps,
  }), [existingInvoices, invoiceId, project, projectPayApps]);

  // A deposit opens at 0% (#32): the contract prints the deposit as the amount
  // due on signing. Still editable — some commercial contracts do withhold on
  // mobilization — and never written back to the job from here.
  const [retentionPercent, setRetentionPercent] = useState<string>(isDepositInvoice ? '0' : String(retainageSeed.percent));
  // True until he changes it — so the screen can say where the number came from
  // rather than presenting a seeded figure as if he had chosen it.
  const [retentionSeedUntouched, setRetentionSeedUntouched] = useState(true);
  // The ask, for the one case the resolver cannot answer. Opened once per mount
  // (see the effect below) and re-openable from the Retention row afterwards, so
  // declining it is a decision he can revisit rather than a dead end.
  const [showRetainageAsk, setShowRetainageAsk] = useState(false);
  const [retainageAskInput, setRetainageAskInput] = useState('');
  const [retainageAsked, setRetainageAsked] = useState(false);
  const [showRetentionModal, setShowRetentionModal] = useState(false);
  const [retentionReleaseAmount, setRetentionReleaseAmount] = useState('');
  const [retentionReleaseNote, setRetentionReleaseNote] = useState('');
  const [generatingPayLink, setGeneratingPayLink] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  const pctValue = parseFloat(progressPercent) || 0;
  const retentionPctValue = Math.max(0, Math.min(100, parseFloat(retentionPercent) || 0));

  // Bill-from-Estimate lines carry `billedPercent` and store an ALREADY-scaled
  // `total`. Applying the invoice-level progress % to them scales a second time
  // (the 30%-of-30% double-scale bug). When any line is pre-scaled, the % is
  // inoperative for this invoice, so we also hide the Billing Percentage field.
  const anyPreScaledLine = useMemo(() => lineItems.some(li => li.billedPercent != null), [lineItems]);

  // MISS-04: money is whole cents at the point it is COMPUTED, not just where
  // it is formatted. Production carried subtotal-derived tax of 5669.625 and a
  // total_due of 81264.625 because these three lines never rounded.
  const subtotal = useMemo(
    () => roundCents(progressSubtotal(lineItems, isProgressType, pctValue)),
    [lineItems, isProgressType, pctValue],
  );

  // Tax rate is IMMUTABLE once an invoice is issued. Re-totaling an existing
  // invoice from the CURRENT global settings.taxRate would let a later change
  // to the Settings default silently rewrite an already-sent invoice's total,
  // its Stripe pay-link charge, and the paid/partial threshold. Read the rate
  // stored ON the invoice; fall back to settings ONLY for a brand-new invoice.
  // MONEY-F3: the settings default is 0 % (a rate the GC never set is not a
  // rate); the invented client-side fallback that taxed every account at a
  // Florida-ish figure is gone.
  //
  // #66: the rate is seeded by ONE rule (billingFlowCore.invoiceTaxSeed) and,
  // on a new invoice or a draft, is his to change — with the source beside it.
  // A contract milestone (deposit, draw, final) bills the amount the contract
  // names, so it seeds 0% unless the contract states a rate: the Settings
  // default added tax on top of a deposit the homeowner had agreed as a flat
  // figure, and the draw never read as paid. `taxRateText` null = untouched,
  // so an invoice that loads after mount still shows its own stored rate.
  const taxSeed = useMemo(() => invoiceTaxSeed({
    existingTaxRate: existingInvoice?.taxRate,
    isNew: !existingInvoice,
    milestoneId: !invoiceId ? milestoneId : null,
    contractTaxRate: null,
    settingsTaxRate: settings.taxRate ?? 0,
  }), [existingInvoice, invoiceId, milestoneId, settings.taxRate]);
  const [taxRateText, setTaxRateText] = useState<string | null>(null);
  const typedTaxRate = taxRateText == null ? null : parsePercentInput(taxRateText);
  const taxRateInvalid = taxRateText != null && (typedTaxRate == null || typedTaxRate > 100);
  const taxRate = taxRateText == null || taxRateInvalid || typedTaxRate == null ? taxSeed.rate : typedTaxRate;
  const taxAmount = roundCents(subtotal * (taxRate / 100));
  const totalDue = roundCents(subtotal + taxAmount);

  const amountPaid = existingInvoice?.amountPaid ?? 0;
  // MISS-04: retainage is withheld on the VALUE OF THE WORK, never on sales
  // tax. `retainageOnWorkValue` (utils/invoiceBilling) is the same function the
  // G702/G703 pay application uses, so the invoice and the certificate for
  // the same job can no longer disagree. This screen used to apply the
  // percentage to `subtotal + taxAmount` — on the founder's live Houston
  // invoice that held $4,063.23 instead of $3,779.75, i.e. $283.48 of retainage
  // against sales tax the GC remits to the state regardless.
  // Floored at zero HERE, not inside retainageOnWorkValue: a G703 schedule of
  // values may legitimately carry a deductive change-order line whose retainage
  // is negative, and clamping the shared helper made the certificate
  // over-withhold on every credit line. An invoice subtotal that came out
  // negative is a credit memo, which withholds nothing.
  const retentionBasis = Math.max(0, subtotal);
  const retentionAmount = useMemo(
    () => retainageOnWorkValue(retentionBasis, retentionPctValue),
    [retentionBasis, retentionPctValue],
  );
  const retentionReleased = existingInvoice?.retentionReleased ?? 0;
  // MONEY-05: through the shared helper, so the cap on "Release Retention"
  // is the same withholding every other screen reports for this invoice.
  const retentionPending = pendingRetentionHeld({
    subtotal, retentionPercent: retentionPctValue, retentionAmount, retentionReleased,
  });
  // MONEY-F5: ONE formula for what the client owes (utils/invoiceBilling).
  // netPayable = retention-net total before payments; balanceDue = collectible
  // today, never negative (an overpayment reads as $0 due, not −$X).
  // Rounded here because `amountPaid` / `retentionReleased` arrive from the
  // server and pre-fix rows carry sub-cent values (MISS-04).
  // MONEY-05: `subtotal` + `retentionPercent` are passed so netBalanceDue runs
  // the SAME effectiveRetentionHeld rule every other surface runs, rather than
  // being handed a figure this screen computed privately. On a live edit the two
  // agree by construction; on a legacy row they are what makes Summary, A/R, the
  // portal and the webhook report the number printed here.
  const netPayable = roundCents(netBalanceDue({
    totalDue, subtotal, retentionPercent: retentionPctValue, retentionAmount, retentionReleased,
  }));
  const balanceDue = roundCents(netBalanceDue({
    totalDue, amountPaid, subtotal, retentionPercent: retentionPctValue, retentionAmount, retentionReleased,
  }));
  // Stripe's per-charge limits for today's balance (#49): the manual Generate
  // button is disabled with this reason, and the send paths skip the mint.
  const payLinkLimitReason = balanceDue > 0 ? payLinkAmountBlock(balanceDue) : null;

  // MISS-04: an invoice saved before the basis fix stored retainage computed on
  // the tax-INCLUSIVE total. The Retention screen, Payments, the portal and the
  // A/R aging all read that STORED column, so they keep showing the old figure
  // until the row itself is repaired — and every invoice past draft is locked
  // (isLocked below), which hides the save bar, so "save it again" is not a
  // remedy the GC can actually reach. Detect it, say so, and offer the repair.
  //
  // The test is computed from STORED columns only and only fires when the
  // stored amount IS the taxed-total figure to the cent (see
  // taxBasisRetentionOverhold). An earlier version compared the stored amount
  // against the LIVE recomputed retention, which diverges the moment anyone
  // edits a line item or the percentage — and then accused zero-tax invoices of
  // holding retainage on sales tax. See utils/invoiceBilling.
  //
  // FLEET REPAIR (deploy runbook 2026-09-04, step 7) — the same correction for
  // rows nobody opens, run once through the Supabase MCP before the OTA:
  //   update invoices set retention_amount = round((subtotal * retention_percent / 100)::numeric, 2)
  //    where retention_percent > 0 and retention_amount is not null
  //      and abs(retention_amount::numeric
  //              - round((total_due * retention_percent / 100)::numeric, 2)) <= 0.01
  //      and abs(round((total_due * retention_percent / 100)::numeric, 2)
  //              - round((subtotal * retention_percent / 100)::numeric, 2)) > 0.01;
  const legacyTaxBasisRetention = useMemo(
    () => (existingInvoice ? taxBasisRetentionOverhold(existingInvoice) : null),
    [existingInvoice],
  );

  // MONEY-F2 (review 2026-09-05): a Stripe Payment Link charges the ONE amount
  // it was minted for. pay_link_* are SERVER-owned — the client never writes
  // them — so clearing the link locally after a payment or a retention release
  // is undone by the next refetch, and every path that reused "any existing
  // link" then re-sent a link for the OLD balance: link minted for $90,000, a
  // $50,000 check recorded, "Send" emails "$40,000 due" with a button that
  // charges $90,000. Nothing may copy, share, email or embed a link unless the
  // amount it was minted for IS today's balance; otherwise re-mint
  // (create-payment-link retires the replaced link on Stripe).
  const payLinkMatchesBalance =
    !!existingInvoice?.payLinkUrl
    && existingInvoice.payLinkAmount != null
    && Math.abs(existingInvoice.payLinkAmount - balanceDue) <= 0.01;

  // #83 / #135: the client paid by bank transfer (ACH) through the Pay link and
  // it is still settling (3-5 business days). stripe-webhook stamped
  // pay_pending_at and retired the link. Until it clears or fails: no Pay /
  // Copy / Share, and no NEW link minted anywhere on this screen — a fresh link
  // now invites the client to pay a second time. Same 10-day window as
  // invoice-dunning (billingFlowCore.paymentPendingHolds), so a lost Stripe
  // event cannot lock the screen for good.
  const pendingBankPayment = useMemo(() => {
    const since = existingInvoice?.paymentPendingAt;
    if (!since || !paymentPendingHolds(since, Date.now())) return null;
    const amount = existingInvoice?.paymentPendingAmount;
    const day = formatCalendarDay(calendarDayOf(since));
    return {
      since,
      amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
      line: `Bank payment${typeof amount === 'number' && Number.isFinite(amount) ? ` of ${formatCurrency(amount)}` : ''} processing since ${day || 'recently'}`,
    };
  }, [existingInvoice?.paymentPendingAt, existingInvoice?.paymentPendingAmount]);
  const pendingBankMintBlock = pendingBankPayment
    ? `the client's ${pendingBankPayment.line.charAt(0).toLowerCase()}${pendingBankPayment.line.slice(1)} — a new link now would invite a second payment`
    : null;

  const handleRemoveItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
  }, []);

  /**
   * The GC's connected Stripe account — connected / not_connected /
   * unreachable (#36). Only a check that ANSWERED can say "not connected"; a
   * failed one (offline) is its own reason, never the once-ever Stripe nudge.
   * A platform-owned link would route the client's money to the wrong bank,
   * so every mint site skips the link unless the answer is 'connected'.
   */
  const resolveStripeAccountId = useCallback(
    () => resolveStripeAccount(user?.id),
    [user?.id],
  );

  /** #83: whether the SERVER row holds a bank payment still settling. A read
   *  that fails answers false — the caller then reports the mint's own error. */
  const serverPaymentPending = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { data } = await supabase.from('invoices').select('pay_pending_at').eq('id', id).maybeSingle();
      const at = (data as { pay_pending_at?: string | null } | null)?.pay_pending_at ?? null;
      return paymentPendingHolds(at, Date.now());
    } catch {
      return false;
    }
  }, []);

  type MintResult =
    | { ok: true; url: string; id: string }
    // `message`: why, in words the GC can act on (billingFlowCore) — every
    // non-not_connected failure is shown in place of the success toast (#49).
    | { ok: false; reason: 'not_connected' | 'failed'; error?: string; message?: string };

  /**
   * Mint a Stripe Payment Link for `amount` (dollars) against `invoice` and
   * stamp url / id / amount locally. create-payment-link persists the same
   * three columns server-side and DEACTIVATES the link it replaces, so minting
   * for a fresh balance is also how a stale link is retired — there is no
   * standalone deactivate endpoint. Callers that get `ok: false` must go on
   * WITHOUT a link, never with the old one.
   */
  const mintPayLinkFor = useCallback(async (
    invoice: Pick<Invoice, 'id' | 'number'>,
    amount: number,
    customerEmail?: string,
  ): Promise<MintResult> => {
    if (amount <= 0) return { ok: false, reason: 'failed', error: 'Nothing due', message: 'nothing is due on it' };
    // #83: every mint on this screen (Send, the PDF send, the re-mint after a
    // payment or a retention release) goes through here.
    if (pendingBankMintBlock && invoice.id === existingInvoice?.id) {
      return { ok: false, reason: 'failed', error: 'payment_pending', message: pendingBankMintBlock };
    }
    const account = await resolveStripeAccountId();
    if (account.kind === 'unreachable') {
      return { ok: false, reason: 'failed', error: account.error, message: STRIPE_UNREACHABLE_REASON };
    }
    if (account.kind === 'not_connected') return { ok: false, reason: 'not_connected' };
    const stripeAccountId = account.accountId;
    // Stripe's hard limits never pass on retry — say so before the round trip.
    const blocked = payLinkAmountBlock(amount);
    if (blocked) return { ok: false, reason: 'failed', error: blocked, message: blocked };
    const res = await createPaymentLink({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      projectName: project?.name ?? 'Project',
      amountCents: Math.round(amount * 100),
      customerEmail,
      companyName: settings.branding?.companyName,
      stripeAccountId,
      userTier: tier,
    });
    if (!res.success || !res.url || !res.id) {
      // #83 carry: create-payment-link refuses (409 'payment_pending') while
      // the client's bank payment settles — but supabase.functions.invoke
      // hands a non-2xx back as a generic "non-2xx status code" message, so
      // the body's reason does not reach here. Ask the row itself: a marker
      // the server holds is the processing copy, never "Stripe said: …".
      if (await serverPaymentPending(invoice.id)) {
        return { ok: false, reason: 'failed', error: 'payment_pending', message: PAYMENT_PENDING_MINT_REASON };
      }
      return { ok: false, reason: 'failed', error: res.error, message: payLinkFailureReason(res.error) };
    }
    // MONEY-F2: remember the amount this link charges — the portal shows Pay,
    // and this screen offers Copy / Share, only while it still equals the balance.
    updateInvoice(invoice.id, { payLinkUrl: res.url, payLinkId: res.id, payLinkAmount: Math.round(amount * 100) / 100 });
    return { ok: true, url: res.url, id: res.id };
  }, [resolveStripeAccountId, serverPaymentPending, project?.name, settings.branding?.companyName, tier, updateInvoice, pendingBankMintBlock, existingInvoice?.id]);

  const buildNewInvoice = useCallback((status: 'draft' | 'sent'): Invoice => {
    const now = new Date().toISOString();
    const dueDate = getDueDate(now, paymentTerms);
    return {
      id: createId('inv'),
      number: nextInvoiceNumber,
      projectId: projectId as string,
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
      // MISS-05: persist a deliberate 0% AS 0 rather than erasing it with
      // `|| undefined`, so the row records that this invoice withheld nothing
      // instead of leaving it unknown. Nothing branches on the difference
      // today — retainagePercentForInvoice reads both as 0 — the invented
      // 10% was removed from the AIA seeder itself, not from this write.
      retentionPercent: retentionPctValue,
      retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
      retentionReleased: 0,
      retentionReleases: [],
      // Stamp the milestone this invoice bills. This is the invoice-side half
      // of the double-bill guard — if the milestone's own flip to 'invoiced'
      // fails to persist, the contract screen can still see that this
      // milestone has already produced an invoice.
      sourceMilestoneId: milestoneId || undefined,
      sourceContractId: contractId || undefined,
      createdAt: now,
      updatedAt: now,
    };
  }, [projectId, nextInvoiceNumber, isProgressType, pctValue, paymentTerms, notes, lineItems, subtotal, taxRate, taxAmount, totalDue, retentionPctValue, retentionAmount, milestoneId, contractId]);

  /**
   * Flip the source milestone to 'invoiced' — called ONLY after addInvoice()
   * has actually run, never when the GC merely opened this editor. Fire and
   * forget from the caller's perspective: the invoice already exists, so a
   * failed flip must not roll it back. We warn instead, because a silent
   * failure is exactly what leaves a milestone billable twice.
   */
  const linkMilestone = useCallback(async (invoice: Invoice) => {
    if (!milestoneId || !contractId) return;
    try {
      const outcome = await markMilestoneInvoiced(contractId, milestoneId, invoice.id);
      if (outcome === 'already') {
        showAlert(
          'Milestone was already billed',
          `Invoice #${invoice.number} was created, but this contract milestone had already been invoiced elsewhere. Check the payment schedule so the client isn't billed twice.`,
        );
      } else if (outcome !== 'flipped') {
        showAlert(
          'Milestone not marked as billed',
          `Invoice #${invoice.number} was saved, but we couldn't update the contract's payment schedule. Open the contract and check that the milestone reads "Billed" before invoicing it again.`,
        );
      }
    } catch (err) {
      console.warn('[Invoice] milestone link failed:', err);
    }
  }, [milestoneId, contractId]);

  const handleSave = useCallback((status: 'draft' | 'sent', recipientName?: string, recipientEmail?: string) => {
    // #34: never while a send is running (it would create a second draft under
    // the next number and pop the screen twice), and never twice from one
    // render — the ref is taken synchronously and released on every early
    // return; a save that lands ends in router.back(), so it stays held.
    if (sendingRef.current) return;
    if (!projectId) return;
    if (billingBlocked) {
      showAlert('Only the job owner bills', INVOICE_OWNER_ONLY_REASON);
      return;
    }
    if (lineItems.length === 0) {
      showAlert('No Items', 'Please add at least one line item.');
      return;
    }
    // While his cash-flow terms are still being read the picker says
    // "Checking…", so a save now would stamp a Net 30 he never saw on screen.
    // The read is bounded (readServerInvoiceTerms), so the wait is seconds.
    if (termsOrigin === 'loading') {
      showAlert(TERMS_LOADING_TITLE, TERMS_LOADING_MESSAGE);
      return;
    }
    if (taxRateInvalid) {
      showAlert('Check the tax rate', `"${(taxRateText ?? '').trim()}" isn't a percentage between 0 and 100. Fix it (0 for no tax) before saving.`);
      return;
    }
    sendingRef.current = true;
    setSendInFlight(true);

    const now = new Date().toISOString();
    const dueDate = getDueDate(now, paymentTerms);
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    if (existingInvoice) {
      // Stale pay-link guard: a Stripe payment link is minted for a FIXED
      // amount (immutable Stripe Price). If the total changed on this save,
      // the old link would keep charging the ORIGINAL amount — overcharging
      // the client and letting the webhook mark the invoice 'paid' past its
      // real total. Clear the stored link so the next Send regenerates one
      // for the current balance.
      const totalChanged = (existingInvoice.totalDue ?? 0) !== totalDue;
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
        // MISS-05: persist a deliberate 0% AS 0 rather than erasing it with
        // `|| undefined`, so the row records that this invoice withheld nothing
        // instead of leaving it unknown. Nothing branches on the difference
        // today — retainagePercentForInvoice reads both as 0 — the invented
        // 10% was removed from the AIA seeder itself, not from this write.
        retentionPercent: retentionPctValue,
        retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
        // All three together: a surviving payLinkAmount would still describe a
        // link that no longer exists, and payLinkMatchesBalance reads it.
        ...(totalChanged ? { payLinkUrl: undefined, payLinkId: undefined, payLinkAmount: undefined } : {}),
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert('Updated', `Invoice #${existingInvoice.number} has been ${status === 'sent' ? `sent${recipientInfo}` : 'saved to project'}.`);
    } else {
      const inv = buildNewInvoice(status);
      addInvoice(inv);
      noteIssuedInvoiceNumber(inv.projectId, inv.number);
      // The invoice now exists — this is the moment the milestone is billed.
      void linkMilestone(inv);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Hammer-strike toast — non-blocking, lets the back nav fire immediately.
      nailIt(status === 'sent' ? `Invoice #${nextInvoiceNumber} sent${recipientInfo}` : `Invoice #${nextInvoiceNumber} saved`);
    }
    router.back();
  }, [projectId, billingBlocked, lineItems, paymentTerms, termsOrigin, taxRateInvalid, taxRateText, notes, subtotal, taxRate, taxAmount, totalDue, isProgressType, pctValue, retentionPctValue, retentionAmount, existingInvoice, nextInvoiceNumber, addInvoice, updateInvoice, router, buildNewInvoice, linkMilestone]);

  // Prefill for the PDF send (the reminder card's "Email the invoice" fix):
  // the address it went to last time, else the portal's first invitee — the
  // same order the reminder cron resolves its recipient in.
  const pdfDefaultRecipient = useMemo(() => {
    const billTo = existingInvoice as (Invoice & InvoiceBillTo) | null | undefined;
    return reminderRecipient(billTo?.billToEmail, project?.clientPortal?.invites ?? []) ?? '';
  }, [existingInvoice, project?.clientPortal?.invites]);

  const handleSendPress = useCallback(() => {
    // #34: the sheet must not reopen and queue a second send mid-flight.
    if (sendingRef.current) return;
    if (billingBlocked) {
      showAlert('Only the job owner bills', INVOICE_OWNER_ONLY_REASON);
      return;
    }
    // Same wait as handleSave: never open Send on terms still "Checking…".
    if (termsOrigin === 'loading') {
      showAlert(TERMS_LOADING_TITLE, TERMS_LOADING_MESSAGE);
      return;
    }
    if (taxRateInvalid) {
      showAlert('Check the tax rate', `"${(taxRateText ?? '').trim()}" isn't a percentage between 0 and 100. Fix it (0 for no tax) before sending.`);
      return;
    }
    setShowSendRecipient(true);
  }, [termsOrigin, billingBlocked, taxRateInvalid, taxRateText]);

  // #47: when the Send sheet OPENS with no recipient typed, prefill who the
  // invoice went to last time, else the portal's first invitee — the same
  // order the reminder cron resolves its recipient in. Only on the opening
  // transition, so clearing the field while the sheet is up is respected.
  const sendSheetWasOpen = useRef(false);
  useEffect(() => {
    const opening = showSendRecipient && !sendSheetWasOpen.current;
    sendSheetWasOpen.current = showSendRecipient;
    if (!opening || sendRecipientEmail.trim()) return;
    const billTo = existingInvoice as (Invoice & InvoiceBillTo) | null | undefined;
    const invite = (project?.clientPortal?.invites ?? []).find(i => (i.email ?? '').includes('@'));
    const email = reminderRecipient(billTo?.billToEmail, invite ? [invite] : []);
    if (!email) return;
    setSendRecipientEmail(email);
    const name = billTo?.billToEmail?.trim() === email ? billTo?.billToName : invite?.name;
    if (name && !sendRecipientName.trim()) setSendRecipientName(name);
  }, [showSendRecipient, sendRecipientEmail, sendRecipientName, existingInvoice, project?.clientPortal?.invites]);

  // The body of a send. Resolves 'left' when it ended in router.back(): the
  // screen is going away, so the in-flight lock stays held (a tap during the
  // pop must not start another send). Every other exit releases it — see
  // handleConfirmSend below.
  const runConfirmSend = useCallback(async (): Promise<'left' | void> => {
    if (billingBlocked) {
      showAlert('Only the job owner bills', INVOICE_OWNER_ONLY_REASON);
      return;
    }
    if (!sendRecipientEmail.trim()) {
      showAlert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    if (!projectId) return;
    if (lineItems.length === 0) {
      showAlert('No Items', 'Please add at least one line item.');
      return;
    }
    setShowSendRecipient(false);

    const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
    const now = new Date().toISOString();
    // An invoice that already went out (sent / partially paid / overdue) is
    // RE-emailed, never re-issued: its due date and status stay what they are.
    // Re-dating it from today would reset A/R ageing and stop dunning, and
    // writing status 'sent' would overwrite a webhook-owned 'partially_paid'.
    // Only drafts (and brand-new invoices) are dated from this send.
    const isResend = !!existingInvoice && existingInvoice.status !== 'draft';
    const dueDate = isResend && existingInvoice?.dueDate ? existingInvoice.dueDate : getDueDate(now, paymentTerms);
    const recipientInfo = sendRecipientName
      ? ` to ${sendRecipientName} (${sendRecipientEmail.trim()})`
      : ` to ${sendRecipientEmail.trim()}`;

    // Create-then-edit. Pre-audit the pay-link block below was gated on
    // `existingInvoice`, so a brand-new "Quick Invoice" went out with NO
    // Pay button and no Stripe nudge — the exact "I made an invoice but
    // can't get paid" trap. Persist the invoice first so it has a stable
    // id (mirrors bill-from-estimate), then generate the link against it.
    //
    // CREATED AS A DRAFT, flipped to 'sent' only once the email has actually
    // gone (invoice-to-paid blocker #3). It used to be inserted as 'sent' and
    // rolled back on a failed or cancelled email — a rollback that could miss
    // the server, leaving a 'sent' row that A/R aged, dunning chased and
    // QuickBooks pushed for an invoice the client never received. Now no
    // failure path has anything to roll back: the draft stays on his list and
    // on the server, under its number, for him to send again.
    let workingInvoice: Invoice;
    const createdNew = !existingInvoice;
    if (existingInvoice) {
      workingInvoice = existingInvoice;
    } else {
      workingInvoice = buildNewInvoice('draft');
      addInvoice(workingInvoice);
      noteIssuedInvoiceNumber(workingInvoice.projectId, workingInvoice.number);
      // Bill the milestone the instant the invoice is persisted — before the
      // email attempt, which can fail and leave the invoice a draft. A draft
      // invoice still exists (and stays on his list), so the milestone is
      // still billed by it.
      void linkMilestone(workingInvoice);
      // #34: point this editor AT the draft now, not only after a failure —
      // any re-entry (a failed send, a stopped one, a guard ever bypassed)
      // then re-sends THIS draft instead of building #N+1 for the same work.
      router.setParams({ invoiceId: workingInvoice.id });
    }

    // Auto-generate a Stripe payment link unless the invoice already carries
    // one minted for TODAY'S balance. Without this, the email goes out with no
    // Pay button — clients get an invoice they can read but not pay, and we
    // lose the whole value prop of the integration. Graceful degradation: if
    // Stripe is unreachable we still send, just without the button.
    // Charge the retention-NET balance, not the gross totalDue. Retention is
    // held back until closeout, so an emailed pay link must bill the same
    // amount as the in-app "Generate Payment Link" button (balanceDue =
    // netPayable − amountPaid). Charging totalDue overcharges the client by the
    // held retention.
    //
    // MONEY-F2: a link minted for an EARLIER balance is never reused and never
    // rides along as a fallback — if the re-mint fails, the email goes out
    // without a Pay button rather than with one charging the wrong amount.
    // (workingInvoice is existingInvoice here, or a brand-new invoice with no
    // link — the same predicate as payLinkMatchesBalance, read off the row
    // being sent.)
    const workingLinkMatchesBalance = !!workingInvoice.payLinkUrl
      && workingInvoice.payLinkAmount != null
      && Math.abs(workingInvoice.payLinkAmount - balanceDue) <= 0.01;
    let payLinkUrl: string | undefined = workingLinkMatchesBalance ? workingInvoice.payLinkUrl : undefined;
    let stripeNotConnected = false;
    // Why the email goes out WITHOUT a Pay button, when it does (#49). Any
    // reason but "Stripe not connected" (which has its own once-ever nudge)
    // replaces the "sent" toast — the GC was told "Invoice #N sent" while the
    // client got an invoice they could not pay online.
    let noPayButtonReason: string | null = null;
    // Is the row on the server? Asked for EVERY send, not only when a mint is
    // due (#39: a $0 balance or a reused link skipped the check and a refused
    // insert still went out), and for existing drafts too (#36: a
    // Bill-from-Estimate draft made offline is still a queued INSERT).
    //   createdNew — await this session's INSERT when it is still on the
    //     wire, so a mint never races it; the outcome tells a REFUSED insert
    //     apart from one that went to the offline queue. `undefined` = no
    //     record of it this session → read the queue.
    //   existing draft — read the queue: its INSERT may still be in it.
    // A queue we cannot read is 'unknown' — the send goes, honestly without
    // the button, and the copy says only what we know.
    //   'unsaved' — an earlier write of this invoice was REFUSED and sits in
    //     the sync ledger's "Not saved" list (CONTRACT 1). The offline queue
    //     no longer holds it and nothing resends it on its own, so the queue
    //     read alone answers 'clear' and the send would email an invoice the
    //     server does not have (#39, review round 1). Read the ledger too.
    let insertState: 'clear' | 'queued' | 'failed' | 'unsaved' | 'unknown' = 'clear';
    const readQueuedInsert = async (): Promise<'clear' | 'queued' | 'unsaved' | 'unknown'> => {
      try {
        if ((await unsavedWriteIds('invoices')).has(workingInvoice.id)) return 'unsaved';
        return pendingIdsForTable(await getOfflineQueue(), 'invoices').has(workingInvoice.id) ? 'queued' : 'clear';
      } catch { return 'unknown'; }
    };
    if (createdNew) {
      const outcome = await awaitInvoiceInsert(workingInvoice.id).catch(() => undefined);
      if (outcome === 'failed') insertState = 'failed';
      else if (outcome === 'queued') insertState = 'queued';
      else if (outcome !== 'synced') insertState = await readQueuedInsert();
    } else if (existingInvoice?.status === 'draft') {
      insertState = await readQueuedInsert();
    }
    // #39: the server REFUSED the new invoice. Stop before the email — an
    // invoice the server does not have drops off his list, A/R, reminders and
    // QuickBooks on the next refresh while the client holds it. The draft is
    // still on screen (the params point at it); the copy sends him to Retry
    // it from "Not saved", the one path that resends it.
    if (insertState === 'failed') {
      showAlert('Invoice not sent', invoiceInsertRefusedMessage(workingInvoice.number));
      return;
    }
    if (insertState === 'unsaved') {
      showAlert('Invoice not sent', invoiceUnsavedOnServerMessage(workingInvoice.number));
      return;
    }
    if (!workingLinkMatchesBalance && balanceDue > 0) {
      // A row the server does not have yet cannot carry a link:
      // create-payment-link would 404 on its ownership check. Skip the mint
      // and say why. (An INSERT still on the wire usually wins the race; if it
      // loses, the 404 is reported in words below, never swallowed.)
      if (insertState === 'queued') {
        noPayButtonReason = INVOICE_INSERT_QUEUED_REASON;
      } else if (insertState === 'unknown') {
        noPayButtonReason = INVOICE_INSERT_UNCONFIRMED_REASON;
      } else {
        try {
          const minted = await mintPayLinkFor(workingInvoice, balanceDue, sendRecipientEmail.trim());
          if (minted.ok) {
            payLinkUrl = minted.url;
          } else if (minted.reason === 'not_connected') {
            console.log('[Invoice] Skipping payment link — Stripe Connect not set up for this user');
            stripeNotConnected = true;
          } else {
            // Includes #36's 'unreachable' (offline status check): it names
            // itself here instead of reading as "Stripe isn't connected".
            console.warn('[Invoice] Auto-generate payment link failed:', minted.error);
            noPayButtonReason = minted.message ?? payLinkFailureReason(minted.error);
          }
        } catch (err) {
          console.warn('[Invoice] Auto-generate payment link threw:', err);
          noPayButtonReason = payLinkFailureReason(err instanceof Error ? err.message : String(err));
        }
      }
    }

    let financingHtml = '';
    try {
      if (isFinancingAvailable(settings) && projectId) {
        const refToken = await ensureReferral({
          projectId,
          source: 'invoice',
          // What the client owes NOW (the Pay button's figure), not the gross
          // total — the email names one amount (#37).
          amountCents: Math.round(Math.max(0, balanceDue) * 100),
          partnerName: settings.financing!.partnerName,
        });
        if (refToken) {
          financingHtml = financingEmailBlockHtml({ settings, amountCents: Math.round(Math.max(0, balanceDue) * 100), refToken });
        }
      }
    } catch (e) {
      console.log('[invoice] financing block skipped:', e);
    }

    // The email headline + Pay button must show the amount the pay link actually
    // charges (retention-net, less payments) — otherwise the client taps a
    // "$100,000" button that charges $90,000. Retention still owed shows in the
    // attached/portal invoice detail, not this collect-now nudge.
    const amountDueNow = Math.max(0, balanceDue);
    const html = buildInvoiceEmailHtml({
      companyName: branding.companyName,
      recipientName: sendRecipientName,
      projectName: project?.name ?? 'Project',
      invoiceNumber: workingInvoice.number,
      totalDue: amountDueNow,
      dueDate,
      paymentTerms,
      contactName: branding.contactName,
      contactEmail: branding.email,
      contactPhone: branding.phone,
      // One-tap pay button in the email body. Closes the friction loop:
      // client gets invoice → taps "Pay Securely" → on Stripe in 1s.
      payLinkUrl,
      financingHtml,
    });

    const result = await sendEmail({
      to: sendRecipientEmail.trim(),
      // Exact to the cent (#135): the subject is the figure the Pay button
      // charges — "$77K due" over a $77,484.88 charge read as a mismatch.
      subject: `Invoice #${workingInvoice.number}: ${formatCurrency(amountDueNow)} due · ${project?.name ?? 'Project'}`,
      html,
      replyTo: branding.email || undefined,
      fromCompanyName: branding.companyName || undefined,
      unsubscribe: { recipientEmail: sendRecipientEmail.trim(), eventKey: 'invoice', enabled: true },
    });

    if (!result.success) {
      // Nothing to roll back: a new invoice is still the draft it was created
      // as, and an existing one was never flipped. (This branch is also reached
      // on web when Resend is down — sendEmail returns success only for outcome
      // 'sent', never for an opened mailto: stub.)
      //
      // Point this editor AT the draft it just created, so a second tap of
      // Send sends that invoice instead of building another one under the
      // next number. (Also set right after addInvoice — #34; kept here so the
      // failure path never depends on that earlier call.)
      if (createdNew) router.setParams({ invoiceId: workingInvoice.id });
      if (result.error === 'cancelled') return;
      console.warn('[Invoice] Email send failed:', result.outcome, result.error);
      if (result.outcome === 'composer_opened') {
        // #84: the address is known — he typed it a moment ago. Store it on
        // the draft now (through the offline queue), so when he taps Mark
        // sent the reminders chase THIS recipient, not the first portal
        // invitee or nobody. A draft is never dunned, so this is safe; only
        // when it changed, and never an empty value over a stored one.
        const typedTo = sendRecipientEmail.trim();
        const storedTo = (workingInvoice as Invoice & InvoiceBillTo).billToEmail?.trim() ?? '';
        if (typedTo.includes('@') && typedTo !== storedTo) {
          const billToPatch: Partial<Invoice> & InvoiceBillTo = {
            billToEmail: typedTo,
            billToName: sendRecipientName.trim() || undefined,
          };
          updateInvoice(workingInvoice.id, billToPatch);
        }
        showAlert(
          'Draft opened — not sent yet',
          // Say how to finish: until he taps Mark sent, the row stays a draft —
          // not dunned, not in A/R, not pushed to QuickBooks — even once the
          // email (with its Pay link) is in the client's inbox.
          `${result.error ?? 'A draft was opened in your email app.'}\n\nInvoice #${workingInvoice.number} is still ${createdNew ? 'a draft' : 'unsent'} until it goes out.${createdNew || existingInvoice?.status === 'draft' ? ' Once you have sent it from your email app, tap Mark sent on the invoice so its due date, reminders and QuickBooks start.' : ''}`,
        );
        return;
      }
      showAlert('Email Notice', `Invoice ${createdNew ? 'saved as draft' : 'saved'} but email could not be sent: ${result.error}`);
      return;
    }
    console.log('[Invoice] Email sent successfully');

    // Persist the sent state. A new invoice was created as a draft with full
    // data — it needs only the flip, with the due date counted from the send
    // (updateInvoice reads the latest list, so it finds the invoice added
    // above, and orders its write behind that insert). Existing invoices need
    // their edits + status flushed.
    // #47: the address it went to is stored with the flip, so the reminder
    // cron chases THIS recipient instead of whoever is first on the portal.
    const billTo: InvoiceBillTo = {
      billToEmail: sendRecipientEmail.trim(),
      billToName: sendRecipientName.trim() || undefined,
    };
    if (createdNew) {
      updateInvoice(workingInvoice.id, { status: 'sent', dueDate, ...billTo });
    } else if (existingInvoice && isResend) {
      // A re-send records only who it went to — no status, no due date, no
      // re-priced lines on an invoice the client already holds.
      const billToOnly: Partial<Invoice> & InvoiceBillTo = { ...billTo };
      updateInvoice(existingInvoice.id, billToOnly);
    } else if (existingInvoice) {
      updateInvoice(existingInvoice.id, {
        ...billTo,
        lineItems,
        paymentTerms,
        notes: notes.trim(),
        subtotal,
        taxRate,
        taxAmount,
        totalDue,
        dueDate,
        status: 'sent',
        // #20: a draft's first send is its issue date (not the day it was staged).
        ...(existingInvoice.status === 'draft' ? { issueDate: new Date().toISOString() } : {}),
        progressPercent: isProgressType ? pctValue : undefined,
        // MISS-05: persist a deliberate 0% AS 0 rather than erasing it with
        // `|| undefined`, so the row records that this invoice withheld nothing
        // instead of leaving it unknown. Nothing branches on the difference
        // today — retainagePercentForInvoice reads both as 0 — the invented
        // 10% was removed from the AIA seeder itself, not from this write.
        retentionPercent: retentionPctValue,
        retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
      });
    }

    // #45: post it to the client portal too (ticked by default). Through the
    // latest-callback ref, so the context's newest sendToClientPortal — the
    // one that can see the invoice added above — is the one called. A failed
    // post never un-sends the email; it is named in the result instead.
    let portalNote = '';
    if (postToPortal && portalEnabled) {
      try {
        await sendToClientPortalRef.current({ kind: 'invoice', itemId: workingInvoice.id, projectId: workingInvoice.projectId });
      } catch (err) {
        console.warn('[Invoice] portal post after email failed:', err);
        portalNote = ` It was not posted to the client portal (${err instanceof Error ? err.message : 'try Send to Client below'}).`;
      }
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (noPayButtonReason) {
      showAlert(
        `Invoice #${workingInvoice.number} sent — no Pay button`,
        `${sentWithoutPayButtonMessage(workingInvoice.number, noPayButtonReason)}${portalNote}`,
      );
      router.back();
      return 'left';
    }
    if (portalNote) {
      showAlert(`Invoice #${workingInvoice.number} sent${recipientInfo}`, portalNote.trim());
      router.back();
      return 'left';
    }

    // FF1-C: Stripe-not-connected nudge — show ONCE EVER, not on every
    // send. After the first time, the user knows; nagging on each invoice
    // is friction. A failed flag read counts as "not seen" (show it);
    // the flag write is fire-and-forget and never blocks the send.
    const stripeNudgeSeen = await AsyncStorage.getItem('mageid_stripe_nudge_seen').catch(() => null);
    if (stripeNotConnected && totalDue > 0 && stripeNudgeSeen !== '1') {
      void AsyncStorage.setItem('mageid_stripe_nudge_seen', '1');
      showAlert(
        'Invoice sent — no Pay button included',
        "You haven't connected Stripe yet, so this invoice was emailed without a one-tap Pay button. Set up Stripe in Payments to add Pay buttons to future invoices.",
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Set up Stripe', onPress: () => router.push('/payments-setup' as never) },
        ],
      );
    } else {
      // The nudge is once-ever; after it, a send with no Pay button still
      // says so in the toast rather than reading as a plain "sent" (#36).
      nailIt(`Invoice #${workingInvoice.number} sent${recipientInfo}${stripeNotConnected && totalDue > 0 ? ' — no Pay button (Stripe not connected)' : ''}`);
    }
    router.back();
    return 'left';
  }, [billingBlocked, sendRecipientEmail, sendRecipientName, projectId, lineItems, settings, project, existingInvoice, buildNewInvoice, addInvoice, totalDue, balanceDue, mintPayLinkFor, paymentTerms, notes, subtotal, taxRate, taxAmount, isProgressType, pctValue, retentionPctValue, retentionAmount, updateInvoice, router, ensureReferral, linkMilestone, postToPortal, portalEnabled, awaitInvoiceInsert]);

  /**
   * #34 — Send & Save, one at a time. The lock is taken synchronously at the
   * very top (before any validation return) and released in `finally` on
   * every exit that does NOT leave the screen: 'cancelled', composer_opened,
   * a refused insert, a failed email, a thrown error. On success the screen
   * is popping, so it stays held — the same rule as change-order.tsx.
   */
  const handleConfirmSend = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSendInFlight(true);
    let left = false;
    try {
      left = (await runConfirmSend()) === 'left';
    } finally {
      if (!left) {
        sendingRef.current = false;
        setSendInFlight(false);
      }
    }
  }, [runConfirmSend]);

  const handleSendPDF = useCallback(async (options: PDFSendOptions) => {
    if (!project || !existingInvoice) return;
    setShowPDFPreSend(false);

    if (options.method === 'email' && options.recipient.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const dueDate = existingInvoice.dueDate || getDueDate(new Date().toISOString(), existingInvoice.paymentTerms);

      // Same auto-generate logic as handleConfirmSend — the PDF send path
      // is the other entry point for "send to client", so it needs the
      // same guarantee that a payment link will be embedded. Charge the
      // retention-NET balance (held retention isn't collectible yet); this
      // path reads the stored invoice fields, so compute net from them.
      const pdfNetDue = netBalanceDue(existingInvoice);
      // MONEY-F2: reuse the stored link only while it still charges this
      // balance; otherwise re-mint, and on failure send without a link.
      const storedLinkMatchesBalance = !!existingInvoice.payLinkUrl
        && existingInvoice.payLinkAmount != null
        && Math.abs(existingInvoice.payLinkAmount - pdfNetDue) <= 0.01;
      let payLinkUrl: string | undefined = storedLinkMatchesBalance ? existingInvoice.payLinkUrl : undefined;
      // Same honesty as handleConfirmSend (#49): a failed mint is named in the
      // result, never swallowed behind "Email Sent".
      let noPayButtonReason: string | null = null;
      // #39 (review round 1): the PDF send is the other way a draft reaches
      // the client, so it asks the same question runConfirmSend does — is
      // this draft on the server? A write of it the server refused sits in
      // the ledger's "Not saved" list and nothing resends it on its own:
      // stop before the email. One still in the offline queue goes without a
      // Pay button (create-payment-link would 404), saying why.
      let pdfInsertQueued = false;
      if (existingInvoice.status === 'draft') {
        try {
          if ((await unsavedWriteIds('invoices')).has(existingInvoice.id)) {
            showAlert('Invoice not sent', invoiceUnsavedOnServerMessage(existingInvoice.number));
            return;
          }
          pdfInsertQueued = pendingIdsForTable(await getOfflineQueue(), 'invoices').has(existingInvoice.id);
        } catch { /* unreadable ledger/queue: the mint below answers for the row */ }
      }
      if (pdfInsertQueued && !storedLinkMatchesBalance && pdfNetDue > 0) {
        noPayButtonReason = INVOICE_INSERT_QUEUED_REASON;
      } else if (!storedLinkMatchesBalance && pdfNetDue > 0) {
        try {
          const minted = await mintPayLinkFor(existingInvoice, pdfNetDue, options.recipient.trim());
          if (minted.ok) {
            payLinkUrl = minted.url;
          } else if (minted.reason === 'not_connected') {
            // #36: this path used to only log, and the result read "Email
            // Sent" over an invoice the client could not pay online.
            console.log('[Invoice] PDF send: skipping payment link — Stripe Connect not set up');
            noPayButtonReason = STRIPE_NOT_CONNECTED_REASON;
          } else {
            console.warn('[Invoice] PDF send: payment link mint failed:', minted.error);
            noPayButtonReason = minted.message ?? payLinkFailureReason(minted.error);
          }
        } catch (err) {
          console.warn('[Invoice] Auto pay-link gen failed in handleSendPDF:', err);
          noPayButtonReason = payLinkFailureReason(err instanceof Error ? err.message : String(err));
        }
      }

      // Email headline + Pay button show the retention-net collectible (matches
      // the pay-link charge); the attached PDF carries the full invoice total and
      // retention breakdown.
      const emailHtml = buildInvoiceEmailHtml({
        companyName: branding.companyName,
        recipientName: '',
        projectName: project.name,
        invoiceNumber: existingInvoice.number,
        totalDue: pdfNetDue,
        dueDate,
        paymentTerms: existingInvoice.paymentTerms,
        message: options.message,
        contactName: branding.contactName,
        contactEmail: branding.email,
        contactPhone: branding.phone,
        payLinkUrl,
      });

      const pdfUri = await generateInvoicePDFUri(existingInvoice, project, branding);

      // generateInvoicePDFUri is a hard `if (Platform.OS === 'web') return null`
      // (utils/pdfGenerator.ts:1407), and it also returns null when expo-print
      // throws on native. The old code fed that straight into
      // `attachments: pdfUri ? [pdfUri] : undefined` and then showed "Email Sent"
      // either way — so a GC on the web app emailed their client an invoice with
      // no invoice attached and was told the send succeeded. This flow exists to
      // deliver a document; if the document isn't there, ask before sending
      // rather than discovering it at the client's end.
      if (!pdfUri) {
        const proceedWithoutPdf = await new Promise<boolean>((resolve) => {
          showAlert(
            'PDF could not be attached',
            Platform.OS === 'web'
              ? `The web app cannot generate the invoice PDF file, so nothing can be attached to this email.\n\nWe can still email ${options.recipient.trim()} the invoice summary — amount due, terms${payLinkUrl ? ' and the Pay button' : ''}. To send the PDF itself, use Share instead and save it from the print dialog, or send from the iPhone app.`
              : `The invoice PDF could not be generated on this device, so nothing can be attached.\n\nWe can still email ${options.recipient.trim()} the invoice summary without it.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Send without PDF', onPress: () => resolve(true) },
            ],
            // Backdrop / Android back must resolve the promise too, or this
            // await never settles and the send button stays dead forever.
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!proceedWithoutPdf) return;
      }

      const result = await sendEmail({
        to: options.recipient.trim(),
        subject: `Invoice #${existingInvoice.number}: ${formatCurrency(pdfNetDue)} due · ${project.name}`,
        html: emailHtml,
        replyTo: branding.email || undefined,
        attachments: pdfUri ? [pdfUri] : undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: options.recipient.trim(), eventKey: 'invoice', enabled: true },
      });

      // The PDF can go missing in two places: we never had one (pdfUri null,
      // handled above) or the service failed to encode it (attachmentsDropped).
      // Either way the client got a summary, not the document, so the toast must
      // not read "Invoice emailed" flat.
      const pdfMissing = !pdfUri || (result.attachmentsDropped ?? 0) > 0;

      if (result.success) {
        // #47: remember who it went to, for reminders — only when it changed.
        const sentTo = options.recipient.trim();
        if ((existingInvoice as Invoice & InvoiceBillTo).billToEmail?.trim() !== sentTo) {
          // The PDF sheet asks for no name, so the previous recipient's name
          // is CLEARED with the address (the key present, value undefined →
          // bill_to_name null via invoiceBillToColumns): the dunning reminder
          // must not greet the lender's AP desk as "Jane".
          const billToPatch: Partial<Invoice> & InvoiceBillTo = { billToEmail: sentTo, billToName: undefined };
          updateInvoice(existingInvoice.id, billToPatch);
        }
        const payNote = noPayButtonReason ? `\n\n${sentWithoutPayButtonMessage(existingInvoice.number, noPayButtonReason)}` : '';
        showAlert(
          noPayButtonReason && !pdfMissing ? 'Sent — without a Pay button' : (pdfMissing ? 'Sent — without the PDF' : 'Email Sent'),
          (pdfMissing
            ? `The invoice summary was emailed to ${options.recipient}, but the PDF could not be attached. Send the PDF separately if the client needs the full document.`
            : `Invoice emailed to ${options.recipient}`) + payNote,
        );
      } else if (result.error === 'cancelled') {
        return;
      } else if (result.outcome === 'composer_opened') {
        // sendEmail could not reach Resend and dropped a draft into the user's
        // mail app instead. Nothing has been sent, and saying "Email Sent" here
        // is exactly the lie this screen used to tell on web.
        // #84: the address is known, so keep it for reminders now — this
        // invoice already went out once (the card only offers this path for a
        // sent invoice), and the success-only write below never runs here.
        const draftTo = options.recipient.trim();
        if (draftTo.includes('@') && (existingInvoice as Invoice & InvoiceBillTo).billToEmail?.trim() !== draftTo) {
          const billToPatch: Partial<Invoice> & InvoiceBillTo = { billToEmail: draftTo, billToName: undefined };
          updateInvoice(existingInvoice.id, billToPatch);
        }
        showAlert('Draft opened — not sent yet', result.error ?? 'Review the draft in your email app and press Send there.');
      } else {
        showAlert(
          'Email Issue',
          pdfUri
            ? 'Could not send via email. Would you like to share the PDF using another app instead?'
            : `Could not send via email.${result.error ? ` ${result.error}` : ''}`,
          pdfUri
            ? [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Share PDF',
                  onPress: async () => {
                    try {
                      // pdfUri is non-null in this branch — no need to re-generate,
                      // and re-generating on web would only hand Sharing a null.
                      if (await Sharing.isAvailableAsync()) {
                        await Sharing.shareAsync(pdfUri, {
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
            : undefined,
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
      showAlert('Error', pdfFailureMessage(e, 'Failed to generate PDF. Please try again.'));
    }
  }, [project, existingInvoice, settings, mintPayLinkFor, updateInvoice]);

  // "Open Not saved" from inside the Record Payment sheet. The Not-saved sheet
  // is a second Modal (the app-wide sync pill's), and iOS presents one Modal
  // at a time: asked for while this sheet was up, it silently never appeared.
  // Close this sheet first, then ask once its dismissal has finished (the
  // construction-ai pattern). What he typed stays: resumePaymentSheetRef tells
  // openRecordPayment not to reset it on the next open — EXCEPT when the
  // payment waiting under Not saved is the same money (`resume` false): the
  // dialog tells him to retry THAT one, and a sheet pre-filled with the same
  // amount, day and check # after the Retry landed was one tap from counting
  // it twice (nothing then warns — the retried append has left the ledger).
  const openNotSavedFromPaymentSheet = useCallback((resume: boolean = true) => {
    resumePaymentSheetRef.current = resume;
    setShowPaymentModal(false);
    setTimeout(requestSyncSheet, Platform.OS === 'ios' ? 450 : 0);
  }, []);

  const commitPayment = useCallback(async (amt: number) => {
    if (!existingInvoice) return;

    // #133: `date` stays the instant it was recorded (the QuickBooks
    // reconciler matches on it); `receivedDate` is the day he says the money
    // arrived, which is what QuickBooks is dated with and what every reader
    // of "when was this paid" prefers (billingFlowCore.paymentReceivedDay).
    const reference = paymentReference.trim();
    const payment: InvoicePayment & RecordedPaymentFields = {
      id: createId('pay'),
      date: new Date().toISOString(),
      amount: amt,
      method: paymentMethod,
      receivedDate: calendarDayOf(paymentReceivedDate) ?? todayCalendarDay(),
      ...(reference ? { reference } : {}),
    };
    // The LOCAL guess at the new status — only reported when the server's
    // answer is not in (queued); the ledger decides everything else.
    // To the cent: two float adds of $0.10 are not $0.20.
    const newPaid = Math.round((amountPaid + amt) * 100) / 100;
    // MONEY-F5: settled = the retention-net balance is covered. Held retention
    // no longer parks an invoice at "partially paid" until closeout.
    const localStatus = invoiceIsSettled({
      totalDue, amountPaid: newPaid, subtotal, retentionPercent: retentionPctValue, retentionAmount, retentionReleased,
    })
      ? 'paid' as const
      : 'partially_paid' as const;

    // #80 (BLOCKER): ONE entry, appended on the server under a row lock
    // (invoice_append_payment, queued as an 'rpc' op when offline and replayed
    // idempotently by its id). This used to be updateInvoice with the device's
    // whole payments array + amount_paid + status — and a phone that had not
    // seen the client's Pay-link payment erased it on the server.
    let outcome: 'synced' | 'queued' | 'failed';
    try {
      outcome = await recordInvoicePayment(existingInvoice.id, payment);
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'failed') {
      // Never "Payment Recorded" for a payment that exists nowhere.
      // Integration round 2: two different 'failed's, worded apart. HELD — the
      // invoice has an earlier change under Not saved, so the append was
      // never sent (offlineQueue's park rule; the call owns its refusal, so no
      // line was added). Round 1 told him the server "did not accept" money
      // it never received. REFUSED — sent, and the server said no (never a
      // dropped signal: that queues); not parked either, so recording it
      // again is the one way to retry and can never count it twice.
      let held = false;
      try { held = await hasUnsavedChainForSession('invoices', existingInvoice.id); } catch { held = false; }
      if (held) {
        showAlert(
          'Payment not sent',
          `Not sent — an earlier change to this invoice is under Not saved on the sync badge, and this invoice's changes go to MAGE in order. Retry or discard it there first, then record the ${formatCurrency(amt)} payment. Nothing was recorded.`,
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Open Not saved', onPress: () => openNotSavedFromPaymentSheet(true) },
          ],
        );
        return;
      }
      showAlert('Payment not recorded', `The server did not accept the ${formatCurrency(amt)} payment — nothing was recorded.`);
      return;
    }

    // The server's row, read AFTER the append landed: the re-mint below charges
    // what the server says is owed, never the stale local balance.
    let server: ServerInvoiceSettlement | null = null;
    if (outcome === 'synced') {
      try {
        const { data } = await supabase
          .from('invoices')
          .select('total_due,amount_paid,subtotal,retention_percent,retention_amount,retention_released,status,pay_pending_at')
          .eq('id', existingInvoice.id)
          .maybeSingle();
        server = (data as ServerInvoiceSettlement | null) ?? null;
      } catch { server = null; }
    }
    const follow = afterRecordedPayment(outcome, server, { hadPayLink: !!existingInvoice.payLinkUrl, localStatus });
    const newStatus = follow.status;

    // MONEY-F2: pay_link_* are server-owned. A link minted for the pre-payment
    // amount would charge the ORIGINAL figure again, so when one exists and the
    // SERVER still shows a balance, re-mint for that balance —
    // create-payment-link deactivates the replaced link on Stripe. Queued
    // (offline): the server's balance has not moved yet, so there is nothing
    // true to mint for; the portal hides a link whose amount no longer matches
    // once it lands, and Send re-mints. Fire-and-forget: the payment is
    // recorded whether or not the mint succeeds.
    if (follow.remintFor != null) {
      void mintPayLinkFor(existingInvoice, follow.remintFor).catch((err) => {
        console.warn('[Invoice] re-mint after payment failed:', err);
      });
    }

    // Close the milestone lifecycle. markMilestoneInvoiced wrote 'invoiced'
    // when this invoice was created; until now NOTHING wrote 'paid', so
    // computeContractPaid always returned 0 and the two PAID branches on the
    // contract screen (:1087, :1201) could never render — a GC whose homeowner
    // had paid the foundation draw still saw it as merely billed, on the screen
    // whose whole job is telling him where the contract stands
    // (audit 2026-09-07, built-but-unreachable #7).
    //
    // Keyed on `sourceContractId` stored on the invoice at :521, NOT the
    // `contractId` route param — that param only exists when the GC arrived
    // from the contract screen's one-tap flow, and a payment is almost always
    // recorded later, from the invoice list, with no params at all.
    //
    // Only when the invoice is fully settled: a partial payment has not paid
    // the draw. Fire-and-forget, like the re-mint above — the payment is
    // already recorded, and a failed flip must never roll it back.
    // It is a direct write (see markMilestonePaidByInvoice), so when it does
    // not land he is TOLD (#136) — console.warn told nobody. The contract
    // screen shows the draw as paid from this invoice either way and repairs
    // the stored status the next time it opens.
    if (newStatus === 'paid' && existingInvoice.sourceContractId) {
      const flipFailed = () => showAlert(
        'Contract milestone not updated yet',
        `The payment on invoice #${existingInvoice.number} is recorded. The contract's payment schedule could not be updated just now (offline or a server error); the contract shows this draw as paid from the invoice, and saves it the next time you open the contract with signal.`,
      );
      void markMilestonePaidByInvoice(existingInvoice.sourceContractId, existingInvoice.id)
        .then((outcome) => { if (outcome === 'failed' || outcome === 'not_found') flipFailed(); })
        .catch(flipFailed);
    }

    // The result alert always shows; closing the sheet and going back only
    // while this invoice is still in front — a late back() after he left
    // closed the screen he had opened since (the payment is recorded either way).
    const stillInFront = screenInFrontRef.current;
    if (stillInFront) {
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentReceivedDate(todayCalendarDay());
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      outcome === 'queued' ? 'Payment saved on this phone' : 'Payment Recorded',
      outcome === 'queued'
        ? `${formatCurrency(amt)} payment saved. It is waiting in this phone's sync queue (no signal, or behind an earlier change to this invoice that has not reached the server yet) and reaches your books once it goes through.${existingInvoice.payLinkUrl ? ' Send the invoice again then, so the Pay link matches the new balance.' : ''}`
        : `${formatCurrency(amt)} payment recorded. Status: ${newStatus.replace('_', ' ')}`,
    );
    if (stillInFront) router.back();
  }, [paymentMethod, paymentReceivedDate, paymentReference, existingInvoice, amountPaid, totalDue, subtotal, retentionPctValue, retentionAmount, retentionReleased, recordInvoicePayment, mintPayLinkFor, router, openNotSavedFromPaymentSheet]);

  // Integration round 1: a payment append that is under Not saved (a queued
  // one the server later refused) is still Retry-able from the sync badge. A
  // new entry recorded here gets a NEW id, and invoice_append_payment only
  // de-duplicates by id — so re-entering the same check and then tapping Retry
  // counted it twice. Ask first, naming the amount waiting.
  //
  // Integration round 2: no record-anyway button. While ANY change to
  // this invoice is under Not saved, a new append is held behind it and never
  // sent (the queue's park rule — changes of one record reach MAGE in order),
  // so that button could never record, and then said the server refused it.
  // The dialog says what to do instead: Retry (same money) or Retry/Discard
  // the waiting one first (different money), then record this.
  const commitPaymentPastUnsaved = useCallback(async (amt: number) => {
    if (!existingInvoice) return;
    let waiting: number[] = [];
    try { waiting = await unsavedPaymentAppends(existingInvoice.id); } catch { waiting = []; }
    let held = waiting.length > 0;
    if (!held) { try { held = await hasUnsavedChainForSession('invoices', existingInvoice.id); } catch { held = false; } }
    if (!held) { await commitPayment(amt); return; }
    // Same money as a waiting append → do not bring the typed payment back
    // after the sheet (openNotSavedFromPaymentSheet): he is told to retry it
    // there, and the next open starts from the balance instead.
    const sameMoney = waiting.some((w) => Math.round(w * 100) === Math.round(amt * 100));
    const buttons = [
      { text: 'Cancel', style: 'cancel' as const },
      { text: 'Open Not saved', onPress: () => openNotSavedFromPaymentSheet(!sameMoney) },
    ];
    if (waiting.length === 0) {
      showAlert(
        'An earlier change to this invoice is not saved',
        `A change to this invoice is under Not saved on the sync badge — not on MAGE. This invoice's changes go to MAGE in order, so the ${formatCurrency(amt)} payment cannot be sent until that one is retried or discarded. Do that first, then record the payment.`,
        buttons,
      );
      return;
    }
    const amounts = waiting.map((a) => formatCurrency(a)).join(', ');
    showAlert(
      'A payment on this invoice is not saved yet',
      `${waiting.length === 1 ? `A ${amounts} payment` : `Payments of ${amounts}`} on this invoice ${waiting.length === 1 ? 'is' : 'are'} under Not saved on the sync badge — not recorded on MAGE. If this is the same money, retry it there instead: recording it here as well would count it twice. If it is a different payment, retry or discard the waiting one first — this invoice's changes go to MAGE in order — then record this one.`,
      buttons,
    );
  }, [existingInvoice, commitPayment, openNotSavedFromPaymentSheet]);

  // The whole record chain under the one-at-a-time lock, released on every
  // exit of it: the held / waiting dialogs, failed, queued and synced.
  const recordUnderLock = useCallback(async (amt: number) => {
    try {
      await commitPaymentPastUnsaved(amt);
    } finally {
      recordingPaymentRef.current = false;
      setRecordingPayment(false);
    }
  }, [commitPaymentPastUnsaved]);

  const handleMarkPaid = useCallback(() => {
    if (!existingInvoice) return;
    // Taken before any dialog, so a second tap can neither open a second
    // overpayment confirm nor start a second append.
    if (recordingPaymentRef.current) return;
    recordingPaymentRef.current = true;
    setRecordingPayment(true);
    const release = () => { recordingPaymentRef.current = false; setRecordingPayment(false); };
    // #134: parseMoneyInput, not parseFloat — '12,500.00' was recorded as $12
    // and pushed to QuickBooks. Refused with the reason, never read as 0;
    // rounded to the cent; more than the balance asks first (overpayments are
    // real — a combined check, a credit — so it asks rather than blocks).
    const decision = recordPaymentDecision(paymentAmount, balanceDue, parseMoneyInput, formatCurrency);
    if (decision.kind === 'refuse') {
      release();
      showAlert(decision.title, decision.message);
      return;
    }
    if (decision.kind === 'confirm') {
      // Android's back button dismisses with no button pressed: onDismiss
      // frees the lock then (web routes a backdrop tap through Cancel).
      showAlert(decision.title, decision.message, [
        { text: 'Cancel', style: 'cancel', onPress: release },
        { text: 'Record it', onPress: () => { void recordUnderLock(decision.amount); } },
      ], { onDismiss: release });
      return;
    }
    void recordUnderLock(decision.amount);
  }, [paymentAmount, balanceDue, existingInvoice, recordUnderLock]);

  // Stripe payment link: generate once per invoice (or regenerate if the link
  // is lost/stale). We persist `payLinkUrl` + `payLinkId` on the invoice so the
  // client portal snapshot picks it up and renders the Pay Now button without
  // needing another round-trip.
  const handleGeneratePayLink = useCallback(async () => {
    if (!existingInvoice || !project) return;
    if (balanceDue <= 0) {
      showAlert('Nothing Due', 'This invoice has no outstanding balance.');
      return;
    }
    // #83: Regenerate is a mint too.
    if (pendingBankPayment) {
      showAlert('Bank payment processing', `${pendingBankPayment.line}. Bank transfers take 3-5 business days; a new link now would invite the client to pay twice. If it fails you'll be told, and you can send a fresh link then.`);
      return;
    }
    // Same pre-check as the send paths: Stripe's per-charge limits never pass,
    // so say why instead of relaying Stripe's raw error after a round trip.
    if (payLinkLimitReason) {
      showAlert('No payment link for this amount', `${payLinkLimitReason.charAt(0).toUpperCase()}${payLinkLimitReason.slice(1)}.`);
      return;
    }

    setGeneratingPayLink(true);
    try {
      // Pre-flight: confirm the GC has connected their Stripe account.
      // Without this, the link gets created on the platform account and
      // money flows to the WRONG bank — exactly the bug we just fixed.
      let stripeAccountId: string | undefined;
      if (user?.id) {
        const status = await fetchStripeConnectStatus(user.id);
        if (!status.success) {
          showAlert('Connection Check Failed', status.error ?? 'Could not verify your payment setup.');
          return;
        }
        if (!status.chargesEnabled) {
          showAlert(
            'Set Up Payments First',
            'You need to connect your bank to receive payments. Set it up now?',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Set up', onPress: () => router.push('/payments-setup' as any) },
            ],
          );
          return;
        }
        stripeAccountId = status.accountId;
      }

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
        stripeAccountId,
        userTier: tier,
      });

      if (!res.success || !res.url || !res.id) {
        // #83 carry: the server refuses while a bank payment settles.
        if (await serverPaymentPending(existingInvoice.id)) {
          showAlert('Bank payment processing', `No new link: ${PAYMENT_PENDING_MINT_REASON}. If it fails you'll be told, and you can send a fresh link then.`);
          return;
        }
        showAlert('Could Not Create Payment Link', res.error ?? 'Unknown error from Stripe.');
        return;
      }

      updateInvoice(existingInvoice.id, {
        payLinkUrl: res.url,
        payLinkId: res.id,
        // MONEY-F2: the amount this link charges — the portal shows Pay only
        // while it still equals the balance due.
        payLinkAmount: Math.round(balanceDue * 100) / 100,
      });

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // #45: promise the portal button only when the portal shows this invoice.
      showAlert(
        'Payment Link Ready',
        invoicePayableInPortal(project.clientPortal, existingInvoice.portalState)
          ? 'A Stripe payment link has been generated and attached to this invoice. Your client will see a Pay Now button in the portal.'
          : `A Stripe payment link has been generated. Copy or share it with your client, or email the invoice so it carries the Pay button. ${
            portalHidesInvoices
              ? "Invoices are hidden on this project's portal, so it has no Pay button there."
              : invoicesVisibleInPortal(project.clientPortal)
                ? 'This invoice is not posted to the client portal, so it has no Pay button there.'
                : 'This project has no client portal, so there is no portal Pay button.'}`,
      );
    } catch (err) {
      console.error('[Invoice] Generate pay link failed:', err);
      showAlert('Error', 'Failed to generate payment link. Please try again.');
    } finally {
      setGeneratingPayLink(false);
    }
  }, [existingInvoice, project, balanceDue, payLinkLimitReason, pendingBankPayment, contacts, settings, updateInvoice, user, tier, router, serverPaymentPending]);

  // MONEY-F2: Copy / Share hand the client a URL that charges a fixed amount,
  // so both refuse a link whose minted amount is not today's balance (the card
  // below already hides them in that state; this is the belt to its braces).
  const handleCopyPayLink = useCallback(async () => {
    if (!existingInvoice?.payLinkUrl || !payLinkMatchesBalance) return;
    const ok = await copyToClipboard(existingInvoice.payLinkUrl);
    if (Platform.OS !== 'web' && ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'Copied' : 'Copy Failed',
      ok ? 'Payment link copied to clipboard.' : 'Could not copy to clipboard.',
    );
  }, [existingInvoice, payLinkMatchesBalance]);

  const handleSharePayLink = useCallback(async () => {
    if (!existingInvoice?.payLinkUrl || !payLinkMatchesBalance || !project) return;
    const brandingName = settings.branding?.companyName || 'MAGE ID';
    const message =
      `${brandingName} — Invoice #${existingInvoice.number} for ${project.name}\n` +
      `Amount due: ${formatCurrency(balanceDue)}\n\n` +
      `Pay securely here:\n${existingInvoice.payLinkUrl}`;
    try {
      await shareText({
        message,
        title: `Invoice #${existingInvoice.number}`,
        url: existingInvoice.payLinkUrl,
      });
    } catch (err) {
      console.error('[Invoice] Share pay link failed:', err);
    }
  }, [existingInvoice, payLinkMatchesBalance, project, balanceDue, settings]);

  // ── Payment reminders (dunning) ────────────────────────────────────
  // The invoice-dunning cron has always emailed escalating notices; the GC
  // just couldn't see it, trigger it, or tell whether one already went out —
  // which is what produces the awkward "did you get my email?" call. Both
  // halves are surfaced here: the state line, and a manual send.
  const reminderState = useMemo(() => {
    if (!existingInvoice) return null;
    // Snapshot the clock inside the memo: recomputing it every render would
    // invalidate this memo on every render, and the only thing that actually
    // moves the answer is the invoice itself (which updates after a send).
    const nowMs = Date.now();
    const lastMs = existingInvoice.dunningLastSentAt
      ? new Date(existingInvoice.dunningLastSentAt).getTime()
      : null;
    // `unsubscribed` is deliberately NOT guessed client-side — the edge fn is
    // the only place that can read the suppression list, and it re-checks
    // before every send. We show the button and report the server's answer.
    const eligibility = reminderEligibility({
      status: existingInvoice.status,
      totalDue: existingInvoice.totalDue ?? 0,
      amountPaid: existingInvoice.amountPaid ?? 0,
      // MONEY-F5: eligibility is net of held retention (see billingFlowCore).
      // MONEY-05: from the STORED row's own basis, so this screen's "a reminder
      // is/isn't eligible" line agrees with what the dunning cron will compute.
      subtotal: existingInvoice.subtotal,
      retentionPercent: existingInvoice.retentionPercent,
      retentionAmount: existingInvoice.retentionAmount ?? 0,
      retentionReleased: existingInvoice.retentionReleased ?? 0,
      dueMs: existingInvoice.dueDate ? new Date(existingInvoice.dueDate).getTime() : NaN,
      dunningStage: existingInvoice.dunningStage ?? 0,
      lastSentMs: lastMs != null && Number.isFinite(lastMs) ? lastMs : null,
      manual: true,
      // #47: the cron's own recipient order (billing email, then the first
      // portal invitee). None → the card says reminders are off, up front.
      hasRecipient: reminderRecipient(
        (existingInvoice as Invoice & InvoiceBillTo).billToEmail,
        project?.clientPortal?.invites,
      ) != null,
      // #83: invoice-dunning refuses while a bank payment settles; say so here.
      paymentPendingAt: existingInvoice.paymentPendingAt ?? null,
      nowMs,
    });
    return {
      eligibility,
      nowMs,
      lastMs: lastMs != null && Number.isFinite(lastMs) ? lastMs : null,
      sentLabel: reminderSentLabel(existingInvoice.dunningStage, lastMs),
    };
  }, [existingInvoice, project?.clientPortal?.invites]);

  // QuickBooks closed this invoice with something other than a payment (a
  // credit memo, journal entry, write-off). The dunning cron is paused on it;
  // a manual reminder is not, so the GC sees the flag and confirms first.
  const qboClosedFlag = qboClosedFlagOf(existingInvoice?.qboError);

  const handleSendReminder = useCallback(async () => {
    if (!existingInvoice || sendingReminder) return;
    setSendingReminder(true);
    try {
      const res = await sendInvoiceReminderNow(existingInvoice.id);
      if (!res.success) {
        showAlert('Reminder not sent', res.error ?? 'Could not reach the reminder service. Try again in a moment.');
        return;
      }
      if (res.outcome === 'skipped') {
        showAlert(
          'No reminder sent',
          res.reason === 'no_recipient'
            ? 'No client email is on file for this invoice. Email the invoice to your client (the address is kept for reminders) or add a portal invitee in Client Portal setup, then try again.'
            : res.reason
              ? reminderBlockMessage(res.reason as Parameters<typeof reminderBlockMessage>[0], reminderState?.lastMs, Date.now())
              : 'This invoice is not eligible for a reminder right now.',
        );
        return;
      }
      // Mirror the server's markers locally so the state line updates without
      // waiting for the next invoices refetch. These columns are written by
      // the edge function; echoing the SAME values back is idempotent.
      if (res.stage != null && res.sentAt) {
        updateInvoice(existingInvoice.id, { dunningStage: res.stage, dunningLastSentAt: res.sentAt });
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt(`${dunningStageLabel(res.stage ?? 1)} sent${res.recipient ? ` to ${res.recipient}` : ''}`);
    } finally {
      setSendingReminder(false);
    }
  }, [existingInvoice, sendingReminder, updateInvoice, reminderState?.lastMs]);

  // MISS-04 repair, GC-initiated. Rewrites this row's money columns from its
  // OWN stored figures: retention onto the work basis, and the three totals at
  // cent precision (production stored subtotal 75,595 / tax 5,669.625 /
  // total_due 81,264.625). Nothing is taken from the editor's live state, so
  // this is safe on a locked invoice — which is the only kind the banner can
  // realistically appear on, since every invoice past draft hides the save bar.
  //
  // MONEY-05 changed what this button is FOR. It used to be the only way to make
  // the rest of the app agree with this screen; now `effectiveRetentionHeld`
  // makes every reader agree on read, so no money moves when it is pressed. What
  // it still does — and the only thing it claims to do — is bring the saved
  // column into line for everything that reads the raw record: the CSV export,
  // the closeout packet's invoice register, an accountant querying the table.
  const handleCorrectRetentionBasis = useCallback(() => {
    if (!existingInvoice || !legacyTaxBasisRetention) return;
    const { corrected, overheld } = legacyTaxBasisRetention;
    const storedPct = existingInvoice.retentionPercent ?? 0;
    updateInvoice(existingInvoice.id, {
      retentionAmount: corrected,
      subtotal: roundCents(existingInvoice.subtotal),
      taxAmount: roundCents(existingInvoice.taxAmount),
      totalDue: roundCents(existingInvoice.totalDue),
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      'Saved Figure Updated',
      `This invoice now records ${formatCurrency(corrected)} held — ${storedPct}% of the work completed. `
      + `The ${formatCurrency(overheld)} that was recorded against sales tax was never being charged: `
      + `this screen, the Retention screen, Payments, the client portal, the pay link and your `
      + `exports were already using the corrected figure. The stored record now matches them.`,
    );
  }, [existingInvoice, legacyTaxBasisRetention, updateInvoice]);

  // MONEY / RETAINAGE-1: the mechanics of a release — the cap, the re-open, the
  // fresh due date, the dunning reset, the pay-link clear — now live in
  // utils/retainage.buildRetainageReleasePatch, because app/retention.tsx
  // releases retainage across a whole job and a second copy of this arithmetic
  // is how this repo has produced double-billing before. This handler keeps the
  // things only a screen can do: validating the typed amount with a message a
  // human reads, and re-minting the Stripe link.
  //
  // The LIVE editor figures are passed over the stored row (subtotal,
  // retentionPctValue, retentionAmount, amountPaid), exactly as before, so a
  // draft mid-edit releases against what is on screen.
  const handleReleaseRetention = useCallback(() => {
    if (!existingInvoice) return;
    // #134: parseMoneyInput, not parseFloat — '10,000' released $10. The cap
    // below already refuses more than is held; this only reads the number.
    const amt = parsePositiveMoney(retentionReleaseAmount, parseMoneyInput);
    if (amt == null) {
      showAlert('Couldn’t read that amount', 'Type the release amount above $0.00, like 10000.00 or 10,000.00.');
      return;
    }
    if (amt > retentionPending + 0.001) {
      showAlert('Exceeds Pending', `Only ${formatCurrency(retentionPending)} of retention is pending. Reduce the amount.`);
      return;
    }
    // MONEY-F7: ONE meaning — released = now collectible. The amount flows
    // into the balance due / forecast income; the cash is recorded later as a
    // payment ("Record Payment"), never here. No payment method is collected
    // because nothing has been paid yet.
    const outcome = buildRetainageReleasePatch(
      {
        ...existingInvoice,
        // Inline, like the MONEY-05 read sites: these are the LIVE editor
        // figures being read, not one of the three persist sites, and the
        // write-site guard in scripts/validate-invoice-billing.ts counts the
        // standalone-line spelling.
        totalDue, amountPaid, subtotal, retentionPercent: retentionPctValue, retentionAmount, retentionReleased,
      },
      amt,
      {
        now: new Date().toISOString(),
        makeId: () => createId('ret'),
        dueDateFor: getDueDate,
        note: retentionReleaseNote,
      },
    );
    if (!outcome) {
      showAlert('Exceeds Pending', `Only ${formatCurrency(retentionPending)} of retention is pending. Reduce the amount.`);
      return;
    }
    updateInvoice(existingInvoice.id, outcome.patch);
    // MONEY-F2: pay_link_* are server-owned, so the local clear is undone by
    // the next refetch. When a link is live for the old balance, re-mint for
    // the new one — create-payment-link retires the replaced link on Stripe
    // (there is no standalone deactivate endpoint). Fire-and-forget; the
    // release is recorded either way, and a failed mint leaves the stale link
    // hidden behind payLinkMatchesBalance until Send / Regenerate re-mints.
    const newBalance = outcome.newBalance;
    if (outcome.needsPayLinkRemint) {
      void mintPayLinkFor(existingInvoice, newBalance).catch((err) => {
        console.warn('[Invoice] re-mint after retention release failed:', err);
      });
    }
    setShowRetentionModal(false);
    setRetentionReleaseAmount('');
    setRetentionReleaseNote('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Retention Released', `${formatCurrency(outcome.amount)} is now collectible. Regenerate the pay link or send the invoice to bill it; record the payment when it arrives.`);
  }, [existingInvoice, retentionReleaseAmount, retentionReleaseNote, retentionPending, retentionReleased, totalDue, amountPaid, subtotal, retentionPctValue, retentionAmount, updateInvoice, mintPayLinkFor]);

  // Use the effective status so an unpaid-but-past-due invoice flips to "overdue"
  // in the UI without anyone having to run a cron to mutate the record, and a
  // fully-paid invoice reads as "paid" even if the stored status lagged behind.
  const effectiveStatus = existingInvoice ? getEffectiveInvoiceStatus(existingInvoice) : null;
  // A locked invoice hides the action bar, so it must not keep lifting the FAB.
  // Derived above the early return below so the hook order never changes.
  const isLocked = effectiveStatus === 'paid'
    || effectiveStatus === 'sent'
    || effectiveStatus === 'partially_paid'
    || effectiveStatus === 'overdue';
  // ONE value for the lift and the padding. The bar is position:'absolute'
  // over the scroll, so the container still reaches the window bottom while the
  // FAB rides `fabLift` above its resting +70..+126 — the last row has to clear
  // BOTH. Reviewed 2026-09-07: seven screens had padded for the FAB and not for
  // the bar it was sitting on, burying roughly a bar-height of content.
  const fabLift = !isLocked ? bottomBarH : 0;
  useBrainFabLift(fabLift);
  // Money can be recorded on any invoice the client has seen that is not yet
  // settled. Effective, not stored, status — so a legacy row stored 'paid' with
  // a balance reopened by a retention release still offers Record Payment and
  // the pay-link card (review of B3a: the released $10,000 was a dead end).
  const canRecordPayment = !!existingInvoice && effectiveStatus !== 'draft' && effectiveStatus !== 'paid';
  const confirmedDespitePending = useRef(false);
  const openRecordPayment = () => {
    // #83: a check recorded while the client's bank payment settles is usually
    // the SAME money counted twice. Asked, not blocked — a second payment for
    // the rest of the balance is real.
    if (pendingBankPayment && !confirmedDespitePending.current) {
      showAlert(
        'A bank payment is processing',
        `${pendingBankPayment.line}. It is credited automatically when it clears. Record a different payment anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Record another', onPress: () => { confirmedDespitePending.current = true; openRecordPayment(); confirmedDespitePending.current = false; } },
        ],
      );
      return;
    }
    if (resumePaymentSheetRef.current) {
      // Back from Open Not saved: his typed payment, not a fresh one.
      resumePaymentSheetRef.current = false;
      setShowPaymentModal(true);
      return;
    }
    setPaymentAmount(balanceDue.toFixed(2));
    setPaymentReceivedDate(todayCalendarDay());
    setPaymentReference('');
    setShowPaymentModal(true);
  };

  /**
   * Ask for the retainage exactly once, at the moment it first matters.
   *
   * `needsAsk` is only true when the resolver found nothing on this invoice, no
   * prior non-draft invoice, no contract term on the job and no saved G702 — i.e.
   * this is the first bill on the job and the number has never been recorded
   * anywhere. A locked (already-sent) invoice is never asked: its rate is a fact
   * about a document the client already has, not a preference to collect now.
   *
   * `retainageAsked` is set the moment it opens, so backing out of the sheet does
   * not put it straight back up, and the Retention row below keeps a way in.
   */
  useEffect(() => {
    // `project` is required: this screen can mount with no job picked (the
    // ToolProjectPicker path below), and burning the one-shot there would mean
    // the ask never appears once he does pick one.
    // Never over a deposit: the contract already answered it (#32).
    if (project && retainageSeed.needsAsk && !isLocked && !retainageAsked && !isDepositInvoice) {
      setRetainageAsked(true);
      setShowRetainageAsk(true);
    }
  }, [project, retainageSeed.needsAsk, isLocked, retainageAsked, isDepositInvoice]);

  /**
   * He answered. The rate goes on the invoice being edited AND on the job, so
   * the second invoice does not have to ask again and the retention screen has
   * something to plan a release against.
   *
   * `assumed: false` — this came from him, not from an inference, so it is a
   * contract term that outranks a disagreeing carry-forward on later invoices
   * (utils/retainageSource, audit round 2 #26).
   *
   * Durable across devices: since e7089d53 the rate syncs as
   * project_financials.retainage_percent (+ retainage_percent_assumed) and
   * contractTermsAfterLoad keeps it across fetches — the same field the
   * project page's Retainage % edits.
   */
  const handleRetainageAnswer = useCallback((pct: number) => {
    setRetentionPercent(String(pct));
    setRetentionSeedUntouched(false);
    setShowRetainageAsk(false);
    setRetainageAskInput('');
    const patch = retainageAnswerPatch(pct, { assumed: false });
    if (patch && projectId) updateProject(projectId, patch);
  }, [projectId, updateProject]);

  /**
   * He tapped "Not sure". STORE NOTHING — not a guess, not a flagged guess.
   * `retainageAnswerPatch(null)` returns null for exactly this reason: an
   * invented rate is billed, sent and then argued about, whereas "not on file"
   * is a sentence the Retention row can say out loud and he can correct later.
   */
  const handleRetainageUnknown = useCallback(() => {
    setShowRetainageAsk(false);
    setRetainageAskInput('');
  }, []);

  /**
   * The one line beside the Retention box saying where its number came from.
   *
   *  · no rate saved on this invoice → the resolver's own label (carried,
   *    contract, pay app, conflict, or "not on file");
   *  · an unlocked DRAFT that already holds a rate (every Bill-from-Estimate
   *    draft) → the job's provenance when it agrees with the draft, or, when a
   *    contract rate he typed disagrees, both numbers — so a draft seeded at
   *    0% before he entered 10% on the project page says so instead of going
   *    out at 0% unremarked. It is NOT changed for him: a saved rate is his.
   *  · a sent invoice → nothing. Its rate is a fact about a document the
   *    client already has; a later contract edit never relabels or rewrites it.
   */
  const retentionProvenance = useMemo<{ label: string; warn: boolean } | null>(() => {
    if (!retentionSeedUntouched) return null;
    if (isDepositInvoice) return { label: 'Deposit — no retainage held (per contract)', warn: false };
    if (retainageSeed.source !== 'invoice') {
      return { label: retainageSeed.label, warn: retainageSeed.needsAsk || !!retainageSeed.conflict };
    }
    if (isLocked || existingInvoice?.status !== 'draft' || retainageBasis.needsAsk) return null;
    const own = retainageSeed.percent;
    if (retainageBasis.percent === own) return { label: retainageBasis.label, warn: false };
    if (retainageBasis.source === 'contract' && project?.retainagePercentAssumed === false) {
      return { label: `this draft holds ${own}%, your contract says ${retainageBasis.percent}%`, warn: true };
    }
    return null;
  }, [retentionSeedUntouched, retainageSeed, retainageBasis, isLocked, existingInvoice?.status, project?.retainagePercentAssumed, isDepositInvoice]);

  // parsePercentInput, not parseFloat: '1,5' read as 1% and '10abc' as 10% (#134).
  const retainageAskValue = parsePercentInput(retainageAskInput) ?? NaN;
  const retainageAskValid = retainageAskInput.trim().length > 0 && isRecordedRetainageRate(retainageAskValue);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Invoices' }} />
        <ToolProjectPicker
          toolName="Invoices"
          message="Invoices live inside a project so they roll up to the right billing total."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MageInvoice size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Invoices in the project tile grid.',
            'Hit + New Invoice and bill against an estimate or line items.',
          ]}
        />
      </View>
    );
  }

  // #38: a job picked on this screen gets the same owner-only gate.
  if (innerRoleGate !== 'open') {
    return <InvoiceRoleBlocked gate={innerRoleGate} pausedReason={innerRoleState.reason} onRetry={innerRoleState.refetch} />;
  }

  const daysPastDue = existingInvoice ? getDaysPastDue(existingInvoice) : 0;

  // Audit-2026-05-21 (#28.2 MED): tighten lock from paid-only to "anything
  // past draft." Pre-fix the lock was effectiveStatus === 'paid' only, so a
  // SENT invoice was fully editable — GC could change line items + totals
  // after the client had already received the invoice + the Stripe pay link.
  // Industry standard (QuickBooks/Xero/FreshBooks) locks at SENT and
  // requires a Void & Reissue to make changes. The lock here gates only
  // line-item edits + pickers; status-action buttons (Mark paid, Generate
  // pay link, Send) are gated independently by effectiveStatus checks and
  // continue to work post-send.

  const statusColor = effectiveStatus ? getInvoiceStatusColors(themeColors, effectiveStatus) : null;
  const statusLabel = effectiveStatus ? (
    effectiveStatus === 'sent' ? 'Awaiting Payment' :
    effectiveStatus === 'partially_paid' ? 'Partially Paid' :
    effectiveStatus === 'overdue' ? `Overdue${daysPastDue > 0 ? ` • ${daysPastDue}d` : ''}` :
    effectiveStatus === 'paid' ? 'Paid' :
    effectiveStatus === 'draft' ? 'Draft' : effectiveStatus
  ) : '';

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{
        title: existingInvoice ? `Invoice #${existingInvoice.number}` : 'New Invoice',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          {...fabScroll}
          contentContainerStyle={[{ paddingBottom: insets.bottom + fabLift + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>
              {isProgressType ? 'Progress Bill' : 'Full Invoice'} #{nextInvoiceNumber}
            </Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            {existingInvoice && statusColor && (
              <View style={[styles.statusBadge, { backgroundColor: statusColor.bg, borderColor: statusColor.text + '33' }]}>
                <Text style={[styles.statusText, { color: statusColor.text }]}>
                  {statusLabel}
                </Text>
              </View>
            )}
            {existingInvoice && (
              <PortalStatusPill portalState={existingInvoice.portalState} itemUpdatedAt={existingInvoice.updatedAt} />
            )}
          </View>

          {existingInvoice && (
            <View style={styles.pipelineWrap}>
              <StatusPipeline
                stages={INVOICE_PIPELINE_STAGES}
                current={mapInvoiceStatus(existingInvoice.status)}
                startedAt={existingInvoice.issueDate}
                dueAt={existingInvoice.dueDate}
                onAdvance={(next) => {
                  // "Mark paid" records the money; it does not just flip a
                  // word. A stored 'paid' with nothing in amountPaid is a
                  // balance every money surface (A/R aging, cash-flow, the
                  // effective status) still sees as open — so route it
                  // through Record Payment, prefilled with the balance.
                  if (next === 'paid') { openRecordPayment(); return; }
                  // "Mark sent" on a draft (he printed or texted it himself)
                  // starts the payment clock exactly as Send does: due date =
                  // today + the stored terms. Flipping only the status left
                  // the server's due_date at whatever day the draft was last
                  // saved, and invoice-dunning counts from that — a draft
                  // saved in September and marked sent in October drew a
                  // "34 days overdue / FINAL NOTICE" as its first reminder.
                  if (next === 'sent' && existingInvoice.status === 'draft') {
                    // #20: and the issue date is the day it went out, like Send.
                    const sentAt = new Date().toISOString();
                    updateInvoice(existingInvoice.id, {
                      status: 'sent',
                      issueDate: sentAt,
                      dueDate: getDueDate(sentAt, existingInvoice.paymentTerms),
                    });
                    return;
                  }
                  updateInvoice(existingInvoice.id, { status: next });
                }}
                advanceLabel={
                  existingInvoice.status === 'draft' ? 'Mark sent'
                  : existingInvoice.status === 'sent' || existingInvoice.status === 'partially_paid' || existingInvoice.status === 'overdue' ? 'Mark paid'
                  : undefined
                }
              />
            </View>
          )}

          {isProgressType && !isLocked && !anyPreScaledLine && (
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
                {/* While his setup is still being read the selector does not
                    name a term — showing "Net 30" there would be the flash. */}
                <Text style={styles.termsSelectorText}>
                  {termsOrigin === 'loading'
                    ? 'Checking…'
                    : PAYMENT_TERMS_OPTIONS.find(o => o.value === paymentTerms)?.label}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.termsSelectorText}>
                {PAYMENT_TERMS_OPTIONS.find(o => o.value === paymentTerms)?.label}
              </Text>
            )}
          </View>

          {/* Say where the terms came from until he picks his own. A fallback is
              named as the app's default, never as his setting — he has not told
              us his terms, and the invoice should not pretend he has. */}
          {!isLocked && termsOrigin === 'loading' && (
            <Text style={styles.termsHint}>Checking the payment terms in your cash-flow setup…</Text>
          )}
          {!isLocked && termsOrigin === 'contract' && (
            <Text style={styles.termsHint} testID="invoice-terms-from-contract">
              {milestoneContractTermsCaption(milestoneTrigger) ?? 'From the signed contract.'}
            </Text>
          )}
          {!isLocked && termsOrigin === 'cash_flow_setup' && (
            <Text style={styles.termsHint}>From your cash-flow setup — the same terms your forecast uses.</Text>
          )}
          {!isLocked && termsOrigin === 'fallback' && (
            <Text style={styles.termsHint}>Net 30 is the app default, not your setting — your cash-flow setup has no payment terms to use. Set them in Cash Flow and new invoices will use them.</Text>
          )}
          {/* Nothing answered (read failed, timed out, or no record at all —
              the loader cannot tell those apart), so this must not claim he
              has no setting. */}
          {!isLocked && termsOrigin === 'unconfirmed' && (
            <Text style={styles.termsHint}>Net 30 is the app default for now — no payment terms came back from your cash-flow setup (not set yet, or it could not be reached).</Text>
          )}

          {showTermsDropdown && (
            <View style={styles.termsDropdown}>
              {PAYMENT_TERMS_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.termsOption, paymentTerms === opt.value && styles.termsOptionActive]}
                  onPress={() => { pickPaymentTerms(opt.value); setShowTermsDropdown(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.termsOptionText, paymentTerms === opt.value && styles.termsOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {paymentTerms === opt.value && <Check size={16} color={themeColors.accent} strokeWidth={1.75} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.termsRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Percent size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.fieldLabelInline}>Retention</Text>
            </View>
            {!isLocked ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {/* Provenance, not a silent prefill. A seeded number has to say
                    where it came from, the same way aia-pay-app.tsx:1363 does —
                    and when nothing recorded one, it has to say THAT rather than
                    let a 0 in the box read as a decision he made. Tapping the
                    note reopens the ask, so declining it is never a dead end. */}
                {retentionProvenance ? (
                  <TouchableOpacity
                    onPress={() => setShowRetainageAsk(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retainage ${retentionProvenance.label}. Set it from your contract.`}
                    testID="retention-provenance-note"
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.retentionCarriedNote, retentionProvenance.warn && styles.retentionUnknownNote]}>
                      {retentionProvenance.label}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TextInput
                  style={styles.retentionInput}
                  value={retentionPercent}
                  onChangeText={(v) => { setRetentionSeedUntouched(false); setRetentionPercent(v); }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={themeColors.textMuted}
                  maxLength={5}
                />
                <Text style={styles.retentionPct}>%</Text>
              </View>
            ) : (
              <Text style={styles.termsSelectorText}>{retentionPctValue}%</Text>
            )}
          </View>

          {!isLocked && (
            <View style={styles.fieldSection}>
              <InlineVoiceFill
                title="Dictate this invoice"
                contextLine={project?.name ? `for ${project.name}` : undefined}
                buttonLabel={existingInvoice ? 'Add detail by voice' : 'Fill invoice by voice'}
                suggestions={[
                  'Demolition kitchen, lump sum twenty-eight hundred',
                  'Drywall hang and finish, 850 square feet at 2.50 per square foot',
                  'Electrical rough-in, 8 hours at 95 per hour',
                  'Add a note: net 15 terms, late fee 1.5% per month',
                ]}
                onTranscript={async (transcript) => {
                  const partial = await parseInvoiceFromTranscript(transcript, project);
                  if (partial.notes) setNotes(prev => mergeText(prev, partial.notes, prev ? 'append' : 'replace-if-empty'));
                  if (partial.lineItems && partial.lineItems.length > 0) {
                    setLineItems(prev => [
                      ...prev,
                      ...partial.lineItems.map(li => ({
                        id: createId('ili'),
                        name: li.name || 'Voice line item',
                        description: li.description || '',
                        quantity: li.quantity || 1,
                        unit: li.unit || 'lump',
                        unitPrice: li.unitPrice || 0,
                        total: (li.quantity || 1) * (li.unitPrice || 0),
                      })),
                    ]);
                  }
                }}
              />
            </View>
          )}

          <View style={styles.fieldSection}>
            <Text style={styles.fieldLabel}>Line Items</Text>
            {lineItems.map((item) => (
              <View key={item.id} style={styles.lineItemCard}>
                <View style={styles.lineItemHeader}>
                  <Text style={styles.lineItemName} numberOfLines={1}>{item.name}</Text>
                  {!isLocked && (
                    <TouchableOpacity onPress={() => handleRemoveItem(item.id)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Delete">
                      <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
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
            {/* #66: on a new invoice or a draft the rate is his to set, with
                where it came from beside it; once issued it is frozen and
                printed as a fact. */}
            {!isLocked ? (
              <View style={styles.totalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.totalLabel}>Tax</Text>
                  <Text style={taxRateInvalid ? styles.taxInvalidNote : styles.taxSourceNote} testID="invoice-tax-source">
                    {taxRateInvalid
                      ? `"${(taxRateText ?? '').trim()}" isn't a percentage — using ${taxSeed.rate}% until fixed`
                      : invoiceTaxSourceLabel(taxSeed, taxRateText != null)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TextInput
                    style={styles.taxRateInput}
                    value={taxRateText ?? String(taxSeed.rate)}
                    onChangeText={setTaxRateText}
                    keyboardType="decimal-pad"
                    maxLength={6}
                    accessibilityLabel="Tax rate, percent"
                    testID="invoice-tax-rate-input"
                  />
                  <Text style={styles.retentionPct}>%</Text>
                  <Text style={styles.totalValue}>{formatCurrency(taxAmount)}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax ({taxRate}%)</Text>
                <Text style={styles.totalValue}>{formatCurrency(taxAmount)}</Text>
              </View>
            )}
            <View style={styles.dividerThick} />
            <View style={styles.totalRow}>
              {/* #66: this is the invoice's total, not the contract's — beside a
                  deposit it read as if the contract had grown. */}
              <Text style={styles.grandLabel}>Invoice total</Text>
              <TapeRollNumber
                value={totalDue}
                formatter={formatCurrency}
                duration={550}
                style={styles.grandValue}
              />
            </View>
            {retentionPctValue > 0 && (
              <>
                <View style={styles.divider} />
                {/* The row states the amount WITHHELD, not what is still
                    pending, so the note under it stays true after a partial
                    release and the column actually foots:
                    total − held + released = net payable. It used to render
                    retentionPending, which double-counted the release against
                    the "Retention Released" row below. */}
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: themeColors.accent }]}>Retention Held ({retentionPctValue}% of work completed)</Text>
                  <Text style={[styles.totalValue, { color: themeColors.accent }]}>-{formatCurrency(retentionAmount)}</Text>
                </View>
                {/* MISS-04: state the basis. Sitting directly under "Contract
                    Total", an undisclosed percentage reads as a percentage of
                    that total — which is how the tax-inclusive basis went
                    unnoticed on a live invoice. */}
                <Text style={styles.retentionBasisNote} testID="retention-basis-note">
                  {retentionPctValue}% of {formatCurrency(retentionBasis)} completed work
                  {taxAmount > 0 ? ' · sales tax is not retained' : ''}
                </Text>
                {/* MONEY-05: the money already agrees. Every screen and the
                    Stripe webhook now compute the withholding from the work
                    value, so this card is NOT "your balance is wrong" — the
                    balance above is already the corrected one. What is still
                    wrong is the saved column, which anything reading the raw
                    record (the CSV export, the closeout packet, an accountant
                    pulling the table) still sees. The copy says exactly that:
                    a bookkeeping repair, not a change to what is owed. */}
                {legacyTaxBasisRetention && (
                  <View style={styles.retentionLegacyCard} testID="retention-basis-legacy">
                    <Text style={styles.retentionBasisWarn}>
                      Saved on this record: {formatCurrency(legacyTaxBasisRetention.stored)} —
                      {' '}{existingInvoice?.retentionPercent ?? 0}% of the tax-inclusive total, which held
                      {' '}{formatCurrency(legacyTaxBasisRetention.overheld)} against sales tax you remit either way.
                      Every screen, your PDFs and your exports already use the
                      {' '}{formatCurrency(legacyTaxBasisRetention.corrected)} above, so nothing you or
                      your client is charged changes. This only updates the stored record to match.
                    </Text>
                    <TouchableOpacity
                      style={styles.retentionFixBtn}
                      onPress={handleCorrectRetentionBasis}
                      activeOpacity={0.85}
                      testID="retention-basis-fix-btn"
                    >
                      <Text style={styles.retentionFixBtnText}>
                        Update the saved figure to {formatCurrency(legacyTaxBasisRetention.corrected)}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                {retentionReleased > 0 && (
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: themeColors.success }]}>Retention Released</Text>
                    <Text style={[styles.totalValue, { color: themeColors.success }]}>{formatCurrency(retentionReleased)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.grandLabel}>Net Payable Now</Text>
                  <TapeRollNumber
                    value={netPayable}
                    formatter={formatCurrency}
                    duration={550}
                    style={styles.grandValue}
                  />
                </View>
              </>
            )}
            {existingInvoice && amountPaid > 0 && (
              <>
                <View style={styles.divider} />
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: themeColors.success }]}>Amount Paid</Text>
                  <Text style={[styles.totalValue, { color: themeColors.success }]}>-{formatCurrency(amountPaid)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.grandLabel}>Balance Due</Text>
                  <Text style={[styles.grandValue, { color: balanceDue > 0 ? themeColors.danger : themeColors.success }]}>
                    {formatCurrency(balanceDue)}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Record Payment lives in the content, not the absolute bottom bar:
              that bar is hidden for every invoice past draft (isLocked), which
              left the button unreachable and "Mark paid" — a status flip with
              no money — as the only way to close an invoice. */}
          {canRecordPayment && (
            <TouchableOpacity
              style={styles.recordPaymentBtn}
              onPress={openRecordPayment}
              activeOpacity={0.7}
              testID="mark-paid-btn"
            >
              <CreditCard size={16} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.markPaidBtnText}>Record Payment</Text>
              <Text style={styles.recordPaymentBtnMeta}>{pendingBankPayment ? 'bank payment processing' : `${formatCurrency(balanceDue)} due`}</Text>
            </TouchableOpacity>
          )}

          {existingInvoice && retentionPctValue > 0 && retentionPending > 0 && (
            <TouchableOpacity
              style={styles.releaseRetentionBtn}
              onPress={() => setShowRetentionModal(true)}
              activeOpacity={0.85}
              testID="release-retention-btn"
            >
              <Unlock size={16} color={themeColors.accent} strokeWidth={1.75} />
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
                      {(r.method ?? 'released').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      {r.note ? ` · ${r.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.paymentAmount, { color: themeColors.accent }]}>{formatCurrency(r.amount)}</Text>
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

          {/* Payment reminders. Two jobs: (1) tell the GC whether the client
              has already been chased and at what escalation, so they stop
              guessing before picking up the phone; (2) let them send in the
              moment. The cadence itself still belongs to the invoice-dunning
              cron — this button rides the same rules, it does not bypass them. */}
          {existingInvoice && reminderState && effectiveStatus !== 'draft' && effectiveStatus !== 'paid' && (
            <View style={styles.reminderCard}>
              <View style={styles.reminderHeader}>
                <View style={styles.reminderIconWrap}>
                  <BellRing size={18} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reminderTitle}>Payment reminders</Text>
                  <Text style={styles.reminderSub} testID="reminder-state-line">
                    {reminderState.sentLabel
                      ?? (reminderState.eligibility.daysOverdue > 0
                        ? `No reminder sent yet · ${reminderState.eligibility.daysOverdue} day${reminderState.eligibility.daysOverdue === 1 ? '' : 's'} overdue`
                        : 'No reminder sent yet')}
                  </Text>
                </View>
              </View>
              {qboClosedFlag ? (
                <Text style={[styles.reminderHint, { color: themeColors.warningLabel }]} testID="reminder-qbo-closed-flag">
                  {qboClosedFlag}
                </Text>
              ) : null}
              {!reminderState.eligibility.eligible && reminderState.eligibility.reason && (
                <Text style={styles.reminderHint} testID="reminder-block-reason">
                  {reminderBlockMessage(reminderState.eligibility.reason, reminderState.lastMs, reminderState.nowMs)}
                </Text>
              )}
              {/* #81: the reminder carries the portal's "View invoice" link only
                  to a portal invitee — the bill-to address is often a lender's
                  or AP desk the homeowner never invited. Said here so he is not
                  promised a button the cron will withhold. */}
              {(() => {
                const to = reminderRecipient((existingInvoice as Invoice & InvoiceBillTo).billToEmail, project.clientPortal?.invites);
                if (!to || !invoicesVisibleInPortal(project.clientPortal)) return null;
                if (reminderCarriesPortalLink((existingInvoice as Invoice & InvoiceBillTo).billToEmail, project.clientPortal)) return null;
                return (
                  <Text style={styles.reminderHint} testID="reminder-portal-link-withheld">
                    {`Reminders to ${to} carry the Pay button but not the portal link — that address isn't invited to this project's portal.`}
                  </Text>
                );
              })()}
              {/* The card only renders for invoices that already went out, so
                  the fix is the PDF send — it keeps the stored due date and
                  status and stores the address. Never the draft Send sheet,
                  which would re-date the invoice from today. */}
              {reminderState.eligibility.reason === 'no_recipient' && (
                <TouchableOpacity
                  style={styles.pickContactBtn}
                  onPress={() => setShowPDFPreSend(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  testID="reminder-add-recipient"
                >
                  <Send size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.pickContactText}>Email the invoice to your client</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.reminderBtn, (!reminderState.eligibility.eligible || sendingReminder) && styles.reminderBtnDisabled]}
                onPress={() => {
                  if (!qboClosedFlag) { void handleSendReminder(); return; }
                  showAlert(
                    'QuickBooks shows this invoice closed',
                    // The reason follows the flag's own kind (void / refund
                    // gap / credit) — one fixed sentence was wrong for two.
                    `${qboClosedFlagAlertReason(qboClosedFlag)} Send a reminder to the client anyway?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Send anyway', onPress: () => { void handleSendReminder(); } },
                    ],
                  );
                }}
                disabled={!reminderState.eligibility.eligible || sendingReminder}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Send a payment reminder to the client now"
                testID="send-reminder-btn"
              >
                {sendingReminder ? (
                  <ActivityIndicator size="small" color={"#FFFFFF"} />
                ) : (
                  <Send size={15} color={"#FFFFFF"} strokeWidth={1.75} />
                )}
                <Text style={styles.reminderBtnText}>
                  {sendingReminder
                    ? 'Sending…'
                    : reminderState.eligibility.targetStage > 0
                      ? `Send ${dunningStageLabel(reminderState.eligibility.nextStage).toLowerCase()} now`
                      : 'Send reminder now'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Stripe Payment Link: only meaningful for sent/partially-paid/overdue
              invoices with a positive balance. Drafts shouldn't be collectable
              yet; settled invoices don't need a link. Effective status, so a
              stored 'paid' reopened by a retention release still gets one. */}
          {/* #83 / #135: in place of the whole Pay-link card while the client's
              bank payment settles — the link is spent, and a new one invites a
              second payment. */}
          {existingInvoice && pendingBankPayment && effectiveStatus !== 'draft' && effectiveStatus !== 'paid' && (
            <View style={styles.payLinkCard} testID="bank-payment-processing">
              <View style={styles.payLinkHeader}>
                <View style={styles.payLinkIconWrap}>
                  <Banknote size={18} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payLinkTitle}>{pendingBankPayment.line}</Text>
                  <Text style={styles.payLinkSub}>
                    Bank transfers take 3-5 business days. It is credited to this invoice automatically when it clears. Payment links and reminders are paused until then; if it fails you'll be notified and can send a fresh link.
                  </Text>
                </View>
              </View>
            </View>
          )}

          {existingInvoice && !pendingBankPayment && effectiveStatus !== 'draft' && effectiveStatus !== 'paid' && balanceDue > 0 && (
            <View style={styles.payLinkCard}>
              <View style={styles.payLinkHeader}>
                <View style={styles.payLinkIconWrap}>
                  <MageAIMark size={18} color={themeColors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payLinkTitle}>Stripe Payment Link</Text>
                  <Text style={styles.payLinkSub}>
                    {payLinkMatchesBalance
                      ? invoicePayableInPortal(project.clientPortal, existingInvoice.portalState)
                        ? 'Clients can pay by card or ACH via the portal.'
                        : portalEnabled
                          ? 'Included as a Pay button in the emailed invoice. Share it to the client portal to show it there too.'
                          : `Included as a Pay button in the emailed invoice.${portalHidesInvoices ? " Invoices are hidden on this project's portal, so it has no Pay button there." : ''}`
                      : existingInvoice.payLinkUrl
                        ? existingInvoice.payLinkAmount == null
                          ? `This link predates amount tracking — regenerate it for the current balance of ${formatCurrency(balanceDue)}.`
                          : `This link is for ${formatCurrency(existingInvoice.payLinkAmount)} — regenerate for the current balance of ${formatCurrency(balanceDue)}.`
                        : `Let your client pay ${formatCurrency(balanceDue)} online in one tap.`}
                  </Text>
                </View>
              </View>

              {existingInvoice.payLinkUrl ? (
                <>
                  {/* MONEY-F2: the URL, Copy and Share are shown only while the
                      link's minted amount IS today's balance. A link for an old
                      balance charges the old figure every time it is opened, so
                      the only action it gets is Regenerate. */}
                  {payLinkMatchesBalance && (
                    <View style={styles.payLinkUrlBox}>
                      <Link2 size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                      <Text style={styles.payLinkUrlText} numberOfLines={1} ellipsizeMode="middle">
                        {existingInvoice.payLinkUrl}
                      </Text>
                    </View>
                  )}
                  <View style={styles.payLinkActions}>
                    {payLinkMatchesBalance && (
                      <>
                        <TouchableOpacity
                          style={styles.payLinkActionBtn}
                          onPress={handleCopyPayLink}
                          activeOpacity={0.7}
                          testID="copy-pay-link-btn"
                        >
                          <Copy size={14} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.payLinkActionText}>Copy</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.payLinkActionBtn}
                          onPress={handleSharePayLink}
                          activeOpacity={0.7}
                          testID="share-pay-link-btn"
                        >
                          <Share2 size={14} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.payLinkActionText}>Share</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity
                      style={[styles.payLinkActionBtn, styles.payLinkRegenBtn]}
                      onPress={handleGeneratePayLink}
                      activeOpacity={0.7}
                      disabled={generatingPayLink}
                      testID="regenerate-pay-link-btn"
                    >
                      {generatingPayLink ? (
                        <ActivityIndicator size="small" color={themeColors.textSecondary} />
                      ) : (
                        <Text style={styles.payLinkRegenText}>{payLinkMatchesBalance ? 'Regenerate' : `Regenerate for ${formatCurrency(balanceDue)}`}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {/* Revenue-product CTAs. Surface only when an unpaid
                      balance exists — otherwise these are noise on the
                      "fully paid" view. See RevenueEarlyAccessCard for
                      the strategy doc context. */}
                  {balanceDue > 0 && (
                    <>
                      <RevenueEarlyAccessCard
                        eventKey="revenue.factoring.altline"
                        icon={Banknote}
                        headline="Get paid today, not in 60 days"
                        body="Advance up to 95% of this unpaid invoice from a factoring partner. 2-4% per 30 days. Funds your bank in 24 hours."
                        footer="Partner LOI in progress · early access shipping Q3 2026"
                        testID="invoice-factoring-cta"
                      />
                      <RevenueEarlyAccessCard
                        eventKey="revenue.financing.wisetack"
                        icon={HandCoins}
                        headline="Offer your client monthly payments"
                        body="Give the homeowner a monthly option instead of one lump sum. We pre-fill the application from this invoice."
                        footer="Wisetack-style partnership · early access shipping Q3 2026"
                        testID="invoice-financing-cta"
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                {payLinkLimitReason ? (
                  <Text style={styles.reminderHint} testID="pay-link-limit-reason">
                    {`No payment link: ${payLinkLimitReason}.`}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.payLinkGenerateBtn, !!payLinkLimitReason && styles.reminderBtnDisabled]}
                  onPress={handleGeneratePayLink}
                  activeOpacity={0.85}
                  disabled={generatingPayLink || !!payLinkLimitReason}
                  accessibilityState={{ disabled: generatingPayLink || !!payLinkLimitReason }}
                  testID="generate-pay-link-btn"
                >
                  {generatingPayLink ? (
                    <>
                      <ActivityIndicator size="small" color={"#FFFFFF"} />
                      <Text style={styles.payLinkGenerateText}>Generating…</Text>
                    </>
                  ) : (
                    <>
                      <MageAIMark size={16} color={"#FFFFFF"} />
                      <Text style={styles.payLinkGenerateText}>Generate Payment Link</Text>
                    </>
                  )}
                </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {existingInvoice && existingInvoice.payments && existingInvoice.payments.length > 0 && (
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Payment History</Text>
              {existingInvoice.payments.map((p) => (
                <View key={p.id} style={styles.paymentRow}>
                  <View style={styles.paymentInfo}>
                    {/* The day it was RECEIVED (#133), as a calendar day — never
                        `new Date(bareDay)`, which is UTC midnight and prints
                        the previous day anywhere in the Americas. */}
                    <Text style={styles.paymentDate}>
                      {formatCalendarDay(paymentReceivedDay(p as InvoicePayment & RecordedPaymentFields)) || '—'}
                    </Text>
                    <Text style={styles.paymentMethodText}>
                      {p.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      {(p as InvoicePayment & RecordedPaymentFields).reference ? ` · ${(p as InvoicePayment & RecordedPaymentFields).reference}` : ''}
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
                placeholderTextColor={themeColors.textMuted}
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
                <FileSpreadsheet size={20} color={themeColors.accent} strokeWidth={1.75} />
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

          {/* Connector: paid invoice → lien waiver CTA. Most banks ask
              for a waiver against every payment to a sub. We pre-fill
              the waiver creation with the invoice id + paid amount +
              through-date so the GC isn't re-typing what they just
              recorded as paid. Only shows once payment is recorded. */}
          {existingInvoice && existingInvoice.status === 'paid' && existingInvoice.projectId && (
            <TouchableOpacity
              style={styles.aiaCtaCard}
              onPress={() => router.push({
                pathname: '/lien-waivers' as any,
                params: {
                  projectId: existingInvoice.projectId,
                  prefillFromInvoice: existingInvoice.id,
                  prefillAmount: String(existingInvoice.amountPaid ?? existingInvoice.totalDue ?? 0),
                  prefillThroughDate: (existingInvoice as any).paidDate ?? existingInvoice.issueDate ?? new Date().toISOString().slice(0, 10),
                },
              })}
              activeOpacity={0.85}
              testID="invoice-to-lien-waiver-cta"
            >
              <View style={styles.aiaCtaIconWrap}>
                <FileText size={20} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiaCtaTitle}>Collect a lien waiver</Text>
                <Text style={styles.aiaCtaSub}>
                  Bank or homeowner will ask for it. Generate the waiver pre-filled with this invoice&apos;s amount and through-date.
                </Text>
              </View>
              <Text style={styles.aiaCtaArrow}>›</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {existingInvoice && (
          <SendToClientButton
            kind="invoice"
            itemId={existingInvoice.id}
            projectId={existingInvoice.projectId}
            portalState={existingInvoice.portalState}
            itemUpdatedAt={existingInvoice.updatedAt}
            canSend={lineItems.length > 0 && totalDue > 0}
            canSendReason={lineItems.length === 0 || totalDue <= 0 ? 'Add line items and a total amount before sending.' : undefined}
          />
        )}

        {!isLocked && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} onLayout={onBottomBarLayout}>
            {(!existingInvoice || existingInvoice.status === 'draft') && (
              <>
                {/* #34: both locked while a send runs — the label says why. */}
                <Button
                  label="Save to Project"
                  onPress={() => handleSave('draft')}
                  variant="secondary"
                  fullWidth
                  disabled={sendInFlight}
                  testID="save-invoice-to-project"
                />
                <Button
                  label={sendInFlight ? 'Sending…' : 'Send & Save'}
                  onPress={handleSendPress}
                  disabled={sendInFlight}
                  iconLeft={<Send size={16} color="#FFFFFF" strokeWidth={1.75} />}
                  fullWidth
                  testID="send-invoice-btn"
                />
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
                <TouchableOpacity onPress={() => setShowPaymentModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalFieldLabel}>Amount</Text>
              <TextInput
                style={styles.modalInput}
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={themeColors.textMuted}
              />

              <Text style={styles.modalFieldLabel}>Date received</Text>
              <TouchableOpacity
                style={styles.modalInput}
                onPress={() => setShowReceivedDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel={`Date received, ${formatCalendarDay(paymentReceivedDate)}. Change it`}
                testID="record-payment-received-date"
                activeOpacity={0.7}
              >
                <Text style={styles.termsSelectorText}>
                  {formatCalendarDay(paymentReceivedDate)}{paymentReceivedDate === todayCalendarDay() ? ' (today)' : ''}
                </Text>
              </TouchableOpacity>

              <Text style={styles.modalFieldLabel}>Check # / reference (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={paymentReference}
                onChangeText={setPaymentReference}
                placeholder="e.g. 1042"
                placeholderTextColor={themeColors.textMuted}
                maxLength={60}
                autoCapitalize="none"
                testID="record-payment-reference"
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

              <TouchableOpacity
                style={[styles.modalSaveBtn, recordingPayment && { opacity: 0.55 }]}
                onPress={handleMarkPaid}
                activeOpacity={0.85}
                disabled={recordingPayment}
                accessibilityRole="button"
                accessibilityState={{ disabled: recordingPayment }}
                testID="record-payment-submit"
              >
                <Check size={18} color={"#FFFFFF"} strokeWidth={1.75} />
                <Text style={styles.modalSaveBtnText}>{recordingPayment ? 'Recording…' : 'Record Payment'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
        {/* Inside the payment sheet's Modal so it presents over it. It emits a
            noon-UTC instant; calendarDayOf takes the local day it names. */}
        <DatePickerModal
          visible={showReceivedDatePicker}
          value={paymentReceivedDate}
          title="Date received"
          onClose={() => setShowReceivedDatePicker(false)}
          onChange={(iso) => {
            setPaymentReceivedDate(calendarDayOf(iso) ?? todayCalendarDay());
            setShowReceivedDatePicker(false);
          }}
        />
      </Modal>

      {/* THE ASK. Opened only when utils/retainageSource found no rate on this
          invoice, on a prior non-draft invoice, on the job, or on a saved G702 —
          so it appears once, on the first bill of a job, and then never again.
          It offers the two rates that are actually common and an explicit "none
          held", but it invents nothing: "Not sure" stores NOTHING, because a
          retainage the app guessed is a number he bills, sends, and then argues
          about with the owner. */}
      <Modal visible={showRetainageAsk} transparent animationType="slide" onRequestClose={handleRetainageUnknown}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]} testID="retainage-ask-modal">
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Retainage on this job</Text>
                <TouchableOpacity onPress={handleRetainageUnknown} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <Text style={styles.retentionModalMeta}>
                How much does {project.name}&apos;s contract hold back on each payment?
                This is the first bill on the job, so nothing has recorded it yet — and an
                invoice billed at 0% by omission is money you never ask for back. The owner
                deducts it either way.
              </Text>

              <View style={styles.retainageAskChips}>
                {RETAINAGE_ASK_CHOICES.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.retainageAskChip}
                    onPress={() => handleRetainageAnswer(opt.value)}
                    accessibilityRole="button"
                    accessibilityLabel={opt.a11y}
                    testID={`retainage-ask-${opt.value}`}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.retainageAskChipText}>{opt.label}</Text>
                    <Text style={styles.retainageAskChipMeta}>{opt.meta}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalFieldLabel}>Or enter the rate from your contract</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={[styles.modalInput, { flex: 1 }]}
                  value={retainageAskInput}
                  onChangeText={setRetainageAskInput}
                  keyboardType="decimal-pad"
                  // NOT "7.5": scripts/validate-project-context-pure.ts forbids that
                  // literal anywhere in this file, because a hardcoded 7.5 tax rate was a
                  // real money bug here. The guard is deliberately blunt and 15% is an
                  // equally real retainage, so this costs nothing to respect.
                  placeholder="e.g. 15"
                  placeholderTextColor={themeColors.textMuted}
                  maxLength={5}
                  testID="retainage-ask-input"
                />
                <Text style={styles.retentionPct}>%</Text>
              </View>
              {retainageAskInput.trim().length > 0 && !retainageAskValid && (
                <Text style={styles.retainageAskWhyOff}>
                  Save is off because &quot;{retainageAskInput.trim()}&quot; isn&apos;t a percentage between 0 and 100.
                </Text>
              )}

              <TouchableOpacity
                style={[styles.modalSaveBtn, !retainageAskValid && styles.modalSaveBtnOff]}
                onPress={() => handleRetainageAnswer(retainageAskValue)}
                disabled={!retainageAskValid}
                accessibilityRole="button"
                accessibilityState={{ disabled: !retainageAskValid }}
                testID="retainage-ask-save"
                activeOpacity={0.85}
              >
                <Percent size={18} color={"#FFFFFF"} strokeWidth={1.75} />
                <Text style={styles.modalSaveBtnText}>Use this rate on this job</Text>
              </TouchableOpacity>

              {/* Storing nothing is a real answer, and the only honest one when
                  he has not got the contract in front of him. The Retention row
                  then reads "not on file — retainage not held" and stays tappable. */}
              <TouchableOpacity
                style={styles.retainageAskSkip}
                onPress={handleRetainageUnknown}
                accessibilityRole="button"
                testID="retainage-ask-skip"
                activeOpacity={0.7}
              >
                <Text style={styles.retainageAskSkipText}>
                  Not sure — check my contract (nothing will be recorded)
                </Text>
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
                <TouchableOpacity onPress={() => setShowRetentionModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <Text style={styles.retentionModalMeta}>
                Pending: <Text style={{ color: themeColors.accent, fontWeight: '700' }}>{formatCurrency(retentionPending)}</Text>
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
                  placeholderTextColor={themeColors.textMuted}
                />
                <TouchableOpacity
                  style={styles.fullReleaseBtn}
                  onPress={() => setRetentionReleaseAmount(retentionPending.toFixed(2))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.fullReleaseBtnText}>Full</Text>
                </TouchableOpacity>
              </View>

              {/* MONEY-F7: no payment-method chips — releasing retention makes
                  it collectible; the payment is recorded separately when it lands. */}
              <Text style={styles.retentionModalMeta}>
                Releasing adds the amount to the balance due. Record the payment when the client sends it.
              </Text>

              <Text style={styles.modalFieldLabel}>Note (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={retentionReleaseNote}
                onChangeText={setRetentionReleaseNote}
                placeholder="e.g. Substantial completion, punch list cleared"
                placeholderTextColor={themeColors.textMuted}
              />

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleReleaseRetention} activeOpacity={0.85}>
                <Unlock size={18} color={"#FFFFFF"} strokeWidth={1.75} />
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
                <TouchableOpacity onPress={() => setShowSendRecipient(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color={themeColors.textMuted} strokeWidth={1.75} />
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
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.recipientModalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {contacts.length > 0 && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* #45: emailing and posting to the portal were two separate
                  sends nothing reconciled — the portal showed no invoice and
                  no Pay button for one the client had in their inbox. */}
              <TouchableOpacity
                style={[styles.portalPostRow, !portalEnabled && { opacity: 0.55 }]}
                onPress={() => setPostToPortal(v => !v)}
                disabled={!portalEnabled}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: portalEnabled && postToPortal, disabled: !portalEnabled }}
                accessibilityLabel="Also post to client portal"
                testID="send-post-to-portal"
              >
                {portalEnabled && postToPortal
                  ? <SquareCheck size={18} color={themeColors.accent} strokeWidth={1.75} />
                  : <Square size={18} color={themeColors.textMuted} strokeWidth={1.75} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.portalPostLabel}>Also post to client portal</Text>
                  <Text style={styles.portalPostHint}>
                    {portalEnabled
                      ? 'The client sees it, with its Pay button, in their project portal.'
                      : portalHidesInvoices
                        ? PORTAL_INVOICES_HIDDEN_HINT
                        : 'This project has no client portal yet — set one up in Client Portal to post invoices there.'}
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                {/* #34: the sliding sheet is still tappable while it closes. */}
                <TouchableOpacity
                  style={[styles.sendBtn, sendInFlight && { opacity: 0.55 }]}
                  onPress={handleConfirmSend}
                  disabled={sendInFlight}
                  accessibilityState={{ disabled: sendInFlight }}
                  activeOpacity={0.7}
                  testID="send-sheet-confirm"
                >
                  <Send size={16} color={"#FFFFFF"} strokeWidth={1.75} />
                  <Text style={styles.sendBtnText}>{sendInFlight ? 'Sending…' : 'Send'}</Text>
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
          defaultRecipient={pdfDefaultRecipient}
          documentType="invoice"
          // #93 follow-up (wave 5): the invoice PDF prints one layout and reads
          // no section toggle, so offering Line Items / Payment Terms / Tax /
          // Branding switches was a control that did nothing. None shown.
          sections={[]}
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

// Same fg === bg class fixed in punch-list.tsx `getStatusConfig` — 'sent' and
// 'overdue' painted the label in the SAME token as the fill, so "Awaiting
// Payment" measured 1.00:1 (a solid blue blob) and "Overdue" a solid red one.
//
// The punch-list fix pairs a SOFT fill with a label/saturated foreground, and
// that is the pattern here too — with one substrate difference that matters:
// this badge is a child of `heroCard`, whose background is `themeColors.accent`
// (#FF6A1A in BOTH themes), not a surface card. Every *Soft token is a
// translucent rgba, so on orange they composite back toward orange and the
// "fixed" badge is still unreadable:
//
//   dangerLabel on dangerSoft over the hero  →  1.85:1 light / 1.06:1 dark
//   info        on info+'1F'  over the hero  →  1.73:1 light / 1.20:1 dark
//
// That is also why the two cases the audit did NOT flag were broken anyway:
// 'partially_paid' is accent-on-accentSoft over an accent hero = 1.00:1 exactly,
// and 'draft' is 2.33:1 once the translucent line/textSecondary are composited.
//
// So the fill is `t.surface` — the one OPAQUE token that inverts with the theme
// (white chip in light, near-black chip in dark) and therefore reads against the
// fixed orange either way. Foregrounds are the punch-list label tokens, and the
// border mirrors `ui/Badge.tsx` (`fg + '33'`) so the statuses stay
// distinguishable. Measured on the hero: 4.85–13.27:1 light, 4.75–16.99:1 dark.
function getInvoiceStatusColors(t: ThemeColors, status: string): { bg: string; text: string } {
  switch (status) {
    case 'draft': return { bg: t.surface, text: t.text };
    case 'sent': return { bg: t.surface, text: t.info };
    case 'partially_paid': return { bg: t.surface, text: t.accentLabel };
    case 'paid': return { bg: t.surface, text: t.success };
    case 'overdue': return { bg: t.surface, text: t.dangerLabel };
    default: return { bg: t.surface, text: t.text };
  }
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  pipelineWrap: { paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  container: { flex: 1, backgroundColor: themeColors.bg },
  // #38: the owner-only block (InvoiceRoleBlocked).
  roleBlockedBody: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' as const, maxWidth: 520, width: '100%', alignSelf: 'center' as const },
  roleBlockedTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  roleBlockedText: { fontSize: Type.subhead.fontSize, color: themeColors.textSecondary, lineHeight: 21 },
  // #66: the editable tax rate on a new / draft invoice.
  taxRateInput: { width: 64, minHeight: 36, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 8, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text, textAlign: 'right' as const },
  taxSourceNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  taxInvalidNote: { fontSize: Type.caption1.fontSize, color: themeColors.danger, marginTop: 2 },
  // Invoice reads as a document — cap it, but 840 was too tight on desktop.
  contentDesktop: { width: '100%', maxWidth: 1040, alignSelf: 'center' as const },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: themeColors.accentFill, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.accentFill, marginHorizontal: 20, marginTop: 16, borderRadius: Tokens.radius.panel, padding: 20, gap: 4 },
  heroLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: Tokens.radius.sm, marginTop: 6, borderWidth: 1 },
  statusText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  progressSection: { marginHorizontal: 20, marginTop: 16, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 16, borderWidth: 1, borderColor: themeColors.line },
  progressLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginBottom: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  progressInput: { width: 70, minHeight: 44, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.accent, textAlign: 'center' as const },
  progressSign: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  progressBarTrack: { height: 6, borderRadius: 3, backgroundColor: themeColors.line, overflow: 'hidden' as const },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: themeColors.accent },
  termsRow: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 14, borderWidth: 1, borderColor: themeColors.line },
  fieldLabelInline: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  termsSelector: { backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm },
  termsSelectorText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.accentLabel },
  termsHint: { ...Type.caption1, color: themeColors.textMuted, marginHorizontal: 20, marginTop: 6 },
  termsDropdown: { marginHorizontal: 20, marginTop: 4, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: themeColors.line, overflow: 'hidden' as const },
  termsOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  termsOptionActive: { backgroundColor: themeColors.accent + '08' },
  termsOptionText: { fontSize: Type.subhead.fontSize, color: themeColors.text },
  termsOptionTextActive: { color: themeColors.accentLabel, fontWeight: '600' as const },
  fieldSection: { marginHorizontal: 20, marginTop: 18 },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  lineItemCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: themeColors.line },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  lineItemName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, flex: 1, marginRight: 8 },
  lineItemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineItemMetaText: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  lineItemTotal: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  totalsCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1, borderColor: themeColors.line },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  totalLabel: { fontSize: Type.subhead.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const },
  totalValue: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  divider: { height: 1, backgroundColor: themeColors.line, marginVertical: 4 },
  dividerThick: { height: 2, backgroundColor: themeColors.accent + '30', borderRadius: 1, marginVertical: 6 },
  grandLabel: { fontSize: Type.body.fontSize, fontWeight: '800' as const, color: themeColors.text },
  grandValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  textArea: { minHeight: 80, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surface, paddingHorizontal: 14, paddingTop: 12, fontSize: Type.subhead.fontSize, color: themeColors.text, borderWidth: 1, borderColor: themeColors.line },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: themeColors.line },
  paymentInfo: { gap: 2 },
  paymentDate: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  paymentMethodText: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  paymentAmount: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.success },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: themeColors.surface, borderTopWidth: 0.5, borderTopColor: themeColors.line, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '15', borderWidth: 1.5, borderColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  aiaCtaCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 20, marginTop: 8, marginBottom: 20, padding: 14,
    backgroundColor: themeColors.accent + '10',
    borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: themeColors.accent + '25',
  },
  aiaCtaIconWrap: {
    width: 40, height: 40, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '20',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  aiaCtaTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 2 },
  aiaCtaSub: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16 },
  aiaCtaArrow: { fontSize: 24, color: themeColors.accent, marginLeft: 4 },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.card, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: themeColors.accent + '25' },
  selectedRecipientName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  selectedRecipientEmail: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '10' },
  pickContactText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  portalPostRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10, paddingVertical: 8 },
  portalPostLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  portalPostHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  recipientModalInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text, borderWidth: 1, borderColor: themeColors.line },
  // In-content Record Payment row (mirrors releaseRetentionBtn's placement).
  recordPaymentBtn: { marginHorizontal: 16, marginBottom: 12, minHeight: 48, borderRadius: Tokens.radius.card, backgroundColor: themeColors.successSoft, alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: themeColors.success + '30' },
  recordPaymentBtnMeta: { marginLeft: 'auto', fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.success },
  markPaidBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.success },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  modalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  methodChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line },
  methodChipActive: { backgroundColor: themeColors.accentFill },
  methodChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  methodChipTextActive: { color: "#FFFFFF" },
  modalSaveBtn: { backgroundColor: themeColors.success, borderRadius: Tokens.radius.lg, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  modalSaveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  modalSaveBtnOff: { backgroundColor: themeColors.line },
  retentionInput: { minWidth: 60, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, textAlign: 'right' as const },
  retentionPct: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  retentionCarriedNote: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted },
  // "not on file" is a gap, not a neutral note — it reads in the accent so the
  // row cannot be skimmed as though a rate had been chosen.
  retentionUnknownNote: { color: themeColors.accent, fontWeight: '600' as const },
  retainageAskChips: { flexDirection: 'row' as const, gap: 8, marginTop: 4, marginBottom: 12 },
  retainageAskChip: {
    // cardSurface, not a fourth hand-rolled copy of the same four properties
    // (validate-ui-adoption ratchets those down). surfaceAlt overrides the
    // surface fill so the chips read as tappable against the modal card.
    ...cardSurface(themeColors, { radius: 'card', pad: 'none' }),
    flex: 1, alignItems: 'center' as const, paddingVertical: 12,
    backgroundColor: themeColors.surfaceAlt,
  },
  retainageAskChipText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  retainageAskChipMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2 },
  retainageAskWhyOff: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: 6 },
  retainageAskSkip: { paddingVertical: 12, alignItems: 'center' as const },
  retainageAskSkipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  releaseRetentionBtn: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '15', borderWidth: 1, borderColor: themeColors.accent + '40' },
  releaseRetentionBtnText: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  releaseRetentionBtnMeta: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  retentionModalMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginBottom: 12 },
  retentionBasisNote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: -4, marginBottom: 6 },
  retentionLegacyCard: {
    marginBottom: 8, padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line, gap: 10,
  },
  retentionBasisWarn: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  retentionFixBtn: {
    alignSelf: 'flex-start' as const, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '20',
    borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  retentionFixBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  fullReleaseBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '20', borderWidth: 1, borderColor: themeColors.accent + '40' },
  fullReleaseBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  payLinkCard: {
    marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.accent + '08',
    borderWidth: 1, borderColor: themeColors.accent + '25',
    gap: 12,
  },
  payLinkHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  payLinkIconWrap: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  payLinkTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 2 },
  payLinkSub: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16 },
  payLinkUrlBox: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
  },
  payLinkUrlText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const },
  payLinkActions: { flexDirection: 'row' as const, gap: 8 },
  payLinkActionBtn: {
    flex: 1, minHeight: 40, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    flexDirection: 'row' as const, gap: 6,
  },
  payLinkActionText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  payLinkRegenBtn: { backgroundColor: themeColors.line },
  payLinkRegenText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  payLinkGenerateBtn: {
    minHeight: 48, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accentFill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    flexDirection: 'row' as const, gap: 8,
  },
  payLinkGenerateText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },

  // ── Payment reminders (dunning) ──
  reminderCard: {
    marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.surface,
    borderWidth: 1, borderColor: themeColors.line,
    gap: 12,
  },
  reminderHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  reminderIconWrap: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  reminderTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 2 },
  reminderSub: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 16, fontWeight: '600' as const },
  reminderHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17 },
  reminderBtn: {
    minHeight: 48, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accentFill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    flexDirection: 'row' as const, gap: 8,
  },
  reminderBtnDisabled: { opacity: 0.45 },
  reminderBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
});
