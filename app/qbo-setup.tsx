import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw, Users, Package, FileText, DollarSign, Shield, Receipt } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { connectQuickBooks, fetchQboStatus, type QboStatus } from '@/utils/qboSync';
import { QboSuccessCheckmark } from '@/components/QboSuccessCheckmark';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Button } from '@/components/ui';
import { useQboCostLines } from '@/hooks/useQboCostLines';
import { showAlert } from '@/utils/alert';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Invoice } from '@/types';

// --- BEGIN paymentsNotInQuickBooks ------------------------------------------
// The client twin of countPaymentsNotInQbo in
// supabase/functions/_shared/paymentLedger.ts (the app cannot import Deno
// files). scripts/validate-qbo-payment-ledger.ts executes BOTH over the same
// fixtures, so the number on this screen is the number the reconciler works
// down. Counted on invoices already in QuickBooks only — an invoice that never
// synced is already in the Errors/Pending tiles, and its payments cannot go
// before it does.
function paymentsNotInQuickBooks(invoices: readonly Pick<Invoice, 'qboId' | 'payments'>[]): number {
  let n = 0;
  for (const inv of invoices) {
    if (!inv.qboId || !Array.isArray(inv.payments)) continue;
    for (const raw of inv.payments as unknown[]) {
      const e = raw as { id?: unknown; amount?: unknown; qboId?: unknown; source?: unknown; method?: unknown; kind?: unknown } | null;
      if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;
      if (e.qboId) continue;
      if (e.source === 'qbo' || e.method === 'qbo') continue;
      if (e.kind === 'refund' || e.kind === 'dispute') continue;
      const amt = Number(e.amount ?? 0);
      if (Number.isFinite(amt) && amt > 0) n++;
    }
  }
  return n;
}

// Twin of QBO_CLOSED_WITHOUT_PAYMENT_PREFIX in _shared/paymentLedger.ts — the
// flag qbo-reconciler writes when QuickBooks shows an invoice paid that no
// payment explains. The validator pins the two strings equal.
const QBO_CLOSED_WITHOUT_PAYMENT_PREFIX = 'QuickBooks shows this invoice closed without a payment';
/**
 * Flagged invoices, split by what MAGE itself says (audit #10). The flag is
 * only set or lifted by the reconciler's pull, which never re-reads an invoice
 * QuickBooks has not changed — so once the GC had recorded the money in MAGE
 * the card still said "MAGE still shows them open". Those are a different
 * problem (two ledgers closed two different ways) and are counted apart.
 */
// Twin of utils/qboClosedFlag QBO_REFUND_GAP_FLAG_MARKER (pinned equal): a
// refund-gap flag on an invoice MAGE shows paid is a different story from a
// credit/void — QuickBooks took a real payment, MAGE recorded a refund, and
// the client has since paid again in MAGE. Counted apart so its card can say so.
const QBO_REFUND_GAP_MARKER = 'as refunded or charged back';
function invoicesClosedWithoutPayment(invoices: readonly { qboError?: string | null; status?: string | null }[]): { open: number; paidInMage: number; refundGapPaid: number } {
  let open = 0, paidInMage = 0, refundGapPaid = 0;
  for (const i of invoices) {
    if (typeof i.qboError !== 'string' || !i.qboError.startsWith(QBO_CLOSED_WITHOUT_PAYMENT_PREFIX)) continue;
    const flag = i.qboError.split('\n\nAlso: ')[0];
    if (i.status !== 'paid') open++;
    else if (flag.includes(QBO_REFUND_GAP_MARKER)) refundGapPaid++;
    else paidInMage++;
  }
  return { open, paidInMage, refundGapPaid };
}

// Twin of MAX_PAYMENT_PUSH_ATTEMPTS in _shared/paymentLedger.ts (pinned equal).
const QBO_PAYMENT_PUSH_MAX_ATTEMPTS = 5;
// Twin of PAYMENT_SWEEP_FLOOR (pinned equal). The floor the reconciler really
// uses is the later of this and the connection's creation; qbo-sync hands that
// back (sweepFloor) and it wins once it has loaded.
const QBO_PAYMENT_SWEEP_FLOOR = '2026-09-17T00:00:00.000Z';
type LedgerRaw = {
  id?: unknown; amount?: unknown; qboId?: unknown; qboError?: unknown; qboAttempts?: unknown; source?: unknown;
  method?: unknown; kind?: unknown; paymentIntentId?: unknown; date?: unknown; qboReversalRecordedAt?: unknown; qboReversalRecordedAmount?: unknown;
} | null;

