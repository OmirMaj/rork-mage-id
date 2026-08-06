import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronRight, CheckCircle2, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  createId,
  buildScheduleFromTasks,
} from '@/utils/scheduleEngine';
import { ScheduleOnRamp } from '@/components/schedule/ScheduleOnRamp';
import type { OnRampPath } from '@/utils/scheduleOnRamp';
import { seedDemoSchedule } from '@/utils/demoSchedule';

export default function DiscoverScheduleTool() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const s = useThemedStyles(makeStyles);
  const { projects, addProject, updateProject } = useProjects();

  const projectsWithSchedules = projects.filter(p => p.schedule && p.schedule.tasks.length > 0);

  /** Open a project's schedule. The classic schedule defaults to projects[0]
   *  and only honours an explicit projectId plus a `focus` nonce, so omitting
   *  either dropped the user on the WRONG project's schedule. */
  const openSchedule = useCallback((projectId: string) => {
    router.replace({
      pathname: '/(tabs)/schedule',
      params: { projectId, focus: String(Date.now()) },
    } as any);
  }, [router]);

  /**
   * Handle all on-ramp path selections. Discover operates without a single
   * selected project, so hasEstimate is always false (hero = interview).
   * Paths that do need a project (blank, template, voice) route through the
   * wizard / copilot which have their own project-selection step.
   */
  const handleOnRampPick = useCallback((path: OnRampPath) => {
    switch (path) {
      case 'estimate':
        // hasEstimate is always false here so this arm is unreachable in
        // practice — the hero will always be 'interview'. Guard it gracefully
        // by routing to the interview instead.
        router.push({ pathname: '/schedule-builder' } as any);
        break;

      case 'interview':
        // AI guided interview → schedule-builder (no project context required;
        // the builder picks or creates one inside).
        router.push({ pathname: '/schedule-builder' } as any);
        break;

      case 'blank':
        // Start-from-scratch wizard path — picks project inside the wizard.
        router.push('/schedule-wizard?scratch=1' as any);
        break;

      case 'template':
        // Template wizard — opens the wizard with no template preselected so
        // the user sees the template list inside the wizard step.
        router.push({ pathname: '/schedule-wizard' } as any);
        break;

      case 'voice':
        // Copilot voice path. canBuildByVoice is always false here (no project
        // context) so this row is hidden — guard anyway.
        router.push({ pathname: '/copilot', params: { capabilityId: 'schedule' } } as any);
        break;

      case 'example': {
        // Seed the real 35-task residential demo schedule — NOT a free-form AI
        // modal. Creates a new project (same pattern as the former AI generate
        // path) so the user has something concrete to explore immediately.
        const demoTasks = seedDemoSchedule();
        const now = new Date().toISOString();
        const newProject: Project = {
          id: createId('project'),
          name: 'Example: Residential Build',
          type: 'new_build',
          location: 'United States',
          squareFootage: 2200,
          quality: 'standard',
          description: 'Demo schedule — 35 tasks, 6 phases, realistic dependencies.',
          createdAt: now,
          updatedAt: now,
          estimate: null,
          status: 'draft',
        };
        const demoSchedule = buildScheduleFromTasks(
          'Example Schedule',
          newProject.id,
          demoTasks,
          undefined,
          { startDate: now.slice(0, 10) },
        );
        newProject.schedule = { ...demoSchedule, projectId: newProject.id, updatedAt: now };
        addProject(newProject);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        openSchedule(newProject.id);
        break;
      }

      case 'manual':
        // Manual / quick-add → scratch wizard (same as blank; the wizard's
        // empty-task row is ready to type into immediately).
        router.push('/schedule-wizard?scratch=1' as any);
        break;
    }
  }, [addProject, openSchedule, router]);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Schedule Builder' }} />
      <ScrollView
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Shared on-ramp — identical front door as the Schedule tab.
            Discover has no project context so hasEstimate is always false
            (hero = interview) and canBuildByVoice is false (no linked
            estimate to ground the copilot). */}
        <ScheduleOnRamp
          hasEstimate={false}
          canBuildByVoice={false}
          onPick={handleOnRampPick}
        />

        {/* Existing schedules — unchanged from before. */}
        {projectsWithSchedules.length > 0 && (
          <View style={s.existingSection}>
            <Text style={s.sectionTitle}>Existing Schedules</Text>
            {projectsWithSchedules.map(project => (
              <TouchableOpacity
                key={project.id}
                style={s.existingCard}
                onPress={() => openSchedule(project.id)}
                activeOpacity={0.7}
              >
                <View style={s.existingIconWrap}>
                  <CheckCircle2 size={18} color={Colors.success} strokeWidth={1.75} />
                </View>
                <View style={s.templateInfo}>
                  <Text style={s.templateName}>{project.name}</Text>
                  <View style={s.existingMeta}>
                    <Clock size={12} color={Colors.textMuted} strokeWidth={1.75} />
                    <Text style={s.templateMeta}>
                      {project.schedule?.tasks.length} tasks · {project.schedule?.totalDurationDays}d
                    </Text>
                    {project.schedule?.healthScore && (
                      <View style={[s.healthBadge, { backgroundColor: (project.schedule.healthScore > 70 ? Colors.success : Colors.warning) + '18' }]}>
                        <Text style={[s.healthText, { color: project.schedule.healthScore > 70 ? Colors.success : Colors.warning }]}>
                          {project.schedule.healthScore}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Theme-aware styles. Previously a module-scope StyleSheet.create() which
// baked Colors.background/surface/text/etc. at module load time — breaking
// dark mode on a main-tab front door. Converted to makeStyles(t) +
// useThemedStyles() so styles re-resolve on every theme change.
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scrollContent: { flexGrow: 1 },
  existingSection: { paddingHorizontal: 16, marginTop: 8 },
  sectionTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: 10,
  },
  existingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  existingIconWrap: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.success + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  templateMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  existingMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  healthBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
  },
  healthText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
});
