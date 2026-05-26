import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { connectQuickBooks, fetchQboStatus, type QboStatus } from '@/utils/qboSync';

export default function QboSetupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(await fetchQboStatus());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connect QuickBooks Online</Text>
              <Text style={styles.cardSub}>One-tap OAuth. Your invoices, payments, and customers will sync live from MAGE to QuickBooks.</Text>
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={onConnect} testID="qbo-connect">
                <ExternalLink size={16} color="#FFFFFF" />
                <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Connect QuickBooks'}</Text>
              </TouchableOpacity>
            </View>
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
});
