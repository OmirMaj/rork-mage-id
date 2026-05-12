import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, Plus, Link2, X, CheckCircle2, ChevronDown, Share2, Send, FileText } from 'lucide-react-native';
import EmptyState from '@/components/EmptyState';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateSubmittalPDF, generateSubmittalPDFUri, buildSubmittalEmailHtml } from '@/utils/pdfGenerator';
import { sendEmail } from '@/utils/emailService';
import { nailIt } from '@/components/animations/NailItToast';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import { parseSubmittalFromTranscript, pickIfEmpty } from '@/utils/voiceFormParsers';
import type { SubmittalStatus } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function getStatusColor(t: ThemeColors, status: SubmittalStatus): string {
  switch (status) {
    case 'pending': return t.accent;
    case 'in_review': return t.info;
    case 'approved': return t.success;
    case 'approved_as_noted': return t.accentHot;
    case 'revise_resubmit':
    case 'rejected': return t.danger;
  }
}

const STATUS_LABELS: Record<SubmittalStatus, string> = {
  pending: 'Pending',
  in_review: 'In Review',
  approved: 'Approved',
  approved_as_noted: 'Approved as Noted',
  revise_resubmit: 'Revise & Resubmit',
  rejected: 'Rejected',
};

// Pipeline stages for the StatusPipeline at the top of an existing submittal.
// We show the happy path (Pending → In Review → Approved). Side-branches
// (revise_resubmit, rejected, approved_as_noted) live in the existing review-
// cycle modal — clicking the "Add Review Cycle" button is how a reviewer
// branches out of the happy path. Approved_as_noted maps to "Approved" in
// the visual since the project moves forward either way.
const SUBMITTAL_PIPELINE_STAGES: PipelineStage<SubmittalStatus>[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'in_review', label: 'In Review' },
  { key: 'approved', label: 'Approved', terminal: true },
];

