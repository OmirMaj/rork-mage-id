// BidConfidenceBadge — surfaces the cost-learning moat where estimates live.
//
// Reuses the existing engines (buildCostDatabase + computeEstimateConfidence)
// to score how much of an estimate is backed by the contractor's OWN proven
// costs, then renders a compact, tappable pill. Tapping opens the full
// estimate-confidence breakdown. Renders nothing when there's no estimate.
//
// Two variants: 'hero' (white-on-accent, for the project-detail hero card) and
// 'light' (for normal surfaces).

import React, { useMemo } from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import type { Project } from '@/types';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { buildCostDatabase } from '@/utils/costDatabase';
import { computeEstimateConfidence } from '@/utils/estimateConfidence';

interface Props {
  project: Project;
  variant?: 'hero' | 'light';
}

function tierColor(score: number): string {
  if (score >= 70) return '#2FBF71'; // green
  if (score >= 40) return '#F5A524'; // amber
  return '#E5484D'; // red
}

export default function BidConfidenceBadge({ project, variant = 'light' }: Props) {
  const { projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();

  const report = useMemo(() => {
    const db = buildCostDatabase(projects, commitments, receipts);
    return computeEstimateConfidence(project, db);
  }, [project, projects, commitments, receipts]);

  const router = useRouter();

  // No estimate → nothing to score.
  if (!report.hasEstimate) return null;

  const onHero = variant === 'hero';
  const dot = report.hasHistory ? tierColor(report.score) : (onHero ? 'rgba(255,255,255,0.6)' : '#8A8F98');
  const textColor = onHero ? '#FFFFFF' : '#0B0D10';
  const subColor = onHero ? 'rgba(255,255,255,0.7)' : '#6B6F76';

  return (
    <TouchableOpacity
      style={[styles.pill, onHero ? styles.pillHero : styles.pillLight]}
      activeOpacity={0.75}
      onPress={() => router.push({ pathname: '/estimate-confidence' as never, params: { projectId: project.id } as never })}
      accessibilityRole="button"
      accessibilityLabel={report.hasHistory ? `Bid confidence ${report.score} out of 100` : 'Bid confidence — building from your jobs'}
      testID="bid-confidence-badge"
    >
      <ShieldCheck size={13} color={onHero ? '#FFFFFF' : dot} strokeWidth={2} />
      {report.hasHistory ? (
        <>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={[styles.label, { color: textColor }]}>Bid Confidence </Text>
          <Text style={[styles.score, { color: textColor }]}>{report.score}</Text>
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: textColor }]}>Bid Confidence</Text>
          <Text style={[styles.sub, { color: subColor }]}>building from your jobs</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pillHero: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  pillLight: {
    backgroundColor: 'rgba(11,13,16,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(11,13,16,0.1)',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  score: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 11, fontWeight: '600' },
});
