import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, Plus, Link2, X, CheckCircle2, ChevronDown, Share2, Send } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateSubmittalPDF, generateSubmittalPDFUri, buildSubmittalEmailHtml } from '@/utils/pdfGenerator';
import { sendEmail } from '@/utils/emailService';
import { nailIt } from '@/components/animations/NailItToast';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { parseSubmittalFromTranscript, pickIfEmpty } from '@/utils/voiceFormParsers';
import type { SubmittalStatus } from '@/types';

const STATUS_COLORS: Record<SubmittalStatus, string> = {
  pending: Colors.warning,
  in_review: Colors.info,
  approved: Colors.success,
  approved_as_noted: Colors.primaryLight,
  revise_resubmit: Colors.error,
  rejected: Colors.error,
};

const STATUS_LABELS: Record<SubmittalStatus, string> = {
  pending: 'Pending',
  in_review: 'In Review',
  approved: 'Approved',
  approved_as_noted: 'Approved as Noted',
  revise_resubmit: 'Revise & Resubmit',
  rejected: 'Rejected',
};

export default function SubmittalScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('rfis_submittals')) {
    return (
      <Paywall
        visible={true}
        feature="RFIs & Submittals"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SubmittalScreenInner />;
}

function SubmittalScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, submittalId } = useLocalSearchParams<{ projectId: string; submittalId?: string }>();
  const { getProject, getSubmittalsForProject, addSubmittal, updateSubmittal, addReviewCycle, settings } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingSubmittals = useMemo(() => getSubmittalsForProject(projectId ?? ''), [projectId, getSubmittalsForProject]);
  const existingSubmittal = useMemo(() => submittalId ? existingSubmittals.find(s => s.id === submittalId) : null, [submittalId, existingSubmittals]);

  const [title, setTitle] = useState(existingSubmittal?.title ?? '');
  const [specSection, setSpecSection] = useState(existingSubmittal?.specSection ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingSubmittal?.submittedBy ?? '');
  const [requiredDate, setRequiredDate] = useState(existingSubmittal?.requiredDate ?? '');

  const [linkedTaskId, setLinkedTaskId] = useState('');
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [newReviewer, setNewReviewer] = useState('');
  const [newCycleStatus, setNewCycleStatus] = useState<SubmittalStatus>('pending');
  const [newCycleComments, setNewCycleComments] = useState('');
  const [showAddCycle, setShowAddCycle] = useState(false);
  // Email-send modal state — recipient + optional message routed to the
  // architect / GC / vendor reviewing this submittal.
  const [showEmailSend, setShowEmailSend] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailRecipientName, setEmailRecipientName] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSharePDF = useCallback(async () => {
    if (!project || !existingSubmittal) {
      Alert.alert('Save First', 'Please save the submittal before exporting.');
      return;
    }
    const branding = settings?.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await generateSubmittalPDF(existingSubmittal, project, branding);
      nailIt(`Submittal #${existingSubmittal.number} shared`);
    } catch (err) {
      console.error('[Submittal] Share PDF failed:', err);
      Alert.alert('Error', 'Could not generate the submittal PDF.');
    }
  }, [project, existingSubmittal, settings]);

  const handleSendEmail = useCallback(async () => {
    if (!project || !existingSubmittal) return;
    if (!emailRecipient.trim()) {
      Alert.alert('Email Required', 'Please enter the reviewer email.');
      return;
    }
    setSending(true);
    try {
      const branding = settings?.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const html = buildSubmittalEmailHtml({
        companyName: branding.companyName,
        recipientName: emailRecipientName.trim() || undefined,
        projectName: project.name,
        submittalNumber: existingSubmittal.number,
        submittalTitle: existingSubmittal.title,
        specSection: existingSubmittal.specSection || undefined,
        status: existingSubmittal.currentStatus,
        message: emailMessage.trim() || undefined,
        contactName: branding.contactName,
        contactEmail: branding.email,
        contactPhone: branding.phone,
      });
      const result = await sendEmail({
        to: emailRecipient.trim(),
        subject: `${branding.companyName || 'MAGE ID'} - Submittal #${existingSubmittal.number} - ${existingSubmittal.title}`,
        html,
        replyTo: branding.email || undefined,
      });
      if (!result.success) {
        if (result.error === 'cancelled') return;
        Alert.alert('Could Not Send', result.error || 'Email failed.');
        return;
      }
      // Auto-create a new review cycle so the submittal status reflects
      // that it's now out for review. Reviewer = the email recipient.
      addReviewCycle(existingSubmittal.id, {
        reviewer: emailRecipientName.trim() || emailRecipient.trim(),
        sentDate: new Date().toISOString(),
        status: 'in_review',
        comments: emailMessage.trim() || undefined,
      });
      setShowEmailSend(false);
      setEmailRecipient('');
      setEmailRecipientName('');
      setEmailMessage('');
      nailIt(`Submittal sent to ${emailRecipientName.trim() || emailRecipient.trim()}`);
    } catch (err) {
      console.error('[Submittal] Email send failed:', err);
      Alert.alert('Error', 'Failed to send email.');
    } finally {
      setSending(false);
    }
  }, [project, existingSubmittal, settings, emailRecipient, emailRecipientName, emailMessage, addReviewCycle]);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title.');
      return;
    }

    if (existingSubmittal) {
      updateSubmittal(existingSubmittal.id, {
        title: title.trim(),
        specSection: specSection.trim(),
        submittedBy: submittedBy.trim(),
        requiredDate,
      });
    } else {
      addSubmittal({
        projectId: projectId ?? '',
        title: title.trim(),
        specSection: specSection.trim(),
        submittedBy: submittedBy.trim(),
        submittedDate: new Date().toISOString(),
        requiredDate: requiredDate || new Date(Date.now() + 21 * 86400000).toISOString(),
        reviewCycles: [],
        currentStatus: 'pending',
        attachments: [],
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [title, specSection, submittedBy, requiredDate, existingSubmittal, projectId, addSubmittal, updateSubmittal, router]);

  const handleAddCycle = useCallback(() => {
    if (!existingSubmittal) return;
    if (!newReviewer.trim()) {
      Alert.alert('Missing Reviewer', 'Please enter a reviewer name.');
      return;
    }

    addReviewCycle(existingSubmittal.id, {
      sentDate: new Date().toISOString(),
      reviewer: newReviewer.trim(),
      status: newCycleStatus,
      comments: newCycleComments.trim() || undefined,
    });

    setNewReviewer('');
    setNewCycleComments('');
    setShowAddCycle(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [existingSubmittal, newReviewer, newCycleStatus, newCycleComments, addReviewCycle]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: existingSubmittal ? `Submittal #${existingSubmittal.number}` : 'New Submittal' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {project && <Text style={styles.projectLabel}>{project.name}</Text>}

        <InlineVoiceFill
          title="Dictate this submittal"
          contextLine={project?.name ? `for ${project.name}` : undefined}
          buttonLabel={existingSubmittal ? 'Add detail by voice' : 'Fill submittal by voice'}
          suggestions={[
            'Door hardware schedule, spec section 08 71 00, submitted by Acme Doors',
            'Light fixture cut sheets for the kitchen, need by Friday',
            'Submit the tile shop drawings, spec 09 30 00',
            'Mechanical equipment cut sheets, submitted by Anderson HVAC',
          ]}
          onTranscript={async (transcript) => {
            const partial = await parseSubmittalFromTranscript(transcript, project);
            if (partial.title) setTitle(prev => pickIfEmpty(prev, partial.title));
            if (partial.specSection) setSpecSection(prev => pickIfEmpty(prev, partial.specSection));
            if (partial.submittedBy) setSubmittedBy(prev => pickIfEmpty(prev, partial.submittedBy));
            if (partial.requiredDate) setRequiredDate(prev => pickIfEmpty(prev, partial.requiredDate));
          }}
        />

        <Text style={styles.fieldLabel}>Title *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Submittal title"
          placeholderTextColor={Colors.textMuted}
          testID="submittal-title"
        />

        <Text style={styles.fieldLabel}>Spec Section</Text>
        <TextInput
          style={styles.input}
          value={specSection}
          onChangeText={setSpecSection}
          placeholder="e.g. 03300 - Cast-in-Place Concrete"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Submitted By</Text>
        <TextInput
          style={styles.input}
          value={submittedBy}
          onChangeText={setSubmittedBy}
          placeholder="Subcontractor name"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Required Date</Text>
        <TextInput
          style={styles.input}
          value={requiredDate}
          onChangeText={setRequiredDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textMuted}
        />

        {existingSubmittal && existingSubmittal.reviewCycles.length > 0 && (
          <View style={styles.timelineSection}>
            <Text style={styles.sectionTitle}>Review Cycles</Text>
            {existingSubmittal.reviewCycles.map((cycle, idx) => (
              <View key={idx} style={styles.timelineItem}>
                <View style={styles.timelineLine}>
                  <View style={[styles.timelineDot, { backgroundColor: STATUS_COLORS[cycle.status] }]} />
                  {idx < existingSubmittal.reviewCycles.length - 1 && <View style={styles.timelineConnector} />}
                </View>
                <View style={styles.timelineContent}>
                  <View style={styles.timelineHeader}>
                    <Text style={styles.cycleNumber}>Cycle {cycle.cycleNumber}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[cycle.status] + '20' }]}>
                      <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[cycle.status] }]}>
                        {STATUS_LABELS[cycle.status]}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cycleDetail}>Reviewer: {cycle.reviewer}</Text>
                  <Text style={styles.cycleDetail}>Sent: {new Date(cycle.sentDate).toLocaleDateString()}</Text>
                  {cycle.returnDate && <Text style={styles.cycleDetail}>Returned: {new Date(cycle.returnDate).toLocaleDateString()}</Text>}
                  {cycle.comments && <Text style={styles.cycleComments}>{cycle.comments}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {existingSubmittal && (
          <>
            {!showAddCycle ? (
              <TouchableOpacity style={styles.addCycleBtn} onPress={() => setShowAddCycle(true)} activeOpacity={0.7}>
                <Plus size={16} color={Colors.primary} />
                <Text style={styles.addCycleBtnText}>Add Review Cycle</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.addCycleForm}>
                <Text style={styles.sectionTitle}>New Review Cycle</Text>
                <TextInput
                  style={styles.input}
                  value={newReviewer}
                  onChangeText={setNewReviewer}
                  placeholder="Reviewer name"
                  placeholderTextColor={Colors.textMuted}
                />
                <View style={styles.statusPicker}>
                  {(Object.keys(STATUS_LABELS) as SubmittalStatus[]).map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.statusChip, newCycleStatus === s && { backgroundColor: STATUS_COLORS[s] }]}
                      onPress={() => setNewCycleStatus(s)}
                    >
                      <Text style={[styles.statusChipText, newCycleStatus === s && { color: '#fff' }]}>
                        {STATUS_LABELS[s]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 60 }]}
                  value={newCycleComments}
                  onChangeText={setNewCycleComments}
                  placeholder="Comments (optional)"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity style={styles.addCycleSubmit} onPress={handleAddCycle} activeOpacity={0.85}>
                  <Text style={styles.addCycleSubmitText}>Add Cycle</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {scheduleTasks.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Linked Schedule Task</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
              <Link2 size={15} color={Colors.info} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')}><X size={14} color={Colors.error} /></TouchableOpacity>
              </View>
            )}
          </>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="submittal-save">
          <Save size={18} color="#fff" />
          <Text style={styles.saveBtnText}>{existingSubmittal ? 'Update Submittal' : 'Create Submittal'}</Text>
        </TouchableOpacity>

        {/* Share + Email actions only appear once the submittal exists.
            Share opens the OS share sheet with the branded PDF; Email
            sends an HTML email via Resend and auto-creates a new review
            cycle so the submittal's review history reflects the routing. */}
        {existingSubmittal && (
          <View style={styles.exportRow}>
            <TouchableOpacity style={styles.exportBtn} onPress={handleSharePDF} activeOpacity={0.7} testID="submittal-share-pdf">
              <Share2 size={16} color={Colors.primary} />
              <Text style={styles.exportBtnText}>Share PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.exportBtn, styles.exportBtnPrimary]} onPress={() => setShowEmailSend(true)} activeOpacity={0.7} testID="submittal-email">
              <Send size={16} color="#fff" />
              <Text style={[styles.exportBtnText, { color: '#fff' }]}>Send to Reviewer</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTaskPicker(false)}>
          <Pressable style={styles.taskPickerCard} onPress={() => undefined}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>Link Schedule Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}>
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity key={task.id} style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}>
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={Colors.primary} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskOptionText, linkedTaskId === task.id && styles.taskOptionTextActive]} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.taskOptionMeta}>{task.phase} · {task.durationDays}d</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Email-send modal — recipient + optional message. After send,
          we auto-add a review cycle so the submittal's status reflects
          that it's been routed out for review. */}
      <Modal visible={showEmailSend} transparent animationType="slide" onRequestClose={() => setShowEmailSend(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowEmailSend(false)}>
            <Pressable style={styles.emailModalCard} onPress={() => undefined}>
              <View style={styles.emailModalHeader}>
                <Text style={styles.emailModalTitle}>Send Submittal</Text>
                <TouchableOpacity onPress={() => setShowEmailSend(false)} testID="submittal-email-close">
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.emailFieldLabel}>Reviewer name</Text>
              <TextInput
                style={styles.emailInput}
                value={emailRecipientName}
                onChangeText={setEmailRecipientName}
                placeholder="e.g. Architect of Record"
                placeholderTextColor={Colors.textMuted}
                testID="submittal-email-name"
              />
              <Text style={styles.emailFieldLabel}>Reviewer email *</Text>
              <TextInput
                style={styles.emailInput}
                value={emailRecipient}
                onChangeText={setEmailRecipient}
                placeholder="reviewer@firm.com"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="submittal-email-recipient"
              />
              <Text style={styles.emailFieldLabel}>Message (optional)</Text>
              <TextInput
                style={[styles.emailInput, { minHeight: 80, textAlignVertical: 'top' }]}
                value={emailMessage}
                onChangeText={setEmailMessage}
                placeholder="Add context for the reviewer..."
                placeholderTextColor={Colors.textMuted}
                multiline
                testID="submittal-email-message"
              />
              <TouchableOpacity
                style={[styles.emailSendBtn, sending && { opacity: 0.5 }]}
                onPress={handleSendEmail}
                disabled={sending}
                activeOpacity={0.85}
                testID="submittal-email-send"
              >
                <Send size={16} color="#fff" />
                <Text style={styles.emailSendBtnText}>{sending ? 'Sending…' : 'Send'}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 16,
  },
  projectLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  timelineSection: {
    marginTop: 24,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  timelineLine: {
    width: 24,
    alignItems: 'center',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  timelineConnector: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cycleNumber: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  cycleDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  cycleComments: {
    fontSize: 13,
    color: Colors.text,
    marginTop: 6,
    fontStyle: 'italic',
  },
  addCycleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    marginTop: 12,
  },
  addCycleBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  addCycleForm: {
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  statusPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  addCycleSubmit: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addCycleSubmitText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  exportRow: { flexDirection: 'row' as const, gap: 10, marginTop: 12 },
  exportBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card },
  exportBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  exportBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  emailModalCard: { backgroundColor: Colors.card, marginHorizontal: 16, padding: 20, borderRadius: 16, gap: 6, borderWidth: 1, borderColor: Colors.cardBorder },
  emailModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  emailModalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emailFieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 10 },
  emailInput: { backgroundColor: Colors.fillTertiary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text },
  emailSendBtn: { marginTop: 16, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12 },
  emailSendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  pickerBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  pickerBtnText: { flex: 1, fontSize: 15, color: Colors.text },
  linkedTaskBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: Colors.primary + '10', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  linkedTaskPhase: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  linkedTaskName: { flex: 1, fontSize: 13, color: Colors.text },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center' as const, alignItems: 'center' as const, padding: 24 },
  taskPickerCard: { backgroundColor: Colors.surface, borderRadius: 16, width: '100%', overflow: 'hidden' as const },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  taskPickerTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder + '80' },
  taskOptionActive: { backgroundColor: Colors.primary + '10' },
  taskOptionText: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: Colors.primary },
  taskOptionMeta: { fontSize: 11, color: Colors.textSecondary ?? Colors.textMuted, marginTop: 1 },
});
