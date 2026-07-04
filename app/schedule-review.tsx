// schedule-review.tsx — review-and-refine step for the AI draft schedule.
//
// generative-setup stashes an AutoScheduleResult via stashDraft(); this screen
// takes it once on mount, shows the draft grouped by phase with each task's
// rationale (and an assumption flag when the AI guessed), lets the GC
// regenerate any single phase, and only commits to the project when the GC taps
// "Use this schedule". Nothing is written to the project until then.

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Sparkles, AlertTriangle, RefreshCcw, Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import EmptyState from '@/components/EmptyState';
import { takeDraft, generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ScheduleTask } from '@/types';

// The theme has no `warning` key; the assumption flag uses this amber literal.
const ASSUMPTION_COLOR = '#c47f17';

export default function ScheduleReviewScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { getProject, updateProject } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);

  const [draft] = useState(() => takeDraft());
  const [tasks, setTasks] = useState<ScheduleTask[]>(draft?.tasks ?? []);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const byPhase = useMemo(() => {
    const m = new Map<string, ScheduleTask[]>();
    tasks.forEach(task => {
      const k = task.phase || 'General';
      m.set(k, [...(m.get(k) ?? []), task]);
    });
    return Array.from(m.entries());
  }, [tasks]);

  const assumptionCount = useMemo(() => tasks.filter(x => x.assumption).length, [tasks]);

  const accept = useCallback(() => {
    if (!project || !draft) return;
    updateProject(project.id, { schedule: { ...draft.schedule, tasks } });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace({ pathname: '/schedule-pro', params: { projectId: project.id } } as any);
  }, [project, draft, tasks, updateProject, router]);

  const regeneratePhase = useCallback(async (phase: string) => {
    if (!project?.linkedEstimate) return;
    setRegenerating(phase);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const fresh = await generateScheduleFromEstimate(project, project.linkedEstimate);
      const freshForPhase = fresh.tasks.filter(x => (x.phase || 'General') === phase);
      setTasks(prev => [...prev.filter(x => (x.phase || 'General') !== phase), ...freshForPhase]);
    } catch (e) {
      console.warn('[schedule-review] regenerate failed:', e);
    } finally {
      setRegenerating(null);
    }
  }, [project]);

  // Empty state — nothing was stashed (deep link / reload).
  if (!draft) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerEyebrow}>Review schedule · MAGE</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>Draft schedule</Text>
          </View>
          <View style={styles.headerBtn} />
        </View>
        <EmptyState
          icon={<Sparkles size={36} color={t.accent} strokeWidth={1.6} />}
          title="No draft to review"
          message="Generate a draft schedule from Generative Setup, then come back here to review it before applying."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Review schedule · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Draft schedule'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryRow}>
          <Sparkles size={16} color={t.accent} strokeWidth={1.75} />
          <Text style={styles.summaryText}>
            {tasks.length} task{tasks.length === 1 ? '' : 's'} across {byPhase.length} phase{byPhase.length === 1 ? '' : 's'}
            {assumptionCount > 0 ? ` · ${assumptionCount} assumption${assumptionCount === 1 ? '' : 's'} to confirm` : ''}
          </Text>
        </View>

        {byPhase.map(([phase, phaseTasks]) => {
          const busy = regenerating === phase;
          return (
            <View key={phase} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{phase}</Text>
                  <Text style={styles.cardSub}>{phaseTasks.length} task{phaseTasks.length === 1 ? '' : 's'}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.regenBtn, busy && styles.regenBtnBusy]}
                  onPress={() => regeneratePhase(phase)}
                  disabled={!!regenerating || !project?.linkedEstimate}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Regenerate ${phase}`}
                >
                  {busy ? (
                    <>
                      <ActivityIndicator size="small" color={t.accent} />
                      <Text style={styles.regenText}>Regenerating…</Text>
                    </>
                  ) : (
                    <>
                      <RefreshCcw size={13} color={t.accent} strokeWidth={2} />
                      <Text style={styles.regenText}>Regenerate</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.cardBody}>
                {phaseTasks.map(task => (
                  <View key={task.id} style={styles.taskRow}>
                    <View style={styles.taskTitleRow}>
                      <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                      {task.assumption && (
                        <View style={styles.assumptionChip}>
                          <AlertTriangle size={11} color={ASSUMPTION_COLOR} strokeWidth={2} />
                          <Text style={styles.assumptionText}>assumed</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.taskMeta}>
                      {task.durationDays}d · crew {task.crewSize ?? '—'}
                    </Text>
                    {task.rationale ? (
                      <Text style={styles.taskRationale}>{task.rationale}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.cta, (!project || !!regenerating) && styles.ctaDisabled]}
          onPress={accept}
          disabled={!project || !!regenerating}
          activeOpacity={0.85}
          testID="accept-schedule"
        >
          <Check size={17} color={Colors.textOnAccent} strokeWidth={2.5} />
          <Text style={styles.ctaText}>Use this schedule</Text>
        </TouchableOpacity>
      </View>
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

  summaryRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 16,
  },
  summaryText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 16, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },

  regenBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: t.accentSoft, backgroundColor: t.accentSoft,
  },
  regenBtnBusy: { opacity: 0.7 },
  regenText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },

  cardBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line, gap: 14 },

  taskRow: { gap: 3 },
  taskTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  taskTitle: { flexShrink: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  taskMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  taskRationale: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontStyle: 'italic' as const, lineHeight: 17, marginTop: 1 },

  assumptionChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(196,127,23,0.12)',
  },
  assumptionText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: ASSUMPTION_COLOR, letterSpacing: 0.2 },

  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, backgroundColor: t.bg,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  cta: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 16,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