function mapToPipelineStage(s: SubmittalStatus): SubmittalStatus {
  if (s === 'approved_as_noted') return 'approved';
  if (s === 'revise_resubmit' || s === 'rejected') return 'in_review';
  return s;
}

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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // prefill* params come from the floating-mic flow when the GC
  // dictated a submittal at the FAB. They pre-seed the new form so
  // the parsed fields land instantly without a manual re-fill.
  const { projectId, submittalId, prefillTitle, prefillSpecSection, prefillSubmittedBy, prefillRequiredDate } = useLocalSearchParams<{
    projectId: string; submittalId?: string;
    prefillTitle?: string; prefillSpecSection?: string;
    prefillSubmittedBy?: string; prefillRequiredDate?: string;
  }>();
  const { getProject, getSubmittalsForProject, addSubmittal, updateSubmittal, addReviewCycle, settings } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingSubmittals = useMemo(() => getSubmittalsForProject(projectId ?? ''), [projectId, getSubmittalsForProject]);
  const existingSubmittal = useMemo(() => submittalId ? existingSubmittals.find(s => s.id === submittalId) : null, [submittalId, existingSubmittals]);

  const [title, setTitle] = useState(existingSubmittal?.title ?? prefillTitle ?? '');
  const [specSection, setSpecSection] = useState(existingSubmittal?.specSection ?? prefillSpecSection ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingSubmittal?.submittedBy ?? prefillSubmittedBy ?? '');
  const [requiredDate, setRequiredDate] = useState(existingSubmittal?.requiredDate ?? prefillRequiredDate ?? '');

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
      // Architect reply portal URL — embeds the submittal's share_token
      // so the reviewer can pick an action code + leave comments and
      // those become a new review cycle without manual GC paste.
      // Portal lives on the marketing site (mageid.app/architect/), not the
      // app domain — it's a static HTML page that hits Supabase RPCs directly.
      const replyPortalUrl = existingSubmittal.shareToken
        ? `https://mageid.app/architect/?token=${existingSubmittal.shareToken}&type=submittal`
        : undefined;
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
        replyPortalUrl,
      });
      // Tight subject — FROM personalization (server-side) carries the
      // company name, so we don't repeat it in the subject.
      const result = await sendEmail({
        to: emailRecipient.trim(),
        subject: `Submittal #${existingSubmittal.number}: ${existingSubmittal.title}`,
        html,
        replyTo: branding.email || undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: emailRecipient.trim(), eventKey: 'submittal', enabled: true },
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

  if (!project && !existingSubmittal) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'Submittals' }} />
        <EmptyState
          icon={<FileText size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No submittal open yet"
          message="Submittals route product specs through the architect for sign-off, then attach to the project's record. To start one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Submittals inside the project tile grid.',
            'Hit Approval Before Order, attach the cut sheet, and send for review.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: themeColors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: existingSubmittal ? `Submittal #${existingSubmittal.number}` : 'Approval Before Order' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {!existingSubmittal && (
          <FeatureHeader
            eyebrow="Submittal"
            title="Get a stamp before you order"
            subtitle="Send the architect a product spec for review. They mark it Approved / Approved-as-Noted / Rejected — you keep the stamp on file before you cut a PO."
            explainer={{
              term: 'Submittal',
              definition: 'A submittal is a document (cut sheet, shop drawing, color sample, MSDS, mockup) you send to the architect for sign-off BEFORE you order or fabricate. The architect stamps it Approved, Approved-as-Noted, or Rejected. Skipping submittals is how you end up installing the wrong fixture and eating the cost.',
              whenToUse: [
                'Before ordering anything spec\'d in the contract documents',
                'When you want to substitute one product for another',
                'For any custom shop fabrication (millwork, steel, glazing)',
              ],
            }}
          />
        )}
        {project && <Text style={styles.projectLabel}>{project.name}</Text>}

        {existingSubmittal && (
          <View style={styles.pipelineWrap}>
            <StatusPipeline
              stages={SUBMITTAL_PIPELINE_STAGES}
              current={mapToPipelineStage(existingSubmittal.currentStatus)}
              startedAt={existingSubmittal.submittedDate}
              dueAt={existingSubmittal.requiredDate || undefined}
            />
          </View>
        )}

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
          placeholderTextColor={themeColors.textMuted}
          testID="submittal-title"
        />

        <Text style={styles.fieldLabel}>Spec Section</Text>
        <TextInput
          style={styles.input}
          value={specSection}
          onChangeText={setSpecSection}
          placeholder="e.g. 03300 - Cast-in-Place Concrete"
          placeholderTextColor={themeColors.textMuted}
        />

        <Text style={styles.fieldLabel}>Submitted By</Text>
        <TextInput
          style={styles.input}
          value={submittedBy}
          onChangeText={setSubmittedBy}
          placeholder="Subcontractor name"
          placeholderTextColor={themeColors.textMuted}
        />

        <Text style={styles.fieldLabel}>Required Date</Text>
        <TextInput
          style={styles.input}
          value={requiredDate}
          onChangeText={setRequiredDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={themeColors.textMuted}
        />

        {existingSubmittal && existingSubmittal.reviewCycles.length > 0 && (
          <View style={styles.timelineSection}>
            <Text style={styles.sectionTitle}>Review Cycles</Text>
            {existingSubmittal.reviewCycles.map((cycle, idx) => (
              <View key={idx} style={styles.timelineItem}>
                <View style={styles.timelineLine}>
                  <View style={[styles.timelineDot, { backgroundColor: getStatusColor(themeColors, cycle.status) }]} />
                  {idx < existingSubmittal.reviewCycles.length - 1 && <View style={styles.timelineConnector} />}
                </View>
                <View style={styles.timelineContent}>
                  <View style={styles.timelineHeader}>
                    <Text style={styles.cycleNumber}>Cycle {cycle.cycleNumber}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(themeColors, cycle.status) + '20' }]}>
                      <Text style={[styles.statusBadgeText, { color: getStatusColor(themeColors, cycle.status) }]}>
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
                <Plus size={16} color={themeColors.accent} />
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
                  placeholderTextColor={themeColors.textMuted}
                />
                <View style={styles.statusPicker}>
                  {(Object.keys(STATUS_LABELS) as SubmittalStatus[]).map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.statusChip, newCycleStatus === s && { backgroundColor: getStatusColor(themeColors, s) }]}
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
                  placeholderTextColor={themeColors.textMuted}
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
              <Link2 size={15} color={themeColors.info} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={themeColors.textMuted} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')} accessibilityRole="button" accessibilityLabel="Close"><X size={14} color={themeColors.danger} /></TouchableOpacity>
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
              <Share2 size={16} color={themeColors.accent} />
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
              <TouchableOpacity onPress={() => setShowTaskPicker(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}>
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity key={task.id} style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}>
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={themeColors.accent} />}
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
                <TouchableOpacity onPress={() => setShowEmailSend(false)} testID="submittal-email-close" accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.emailFieldLabel}>Reviewer name</Text>
              <TextInput
                style={styles.emailInput}
                value={emailRecipientName}
                onChangeText={setEmailRecipientName}
                placeholder="e.g. Architect of Record"
                placeholderTextColor={themeColors.textMuted}
                testID="submittal-email-name"
              />
              <Text style={styles.emailFieldLabel}>Reviewer email *</Text>
              <TextInput
                style={styles.emailInput}
                value={emailRecipient}
                onChangeText={setEmailRecipient}
                placeholder="reviewer@firm.com"
                placeholderTextColor={themeColors.textMuted}
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
                placeholderTextColor={themeColors.textMuted}
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

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themeColors.bg,
    padding: 16,
  },
  projectLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  sectionTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
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
    borderRadius: Tokens.radius.xs,
    marginTop: 4,
  },
  timelineConnector: {
    width: 2,
    flex: 1,
    backgroundColor: themeColors.line,
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 16,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
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
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
  },
  statusBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  cycleDetail: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 20,
  },
  cycleComments: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.text,
    marginTop: 6,
    fontStyle: 'italic',
  },
  addCycleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accent + '12',
    marginTop: 12,
  },
  addCycleBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
  },
  addCycleForm: {
    marginTop: 16,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.panel,
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
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.line,
  },
  statusChipText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  addCycleSubmit: {
    backgroundColor: themeColors.accent,
    borderRadius: Tokens.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addCycleSubmitText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: themeColors.accent,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    marginTop: 28,
    shadowColor: themeColors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: Type.body.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
  },
  exportRow: { flexDirection: 'row' as const, gap: 10, marginTop: 12 },
  exportBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, paddingVertical: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: themeColors.line, backgroundColor: themeColors.surface },
  exportBtnPrimary: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
  exportBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  emailModalCard: { backgroundColor: themeColors.surface, marginHorizontal: 16, padding: 20, borderRadius: Tokens.radius.panel, gap: 6, borderWidth: 1, borderColor: themeColors.line },
  emailModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  emailModalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  emailFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 10 },
  emailInput: { backgroundColor: themeColors.line, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  emailSendBtn: { marginTop: 16, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: themeColors.accent, paddingVertical: 14, borderRadius: Tokens.radius.card },
  emailSendBtnText: { color: '#fff', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  pickerBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: themeColors.line },
  pickerBtnText: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text },
  linkedTaskBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  linkedTaskPhase: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  linkedTaskName: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center' as const, alignItems: 'center' as const, padding: 24 },
  taskPickerCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, width: '100%', overflow: 'hidden' as const },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  taskPickerTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: themeColors.line + '80' },
  taskOptionActive: { backgroundColor: themeColors.accent + '10' },
  taskOptionText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: themeColors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: themeColors.accent },
  taskOptionMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary ?? themeColors.textMuted, marginTop: 1 },

  pipelineWrap: {
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
});
