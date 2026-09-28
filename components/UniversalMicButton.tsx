import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Platform, ScrollView, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { onlineManager } from '@tanstack/react-query';
import {
  Mic, X, FileText, FilePlus2, MessageSquare, AlertTriangle,
  CheckSquare, Briefcase, Receipt, FolderOpen, UserPlus, ListChecks, Check,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useSheetFrame } from '@/components/ui/Sheet';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { urlProjectIdFrom } from '@/utils/activeProject';
import { pickDefaultProjectId, PICK_JOB_FIRST } from '@/utils/defaultProjectId';
import { planVoiceLogWrite } from '@/utils/dailyLogCompletion';
import {
  fileReadyVoiceNotes, onVoiceNoteFilingRequested, voiceJobChips, voiceReportBase,
} from '@/utils/voiceNoteFiling';
import { voiceNoteQueueKey } from '@/utils/audioTranscribeCore';
import {
  getOwnAudioTranscribeQueue, onAudioQueueChange, processAudioTranscribeQueue, takeTranscript,
} from '@/utils/audioTranscribeQueue';
import { currentSessionUserId } from '@/utils/offlineQueue';
import { nailIt, oops } from '@/components/animations/NailItToast';
import { useProjectCapGate } from '@/hooks/useProjectCapGate';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTimeEntries } from '@/hooks/useTimeEntries';
import { todayCalendarDay } from '@/utils/calendarDate';
import VoiceRecorder from '@/components/VoiceRecorder';
import { matchFieldScheduleUpdates, parseVoiceAction, scheduleEditRouteForTranscript, type VoiceActionResult } from '@/utils/voiceActionParser';
import { sentenceCase, titleCase } from '@/utils/voiceFormParsers';
import { projectTypeFromParsedType } from '@/utils/scopeQuestions';
import { projectTypeLabel } from '@/utils/projectTypes';
import { humanizeEnum } from '@/utils/statusLabels';
import { markFirstVoiceUsed } from '@/utils/onboardingProgress';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
import ThinkingStates from '@/components/ThinkingStates';
import type { Project, RFI, ChangeOrder, PunchItem, DailyFieldReport, DFRWorkProgress } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { supabase } from '@/lib/supabase';
import {
  applyFieldTaskPatches, mergeWrittenStamps,
  scheduleWritePathForRole,
  sendFieldTaskPatches,
  type FieldTaskPatch,
} from '@/utils/fieldScheduleUpdate';
import { stampActuals, todayScheduleDay } from '@/utils/pace/stampActuals';

// Floating "speak anywhere" button. Opens a modal with the project picker
// + voice recorder; after the AI parses intent, drafts the appropriate
// in-app artifact (RFI / change-order / note) and routes the GC to it
// for review. Mounted at root layout so it's reachable from every screen.

// What to read aloud. Shown one line at a time by the capture sheet's
// rotating suggestion (VoiceCaptureModal), not as a wall above the recorder.
const VOICE_ACTION_SUGGESTIONS = [
  'Note: framing on second floor is half done.',
  'Log 3 hours framing, floor 2 drywall 80%, 40 sheets of drywall delivered.',
  'Punch list: master bath, light fixture loose.',
  'Submit an RFI to the architect about the steel beam size.',
  'Client wants the heat pump upgrade — change order for forty-five hundred.',
  'Invoice them for demolition — twenty-eight hundred lump.',
  'Submittal: light fixture cut sheets, spec twenty-six fifty-one zero zero.',
  'New lead: John Smith, 555 1234, kitchen remodel, found us on Houzz, eighty thousand.',
  'New project: Smith kitchen remodel at 123 Main, eighty thousand.',
];

interface Props {
  // When provided, the action is pinned to this project and the picker is
  // hidden. Otherwise the mic defaults to the project the user is on
  // (pickDefaultProjectId) and offers the chips.
  projectId?: string;
  // Render mode: 'fab' floats bottom-right; 'inline' is a flat button you
  // can drop into a header or row.
  variant?: 'fab' | 'inline';
  // Speed-dial integration: when true, the component renders NO floating
  // button of its own — the HomeFabStack draws the mini-FAB and opens this
  // component's modal via `openSignal`. All the recorder/parse/create logic
  // (and the modal) stay inside this component; only its trigger moves out.
  hideFab?: boolean;
  // Monotonic counter — each increment opens the voice modal. Lets a parent
  // trigger the existing `handleOpen` flow without reaching into internals.
  openSignal?: number;
  // UX A3 — what the last openVoice() asked for (BrainSurface passes
  // SearchContext's voiceRequest). A project the caller names wins over the
  // route; autoStart opens the recorder already recording (native only).
  requestedProjectId?: string;
  autoStart?: boolean;
  // Called when the sheet closes, so the opener can clear its request and
  // the next open resolves the project again.
  onClosed?: () => void;
  // UX A6 — the ONE always-mounted mic (BrainSurface) files voice notes that
  // were recorded with no signal once their transcript arrives. Every other
  // mount leaves that to it.
  filesParkedNotes?: boolean;
}

type Step = 'idle' | 'recording' | 'parsing' | 'reviewing' | 'creating';

