// sub-scorecard.tsx — every sub graded from the GC's real job data.
//
// The Subs tab knows who exists; this knows who is GOOD. Runs
// utils/subScorecard over the signed commitments + compliance dates already
// in memory and renders a ranked list — grade chip, score, trade, and the
// one-line top driver — with an inline expandable factor breakdown per sub.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ChevronDown, ChevronUp, Award, HardHat } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { computeSubScorecards, type SubGrade, type SubScorecard } from '@/utils/subScorecard';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function colorForGrade(grade: SubGrade, t: ThemeColors): string {
  switch (grade) {
    case 'A': return t.success;
    case 'B': return t.accent;
    case 'C': return t.accentHot;
    case 'D': return t.accentHot;
    case 'F': return t.danger;
  }
}

const CONFIDENCE_LABEL: Record<SubScorecard['confidence'], string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export default function SubScorecardScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Sub Scorecard"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <SubScorecardInner />;
}

function SubScorecardInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subcontractors, commitments, changeOrders } = useProjects();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const result = useMemo(
    () => computeSubScorecards({ subcontractors, commitments, changeOrders }),
    [subcontractors, commitments, changeOrders],
  );

  if (subcontractors.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: 'Sub Scorecard' }} />
        <EmptyState
          icon={<HardHat size={36} color={t.accent} strokeWidth={1.6} />}
          title="No subs to grade yet"
          message="The Sub Scorecard grades every subcontractor from your real job costs — closed-commitment overruns, change-order creep, and paperwork standing. To see it:"
          steps={[
            'Add subcontractors from the Subs tab.',
            'Award commitments to them through Buyout.',
            'Come back to see who actually earns the next call.',
          ]}
          actionLabel="Open Subs"
          onAction={() => router.push('/(tabs)/subs' as any)}
        />
      </View>
    );
  }

  const graded = result.cards.filter(c => !c.noHistory).length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Sub Scorecard · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Who earns the next call</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <Text style={styles.lede}>
          {graded > 0
            ? `${result.cards.length} sub${result.cards.length === 1 ? '' : 's'} ranked from your signed commitments and compliance records. ${graded} ha${graded === 1 ? 's' : 've'} job history behind the grade.`
            : `${result.cards.length} sub${result.cards.length === 1 ? '' : 's'} on file — none with signed commitments yet, so grades reflect paperwork only. Award work through Buyout and the scores get real.`}
        </Text>

        {result.cards.map(card => {
          const gc = colorForGrade(card.grade, t);
          const expanded = expandedId === card.subId;
          const bestInTrade = result.bestByTrade[card.trade] === card.subId && graded > 0 && !card.noHistory;
          return (
            <TouchableOpacity
              key={card.subId}
              style={[styles.card, expanded && { borderColor: gc }]}
              onPress={() => setExpandedId(expanded ? null : card.subId)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${card.companyName}, grade ${card.grade}, score ${card.score}`}
            >
              <View style={styles.cardTop}>
                <View style={[styles.gradeChip, { backgroundColor: gc + '22' }]}>
                  <Text style={[styles.gradeChipText, { color: gc }]}>{card.grade}</Text>
                </View>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardName} numberOfLines={1}>{card.companyName}</Text>
                  <View style={styles.cardMetaRow}>
                    <Text style={styles.cardTrade}>{card.trade}</Text>
                    {bestInTrade && (
                      <View style={styles.bestChip}>
                        <Award size={11} color={t.success} />
                        <Text style={styles.bestChipText}>Best {card.trade}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.scoreWrap}>
                  <Text style={[styles.scoreText, { color: gc }]}>{card.score}</Text>
                  <Text style={styles.scoreOutOf}>/ 100</Text>
                </View>
                {expanded
                  ? <ChevronUp size={16} color={t.textMuted} />
                  : <ChevronDown size={16} color={t.textMuted} />}
              </View>

              <Text style={styles.topDriver} numberOfLines={expanded ? undefined : 2}>{card.topDriver}</Text>

              {expanded && (
                <View style={styles.breakdown}>
                  {card.factors.map(f => {
                    const fc = !f.applicable ? t.textMuted : f.score < 0.4 ? t.danger : f.score < 0.75 ? t.accentHot : t.success;
                    return (
                      <View key={f.key} style={styles.factorRow}>
                        <View style={styles.factorTop}>
                          <Text style={styles.factorLabel}>{f.label}</Text>
                          <Text style={[styles.factorScore, { color: fc }]}>
                            {f.applicable ? Math.round(f.score * 100) : '—'}
                          </Text>
                        </View>
                        <View style={styles.miniTrack}>
                          <View style={[styles.miniFill, { width: `${f.applicable ? Math.round(f.score * 100) : 0}%` as any, backgroundColor: fc }]} />
                        </View>
                        <Text style={styles.factorDetail}>{f.detail}</Text>
                      </View>
                    );
                  })}
                  <View style={styles.statsRow}>
                    <Text style={styles.statText}>{card.commitmentCount} commitment{card.commitmentCount === 1 ? '' : 's'}</Text>
                    <Text style={styles.statDot}>·</Text>
                    <Text style={styles.statText}>{card.closedCommitmentCount} closed</Text>
                    <Text style={styles.statDot}>·</Text>
                    <Text style={styles.statText}>{CONFIDENCE_LABEL[card.confidence]}</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <Text style={styles.note}>
          Grades blend cost discipline on closed commitments, change-order growth on
          signed work, and today&apos;s COI / license / W-9 standing. History depth moves
          confidence, not the grade — a new sub with clean paper isn&apos;t punished, just
          unproven.
        </Text>
      </ScrollView>
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

  lede: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginBottom: 14 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    padding: 14, marginBottom: 10, gap: 8,
  },
  cardTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  gradeChip: {
    width: 38, height: 38, borderRadius: Tokens.radius.full,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  gradeChipText: { fontSize: Type.headline.fontSize, fontWeight: '800' as const },
  cardTitleWrap: { flex: 1, gap: 2 },
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardMetaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  cardTrade: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  bestChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3,
    backgroundColor: t.success + '18', borderRadius: Tokens.radius.full,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  bestChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.success },
  scoreWrap: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: 2 },
  scoreText: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, letterSpacing: -0.5 },
  scoreOutOf: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, marginBottom: 2 },

  topDriver: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  breakdown: { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10, gap: 12 },
  factorRow: { gap: 5 },
  factorTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  factorLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  factorScore: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const },
  miniTrack: { height: 5, borderRadius: Tokens.radius.full, backgroundColor: t.line, overflow: 'hidden' as const },
  miniFill: { height: 5, borderRadius: Tokens.radius.full },
  factorDetail: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16 },
  statsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  statText: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  statDot: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 6 },
});
