// portfolio-margin.tsx — every active job's projected margin and risk, ranked.
//
// The per-project Living Estimate (app/living-estimate) and Margin Risk
// (app/margin-risk) answer "how's THIS job?" This is the portfolio roll-up the
// owner actually opens first: across every active project, which ones are
// bleeding — worst first — and what's the blended margin on the whole book.
//
// Pure aggregation over the engines already shipped (utils/livingEstimate +
// utils/marginRiskScore); no new math, no network. Tap a row to drill in.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, ShieldAlert, BellRing } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { computeLivingEstimate } from '@/utils/livingEstimate';
import { computeMarginRisk, type RiskBand } from '@/utils/marginRiskScore';
import {
  computeCurrentBaselines, computeAlerts, countActionable,
  MARGIN_ALERTS_BASELINE_KEY, type BaselineMap,
} from '@/utils/marginAlerts';
import { formatMoney } from '@/utils/jobCostEngine';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function colorForBand(band: RiskBand, t: ThemeColors): string {
  switch (band) {
    case 'low': return t.success;
    case 'moderate': return t.accent;
    case 'elevated': return t.accentHot;
    case 'high': return t.danger;
  }
}
const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

interface PortfolioRow {
  project: Project;
  projectedRevenue: number;
  projectedMargin: number;
  projectedMarginPct: number;
  erosionPoints: number;
  score: number;
  band: RiskBand;
}

