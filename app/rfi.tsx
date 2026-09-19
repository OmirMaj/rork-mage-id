import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, ChevronDown, Link2, X, CheckCircle2, Send, CalendarDays, RefreshCw, AlertTriangle, ImagePlus } from 'lucide-react-native';
import { MageRFI, MageAIMark } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
// Project-scoped gate: an invited collaborator may do the work they were
// invited to do, even though their own tier is free. See
// utils/collaboratorAccess.
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import {
  useCollectionSettled, useRefetchCollectionOnOpen, useServerRecordNumber,
  recordGate, changedFields, rfiBallAfterSave, rfiRegressionReason, recordNumberLabel, numberHoldReason, sendBlockReason,
  rebaseFormOnLive,
} from '@/hooks/useCollectionSettled';
import { planSheetStoragePath, resolvePlanSheetUrl } from '@/utils/planSheetUrls';
import Paywall from '@/components/Paywall';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import { parseRFIFromTranscript, mergeText, pickIfEmpty } from '@/utils/voiceFormParsers';
import { sendEmail, buildRFIEmailHtml } from '@/utils/emailService';
import type { RFI, RFIStatus, RFIPriority, RFIBallInCourt, RFIHandoff } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface, Button } from '@/components/ui';
import { PhotoMarkupOverlay, markupForSource, sourcePhotoIdOf } from '@/components/PhotoMarkupOverlay';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { extractMemoryDocs, answerFromMemorySemantic } from '@/utils/projectMemory';
import { rfiBlockStatus, overdueCalendarDays } from '@/utils/delayScan/rfiBlocking';
import { computeRfiHoldTime } from '@/utils/rfiHoldTime';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useQueryClient } from '@tanstack/react-query';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert } from '@/utils/alert';
import { parseCalendarDay, formatCalendarDay, toCalendarDayString, addCalendarDays, calendarDayOf } from '@/utils/calendarDate';

const PRIORITY_OPTIONS: RFIPriority[] = ['low', 'normal', 'urgent'];
const STATUS_OPTIONS: RFIStatus[] = ['open', 'answered', 'closed', 'void'];

/** Ball-in-court display helpers — a single source of truth for the party
 *  labels + colors used in both the badge and the handoff log.
 *
 *  These switch on RFIBallInCourt ITSELF rather than on a local copy of its
 *  values. There used to be a private `BallParty` alias here listing the six
 *  parties by hand; the moment the real enum grew a landlord it silently
 *  disagreed with the type it was pretending to be. Switching on the imported
 *  union means tsc — not a bug report from the field — is what tells the next
 *  person a new party needs a label and a color. */
function ballLabel(p: RFIBallInCourt): string {
  switch (p) {
    case 'gc': return 'You (GC)';
    case 'architect': return 'Architect';
    case 'engineer': return 'Engineer';
    case 'owner': return 'Owner';
    case 'sub': return 'Subcontractor';
    case 'landlord': return 'Landlord';
    case 'building_engineer': return 'Building engineer';
    case 'closed': return 'Closed';
  }
}
function getBallColor(p: RFIBallInCourt): string {
  switch (p) {
    case 'gc': return '#0EA5A4';        // teal — GC's turn
    case 'architect': return '#3F6B7D'; // slate-blue — design team
    case 'engineer': return '#3F6B7D';
    case 'owner': return '#F59E0B';     // amber — owner
    case 'sub': return '#5A7D3C';       // olive — sub / field
    // Building side gets its own hue. It is neither the owner (a different
    // party with a different SLA) nor the GC's own tier, and on a fit-out it
    // is the party a schedule most often waits on.
    case 'landlord': return '#8B5E83';        // plum — building side
    case 'building_engineer': return '#8B5E83';
    case 'closed': return '#6B7280';    // gray — closed
  }
}

/** The form's fields as a stored RFI seeds them — the SAME defaults the
 *  useState initializers use, so an untouched form diffs to nothing. */
function rfiFormValuesOf(r: RFI) {
  return {
    subject: r.subject ?? '',
    question: r.question ?? '',
    assignedTo: r.assignedTo ?? '',
    assignedSubId: r.assignedSubId ?? '',
    submittedBy: r.submittedBy ?? '',
    dateRequired: r.dateRequired ?? '',
    priority: r.priority ?? 'normal',
    status: r.status ?? 'open',
    linkedDrawing: r.linkedDrawing ?? '',
    linkedTaskId: r.linkedTaskId ?? '',
    response: r.response ?? '',
    attachments: r.attachments ?? [],
  };
}

// Pipeline stages for the StatusPipeline visualization at the top of an
// existing RFI. We omit 'void' from the visual flow — it's a side branch
// (an RFI was raised then withdrawn), not the next normal step. Users can
// still set status=void via the status picker further down the form.
const RFI_PIPELINE_STAGES: PipelineStage<RFIStatus>[] = [
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'closed', label: 'Closed', terminal: true },
];

export default function RFIScreen() {
  const router = useRouter();
  // Read the project from params here (not just in Inner) so the gate can
  // ask 'were they invited to THIS project?' before paywalling.
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess, canAccessOwnTier } = useProjectAccess(gateProjectId);
  const roleState = useProjectRoleState(gateProjectId);
  // useProjectAccess wraps the collaborator check; the tier LABEL still comes
  // from useTierAccess, which is the one that reads featureTiers.ts.
  const { requiredTierFor } = useTierAccess();
  // Gating contract: an invited collaborator on a free account is not
  // paywalled while his grant is still being read — he waits, or retries a
  // failed read. A settled null role on a named project is "no access", said
  // plainly; the paywall is for someone whose own plan is the answer.
  const collaboratorWait = gateProjectId && !canAccessOwnTier('rfis_submittals')
    ? (roleState.isLoading
      ? <RecordGateView title="RFIs" state="loading" />
      : roleState.isError
        ? (
          <RecordGateView
            title="RFIs" state="error"
            message="Couldn't check your access to this job. Check your connection and try again."
            onRetry={() => { void roleState.refetch(); }}
          />
        )
        : roleState.role === null
          ? <RecordGateView title="RFIs" state="missing" message="You don't have access to this project's RFIs. Ask the project owner to invite you." />
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
  return <RFIScreenInner />;
}

/** Loader / gone / couldn't-load states for the record screen (#142) and the
 *  access gate. Never a blank, saveable form. */
