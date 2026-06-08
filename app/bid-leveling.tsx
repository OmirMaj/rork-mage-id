// bid-leveling.tsx — level a buyout package's bids into an honest decision.
//
// Raw bids lie: the lowball that "wins" is usually the one that excluded the
// blocking, the permit, and the dumpster. This screen ranks bids by their
// LEVELED cost (raw + adjustment for excluded scope), flags suspiciously-low
// outliers, surfaces every exclusion, and recommends the best honest value vs.
// the budget. "AI-level" asks the model to price each bid's exclusions so the
// comparison is apples-to-apples.
//
// Pure ranking in utils/bidLeveling; the single AI call routes through mageAI.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Scale, Sparkles, Trophy, BadgeDollarSign, AlertTriangle } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  computeBidLeveling, buildLevelingPrompt, BID_LEVELING_SCHEMA_HINT,
  type LeveledBid, type AILevelSuggestion,
} from '@/utils/bidLeveling';
import { mageAI } from '@/utils/mageAI';
import { formatMoney, formatMoneyFull } from '@/utils/jobCostEngine';
import type { BidPackageBid } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function BidLevelingScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return <Paywall visible={true} feature="AI Bid Leveling" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <BidLevelingInner />;
}

function BidLevelingInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { packageId } = useLocalSearchParams<{ packageId?: string }>();
  const { getBidPackage, getBidsForPackage, getSubcontractor, updateBidPackageBid } = useProjects();

  const pkg = useMemo(() => (packageId ? getBidPackage(packageId) : null), [packageId, getBidPackage]);
  const bids = useMemo(() => (packageId ? getBidsForPackage(packageId) : []), [packageId, getBidsForPackage]);

  const resolveVendor = useCallback((b: BidPackageBid) => {
    if (b.vendorName?.trim()) return b.vendorName.trim();
    if (b.subcontractorId) return getSubcontractor(b.subcontractorId)?.companyName ?? 'Subcontractor';
    return 'Subcontractor';
  }, [getSubcontractor]);

  const report = useMemo(
    () => (pkg ? computeBidLeveling(pkg, bids, resolveVendor) : null),
    [pkg, bids, resolveVendor],
  );

  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  const aiLevel = useCallback(async () => {
    if (!pkg || aiBusy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setAiBusy(true);
    setAiMsg(null);
    try {
      const prompt = buildLevelingPrompt(pkg, bids, resolveVendor);
      const res = await mageAI({ prompt, tier: 'smart', schemaHint: BID_LEVELING_SCHEMA_HINT, maxTokens: 1200 });
      const data = (res.data && typeof res.data === 'object' ? res.data : safeParse(res.raw)) as { suggestions?: AILevelSuggestion[] } | null;
      const suggestions = Array.isArray(data?.suggestions) ? data!.suggestions : [];
      if (!res.success || suggestions.length === 0) {
        setAiMsg(res.error ? `Couldn't level: ${res.error}` : 'No adjustments suggested. Add each bid’s exclusions and try again.');
        return;
      }
      let applied = 0;
      for (const s of suggestions) {
        if (!s.bidId) continue;
        const adj = Math.max(0, Math.round(Number(s.adjustment) || 0));
        updateBidPackageBid(s.bidId, { normalizedAdjustment: adj, normalizedAdjustmentReason: (s.reason ?? '').slice(0, 240) });
        applied += 1;
      }
      setAiMsg(`Leveled ${applied} bid${applied === 1 ? '' : 's'} for excluded scope. Ranking updated.`);
    } catch (e) {
      setAiMsg(`Leveling hit an error: ${String((e as Error).message ?? e)}`);
    } finally {
      setAiBusy(false);
    }
  }, [pkg, bids, resolveVendor, aiBusy, updateBidPackageBid]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Bid Leveling · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{pkg?.name ?? 'Level bids'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {!pkg || !report || !report.hasBids ? (
        <EmptyState
          icon={<Scale size={36} color={t.accent} strokeWidth={1.6} />}
          title={!pkg ? 'Package not found' : 'No bids to level yet'}
          message={
            !pkg
              ? 'Open this from a buyout package to compare its bids apples-to-apples.'
              : 'Add at least two bids to this package — with what each one includes and excludes — and MAGE will level them and recommend the best value.'
          }
          actionLabel="Back"
          onAction={() => router.back()}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* Recommendation */}
          {report.recommendedId && (() => {
            const rec = report.bids.find(b => b.isRecommended)!;
            return (
              <View style={[styles.recoCard, { borderColor: t.success + '55' }]}>
                <View style={styles.recoHead}>
                  <Trophy size={16} color={t.success} />
                  <Text style={styles.recoLabel}>BEST VALUE</Text>
                </View>
                <Text style={styles.recoVendor}>{rec.vendor}</Text>
                <Text style={styles.recoAmount}>{formatMoneyFull(rec.leveledAmount)} <Text style={styles.recoLeveled}>leveled</Text></Text>
                <Text style={styles.recoReason}>
                  {rec.adjustment > 0 ? `${formatMoneyFull(rec.rawAmount)} bid + ${formatMoney(rec.adjustment)} for excluded scope. ` : ''}
                  {rec.vsBudget <= 0 ? `${formatMoney(Math.abs(rec.vsBudget))} under budget.` : `${formatMoney(rec.vsBudget)} over budget.`}
                </Text>
              </View>
            );
          })()}

          {/* AI level CTA + summary */}
          <TouchableOpacity style={[styles.aiBtn, aiBusy && { opacity: 0.7 }]} onPress={aiLevel} disabled={aiBusy} activeOpacity={0.85} testID="bid-ai-level">
            {aiBusy ? <ActivityIndicator size="small" color={t.accent} /> : <Sparkles size={16} color={t.accent} />}
            <Text style={styles.aiBtnText}>{aiBusy ? 'Leveling exclusions…' : 'AI-level the exclusions'}</Text>
          </TouchableOpacity>
          {aiMsg && <Text style={styles.aiMsg}>{aiMsg}</Text>}

          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}><Text style={styles.kpiLabel}>Budget</Text><Text style={styles.kpiValue}>{formatMoney(report.budget)}</Text></View>
            <View style={styles.kpiCard}><Text style={styles.kpiLabel}>Field spread</Text><Text style={styles.kpiValue}>{formatMoney(report.spread)}</Text><Text style={styles.kpiSub}>{Math.round(report.spreadPct * 100)}% of median</Text></View>
          </View>

          {report.outlierCount > 0 && (
            <View style={styles.warn}>
              <AlertTriangle size={15} color={t.danger} />
              <Text style={styles.warnText}>
                <Text style={{ fontWeight: '800', color: t.danger }}>{report.outlierCount}</Text> bid{report.outlierCount === 1 ? '' : 's'} suspiciously low vs the field — likely missing scope. Read the exclusions before awarding.
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Ranked by leveled cost</Text>
          {report.bids.map(b => <BidRow key={b.bid.id} b={b} t={t} styles={styles} />)}

          <Text style={styles.note}>
            Leveled cost = the bid plus an adjustment for the scope it excludes, so every bid is
            compared on the same scope. &ldquo;Best value&rdquo; is the lowest leveled cost that isn&apos;t a
            suspicious lowball. Terms/availability are shown per bid — confirm schedule before you award.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function BidRow({ b, t, styles }: { b: LeveledBid; t: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  const overBudget = b.vsBudget > 0;
  return (
    <View style={[styles.bidCard, b.isRecommended && { borderColor: t.success, borderWidth: 1.5 }]}>
      <View style={styles.bidTop}>
        <View style={[styles.rankPill, { backgroundColor: (b.isRecommended ? t.success : t.textMuted) + '1F' }]}>
          <Text style={[styles.rankNum, { color: b.isRecommended ? t.success : t.textSecondary }]}>{b.rank}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bidVendor} numberOfLines={1}>{b.vendor}</Text>
          <View style={styles.badgeRow}>
            {b.isRecommended && <Badge label="Best value" color={t.success} styles={styles} />}
            {b.isCheapestRaw && <Badge label="Cheapest bid" color={t.accent} styles={styles} icon={<BadgeDollarSign size={10} color={t.accent} />} />}
            {b.outlierLow && <Badge label="Suspiciously low" color={t.danger} styles={styles} />}
          </View>
        </View>
        <View style={styles.bidAmounts}>
          <Text style={styles.bidLeveled}>{formatMoneyFull(b.leveledAmount)}</Text>
          {b.adjustment > 0
            ? <Text style={styles.bidRaw}>{formatMoneyFull(b.rawAmount)} + {formatMoney(b.adjustment)}</Text>
            : <Text style={styles.bidRaw}>as bid</Text>}
          <Text style={[styles.bidVsBudget, { color: overBudget ? t.danger : t.success }]}>{overBudget ? '+' : '−'}{formatMoney(Math.abs(b.vsBudget))} vs budget</Text>
        </View>
      </View>
      {b.excludes.length > 0 && (
        <Text style={styles.bidExcludes}><Text style={{ fontWeight: '700', color: t.accentHot }}>Excludes:</Text> {b.excludes}{b.bid.normalizedAdjustmentReason ? ` — leveled: ${b.bid.normalizedAdjustmentReason}` : ''}</Text>
      )}
      {b.terms.length > 0 && <Text style={styles.bidTerms}>Terms: {b.terms}</Text>}
    </View>
  );
}

function Badge({ label, color, styles, icon }: { label: string; color: string; styles: ReturnType<typeof makeStyles>; icon?: React.ReactNode }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '1F' }]}>
      {icon}
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function safeParse(s: string | undefined): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
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

  recoCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, padding: 16, marginBottom: 12, gap: 3 },
  recoHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  recoLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, letterSpacing: 0.6, color: t.success },
  recoVendor: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 2 },
  recoAmount: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text },
  recoLeveled: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textMuted },
  recoReason: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18, marginTop: 2 },

  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent + '14', borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.accent + '33',
    paddingVertical: 12, marginBottom: 8,
  },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },
  aiMsg: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginBottom: 12, lineHeight: 17 },

  kpiRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 12 },
  kpiCard: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, padding: 14, gap: 2 },
  kpiLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  kpiValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  kpiSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  warn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: t.danger + '14', borderRadius: Tokens.radius.card, padding: 12, marginBottom: 14 },
  warnText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },

  bidCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 8, gap: 6 },
  bidTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  rankPill: { width: 30, height: 30, borderRadius: Tokens.radius.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  rankNum: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
  bidVendor: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  badgeRow: { flexDirection: 'row' as const, gap: 5, flexWrap: 'wrap' as const, marginTop: 3 },
  badge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.xs },
  badgeText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const },
  bidAmounts: { alignItems: 'flex-end' as const },
  bidLeveled: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },
  bidRaw: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  bidVsBudget: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  bidExcludes: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  bidTerms: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },
});
