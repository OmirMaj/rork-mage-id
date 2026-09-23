import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, Pressable, ActivityIndicator, Switch,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, Plus, Link2, X, CheckCircle2, ChevronDown, Share2, Send, CalendarDays, Paperclip, FileText, Image as ImageIcon } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { MageSubmittal } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import {
  useCollectionSettled, useRefetchCollectionOnOpen, useServerRecordNumber,
  recordGate, changedFields, manualCycleProblem, recordNumberLabel, numberHoldReason, sendBlockReason,
  rebaseFormOnLive, reviewerSendCycle, openCycleOf,
} from '@/hooks/useCollectionSettled';
import { calendarDayOf, formatCalendarDay, parseCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import { Button, cardSurface } from '@/components/ui';
import Paywall from '@/components/Paywall';
import { generateSubmittalPDF, generateSubmittalPDFUri, buildSubmittalEmailHtml } from '@/utils/pdfGenerator';
import { sendEmail } from '@/utils/emailService';
import { nailIt } from '@/components/animations/NailItToast';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import { parseSubmittalFromTranscript, pickIfEmpty } from '@/utils/voiceFormParsers';
import type { Submittal, SubmittalStatus } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { showAlert } from '@/utils/alert';
import { supabase } from '@/lib/supabase';
import { readFileBytes } from '@/utils/fileBytes';
import { generateUUID } from '@/utils/generateId';
import { pdfFailureMessage } from '@/utils/platformFile';
import {
  SUBMITTAL_ATTACHMENT_BUCKET, SUBMITTAL_ATTACHMENT_SEND_TTL_SECONDS,
  safeAttachmentFileName, submittalAttachmentObjectPath, toStoredAttachment, storedAttachmentObjectPath,
  attachmentDisplayName, attachmentUploadBlock, submittalSendGate, submittalEmailIntro, submittalSendOutcome,
  submittalFileSizeBlock, submittalPackageSizeBlock, attachmentsTooLargeMessage,
  deriveSubmittalRequiredDateForTask,
} from '@/utils/submittalAttachments';

// ── #57: product data on the submittal ──────────────────────────────────────
// The bytes go straight to Storage while he has signal — a multi-MB PDF cannot
// ride utils/offlineQueue (AsyncStorage JSON; see utils/photoUploadCore.ts for
// the budget it would blow), and pretending an upload is queued would lose it
// silently. The PATH is then saved through updateSubmittal, whose write goes
// through utils/offlineQueue and — since wave 4 (#23) — waits behind any
// queued or in-flight write of this submittal, its create included, so it
// lands after the row exists instead of matching 0 rows. A failed upload
// says so and attaches nothing.
async function uploadSubmittalFile(o: {
  projectId: string; submittalId: string; uri: string; fileName: string; contentType: string;
  /** Why this many bytes may not go on the reviewer email, or null. Checked
   *  on the bytes actually read, before anything is uploaded. */
  sizeBlock: (fileBytes: number) => string | null;
}): Promise<string> {
  const bytes = await readFileBytes(o.uri);
  if (bytes.byteLength === 0) throw new Error('That file is empty.');
  const tooBig = o.sizeBlock(bytes.byteLength);
  if (tooBig) throw new AttachmentTooLargeError(tooBig);
  const objectPath = submittalAttachmentObjectPath({
    projectId: o.projectId, submittalId: o.submittalId, uniq: generateUUID().slice(0, 8), fileName: o.fileName,
  });
  const { error } = await supabase.storage
    .from(SUBMITTAL_ATTACHMENT_BUCKET)
    .upload(objectPath, bytes, { contentType: o.contentType, upsert: false });
  if (error) throw new Error(error.message);
  return toStoredAttachment(objectPath);
}

/** A file the reviewer email could never carry — its message is the whole
 *  explanation, shown as is. */
class AttachmentTooLargeError extends Error {}

/** Each entry's stored size in bytes, or null when it is not one of ours or
 *  Storage could not say. The send-email function caps the package (#57
 *  review), so the phone checks the real sizes before it tries. */
async function storedAttachmentSizes(entries: readonly string[]): Promise<(number | null)[]> {
  return Promise.all(entries.map(async (e) => {
    const path = storedAttachmentObjectPath(e);
    if (!path) return null;
    try {
      const { data, error } = await supabase.storage.from(SUBMITTAL_ATTACHMENT_BUCKET).info(path);
      return !error && typeof data?.size === 'number' ? data.size : null;
    } catch {
      return null;
    }
  }));
}

/** Every attachment as something sendEmail can read: a stored path becomes a
 *  short-lived signed URL (emailService downloads it and sends the bytes); a
 *  legacy entry (a local file on this phone, a URL) goes as it is. Anything
 *  that cannot be resolved is reported, never silently left off. */
async function resolveAttachmentsForSend(entries: readonly string[]): Promise<{ uris: string[]; names: string[]; unresolved: string[] }> {
  const uris: string[] = [];
  const names: string[] = [];
  const unresolved: string[] = [];
  const stored = entries.map(e => ({ e, path: storedAttachmentObjectPath(e) }));
  const paths = stored.filter(x => x.path).map(x => x.path as string);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    try {
      const { data } = await supabase.storage
        .from(SUBMITTAL_ATTACHMENT_BUCKET)
        .createSignedUrls(paths, SUBMITTAL_ATTACHMENT_SEND_TTL_SECONDS);
      for (const row of data ?? []) {
        if (row.path && row.signedUrl && !row.error) signed.set(row.path, row.signedUrl);
      }
    } catch (err) {
      console.warn('[Submittal] signing attachments failed', err);
    }
  }
  for (const { e, path } of stored) {
    const uri = path ? signed.get(path) : e;
    if (uri) { uris.push(uri); names.push(attachmentDisplayName(e)); } else unresolved.push(attachmentDisplayName(e));
  }
  return { uris, names, unresolved };
}

// Formats the required-date value for the picker button. A bare day is that
// day and an instant is the LOCAL day it names (calendarDayOf) — new Date() on
// a bare day printed the day before west of Greenwich. Falls back to the raw
// value if it isn't a date (e.g. a voice-prefilled fragment), so we never
// render "Invalid Date".
function formatRequiredDateLabel(value: string): string {
  const day = calendarDayOf(value);
  return day ? formatCalendarDay(day) : value;
}

/** A cycle's Sent / Returned value as a day, or null when it was never
 *  recorded (a portal answer with no send on file carries sentDate null). */
