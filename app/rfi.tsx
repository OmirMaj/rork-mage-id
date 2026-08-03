import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, ChevronDown, Link2, X, CheckCircle2, Send, CalendarDays, RefreshCw, AlertTriangle } from 'lucide-react-native';
import { MageRFI, MageAIMark } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import { parseRFIFromTranscript, mergeText, pickIfEmpty } from '@/utils/voiceFormParsers';
import { sendEmail, buildRFIEmailHtml } from '@/utils/emailService';
import type { RFIStatus, RFIPriority } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { extractMemoryDocs, answerFromMemorySemantic } from '@/utils/projectMemory';
import { rfiBlockStatus, overdueCalendarDays } from '@/utils/delayScan/rfiBlocking';
import { computeRfiHoldTime } from '@/utils/rfiHoldTime';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert } from '@/utils/alert';

const PRIORITY_OPTIONS: RFIPriority[] = ['low', 'normal', 'urgent'];
const STATUS_OPTIONS: RFIStatus[] = ['open', 'answered', 'closed', 'void'];

/** Ball-in-court display helpers — a single-source-of-truth for the
 *  party labels + colors used in both the badge and the handoff log. */
type BallParty = 'gc' | 'architect' | 'engineer' | 'owner' | 'sub' | 'closed';
function ballLabel(p: BallParty): string {
  switch (p) {
    case 'gc': return 'You (GC)';
    case 'architect': return 'Architect';
    case 'engineer': return 'Engineer';
    case 'owner': return 'Owner';
    case 'sub': return 'Subcontractor';
    case 'closed': return 'Closed';
  }
}
function getBallColor(p: BallParty): string {
  switch (p) {
    case 'gc': return '#0EA5A4';        // teal — GC's turn
    case 'architect': return '#3F6B7D'; // slate-blue — design team
    case 'engineer': return '#3F6B7D';
    case 'owner': return '#F59E0B';     // amber — owner
    case 'sub': return '#5A7D3C';       // olive — sub / field
    case 'closed': return '#6B7280';    // gray — closed
  }
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
  const { canAccess } = useTierAccess();
  const { colors: themeColors } = useTheme();
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
  return <RFIScreenInner />;
}

function RFIScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId, rfiId, prefillPhotoId } = useLocalSearchParams<{
    projectId: string;
    rfiId?: string;
    prefillPhotoId?: string;
  }>();
  const ctx = useProjects();
  const {
    getProject, getRFIsForProject, addRFI, updateRFI, settings,
    getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject,
  } = ctx;
  const { tier } = useSubscription();
  const projectPhotos = (ctx as any).projectPhotos as { id: string; uri: string }[] | undefined;

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingRFIs = useMemo(() => getRFIsForProject(projectId ?? ''), [projectId, getRFIsForProject]);
  const existingRFI = useMemo(() => rfiId ? existingRFIs.find(r => r.id === rfiId) : null, [rfiId, existingRFIs]);

  // When arriving from photo-annotator with `prefillPhotoId`, look up
  // the photo and pre-attach its URI to the new RFI's attachments.
  const prefillPhotoUri = useMemo(() => {
    if (!prefillPhotoId) return null;
    const photo = (projectPhotos ?? []).find(p => p.id === prefillPhotoId);
    return photo?.uri ?? null;
  }, [prefillPhotoId, projectPhotos]);

  const [subject, setSubject] = useState(existingRFI?.subject ?? '');
  const [question, setQuestion] = useState(existingRFI?.question ?? '');
  const [assignedTo, setAssignedTo] = useState(existingRFI?.assignedTo ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingRFI?.submittedBy ?? '');
  const [dateRequired, setDateRequired] = useState(existingRFI?.dateRequired ?? '');
  const [priority, setPriority] = useState<RFIPriority>(existingRFI?.priority ?? 'normal');
  const [status, setStatus] = useState<RFIStatus>(existingRFI?.status ?? 'open');
  const [linkedDrawing, setLinkedDrawing] = useState(existingRFI?.linkedDrawing ?? '');
  const [response, setResponse] = useState(existingRFI?.response ?? '');
  const [linkedTaskId, setLinkedTaskId] = useState(existingRFI?.linkedTaskId ?? '');
  // Local attachments — start with existing RFI attachments OR a fresh
  // array seeded with the prefill photo URI.
  const [attachments, setAttachments] = useState<string[]>(
    existingRFI?.attachments ?? (prefillPhotoUri ? [prefillPhotoUri] : []),
  );
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
  // This is a different claim from the round-trip age the pipeline shows:
  // Caddell lost partly because it measured total turnaround "including the
  // time the RFIs were in Caddell's hands." Both are rendered below, labelled,
  // and never summed. Pure math lives in utils/rfiHoldTime.ts.
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

  const handleSave = useCallback(() => {
    if (!subject.trim()) {
      showAlert('Missing Subject', 'Please enter a subject for this RFI.');
      return;
    }
    if (!question.trim()) {
      showAlert('Missing Question', 'Please enter the RFI question.');
      return;
    }

    const now = new Date().toISOString();

    if (existingRFI) {
      // Auto-shift the ball when the GC fills in a response or marks
      // the RFI closed. Status 'answered' OR a typed response → ball
      // back to GC (they need to review + close). Status 'closed' →
      // ballInCourt 'closed' so it drops out of the live filter.
      const prevBall = existingRFI.ballInCourt ?? 'gc';
      let nextBall = prevBall;
      const newHandoffs: typeof existingRFI.handoffs = [];
      const newResponseTyped = response.trim() && response.trim() !== (existingRFI.response ?? '');
      if (status === 'closed' && prevBall !== 'closed') {
        nextBall = 'closed';
        newHandoffs.push({
          at: now,
          fromParty: prevBall,
          toParty: 'closed',
          note: 'RFI closed by GC',
        });
      } else if (newResponseTyped && prevBall !== 'gc') {
        // Architect typed a response in the form (or pasted from email).
        // Flip ball back to GC for review.
        nextBall = 'gc';
        newHandoffs.push({
          at: now,
          fromParty: prevBall,
          toParty: 'gc',
          note: 'Response received',
        });
      }
      updateRFI(existingRFI.id, {
        subject: subject.trim(),
        question: question.trim(),
        assignedTo: assignedTo.trim(),
        submittedBy: submittedBy.trim(),
        dateRequired,
        priority,
        status,
        linkedDrawing: linkedDrawing.trim(),
        linkedTaskId: linkedTaskId || undefined,
        response: response.trim() || undefined,
        dateResponded: response.trim() && !existingRFI.dateResponded ? now : existingRFI.dateResponded,
        ballInCourt: nextBall,
        handoffs: newHandoffs.length > 0 ? [...(existingRFI.handoffs ?? []), ...newHandoffs] : existingRFI.handoffs,
      });
    } else {
      addRFI({
        projectId: projectId ?? '',
        subject: subject.trim(),
        question: question.trim(),
        submittedBy: submittedBy.trim(),
        assignedTo: assignedTo.trim(),
        dateSubmitted: now,
        dateRequired: dateRequired || new Date(Date.now() + 14 * 86400000).toISOString(),
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
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [subject, question, assignedTo, submittedBy, dateRequired, priority, status, linkedDrawing, response, linkedTaskId, existingRFI, projectId, addRFI, updateRFI, router, attachments]);

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
    setSending(true);
    try {
      // Build the architect reply portal URL — embeds the RFI's
      // share_token so the portal can fetch + respond via SECURITY
      // DEFINER RPCs without an account. Falls back to email-only
      // reply if the token isn't available yet (older RFIs).
      // Portal lives on the marketing site (mageid.app/architect/), not the
      // app domain — it's a static HTML page that hits Supabase RPCs directly.
      const replyPortalUrl = existingRFI.shareToken
        ? `https://mageid.app/architect/?token=${existingRFI.shareToken}&type=rfi`
        : undefined;
      const html = buildRFIEmailHtml({
        companyName: settings?.branding?.companyName ?? 'MAGE ID',
        recipientName: sendEmail_Name.trim(),
        projectName: project.name,
        rfiNumber: existingRFI.number,
        subject: existingRFI.subject,
        question: existingRFI.question,
        priority: existingRFI.priority,
        dateRequired: existingRFI.dateRequired,
        submittedBy: existingRFI.submittedBy,
        linkedDrawing: existingRFI.linkedDrawing,
        message: sendEmail_Note.trim() || undefined,
        contactName: settings?.branding?.contactName,
        contactEmail: settings?.branding?.email,
        contactPhone: settings?.branding?.phone,
        replyPortalUrl,
      });
      const subject = `RFI #${existingRFI.number}: ${existingRFI.subject} — ${project.name}`;
      const result = await sendEmail({
        to,
        subject,
        html,
        replyTo: settings?.branding?.email,
        attachments: existingRFI.attachments?.length ? existingRFI.attachments : undefined,
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
      const newHandoff = {
        at: now,
        fromParty: (existingRFI.ballInCourt ?? 'gc') as 'gc' | 'architect' | 'engineer' | 'owner' | 'sub' | 'closed',
        toParty: 'architect' as const,
        note: `Sent to ${sendEmail_Name.trim() || to}`,
      };
      updateRFI(existingRFI.id, {
        ballInCourt: 'architect',
        handoffs: [...(existingRFI.handoffs ?? []), newHandoff],
      });
      // Status stays 'open' — the RFI is still open until the
      // architect responds. ballInCourt is the live signal of "who's
      // holding it right now."
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert('RFI Sent', `Sent to ${to}. Their reply will come to your email${settings?.branding?.email ? ` (${settings.branding.email})` : ''}.`);
      setShowSendModal(false);
    } catch (err) {
      console.error('[RFI] Send failed:', err);
      showAlert('Send failed', err instanceof Error ? err.message : 'Could not send RFI.');
    } finally {
      setSending(false);
    }
  }, [existingRFI, project, sendEmail_To, sendEmail_Name, sendEmail_Note, settings, updateRFI]);

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
        <EmptyState
          icon={<MageRFI size={36} color={themeColors.accent} />}
          title="No RFI open yet"
          message="RFIs (Requests for Information) attach to a project so the answer becomes part of that job's record. To send one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap RFIs inside the project tile grid.',
            'Hit Ask the Architect, dictate the question, set a deadline, and send.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: themeColors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: existingRFI ? `RFI #${existingRFI.number}` : 'Ask the Architect' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
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
              {/* The claimable measure, not the round-trip age. */}
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
            {/* HOLD TIME — the number a delay claim actually rests on.
                Caddell Constr. Co. v. United States (Fed. Cl. 2007) went
                against the claimant partly because it measured RFI turnaround
                "including the time the RFIs were in Caddell's hands." Owner-
                side hold is the intervals the architect / engineer / owner
                held the ball, folded from the handoff chain below. Round trip
                is shown too, labelled as what it is, so the two never get
                mistaken for each other. A sub's hold is the GC's own tier and
                is listed on the GC's side — see utils/rfiHoldTime.ts. */}
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
                  <View style={styles.holdRow}>
                    <Text style={styles.holdLabel}>Total elapsed, round trip</Text>
                    <Text style={styles.holdValue}>{holdTime.elapsedDays} {dayWord(holdTime.elapsedDays)}</Text>
                  </View>
                  <Text style={styles.holdNote}>
                    Owner side means the architect, engineer, or owner. A subcontractor&apos;s time
                    counts on your side, not theirs. Round trip includes your own turnaround, so it
                    is not a delay measure.
                  </Text>
                </>
              ) : (
                <Text style={styles.holdNote}>
                  This RFI has no handoff log, so owner-side hold time cannot be computed — it is
                  unknown, not zero. Total elapsed is {holdTime.elapsedDays} {dayWord(holdTime.elapsedDays)},
                  which includes your own turnaround and is not a delay measure. Sending and
                  answering from this screen starts the chain.
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
              onChangeText={setAssignedTo}
              placeholder="Architect, engineer..."
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
        </View>

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
            {dateRequired
              ? new Date(dateRequired).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Select a date'}
          </Text>
        </TouchableOpacity>
        <DatePickerModal
          visible={showDatePicker}
          value={dateRequired}
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
                {STATUS_OPTIONS.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.pickerOption, status === s && styles.pickerOptionActive]}
                    onPress={() => { setStatus(s); setShowStatusPicker(false); }}
                  >
                    <Text style={[styles.pickerOptionText, status === s && styles.pickerOptionTextActive]}>
                      {s.charAt(0).toUpperCase() + s.replace('_', ' ').slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
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
            canSend={existingRFI.question.trim().length > 0}
            canSendReason={existingRFI.question.trim().length === 0 ? 'Add a question before sending.' : undefined}
          />
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
          <TouchableOpacity
            style={styles.sendToProBtn}
            onPress={openSendModal}
            activeOpacity={0.85}
            testID="rfi-send-to-pro"
          >
            <Send size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.sendToProBtnText}>Send to Architect / Engineer</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Send-to-Pro modal */}
      <Modal visible={showSendModal} transparent animationType="fade" onRequestClose={() => setShowSendModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSendModal(false)}>
          <Pressable style={styles.sendCard} onPress={() => undefined}>
            <View style={styles.sendCardHeader}>
              <Text style={styles.sendCardTitle}>Send RFI #{existingRFI?.number}</Text>
              <TouchableOpacity onPress={() => setShowSendModal(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sendCardHelper}>
              They'll get a formatted email with the question. Their reply
              comes back to your inbox — paste it into the Response field.
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
    backgroundColor: themeColors.accent,
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
    backgroundColor: themeColors.accent,
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
