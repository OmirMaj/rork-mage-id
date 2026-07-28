// /shared-estimate?t=<token>
//
// Read-only client proposal shared via URL. Same tokenized magic-link pattern
// as /shared-photos and /shared-schedule — the client-safe payload is base64'd
// into the URL, no backend, no login. The token is the credential.
//
// The payload (utils/clientEstimateShareToken) is built only from the client
// view, so this screen structurally cannot display costs, markups, or margin.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Check, X as XIcon } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { decodeClientEstimateToken, type ClientEstimateSharePayload } from '@/utils/clientEstimateShareToken';

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export default function SharedEstimateScreen() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { t } = useLocalSearchParams<{ t?: string }>();

  const payload: ClientEstimateSharePayload | null = useMemo(
    () => (t ? decodeClientEstimateToken(String(t)) : null),
    [t],
  );

  if (!payload) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ title: 'Proposal' }} />
        <View style={styles.errWrap}>
          <AlertCircle size={40} color="#6C7480" strokeWidth={1.5} />
          <Text style={styles.errTitle}>Proposal not found</Text>
          <Text style={styles.errDesc}>This link is invalid or has expired. Ask your contractor to resend it.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: payload.n || 'Proposal' }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40, maxWidth: 620, alignSelf: 'center', width: '100%' }} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>PROPOSAL</Text>
        <Text style={styles.project}>{payload.n}</Text>
        {(payload.cl || payload.gc) && (
          <Text style={styles.prep}>
            {payload.cl ? `Prepared for ${payload.cl}` : ''}{payload.cl && payload.gc ? ' · ' : ''}{payload.gc ? `by ${payload.gc}` : ''}
          </Text>
        )}

        <Text style={styles.totalLabel}>PROJECT TOTAL</Text>
        <Text style={styles.total}>{money(payload.total)}</Text>
        {!!payload.valid && <Text style={styles.valid}>Fixed-price proposal · valid through {payload.valid}</Text>}

        <Text style={styles.section}>SCOPE OF WORK</Text>
        <View style={styles.card}>
          {payload.scope.map((g, i) => (
            <View key={g.k} style={[styles.row, i < payload.scope.length - 1 && styles.rowBorder]}>
              <Text style={styles.rowName} numberOfLines={1}>{g.l}</Text>
              <Text style={styles.rowAmt}>{money(g.a)}</Text>
            </View>
          ))}
        </View>

        {!!payload.allow?.length && (
          <>
            <Text style={styles.section}>ALLOWANCES INCLUDED</Text>
            <View style={styles.card}>
              {payload.allow.map((a, i) => (
                <View key={`${a.n}-${i}`} style={[styles.row, i < payload.allow!.length - 1 && styles.rowBorder]}>
                  <Text style={styles.rowName} numberOfLines={1}>{a.n}</Text>
                  <Text style={styles.rowAmtMuted}>{money(a.a)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {(!!payload.inc?.length || !!payload.exc?.length) && (
          <View style={styles.inclGrid}>
            {!!payload.inc?.length && (
              <View style={styles.inclCol}>
                <Text style={styles.inclHeadIn}>INCLUDED</Text>
                {payload.inc.map((s, i) => (
                  <View key={i} style={styles.inclRow}><Check size={12} color="#5FBF6B" strokeWidth={2.5} /><Text style={styles.inclText}>{s}</Text></View>
                ))}
              </View>
            )}
            {!!payload.exc?.length && (
              <View style={styles.inclCol}>
                <Text style={styles.inclHeadEx}>NOT INCLUDED</Text>
                {payload.exc.map((s, i) => (
                  <View key={i} style={styles.inclRow}><XIcon size={12} color="#6C7480" strokeWidth={2.5} /><Text style={styles.inclText}>{s}</Text></View>
                ))}
              </View>
            )}
          </View>
        )}

        <Text style={styles.footer}>{payload.gc ? `${payload.gc} · ` : ''}Powered by MAGE ID</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  errWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  errDesc: { fontSize: Type.subhead.fontSize, color: t.textSecondary, textAlign: 'center', maxWidth: 300, lineHeight: 21 },

  eyebrow: { fontSize: 10.5, letterSpacing: 2, color: t.textMuted, fontWeight: '700', marginBottom: 8 },
  project: { fontSize: 22, fontWeight: '800', color: t.text, letterSpacing: -0.4 },
  prep: { fontSize: 12.5, color: t.textSecondary, marginTop: 6 },
  totalLabel: { fontSize: 10.5, letterSpacing: 1, color: t.textMuted, fontWeight: '700', marginTop: 28, marginBottom: 5 },
  total: { fontSize: 46, fontWeight: '800', color: t.text, letterSpacing: -1.2 },
  valid: { fontSize: 12, color: t.textSecondary, marginTop: 9 },

  section: { fontSize: 10.5, letterSpacing: 1.2, color: t.textMuted, fontWeight: '800', marginTop: 26, marginBottom: 9 },
  card: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 15, paddingVertical: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: t.line },
  rowName: { fontSize: 14, color: t.text, fontWeight: '600', flex: 1 },
  rowAmt: { fontSize: 14, color: t.text, fontWeight: '700' },
  rowAmtMuted: { fontSize: 13, color: t.textSecondary, fontWeight: '600' },

  inclGrid: { flexDirection: 'row', gap: 10, marginTop: 8 },
  inclCol: { flex: 1, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.card, padding: 14 },
  inclHeadIn: { fontSize: 10.5, letterSpacing: 0.5, color: '#5FBF6B', fontWeight: '800', marginBottom: 10 },
  inclHeadEx: { fontSize: 10.5, letterSpacing: 0.5, color: t.textSecondary, fontWeight: '800', marginBottom: 10 },
  inclRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 4 },
  inclText: { fontSize: 12, color: t.textSecondary, flex: 1, lineHeight: 17 },

  footer: { fontSize: 11, color: t.textMuted, textAlign: 'center', marginTop: 32 },
});
