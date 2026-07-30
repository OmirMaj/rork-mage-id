// app/profit-leak-history.tsx — Profit Leak History
//
// Lists every leak_flag prediction from the brain's prediction ledger,
// grouped into three buckets:
//   OPEN       — flagged extra work that never became a change order
//   CONVERTED  — leak flags that resolved to a CO being raised
//   EATEN      — resolved as "not billed" (owner declined / eaten by GC)
//
// Business+ gated (brain_accuracy proxy, same as /business and /brief).
// Desktop: content column capped at 760 and centered.
// Anti-slop: Type/Tokens/Colors only. No raw hex or fontSize.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, TrendingDown, CheckCircle2, XCircle, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { fetchOpenPredictionsDeduped, fetchResolvedPredictions } from '@/utils/brain/predictionLedger';
import type { BrainPredictionReadRow } from '@/utils/brain/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

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
  bucket: 'open' | 'converted' | 'eaten';
}

function classifyOutcome(row: BrainPredictionReadRow): 'open' | 'converted' | 'eaten' {
  if (!row.resolved_at) return 'open';
  const outcome = row.outcome ?? {};
  if (outcome.resolution === 'co_raised' || outcome.coId) return 'converted';
  return 'eaten';
}

function buildLeakRow(row: BrainPredictionReadRow): LeakRow {
  const payload = row.payload as {
    reportId?: string;
    items?: { category: string; description: string; estPrice?: number | null }[];
  };
  const items = payload.items ?? [];
  const estTotal = items.reduce((s, i) => s + (i.estPrice ?? 0), 0);
  return {
    id: row.id,
    reportId: payload.reportId ?? row.subject_id,
    projectId: row.project_id ?? null,
    predictedAt: row.predicted_at,
    resolvedAt: row.resolved_at,
    outcome: row.outcome,
    items,
    estTotal,
    bucket: classifyOutcome(row),
  };
}

// ─── Inner screen ───────────────────────────────────────────────────────────

function ProfitLeakHistoryInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LeakRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [open, resolved] = await Promise.all([
        fetchOpenPredictionsDeduped(['leak_flag']),
        fetchResolvedPredictions(['leak_flag']),
      ]);
      const all = [...open, ...resolved].map(buildLeakRow);
      // Sort: open first, then by predictedAt desc within each bucket
      all.sort((a, b) => {
        const bucketOrder = { open: 0, converted: 1, eaten: 2 };
        const bDiff = bucketOrder[a.bucket] - bucketOrder[b.bucket];
        if (bDiff !== 0) return bDiff;
        return new Date(b.predictedAt).getTime() - new Date(a.predictedAt).getTime();
      });
      setRows(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const { openRows, convertedRows, eatenRows, openTotal, convertedTotal, eatenTotal } = useMemo(() => {
    const openRows = rows.filter(r => r.bucket === 'open');
    const convertedRows = rows.filter(r => r.bucket === 'converted');
    const eatenRows = rows.filter(r => r.bucket === 'eaten');
    return {
      openRows,
      convertedRows,
      eatenRows,
      openTotal: openRows.reduce((s, r) => s + r.estTotal, 0),
      convertedTotal: convertedRows.reduce((s, r) => s + r.estTotal, 0),
      eatenTotal: eatenRows.reduce((s, r) => s + r.estTotal, 0),
    };
  }, [rows]);

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
          headerTitleStyle: { color: t.text, fontWeight: '700' },
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
          style={styles.scroll}
          contentContainerStyle={[contentStyle, { paddingBottom: insets.bottom + 24 }]}
        >
          {/* Summary row */}
          <View style={styles.summaryRow}>
            <SummaryChip
              label="Open"
              count={openRows.length}
              total={openTotal}
              color={Colors.warning}
              bg={Colors.warning + '14'}
              styles={styles}
              t={t}
            />
            <SummaryChip
              label="Converted"
              count={convertedRows.length}
              total={convertedTotal}
              color={t.success}
              bg={Colors.successLight}
              styles={styles}
              t={t}
            />
            <SummaryChip
              label="Eaten"
              count={eatenRows.length}
              total={eatenTotal}
              color={t.danger}
              bg={t.danger + '14'}
              styles={styles}
              t={t}
            />
          </View>

          {rows.length === 0 && (
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
              icon={<Clock size={15} color={Colors.warning} strokeWidth={1.75} />}
              tint={Colors.warning}
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

          {eatenRows.length > 0 && (
            <BucketSection
              label="Eaten"
              subtitle="Flagged work resolved as not billed"
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
  count: number;
  total: number;
  color: string;
  bg: string;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
}) {
  return (
    <View style={[styles.summaryChip, { backgroundColor: bg, borderColor: color + '30' }]}>
      <Text style={[styles.summaryCount, { color }]}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {total > 0 && (
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
