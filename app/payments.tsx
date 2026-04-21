import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CreditCard, ArrowDownRight,
  Clock, Check, XCircle, Send, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PROVIDER_INFO } from '@/mocks/payments';
import type { Payment, PaymentStatus, PaymentProvider, Invoice, Project, Contact } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { useProjects } from '@/contexts/ProjectContext';

// Stripe's posted rate — good enough for a rough "net after fees" column on the
// payments dashboard. We never charge this ourselves; Stripe takes it out of
// the deposit. Keeping it here means the GC can see what they actually cleared.
const STRIPE_FEE_PERCENT = 0.029;
const STRIPE_FEE_FIXED = 0.30;

// Map the narrower PaymentMethod used on InvoicePayment to the broader
// PaymentProvider used on the dashboard. credit_card is assumed to flow through
// Stripe — that's the only card-capable integration we've wired.
function methodToProvider(method: string): PaymentProvider {
  switch (method) {
    case 'credit_card': return 'stripe';
    case 'check': return 'check';
    case 'ach': return 'ach';
    case 'cash': return 'cash';
    default: return 'check';
  }
}

function displayClientName(project: Project, contacts: Contact[]): string {
  // Prefer an explicitly linked contact; fall back to the project name so a
  // row is never blank. We don't type-narrow on role here because plenty of
  // real-world contacts get typed as 'owner' / 'property_manager' / whatever.
  const linked = contacts.find(c => c.linkedProjectIds?.includes(project.id));
  if (linked) {
    const full = `${linked.firstName ?? ''} ${linked.lastName ?? ''}`.trim();
    if (full) return full;
    if (linked.companyName) return linked.companyName;
  }
  return project.name;
}

// Build a unified Payment[] from real invoice data.
//
// Three row classes:
//   1. Completed — each InvoicePayment the GC recorded manually.
//   2. Pending (Stripe) — invoice has payLinkUrl out; client hasn't paid yet.
//   3. Pending (other) — invoice is sent but no Stripe link and still owed.
//
// Sorted newest-first so the dashboard always shows the most recent activity.
function derivePayments(
  projects: Project[], invoices: Invoice[], contacts: Contact[],
): Payment[] {
  const rows: Payment[] = [];

  for (const inv of invoices) {
    const project = projects.find(p => p.id === inv.projectId);
    if (!project) continue;
    const clientName = displayClientName(project, contacts);

    // 1. Recorded payments — one row per payment, always 'completed'.
    for (const p of inv.payments ?? []) {
      const provider = methodToProvider(p.method);
      const fee = provider === 'stripe'
        ? Math.round((p.amount * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED) * 100) / 100
        : 0;
      rows.push({
        id: p.id,
        invoiceId: inv.id,
        projectId: project.id,
        projectName: project.name,
        clientName,
        amount: p.amount,
        fee,
        netAmount: Math.round((p.amount - fee) * 100) / 100,
        provider,
        status: 'completed',
        description: `Invoice #${inv.number}`,
        createdAt: p.date,
        completedAt: p.date,
      });
    }

    // 2/3. Outstanding balance row — only for sent/partially_paid/overdue with a
    // positive balance. Draft and fully-paid invoices don't belong on a
    // payments feed.
    const balance = Math.max(0, inv.totalDue - inv.amountPaid);
    if (
      balance > 0 &&
      inv.status !== 'draft' &&
      inv.status !== 'paid'
    ) {
      const hasStripeLink = !!inv.payLinkUrl;
      const estimatedFee = hasStripeLink
        ? Math.round((balance * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED) * 100) / 100
        : 0;
      rows.push({
        id: `pending-${inv.id}`,
        invoiceId: inv.id,
        projectId: project.id,
        projectName: project.name,
        clientName,
        amount: balance,
        fee: estimatedFee,
        netAmount: Math.round((balance - estimatedFee) * 100) / 100,
        provider: hasStripeLink ? 'stripe' : 'check',
        // overdue is still "pending" from our side — the client owes but
        // nothing has bounced. Reserving 'failed' for actual Stripe card
        // declines we'll pick up via webhook later.
        status: 'pending',
        description: hasStripeLink
          ? `Invoice #${inv.number} — Stripe link sent`
          : `Invoice #${inv.number} — awaiting payment`,
        createdAt: inv.issueDate,
      });
    }
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows;
}

const STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: '#E65100', bgColor: '#FFF3E0', icon: Clock },
  processing: { label: 'Processing', color: '#1565C0', bgColor: '#E3F2FD', icon: RefreshCw },
  completed: { label: 'Completed', color: '#2E7D32', bgColor: '#E8F5E9', icon: Check },
  failed: { label: 'Failed', color: '#C62828', bgColor: '#FFEBEE', icon: XCircle },
  refunded: { label: 'Refunded', color: '#546E7A', bgColor: '#ECEFF1', icon: RefreshCw },
};