/** Twin of unsyncedPaymentState: what the reconciler will actually do with it. */
type StuckState = 'reversed' | 'stopped' | 'not-swept' | 'refused' | 'retrying';
function unsyncedStateOf(e: NonNullable<LedgerRaw>, ledger: readonly LedgerRaw[], floorIso: string): StuckState {
  const reversed = typeof e.paymentIntentId === 'string' && e.paymentIntentId !== ''
    && ledger.some((r) => !!r && r !== e && (r.kind === 'refund' || r.kind === 'dispute') && r.paymentIntentId === e.paymentIntentId);
  if (reversed) return 'reversed';
  if (Number(e.qboAttempts ?? 0) >= QBO_PAYMENT_PUSH_MAX_ATTEMPTS) return 'stopped';
  // INSTANTS, not calendar days: the sweep compares the entry's stored stamp
  // (an instant from the webhook / app) with the floor instant in ms, and
  // this label must be that exact comparison — parity, not a local reading.
  const stamp: unknown = e.date;
  const floorStamp: string = floorIso;
  const at = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  const floor = Date.parse(floorStamp);
  if (!Number.isFinite(at) || (Number.isFinite(floor) && at < floor)) return 'not-swept';
  if (typeof e.qboError === 'string' && /^QuickBooks (shows only|already shows invoice)/.test(e.qboError)) return 'refused';
  return 'retrying';
}

/** One payment that did not reach QuickBooks, with the reason the reconciler
 *  recorded on it (entry.qboError). The count alone left the GC with nothing
 *  to act on, and the card's copy promised a retry the reconciler will not
 *  make for a refused, exhausted, refunded or pre-sweep payment. */
interface StuckQboPayment {
  key: string;
  invoiceNumber: number | string | null;
  amount: number;
  reason: string;
  state: StuckState;
}
function stuckQboPayments(
  invoices: readonly { number?: number | string | null; qboId?: string; payments?: unknown }[],
  floorIso: string = QBO_PAYMENT_SWEEP_FLOOR,
): StuckQboPayment[] {
  const out: StuckQboPayment[] = [];
  for (const inv of invoices) {
    if (!inv.qboId || !Array.isArray(inv.payments)) continue;
    const ledger = inv.payments as LedgerRaw[];
    for (const e of ledger) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || e.qboId) continue;
      if (e.source === 'qbo' || e.method === 'qbo' || e.kind === 'refund' || e.kind === 'dispute') continue;
      const amount = Number(e.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const state = unsyncedStateOf(e, ledger, floorIso);
      const recorded = typeof e.qboError === 'string' && e.qboError !== '' ? e.qboError : null;
      // A refunded payment is listed even with no push error: it will never
      // go, and somebody has to book the net by hand.
      if (!recorded && state !== 'reversed') continue;
      out.push({
        key: `${String(inv.qboId)}:${e.id}`,
        invoiceNumber: inv.number ?? null,
        amount,
        reason: recorded ?? 'Refunded or charged back in Stripe, so MAGE did not send it to QuickBooks.',
        state,
      });
    }
  }
  return out;
}

/** Twin of reversalsNotInQbo (audit #97): money MAGE already sent to
 *  QuickBooks that has since been refunded or lost in a chargeback. */
interface QboReversalLine {
  key: string;
  invoiceId: string;
  entryId: string;
  invoiceNumber: number | string | null;
  amount: number;
  kind: 'refund' | 'dispute';
  paymentQboId: string;
}
function reversalsNotInQuickBooks(
  invoices: readonly { id?: string; number?: number | string | null; qboId?: string; payments?: unknown }[],
): QboReversalLine[] {
  const out: QboReversalLine[] = [];
  for (const inv of invoices) {
    if (!inv.qboId || !Array.isArray(inv.payments)) continue;
    const ledger = inv.payments as LedgerRaw[];
    for (const r of ledger) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue;
      if (r.kind !== 'refund' && r.kind !== 'dispute') continue;
      const amt = Number(r.amount ?? 0);
      if (!Number.isFinite(amt) || amt > -0.01 || r.qboId || typeof r.paymentIntentId !== 'string' || !r.paymentIntentId) continue;
      // Less what he already said he recorded — a second partial refund grows
      // the same (already stamped) entry. Twin of the server rule.
      const recorded = r.qboReversalRecordedAt ? Number(r.qboReversalRecordedAmount ?? -amt) : 0;
      const open = Math.round((-amt - (Number.isFinite(recorded) ? recorded : 0)) * 100) / 100;
      if (open < 0.01) continue;
      const orig = ledger.find((e) => !!e && e !== r && e.paymentIntentId === r.paymentIntentId && Number(e.amount) > 0 && !!e.qboId);
      if (!orig) continue;
      out.push({
        key: `${String(inv.qboId)}:${r.id}`,
        invoiceId: String(inv.id ?? ''),
        entryId: r.id,
        invoiceNumber: inv.number ?? null,
        amount: open,
        kind: r.kind,
        paymentQboId: String(orig.qboId),
      });
    }
  }
  return out;
}
// --- END paymentsNotInQuickBooks ---

