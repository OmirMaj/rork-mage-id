// OAC Meeting — Owner-Architect-Contractor weekly meeting tool.
//
// One screen, two modes:
//   - List mode: shows past meetings + "New meeting" button (default
//     when navigating from project-detail).
//   - Detail mode: opens when user taps a meeting OR creates a new one.
//     Renders agenda (auto-built from project state), voice-capture,
//     AI-generated minutes, and a Distribute action that emails the
//     minutes to attendees.
//
// Mode is internal state, not separate routes — keeps the navigation
// surface flat. The visible affordance is a toolbar back button when
// in detail mode.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator, Modal, KeyboardAvoidingView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, RefreshCw, Send, CheckCircle2, Circle,
  Mic, X, Users, Calendar, AlertTriangle, AlertCircle, Check, Clock, Upload,
  Pencil, CalendarClock,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import VoiceRecorder from '@/components/VoiceRecorder';
import { sendEmail } from '@/utils/emailService';
import { transcribeAudio } from '@/utils/transcribeAudio';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { neutralInk } from '@/components/ui/ink';
import { cardSurface } from '@/components/ui';
import { showAlert } from '@/utils/alert';
import {
  buildAgendaFromProjectState, mergeAgenda, generateMinutesFromTranscript,
  collectOpenOACActions, cycleOACActionStatus, makeManualOACActionItem,
  actionDueLabel, type OpenOACAction,
} from '@/utils/oacEngine';
import DatePickerModal from '@/components/DatePickerModal';
import { formatCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor } from '@/utils/workflowPipelines';
import type {
  OACMeeting, OACAgendaItem, OACAgendaSection, OACAttendee, OACActionItem,
} from '@/types';

const SECTION_LABELS: Record<OACAgendaSection, string> = {
  safety:          'Safety',
  schedule:        'Schedule',
  rfis:            'RFIs',
  submittals:      'Submittals',
  change_orders:   'Change Orders',
  budget:          'Budget',
  decisions:       'Decisions Needed',
  action_items:    'Action Items',
  open_discussion: 'Open Discussion',
  next_meeting:    'Next Meeting',
};

// Render order for the agenda. Pulled out of the render so the order is a
// decision made once, not re-derived from object-key order on every frame.
const SECTION_ORDER = Object.keys(SECTION_LABELS) as OACAgendaSection[];

// Bucket id for agenda rows whose `section` is none of the ten above.
// Deliberately NOT an OACAgendaSection — it is a display bucket, not a section
// anything is allowed to write. (Named ...BUCKET rather than ...KEY on purpose:
// validate-storage-hygiene.ts reads every `*_KEY` const as an AsyncStorage key
// and would report this one as an unswept storage key.)
const OTHER_SECTION_BUCKET = '__other__';

/** Status words as the pill prints them — the underscore form is a storage
 *  detail, not something to show a PM mid-meeting. */
const STATUS_WORD: Record<OACActionItem['status'], string> = {
  open: 'open',
  in_progress: 'in progress',
  done: 'done',
};

function isKnownSection(section: string): section is OACAgendaSection {
  return Object.prototype.hasOwnProperty.call(SECTION_LABELS, section);
}

export interface AgendaBucket {
  key: string;
  label: string;
  items: OACAgendaItem[];
}

/**
 * Group agenda items for display so that EVERY item lands in exactly one
 * bucket.
 *
 * The screen used to render `Object.keys(SECTION_LABELS).map(sec => items
 * .filter(a => a.section === sec))`, which silently DROPS any row whose
 * `section` is outside the ten known keys — a Supabase-synced row, an older
 * fixture, an AI-invented section — while the "n of m covered" caption
 * underneath kept counting the unfiltered `agenda.length`. That mismatch is
 * what produced the audited "0 of 2 covered" above an empty agenda. Unknown
 * sections now land in a trailing "Other" bucket, so the list and the counter
 * cannot disagree.
 *
 * Invariant: `sum(bucket.items.length) === items.length`.
 */
export function groupAgendaBySection(items: OACAgendaItem[]): AgendaBucket[] {
  const buckets: AgendaBucket[] = SECTION_ORDER.map(key => ({
    key,
    label: SECTION_LABELS[key],
    items: items.filter(a => a.section === key),
  }));
  const orphans = items.filter(a => !isKnownSection(a.section as string));
  if (orphans.length > 0) {
    buckets.push({ key: OTHER_SECTION_BUCKET, label: 'Other', items: orphans });
  }
  return buckets.filter(b => b.items.length > 0);
}

// A factory, not a module constant. `info` was the DARK theme's textSecondary
// (#9AA3AD) and `Colors.warningLabel` is a getter that froze at import, so the
// old "theme-agnostic" comment was describing the bug: these are read per
// render now, and drive both a pill fill (`+ '20'`) and the icon on it.
function statusColors(t: ThemeColors) {
  return {
    info: neutralInk(t),
    warn: t.warningLabel,
    urgent: t.dangerLabel,
    done: t.successLabel,
  } as const;
}

