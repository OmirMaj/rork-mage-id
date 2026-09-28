import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Megaphone, Plus, X, Trash2, PenLine, CheckCircle, Users, ChevronLeft, Lock, Mic, AlertTriangle, UserPlus,
} from 'lucide-react-native';
import { useCrew, useProjectCrew } from '@/contexts/CrewContext';
import { prefillAttendeesFromCrew } from '@/utils/safety/toolboxRoster';
import { certFlagsForWorker, lapsedCertConfirmText } from '@/utils/safety/crewCerts';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { SafetyAccessBlocked, useSafetySeat } from '@/app/safety';
import EmptyState from '@/components/EmptyState';
import type { ToolboxTalk, SafetyAttendee } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { savedCrewLine } from '@/utils/timeClockPayroll';
import {
  crewCardCheck, crewEmptyTitle, crewListNote, CREW_CARDS_LOADING, CREW_CARDS_UNAVAILABLE, crewCardsText,
} from '@/utils/safety/safetyRefresh';
// Local calendar day for date defaults — toISOString() is the UTC day and
// stamps an after-5pm-Pacific record with tomorrow's date (audit round 2 #6).
import { todayCalendarDay } from '@/utils/calendarDate';
import { safetyDateProblem, safetyDeleteBlockedReason, safetyWriteBlockedReason } from '@/utils/safety/osha';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';
import { useT } from '@/contexts/LanguageContext';

export default function SafetyToolboxScreen() {
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
  return <SafetyToolboxInner />;
}