type QboLedgerRow = Pick<Invoice, 'qboId' | 'payments'> & { id: string; qboError?: string | null; number?: number | null; status?: string | null };

/**
 * The SERVER's copy of every QuickBooks-linked invoice's ledger. Counting the
 * device's in-memory invoices said "every payment is in QuickBooks" while they
 * were still loading (an empty list counts zero), and "not in QuickBooks yet"
 * right after a successful push — payment.ts stamps qboId on the server, and
 * the device has not refetched. RLS-scoped, read-only.
 */
async function fetchQboLedgerRows(userId: string): Promise<QboLedgerRow[]> {
  const PAGE = 1000;
  const out: QboLedgerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invoices')
      .select('id,number,qbo_id,payments,qbo_error,status')
      .eq('user_id', userId)
      .not('qbo_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; number: number | null; qbo_id: string | null; payments: unknown; qbo_error: string | null; status: string | null }[];
    for (const r of rows) {
      out.push({ id: r.id, qboId: r.qbo_id ?? undefined, payments: r.payments as Invoice['payments'], qboError: r.qbo_error, number: r.number, status: r.status });
    }
    if (rows.length < PAGE) return out;
  }
}


/**
 * Registers this device's time zone with the QuickBooks connection and reads
 * back the reconciler's sweep floor (qbo-sync kind 'connection'). The zone is
 * how QuickBooks gets the COMPANY's calendar day for a payment or invoice
 * instead of the UTC one (an evening payment on Sep 30 used to land in
 * October); the floor is what makes "will retry" the reconciler's own rule.
 * Null when it could not be read — the screen then uses the floor constant,
 * the earliest the real floor can be.
 */
/** Sent when the device cannot name its zone. qbo-sync refuses to store a zone
 *  Intl does not know (and this one fails its pattern too), yet still answers
 *  with the sweep floor — so an unreadable zone never overwrites a real one
 *  with a guessed 'UTC'. */
const QBO_UNKNOWN_TIME_ZONE = '-';

async function registerQboConnection(): Promise<{ sweepFloor: string | null }> {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { timeZone = ''; }
  const { data, error } = await supabase.functions.invoke<{ success?: boolean; sweepFloor?: string }>('qbo-sync', {
    body: { kind: 'connection', op: 'upsert', objectId: timeZone || QBO_UNKNOWN_TIME_ZONE },
  });
  // THROW, don't resolve {sweepFloor:null}: a resolved failure was cached for
  // the 10-minute staleTime, so the visit where he reconnects (the server
  // answers 409 while the connection is reauth_required) never registered
  // the zone. A thrown failure is retried on the next mount / status change.
  if (error || !data?.success) throw new Error(error?.message ?? 'QuickBooks connection not registered');
  return { sweepFloor: typeof data.sweepFloor === 'string' ? data.sweepFloor : null };
}

/** Why the status check failed, in his words (#103). Never "not connected". */
function qboUnknownReasonText(reason: QboStatus['reason']): string {
  if (reason === 'offline') return 'MAGE couldn\u2019t reach the server \u2014 check your signal and try again. Your QuickBooks connection is not affected.';
  if (reason === 'tier') return 'MAGE\u2019s server doesn\u2019t show a Business plan on your account, so it can\u2019t read the QuickBooks connection. If you just upgraded, try again in a minute; otherwise email help@mageid.app.';
  return 'The server couldn\u2019t answer just now. Try again in a minute \u2014 your QuickBooks connection is not affected.';
}

