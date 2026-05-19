import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Share,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Trash2, X, Send, CreditCard, Check, BookUser, User, Percent, Unlock, FileSpreadsheet,
  Link2, Copy, Share2, Zap, FileText, Receipt,
} from 'lucide-react-native';
import EmptyState from '@/components/EmptyState';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import AIInvoicePredictor from '@/components/AIInvoicePredictor';
import ContactPickerModal from '@/components/ContactPickerModal';
import { generateInvoicePDF, generateInvoicePDFUri } from '@/utils/pdfGenerator';
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
import { fetchStripeConnectStatus } from '@/utils/stripeConnect';
import { useAuth } from '@/contexts/AuthContext';
import { nailIt } from '@/components/animations/NailItToast';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import type { InvoiceLineItem, Invoice, InvoiceStatus, PaymentTerms, PaymentMethod, InvoicePayment, RetentionRelease } from '@/types';

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
import AsyncStorage from '@react-native-async-storage/async-storage';

function createId(_prefix: string): string {
  return generateUUID();
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
  const router = useRouter();
  const { canAccess } = useTierAccess();
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

function InvoiceInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // prefillLines / prefillNotes come from the floating-mic flow when
  // the GC said something like "invoice them for demolition twenty-eight
  // hundred". JSON-encoded so we don't have to re-parse the AI's
  // structured output on this side.
  const { projectId, invoiceId, type: invoiceType, prefillLines, prefillNotes } = useLocalSearchParams<{
    projectId: string; invoiceId?: string; type?: string;
    prefillLines?: string; prefillNotes?: string;
  }>();
  const {
    getProject, getInvoicesForProject, addInvoice, updateInvoice, settings, updateSettings,
    getChangeOrdersForProject, contacts, invoices: allInvoices,
  } = useProjects();
  const { tier } = useSubscription();
  const { user } = useAuth();
  const { ensureReferral } = useFinancingReferrals(user?.id);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
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
    // number that's already on a client-facing invoice.
    return existingInvoices.reduce((max, i) => Math.max(max, i.number ?? 0), 0) + 1;
  }, [existingInvoices, existingInvoice]);

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
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(existingInvoice?.paymentTerms ?? 'net_30');
  const [notes, setNotes] = useState(existingInvoice?.notes ?? prefillNotes ?? '');
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
      retentionPercent: retentionPctValue || undefined,
      retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
      retentionReleased: 0,
      retentionReleases: [],
      createdAt: now,
      updatedAt: now,
    };
  }, [projectId, nextInvoiceNumber, isProgressType, pctValue, paymentTerms, notes, lineItems, subtotal, taxRate, taxAmount, totalDue, retentionPctValue, retentionAmount]);

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
      const inv = buildNewInvoice(status);
      addInvoice(inv);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Hammer-strike toast — non-blocking, lets the back nav fire immediately.
      nailIt(status === 'sent' ? `Invoice #${nextInvoiceNumber} sent${recipientInfo}` : `Invoice #${nextInvoiceNumber} saved`);
    }
    router.back();
  }, [projectId, lineItems, paymentTerms, notes, subtotal, taxRate, taxAmount, totalDue, isProgressType, pctValue, retentionPctValue, retentionAmount, existingInvoice, nextInvoiceNumber, addInvoice, updateInvoice, router, buildNewInvoice]);

  const handleSendPress = useCallback(() => {
    setShowSendRecipient(true);
  }, []);

  const handleConfirmSend = useCallback(async () => {
    if (!sendRecipientEmail.trim()) {
      Alert.alert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    if (!projectId) return;
    if (lineItems.length === 0) {
      Alert.alert('No Items', 'Please add at least one line item.');
      return;
    }
    setShowSendRecipient(false);

    const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
    const now = new Date().toISOString();
    const dueDate = getDueDate(now, paymentTerms);
    const recipientInfo = sendRecipientName
      ? ` to ${sendRecipientName} (${sendRecipientEmail.trim()})`
      : ` to ${sendRecipientEmail.trim()}`;

    // Create-then-edit. Pre-audit the pay-link block below was gated on
    // `existingInvoice`, so a brand-new "Quick Invoice" went out with NO
    // Pay button and no Stripe nudge — the exact "I made an invoice but
    // can't get paid" trap. Persist the invoice first so it has a stable
    // id (mirrors bill-from-estimate), then generate the link against it.
    let workingInvoice: Invoice;
    const createdNew = !existingInvoice;
    if (existingInvoice) {
      workingInvoice = existingInvoice;
    } else {
      workingInvoice = buildNewInvoice('sent');
      addInvoice(workingInvoice);
    }

    // Auto-generate a Stripe payment link if the invoice doesn't have one
    // yet. Without this, the email goes out with no Pay button — clients
    // get an invoice they can read but not pay, and we lose the whole
    // value prop of the integration. Graceful degradation: if Stripe is
    // unreachable we still send, just without the button.
    let payLinkUrl: string | undefined = workingInvoice.payLinkUrl;
    let stripeNotConnected = false;
    if (!payLinkUrl && totalDue > 0) {
      try {
        // Look up the GC's Stripe Connect account so the payment lands in
        // their bank, not the platform's. If they're not connected we skip
        // the link entirely — a platform-owned link would misroute money.
        let stripeAccountId: string | undefined;
        if (user?.id) {
          const status = await fetchStripeConnectStatus(user.id);
          if (status.success && status.chargesEnabled && status.accountId) {
            stripeAccountId = status.accountId;
          }
        }
        if (stripeAccountId) {
          const res = await createPaymentLink({
            invoiceId: workingInvoice.id,
            invoiceNumber: workingInvoice.number,
            projectName: project?.name ?? 'Project',
            amountCents: Math.round(totalDue * 100),
            customerEmail: sendRecipientEmail.trim(),
            companyName: branding.companyName,
            stripeAccountId,
            userTier: tier,
          });
          if (res.success && res.url && res.id) {
            payLinkUrl = res.url;
            updateInvoice(workingInvoice.id, { payLinkUrl: res.url, payLinkId: res.id });
          } else {
            console.warn('[Invoice] Auto-generate payment link failed:', res.error);
          }
        } else {
          console.log('[Invoice] Skipping payment link — Stripe Connect not set up for this user');
          stripeNotConnected = true;
        }
      } catch (err) {
        console.warn('[Invoice] Auto-generate payment link threw:', err);
      }
    }

    let financingHtml = '';
    try {
      if (isFinancingAvailable(settings) && projectId) {
        const refToken = await ensureReferral({
          projectId,
          source: 'invoice',
          amountCents: Math.round(totalDue * 100),
          partnerName: settings.financing!.partnerName,
        });
        if (refToken) {
          financingHtml = financingEmailBlockHtml({ settings, amountCents: Math.round(totalDue * 100), refToken });
        }
      }
    } catch (e) {
      console.log('[invoice] financing block skipped:', e);
    }

    const html = buildInvoiceEmailHtml({
      companyName: branding.companyName,
      recipientName: sendRecipientName,
      projectName: project?.name ?? 'Project',
      invoiceNumber: workingInvoice.number,
      totalDue,
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
      subject: `Invoice #${workingInvoice.number}: ${(() => { const v = totalDue; if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`; if (v >= 1_000) return `$${Math.round(v / 1_000)}K`; return `$${v.toLocaleString('en-US')}`; })()} due · ${project?.name ?? 'Project'}`,
      html,
      replyTo: branding.email || undefined,
      fromCompanyName: branding.companyName || undefined,
      unsubscribe: { recipientEmail: sendRecipientEmail.trim(), eventKey: 'invoice', enabled: true },
    });

    if (!result.success) {
      // If we created this invoice just for the send, drop it back to draft
      // so the user can retry rather than stranding a phantom "sent" record.
      if (createdNew) updateInvoice(workingInvoice.id, { status: 'draft' });
      if (result.error === 'cancelled') return;
      console.warn('[Invoice] Email send failed:', result.error);
      Alert.alert('Email Notice', `Invoice ${createdNew ? 'saved as draft' : 'saved'} but email could not be sent: ${result.error}`);
      return;
    }
    console.log('[Invoice] Email sent successfully');

    // Persist the sent state. New invoices were created as 'sent' with full
    // data already; existing invoices need their edits + status flushed.
    if (!createdNew && existingInvoice) {
      updateInvoice(existingInvoice.id, {
        lineItems,
        paymentTerms,
        notes: notes.trim(),
        subtotal,
        taxRate,
        taxAmount,
        totalDue,
        dueDate,
        status: 'sent',
        progressPercent: isProgressType ? pctValue : undefined,
        retentionPercent: retentionPctValue || undefined,
        retentionAmount: retentionPctValue > 0 ? retentionAmount : undefined,
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // FF1-C: Stripe-not-connected nudge — show ONCE EVER, not on every
    // send. After the first time, the user knows; nagging on each invoice
    // is friction. A failed flag read counts as "not seen" (show it);
    // the flag write is fire-and-forget and never blocks the send.
    const stripeNudgeSeen = await AsyncStorage.getItem('buildwise_stripe_nudge_seen').catch(() => null);
    if (stripeNotConnected && totalDue > 0 && stripeNudgeSeen !== '1') {
      void AsyncStorage.setItem('buildwise_stripe_nudge_seen', '1');
      Alert.alert(
        'Invoice sent — no Pay button included',
        "You haven't connected Stripe yet, so this invoice was emailed without a one-tap Pay button. Set up Stripe in Payments to add Pay buttons to future invoices.",
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Set up Stripe', onPress: () => router.push('/payments-setup' as never) },
        ],
      );
    } else {
      nailIt(`Invoice #${workingInvoice.number} sent${recipientInfo}`);
    }
    router.back();
  }, [sendRecipientEmail, sendRecipientName, projectId, lineItems, settings, project, existingInvoice, buildNewInvoice, addInvoice, totalDue, user, tier, paymentTerms, notes, subtotal, taxRate, taxAmount, isProgressType, pctValue, retentionPctValue, retentionAmount, updateInvoice, router, ensureReferral]);

  const handleSendPDF = useCallback(async (options: PDFSendOptions) => {
    if (!project || !existingInvoice) return;
    setShowPDFPreSend(false);

    if (options.method === 'email' && options.recipient.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const dueDate = existingInvoice.dueDate || getDueDate(new Date().toISOString(), existingInvoice.paymentTerms);

      // Same auto-generate logic as handleConfirmSend — the PDF send path
      // is the other entry point for "send to client", so it needs the
      // same guarantee that a payment link will be embedded.
      let payLinkUrl: string | undefined = existingInvoice.payLinkUrl;
      if (!payLinkUrl && (existingInvoice.totalDue - existingInvoice.amountPaid) > 0) {
        try {
          let stripeAccountId: string | undefined;
          if (user?.id) {
            const status = await fetchStripeConnectStatus(user.id);
            if (status.success && status.chargesEnabled && status.accountId) {
              stripeAccountId = status.accountId;
            }
          }
          if (stripeAccountId) {
            const res = await createPaymentLink({
              invoiceId: existingInvoice.id,
              invoiceNumber: existingInvoice.number,
              projectName: project.name,
              amountCents: Math.round((existingInvoice.totalDue - existingInvoice.amountPaid) * 100),
              customerEmail: options.recipient.trim(),
              companyName: branding.companyName,
              stripeAccountId,
              userTier: tier,
            });
            if (res.success && res.url && res.id) {
              payLinkUrl = res.url;
              updateInvoice(existingInvoice.id, { payLinkUrl: res.url, payLinkId: res.id });
            }
          } else {
            console.log('[Invoice] PDF send: skipping payment link — Stripe Connect not set up');
          }
        } catch (err) {
          console.warn('[Invoice] Auto pay-link gen failed in handleSendPDF:', err);
        }
      }

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
        payLinkUrl,
      });

      const pdfUri = await generateInvoicePDFUri(existingInvoice, project, branding);

      const result = await sendEmail({
        to: options.recipient.trim(),
        subject: `Invoice #${existingInvoice.number}: ${(() => { const v = existingInvoice.totalDue ?? 0; if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`; if (v >= 1_000) return `$${Math.round(v / 1_000)}K`; return `$${v.toLocaleString('en-US')}`; })()} due · ${project.name}`,
        html: emailHtml,
        replyTo: branding.email || undefined,
        attachments: pdfUri ? [pdfUri] : undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: options.recipient.trim(), eventKey: 'invoice', enabled: true },
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
  }, [project, existingInvoice, settings, updateInvoice]);

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
      // Pre-flight: confirm the GC has connected their Stripe account.
      // Without this, the link gets created on the platform account and
      // money flows to the WRONG bank — exactly the bug we just fixed.
      let stripeAccountId: string | undefined;
      if (user?.id) {
        const status = await fetchStripeConnectStatus(user.id);
        if (!status.success) {
          Alert.alert('Connection Check Failed', status.error ?? 'Could not verify your payment setup.');
          return;
        }
        if (!status.chargesEnabled) {
          Alert.alert(
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

  const handleCopyPayLink = useCallback(async () => {
    if (!existingInvoice?.payLinkUrl) return;
    const ok = await copyToClipboard(existingInvoice.payLinkUrl);
    if (Platform.OS !== 'web' && ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      ok ? 'Copied' : 'Copy Failed',
      ok ? 'Payment link copied to clipboard.' : 'Could not copy to clipboard.',
    );
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
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Invoices' }} />
        <EmptyState
          icon={<Receipt size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No invoice open yet"
          message="Invoices live inside a project so they roll up to the right billing total. To create one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Invoices in the project tile grid.',
            'Hit + New Invoice and bill against an estimate or line items.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  // Use the effective status so an unpaid-but-past-due invoice flips to "overdue"
  // in the UI without anyone having to run a cron to mutate the record, and a
  // fully-paid invoice reads as "paid" even if the stored status lagged behind.
  const effectiveStatus = existingInvoice ? getEffectiveInvoiceStatus(existingInvoice) : null;
  const daysPastDue = existingInvoice ? getDaysPastDue(existingInvoice) : 0;

  const isLocked = effectiveStatus === 'paid';

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
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
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

          {existingInvoice && (
            <View style={styles.pipelineWrap}>
              <StatusPipeline
                stages={INVOICE_PIPELINE_STAGES}
                current={mapInvoiceStatus(existingInvoice.status)}
                startedAt={existingInvoice.issueDate}
                dueAt={existingInvoice.dueDate}
                onAdvance={(next) => {
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
                  {paymentTerms === opt.value && <Check size={16} color={themeColors.accent} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.termsRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Percent size={14} color={themeColors.textSecondary} />
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
                      <Trash2 size={14} color={themeColors.danger} />
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
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: themeColors.accent }]}>Retention Held ({retentionPctValue}%)</Text>
                  <Text style={[styles.totalValue, { color: themeColors.accent }]}>-{formatCurrency(retentionPending)}</Text>
                </View>
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

          {existingInvoice && retentionPctValue > 0 && retentionPending > 0 && (
            <TouchableOpacity
              style={styles.releaseRetentionBtn}
              onPress={() => setShowRetentionModal(true)}
              activeOpacity={0.85}
              testID="release-retention-btn"
            >
              <Unlock size={16} color={themeColors.accent} />
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

          {/* Stripe Payment Link: only meaningful for sent/partially-paid/overdue
              invoices with a positive balance. Drafts shouldn't be collectable
              yet; paid invoices don't need a link. */}
          {existingInvoice && existingInvoice.status !== 'draft' && existingInvoice.status !== 'paid' && balanceDue > 0 && (
            <View style={styles.payLinkCard}>
              <View style={styles.payLinkHeader}>
                <View style={styles.payLinkIconWrap}>
                  <Zap size={18} color={themeColors.accent} />
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
                    <Link2 size={14} color={themeColors.textSecondary} />
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
                      <Copy size={14} color={themeColors.accent} />
                      <Text style={styles.payLinkActionText}>Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.payLinkActionBtn}
                      onPress={handleSharePayLink}
                      activeOpacity={0.7}
                      testID="share-pay-link-btn"
                    >
                      <Share2 size={14} color={themeColors.accent} />
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
                        <ActivityIndicator size="small" color={themeColors.textSecondary} />
                      ) : (
                        <Text style={styles.payLinkRegenText}>Regenerate</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {/* Revenue-product CTAs. Surface only when an unpaid
                      balance exists — otherwise these are noise on the
                      "fully paid" view. See RevenueEarlyAccessCard for
                      the strategy doc context. */}
                  {(existingInvoice.totalDue - (existingInvoice.amountPaid ?? 0)) > 0 && (
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
                        body="Industry data: contractors who offer financing close 20% more deals at 5-7x larger ticket. We pre-fill the app from this invoice."
                        footer="Wisetack-style partnership · early access shipping Q3 2026"
                        testID="invoice-financing-cta"
                      />
                    </>
                  )}
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
                      <ActivityIndicator size="small" color={"#FFFFFF"} />
                      <Text style={styles.payLinkGenerateText}>Generating…</Text>
                    </>
                  ) : (
                    <>
                      <Zap size={16} color={"#FFFFFF"} />
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
                <FileSpreadsheet size={20} color={themeColors.accent} />
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
                <FileText size={20} color={themeColors.accent} />
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

        {!isLocked && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            {existingInvoice && existingInvoice.status !== 'draft' && existingInvoice.status !== 'paid' && (
              <TouchableOpacity
                style={styles.markPaidBtn}
                onPress={() => { setPaymentAmount(balanceDue.toFixed(2)); setShowPaymentModal(true); }}
                activeOpacity={0.7}
                testID="mark-paid-btn"
              >
                <CreditCard size={16} color={themeColors.success} />
                <Text style={styles.markPaidBtnText}>Record Payment</Text>
              </TouchableOpacity>
            )}
            {(!existingInvoice || existingInvoice.status === 'draft') && (
              <>
                <Button
                  label="Save to Project"
                  onPress={() => handleSave('draft')}
                  variant="secondary"
                  fullWidth
                  testID="save-invoice-to-project"
                />
                <Button
                  label="Send & Save"
                  onPress={handleSendPress}
                  iconLeft={<Send size={16} color="#FFFFFF" />}
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
                  <X size={20} color={themeColors.textMuted} />
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
                <Check size={18} color={"#FFFFFF"} />
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
                <TouchableOpacity onPress={() => setShowRetentionModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} />
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
                placeholderTextColor={themeColors.textMuted}
              />

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleReleaseRetention} activeOpacity={0.85}>
                <Unlock size={18} color={"#FFFFFF"} />
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
                  <X size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={themeColors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color={themeColors.textMuted} />
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
                      <BookUser size={14} color={themeColors.accent} />
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
                  <Send size={16} color={"#FFFFFF"} />
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

function getInvoiceStatusColors(t: ThemeColors, status: string): { bg: string; text: string } {
  switch (status) {
    case 'draft': return { bg: t.line, text: t.textSecondary };
    case 'sent': return { bg: t.info, text: t.info };
    case 'partially_paid': return { bg: t.accentSoft, text: t.accent };
    case 'paid': return { bg: t.successSoft, text: t.success };
    case 'overdue': return { bg: t.danger, text: t.danger };
    default: return { bg: t.line, text: t.textSecondary };
  }
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  pipelineWrap: { paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  container: { flex: 1, backgroundColor: themeColors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: themeColors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.accent, marginHorizontal: 20, marginTop: 16, borderRadius: Tokens.radius.panel, padding: 20, gap: 4 },
  heroLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: Tokens.radius.sm, marginTop: 6 },
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
  termsSelectorText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  termsDropdown: { marginHorizontal: 20, marginTop: 4, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: themeColors.line, overflow: 'hidden' as const },
  termsOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  termsOptionActive: { backgroundColor: themeColors.accent + '08' },
  termsOptionText: { fontSize: Type.subhead.fontSize, color: themeColors.text },
  termsOptionTextActive: { color: themeColors.accent, fontWeight: '600' as const },
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
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
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
  recipientModalInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text, borderWidth: 1, borderColor: themeColors.line },
  markPaidBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.successSoft, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: themeColors.success + '30' },
  markPaidBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.success },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  modalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  methodChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line },
  methodChipActive: { backgroundColor: themeColors.accent },
  methodChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  methodChipTextActive: { color: "#FFFFFF" },
  modalSaveBtn: { backgroundColor: themeColors.success, borderRadius: Tokens.radius.lg, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  modalSaveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  retentionInput: { minWidth: 60, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, textAlign: 'right' as const },
  retentionPct: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  releaseRetentionBtn: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '15', borderWidth: 1, borderColor: themeColors.accent + '40' },
  releaseRetentionBtnText: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  releaseRetentionBtnMeta: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  retentionModalMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginBottom: 12 },
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
    backgroundColor: themeColors.accent,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    flexDirection: 'row' as const, gap: 8,
  },
  payLinkGenerateText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
});
