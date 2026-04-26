import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  Mic, X, FileText, FilePlus2, MessageSquare, AlertTriangle, Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import VoiceRecorder from '@/components/VoiceRecorder';
import { parseVoiceAction, type VoiceActionResult } from '@/utils/voiceActionParser';
import type { Project, RFI, ChangeOrder } from '@/types';
import { generateUUID } from '@/utils/generateId';

// Floating "speak anywhere" button. Opens a modal with the project picker
// + voice recorder; after the AI parses intent, drafts the appropriate
// in-app artifact (RFI / change-order / note) and routes the GC to it
// for review. Mounted at root layout so it's reachable from every screen.

interface Props {
  // When provided, the action is scoped to this project. Otherwise the
  // user picks from a list (or we use the most-recently-updated active project).
  projectId?: string;
  // Render mode: 'fab' floats bottom-right; 'inline' is a flat button you
  // can drop into a header or row.
  variant?: 'fab' | 'inline';
}

type Step = 'idle' | 'recording' | 'parsing' | 'reviewing' | 'creating';

export default function UniversalMicButton({ projectId, variant = 'fab' }: Props) {
  // Hook order is fixed regardless of project availability, so the same
  // hooks run every render even before the user has a project. The FAB
  // visually no-ops when there's nothing to scope to.
  const router = useRouter();
  const ctx = useProjects();
  const { isProOrAbove } = useSubscription();
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [parsed, setParsed] = useState<VoiceActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<string | undefined>(projectId);

  const projectsList = ctx?.projects ?? [];

  const activeProjects = useMemo(() => {
    return projectsList.filter(p => p.status === 'in_progress' || p.status === 'estimated' || p.status === 'draft');
  }, [projectsList]);

  const project: Project | undefined = useMemo(() => {
    const id = pickedProjectId ?? projectId;
    if (id) return projectsList.find(p => p.id === id);
    if (activeProjects.length === 1) return activeProjects[0];
    if (activeProjects.length === 0) return undefined;
    // Most-recently-updated active project as the default.
    return [...activeProjects].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }, [projectsList, projectId, pickedProjectId, activeProjects]);

  const reset = useCallback(() => {
    setStep('idle');
    setParsed(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const handleOpen = useCallback(() => {
    if (!isProOrAbove) {
      router.push('/paywall' as never);
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOpen(true);
    if (!pickedProjectId && project) setPickedProjectId(project.id);
  }, [isProOrAbove, router, project, pickedProjectId]);

  const handleTranscript = useCallback(async (transcript: string) => {
    if (!transcript || transcript.trim().length === 0) {
      setError('Didn\'t catch that — try again.');
      setStep('idle');
      return;
    }
    setStep('parsing');
    setError(null);
    try {
      const result = await parseVoiceAction({ transcript, project });
      setParsed(result);
      setStep('reviewing');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[UniversalMic] parse failed', e);
      setError('AI couldn\'t parse that — try again.');
      setStep('idle');
    }
  }, [project]);

  const handleConfirm = useCallback(async () => {
    if (!parsed) return;
    if (!project) {
      setError('Pick a project first.');
      return;
    }
    setStep('creating');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (parsed.kind === 'rfi') {
        ctx.addRFI({
          projectId: project.id,
          subject: parsed.subject || 'Voice-drafted RFI',
          question: parsed.question || parsed.subject,
          priority: parsed.priority || 'normal',
          status: 'open',
          assignedTo: parsed.assignedTo || '',
          dateSubmitted: new Date().toISOString(),
          dateRequired: '',
          submittedBy: ctx.settings?.branding?.companyName ?? 'Contractor',
          attachments: [],
        } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);
        // Find the just-created RFI to navigate to.
        setTimeout(() => {
          const justCreated = ctx.getRFIsForProject(project.id)[0];
          handleClose();
          router.push({
            pathname: '/rfi' as never,
            params: { projectId: project.id, rfiId: justCreated?.id } as never,
          });
        }, 250);
      } else if (parsed.kind === 'co') {
        const lineItems = (parsed.lineItems && parsed.lineItems.length > 0)
          ? parsed.lineItems.map(li => ({
              id: generateUUID(),
              name: li.name,
              description: li.description ?? '',
              quantity: li.quantity ?? 1,
              unit: li.unit ?? 'lump',
              unitPrice: li.unitPrice ?? 0,
              total: (li.quantity ?? 1) * (li.unitPrice ?? 0),
              isNew: true,
            }))
          : (parsed.changeAmount > 0
              ? [{
                  id: generateUUID(),
                  name: parsed.description || 'Change order item',
                  description: '',
                  quantity: 1,
                  unit: 'lump',
                  unitPrice: parsed.changeAmount,
                  total: parsed.changeAmount,
                  isNew: true,
                }]
              : []);
        const totalChange = lineItems.reduce((s, li) => s + (li.total ?? 0), 0);
        const baseValue = project.estimate?.grandTotal ?? 0;
        const projectCOs = ctx.getChangeOrdersForProject(project.id);
        const nextNumber = projectCOs.length > 0 ? Math.max(...projectCOs.map(c => c.number)) + 1 : 1;
        const newId = generateUUID();
        const now = new Date().toISOString();
        ctx.addChangeOrder({
          id: newId,
          projectId: project.id,
          number: nextNumber,
          date: now,
          description: parsed.description || 'Voice-drafted change order',
          reason: parsed.reason || 'Owner direction',
          lineItems,
          originalContractValue: baseValue,
          changeAmount: totalChange,
          newContractTotal: baseValue + totalChange,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        } as unknown as ChangeOrder);
        setTimeout(() => {
          handleClose();
          router.push({ pathname: '/change-order' as never, params: { id: newId } as never });
        }, 250);
      } else if (parsed.kind === 'note') {
        // Notes go in as a "draft" daily report so they end up somewhere
        // visible — the GC can convert / discard later. Keeps voice notes
        // from disappearing into the void.
        ctx.addDailyReport({
          id: generateUUID(),
          projectId: project.id,
          date: new Date().toISOString(),
          weather: { temperature: '', conditions: '', wind: '', isManual: true },
          manpower: [],
          workPerformed: parsed.noteBody || '',
          materialsDelivered: [],
          issuesAndDelays: '',
          photos: [],
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as never);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Note saved', 'Saved as a daily-report draft you can finish later.', [{
          text: 'OK', onPress: handleClose,
        }]);
      } else {
        setError('AI wasn\'t sure what to do — try again with more detail.');
        setStep('idle');
      }
    } catch (e) {
      console.warn('[UniversalMic] create failed', e);
      setError('Couldn\'t save that — try again.');
      setStep('reviewing');
    }
  }, [parsed, project, ctx, router, handleClose]);

  const KindIcon = parsed?.kind === 'rfi' ? MessageSquare
    : parsed?.kind === 'co' ? FilePlus2
    : parsed?.kind === 'note' ? FileText
    : AlertTriangle;
  const kindLabel = parsed?.kind === 'rfi' ? 'Request for information'
    : parsed?.kind === 'co' ? 'Change order draft'
    : parsed?.kind === 'note' ? 'Field note'
    : 'Not sure yet';

  // Hide self when there's nothing to scope to. Done in render (not via an
  // earlier return) so all hooks above run unconditionally on every render.
  const shouldRender = projectsList.length > 0;

  return (
    <>
      {shouldRender && variant === 'fab' && (
        <TouchableOpacity
          // Stack ABOVE the AICopilot FAB which sits at insets.bottom + 70
          // with size 52. Add gap so the two don't touch.
          style={[styles.fab, { bottom: insets.bottom + 70 + 52 + 12 }]}
          onPress={handleOpen}
          activeOpacity={0.85}
          accessibilityLabel="Voice action"
          testID="universal-mic-fab"
        >
          <Mic size={20} color="#FFF" />
        </TouchableOpacity>
      )}
      {shouldRender && variant === 'inline' && (
        <TouchableOpacity
          style={styles.inlineBtn}
          onPress={handleOpen}
          activeOpacity={0.85}
          testID="universal-mic-inline"
        >
          <Mic size={16} color={Colors.primary} />
          <Text style={styles.inlineBtnText}>Voice action</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalEyebrow}>Speak it, we&apos;ll draft it</Text>
                <Text style={styles.modalTitle}>Voice action</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={6}>
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {/* Project picker */}
            {!projectId && activeProjects.length > 1 && (
              <View style={styles.pickerWrap}>
                <Text style={styles.pickerLabel}>Project</Text>
                <View style={styles.pickerRow}>
                  {activeProjects.slice(0, 3).map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.pickerChip, project?.id === p.id && styles.pickerChipActive]}
                      onPress={() => setPickedProjectId(p.id)}
                    >
                      <Text style={[styles.pickerChipText, project?.id === p.id && styles.pickerChipTextActive]} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            {project && (
              <Text style={styles.projectHint}>Drafting on <Text style={styles.projectHintEmph}>{project.name}</Text></Text>
            )}
            {!project && (
              <Text style={styles.projectHintWarn}>You don&apos;t have any active projects yet — create one first.</Text>
            )}

            {/* States */}
            {step === 'idle' && project && (
              <View style={styles.bodyWrap}>
                <View style={styles.tipsBox}>
                  <Text style={styles.tipsTitle}>Try saying…</Text>
                  <Text style={styles.tipsLine}>&quot;Submit an RFI to the architect about the steel beam size.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Owner wants the heat pump upgrade — change order for forty-five hundred.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Note: framing on second floor is half done.&quot;</Text>
                </View>
                <VoiceRecorder
                  onTranscriptReady={handleTranscript}
                  isLoading={false}
                  isLocked={!isProOrAbove}
                  onLockedPress={() => router.push('/paywall' as never)}
                />
                {error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            )}

            {(step === 'parsing' || step === 'creating') && (
              <View style={styles.parsingWrap}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.parsingText}>{step === 'parsing' ? 'Reading what you said…' : 'Saving your draft…'}</Text>
              </View>
            )}

            {step === 'reviewing' && parsed && (
              <View style={styles.bodyWrap}>
                <View style={styles.previewCard}>
                  <View style={styles.previewHead}>
                    <View style={[styles.previewIconWrap, parsed.kind === 'unsure' && { backgroundColor: '#FFF4E0' }]}>
                      <KindIcon size={18} color={parsed.kind === 'unsure' ? '#C26A00' : Colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewKind}>{kindLabel}</Text>
                      {parsed.reasoning ? <Text style={styles.previewReason}>{parsed.reasoning}</Text> : null}
                    </View>
                  </View>

                  {parsed.kind === 'rfi' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Subject" value={parsed.subject || '—'} />
                      <PreviewField label="Question" value={parsed.question || '—'} multi />
                      <View style={styles.previewMetaRow}>
                        <PreviewField label="Priority" value={(parsed.priority || 'normal').toUpperCase()} small />
                        <PreviewField label="Assigned to" value={parsed.assignedTo || '—'} small />
                      </View>
                    </View>
                  )}

                  {parsed.kind === 'co' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Description" value={parsed.description || '—'} multi />
                      <PreviewField label="Reason" value={parsed.reason || '—'} small />
                      {parsed.lineItems && parsed.lineItems.length > 0 ? (
                        parsed.lineItems.map((li, i) => (
                          <View key={i} style={styles.lineItemRow}>
                            <Text style={styles.lineItemName} numberOfLines={1}>{li.name || '—'}</Text>
                            <Text style={styles.lineItemQty}>{li.quantity} {li.unit}</Text>
                            <Text style={styles.lineItemAmt}>${(li.unitPrice * li.quantity).toLocaleString()}</Text>
                          </View>
                        ))
                      ) : parsed.changeAmount > 0 ? (
                        <PreviewField label="Change amount" value={`$${parsed.changeAmount.toLocaleString()}`} small />
                      ) : (
                        <Text style={styles.previewNote}>No price detected — you can add line items on the next screen.</Text>
                      )}
                    </View>
                  )}

                  {parsed.kind === 'note' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Note" value={parsed.noteBody || '—'} multi />
                    </View>
                  )}

                  {parsed.kind === 'unsure' && (
                    <View style={styles.previewBody}>
                      <Text style={styles.unsureText}>
                        Not enough detail to know what you want. Tap &quot;Try again&quot; and start with words like &quot;submit an RFI to…&quot;, &quot;create a change order for…&quot;, or &quot;note:…&quot;.
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.ctaRow}>
                  <TouchableOpacity style={styles.ctaSecondary} onPress={reset}>
                    <Text style={styles.ctaSecondaryText}>Try again</Text>
                  </TouchableOpacity>
                  {parsed.kind !== 'unsure' && (
                    <TouchableOpacity
                      style={styles.ctaPrimary}
                      onPress={handleConfirm}
                    >
                      <Sparkles size={14} color="#FFF" />
                      <Text style={styles.ctaPrimaryText}>
                        Create {parsed.kind === 'rfi' ? 'RFI' : parsed.kind === 'co' ? 'change order' : 'note'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function PreviewField({ label, value, multi, small }: { label: string; value: string; multi?: boolean; small?: boolean }) {
  return (
    <View style={[styles.field, small && styles.fieldSmall]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text
        style={[styles.fieldValue, multi && { lineHeight: 19 }]}
        numberOfLines={multi ? 4 : 2}
      >{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: 20,
    width: 46, height: 46, borderRadius: 23,
    // Ink/black to clearly differentiate from the amber AICopilot below.
    backgroundColor: Colors.text,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30, shadowRadius: 10, elevation: 6,
    zIndex: 999,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  inlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: Colors.primary + '15', borderWidth: 1, borderColor: Colors.primary + '40',
  },
  inlineBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(11,13,16,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 22, paddingBottom: 36,
    minHeight: 360,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16 },
  modalEyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  modalTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginTop: 4, letterSpacing: -0.4 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 9, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },

  pickerWrap: { marginBottom: 12 },
  pickerLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  pickerRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pickerChip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    maxWidth: 220,
  },
  pickerChipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  pickerChipText: { fontSize: 12, fontWeight: '600', color: Colors.text },
  pickerChipTextActive: { color: '#FFF' },
  projectHint: { fontSize: 13, color: Colors.textMuted, marginBottom: 12 },
  projectHintEmph: { color: Colors.text, fontWeight: '700' },
  projectHintWarn: { fontSize: 13, color: Colors.warning, marginBottom: 12, fontWeight: '600' },

  bodyWrap: { gap: 12 },
  tipsBox: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  tipsTitle: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  tipsLine: { fontSize: 12.5, color: Colors.text, lineHeight: 18, marginBottom: 4, fontStyle: 'italic' },

  parsingWrap: { alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 },
  parsingText: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },

  previewCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  previewHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 4 },
  previewIconWrap: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  previewKind: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  previewReason: { fontSize: 13, color: Colors.text, lineHeight: 18, marginTop: 2 },
  previewBody: { gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: Colors.border },
  previewMetaRow: { flexDirection: 'row', gap: 12 },
  previewNote: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
  unsureText: { fontSize: 13, color: Colors.text, lineHeight: 19 },

  field: { marginBottom: 4 },
  fieldSmall: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  fieldValue: { fontSize: 14, fontWeight: '600', color: Colors.text },

  lineItemRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 8,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  lineItemName: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '600' },
  lineItemQty: { fontSize: 12, color: Colors.textMuted },
  lineItemAmt: { fontSize: 13, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },

  ctaRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  ctaSecondary: {
    flex: 1, paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaSecondaryText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  ctaPrimary: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.primary,
  },
  ctaPrimaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  errorText: { fontSize: 12, color: Colors.error, marginTop: 6, fontWeight: '600' },
});