export default function QboSetupScreen() {
  // Client-side tier gate BEFORE the OAuth browser can open. The server
  // (qbo-connect-start) already requires Business/Enterprise via
  // requireTier(['business','enterprise'], 'qbo_connect'); without this
  // check a Free/Pro user reads the full sell-hero, taps "Connect
  // QuickBooks," completes Intuit OAuth, and only then hits an opaque
  // server rejection. Show the paywall up front so the requirement is
  // honest before they commit. There is no 'quickbooks_sync' FeatureKey
  // (removed in a prior audit), so we gate on the Business tier bucket
  // directly — which mirrors the server's allowed-tier list.
  const router = useRouter();
  const { isBusinessOrAbove } = useTierAccess();
  if (!isBusinessOrAbove) {
    return (
      <Paywall
        visible={true}
        feature="QuickBooks Sync"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <QboSetupScreenInner />;
}

function QboSetupScreenInner() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // Staged cost-line count for the review entry badge (F6). Read-only,
  // RLS-scoped; 5-min stale via the shared hook.
  const { pendingCount } = useQboCostLines();
  const { user } = useAuth();
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // Registered only while the connection is 'connected' (qbo-sync answers 409
  // otherwise) and keyed on that status, so reconnecting on this screen
  // registers the zone in the same visit instead of 10 minutes later.
  const qboConnected = status?.status === 'connected';
  const connectionQuery = useQuery({
    queryKey: ['qbo-setup-connection', user?.id ?? 'anon', qboConnected ? 'connected' : 'not-connected'],
    queryFn: registerQboConnection,
    enabled: !!user?.id && qboConnected,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const sweepFloor = connectionQuery.data?.sweepFloor ?? QBO_PAYMENT_SWEEP_FLOOR;
  const ledgerQuery = useQuery({
    queryKey: ['qbo-setup-ledger', user?.id ?? 'anon'],
    queryFn: () => fetchQboLedgerRows(user!.id),
    enabled: !!user?.id,
  });
  const ledgerRows = ledgerQuery.data;
  const unsyncedPayments = useMemo(() => (ledgerRows ? paymentsNotInQuickBooks(ledgerRows) : null), [ledgerRows]);
  const stuckPayments = useMemo(() => (ledgerRows ? stuckQboPayments(ledgerRows, sweepFloor) : []), [ledgerRows, sweepFloor]);
  const reversals = useMemo(() => (ledgerRows ? reversalsNotInQuickBooks(ledgerRows) : []), [ledgerRows]);
  const closedWithoutPayment = useMemo(() => (ledgerRows ? invoicesClosedWithoutPayment(ledgerRows) : { open: 0, paidInMage: 0, refundGapPaid: 0 }), [ledgerRows]);
  // The GC's "I recorded it in QuickBooks" on a refund of a payment MAGE had
  // already sent. Server-side, on a fresh read by entry id (qbo-sync kind
  // 'reversal'); needs a connection — offline it says so instead of pretending.
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const onAckReversal = useCallback(async (line: QboReversalLine) => {
    if (ackBusy) return;
    setAckBusy(line.key);
    try {
      const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>('qbo-sync', {
        // listedAmount: the open amount this line showed — the server stamps
        // that, so a refund that grew since the list stays listed.
        body: { kind: 'reversal', op: 'upsert', objectId: `${line.invoiceId}::${line.entryId}`, listedAmount: line.amount },
      });
      if (error || !data?.success) {
        showAlert('Not saved', `${data?.error ?? error?.message ?? 'MAGE could not reach the server.'} Check your connection and try again — the refund stays listed until this is saved.`);
        return;
      }
      await ledgerQuery.refetch();
    } finally {
      setAckBusy(null);
    }
  }, [ackBusy, ledgerQuery]);
  const refetchLedger = ledgerQuery.refetch;
  const [busy, setBusy] = useState(false);
  // Briefly show the animated celebration when the status transitions from
  // not-connected to connected during this screen visit. Doesn't fire on
  // already-connected screen reloads (we'd see the same green check every
  // time, which would feel like dunking on the user).
  const [celebrate, setCelebrate] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  // Audit #103: a failed status check ('unknown') is not an answer about the
  // connection. Within this visit the last GOOD answer stays on screen (so a
  // connected GC keeps his payment-gap cards when one refresh drops) and the
  // failure is shown beside it; with no good answer yet the screen shows the
  // failure card — never the Connect pitch, which would start a second OAuth
  // over a live connection.
  const [checkFailed, setCheckFailed] = useState<QboStatus | null>(null);
  const applyStatus = useCallback((s: QboStatus) => {
    if (s.status === 'unknown') {
      setCheckFailed(s);
      setStatus((prev) => (prev && prev.status !== 'unknown' ? prev : s));
      return;
    }
    setCheckFailed(null);
    setStatus(s);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    applyStatus(await fetchQboStatus());
    setLoading(false);
    void refetchLedger();
  }, [refetchLedger, applyStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Detect "just connected" moment from polling.
  useEffect(() => {
    const cur = status?.status ?? null;
    // An 'unknown' check leaves the ref alone: unknown -> connected is the
    // same connection read again, not a new one, and must not celebrate.
    if (cur === 'unknown') return;
    if (cur === 'connected' && prevStatusRef.current && prevStatusRef.current !== 'connected') {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 2800);
      prevStatusRef.current = cur;
      return () => clearTimeout(t);
    }
    prevStatusRef.current = cur;
  }, [status?.status]);

  const onConnect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const r = await connectQuickBooks();
    setBusy(false);
    if (!r.ok) {
      showAlert('Connect failed', r.error ?? 'Try again.');
      return;
    }
    // Server write happens AFTER browser closes. Poll briefly.
    for (let i = 0; i < 5; i++) {
      await new Promise(res => setTimeout(res, 1000));
      const s = await fetchQboStatus();
      // A failed check mid-poll says nothing — keep polling (#103).
      if (s.status === 'unknown') continue;
      if (s.status === 'connected' || s.status === 'reauth_required' || s.status === 'error') {
        applyStatus(s);
        return;
      }
    }
    await refresh();
  }, [busy, refresh, applyStatus]);

  const onRefreshStatus = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await refresh();
    setBusy(false);
  }, [busy, refresh]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back"><ChevronLeft size={22} color={colors.text} strokeWidth={1.75} /></TouchableOpacity>
        <Text style={styles.title}>QuickBooks</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {checkFailed && status && status.status !== 'unknown' && !loading ? (
          // A later check failed; the card below is the last good answer.
          <View style={[styles.card, styles.cardWarn, { marginBottom: 12 }]} testID="qbo-status-stale">
            <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.cardSub}>{qboUnknownReasonText(checkFailed.reason)} Showing what MAGE last read on this screen.</Text>
            <Button
              label={busy ? 'Checking…' : 'Retry'}
              onPress={() => { void onRefreshStatus(); }}
              variant="secondary"
              size="sm"
              disabled={busy}
              style={{ marginTop: 6, alignSelf: 'flex-start' }}
              testID="qbo-status-stale-retry"
            />
          </View>
        ) : null}
        {loading ? <ActivityIndicator color={colors.accent} /> :
          status?.status === 'unknown' ? (
            // #103: the check failed and there is no good answer yet. Say so,
            // offer Retry, and do NOT offer Connect — he may well be connected.
            <View style={[styles.card, styles.cardWarn]} testID="qbo-status-unknown">
              <AlertTriangle size={20} color={colors.warningLabel} strokeWidth={1.75} />
              <Text style={styles.cardTitle}>Couldn&apos;t check your QuickBooks connection</Text>
              <Text style={styles.cardSub}>{qboUnknownReasonText(status.reason)}</Text>
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={onRefreshStatus} testID="qbo-status-retry" accessibilityRole="button">
                <RefreshCw size={16} color="#FFFFFF" strokeWidth={1.75} />
                <Text style={styles.primaryText}>{busy ? 'Checking…' : 'Retry'}</Text>
              </TouchableOpacity>
            </View>
          ) :
          (!status || status.status === 'disconnected') ? (
            <>
              {/* Hero */}
              <View style={styles.hero}>
                <View style={styles.heroBadge}>
                  <View style={styles.qboMark}><Text style={styles.qboMarkText}>qb</Text></View>
                  <Text style={styles.heroPill}>QUICKBOOKS ONLINE</Text>
                </View>
                <Text style={styles.heroTitle}>Live 2-way sync with QuickBooks</Text>
                <Text style={styles.heroSub}>
                  Stop double-entering invoices. MAGE pushes new customers, invoices, items, and the payments you record to your books as you save them. Payments clients make through your Pay link, and anything that failed to push, go over on the next background reconcile (every 30 minutes) — and QuickBooks-side payments come back the same way.
                </Text>
                <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={onConnect} testID="qbo-connect">
                  <ExternalLink size={16} color="#FFFFFF" strokeWidth={1.75} />
                  <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Connect QuickBooks'}</Text>
                </TouchableOpacity>
                <Text style={styles.heroHint}>One-tap OAuth · about 30 seconds</Text>
              </View>

              {/* What gets synced */}
              <Text style={styles.sectionLabel}>What gets synced</Text>
              <View style={styles.syncList}>
                <SyncRow Icon={Users}    title="Customers"  sub="Each MAGE project becomes a QuickBooks Customer" styles={styles} colors={colors} />
                <SyncRow Icon={Package}  title="Items"      sub="Estimate line items become Service items in QBO" styles={styles} colors={colors} />
                <SyncRow Icon={FileText} title="Invoices"   sub="MAGE invoices appear with line-item detail" styles={styles} colors={colors} />
                <SyncRow Icon={DollarSign} title="Payments" sub="Two-way — recorded and Pay-link payments go to QuickBooks; payments entered in QuickBooks come back" styles={styles} colors={colors} />
              </View>

              {/* How it works */}
              <Text style={styles.sectionLabel}>How it works</Text>
              <View style={styles.stepsCard}>
                <StepRow num={1} title="Connect once"    sub="Sign in to Intuit, pick your QuickBooks company, approve access. We never see your password." styles={styles} colors={colors} last={false} />
                <StepRow num={2} title="Work in MAGE"    sub="Create projects and invoices like you normally would. Every save pushes to QuickBooks behind the scenes." styles={styles} colors={colors} last={false} />
                <StepRow num={3} title="Reconcile auto"  sub="A background job runs every 30 minutes: it sends Pay-link payments, retries anything that failed, and brings QBO-side payments back to MAGE." styles={styles} colors={colors} last={true} />
              </View>

              {/* Trust footer */}
              <View style={styles.trustRow}>
                <Shield size={14} color={colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.trustText}>OAuth 2.0 via Intuit · MAGE never stores your QuickBooks password</Text>
              </View>
            </>
          ) : status.status === 'reauth_required' ? (
            <View style={[styles.card, styles.cardWarn]}>
              <AlertTriangle size={20} color={colors.danger} strokeWidth={1.75} />
              <Text style={styles.cardTitle}>Reconnect QuickBooks</Text>
              <Text style={styles.cardSub}>Your QuickBooks session expired. Tap to reconnect — your existing links to QBO records will be preserved.</Text>
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={onConnect} disabled={busy} testID="qbo-connect">
                <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Reconnect'}</Text>
              </TouchableOpacity>
            </View>
          ) : status.status === 'error' || status.status === 'connecting' ? (
            <View style={[styles.card, styles.cardWarn]}>
              <AlertTriangle size={20} color={colors.danger} strokeWidth={1.75} />
              <Text style={styles.cardTitle}>{status.status === 'connecting' ? 'Connecting…' : 'Connection Error'}</Text>
              <Text style={styles.cardSub}>{status.status === 'connecting'
                ? 'OAuth in progress. Come back in a moment.'
                : 'Something went wrong with your QuickBooks connection. Try reconnecting.'}</Text>
              {status.status === 'error' && (
                <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={onConnect} testID="qbo-connect">
                  <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Retry'}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {celebrate ? (
                <View style={styles.celebrateHero}>
                  <QboSuccessCheckmark size={88} color={colors.success} />
                  <Text style={styles.celebrateTitle}>Connected!</Text>
                  <Text style={styles.celebrateSub}>
                    {status.companyName ? `MAGE is now linked to ${status.companyName}.` : 'MAGE is now linked to your QuickBooks Online account.'}
                  </Text>
                </View>
              ) : null}
              <View style={styles.card}>
                <View style={styles.row}><CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} /><Text style={styles.cardTitle}>Connected · {status.companyName ?? 'QuickBooks Online'}</Text></View>
                <Text style={styles.cardSub}>Realm {status.realmId} · {status.environment}</Text>
                {/* last_sync_at is the invoice-pull CURSOR (nextInvoicePullCursor):
                    5 minutes behind the run, and during a first backfill the
                    newest change read so far — possibly years back. It is
                    labelled as what it is, not as when the last run happened. */}
                {status.lastSyncAt ? <Text style={styles.cardSub}>QuickBooks changes read up to: {new Date(status.lastSyncAt).toLocaleString()}</Text> : null}
              </View>
              <View style={styles.statsRow}>
                <Stat label="Synced" value={status.counts?.synced ?? 0} good styles={styles} />
                <Stat label="Pending" value={status.counts?.pending ?? 0} styles={styles} />
                <Stat label="Errors" value={status.counts?.error ?? 0} bad styles={styles} />
              </View>
              {/* Why the books can differ from MAGE (audit round 2, #15). The
                  tiles above count INVOICES; a payment that has not reached
                  QuickBooks used to leave no trace anywhere, so the screen read
                  "connected" while the money sat as open A/R in the books. */}
              <View style={styles.card} testID="qbo-payments-unsynced">
                {unsyncedPayments === null ? (
                  // Not counted yet, or the read failed: say so. Never the
                  // reassuring check on a number we do not have.
                  <Text style={styles.cardSub}>
                    {ledgerQuery.isError
                      ? 'Could not check payments against QuickBooks right now. Tap Refresh status below to try again.'
                      : 'Checking payments against QuickBooks…'}
                  </Text>
                ) : (
                  <>
                    <View style={styles.row}>
                      {/* The green check only when BOTH counts are zero: a payment
                          MAGE sent and Stripe then refunded is "in QuickBooks"
                          and wrong there (audit #97). */}
                      {unsyncedPayments > 0 || reversals.length > 0
                        ? <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
                        : <CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} />}
                      <Text style={[styles.cardTitle, { flex: 1 }]}>
                        {unsyncedPayments > 0
                          ? `${unsyncedPayments} payment${unsyncedPayments === 1 ? '' : 's'} not in QuickBooks yet`
                          : reversals.length > 0
                            ? `${reversals.length} refund${reversals.length === 1 ? '' : 's'} not recorded in QuickBooks`
                            : 'Every payment on a synced invoice is in QuickBooks'}
                      </Text>
                    </View>
                    {unsyncedPayments > 0 ? (
                      <Text style={styles.cardSub}>
                        New Pay-link payments and failed pushes are tried again on the next reconcile (every 30 minutes), up to 5 times. A payment MAGE refused or stopped trying is listed below with the reason, and is not sent while that holds — match it by hand in QuickBooks. Payments from before automatic sending began are not sent either — your bookkeeper may already have entered them.
                      </Text>
                    ) : null}
                    {stuckPayments.map((p) => (
                      <View key={p.key} style={{ marginTop: 10 }} testID="qbo-stuck-payment">
                        <Text style={styles.cardTitle}>
                          {`${p.invoiceNumber != null ? `Invoice #${p.invoiceNumber}` : 'Invoice'} · $${p.amount.toFixed(2)} · `}
                          {p.state === 'reversed' ? 'refunded — record the net in QuickBooks by hand'
                            : p.state === 'stopped' ? 'stopped trying — match by hand'
                            : p.state === 'refused' ? 'not sent — match by hand'
                            : p.state === 'not-swept' ? 'from before automatic sending — match by hand'
                            : 'will retry next reconcile'}
                        </Text>
                        <Text style={styles.cardSub}>{p.reason}</Text>
                      </View>
                    ))}
                    {reversals.map((r) => (
                      <View key={r.key} style={{ marginTop: 10 }} testID="qbo-reversal-not-recorded">
                        <Text style={styles.cardTitle}>
                          {`${r.invoiceNumber != null ? `Invoice #${r.invoiceNumber}` : 'Invoice'} · −$${r.amount.toFixed(2)} · ${r.kind === 'dispute' ? 'charged back' : 'refunded'} after it was sent to QuickBooks`}
                        </Text>
                        <Text style={styles.cardSub}>
                          {`QuickBooks still counts this money (its payment ${r.paymentQboId}). Record a refund receipt there, or edit that payment — MAGE does not do it for you, because how to book it is your bookkeeper's call.`}
                        </Text>
                        <Button
                          label={ackBusy === r.key ? 'Saving…' : 'I recorded it in QuickBooks'}
                          onPress={() => { void onAckReversal(r); }}
                          variant="secondary"
                          size="sm"
                          loading={ackBusy === r.key}
                          disabled={ackBusy !== null}
                          style={{ marginTop: 6, alignSelf: 'flex-start' }}
                          testID="qbo-reversal-ack"
                        />
                      </View>
                    ))}
                  </>
                )}
              </View>
              {closedWithoutPayment.open > 0 ? (
                <View style={[styles.card, styles.cardWarn]} testID="qbo-closed-without-payment">
                  <View style={styles.row}>
                    <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
                    <Text style={[styles.cardTitle, { flex: 1 }]}>
                      {`${closedWithoutPayment.open} invoice${closedWithoutPayment.open === 1 ? '' : 's'} closed in QuickBooks without a payment`}
                    </Text>
                  </View>
                  {/* Never tells him to record the payment in MAGE first: that pushed the money
                      into QuickBooks a second time as unapplied credit (audit
                      #10). The invoice screen shows each one's own reason. */}
                  <Text style={styles.cardSub}>
                    QuickBooks shows these paid, but not with money MAGE can count — a credit memo, journal entry, write-off, a void, or a refunded payment it still carries. MAGE still shows them open and has paused automatic reminders to the client. Check each invoice in QuickBooks; if the client really paid, fix it there first (reverse the credit memo or journal entry), then record the payment in MAGE.
                  </Text>
                </View>
              ) : null}
              {closedWithoutPayment.paidInMage > 0 ? (
                <View style={[styles.card, styles.cardWarn]} testID="qbo-closed-paid-in-mage">
                  <View style={styles.row}>
                    <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
                    <Text style={[styles.cardTitle, { flex: 1 }]}>
                      {`${closedWithoutPayment.paidInMage} invoice${closedWithoutPayment.paidInMage === 1 ? '' : 's'} paid in MAGE, closed a different way in QuickBooks`}
                    </Text>
                  </View>
                  <Text style={styles.cardSub}>
                    MAGE has the payment; QuickBooks closed the invoice with a credit, a journal entry or a void. The two books disagree on how it was settled — reconcile it by hand in QuickBooks. MAGE did not send the payment there, so it is not counted twice.
                  </Text>
                </View>
              ) : null}
              {closedWithoutPayment.refundGapPaid > 0 ? (
                <View style={[styles.card, styles.cardWarn]} testID="qbo-closed-refund-gap-paid">
                  <View style={styles.row}>
                    <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
                    <Text style={[styles.cardTitle, { flex: 1 }]}>
                      {`${closedWithoutPayment.refundGapPaid} invoice${closedWithoutPayment.refundGapPaid === 1 ? '' : 's'} paid again in MAGE after a refund`}
                    </Text>
                  </View>
                  {/* Not the credit/void card: here QuickBooks closed the
                      invoice with a REAL payment, and MAGE was short only
                      because it recorded a refund or chargeback. */}
                  <Text style={styles.cardSub}>
                    QuickBooks closed these with a real payment. MAGE recorded part of that money as refunded or charged back, and now shows them paid again, so both books say paid. Check in QuickBooks that it does not still carry the refunded money as well. This stays listed until QuickBooks next changes the invoice, because MAGE only re-reads invoices QuickBooks has changed.
                  </Text>
                </View>
              ) : null}

              {/* Cost review entry (F6): purchases/bills pulled from QBO wait
                  in a confirm queue — nothing reaches job costs silently. */}
              <TouchableOpacity
                style={styles.reviewRow}
                onPress={() => router.push('/qbo-review' as never)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={pendingCount > 0 ? `Review ${pendingCount} QuickBooks costs` : 'Review QuickBooks costs'}
                testID="qbo-review-entry"
              >
                <View style={styles.syncIcon}><Receipt size={18} color={colors.accent} strokeWidth={1.75} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.syncTitle}>Cost review</Text>
                  <Text style={styles.syncSub}>
                    {pendingCount > 0
                      ? `${pendingCount} purchase${pendingCount === 1 ? '' : 's'}/bill${pendingCount === 1 ? '' : 's'} from QuickBooks waiting for your confirm`
                      : 'Purchases & bills from QuickBooks — confirm to file into job costs'}
                  </Text>
                </View>
                {pendingCount > 0 && (
                  <View style={styles.reviewBadge}>
                    <Text style={styles.reviewBadgeText}>{pendingCount}</Text>
                  </View>
                )}
                <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={onRefreshStatus} disabled={busy} testID="qbo-refresh-status">
                <RefreshCw size={16} color="#FFFFFF" strokeWidth={1.75} />
                <Text style={styles.primaryText}>{busy ? 'Refreshing…' : 'Refresh status'}</Text>
              </TouchableOpacity>
            </>
          )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, good, bad, styles }: { label: string; value: number; good?: boolean; bad?: boolean; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[styles.stat, good && styles.statGood, bad && styles.statBad]} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SyncRow({ Icon, title, sub, styles, colors }: { Icon: React.ComponentType<{ size?: number; color?: string }>; title: string; sub: string; styles: ReturnType<typeof makeStyles>; colors: ThemeColors }) {
  return (
    <View style={styles.syncRow}>
      <View style={styles.syncIcon}><Icon size={18} color={colors.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.syncTitle}>{title}</Text>
        <Text style={styles.syncSub}>{sub}</Text>
      </View>
    </View>
  );
}

function StepRow({ num, title, sub, last, styles, colors }: { num: number; title: string; sub: string; last: boolean; styles: ReturnType<typeof makeStyles>; colors: ThemeColors }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNumWrap}>
        <View style={styles.stepNumCircle}><Text style={styles.stepNumText}>{num}</Text></View>
        {!last ? <View style={styles.stepLine} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line },
  backBtn: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  title: { fontSize: 17, fontWeight: '800' as const, color: t.text },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 16, marginBottom: 12, gap: 6 },
  cardWarn: { borderWidth: 1, borderColor: t.danger },
  cardTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },
  cardSub: { fontSize: Type.subhead.fontSize, color: t.textMuted },
  primary: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  statsRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 12, alignItems: 'center' as const },
  statGood: { borderLeftWidth: 3, borderLeftColor: t.success },
  statBad: { borderLeftWidth: 3, borderLeftColor: t.danger },
  statVal: { fontSize: 22, fontWeight: '800' as const, color: t.text },
  statLabel: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  // Cost-review entry (F6)
  reviewRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12,
  },
  reviewBadge: {
    minWidth: 22, height: 22, borderRadius: Tokens.radius.full,
    paddingHorizontal: 6,
    backgroundColor: t.accentFill,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  reviewBadgeText: { color: '#FFFFFF', fontSize: Type.caption2.fontSize, fontWeight: '800' as const },

  // Disconnected-state premium UI
  hero: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: 'center' as const,
    gap: 10,
  },
  heroBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 4,
  },
  qboMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#2CA01C', // Intuit QuickBooks green
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  qboMarkText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900' as const,
    letterSpacing: -0.5,
  },
  heroPill: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: t.textMuted,
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: t.text,
    textAlign: 'center' as const,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  heroSub: {
    fontSize: Type.subhead.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
    lineHeight: 21,
    paddingHorizontal: 4,
  },
  heroHint: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 6,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: t.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },

  syncList: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 18,
    overflow: 'hidden' as const,
  },
  syncRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  syncIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  syncTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 1,
  },
  syncSub: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 18,
  },

  stepsCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    padding: 16,
    marginBottom: 18,
  },
  stepRow: {
    flexDirection: 'row' as const,
    gap: 12,
    alignItems: 'flex-start' as const,
  },
  stepNumWrap: {
    alignItems: 'center' as const,
    width: 28,
  },
  stepNumCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.accentFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepNumText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800' as const,
  },
  stepLine: {
    flex: 1,
    width: 2,
    backgroundColor: t.line,
    marginTop: 4,
    marginBottom: 4,
    minHeight: 18,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 2,
  },
  stepSub: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 19,
  },

  trustRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 12,
  },
  trustText: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
    flexShrink: 1,
  },

  // Just-connected celebration (transient, fades after ~2.8s).
  celebrateHero: {
    alignItems: 'center' as const,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 12,
  },
  celebrateTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.5,
  },
  celebrateSub: {
    fontSize: Type.subhead.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
    lineHeight: 21,
    paddingHorizontal: 16,
  },
});
