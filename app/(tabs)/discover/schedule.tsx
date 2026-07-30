import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronRight, FileText, X, CheckCircle2, Clock, Plus,
} from 'lucide-react-native';
import { MageAIMark, MageSchedule } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';
import type { Project, ScheduleTask, DependencyLink, DependencyType } from '@/types';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  createId,
  buildScheduleFromTasks,
} from '@/utils/scheduleEngine';

export default function DiscoverScheduleTool() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const s = useThemedStyles(makeStyles);
  const { projects, addProject, updateProject } = useProjects();

  const [aiPrompt, setAiPrompt] = useState('');
  const [isAILoading, setIsAILoading] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  // Inline status instead of Alert.alert. react-native-web ships
  // `class Alert { static alert() {} }` — a literal no-op — so every failure
  // AND every success on this screen was invisible on web: you tapped
  // Generate, waited, and nothing appeared to happen.
  const [aiError, setAiError] = useState<string | null>(null);

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

  const handleAIGenerate = useCallback(async (targetProject?: Project | null) => {
    if (!aiPrompt.trim()) {
      setAiError('Describe the project first — a sentence or two is enough.');
      return;
    }
    setAiError(null);
    setIsAILoading(true);
    try {
      const responseSchema = z.object({
        tasks: z.array(z.object({
          id: z.string(),
          name: z.string(),
          phase: z.string(),
          duration: z.number(),
          predecessorIds: z.array(z.string()),
          isMilestone: z.boolean(),
          isCriticalPath: z.boolean(),
          crewSize: z.number(),
          wbs: z.string(),
        })),
      });

      console.log('[Discover Schedule] AI generation starting:', aiPrompt.trim().substring(0, 60));

      const aiResult = await mageAI({
        prompt: `You are a professional construction scheduler. Generate a complete construction schedule for this project. Return a JSON object with a "tasks" array.

Project description: ${aiPrompt.trim()}

Each task in the tasks array must have: id (string like "t1", "t2"), name (string), phase (one of: Site Work, Demo, Foundation, Framing, Roofing, MEP, Plumbing, Electrical, HVAC, Insulation, Drywall, Interior, Finishes, Landscaping, Inspections, General), duration (number of working days), predecessorIds (array of id strings referencing other task ids), isMilestone (boolean), isCriticalPath (boolean), crewSize (number 1-8), wbs (string like "1.1", "2.3").

Include a Project Start milestone (duration 0) and Project Complete milestone (duration 0). Group tasks into logical phases with realistic durations and dependencies. Generate 15-40 tasks depending on project size.`,
        schema: responseSchema,
        tier: 'smart',
        maxTokens: 2000,
      });

      if (!aiResult.success) {
        setAiError(aiResult.error || 'MAGE AI is unavailable right now. Try again in a moment.');
        setIsAILoading(false);
        return;
      }

      let parsed: any = aiResult.data;
      console.log('[Discover Schedule] AI response type:', typeof parsed);

      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          let cleaned = parsed.trim();
          if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
          if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
          if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
          try {
            parsed = JSON.parse(cleaned.trim());
          } catch {
            console.log('[Discover Schedule] Could not parse AI string response');
            setAiError('The generator returned something we could not read. Try again.');
            setIsAILoading(false);
            return;
          }
        }
      }

      let taskArray: any[] | null = null;
      if (Array.isArray(parsed)) {
        taskArray = parsed;
      } else if (parsed && Array.isArray(parsed.tasks)) {
        taskArray = parsed.tasks;
      } else if (parsed && typeof parsed === 'object') {
        const firstArrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
        if (firstArrayKey) taskArray = parsed[firstArrayKey];
      }

      console.log('[Discover Schedule] Parsed tasks count:', taskArray?.length);

      if (!taskArray || taskArray.length === 0) {
        setAiError('No tasks came back. Add more detail — scope, size, and the trades involved.');
        setIsAILoading(false);
        return;
      }

      const safeResult = taskArray.map((t: any, idx: number) => ({
        id: t.id || `t${idx + 1}`,
        name: t.name || t.title || `Task ${idx + 1}`,
        phase: t.phase || 'General',
        duration: typeof t.duration === 'number' ? t.duration : (typeof t.durationDays === 'number' ? t.durationDays : 5),
        predecessorIds: Array.isArray(t.predecessorIds) ? t.predecessorIds : (Array.isArray(t.dependencies) ? t.dependencies : []),
        isMilestone: !!t.isMilestone,
        isCriticalPath: !!t.isCriticalPath,
        crewSize: typeof t.crewSize === 'number' ? t.crewSize : 2,
        wbs: t.wbs || t.wbsCode || `${idx + 1}.0`,
      }));

      const tasks: ScheduleTask[] = safeResult.map((t: any, idx: number) => ({
        id: createId('task'),
        title: t.name,
        phase: t.phase,
        durationDays: Math.max(t.isMilestone ? 0 : 1, t.duration),
        startDay: 1,
        progress: 0,
        crew: `Crew ${idx + 1}`,
        crewSize: t.crewSize,
        dependencies: [],
        dependencyLinks: [],
        notes: '',
        status: 'not_started' as const,
        isMilestone: t.isMilestone,
        wbsCode: t.wbs,
        isCriticalPath: t.isCriticalPath,
        isWeatherSensitive: false,
      }));

      const idMap = new Map<string, string>();
      safeResult.forEach((t: any, idx: number) => {
        idMap.set(t.id, tasks[idx].id);
      });

      for (let i = 0; i < tasks.length; i++) {
        const original = safeResult[i];
        tasks[i].dependencyLinks = (original.predecessorIds ?? [])
          .filter((pid: string) => idMap.has(pid))
          .map((pid: string) => ({
            taskId: idMap.get(pid)!,
            type: 'FS' as DependencyType,
            lagDays: 0,
          }));
        tasks[i].dependencies = tasks[i].dependencyLinks!.map((l: DependencyLink) => l.taskId);
      }

      let createdProjectId: string;
      if (targetProject) {
        createdProjectId = targetProject.id;
        const scheduleName = `${targetProject.name} Schedule`;
        const schedule = buildScheduleFromTasks(scheduleName, targetProject.id, tasks, undefined, { startDate: new Date().toISOString().slice(0, 10) });
        updateProject(targetProject.id, {
          schedule: { ...schedule, projectId: targetProject.id, updatedAt: new Date().toISOString() },
        });
      } else {
        const now = new Date().toISOString();
        const projectName = aiPrompt.trim().substring(0, 60);
        const newProject: Project = {
          id: createId('project'),
          name: projectName,
          type: 'renovation',
          location: 'United States',
          squareFootage: 0,
          quality: 'standard',
          description: aiPrompt.trim(),
          createdAt: now,
          updatedAt: now,
          estimate: null,
          status: 'draft',
        };
        const scheduleName = `${projectName} Schedule`;
        const schedule = buildScheduleFromTasks(scheduleName, newProject.id, tasks, undefined, { startDate: now.slice(0, 10) });
        newProject.schedule = { ...schedule, projectId: newProject.id, updatedAt: now };
        addProject(newProject);
        createdProjectId = newProject.id;
      }

      setAiPrompt('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Go straight to the schedule that was just generated. The old
      // "View it now?" Alert was invisible on web (so the schedule appeared
      // never to have been created) AND its navigation omitted the projectId,
      // which landed you on projects[0] rather than this one.
      openSchedule(createdProjectId);
    } catch (err) {
      console.log('[Discover Schedule] AI generation failed:', err);
      setAiError('Could not generate the schedule. Check your connection and try again.');
    } finally {
      setIsAILoading(false);
    }
  }, [aiPrompt, addProject, updateProject, openSchedule]);

  /**
   * Templates now open the SCHEDULE WIZARD with that template preloaded
   * rather than committing a schedule on the spot.
   *
   * What this replaces, and why:
   *   - "Create as new project" fabricated a Project named after the template
   *     with location "United States" and 0 sq ft — the same junk-project
   *     problem the Blank path was already fixed for.
   *   - "Add to existing project" silently REPLACED that project's schedule
   *     with no preview and no undo.
   *   - Both then reported success through Alert.alert, which is a literal
   *     no-op on React Native Web, so on web a template tap appeared to do
   *     nothing at all.
   * The wizard already does this properly: pick the real project, see the
   * tasks, edit them, see the timeline, then commit.
   */
  const handleTemplateSelect = useCallback((template: ScheduleTemplate) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push({ pathname: '/schedule-wizard', params: { template: template.id } } as any);
  }, [router]);

  /**
   * Create a brand-new project with an EMPTY schedule (no tasks). The
   * user fills it in from scratch on the schedule editor screen. Useful
   * when none of the templates fit and the AI generator's output is
   * over-engineered for a small job.
   */
  // "Blank schedule" hands off to the schedule wizard on its from-scratch path.
  // Previously this silently created a throwaway project named "New Schedule"
  // and router.replace'd onto the schedule tab — so you got a junk project in
  // your list, no way back, and never an actual build-it-yourself flow. The
  // wizard already does this properly: step 1 picks the REAL project, step 2
  // opens on an empty task list with "Add task".
  const handleStartFromScratch = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push('/schedule-wizard?scratch=1' as any);
  }, [router]);

  // The picker now only serves the AI path — templates go through the wizard,
  // which has its own project step.
  const handleProjectSelected = useCallback((project: Project) => {
    setShowProjectPicker(false);
    handleAIGenerate(project);
  }, [handleAIGenerate]);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Schedule Builder' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.heroSection}>
            <View style={s.heroIconWrap}>
              <MageSchedule size={28} color="#FF6A1A" />
            </View>
            <Text style={s.heroTitle}>Schedule Maker</Text>
            {/* The old copy promised "no project required", which stopped being
                true when Blank and Template started routing through the wizard
                (both now pick a real project instead of fabricating one). */}
            <Text style={s.heroDesc}>
              Describe the job and let AI draft it, or build it task by task.
            </Text>
          </View>

          <View style={s.aiSection}>
            <View style={s.aiHeader}>
              <MageAIMark size={18} color="#FF6A1A" />
              <Text style={s.aiTitle}>Generate with AI</Text>
            </View>
            <Text style={s.aiDesc}>
              Describe your project and AI will create a complete schedule with tasks, phases, dependencies, and milestones.
            </Text>
            <TextInput
              style={s.aiInput}
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="e.g. 2,500 sq ft kitchen and bathroom renovation, gut to studs, new cabinets, tile, fixtures..."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
              testID="discover-schedule-ai-prompt"
            />
            <View style={s.aiActions}>
              <TouchableOpacity
                style={[s.aiBtn, isAILoading && s.aiBtnDisabled]}
                onPress={() => handleAIGenerate(null)}
                activeOpacity={0.85}
                disabled={isAILoading}
                testID="discover-schedule-ai-generate"
              >
                {isAILoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <MageAIMark size={16} color="#FFF" />
                    <Text style={s.aiBtnText}>Generate (New Project)</Text>
                  </>
                )}
              </TouchableOpacity>
              {projects.length > 0 && (
                <TouchableOpacity
                  style={[s.aiBtnSecondary, isAILoading && s.aiBtnDisabled]}
                  onPress={() => {
                    if (!aiPrompt.trim()) {
                      setAiError('Describe the project first — a sentence or two is enough.');
                      return;
                    }
                    setAiError(null);
                    setShowProjectPicker(true);
                  }}
                  activeOpacity={0.85}
                  disabled={isAILoading}
                >
                  <Text style={s.aiBtnSecondaryText}>Add to Existing Project</Text>
                </TouchableOpacity>
              )}
            </View>
            {aiError ? (
              <Text style={s.aiError} testID="discover-schedule-ai-error">{aiError}</Text>
            ) : null}
          </View>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <Text style={s.sectionTitle}>Start from Scratch</Text>
          <TouchableOpacity
            style={s.scratchCard}
            onPress={handleStartFromScratch}
            activeOpacity={0.7}
            testID="discover-schedule-scratch"
          >
            <View style={[s.templateIconWrap, { backgroundColor: Colors.warning + '15' }]}>
              <Plus size={22} color={Colors.warning} strokeWidth={2.2} />
            </View>
            <View style={s.templateInfo}>
              <Text style={s.templateName}>Blank schedule</Text>
              <Text style={s.templateMeta}>Pick your project, then build it task by task — no template.</Text>
            </View>
            <ChevronRight size={18} color={Colors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>

          <Text style={[s.sectionTitle, { marginTop: 24 }]}>Start from Template</Text>
          <Text style={s.sectionHint}>
            Opens the builder with these tasks loaded — pick your project, edit
            the list, then save.
          </Text>
          {SCHEDULE_TEMPLATES.map(template => (
            <TouchableOpacity
              key={template.id}
              style={s.templateCard}
              onPress={() => handleTemplateSelect(template)}
              activeOpacity={0.7}
              testID={`schedule-template-${template.id}`}
            >
              <View style={s.templateIconWrap}>
                <FileText size={20} color={Colors.primary} strokeWidth={1.75} />
              </View>
              <View style={s.templateInfo}>
                <Text style={s.templateName}>{template.name}</Text>
                <Text style={s.templateMeta}>{template.tasks.length} tasks · {template.tasks.filter(t => t.isMilestone).length} milestones</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          ))}

          {projectsWithSchedules.length > 0 && (
            <>
              <Text style={[s.sectionTitle, { marginTop: 24 }]}>Existing Schedules</Text>
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
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showProjectPicker} transparent animationType="fade" onRequestClose={() => setShowProjectPicker(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowProjectPicker(false)}>
          <Pressable style={s.modalCard} onPress={() => undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setShowProjectPicker(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {projects.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={s.pickerOption}
                  onPress={() => handleProjectSelected(project)}
                  activeOpacity={0.7}
                >
                  <Text style={s.pickerName}>{project.name}</Text>
                  <Text style={s.pickerMeta}>
                    {project.schedule ? `${project.schedule.tasks.length} tasks (will replace)` : 'No schedule yet'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </View>
  );
}

// Theme-aware styles. Previously a module-scope StyleSheet.create() which
// baked Colors.background/surface/text/etc. at module load time — breaking
// dark mode on a main-tab front door. Converted to makeStyles(t) +
// useThemedStyles() so styles re-resolve on every theme change.
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: Tokens.radius.panel,
    backgroundColor: '#FF6A1A' + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 6 },
  heroDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20 },
  aiSection: {
    marginHorizontal: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.xl,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  aiTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
  aiDesc: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginBottom: 12, lineHeight: 18 },
  aiInput: {
    minHeight: 100,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surfaceAlt,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    marginBottom: 14,
    textAlignVertical: 'top' as const,
  },
  aiActions: { gap: 10 },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FF6A1A',
    borderRadius: Tokens.radius.lg,
    paddingVertical: 15,
    shadowColor: '#FF6A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 3,
  },
  aiBtnDisabled: { opacity: 0.6 },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFF' },
  aiBtnSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
  },
  aiBtnSecondaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.primary },
  aiError: { marginTop: 12, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.danger, lineHeight: 18 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: t.line },
  dividerText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textMuted, letterSpacing: 0.5 },
  sectionTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, paddingHorizontal: 20, marginTop: -4, marginBottom: 10, lineHeight: 17 },
  scratchCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 12,
    borderWidth: 1.5,
    borderColor: Colors.warning + '40',
    borderStyle: 'dashed' as const,
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 12,
    // outline matches every other card across the app
    borderWidth: 1,
    borderColor: t.line,
  },
  templateIconWrap: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  templateMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  existingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 12,
    // outline matches every other card across the app
    borderWidth: 1,
    borderColor: t.line,
  },
  existingIconWrap: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.success + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  existingMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  healthBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Tokens.radius.xs,
  },
  healthText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 20,
    maxHeight: '80%' as any,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  pickerOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
    marginBottom: 8,
  },
  pickerName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  pickerMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },
});