function PaymentCard({ payment, onPress }: { payment: Payment; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusInfo = STATUS_CONFIG[payment.status];
  const providerInfo = PROVIDER_INFO[payment.provider] ?? PROVIDER_INFO.check;
  const StatusIcon = statusInfo.icon;

  return (
    <Animated.View style={[styles.payCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.payCardInner}
      >
        <View style={styles.payCardHeader}>
          <View style={[styles.providerBadge, { backgroundColor: providerInfo.bgColor }]}>
            <Text style={[styles.providerBadgeLetter, { color: providerInfo.color }]}>
              {providerInfo.label.charAt(0)}
            </Text>
          </View>
          <View style={styles.payCardInfo}>
            <Text style={styles.payCardClient}>{payment.clientName}</Text>
            <Text style={styles.payCardProject} numberOfLines={1}>{payment.projectName}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.payCardAmount, payment.status === 'failed' && { color: '#C62828' }]}>
              {formatMoney(payment.amount)}
            </Text>
            {payment.fee > 0 && (
              <Text style={styles.payCardFee}>-{formatMoney(payment.fee, 2)} fee</Text>
            )}
          </View>
        </View>

        <Text style={styles.payCardDesc} numberOfLines={1}>{payment.description}</Text>

        <View style={styles.payCardFooter}>
          <View style={[styles.payStatusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <StatusIcon size={10} color={statusInfo.color} />
            <Text style={[styles.payStatusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
          <View style={styles.payCardMetaRow}>
            <View style={[styles.providerTag, { backgroundColor: providerInfo.bgColor }]}>
              <Text style={[styles.providerTagText, { color: providerInfo.color }]}>{providerInfo.label}</Text>
            </View>
            <Text style={styles.payCardDate}>
              {new Date(payment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function PaymentsScreen() {
  const insets = useSafeAreaInsets();
  const { projects, invoices, contacts } = useProjects();
  const [selectedTab, setSelectedTab] = useState<'all' | 'pending' | 'completed'>('all');

  // Derive the whole feed from real invoice data. Recomputes cheaply — the
  // three inputs are already memoized by ProjectContext.
  const payments = useMemo(
    () => derivePayments(projects, invoices, contacts),
    [projects, invoices, contacts],
  );

  const filtered = useMemo(() => {
    if (selectedTab === 'all') return payments;
    if (selectedTab === 'pending') return payments.filter(p => p.status === 'pending' || p.status === 'processing');
    return payments.filter(p => p.status === 'completed');
  }, [payments, selectedTab]);

  const stats = useMemo(() => {
    const received = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.netAmount, 0);
    const pending = payments.filter(p => p.status === 'pending' || p.status === 'processing').reduce((s, p) => s + p.amount, 0);
    const totalFees = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.fee, 0);
    const failedCount = payments.filter(p => p.status === 'failed').length;
    return { received, pending, totalFees, failedCount };
  }, [payments]);

  // Tapping any row drops you into the invoice — that's where you record a
  // payment, generate/share a Stripe link, or see payment history. The old
  // "Send Reminder" / "Retry" alerts were fake; no backend existed for them.
  const handlePaymentPress = useCallback((payment: Payment) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (payment.invoiceId) {
      router.push({
        pathname: '/invoice' as any,
        params: { projectId: payment.projectId, invoiceId: payment.invoiceId },
      });
      return;
    }
    // No invoice anchor (shouldn't happen with real data, but belt-and-braces
    // so we never leave the user staring at a dead press).
    const providerInfo = PROVIDER_INFO[payment.provider] ?? PROVIDER_INFO.check;
    Alert.alert(
      'Payment Details',
      `${formatMoney(payment.amount)} • ${providerInfo.label}\n${payment.description}`,
    );
  }, []);

  // Route to the oldest outstanding invoice so the GC can generate a Stripe
  // link from there. Picking the oldest (not newest) matches "collect what's
  // overdue first" intuition and is what the user reported needing most.
  const handleSendInvoice = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const outstanding = invoices
      .filter(inv =>
        (inv.totalDue - inv.amountPaid) > 0 &&
        inv.status !== 'draft' &&
        inv.status !== 'paid',
      )
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

    if (outstanding.length === 0) {
      Alert.alert(
        'Nothing to Collect',
        'No outstanding invoices right now. Create or send an invoice to request payment.',
      );
      return;
    }
    const target = outstanding[0];
    router.push({
      pathname: '/invoice' as any,
      params: { projectId: target.projectId, invoiceId: target.id },
    });
  }, [invoices]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Payments', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCards}>
          <View style={[styles.heroCard, { flex: 1.2 }]}>
            <View style={[styles.heroIconWrap, { backgroundColor: '#E8F5E9' }]}>
              <ArrowDownRight size={18} color="#2E7D32" />
            </View>
            <Text style={[styles.heroValue, { color: '#2E7D32' }]}>{formatMoney(stats.received)}</Text>
            <Text style={styles.heroLabel}>Received</Text>
          </View>
          <View style={styles.heroCard}>
            <View style={[styles.heroIconWrap, { backgroundColor: '#FFF3E0' }]}>
              <Clock size={18} color="#E65100" />
            </View>
            <Text style={[styles.heroValue, { color: '#E65100' }]}>{formatMoney(stats.pending)}</Text>
            <Text style={styles.heroLabel}>Pending</Text>
          </View>
        </View>

        <View style={styles.feeRow}>
          <View style={styles.feeItem}>
            <Text style={styles.feeItemLabel}>Processing Fees</Text>
            <Text style={styles.feeItemValue}>{formatMoney(stats.totalFees, 2)}</Text>
          </View>
          {stats.failedCount > 0 && (
            <View style={[styles.feeItem, { backgroundColor: '#FFEBEE' }]}>
              <Text style={[styles.feeItemLabel, { color: '#C62828' }]}>Failed</Text>
              <Text style={[styles.feeItemValue, { color: '#C62828' }]}>{stats.failedCount}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.sendButton} onPress={handleSendInvoice} activeOpacity={0.85}>
          <Send size={18} color="#fff" />
          <Text style={styles.sendButtonText}>Send Payment Request</Text>
        </TouchableOpacity>

        <View style={styles.tabRow}>
          {(['all', 'pending', 'completed'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, selectedTab === tab && styles.tabActive]}
              onPress={() => setSelectedTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, selectedTab === tab && styles.tabTextActive]}>
                {tab === 'all' ? `All (${payments.length})` : tab === 'pending' ? 'Pending' : 'Completed'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <CreditCard size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No payments found</Text>
            </View>
          ) : (
            filtered.map(payment => (
              <PaymentCard key={payment.id} payment={payment} onPress={() => handlePaymentPress(payment)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroCards: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 16,
    marginBottom: 12,
  },
  heroCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  heroValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  heroLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  feeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 16,
  },
  feeItem: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  feeItemLabel: { fontSize: 13, color: Colors.textSecondary },
  feeItemValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  sendButton: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  sendButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: { backgroundColor: Colors.surface },
  tabText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textMuted },
  tabTextActive: { color: Colors.text },
  listSection: { paddingHorizontal: 16 },
  payCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  payCardInner: { padding: 14, gap: 8 },
  payCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerBadgeLetter: { fontSize: 18, fontWeight: '700' as const },
  payCardInfo: { flex: 1, gap: 2 },
  payCardClient: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  payCardProject: { fontSize: 12, color: Colors.textSecondary },
  payCardAmount: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  payCardFee: { fontSize: 11, color: Colors.textMuted },
  payCardDesc: { fontSize: 13, color: Colors.textSecondary },
  payCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  payStatusText: { fontSize: 11, fontWeight: '600' as const },
  payCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  providerTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  providerTagText: { fontSize: 11, fontWeight: '600' as const },
  payCardDate: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
});
