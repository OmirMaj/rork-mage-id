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
import { nailIt } from '@/components/animations/NailItToast';
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
      // Hammer-strike toast — non-blocking, lets the back nav fire immediately.
      nailIt(status === 'sent' ? `Invoice #${nextInvoiceNumber} sent${recipientInfo}` : `Invoice #${nextInvoiceNumber} saved`);
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

      // Auto-generate a Stripe payment link if the invoice doesn't have one
      // yet. Without this, the email goes out with no Pay button — clients
      // get an invoice they can read but not pay, and we lose the whole
      // value prop of the integration. This runs silently in the background;
      // if Stripe is unreachable, we just send the email without the button
      // (graceful degradation rather than blocking the send).
      let payLinkUrl: string | undefined = existingInvoice?.payLinkUrl;
      if (!payLinkUrl && existingInvoice && totalDue > 0) {
        try {
          const res = await createPaymentLink({
            invoiceId: existingInvoice.id,
            invoiceNumber: existingInvoice.number,
            projectName: project?.name ?? 'Project',
            amountCents: Math.round(totalDue * 100),
            customerEmail: sendRecipientEmail.trim(),
            companyName: branding.companyName,
          });
          if (res.success && res.url && res.id) {
            payLinkUrl = res.url;
            updateInvoice(existingInvoice.id, { payLinkUrl: res.url, payLinkId: res.id });
          } else {
            console.warn('[Invoice] Auto-generate payment link failed:', res.error);
          }
        } catch (err) {
          console.warn('[Invoice] Auto-generate payment link threw:', err);
        }
      }

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
        // One-tap pay button in the email body. Closes the friction loop:
        // client gets invoice → taps "Pay Securely" → on Stripe in 1s.
        payLinkUrl,
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
  }, [handleSave, sendRecipientName, sendRecipientEmail, settings, project, existingInvoice, nextInvoiceNumber, totalDue, paymentTerms, updateInvoice]);

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
          const res = await createPaymentLink({
            invoiceId: existingInvoice.id,
            invoiceNumber: existingInvoice.number,
            projectName: project.name,
            amountCents: Math.round((existingInvoice.totalDue - existingInvoice.amountPaid) * 100),
            customerEmail: options.recipient.trim(),
            companyName: branding.companyName,
          });
          if (res.success && res.url && res.id) {
            payLinkUrl = res.url;
            updateInvoice(existingInvoice.id, { payLinkUrl: res.url, payLinkId: res.id });
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