export default function PortfolioMarginScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('portfolio_margin')) {
    return (
      <Paywall
        visible={true}
        feature="Portfolio Margin Board"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <PortfolioMarginInner />;
}

function PortfolioMarginInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, changeOrders, commitments, invoices } = useProjects();

  // Unread margin-alert count — what crossed since the user last acknowledged
  // in the alerts inbox. Surfaced as a tappable banner so the board doubles as
  // the entry point to triage.
  const [acknowledged, setAcknowledged] = useState<BaselineMap>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(MARGIN_ALERTS_BASELINE_KEY);
        if (alive && raw) setAcknowledged(JSON.parse(raw) as BaselineMap);
      } catch { /* first-sight */ }
    })();
    return () => { alive = false; };
  }, []);
  const unreadAlerts = useMemo(() => {
    const { baselines, names } = computeCurrentBaselines({ projects, changeOrders, commitments, invoices });
    return countActionable(computeAlerts(baselines, names, acknowledged));
  }, [projects, changeOrders, commitments, invoices, acknowledged]);

  const { rows, totalRevenue, totalMargin, blendedPct, atRisk } = useMemo(() => {
    const active = projects.filter(
      p => p.status === 'estimated' || p.status === 'in_progress',
    );
    const built: PortfolioRow[] = [];
    for (const project of active) {
      const le = computeLivingEstimate({ project, changeOrders, commitments, invoices });
      if (!le.hasMarginBasis) continue;
      const risk = computeMarginRisk({ project, changeOrders, commitments, invoices });
      built.push({
        project,
        projectedRevenue: le.projected.revenue,
        projectedMargin: le.projected.margin,
        projectedMarginPct: le.projected.marginPct,
        erosionPoints: le.marginErosionPoints,
        score: risk.score,
        band: risk.band,
      });
    }
    // Riskiest first; ties broken by larger erosion then bigger contract.
    built.sort(
      (a, b) =>
        b.score - a.score ||
        a.erosionPoints - b.erosionPoints ||
        b.projectedRevenue - a.projectedRevenue,
    );
    const totalRevenue = built.reduce((s, r) => s + r.projectedRevenue, 0);
    const totalMargin = built.reduce((s, r) => s + r.projectedMargin, 0);
    const blendedPct = totalRevenue > 0 ? totalMargin / totalRevenue : 0;
    const atRisk = built.filter(r => r.band === 'elevated' || r.band === 'high').length;
    return { rows: built, totalRevenue, totalMargin, blendedPct, atRisk };
  }, [projects, changeOrders, commitments, invoices]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Margin Board · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Portfolio margin</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {rows.length === 0 ? (
        <EmptyState
          icon={<TrendingUp size={36} color={t.accent} strokeWidth={1.6} />}
          title="No margin to roll up yet"
          message="The Margin Board ranks every active project by margin risk. To populate it:"
          steps={[
            'Mark projects as estimated or in progress.',
            'Give each an estimate with markup so there is a margin to track.',
            'Award buyout and approve change orders — the board updates live.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* Portfolio KPIs */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Projected revenue</Text>
              <Text style={styles.kpiValue}>{formatMoney(totalRevenue)}</Text>
              <Text style={styles.kpiSub}>{rows.length} active job{rows.length === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Blended margin</Text>
              <Text style={[styles.kpiValue, { color: blendedPct < 0.1 ? t.danger : t.text }]}>{pct(blendedPct)}</Text>
              <Text style={styles.kpiSub}>{formatMoney(totalMargin)} profit</Text>
            </View>
          </View>

          {unreadAlerts > 0 && (
            <TouchableOpacity
              style={styles.alertsLink}
              onPress={() => router.push('/margin-alerts' as any)}
              activeOpacity={0.7}
              testID="portfolio-margin-alerts-link"
            >
              <BellRing size={16} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.alertsLinkText}>
                <Text style={styles.alertsLinkStrong}>{unreadAlerts}</Text> margin alert{unreadAlerts === 1 ? '' : 's'} since you last looked
              </Text>
              <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          )}

          {atRisk > 0 && (
            <View style={styles.alertBanner}>
              <ShieldAlert size={16} color={t.danger} strokeWidth={1.75} />
              <Text style={styles.alertText}>
                <Text style={styles.alertStrong}>{atRisk}</Text> job{atRisk === 1 ? '' : 's'} at elevated or high margin risk — top of the list.
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Ranked by risk</Text>
          {rows.map(r => {
            const bc = colorForBand(r.band, t);
            const eroded = r.erosionPoints < -0.05;
            return (
              <TouchableOpacity
                key={r.project.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/margin-risk', params: { projectId: r.project.id } } as any)}
                activeOpacity={0.7}
                testID={`portfolio-row-${r.project.id}`}
              >
                <View style={[styles.scorePill, { backgroundColor: bc + '1F' }]}>
                  <Text style={[styles.scoreNum, { color: bc }]}>{r.score}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>{r.project.name}</Text>
                  <View style={styles.rowMetaLine}>
                    <Text style={styles.rowMeta}>{formatMoney(r.projectedRevenue)}</Text>
                    <Text style={styles.rowDot}>·</Text>
                    <Text style={[styles.rowMeta, { color: r.projectedMarginPct < 0.1 ? t.danger : t.textSecondary }]}>
                      {pct(r.projectedMarginPct)} margin
                    </Text>
                    {eroded && (
                      <>
                        <Text style={styles.rowDot}>·</Text>
                        <TrendingDown size={12} color={t.danger} strokeWidth={1.75} />
                        <Text style={[styles.rowMeta, { color: t.danger }]}>{r.erosionPoints.toFixed(1)} pts</Text>
                      </>
                    )}
                  </View>
                </View>
                <ChevronRight size={18} color={t.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            );
          })}

          <Text style={styles.note}>
            Only projects (estimated or in progress) with a cost-and-markup estimate appear
            here. Tap a job to see its margin risk and the Living Estimate behind it.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  kpiRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 14 },
  kpiCard: {
    flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, gap: 3,
  },
  kpiLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  kpiValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },
  kpiSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  alertsLink: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.accent + '12', borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.accent + '33',
    padding: 12, marginBottom: 12,
  },
  alertsLinkText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  alertsLinkStrong: { fontWeight: '800' as const, color: t.accent },

  alertBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.danger + '14', borderRadius: Tokens.radius.card,
    padding: 12, marginBottom: 16,
  },
  alertText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  alertStrong: { fontWeight: '800' as const, color: t.danger },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },

  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 8,
  },
  scorePill: {
    width: 44, height: 44, borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  scoreNum: { fontSize: Type.headline.fontSize, fontWeight: '800' as const },
  rowBody: { flex: 1, gap: 3 },
  rowName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  rowMetaLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, flexWrap: 'wrap' as const },
  rowMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  rowDot: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },
});
