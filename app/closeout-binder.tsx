// closeout-binder — GC reviews + finalizes the homeowner closeout binder.
// The engine auto-compiles everything from selections, commitments,
// warranties, photos. This screen is intentionally thin because the
// magic is in the compiler — GC just adds a note + tweaks the
// maintenance schedule + taps Generate PDF.
//
// Status flow:
//   draft     → editable, not visible to homeowner
//   finalized → "ready to deliver", still editable, still not in portal
//   sent      → visible in homeowner portal (closeout section), GC can
//               re-deliver (re-fire notification) but content is locked
//
// The portal snapshot only emits the binder block when status ∈
// {finalized, sent}, so flipping the toggle is what makes it appear.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileDown, Plus, Trash2, Wrench, Sparkles,
  CheckCircle2, Send, Lock, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  fetchCloseoutBinder, saveCloseoutBinder, shareCloseoutBinderPDF,
  DEFAULT_MAINTENANCE,
  type MaintenanceItem, type CloseoutBinder,
} from '@/utils/closeoutBinderEngine';
import { statusPillStyle } from '@/utils/statusPill';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { generateUUID } from '@/utils/generateId';
import { notifyEvent } from '@/utils/notifyClient';
import type {
  CompanyBranding, SelectionCategory,
} from '@/types';

type BinderStatus = CloseoutBinder['status'];

