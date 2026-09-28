import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  HardHat, Plus, X, Trash2, ChevronLeft, CheckCircle, PenLine, Lock, Archive, Mic, AlertTriangle,
} from 'lucide-react-native';
import { useCrew, useProjectCrew } from '@/contexts/CrewContext';
import { certFlagsForWorker, lapsedCertConfirmText } from '@/utils/safety/crewCerts';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { SafetyAccessBlocked, useSafetySeat } from '@/app/safety';
import EmptyState from '@/components/EmptyState';
import type { JobHazardAnalysis, JHAStep, JHAStatus, SafetySignoff } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert } from '@/utils/alert';
import { savedCrewLine } from '@/utils/timeClockPayroll';
import {
  aiLimitAlertTitle, crewCardCheck, crewEmptyTitle, crewListNote, safetyAiBlockedReason, safetyAiServerRefusal,
  CREW_CARDS_LOADING, CREW_CARDS_UNAVAILABLE, crewCardsText,
} from '@/utils/safety/safetyRefresh';
// Local calendar day for date defaults — toISOString() is the UTC day and
// stamps an after-5pm-Pacific record with tomorrow's date (audit round 2 #6).
import { todayCalendarDay } from '@/utils/calendarDate';
import { safetyDateProblem, safetyDeleteBlockedReason, safetyWriteBlockedReason } from '@/utils/safety/osha';
import { getLang, t } from '@/i18n/core';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';
import { useT } from '@/contexts/LanguageContext';

function getStatusConfig(tc: ThemeColors, status: JHAStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'draft': return { label: t('safety.jha.statusDraft', 'Draft'), color: tc.textSecondary, bg: tc.line };
    case 'active': return { label: t('safety.jha.statusActive', 'Active'), color: tc.success, bg: tc.successSoft };
    case 'archived': return { label: t('safety.jha.statusArchived', 'Archived'), color: tc.textMuted, bg: tc.line };
  }
}

export default function SafetyJhaScreen() {
  const router = useRouter();
  // Read the project here (not just in Inner) so the gate can ask "was he
  // invited to THIS job?" before paywalling — the tools a foreman actually
  // runs (audit #170). Safe because 20260919130000 routes a collaborator's
  // records to the project owner; before it, they stayed on his own account.
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useProjectAccess(gateProjectId);
  const roleState = useProjectRoleState(gateProjectId);
  if (!canAccess('safety_management')) {
    return <SafetyAccessBlocked roleState={roleState} onClose={() => router.back()} />;
  }
  return <SafetyJhaInner />;
}