function SafetyToolboxInner() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const author = ((user?.name && user.name.trim()) || user?.email || '').trim();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const seat = useSafetySeat(projectId);
  const { getToolboxTalksForProject, addToolboxTalk, updateToolboxTalk, deleteToolboxTalk, certifications: ownCertifications } = useSafety();
  // Read-only: who is assigned to this job (CrewMember.projectIds, written by
  // app/crew.tsx). Pre-fills the sign-in sheet — audit round 2 #5b.
  const { getCrewForProject } = useCrew();
  // Audit #120: on a crew seat useCrew / useSafety are the FOREMAN's own
  // (empty) roster and certificates, so the GC's crew never pre-filled and a
  // lapsed card signed in unflagged. The GC's roster + card dates come from
  // useProjectCrew (the split Time Tracking uses). Only a roster row carries
  // the crew id (subId) the card check joins on; a typed name has none.
  const isCrewSeat = seat === 'crew';
  const projectCrew = useProjectCrew(projectId, isCrewSeat);
  const assignedCrew = useMemo(
    () => (isCrewSeat ? projectCrew.crew : getCrewForProject(projectId ?? '')),
    [isCrewSeat, projectCrew.crew, getCrewForProject, projectId],
  );
  const certifications = isCrewSeat ? projectCrew.certifications : ownCertifications;
  // A failed or still-running read is "unknown", never "every card valid".
  const cardCheck = crewCardCheck({ isCrewSeat, isLoading: projectCrew.isLoading, fetchedAt: projectCrew.fetchedAt });
  const today = useMemo(() => todayCalendarDay(), []);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getToolboxTalksForProject(projectId ?? ''), [projectId, getToolboxTalksForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingTalk, setEditingTalk] = useState<ToolboxTalk | null>(null);
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState(() => todayCalendarDay());
  const [presenter, setPresenter] = useState('');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState<SafetyAttendee[]>([]);
  const [attendeeName, setAttendeeName] = useState('');

  // A talk becomes an immutable record once anyone has signed in. Signatures
  // are append-only: you can still add + sign new attendees, but the topic,
  // presenter, date, and notes are locked, and an existing signature can't be
  // removed or un-signed. Editing a signed sign-in sheet would invalidate the
  // record inspectors rely on.
  const isLocked = useMemo(
    () => !!editingTalk && editingTalk.attendees.some(a => !!a.signedAt),
    [editingTalk],
  );

  const resetForm = useCallback(() => {
    setEditingTalk(null);
    setTopic(''); setPresenter(''); setNotes('');
    setDate(todayCalendarDay());
    setAttendees([]); setAttendeeName('');
  }, []);

  /** Open a NEW talk with the assigned crew already listed, unsigned. He
   *  removes whoever is absent; nobody is signed for him. */
  const openNew = useCallback(() => {
    resetForm();
    setAttendees(prefillAttendeesFromCrew([], assignedCrew));
    setShowForm(true);
  }, [resetForm, assignedCrew]);

  // Crew assigned after the talk was opened (or never pre-filled because the
  // talk predates this) — one tap instead of retyping. Still unsigned rows, so
  // this is allowed on a locked (signed) sheet: sign-ins are append-only.
  const missingCrewCount = useMemo(
    () => prefillAttendeesFromCrew(attendees, assignedCrew).length - attendees.length,
    [attendees, assignedCrew],
  );
  const addAssignedCrew = useCallback(() => {
    setAttendees(prev => prefillAttendeesFromCrew(prev, assignedCrew));
  }, [assignedCrew]);

  // ── Attendee editor ──────────────────────────────────────────────────
  const addAttendee = useCallback(() => {
    const n = attendeeName.trim();
    if (!n) return;
    setAttendees(prev => [...prev, { name: n }]);
    setAttendeeName('');
  }, [attendeeName]);

  const removeAttendee = useCallback((idx: number) => {
    setAttendees(prev => {
      // A recorded signature is immutable — signed attendees can't be pulled
      // off the sheet. Unsigned rows are still free to remove.
      if (prev[idx]?.signedAt) {
        showAlert(t('safety.toolbox.signedInAndLocked', 'Signed in and locked'), t('safety.toolbox.aSignedAttendeeIs', "A signed attendee is part of the record and can't be removed."));
        return prev;
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, [t]);

  const signAttendee = useCallback((idx: number) => {
    setAttendees(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      // Signing is append-only: once signed, it stays signed. Only an unsigned
      // attendee can be signed in.
      if (a.signedAt) {
        showAlert(t('safety.toolbox.signedInAndLocked', 'Signed in and locked'), t('safety.toolbox.aSignatureCantBe', "A signature can't be undone once recorded."));
        return a;
      }
      return { ...a, signedAt: new Date().toISOString() };
    }));
  }, [t]);

  // Signing someone whose card has lapsed asks first and names the card and its
  // date (audit round 2 #2). A confirmation, not a block: the super may know the
  // renewal is in hand — but he decides with the fact in front of him.
  const toggleAttendeeSigned = useCallback((idx: number) => {
    const a = attendees[idx];
    if (a && !a.signedAt && a.subId) {
      const warn = lapsedCertConfirmText(a.name, certFlagsForWorker(certifications, a.subId, today));
      if (warn) {
        showAlert(t('safety.toolbox.certificationLapsed', 'Certification lapsed'), warn, [
          { text: t('common.action.cancel', 'Cancel'), style: 'cancel' },
          { text: t('safety.toolbox.signInAnyway', 'Sign in anyway'), style: 'destructive', onPress: () => signAttendee(idx) },
        ]);
        return;
      }
    }
    signAttendee(idx);
  }, [attendees, certifications, today, signAttendee, t]);

  const openEdit = useCallback((talk: ToolboxTalk) => {
    setEditingTalk(talk);
    setTopic(talk.topic);
    setDate(talk.date);
    setPresenter(talk.presenter);
    setNotes(talk.notes);
    setAttendees(talk.attendees);
    setAttendeeName('');
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    const blocked = safetyWriteBlockedReason(seat);
    if (blocked) { showAlert(t('safety.toolbox.viewOnly', 'View only'), blocked); return; }
    const tp = topic.trim();
    if (!tp) { showAlert(t('safety.toolbox.missingTopic', 'Missing topic'), t('safety.toolbox.whatWasTheTalk', 'What was the talk about?')); return; }
    // A typed '9/18' used to save as-is (audit #168); a sign-in sheet's date
    // is evidence, so only a real day is filed.
    const dateProblem = safetyDateProblem(date, t('safety.toolbox.dateLabel', 'Talk date'));
    if (dateProblem) { showAlert(t('safety.toolbox.checkTheDate', 'Check the date'), dateProblem); return; }
    const now = new Date().toISOString();
    if (editingTalk) {
      updateToolboxTalk(editingTalk.id, { topic: tp, date, presenter: presenter.trim(), notes: notes.trim(), attendees });
    } else {
      const talk: ToolboxTalk = {
        id: generateUUID(), projectId: projectId ?? '', topic: tp, date, presenter: presenter.trim(),
        notes: notes.trim(), attendees, aiTopicSource: 'manual', createdBy: author, createdAt: now, updatedAt: now,
      };
      addToolboxTalk(talk);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [topic, date, presenter, notes, attendees, editingTalk, projectId, addToolboxTalk, updateToolboxTalk, resetForm, author, seat, t]);

  const handleDelete = useCallback((id: string) => {
    const blocked = safetyDeleteBlockedReason(seat);
    if (blocked) { showAlert(t('safety.toolbox.cantDelete', "Can't delete"), blocked); return; }
    const talk = items.find(x => x.id === id);
    if (talk && talk.attendees.some(a => !!a.signedAt)) {
      showAlert(t('safety.toolbox.signedAndLocked', 'Signed and locked'), t('safety.toolbox.aToolboxTalkWith', "A toolbox talk with signed attendees is part of the safety record and can't be deleted."));
      return;
    }
    showAlert(t('safety.toolbox.deleteToolboxTalk', 'Delete toolbox talk'), t('safety.toolbox.deleteThisToolboxTalk', 'Delete this toolbox talk?'), [
      { text: t('common.action.cancel', 'Cancel'), style: 'cancel' },
      { text: t('common.action.delete', 'Delete'), style: 'destructive', onPress: () => deleteToolboxTalk(id) },
    ]);
  }, [deleteToolboxTalk, items, seat, t]);

  // Desktop sheet (wave 6c): the form opens as a capped card centred in the
  // content column; Cmd/Ctrl+Enter or Cmd/Ctrl+S saves it.
  const fForm = useSheetFrame('form', { visible: showForm, animationType: 'slide' });
  useSheetPrimaryHotkey(showForm, handleSave);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: t('safety.toolbox.screenTitle', 'Toolbox talks') }} />
        <EmptyState
          icon={<Megaphone size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title={t('safety.toolbox.openAProjectFirst', 'Open a project first')}
          message={t('safety.toolbox.toolboxTalksAreTied', 'Toolbox talks are tied to a project so each one carries its topic, presenter, and attendee sign-ins. To start one:')}
          steps={[
            t('safety.openSafetyStep', 'Open Safety (Tools, or the sidebar) and pick the project you are on.'),
            t('safety.toolbox.emptyStepOpen', 'Open Toolbox talks and tap + to add one.'),
          ]}
          // Safety's own project picker, not Home: the "Safety tile inside the
          // project tile grid" these steps used to promise did not exist, so
          // this door led nowhere (audit #81).
          actionLabel={t('safety.toolbox.pickAProject', 'Pick a project')}
          onAction={() => router.replace('/safety' as never)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: t('safety.toolbox.titleWithProject', 'Toolbox talks — {name}', { name: project.name }) }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        {/* Audit #121: an invited crew seat reads only the talks he filed
            (20260919130000); the GC's are not shown to him. */}
        {isCrewSeat ? (
          <Text style={styles.collabNote} testID="toolbox-collab-note">{crewListNote('toolbox')}</Text>
        ) : null}
        {items.map(item => {
          const signed = item.attendees.filter(a => a.signedAt).length;
          return (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.85} onPress={() => openEdit(item)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.topic}</Text>
                  <Text style={styles.cardMeta}>
                    {[item.presenter, item.date].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel={t('common.action.delete', 'Delete')}>
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <View style={styles.attendeeSummary}>
                <Users size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
                <Text style={styles.cardSummary}>
                  {/* "listed", not "attendees": the roster pre-fill adds the
                      crew before anyone signs, so the count is who is on the
                      sheet, and only the signed number is who attended. */}
                  {t('safety.toolbox.listedSigned', '{listed} listed · {signed} signed', { listed: item.attendees.length, signed })}
                </Text>
                {signed > 0 ? (
                  <View style={styles.lockedChip}>
                    <Lock size={11} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedChipText}>{t('safety.toolbox.locked', 'Locked')}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}

        {items.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<Megaphone size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title={isCrewSeat ? crewEmptyTitle('toolbox') : t('safety.toolbox.noToolboxTalksYet', 'No toolbox talks yet')}
              message={t('safety.toolbox.logThePreShift', 'Log the pre-shift safety huddle: the topic, who presented and who signed in.')}
              actionLabel={t('safety.toolbox.addFirstTalk', 'Add first talk')}
              onAction={openNew}
            />
          </View>
        )}

        <TouchableOpacity
          style={styles.addItemBtn}
          onPress={() => router.push({ pathname: '/copilot', params: { capabilityId: 'toolbox_talk', projectId: projectId ?? '' } })}
          activeOpacity={0.7}
          testID="add-toolbox-voice"
        >
          <Mic size={16} color={themeColors.accent} strokeWidth={2} />
          <Text style={styles.addItemBtnText}>{t('safety.toolbox.writeOneByVoice', 'Write one by voice')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.addItemBtn} onPress={openNew} activeOpacity={0.7} testID="add-toolbox">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>{t('safety.toolbox.addToolboxTalk', 'Add toolbox talk')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Toolbox talk form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType={fForm.animationType} onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ flexGrow: 1, justifyContent: 'flex-end' as const }, fForm.scrollContent]} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }, fForm.card]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel={t('common.action.back', 'Back')} style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{isLocked ? t('safety.toolbox.signedTalk', 'Signed talk') : editingTalk ? t('safety.toolbox.editTalk', 'Edit talk') : t('safety.toolbox.newToolboxTalk', 'New toolbox talk')}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel={t('common.action.close', 'Close')}>
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {isLocked ? (
                  <View style={styles.lockedBanner}>
                    <Lock size={14} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.lockedBannerText}>
                      {t('safety.toolbox.signedAndLockedSign', 'Signed and locked. Sign-ins can only be added, and the topic, presenter, date and notes can’t be edited.')}
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>{t('safety.toolbox.topic', 'Topic *')}</Text>
                <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={topic} onChangeText={setTopic} editable={!isLocked} placeholder={t('safety.toolbox.eGLadderSafety', 'e.g. Ladder safety')} placeholderTextColor={themeColors.textMuted} testID="toolbox-topic-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('safety.toolbox.presenter', 'Presenter')}</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={presenter} onChangeText={setPresenter} editable={!isLocked} placeholder={t('safety.toolbox.eGForeman', 'e.g. Foreman')} placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('safety.toolbox.date', 'Date')}</Text>
                    <TextInput style={[styles.input, isLocked ? styles.inputLocked : null]} value={date} onChangeText={setDate} editable={!isLocked} placeholder={t('safety.dateHint', 'YYYY-MM-DD')} placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('safety.toolbox.notes', 'Notes')}</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }, isLocked ? styles.inputLocked : null]}
                  value={notes}
                  onChangeText={setNotes}
                  editable={!isLocked}
                  placeholder={t('safety.toolbox.keyPointsCoveredIn', 'Key points covered in the talk')}
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>{t('safety.toolbox.attendees', 'Attendees')}</Text>
                  {missingCrewCount > 0 ? (
                    <TouchableOpacity style={styles.crewAddBtn} onPress={addAssignedCrew} accessibilityRole="button" testID="toolbox-add-crew">
                      <UserPlus size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.crewAddText}>{t('safety.toolbox.addAssignedCrew', 'Add assigned crew ({count})', { count: missingCrewCount })}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {cardCheck === 'loading' || cardCheck === 'unavailable' ? (
                  <View style={styles.cardCheckRow} testID="toolbox-card-check">
                    <AlertTriangle size={12} color={themeColors.accentLabel} strokeWidth={2} />
                    <Text style={styles.cardCheckText}>{crewCardsText(cardCheck === 'loading' ? CREW_CARDS_LOADING : CREW_CARDS_UNAVAILABLE)}</Text>
                    {cardCheck === 'unavailable' ? (
                      <TouchableOpacity onPress={projectCrew.refetch} accessibilityRole="button" hitSlop={8} testID="toolbox-card-check-retry">
                        <Text style={styles.cardCheckRetry}>{t('common.action.retry', 'Retry')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : isCrewSeat && projectCrew.fromCache && projectCrew.fetchedAt ? (
                  <Text style={styles.hintText}>{savedCrewLine(projectCrew.fetchedAt, projectCrew.offline || projectCrew.isPaused)}</Text>
                ) : null}
                {!editingTalk && assignedCrew.length > 0 ? (
                  <Text style={styles.hintText}>
                    {t('safety.toolbox.listedFromTheCrew', "Listed from the crew assigned to this project. Remove anyone who isn't here, then have each person sign.")}
                  </Text>
                ) : null}
                <View style={styles.attendeeAddRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={attendeeName}
                    onChangeText={setAttendeeName}
                    placeholder={t('safety.toolbox.attendeeName', 'Attendee name')}
                    placeholderTextColor={themeColors.textMuted}
                    onSubmitEditing={addAttendee}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.attendeeAddBtn} onPress={addAttendee} accessibilityRole="button" accessibilityLabel={t('safety.toolbox.addAttendee', 'Add attendee')}>
                    <Plus size={18} color={themeColors.accent} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {attendees.map((a, idx) => {
                  // Only a roster-linked row gets a chip — see utils/safety/crewCerts.
                  const flags = a.subId ? certFlagsForWorker(certifications, a.subId, today) : [];
                  return (
                  <View key={`${a.name}-${idx}`} style={styles.attendeeRow}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.attendeeName} numberOfLines={1}>{a.name}</Text>
                      {flags.map(f => (
                        <View key={f.certId} style={[styles.certChip, f.status === 'expired' ? styles.certChipExpired : null]} testID="toolbox-cert-chip">
                          <AlertTriangle size={11} color={f.status === 'expired' ? themeColors.danger : themeColors.accentLabel} strokeWidth={2} />
                          <Text style={[styles.certChipText, { color: f.status === 'expired' ? themeColors.danger : themeColors.accentLabel }]}>{f.label}</Text>
                        </View>
                      ))}
                    </View>
                    <TouchableOpacity
                      style={[styles.signToggle, a.signedAt ? { backgroundColor: themeColors.successSoft } : null]}
                      onPress={() => toggleAttendeeSigned(idx)}
                      accessibilityRole="button"
                      accessibilityLabel={a.signedAt ? t('safety.toolbox.signed', 'Signed') : t('safety.toolbox.markSigned', 'Mark signed')}
                    >
                      {a.signedAt
                        ? <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                        : <PenLine size={14} color={themeColors.textSecondary} strokeWidth={1.75} />}
                      <Text style={[styles.signToggleText, { color: a.signedAt ? themeColors.success : themeColors.textSecondary }]}>
                        {a.signedAt ? t('safety.toolbox.signed', 'Signed') : t('safety.toolbox.sign', 'Sign')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeAttendee(idx)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('safety.toolbox.removeAttendee', 'Remove attendee')}>
                      <X size={16} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                  );
                })}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>{t('common.action.cancel', 'Cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-toolbox">
                    <Text style={styles.saveBtnText}>{editingTalk ? t('safety.toolbox.update', 'Update') : t('safety.toolbox.addTalk', 'Add talk')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  cardSummary: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  attendeeSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  lockedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '14' },
  lockedChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  lockedBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '30', marginBottom: 4 },
  lockedBannerText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
  inputLocked: { opacity: 0.6 },
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '18', alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  attendeeAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attendeeAddBtn: { width: 44, height: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '12', alignItems: 'center', justifyContent: 'center' },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, borderWidth: 0.5, borderColor: themeColors.line },
  crewAddBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12' },
  crewAddText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  hintText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16 },
  collabNote: { marginHorizontal: 20, marginTop: 12, fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 19 },
  cardCheckRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flexWrap: 'wrap' as const, marginTop: 4 },
  cardCheckText: { flexShrink: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 16 },
  cardCheckRetry: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  certChip: { flexDirection: 'row' as const, alignItems: 'center' as const, alignSelf: 'flex-start' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accentSoft },
  certChipExpired: { backgroundColor: themeColors.dangerSoft },
  certChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  attendeeName: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text, fontWeight: '600' as const },
  signToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  signToggleText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
