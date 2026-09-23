// app/profit-leak-history.tsx — Profit Leak History
//
// Lists every leak_flag prediction from the brain's prediction ledger,
// grouped by what the grader (utils/brain/gradePredictions.gradeLeak) found:
//   OPEN          — not graded yet: the 60-day window is still running
//   CONVERTED     — every flagged item matched an approved change order
//   PARTLY BILLED — some items matched an approved CO, some did not
//   EATEN         — no matching approved CO was found within 60 days of the
//                   scan (or before the job closed). The grader cannot know
//                   WHY — it never says the owner declined anything.
// The filing rules and the totals are pure functions in
// utils/brain/predictionLedger.ts (classifyLeakOutcome / summarizeLeakHistory),
// held equal to the brain's own recovery rate by validate-w5-brain-money-leak.
//
// Business+ gated (brain_accuracy proxy, same as /business and /brief).
// Desktop: content column capped at 760 and centered.
// Anti-slop: Type/Tokens/Colors only. No raw hex or fontSize.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Platform, RefreshControl,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, TrendingDown, CheckCircle2, XCircle, Clock, CircleDashed,
  CloudOff, RotateCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { cardSurface } from '@/components/ui';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import {
  fetchOpenPredictionsDedupedResult, fetchResolvedPredictionsResult, invalidatePredictionCache,
  classifyLeakOutcome, leakEstTotal, leakDollarsBilled, summarizeLeakHistory,
  type LeakBucket, type LeakHistorySummary,
} from '@/utils/brain/predictionLedger';
import type { BrainPredictionReadRow } from '@/utils/brain/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

// ─── Business gate ──────────────────────────────────────────────────────────