function SafetyJhaInner() {
  const { t, tn } = useT();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier, isBusinessOrAbove } = useTierAccess();
  // Generate with AI runs on HIS own plan (safety-generate-jha requires
  // Business on the caller), gated before the tap with the reason (#123).
  const generateBlocked = safetyAiBlockedReason('jha_generate', isBusinessOrAbove);
  const { user } = useAuth();
  const author = ((user?.name && user.name.trim()) || user?.email || '').trim();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const seat = useSafetySeat(projectId);
  const { getJhasForProject, addJha, updateJha, deleteJha, certifications: ownCertifications } = useSafety();
  const { getCrewForProject } = useCrew();
  // Audit #120: on a crew seat, useCrew / useSafety hold the FOREMAN's own
  // (empty) roster and certificates, so the GC's crew never listed and an
  // expired SST signed off with no warning. The GC's roster and card dates
  // come from useProjectCrew (project_crew_roster / project_crew_cert_flags,
  // the same split Time Tracking uses). Only a PICK carries the crew id the
  // card check joins on; a typed name has none.
  const isCrewSeat = seat === 'crew';
  const projectCrew = useProjectCrew(projectId, isCrewSeat);
  const assignedCrew = useMemo(
    () => (isCrewSeat ? projectCrew.crew : getCrewForProject(projectId ?? '')).filter(m => m.status === 'active'),
    [isCrewSeat, projectCrew.crew, getCrewForProject, projectId],
  );
  const certifications = isCrewSeat ? projectCrew.certifications : ownCertifications;
  // A failed or still-running read is "unknown", never "every card valid".
  const cardCheck = crewCardCheck({ isCrewSeat, isLoading: projectCrew.isLoading, fetchedAt: projectCrew.fetchedAt });
  const today = useMemo(() => todayCalendarDay(), []);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getJhasForProject(projectId ?? ''), [projectId, getJhasForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingJha, setEditingJha] = useState<JobHazardAnalysis | null>(null);
  const [title, setTitle] = useState('');
  const [trade, setTrade] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [date, setDate] = useState(() => todayCalendarDay());
  const [steps, setSteps] = useState<JHAStep[]>([]);
  const [requiredPPE, setRequiredPPE] = useState<string[]>([]);
  const [ppeText, setPpeText] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  // What he is TYPING in each step's Hazards / Controls box, keyed by step id
  // (audit #84). The boxes used to be controlled by `list.join(', ')` of the
  // parsed array, so every keystroke split, trimmed and re-joined the text: a
  // trailing space or comma vanished the moment it was typed and 'Fall from
  // height, open edge' became 'Fallfromheightopenedge'. The raw text is the
  // controlled value now; the arrays are parsed from it on every change (so
  // Save always has current arrays) and it lives OUTSIDE `steps`, so it can
  // never reach the saved JobHazardAnalysis. A step with no entry here shows
  // its saved list joined — that is the seed for an opened, AI-built or new
  // step.
  const [stepText, setStepText] = useState<Record<string, { hazards?: string; controls?: string }>>({});

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
  // The crew member picked from the roster for this sign-off, if any. Only a
  // PICK sets it — typing a name clears it — so the certification chip is an
  // exact CrewMember.id join, never a name guess (audit round 2 #2).
  const [sigWorkerId, setSigWorkerId] = useState<string | null>(null);
  // Not memoised: the chip labels are catalog text and must follow the app
  // language on every render (a filter over one worker's certificates).
  const sigFlags = certFlagsForWorker(certifications, sigWorkerId, today);

  const resetForm = useCallback(() => {
    setEditingJha(null);
    setTitle(''); setTrade(''); setTaskDescription('');
    setDate(todayCalendarDay());
    setSteps([]); setRequiredPPE([]); setPpeText(''); setStepText({});
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
    if (field !== 'step') setStepText(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
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
    setStepText({});
    setRequiredPPE(jha.requiredPPE);
    setPpeText(jha.requiredPPE.join(', '));
    setAiGenerated(jha.aiGenerated);
    setShowForm(true);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!taskDescription.trim()) { showAlert(t('safety.jha.addATask', 'Add a task'), t('safety.jha.describeTheTaskFirst', 'Describe the task first so MAGE can list its hazards.')); return; }
    if (generateBlocked) { showAlert(t('safety.ai.businessFeatureTitle', 'Business feature'), generateBlocked); return; }
    const check = await checkAILimit(tier, 'smart');
    if (!check.allowed) { showAlert(aiLimitAlertTitle(check.reason), check.message ?? t('safety.jha.dailyAiLimitReached', 'Daily AI limit reached.')); return; }
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
        // Spanish drafts only when the app is in Spanish; an English body is byte-identical.
        body: JSON.stringify({ trade, taskDescription, projectContext: project?.name ?? '', ...(getLang() === 'es' ? { locale: 'es' } : {}) }),
      });
      const refusal = safetyAiServerRefusal('jha_generate', res.status);
      if (refusal) { showAlert(t('safety.ai.businessFeatureTitle', 'Business feature'), refusal); return; }
      const json = await res.json();
      if (!res.ok || !json.success) { console.warn('[safety-jha] draft failed', json.error); showAlert(t('safety.jha.couldntDraftTheJha', "Couldn't draft the JHA"), t('safety.jha.fillItInBy', 'Fill it in by hand, or try again in a moment.')); return; }
      const aiSteps: JHAStep[] = (json.data.steps ?? []).map((s: { step: string; hazards: string[]; controls: string[] }) => ({
        id: generateUUID(), step: s.step, hazards: s.hazards ?? [], controls: s.controls ?? [],
      }));
      setSteps(aiSteps);
      setStepText({});
      setRequiredPPE(json.data.requiredPPE ?? []);
      setPpeText((json.data.requiredPPE ?? []).join(', '));
      setAiGenerated(true);
      await recordAIUsage('smart');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showAlert(t('safety.jha.couldntDraftTheJha', "Couldn't draft the JHA"), t('safety.jha.youMayBeOffline', "You may be offline. Fill it in by hand, or try again when you're back online."));
    } finally {
      setGenerating(false);
    }
  }, [taskDescription, trade, tier, project, generateBlocked, t]);

  const handleSave = useCallback(() => {
    // Immutable once signed — a signed JHA can only be archived, never edited.
    if (editingJha && editingJha.signOffs.length > 0) {
      showAlert(t('safety.jha.signedAndLocked', 'Signed and locked'), t('safety.jha.thisJhaHasSign', 'This JHA has sign-offs and can no longer be edited. Archive it instead.'));
      return;
    }
    const blocked = safetyWriteBlockedReason(seat);
    if (blocked) { showAlert(t('safety.jha.viewOnly', 'View only'), blocked); return; }
    const ttl = title.trim();
    if (!ttl) { showAlert(t('safety.jha.missingTitle', 'Missing title'), t('safety.jha.giveThisJhaA', 'Give this JHA a title.')); return; }
    const dateProblem = safetyDateProblem(date, t('safety.jha.dateLabel', 'JHA date'));
    if (dateProblem) { showAlert(t('safety.jha.checkTheDate', 'Check the date'), dateProblem); return; }
    const now = new Date().toISOString();
    const ppe = requiredPPE.map(p => p.trim()).filter(Boolean);
    if (editingJha) {
      updateJha(editingJha.id, { title: ttl, trade: trade.trim(), taskDescription: taskDescription.trim(), date, steps, requiredPPE: ppe, aiGenerated });
    } else {
      const jha: JobHazardAnalysis = {
        id: generateUUID(), projectId: projectId ?? '', title: ttl, trade: trade.trim(),
        taskDescription: taskDescription.trim(), date, steps, requiredPPE: ppe, signOffs: [],
        aiGenerated, status: 'draft', createdBy: author, createdAt: now, updatedAt: now,
      };
      addJha(jha);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [title, trade, taskDescription, date, steps, requiredPPE, aiGenerated, editingJha, projectId, addJha, updateJha, resetForm, author, seat, t]);

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
    const blocked = safetyDeleteBlockedReason(seat);
    if (blocked) { showAlert(t('safety.jha.cantDelete', "Can't delete"), blocked); return; }
    const jha = items.find(x => x.id === id);
    if (jha && jha.signOffs.length > 0) {
      showAlert(t('safety.jha.signedAndLocked', 'Signed and locked'), t('safety.jha.aJhaWithRecorded', "A JHA with recorded sign-offs is part of the safety record and can't be deleted. Archive it instead."));
      return;
    }
    showAlert(t('safety.jha.deleteJha', 'Delete JHA'), t('safety.jha.deleteThisJobHazard', 'Delete this job hazard analysis?'), [
      { text: t('common.action.cancel', 'Cancel'), style: 'cancel' },
      { text: t('common.action.delete', 'Delete'), style: 'destructive', onPress: () => deleteJha(id) },
    ]);
  }, [deleteJha, items, seat, t]);

  const commitSignOff = useCallback(() => {
    const jha = items.find(x => x.id === signOffFor);
    if (!jha) { setSignOffFor(null); return; }
    const name = sigName.trim();
    const sig: SafetySignoff = { name, role: sigRole.trim(), signedAt: new Date().toISOString() };
    updateJha(jha.id, { signOffs: [...jha.signOffs, sig] });
    setSignOffFor(null); setSigName(''); setSigRole(''); setSigWorkerId(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [items, signOffFor, sigName, sigRole, updateJha]);

  const handleAddSignOff = useCallback(() => {
    const name = sigName.trim();
    if (!name) { showAlert(t('safety.jha.missingName', 'Missing name'), t('safety.jha.enterWhoIsSigning', 'Enter who is signing off.')); return; }
    // A lapsed card asks first and names the card + date. Not a block.
    // 'Sign them off': the JHA's verb, matching the button below. The default
    // ('Sign them in') belongs to the toolbox sign-in sheet.
    const warn = lapsedCertConfirmText(name, sigFlags, 'Sign them off');
    if (warn) {
      showAlert(t('safety.jha.certificationLapsed', 'Certification lapsed'), warn, [
        { text: t('common.action.cancel', 'Cancel'), style: 'cancel' },
        { text: t('safety.jha.signOffAnyway', 'Sign off anyway'), style: 'destructive', onPress: commitSignOff },
      ]);
      return;
    }
    commitSignOff();
  }, [sigName, sigFlags, commitSignOff, t]);

  // Desktop sheet (wave 6c): the form opens as a capped card centred in the
  // content column; Cmd/Ctrl+Enter or Cmd/Ctrl+S saves it.
  const fForm = useSheetFrame('form', { visible: showForm, animationType: 'slide' });
  useSheetPrimaryHotkey(showForm, handleSave);
  const fSign = useSheetFrame('dialog', { visible: signOffFor !== null, animationType: 'fade' });
  // D5: a crew sign-off is permanent, so Cmd+Enter only — Cmd+S never signs.
  useSheetPrimaryHotkey(signOffFor !== null, handleAddSignOff, { saveKey: false });

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: t('safety.jha.screenTitle', 'JHAs') }} />
        <EmptyState
          icon={<HardHat size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title={t('safety.jha.openAProjectFirst', 'Open a project first')}
          message={t('safety.jha.jhasAreTiedTo', 'JHAs are tied to a project so each one carries its trade, steps and sign-offs. To start one:')}
          steps={[
            t('safety.openSafetyStep', 'Open Safety (Tools, or the sidebar) and pick the project you are on.'),
            t('safety.jha.emptyStepOpen', 'Open JHAs and tap + to add one, or draft it from a task description.'),
          ]}
          // Safety's own project picker, not Home: the "Safety tile inside the
          // project tile grid" these steps used to promise did not exist, so
          // this door led nowhere (audit #81).
          actionLabel={t('safety.jha.pickAProject', 'Pick a project')}
          onAction={() => router.replace('/safety' as never)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: t('safety.jha.titleWithProject', 'JHAs — {name}', { name: project.name }) }} />
      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {/* Audit #121: an invited crew seat reads only the JHAs he filed
            (20260919130000); the GC's are not shown to him. */}
        {isCrewSeat ? (
          <Text style={styles.collabNote} testID="jha-collab-note">{crewListNote('jha')}</Text>
        ) : null}
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
                {item.aiGenerated
                  ? tn('safety.jha.cardSummaryAi', item.steps.length, { one: '{count} step · {ppe} PPE · AI', other: '{count} steps · {ppe} PPE · AI' }, { ppe: item.requiredPPE.length })
                  : tn('safety.jha.cardSummary', item.steps.length, { one: '{count} step · {ppe} PPE', other: '{count} steps · {ppe} PPE' }, { ppe: item.requiredPPE.length })}
              </Text>

              {item.signOffs.length > 0 ? (
                <View style={styles.signMetaRow}>
                  <View style={styles.signRow}>
                    <PenLine size={12} color={themeColors.success} strokeWidth={1.75} />
                    <Text style={styles.signRowText}>
                      {tn('safety.jha.signOffCount', item.signOffs.length, { one: '{count} sign-off', other: '{count} sign-offs' })}
                    </Text>
                  </View>
                  <View style={styles.lockedChip}>
                    <Lock size={11} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedChipText}>{t('safety.jha.locked', 'Locked')}</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.cardActions}>
                {item.status === 'draft' && (
                  <TouchableOpacity style={[styles.cardActionBtn, { backgroundColor: themeColors.successSoft }]} onPress={() => handleActivate(item)}>
                    <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                    <Text style={[styles.cardActionText, { color: themeColors.success }]}>{t('safety.jha.activate', 'Activate')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.cardActionBtn} onPress={() => { setSignOffFor(item.id); setSigName(''); setSigRole(''); setSigWorkerId(null); }}>
                  <PenLine size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.cardActionText, { color: themeColors.accent }]}>{t('safety.jha.addSignOff', 'Add sign-off')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel={t('common.action.delete', 'Delete')}>
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
              title={isCrewSeat ? crewEmptyTitle('jha') : t('safety.jha.noJhasYet', 'No JHAs yet')}
              message={t('safety.jha.breakATaskInto', 'Break a task into steps, name the hazards and set the controls before crews start. Draft it from a task description, then edit it and get sign-offs.')}
              actionLabel={t('safety.jha.addFirstJha', 'Add first JHA')}
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
          <Text style={styles.addItemBtnText}>{t('safety.jha.writeOneByVoice', 'Write one by voice')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-jha">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>{t('safety.jha.addJha', 'Add JHA')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* JHA form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType={fForm.animationType} onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ flexGrow: 1, justifyContent: 'flex-end' as const }, fForm.scrollContent]} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }, fForm.card]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel={t('common.action.back', 'Back')} style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{isLocked ? t('safety.jha.signedJha', 'Signed JHA') : editingJha ? t('safety.jha.editJha', 'Edit JHA') : t('safety.jha.newJha', 'New JHA')}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel={t('common.action.close', 'Close')}>
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {isLocked ? (
                  <View style={styles.lockedBanner}>
                    <Lock size={14} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedBannerText}>
                      {t('safety.jha.signedLockedSignOffs', 'Signed — locked. Sign-offs are append-only; the analysis can’t be edited. You can archive it or add more sign-offs.')}
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>{t('safety.jha.titleLabel', 'Title *')}</Text>
                <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={title} onChangeText={setTitle} editable={!isLocked} placeholder={t('safety.jha.eGRoofTie', 'e.g. Roof tie-off — south slope')} placeholderTextColor={themeColors.textMuted} testID="jha-title-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('safety.jha.trade', 'Trade')}</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={trade} onChangeText={setTrade} editable={!isLocked} placeholder={t('safety.jha.eGRoofing', 'e.g. Roofing')} placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('safety.jha.date', 'Date')}</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={date} onChangeText={setDate} editable={!isLocked} placeholder={t('safety.dateHint', 'YYYY-MM-DD')} placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('safety.jha.taskDescription', 'Task description')}</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }, isLocked ? styles.inputLocked : null]}
                  value={taskDescription}
                  onChangeText={setTaskDescription}
                  editable={!isLocked}
                  placeholder={t('safety.jha.describeTheTaskTo', 'Describe the task to list its hazards')}
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                {!isLocked ? (
                  <>
                    <TouchableOpacity style={[styles.aiBtn, generateBlocked ? styles.aiBtnDisabled : null]} onPress={handleGenerate} disabled={generating || !!generateBlocked} activeOpacity={0.85} testID="jha-generate">
                      <MageAIMark size={16} color="#FFFFFF" accentColor="#FFFFFF" />
                      <Text style={styles.aiBtnText}>{generating ? t('safety.jha.draftingTheJha', 'Drafting the JHA…') : t('safety.jha.draftJha', 'Draft JHA')}</Text>
                    </TouchableOpacity>
                    {generateBlocked ? (
                      <Text style={styles.cardCheckText} testID="jha-generate-blocked">{generateBlocked}</Text>
                    ) : null}
                  </>
                ) : null}

                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>{t('safety.jha.steps', 'Steps')}</Text>
                  {!isLocked ? (
                    <TouchableOpacity onPress={addStep} style={styles.addStepBtn} accessibilityRole="button" accessibilityLabel={t('safety.jha.addStep', 'Add step')}>
                      <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.addStepText}>{t('safety.jha.addStep', 'Add step')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {steps.map((s, idx) => (
                  <View key={s.id} style={styles.stepRow}>
                    <View style={styles.stepRowHeader}>
                      <Text style={styles.stepNum}>{t('safety.jha.stepNumber', 'Step {n}', { n: idx + 1 })}</Text>
                      {!isLocked ? (
                        <TouchableOpacity onPress={() => removeStep(s.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('safety.jha.removeStep', 'Remove step')}>
                          <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <TextInput
                      style={[styles.input, isLocked ? styles.inputLocked : null]}
                      value={s.step}
                      onChangeText={v => updateStepField(s.id, 'step', v)}
                      editable={!isLocked}
                      placeholder={t('safety.jha.stepDescription', 'Step description')}
                      placeholderTextColor={themeColors.textMuted}
                    />
                    <TextInput
                      style={[styles.input, isLocked ? styles.inputLocked : null]}
                      value={stepText[s.id]?.hazards ?? s.hazards.join(', ')}
                      onChangeText={v => updateStepField(s.id, 'hazards', v)}
                      editable={!isLocked}
                      placeholder={t('safety.jha.hazardsCommaSeparated', 'Hazards (comma-separated)')}
                      placeholderTextColor={themeColors.textMuted}
                    />
                    <TextInput
                      style={[styles.input, isLocked ? styles.inputLocked : null]}
                      value={stepText[s.id]?.controls ?? s.controls.join(', ')}
                      onChangeText={v => updateStepField(s.id, 'controls', v)}
                      editable={!isLocked}
                      placeholder={t('safety.jha.controlsCommaSeparated', 'Controls (comma-separated)')}
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                ))}

                <Text style={styles.fieldLabel}>{t('safety.jha.requiredPpe', 'Required PPE')}</Text>
                <TextInput
                  style={[styles.input, isLocked ? styles.inputLocked : null]}
                  value={ppeText}
                  onChangeText={handlePpeChange}
                  editable={!isLocked}
                  placeholder={t('safety.jha.hardHatHarnessGloves', 'Hard hat, harness, gloves (separate with commas)')}
                  placeholderTextColor={themeColors.textMuted}
                />

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>{isLocked ? t('common.action.close', 'Close') : t('common.action.cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                  {isLocked ? (
                    editingJha?.status !== 'archived' ? (
                      <TouchableOpacity style={[styles.saveBtn, { flexDirection: 'row', gap: 6 }]} onPress={handleArchive} activeOpacity={0.85} testID="archive-jha">
                        <Archive size={15} color="#fff" strokeWidth={1.75} />
                        <Text style={styles.saveBtnText}>{t('safety.jha.archive', 'Archive')}</Text>
                      </TouchableOpacity>
                    ) : null
                  ) : (
                    <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-jha">
                      <Text style={styles.saveBtnText}>{editingJha ? t('safety.jha.update', 'Update') : t('safety.jha.addJha', 'Add JHA')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sign-off capture — small centered modal */}
      <Modal visible={signOffFor !== null} transparent animationType={fSign.animationType} onRequestClose={() => setSignOffFor(null)}>
        <View style={[styles.signOverlay, fSign.overlay]}>
          <View style={[styles.signCard, fSign.card]}>
            <View style={styles.formHeader}>
              <Text style={styles.signTitle}>{t('safety.jha.addSignOff', 'Add sign-off')}</Text>
              <TouchableOpacity onPress={() => setSignOffFor(null)} accessibilityRole="button" accessibilityLabel={t('common.action.close', 'Close')}>
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {assignedCrew.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>{t('safety.jha.crewOnThisProject', 'Crew on this project')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                  {assignedCrew.map(m => {
                    const active = sigWorkerId === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.crewPick, active ? styles.crewPickActive : null]}
                        onPress={() => { setSigWorkerId(m.id); setSigName(m.fullName); if (!sigRole.trim() && m.trades?.[0]) setSigRole(m.trades[0]); }}
                        testID="jha-signoff-crew"
                      >
                        <Text style={[styles.crewPickText, active ? styles.crewPickTextActive : null]}>{m.fullName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}
            {cardCheck === 'loading' || cardCheck === 'unavailable' ? (
              <View style={styles.cardCheckRow} testID="jha-card-check">
                <AlertTriangle size={12} color={themeColors.accentLabel} strokeWidth={2} />
                <Text style={styles.cardCheckText}>{crewCardsText(cardCheck === 'loading' ? CREW_CARDS_LOADING : CREW_CARDS_UNAVAILABLE)}</Text>
                {cardCheck === 'unavailable' ? (
                  <TouchableOpacity onPress={projectCrew.refetch} accessibilityRole="button" hitSlop={8} testID="jha-card-check-retry">
                    <Text style={styles.cardCheckRetry}>{t('common.action.retry', 'Retry')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : isCrewSeat && projectCrew.fromCache && projectCrew.fetchedAt ? (
              <Text style={styles.cardCheckText}>{savedCrewLine(projectCrew.fetchedAt, projectCrew.offline || projectCrew.isPaused)}</Text>
            ) : null}
            <Text style={styles.fieldLabel}>{t('safety.jha.name', 'Name *')}</Text>
            <TextInput style={styles.input} value={sigName} onChangeText={(v) => { setSigName(v); setSigWorkerId(null); }} placeholder={t('safety.jha.whoIsSigningOff', 'Who is signing off')} placeholderTextColor={themeColors.textMuted} />
            {sigFlags.map(f => (
              <View key={f.certId} style={[styles.certChip, f.status === 'expired' ? styles.certChipExpired : null]} testID="jha-cert-chip">
                <AlertTriangle size={11} color={f.status === 'expired' ? themeColors.danger : themeColors.accentLabel} strokeWidth={2} />
                <Text style={[styles.certChipText, { color: f.status === 'expired' ? themeColors.danger : themeColors.accentLabel }]}>{f.label}</Text>
              </View>
            ))}
            <Text style={styles.fieldLabel}>{t('safety.jha.role', 'Role')}</Text>
            <TextInput style={styles.input} value={sigRole} onChangeText={setSigRole} placeholder={t('safety.jha.eGForeman', 'e.g. Foreman')} placeholderTextColor={themeColors.textMuted} />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSignOffFor(null)}>
                <Text style={styles.cancelBtnText}>{t('common.action.cancel', 'Cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddSignOff} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>{t('safety.jha.signOff', 'Sign off')}</Text>
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
  aiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  aiBtnDisabled: { opacity: 0.5 },
  collabNote: { marginHorizontal: 20, marginTop: 12, fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 19 },
  cardCheckRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flexWrap: 'wrap' as const, marginTop: 4 },
  cardCheckText: { flexShrink: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 16, marginTop: 4 },
  cardCheckRetry: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  addStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12' },
  addStepText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  stepRow: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 12, gap: 8, marginTop: 8, borderWidth: 0.5, borderColor: themeColors.line },
  stepRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepNum: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
  signOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'center', padding: 20 },
  signCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius["2xl"], padding: 22, gap: 8, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  crewPick: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  crewPickActive: { backgroundColor: themeColors.accentFill },
  crewPickText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  crewPickTextActive: { color: '#fff' },
  certChip: { flexDirection: 'row' as const, alignItems: 'center' as const, alignSelf: 'flex-start' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accentSoft },
  certChipExpired: { backgroundColor: themeColors.dangerSoft },
  certChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  signTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
});
