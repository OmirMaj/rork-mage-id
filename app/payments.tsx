import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  CreditCard, ArrowDownRight,
  Clock, Check, XCircle, Send, RefreshCw,
} from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { PROVIDER_INFO } from '@/mocks/payments';
import type { Payment, PaymentStatus, PaymentProvider, Invoice, Project, Contact } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { invoiceOutstanding } from '@/utils/invoiceBilling';
import { estimateNetAfterFees, platformFeeLabel, STRIPE_CARD_PROCESSING } from '@/utils/platformFees';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

function feeScheduleLabel(tier: string): string {
  return `${platformFeeLabel(tier)} + ${STRIPE_CARD_PROCESSING.percent}% + ${STRIPE_CARD_PROCESSING.fixedCents}¢`;
}

// A card the GC keyed in by hand is none of the eight PaymentProvider values —
// MAGE has no idea which processor took it — so the feed carries two display
// keys of its own alongside the shared PROVIDER_INFO table.
type FeedProvider = PaymentProvider | 'card' | 'other';

// "Card", not "Stripe": see the MONEY-01 note on the feed below. "Recorded" is
// for a ledger entry whose method we don't recognise — it says what we know
// rather than guessing a rail. Neither is a brand, so neither gets a brand
// colour; they wear the theme's neutral chip in both light and dark.
const FEED_PROVIDER_LABEL: Record<string, string> = {
  card: 'Card',
  other: 'Recorded',
};

function providerLabel(provider: FeedProvider): string {
  return FEED_PROVIDER_LABEL[provider] ?? PROVIDER_INFO[provider]?.label ?? FEED_PROVIDER_LABEL.other;
}

function providerBadge(provider: FeedProvider, t: ThemeColors): { label: string; color: string; bgColor: string } {
  const brand = FEED_PROVIDER_LABEL[provider] ? undefined : PROVIDER_INFO[provider];
  if (brand) return { label: brand.label, color: brand.color, bgColor: brand.bgColor };
  return { label: providerLabel(provider), color: t.textSecondary, bgColor: t.surfaceAlt };
}

