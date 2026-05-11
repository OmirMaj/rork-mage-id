// sub-scorecards.tsx — per-subcontractor performance scorecard.
//
// Pre-fix the GC had no way to compare subs at a glance. Subcontractor
// detail showed each sub's contact info + COI + W9 status, but
// answered no operational questions:
//   - "Who finishes their tasks on time?"
//   - "Who's slow to respond to RFIs?"
//   - "Whose work generates the most change orders?"
//
// This screen aggregates those metrics across every project the GC
// runs. Each sub gets one card with three numbers + a 0-100 composite
// score. Tap a card → opens the existing sub detail screen.
//
// Math: deliberately simple, deliberately conservative.
//   - On-time %: (tasks finished on/before deadline) / (tasks finished)
//     where finished = status 'done' AND actualEndDay ≤ baseline end.
//     A sub with no finished tasks shows "—" instead of 100% (don't
//     reward an empty roster).
//   - Avg RFI response: mean of (dateResponded - dateSubmitted) days,
//     across RFIs assigned to this sub OR submitted by them, only
//     counting RFIs that actually got a response. NaN-clean.
//   - CO impact: $ change orders attributable to this sub / total
//     project value of projects this sub touched. We can't perfectly
//     attribute COs to subs without explicit linkage; v1 surfaces
//     "COs on this sub's projects" as a coarse signal, with a note.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Star, ChevronRight, AlertTriangle, Award, Clock, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import EmptyState from '@/components/ui/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface SubScore {
  subId: string;
  companyName: string;
  trade: string;
  // Counts
  finishedTasks: number;
  onTimeTasks: number;
  rfisAnswered: number;
  rfiAvgResponseDays: number | null;
  /**
   * # change orders attributable to this sub. Reads
   * ChangeOrder.subcontractorId when set; falls back to "COs on
   * any project this sub worked on" when no CO has been tagged
   * for this sub yet. The `coTouchesAttribution` flag below tells
   * the UI which signal it's showing.
   */
  changeOrderTouches: number;
  /**
   * 'direct' = subcontractorId === sub.id on at least one CO.
   * 'project' = coarse fallback (CO on a shared project, no
   * subcontractorId set). 'none' = no COs at all.
   */
  coTouchesAttribution: 'direct' | 'project' | 'none';
  // Derived
  onTimePct: number | null;
  composite: number; // 0-100
}

function pctLabel(p: number | null): string {
  if (p == null) return '—';
  return `${Math.round(p * 100)}%`;
}

function daysLabel(d: number | null): string {
  if (d == null) return '—';
  if (d < 1) return '<1 day';
  return `${d.toFixed(1)} days`;
}

function scoreColor(score: number): string {
  if (score >= 80) return Colors.success;
  if (score >= 60) return Colors.warning;
  return Colors.error;
}

