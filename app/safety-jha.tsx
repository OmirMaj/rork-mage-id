import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  HardHat, Plus, X, Trash2, ChevronLeft, CheckCircle, PenLine, Lock, Archive, Mic,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type { JobHazardAnalysis, JHAStep, JHAStatus, SafetySignoff } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert } from '@/utils/alert';

function getStatusConfig(t: ThemeColors, status: JHAStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'draft': return { label: 'Draft', color: t.textSecondary, bg: t.line };
    case 'active': return { label: 'Active', color: t.success, bg: t.successSoft };
    case 'archived': return { label: 'Archived', color: t.textMuted, bg: t.line };
  }
}

export default function SafetyJhaScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyJhaInner />;
}

function SafetyJhaInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useTierAccess();
  const { user } = useAuth();
  const author = ((user?.name && user.name.trim()) || user?.email || '').trim();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { getJhasForProject, addJha, updateJha, deleteJha } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getJhasForProject(projectId ?? ''), [projectId, getJhasForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingJha, setEditingJha] = useState<JobHazardAnalysis | null>(null);
  const [title, setTitle] = useState('');
  const [trade, setTrade] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [steps, setSteps] = useState<JHAStep[]>([]);
  const [requiredPPE, setRequiredPPE] = useState<string[]>([]);
  const [ppeText, setPpeText] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Once a JHA carries any sign-off it becomes an immutable safety record:
  // sign-offs are append-only, and the analysis itself (title, trade, task,
  // date, steps, PPE) can no longer be edited — only archived. Editing a
  // signed JHA would invalidate the signatures crews gave against it.
  const isLocked = useMemo(
    () => !!editingJha && editingJha.signOffs.length > 0,
    [editingJha],
  );

  // Sign-off capture — append-only signatures on a JHA.
  const [signOffFor, setSignOffFor] = useState<string | null>(null);
  const [sigName, setSigName] = useState('');
  const [sigRole, setSigRole] = useState('');

  const resetForm = useCallback(() => {
    setEditingJha(null);
    setTitle(''); setTrade(''); setTaskDescription('');
    setDate(new Date().toISOString().slice(0, 10));
    setSteps([]); setRequiredPPE([]); setPpeText('');
    setAiGenerated(false); setGenerating(false);
  }, []);

  // Keep the requiredPPE array in sync with the comma-joined text field.
  const handlePpeChange = useCallback((text: string) => {
    setPpeText(text);
    setRequiredPPE(text.split(',').map(p => p.trim()).filter(Boolean));
  }, []);

  // ── Inline step editing ──────────────────────────────────────────────
  const addStep = useCallback(() => {
    setSteps(prev => [...prev, { id: generateUUID(), step: '', hazards: [], controls: [] }]);
  }, []);

  const removeStep = useCallback((id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateStepField = useCallback((id: string, field: 'step' | 'hazards' | 'controls', value: string) => {
    setSteps(prev => prev.map(s => {
      if (s.id !== id) return s;
      if (field === 'step') return { ...s, step: value };
      const list = value.split(',').map(v => v.trim()).filter(Boolean);
      return { ...s, [field]: list };
    }));
  }, []);

  const openEdit = useCallback((jha: JobHazardAnalysis) => {
    setEditingJha(jha);
    setTitle(jha.title);
    setTrade(jha.trade);
    setTaskDescription(jha.taskDescription);
    setDate(jha.date);
    setSteps(jha.steps);
    setRequiredPPE(jha.requiredPPE);
    setPpeText(jha.requiredPPE.join(', '));
    setAiGenerated(jha.aiGenerated);
    setShowForm(true);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!taskDescription.trim()) { showAlert('Add a task', 'Describe the task first so AI can analyze it.'); return; }
    const check = await checkAILimit(tier, 'smart');
    if (!check.allowed) { showAlert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-generate-jha`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ trade, taskDescription, projectContext: project?.name ?? '' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { showAlert('AI unavailable', json.error ?? 'Could not generate. Fill the JHA manually.'); return; }
      const aiSteps: JHAStep[] = (json.data.steps ?? []).map((s: { step: string; hazards: string[]; controls: string[] }) => ({
        id: generateUUID(), step: s.step, hazards: s.hazards ?? [], controls: s.controls ?? [],
      }));
      setSteps(aiSteps);
      setRequiredPPE(json.data.requiredPPE ?? []);
      setPpeText((json.data.requiredPPE ?? []).join(', '));
      setAiGenerated(true);
      await recordAIUsage('smart');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showAlert('AI unavailable', 'Network issue — fill the JHA manually.');
    } finally {
      setGenerating(false);
    }
  }, [taskDescription, trade, tier, project]);

  const handleSave = useCallback(() => {
    // Immutable once signed — a signed JHA can only be archived, never edited.
    if (editingJha && editingJha.signOffs.length > 0) {
      showAlert('Signed — locked', 'This JHA has sign-offs and can no longer be edited. Archive it instead.');
      return;
    }
    const t = title.trim();
    if (!t) { showAlert('Missing title', 'Give this JHA a title.'); return; }
    const now = new Date().toISOString();
    const ppe = requiredPPE.map(p => p.trim()).filter(Boolean);
    if (editingJha) {
      updateJha(editingJha.id, { title: t, trade: trade.trim(), taskDescription: taskDescription.trim(), date, steps, requiredPPE: ppe, aiGenerated });
    } else {
      const jha: JobHazardAnalysis = {
        id: generateUUID(), projectId: projectId ?? '', title: t, trade: trade.trim(),
        taskDescription: taskDescription.trim(), date, steps, requiredPPE: ppe, signOffs: [],
        aiGenerated, status: 'draft', createdBy: author, createdAt: now, updatedAt: now,
      };
      addJha(jha);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [title, trade, taskDescription, date, steps, requiredPPE, aiGenerated, editingJha, projectId, addJha, updateJha, resetForm, author]);

  const handleActivate = useCallback((jha: JobHazardAnalysis) => {
    updateJha(jha.id, { status: 'active' });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [updateJha]);

  // Archival is the one mutation a signed (locked) JHA still allows — status
  // is a lifecycle flag, not part of the signed analysis content.
  const handleArchive = useCallback(() => {
    if (!editingJha) return;
    updateJha(editingJha.id, { status: 'archived' });
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [editingJha, updateJha, resetForm]);

  const handleDelete = useCallback((id: string) => {
    const jha = items.find(x => x.id === id);
    if (jha && jha.signOffs.length > 0) {
      showAlert('Signed — locked', 'A JHA with recorded sign-offs is part of the safety record and can\'t be deleted. Archive it instead.');
      return;
    }
    showAlert('Delete JHA', 'Delete this job hazard analysis?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteJha(id) },
    ]);
  }, [deleteJha, items]);

  const handleAddSignOff = useCallback(() => {
    const jha = items.find(x => x.id === signOffFor);
    if (!jha) { setSignOffFor(null); return; }
    const name = sigName.trim();
    if (!name) { showAlert('Missing name', 'Enter who is signing off.'); return; }
    const sig: SafetySignoff = { name, role: sigRole.trim(), signedAt: new Date().toISOString() };
    updateJha(jha.id, { signOffs: [...jha.signOffs, sig] });
    setSignOffFor(null); setSigName(''); setSigRole('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [items, signOffFor, sigName, sigRole, updateJha]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'JHAs' }} />
        <EmptyState
          icon={<HardHat size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Open a project first"
          message="Job hazard analyses are tied to a project so each one carries its trade, steps, and sign-offs. To start one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Open JHAs and hit + to add one, or generate it with AI.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `JHAs — ${project.name}` }} />
      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {items.map(item => {
          const sc = getStatusConfig(themeColors, item.status);
          return (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.85} onPress={() => openEdit(item)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta}>
                    {[item.trade, item.date].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={[styles.statusChip, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.statusChipText, { color: sc.color }]}>{sc.label}</Text>
                </View>
              </View>

              <Text style={styles.cardSummary}>
                {item.steps.length} step{item.steps.length === 1 ? '' : 's'} · {item.requiredPPE.length} PPE
                {item.aiGenerated ? ' · AI' : ''}
              </Text>

              {item.signOffs.length > 0 ? (
                <View style={styles.signMetaRow}>
                  <View style={styles.signRow}>
                    <PenLine size={12} color={themeColors.success} strokeWidth={1.75} />
                    <Text style={styles.signRowText}>
                      {item.signOffs.length} sign-off{item.signOffs.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.lockedChip}>
                    <Lock size={11} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedChipText}>Locked</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.cardActions}>
                {item.status === 'draft' && (
                  <TouchableOpacity style={[styles.cardActionBtn, { backgroundColor: themeColors.successSoft }]} onPress={() => handleActivate(item)}>
                    <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                    <Text style={[styles.cardActionText, { color: themeColors.success }]}>Activate</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.cardActionBtn} onPress={() => { setSignOffFor(item.id); setSigName(''); setSigRole(''); }}>
                  <PenLine size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.cardActionText, { color: themeColors.accent }]}>Add sign-off</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        {items.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<HardHat size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No JHAs yet"
              message="Break a task into steps, name the hazards, and lock in the controls before crews start. Let AI draft it from a task description, then edit and get sign-offs."
              actionLabel="Add first JHA"
              onAction={() => { resetForm(); setShowForm(true); }}
            />
          </View>
        )}

        <TouchableOpacity
          style={styles.addItemBtn}
          onPress={() => router.push({ pathname: '/copilot', params: { capabilityId: 'jha', projectId: projectId ?? '' } })}
          activeOpacity={0.7}
          testID="add-jha-voice"
        >
          <Mic size={16} color={themeColors.accent} strokeWidth={2} />
          <Text style={styles.addItemBtnText}>Write one by voice</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-jha">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Add JHA</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* JHA form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Back" style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{isLocked ? 'Signed JHA' : editingJha ? 'Edit JHA' : 'New JHA'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {isLocked ? (
                  <View style={styles.lockedBanner}>
                    <Lock size={14} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedBannerText}>
                      Signed — locked. Sign-offs are append-only; the analysis can’t be edited. You can archive it or add more sign-offs.
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>Title *</Text>
                <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={title} onChangeText={setTitle} editable={!isLocked} placeholder="e.g. Roof tie-off — south slope" placeholderTextColor={themeColors.textMuted} testID="jha-title-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Trade</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={trade} onChangeText={setTrade} editable={!isLocked} placeholder="e.g. Roofing" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={date} onChangeText={setDate} editable={!isLocked} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Task Description</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }, isLocked ? styles.inputLocked : null]}
                  value={taskDescription}
                  onChangeText={setTaskDescription}
                  editable={!isLocked}
                  placeholder="Describe the task so AI can analyze the hazards..."
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                {!isLocked ? (
                  <TouchableOpacity style={styles.aiBtn} onPress={handleGenerate} disabled={generating} activeOpacity={0.85} testID="jha-generate">
                    <MageAIMark size={16} color="#FFFFFF" accentColor="#FFFFFF" />
                    <Text style={styles.aiBtnText}>{generating ? 'Analyzing…' : 'Generate with AI'}</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>Steps</Text>
                  {!isLocked ? (
                    <TouchableOpacity onPress={addStep} style={styles.addStepBtn} accessibilityRole="button" accessibilityLabel="Add step">
                      <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.addStepText}>Add step</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {steps.map((s, idx) => (
                  <View key={s.id} style={styles.stepRow}>
                    <View style={styles.stepRowHeader}>
                      <Text style={styles.stepNum}>Step {idx + 1}</Text>
                      {!isLocked ? (
                        <TouchableOpacity onPress={() => removeStep(s.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove step">
                          <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <TextInput
                      style={[styles.input, isLocked ? styles.inputLocked : null]}
                      value={s.step}
                      onChangeText={v => updateStepField(s.id, 'step', v)}
                      editable={!isLocked}
                      placeholder="Step description"
                      placeholderTextColor={themeColors.textMuted}
                    />
                    <TextInput
                      style={[styles.input, isLocked ? styles.inputLocked : null]}
                      value={s.hazards.join(', ')}
                      onChangeText={v => updateStepField(s.id, 'hazards', v)}
                      editable={!isLocked}
                      placeholder="Hazards (comma-separated)"
                      placeholderTextColor={themeColors.textMuted}
                    />
                    <TextInput
                      style={[styles.input, isLocked ? styles.inputLocked : null]}
                      value={s.controls.join(', ')}
                      onChangeText={v => updateStepField(s.id, 'controls', v)}
                      editable={!isLocked}
                      placeholder="Controls (comma-separated)"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                ))}

                <Text style={styles.fieldLabel}>Required PPE</Text>
                <TextInput
                  style={[styles.input, isLocked ? styles.inputLocked : null]}
                  value={ppeText}
                  onChangeText={handlePpeChange}
                  editable={!isLocked}
                  placeholder="Hard hat, harness, gloves (comma-separated)"
                  placeholderTextColor={themeColors.textMuted}
                />

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>{isLocked ? 'Close' : 'Cancel'}</Text>
                  </TouchableOpacity>
                  {isLocked ? (
                    editingJha?.status !== 'archived' ? (
                      <TouchableOpacity style={[styles.saveBtn, { flexDirection: 'row', gap: 6 }]} onPress={handleArchive} activeOpacity={0.85} testID="archive-jha">
                        <Archive size={15} color="#fff" strokeWidth={1.75} />
                        <Text style={styles.saveBtnText}>Archive</Text>
                      </TouchableOpacity>
                    ) : null
                  ) : (
                    <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-jha">
                      <Text style={styles.saveBtnText}>{editingJha ? 'Update' : 'Add JHA'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sign-off capture — small centered modal */}
      <Modal visible={signOffFor !== null} transparent animationType="fade" onRequestClose={() => setSignOffFor(null)}>
        <View style={styles.signOverlay}>
          <View style={styles.signCard}>
            <View style={styles.formHeader}>
              <Text style={styles.signTitle}>Add sign-off</Text>
              <TouchableOpacity onPress={() => setSignOffFor(null)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput style={styles.input} value={sigName} onChangeText={setSigName} placeholder="Who is signing off" placeholderTextColor={themeColors.textMuted} />
            <Text style={styles.fieldLabel}>Role</Text>
            <TextInput style={styles.input} value={sigRole} onChangeText={setSigRole} placeholder="e.g. Foreman" placeholderTextColor={themeColors.textMuted} />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSignOffFor(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddSignOff} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Sign off</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  cardSummary: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  signMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  signRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' as const, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.successSoft },
  signRowText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.success },
  lockedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '14' },
  lockedChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  lockedBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '30', marginBottom: 4 },
  lockedBannerText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
  inputLocked: { opacity: 0.6 },
  cardActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  cardActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  cardActionText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger, alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  aiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  addStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12' },
  addStepText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  stepRow: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 12, gap: 8, marginTop: 8, borderWidth: 0.5, borderColor: themeColors.line },
  stepRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepNum: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
  signOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'center', padding: 20 },
  signCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius["2xl"], padding: 22, gap: 8, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  signTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
});
