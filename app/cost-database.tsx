// cost-database.tsx — your personal price book, learned from closed jobs.
//
// Generic cost data is stale and locally wrong; your own history is the most
// accurate price book that exists for your work. This screen surfaces it: per
// trade + unit, what scope actually costs at your hands, how much it varies job
// to job, whether you systematically bid it high or low, and a blended rate to
// carry into the next bid. Built live from every closed job's bid-vs-actual
// ledger — pure aggregation over utils/costDatabase, no network.

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ChevronDown, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react-native';
import { MageCostDb, MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { buildCostDatabase, type CostBookEntry } from '@/utils/costDatabase';
import { useCostBenchmark } from '@/hooks/useCostBenchmark';
import CostTruthChip from '@/components/CostTruthChip';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useBrainGrading } from '@/hooks/useBrainGrading';

function formatRate(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export default function CostDatabaseScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Cost Database"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <CostDatabaseInner />;
}

function CostDatabaseInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();
  // Self-perform labor (D6): the book's own screen must show every source
  // that feeds it — crew hours appear as "Labor — <trade>" $/hour entries.
  const laborSamples = useLaborCostSamples();
  const { canAccess } = useTierAccess();
  const { accuracyReport } = useBrainGrading();

  const db = useMemo(
    () => buildCostDatabase(projects, commitments, receipts, laborSamples),
    [projects, commitments, receipts, laborSamples],
  );

  // Cost Truth: contribute my learned rates + read the cross-contractor
  // regional benchmark (aggregate-only, k-anonymized).
  const benchInputs = useMemo(
    () => db.entries.map((e) => ({ trade: e.trade, unit: e.unit, personalRate: e.personalRate })),
    [db.entries],
  );
  const { statsFor } = useCostBenchmark(benchInputs);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const confColor = (c: CostBookEntry['confidence']) =>
    c === 'high' ? t.success : c === 'medium' ? t.accent : t.textMuted;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Cost Database · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Your prices</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {db.entries.length === 0 ? (
        <EmptyState
          icon={<MageCostDb size={36} color={t.accent} />}
          title="No price history yet"
          message="Your cost database learns what work actually costs from every job you close. To build it:"
          steps={[
            'Complete or close a project that had a cost estimate.',
            'Make sure its commitments are linked to estimate lines (buyout does this).',
            'Each closed job adds samples — rates sharpen as history grows.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      ) : (
        <ScrollView contentContainerStyle={[{ padding: 16, paddingBottom: 40 + insets.bottom }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Trades</Text>
              <Text style={styles.kpiValue}>{db.tradesTracked}</Text>
              <Text style={styles.kpiSub}>{db.jobsAnalyzed} closed job{db.jobsAnalyzed === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Bid accuracy</Text>
              <Text style={[styles.kpiValue, { color: db.overallBidAccuracy !== null && db.overallBidAccuracy < 0.85 ? t.accentHot : t.text }]}>
                {db.overallBidAccuracy !== null ? `${Math.round(db.overallBidAccuracy * 100)}%` : '—'}
              </Text>
              <Text style={styles.kpiSub}>est. vs actual, weighted</Text>
            </View>
          </View>

          {/* Brain accuracy section — Business+ gated */}
          {canAccess('brain_accuracy') && (
            <View style={styles.accuracySection}>
              <View style={styles.accuracySectionHeader}>
                <MageAIMark size={14} color={t.accent} />
                <Text style={styles.accuracySectionTitle}>Brain accuracy</Text>
              </View>
              {accuracyReport.hasEnoughData ? (
                accuracyReport.rows.map(row => (
                  <View key={row.kind} style={styles.accuracyCard}>
                    <Text style={styles.accuracyLabel}>{row.label}</Text>
                    <Text style={styles.accuracyHeadline}>{row.headline}</Text>
                    <Text style={styles.accuracyDetail}>{row.detail}</Text>
                    {row.rate != null && (
                      <View style={styles.accuracyBarTrack}>
                        <View style={[styles.accuracyBarFill, { width: `${Math.round(row.rate * 100)}%` as any }]} />
                      </View>
                    )}
                  </View>
                ))
              ) : (
                <View style={styles.accuracyEmpty}>
                  <Text style={styles.accuracyEmptyText}>
                    The brain is grading itself — first results after your predictions resolve.
                  </Text>
                </View>
              )}
            </View>
          )}

          <Text style={styles.sectionTitle}>By trade · unit</Text>
          {db.entries.map(e => {
            const isOpen = expanded.has(e.key);
            const cc = confColor(e.confidence);
            const bench = statsFor(e.trade, e.unit);
            const bidsLow = e.bidBias > 0.02;
            const bidsHigh = e.bidBias < -0.02;
            return (
              <View key={e.key} style={styles.card}>
                <TouchableOpacity
                  style={styles.cardHead}
                  onPress={() => toggle(e.key)}
                  activeOpacity={0.7}
                  testID={`cost-entry-${e.key}`}
                >
                  <View style={styles.cardHeadBody}>
                    <Text style={styles.cardTrade} numberOfLines={1}>{e.trade}</Text>
                    <Text style={styles.cardMeta}>
                      per {e.unit} · {e.jobCount} job{e.jobCount === 1 ? '' : 's'}
                      <Text style={{ color: cc }}> · {e.confidence}</Text>
                    </Text>
                    {bench ? (
                      <View style={{ marginTop: 5 }}>
                        <CostTruthChip stats={bench} rate={e.personalRate} />
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.rateBox}>
                    <Text style={styles.rateVal}>{formatRate(e.suggestedRate)}</Text>
                    <Text style={styles.rateSub}>±{Math.round(e.variability * 100)}%</Text>
                  </View>
                  {isOpen ? <ChevronDown size={18} color={t.textMuted} strokeWidth={1.75} /> : <ChevronRight size={18} color={t.textMuted} strokeWidth={1.75} />}
                </TouchableOpacity>

                {(bidsLow || bidsHigh) && (
                  <View style={styles.biasRow}>
                    {bidsLow ? <TrendingUp size={12} color={t.danger} strokeWidth={1.75} /> : <TrendingDown size={12} color={t.success} strokeWidth={1.75} />}
                    <Text style={[styles.biasText, { color: bidsLow ? t.danger : t.success }]}>
                      You bid this ~{Math.abs(Math.round(e.bidBias * 100))}% {bidsLow ? 'under' : 'over'} actual cost
                    </Text>
                  </View>
                )}

                {isOpen && (
                  <View style={styles.detail}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Your actual rate</Text>
                      <Text style={styles.detailVal}>{formatRate(e.personalRate)}/{e.unit}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Last bid assumption</Text>
                      <Text style={styles.detailVal}>{formatRate(e.baseline)}/{e.unit}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Suggested next bid</Text>
                      <Text style={[styles.detailVal, { color: t.accent }]}>{formatRate(e.suggestedRate)}/{e.unit}</Text>
                    </View>
                    <Text style={styles.samplesTitle}>Samples</Text>
                    {e.samples.map((s, i) => (
                      <View key={`${s.projectId}-${i}`} style={styles.sampleRow}>
                        <Text style={styles.sampleName} numberOfLines={1}>{s.projectName}</Text>
                        <Text style={styles.sampleRate}>
                          {formatRate(s.actualUnit)}
                          <Text style={styles.sampleBasis}> {s.basis === 'actual' ? 'actual' : 'signed'}</Text>
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          <Text style={styles.note}>
            Suggested rate blends your most recent bid assumption toward your measured actuals
            as you close more jobs (more samples = more weight on reality). &ldquo;Actual&rdquo; samples are
            paid-to-date; &ldquo;signed&rdquo; samples fall back to the committed sub/PO amount.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  contentDesktop: { width: '100%', maxWidth: 760, alignSelf: 'center' as const },
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

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, marginBottom: 8, overflow: 'hidden' as const,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12 },
  cardHeadBody: { flex: 1, gap: 2 },
  cardTrade: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  rateBox: { alignItems: 'flex-end' as const },
  rateVal: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },
  rateSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  biasRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingBottom: 12, marginTop: -2,
  },
  biasText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },

  detail: {
    borderTopWidth: 1, borderTopColor: t.line,
    padding: 12, gap: 6, backgroundColor: t.surfaceAlt,
  },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  detailLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  detailVal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  samplesTitle: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' as const, letterSpacing: 0.3, marginTop: 6 },
  sampleRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: 8 },
  sampleName: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  sampleRate: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  sampleBasis: { fontSize: Type.caption2.fontSize, fontWeight: '400' as const, color: t.textMuted },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },

  accuracySection: {
    marginBottom: 20,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.panel,
    overflow: 'hidden' as const,
  },
  accuracySectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    backgroundColor: t.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  accuracySectionTitle: {
    ...Type.subheadEmphasized,
    color: t.text,
  },
  accuracyCard: {
    backgroundColor: t.bg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  accuracyLabel: {
    ...Type.caption1,
    color: t.textMuted,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  accuracyHeadline: {
    ...Type.subhead,
    color: t.text,
    fontWeight: '700' as const,
  },
  accuracyDetail: {
    ...Type.footnote,
    color: t.textSecondary,
    lineHeight: 18,
  },
  accuracyBarTrack: {
    height: 4,
    backgroundColor: t.line,
    borderRadius: Tokens.radius.full,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  accuracyBarFill: {
    height: 4,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.full,
  },
  accuracyEmpty: {
    backgroundColor: t.bg,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  accuracyEmptyText: {
    ...Type.footnote,
    color: t.textSecondary,
    fontStyle: 'italic' as const,
  },
});