export default function SubScorecardsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subcontractors, projects, rfis, changeOrders } = useProjects();

  const scores = useMemo<SubScore[]>(() => {
    const out: SubScore[] = [];

    for (const sub of subcontractors) {
      // 1. Tasks: walk every project's schedule, find tasks where
      //    assignedSubId === sub.id (or assignedSubName matches by
      //    name when id missing, for legacy rows). Only count tasks
      //    with status 'done' as "finished."
      let finished = 0;
      let onTime = 0;
      const subProjectIds = new Set<string>();
      for (const p of projects) {
        const tasks = p.schedule?.tasks ?? [];
        for (const t of tasks) {
          const matches = t.assignedSubId === sub.id
            || (t.assignedSubName && sub.companyName && t.assignedSubName.toLowerCase() === sub.companyName.toLowerCase());
          if (!matches) continue;
          subProjectIds.add(p.id);
          if (t.status !== 'done') continue;
          finished++;
          // On-time: actualEndDay <= baselineEndDay (or planned end if
          // no baseline). Without an actualEndDay we can't judge; treat
          // as on-time-by-default (don't penalize the sub for the GC's
          // missing data entry).
          const planned = t.baselineEndDay ?? (t.startDay + t.durationDays - 1);
          const actual = t.actualEndDay;
          if (actual == null || actual <= planned) onTime++;
        }
      }
      const onTimePct = finished > 0 ? onTime / finished : null;

      // 2. RFIs: response time mean. We attribute by submittedBy +
      //    assignedTo string match (legacy field; sub.companyName
      //    typically used).
      const subRfis = rfis.filter(r => {
        const name = sub.companyName.toLowerCase();
        return (r.submittedBy ?? '').toLowerCase() === name
          || (r.assignedTo ?? '').toLowerCase() === name;
      });
      const responded = subRfis.filter(r => r.dateResponded);
      const rfiAvgResponseDays = responded.length > 0
        ? responded.reduce((acc, r) => {
            const a = Date.parse(r.dateSubmitted);
            const b = Date.parse(r.dateResponded!);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return acc;
            return acc + (b - a) / 86_400_000;
          }, 0) / responded.length
        : null;

      // 3. CO impact. Two signals here, preferring the precise one
      //    when available:
      //    a) Direct attribution: COs where subcontractorId === sub.id.
      //       Counts only COs the GC explicitly tagged to this sub.
      //    b) Coarse fallback: COs on any project the sub touched
      //       AND with no subcontractorId set. Surfaces a pre-fix
      //       signal for old data while we transition to direct
      //       attribution.
      //    The metric label below switches between "attributed" and
      //    "on shared projects" so the GC can read which signal
      //    they're seeing.
      const directCoTouches = changeOrders.filter(co => co.subcontractorId === sub.id).length;
      const coarseCoTouches = changeOrders.filter(co => !co.subcontractorId && subProjectIds.has(co.projectId)).length;
      const coTouches = directCoTouches > 0 ? directCoTouches : coarseCoTouches;

      // 4. Composite score. Weighted:
      //    - on-time: 50 points (heaviest signal of execution)
      //    - rfi response: 30 points (collaboration signal)
      //    - co touches: 20 points inverted (fewer COs = better)
      //    Subs with no data on a metric get the metric's full points
      //    so we don't penalize new subs.
      const onTimePoints = onTimePct == null ? 50 : Math.round(onTimePct * 50);
      const rfiPoints = rfiAvgResponseDays == null
        ? 30
        : rfiAvgResponseDays <= 1 ? 30
          : rfiAvgResponseDays <= 3 ? 24
          : rfiAvgResponseDays <= 7 ? 16
          : 8;
      const coPoints = coTouches === 0 ? 20
        : coTouches <= 2 ? 14
        : coTouches <= 5 ? 8
        : 4;
      const composite = onTimePoints + rfiPoints + coPoints;

      out.push({
        subId: sub.id,
        companyName: sub.companyName,
        trade: sub.trade,
        finishedTasks: finished,
        onTimeTasks: onTime,
        rfisAnswered: responded.length,
        rfiAvgResponseDays,
        changeOrderTouches: coTouches,
        coTouchesAttribution: directCoTouches > 0 ? 'direct'
          : coarseCoTouches > 0 ? 'project'
          : 'none',
        onTimePct,
        composite,
      });
    }

    // Sort: composite DESC, then by company name.
    out.sort((a, b) => b.composite - a.composite || a.companyName.localeCompare(b.companyName));
    return out;
  }, [subcontractors, projects, rfis, changeOrders]);

  if (scores.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Sub Scorecards' }} />
        <EmptyState
          icon={<Award size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No scorecards yet"
          message="Add subcontractors and assign them to schedule tasks. Each sub's scorecard rolls up automatically — on-time %, RFI response time, and change-order touches across every project."
          actionLabel="Open Subs"
          onAction={() => router.push('/(tabs)/subcontractors-list' as never)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{ title: 'Sub Scorecards', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }}
      />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sub performance</Text>
          <Text style={styles.headerSub}>Sorted by composite score across all your projects</Text>
        </View>

        {scores.map((s, i) => (
          <TouchableOpacity
            key={s.subId}
            style={styles.card}
            onPress={() => router.push({ pathname: '/sub-portal-setup' as never, params: { subId: s.subId } as never })}
            activeOpacity={0.85}
            testID={`sub-scorecard-${s.subId}`}
          >
            <View style={styles.cardHead}>
              <View style={[styles.rankBadge, { backgroundColor: scoreColor(s.composite) + '20' }]}>
                <Star size={12} color={scoreColor(s.composite)} />
                <Text style={[styles.rankBadgeText, { color: scoreColor(s.composite) }]}>{s.composite}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardCompany} numberOfLines={1}>{s.companyName}</Text>
                <Text style={styles.cardTrade} numberOfLines={1}>{s.trade} · #{i + 1} of {scores.length}</Text>
              </View>
              <ChevronRight size={16} color={Colors.textMuted} />
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricCell}>
                <View style={styles.metricIconWrap}>
                  <Award size={11} color={Colors.success} />
                </View>
                <Text style={styles.metricLabel}>On time</Text>
                <Text style={styles.metricValue}>{pctLabel(s.onTimePct)}</Text>
                <Text style={styles.metricSub}>{s.onTimeTasks}/{s.finishedTasks} tasks</Text>
              </View>
              <View style={styles.metricCell}>
                <View style={styles.metricIconWrap}>
                  <Clock size={11} color={Colors.info} />
                </View>
                <Text style={styles.metricLabel}>RFI reply</Text>
                <Text style={styles.metricValue}>{daysLabel(s.rfiAvgResponseDays)}</Text>
                <Text style={styles.metricSub}>{s.rfisAnswered} answered</Text>
              </View>
              <View style={styles.metricCell}>
                <View style={styles.metricIconWrap}>
                  <FileText size={11} color={Colors.warning} />
                </View>
                <Text style={styles.metricLabel}>CO touches</Text>
                <Text style={styles.metricValue}>{s.changeOrderTouches}</Text>
                <Text style={styles.metricSub}>
                  {s.coTouchesAttribution === 'direct' ? 'attributed to sub'
                    : s.coTouchesAttribution === 'project' ? 'on shared projects'
                    : '—'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        <View style={styles.footer}>
          <AlertTriangle size={12} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            CO touches is &quot;attributed to sub&quot; when at least one change order on this sub has its subcontractor tagged in the CO create flow. Until you tag any, it falls back to a coarse signal (any CO on a shared project) — set the sub on a CO from the change-order screen to switch this row to direct attribution.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, marginTop: 6, marginBottom: 12 },
  headerTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.4 },
  headerSub: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, marginTop: 2 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg,
    marginHorizontal: 16, marginBottom: 10, padding: 14,
    borderWidth: 1, borderColor: Colors.borderLight,
    gap: 12,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  rankBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: Tokens.radius.sm,
  },
  rankBadgeText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '900' as const, letterSpacing: -0.3 },
  cardCompany: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.text },
  cardTrade: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2 },

  metricRow: { flexDirection: 'row' as const, gap: 8 },
  metricCell: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm, backgroundColor: Colors.surfaceAlt,
    alignItems: 'flex-start' as const, gap: 2,
  },
  metricIconWrap: { marginBottom: 2 },
  metricLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  metricValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.3 },
  metricSub: { fontSize: 10, color: Colors.textMuted },

  footer: { flexDirection: 'row' as const, gap: 8, alignItems: 'flex-start' as const, paddingHorizontal: 18, paddingVertical: 16, opacity: 0.75 },
  footerText: { flex: 1, fontSize: Type.caption2.fontSize, color: Colors.textMuted, lineHeight: 14 },
});