export default function CloseoutBinderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, commitments, warranties, projectPhotos, rfis, submittals, settings, updateProject: ctxUpdateProject } = useProjects() as any;
  const project = projectId ? getProject(projectId) : undefined;

  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>(DEFAULT_MAINTENANCE);
  const [notes, setNotes] = useState('');
  const [binderId, setBinderId] = useState<string | undefined>();
  const [status, setStatus] = useState<BinderStatus>('draft');
  const [finalizedAt, setFinalizedAt] = useState<string | undefined>();
  const [sentAt, setSentAt] = useState<string | undefined>();
  const [selections, setSelections] = useState<SelectionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [delivering, setDelivering] = useState(false);

  const branding = useMemo<CompanyBranding>(() => ({
    companyName:   settings?.branding?.companyName ?? 'MAGE ID',
    contactName:   settings?.branding?.contactName ?? '',
    phone:         settings?.branding?.phone ?? '',
    email:         settings?.branding?.email ?? '',
    address:       settings?.branding?.address ?? '',
    licenseNumber: settings?.branding?.licenseNumber ?? '',
    tagline:       settings?.branding?.tagline ?? '',
    logoUri:       settings?.branding?.logoUri,
  }), [settings]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) { setLoading(false); return; }
      const [existing, sels] = await Promise.all([
        fetchCloseoutBinder(projectId),
        fetchSelectionsForProject(projectId),
      ]);
      if (cancelled) return;
      if (existing) {
        setBinderId(existing.id);
        setMaintenance(existing.maintenanceSchedule.length ? existing.maintenanceSchedule : DEFAULT_MAINTENANCE);
        setNotes(existing.notes);
        setStatus(existing.status);
        setFinalizedAt(existing.finalizedAt);
        setSentAt(existing.sentAt);
      }
      setSelections(sels);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const persistBinder = useCallback(async (overrides: Partial<CloseoutBinder>) => {
    if (!projectId) return null;
    return saveCloseoutBinder({
      id: binderId,
      projectId,
      maintenanceSchedule: maintenance,
      notes,
      status,
      finalizedAt,
      sentAt,
      ...overrides,
    });
  }, [binderId, projectId, maintenance, notes, status, finalizedAt, sentAt]);

  const handleSave = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const saved = await persistBinder({});
      if (saved) {
        setBinderId(saved.id);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Save failed', 'Could not save the binder. Check your connection and try again.');
      }
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }, [persistBinder, projectId]);

  const handleFinalize = useCallback(() => {
    Alert.alert(
      'Finalize binder?',
      'You can still tweak the note and maintenance items, but the binder will be marked ready to deliver. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize', onPress: async () => {
            const now = new Date().toISOString();
            setSaving(true);
            try {
              const saved = await persistBinder({ status: 'finalized', finalizedAt: now });
              if (saved) {
                setBinderId(saved.id);
                setStatus('finalized');
                setFinalizedAt(now);
                if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else {
                Alert.alert('Failed', 'Could not finalize. Try again.');
              }
            } finally {
              setSaving(false);
            }
          }
        },
      ],
    );
  }, [persistBinder]);

  const handleDeliver = useCallback(() => {
    if (!project) return;
    const title = sentAt ? 'Re-deliver to homeowner?' : 'Deliver to homeowner?';
    const message = sentAt
      ? 'The homeowner already received this binder. We\'ll re-send the email and refresh the portal copy. Continue?'
      : 'The binder will appear in the homeowner\'s portal under the Closeout section, and we\'ll send them an email so they know where to find it. Continue?';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deliver', onPress: async () => {
          setDelivering(true);
          try {
            const now = new Date().toISOString();
            const saved = await persistBinder({ status: 'sent', sentAt: now });
            if (!saved) {
              Alert.alert('Failed', 'Could not deliver. Try again.');
              return;
            }
            setBinderId(saved.id);
            setStatus('sent');
            setSentAt(now);
            // Fire-and-forget notification — don't block UI on email.
            // Pull the first portal invite (the homeowner) so we can
            // address the email by name + send to the right inbox.
            const invite = (project.clientPortal?.invites ?? [])[0];
            void notifyEvent('closeout_binder_sent', {
              project_id: project.id,
              binder_id: saved.id,
              project_name: project.name,
              gc_user_id: saved.userId,
              portal_id: project.clientPortal?.portalId,
              homeowner_email: invite?.email,
              homeowner_name: invite?.name,
            });
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Connector: flip the project to 'closed' on first delivery.
            // Only on first delivery (not re-deliver) and only if the
            // project isn't already past the active phase. Asks the GC
            // first because some projects keep working after binder
            // delivery (e.g., warranty work, punch follow-ups).
            const wasFirstDeliver = !sentAt;
            if (wasFirstDeliver && project.status !== 'closed' && project.status !== 'completed') {
              Alert.alert(
                'Mark project as closed?',
                'Now that the binder is delivered, do you want to mark the whole project as closed? You can still come back to it for warranty work, punch follow-ups, or invoice tracking.',
                [
                  { text: 'Keep open', style: 'cancel' },
                  {
                    text: 'Mark as closed',
                    onPress: () => {
                      ctxUpdateProject(project.id, { status: 'closed', closedAt: new Date().toISOString() });
                    },
                  },
                ],
              );
            } else {
              Alert.alert('Delivered', 'The homeowner can see it in their portal now.');
            }
          } finally {
            setDelivering(false);
          }
        }
      },
    ]);
  }, [persistBinder, project, sentAt]);

  const handleExport = useCallback(async () => {
    if (!project) return;
    setExporting(true);
    try {
      const projectCommitments = (commitments ?? []).filter((c: any) => c.projectId === project.id);
      const projectPhotosArr = (projectPhotos ?? []).filter((p: any) => p.projectId === project.id);
      const projectRfis = (rfis ?? []).filter((r: any) => r.projectId === project.id);
      const projectSubmittals = (submittals ?? []).filter((s: any) => s.projectId === project.id);
      await shareCloseoutBinderPDF({
        project,
        branding,
        binder: {
          id: binderId ?? '',
          projectId: project.id,
          userId: '',
          maintenanceSchedule: maintenance,
          notes,
          status,
          createdAt: '',
          updatedAt: '',
        },
        commitments: projectCommitments,
        photos: projectPhotosArr,
        selections,
        warranties: warranties ?? [],
        rfis: projectRfis,
        submittals: projectSubmittals,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setExporting(false);
    }
  }, [project, branding, binderId, maintenance, notes, status, commitments, projectPhotos, rfis, submittals, selections, warranties]);

  const addMaintenance = useCallback(() => {
    setMaintenance(prev => [...prev, { id: generateUUID(), task: '', frequency: 'Annual', notes: '' }]);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);
  const removeMaintenance = useCallback((id: string) => {
    const m = maintenance.find(x => x.id === id);
    Alert.alert(
      'Remove maintenance item?',
      m?.task ? `"${m.task}" will be removed from the binder.` : 'This will remove the item from the binder.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setMaintenance(prev => prev.filter(x => x.id !== id));
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        } },
      ],
    );
  }, [maintenance]);
  const updateMaintenance = useCallback((id: string, patch: Partial<MaintenanceItem>) => {
    setMaintenance(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }, []);

  if (!project) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.emptyTitle}>Project not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.emptyBack}>
          <Text style={styles.emptyBackText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const selectionsCount = selections.filter(s => (s.options ?? []).some(o => o.isChosen)).length;
  const projectCommitmentsCount = (commitments ?? []).filter((c: any) => c.projectId === project.id && c.status !== 'draft').length;
  const projectWarrantiesCount  = (warranties ?? []).filter((w: any) => w.projectId === project.id).length;

  const statusPill = (() => {
    const label = status === 'sent' ? 'DELIVERED' : status === 'finalized' ? 'FINALIZED' : 'DRAFT';
    const { color, backgroundColor } = statusPillStyle(status);
    return { label, color, bg: backgroundColor };
  })();

  const formattedAt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Closeout Binder</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusPill.bg }]}>
          <Text style={[styles.statusPillText, { color: statusPill.color }]}>{statusPill.label}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading your binder…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 130 }}>
          {/* Status timeline — small and informational so the GC always
              knows where this binder stands. */}
          {(finalizedAt || sentAt) && (
            <View style={styles.timeline}>
              {finalizedAt && (
                <View style={styles.timelineRow}>
                  <CheckCircle2 size={14} color={'#C26A00'} />
                  <Text style={styles.timelineText}>Finalized {formattedAt(finalizedAt)}</Text>
                </View>
              )}
              {sentAt && (
                <View style={styles.timelineRow}>
                  <Send size={13} color={'#1E8E4A'} />
                  <Text style={styles.timelineText}>Delivered to homeowner {formattedAt(sentAt)}</Text>
                </View>
              )}
            </View>
          )}

          {/* What's in it */}
          <View style={styles.previewCard}>
            <View style={styles.previewHead}>
              <Sparkles size={14} color={Colors.primary} />
              <Text style={styles.previewTitle}>Auto-compiled from this project</Text>
            </View>
            <Text style={styles.previewBody}>
              Your binder will pull live data from the project so the homeowner gets a complete record:
            </Text>
            <View style={styles.previewList}>
              <PreviewRow label="Finishes & fixtures" value={`${selectionsCount} chosen`} />
              <PreviewRow label="Subcontractor contacts" value={`${projectCommitmentsCount} commitments`} />
              <PreviewRow label="Warranties" value={`${projectWarrantiesCount} on file`} />
              <PreviewRow label="Maintenance schedule" value={`${maintenance.length} items`} />
            </View>
            {selectionsCount === 0 && projectCommitmentsCount === 0 && projectWarrantiesCount === 0 && (
              <Text style={styles.emptyHint}>Tip: even with no data yet, your maintenance schedule and personal note still go into the binder. You can deliver a partial binder now and re-deliver as the project closes out.</Text>
            )}
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>A note to the homeowner</Text>
            <Text style={styles.cardHelper}>Goes at the top of the binder. Personal touch, sign-off, anything they should know.</Text>
            <TextInput
              style={styles.textarea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Thanks for choosing us. Here's everything you need..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          {/* Maintenance schedule */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Maintenance schedule</Text>
                <Text style={styles.cardHelper}>Routine tasks the homeowner should do. Pre-filled with sane defaults — edit, add, remove.</Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={addMaintenance}>
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            {maintenance.map(m => (
              <View key={m.id} style={styles.maintRow}>
                <View style={styles.maintMain}>
                  <TextInput
                    style={styles.maintTask}
                    value={m.task}
                    onChangeText={v => updateMaintenance(m.id, { task: v })}
                    placeholder="Task (e.g. HVAC filter replacement)"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <View style={styles.maintMeta}>
                    <Wrench size={11} color={Colors.textMuted} />
                    <TextInput
                      style={styles.maintFreq}
                      value={m.frequency}
                      onChangeText={v => updateMaintenance(m.id, { frequency: v })}
                      placeholder="Frequency"
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                </View>
                <TouchableOpacity onPress={() => removeMaintenance(m.id)} hitSlop={6} testID={`maint-remove-${m.id}`}>
                  <Trash2 size={13} color={Colors.error} />
                </TouchableOpacity>
              </View>
            ))}
            {maintenance.length === 0 && (
              <Text style={styles.emptyHint}>No maintenance items. Tap Add to start, or leave it blank — the rest of the binder still ships.</Text>
            )}
          </View>
        </ScrollView>
      )}

      {/* Action bar — different actions per status. PDF is always
          available so the GC can always pull a paper copy. */}
      {!loading && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          {status === 'draft' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleSave} disabled={saving} testID="binder-save-draft">
                {saving ? <ActivityIndicator size="small" color={Colors.text} /> : <Text style={styles.secondaryText}>Save draft</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf">
                {exporting ? <ActivityIndicator size="small" color={Colors.text} /> : (
                  <>
                    <FileDown size={14} color={Colors.text} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={handleFinalize} disabled={saving} testID="binder-finalize">
                <Lock size={14} color="#FFF" />
                <Text style={styles.primaryText}>Finalize</Text>
              </TouchableOpacity>
            </>
          )}
          {status === 'finalized' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleSave} disabled={saving} testID="binder-save-final">
                {saving ? <ActivityIndicator size="small" color={Colors.text} /> : <Text style={styles.secondaryText}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf-final">
                {exporting ? <ActivityIndicator size="small" color={Colors.text} /> : (
                  <>
                    <FileDown size={14} color={Colors.text} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={handleDeliver} disabled={delivering} testID="binder-deliver">
                {delivering ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <Send size={14} color="#FFF" />
                    <Text style={styles.primaryText}>Deliver to homeowner</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
          {status === 'sent' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf-sent">
                {exporting ? <ActivityIndicator size="small" color={Colors.text} /> : (
                  <>
                    <FileDown size={14} color={Colors.text} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={handleDeliver} disabled={delivering} testID="binder-redeliver">
                {delivering ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <RefreshCw size={14} color="#FFF" />
                    <Text style={styles.primaryText}>Re-deliver</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewRowLabel}>{label}</Text>
      <Text style={styles.previewRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: Colors.textMuted },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 6 },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text },
  emptyBack: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary },
  emptyBackText: { color: '#FFF', fontWeight: '800', fontSize: 13 },

  timeline: { gap: 4, marginBottom: 10, paddingHorizontal: 4 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timelineText: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },

  previewCard: { backgroundColor: Colors.primary + '0D', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: Colors.primary + '30', gap: 8 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewTitle: { fontSize: 13, fontWeight: '800', color: Colors.primary, letterSpacing: -0.2 },
  previewBody: { fontSize: 12, color: Colors.text, lineHeight: 17 },
  previewList: { gap: 4 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  previewRowLabel: { fontSize: 12, color: Colors.text, fontWeight: '600' },
  previewRowValue: { fontSize: 12, color: Colors.primary, fontWeight: '800' },
  emptyHint: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic', lineHeight: 16, marginTop: 4 },

  card: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  cardHelper: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },

  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: Colors.primary + '0D', borderWidth: 1, borderColor: Colors.primary + '30' },
  smallBtnText: { fontSize: 12, fontWeight: '800', color: Colors.primary },

  textarea: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: Colors.text, minHeight: 110 },

  maintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  maintMain: { flex: 1, gap: 6 },
  maintTask: { fontSize: 13, color: Colors.text, fontWeight: '600', padding: 0 },
  maintMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  maintFreq: { flex: 1, fontSize: 11, color: Colors.textMuted, padding: 0 },

  actionBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 11, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  secondaryText: { fontSize: 13, fontWeight: '700', color: Colors.text },
  primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 11, backgroundColor: Colors.primary, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4 },
  primaryText: { fontSize: 13, fontWeight: '800', color: '#FFF' },
});