export default function ProfitLeakHistoryScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('brain_accuracy')) {
    return (
      <Paywall
        visible={true}
        feature="Profit Leak History"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <ProfitLeakHistoryInner />;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface LeakRow {
  id: string;
  reportId: string;
  projectId: string | null;
  predictedAt: string;
  resolvedAt: string | null;
  outcome: Record<string, unknown> | null;
  items: { category: string; description: string; estPrice?: number | null }[];
  estTotal: number;
  /** Dollars of this scan that became an approved CO (0 while open). */
  dollarsBilled: number;
  /** Items the grader matched / graded — for the "N of M items billed" line. */
  itemsBilled: number;
  itemsGraded: number;
  bucket: LeakBucket;
}

function buildLeakRow(row: BrainPredictionReadRow): LeakRow {
  const payload = row.payload as {
    reportId?: string;
    items?: { category: string; description: string; estPrice?: number | null }[];
  };
  const items = payload.items ?? [];
  const o = (row.outcome ?? {}) as { itemsBilled?: number; itemsEaten?: number };
  const itemsBilled = o.itemsBilled ?? 0;
  return {
    id: row.id,
    reportId: payload.reportId ?? row.subject_id,
    projectId: row.project_id ?? null,
    predictedAt: row.predicted_at,
    resolvedAt: row.resolved_at,
    outcome: row.outcome,
    items,
    estTotal: leakEstTotal(row),
    dollarsBilled: leakDollarsBilled(row),
    itemsBilled,
    itemsGraded: itemsBilled + (o.itemsEaten ?? 0),
    bucket: classifyLeakOutcome(row),
  };
}

const BUCKET_ORDER: Record<LeakBucket, number> = { open: 0, converted: 1, partial: 2, eaten: 3 };

// ─── Inner screen ───────────────────────────────────────────────────────────

function ProfitLeakHistoryInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<LeakRow[]>([]);
  const [summary, setSummary] = useState<LeakHistorySummary | null>(null);
  // A FAILED READ IS NOT "NO SCANS" (#104 / #122). Offline, both ledger reads
  // used to come back as [] and this screen told a GC with a year of scans
  // "No profit leak scans yet" over three zero chips. Now a failure is its own
  // state: the rows already on screen stay (a pull-to-refresh with no signal
  // must not wipe what he was reading), and with none to show he is told the
  // read failed, with a Retry.
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [open, resolved] = await Promise.all([
      fetchOpenPredictionsDedupedResult(['leak_flag']),
      fetchResolvedPredictionsResult(['leak_flag']),
    ]);
    if (!open.ok || !resolved.ok) {
      // Keep the previous rows. Half a ledger is not shown as the whole of it.
      setLoadError(!open.ok ? open.error : !resolved.ok ? resolved.error : 'read failed');
      return;
    }
    const raw = [...open.rows, ...resolved.rows];
    const all = raw.map(buildLeakRow);
    // Sort: open first, then by predictedAt desc within each bucket
    all.sort((a, b) => {
      const bDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
      if (bDiff !== 0) return bDiff;
      return new Date(b.predictedAt).getTime() - new Date(a.predictedAt).getTime();
    });
    setRows(all);
    setSummary(summarizeLeakHistory(raw));
    setLoadError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  // Retry and pull-to-refresh drop the 30 s read cache first, so a pull never
  // serves the snapshot it is meant to replace.
  const reload = useCallback(async () => {
    setRefreshing(true);
    invalidatePredictionCache();
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const { openRows, convertedRows, partialRows, eatenRows } = useMemo(() => ({
    openRows: rows.filter(r => r.bucket === 'open'),
    convertedRows: rows.filter(r => r.bucket === 'converted'),
    partialRows: rows.filter(r => r.bucket === 'partial'),
    eatenRows: rows.filter(r => r.bucket === 'eaten'),
  }), [rows]);

  // No figures to stand behind → dashes, never 0 / $0 stated as fact.
  const noData = summary === null;

  const handleRowPress = useCallback((row: LeakRow) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (row.projectId && row.reportId) {
      router.push({
        pathname: '/daily-report',
        params: { projectId: row.projectId, reportId: row.reportId },
      });
    }
  }, [router]);

  const contentStyle = isDesktop
    ? [styles.scrollContent, { maxWidth: 1200, alignSelf: 'center' as const, width: '100%' as const }]
    : styles.scrollContent;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Profit Leak History',
          headerShown: true,
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.accent,
          headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: t.text },
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={8}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ChevronLeft size={22} color={t.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : (
        <ScrollView
          {...fabScroll}
          style={styles.scroll}
          contentContainerStyle={[contentStyle, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={t.accent} />}
        >
          {loadError && rows.length > 0 ? (
            // Stale rows stay readable; the banner says they may be out of date.
            <View style={styles.errorBanner} testID="leak-history-stale">
              <CloudOff size={14} color={t.textMuted} strokeWidth={1.75} />
              <Text style={styles.errorBannerText}>
                {"Couldn't refresh — no signal or the server didn't answer. Showing what was loaded before."}
              </Text>
            </View>
          ) : null}

          {/* Summary row — a partly billed scan counts under both Converted and Eaten. */}
          <View style={styles.summaryRow}>
            <SummaryChip
              label="Open"
              count={noData ? null : summary.openCount}
              total={noData ? null : summary.openTotal}
              color={Colors.warningLabel}
              bg={Colors.warning + '14'}
              styles={styles}
              t={t}
            />
            <SummaryChip
              label="Converted"
              count={noData ? null : summary.billedScanCount}
              total={noData ? null : summary.convertedTotal}
              color={t.success}
              bg={Colors.successLight}
              styles={styles}
              t={t}
            />
            <SummaryChip
              label="Eaten"
              count={noData ? null : summary.unbilledScanCount}
              total={noData ? null : summary.eatenTotal}
              color={t.danger}
              bg={t.danger + '14'}
              styles={styles}
              t={t}
            />
          </View>
          {!noData && summary.itemRecoveryRate !== null ? (
            // The brain's own recovery line, on the same rows — so this page and
            // the accuracy report can no longer disagree.
            <Text style={styles.recoveryLine} testID="leak-history-recovery">
              {`${summary.itemsBilled} of ${summary.itemsGraded} graded item${summary.itemsGraded === 1 ? '' : 's'} `
                + `became an approved change order (${Math.round(summary.itemRecoveryRate * 100)}%).`
                + (summary.partialCount > 0
                  ? ` ${summary.partialCount} partly billed scan${summary.partialCount === 1 ? ' counts' : 's count'} under both Converted and Eaten.`
                  : '')}
            </Text>
          ) : null}

          {loadError && rows.length === 0 ? (
            <View style={styles.emptyWrap} testID="leak-history-error">
              <CloudOff size={32} color={t.textMuted} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>{"Couldn't load your profit leak scans"}</Text>
              <Text style={styles.emptyBody}>
                {"No signal or the server didn't answer. Your scans are still on your account."}
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => { void reload(); }}
                disabled={refreshing}
                accessibilityRole="button"
                accessibilityLabel="Retry loading profit leak scans"
                testID="leak-history-retry"
              >
                <RotateCw size={14} color={t.accent} strokeWidth={2} />
                <Text style={styles.retryText}>{refreshing ? 'Retrying…' : 'Retry'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!loadError && rows.length === 0 && (
            <View style={styles.emptyWrap}>
              <TrendingDown size={32} color={t.textMuted} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>No profit leak scans yet</Text>
              <Text style={styles.emptyBody}>
                When the brain flags extra work in a daily report that wasn't billed as a change order, it appears here.
              </Text>
            </View>
          )}

          {openRows.length > 0 && (
            <BucketSection
              label="Open"
              subtitle="Flagged extra work not yet billed as a change order"
              icon={<Clock size={15} color={Colors.warningLabel} strokeWidth={1.75} />}
              tint={Colors.warningLabel}
              rows={openRows}
              styles={styles}
              t={t}
              onPress={handleRowPress}
            />
          )}

          {convertedRows.length > 0 && (
            <BucketSection
              label="Converted"
              subtitle="Flagged work that turned into an approved change order"
              icon={<CheckCircle2 size={15} color={t.success} strokeWidth={1.75} />}
              tint={t.success}
              rows={convertedRows}
              styles={styles}
              t={t}
              onPress={handleRowPress}
            />
          )}

          {partialRows.length > 0 && (
            <BucketSection
              label="Partly billed"
              subtitle="Some flagged items matched an approved change order; the rest found no match within 60 days"
              icon={<CircleDashed size={15} color={t.success} strokeWidth={1.75} />}
              tint={t.success}
              rows={partialRows}
              styles={styles}
              t={t}
              onPress={handleRowPress}
            />
          )}

          {eatenRows.length > 0 && (
            <BucketSection
              label="Eaten"
              subtitle="No matching approved change order found within 60 days of the scan (or before the job closed)"
              icon={<XCircle size={15} color={t.danger} strokeWidth={1.75} />}
              tint={t.danger}
              rows={eatenRows}
              styles={styles}
              t={t}
              onPress={handleRowPress}
            />
          )}
        </ScrollView>
      )}
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SummaryChip({
  label, count, total, color, bg, styles, t,
}: {
  label: string;
  /** null = the ledger could not be read — shown as a dash, never as 0. */
  count: number | null;
  total: number | null;
  color: string;
  bg: string;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
}) {
  return (
    <View style={[styles.summaryChip, { backgroundColor: bg, borderColor: color + '30' }]}>
      <Text style={[styles.summaryCount, { color }]}>{count === null ? '—' : count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {total !== null && total > 0 && (
        <Text style={[styles.summaryMoney, { color }]}>{fmtMoney(total)}</Text>
      )}
    </View>
  );
}

function BucketSection({
  label, subtitle, icon, tint, rows, styles, t, onPress,
}: {
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  tint: string;
  rows: LeakRow[];
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  onPress: (row: LeakRow) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionHeadLeft}>
          {icon}
          <Text style={[styles.sectionLabel, { color: tint }]}>{label}</Text>
        </View>
        <Text style={styles.sectionSub}>{subtitle}</Text>
      </View>
      {rows.map(row => (
        <LeakRowCard
          key={row.id}
          row={row}
          tint={tint}
          styles={styles}
          t={t}
          onPress={onPress}
        />
      ))}
    </View>
  );
}

function LeakRowCard({
  row, tint, styles, t, onPress,
}: {
  row: LeakRow;
  tint: string;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  onPress: (row: LeakRow) => void;
}) {
  const canDrill = Boolean(row.projectId && row.reportId);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(row)}
      activeOpacity={canDrill ? 0.8 : 1}
      disabled={!canDrill}
    >
      <View style={styles.cardHead}>
        <View style={[styles.tintBar, { backgroundColor: tint }]} />
        <View style={styles.cardHeadBody}>
          <Text style={styles.cardDate}>{fmtDate(row.predictedAt)}</Text>
          {row.estTotal > 0 && (
            <Text style={[styles.cardMoney, { color: tint }]}>{fmtMoney(row.estTotal)}</Text>
          )}
        </View>
        {canDrill && (
          <ChevronRight size={14} color={t.textMuted} strokeWidth={1.75} />
        )}
      </View>
      {row.bucket === 'partial' ? (
        <Text style={styles.partialLine}>
          {`${row.itemsBilled} of ${row.itemsGraded} items billed as a change order · `
            + `${fmtMoney(row.dollarsBilled)} billed, ${fmtMoney(Math.max(0, row.estTotal - row.dollarsBilled))} not`}
        </Text>
      ) : null}
      {row.items.slice(0, 3).map((item, idx) => (
        <View key={idx} style={styles.itemRow}>
          <Text style={styles.itemCategory}>{item.category}</Text>
          <Text style={styles.itemDesc} numberOfLines={1}>{item.description}</Text>
          {item.estPrice != null && item.estPrice > 0 && (
            <Text style={styles.itemPrice}>{fmtMoney(item.estPrice)}</Text>
          )}
        </View>
      ))}
      {row.items.length > 3 && (
        <Text style={styles.itemMore}>+{row.items.length - 3} more items</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: t.bg },
  scrollContent: { padding: 16, gap: 16 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  backBtn: { padding: 4 },

  summaryRow: {
    flexDirection: 'row', gap: 8,
  },
  summaryChip: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2,
    paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
  },
  summaryCount: { fontSize: Type.title3.fontSize, fontWeight: '800', letterSpacing: -0.5 },
  summaryLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  summaryMoney: { fontSize: Type.caption2.fontSize, fontWeight: '700' },

  emptyWrap: {
    alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 48, paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text, textAlign: 'center' },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, marginTop: 4,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  retryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  errorBanner: {
    ...cardSurface(t, { radius: 'md', pad: 10 }),
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorBannerText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  recoveryLine: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 18 },
  partialLine: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary },

  section: { gap: 8 },
  sectionHead: { gap: 2, paddingHorizontal: 2 },
  sectionHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sectionLabel: { fontSize: Type.footnote.fontSize, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  sectionSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    padding: 12, gap: 6,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tintBar: { width: 3, height: 32, borderRadius: Tokens.radius.xs, flexShrink: 0 },
  cardHeadBody: { flex: 1, gap: 1 },
  cardDate: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  cardMoney: { fontSize: Type.caption1.fontSize, fontWeight: '800' },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 2,
  },
  itemCategory: {
    fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.2,
    minWidth: 60,
  },
  itemDesc: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text },
  itemPrice: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  itemMore: { fontSize: Type.caption2.fontSize, color: t.textMuted, paddingLeft: 11 },
});
