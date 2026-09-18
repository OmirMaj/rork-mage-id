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
function invoicesClosedWithoutPayment(invoices: readonly { qboError?: string | null }[]): number {
  return invoices.filter((i) => typeof i.qboError === 'string' && i.qboError.startsWith(QBO_CLOSED_WITHOUT_PAYMENT_PREFIX)).length;
}

// Twin of MAX_PAYMENT_PUSH_ATTEMPTS in _shared/paymentLedger.ts (pinned equal).
const QBO_PAYMENT_PUSH_MAX_ATTEMPTS = 5;
/** One payment that did not reach QuickBooks, with the reason the reconciler
 *  recorded on it (entry.qboError). The count alone left the GC with nothing
 *  to act on, and the card's copy promised a retry the reconciler will not
 *  make for a refused or exhausted payment. */
interface StuckQboPayment {
  key: string;
  invoiceNumber: number | string | null;
  amount: number;
  reason: string;
  /** 'stopped' = out of attempts; 'refused' = the sweep will not send it while
   *  QuickBooks shows less open (a likely duplicate); 'retrying' = it will. */
  state: 'stopped' | 'refused' | 'retrying';
}
function stuckQboPayments(
  invoices: readonly { number?: number | string | null; qboId?: string; payments?: unknown }[],
): StuckQboPayment[] {
  const out: StuckQboPayment[] = [];
  for (const inv of invoices) {
    if (!inv.qboId || !Array.isArray(inv.payments)) continue;
    for (const raw of inv.payments as unknown[]) {
      const e = raw as { id?: unknown; amount?: unknown; qboId?: unknown; qboError?: unknown; qboAttempts?: unknown; source?: unknown; method?: unknown; kind?: unknown } | null;
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || e.qboId) continue;
      if (typeof e.qboError !== 'string' || e.qboError === '') continue;
      if (e.source === 'qbo' || e.method === 'qbo' || e.kind === 'refund' || e.kind === 'dispute') continue;
      const amount = Number(e.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const attempts = Number(e.qboAttempts ?? 0);
      const state: StuckQboPayment['state'] = attempts >= QBO_PAYMENT_PUSH_MAX_ATTEMPTS ? 'stopped'
        : /^QuickBooks (shows only|already shows invoice)/.test(e.qboError) ? 'refused'
        : 'retrying';
      out.push({ key: `${String(inv.qboId)}:${e.id}`, invoiceNumber: inv.number ?? null, amount, reason: e.qboError, state });
    }
  }
  return out;
}
// --- END paymentsNotInQuickBooks ---

type QboLedgerRow = Pick<Invoice, 'qboId' | 'payments'> & { qboError?: string | null; number?: number | null };

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
      .select('id,number,qbo_id,payments,qbo_error')
      .eq('user_id', userId)
      .not('qbo_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { number: number | null; qbo_id: string | null; payments: unknown; qbo_error: string | null }[];
    for (const r of rows) {
      out.push({ qboId: r.qbo_id ?? undefined, payments: r.payments as Invoice['payments'], qboError: r.qbo_error, number: r.number });
    }
    if (rows.length < PAGE) return out;
  }
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
  const ledgerQuery = useQuery({
    queryKey: ['qbo-setup-ledger', user?.id ?? 'anon'],
    queryFn: () => fetchQboLedgerRows(user!.id),
    enabled: !!user?.id,
  });
  const ledgerRows = ledgerQuery.data;
  const unsyncedPayments = useMemo(() => (ledgerRows ? paymentsNotInQuickBooks(ledgerRows) : null), [ledgerRows]);
  const stuckPayments = useMemo(() => (ledgerRows ? stuckQboPayments(ledgerRows) : []), [ledgerRows]);
  const closedWithoutPayment = useMemo(() => (ledgerRows ? invoicesClosedWithoutPayment(ledgerRows) : 0), [ledgerRows]);
  const refetchLedger = ledgerQuery.refetch;
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Briefly show the animated celebration when the status transitions from
  // not-connected to connected during this screen visit. Doesn't fire on
  // already-connected screen reloads (we'd see the same green check every
  // time, which would feel like dunking on the user).
  const [celebrate, setCelebrate] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(await fetchQboStatus());
    setLoading(false);
    void refetchLedger();
  }, [refetchLedger]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Detect "just connected" moment from polling.
  useEffect(() => {
    const cur = status?.status ?? null;
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
      if (s.status === 'connected' || s.status === 'reauth_required' || s.status === 'error') {
        setStatus(s);
        return;
      }
    }
    await refresh();
  }, [busy, refresh]);

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
        {loading ? <ActivityIndicator color={colors.accent} /> :
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
                      {unsyncedPayments > 0
                        ? <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
                        : <CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} />}
                      <Text style={[styles.cardTitle, { flex: 1 }]}>
                        {unsyncedPayments > 0
                          ? `${unsyncedPayments} payment${unsyncedPayments === 1 ? '' : 's'} not in QuickBooks yet`
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
                          {p.state === 'stopped' ? 'stopped trying — match by hand'
                            : p.state === 'refused' ? 'not sent — match by hand'
                            : 'will retry next reconcile'}
                        </Text>
                        <Text style={styles.cardSub}>{p.reason}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
              {closedWithoutPayment > 0 ? (
                <View style={[styles.card, styles.cardWarn]} testID="qbo-closed-without-payment">
                  <View style={styles.row}>
                    <AlertTriangle size={18} color={colors.warningLabel} strokeWidth={1.75} />
                    <Text style={[styles.cardTitle, { flex: 1 }]}>
                      {`${closedWithoutPayment} invoice${closedWithoutPayment === 1 ? '' : 's'} closed in QuickBooks without a payment`}
                    </Text>
                  </View>
                  <Text style={styles.cardSub}>
                    QuickBooks cleared these with a credit memo, journal entry or write-off. MAGE still shows them open and has paused automatic reminders to the client. Record the payment in MAGE, or check the invoice in QuickBooks.
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
