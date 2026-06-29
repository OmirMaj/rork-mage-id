import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, AlertTriangle, Clock, CheckCircle2, ChevronRight, Wallet, RefreshCw, Phone,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useProjects } from '@/contexts/ProjectContext';
import { predictInvoicePayments } from '@/utils/paymentPrediction';
import type { PaymentPredictionResult, InvoicePrediction } from '@/utils/paymentPrediction';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function formatMoney(n: number): string {
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

const RISK_COLOR: Record<InvoicePrediction['riskLevel'], string> = {
  low: '#2E7D44',
  medium: Colors.warning,
  high: '#C84038',
};

const RISK_LABEL: Record<InvoicePrediction['riskLevel'], string> = {
  low: 'On Track',
  medium: 'Watch',
  high: 'At Risk',
};

export default function PaymentPredictionsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId: scopeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices, getInvoicesForProject } = useProjects();

  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<PaymentPredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const relevantInvoices = useMemo(() => {
    if (scopeProjectId) return getInvoicesForProject(scopeProjectId);
    return invoices;
  }, [scopeProjectId, invoices, getInvoicesForProject]);

  const projectsById = useMemo(() => {
    const map: Record<string, Project> = {};
    projects.forEach(p => { map[p.id] = p; });
    return map;
  }, [projects]);

  const unpaidCount = useMemo(() => {
    return relevantInvoices.filter(i => {
      const retentionPending = Math.max(0, (i.retentionAmount ?? 0) - (i.retentionReleased ?? 0));
      const netPayable = Math.max(0, (i.totalDue ?? 0) - retentionPending);
      const out = Math.max(0, netPayable - (i.amountPaid ?? 0));
      return out > 0 && i.status !== 'draft';
    }).length;
  }, [relevantInvoices]);

  const totalOutstanding = useMemo(() => {
    return relevantInvoices.reduce((sum, i) => {
      const retentionPending = Math.max(0, (i.retentionAmount ?? 0) - (i.retentionReleased ?? 0));
      const netPayable = Math.max(0, (i.totalDue ?? 0) - retentionPending);
      const out = Math.max(0, netPayable - (i.amountPaid ?? 0));
      return sum + out;
    }, 0);
  }, [relevantInvoices]);

  const runForecast = useCallback(async () => {
    if (loading) return;
    if (unpaidCount === 0) {
      Alert.alert('All Caught Up', 'No unpaid invoices to forecast right now.');
      return;
    }
    setLoading(true);
    setError(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const r = await predictInvoicePayments(relevantInvoices, projectsById);
      setResult(r);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('[PaymentPredictions] Error:', err);
      setError(err?.message || 'Could not forecast payments.');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [loading, unpaidCount, relevantInvoices, projectsById]);

  const openInvoice = useCallback((invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    router.push({ pathname: '/invoice' as any, params: { projectId: inv.projectId, invoiceId } });
  }, [invoices, router]);

  const sortedPredictions = useMemo(() => {
    if (!result) return [];
    const order: Record<InvoicePrediction['riskLevel'], number> = { high: 0, medium: 1, low: 2 };
    return [...result.perInvoice].sort((a, b) => {
      const r = order[a.riskLevel] - order[b.riskLevel];
      if (r !== 0) return r;
      return b.outstandingAmount - a.outstandingAmount;
    });
  }, [result]);

  const scopeName = scopeProjectId ? (projectsById[scopeProjectId]?.name || 'This project') : 'All projects';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      testID="payment-predictions-screen"
    >
      <View style={styles.header}>
        <View style={styles.heroIcon}>
          <MageAIMark size={22} color={themeColors.accent} />
        </View>
        <Text style={styles.heroTitle}>Cash-Crunch Forecast</Text>
        <Text style={styles.heroSub}>{scopeName} • {unpaidCount} unpaid invoice{unpaidCount === 1 ? '' : 's'} • {formatMoney(totalOutstanding)} outstanding</Text>
      </View>

      {!result && !loading && (
        <View style={styles.introCard}>
          <Text style={styles.introHeadline}>Predict when each invoice will actually clear.</Text>
          <Text style={styles.introBody}>
            Mage AI analyzes due dates, client payment history, project status, and retention holds to forecast real inflows — so you know which invoices need a call today vs. which are safe to let ride.
          </Text>
          <View style={styles.featureRow}>
            <View style={styles.featureChip}><Clock size={12} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.featureText}>Per-invoice pay date</Text></View>
            <View style={styles.featureChip}><AlertTriangle size={12} color={Colors.warning} strokeWidth={1.75} /><Text style={styles.featureText}>Risk scoring</Text></View>
            <View style={styles.featureChip}><Phone size={12} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.featureText}>Action suggestions</Text></View>
          </View>
          <TouchableOpacity
            style={[styles.runBtn, unpaidCount === 0 && { opacity: 0.5 }]}
            onPress={runForecast}
            disabled={unpaidCount === 0}
            activeOpacity={0.85}
            testID="run-payment-forecast-btn"
          >
            <MageAIMark size={16} color="#FFF" />
            <Text style={styles.runBtnText}>Run Forecast</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={styles.loadingCard}>
          <ConstructionLoader size="lg" label={`Analyzing ${unpaidCount} invoice${unpaidCount === 1 ? '' : 's'}…`} />
          <Text style={styles.loadingSub}>Checking payment history, terms, and project status</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.errorCard}>
          <AlertTriangle size={18} color={themeColors.danger} strokeWidth={1.75} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={runForecast} activeOpacity={0.85}>
            <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {result && !loading && (
        <>
          <View style={styles.headlineCard}>
            <View style={styles.scoreRow}>
              <View style={[styles.scoreBubble, { backgroundColor: result.collectionRiskScore > 60 ? themeColors.danger + '18' : result.collectionRiskScore > 35 ? Colors.warning + '18' : themeColors.success + '18' }]}>
                <Text style={[styles.scoreNum, { color: result.collectionRiskScore > 60 ? themeColors.danger : result.collectionRiskScore > 35 ? Colors.warning : themeColors.success }]}>
                  {result.collectionRiskScore}
                </Text>
                <Text style={styles.scoreLabel}>Risk Score</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headlineText}>{result.headline}</Text>
                {result.topAction && (
                  <View style={styles.topActionWrap}>
                    <Phone size={12} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.topActionText}>{result.topAction}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Next 7 days</Text>
                <Text style={styles.metricValue}>{formatMoney(result.expected7dInflow)}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Next 14 days</Text>
                <Text style={styles.metricValue}>{formatMoney(result.expected14dInflow)}</Text>
              </View>
              <View style={styles.metricBox}>
                <Text style={styles.metricLabel}>Next 30 days</Text>
                <Text style={styles.metricValue}>{formatMoney(result.expected30dInflow)}</Text>
              </View>
              <View style={[styles.metricBox, { backgroundColor: themeColors.danger + '10' }]}>
                <Text style={[styles.metricLabel, { color: themeColors.danger }]}>At risk</Text>
                <Text style={[styles.metricValue, { color: themeColors.danger }]}>{formatMoney(result.atRiskAmount)}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.listHeading}>Per-Invoice Forecast</Text>
          {sortedPredictions.map(pred => {
            const color = RISK_COLOR[pred.riskLevel];
            return (
              <TouchableOpacity
                key={pred.invoiceId}
                style={[styles.invoiceCard, { borderLeftColor: color }]}
                onPress={() => openInvoice(pred.invoiceId)}
                activeOpacity={0.85}
                testID={`payment-prediction-card-${pred.invoiceId}`}
              >
                <View style={styles.invoiceHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.invoiceTitleRow}>
                      <Text style={styles.invoiceNumber}>Invoice #{pred.invoiceNumber}</Text>
                      <View style={[styles.riskPill, { backgroundColor: color + '18' }]}>
                        <Text style={[styles.riskPillText, { color }]}>{RISK_LABEL[pred.riskLevel]}</Text>
                      </View>
                    </View>
                    <Text style={styles.invoiceProject} numberOfLines={1}>{pred.projectName}</Text>
                  </View>
                  <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                </View>

                <View style={styles.invoiceMetrics}>
                  <View style={styles.invoiceMetricBox}>
                    <Text style={styles.invoiceMetricLabel}>Outstanding</Text>
                    <Text style={styles.invoiceMetricValue}>{formatMoney(pred.outstandingAmount)}</Text>
                  </View>
                  <View style={styles.invoiceMetricBox}>
                    <Text style={styles.invoiceMetricLabel}>Est. pay date</Text>
                    <Text style={styles.invoiceMetricValue}>{formatShortDate(pred.predictedPayDate)}</Text>
                    <Text style={styles.invoiceMetricSub}>in {pred.daysToPay}d</Text>
                  </View>
                  <View style={styles.invoiceMetricBox}>
                    <Text style={styles.invoiceMetricLabel}>On-time</Text>
                    <Text style={[styles.invoiceMetricValue, { color }]}>{pred.onTimeProbability}%</Text>
                  </View>
                </View>

                {pred.reasons.length > 0 && (
                  <View style={styles.reasonsBlock}>
                    {pred.reasons.map((r, idx) => (
                      <View key={idx} style={styles.reasonRow}>
                        <View style={[styles.reasonDot, { backgroundColor: color }]} />
                        <Text style={styles.reasonText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {pred.suggestedAction && (
                  <View style={styles.actionBlock}>
                    <MageAIMark size={11} color={themeColors.accent} />
                    <Text style={styles.actionText}>{pred.suggestedAction}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.rerunBtn} onPress={runForecast} activeOpacity={0.85} testID="rerun-forecast-btn">
            <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.rerunBtnText}>Re-run Forecast</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 6, alignItems: 'center' as const },
  heroIcon: { width: 44, height: 44, borderRadius: Tokens.radius.lg, backgroundColor: t.accent + '18', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 6 },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.4 },
  heroSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center' as const },

  introCard: { margin: 16, padding: 18, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, gap: 12 },
  introHeadline: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.2 },
  introBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  featureRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  featureChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.xs, backgroundColor: Colors.fillSecondary },
  featureText: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  runBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accent, marginTop: 4 },
  runBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFF' },

  loadingCard: { margin: 16, padding: 28, alignItems: 'center' as const, gap: 10, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line },
  loadingText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  loadingSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center' as const },

  errorCard: { margin: 16, padding: 16, backgroundColor: t.danger + '10', borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.danger + '30', gap: 10, alignItems: 'center' as const },
  errorText: { fontSize: Type.footnote.fontSize, color: t.danger, textAlign: 'center' as const },
  retryBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
  retryBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },

  headlineCard: { margin: 16, padding: 16, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, gap: 14 },
  scoreRow: { flexDirection: 'row' as const, gap: 14, alignItems: 'flex-start' as const },
  scoreBubble: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  scoreNum: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5 },
  scoreLabel: { fontSize: 9, color: t.textSecondary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4, marginTop: 2 },
  headlineText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text, lineHeight: 19 },
  topActionWrap: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line },
  topActionText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  metricsRow: { flexDirection: 'row' as const, gap: 8, flexWrap: 'wrap' as const },
  metricBox: { flex: 1, minWidth: '22%' as any, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: Colors.fillSecondary, gap: 3 },
  metricLabel: { fontSize: 10, color: t.textSecondary, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  metricValue: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.2 },

  listHeading: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginHorizontal: 20, marginTop: 8, marginBottom: 4 },

  invoiceCard: { marginHorizontal: 16, marginVertical: 6, padding: 14, backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, borderLeftWidth: 4, gap: 10 },
  invoiceHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  invoiceTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  invoiceNumber: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  invoiceProject: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },
  riskPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Tokens.radius.xs },
  riskPillText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  invoiceMetrics: { flexDirection: 'row' as const, gap: 8 },
  invoiceMetricBox: { flex: 1, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillSecondary, gap: 2 },
  invoiceMetricLabel: { fontSize: 9, color: t.textSecondary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  invoiceMetricValue: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  invoiceMetricSub: { fontSize: 10, color: t.textMuted, marginTop: 1 },
  reasonsBlock: { gap: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: t.line },
  reasonRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6 },
  reasonDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  reasonText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  actionBlock: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6, padding: 8, backgroundColor: t.accent + '0D', borderRadius: Tokens.radius.sm },
  actionText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '500' as const, lineHeight: 17 },

  rerunBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, marginHorizontal: 16, marginTop: 16, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
  rerunBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },
});