export default function UniversalMicButton({
  projectId, variant = 'fab', hideFab = false, openSignal,
  requestedProjectId, autoStart = false, onClosed, filesParkedNotes = false,
}: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Hook order is fixed regardless of project availability, so the same
  // hooks run every render even before the user has a project. The FAB
  // visually no-ops when there's nothing to scope to.
  const router = useRouter();
  const ctx = useProjects();
  const capGate = useProjectCapGate();
  const { addManualEntry } = useTimeEntries();
  const { tier } = useSubscription();
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  // Desktop web: the voice sheet is a centred card beside the sidebar;
  // all-null on a phone.
  const fMic = useSheetFrame('form', { visible: open, animationType: 'slide' });
  const [step, setStep] = useState<Step>('idle');
  const [parsed, setParsed] = useState<VoiceActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The chip he tapped in THIS open of the sheet. Cleared on close, so the
  // next open resolves the project again (it used to latch on the first open
  // for the whole session — every later note filed to that first job).
  const [pickedProjectId, setPickedProjectId] = useState<string | undefined>(undefined);
  const [showAllJobs, setShowAllJobs] = useState(false);
  // Armed by an open that asked for autoStart; disarmed once a transcript
  // arrives or he taps Try again, so the recorder never re-opens by itself.
  const [autoStartArmed, setAutoStartArmed] = useState(false);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
  // Holds the original transcript so we can re-parse with a clarify answer appended.
  const lastTranscriptRef = useRef<string>('');

  const projectsList = useMemo(() => ctx?.projects ?? [], [ctx?.projects]);

  // A3: the project a note defaults to. The route (the same parse
  // useActiveProject uses), then his real pick, then his most recent job —
  // never "most recently updated", never projects[0]. null = nothing is
  // preselected and Create waits for a pick (PICK_JOB_FIRST).
  const pathname = usePathname();
  const globalParams = useGlobalSearchParams<{ projectId?: string | string[]; id?: string | string[] }>();
  const { activeProjectId, recentProjectIds } = useActiveProject();
  const routeProjectId = requestedProjectId ?? projectId ?? urlProjectIdFrom(pathname ?? '', globalParams ?? {});
  const defaultProjectId = useMemo(
    () => pickDefaultProjectId({ routeProjectId, activeProjectId, recentProjectIds, projects: projectsList }),
    [routeProjectId, activeProjectId, recentProjectIds, projectsList],
  );
  const resolvedProjectId = projectId ?? pickedProjectId ?? defaultProjectId ?? undefined;
  const project: Project | undefined = useMemo(
    () => (resolvedProjectId ? projectsList.find(p => p.id === resolvedProjectId) : undefined),
    [resolvedProjectId, projectsList],
  );
  const jobChips = useMemo(
    () => voiceJobChips({ projects: projectsList, recentProjectIds, defaultId: defaultProjectId, pickedId: pickedProjectId }),
    [projectsList, recentProjectIds, defaultProjectId, pickedProjectId],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setParsed(null);
    setError(null);
    setAutoStartArmed(false);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    reset();
    setPickedProjectId(undefined);
    setShowAllJobs(false);
    onClosed?.();
  }, [reset, onClosed]);

  const handleOpen = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickedProjectId(undefined);
    setShowAllJobs(false);
    setAutoStartArmed(autoStart && Platform.OS !== 'web');
    setOpen(true);
  }, [autoStart]);

  // Speed-dial trigger — when the parent HomeFabStack bumps `openSignal`,
  // run the same open flow as tapping the FAB. Guarded against the initial
  // mount / undefined so it never auto-opens on load.
  const prevOpenSignal = useRef<number | undefined>(openSignal);
  useEffect(() => {
    if (openSignal === undefined) return;
    if (prevOpenSignal.current === undefined) { prevOpenSignal.current = openSignal; return; }
    if (openSignal !== prevOpenSignal.current) {
      prevOpenSignal.current = openSignal;
      handleOpen();
    }
  }, [openSignal, handleOpen]);

  // A6: file voice notes recorded with no signal once their transcript is
  // back. Only the always-mounted mic does this (BrainSurface sets
  // filesParkedNotes), and never on the web (the web mic records nothing).
  // The latest project list and report writers are read through a ref so a
  // pass started by the queue's change feed never files against a stale list.
  const filingRef = useRef({
    projects: projectsList as readonly Project[],
    reports: (ctx?.dailyReports ?? []) as readonly DailyFieldReport[],
    add: ctx?.addDailyReport,
    update: ctx?.updateDailyReport,
  });
  filingRef.current = {
    projects: projectsList,
    reports: ctx?.dailyReports ?? [],
    add: ctx?.addDailyReport,
    update: ctx?.updateDailyReport,
  };
  const fileParkedNotes = useCallback(() => {
    void fileReadyVoiceNotes({
      readQueue: getOwnAudioTranscribeQueue,
      ownUserId: currentSessionUserId,
      takeTranscript,
      projects: () => filingRef.current.projects,
      reports: () => filingRef.current.reports,
      addDailyReport: (r) => filingRef.current.add?.(r),
      updateDailyReport: (id, patch) => filingRef.current.update?.(id, patch),
      newId: generateUUID,
      now: Date.now,
      toast: nailIt,
    });
  }, []);
  const projectsLoaded = projectsList.length > 0;
  useEffect(() => {
    if (!filesParkedNotes || Platform.OS === 'web') return;
    // Run the queue first (a reconnect is exactly when a parked clip can be
    // transcribed), then file. The drain's own change event files too; the
    // filing pass is single-flight and takeTranscript is single-consumer, so
    // the overlap can never file a clip twice.
    const drainThenFile = () => { void processAudioTranscribeQueue().finally(fileParkedNotes); };
    if (projectsLoaded) drainThenFile();
    const offQueue = onAudioQueueChange(fileParkedNotes);
    const offRequest = onVoiceNoteFilingRequested(fileParkedNotes);
    const offOnline = onlineManager.subscribe((online) => { if (online) drainThenFile(); });
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active') drainThenFile(); });
    return () => { offQueue(); offRequest(); offOnline(); appState.remove(); };
  }, [filesParkedNotes, fileParkedNotes, projectsLoaded]);

  const handleTranscript = useCallback(async (transcript: string) => {
    setAutoStartArmed(false);
    if (!transcript || transcript.trim().length === 0) {
      setError('Didn\'t catch that — try again.');
      setStep('idle');
      return;
    }
    // "Add three tasks after rough-in" is a change to the running schedule,
    // and the parser below has no kind for it — it came back as a note, an
    // RFI or a daily log, and the tasks were never added (audit W6 E8). Send
    // it to the schedule editor, seeded with his words, before a parse (or a
    // voice-capture credit) is spent; the editor meters its own AI call.
    const editRoute = scheduleEditRouteForTranscript(transcript, project);
    if (editRoute) {
      // Close the mic sheet first, then navigate: the Schedule tab opens its
      // editor as a Modal, and iOS refuses to present one while this one is
      // still dismissing (the same 350ms guard UniversalSearch uses).
      handleClose();
      setTimeout(() => router.push(editRoute as never), Platform.OS === 'ios' ? 350 : 0);
      return;
    }
    // Metered gate — a free user gets a few lifetime voice captures, then a
    // wall. checkAILimit fails open on storage error so a hiccup never costs
    // a trial or blocks value.
    const gate = await checkAILimit(tier, 'fast', 'voiceCapture');
    if (!gate.allowed) {
      setUpgradeLimit(gate);
      setStep('idle');
      return;
    }
    // Onboarding milestone — first time the user actually transcribes
    // something via voice. Drives the home-screen checklist.
    void markFirstVoiceUsed();
    setStep('parsing');
    setError(null);
    lastTranscriptRef.current = transcript;
    try {
      const result = await parseVoiceAction({ transcript, project });
      setParsed(result);
      setStep('reviewing');
      // Increment ONLY on success — a failed parse never burns a trial.
      void recordAIUsage('fast', 'voiceCapture');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[UniversalMic] parse failed', e);
      setError('MAGE couldn\'t read that. Try again.');
      setStep('idle');
    }
  }, [project, tier, handleClose, router]);

  const handleConfirm = useCallback(async () => {
    if (!parsed) return;
    // Project gate — most kinds need one. 'project' kind creates a NEW
    // project, so it's exempt. 'lead' is exempt too — leads pre-date
    // any project (a lead becomes a project once won). With no project
    // there is NO fallback (it used to file to projects[0]): the Create
    // button is disabled with the reason, and this is its belt and braces.
    if (!project && parsed.kind !== 'project' && parsed.kind !== 'lead') {
      setError(projectsList.length > 0 ? PICK_JOB_FIRST : 'No projects yet. Start with "new project:" and a name to create one.');
      return;
    }
    setStep('creating');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Inside this try, `project` is non-null for every branch except
    // 'project' (the new-project flow). Use a local non-null alias so
    // TS narrows correctly under conditional branches.
    const proj = project!;
    try {
      if (parsed.kind === 'rfi') {
        // addRFI returns the new RFI synchronously — the previous flow
        // used setTimeout + getRFIsForProject(...)[0] which read from a
        // stale closure and returned undefined, so the user landed on
        // a blank RFI screen even though the saved row had subject /
        // question filled.
        const newRfi = ctx.addRFI({
          projectId: proj.id,
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
        handleClose();
        router.push({
          pathname: '/rfi' as never,
          params: { projectId: proj.id, rfiId: newRfi.id } as never,
        });
      } else if (parsed.kind === 'co') {
        // #41 interim: only the project owner creates change orders. On a job
        // he was invited to (myRole is stamped only on shared jobs) the insert
        // is refused by RLS (20260919110000) and the offline queue drops it as
        // terminal — so a voice CO there would appear, then vanish. Say where
        // the scope belongs instead.
        if (proj.myRole) {
          setError('Your GC creates change orders on this project — log it in a daily report as a field issue.');
          setStep('reviewing');
          return;
        }
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
        const baseValue = effectiveEstimateTotal(proj);
        const projectCOs = ctx.getChangeOrdersForProject(proj.id);
        // PROVISIONAL (#141): the server's change_orders_assign_number trigger
        // assigns the real number on insert (keeping this one when it is free).
        // `|| 0`: a CO with no number used to make Math.max return NaN.
        const nextNumber = projectCOs.reduce((m, c) => Math.max(m, c.number || 0), 0) + 1;
        const newId = generateUUID();
        const now = new Date().toISOString();
        ctx.addChangeOrder({
          id: newId,
          projectId: proj.id,
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
          // The CO screen reads `coId`, not `id` — with `id` it opened a BLANK
          // "New Change Order" (and, with no projectId, the project picker
          // first) instead of the one just drafted. projectId is passed too so
          // the editor lands on the right job even before the CO is in state.
          router.push({ pathname: '/change-order', params: { coId: newId, projectId: proj.id } });
        }, 250);
      } else if (parsed.kind === 'note') {
        // A4: a note adds a timestamped line to TODAY's unsent report for the
        // project (planVoiceLogWrite). With none — or only a sent one, which
        // voice never edits — it starts a draft marked origin 'voice', so the
        // day still reads "voice note only · finish it" until he saves it.
        const line = (parsed.noteBody || '').trim();
        if (!line) {
          setError('Didn\'t catch a note to add. Try again.');
          setStep('reviewing');
          return;
        }
        const at = new Date();
        const w = planVoiceLogWrite({ reports: ctx.dailyReports, projectId: proj.id, at, line });
        if (w.kind === 'append') {
          ctx.updateDailyReport(w.reportId, w.patch);
        } else {
          ctx.addDailyReport({
            ...voiceReportBase({ id: generateUUID(), projectId: proj.id, at, nowISO: at.toISOString() }),
            ...w.seed,
          });
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        nailIt(`Added to today's report · ${proj.name}`);
        handleClose();
      } else if (parsed.kind === 'punch') {
        // Punch item: save inline (no extra screen), so a GC walking
        // the site can dictate punches in succession without leaving
        // the FAB. Land in the project's punch list. Description and
        // location go through sentenceCase / titleCase so the punch
        // list rows read like proper short-form titles ("Master Bath
        // — Light fixture loose") instead of the raw lowercase
        // transcription.
        const newId = generateUUID();
        const now = new Date().toISOString();
        // Typed, no cast (#3): the cast hid that dueDate and assignedSub were
        // missing — punch_items.due_date is NOT NULL, so the server refused
        // every voice punch and the next refetch took it off his list. It also
        // hid a `trade` key PunchItem has no column for (never stored).
        // Location (#56): the spoken room, or '' — never an 'Unspecified' that
        // reads like a real room on the export, the filters and the sub portal.
        const spokenRoom = (parsed.punchLocation || '').trim();
        const punch: PunchItem = {
          id: newId,
          projectId: proj.id,
          description: sentenceCase(parsed.description || 'Voice-captured item'),
          location: spokenRoom ? titleCase(spokenRoom) : '',
          assignedSub: '',
          dueDate: '',
          priority: parsed.punchPriority || 'medium',
          status: 'open',
          createdAt: now,
          updatedAt: now,
        };
        ctx.addPunchItem(punch);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        handleClose();
        router.push({ pathname: '/punch-list' as never, params: { projectId: proj.id } as never });
      } else if (parsed.kind === 'project') {
        // New project — create immediately and route into project-detail
        // so the GC can review/extend. MUST populate every required
        // Project field (squareFootage, quality, description, estimate,
        // schedule) — missing ones used to crash project-detail with
        // "Cannot read property 'charAt' of undefined" because downstream
        // components called .charAt on undefined string fields. Mirrors
        // the standard "Create Project" payload from the home tab.
        // #57 / #156 (CONTRACT 5): the free plan's one-job cap. The server
        // refuses a second job's insert, so a voice-drafted job past the cap
        // would live on this phone only — explain and offer the upgrade.
        const voiceName = parsed.projectName || 'Voice-drafted project';
        if (!capGate.canCreate(voiceName)) {
          handleClose();
          capGate.explainAndOfferUpgrade();
          return;
        }
        const newId = generateUUID();
        const now = new Date().toISOString();
        // Q6: an id, a label or his words ("HVAC changeout") → a real type,
        // with his words kept for Other. Nothing said → renovation, as before.
        const voiceType = projectTypeFromParsedType(parsed.projectType) ?? { type: 'renovation' as const };
        ctx.addProject({
          id: newId,
          name: voiceName,
          type: voiceType.type,
          ...(voiceType.projectTypeOther ? { projectTypeOther: voiceType.projectTypeOther } : {}),
          // Blank = no address. 'United States' geocoded to the Kansas
          // centroid and printed on every document as if it were a jobsite.
          location: parsed.projectLocation || '',
          squareFootage: 0,
          quality: 'standard',
          description: parsed.reasoning || '',
          status: 'draft',
          estimate: null,
          schedule: null,
          targetBudget: parsed.targetBudget > 0 ? { amount: parsed.targetBudget, isFromClient: false } : undefined,
          collaborators: [],
          createdAt: now,
          updatedAt: now,
        } as never);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        handleClose();
        router.push({ pathname: '/project-detail' as never, params: { id: newId } as never });
      } else if (parsed.kind === 'invoice') {
        // Invoice: navigate to the invoice form with prefilled line
        // items. We pass them as a JSON-encoded URL param so the form
        // can pre-seed without a prior save (similar to the existing
        // selections-overage prefill pattern in change-order).
        handleClose();
        router.push({
          pathname: '/invoice' as never,
          params: {
            projectId: proj.id,
            prefillLines: JSON.stringify(parsed.invoiceLineItems ?? []),
            prefillNotes: parsed.invoiceNotes ?? '',
          } as never,
        });
      } else if (parsed.kind === 'lead') {
        // New CRM lead — homeowner inquiry. Saves immediately, lands in
        // /lead-detail so the GC can review/log first contact. Source
        // defaults to 'other' if AI didn't catch one.
        const newLead = ctx.addLead({
          name: titleCase(parsed.leadName || 'Voice-captured lead'),
          phone: parsed.leadPhone || undefined,
          email: parsed.leadEmail || undefined,
          address: parsed.leadAddress || undefined,
          projectType: parsed.leadProjectType || undefined,
          scope: parsed.leadScope || undefined,
          budgetMin: parsed.leadBudgetMin > 0 ? parsed.leadBudgetMin : undefined,
          budgetMax: parsed.leadBudgetMax > 0 ? parsed.leadBudgetMax : undefined,
          timeline: parsed.leadTimeline || undefined,
          source: parsed.leadSource || 'other',
          sourceOther: parsed.leadSourceOther || undefined,
          stage: 'new',
          score: parsed.leadScore > 0 ? parsed.leadScore : undefined,
          scoreReason: parsed.leadScoreReason || undefined,
          touches: [],
        });
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        handleClose();
        router.push({ pathname: '/lead-detail' as never, params: { leadId: newLead.id } as never });
      } else if (parsed.kind === 'field_update') {
        // The differentiator: ONE spoken log fans out to several systems —
        // time entries, schedule progress, and a draft daily report that
        // captures the work + materials. Everything created is a draft /
        // reversible edit; the GC reviews the daily-report draft later.
        const now = new Date().toISOString();
        // The LOCAL day (field-ops #9). The ISO string's date half is the UTC
        // day: "2 hours punch" said at 6 pm Friday Pacific was filed as a
        // Saturday 8 am shift, and the daily-report draft below as Saturday's.
        const today = todayCalendarDay();
        const company = ctx.settings?.branding?.companyName ?? '';
        // What did NOT land. Said in the toast — a failure keeps a visible
        // reason (the old alert listed it; a success toast alone would hide it).
        const summaryParts: string[] = [];

        // 1) Time — one completed entry per trade whose hours were stated.
        const timeEntries = (parsed.fieldTimeEntries ?? []).filter(t => (t.hours ?? 0) > 0);
        for (const te of timeEntries) {
          addManualEntry({
            projectId: proj.id,
            projectName: proj.name,
            workerName: company || 'Me',
            trade: te.trade || 'General',
            hours: te.hours,
            notes: te.notes || undefined,
            date: today,
          });
        }

        // 2) Schedule — each spoken update lands on ONE task. The old loop
        // walked the tasks and gave each the first update whose name it
        // contained, so "drywall is done" marked Drywall hang, tape AND finish
        // done (E8). matchFieldScheduleUpdates matches update-by-update and
        // refuses an ambiguous name; the parser already said which ones.
        const schedule = proj.schedule;
        const workProgress: { taskId: string; taskName: string; phase: string; pct: number }[] = [];
        if (schedule && (parsed.fieldScheduleUpdates ?? []).length > 0) {
          const matchedByTask = new Map(
            matchFieldScheduleUpdates(schedule.tasks, parsed.fieldScheduleUpdates).matched.map(m => [m.taskId, m] as const),
          );
          const updatedTasks = schedule.tasks.map(t => {
            const match = matchedByTask.get(t.id);
            if (!match) return t;
            const pct = match.pct;
            workProgress.push({ taskId: t.id, taskName: t.title, phase: t.phase, pct });
            const status: typeof t.status = pct >= 100 ? 'done' : pct > 0 ? 'in_progress' : t.status;
            // As-built actuals on a status change (#89), the Schedule tab's and
            // the daily report's rule — "framing 100%" used to record no
            // actual finish, so Schedule Pro's Reflow from actuals ignored it.
            const stamp = status !== t.status
              ? stampActuals(t, status, todayScheduleDay(schedule.startDate), now, { retroStartFromPlanned: false })
              : {};
            return { ...t, progress: pct, status, ...stamp };
          });
          if (workProgress.length > 0) {
            // Same routing as QuickFieldUpdate (#25). The row PATCH is refused
            // by RLS for a field collaborator, so on field access the progress
            // goes through the field RPC; on view-only it is refused up front.
            // Before this the mic said "N tasks updated" either way, and any
            // change the DFR ratchet ignores (a lowered %, a 0% status) was
            // silently lost on the next reload.
            const writePath = scheduleWritePathForRole(proj.myRole);
            if (writePath === 'none') {
              summaryParts.push(`schedule not updated — you have view-only access to ${proj.name}`);
            } else if (writePath === 'field_rpc') {
              const patches: FieldTaskPatch[] = updatedTasks
                .filter(t => workProgress.some(w => w.taskId === t.id))
                .map((t) => {
                  // The actuals ride to the field RPC too — without them the
                  // stamp above would never reach the server. A cleared actual
                  // (reopening a finished task) is sent as null, the RPC's
                  // "remove"; JSON would drop an undefined.
                  const before = schedule.tasks.find(x => x.id === t.id);
                  const patch: Record<string, unknown> = { id: t.id, progress: t.progress, status: t.status };
                  for (const k of ['actualStartDate', 'actualEndDate', 'actualStartDay', 'actualEndDay'] as const) {
                    if (before && before[k] !== t[k]) patch[k] = t[k] ?? null;
                  }
                  return patch as FieldTaskPatch;
                });
              const sent = await sendFieldTaskPatches(supabase, proj.id, patches);
              if (!sent.ok) {
                summaryParts.push(`schedule not updated — ${sent.message}`);
              } else {
                // Local copy = what the server now holds (see QuickFieldUpdate).
                ctx.updateProject(proj.id, {
                  // With the stamps the RPC wrote (#87).
                  schedule: { ...schedule, tasks: mergeWrittenStamps(applyFieldTaskPatches(schedule.tasks, patches), sent.stamps), updatedAt: new Date().toISOString() },
                });
                if (sent.missing.length > 0) {
                  summaryParts.push(sent.missing.length === 1
                    ? '1 task is no longer on the schedule'
                    : `${sent.missing.length} tasks are no longer on the schedule`);
                }
              }
            } else {
              ctx.updateProject(proj.id, { schedule: { ...schedule, tasks: updatedTasks } });
            }
          }
        }

        // 3) Daily report draft — today's, the connective record for the whole
        // log. A4: appended to today's unsent report when there is one (crew and
        // materials merged in without duplicating a row), else a new draft
        // marked origin 'voice'. A sent report is never edited by voice.
        const materials = parsed.fieldMaterials ?? [];
        const workPerformed = parsed.fieldWorkPerformed
          || workProgress.map(w => `${w.taskName} ${w.pct}%`).join(', ')
          || 'Field update';
        const manpower = timeEntries.map(te => ({
          id: generateUUID(),
          trade: te.trade || 'General',
          company,
          headcount: 1,
          hoursWorked: te.hours,
        }));
        const progress: DFRWorkProgress[] = workProgress;
        const w = planVoiceLogWrite({ reports: ctx.dailyReports, projectId: proj.id, at: now, line: workPerformed, manpower, materials });
        if (w.kind === 'append') {
          const target = ctx.dailyReports.find(r => r.id === w.reportId);
          const heardTasks = new Set(progress.map(p => p.taskId));
          const mergedProgress = progress.length > 0
            ? [...(target?.workProgress ?? []).filter(p => !heardTasks.has(p.taskId)), ...progress]
            : undefined;
          ctx.updateDailyReport(w.reportId, { ...w.patch, ...(mergedProgress ? { workProgress: mergedProgress } : {}) });
        } else {
          const report: DailyFieldReport = {
            ...voiceReportBase({ id: generateUUID(), projectId: proj.id, at: new Date(now), nowISO: now }),
            ...w.seed,
            workProgress: progress.length > 0 ? progress : undefined,
          };
          ctx.addDailyReport(report);
        }

        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (summaryParts.length > 0) {
          const said = summaryParts.join('. ');
          oops(`Added to today's report. ${said.charAt(0).toUpperCase()}${said.slice(1)}.`);
        } else {
          nailIt(`Added to today's report · ${proj.name}`);
        }
        handleClose();
      } else if (parsed.kind === 'submittal') {
        // Submittal: same pattern — route to the form with prefills,
        // then the user reviews + saves.
        handleClose();
        router.push({
          pathname: '/submittal' as never,
          params: {
            projectId: proj.id,
            prefillTitle: parsed.submittalTitle ?? '',
            prefillSpecSection: parsed.submittalSpecSection ?? '',
            prefillSubmittedBy: parsed.submittalSubmittedBy ?? '',
            prefillRequiredDate: parsed.submittalRequiredDate ?? '',
          } as never,
        });
      } else {
        setError('Not sure what to draft. Start with the action, like "RFI for the beam size", "change order for the heat pump", "punch list:", "new project:", "invoice for demolition" or "submittal:".');
        setStep('reviewing');
      }
    } catch (e) {
      console.warn('[UniversalMic] create failed', e);
      setError('Couldn\'t save that — try again.');
      setStep('reviewing');
    }
  }, [parsed, project, projectsList.length, ctx, router, handleClose, capGate, addManualEntry]);

  const KindIcon = parsed?.kind === 'rfi' ? MessageSquare
    : parsed?.kind === 'co' ? FilePlus2
    : parsed?.kind === 'note' ? FileText
    : parsed?.kind === 'punch' ? CheckSquare
    : parsed?.kind === 'project' ? Briefcase
    : parsed?.kind === 'invoice' ? Receipt
    : parsed?.kind === 'submittal' ? FolderOpen
    : parsed?.kind === 'lead' ? UserPlus
    : parsed?.kind === 'field_update' ? ListChecks
    : AlertTriangle;
  const kindLabel = parsed?.kind === 'rfi' ? 'Request for information'
    : parsed?.kind === 'co' ? 'Change order draft'
    : parsed?.kind === 'note' ? 'Field note'
    : parsed?.kind === 'punch' ? 'Punch item'
    : parsed?.kind === 'project' ? 'New project'
    : parsed?.kind === 'invoice' ? 'Invoice draft'
    : parsed?.kind === 'submittal' ? 'Submittal'
    : parsed?.kind === 'lead' ? 'New lead'
    : parsed?.kind === 'field_update' ? 'Field update'
    : 'Not sure yet';
  const kindCTA = parsed?.kind === 'rfi' ? 'RFI'
    : parsed?.kind === 'co' ? 'change order'
    : parsed?.kind === 'note' ? 'note'
    : parsed?.kind === 'punch' ? 'punch item'
    : parsed?.kind === 'project' ? 'project'
    : parsed?.kind === 'invoice' ? 'invoice'
    : parsed?.kind === 'submittal' ? 'submittal'
    : parsed?.kind === 'lead' ? 'lead'
    : parsed?.kind === 'field_update' ? 'field update'
    : '';

  // A3: with no project resolved, Create is disabled and says why — except
  // for the two kinds that make their own (a new project, a new lead).
  const createBlocked = !!parsed && parsed.kind !== 'project' && parsed.kind !== 'lead' && parsed.kind !== 'unsure' && !project;

  // Hide self when there's nothing to scope to. Done in render (not via an
  // earlier return) so all hooks above run unconditionally on every render.
  const shouldRender = projectsList.length > 0;

  return (
    <>
      {shouldRender && variant === 'fab' && !hideFab && (
        <TouchableOpacity
          // Stack ABOVE the AICopilot FAB which sits at insets.bottom + 70
          // with size 52. Add gap so the two don't touch.
          //
          // Audit-2026-05-21 W12 (LOW): on web there's no tab-bar safe-
          // area, so insets.bottom is usually 0 and the FABs hover too
          // close to the bottom of the viewport, overlapping the last
          // ~100px of scrollable content. Push both FABs up by 48px on
          // web to clear typical content edges. The user can still scroll
          // to see anything obscured.
          style={[styles.fab, { bottom: insets.bottom + 70 + 52 + 12 + (Platform.OS === 'web' ? 48 : 0) }]}
          onPress={handleOpen}
          activeOpacity={0.85}
          accessibilityLabel="Voice action"
          testID="universal-mic-fab"
        >
          <Mic size={20} color="#FFF" strokeWidth={1.75} />
        </TouchableOpacity>
      )}
      {shouldRender && variant === 'inline' && (
        <TouchableOpacity
          style={styles.inlineBtn}
          onPress={handleOpen}
          activeOpacity={0.85}
          testID="universal-mic-inline"
        >
          <Mic size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.inlineBtnText}>Voice action</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType={fMic.animationType} onRequestClose={handleClose}>
        <View style={[styles.modalBackdrop, fMic.overlay]}>
          <View style={[styles.modalCard, fMic.card]}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalEyebrow}>Draft by voice</Text>
                <Text style={styles.modalTitle}>Voice action</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            {/* Project picker — render any time the user hasn't pinned
                a projectId via prop AND there are projects to choose
                from. Previously gated on activeProjects.length > 1
                which meant a single project still couldn't be re-
                picked, and no projects gave a confusing dead-end. */}
            {/* A3 chips: his pick, the default, his recent jobs — and "More…"
                with every open project, so a fifth project is reachable. */}
            {!projectId && jobChips.all.length > 0 && (
              <View style={styles.pickerWrap}>
                <Text style={styles.pickerLabel}>Project</Text>
                <View style={styles.pickerRow}>
                  {jobChips.chips.map(p => {
                    const on = project?.id === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.pickerChip, on && styles.pickerChipActive]}
                        onPress={() => { setPickedProjectId(p.id); setShowAllJobs(false); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        testID={`voice-job-chip-${p.id}`}
                      >
                        <Text style={[styles.pickerChipText, on && styles.pickerChipTextActive]} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {jobChips.hasMore && (
                    <TouchableOpacity
                      style={styles.pickerChip}
                      onPress={() => setShowAllJobs(v => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showAllJobs }}
                      accessibilityLabel="More projects"
                      testID="voice-job-more"
                    >
                      <Text style={styles.pickerChipText}>More…</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {showAllJobs && (
                  <ScrollView style={styles.allJobs} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {jobChips.all.map(p => {
                      const on = project?.id === p.id;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.allJobRow}
                          onPress={() => { setPickedProjectId(p.id); setShowAllJobs(false); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          testID={`voice-job-row-${p.id}`}
                        >
                          <Text style={[styles.allJobText, on && styles.projectHintEmph]} numberOfLines={1}>{p.name}</Text>
                          {on ? <Check size={16} color={themeColors.accent} strokeWidth={2} /> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}
            {project && (
              <Text style={styles.projectHint}>Drafting on <Text style={styles.projectHintEmph}>{project.name}</Text></Text>
            )}
            {!project && projectsList.length === 0 && (
              <Text style={styles.projectHintWarn}>No projects yet — say &quot;new project: Smith kitchen at 123 Main, eighty thousand&quot; to create one.</Text>
            )}
            {!project && !projectId && projectsList.length > 0 && jobChips.all.length > 0 && (
              <Text style={styles.projectHintWarn}>{PICK_JOB_FIRST}</Text>
            )}
            {!project && !projectId && projectsList.length > 0 && jobChips.all.length === 0 && (
              <Text style={styles.projectHintWarn}>No open projects. Say &quot;new project:&quot; and a name to start one.</Text>
            )}

            {/* States — voice recorder is available even without a project,
                so the GC can dictate "new project: ..." to create one.
                For other kinds, the project gate fires inside handleConfirm. */}
            {step === 'idle' && (
              <View style={styles.bodyWrap}>
                {/* One rotating "Try saying" line lives in the capture sheet
                    (VOICE_ACTION_SUGGESTIONS), not a nine-line wall here.
                    The queue key names the project, so a note recorded with
                    no signal still files to it when the words come back. */}
                <VoiceRecorder
                  onTranscriptReady={handleTranscript}
                  isLoading={false}
                  suggestions={VOICE_ACTION_SUGGESTIONS}
                  contextLine={project?.name}
                  queueKey={project ? voiceNoteQueueKey(project.id) : undefined}
                  autoStart={autoStartArmed}
                />
                {error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            )}

            {(step === 'parsing' || step === 'creating') && (
              <View style={styles.parsingWrap}>
                {step === 'parsing' ? (
                  <ThinkingStates
                    active
                    steps={[
                      'Reading what you said…',
                      'Matching it to your projects…',
                      'Writing the draft…',
                    ]}
                  />
                ) : (
                  <>
                    <ActivityIndicator size="small" color={themeColors.accent} />
                    <Text style={styles.parsingText}>Saving your draft…</Text>
                  </>
                )}
              </View>
            )}

            {step === 'reviewing' && parsed && (
              <View style={styles.bodyWrap}>
                <View style={styles.previewCard}>
                  <View style={styles.previewHead}>
                    <View style={[styles.previewIconWrap, parsed.kind === 'unsure' && { backgroundColor: '#FFF4E0' }]}>
                      <KindIcon size={18} color={parsed.kind === 'unsure' ? '#C26A00' : themeColors.accent} />
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
                        <PreviewField label="Priority" value={humanizeEnum(parsed.priority || 'normal')} small />
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
                            {/* A price he never said is filed as $0 (voiceActionParser
                                groundVoicePrices) — say so rather than show "$0". */}
                            <Text style={styles.lineItemAmt}>{li.priceStated ? `$${(li.unitPrice * li.quantity).toLocaleString()}` : 'No price said'}</Text>
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

                  {parsed.kind === 'punch' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Issue" value={parsed.description || '—'} multi />
                      <View style={styles.previewMetaRow}>
                        {/* No Trade field: a punch item has no trade column, so
                            showing one here promised something never saved. */}
                        <PreviewField label="Location" value={parsed.punchLocation?.trim() ? parsed.punchLocation : 'No room given'} small />
                        <PreviewField label="Priority" value={humanizeEnum(parsed.punchPriority || 'medium')} small />
                      </View>
                    </View>
                  )}

                  {parsed.kind === 'project' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Project name" value={parsed.projectName || '—'} />
                      <View style={styles.previewMetaRow}>
                        <PreviewField label="Type" value={projectTypeLabel(projectTypeFromParsedType(parsed.projectType) ?? { type: 'renovation' })} small />
                        <PreviewField label="Location" value={parsed.projectLocation || '—'} small />
                        <PreviewField label="Budget" value={parsed.targetBudget > 0 ? `$${parsed.targetBudget.toLocaleString()}` : '—'} small />
                      </View>
                    </View>
                  )}

                  {parsed.kind === 'invoice' && (
                    <View style={styles.previewBody}>
                      {parsed.invoiceLineItems && parsed.invoiceLineItems.length > 0 ? (
                        parsed.invoiceLineItems.map((li, i) => (
                          <View key={i} style={styles.lineItemRow}>
                            <Text style={styles.lineItemName} numberOfLines={1}>{li.name || '—'}</Text>
                            <Text style={styles.lineItemQty}>{li.quantity} {li.unit}</Text>
                            {/* A price he never said is filed as $0 (voiceActionParser
                                groundVoicePrices) — say so rather than show "$0". */}
                            <Text style={styles.lineItemAmt}>{li.priceStated ? `$${(li.unitPrice * li.quantity).toLocaleString()}` : 'No price said'}</Text>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.previewNote}>No line items detected — you can add them on the next screen.</Text>
                      )}
                      {!!parsed.invoiceNotes && <PreviewField label="Notes" value={parsed.invoiceNotes} multi />}
                    </View>
                  )}

                  {parsed.kind === 'submittal' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Title" value={parsed.submittalTitle || '—'} multi />
                      <View style={styles.previewMetaRow}>
                        <PreviewField label="Spec section" value={parsed.submittalSpecSection || '—'} small />
                        <PreviewField label="Submitted by" value={parsed.submittalSubmittedBy || '—'} small />
                        <PreviewField label="Required by" value={parsed.submittalRequiredDate || '—'} small />
                      </View>
                    </View>
                  )}

                  {parsed.kind === 'lead' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Name" value={parsed.leadName || '—'} />
                      <View style={styles.previewMetaRow}>
                        {!!parsed.leadPhone && <PreviewField label="Phone" value={parsed.leadPhone} small />}
                        {!!parsed.leadEmail && <PreviewField label="Email" value={parsed.leadEmail} small />}
                      </View>
                      {!!parsed.leadProjectType && <PreviewField label="Project" value={parsed.leadProjectType} />}
                      <View style={styles.previewMetaRow}>
                        <PreviewField label="Source" value={parsed.leadSource} small />
                        <PreviewField label="Budget" value={parsed.leadBudgetMax > 0 ? `$${parsed.leadBudgetMax.toLocaleString()}` : (parsed.leadBudgetMin > 0 ? `$${parsed.leadBudgetMin.toLocaleString()}` : '—')} small />
                        <PreviewField label="Score" value={parsed.leadScore > 0 ? `${parsed.leadScore}/10` : '—'} small />
                      </View>
                      {!!parsed.leadScoreReason && <Text style={styles.previewNote}>{parsed.leadScoreReason}</Text>}
                    </View>
                  )}

                  {parsed.kind === 'field_update' && (
                    <View style={styles.previewBody}>
                      {!!parsed.fieldWorkPerformed && <PreviewField label="Work performed" value={parsed.fieldWorkPerformed} multi />}
                      {(parsed.fieldTimeEntries ?? []).filter(t => (t.hours ?? 0) > 0).map((t, i) => (
                        <View key={`t${i}`} style={styles.lineItemRow}>
                          <Text style={styles.lineItemName} numberOfLines={1}>Time · {t.trade || 'General'}</Text>
                          <Text style={styles.lineItemAmt}>{t.hours}h</Text>
                        </View>
                      ))}
                      {(parsed.fieldScheduleUpdates ?? []).filter(u => !!u.taskName).map((u, i) => (
                        <View key={`s${i}`} style={styles.lineItemRow}>
                          <Text style={styles.lineItemName} numberOfLines={1}>{u.taskName}</Text>
                          <Text style={styles.lineItemAmt}>{Math.round(u.progressPercent)}%</Text>
                        </View>
                      ))}
                      {(parsed.fieldMaterials ?? []).length > 0 && (
                        <PreviewField label="Materials" value={(parsed.fieldMaterials ?? []).join(', ')} multi />
                      )}
                      {!parsed.fieldWorkPerformed
                        && (parsed.fieldTimeEntries ?? []).length === 0
                        && (parsed.fieldScheduleUpdates ?? []).length === 0
                        && (parsed.fieldMaterials ?? []).length === 0 && (
                        <Text style={styles.previewNote}>Nothing detected to log — try again with hours, task progress, or materials.</Text>
                      )}
                    </View>
                  )}

                  {parsed.kind === 'unsure' && (
                    <View style={styles.previewBody}>
                      {parsed.clarifyQuestion ? (
                        <>
                          <Text style={styles.unsureText}>{parsed.clarifyQuestion}</Text>
                          <View style={styles.clarifyChipRow}>
                            {/* A few common one-word answers as quick-tap chips */}
                            {['Invoice', 'Change order', 'Note', 'RFI'].map(answer => (
                              <TouchableOpacity
                                key={answer}
                                style={styles.clarifyChip}
                                onPress={async () => {
                                  const combined = `${lastTranscriptRef.current} — ${answer}`;
                                  // Same front door as the first parse: an
                                  // add-tasks request goes to the editor.
                                  const editRoute = scheduleEditRouteForTranscript(combined, project);
                                  if (editRoute) {
                                    handleClose();
                                    setTimeout(() => router.push(editRoute as never), Platform.OS === 'ios' ? 350 : 0);
                                    return;
                                  }
                                  setStep('parsing');
                                  setError(null);
                                  try {
                                    const result = await parseVoiceAction({ transcript: combined, project });
                                    setParsed(result);
                                    setStep('reviewing');
                                  } catch {
                                    setError('MAGE couldn\'t read that. Try again.');
                                    setStep('reviewing');
                                  }
                                }}
                              >
                                <Text style={styles.clarifyChipText}>{answer}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </>
                      ) : (
                        <Text style={styles.unsureText}>
                          Not enough detail to know what you want. Tap &quot;Try again&quot; and start with the action, like &quot;submit an RFI&quot;, &quot;create a change order&quot; or &quot;note:&quot;.
                        </Text>
                      )}
                    </View>
                  )}
                </View>

                <View style={styles.ctaRow}>
                  <TouchableOpacity style={styles.ctaSecondary} onPress={reset}>
                    <Text style={styles.ctaSecondaryText}>Try again</Text>
                  </TouchableOpacity>
                  {parsed.kind !== 'unsure' && (
                    <TouchableOpacity
                      style={[styles.ctaPrimary, createBlocked && styles.ctaPrimaryBlocked]}
                      onPress={handleConfirm}
                      disabled={createBlocked}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: createBlocked }}
                      accessibilityHint={createBlocked ? PICK_JOB_FIRST : undefined}
                      testID="voice-create"
                    >
                      <MageAIMark size={14} color="#FFF" />
                      <Text style={styles.ctaPrimaryText}>
                        Create {kindCTA}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {createBlocked && !error && <Text style={styles.blockedText}>{PICK_JOB_FIRST}</Text>}
                {error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            )}
          </View>
        </View>
      </Modal>
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="Voice capture"
        onClose={() => setUpgradeLimit(null)}
      />
    </>
  );
}

function PreviewField({ label, value, multi, small }: { label: string; value: string; multi?: boolean; small?: boolean }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  fab: {
    position: 'absolute', right: 20,
    width: 46, height: 46, borderRadius: 23,
    // Ink/black to clearly differentiate from the amber AICopilot below.
    backgroundColor: t.text,
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
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '15', borderWidth: 1, borderColor: t.accent + '40',
  },
  inlineBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(11,13,16,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 22, paddingBottom: 36,
    minHeight: 360,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16 },
  modalEyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  modalTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginTop: 4, letterSpacing: -0.4 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 9, borderWidth: 1, borderColor: t.line,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },

  pickerWrap: { marginBottom: 12 },
  pickerLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  pickerRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pickerChip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    maxWidth: 220,
  },
  pickerChipActive: { backgroundColor: t.text, borderColor: t.text },
  pickerChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.text },
  pickerChipTextActive: { color: '#FFF' },
  projectHint: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginBottom: 12 },
  projectHintEmph: { color: t.text, fontWeight: '700' },
  projectHintWarn: { fontSize: Type.footnote.fontSize, color: Colors.warningLabel, marginBottom: 12, fontWeight: '600' },

  bodyWrap: { gap: 12 },
  allJobs: { maxHeight: 220, marginTop: 8 },
  allJobRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    minHeight: 44, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  allJobText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text },

  parsingWrap: { alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 },
  parsingText: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' },

  previewCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, gap: 10,
  },
  previewHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 4 },
  previewIconWrap: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  previewKind: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  previewReason: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18, marginTop: 2 },
  previewBody: { gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: t.line },
  previewMetaRow: { flexDirection: 'row', gap: 12 },
  previewNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic' },
  unsureText: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  clarifyChipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
  clarifyChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: `${t.accent}12`, borderWidth: 1, borderColor: `${t.accent}30`,
  },
  clarifyChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },

  field: { marginBottom: 4 },
  fieldSmall: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  fieldValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },

  lineItemRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 8,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  lineItemName: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  lineItemQty: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  lineItemAmt: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text, fontVariant: ['tabular-nums'] },

  ctaRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  ctaSecondary: {
    flex: 1, paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaSecondaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  ctaPrimary: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11,
    backgroundColor: t.accentFill,
  },
  ctaPrimaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: '#FFF' },
  ctaPrimaryBlocked: { opacity: 0.45 },
  blockedText: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 6, fontWeight: '600' },

  errorText: { fontSize: Type.caption1.fontSize, color: t.danger, marginTop: 6, fontWeight: '600' },
});
