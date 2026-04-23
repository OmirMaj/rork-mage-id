import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, CalendarDays, ChevronRight, FileText, X,
  CheckCircle2, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';
import type { Project, ScheduleTask, DependencyLink, DependencyType } from '@/types';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import {
  createId,
  buildScheduleFromTasks,
} from '@/utils/scheduleEngine';

export default function DiscoverScheduleTool() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, addProject, updateProject } = useProjects();

  const [aiPrompt, setAiPrompt] = useState('');
  const [isAILoading, setIsAILoading] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pendingAction, setPendingAction] = useState<'ai' | 'template' | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const projectsWithSchedules = projects.filter(p => p.schedule && p.schedule.tasks.length > 0);

  const handleAIGenerate = useCallback(async (targetProject?: Project | null) => {
    if (!aiPrompt.trim()) {
      Alert.alert('Describe your project', 'Enter a description to generate a schedule.');
      return;
    }
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
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
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
            Alert.alert('Generation Failed', 'AI returned invalid data. Please try again.');
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
        Alert.alert('Generation Failed', 'AI returned no tasks. Please try a more detailed description.');
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

      if (targetProject) {
        const scheduleName = `${targetProject.name} Schedule`;
        const schedule = buildScheduleFromTasks(scheduleName, targetProject.id, tasks);
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
        const schedule = buildScheduleFromTasks(scheduleName, newProject.id, tasks);
        newProject.schedule = { ...schedule, projectId: newProject.id, updatedAt: now };
        addProject(newProject);
      }

      setAiPrompt('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Schedule Created!',
        `Generated ${tasks.length} tasks. View it now?`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
        ]
      );
    } catch (err) {
      console.log('[Discover Schedule] AI generation failed:', err);
      Alert.alert('Generation Failed', 'Could not generate schedule. Please try again.');
    } finally {
      setIsAILoading(false);
    }
  }, [aiPrompt, addProject, updateProject, router]);

  const handleTemplateSelect = useCallback((template: ScheduleTemplate, targetProject?: Project | null) => {
    const tasks: ScheduleTask[] = [];
    const idMap = new Map<string, string>();

    template.tasks.forEach(tt => {
      const newId = createId('task');
      idMap.set(tt.id, newId);
    });

    template.tasks.forEach(tt => {
      const newId = idMap.get(tt.id)!;
      const depLinks: DependencyLink[] = tt.predecessorIds
        .filter(pid => idMap.has(pid))
        .map(pid => ({ taskId: idMap.get(pid)!, type: 'FS' as DependencyType, lagDays: 0 }));

      tasks.push({
        id: newId, title: tt.name, phase: tt.phase,
        durationDays: tt.isMilestone ? 0 : Math.max(1, tt.duration),
        startDay: 1, progress: 0, crew: 'Crew', crewSize: tt.crewSize || 1,
        dependencies: depLinks.map(l => l.taskId), dependencyLinks: depLinks,
        notes: '', status: 'not_started', isMilestone: tt.isMilestone,
        isCriticalPath: tt.isCriticalPath, isWeatherSensitive: false,
      });
    });

    if (targetProject) {
      const scheduleName = `${targetProject.name} Schedule`;
      const schedule = buildScheduleFromTasks(scheduleName, targetProject.id, tasks);
      updateProject(targetProject.id, {
        schedule: { ...schedule, projectId: targetProject.id, updatedAt: new Date().toISOString() },
      });
    } else {
      const now = new Date().toISOString();
      const newProject: Project = {
        id: createId('project'),
        name: template.name,
        type: 'renovation',
        location: 'United States',
        squareFootage: 0,
        quality: 'standard',
        description: `Created from ${template.name} template`,
        createdAt: now,
        updatedAt: now,
        estimate: null,
        status: 'draft',
      };
      const schedule = buildScheduleFromTasks(template.name, newProject.id, tasks);
      newProject.schedule = { ...schedule, projectId: newProject.id, updatedAt: now };
      addProject(newProject);
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      'Schedule Created!',
      `Created from "${template.name}" template with ${tasks.length} tasks.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
      ]
    );
  }, [addProject, updateProject, router]);

  const handleProjectSelected = useCallback((project: Project) => {
    setShowProjectPicker(false);
    if (pendingAction === 'ai') {
      handleAIGenerate(project);
    } else if (pendingAction === 'template' && selectedTemplateId) {
      const template = SCHEDULE_TEMPLATES.find(t => t.id === selectedTemplateId);
      if (template) handleTemplateSelect(template, project);
    }
    setPendingAction(null);
    setSelectedTemplateId(null);
  }, [pendingAction, selectedTemplateId, handleAIGenerate, handleTemplateSelect]);

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
              <CalendarDays size={28} color="#FF9F0A" />
            </View>
            <Text style={s.heroTitle}>Quick Schedule Builder</Text>
            <Text style={s.heroDesc}>
              Create a construction schedule in seconds — no project required.
            </Text>
          </View>

          <View style={s.aiSection}>
            <View style={s.aiHeader}>
              <Sparkles size={18} color="#FF9F0A" />
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
                    <Sparkles size={16} color="#FFF" />
                    <Text style={s.aiBtnText}>Generate (New Project)</Text>
                  </>
                )}
              </TouchableOpacity>
              {projects.length > 0 && (
                <TouchableOpacity
                  style={[s.aiBtnSecondary, isAILoading && s.aiBtnDisabled]}
                  onPress={() => {
                    if (!aiPrompt.trim()) {
                      Alert.alert('Describe your project first.');
                      return;
                    }
                    setPendingAction('ai');
                    setShowProjectPicker(true);
                  }}
                  activeOpacity={0.85}
                  disabled={isAILoading}
                >
                  <Text style={s.aiBtnSecondaryText}>Add to Existing Project</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <Text style={s.sectionTitle}>Start from Template</Text>
          {SCHEDULE_TEMPLATES.map(template => (
            <TouchableOpacity
              key={template.id}
              style={s.templateCard}
              onPress={() => {
                Alert.alert(
                  template.name,
                  `${template.tasks.length} tasks. Create as new project or add to existing?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'New Project',
                      onPress: () => handleTemplateSelect(template, null),
                    },
                    ...(projects.length > 0 ? [{
                      text: 'Existing Project',
                      onPress: () => {
                        setPendingAction('template');
                        setSelectedTemplateId(template.id);
                        setShowProjectPicker(true);
                      },
                    }] : []),
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <View style={s.templateIconWrap}>
                <FileText size={20} color={Colors.primary} />
              </View>
              <View style={s.templateInfo}>
                <Text style={s.templateName}>{template.name}</Text>
                <Text style={s.templateMeta}>{template.tasks.length} tasks · {template.tasks.filter(t => t.isMilestone).length} milestones</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}

          {projectsWithSchedules.length > 0 && (
            <>
              <Text style={[s.sectionTitle, { marginTop: 24 }]}>Existing Schedules</Text>
              {projectsWithSchedules.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={s.existingCard}
                  onPress={() => router.replace('/(tabs)/schedule' as any)}
                  activeOpacity={0.7}
                >
                  <View style={s.existingIconWrap}>
                    <CheckCircle2 size={18} color={Colors.success} />
                  </View>
                  <View style={s.templateInfo}>
                    <Text style={s.templateName}>{project.name}</Text>
                    <View style={s.existingMeta}>
                      <Clock size={12} color={Colors.textMuted} />
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
                  <ChevronRight size={18} color={Colors.textMuted} />
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
              <TouchableOpacity onPress={() => setShowProjectPicker(false)}>
                <X size={20} color={Colors.textMuted} />
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: '#FF9F0A' + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, marginBottom: 6 },
  heroDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  aiSection: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  aiTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  aiDesc: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  aiInput: {
    minHeight: 100,
    borderRadius: 14,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 14,
    textAlignVertical: 'top' as const,
  },
  aiActions: { gap: 10 },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FF9F0A',
    borderRadius: 14,
    paddingVertical: 15,
    shadowColor: '#FF9F0A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 3,
  },
  aiBtnDisabled: { opacity: 0.6 },
  aiBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
  aiBtnSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  aiBtnSecondaryText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.cardBorder },
  dividerText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  templateIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  templateMeta: { fontSize: 12, color: Colors.textSecondary },
  existingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  existingIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.success + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  existingMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  healthBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  healthText: { fontSize: 11, fontWeight: '700' as const },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
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
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  pickerOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: 8,
  },
  pickerName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  pickerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
