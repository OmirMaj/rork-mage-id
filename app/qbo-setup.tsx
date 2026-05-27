import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw, Users, Package, FileText, DollarSign, Shield } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { connectQuickBooks, fetchQboStatus, type QboStatus } from '@/utils/qboSync';
import { QboSuccessCheckmark } from '@/components/QboSuccessCheckmark';

export default function QboSetupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
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
  }, []);

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
      Alert.alert('Connect failed', r.error ?? 'Try again.');
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back"><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>QuickBooks</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
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
                  Stop double-entering invoices. MAGE pushes new customers, invoices, items, and payments to your books in seconds — and pulls QuickBooks-side payments back automatically.
                </Text>
                <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={onConnect} testID="qbo-connect">
                  <ExternalLink size={16} color="#FFFFFF" />
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
                <SyncRow Icon={DollarSign} title="Payments" sub="Two-way — payments flow both directions automatically" styles={styles} colors={colors} />
              </View>

              {/* How it works */}
              <Text style={styles.sectionLabel}>How it works</Text>
              <View style={styles.stepsCard}>
                <StepRow num={1} title="Connect once"    sub="Sign in to Intuit, pick your QuickBooks company, approve access. We never see your password." styles={styles} colors={colors} last={false} />
                <StepRow num={2} title="Work in MAGE"    sub="Create projects and invoices like you normally would. Every save pushes to QuickBooks behind the scenes." styles={styles} colors={colors} last={false} />
                <StepRow num={3} title="Reconcile auto"  sub="A background job runs every 30 minutes to retry anything that failed and flow QBO-side payments back to MAGE." styles={styles} colors={colors} last={true} />
              </View>

              {/* Trust footer */}
              <View style={styles.trustRow}>
                <Shield size={14} color={colors.textMuted} />
                <Text style={styles.trustText}>OAuth 2.0 via Intuit · MAGE never stores your QuickBooks password</Text>
              </View>
            </>
          ) : status.status === 'reauth_required' ? (
            <View style={[styles.card, styles.cardWarn]}>
              <AlertTriangle size={20} color={colors.danger} />
              <Text style={styles.cardTitle}>Reconnect QuickBooks</Text>
              <Text style={styles.cardSub}>Your QuickBooks session expired. Tap to reconnect — your existing links to QBO records will be preserved.</Text>
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={onConnect} disabled={busy} testID="qbo-connect">
                <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Reconnect'}</Text>
              </TouchableOpacity>
            </View>
          ) : status.status === 'error' || status.status === 'connecting' ? (
            <View style={[styles.card, styles.cardWarn]}>
              <AlertTriangle size={20} color={colors.danger} />
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
                <View style={styles.row}><CheckCircle2 size={18} color={colors.success} /><Text style={styles.cardTitle}>Connected · {status.companyName ?? 'QuickBooks Online'}</Text></View>
                <Text style={styles.cardSub}>Realm {status.realmId} · {status.environment}</Text>
                {status.lastSyncAt ? <Text style={styles.cardSub}>Last reconcile: {new Date(status.lastSyncAt).toLocaleString()}</Text> : null}
              </View>
              <View style={styles.statsRow}>
                <Stat label="Synced" value={status.counts?.synced ?? 0} good styles={styles} />
                <Stat label="Pending" value={status.counts?.pending ?? 0} styles={styles} />
                <Stat label="Errors" value={status.counts?.error ?? 0} bad styles={styles} />
              </View>
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} onPress={onRefreshStatus} disabled={busy} testID="qbo-refresh-status">
                <RefreshCw size={16} color="#FFFFFF" />
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
  primary: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  statsRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 12, alignItems: 'center' as const },
  statGood: { borderLeftWidth: 3, borderLeftColor: t.success },
  statBad: { borderLeftWidth: 3, borderLeftColor: t.danger },
  statVal: { fontSize: 22, fontWeight: '800' as const, color: t.text },
  statLabel: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

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
    backgroundColor: t.accent,
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
