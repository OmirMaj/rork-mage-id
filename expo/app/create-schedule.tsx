import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, Pressable, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, LayoutTemplate, FileText, Plus, CalendarDays, ChevronRight,
  X, Clock, Users, Layers, ArrowRight, Zap, CheckCircle2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { mageAI } from '@/utils/mageAI';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';
import type { ScheduleTask, DependencyLink, DependencyType, ProjectSchedule } from '@/types';
import {
  createId,
  buildScheduleFromTasks,
} from '@/utils/scheduleEngine';

type CreationMethod = 'ai' | 'template' | 'estimate' | 'manual' | null;

function parseTasksJSON(raw: string): any | null {
  try { return JSON.parse(raw); } catch {}
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  const startIdx = raw.indexOf('"tasks"');
  const arrStart = startIdx >= 0 ? raw.indexOf('[', startIdx) : raw.indexOf('[');
  if (arrStart < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const items: string[] = [];
  let current = '';
  let started = false;
  for (let i = arrStart + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; current += ch; continue; }
    if (ch === '\\' && inStr) { esc = true; current += ch; continue; }
    if (ch === '"') { inStr = !inStr; current += ch; continue; }
    if (inStr) { current += ch; continue; }
    if (ch === '{') { if (depth === 0) { current = '{'; started = true; } else current += ch; depth++; continue; }
    if (ch === '}') { depth--; current += ch; if (depth === 0 && started) { items.push(current); current = ''; started = false; } continue; }
    if (started) current += ch;
  }
  if (items.length === 0) return null;
  const tasks: any[] = [];
  for (const it of items) {
    try { tasks.push(JSON.parse(it)); } catch {}
  }
  if (tasks.length === 0) return null;
  console.log('[CreateSchedule] Recovered', tasks.length, 'tasks from truncated JSON');
  return { tasks };
}

function guessPhase(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('lumber') || c.includes('framing') || c.includes('wood')) return 'Framing';
  if (c.includes('electric') || c.includes('wiring')) return 'Electrical';
  if (c.includes('plumb') || c.includes('pipe')) return 'Plumbing';
  if (c.includes('roof') || c.includes('shingle')) return 'Roofing';
  if (c.includes('hvac') || c.includes('duct')) return 'HVAC';
  if (c.includes('concrete') || c.includes('foundation')) return 'Foundation';
  if (c.includes('drywall') || c.includes('gypsum')) return 'Drywall';
  if (c.includes('paint') || c.includes('finish')) return 'Finishes';
  if (c.includes('floor') || c.includes('tile') || c.includes('carpet')) return 'Finishes';
  if (c.includes('insulation')) return 'Insulation';
  if (c.includes('landscape')) return 'Landscaping';
  if (c.includes('hardware') || c.includes('fastener')) return 'General';
  return 'General';
}