export default function OACMeetingScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess, requiredTierFor } = useTierAccess();
  if (!canAccess('rfis_submittals')) {
    return (
      <Paywall
        visible={true}
        feature="OAC Meetings"
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
  return <OACMeetingInner />;
}

function OACMeetingInner() {
  const { colors: themeColors } = useTheme();
  const statusColor = statusColors(themeColors);
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // Reached from the sidebar (FIELD OPS ▸ OAC Meetings), Tools, universal
  // search or a deep link there is no projectId, so ToolProjectPicker sets one
  // locally (field-ticket pattern). A pick outranks the param so a STALE id in
  // the URL — deleted project, old shared link — can't make the picker inert.
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId: string }>();
  const ctx = useProjects() as any;
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = ctx.getProject?.(projectId ?? '');
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const meetings: OACMeeting[] = useMemo(() => {
    return (ctx.getOACMeetingsForProject?.(projectId ?? '') ?? []) as OACMeeting[];
  }, [ctx, projectId]);

  // Mode + active meeting state
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo<OACMeeting | null>(() => {
    if (!activeId) return null;
    return meetings.find(m => m.id === activeId) ?? null;
  }, [activeId, meetings]);

  // Loading state for AI agenda regeneration + minutes
  const [generatingAgenda, setGeneratingAgenda] = useState(false);
  const [generatingMinutes, setGeneratingMinutes] = useState(false);
  const [distributing, setDistributing] = useState(false);

  // Add-attendee modal — replaces the old iOS-only Alert.prompt chain, which
  // was a silent no-op on Android + web (Alert.prompt is undefined there). A
  // real in-app modal works on every platform CLAUDE.md supports.
  const [showAddAttendee, setShowAddAttendee] = useState(false);
  const [newAttendeeName, setNewAttendeeName] = useState('');
  const [newAttendeeEmail, setNewAttendeeEmail] = useState('');

  const handleSaveAttendee = useCallback(() => {
    if (!active) return;
    const name = newAttendeeName.trim();
    if (!name) {
      showAlert('Name required', "Enter the attendee's name.");
      return;
    }
    const email = newAttendeeEmail.trim();
    addAttendee(active, ctx, {
      id: generateUUID(),
      name,
      email: email || undefined,
      role: 'other',
    });
    setNewAttendeeName('');
    setNewAttendeeEmail('');
    setShowAddAttendee(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [active, ctx, newAttendeeName, newAttendeeEmail]);

  // ─── Build a fresh meeting ──────────────────────────────────────
  const handleNewMeeting = useCallback(() => {
    if (!project) return;
    setGeneratingAgenda(true);
    try {
      const rfis = ctx.getRFIsForProject?.(project.id) ?? [];
      const submittals = ctx.getSubmittalsForProject?.(project.id) ?? [];
      const changeOrders = ctx.getChangeOrdersForProject?.(project.id) ?? [];
      const dailyReports = ctx.getDailyReportsForProject?.(project.id) ?? [];
      const tasks = project.schedule?.tasks ?? [];
      // TODO E4: inject computeRFILatency(rfis).factLine into agenda RFI section
      const agenda = buildAgendaFromProjectState({
        project, rfis, submittals, changeOrders, dailyReports,
        schedule: project.schedule, tasks,
        // Every earlier meeting on the job. Their still-open commitments become
        // named agenda rows, so week 4 opens with what week 3 agreed instead of
        // with the PM reconstructing it from memory.
        priorMeetings: meetings,
      });
      const meeting: OACMeeting = {
        id: generateUUID(),
        projectId: project.id,
        // max(existing) + 1, not length + 1 — deleting a meeting must not
        // reissue an already-used meeting number.
        number: meetings.reduce((max, m) => Math.max(max, m.number || 0), 0) + 1,
        scheduledAt: new Date().toISOString(),
        durationMinutes: 60,
        attendees: defaultAttendeesFromProject(project),
        agenda,
        actionItems: [],
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      ctx.addOACMeeting?.(meeting);
      setActiveId(meeting.id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[OAC] New meeting failed:', err);
      showAlert('Could not create meeting', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setGeneratingAgenda(false);
    }
    // `meetings`, not `meetings.length`: the callback reads the meeting ROWS now
    // (for the carry-forward), so a length that happens to match a stale array
    // would hand the new agenda last week's action items.
  }, [project, meetings, ctx]);

  const handleRefreshAgenda = useCallback(() => {
    if (!project || !active) return;
    setGeneratingAgenda(true);
    try {
      const rfis = ctx.getRFIsForProject?.(project.id) ?? [];
      const submittals = ctx.getSubmittalsForProject?.(project.id) ?? [];
      const changeOrders = ctx.getChangeOrdersForProject?.(project.id) ?? [];
      const dailyReports = ctx.getDailyReportsForProject?.(project.id) ?? [];
      const tasks = project.schedule?.tasks ?? [];
      const fresh = buildAgendaFromProjectState({
        project, rfis, submittals, changeOrders, dailyReports,
        schedule: project.schedule, tasks,
        priorMeetings: meetings,
        // This meeting's own actions are rendered in full below; carrying them
        // onto its own agenda would print every one of them twice.
        currentMeetingId: active.id,
      });
      const merged = mergeAgenda(active.agenda, fresh);
      ctx.updateOACMeeting?.(active.id, { agenda: merged, updatedAt: new Date().toISOString() });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setGeneratingAgenda(false);
    }
  }, [project, active, meetings, ctx]);

  const handleToggleCovered = useCallback((itemId: string) => {
    if (!active) return;
    const updatedAgenda = active.agenda.map(a =>
      a.id === itemId ? { ...a, covered: !a.covered } : a
    );
    ctx.updateOACMeeting?.(active.id, { agenda: updatedAgenda, updatedAt: new Date().toISOString() });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [active, ctx]);

  const handleNoteChange = useCallback((itemId: string, note: string) => {
    if (!active) return;
    const updatedAgenda = active.agenda.map(a =>
      a.id === itemId ? { ...a, manualNote: note } : a
    );
    ctx.updateOACMeeting?.(active.id, { agenda: updatedAgenda, updatedAt: new Date().toISOString() });
  }, [active, ctx]);

  // ─── Voice → minutes ───────────────────────────────────────────
  const handleTranscript = useCallback((newTranscript: string) => {
    if (!active) return;
    // Append to existing transcript so multiple recording sessions during
    // the meeting accumulate.
    const combined = active.transcript
      ? `${active.transcript}\n\n${newTranscript}`
      : newTranscript;
    ctx.updateOACMeeting?.(active.id, { transcript: combined, updatedAt: new Date().toISOString() });
  }, [active, ctx]);

  // ─── Upload existing audio file → transcript ───────────────────
  // Many GCs already record OAC meetings on Voice Memos / Otter / Zoom.
  // Pulling an existing recording in saves them from re-recording during
  // the meeting (and gives them a path that doesn't require the modal
  // to stay foregrounded for an hour). Hits the same Rork STT endpoint
  // as the in-app voice recorder, so transcript quality is the same.
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const handleUploadAudio = useCallback(async () => {
    if (!active) return;
    if (Platform.OS === 'web') {
      showAlert('Mobile only', 'Audio file upload is only supported on the iOS / Android app.');
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];

      // Reasonable size cap. The STT endpoint handles up to ~50 MB
      // before it starts to slow down badly. We stop at 40 MB and ask
      // the user to split the file (long meetings should be chunked
      // by them anyway, since transcription accuracy degrades on
      // single multi-hour blobs).
      const MAX_BYTES = 40 * 1024 * 1024;
      if (asset.size && asset.size > MAX_BYTES) {
        const mb = (asset.size / 1024 / 1024).toFixed(1);
        showAlert(
          'File too large',
          `That file is ${mb} MB. The transcriber tops out around 40 MB. Split a long meeting into chunks (e.g. by hour) and upload them one at a time — the transcripts get appended.`,
        );
        return;
      }

      setUploadingAudio(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Read file as base64, build a multipart form, post to STT.
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const filename = asset.name || 'meeting-audio';
      const mime = asset.mimeType || 'audio/m4a';

      // Convert base64 → Blob for the multipart upload. (React Native
      // FormData accepts a { uri, name, type } shape; we use that to
      // avoid a giant base64 round-trip in JS memory.)
      // Transcribe through the MAGE STT proxy (utils/transcribeAudio) so the
      // vendor host never ships in the client bundle.
      const transcribed = await transcribeAudio({ uri: asset.uri, name: filename, type: mime });
      // Suppress the unused-var lint on base64 — held for parity with
      // any future inline-base64 path.
      void base64;
      if (!transcribed) {
        throw new Error('STT returned an empty transcript. Try a clearer recording.');
      }
      handleTranscript(transcribed);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Audio added',
        `Added ${transcribed.length.toLocaleString()} characters of transcript. Tap "Generate minutes" to draft the meeting record.`,
      );
    } catch (err) {
      console.error('[OAC] upload-audio failed', err);
      showAlert(
        'Could not transcribe',
        err instanceof Error ? err.message : 'Check the file and try again.',
      );
    } finally {
      setUploadingAudio(false);
    }
  }, [active, handleTranscript]);

  const handleGenerateMinutes = useCallback(async () => {
    if (!active || !project) return;
    if (!active.transcript || active.transcript.trim().length < 50) {
      showAlert(
        'Need a transcript first',
        'Tap the mic to capture the meeting discussion before generating minutes. Even a 60-second summary at the end works.',
      );
      return;
    }
    setGeneratingMinutes(true);
    try {
      const result = await generateMinutesFromTranscript({
        projectName: project.name,
        meetingNumber: active.number,
        meetingDate: new Date(active.scheduledAt).toLocaleDateString(),
        attendees: active.attendees.map(a => `${a.name}${a.role ? ` (${a.role})` : ''}`),
        agendaTitles: active.agenda.map(a => a.title),
        transcript: active.transcript,
      });
      // Merge AI's extracted action items into the meeting's action list.
      const newActions: OACActionItem[] = result.actionItems
        .filter(a => a.description && a.ballInCourt)
        .map(a => ({
          id: generateUUID(),
          description: a.description,
          ballInCourt: a.ballInCourt,
          dueBy: a.dueBy,
          status: 'open' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          meetingId: active.id,
          // A model's reading of "Jim will chase the landlord" is a paraphrase,
          // not a quote. The row says where it came from so the PM can check it
          // against the transcript before it starts chasing anyone.
          source: 'ai' as const,
        }));
      ctx.updateOACMeeting?.(active.id, {
        minutes: result.body,
        actionItems: [...active.actionItems, ...newActions],
        status: 'concluded',
        updatedAt: new Date().toISOString(),
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[OAC] Generate minutes failed:', err);
      showAlert('Could not generate minutes', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setGeneratingMinutes(false);
    }
  }, [active, project, ctx]);

  const handleDistribute = useCallback(async () => {
    if (!active || !project) return;
    if (!active.minutes || active.minutes.trim().length < 20) {
      showAlert('No minutes yet', 'Generate or paste minutes before distributing.');
      return;
    }
    const recipients = active.attendees.filter(a => a.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
    if (recipients.length === 0) {
      showAlert('No emails', 'Add email addresses to the attendees so they receive the minutes.');
      return;
    }
    setDistributing(true);
    try {
      const subject = `OAC Meeting #${active.number} Minutes — ${project.name}`;
      const html = buildMinutesEmailHtml({
        projectName: project.name,
        meetingNumber: active.number,
        meetingDate: new Date(active.scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        minutesMarkdown: active.minutes,
        attendees: active.attendees,
        actionItems: active.actionItems,
      });
      const log: OACMeeting['distributionLog'] = [];
      for (const r of recipients) {
        const result = await sendEmail({ to: r.email!, subject, html });
        log.push({ recipient: r.email!, sentAt: new Date().toISOString(), ok: result.success, error: result.error });
      }
      ctx.updateOACMeeting?.(active.id, {
        status: 'distributed',
        distributedAt: new Date().toISOString(),
        distributionLog: log,
        updatedAt: new Date().toISOString(),
      });
      const okCount = log.filter(l => l.ok).length;
      showAlert('Minutes distributed', `Sent to ${okCount} of ${recipients.length} attendee${recipients.length === 1 ? '' : 's'}.`);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[OAC] Distribute failed:', err);
      showAlert('Distribution failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setDistributing(false);
    }
  }, [active, project, ctx]);

  // ─── Action items — closeable, editable, and visible across meetings ──
  //
  // Before this, an OACActionItem was write-only: minted by the AI from the
  // transcript, rendered in a plain <View> with no handler, and scoped to the one
  // meeting that created it. Nothing could mark one done and nothing outside that
  // meeting ever read it. On a fit-out those rows are the ONLY record the app
  // holds for the owner, architect, landlord and building engineer, so losing
  // them loses the four parties the PM most needs to chase.

  /** Editor target: a new item on this meeting, or an existing one anywhere. */
  const [actionEditor, setActionEditor] = useState<
    | { mode: 'add' }
    | { mode: 'edit'; meetingId: string; actionId: string }
    | null
  >(null);
  const [actionDraftDesc, setActionDraftDesc] = useState('');
  const [actionDraftOwner, setActionDraftOwner] = useState('');
  const [actionDraftDue, setActionDraftDue] = useState('');
  const [showDuePicker, setShowDuePicker] = useState(false);

  /**
   * Rewrite one action inside whichever meeting owns it. Carried-forward rows are
   * shown on THIS meeting but belong to an earlier one, so the write has to be
   * addressed by meetingId — writing to `active` would silently fork a copy and
   * leave the original open forever.
   */
  const writeAction = useCallback((meetingId: string, actionId: string, mutate: (a: OACActionItem) => OACActionItem) => {
    const owner = meetings.find(m => m.id === meetingId);
    if (!owner) return;
    const next = (owner.actionItems ?? []).map(a => (a.id === actionId ? mutate(a) : a));
    ctx.updateOACMeeting?.(meetingId, { actionItems: next, updatedAt: new Date().toISOString() });
  }, [meetings, ctx]);

  const handleCycleAction = useCallback((meetingId: string, actionId: string) => {
    writeAction(meetingId, actionId, a => cycleOACActionStatus(a));
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [writeAction]);

  const openAddAction = useCallback(() => {
    setActionDraftDesc('');
    setActionDraftOwner('');
    setActionDraftDue('');
    setActionEditor({ mode: 'add' });
  }, []);

  const openEditAction = useCallback((meetingId: string, a: OACActionItem) => {
    setActionDraftDesc(a.description);
    setActionDraftOwner(a.ballInCourt);
    setActionDraftDue(a.dueBy ?? '');
    setActionEditor({ mode: 'edit', meetingId, actionId: a.id });
  }, []);

  const handleSaveAction = useCallback(() => {
    if (!active || !actionEditor) return;
    const description = actionDraftDesc.trim();
    const ballInCourt = actionDraftOwner.trim();
    if (!description || !ballInCourt) {
      showAlert(
        'Needs both halves',
        'An action item is what is owed AND who owes it. Next week\'s meeting checks both, so neither can be blank.',
      );
      return;
    }
    const dueBy = actionDraftDue.trim() || undefined;
    if (actionEditor.mode === 'add') {
      const item = makeManualOACActionItem({ description, ballInCourt, dueBy, meetingId: active.id });
      ctx.updateOACMeeting?.(active.id, {
        actionItems: [...(active.actionItems ?? []), item],
        updatedAt: new Date().toISOString(),
      });
    } else {
      writeAction(actionEditor.meetingId, actionEditor.actionId, a => ({
        ...a, description, ballInCourt, dueBy, updatedAt: new Date().toISOString(),
      }));
    }
    setActionEditor(null);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [active, actionEditor, actionDraftDesc, actionDraftOwner, actionDraftDue, ctx, writeAction]);

  /**
   * Still-open actions from the project's OTHER meetings, with the clock already
   * resolved. Listed under this meeting's own so last Thursday's commitment can be
   * closed in this Thursday's meeting — which is the whole point of a standing
   * weekly.
   */
  const carriedActions: OpenOACAction[] = useMemo(
    () => collectOpenOACActions(meetings, { excludeMeetingId: active?.id }),
    [meetings, active?.id],
  );

  /**
   * One action row. `meetingId` is the meeting that OWNS the row (not always the
   * one on screen); `origin` is present only for a carried-forward row, and
   * carries the resolved clock so the sub-line can say "3 days overdue" or
   * "no due date agreed" instead of printing a bare date and leaving the reader
   * to do the arithmetic.
   *
   * A plain render helper, not a component: it is called, never mounted, so React
   * cannot remount the TextInput-free subtree between keystrokes elsewhere.
   */
  const renderActionRow = (a: OACActionItem, meetingId: string, origin?: OpenOACAction) => {
    const meta = origin
      ? `${a.ballInCourt} · ${actionDueLabel(origin)} · OAC #${origin.meetingNumber}`
      : `${a.ballInCourt} · ${a.dueBy
          ? `Due ${formatCalendarDay(calendarDayOf(a.dueBy)) || a.dueBy}`
          : 'No due date agreed'}`;
    return (
      <View key={a.id} style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionMain}
          onPress={() => openEditAction(meetingId, a)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Edit action item: ${a.description}`}
          testID={`oac-action-edit-${a.id}`}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionDesc, a.status === 'done' && styles.actionDescDone]}>
              {a.description}
            </Text>
            <Text style={styles.actionMeta}>{meta}</Text>
            {a.source === 'ai' ? (
              // Grounding, not decoration: an extracted commitment is the model's
              // reading of the room, and the PM gets told which rows those are.
              <Text style={styles.actionSource}>From transcript</Text>
            ) : null}
          </View>
          <Pencil size={13} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionStatus,
            a.status === 'in_progress' && styles.actionStatusProgress,
            a.status === 'done' && styles.actionStatusDone,
          ]}
          onPress={() => handleCycleAction(meetingId, a.id)}
          accessibilityRole="button"
          accessibilityLabel={`Status: ${STATUS_WORD[a.status]}. Tap to advance.`}
          hitSlop={8}
          testID={`oac-action-status-${a.id}`}
        >
          <Text style={[
            styles.actionStatusText,
            a.status === 'in_progress' && styles.actionStatusTextProgress,
            a.status === 'done' && styles.actionStatusTextDone,
          ]}>
            {STATUS_WORD[a.status]}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  /**
   * The add/edit form. Extracted so it can render inside WHICHEVER card owns the
   * row being edited — a carried-forward action lives in the second card, and a
   * form that always appeared in the first one would open off-screen.
   */
  const renderActionEditor = () => (
    <View style={styles.actionEditor}>
      <Text style={styles.actionEditorTitle}>
        {actionEditor?.mode === 'add' ? 'New action item' : 'Edit action item'}
      </Text>
      <Text style={styles.attendeeFieldLabel}>What is owed *</Text>
      <TextInput
        style={styles.attendeeInput}
        value={actionDraftDesc}
        onChangeText={setActionDraftDesc}
        placeholder="e.g. Owner to approve the terrace radiant scope"
        placeholderTextColor={themeColors.textMuted}
        multiline
        testID="oac-action-desc"
      />
      <Text style={styles.attendeeFieldLabel}>Who owes it *</Text>
      <TextInput
        style={styles.attendeeInput}
        value={actionDraftOwner}
        onChangeText={setActionDraftOwner}
        // Free text on purpose: the four parties this captures — owner,
        // architect, landlord, building engineer — are not Contacts,
        // subs or users anywhere in the app. Typed as said in the room.
        placeholder="e.g. Owner / Sarah Chen, AIA / Building engineer"
        placeholderTextColor={themeColors.textMuted}
        testID="oac-action-owner"
      />
      <Text style={styles.attendeeFieldLabel}>Due by (optional)</Text>
      <TouchableOpacity
        style={styles.actionDueBtn}
        onPress={() => setShowDuePicker(true)}
        accessibilityRole="button"
        accessibilityLabel="Pick a due date"
        testID="oac-action-due"
      >
        <CalendarClock size={15} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.actionDueBtnText}>
          {actionDraftDue
            ? formatCalendarDay(calendarDayOf(actionDraftDue)) || actionDraftDue
            : 'No date agreed'}
        </Text>
        {actionDraftDue ? (
          <TouchableOpacity
            onPress={() => setActionDraftDue('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear the due date"
          >
            <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      <Text style={styles.actionDueHint}>
        Leave it blank if the room never agreed one — MAGE chases an undated item once it has sat a full week rather than inventing a deadline nobody gave.
      </Text>
      <View style={styles.actionEditorBtns}>
        <TouchableOpacity
          style={styles.actionCancelBtn}
          onPress={() => setActionEditor(null)}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.actionCancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionSaveBtn}
          onPress={handleSaveAction}
          accessibilityRole="button"
          accessibilityLabel="Save action item"
          testID="oac-action-save"
        >
          <Check size={15} color="#fff" strokeWidth={2} />
          <Text style={styles.primaryBtnText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  /** True when the open editor belongs to THIS meeting's card — a new item, or
   *  an edit of one of its own rows — rather than to the carried-forward card. */
  const editorOnThisMeeting = !!actionEditor && (actionEditor.mode === 'add' || actionEditor.meetingId === activeId);

  // The agenda, bucketed for display. Every item is in exactly one bucket —
  // see groupAgendaBySection — and the "n of m covered" caption below counts
  // the buckets rather than `active.agenda`, so the list and the count are the
  // same data by construction and cannot drift apart again.
  const agendaBuckets = useMemo(
    () => groupAgendaBySection(active?.agenda ?? []),
    [active?.agenda],
  );
  const agendaShown = useMemo(
    () => agendaBuckets.flatMap(b => b.items),
    [agendaBuckets],
  );

  if (!project) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'OAC Meetings' }} />
        <ToolProjectPicker
          toolName="OAC Meetings"
          message="An Owner-Architect-Contractor meeting keeps attendees, agenda and minutes tied to one project."
          projects={ctx.projects ?? []}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<Users size={36} color={themeColors.accent} strokeWidth={1.6} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap OAC Meetings inside the project tile grid.',
            'Add attendees, paste or dictate the agenda, then capture minutes mid-meeting.',
          ]}
        />
      </View>
    );
  }

  // Detail mode
  if (active) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setActiveId(null)} hitSlop={10} style={styles.headerBack}>
            <ChevronLeft size={22} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.headerBackText}>All meetings</Text>
          </TouchableOpacity>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{labelForStatus(active.status)}</Text>
          </View>
        </View>

        <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
          {/* Centered icon-circle hero — matches the new design language so
              the OAC meeting screen reads as a sibling of the AI screens.
              Keeps the existing eyebrow / project / date structure but
              promotes it to the premium centered-hero treatment. */}
          <View style={styles.oacHero}>
            <View style={styles.oacHeroIcon}>
              <Users size={26} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.eyebrow}>OAC Meeting #{active.number}</Text>
            <Text style={styles.oacHeroTitle}>{project.name}</Text>
            <Text style={styles.oacHeroSub}>
              {new Date(active.scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>

          {/* Lifecycle breadcrumb — shows where this meeting sits in the
              draft → scheduled → in_progress → concluded → distributed
              pipeline. The advance button is intentionally disabled once the
              meeting reaches "concluded": the final step ("distributed") is
              EARNED by handleDistribute, which actually sends emails to
              attendees and writes the distributionLog. A bare status write
              here would mark the minutes distributed without sending them. */}
          <View style={{ marginBottom: 12 }}>
            <StatusPipeline
              stages={stagesFor('oac')}
              current={visualStageFor('oac', active.status)}
              startedAt={active.createdAt}
              onAdvance={active.status === 'concluded' ? undefined : (next) => {
                ctx.updateOACMeeting?.(active.id, {
                  status: next as OACMeeting['status'],
                  updatedAt: new Date().toISOString(),
                });
              }}
            />
          </View>

          {/* Attendees */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Users size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.cardLabel}>Attendees ({active.attendees.length})</Text>
            </View>
            {active.attendees.length === 0 ? (
              <Text style={styles.emptyHint}>No attendees yet. Add the owner, architect, engineer, etc.</Text>
            ) : (
              active.attendees.map(a => (
                <View key={a.id} style={styles.attendeeRow}>
                  <Text style={styles.attendeeName}>{a.name}</Text>
                  <Text style={styles.attendeeMeta}>
                    {(a.role ?? 'other').replace('_', ' ')}{a.email ? ` · ${a.email}` : ''}
                  </Text>
                </View>
              ))
            )}
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => { setNewAttendeeName(''); setNewAttendeeEmail(''); setShowAddAttendee(true); }}
              testID="oac-add-attendee"
            >
              <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.smallBtnText}>Add attendee</Text>
            </TouchableOpacity>
          </View>

          {/* Agenda */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <MageAIMark size={16} color={themeColors.accent} />
              <Text style={styles.cardLabel}>Agenda · auto-built from project state</Text>
              <TouchableOpacity onPress={handleRefreshAgenda} disabled={generatingAgenda} hitSlop={10}>
                {generatingAgenda
                  ? <ActivityIndicator size="small" color={themeColors.accent} />
                  : <RefreshCw size={15} color={themeColors.accent} strokeWidth={1.75} />}
              </TouchableOpacity>
            </View>
            <Text style={styles.cardHelper}>Tap each item to mark covered. Add a manual note below any item.</Text>
            {agendaBuckets.map(bucket => {
              const sectionItems = bucket.items;
              return (
                <View key={bucket.key} style={styles.section}>
                  <Text style={styles.sectionLabel}>{bucket.label}</Text>
                  {sectionItems.map(item => (
                    <View key={item.id} style={styles.agendaItem}>
                      <TouchableOpacity onPress={() => handleToggleCovered(item.id)} style={styles.agendaCheck} hitSlop={6}>
                        {item.covered
                          ? <CheckCircle2 size={20} color={themeColors.success} strokeWidth={1.75} />
                          : <Circle size={20} color={themeColors.textMuted} strokeWidth={1.75} />}
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.agendaTitle, item.covered && styles.agendaTitleDone]}>
                          {item.title}
                        </Text>
                        {item.detail ? (
                          <Text style={styles.agendaDetail}>{item.detail}</Text>
                        ) : null}
                        <TextInput
                          style={styles.agendaNote}
                          value={item.manualNote ?? ''}
                          onChangeText={t => handleNoteChange(item.id, t)}
                          placeholder="Add a note..."
                          placeholderTextColor={themeColors.textMuted}
                          multiline
                        />
                      </View>
                      {item.status && item.status !== 'info' ? (
                        <View style={[styles.itemPill, { backgroundColor: statusColor[item.status] + '20' }]}>
                          {item.status === 'urgent' ? (
                            <AlertCircle size={13} color={statusColor.urgent} strokeWidth={2} />
                          ) : item.status === 'warn' ? (
                            <AlertTriangle size={13} color={statusColor.warn} strokeWidth={2} />
                          ) : item.status === 'done' ? (
                            <Check size={13} color={statusColor.done} strokeWidth={2.5} />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              );
            })}
            <Text style={styles.coveredSummary}>
              {agendaShown.filter(a => a.covered).length} of {agendaShown.length} covered
            </Text>
          </View>

          {/* Voice capture */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Mic size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.cardLabel}>Voice capture</Text>
            </View>
            <Text style={styles.cardHelper}>
              Record the meeting (or just the wrap-up summary). The AI uses the transcript to draft minutes.
            </Text>
            <VoiceRecorder
              onTranscriptReady={handleTranscript}
              title="Capture meeting discussion"
              contextLine={`OAC #${active.number} — ${project.name}`}
              suggestions={[
                "Architect, what's the response on RFI 14",
                "Owner approved CO 4 for the kitchen pendant rerun, $3,200",
                "Drywall sub will finish the master suite by Friday",
                "We need a decision on the master bath tile by next week",
              ]}
            />
            <TouchableOpacity
              onPress={handleUploadAudio}
              disabled={uploadingAudio}
              activeOpacity={0.85}
              style={[styles.uploadAudioBtn, uploadingAudio && { opacity: 0.6 }]}
              testID="oac-upload-audio"
            >
              {uploadingAudio
                ? <ActivityIndicator size="small" color={themeColors.accent} />
                : <Upload size={16} color={themeColors.accent} strokeWidth={1.75} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadAudioLabel}>
                  {uploadingAudio ? 'Transcribing audio…' : 'Upload existing recording'}
                </Text>
                <Text style={styles.uploadAudioSub}>
                  {uploadingAudio
                    ? 'This may take 30-60 seconds depending on length.'
                    : 'Voice Memos / Otter / Zoom export — m4a, mp3, wav up to 40 MB.'}
                </Text>
              </View>
            </TouchableOpacity>
            {active.transcript ? (
              <View style={styles.transcriptCard}>
                <Text style={styles.transcriptLabel}>Captured ({active.transcript.length} char{active.transcript.length === 1 ? '' : 's'})</Text>
                <Text style={styles.transcriptText} numberOfLines={6}>{active.transcript}</Text>
              </View>
            ) : null}
          </View>

          {/* Minutes */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <MageAIMark size={16} color={themeColors.accent} />
              <Text style={styles.cardLabel}>Minutes</Text>
            </View>
            {active.minutes ? (
              <>
                <TextInput
                  style={styles.minutesInput}
                  value={active.minutes}
                  onChangeText={t => ctx.updateOACMeeting?.(active.id, { minutes: t, updatedAt: new Date().toISOString() })}
                  multiline
                  textAlignVertical="top"
                  placeholderTextColor={themeColors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, distributing && styles.primaryBtnDisabled]}
                  onPress={handleDistribute}
                  disabled={distributing}
                  testID="oac-distribute"
                >
                  {distributing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Send size={16} color="#fff" strokeWidth={1.75} /><Text style={styles.primaryBtnText}>Distribute to attendees</Text></>}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, generatingMinutes && styles.primaryBtnDisabled]}
                onPress={handleGenerateMinutes}
                disabled={generatingMinutes}
                testID="oac-generate-minutes"
              >
                {generatingMinutes
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><MageAIMark size={16} color="#fff" /><Text style={styles.primaryBtnText}>Generate minutes from transcript</Text></>}
              </TouchableOpacity>
            )}
          </View>

          {/* Action items — always rendered, even empty. The card used to be
              gated on `actionItems.length > 0`, so a PM whose only producer was
              the AI merge (which needs a 50+ character recorded transcript) never
              saw it at all and had no way in. */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <CheckCircle2 size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.cardLabel}>Action items ({active.actionItems.length})</Text>
            </View>
            <Text style={styles.cardHelper}>
              Who owes what out of this meeting. Tap a status to advance it — open, in progress, done. Tap the text to edit it.
            </Text>

            {active.actionItems.length === 0 ? (
              <Text style={styles.emptyHint}>
                Nothing recorded yet. Generate minutes from a recording to pull commitments out of the transcript, or add one by hand.
              </Text>
            ) : (
              active.actionItems.map(a => renderActionRow(a, active.id))
            )}

            {editorOnThisMeeting ? renderActionEditor() : (
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={openAddAction}
                accessibilityRole="button"
                accessibilityLabel="Add action item"
                testID="oac-add-action"
              >
                <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.smallBtnText}>Add action item</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Still open from earlier meetings. These belong to another meeting
              record — the write is addressed by its id — but they are shown and
              closeable HERE, because the standing weekly is where last week's
              commitments get checked. */}
          {carriedActions.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Clock size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.cardLabel}>
                  Still open from earlier meetings ({carriedActions.length})
                </Text>
              </View>
              <Text style={styles.cardHelper}>
                Carried forward from OAC meetings on this project. Close one here and it closes in the meeting that raised it.
              </Text>
              {carriedActions.map(o => renderActionRow(o.action, o.meetingId, o))}
              {actionEditor && !editorOnThisMeeting ? renderActionEditor() : null}
            </View>
          ) : null}
        </ScrollView>

        <DatePickerModal
          visible={showDuePicker}
          value={actionDraftDue}
          title="Due by"
          // Action items are commitments for NEXT week — a due date in the future
          // is the normal case, not the exception.
          allowFuture
          onClose={() => setShowDuePicker(false)}
          onChange={iso => { setActionDraftDue(iso); setShowDuePicker(false); }}
        />

        {/* Add-attendee modal — cross-platform replacement for Alert.prompt.
            Name required, email optional (needed only for minutes distribution). */}
        <Modal visible={showAddAttendee} transparent animationType="slide" onRequestClose={() => setShowAddAttendee(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable style={styles.attendeeModalOverlay} onPress={() => setShowAddAttendee(false)}>
              <Pressable style={[styles.attendeeModalCard, { paddingBottom: insets.bottom + 20 }]} onPress={() => undefined}>
                <View style={styles.attendeeModalHeader}>
                  <Text style={styles.attendeeModalTitle}>Add attendee</Text>
                  <TouchableOpacity onPress={() => setShowAddAttendee(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.attendeeFieldLabel}>Name *</Text>
                <TextInput
                  style={styles.attendeeInput}
                  value={newAttendeeName}
                  onChangeText={setNewAttendeeName}
                  placeholder="e.g. Jane Okafor (Architect)"
                  placeholderTextColor={themeColors.textMuted}
                  autoFocus
                  testID="oac-attendee-name"
                />
                <Text style={styles.attendeeFieldLabel}>Email (optional)</Text>
                <TextInput
                  style={styles.attendeeInput}
                  value={newAttendeeEmail}
                  onChangeText={setNewAttendeeEmail}
                  placeholder="For sending minutes"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="oac-attendee-email"
                />
                <TouchableOpacity style={styles.attendeeSaveBtn} onPress={handleSaveAttendee} activeOpacity={0.85} testID="oac-attendee-save">
                  <Plus size={16} color="#fff" strokeWidth={1.75} />
                  <Text style={styles.attendeeSaveBtnText}>Add attendee</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  // List mode
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Project Meetings' }} />
      <FeatureHeader
        eyebrow="OAC Weekly"
        title="Weekly project meeting"
        subtitle="The standing call with the owner, architect, and you. We auto-build the agenda from open RFIs, change orders, and schedule slips — and record + transcribe the meeting."
        explainer={{
          term: 'OAC Meeting',
          definition: '"OAC" stands for Owner / Architect / Contractor — the three parties who meet weekly (or biweekly) on most jobs to align on progress, decisions, and changes. This is the meeting where blocking RFIs get resolved, change orders get approved, and the schedule gets re-baselined.',
          whenToUse: [
            'You\'re running a project with regular owner/architect involvement',
            'You want one place to track decisions across weeks',
            'You need a paper trail of who agreed to what, when',
          ],
        }}
      />
      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.subtitle}>{project.name} · {meetings.length} meeting{meetings.length === 1 ? '' : 's'} on file</Text>
        </View>
        <TouchableOpacity
          style={[styles.newMeetingBtn, generatingAgenda && styles.primaryBtnDisabled]}
          onPress={handleNewMeeting}
          disabled={generatingAgenda}
          testID="oac-new-meeting"
        >
          {generatingAgenda
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Plus size={16} color="#fff" strokeWidth={1.75} /><Text style={styles.primaryBtnText}>New meeting</Text></>}
        </TouchableOpacity>
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {meetings.length === 0 ? (
          <View style={styles.emptyState}>
            <Calendar size={36} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No OAC meetings yet</Text>
            <Text style={styles.emptyBody}>
              The OAC weekly is the central meeting where owner, architect, and contractor sync. Tap "New meeting" — MAGE ID auto-builds the agenda from open RFIs, submittals, change orders, and schedule slips.
            </Text>
          </View>
        ) : (
          meetings
            .slice()
            .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
            .map(m => (
              <TouchableOpacity
                key={m.id}
                style={styles.meetingRow}
                onPress={() => setActiveId(m.id)}
                activeOpacity={0.7}
                testID={`oac-meeting-${m.id}`}
              >
                <View style={[styles.meetingBadge, m.status === 'distributed' && { backgroundColor: themeColors.success + '20' }]}>
                  <Text style={[styles.meetingBadgeText, m.status === 'distributed' && { color: themeColors.success }]}>
                    #{m.number}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.meetingTitle}>
                    {new Date(m.scheduledAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  <Text style={styles.meetingMeta}>
                    {m.attendees.length} attendee{m.attendees.length === 1 ? '' : 's'} · {m.agenda.filter(a => a.covered).length}/{m.agenda.length} covered · {labelForStatus(m.status)}
                  </Text>
                </View>
                {m.status === 'distributed'
                  ? <CheckCircle2 size={18} color={themeColors.success} strokeWidth={1.75} />
                  : m.status === 'concluded'
                    ? <Clock size={18} color={Colors.warningLabel} strokeWidth={1.75} />
                    : <Circle size={18} color={themeColors.textMuted} strokeWidth={1.75} />}
              </TouchableOpacity>
            ))
        )}
      </ScrollView>
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function labelForStatus(s: OACMeeting['status']): string {
  switch (s) {
    case 'draft':        return 'Draft';
    case 'scheduled':    return 'Scheduled';
    case 'in_progress':  return 'In progress';
    case 'concluded':    return 'Concluded — ready to distribute';
    case 'distributed':  return 'Distributed';
  }
}

function defaultAttendeesFromProject(project: any): OACAttendee[] {
  // Pull whatever stakeholders the project has on file. The GC can edit.
  const out: OACAttendee[] = [];
  // Owner from the client portal invites
  const inv = project.clientPortal?.invites?.[0];
  if (inv) out.push({ id: generateUUID(), name: inv.name ?? 'Owner', email: inv.email, role: 'owner' });
  // GC from contract / settings — we keep this generic since settings live elsewhere
  return out;
}

function addAttendee(meeting: OACMeeting, ctx: any, attendee: OACAttendee) {
  ctx.updateOACMeeting?.(meeting.id, {
    attendees: [...meeting.attendees, attendee],
    updatedAt: new Date().toISOString(),
  });
}

function buildMinutesEmailHtml(opts: {
  projectName: string;
  meetingNumber: number;
  meetingDate: string;
  minutesMarkdown: string;
  attendees: OACAttendee[];
  actionItems: OACActionItem[];
}): string {
  const { projectName, meetingNumber, meetingDate, minutesMarkdown, attendees, actionItems } = opts;
  // Naive markdown → HTML for ## and -
  const html = minutesMarkdown
    .replace(/^## (.+)$/gm, '<h3 style="margin:18px 0 8px;color:#0B0D10">$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul style="padding-left:20px;margin:8px 0">$1</ul>')
    .replace(/\n\n/g, '<br/><br/>');

  const openActions = actionItems.filter(a => a.status !== 'done');
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;padding:24px;color:#111">
    <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06)">
      <div style="background:#0B0D10;color:#FF6A1A;padding:24px 28px">
        <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">OAC Meeting Minutes</div>
        <div style="font-size:20px;font-weight:800;color:#fff;margin-top:4px">${projectName}</div>
        <div style="font-size:13px;color:#a5a5b8;margin-top:6px">Meeting #${meetingNumber} · ${meetingDate}</div>
      </div>
      <div style="padding:24px 28px;font-size:14px;line-height:1.6">
        ${html}
        ${openActions.length > 0 ? `
          <h3 style="margin-top:24px;border-top:1px solid #e5e5e5;padding-top:18px">Open action items</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr style="background:#f9f9f9">
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #ddd">Action</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #ddd">Owner</th>
              <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #ddd">Due</th>
            </tr>
            ${openActions.map(a => `<tr>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">${a.description}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">${a.ballInCourt}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">${a.dueBy ? new Date(a.dueBy).toLocaleDateString() : '—'}</td>
            </tr>`).join('')}
          </table>
        ` : ''}
        <p style="margin-top:24px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
          Distributed via MAGE ID. Reply to this email with corrections — they go to the GC.
        </p>
      </div>
    </div>
  </body></html>`;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: Type.callout.fontSize, color: t.text, fontWeight: '600' as const, marginBottom: 12 },
  backBtn: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: t.accentFill, borderRadius: Tokens.radius.md },
  backBtnText: { color: '#fff', fontWeight: '700' as const },

  // List mode
  listHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
  },
  title: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 2, letterSpacing: -0.4 },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  newMeetingBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.card,
  },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: t.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: 32 },
  meetingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: t.line,
    gap: 12,
  },
  meetingBadge: {
    width: 44, height: 44, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  meetingBadgeText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: t.accent },
  meetingTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  meetingMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  // Detail mode
  detailHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  headerBackText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.accent },
  statusPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.full,
    backgroundColor: t.accent + '15',
  },
  statusPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent, letterSpacing: 0.4 },
  titleBlock: { marginBottom: 16 },
  oacHero: { alignItems: 'center' as const, gap: 4, marginBottom: 20, paddingHorizontal: 8 },
  oacHeroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: t.accent + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 8,
  },
  oacHeroTitle: { fontSize: 24, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3, textAlign: 'center' as const },
  oacHeroSub: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' as const },

  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
  cardLabel: { flex: 1, fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  cardHelper: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16, marginBottom: 8 },
  emptyHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic' as const },
  smallBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '30',
    alignSelf: 'flex-start' as const,
    marginTop: 8,
  },
  smallBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: t.accent },

  attendeeRow: { paddingVertical: 6 },
  attendeeName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  attendeeMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  section: { marginTop: 6, marginBottom: 4 },
  sectionLabel: {
    fontSize: 10, fontWeight: '800' as const, color: t.accent,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
    marginTop: 8, marginBottom: 4,
  },
  agendaItem: {
    flexDirection: 'row' as const,
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  agendaCheck: { paddingTop: 2 },
  agendaTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text, lineHeight: 19 },
  agendaTitleDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  agendaDetail: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 3, lineHeight: 16 },
  agendaNote: {
    fontSize: Type.caption1.fontSize, color: t.text,
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.xs, padding: 6, marginTop: 6,
    minHeight: 28,
  },
  itemPill: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  itemPillText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },
  coveredSummary: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, fontStyle: 'italic' as const,
    textAlign: 'right' as const, marginTop: 6,
  },

  transcriptCard: {
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.sm, padding: 10,
    marginTop: 8,
  },
  transcriptLabel: { fontSize: 10, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginBottom: 4 },
  transcriptText: { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 16 },

  minutesInput: {
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, padding: 12,
    fontSize: Type.footnote.fontSize, color: t.text,
    minHeight: 200,
    marginBottom: 12,
  },

  primaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.card, paddingVertical: 14,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: '#fff' },

  actionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
    gap: 10,
  },
  actionMain: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  actionDesc: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  actionDescDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
  actionMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  actionSource: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' as const, marginTop: 3 },
  actionStatus: {
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: Tokens.radius.full,
    // Soft/label pairs, not raw signal hues: `warningSoft` is the tint that
    // `warningLabel` is contrast-checked against in both themes
    // (validate-theme-surface-pairs).
    backgroundColor: t.warningSoft,
    borderWidth: 1, borderColor: t.warningLabel + '30',
  },
  actionStatusProgress: { backgroundColor: t.accentSoft, borderColor: t.accentLabel + '30' },
  actionStatusDone: { backgroundColor: t.successSoft, borderColor: t.successLabel + '30' },
  actionStatusText: { fontSize: 10, fontWeight: '700' as const, color: t.warningLabel, letterSpacing: 0.3, textTransform: 'uppercase' as const },
  actionStatusTextProgress: { color: t.accentLabel },
  actionStatusTextDone: { color: t.successLabel },

  // Inline add / edit form. Inline rather than a Modal because the due-date
  // picker is itself a Modal, and stacking two on iOS is the kind of thing that
  // works until it doesn't.
  actionEditor: {
    marginTop: 10, padding: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
  },
  actionEditorTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  actionDueBtn: {
    // cardSurface, not a hand-rolled surface recipe (validate-ui-adoption):
    // pad 'none' because this row sets its own asymmetric padding.
    ...cardSurface(t, { radius: 'md', pad: 'none' }),
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  actionDueBtnText: { flex: 1, fontSize: Type.subhead.fontSize, color: t.text },
  actionDueHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, marginTop: 6 },
  actionEditorBtns: { flexDirection: 'row' as const, gap: 10, marginTop: 14 },
  actionCancelBtn: {
    flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const,
    paddingVertical: 12, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  actionCancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  actionSaveBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.card,
    backgroundColor: t.accentFill,
  },

  uploadAudioBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginTop: 10, padding: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '30',
  },
  uploadAudioLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  uploadAudioSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },

  // Add-attendee modal (cross-platform)
  attendeeModalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' as const },
  attendeeModalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20,
  },
  attendeeModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  attendeeModalTitle: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text },
  attendeeFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 10, marginBottom: 6 },
  attendeeInput: {
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: Type.subhead.fontSize, color: t.text,
    borderWidth: 1, borderColor: t.line,
  },
  attendeeSaveBtn: {
    marginTop: 16,
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.card, paddingVertical: 14,
  },
  attendeeSaveBtnText: { color: '#fff', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
});