function RecordGateView({ title, state, message, onRetry }: {
  title: string;
  state: 'loading' | 'missing' | 'error';
  message?: string;
  onRetry?: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg, padding: 24, justifyContent: 'center' }} testID={`rfi-gate-${state}`}>
      <Stack.Screen options={{ title }} />
      {state === 'loading' ? (
        <ActivityIndicator size="small" color={themeColors.accent} />
      ) : (
        <View style={styles.gateCard}>
          <Text style={styles.gateText}>{message}</Text>
          {onRetry ? <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} testID="rfi-gate-retry" /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * #142: the record must be IN HAND before the form mounts. Opened by link on a
 * browser that has never cached it, the rfis fetch was still in flight, every
 * useState initializer ran against null, and Update then wrote '' / NULL over
 * the real record (and reopened an answered one). Wait for the collection to
 * settle, then mount the form keyed on the record id so its initializers run
 * on the real record; settled without it, say why.
 */
function RFIScreenInner() {
  const { projectId, rfiId } = useLocalSearchParams<{ projectId?: string; rfiId?: string }>();
  const { rfis } = useProjects();
  const qc = useQueryClient();
  // #55: fresh copy on open and on every return to the foreground.
  useRefetchCollectionOnOpen('rfis');
  const settled = useCollectionSettled('rfis', rfiId);
  const found = rfiId ? rfis.find(r => r.id === rfiId && (!projectId || r.projectId === projectId)) : undefined;
  const gate = recordGate({
    wantsRecord: !!rfiId,
    foundInContext: !!found,
    foundInQuery: settled.hasRecord,
    settled: settled.settled,
    failed: settled.failed,
  });
  if (gate === 'loading') return <RecordGateView title="RFI" state="loading" />;
  if (gate === 'missing') {
    return <RecordGateView title="RFI" state="missing" message="This RFI no longer exists, or it isn't shared with you. Ask the project owner if you expected to see it." />;
  }
  if (gate === 'error') {
    return <RecordGateView title="RFI" state="error" message="Couldn't load this RFI. Check your connection and try again." onRetry={() => { void qc.invalidateQueries({ queryKey: ['rfis'] }); }} />;
  }
  return <RFIForm key={found?.id ?? 'new'} />;
}

function RFIForm() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId: paramProjectId, rfiId, prefillPhotoId } = useLocalSearchParams<{
    projectId: string;
    rfiId?: string;
    prefillPhotoId?: string;
  }>();
  const ctx = useProjects();
  const {
    projects, getProject, getRFIsForProject, addRFI, updateRFI, settings, subcontractors,
    getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject,
    projectPhotos, drawingPins, planSheets,
  } = ctx;
  const { tier } = useSubscription();

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const existingRFIs = useMemo(() => getRFIsForProject(projectId ?? ''), [projectId, getRFIsForProject]);
  const existingRFI = useMemo(() => rfiId ? existingRFIs.find(r => r.id === rfiId) : null, [rfiId, existingRFIs]);

  // When arriving from photo-annotator with `prefillPhotoId`, look up the whole
  // photo — not just its URI. The photo already knows which schedule task it
  // belongs to and carries the markup the GC drew on it; both were being thrown
  // away here, so the architect received an unmarked photo and the RFI arrived
  // unlinked to the task it was blocking (audit 2026-09-17 #12).
  const prefillPhoto = useMemo(
    () => (prefillPhotoId ? (projectPhotos ?? []).find(p => p.id === prefillPhotoId) : undefined),
    [prefillPhotoId, projectPhotos],
  );
  const prefillPhotoUri = prefillPhoto?.uri ?? null;

  const [subject, setSubject] = useState(existingRFI?.subject ?? '');
  const [question, setQuestion] = useState(existingRFI?.question ?? '');
  const [assignedTo, setAssignedTo] = useState(existingRFI?.assignedTo ?? '');
  // WHICH sub, when this RFI goes to one. Free-text assignedTo can't be
  // attributed, so without this the sub scorecard can't score turnaround.
  const [assignedSubId, setAssignedSubId] = useState<string | undefined>(existingRFI?.assignedSubId);
  const [submittedBy, setSubmittedBy] = useState(existingRFI?.submittedBy ?? '');
  const [dateRequired, setDateRequired] = useState(existingRFI?.dateRequired ?? '');
  const [priority, setPriority] = useState<RFIPriority>(existingRFI?.priority ?? 'normal');
  const [status, setStatus] = useState<RFIStatus>(existingRFI?.status ?? 'open');
  const [linkedDrawing, setLinkedDrawing] = useState(existingRFI?.linkedDrawing ?? '');
  const [response, setResponse] = useState(existingRFI?.response ?? '');
  // The photo knows what it was a photo OF. Seeding the link from it is what
  // makes the RFI show up on the task it is holding up — and what feeds
  // rfiBlockStatus below, which is otherwise silent on an unlinked RFI.
  const [linkedTaskId, setLinkedTaskId] = useState(
    existingRFI?.linkedTaskId ?? prefillPhoto?.linkedTaskId ?? '',
  );
  // Local attachments — start with existing RFI attachments OR a fresh
  // array seeded with the prefill photo URI.
  const [attachments, setAttachments] = useState<string[]>(
    existingRFI?.attachments ?? (prefillPhotoUri ? [prefillPhotoUri] : []),
  );

  // #55 / #58: the record the form OPENED with. A save sends only the fields
  // that differ from it (never the whole form), then re-bases on what it
  // saved — so a copy the architect has since answered through the portal is
  // never written back over his answer, and Send can save first.
  const [opened, setOpened] = useState<RFI | null>(() => existingRFI ?? null);
  const formValues = useMemo(() => ({
    subject, question, assignedTo, assignedSubId: assignedSubId ?? '', submittedBy, dateRequired,
    priority, status, linkedDrawing, linkedTaskId, response, attachments,
  }), [subject, question, assignedTo, assignedSubId, submittedBy, dateRequired, priority, status, linkedDrawing, linkedTaskId, response, attachments]);
  const pendingChanges = useMemo(
    () => (opened ? changedFields(rfiFormValuesOf(opened), formValues) : {}),
    [opened, formValues],
  );
  const isDirty = existingRFI
    ? Object.keys(pendingChanges).length > 0
    : subject.trim() !== '' || question.trim() !== '';

  /** Put a record's values into every form field (the inverse of rfiFormValuesOf). */
  const applyFormValues = useCallback((v: ReturnType<typeof rfiFormValuesOf>) => {
    setSubject(v.subject); setQuestion(v.question); setAssignedTo(v.assignedTo);
    setAssignedSubId(v.assignedSubId || undefined); setSubmittedBy(v.submittedBy);
    setDateRequired(v.dateRequired); setPriority(v.priority); setStatus(v.status);
    setLinkedDrawing(v.linkedDrawing); setLinkedTaskId(v.linkedTaskId);
    setResponse(v.response); setAttachments(v.attachments);
  }, []);

  // #55 / #56 (review round 3): adopt a newer copy of the record. The form
  // seeded once — often from the cached copy — and the open / foreground
  // refetch (or a save) lands after. Fields he hasn't touched take the live
  // value, his edits stay, and the live row becomes the baseline; so the
  // architect's portal answer shows here, and a saved form reads clean.
  // Keyed on the record's identity only: a baseline change alone (a save)
  // never re-bases against the pre-save list.
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const formRef = useRef(formValues);
  formRef.current = formValues;
  const lastLiveRef = useRef(existingRFI);
  useEffect(() => {
    if (!existingRFI || existingRFI === lastLiveRef.current) return;
    lastLiveRef.current = existingRFI;
    const base = rfiFormValuesOf(openedRef.current ?? existingRFI);
    applyFormValues(rebaseFormOnLive(base, formRef.current, rfiFormValuesOf(existingRFI)));
    setOpened(existingRFI);
  }, [existingRFI, applyFormValues]);

  // #148: the number is the SERVER's. Until it has been read back the header
  // says "(pending #)" and nothing that prints a number goes out.
  const numberInfo = useServerRecordNumber('rfis', existingRFI?.id, existingRFI?.number);
  const numberLabel = existingRFI
    ? recordNumberLabel('RFI', numberInfo.state, numberInfo.number, existingRFI.number)
    : 'Ask the Architect';
  const numberHold = existingRFI ? numberHoldReason('RFI', numberInfo.state) : null;
  // #58: every send (architect email, client portal) is off while there are
  // unsaved edits — Send never saves; see sendBlockReason.
  const sendBlock = existingRFI ? sendBlockReason({ isDirty, numberHold }) : null;
  // The state initializers above run on the FIRST render only, and the photo
  // cache can hydrate a beat after this screen opens — so a prefill that
  // arrives late would be dropped on the floor. Latched so it fills each field
  // exactly once and never overwrites something he has since typed.
  const prefillPulled = useRef(false);
  useEffect(() => {
    if (!prefillPhoto || existingRFI || prefillPulled.current) return;
    prefillPulled.current = true;
    setAttachments(prev => (prev.length ? prev : [prefillPhoto.uri]));
    setLinkedTaskId(prev => prev || (prefillPhoto.linkedTaskId ?? ''));
  }, [prefillPhoto, existingRFI]);

  // The gallery photo the first attachment was raised from. Kept as an ID, not
  // just the copied URI: that URI is a device-local `file://` path or a signed
  // URL re-minted every session, so on the office device, on web, or next
  // launch it matches no photo — the markup lookup came back empty and the
  // copied link itself could stop opening (audit #12, review 2). Only the
  // photo-annotator prefill puts an attachment here, and always at index 0.
  const sourcePhotoId = existingRFI ? sourcePhotoIdOf(existingRFI) : (prefillPhotoId || undefined);
  const sourcePhoto = useMemo(
    () => (sourcePhotoId ? (projectPhotos ?? []).find(p => p.id === sourcePhotoId) : undefined),
    [sourcePhotoId, projectPhotos],
  );
  /** What attachment `index` should render as, and with which markup. The
   *  source photo's CURRENT uri beats the stored copy, which may have expired
   *  or belong to another device. */
  const attachmentView = useCallback((uri: string, index: number) => {
    const fromSource = index === 0 ? sourcePhoto : undefined;
    return {
      uri: fromSource?.uri || uri,
      markup: markupForSource(projectPhotos, fromSource?.id, uri),
    };
  }, [sourcePhoto, projectPhotos]);

  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  // Send-to-Architect modal state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmail_To, setSendEmailTo] = useState('');
  const [sendEmail_Name, setSendEmailName] = useState('');
  const [sendEmail_Note, setSendEmailNote] = useState('');
  const [sending, setSending] = useState(false);
  // ─── RFI brain ───
  const [suggesting, setSuggesting] = useState(false);
  const [suggestCitation, setSuggestCitation] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  // Response-field visibility is a LATCH, not a live derivation from the
  // field's own text: once shown, it stays mounted so select-all-delete
  // doesn't unmount the TextInput (and dismiss the keyboard) mid-edit.
  const [responseShown, setResponseShown] = useState<boolean>(() =>
    !!existingRFI && (
      existingRFI.status === 'answered' || existingRFI.status === 'closed' || !!existingRFI.response?.trim()
    ));
  useEffect(() => {
    if (status === 'answered' || status === 'closed' || response.trim().length > 0) setResponseShown(true);
  }, [status, response]);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  // Critical-path check for the linked task — pure rfiBlockStatus wrapped in a
  // memo. cpmOptions mirror the schedule screens (Grounded reality #6).
  const blocking = useMemo(() => rfiBlockStatus(
    { linkedTaskId: linkedTaskId || undefined, status },
    project?.schedule,
    {
      scheduleStartDate: project?.schedule?.startDate,
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
    },
  ), [linkedTaskId, status, project?.schedule]);

  // Local CALENDAR days overdue, not elapsed 24h blocks — a due date stored as
  // noon UTC reads overdue at local midnight after the due day, and "due today"
  // stays 0 all day. Pure math lives in overdueCalendarDays (validator-covered).
  const overdueDays = useMemo(() => {
    if (!existingRFI || status !== 'open' || !dateRequired) return 0;
    return overdueCalendarDays(dateRequired);
  }, [existingRFI, status, dateRequired]);

  // Owner-side HOLD time — how long the ball actually sat in the architect's,
  // engineer's, or owner's court, folded from the append-only handoff chain.
  // A different number from the round-trip age the pipeline shows, because
  // round trip includes the days the RFI sat on the GC's own desk. Both are
  // rendered below, labelled, and never summed. Pure math lives in
  // utils/rfiHoldTime.ts.
  const holdTime = useMemo(
    () => computeRfiHoldTime({
      handoffs: existingRFI?.handoffs,
      status: existingRFI?.status ?? 'open',
      dateSubmitted: existingRFI?.dateSubmitted ?? '',
      dateResponded: existingRFI?.dateResponded,
    }),
    [existingRFI],
  );
  const dayWord = useCallback((n: number) => (n === 1 ? 'day' : 'days'), []);

  /**
   * The update half of Save, without leaving the screen (#58). Validates,
   * refuses a change the server would refuse anyway (#55), writes only the
   * fields he changed plus the ball hand-off, and returns the record as it now
   * stands so a send can be built from it. Null = nothing may be sent.
   */
  const persistForm = useCallback((): RFI | null => {
    if (!existingRFI) return null;
    if (!subject.trim()) {
      showAlert('Missing Subject', 'Please enter a subject for this RFI.');
      return null;
    }
    if (!question.trim()) {
      showAlert('Missing Question', 'Please enter the RFI question.');
      return null;
    }
    const base = opened ?? existingRFI;
    const blocked = rfiRegressionReason(base, { status, response });
    if (blocked) {
      showAlert("Can't save that change", blocked);
      return null;
    }
    const now = new Date().toISOString();
    const changed = changedFields(rfiFormValuesOf(base), formValues);
    const updates: Partial<RFI> = {};
    if ('subject' in changed) updates.subject = subject.trim();
    if ('question' in changed) updates.question = question.trim();
    if ('assignedTo' in changed) updates.assignedTo = assignedTo.trim();
    if ('assignedSubId' in changed) updates.assignedSubId = assignedSubId || undefined;
    if ('submittedBy' in changed) updates.submittedBy = submittedBy.trim();
    if ('dateRequired' in changed) updates.dateRequired = dateRequired;
    if ('priority' in changed) updates.priority = priority;
    if ('status' in changed) updates.status = status;
    if ('linkedDrawing' in changed) updates.linkedDrawing = linkedDrawing.trim();
    if ('linkedTaskId' in changed) updates.linkedTaskId = linkedTaskId || undefined;
    if ('attachments' in changed) updates.attachments = attachments;
    const responseTyped = 'response' in changed && response.trim().length > 0;
    if ('response' in changed) updates.response = response.trim() || undefined;
    // `existingRFI` is the LIVE copy (refetched on open / foreground), so the
    // stamp and the hand-off build on what the server holds now.
    if (responseTyped && !existingRFI.dateResponded) updates.dateResponded = now;
    // Auto-shift the ball: closing sends it to 'closed'; an answer (typed
    // here, or one the portal filed after the send) hands it back to the GC.
    const ball = rfiBallAfterSave({
      prevBall: existingRFI.ballInCourt,
      handoffs: existingRFI.handoffs,
      status,
      responseTyped,
      dateResponded: updates.dateResponded ?? existingRFI.dateResponded,
      now,
    });
    if (ball.added.length > 0) {
      updates.ballInCourt = ball.ball as RFIBallInCourt;
      updates.handoffs = [...(existingRFI.handoffs ?? []), ...(ball.added as RFIHandoff[])];
    }
    if (Object.keys(updates).length > 0) updateRFI(existingRFI.id, updates);
    const saved: RFI = { ...existingRFI, ...updates };
    // Form and baseline both become the saved record (review round 3): fields
    // he didn't change take the live values `existingRFI` carries, so a save
    // over a copy the portal answered leaves nothing "unsaved" behind.
    applyFormValues(rfiFormValuesOf(saved));
    setOpened(saved);
    return saved;
  }, [existingRFI, opened, subject, question, assignedTo, assignedSubId, submittedBy, dateRequired, priority, status, linkedDrawing, linkedTaskId, response, attachments, formValues, updateRFI, applyFormValues]);

  // Leaving with edits on screen asks first (#58): backing out used to drop
  // the rewrite silently. A save that navigates away opens the gate itself.
  const navigation = useNavigation();
  const allowLeave = useRef(false);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (allowLeave.current || !dirtyRef.current) return;
    e.preventDefault();
    showAlert(
      'Discard your changes?',
      "Your edits to this RFI aren't saved yet.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { allowLeave.current = true; navigation.dispatch(e.data.action); } },
      ],
    );
  }), [navigation]);

  const handleSave = useCallback(() => {
    if (existingRFI) {
      if (!persistForm()) return;
    } else {
      if (!subject.trim()) {
        showAlert('Missing Subject', 'Please enter a subject for this RFI.');
        return;
      }
      if (!question.trim()) {
        showAlert('Missing Question', 'Please enter the RFI question.');
        return;
      }
      const now = new Date().toISOString();
      addRFI({
        projectId: projectId ?? '',
        subject: subject.trim(),
        question: question.trim(),
        submittedBy: submittedBy.trim(),
        assignedTo: assignedTo.trim(),
        assignedSubId,
        dateSubmitted: now,
        // B4 review A2: dateRequired is a CALENDAR DAY. The two-week default
        // is a local day, not an evening instant whose UTC date prefix is
        // tomorrow's.
        dateRequired: dateRequired || toCalendarDayString(addCalendarDays(new Date(), 14)),
        status: 'open',
        priority,
        // Start with the GC holding the ball — they have to send the
        // RFI before responsibility shifts to the assignee. Hand-off
        // happens in the Send modal (handleConfirmSend below).
        ballInCourt: 'gc',
        handoffs: [{
          at: now,
          fromParty: 'gc',
          toParty: 'gc',
          note: 'RFI created',
        }],
        linkedDrawing: linkedDrawing.trim() || undefined,
        linkedTaskId: linkedTaskId || undefined,
        attachments,
        // RFI.sourcePhotoId (rfis.source_photo_id) is how every other device
        // finds the markup. Spread so it is written only while the prefilled
        // photo is still the first attachment, and never as an explicit
        // undefined over a value the record already has.
        ...(sourcePhotoId && attachments.length > 0 ? { sourcePhotoId } : {}),
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    allowLeave.current = true;
    router.back();
  }, [subject, question, assignedTo, assignedSubId, submittedBy, dateRequired, priority, linkedDrawing, linkedTaskId, existingRFI, projectId, addRFI, router, attachments, sourcePhotoId, persistForm]);

  // #58: "Save changes" — the save half of Update, staying on the screen so
  // he can send next. The send runs in a LATER render, whose context closures
  // already hold the saved record.
  const handleSaveInPlace = useCallback(() => {
    if (!persistForm()) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [persistForm]);

  // (c) Attach a photo from this device. It is emailed from this device; the
  // architect's reply page lists it as sent with the email.
  const handleAttachPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      showAlert('Permission needed', 'Allow photo library access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    setAttachments(prev => (prev.includes(uri) ? prev : [...prev, uri]));
  }, []);

  const priorityColor = priority === 'urgent' ? themeColors.danger : priority === 'normal' ? themeColors.accent : themeColors.textSecondary;

  // Open the "Send to Architect / Engineer" modal. Prefills the To-Name
  // from the RFI's `assignedTo` field, so if the GC already noted who
  // this is for, they don't have to retype.
  const openSendModal = useCallback(() => {
    if (!existingRFI) return;
    setSendEmailName(assignedTo || '');
    setSendEmailTo('');
    setSendEmailNote('');
    setShowSendModal(true);
  }, [existingRFI, assignedTo]);

  const handleSendToPro = useCallback(async () => {
    if (!existingRFI || !project) return;
    const to = sendEmail_To.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      showAlert('Invalid email', 'Enter a valid recipient email address.');
      return;
    }
    // #148: the email prints the RFI number, so it waits for the server's.
    if (numberInfo.state !== 'confirmed' || typeof numberInfo.number !== 'number') {
      showAlert('Not sent yet', numberHold ?? 'This RFI has no confirmed number yet.');
      return;
    }
    const rfiNumber = numberInfo.number;
    // #58: the email is built from the SAVED record, and the reply link has
    // the architect read the stored row — so an unsaved rewrite must never go
    // out as the placeholder. Send does not save (a save and a send in one tap
    // share this render's stale closures); it refuses while edits are unsaved.
    if (isDirty) {
      showAlert('Save first', sendBlockReason({ isDirty, numberHold: null }) ?? '');
      return;
    }
    setSending(true);
    try {
      // #77 (a): plan-sheet links are signed and expire. Re-mint them now; the
      // fresh ones are stored in the ONE write after the email goes (below),
      // so the reply page opens the sheet too.
      const stored = existingRFI.attachments ?? [];
      const minted = await Promise.all(stored.map(u => (planSheetStoragePath(u) ? resolvePlanSheetUrl(u) : Promise.resolve(u))));
      const mintedChanged = minted.some((u, i) => u !== stored[i]);
      const sent: RFI = mintedChanged ? { ...existingRFI, attachments: minted } : existingRFI;
      // Build the architect reply portal URL — embeds the RFI's
      // share_token so the portal can fetch + respond via SECURITY
      // DEFINER RPCs without an account. Falls back to email-only
      // reply if the token isn't available yet (older RFIs).
      // Portal lives on the marketing site (mageid.app/architect/), not the
      // app domain — it's a static HTML page that hits Supabase RPCs directly.
      const replyPortalUrl = sent.shareToken
        ? `https://mageid.app/architect/?token=${sent.shareToken}&type=rfi`
        : undefined;
      // #77 (b): where the pin is. The reply page circles it on the sheet; the
      // emailed sheet is the plain drawing, so the email says where to look.
      const pin = drawingPins.find(p => p.linkedRfiId === sent.id);
      const pinSheet = pin ? planSheets.find(ps => ps.id === pin.planSheetId) : undefined;
      const pinLine = pin && pinSheet
        ? `Marked location: ${(pinSheet.sheetNumber ?? '').trim() || pinSheet.name}, ${Math.round(pin.x * 100)}% across and ${Math.round(pin.y * 100)}% down the sheet${replyPortalUrl ? ' — circled on the sheet at the reply link' : ''}.`
        : '';
      const note = [sendEmail_Note.trim(), pinLine].filter(Boolean).join('\n\n');
      const html = buildRFIEmailHtml({
        companyName: settings?.branding?.companyName ?? 'MAGE ID',
        recipientName: sendEmail_Name.trim(),
        projectName: project.name,
        rfiNumber,
        subject: sent.subject,
        question: sent.question,
        priority: sent.priority,
        dateRequired: sent.dateRequired,
        submittedBy: sent.submittedBy,
        linkedDrawing: sent.linkedDrawing,
        message: note || undefined,
        contactName: settings?.branding?.contactName,
        contactEmail: settings?.branding?.email,
        contactPhone: settings?.branding?.phone,
        replyPortalUrl,
      });
      const subject = `RFI #${rfiNumber}: ${sent.subject} — ${project.name}`;
      // The source photo's current uri where there is one — the stored copy
      // may be another device's file:// or an expired signed URL.
      const sendUris = sent.attachments?.length
        ? sent.attachments.map((stored, index) => attachmentView(stored, index).uri)
        : undefined;
      const result = await sendEmail({
        to,
        subject,
        html,
        replyTo: settings?.branding?.email,
        attachments: sendUris,
      });
      if (!result.success) {
        showAlert('Send failed', result.error || 'Could not send the RFI. Try again.');
        return;
      }
      // Shift the ball-in-court to the architect. The GC held it until
      // they hit Send; now responsibility is theirs until they reply
      // through the portal or the GC manually pulls it back. Append to
      // the handoff log for the audit trail (delay-claim docs etc.).
      const now = new Date().toISOString();
      // Typed as RFIHandoff rather than inferred. The inline version spelled
      // the party union out by hand on fromParty and used `as const` on
      // toParty to dodge widening — two workarounds for not naming the type
      // that already describes this object, and the hand-written copy is what
      // let RFIBallInCourt grow a landlord without anything here noticing.
      const newHandoff: RFIHandoff = {
        at: now,
        fromParty: sent.ballInCourt ?? 'gc',
        toParty: 'architect',
        note: `Sent to ${sendEmail_Name.trim() || to}`,
      };
      // ONE write per send (#58 review): the fresh plan-sheet links ride with
      // the hand-off. Two updateRFI calls from one closure would each rebuild
      // the record from the same pre-send list, the second undoing the first.
      const handedOff: Partial<RFI> = {
        ballInCourt: 'architect',
        handoffs: [...(sent.handoffs ?? []), newHandoff],
        ...(mintedChanged ? { attachments: minted } : {}),
      };
      updateRFI(sent.id, handedOff);
      const afterSend: RFI = { ...sent, ...handedOff };
      applyFormValues(rfiFormValuesOf(afterSend));
      setOpened(afterSend);
      // Status stays 'open' — the RFI is still open until the
      // architect responds. ballInCourt is the live signal of "who's
      // holding it right now."
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // #56: say where the answer comes back — the reply link files it on this
      // RFI and MAGE ID alerts him; only an email-only RFI (no link) means pasting.
      const whereBack = replyPortalUrl
        ? 'Their answer is filed on this RFI when they submit it through the reply link, and MAGE ID alerts you.'
        : `Their reply will come to your email${settings?.branding?.email ? ` (${settings.branding.email})` : ''} — paste it into the Response field.`;
      // #146: an attachment this device could not read was left off. Never
      // "RFI Sent" as if the architect has the photo.
      const dropped = result.attachmentsDropped ?? 0;
      if (dropped > 0) {
        showAlert(
          `RFI sent without ${dropped} attachment${dropped === 1 ? '' : 's'}`,
          `Sent to ${to}, but ${dropped === 1 ? 'one photo' : `${dropped} photos`} could not be read on this device and ${dropped === 1 ? 'was' : 'were'} left off. Attach ${dropped === 1 ? 'it' : 'them'} from this device and send again, or send ${dropped === 1 ? 'it' : 'them'} to the architect yourself. ${whereBack}`,
        );
      } else {
        showAlert('RFI Sent', `Sent to ${to}. ${whereBack}`);
      }
      setShowSendModal(false);
    } catch (err) {
      console.error('[RFI] Send failed:', err);
      showAlert('Send failed', err instanceof Error ? err.message : 'Could not send RFI.');
    } finally {
      setSending(false);
    }
  }, [existingRFI, project, sendEmail_To, sendEmail_Name, sendEmail_Note, settings, updateRFI, attachmentView, numberInfo.state, numberInfo.number, numberHold, isDirty, drawingPins, planSheets, applyFormValues]);

  // ─── MAGE suggests an answer ───
  // Same machinery as app/project-memory.tsx: extract this project's records,
  // retrieve semantically (pgvector when deployed, TF-IDF fallback), draft an
  // answer citing refs. answerFromMemorySemantic NEVER throws — but on failure
  // it resolves with errorKind set (answer = error sentence) and with zero
  // records it resolves with searched === 0. Gate on both so a failure leaves
  // the response field untouched.
  const handleSuggestAnswer = useCallback(async () => {
    const q = question.trim();
    if (!q || suggesting || !projectId) return;
    setSuggesting(true);
    // Reset BOTH result banners — a failed retry must not leave last
    // attempt's "Drafted from …" citation sitting above the new error.
    setSuggestError(null);
    setSuggestCitation(null);
    try {
      // Smart-tier call — meter it like every other AI call site (client-side
      // daily caps per CLAUDE.md; the relay only sees the feature id).
      const limit = await checkAILimit(tier, 'smart', 'projectMemory');
      if (!limit.allowed) {
        setSuggestError(limit.message ?? "You've used today's advanced AI calls. Try again tomorrow.");
        return;
      }
      const docs = extractMemoryDocs({
        rfis: getRFIsForProject(projectId).filter(r => r.id !== existingRFI?.id), // don't cite the question at itself
        dailyReports: getDailyReportsForProject(projectId),
        changeOrders: getChangeOrdersForProject(projectId),
        submittals: getSubmittalsForProject(projectId),
        punchItems: getPunchItemsForProject(projectId),
      });
      // Exclusions also cover the SEMANTIC path — the pgvector index was synced
      // with every RFI (including this one), so without these the RFI's own
      // question is its own nearest neighbor and gets cited at itself.
      const res = await answerFromMemorySemantic(q, projectId, docs, {
        excludeDocIds: existingRFI ? [`rfi-${existingRFI.id}`] : [],
        excludeRefs: existingRFI ? [`RFI #${existingRFI.number}`] : [],
        feature: 'projectMemory',
      });
      if (res.errorKind || res.searched === 0 || !res.answer.trim()) {
        setSuggestError(res.searched === 0
          ? 'No project records to draft from yet — answers, reports and change orders become source material as you log them.'
          : res.answer || "MAGE couldn't draft an answer right now. Try again in a moment.");
        return;
      }
      if (!res.fromCache) void recordAIUsage('smart', 'projectMemory');
      setResponse(res.answer.trim());
      setResponseShown(true);
      // Citation honesty: name refs only when retrieval actually MATCHED
      // records. matched=false means the recency fallback fed the model —
      // naming those refs would be fabricated provenance, so show none.
      setSuggestCitation(res.matched
        ? (res.usedRefs.length > 0
          ? `Drafted from ${res.usedRefs.slice(0, 3).join(', ')} — review before sending.`
          : "Drafted from this project's records — review before sending.")
        : null);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSuggesting(false);
    }
  }, [question, suggesting, projectId, tier, existingRFI, getRFIsForProject, getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject]);

  if (!project && !existingRFI) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'RFIs' }} />
        <ToolProjectPicker
          toolName="RFIs"
          message="RFIs (Requests for Information) attach to a project so the answer becomes part of that job's record."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MageRFI size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap RFIs inside the project tile grid.',
            'Hit Ask the Architect, dictate the question, set a deadline, and send.',
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
        {!existingRFI && (
          <FeatureHeader
            eyebrow="RFI · Request for Information"
            title="Ask a question. Get a paper trail."
            subtitle="Send the design team (architect, engineer, owner) a question with a deadline. Every answer is logged with a timestamp — protects you when scope drifts later."
            explainer={{
              term: 'Request for Information (RFI)',
              definition: 'An RFI is the formal way you ask the architect, engineer, or owner a question during construction. It creates a clock (when do you need the answer?) and a permanent record. RFIs are how you protect yourself when a detail is unclear or missing — a delayed RFI answer is documented evidence for a schedule extension.',
              whenToUse: [
                'A drawing detail is unclear, missing, or contradicts another sheet',
                'You need a substitution approved on a spec\'d product',
                'A field condition doesn\'t match the design and you need direction',
              ],
            }}
          />
        )}
        {project && (
          <Text style={styles.projectLabel}>{project.name}</Text>
        )}

        {/* Overdue / critical-path banner — the RFI's cost made visible. Danger
            when the response is late; warning when the linked task has no float. */}
        {existingRFI && status === 'open' && (overdueDays > 0 || blocking.critical) && (
          <View style={[styles.alertBanner, overdueDays > 0 ? styles.alertBannerDanger : styles.alertBannerWarn]} testID="rfi-alert-banner">
            <AlertTriangle size={15} color={overdueDays > 0 ? themeColors.danger : Colors.warning} strokeWidth={1.75} />
            <Text style={styles.alertBannerText}>
              {overdueDays > 0
                ? `Response due ${overdueDays} ${dayWord(overdueDays)} ago`
                : 'Waiting on this answer'}
              {blocking.critical && blocking.taskTitle ? ` — blocks "${blocking.taskTitle}" on the critical path.` : ''}
              {/* Owner-side hold, not the round-trip age. */}
              {holdTime.measurable && holdTime.ownerSideDays > 0
                ? ` Owner side has held it ${holdTime.ownerSideDays} ${dayWord(holdTime.ownerSideDays)}.`
                : ''}
            </Text>
          </View>
        )}

        {existingRFI && (
          <View style={styles.pipelineWrap}>
            <StatusPipeline
              stages={RFI_PIPELINE_STAGES}
              current={status === 'void' ? 'open' : status}
              startedAt={existingRFI.dateSubmitted}
              dueAt={dateRequired || undefined}
              onAdvance={(next) => {
                setStatus(next);
                if (next === 'answered' && !response) {
                  showAlert(
                    'Mark as answered',
                    'Add the response below before saving so the audit trail captures who said what.',
                    [{ text: 'OK' }],
                  );
                }
              }}
              advanceLabel={
                status === 'open' ? 'Mark answered'
                : status === 'answered' ? 'Mark closed'
                : undefined
              }
            />
          </View>
        )}

        {/* Ball-in-court badge — surfaces who's holding the RFI right
            now so the GC always knows whether they're waiting on
            someone else or whether they're the bottleneck. The
            handoff log below is the audit trail; this is the
            at-a-glance signal. */}
        {existingRFI && (
          <View style={styles.ballInCourtCard}>
            <View style={styles.ballInCourtRow}>
              <Text style={styles.ballInCourtEyebrow}>BALL IN COURT</Text>
              <View style={[styles.ballInCourtBadge, { backgroundColor: getBallColor(existingRFI.ballInCourt ?? 'gc') }]}>
                <Text style={styles.ballInCourtBadgeText}>
                  {ballLabel(existingRFI.ballInCourt ?? 'gc')}
                </Text>
              </View>
            </View>
            {/* HOLD TIME — how long the other side actually had it.
                Round-trip age includes the GC's own turnaround, so it says
                nothing about how fast anyone else moved. Owner-side hold is
                the intervals the architect / engineer / owner held the ball,
                folded from the handoff chain below. Round trip is shown too,
                labelled as what it is, so the two never get mistaken for each
                other. A sub's hold is the GC's own tier and is listed on the
                GC's side — see utils/rfiHoldTime.ts. */}
            <View style={styles.holdBlock} testID="rfi-hold-time">
              <Text style={styles.handoffLogLabel}>Hold time</Text>
              {holdTime.measurable ? (
                <>
                  <View style={styles.holdRow}>
                    <Text style={styles.holdLabel}>Owner side held it</Text>
                    <Text style={styles.holdValueStrong}>
                      {holdTime.ownerSideDays} {dayWord(holdTime.ownerSideDays)}
                      {holdTime.accruing ? ' and counting' : ''}
                    </Text>
                  </View>
                  <View style={styles.holdRow}>
                    <Text style={styles.holdLabel}>Your turnaround</Text>
                    <Text style={styles.holdValue}>{holdTime.gcDays} {dayWord(holdTime.gcDays)}</Text>
                  </View>
                  {holdTime.subDays > 0 && (
                    <View style={styles.holdRow}>
                      <Text style={styles.holdLabel}>Held by a sub (your side)</Text>
                      <Text style={styles.holdValue}>{holdTime.subDays} {dayWord(holdTime.subDays)}</Text>
                    </View>
                  )}
                  {holdTime.buildingDays > 0 && (
                    <View style={styles.holdRow}>
                      <Text style={styles.holdLabel}>Held by the building (neither side)</Text>
                      <Text style={styles.holdValue}>
                        {holdTime.buildingDays} {dayWord(holdTime.buildingDays)}
                        {holdTime.accruingBuilding ? ' and counting' : ''}
                      </Text>
                    </View>
                  )}
                  <View style={styles.holdRow}>
                    <Text style={styles.holdLabel}>Total elapsed, round trip</Text>
                    <Text style={styles.holdValue}>{holdTime.elapsedDays} {dayWord(holdTime.elapsedDays)}</Text>
                  </View>
                  <Text style={styles.holdNote}>
                    Owner side means the architect, engineer, or owner. A subcontractor&apos;s time
                    counts on your side, not theirs, and time with the landlord or building engineer
                    counts on neither — that is a third party with its own turnaround. Round trip
                    includes your own turnaround, so it is not a measure of how fast they answered.
                  </Text>
                </>
              ) : (
                <Text style={styles.holdNote}>
                  This RFI has no handoff log, so owner-side hold time cannot be computed — it is
                  unknown, not zero. Total elapsed is {holdTime.elapsedDays} {dayWord(holdTime.elapsedDays)},
                  which includes your own turnaround and is not a measure of how fast they
                  answered. Sending and answering from this screen starts the chain.
                </Text>
              )}
            </View>

            {(existingRFI.handoffs?.length ?? 0) > 0 && (
              <View style={styles.handoffLog}>
                <Text style={styles.handoffLogLabel}>Handoff log</Text>
                {(existingRFI.handoffs ?? []).slice(-4).map((h, i) => (
                  <View key={i} style={styles.handoffRow}>
                    <Text style={styles.handoffArrow}>
                      {ballLabel(h.fromParty)} → {ballLabel(h.toParty)}
                    </Text>
                    <Text style={styles.handoffMeta}>
                      {new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {h.note ? ` · ${h.note}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {existingRFI && (
          <PortalStatusPill portalState={existingRFI.portalState} itemUpdatedAt={existingRFI.updatedAt} />
        )}

        <InlineVoiceFill
          title="Dictate this RFI"
          contextLine={project?.name ? `for ${project.name}` : undefined}
          buttonLabel={existingRFI ? 'Add detail by voice' : 'Fill RFI by voice'}
          suggestions={[
            'Ask the architect about the LVL beam size for the kitchen island, urgent',
            'We need the tile pattern for the master bath by Friday',
            'Engineer — please confirm the footing depth on the south side',
            'Owner question about the door swing direction in the powder room',
          ]}
          onTranscript={async (transcript) => {
            const partial = await parseRFIFromTranscript(transcript, project);
            // Subject: fill if empty, else leave alone (don't clobber).
            if (partial.subject) setSubject(prev => pickIfEmpty(prev, partial.subject));
            // Question is long-form free text — append so a second
            // dictation extends the question rather than replacing it.
            if (partial.question) setQuestion(prev => mergeText(prev, partial.question, prev ? 'append' : 'replace-if-empty'));
            // Priority: only overwrite if user hasn't picked something
            // explicit. Default state is 'normal' so we'd always overwrite
            // — instead, only overwrite when AI says urgent or low (i.e.
            // they spoke an explicit priority cue).
            if (partial.priority && partial.priority !== 'normal') setPriority(partial.priority);
            if (partial.assignedTo) setAssignedTo(prev => pickIfEmpty(prev, partial.assignedTo));
            if (partial.dateRequired) setDateRequired(prev => pickIfEmpty(prev, partial.dateRequired));
          }}
        />

        <Text style={styles.fieldLabel}>Subject *</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Brief description of the question"
          placeholderTextColor={themeColors.textMuted}
          testID="rfi-subject"
        />

        <Text style={styles.fieldLabel}>Question *</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={question}
          onChangeText={setQuestion}
          placeholder="Full RFI question body..."
          placeholderTextColor={themeColors.textMuted}
          multiline
          textAlignVertical="top"
          testID="rfi-question"
        />

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>Submitted By</Text>
            <TextInput
              style={styles.input}
              value={submittedBy}
              onChangeText={setSubmittedBy}
              placeholder="Name or company"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>Assigned To</Text>
            <TextInput
              style={styles.input}
              value={assignedTo}
              onChangeText={(v) => {
                setAssignedTo(v);
                // Typing over a picked sub breaks the link, so drop the id
                // rather than leave it pointing at a different company.
                if (assignedSubId) setAssignedSubId(undefined);
              }}
              placeholder="Architect, engineer..."
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
        </View>

        {/* Sub attribution. `assignedTo` is free text and the handoff log
            records only ROLES ('sub'), so without an actual sub id the app can
            measure that the sub side held this RFI but not WHO — and the sub
            scorecard cannot score their turnaround. Optional: plenty of RFIs
            go to an architect and never touch a sub. */}
        {subcontractors.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>
              Which sub?{'  '}
              <Text style={styles.subChipHint}>optional — scores their RFI turnaround</Text>
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subChipRow}
              keyboardShouldPersistTaps="handled"
            >
              {subcontractors.map(sc => {
                const on = assignedSubId === sc.id;
                return (
                  <TouchableOpacity
                    key={sc.id}
                    onPress={() => {
                      if (on) { setAssignedSubId(undefined); return; }
                      setAssignedSubId(sc.id);
                      // Fill the visible name for convenience, but never
                      // clobber one the GC already typed.
                      if (!assignedTo.trim()) setAssignedTo(sc.companyName);
                    }}
                    style={[styles.subChip, on && styles.subChipOn]}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Assign RFI to ${sc.companyName}`}
                    testID={`rfi-sub-${sc.id}`}
                  >
                    <Text
                      style={[styles.subChipText, on && styles.subChipTextOn]}
                      numberOfLines={1}
                    >
                      {sc.companyName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        <Text style={styles.fieldLabel}>Response Required By</Text>
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
          testID="rfi-date-required"
        >
          <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text
            style={[styles.pickerBtnText, !dateRequired && { color: themeColors.textMuted }]}
            numberOfLines={1}
          >
            {/* B4 review A2: a calendar day — bare from photo-triage / the voice
                parsers, noon-UTC from DatePickerModal; formatCalendarDay resolves
                both. new Date(bareDay) printed the day before, west of Greenwich. */}
            {/* #164: a full instant is read as the LOCAL day it names
                (calendarDayOf), a bare day as itself. */}
            {dateRequired ? formatCalendarDay(calendarDayOf(dateRequired) ?? dateRequired) : 'Select a date'}
          </Text>
        </TouchableOpacity>
        <DatePickerModal
          visible={showDatePicker}
          // The picker parses `value` with new Date(); hand it LOCAL midnight of
          // the day as an instant (same as app/permits.tsx) or a bare day opens
          // on the previous day west of Greenwich.
          value={dateRequired ? (parseCalendarDay(calendarDayOf(dateRequired))?.toISOString() ?? dateRequired) : ''}
          allowFuture
          title="Response required by"
          onClose={() => setShowDatePicker(false)}
          onChange={(iso) => setDateRequired(iso)}
        />

        <Text style={styles.fieldLabel}>Priority</Text>
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={() => setShowPriorityPicker(!showPriorityPicker)}
          activeOpacity={0.7}
        >
          <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
          <Text style={styles.pickerBtnText}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</Text>
          <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
        {showPriorityPicker && (
          <View style={styles.pickerOptions}>
            {PRIORITY_OPTIONS.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.pickerOption, priority === p && styles.pickerOptionActive]}
                onPress={() => { setPriority(p); setShowPriorityPicker(false); }}
              >
                <Text style={[styles.pickerOptionText, priority === p && styles.pickerOptionTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {existingRFI && (
          <>
            <Text style={styles.fieldLabel}>Status</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowStatusPicker(!showStatusPicker)}
              activeOpacity={0.7}
            >
              <Text style={styles.pickerBtnText}>{status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}</Text>
              <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
            {showStatusPicker && (
              <View style={styles.pickerOptions}>
                {STATUS_OPTIONS.map(s => {
                  // #55: an answered RFI does not go back to Open — the server
                  // keeps the answer either way, so the option says why.
                  const locked = s === 'open' && !!rfiRegressionReason(opened ?? existingRFI, { status: 'open', response: 'kept' });
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.pickerOption, status === s && styles.pickerOptionActive, locked && { opacity: 0.45 }]}
                      onPress={() => { if (locked) return; setStatus(s); setShowStatusPicker(false); }}
                      disabled={locked}
                      accessibilityState={{ disabled: locked }}
                    >
                      <Text style={[styles.pickerOptionText, status === s && styles.pickerOptionTextActive]}>
                        {s.charAt(0).toUpperCase() + s.replace('_', ' ').slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {!!rfiRegressionReason(opened ?? existingRFI, { status: 'open', response: 'kept' }) && (
                  <Text style={styles.attachmentNote}>
                    {rfiRegressionReason(opened ?? existingRFI, { status: 'open', response: 'kept' })}
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        <Text style={styles.fieldLabel}>Linked Drawing</Text>
        <TextInput
          style={styles.input}
          value={linkedDrawing}
          onChangeText={setLinkedDrawing}
          placeholder="e.g. A-101"
          placeholderTextColor={themeColors.textMuted}
        />

        {/* Attached photos. Until now the screen accepted an attachment and
            never drew it, so the GC could not see what he was about to send —
            and the markup he drew on it (the circle around the clash, the
            "conflict here" label) was invisible everywhere outside the
            project-detail lightbox. The markup IS the question. */}
        {/* (c) Attach from this device — any RFI, with or without photos yet. */}
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={() => { void handleAttachPhoto(); }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Attach a photo"
          testID="rfi-attach-photo"
        >
          <ImagePlus size={15} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.attachBtnText}>Attach a photo</Text>
        </TouchableOpacity>
        {attachments.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Photos</Text>
            <View style={styles.attachmentStrip}>
              {attachments.map((stored, index) => {
                const { uri, markup } = attachmentView(stored, index);
                return (
                  <View key={stored} style={styles.attachmentThumbWrap}>
                    <Image source={{ uri }} style={styles.attachmentThumb} contentFit="cover" />
                    {markup.length > 0 && <PhotoMarkupOverlay markup={markup} />}
                  </View>
                );
              })}
            </View>
            {attachments.some((stored, index) => attachmentView(stored, index).markup.length > 0) && (
              // Honest about the boundary: the markup is stored alongside the
              // photo, not burned into the image file, so an emailed copy is
              // the plain shot. Say so rather than let him assume the
              // architect sees the circle.
              <Text style={styles.attachmentNote}>
                Your markup shows here. An emailed copy of the photo is the plain shot — describe
                the mark in the question too.
              </Text>
            )}
            {existingRFI && drawingPins.some(p => p.linkedRfiId === existingRFI.id) && (
              // #77 (b): the pin is circled on the architect's reply page; the
              // emailed sheet is the plain drawing, and the email names the spot.
              <Text style={styles.attachmentNote}>
                The pin is circled on the sheet at the architect&apos;s reply link. The emailed sheet
                is the plain drawing — the email says where the pin is.
              </Text>
            )}
            {attachments.some(u => /^(file|content|ph|assets-library|blob):/i.test(u)) && (
              <Text style={styles.attachmentNote}>
                Photos attached from this device are emailed from this device. The architect&apos;s
                reply page lists them as sent with the email.
              </Text>
            )}
          </>
        )}

        {existingRFI && responseShown && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Response</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={response}
              onChangeText={setResponse}
              placeholder="Official response..."
              placeholderTextColor={themeColors.textMuted}
              multiline
              textAlignVertical="top"
            />
          </>
        )}

        {/* MAGE suggests — drafts a response from how this project answered
            similar questions before. Cited; GC reviews before sending.
            Hidden once an answered/closed/void RFI holds a recorded response —
            one absent-minded tap must not overwrite the official answer. */}
        {existingRFI && (
          <>
            {!((status === 'answered' || status === 'closed' || status === 'void') && response.trim().length > 0) && (
              <TouchableOpacity
                style={[styles.suggestBtn, (suggesting || !question.trim()) && styles.suggestBtnDisabled]}
                onPress={handleSuggestAnswer}
                disabled={suggesting || !question.trim()}
                activeOpacity={0.85}
                testID="rfi-suggest"
                accessibilityRole="button"
                accessibilityLabel="MAGE suggests an answer"
                accessibilityState={{ disabled: suggesting || !question.trim(), busy: suggesting }}
              >
                {suggesting ? (
                  <>
                    <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.suggestBtnText}>Searching this project&rsquo;s history…</Text>
                  </>
                ) : (
                  <>
                    <MageAIMark size={14} color={themeColors.accent} />
                    <Text style={styles.suggestBtnText}>MAGE suggests an answer</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            {!!suggestCitation && !suggesting && (
              <Text style={styles.suggestCitation}>{suggestCitation}</Text>
            )}
            {!!suggestError && !suggesting && (
              <Text style={styles.suggestError}>{suggestError}</Text>
            )}
          </>
        )}

        {scheduleTasks.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Linked Schedule Task</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
              <Link2 size={15} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')} style={styles.unlinkBtn} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {existingRFI && (
          <SendToClientButton
            kind="rfi"
            itemId={existingRFI.id}
            projectId={existingRFI.projectId}
            portalState={existingRFI.portalState}
            itemUpdatedAt={existingRFI.updatedAt}
            // #58: the portal snapshots the SAVED row, so it is off while
            // there are unsaved edits (sendBlock says so). #148: it carries
            // the number. Not dirty ⇒ the screen IS the saved record.
            canSend={!sendBlock && (existingRFI.question ?? '').trim().length > 0}
            canSendReason={sendBlock ?? ((existingRFI.question ?? '').trim().length === 0 ? 'Add a question before sending.' : undefined)}
          />
        )}

        {/* #58: save and stay, so the sends below can go. */}
        {existingRFI && isDirty && (
          <TouchableOpacity style={styles.sendToProBtn} onPress={handleSaveInPlace} activeOpacity={0.85} testID="rfi-save-in-place">
            <Save size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.sendToProBtnText}>Save changes</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="rfi-save">
          <Save size={18} color="#fff" strokeWidth={1.75} />
          <Text style={styles.saveBtnText}>{existingRFI ? 'Update RFI' : 'Create RFI'}</Text>
        </TouchableOpacity>

        {/* Send-to-Architect/Engineer — only available for SAVED RFIs.
            Opens a modal collecting the recipient email + optional note,
            sends a formatted RFI email via the existing email service.
            The architect's reply lands in the GC's inbox (replyTo). */}
        {existingRFI && (
          <>
            <TouchableOpacity
              style={[styles.sendToProBtn, !!sendBlock && { opacity: 0.5 }]}
              onPress={openSendModal}
              disabled={!!sendBlock}
              activeOpacity={0.85}
              testID="rfi-send-to-pro"
              accessibilityState={{ disabled: !!sendBlock }}
            >
              <Send size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sendToProBtnText}>Send to Architect / Engineer</Text>
            </TouchableOpacity>
            {/* #58 / #148: says why, never a dead button. */}
            {!!sendBlock && <Text style={styles.attachmentNote} testID="rfi-send-block">{sendBlock}</Text>}
          </>
        )}
      </ScrollView>

      {/* Send-to-Pro modal */}
      <Modal visible={showSendModal} transparent animationType="fade" onRequestClose={() => setShowSendModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSendModal(false)}>
          <Pressable style={styles.sendCard} onPress={() => undefined}>
            <View style={styles.sendCardHeader}>
              <Text style={styles.sendCardTitle}>Send {numberLabel}</Text>
              <TouchableOpacity onPress={() => setShowSendModal(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sendCardHelper}>
              {/* #56: the reply link files the answer on this RFI; pasting is
                  only for an RFI with no link (older records). */}
              {existingRFI?.shareToken
                ? "They'll get a formatted email with the question and a reply link. Their answer is filed on this RFI when they submit it, and MAGE ID alerts you."
                : "They'll get a formatted email with the question. Their reply comes back to your inbox — paste it into the Response field."}
            </Text>
            <Text style={styles.sendFieldLabel}>Their email *</Text>
            <TextInput
              style={styles.sendInput}
              value={sendEmail_To}
              onChangeText={setSendEmailTo}
              placeholder="architect@firm.com"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.sendFieldLabel}>Their name (optional)</Text>
            <TextInput
              style={styles.sendInput}
              value={sendEmail_Name}
              onChangeText={setSendEmailName}
              placeholder="e.g. Sarah Chen, AIA"
              placeholderTextColor={themeColors.textMuted}
            />
            <Text style={styles.sendFieldLabel}>Personal note (optional)</Text>
            <TextInput
              style={[styles.sendInput, styles.sendInputMulti]}
              value={sendEmail_Note}
              onChangeText={setSendEmailNote}
              placeholder="Hey Sarah, need this back by Friday if possible…"
              placeholderTextColor={themeColors.textMuted}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.sendSubmitBtn, sending && { opacity: 0.6 }]}
              onPress={handleSendToPro}
              disabled={sending}
              activeOpacity={0.85}
              testID="rfi-send-submit"
            >
              <Send size={16} color="#fff" strokeWidth={1.75} />
              <Text style={styles.sendSubmitBtnText}>{sending ? 'Sending…' : 'Send RFI'}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Task Picker Modal */}
      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTaskPicker(false)}>
          <Pressable style={styles.taskPickerCard} onPress={() => undefined}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>Link Schedule Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]}
                onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}
              >
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity
                  key={task.id}
                  style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]}
                  onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}
                >
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={1.75} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskOptionText, linkedTaskId === task.id && styles.taskOptionTextActive]} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.taskOptionMeta}>{task.phase} · {task.durationDays}d · {task.progress}% done</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
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
  attachmentStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The thumbnail is the frame the normalized markup scales itself to, so the
  // overlay sits inside this wrapper rather than over the whole strip.
  attachmentThumbWrap: {
    ...cardSurface(themeColors, { radius: 'md', pad: 'none' }),
    width: 104, height: 104, overflow: 'hidden',
  },
  attachmentThumb: { width: '100%', height: '100%' },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 12, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: themeColors.line,
  },
  attachBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  gateCard: { ...cardSurface(themeColors, { radius: 'md', pad: 16 }), gap: 12, alignItems: 'flex-start' },
  gateText: { fontSize: Type.callout.fontSize, color: themeColors.text, lineHeight: 21 },
  attachmentNote: {
    fontSize: Type.caption1.fontSize, color: themeColors.textMuted,
    lineHeight: 17, marginTop: 8,
  },
  // Sub attribution chips — see the "Which sub?" block.
  subChipHint: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '400' as const,
    color: themeColors.textMuted,
  },
  subChipRow: { gap: 8, paddingRight: 16, paddingBottom: 2 },
  subChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: themeColors.line,
    backgroundColor: themeColors.bg,
    maxWidth: 180,
  },
  subChipOn: { borderColor: themeColors.accent, backgroundColor: themeColors.accentSoft },
  subChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  subChipTextOn: { color: themeColors.accentLabel },
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
  multilineInput: {
    minHeight: 100,
    paddingTop: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pickerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.line,
  },
  pickerOptionActive: {
    backgroundColor: themeColors.accentFill,
  },
  pickerOptionText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  pickerOptionTextActive: {
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
  // Send-to-Architect/Engineer button + modal
  sendToProBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: themeColors.surface,
    borderWidth: 1.5,
    borderColor: themeColors.accent + '40',
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    marginTop: 12,
  },
  sendToProBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
    letterSpacing: 0.2,
  },
  sendCard: {
    width: '90%' as const,
    maxWidth: 440,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.panel,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  sendCardHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  sendCardTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
  },
  sendCardHelper: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    lineHeight: 17,
    marginBottom: 14,
  },
  sendFieldLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
    marginTop: 10,
    marginBottom: 5,
  },
  sendInput: {
    backgroundColor: themeColors.bg,
    borderWidth: 1,
    borderColor: themeColors.line,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.text,
  },
  sendInputMulti: {
    minHeight: 70,
  },
  sendSubmitBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: themeColors.accentFill,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
    marginTop: 16,
  },
  sendSubmitBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: '#fff',
  },
  linkedTaskBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10, paddingVertical: 8, marginTop: 6,
  },
  linkedTaskPhase: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  linkedTaskName: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  unlinkBtn: { padding: 2 },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center', alignItems: 'center', padding: 24 },
  taskPickerCard: { backgroundColor: themeColors.surface ?? themeColors.surface, borderRadius: Tokens.radius.panel, width: '100%', overflow: 'hidden' },
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
  ballInCourtCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surface,
    borderWidth: 0.5, borderColor: themeColors.line,
    gap: 10,
  },
  ballInCourtRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  ballInCourtEyebrow: {
    fontSize: 10, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
  ballInCourtBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12,
  },
  ballInCourtBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.surface },
  handoffLog: {
    paddingTop: 8, borderTopWidth: 0.5, borderTopColor: themeColors.line,
    gap: 4,
  },
  handoffLogLabel: {
    fontSize: 10, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 4,
  },
  handoffRow: { gap: 1 },
  handoffArrow: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.text },
  handoffMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary },
  // Hold time — owner-side custody, kept visually separate from the
  // round-trip figures so the two claims never read as one number.
  holdBlock: {
    paddingTop: 8, borderTopWidth: 0.5, borderTopColor: themeColors.line,
    gap: 4,
  },
  holdRow: { flexDirection: 'row' as const, alignItems: 'baseline' as const, justifyContent: 'space-between' as const, gap: 12 },
  holdLabel: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  holdValue: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.text },
  holdValueStrong: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  holdNote: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 4 },
  // RFI brain — suggest button + banners
  suggestBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
    borderRadius: Tokens.radius.md, paddingVertical: 11, marginTop: 12,
  },
  suggestBtnDisabled: { opacity: 0.6 },
  suggestBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  suggestCitation: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, marginTop: 6 },
  suggestError: { fontSize: Type.caption1.fontSize, color: themeColors.danger, marginTop: 6 },
  alertBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: Tokens.radius.md, borderWidth: 1,
  },
  alertBannerDanger: { backgroundColor: themeColors.danger + '12', borderColor: themeColors.danger + '40' },
  alertBannerWarn: { backgroundColor: Colors.warning + '14', borderColor: Colors.warning + '40' },
  alertBannerText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
});