function cycleDayLabel(value: string | null | undefined): string | null {
  const day = calendarDayOf(value ?? undefined);
  return day ? formatCalendarDay(day) : null;
}

/** Statuses a logged cycle can carry. 'pending' is the submittal's state
 *  before it is ever sent — not a review outcome. */
const CYCLE_STATUSES: SubmittalStatus[] = ['in_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected'];

/** The form's fields as a stored submittal seeds them (#55 dirty diff). */
function submittalFormValuesOf(s: Submittal) {
  return {
    title: s.title ?? '',
    specSection: s.specSection ?? '',
    submittedBy: s.submittedBy ?? '',
    requiredDate: s.requiredDate ?? '',
    // #144: the link is a form field like the others — seeded, diffed, saved.
    linkedTaskId: s.linkedTaskId ?? '',
  };
}

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
  // Project-scoped gate (the gating contract): an invited collaborator does
  // the work he was invited to do on the GC's plan. The tier LABEL still
  // comes from useTierAccess, which reads featureTiers.ts.
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess, canAccessOwnTier } = useProjectAccess(gateProjectId);
  const roleState = useProjectRoleState(gateProjectId);
  const { requiredTierFor } = useTierAccess();
  // Gating contract: an invited collaborator on a free account is not
  // paywalled while his grant is still being read — he waits, or retries a
  // failed read. A settled null role on a named project is "no access", said
  // plainly; the paywall is for someone whose own plan is the answer.
  const collaboratorWait = gateProjectId && !canAccessOwnTier('rfis_submittals')
    ? (roleState.isLoading
      ? <SubmittalGateView state="loading" />
      : roleState.isError
        ? (
          <SubmittalGateView
            state="error"
            message="Couldn't check your access to this job. Check your connection and try again."
            onRetry={() => { void roleState.refetch(); }}
          />
        )
        : roleState.role === null
          ? <SubmittalGateView state="missing" message="You don't have access to this project's submittals. Ask the project owner to invite you." />
          : null)
    : null;
  if (!canAccess('rfis_submittals')) {
    return collaboratorWait ?? (
      <Paywall
        visible={true}
        feature="RFIs & Submittals"
        // Derived, never typed. These four screens all said "business" while
        // their gate said 'rfis_submittals' — true until that key moved to
        // Pro, at which point the paywall quoted a price the gate did not
        // charge. requiredTierFor reads featureTiers.ts, so the number on the
        // wall is the number on the door.
        requiredTier={requiredTierFor('rfis_submittals')}
        onClose={() => router.back()}
      />
    );
  }
  return <SubmittalScreenInner />;
}

/** Loader / gone / couldn't-load (#142) and the access gate — never a blank,
 *  saveable form. */
