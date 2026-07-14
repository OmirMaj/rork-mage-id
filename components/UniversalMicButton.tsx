import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  Mic, X, FileText, FilePlus2, MessageSquare, AlertTriangle,
  CheckSquare, Briefcase, Receipt, FolderOpen, UserPlus, ListChecks,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTimeEntries } from '@/hooks/useTimeEntries';
import VoiceRecorder from '@/components/VoiceRecorder';
import { parseVoiceAction, type VoiceActionResult } from '@/utils/voiceActionParser';
import { sentenceCase, titleCase } from '@/utils/voiceFormParsers';
import { markFirstVoiceUsed } from '@/utils/onboardingProgress';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
import ThinkingStates from '@/components/ThinkingStates';
import type { Project, RFI, ChangeOrder } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

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
  // Speed-dial integration: when true, the component renders NO floating
  // button of its own — the HomeFabStack draws the mini-FAB and opens this
  // component's modal via `openSignal`. All the recorder/parse/create logic
  // (and the modal) stay inside this component; only its trigger moves out.
  hideFab?: boolean;
  // Monotonic counter — each increment opens the voice modal. Lets a parent
  // trigger the existing `handleOpen` flow without reaching into internals.
  openSignal?: number;
}

type Step = 'idle' | 'recording' | 'parsing' | 'reviewing' | 'creating';