export default function CreateScheduleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, updateProject } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);

  const [method, setMethod] = useState<CreationMethod>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAILoading, setIsAILoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ScheduleTemplate | null>(null);

  const [manualTasks, setManualTasks] = useState<Array<{ title: string; phase: string; duration: string }>>([
    { title: '', phase: 'General', duration: '5' },
  ]);

  const hasEstimate = !!(project?.estimate || project?.linkedEstimate);

  const saveSchedule = useCallback((schedule: ProjectSchedule) => {
    if (!project || !projectId) return;
    console.log('[CreateSchedule] Saving schedule with', schedule.tasks.length, 'tasks to project', projectId);
    updateProject(projectId, {
      schedule: { ...schedule, projectId, updatedAt: new Date().toISOString() },
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [project, projectId, updateProject, router]);

  const handleAIGenerate = useCallback(async () => {
    const prompt = aiPrompt.trim() || (project ? `${project.type} project: ${project.name}. ${project.description || ''} ${project.squareFootage > 0 ? project.squareFootage + ' sq ft.' : ''}` : '');
    if (!prompt) {
      Alert.alert('Describe your project', 'Enter a description to generate a schedule.');
      return;
    }

    setIsAILoading(true);
    try {
      console.log('[CreateSchedule] AI generation starting with prompt:', prompt.slice(0, 100));

      const aiResult = await mageAI({
        prompt: `Construction scheduler. Generate schedule JSON for: ${prompt}

Return ONLY this JSON shape (no markdown, no prose):
{"tasks":[{"id":"t1","name":"...","phase":"...","duration":N,"predecessorIds":["t0"],"isMilestone":false,"isCriticalPath":true,"crewSize":2}]}

Rules:
- id: short string like "t1","t2"...
- phase: one of Site Work, Demo, Foundation, Framing, Roofing, MEP, Plumbing, Electrical, HVAC, Insulation, Drywall, Interior, Finishes, Landscaping, Inspections, General
- duration: integer working days (milestones=0)
- predecessorIds: array of earlier task ids
- First task: Project Start (milestone, duration 0)
- Last task: Project Complete (milestone, duration 0)
- 15-25 tasks total
- Keep names concise (<50 chars)
- Output compact JSON, no extra fields, no whitespace padding`,
        tier: 'smart',
        maxTokens: 16000,
      });

      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        setIsAILoading(false);
        return;
      }

      let response: any = aiResult.data;
      console.log('[CreateSchedule] AI data type:', typeof response, Array.isArray(response));
      if (typeof response === 'string') console.log('[CreateSchedule] AI data string preview:', response.substring(0, 300));
      else console.log('[CreateSchedule] AI data preview:', JSON.stringify(response).substring(0, 300));

      if (typeof response === 'string') {
        let cleaned = response.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
        else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
        if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
        cleaned = cleaned.trim();
        const parsed = parseTasksJSON(cleaned);
        if (parsed) {
          response = parsed;
        } else {
          console.log('[CreateSchedule] Could not parse AI response:', cleaned.substring(0, 300));
          Alert.alert('Generation Failed', 'AI returned invalid data. Please try again with a shorter description.');
          setIsAILoading(false);
          return;
        }
      }

      let result: any[] | undefined;
      if (Array.isArray(response)) {
        result = response;
      } else if (response?.tasks && Array.isArray(response.tasks)) {
        result = response.tasks;
      } else if (response?.schedule?.tasks && Array.isArray(response.schedule.tasks)) {
        result = response.schedule.tasks;
      } else if (typeof response === 'object' && response !== null) {
        const keys = Object.keys(response);
        for (const key of keys) {
          if (Array.isArray(response[key]) && response[key].length > 0 && response[key][0]?.name) {
            result = response[key];
            break;
          }
        }
      }
      console.log('[CreateSchedule] AI returned', result?.length, 'tasks');

      if (result && result.length > 0) {
        const tasks: ScheduleTask[] = result.map((t: any, idx: number) => ({
          id: createId('task'),
          title: t.name || t.title || `Task ${idx + 1}`,
          phase: t.phase || 'General',
          durationDays: Math.max(t.isMilestone ? 0 : 1, t.duration || 1),
          startDay: 1,
          progress: 0,
          crew: `Crew ${idx + 1}`,
          crewSize: t.crewSize || 2,
          dependencies: [],
          dependencyLinks: [],
          notes: '',
          status: 'not_started' as const,
          isMilestone: t.isMilestone || false,
          wbsCode: t.wbs,
          isCriticalPath: t.isCriticalPath || false,
          isWeatherSensitive: false,
        }));

        const idMap = new Map<string, string>();
        result.forEach((t: any, idx: number) => {
          idMap.set(String(t.id), tasks[idx].id);
        });

        for (let i = 0; i < tasks.length; i++) {
          const original = result[i];
          const preds: any[] = Array.isArray(original.predecessorIds) ? original.predecessorIds : [];
          tasks[i].dependencyLinks = preds
            .map(p => String(p))
            .filter((pid: string) => idMap.has(pid))
            .map((pid: string) => ({
              taskId: idMap.get(pid)!,
              type: 'FS' as DependencyType,
              lagDays: 0,
            }));
          tasks[i].dependencies = tasks[i].dependencyLinks!.map((l: DependencyLink) => l.taskId);
        }

        const scheduleName = project ? `${project.name} Schedule` : 'AI Generated Schedule';
        const schedule = buildScheduleFromTasks(scheduleName, projectId ?? null, tasks);
        saveSchedule(schedule);
      } else {
        Alert.alert('Generation Failed', 'AI returned no tasks. Try a more detailed description.');
      }
    } catch (err) {
      console.log('[CreateSchedule] AI generation failed:', err);
      Alert.alert('Generation Failed', 'Could not generate schedule. Please try again.');
    } finally {
      setIsAILoading(false);
    }
  }, [aiPrompt, project, projectId, saveSchedule]);

  const handleTemplateSelect = useCallback((template: ScheduleTemplate) => {
    const tasks: ScheduleTask[] = [];
    const idMap = new Map<string, string>();

    template.tasks.forEach(tt => {
      idMap.set(tt.id, createId('task'));
    });

    template.tasks.forEach(tt => {
      const newId = idMap.get(tt.id)!;
      const depLinks: DependencyLink[] = tt.predecessorIds
        .filter(pid => idMap.has(pid))
        .map(pid => ({ taskId: idMap.get(pid)!, type: 'FS' as DependencyType, lagDays: 0 }));

      tasks.push({
        id: newId,
        title: tt.name,
        phase: tt.phase,
        durationDays: tt.isMilestone ? 0 : Math.max(1, tt.duration),
        startDay: 1,
        progress: 0,
        crew: 'Crew',
        crewSize: tt.crewSize || 1,
        dependencies: depLinks.map(l => l.taskId),
        dependencyLinks: depLinks,
        notes: '',
        status: 'not_started',
        isMilestone: tt.isMilestone,
        isCriticalPath: tt.isCriticalPath,
        isWeatherSensitive: false,
      });
    });

    const scheduleName = project ? `${project.name} Schedule` : template.name;
    const schedule = buildScheduleFromTasks(scheduleName, projectId ?? null, tasks);
    saveSchedule(schedule);
  }, [project, projectId, saveSchedule]);

  const handleBuildFromEstimate = useCallback(() => {
    if (!project) return;

    const tasks: ScheduleTask[] = [];
    const linkedEst = project.linkedEstimate;
    const legacyEst = project.estimate;

    if (linkedEst) {
      const categories = new Map<string, { items: string[]; totalQty: number }>();
      linkedEst.items.forEach(item => {
        if (!categories.has(item.category)) {
          categories.set(item.category, { items: [], totalQty: 0 });
        }
        const cat = categories.get(item.category)!;
        cat.items.push(item.name);
        cat.totalQty += item.quantity;
      });

      let prevId: string | null = null;
      const startMilestone: ScheduleTask = {
        id: createId('task'), title: 'Project Start', phase: 'General',
        durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
        dependencies: [], notes: '', status: 'not_started', isMilestone: true,
        isCriticalPath: true, isWeatherSensitive: false,
      };
      tasks.push(startMilestone);
      prevId = startMilestone.id;

      categories.forEach((data, category) => {
        const duration = Math.max(1, Math.round(data.totalQty / 50));
        const task: ScheduleTask = {
          id: createId('task'), title: category, phase: guessPhase(category),
          durationDays: Math.min(duration, 20), startDay: 1, progress: 0,
          crew: `${category} crew`, crewSize: 2,
          dependencies: prevId ? [prevId] : [],
          dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
          notes: `Items: ${data.items.slice(0, 3).join(', ')}${data.items.length > 3 ? '...' : ''}`,
          status: 'not_started', isMilestone: false, isCriticalPath: true,
          isWeatherSensitive: false,
        };
        tasks.push(task);
        prevId = task.id;
      });

      const endMilestone: ScheduleTask = {
        id: createId('task'), title: 'Project Complete', phase: 'General',
        durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
        dependencies: prevId ? [prevId] : [],
        dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
        notes: '', status: 'not_started', isMilestone: true, isCriticalPath: true,
        isWeatherSensitive: false,
      };
      tasks.push(endMilestone);
    } else if (legacyEst) {
      const categories = new Map<string, number>();
      legacyEst.materials.forEach(m => {
        categories.set(m.category, (categories.get(m.category) || 0) + m.quantity);
      });

      let prevId: string | null = null;
      const startMilestone: ScheduleTask = {
        id: createId('task'), title: 'Project Start', phase: 'General',
        durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
        dependencies: [], notes: '', status: 'not_started', isMilestone: true,
        isCriticalPath: true, isWeatherSensitive: false,
      };
      tasks.push(startMilestone);
      prevId = startMilestone.id;

      categories.forEach((qty, category) => {
        const task: ScheduleTask = {
          id: createId('task'), title: category, phase: guessPhase(category),
          durationDays: Math.max(1, Math.min(Math.round(qty / 50), 15)),
          startDay: 1, progress: 0, crew: `${category} crew`, crewSize: 2,
          dependencies: prevId ? [prevId] : [],
          dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
          notes: '', status: 'not_started', isMilestone: false, isCriticalPath: true,
          isWeatherSensitive: false,
        };
        tasks.push(task);
        prevId = task.id;
      });

      const endMilestone: ScheduleTask = {
        id: createId('task'), title: 'Project Complete', phase: 'General',
        durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
        dependencies: prevId ? [prevId] : [],
        dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
        notes: '', status: 'not_started', isMilestone: true, isCriticalPath: true,
        isWeatherSensitive: false,
      };
      tasks.push(endMilestone);
    }

    if (tasks.length > 0) {
      const scheduleName = `${project.name} Schedule`;
      const schedule = buildScheduleFromTasks(scheduleName, projectId ?? null, tasks);
      saveSchedule(schedule);
    } else {
      Alert.alert('No Data', 'Could not build schedule from estimate data.');
    }
  }, [project, projectId, saveSchedule]);

  const handleManualCreate = useCallback(() => {
    const validTasks = manualTasks.filter(t => t.title.trim());
    if (validTasks.length === 0) {
      Alert.alert('Add Tasks', 'Enter at least one task to create a schedule.');
      return;
    }

    const startMilestone: ScheduleTask = {
      id: createId('task'), title: 'Project Start', phase: 'General',
      durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
      dependencies: [], notes: '', status: 'not_started', isMilestone: true,
      isCriticalPath: true, isWeatherSensitive: false,
    };

    const tasks: ScheduleTask[] = [startMilestone];
    let prevId = startMilestone.id;

    validTasks.forEach(t => {
      const dur = parseInt(t.duration, 10) || 5;
      const task: ScheduleTask = {
        id: createId('task'),
        title: t.title.trim(),
        phase: t.phase,
        durationDays: Math.max(1, dur),
        startDay: 1,
        progress: 0,
        crew: 'General crew',
        crewSize: 2,
        dependencies: [prevId],
        dependencyLinks: [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }],
        notes: '',
        status: 'not_started',
        isMilestone: false,
        isCriticalPath: true,
        isWeatherSensitive: false,
      };
      tasks.push(task);
      prevId = task.id;
    });

    const endMilestone: ScheduleTask = {
      id: createId('task'), title: 'Project Complete', phase: 'General',
      durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
      dependencies: [prevId],
      dependencyLinks: [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }],
      notes: '', status: 'not_started', isMilestone: true, isCriticalPath: true,
      isWeatherSensitive: false,
    };
    tasks.push(endMilestone);

    const scheduleName = project ? `${project.name} Schedule` : 'New Schedule';
    const schedule = buildScheduleFromTasks(scheduleName, projectId ?? null, tasks);
    saveSchedule(schedule);
  }, [manualTasks, project, projectId, saveSchedule]);

  const addManualTask = useCallback(() => {
    setManualTasks(prev => [...prev, { title: '', phase: 'General', duration: '5' }]);
  }, []);

  const updateManualTask = useCallback((index: number, field: string, value: string) => {
    setManualTasks(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  }, []);

  const removeManualTask = useCallback((index: number) => {
    setManualTasks(prev => prev.filter((_, i) => i !== index));
  }, []);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Create Schedule' }} />
        <Text style={styles.emptyText}>Project not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderMethodPicker = () => (
    <View style={styles.methodContainer}>
      <View style={styles.heroSection}>
        <View style={styles.heroIconWrap}>
          <CalendarDays size={32} color={Colors.info} />
        </View>
        <Text style={styles.heroTitle}>Create Schedule</Text>
        <Text style={styles.heroSubtitle}>{project.name}</Text>
        <Text style={styles.heroDesc}>Choose how you'd like to build your project schedule</Text>
      </View>

      <TouchableOpacity
        style={styles.methodCard}
        onPress={() => setMethod('ai')}
        activeOpacity={0.7}
        testID="schedule-method-ai"
      >
        <View style={[styles.methodIconWrap, { backgroundColor: '#FF9F0A12' }]}>
          <Sparkles size={26} color="#FF9F0A" />
        </View>
        <View style={styles.methodInfo}>
          <Text style={styles.methodTitle}>AI Generate</Text>
          <Text style={styles.methodDesc}>Describe your project and AI builds a full schedule with dependencies</Text>
          <View style={styles.methodBadge}>
            <Zap size={10} color="#FF9F0A" />
            <Text style={styles.methodBadgeText}>Recommended</Text>
          </View>
        </View>
        <ChevronRight size={20} color={Colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.methodCard}
        onPress={() => setMethod('template')}
        activeOpacity={0.7}
        testID="schedule-method-template"
      >
        <View style={[styles.methodIconWrap, { backgroundColor: '#5856D612' }]}>
          <LayoutTemplate size={26} color="#5856D6" />
        </View>
        <View style={styles.methodInfo}>
          <Text style={styles.methodTitle}>From Template</Text>
          <Text style={styles.methodDesc}>{SCHEDULE_TEMPLATES.length} pre-built templates for common project types</Text>
        </View>
        <ChevronRight size={20} color={Colors.textMuted} />
      </TouchableOpacity>

      {hasEstimate && (
        <TouchableOpacity
          style={styles.methodCard}
          onPress={handleBuildFromEstimate}
          activeOpacity={0.7}
          testID="schedule-method-estimate"
        >
          <View style={[styles.methodIconWrap, { backgroundColor: '#34C75912' }]}>
            <FileText size={26} color="#34C759" />
          </View>
          <View style={styles.methodInfo}>
            <Text style={styles.methodTitle}>From Estimate</Text>
            <Text style={styles.methodDesc}>Auto-create tasks from your existing estimate categories</Text>
            <View style={[styles.methodBadge, { backgroundColor: '#34C75912' }]}>
              <CheckCircle2 size={10} color="#34C759" />
              <Text style={[styles.methodBadgeText, { color: '#34C759' }]}>Estimate available</Text>
            </View>
          </View>
          <ChevronRight size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.methodCard}
        onPress={() => setMethod('manual')}
        activeOpacity={0.7}
        testID="schedule-method-manual"
      >
        <View style={[styles.methodIconWrap, { backgroundColor: '#0A84FF12' }]}>
          <Plus size={26} color="#0A84FF" />
        </View>
        <View style={styles.methodInfo}>
          <Text style={styles.methodTitle}>Manual Build</Text>
          <Text style={styles.methodDesc}>Add tasks one by one with custom durations and phases</Text>
        </View>
        <ChevronRight size={20} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  const renderAIBuilder = () => (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.builderHeader}>
          <TouchableOpacity style={styles.backChip} onPress={() => setMethod(null)} activeOpacity={0.7}>
            <ArrowRight size={14} color={Colors.primary} style={{ transform: [{ rotate: '180deg' }] }} />
            <Text style={styles.backChipText}>Back</Text>
          </TouchableOpacity>
          <View style={[styles.builderIconWrap, { backgroundColor: '#FF9F0A12' }]}>
            <Sparkles size={28} color="#FF9F0A" />
          </View>
          <Text style={styles.builderTitle}>AI Schedule Builder</Text>
          <Text style={styles.builderDesc}>
            Describe your project and AI will generate a complete schedule with tasks, phases, dependencies, and milestones.
          </Text>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Project Description</Text>
          <TextInput
            style={styles.textArea}
            value={aiPrompt}
            onChangeText={setAiPrompt}
            placeholder={`e.g. "${project.type} - ${project.name}. ${project.squareFootage > 0 ? project.squareFootage + ' sq ft.' : ''} ${project.description || 'Kitchen remodel with new cabinets, countertops, and appliances'}"`.trim()}
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            testID="ai-schedule-prompt"
          />

          <View style={styles.aiTipCard}>
            <Sparkles size={14} color="#FF9F0A" />
            <Text style={styles.aiTipText}>
              Include project type, size, scope, and any special requirements for better results.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.generateBtn, isAILoading && styles.generateBtnDisabled]}
            onPress={handleAIGenerate}
            disabled={isAILoading}
            activeOpacity={0.85}
            testID="generate-ai-schedule-btn"
          >
            {isAILoading ? (
              <>
                <ActivityIndicator size="small" color={Colors.textOnPrimary} />
                <Text style={styles.generateBtnText}>Generating Schedule...</Text>
              </>
            ) : (
              <>
                <Sparkles size={18} color={Colors.textOnPrimary} />
                <Text style={styles.generateBtnText}>Generate Schedule</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderTemplatePicker = () => (
    <ScrollView
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.builderHeader}>
        <TouchableOpacity style={styles.backChip} onPress={() => setMethod(null)} activeOpacity={0.7}>
          <ArrowRight size={14} color={Colors.primary} style={{ transform: [{ rotate: '180deg' }] }} />
          <Text style={styles.backChipText}>Back</Text>
        </TouchableOpacity>
        <View style={[styles.builderIconWrap, { backgroundColor: '#5856D612' }]}>
          <LayoutTemplate size={28} color="#5856D6" />
        </View>
        <Text style={styles.builderTitle}>Choose a Template</Text>
        <Text style={styles.builderDesc}>
          Select a pre-built schedule template that matches your project type.
        </Text>
      </View>

      {SCHEDULE_TEMPLATES.map(template => (
        <TouchableOpacity
          key={template.id}
          style={styles.templateCard}
          onPress={() => handleTemplateSelect(template)}
          activeOpacity={0.7}
          testID={`template-${template.id}`}
        >
          <View style={styles.templateHeader}>
            <Text style={styles.templateName}>{template.name}</Text>
            <ChevronRight size={18} color={Colors.textMuted} />
          </View>
          <View style={styles.templateMeta}>
            <View style={styles.templateMetaItem}>
              <Layers size={12} color={Colors.textMuted} />
              <Text style={styles.templateMetaText}>{template.taskCount} tasks</Text>
            </View>
            <View style={styles.templateMetaItem}>
              <Clock size={12} color={Colors.textMuted} />
              <Text style={styles.templateMetaText}>{template.typicalDuration}</Text>
            </View>
          </View>
          <View style={styles.templatePhases}>
            {Array.from(new Set(template.tasks.map(t => t.phase))).slice(0, 6).map(phase => (
              <View key={phase} style={styles.templatePhaseChip}>
                <Text style={styles.templatePhaseText}>{phase}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const PHASE_OPTIONS = [
    'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
    'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
    'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
  ];

  const renderManualBuilder = () => (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.builderHeader}>
          <TouchableOpacity style={styles.backChip} onPress={() => setMethod(null)} activeOpacity={0.7}>
            <ArrowRight size={14} color={Colors.primary} style={{ transform: [{ rotate: '180deg' }] }} />
            <Text style={styles.backChipText}>Back</Text>
          </TouchableOpacity>
          <View style={[styles.builderIconWrap, { backgroundColor: '#0A84FF12' }]}>
            <Plus size={28} color="#0A84FF" />
          </View>
          <Text style={styles.builderTitle}>Manual Schedule</Text>
          <Text style={styles.builderDesc}>
            Add tasks sequentially. They'll be linked as finish-to-start dependencies automatically.
          </Text>
        </View>

        {manualTasks.map((task, idx) => (
          <View key={idx} style={styles.manualTaskCard}>
            <View style={styles.manualTaskHeader}>
              <Text style={styles.manualTaskNumber}>Task {idx + 1}</Text>
              {manualTasks.length > 1 && (
                <TouchableOpacity onPress={() => removeManualTask(idx)} activeOpacity={0.7}>
                  <X size={16} color={Colors.error} />
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.manualInput}
              value={task.title}
              onChangeText={(v) => updateManualTask(idx, 'title', v)}
              placeholder="Task name"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.manualRow}>
              <View style={styles.manualDurationWrap}>
                <Text style={styles.manualFieldLabel}>Days</Text>
                <TextInput
                  style={styles.manualDurationInput}
                  value={task.duration}
                  onChangeText={(v) => updateManualTask(idx, 'duration', v)}
                  keyboardType="numeric"
                  placeholder="5"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={styles.manualPhaseWrap}>
                <Text style={styles.manualFieldLabel}>Phase</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.phaseScroll}>
                  {PHASE_OPTIONS.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.phaseChip, task.phase === p && styles.phaseChipActive]}
                      onPress={() => updateManualTask(idx, 'phase', p)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.phaseChipText, task.phase === p && styles.phaseChipTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addTaskBtn} onPress={addManualTask} activeOpacity={0.7}>
          <Plus size={16} color={Colors.primary} />
          <Text style={styles.addTaskBtnText}>Add Task</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.generateBtn}
          onPress={handleManualCreate}
          activeOpacity={0.85}
          testID="create-manual-schedule-btn"
        >
          <CalendarDays size={18} color={Colors.textOnPrimary} />
          <Text style={styles.generateBtnText}>Create Schedule</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Create Schedule' }} />
      {method === null && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {renderMethodPicker()}
        </ScrollView>
      )}
      {method === 'ai' && renderAIBuilder()}
      {method === 'template' && renderTemplatePicker()}
      {method === 'manual' && renderManualBuilder()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  backButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  backButtonText: {
    color: Colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  methodContainer: {
    paddingHorizontal: 20,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 24,
    gap: 6,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.info + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  heroDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: 4,
    lineHeight: 20,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  methodIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodInfo: {
    flex: 1,
    gap: 3,
  },
  methodTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  methodDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  methodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF9F0A12',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  methodBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FF9F0A',
  },
  builderHeader: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 6,
  },
  backChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.primary + '10',
    marginBottom: 12,
  },
  backChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  builderIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  builderTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  builderDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  formSection: {
    paddingHorizontal: 20,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  textArea: {
    minHeight: 120,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    textAlignVertical: 'top' as const,
    lineHeight: 22,
  },
  aiTipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FF9F0A08',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FF9F0A15',
  },
  aiTipText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  generateBtnDisabled: {
    opacity: 0.7,
  },
  generateBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  templateCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 8,
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  templateName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  templateMeta: {
    flexDirection: 'row',
    gap: 16,
  },
  templateMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  templateMetaText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  templatePhases: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  templatePhaseChip: {
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  templatePhaseText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  manualTaskCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 8,
  },
  manualTaskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  manualTaskNumber: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  manualInput: {
    minHeight: 44,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: Colors.text,
  },
  manualRow: {
    gap: 8,
  },
  manualDurationWrap: {
    gap: 4,
  },
  manualFieldLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  manualDurationInput: {
    width: 80,
    minHeight: 40,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: Colors.text,
  },
  manualPhaseWrap: {
    gap: 4,
  },
  phaseScroll: {
    flexGrow: 0,
  },
  phaseChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
    marginRight: 6,
  },
  phaseChipActive: {
    backgroundColor: Colors.primary,
  },
  phaseChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  phaseChipTextActive: {
    color: Colors.textOnPrimary,
  },
  addTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    marginHorizontal: 20,
    marginTop: 4,
  },
  addTaskBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