function SubmittalGateView({ state, message, onRetry }: {
  state: 'loading' | 'missing' | 'error';
  message?: string;
  onRetry?: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg, padding: 24, justifyContent: 'center' }} testID={`submittal-gate-${state}`}>
      <Stack.Screen options={{ title: 'Submittal' }} />
      {state === 'loading' ? (
        <ActivityIndicator size="small" color={themeColors.accent} />
      ) : (
        <View style={styles.gateCard}>
          <Text style={styles.gateText}>{message}</Text>
          {onRetry ? <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} testID="submittal-gate-retry" /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * #142: wait until the submittals collection has settled when an id is in the
 * URL, then mount the form keyed on the record so its initializers run on the
 * real record — a cold link used to open a blank form whose Update wiped spec
 * section, submitted-by and required date. Settled without it: say why.
 */
function SubmittalScreenInner() {
  const { projectId, submittalId } = useLocalSearchParams<{ projectId?: string; submittalId?: string }>();
  const { submittals } = useProjects();
  const qc = useQueryClient();
  // #55: fresh copy on open and on every return to the foreground.
  useRefetchCollectionOnOpen('submittals');
  const settled = useCollectionSettled('submittals', submittalId);
  const found = submittalId ? submittals.find(x => x.id === submittalId && (!projectId || x.projectId === projectId)) : undefined;
  const gate = recordGate({
    wantsRecord: !!submittalId,
    foundInContext: !!found,
    foundInQuery: settled.hasRecord,
    settled: settled.settled,
    failed: settled.failed,
  });
  if (gate === 'loading') return <SubmittalGateView state="loading" />;
  if (gate === 'missing') {
    return <SubmittalGateView state="missing" message="This submittal no longer exists, or it isn't shared with you. Ask the project owner if you expected to see it." />;
  }
  if (gate === 'error') {
    return (
      <SubmittalGateView
        state="error"
        message="Couldn't load this submittal. Check your connection and try again."
        onRetry={() => { void qc.invalidateQueries({ queryKey: ['submittals'] }); }}
      />
    );
  }
  return <SubmittalForm key={found?.id ?? 'new'} />;
}

function SubmittalForm() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // prefill* params come from the floating-mic flow when the GC
  // dictated a submittal at the FAB. They pre-seed the new form so
  // the parsed fields land instantly without a manual re-fill.
  // Reached from the sidebar (FIELD OPS ▸ Submittals), Tools, universal search
  // or a deep link there is no projectId, so ToolProjectPicker sets one locally
  // (field-ticket pattern). A pick outranks the param so a STALE id in the URL
  // — deleted project, old shared link — can't make the picker inert.
  const { projectId: paramProjectId, submittalId, prefillTitle, prefillSpecSection, prefillSubmittedBy, prefillRequiredDate } = useLocalSearchParams<{
    projectId: string; submittalId?: string;
    prefillTitle?: string; prefillSpecSection?: string;
    prefillSubmittedBy?: string; prefillRequiredDate?: string;
  }>();
  const { getProject, getSubmittalsForProject, addSubmittal, updateSubmittal, addReviewCycle, settings, projects } = useProjects();

  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const existingSubmittals = useMemo(() => getSubmittalsForProject(projectId ?? ''), [projectId, getSubmittalsForProject]);
  const existingSubmittal = useMemo(() => submittalId ? existingSubmittals.find(s => s.id === submittalId) : null, [submittalId, existingSubmittals]);

  const [title, setTitle] = useState(existingSubmittal?.title ?? prefillTitle ?? '');
  const [specSection, setSpecSection] = useState(existingSubmittal?.specSection ?? prefillSpecSection ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingSubmittal?.submittedBy ?? prefillSubmittedBy ?? '');
  const [requiredDate, setRequiredDate] = useState(existingSubmittal?.requiredDate ?? prefillRequiredDate ?? '');
  const [linkedTaskId, setLinkedTaskId] = useState(existingSubmittal?.linkedTaskId ?? '');

  // #55: the record the form OPENED with. Update sends only the fields he
  // changed, never review_cycles / current_status — those move through cycles.
  const [opened, setOpened] = useState<Submittal | null>(() => existingSubmittal ?? null);
  const formValues = useMemo(() => ({ title, specSection, submittedBy, requiredDate, linkedTaskId }), [title, specSection, submittedBy, requiredDate, linkedTaskId]);
  const pendingChanges = useMemo(
    () => (opened ? changedFields(submittalFormValuesOf(opened), formValues) : {}),
    [opened, formValues],
  );
  const isDirty = existingSubmittal ? Object.keys(pendingChanges).length > 0 : title.trim() !== '';

  /** Put a record's values into the header fields (inverse of submittalFormValuesOf). */
  const applyFormValues = useCallback((v: ReturnType<typeof submittalFormValuesOf>) => {
    setTitle(v.title); setSpecSection(v.specSection); setSubmittedBy(v.submittedBy); setRequiredDate(v.requiredDate);
    setLinkedTaskId(v.linkedTaskId);
  }, []);

  // #55 (review round 3): adopt a newer copy of the record — untouched fields
  // take the live value, his edits stay, the live row becomes the baseline.
  // Keyed on the record's identity only (see app/rfi.tsx for the why).
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const formRef = useRef(formValues);
  formRef.current = formValues;
  const lastLiveRef = useRef(existingSubmittal);
  useEffect(() => {
    if (!existingSubmittal || existingSubmittal === lastLiveRef.current) return;
    lastLiveRef.current = existingSubmittal;
    const base = submittalFormValuesOf(openedRef.current ?? existingSubmittal);
    applyFormValues(rebaseFormOnLive(base, formRef.current, submittalFormValuesOf(existingSubmittal)));
    setOpened(existingSubmittal);
  }, [existingSubmittal, applyFormValues]);

  // #148: the server assigns the number; nothing prints one until it is read back.
  const numberInfo = useServerRecordNumber('submittals', existingSubmittal?.id, existingSubmittal?.number);
  const numberLabel = existingSubmittal
    ? recordNumberLabel('Submittal', numberInfo.state, numberInfo.number, existingSubmittal.number)
    : 'Approval Before Order';
  const numberHold = existingSubmittal ? numberHoldReason('submittal', numberInfo.state) : null;
  // #58: every send (reviewer email, client portal) is off while there are
  // unsaved edits — Send never saves; see sendBlockReason.
  const sendBlock = existingSubmittal ? sendBlockReason({ isDirty, numberHold }) : null;
  // #147 / #55: while a cycle is still out for review, the manual form CLOSES
  // that cycle in place (submittal_append_review_cycle closesOpenCycle) —
  // logging a second cycle would count the same round twice. Its number,
  // reviewer and Sent day are the open cycle's; he adds the stamp and the day
  // it came back. Offline the context refuses a close, with why.
  const openCycle = existingSubmittal ? openCycleOf(existingSubmittal.reviewCycles) : null;
  const openCycleNo = openCycle
    ? (typeof openCycle.cycleNumber === 'number' ? openCycle.cycleNumber : existingSubmittal!.reviewCycles.length)
    : null;
  // #147: a send over an open cycle is a reminder, not a new round.
  const sendCycle = existingSubmittal ? reviewerSendCycle(existingSubmittal.reviewCycles) : null;
  const resendCycle = sendCycle && !sendCycle.append ? sendCycle.cycleNumber : null;

  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [newReviewer, setNewReviewer] = useState('');
  // #147: a logged cycle defaults to "still in review"; a stamp that came back
  // needs its Returned day, and nothing is dated "now" behind his back.
  const [newCycleStatus, setNewCycleStatus] = useState<SubmittalStatus>('in_review');
  const [newCycleComments, setNewCycleComments] = useState('');
  const [newCycleSent, setNewCycleSent] = useState('');
  const [newCycleReturned, setNewCycleReturned] = useState('');
  const [cycleDatePicker, setCycleDatePicker] = useState<'sent' | 'returned' | null>(null);
  const [showAddCycle, setShowAddCycle] = useState(false);

  /** Save the header fields without leaving (#58's rule, for submittals too):
   *  a send is built from what is saved, and the reply page reads the row. */
  const persistForm = useCallback((): Submittal | null => {
    if (!existingSubmittal) return null;
    if (!title.trim()) {
      showAlert('Missing Title', 'Please enter a title.');
      return null;
    }
    const base = opened ?? existingSubmittal;
    const changed = changedFields(submittalFormValuesOf(base), formValues);
    const updates: Partial<Submittal> = {};
    if ('title' in changed) updates.title = title.trim();
    if ('specSection' in changed) updates.specSection = specSection.trim();
    if ('submittedBy' in changed) updates.submittedBy = submittedBy.trim();
    // A date he set by hand is his — it no longer reads as derived from the
    // schedule (#60).
    if ('requiredDate' in changed) { updates.requiredDate = requiredDate; updates.requiredDateSource = 'manual'; }
    // #144: cleared = undefined, which the row mapper writes as null.
    if ('linkedTaskId' in changed) updates.linkedTaskId = linkedTaskId || undefined;
    // #96: the stored date was counted back from the OLD task. Relinked or
    // unlinked, it is no longer "from the schedule" — it stays as his date
    // (never silently moved), and the label stops claiming a source.
    if ('linkedTaskId' in changed && !('requiredDate' in changed) && base.requiredDateSource === 'schedule') {
      updates.requiredDateSource = 'manual';
    }
    if (Object.keys(updates).length > 0) updateSubmittal(existingSubmittal.id, updates);
    const saved: Submittal = { ...existingSubmittal, ...updates };
    // Form and baseline both become the saved record, so a save reads clean.
    applyFormValues(submittalFormValuesOf(saved));
    setOpened(saved);
    return saved;
  }, [existingSubmittal, opened, title, specSection, submittedBy, requiredDate, linkedTaskId, formValues, updateSubmittal, applyFormValues]);

  // Unsaved edits ask before leaving.
  const navigation = useNavigation();
  const allowLeave = useRef(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (allowLeave.current || !dirtyRef.current) return;
    e.preventDefault();
    showAlert(
      'Discard your changes?',
      "Your edits to this submittal aren't saved yet.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { allowLeave.current = true; navigation.dispatch(e.data.action); } },
      ],
    );
  }), [navigation]);
  // Email-send modal state — recipient + optional message routed to the
  // architect / GC / vendor reviewing this submittal.
  const [showEmailSend, setShowEmailSend] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailRecipientName, setEmailRecipientName] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);
  // #57: an empty package needs his say-so, per send.
  const [sendWithoutProductData, setSendWithoutProductData] = useState(false);
  const [uploading, setUploading] = useState(false);
  const attachRole = useProjectRoleState(existingSubmittal?.projectId ?? (projectId || undefined));
  const uploadBlock = attachmentUploadBlock({ role: attachRole.role, roleLoading: attachRole.isLoading, roleError: attachRole.isError });
  const productData = existingSubmittal?.attachments ?? [];
  const coverSheetAvailable = Platform.OS !== 'web';
  const packageGate = submittalSendGate({
    productDataCount: productData.length, coverSheetAvailable, confirmedWithoutProductData: sendWithoutProductData,
  });

  /** Upload a picked file and add it to the saved record. */
  const attachFile = useCallback(async (file: { uri: string; name: string; contentType: string; ext: string }) => {
    if (!existingSubmittal) return;
    if (uploadBlock) { showAlert("Can't attach", uploadBlock); return; }
    setUploading(true);
    try {
      // What is already on the package, so a file that fits alone but not
      // with the others is refused here rather than at send.
      const packageBytes = (await storedAttachmentSizes(existingSubmittal.attachments ?? []))
        .reduce<number>((a, b) => a + (b ?? 0), 0);
      const stored = await uploadSubmittalFile({
        projectId: existingSubmittal.projectId,
        submittalId: existingSubmittal.id,
        uri: file.uri,
        fileName: safeAttachmentFileName(file.name, file.ext),
        contentType: file.contentType,
        sizeBlock: (fileBytes) => submittalFileSizeBlock({ fileName: file.name, fileBytes, packageBytes, coverSheet: coverSheetAvailable }),
      });
      updateSubmittal(existingSubmittal.id, { attachments: [...(existingSubmittal.attachments ?? []), stored] });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      if (err instanceof AttachmentTooLargeError) {
        showAlert('Too large to email', err.message);
        return;
      }
      console.warn('[Submittal] attach failed', err);
      showAlert(
        'Not attached',
        `${file.name} couldn't be uploaded (${err instanceof Error ? err.message : String(err)}). Check your connection and try again — nothing was attached.`,
      );
    } finally {
      setUploading(false);
    }
  }, [existingSubmittal, uploadBlock, updateSubmittal, coverSheetAvailable]);

  const handleAttachPdf = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const a = picked.assets[0];
    await attachFile({ uri: a.uri, name: a.name ?? 'product-data.pdf', contentType: 'application/pdf', ext: 'pdf' });
  }, [attachFile]);

  const handleAttachPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      showAlert('Permission needed', 'Allow photo library access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: false, exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const isPng = (a.mimeType ?? '').includes('png') || /\.png$/i.test(a.fileName ?? '');
    await attachFile({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}.${isPng ? 'png' : 'jpg'}`,
      contentType: isPng ? 'image/png' : 'image/jpeg',
      ext: isPng ? 'png' : 'jpg',
    });
  }, [attachFile]);

  /** Unlink a file from the submittal. The stored object is left in place —
   *  unlinking is reversible, deleting a document is not. */
  const handleRemoveAttachment = useCallback((entry: string) => {
    if (!existingSubmittal) return;
    if (uploadBlock) { showAlert("Can't change attachments", uploadBlock); return; }
    showAlert('Remove this file?', `${attachmentDisplayName(entry)} will no longer go out with this submittal.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => updateSubmittal(existingSubmittal.id, { attachments: (existingSubmittal.attachments ?? []).filter(x => x !== entry) }),
      },
    ]);
  }, [existingSubmittal, uploadBlock, updateSubmittal]);

  const handleSharePDF = useCallback(async () => {
    if (!project || !existingSubmittal) {
      showAlert('Save First', 'Please save the submittal before exporting.');
      return;
    }
    // #148: the transmittal prints the number — the server's, or it waits.
    if (numberInfo.state !== 'confirmed' || typeof numberInfo.number !== 'number') {
      showAlert('Not ready yet', numberHold ?? 'This submittal has no confirmed number yet.');
      return;
    }
    const saved = persistForm();
    if (!saved) return;
    const doc = { ...saved, number: numberInfo.number };
    const branding = settings?.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await generateSubmittalPDF(doc, project, branding);
      nailIt(`Submittal #${doc.number} shared`);
    } catch (err) {
      console.error('[Submittal] Share PDF failed:', err);
      showAlert('Error', pdfFailureMessage(err, 'Could not generate the submittal PDF.'));
    }
  }, [project, existingSubmittal, settings, numberInfo.state, numberInfo.number, numberHold, persistForm]);

  const handleSendEmail = useCallback(async () => {
    if (!project || !existingSubmittal) return;
    if (!emailRecipient.trim()) {
      showAlert('Email Required', 'Please enter the reviewer email.');
      return;
    }
    // #148: the email prints the number, so it waits for the server's.
    if (numberInfo.state !== 'confirmed' || typeof numberInfo.number !== 'number') {
      showAlert('Not sent yet', numberHold ?? 'This submittal has no confirmed number yet.');
      return;
    }
    const subNumber = numberInfo.number;
    // #58: the reviewer's reply page reads the SAVED row, and addReviewCycle
    // below rebuilds the record from this render's list — so Send never saves
    // (a save here would be undone by that second write). It refuses instead.
    if (isDirty) {
      showAlert('Save first', sendBlockReason({ isDirty, numberHold: null }) ?? '');
      return;
    }
    const sent = existingSubmittal;
    // #57: the package is the point. No product data → blocked with the
    // reason, unless he ticked "send without it" for this send.
    if (packageGate.blocked) {
      showAlert('Nothing to review yet', packageGate.blocked);
      return;
    }
    setSending(true);
    try {
      const branding = settings?.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      // Every file that rides on this email, resolved BEFORE anything is sent:
      // the product data he attached, then the cover sheet (a transmittal
      // with the number, spec section and action codes). The cover is native
      // only — expo-print cannot make a file on the web.
      // The email carries at most MAX_ATTACHMENT_BYTES in total: a package
      // over it is stopped here with the sizes, not left to a bare 400.
      const sizeBlock = submittalPackageSizeBlock({
        sizes: await storedAttachmentSizes(sent.attachments ?? []), coverSheet: coverSheetAvailable,
      });
      if (sizeBlock) {
        showAlert('Too large to email', sizeBlock);
        return;
      }
      const resolved = await resolveAttachmentsForSend(sent.attachments ?? []);
      if (resolved.unresolved.length > 0) {
        showAlert(
          'Not sent',
          `${resolved.unresolved.join(', ')} couldn't be prepared for the email. Check your connection and try again — nothing was sent.`,
        );
        return;
      }
      const coverUri = coverSheetAvailable
        ? await generateSubmittalPDFUri({ ...sent, number: subNumber }, project, branding)
        : null;
      if (!coverUri && resolved.uris.length === 0 && coverSheetAvailable) {
        // He confirmed "cover sheet only", and the cover could not be made:
        // the email would carry nothing, so it does not go.
        showAlert('Not sent', "The cover sheet PDF couldn't be made on this device, so there is nothing to attach. Nothing was sent.");
        return;
      }
      const files = [...(coverUri ? [coverUri] : []), ...resolved.uris];
      // His words when he wrote some; otherwise a line that names exactly the
      // files resolved above and never says "attached" about nothing.
      const intro = emailMessage.trim() || submittalEmailIntro({ coverSheet: !!coverUri, productNames: resolved.names });
      // Architect reply portal URL — embeds the submittal's share_token
      // so the reviewer can pick an action code + leave comments and
      // those become a new review cycle without manual GC paste.
      // Portal lives on the marketing site (mageid.app/architect/), not the
      // app domain — it's a static HTML page that hits Supabase RPCs directly.
      const replyPortalUrl = sent.shareToken
        ? `https://mageid.app/architect/?token=${sent.shareToken}&type=submittal`
        : undefined;
      const html = buildSubmittalEmailHtml({
        companyName: branding.companyName,
        recipientName: emailRecipientName.trim() || undefined,
        projectName: project.name,
        submittalNumber: subNumber,
        submittalTitle: sent.title,
        specSection: sent.specSection || undefined,
        status: sent.currentStatus,
        message: intro,
        attachmentCount: files.length,
        contactName: branding.contactName,
        contactEmail: branding.email,
        contactPhone: branding.phone,
        replyPortalUrl,
      });
      // Tight subject — FROM personalization (server-side) carries the
      // company name, so we don't repeat it in the subject.
      const result = await sendEmail({
        to: emailRecipient.trim(),
        subject: `Submittal #${subNumber}: ${sent.title}`,
        html,
        replyTo: branding.email || undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: emailRecipient.trim(), eventKey: 'submittal', enabled: true },
        ...(files.length > 0 ? { attachments: files } : {}),
      });
      if (!result.success) {
        if (result.error === 'cancelled') return;
        const tooLarge = attachmentsTooLargeMessage(result.error);
        showAlert(tooLarge ? 'Too large to email' : 'Could Not Send', tooLarge ?? (result.error || 'Email failed.'));
        return;
      }
      // #57: an email that lost part of its package is not a clean round of
      // review — nothing is logged, and he is told what went.
      const outcome = submittalSendOutcome({ requested: files.length, dropped: result.attachmentsDropped ?? 0 });
      if (!outcome.recordCycle) {
        setShowEmailSend(false);
        showAlert('Sent with missing files', outcome.warning ?? '');
        return;
      }
      // A send starts a review cycle so the status reads "out for review".
      // #147: with a cycle still open, this send is a reminder for THAT round
      // — a second in_review cycle would count it twice and leave the first
      // open forever — so nothing is appended, and he's told which cycle.
      const cycle = reviewerSendCycle(existingSubmittal.reviewCycles);
      if (cycle.append) {
        addReviewCycle(existingSubmittal.id, {
          reviewer: emailRecipientName.trim() || emailRecipient.trim(),
          sentDate: new Date().toISOString(),
          status: 'in_review',
          comments: emailMessage.trim() || undefined,
        });
      }
      setShowEmailSend(false);
      setEmailRecipient('');
      setEmailRecipientName('');
      setEmailMessage('');
      setSendWithoutProductData(false);
      if (cycle.append) nailIt(`Submittal sent to ${emailRecipientName.trim() || emailRecipient.trim()}`);
      else showAlert('Re-sent', `Sent to ${emailRecipientName.trim() || emailRecipient.trim()}. Cycle ${cycle.cycleNumber} is still out for review, so no new cycle was added — the reviewer's answer through the reply link closes it.`);
    } catch (err) {
      console.error('[Submittal] Email send failed:', err);
      showAlert('Error', 'Failed to send email.');
    } finally {
      setSending(false);
    }
  }, [project, existingSubmittal, settings, emailRecipient, emailRecipientName, emailMessage, addReviewCycle, numberInfo.state, numberInfo.number, numberHold, isDirty, packageGate.blocked, coverSheetAvailable]);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  // #96: a schedule-sourced Required date, checked against TODAY's schedule —
  // the stored date was counted back once, when the spec book was read. Only
  // while the saved link is still the one on screen and the task still
  // exists; relinked, unlinked or gone, nothing claims "from the schedule".
  const scheduleSource = useMemo(() => {
    const s = existingSubmittal;
    if (!s || s.requiredDateSource !== 'schedule' || !linkedTask) return null;
    if (requiredDate !== s.requiredDate || (s.linkedTaskId ?? '') !== linkedTaskId) return null;
    const live = deriveSubmittalRequiredDateForTask({ schedule: project?.schedule, taskId: linkedTaskId, leadDays: s.leadDays });
    return { live, stored: s.requiredDate };
  }, [existingSubmittal, linkedTask, linkedTaskId, requiredDate, project?.schedule]);
  const leadWords = typeof existingSubmittal?.leadDays === 'number' ? `the ${existingSubmittal.leadDays}-day` : 'the';
  // One tap takes the schedule's new date (through updateSubmittal → the
  // offline queue); the stored date never moves behind his back — the chase
  // list reads it.
  const takeScheduleDate = useCallback(() => {
    if (!existingSubmittal || !scheduleSource?.live.requiredDate) return;
    updateSubmittal(existingSubmittal.id, { requiredDate: scheduleSource.live.requiredDate, requiredDateSource: 'schedule' });
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [existingSubmittal, scheduleSource, updateSubmittal]);

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      showAlert('Missing Title', 'Please enter a title.');
      return;
    }

    if (existingSubmittal) {
      // #55: only what he changed — a title edit never carries review_cycles
      // or current_status, so it can't roll back the architect's stamp.
      if (!persistForm()) return;
    } else {
      addSubmittal({
        projectId: projectId ?? '',
        title: title.trim(),
        specSection: specSection.trim(),
        submittedBy: submittedBy.trim(),
        // #60: created is not submitted. The first review round records when
        // it actually went out; until then the log says "not sent yet".
        submittedDate: '',
        // #60/#150: no invented deadline. The old "+21 days" instant became a
        // date the chase list enforced against the reviewer; blank is honest
        // and the chase loop skips it.
        requiredDate,
        ...(requiredDate ? { requiredDateSource: 'manual' as const } : {}),
        // #144: the task he linked is saved with the record.
        ...(linkedTaskId ? { linkedTaskId } : {}),
        reviewCycles: [],
        currentStatus: 'pending',
        // Product data is attached once the submittal exists (#57) — the file
        // path is keyed on its id.
        attachments: [],
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    allowLeave.current = true;
    router.back();
  }, [title, specSection, submittedBy, requiredDate, linkedTaskId, existingSubmittal, projectId, addSubmittal, router, persistForm]);

  // #58: save and stay, so the sends can go in a later render.
  const handleSaveInPlace = useCallback(() => {
    if (!persistForm()) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [persistForm]);

  const handleAddCycle = useCallback(() => {
    if (!existingSubmittal) return;
    if (openCycle) {
      if (newCycleStatus === 'in_review') {
        showAlert('Pick the stamp', `Cycle ${openCycleNo} is still in review. Pick the stamp the reviewer returned it with.`);
        return;
      }
      // The open cycle's reviewer; asked for only when that cycle has none
      // (the server refuses a cycle with no reviewer).
      const closeReviewer = (openCycle.reviewer || newReviewer).trim();
      const closeProblem = manualCycleProblem({
        reviewer: closeReviewer, status: newCycleStatus, sentDay: calendarDayOf(openCycle.sentDate) ?? '', returnDay: newCycleReturned,
      });
      if (closeProblem) {
        showAlert('Check this cycle', closeProblem);
        return;
      }
      void addReviewCycle(existingSubmittal.id, {
        sentDate: openCycle.sentDate,
        returnDate: newCycleReturned,
        reviewer: closeReviewer,
        status: newCycleStatus,
        comments: newCycleComments.trim() || undefined,
        closesOpenCycle: true,
      });
      setNewCycleComments('');
      setNewCycleReturned('');
      setNewCycleStatus('in_review');
      setShowAddCycle(false);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    const problem = manualCycleProblem({
      reviewer: newReviewer, status: newCycleStatus, sentDay: newCycleSent, returnDay: newCycleReturned,
    });
    if (problem) {
      showAlert('Check this cycle', problem);
      return;
    }

    // #147: the days he entered, as calendar days — never "now" for a cycle
    // being logged after the fact. An unknown Sent day stays blank.
    addReviewCycle(existingSubmittal.id, {
      sentDate: newCycleSent,
      ...(newCycleReturned ? { returnDate: newCycleReturned } : {}),
      reviewer: newReviewer.trim(),
      status: newCycleStatus,
      comments: newCycleComments.trim() || undefined,
    });

    setNewReviewer('');
    setNewCycleComments('');
    setNewCycleSent('');
    setNewCycleReturned('');
    setNewCycleStatus('in_review');
    setShowAddCycle(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [existingSubmittal, openCycle, openCycleNo, newReviewer, newCycleStatus, newCycleComments, newCycleSent, newCycleReturned, addReviewCycle]);

  if (!project && !existingSubmittal) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'Submittals' }} />
        <ToolProjectPicker
          toolName="Submittals"
          message="A submittal routes a product spec through the architect and attaches to one project's record."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MageSubmittal size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Submittals inside the project tile grid.',
            'Hit Approval Before Order and create it, then attach the cut sheet and send for review.',
          ]}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: themeColors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: numberLabel }} />
      <ScrollView
        {...fabScroll}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
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
              // #60: "started" is when it first went out — submittedDate once
              // set, else the first review round's Sent day, else nothing.
              startedAt={existingSubmittal.submittedDate || existingSubmittal.reviewCycles[0]?.sentDate || undefined}
              dueAt={existingSubmittal.requiredDate || undefined}
            />
          </View>
        )}

        {existingSubmittal && (
          <PortalStatusPill portalState={existingSubmittal.portalState} itemUpdatedAt={existingSubmittal.updatedAt} />
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
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
          testID="submittal-required-date"
        >
          <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text
            style={[styles.pickerBtnText, !requiredDate && { color: themeColors.textMuted }]}
            numberOfLines={1}
          >
            {requiredDate ? formatRequiredDateLabel(requiredDate) : 'Select a date'}
          </Text>
        </TouchableOpacity>
        <DatePickerModal
          visible={showDatePicker}
          value={requiredDate}
          allowFuture
          title="Required date"
          onClose={() => setShowDatePicker(false)}
          // Stored as the calendar day he picked (#150) — the same shape the
          // schedule-derived dates use, read by every day-aware reader.
          onChange={(iso) => setRequiredDate(calendarDayOf(iso) ?? iso)}
        />
        {requiredDate ? (
          <View style={styles.dateMetaRow}>
            {scheduleSource && linkedTask ? (
              !scheduleSource.live.requiredDate ? (
                <Text style={[styles.cycleHint, { flex: 1 }]} testID="submittal-required-source">
                  {`Counted back from "${linkedTask.title}" when it was set. The schedule has no start date now, so it can't be checked against it.`}
                </Text>
              ) : scheduleSource.live.requiredDate === scheduleSource.stored ? (
                <Text style={[styles.cycleHint, { flex: 1 }]} testID="submittal-required-source">
                  {`From the schedule: "${linkedTask.title}" starts ${formatCalendarDay(scheduleSource.live.taskStart ?? '')}, less ${leadWords} estimated lead (AI). Change it if the architect needs it sooner.`}
                </Text>
              ) : (
                <View style={{ flex: 1, gap: 6 }} testID="submittal-required-moved">
                  <Text style={styles.cycleHint}>
                    {`Schedule moved: was ${formatCalendarDay(scheduleSource.stored)}, now ${formatCalendarDay(scheduleSource.live.requiredDate)} — "${linkedTask.title}" starts ${formatCalendarDay(scheduleSource.live.taskStart ?? '')}, less ${leadWords} estimated lead (AI).`}
                  </Text>
                  <Button
                    label={`Update to ${formatCalendarDay(scheduleSource.live.requiredDate)}`}
                    variant="secondary" size="sm" onPress={takeScheduleDate}
                    testID="submittal-required-take-schedule"
                  />
                </View>
              )
            ) : <View style={{ flex: 1 }} />}
            <TouchableOpacity onPress={() => setRequiredDate('')} accessibilityRole="button" testID="submittal-required-clear">
              <Text style={styles.cycleHint}>Clear date</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.cycleHint} testID="submittal-required-empty">
            No required date yet — set one, or it stays off the chase list.
          </Text>
        )}
        {existingSubmittal && typeof existingSubmittal.leadDays === 'number' ? (
          <Text style={styles.cycleHint}>{`Lead time: ${existingSubmittal.leadDays} days — estimated lead (AI) from the spec book.`}</Text>
        ) : null}

        {/* #57: the product data IS the submittal. Files upload to the
            project's documents and ride on the reviewer email. */}
        {existingSubmittal ? (
          <View style={styles.attachSection} testID="submittal-attachments">
            <Text style={styles.fieldLabel}>Product data & shop drawings</Text>
            {productData.length === 0 ? (
              <Text style={styles.cycleHint}>Nothing attached yet. Attach the cut sheet, shop drawing or sample photo the architect is reviewing.</Text>
            ) : productData.map(entry => (
              <View key={entry} style={styles.attachRow}>
                <Paperclip size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.attachName} numberOfLines={1}>{attachmentDisplayName(entry)}</Text>
                {!uploadBlock ? (
                  <TouchableOpacity onPress={() => handleRemoveAttachment(entry)} accessibilityRole="button" accessibilityLabel={`Remove ${attachmentDisplayName(entry)}`}>
                    <X size={14} color={themeColors.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            <View style={styles.cycleDateRow}>
              <TouchableOpacity
                style={[styles.pickerBtn, { flex: 1 }, (!!uploadBlock || uploading) && { opacity: 0.5 }]}
                onPress={() => { void handleAttachPdf(); }}
                disabled={!!uploadBlock || uploading}
                accessibilityState={{ disabled: !!uploadBlock || uploading }}
                activeOpacity={0.7}
                testID="submittal-attach-pdf"
              >
                <FileText size={15} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.pickerBtnText} numberOfLines={1}>Attach PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerBtn, { flex: 1 }, (!!uploadBlock || uploading) && { opacity: 0.5 }]}
                onPress={() => { void handleAttachPhoto(); }}
                disabled={!!uploadBlock || uploading}
                accessibilityState={{ disabled: !!uploadBlock || uploading }}
                activeOpacity={0.7}
                testID="submittal-attach-photo"
              >
                <ImageIcon size={15} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.pickerBtnText} numberOfLines={1}>Attach photo</Text>
              </TouchableOpacity>
            </View>
            {uploading ? <ActivityIndicator size="small" color={themeColors.accent} style={{ marginTop: 8 }} /> : null}
            {/* A blocked control says why. */}
            {uploadBlock ? <Text style={styles.cycleHint} testID="submittal-attach-block">{uploadBlock}</Text> : null}
          </View>
        ) : (
          <Text style={styles.cycleHint}>Create the submittal, then attach the product data and send it for review.</Text>
        )}

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
                  {/* #147: a portal answer with no send on file has no Sent day —
                      say so rather than print a made-up one. */}
                  <Text style={styles.cycleDetail}>Sent: {cycleDayLabel(cycle.sentDate) ?? 'not recorded'}</Text>
                  {!!cycle.returnDate && <Text style={styles.cycleDetail}>Returned: {cycleDayLabel(cycle.returnDate) ?? cycle.returnDate}</Text>}
                  {cycle.comments && <Text style={styles.cycleComments}>{cycle.comments}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {existingSubmittal && (
          <>
            {!showAddCycle ? (
              openCycle ? (
                // #147: the open cycle is closed in place, never doubled.
                <TouchableOpacity style={styles.addCycleBtn} onPress={() => setShowAddCycle(true)} activeOpacity={0.7} testID="submittal-close-cycle">
                  <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.addCycleBtnText}>Log the reviewer's answer · Cycle {openCycleNo}</Text>
                </TouchableOpacity>
              ) : (
              <TouchableOpacity style={styles.addCycleBtn} onPress={() => setShowAddCycle(true)} activeOpacity={0.7}>
                <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.addCycleBtnText}>Add Review Cycle</Text>
              </TouchableOpacity>
              )
            ) : (
              <View style={styles.addCycleForm}>
                {openCycle ? (
                  <>
                    <Text style={styles.sectionTitle}>Cycle {openCycleNo} · {openCycle.reviewer || 'Reviewer'}</Text>
                    <Text style={styles.cycleHint} testID="submittal-close-cycle-note">
                      This closes Cycle {openCycleNo} — it does not start a new round. Pick the stamp it came back with and the day it came back.
                    </Text>
                    {openCycle.reviewer?.trim() ? null : (
                      <TextInput
                        style={styles.input}
                        value={newReviewer}
                        onChangeText={setNewReviewer}
                        placeholder="Reviewer name"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.sectionTitle}>New Review Cycle · Cycle {existingSubmittal.reviewCycles.reduce((m, c) => Math.max(m, c.cycleNumber || 0), 0) + 1}</Text>
                    <TextInput
                      style={styles.input}
                      value={newReviewer}
                      onChangeText={setNewReviewer}
                      placeholder="Reviewer name"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </>
                )}
                <View style={styles.statusPicker}>
                  {CYCLE_STATUSES.filter(st => !openCycle || st !== 'in_review').map(s => (
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
                <View style={styles.cycleDateRow}>
                  {openCycle ? null : (
                  <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setCycleDatePicker('sent')} activeOpacity={0.7} testID="submittal-cycle-sent">
                    <CalendarDays size={15} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={[styles.pickerBtnText, !newCycleSent && { color: themeColors.textMuted }]} numberOfLines={1}>
                      {newCycleSent ? `Sent ${formatCalendarDay(newCycleSent)}` : 'Sent (optional)'}
                    </Text>
                  </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.pickerBtn, { flex: 1 }]} onPress={() => setCycleDatePicker('returned')} activeOpacity={0.7} testID="submittal-cycle-returned">
                    <CalendarDays size={15} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={[styles.pickerBtnText, !newCycleReturned && { color: themeColors.textMuted }]} numberOfLines={1}>
                      {newCycleReturned ? `Returned ${formatCalendarDay(newCycleReturned)}` : newCycleStatus === 'in_review' ? 'Returned (not yet)' : 'Returned *'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {(newCycleSent || newCycleReturned) ? (
                  <TouchableOpacity onPress={() => { setNewCycleSent(''); setNewCycleReturned(''); }} accessibilityRole="button">
                    <Text style={styles.cycleHint}>Clear dates</Text>
                  </TouchableOpacity>
                ) : null}
                <DatePickerModal
                  visible={cycleDatePicker !== null}
                  value={(() => {
                    const d = cycleDatePicker === 'sent' ? newCycleSent : newCycleReturned;
                    return d ? (parseCalendarDay(d)?.toISOString() ?? '') : '';
                  })()}
                  title={cycleDatePicker === 'sent' ? 'Sent to reviewer' : 'Returned by reviewer'}
                  onClose={() => setCycleDatePicker(null)}
                  onChange={(iso) => {
                    const day = calendarDayOf(iso) ?? todayCalendarDay();
                    if (cycleDatePicker === 'sent') setNewCycleSent(day); else setNewCycleReturned(day);
                  }}
                />
                <TextInput
                  style={[styles.input, { minHeight: 60 }]}
                  value={newCycleComments}
                  onChangeText={setNewCycleComments}
                  placeholder="Comments (optional)"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity style={styles.addCycleSubmit} onPress={handleAddCycle} activeOpacity={0.85} testID="submittal-cycle-submit">
                  <Text style={styles.addCycleSubmitText}>{openCycle ? `Close Cycle ${openCycleNo}` : 'Add Cycle'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {scheduleTasks.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Linked Schedule Task</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
              <Link2 size={15} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : linkedTaskId ? 'Linked task is no longer on the schedule — tap to relink' : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')} accessibilityRole="button" accessibilityLabel="Close"><X size={14} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
              </View>
            )}
          </>
        )}

        {existingSubmittal && (
          <SendToClientButton
            kind="submittal"
            itemId={existingSubmittal.id}
            projectId={existingSubmittal.projectId}
            portalState={existingSubmittal.portalState}
            itemUpdatedAt={existingSubmittal.updatedAt}
            // #58: the portal snapshots the SAVED row, so it is off while
            // there are unsaved edits. #148: it carries the number.
            canSend={!sendBlock && existingSubmittal.title.trim().length > 0}
            canSendReason={sendBlock ?? (existingSubmittal.title.trim().length === 0 ? 'Add a title before sending.' : undefined)}
          />
        )}

        {/* #58: save and stay, so the sends can go. */}
        {existingSubmittal && isDirty && (
          <TouchableOpacity style={styles.addCycleBtn} onPress={handleSaveInPlace} activeOpacity={0.85} testID="submittal-save-in-place">
            <Save size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.addCycleBtnText}>Save changes</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="submittal-save">
          <Save size={18} color="#fff" strokeWidth={1.75} />
          <Text style={styles.saveBtnText}>{existingSubmittal ? 'Update Submittal' : 'Create Submittal'}</Text>
        </TouchableOpacity>

        {/* Share + Email actions only appear once the submittal exists.
            Share opens the OS share sheet with the branded PDF; Email
            sends an HTML email via Resend and auto-creates a new review
            cycle so the submittal's review history reflects the routing. */}
        {existingSubmittal && (
          <View style={styles.exportRow}>
            <TouchableOpacity style={styles.exportBtn} onPress={handleSharePDF} activeOpacity={0.7} testID="submittal-share-pdf">
              <Share2 size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.exportBtnText}>Share PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, styles.exportBtnPrimary, !!sendBlock && { opacity: 0.5 }]}
              onPress={() => setShowEmailSend(true)}
              disabled={!!sendBlock}
              activeOpacity={0.7}
              testID="submittal-email"
              accessibilityState={{ disabled: !!sendBlock }}
            >
              <Send size={16} color="#fff" strokeWidth={1.75} />
              <Text style={[styles.exportBtnText, { color: '#fff' }]}>Send to Reviewer</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* #58 / #148: says why, never a dead button. */}
        {existingSubmittal && !!sendBlock && (
          <Text style={styles.cycleHint} testID="submittal-send-block">{sendBlock}</Text>
        )}
      </ScrollView>

      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTaskPicker(false)}>
          <Pressable style={styles.taskPickerCard} onPress={() => undefined}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>Link Schedule Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}>
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity key={task.id} style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}>
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={1.75} />}
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
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
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
              {packageGate.confirmLabel ? (
                // #57: an empty package is his call, made here, per send.
                <View style={styles.confirmRow}>
                  <Switch
                    value={sendWithoutProductData}
                    onValueChange={setSendWithoutProductData}
                    testID="submittal-send-without-product-data"
                  />
                  <Text style={[styles.cycleHint, { flex: 1, marginTop: 0 }]}>{packageGate.confirmLabel}</Text>
                </View>
              ) : null}
              {packageGate.blocked ? (
                <Text style={styles.cycleHint} testID="submittal-package-block">{packageGate.blocked}</Text>
              ) : null}
              {resendCycle ? (
                <Text style={styles.cycleHint} testID="submittal-resend-note">
                  {`Cycle ${resendCycle} is still out for review, so this goes as a reminder for that round — no new cycle is added.`}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.emailSendBtn, (sending || !!packageGate.blocked) && { opacity: 0.5 }]}
                onPress={handleSendEmail}
                disabled={sending || !!packageGate.blocked}
                accessibilityState={{ disabled: sending || !!packageGate.blocked }}
                activeOpacity={0.85}
                testID="submittal-email-send"
              >
                <Send size={16} color="#fff" strokeWidth={1.75} />
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
  gateCard: { ...cardSurface(themeColors, { radius: 'md', pad: 16 }), gap: 12, alignItems: 'flex-start' },
  gateText: { fontSize: Type.callout.fontSize, color: themeColors.text, lineHeight: 21 },
  cycleHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17, marginTop: 6 },
  cycleDateRow: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  dateMetaRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  attachSection: { marginTop: 4 },
  attachRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  attachName: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  confirmRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginTop: 12 },
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
    backgroundColor: themeColors.accentFill,
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
    backgroundColor: themeColors.accentFill,
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
  exportBtnPrimary: { backgroundColor: themeColors.accentFill, borderColor: themeColors.accent },
  exportBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  emailModalCard: { backgroundColor: themeColors.surface, marginHorizontal: 16, padding: 20, borderRadius: Tokens.radius.panel, gap: 6, borderWidth: 1, borderColor: themeColors.line },
  emailModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  emailModalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  emailFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 10 },
  emailInput: { backgroundColor: themeColors.line, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  emailSendBtn: { marginTop: 16, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: themeColors.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.card },
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
