import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { TriangleAlert, Plus, X, Sparkles, Trash2, ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type { Hazard, HazardScale, HazardStatus } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { computeRiskScore, riskBand, type RiskBand } from '@/utils/safety/risk';
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';

const SCALE_OPTIONS: HazardScale[] = [1, 2, 3, 4, 5];

const BAND_LABEL: Record<RiskBand, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};

/** Band → color, mirroring punch-list's getPriorityConfig. */
function bandColor(t: ThemeColors, band: RiskBand): string {
  switch (band) {
    case 'low': return t.textMuted;
    case 'medium': return t.accent;
    case 'high': return t.danger;
    case 'critical': return t.danger;
  }
}

function getStatusConfig(t: ThemeColors, status: HazardStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'open': return { label: 'Open', color: t.danger, bg: t.danger + '18' };
    case 'mitigated': return { label: 'Mitigated', color: t.accent, bg: t.accent + '18' };
    case 'closed': return { label: 'Closed', color: t.success, bg: t.successSoft };
  }
}

function nextStatus(s: HazardStatus): HazardStatus {
  if (s === 'open') return 'mitigated';
  if (s === 'mitigated') return 'closed';
  return 'open';
}

type Suggestion = { description: string; severity: number; likelihood: number };

export default function SafetyHazardsScreen() {
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
  return <SafetyHazardsInner />;
}

function SafetyHazardsInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useTierAccess();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { getHazardsForProject, addHazard, updateHazard, deleteHazard } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getHazardsForProject(projectId ?? ''), [projectId, getHazardsForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingHazard, setEditingHazard] = useState<Hazard | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState<HazardScale>(3);
  const [likelihood, setLikelihood] = useState<HazardScale>(3);
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [status, setStatus] = useState<HazardStatus>('open');

  // AI photo-detect.
  const [photoUrl, setPhotoUrl] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const resetForm = useCallback(() => {
    setEditingHazard(null);
    setDescription(''); setLocation('');
    setSeverity(3); setLikelihood(3);
    setAssignedTo(''); setDueDate(''); setCorrectiveAction('');
    setStatus('open');
  }, []);

  const openEdit = useCallback((hz: Hazard) => {
    setEditingHazard(hz);
    setDescription(hz.description); setLocation(hz.location);
    setSeverity(hz.severity); setLikelihood(hz.likelihood);
    setAssignedTo(hz.assignedTo ?? ''); setDueDate(hz.dueDate ?? '');
    setCorrectiveAction(hz.correctiveAction ?? ''); setStatus(hz.status);
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) { Alert.alert('Missing description', 'Describe the hazard.'); return; }
    const now = new Date().toISOString();
    const score = computeRiskScore(severity, likelihood);
    if (editingHazard) {
      updateHazard(editingHazard.id, {
        description: desc, location: location.trim(), severity, likelihood, riskScore: score,
        assignedTo: assignedTo.trim() || undefined, dueDate: dueDate.trim() || undefined,
        correctiveAction: correctiveAction.trim() || undefined, status,
      });
    } else {
      const hazard: Hazard = {
        id: generateUUID(), projectId: projectId ?? '', description: desc, location: location.trim(),
        photoUrl: undefined, severity, likelihood, riskScore: score,
        assignedTo: assignedTo.trim() || undefined, dueDate: dueDate.trim() || undefined,
        correctiveAction: correctiveAction.trim() || undefined, status: 'open',
        createdBy: '', createdAt: now, updatedAt: now,
      };
      addHazard(hazard);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [description, location, severity, likelihood, assignedTo, dueDate, correctiveAction, status, editingHazard, projectId, addHazard, updateHazard, resetForm]);

  const handleDetect = useCallback(async (photoUrls: string[]) => {
    if (photoUrls.length === 0) { Alert.alert('Add a photo', 'Attach a site photo to scan for hazards.'); return; }
    const check = await checkAILimit(tier, 'smart');
    if (!check.allowed) { Alert.alert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
    setDetecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-detect-hazards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ photoUrls }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { Alert.alert('AI unavailable', json.error ?? 'Log hazards manually.'); return; }
      setSuggestions(json.data.hazards ?? []);
      await recordAIUsage('smart');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('AI unavailable', 'Network issue — log hazards manually.');
    } finally {
      setDetecting(false);
    }
  }, [tier]);

  const applySuggestion = useCallback((s: Suggestion) => {
    setDescription(s.description);
    setSeverity(Math.max(1, Math.min(5, s.severity)) as HazardScale);
    setLikelihood(Math.max(1, Math.min(5, s.likelihood)) as HazardScale);
    setShowForm(true);
  }, []);

  const handleAdvanceStatus = useCallback((hz: Hazard) => {
    updateHazard(hz.id, { status: nextStatus(hz.status) });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [updateHazard]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert('Delete hazard', 'Delete this hazard from the log?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteHazard(id) },
    ]);
  }, [deleteHazard]);

  const previewScore = computeRiskScore(severity, likelihood);
  const previewBand = riskBand(previewScore);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Hazard Log' }} />
        <EmptyState
          icon={<TriangleAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Open a project first"
          message="Hazards are tied to a project so each one carries its risk score, owner, and corrective action. To log one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Open Hazard Log and hit + to log one, or scan a site photo.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `Hazard Log — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {suggestions.length > 0 && (
          <View style={styles.suggestionBox}>
            <Text style={styles.suggestionTitle}>AI-detected hazards — tap to review</Text>
            <View style={styles.chipWrap}>
              {suggestions.map((s, idx) => {
                const band = riskBand(computeRiskScore(s.severity, s.likelihood));
                return (
                  <TouchableOpacity key={idx} style={styles.suggestionChip} onPress={() => applySuggestion(s)} activeOpacity={0.8}>
                    <View style={[styles.chipDot, { backgroundColor: bandColor(themeColors, band) }]} />
                    <Text style={styles.suggestionChipText} numberOfLines={1}>{s.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity onPress={() => setSuggestions([])} hitSlop={8}>
              <Text style={styles.suggestionDismiss}>Dismiss suggestions</Text>
            </TouchableOpacity>
          </View>
        )}

        {items.map(item => {
          const band = riskBand(item.riskScore);
          const sc = getStatusConfig(themeColors, item.status);
          const bc = bandColor(themeColors, band);
          return (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.85} onPress={() => openEdit(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.description}</Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {item.location ? <Text style={styles.cardMeta}>{item.location}</Text> : null}

              <View style={styles.badgeRow}>
                <View style={[styles.riskChip, { backgroundColor: bc + '18' }]}>
                  <Text style={[styles.riskChipText, { color: bc }]}>{item.riskScore} · {BAND_LABEL[band]}</Text>
                </View>
                <TouchableOpacity style={[styles.statusChip, { backgroundColor: sc.bg }]} onPress={() => handleAdvanceStatus(item)}>
                  <Text style={[styles.statusChipText, { color: sc.color }]}>{sc.label}</Text>
                </TouchableOpacity>
              </View>

              {(item.assignedTo || item.dueDate) ? (
                <Text style={styles.cardSummary}>
                  {item.assignedTo ? item.assignedTo : ''}{item.assignedTo && item.dueDate ? ' · ' : ''}{item.dueDate ? `due ${item.dueDate}` : ''}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}

        {items.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<TriangleAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No hazards logged"
              message="Log site hazards and rank them by risk (severity × likelihood). Highest-risk hazards surface first, and AI can scan a site photo to spot hazards for you to confirm."
              actionLabel="Log hazard"
              onAction={() => { resetForm(); setShowForm(true); }}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-hazard">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Log Hazard</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.walkBtn} onPress={() => handleDetect(photoUrl.trim() ? [photoUrl.trim()] : [])} disabled={detecting} activeOpacity={0.85} testID="scan-hazards">
          <Sparkles size={16} color="#FFFFFF" strokeWidth={1.75} />
          <Text style={styles.walkBtnText}>{detecting ? 'Scanning…' : 'Scan photo for hazards'}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.photoInput}
          value={photoUrl}
          onChangeText={setPhotoUrl}
          placeholder="Paste a site photo URL to scan…"
          placeholderTextColor={themeColors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </ScrollView>

      {/* Hazard form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Back" style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{editingHazard ? 'Edit Hazard' : 'Log Hazard'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Description *</Text>
                <TextInput
                  style={[styles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What's the hazard?"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  testID="hazard-description-input"
                />

                <Text style={styles.fieldLabel}>Location</Text>
                <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. 3rd floor east" placeholderTextColor={themeColors.textMuted} />

                <Text style={styles.fieldLabel}>Severity</Text>
                <View style={styles.segRow}>
                  {SCALE_OPTIONS.map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.segBtn, severity === n ? styles.segBtnActive : null]}
                      onPress={() => setSeverity(n)}
                    >
                      <Text style={[styles.segText, severity === n ? styles.segTextActive : null]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Likelihood</Text>
                <View style={styles.segRow}>
                  {SCALE_OPTIONS.map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.segBtn, likelihood === n ? styles.segBtnActive : null]}
                      onPress={() => setLikelihood(n)}
                    >
                      <Text style={[styles.segText, likelihood === n ? styles.segTextActive : null]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={[styles.riskPreview, { borderColor: bandColor(themeColors, previewBand) + '40' }]}>
                  <Text style={[styles.riskPreviewText, { color: bandColor(themeColors, previewBand) }]}>
                    Risk {previewScore} — {BAND_LABEL[previewBand]}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Assigned to</Text>
                    <TextInput style={styles.input} value={assignedTo} onChangeText={setAssignedTo} placeholder="Owner" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Due date</Text>
                    <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Corrective action</Text>
                <TextInput
                  style={[styles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={correctiveAction}
                  onChangeText={setCorrectiveAction}
                  placeholder="How will it be mitigated?"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                {editingHazard ? (
                  <>
                    <Text style={styles.fieldLabel}>Status</Text>
                    <View style={styles.segRow}>
                      {(['open', 'mitigated', 'closed'] as HazardStatus[]).map(s => (
                        <TouchableOpacity
                          key={s}
                          style={[styles.segBtn, status === s ? styles.segBtnActive : null]}
                          onPress={() => setStatus(s)}
                        >
                          <Text style={[styles.segText, status === s ? styles.segTextActive : null]}>{getStatusConfig(themeColors, s).label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-hazard">
                    <Text style={styles.saveBtnText}>{editingHazard ? 'Update' : 'Log'}</Text>
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
  riskChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  riskChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '18', alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  walkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 10, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent },
  walkBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  photoInput: { minHeight: 44, marginHorizontal: 20, marginTop: 10, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.footnote.fontSize, color: themeColors.text, borderWidth: 1, borderColor: themeColors.line },
  suggestionBox: { marginHorizontal: 20, marginTop: 16, padding: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '0D', borderWidth: 1, borderColor: themeColors.accent + '20', gap: 10 },
  suggestionTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  chipWrap: { gap: 8 },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  suggestionChipText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  suggestionDismiss: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  segRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segBtn: { flexGrow: 1, minWidth: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  segBtnActive: { backgroundColor: themeColors.accent + '18', borderColor: themeColors.accent },
  segText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  segTextActive: { color: themeColors.accent, fontWeight: '700' as const },
  riskPreview: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: Tokens.radius.card, borderWidth: 1, marginTop: 10 },
  riskPreviewText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});