export default function UniversalMicButton({ projectId, variant = 'fab', hideFab = false, openSignal }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Hook order is fixed regardless of project availability, so the same
  // hooks run every render even before the user has a project. The FAB
  // visually no-ops when there's nothing to scope to.
  const router = useRouter();
  const ctx = useProjects();
  const { addManualEntry } = useTimeEntries();
  const { tier } = useSubscription();
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [parsed, setParsed] = useState<VoiceActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<string | undefined>(projectId);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);

  const projectsList = ctx?.projects ?? [];

  // Active first, but fall back to all projects so a GC who's labelled
  // everything 'completed' can still dictate. Empty array stays empty.
  const activeProjects = useMemo(() => {
    const active = projectsList.filter(p => p.status === 'in_progress' || p.status === 'estimated' || p.status === 'draft');
    return active.length > 0 ? active : projectsList;
  }, [projectsList]);

  const project: Project | undefined = useMemo(() => {
    const id = pickedProjectId ?? projectId;
    if (id) return projectsList.find(p => p.id === id);
    if (activeProjects.length === 1) return activeProjects[0];
    if (activeProjects.length === 0) return undefined;
    // Most-recently-updated project as the default.
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
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOpen(true);
    if (!pickedProjectId && project) setPickedProjectId(project.id);
  }, [project, pickedProjectId]);

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

  const handleTranscript = useCallback(async (transcript: string) => {
    if (!transcript || transcript.trim().length === 0) {
      setError('Didn\'t catch that — try again.');
      setStep('idle');
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
    try {
      const result = await parseVoiceAction({ transcript, project });
      setParsed(result);
      setStep('reviewing');
      // Increment ONLY on success — a failed parse never burns a trial.
      void recordAIUsage('fast', 'voiceCapture');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[UniversalMic] parse failed', e);
      setError('AI couldn\'t parse that — try again.');
      setStep('idle');
    }
  }, [project, tier]);

  const handleConfirm = useCallback(async () => {
    if (!parsed) return;
    // Project gate — most kinds need one. 'project' kind creates a NEW
    // project, so it's exempt. 'lead' is exempt too — leads pre-date
    // any project (a lead becomes a project once won). If no project
    // resolved through the auto-pick, last-ditch fallback to the first
    // project in the list — better than blocking with a "no project"
    // error when the GC clearly has projects on file. They can change
    // it via the picker chips above the recorder if it's wrong.
    if (!project && parsed.kind !== 'project' && parsed.kind !== 'lead') {
      const fallback = projectsList[0];
      if (fallback) {
        setPickedProjectId(fallback.id);
        // Don't return — handleConfirm re-runs after state settles when
        // the user hits the button. We surface a hint so they retry.
        setError(`Drafting on ${fallback.name}. Tap "Create" again to confirm.`);
        return;
      }
      setError('No projects yet — say "new project: ..." first to create one.');
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
        const nextNumber = projectCOs.length > 0 ? Math.max(...projectCOs.map(c => c.number)) + 1 : 1;
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
          router.push({ pathname: '/change-order' as never, params: { id: newId } as never });
        }, 250);
      } else if (parsed.kind === 'note') {
        // Notes go in as a "draft" daily report so they end up somewhere
        // visible — the GC can convert / discard later. Keeps voice notes
        // from disappearing into the void.
        ctx.addDailyReport({
          id: generateUUID(),
          projectId: proj.id,
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
        ctx.addPunchItem({
          id: newId,
          projectId: proj.id,
          description: sentenceCase(parsed.description || 'Voice-captured item'),
          location: titleCase(parsed.punchLocation || 'Unspecified'),
          trade: aiTradeToSubTrade(parsed.punchTrade) as never,
          priority: parsed.punchPriority || 'medium',
          status: 'open',
          createdAt: now,
          updatedAt: now,
        } as never);
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
        const newId = generateUUID();
        const now = new Date().toISOString();
        ctx.addProject({
          id: newId,
          name: parsed.projectName || 'Voice-drafted project',
          type: (parsed.projectType || 'renovation') as never,
          location: parsed.projectLocation || 'United States',
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
        const today = now.split('T')[0];
        const company = ctx.settings?.branding?.companyName ?? '';
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
        const totalHrs = timeEntries.reduce((s, t) => s + (t.hours || 0), 0);
        if (totalHrs > 0) summaryParts.push(`${totalHrs}h logged`);

        // 2) Schedule — fuzzy-match spoken task names to real schedule items.
        const schedule = proj.schedule;
        const workProgress: { taskId: string; taskName: string; phase: string; pct: number }[] = [];
        if (schedule && (parsed.fieldScheduleUpdates ?? []).length > 0) {
          const norm = (s: string) => s.toLowerCase().trim();
          const updatedTasks = schedule.tasks.map(t => {
            const match = parsed.fieldScheduleUpdates.find(u =>
              u.taskName && (norm(t.title).includes(norm(u.taskName)) || norm(u.taskName).includes(norm(t.title))));
            if (!match) return t;
            const pct = Math.max(0, Math.min(100, Math.round(match.progressPercent)));
            workProgress.push({ taskId: t.id, taskName: t.title, phase: t.phase, pct });
            const status: typeof t.status = pct >= 100 ? 'done' : pct > 0 ? 'in_progress' : t.status;
            return { ...t, progress: pct, status };
          });
          if (workProgress.length > 0) {
            ctx.updateProject(proj.id, { schedule: { ...schedule, tasks: updatedTasks } });
            summaryParts.push(`${workProgress.length} task${workProgress.length > 1 ? 's' : ''} updated`);
          }
        }

        // 3) Daily report draft — the connective record for the whole log.
        const materials = parsed.fieldMaterials ?? [];
        const workPerformed = parsed.fieldWorkPerformed
          || workProgress.map(w => `${w.taskName} ${w.pct}%`).join(', ')
          || 'Field update';
        ctx.addDailyReport({
          id: generateUUID(),
          projectId: proj.id,
          date: now,
          weather: { temperature: '', conditions: '', wind: '', isManual: true },
          manpower: timeEntries.map(te => ({
            id: generateUUID(),
            trade: te.trade || 'General',
            company,
            headcount: 1,
            hoursWorked: te.hours,
          })),
          workPerformed,
          workProgress: workProgress.length > 0 ? workProgress : undefined,
          materialsDelivered: materials,
          issuesAndDelays: '',
          photos: [],
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        } as never);
        if (materials.length > 0) summaryParts.push(`${materials.length} material${materials.length > 1 ? 's' : ''} noted`);

        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Field update saved',
          `${summaryParts.join(' · ') || 'Draft daily report created'}. Saved as a daily-report draft you can finish anytime.`,
          [{ text: 'OK', onPress: handleClose }],
        );
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
        setError('AI wasn\'t sure what to do — try again with more detail. Try starting with the action: "RFI for...", "change order to...", "punch list:", "new project:", "invoice for...", or "submittal:..."');
        setStep('reviewing');
      }
    } catch (e) {
      console.warn('[UniversalMic] create failed', e);
      setError('Couldn\'t save that — try again.');
      setStep('reviewing');
    }
  }, [parsed, project, ctx, router, handleClose]);

  // Map the AI's loose trade label to the strict SubTrade enum used
  // for punch items. (Inline-defined here rather than imported because
  // it's a one-screen helper.)
  function aiTradeToSubTrade(aiTrade: string): string {
    const t = (aiTrade || '').toLowerCase();
    if (t.includes('electrical')) return 'Electrical';
    if (t.includes('plumb')) return 'Plumbing';
    if (t.includes('hvac') || t.includes('mechanical')) return 'HVAC';
    if (t.includes('drywall')) return 'Drywall';
    if (t.includes('paint')) return 'Painting';
    if (t.includes('tile') || t.includes('floor')) return 'Flooring';
    if (t.includes('roof')) return 'Roofing';
    if (t.includes('concrete') || t.includes('masonry')) return 'Concrete';
    if (t.includes('frame')) return 'Framing';
    if (t.includes('landscap')) return 'Landscaping';
    if (t.includes('door') || t.includes('cabinet') || t.includes('insul')
        || t.includes('cleanup') || t.includes('trim') || t.includes('carpentry')) return 'Other';
    return 'General';
  }

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
    : parsed?.kind === 'punch' ? 'Punch-list item'
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

      <Modal visible={open} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalEyebrow}>Speak it, we&apos;ll draft it</Text>
                <Text style={styles.modalTitle}>Voice action</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            {/* Project picker — render any time the user hasn't pinned
                a projectId via prop AND there are projects to choose
                from. Previously gated on activeProjects.length > 1
                which meant a single project still couldn't be re-
                picked, and no projects gave a confusing dead-end. */}
            {!projectId && projectsList.length > 0 && (
              <View style={styles.pickerWrap}>
                <Text style={styles.pickerLabel}>Project</Text>
                <View style={styles.pickerRow}>
                  {projectsList.slice(0, 4).map(p => (
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
            {!project && projectsList.length === 0 && (
              <Text style={styles.projectHintWarn}>No projects yet — say &quot;new project: Smith kitchen at 123 Main, eighty thousand&quot; to create one.</Text>
            )}
            {!project && projectsList.length > 0 && (
              <Text style={styles.projectHintWarn}>Tap a project above to pick which one this applies to.</Text>
            )}

            {/* States — voice recorder is available even without a project,
                so the GC can dictate "new project: ..." to create one.
                For other kinds, the project gate fires inside handleConfirm. */}
            {step === 'idle' && (
              <View style={styles.bodyWrap}>
                <View style={styles.tipsBox}>
                  <Text style={styles.tipsTitle}>Try saying…</Text>
                  <Text style={styles.tipsLine}>&quot;New lead: John Smith, 555 1234, kitchen remodel, found us on Houzz, eighty thousand.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Submit an RFI to the architect about the steel beam size.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Owner wants the heat pump upgrade — change order for forty-five hundred.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Punch list: master bath, light fixture loose.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;New project: Smith kitchen remodel at 123 Main, eighty thousand.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Invoice them for demolition — twenty-eight hundred lump.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Submittal: light fixture cut sheets, spec twenty-six fifty-one zero zero.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Note: framing on second floor is half done.&quot;</Text>
                  <Text style={styles.tipsLine}>&quot;Log 3 hours framing, floor 2 drywall 80%, 40 sheets of drywall delivered.&quot;</Text>
                </View>
                <VoiceRecorder
                  onTranscriptReady={handleTranscript}
                  isLoading={false}
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
                      'Drafting the right artifact…',
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

                  {parsed.kind === 'punch' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Issue" value={parsed.description || '—'} multi />
                      <View style={styles.previewMetaRow}>
                        <PreviewField label="Location" value={parsed.punchLocation || '—'} small />
                        <PreviewField label="Trade" value={parsed.punchTrade || 'General'} small />
                        <PreviewField label="Priority" value={(parsed.punchPriority || 'medium').toUpperCase()} small />
                      </View>
                    </View>
                  )}

                  {parsed.kind === 'project' && (
                    <View style={styles.previewBody}>
                      <PreviewField label="Project name" value={parsed.projectName || '—'} />
                      <View style={styles.previewMetaRow}>
                        <PreviewField label="Type" value={(parsed.projectType || 'renovation').replace(/_/g, ' ')} small />
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
                            <Text style={styles.lineItemAmt}>${(li.unitPrice * li.quantity).toLocaleString()}</Text>
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
                          <Text style={styles.lineItemName} numberOfLines={1}>{t.trade || 'General'} — time</Text>
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
                      <MageAIMark size={14} color="#FFF" />
                      <Text style={styles.ctaPrimaryText}>
                        Create {kindCTA}
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
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="Voice Capture"
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
  projectHintWarn: { fontSize: Type.footnote.fontSize, color: Colors.warning, marginBottom: 12, fontWeight: '600' },

  bodyWrap: { gap: 12 },
  tipsBox: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.line,
  },
  tipsTitle: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  tipsLine: { fontSize: 12.5, color: t.text, lineHeight: 18, marginBottom: 4, fontStyle: 'italic' },

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
    backgroundColor: t.accent,
  },
  ctaPrimaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: '#FFF' },

  errorText: { fontSize: Type.caption1.fontSize, color: t.danger, marginTop: 6, fontWeight: '600' },
});