/** One feed row. Extends the shared Payment with what only this screen knows. */
export interface PaymentRow extends Omit<Payment, 'provider'> {
  provider: FeedProvider;
  /**
   * True only when the money actually moved through MAGE's Stripe integration
   * — the ONLY case in which the fee on this row is a fee we can compute.
   */
  processedByMage: boolean;
  /** Retention the contract still lets the client hold on this invoice (pending rows). */
  retentionHeld: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-01 (runtime audit 2026-09-06). Two lies met on this screen:
//
//  1. methodToProvider() mapped EVERY `method: 'credit_card'` to provider
//     'stripe', and the row was then docked 2.9% + 30¢ Stripe processing AND
//     the tier platform fee. The founder's only real payment — $48,826.93,
//     hand-keyed on an invoice with pay_link_url NULL, so MAGE never minted a
//     link and charged no platform fee — was docked $1,660.41 (including
//     $244.13 of MAGE fee that was never charged) and badged "Stripe". The
//     same switch had no 'stripe' case at all, so a payment the webhook really
//     did record (it writes method 'stripe', id `stripe-<session>`) fell
//     through to default and was badged "Check".
//  2. The hero summed netAmount (gross − those invented fees) while the row
//     two lines below showed gross, so the headline "Received" tied to nothing
//     — not the rows, not the invoice's Amount Paid, not the bank.
//
// The rule now: a row is Stripe-processed only when the ledger entry says so
// (the webhook stamps method 'stripe' / a `stripe-` id). A hand-keyed card is
// labelled "Card", carries NO fee estimate, and the screen says plainly that
// its processor fee is unknown — an absent fact beats an invented one.
//
// And "Received" means GROSS cash recorded against invoices, net of refunds
// and chargebacks: the figure that ties to each row, to invoice.amountPaid and
// to the bank deposit. The net-of-fees figure stays available as the estimate
// it is, in the fee tile, labelled as an estimate.
//
// --- BEGIN payments feed (pure; executed by scripts/validate-payments-feed.ts — keep the sentinels) ---

/** The shape an entry in invoices.payments actually has on disk. */
export interface LedgerLike {
  id?: string;
  amount?: number;
  method?: string;
  /** The app writes `date`; older seeded rows and the webhook also carry `receivedAt`. */
  date?: string;
  receivedAt?: string;
  kind?: string;
}

// MONEY-F8: every fee figure comes from the ONE schedule in
// utils/platformFees.ts (mirrored byte-for-byte by the create-payment-link edge
// function). Stripe card processing and the caller's tier-specific platform
// fee both come out of the deposit. Only ever called for money that went
// through MAGE — for anything else there is no fee we know.
function cardFeeFor(amountDollars: number, tier: string): number {
  if (!(amountDollars > 0)) return 0;
  const { stripeFeeCents, platformFeeCents } = estimateNetAfterFees(Math.round(amountDollars * 100), tier);
  return (stripeFeeCents + platformFeeCents) / 100;
}

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Did MAGE process this money? Only the Stripe webhook writes these markers
 * (`method: 'stripe'`, ledger id `stripe-<session|refund|dispute>-…`); every
 * hand-recorded payment gets a uuid and one of the four PaymentMethod values.
 */
export function isMageProcessed(entry: LedgerLike): boolean {
  return entry.method === 'stripe' || (typeof entry.id === 'string' && entry.id.startsWith('stripe-'));
}

export function feedProviderFor(entry: LedgerLike): FeedProvider {
  if (isMageProcessed(entry)) return 'stripe';
  switch (entry.method) {
    case 'credit_card': return 'card';
    case 'check': return 'check';
    case 'ach': return 'ach';
    case 'cash': return 'cash';
    default: return 'other';
  }
}

/** A refund or a lost chargeback the webhook booked — money going back out. */
export function isReversal(entry: LedgerLike): boolean {
  return entry.kind === 'refund' || entry.kind === 'dispute' || (entry.amount ?? 0) < 0;
}

/** Rows whose money has actually moved. The hero "Received" is exactly their sum. */
export function isSettledRow(row: PaymentRow): boolean {
  return row.status === 'completed' || row.status === 'refunded';
}

export function isPendingRow(row: PaymentRow): boolean {
  return row.status === 'pending' || row.status === 'processing';
}

function entryDate(entry: LedgerLike, fallback: string): string {
  const raw = entry.date ?? entry.receivedAt;
  return raw && !Number.isNaN(new Date(raw).getTime()) ? raw : fallback;
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

// Build the feed from real invoice data.
//
// Row classes:
//   1. Settled — one per ledger entry. Payments are 'completed'; refunds and
//      lost chargebacks are 'refunded' and carry their negative amount, so the
//      settled rows sum to the cash actually kept.
//   2. Pending (Stripe) — invoice has payLinkUrl out; client hasn't paid yet.
//   3. Pending (other) — invoice is sent but no Stripe link and still owed.
//
// Sorted newest-first so the dashboard always shows the most recent activity.
export function derivePayments(
  projects: Project[], invoices: Invoice[], contacts: Contact[], tier: string,
): PaymentRow[] {
  const rows: PaymentRow[] = [];

  for (const inv of invoices) {
    const project = projects.find(p => p.id === inv.projectId);
    if (!project) continue;
    const clientName = displayClientName(project, contacts);
    const retentionHeld = Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0));

    // 1. Recorded ledger entries.
    for (const entry of (inv.payments ?? []) as LedgerLike[]) {
      const amount = entry.amount ?? 0;
      const provider = feedProviderFor(entry);
      const processedByMage = provider === 'stripe';
      // A fee we can only state for money MAGE actually ran. For a card the GC
      // keyed in by hand we do not know the processor, the rate, or whether
      // one was charged at all — so nothing is deducted and the screen says so.
      const fee = processedByMage ? roundCents(cardFeeFor(amount, tier)) : 0;
      const when = entryDate(entry, inv.issueDate);
      const reversal = isReversal(entry);
      const suffix = reversal
        ? (entry.kind === 'dispute' ? ' — chargeback' : ' — refund')
        : provider === 'card' ? ' — card recorded by hand' : '';
      rows.push({
        id: entry.id ?? `${inv.id}-${when}-${amount}`,
        invoiceId: inv.id,
        projectId: project.id,
        projectName: project.name,
        clientName,
        amount,
        fee,
        netAmount: roundCents(amount - fee),
        provider,
        processedByMage,
        retentionHeld: 0,
        status: reversal ? 'refunded' : 'completed',
        description: `Invoice #${inv.number}${suffix}`,
        createdAt: when,
        completedAt: when,
      });
    }

    // 2/3. Outstanding balance row — only for sent/partially_paid/overdue with a
    // positive balance. Draft and fully-paid invoices don't belong on a
    // payments feed. MONEY-F5: balance is net of held retention.
    const balance = invoiceOutstanding(inv);
    if (
      balance > 0 &&
      inv.status !== 'draft' &&
      inv.status !== 'paid'
    ) {
      const hasStripeLink = !!inv.payLinkUrl;
      // A live MAGE pay link is the one pending case where we DO know the fee
      // schedule the money will land under.
      const estimatedFee = hasStripeLink ? roundCents(cardFeeFor(balance, tier)) : 0;
      rows.push({
        id: `pending-${inv.id}`,
        invoiceId: inv.id,
        projectId: project.id,
        projectName: project.name,
        clientName,
        amount: balance,
        fee: estimatedFee,
        netAmount: roundCents(balance - estimatedFee),
        provider: hasStripeLink ? 'stripe' : 'other',
        processedByMage: hasStripeLink,
        retentionHeld,
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

  const time = (iso: string): number => {
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  rows.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  return rows;
}

export interface PaymentsSummary {
  /** Gross cash recorded against invoices, net of refunds — the sum of the settled rows. */
  received: number;
  /** Outstanding, already net of retention still held. */
  pending: number;
  /** Retention excluded from `pending` because the contract lets the client hold it. */
  pendingRetentionHeld: number;
  /** Estimated Stripe + MAGE fees on the settled rows MAGE actually processed. */
  totalFees: number;
  /** Settled card rows MAGE did NOT process — their processor fee is unknown. */
  unknownFeeCount: number;
  failedCount: number;
}

/**
 * The hero numbers. `received` is the sum of exactly the rows the Completed
 * tab renders, so the headline can always be reconciled against the list
 * underneath it — the thing the old net-of-invented-fees hero could not do.
 */
export function summarizePayments(rows: PaymentRow[]): PaymentsSummary {
  const settled = rows.filter(isSettledRow);
  const pendingRows = rows.filter(isPendingRow);
  const sum = (list: PaymentRow[], pick: (r: PaymentRow) => number): number =>
    roundCents(list.reduce((s, r) => s + pick(r), 0));
  return {
    received: sum(settled, r => r.amount),
    pending: sum(pendingRows, r => r.amount),
    pendingRetentionHeld: sum(pendingRows, r => r.retentionHeld),
    totalFees: sum(settled, r => r.fee),
    unknownFeeCount: settled.filter(r => r.provider === 'card').length,
    failedCount: rows.filter(r => r.status === 'failed').length,
  };
}
// --- END payments feed ---

// Themed per-status chip styling — a FUNCTION of the palette (not a module
// static) so the chip fills flip with the theme instead of staying bright
// light-theme pastels on dark cards. bgColor→soft tokens, color→label tokens
// per the theme-sweep convention.
const statusConfig = (t: ThemeColors): Record<PaymentStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> => ({
  pending: { label: 'Pending', color: t.warningLabel, bgColor: t.warningSoft, icon: Clock },
  processing: { label: 'Processing', color: t.info, bgColor: t.info + '1F', icon: RefreshCw },
  completed: { label: 'Completed', color: t.success, bgColor: t.successSoft, icon: Check },
  failed: { label: 'Failed', color: t.dangerLabel, bgColor: t.dangerSoft, icon: XCircle },
  refunded: { label: 'Refunded', color: t.textSecondary, bgColor: t.surfaceAlt, icon: RefreshCw },
});

function PaymentCard({ payment, onPress }: { payment: PaymentRow; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusInfo = statusConfig(themeColors)[payment.status];
  const providerInfo = providerBadge(payment.provider, themeColors);
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
            <Text style={[styles.payCardAmount, payment.status === 'failed' && { color: themeColors.dangerLabel }]}>
              {formatMoney(payment.amount)}
            </Text>
            {payment.fee > 0 ? (
              <Text style={styles.payCardFee}>-{formatMoney(payment.fee, 2)} est. fee</Text>
            ) : payment.provider === 'card' ? (
              // MONEY-01: MAGE didn't run this card, so we don't know what the
              // processor took. Say that instead of inventing 2.9% + 30¢.
              <Text style={styles.payCardFee}>Processor fee unknown</Text>
            ) : null}
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { projects, invoices, contacts } = useProjects();
  const { tier } = useTierAccess();
  const [selectedTab, setSelectedTab] = useState<'all' | 'pending' | 'completed'>('all');

  // Derive the whole feed from real invoice data. Recomputes cheaply — the
  // three inputs are already memoized by ProjectContext.
  const payments = useMemo(
    () => derivePayments(projects, invoices, contacts, tier),
    [projects, invoices, contacts, tier],
  );

  // The Completed tab is `isSettledRow` and the hero's Received is the sum of
  // the SAME predicate — one definition, so the headline always foots to the
  // list under it (MONEY-01).
  const filtered = useMemo(() => {
    if (selectedTab === 'all') return payments;
    if (selectedTab === 'pending') return payments.filter(isPendingRow);
    return payments.filter(isSettledRow);
  }, [payments, selectedTab]);

  const stats = useMemo(() => summarizePayments(payments), [payments]);

  // Tapping any row drops you into the invoice — that's where you record a
  // payment, generate/share a Stripe link, or see payment history. The old
  // "Send Reminder" / "Retry" alerts were fake; no backend existed for them.
  const handlePaymentPress = useCallback((payment: PaymentRow) => {
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
    showAlert(
      'Payment Details',
      `${formatMoney(payment.amount)} • ${providerLabel(payment.provider)}\n${payment.description}`,
    );
  }, []);

  // Route to the oldest outstanding invoice so the GC can generate a Stripe
  // link from there. Picking the oldest (not newest) matches "collect what's
  // overdue first" intuition. The button doesn't SEND anything on its own —
  // it opens a specific invoice editor — so we confirm which invoice we're
  // opening (and how many others are outstanding) before routing, instead of
  // silently teleporting the GC into a random-looking invoice.
  const handleSendInvoice = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const outstanding = invoices
      .filter(inv =>
        invoiceOutstanding(inv) > 0 &&
        inv.status !== 'draft' &&
        inv.status !== 'paid',
      )
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

    if (outstanding.length === 0) {
      showAlert(
        'Nothing to Collect',
        'No outstanding invoices right now. Create or send an invoice to request payment.',
      );
      return;
    }
    const target = outstanding[0];
    const targetProject = projects.find(p => p.id === target.projectId);
    const targetLabel = `Invoice #${target.number}${targetProject ? ` — ${targetProject.name}` : ''}`;
    const openTarget = () => {
      router.push({
        pathname: '/invoice' as any,
        params: { projectId: target.projectId, invoiceId: target.id },
      });
    };
    const othersNote = outstanding.length > 1
      ? ` It's the oldest of ${outstanding.length} outstanding invoices — collect the rest from each project.`
      : '';
    showAlert(
      'Collect oldest unpaid',
      `Opening ${targetLabel} so you can send a pay link or record payment.${othersNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open', onPress: openTarget },
      ],
    );
  }, [invoices, projects]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Payments', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text } }} />
      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCards}>
          <View style={[styles.heroCard, { flex: 1.2 }]}>
            <View style={[styles.heroIconWrap, { backgroundColor: themeColors.successSoft }]}>
              <ArrowDownRight size={18} color={themeColors.success} strokeWidth={1.75} />
            </View>
            <Text style={[styles.heroValue, { color: themeColors.success }]}>{formatMoney(stats.received)}</Text>
            <Text style={styles.heroLabel}>Received</Text>
            {/* Labelled, per MONEY-01: this is the money in, before fees — the
                same figure the rows and each invoice's Amount Paid show. */}
            <Text style={styles.heroNote}>Amount paid, before fees</Text>
          </View>
          <View style={styles.heroCard}>
            <View style={[styles.heroIconWrap, { backgroundColor: themeColors.warningSoft }]}>
              <Clock size={18} color={themeColors.warningLabel} strokeWidth={1.75} />
            </View>
            <Text style={[styles.heroValue, { color: themeColors.warningLabel }]}>{formatMoney(stats.pending)}</Text>
            <Text style={styles.heroLabel}>Pending</Text>
            <Text style={styles.heroNote}>
              {stats.pendingRetentionHeld > 0
                ? `Excludes ${formatMoney(stats.pendingRetentionHeld)} retention held`
                : 'Owed to you now'}
            </Text>
          </View>
        </View>

        <View style={styles.feeRow}>
          <View style={styles.feeItem}>
            <View style={styles.feeItemText}>
              <Text style={styles.feeItemLabel}>Est. fees on payments MAGE processed</Text>
              <Text style={styles.feeItemSub}>{feeScheduleLabel(tier)}</Text>
            </View>
            <Text style={styles.feeItemValue}>{formatMoney(stats.totalFees, 2)}</Text>
          </View>
          {stats.failedCount > 0 && (
            <View style={[styles.feeItem, { backgroundColor: themeColors.dangerSoft }]}>
              <Text style={[styles.feeItemLabel, { color: themeColors.dangerLabel }]}>Failed</Text>
              <Text style={[styles.feeItemValue, { color: themeColors.dangerLabel }]}>{stats.failedCount}</Text>
            </View>
          )}
        </View>

        {stats.unknownFeeCount > 0 && (
          <Text style={styles.feeNote}>
            {stats.unknownFeeCount === 1
              ? '1 card payment was recorded by hand. MAGE did not process it, so its processor fee is unknown and none is deducted above.'
              : `${stats.unknownFeeCount} card payments were recorded by hand. MAGE did not process them, so their processor fees are unknown and none are deducted above.`}
          </Text>
        )}

        <TouchableOpacity style={styles.sendButton} onPress={handleSendInvoice} activeOpacity={0.85}>
          <Send size={18} color="#fff" strokeWidth={1.75} />
          <Text style={styles.sendButtonText}>Collect Oldest Unpaid</Text>
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
            <View style={{ minHeight: 360 }}>
              <EmptyState
                icon={<CreditCard size={32} color={themeColors.accent} strokeWidth={1.75} />}
                title="No payments yet"
                message="Payments show up here the moment a client pays an invoice or you log a check. To collect your first one:"
                steps={[
                  'Open a project and create an invoice with a Stripe pay link.',
                  'Send the invoice — the client taps Pay or you mark a check received.',
                  'Payments, fees, and provider details land on this screen automatically.',
                ]}
                actionLabel="Open Projects"
                onAction={() => router.push('/(tabs)/(home)' as any)}
              />
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  heroCards: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 16,
    marginBottom: 12,
  },
  heroCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroIconWrap: { width: 36, height: 36, borderRadius: Tokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  heroValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },
  heroLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  heroNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: -4, lineHeight: 14 },
  feeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 16,
  },
  feeItem: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.line,
  },
  feeItemText: { flex: 1, gap: 2, paddingRight: 8 },
  feeItemLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  feeItemSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  feeItemValue: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  feeNote: {
    paddingHorizontal: 16,
    marginTop: -8,
    marginBottom: 16,
    fontSize: Type.caption1.fontSize,
    lineHeight: 17,
    color: t.textMuted,
  },
  sendButton: {
    marginHorizontal: 16,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  sendButtonText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Tokens.radius.md,
  },
  tabActive: { backgroundColor: t.surface },
  tabText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textMuted },
  tabTextActive: { color: t.text },
  listSection: { paddingHorizontal: 16 },
  payCard: {
    marginBottom: 10,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface,
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
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerBadgeLetter: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const },
  payCardInfo: { flex: 1, gap: 2 },
  payCardClient: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  payCardProject: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  payCardAmount: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  payCardFee: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  payCardDesc: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  payCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  payStatusText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  payCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  providerTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  providerTagText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  payCardDate: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
});
