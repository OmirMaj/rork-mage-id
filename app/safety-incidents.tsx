import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ShieldAlert, Plus, X, Sparkles, Trash2, AlertTriangle, ChevronLeft, Check,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type {
  SafetyIncident, SafetyIncidentType, SafetyIncidentSeverity, SafetyIncidentStatus,
  SafetyTreatment, IncidentCorrectiveAction, IncidentPerson,
} from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { isOshaRecordable } from '@/utils/safety/osha';
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';

const TYPE_OPTIONS: { value: SafetyIncidentType; label: string }[] = [
  { value: 'injury', label: 'Injury' },
  { value: 'near_miss', label: 'Near miss' },
  { value: 'property', label: 'Property' },
  { value: 'environmental', label: 'Environ.' },
];
const SEVERITY_OPTIONS: { value: SafetyIncidentSeverity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];
const TREATMENT_OPTIONS: { value: SafetyTreatment; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'first_aid', label: 'First aid' },
  { value: 'medical_beyond_first_aid', label: 'Medical' },
];

function getStatusConfig(t: ThemeColors, status: SafetyIncidentStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'open': return { label: 'Open', color: t.danger, bg: t.danger + '18' };
    case 'investigating': return { label: 'Investigating', color: t.accent, bg: t.accent + '18' };
    case 'closed': return { label: 'Closed', color: t.success, bg: t.successSoft };
  }
}

function nextStatus(s: SafetyIncidentStatus): SafetyIncidentStatus {
  if (s === 'open') return 'investigating';
  if (s === 'investigating') return 'closed';
  return 'open';
}

export default function SafetyIncidentsScreen() {
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
  return <SafetyIncidentsInner />;
}

function SafetyIncidentsInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useTierAccess();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { getIncidentsForProject, addIncident, updateIncident, deleteIncident } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getIncidentsForProject(projectId ?? ''), [projectId, getIncidentsForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingIncident, setEditingIncident] = useState<SafetyIncident | null>(null);
  const [type, setType] = useState<SafetyIncidentType>('injury');
  const [severity, setSeverity] = useState<SafetyIncidentSeverity>('low');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [treatment, setTreatment] = useState<SafetyTreatment>('none');
  const [daysAway, setDaysAway] = useState('');
  const [restrictedDuty, setRestrictedDuty] = useState(false);
  const [lostConsciousness, setLostConsciousness] = useState(false);
  const [fatality, setFatality] = useState(false);
  const [correctiveActions, setCorrectiveActions] = useState<IncidentCorrectiveAction[]>([]);
  const [peopleInvolved, setPeopleInvolved] = useState<IncidentPerson[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [status, setStatus] = useState<SafetyIncidentStatus>('open');

  // AI draft-from-notes.
  const [draftNotes, setDraftNotes] = useState('');
  const [drafting, setDrafting] = useState(false);

  const resetForm = useCallback(() => {
    setEditingIncident(null);
    setType('injury'); setSeverity('low');
    setOccurredAt(new Date().toISOString().slice(0, 10));
    setDescription(''); setLocation('');
    setTreatment('none'); setDaysAway('');
    setRestrictedDuty(false); setLostConsciousness(false); setFatality(false);
    setCorrectiveActions([]); setPeopleInvolved([]); setPhotoUrls([]);
    setStatus('open'); setDraftNotes(''); setDrafting(false);
  }, []);

  // ── Corrective-action editor ─────────────────────────────────────────
  const addCorrectiveAction = useCallback(() => {
    setCorrectiveActions(prev => [...prev, { action: '', owner: '', done: false }]);
  }, []);
  const updateCorrectiveAction = useCallback((idx: number, field: 'action' | 'owner', value: string) => {
    setCorrectiveActions(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }, []);
  const toggleCorrectiveDone = useCallback((idx: number) => {
    setCorrectiveActions(prev => prev.map((a, i) => i === idx ? { ...a, done: !a.done } : a));
  }, []);
  const removeCorrectiveAction = useCallback((idx: number) => {
    setCorrectiveActions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // ── People-involved editor ───────────────────────────────────────────
  const addPerson = useCallback(() => {
    setPeopleInvolved(prev => [...prev, { name: '', role: '' }]);
  }, []);
  const updatePerson = useCallback((idx: number, field: 'name' | 'role', value: string) => {
    setPeopleInvolved(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);
  const removePerson = useCallback((idx: number) => {
    setPeopleInvolved(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const openEdit = useCallback((inc: SafetyIncident) => {
    setEditingIncident(inc);
    setType(inc.type); setSeverity(inc.severity); setOccurredAt(inc.occurredAt);
    setDescription(inc.description); setLocation(inc.location);
    setTreatment(inc.treatment); setDaysAway(String(inc.daysAway || ''));
    setRestrictedDuty(inc.restrictedDuty); setLostConsciousness(inc.lostConsciousness); setFatality(inc.fatality);
    setCorrectiveActions(inc.correctiveActions); setPeopleInvolved(inc.peopleInvolved); setPhotoUrls(inc.photoUrls);
    setStatus(inc.status); setDraftNotes(''); setDrafting(false);
    setShowForm(true);
  }, []);

  const handleDraftAI = useCallback(async () => {
    if (!draftNotes.trim()) { Alert.alert('Add notes', 'Type or dictate what happened first.'); return; }
    const check = await checkAILimit(tier, 'smart');
    if (!check.allowed) { Alert.alert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
    setDrafting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-draft-incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ voiceTranscript: draftNotes, notes: draftNotes }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { Alert.alert('AI unavailable', json.error ?? 'Fill the incident manually.'); return; }
      setType(json.data.type); setSeverity(json.data.severity);
      setDescription(json.data.description ?? ''); setLocation(json.data.location ?? '');
      setCorrectiveActions((json.data.correctiveActions ?? []).map((a: { action: string; owner: string }) => ({ action: a.action, owner: a.owner, done: false })));
      await recordAIUsage('smart');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('AI unavailable', 'Network issue — fill the incident manually.');
    } finally {
      setDrafting(false);
    }
  }, [draftNotes, tier]);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) { Alert.alert('Missing description', 'Describe what happened.'); return; }
    const now = new Date().toISOString();
    const recordable = isOshaRecordable({
      type, treatment,
      daysAway: Number(daysAway) || 0,
      restrictedDuty, lostConsciousness, fatality,
    });
    if (editingIncident) {
      updateIncident(editingIncident.id, {
        type, severity, occurredAt, description: desc, location: location.trim(),
        peopleInvolved, photoUrls, correctiveActions, treatment,
        daysAway: Number(daysAway) || 0, restrictedDuty, lostConsciousness, fatality,
        oshaRecordable: recordable, status,
      });
    } else {
      const incident: SafetyIncident = {
        id: generateUUID(), projectId: projectId ?? '', type, severity, occurredAt,
        description: desc, location: location.trim(), peopleInvolved, photoUrls,
        correctiveActions, treatment, daysAway: Number(daysAway) || 0,
        restrictedDuty, lostConsciousness, fatality, oshaRecordable: recordable,
        status: 'open', reportedBy: '', createdBy: '', createdAt: now, updatedAt: now,
      };
      addIncident(incident);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [type, severity, occurredAt, description, location, peopleInvolved, photoUrls, correctiveActions, treatment, daysAway, restrictedDuty, lostConsciousness, fatality, status, editingIncident, projectId, addIncident, updateIncident, resetForm]);

  const handleAdvanceStatus = useCallback((inc: SafetyIncident) => {
    updateIncident(inc.id, { status: nextStatus(inc.status) });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [updateIncident]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert('Delete incident', 'Delete this incident report?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteIncident(id) },
    ]);
  }, [deleteIncident]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Incidents' }} />
        <EmptyState
          icon={<ShieldAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Open a project first"
          message="Incidents are tied to a project so each report carries its people, corrective actions, and OSHA classification. To log one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Open Incidents and hit + to report one, or draft it with AI.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `Incidents — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.map(item => {
          const sc = getStatusConfig(themeColors, item.status);
          const doneCount = item.correctiveActions.filter(a => a.done).length;
          return (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.85} onPress={() => openEdit(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.description}</Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <Text style={styles.cardMeta}>
                {TYPE_OPTIONS.find(o => o.value === item.type)?.label ?? item.type} · {item.severity}
              </Text>

              <View style={styles.badgeRow}>
                {item.oshaRecordable ? (
                  <View style={styles.oshaBadge}>
                    <AlertTriangle size={11} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.oshaBadgeText}>OSHA Recordable</Text>
                  </View>
                ) : null}
                <TouchableOpacity style={[styles.statusChip, { backgroundColor: sc.bg }]} onPress={() => handleAdvanceStatus(item)}>
                  <Text style={[styles.statusChipText, { color: sc.color }]}>{sc.label}</Text>
                </TouchableOpacity>
              </View>

              {item.correctiveActions.length > 0 ? (
                <Text style={styles.cardSummary}>
                  {doneCount}/{item.correctiveActions.length} action{item.correctiveActions.length === 1 ? '' : 's'}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}

        {items.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<ShieldAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No incidents logged"
              message="Report injuries, near misses, and property damage the moment they happen. AI can draft the report from your notes, and OSHA-recordable status is classified automatically."
              actionLabel="Report incident"
              onAction={() => { resetForm(); setShowForm(true); }}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-incident">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Report Incident</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Incident form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Back" style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{editingIncident ? 'Edit Incident' : 'Report Incident'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {/* AI draft-from-notes */}
                {!editingIncident ? (
                  <>
                    <Text style={styles.fieldLabel}>Draft with AI</Text>
                    <TextInput
                      style={[styles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' as const }]}
                      value={draftNotes}
                      onChangeText={setDraftNotes}
                      placeholder="Dictate or type what happened — AI will fill in the fields..."
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                    />
                    <TouchableOpacity style={styles.aiBtn} onPress={handleDraftAI} disabled={drafting} activeOpacity={0.85} testID="incident-draft">
                      <Sparkles size={16} color="#FFFFFF" strokeWidth={1.75} />
                      <Text style={styles.aiBtnText}>{drafting ? 'Drafting…' : 'Draft with AI'}</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                <Text style={styles.fieldLabel}>Type</Text>
                <View style={styles.segRow}>
                  {TYPE_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, type === o.value ? styles.segBtnActive : null]}
                      onPress={() => setType(o.value)}
                    >
                      <Text style={[styles.segText, type === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Severity</Text>
                <View style={styles.segRow}>
                  {SEVERITY_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, severity === o.value ? styles.segBtnActive : null]}
                      onPress={() => setSeverity(o.value)}
                    >
                      <Text style={[styles.segText, severity === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Description *</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What happened?"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  testID="incident-description-input"
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Occurred</Text>
                    <TextInput style={styles.input} value={occurredAt} onChangeText={setOccurredAt} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Location</Text>
                    <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. 3rd floor east" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                {/* OSHA inputs */}
                <Text style={styles.sectionLabel}>OSHA classification</Text>
                <Text style={styles.fieldLabel}>Treatment</Text>
                <View style={styles.segRow}>
                  {TREATMENT_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, treatment === o.value ? styles.segBtnActive : null]}
                      onPress={() => setTreatment(o.value)}
                    >
                      <Text style={[styles.segText, treatment === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Days away from work</Text>
                <TextInput style={styles.input} value={daysAway} onChangeText={setDaysAway} placeholder="0" placeholderTextColor={themeColors.textMuted} keyboardType="number-pad" />

                <TouchableOpacity style={styles.toggleRow} onPress={() => setRestrictedDuty(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.toggleLabel}>Restricted duty / job transfer</Text>
                  <View style={[styles.toggleBox, restrictedDuty ? styles.toggleBoxOn : null]}>
                    {restrictedDuty ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toggleRow} onPress={() => setLostConsciousness(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.toggleLabel}>Loss of consciousness</Text>
                  <View style={[styles.toggleBox, lostConsciousness ? styles.toggleBoxOn : null]}>
                    {lostConsciousness ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toggleRow} onPress={() => setFatality(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.toggleLabel}>Fatality</Text>
                  <View style={[styles.toggleBox, fatality ? styles.toggleBoxOn : null]}>
                    {fatality ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>

                {/* Corrective actions */}
                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>Corrective actions</Text>
                  <TouchableOpacity onPress={addCorrectiveAction} style={styles.addStepBtn} accessibilityRole="button" accessibilityLabel="Add corrective action">
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addStepText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {correctiveActions.map((a, idx) => (
                  <View key={idx} style={styles.editRow}>
                    <View style={styles.editRowHeader}>
                      <TouchableOpacity style={[styles.doneToggle, a.done ? styles.doneToggleOn : null]} onPress={() => toggleCorrectiveDone(idx)}>
                        <Text style={[styles.doneToggleText, { color: a.done ? themeColors.success : themeColors.textSecondary }]}>{a.done ? 'Done' : 'Open'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeCorrectiveAction(idx)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove action">
                        <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                    <TextInput style={styles.input} value={a.action} onChangeText={v => updateCorrectiveAction(idx, 'action', v)} placeholder="Action" placeholderTextColor={themeColors.textMuted} />
                    <TextInput style={styles.input} value={a.owner} onChangeText={v => updateCorrectiveAction(idx, 'owner', v)} placeholder="Owner" placeholderTextColor={themeColors.textMuted} />
                  </View>
                ))}

                {/* People involved */}
                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>People involved</Text>
                  <TouchableOpacity onPress={addPerson} style={styles.addStepBtn} accessibilityRole="button" accessibilityLabel="Add person">
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addStepText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {peopleInvolved.map((p, idx) => (
                  <View key={idx} style={styles.editRow}>
                    <View style={styles.editRowHeader}>
                      <Text style={styles.stepNum}>Person {idx + 1}</Text>
                      <TouchableOpacity onPress={() => removePerson(idx)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove person">
                        <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                    <TextInput style={styles.input} value={p.name} onChangeText={v => updatePerson(idx, 'name', v)} placeholder="Name" placeholderTextColor={themeColors.textMuted} />
                    <TextInput style={styles.input} value={p.role} onChangeText={v => updatePerson(idx, 'role', v)} placeholder="Role" placeholderTextColor={themeColors.textMuted} />
                  </View>
                ))}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-incident">
                    <Text style={styles.saveBtnText}>{editingIncident ? 'Update' : 'Report'}</Text>
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
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary },
  cardSummary: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  oshaBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '18' },
  oshaBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '18', alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  sectionLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text, marginTop: 12, marginBottom: 2 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  aiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  segRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segBtn: { flexGrow: 1, minWidth: 70, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  segBtnActive: { backgroundColor: themeColors.accent + '18', borderColor: themeColors.accent },
  segText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  segTextActive: { color: themeColors.accent, fontWeight: '700' as const },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, marginTop: 8 },
  toggleLabel: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text },
  toggleBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  toggleBoxOn: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  addStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12' },
  addStepText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  editRow: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 12, gap: 8, marginTop: 8, borderWidth: 0.5, borderColor: themeColors.line },
  editRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepNum: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  doneToggle: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  doneToggleOn: { backgroundColor: themeColors.successSoft },
  doneToggleText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
