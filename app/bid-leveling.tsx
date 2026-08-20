// bid-leveling.tsx — level a buyout package's bids into an honest decision.
//
// Raw bids lie: the lowball that "wins" is usually the one that excluded the
// blocking, the permit, and the dumpster. This screen ranks bids by their
// LEVELED cost (raw + adjustment for excluded scope), flags suspiciously-low
// outliers, surfaces every exclusion, and recommends the best honest value vs.
// the budget. "AI-level" asks the model to price each bid's exclusions so the
// comparison is apples-to-apples.
//
// Grounding: when the GC has a learned cost book, the leveling engine uses
// those rates and marks each row 'your_history' vs 'market_guess' so the
// GC knows which adjustments came from real data and which are model estimates.
//
// Pure ranking in utils/bidLeveling; AI call routes through bidLevelingEngine.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Scale, Trophy, BadgeDollarSign, AlertTriangle, Star } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  computeBidLeveling,
  type LeveledBid,
} from '@/utils/bidLeveling';
import { levelBids, type AdjustmentBasis } from '@/utils/bidLevelingEngine';
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
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { packageId } = useLocalSearchParams<{ packageId?: string }>();
  const { projects, commitments, getBidPackage, getBidsForPackage, getSubcontractor, updateBidPackageBid } = useProjects();
  const { receipts } = useMaterialReceipts();
  // Cold-start seeds — without them a seeded GC levels bids against an empty
  // cost book and every adjustment degrades to 'market_guess'.
  const { seeds } = useCostSeeds();

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
  // Track adjustmentBasis per bidId from the latest AI level run so we can
  // show grounding chips without persisting a new field on BidPackageBid.
  const [basisMap, setBasisMap] = useState<Record<string, AdjustmentBasis>>({});
  // Track needsAnswer questions from AI (ambiguous inclusions).
  const [questionsMap, setQuestionsMap] = useState<Record<string, string>>({});

  const aiLevel = useCallback(async () => {
    if (!pkg || aiBusy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setAiBusy(true);
    setAiMsg(null);
    try {
      const result = await levelBids({ pkg, bids, projects, commitments, receipts, seeds });
      if (result.adjustments.length === 0) {
        setAiMsg("No adjustments suggested. Add each bid's exclusions and try again.");
        return;
      }
      const newBasis: Record<string, AdjustmentBasis> = {};
      const newQuestions: Record<string, string> = {};
      let applied = 0;
      for (const adj of result.adjustments) {
        if (!adj.bidId || adj.confidence === 0) continue;
        const amount = Math.max(0, Math.round(Number(adj.adjustment) || 0));
        updateBidPackageBid(adj.bidId, {
          normalizedAdjustment: amount,
          normalizedAdjustmentReason: (adj.reason ?? '').slice(0, 240),
        });
        newBasis[adj.bidId] = adj.adjustmentBasis ?? 'market_guess';
        if (adj.needsAnswer) newQuestions[adj.bidId] = adj.needsAnswer;
        applied += 1;
      }
      setBasisMap(prev => ({ ...prev, ...newBasis }));
      setQuestionsMap(prev => ({ ...prev, ...newQuestions }));

      // Check if all adjustments are market_guess (no learned data used)
      const historyCount = Object.values(newBasis).filter(b => b === 'your_history').length;
      const baseMsg = `Leveled ${applied} bid${applied === 1 ? '' : 's'} for excluded scope. Ranking updated.`;
      const groundingNote = historyCount > 0
        ? ` ${historyCount} adjustment${historyCount === 1 ? '' : 's'} priced from your cost history.`
        : ' No learned rates matched — using market estimates. Close more jobs to improve accuracy.';
      setAiMsg(baseMsg + groundingNote);
    } catch (e) {
      setAiMsg(`Leveling hit an error: ${String((e as Error).message ?? e)}`);
    } finally {
      setAiBusy(false);
    }
  }, [pkg, bids, projects, commitments, receipts, seeds, aiBusy, updateBidPackageBid]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Bid Leveling · MAGE ID</Text>
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
        <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
          {/* Recommendation */}
          {report.recommendedId && (() => {
            const rec = report.bids.find(b => b.isRecommended)!;
            return (
              <View style={[styles.recoCard, { borderColor: t.success + '55' }]}>
                <View style={styles.recoHead}>
                  <Trophy size={16} color={t.success} strokeWidth={1.75} />
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
            {aiBusy ? <ActivityIndicator size="small" color={t.accent} /> : <MageAIMark size={16} color={t.accent} />}
            <Text style={styles.aiBtnText}>{aiBusy ? 'Leveling exclusions…' : 'AI-level the exclusions'}</Text>
          </TouchableOpacity>
          {aiMsg && <Text style={styles.aiMsg}>{aiMsg}</Text>}

          {/* Decision-moment CTA: Score with Bid Advisor */}
          <TouchableOpacity
            style={styles.decisionBtn}
            onPress={() => router.push({ pathname: '/judges', params: { projectId: pkg.projectId } } as never)}
            activeOpacity={0.85}
          >
            <Star size={14} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.decisionBtnText}>Score with Bid Advisor</Text>
          </TouchableOpacity>

          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}><Text style={styles.kpiLabel}>Budget</Text><Text style={styles.kpiValue}>{formatMoney(report.budget)}</Text></View>
            <View style={styles.kpiCard}><Text style={styles.kpiLabel}>Field spread</Text><Text style={styles.kpiValue}>{formatMoney(report.spread)}</Text><Text style={styles.kpiSub}>{Math.round(report.spreadPct * 100)}% of median</Text></View>
          </View>

          {report.outlierCount > 0 && (
            <View style={styles.warn}>
              <AlertTriangle size={15} color={t.danger} strokeWidth={1.75} />
              <Text style={styles.warnText}>
                <Text style={{ fontWeight: '800', color: t.danger }}>{report.outlierCount}</Text> bid{report.outlierCount === 1 ? '' : 's'} suspiciously low vs the field — likely missing scope. Read the exclusions before awarding.
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Ranked by leveled cost</Text>
          {report.bids.map(b => (
            <BidRow
              key={b.bid.id}
              b={b}
              t={t}
              styles={styles}
              basis={basisMap[b.bid.id]}
              needsAnswer={questionsMap[b.bid.id]}
              onScorecard={
                b.bid.subcontractorId
                  ? () => router.push({ pathname: '/sub-scorecard', params: { subId: b.bid.subcontractorId } } as never)
                  : undefined
              }
            />
          ))}

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

// ── Basis chip labels ─────────────────────────────────────────────────────────

const BASIS_LABEL: Record<AdjustmentBasis, string> = {
  your_history: 'your history',
  estimate:     'estimate',
  market_guess: 'AI estimate',
};

function BidRow({
  b, t, styles, basis, needsAnswer, onScorecard,
}: {
  b: LeveledBid;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  basis?: AdjustmentBasis;
  needsAnswer?: string;
  onScorecard?: () => void;
}) {
  const overBudget = b.vsBudget > 0;
  const showBasisChip = !!basis && b.adjustment > 0;
  const isHistoryBased = basis === 'your_history';
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
            {b.isCheapestRaw && <Badge label="Cheapest bid" color={t.accent} styles={styles} icon={<BadgeDollarSign size={10} color={t.accent} strokeWidth={1.75} />} />}
            {b.outlierLow && <Badge label="Suspiciously low" color={t.danger} styles={styles} />}
            {showBasisChip && (
              <Badge
                label={BASIS_LABEL[basis!]}
                color={isHistoryBased ? t.success : t.textMuted}
                styles={styles}
              />
            )}
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
      {needsAnswer && (
        <View style={styles.needsAnswerRow}>
          <AlertTriangle size={12} color={t.textMuted} strokeWidth={1.75} />
          <Text style={styles.needsAnswerText}>{needsAnswer}</Text>
        </View>
      )}
      {b.terms.length > 0 && <Text style={styles.bidTerms}>Terms: {b.terms}</Text>}
      {onScorecard && (
        <TouchableOpacity onPress={onScorecard} style={styles.scorecardLink} activeOpacity={0.75}>
          <Text style={styles.scorecardLinkText}>See this sub's scorecard →</Text>
        </TouchableOpacity>
      )}
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

  decisionBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingVertical: 9, marginBottom: 12,
    borderWidth: 1, borderColor: t.accent + '33', borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '0A',
  },
  decisionBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },

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

  needsAnswerRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 5, backgroundColor: t.neutralSoft, borderRadius: Tokens.radius.xs, paddingHorizontal: 8, paddingVertical: 5 },
  needsAnswerText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16 },

  scorecardLink: { alignItems: 'flex-end' as const, paddingTop: 2 },
  scorecardLinkText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '600' as const },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 8 },
});
