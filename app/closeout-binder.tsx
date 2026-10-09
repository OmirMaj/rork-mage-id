// closeout-binder — GC reviews + finalizes the client closeout binder.
//
// Copy says "client", not "homeowner": this screen is reached on a tenant
// fit-out as often as a house, and the recipient there is a tenant or a
// property manager. The `homeowner_email` / `homeowner_name` keys in the
// deliver payload below are deliberately NOT renamed — they are a wire format
// the edge function reads, not words anybody sees.
// The engine auto-compiles everything from selections, commitments,
// warranties, photos. This screen is intentionally thin because the
// magic is in the compiler — GC just adds a note + tweaks the
// maintenance schedule + taps Generate PDF.
//
// Status flow:
//   draft     → editable, not visible to the client
//   finalized → "ready to deliver", still editable, still not in portal
//   sent      → visible in the client portal (closeout section), GC can
//               re-deliver (re-fire notification) but content is locked
//
// The portal snapshot only emits the binder block when status ∈
// {finalized, sent}, so flipping the toggle is what makes it appear.
//
// "Shared with your client" (Phase 0, founder decision 5): two per-job
// switches — supplier names, trade contacts — stored on the job's portal
// settings (ClientPortalSettings.shareSupplierNames / shareTradeContacts) and
// read everywhere through utils/passport/ownerSharing. Both default OFF. They
// govern what MAGE shows the owner: the portal's closeout block, the Home
// Passport (docs Ask Your Home retrieves, and the pre-answered FAQ) and the
// Home Passport screen's shared copy, and the closeout binder PDF (the owner's
// handover document — utils/closeoutBinderEngine drops the Supplier column and
// the Phone/Email cells unless the switch is on). Ask Your Home enforces them
// server-side from the live switch (portal-ask-home/sharingFilter.ts).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Switch,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileDown, Plus, Trash2, Wrench,
  CheckCircle2, Send, RefreshCw, Stamp, FileText, Shield, X,
  ShieldCheck, BookOpen,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import {
  fetchCloseoutBinder, saveCloseoutBinder, saveCloseoutBinderDetailed, shareCloseoutBinderPDF,
  DEFAULT_MAINTENANCE,
  type MaintenanceItem, type CloseoutBinder,
} from '@/utils/closeoutBinderEngine';
import { statusPillStyle } from '@/utils/statusPill';
import { SlideToConfirm, fromOnlineOutcome, type CommitResult, type CommitWriteOptions, type SlideToConfirmHandle } from '@/components/moments/core/contract';
import * as fieldCopy from '@/utils/moments/sites/fieldCopy';
import { useOffline } from '@/hooks/useOnline';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { loadLienWaiversChecked } from '@/utils/lienWaiverEngine';
import { generateUUID } from '@/utils/generateId';
import { notifyEvent } from '@/utils/notifyClient';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  generateG704PDF, generateG706PDF, generateG706APDF, generateG707PDF,
  type G704Data, type G706Data, type G706AData, type G707Data,
} from '@/utils/aiaForms';
import type {
  CompanyBranding, SelectionCategory, LienWaiver,
} from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { buildHomePassport } from '@/utils/passport/buildHomePassport';
import type { BakedFaqEntry, BakedHomePassport } from '@/utils/passport/types';
import { ownerSharingFor, type OwnerSharing } from '@/utils/passport/ownerSharing';
import { loadBakedPassport, saveBakedPassport } from '@/utils/passport/passportStore';
import { syncMemoryEmbeddings, answerFromMemory, type MemoryDoc } from '@/utils/projectMemory';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';
import { AI_CONSENT_DECLINED_CODE, AI_CONSENT_OFF_MESSAGE, AI_CONSENT_OFF_TITLE } from '@/utils/aiConsent';
import { describeError, rawErrorMessage } from '@/utils/errorCopy';
import { pdfFailureMessage } from '@/utils/platformFile';
// Tutorials (closeout-binder) + the sample outbound fence: see the header of
// utils/tutorial/learn/laneD.ts.
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { TutorialScrollAnchor } from '@/components/tutorial/TutorialScrollAnchor';
import { tutorialSignal, useTutorialSandboxId } from '@/utils/tutorial/store';
import { binderSectionsFilled } from '@/utils/tutorial/learn/fixturesD';
import { isSampleProject, SAMPLE_DOC_NOT_SENT } from '@/utils/sampleGuard';
import { usePunchSeal } from '@/hooks/usePunchSeal';
import { TemplateNotice } from '@/components/ProtectNotices';

type BinderStatus = CloseoutBinder['status'];

/** The tutorial wrapper only while a run is live on this job: off, it renders
 *  its children with no host View of its own, so the tree is unchanged. */
function TutorialWrap({ on, wrap, children }: { on: boolean; wrap: React.ReactElement; children: React.ReactNode }) {
  return on ? React.cloneElement(wrap, undefined, children) : <>{children}</>;
}

/** The scroll anchor only during a tutorial run (no host View when off). */
function MaybeScrollAnchor({ on, scrollRef, children }: {
  on: boolean; scrollRef: React.RefObject<ScrollView | null>; children: React.ReactNode;
}) {
  return on ? <TutorialScrollAnchor scrollRef={scrollRef}>{children}</TutorialScrollAnchor> : <>{children}</>;
}

export default function CloseoutBinderScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId: string }>();
  const { projects, getProject, commitments, warranties, projectPhotos, rfis, submittals, settings, updateProject: ctxUpdateProject, getPunchItemsForProject, getInvoicesForProject, getChangeOrdersForProject, subcontractors, requestPortalPublish } = useProjects() as any;

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = projectId ? getProject(projectId) : undefined;
  // Lane SEAL (SHOULD 9): the sealed final punch, read from the server only.
  const { seal: punchSeal } = usePunchSeal(project?.id);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;

  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>(DEFAULT_MAINTENANCE);
  const [notes, setNotes] = useState('');
  const [binderId, setBinderId] = useState<string | undefined>();
  const [status, setStatus] = useState<BinderStatus>('draft');
  const [finalizedAt, setFinalizedAt] = useState<string | undefined>();
  const [sentAt, setSentAt] = useState<string | undefined>();
  const [selections, setSelections] = useState<SelectionCategory[]>([]);
  const [lienWaivers, setLienWaivers] = useState<LienWaiver[]>([]);
  // #30 (CONTRACT 6): a failed waiver read is NOT "no waivers" — the binder
  // would print an empty lien-waiver section for a job that has them. Held
  // here so the export refuses (with Retry) instead.
  const [waiverReadError, setWaiverReadError] = useState<string | null>(null);
  const [waiverReload, setWaiverReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [delivering, setDelivering] = useState(false);
  // Tracks which AIA form (if any) is open in the input modal.
  // null when no modal is open. Each form needs slightly different
  // extras the user has to fill in (notary state, surety, etc.) so
  // we use a single modal that branches on `form`.
  const [aiaModal, setAiaModal] = useState<AiaFormId | null>(null);
  // Home Passport — baked result (FAQ + counts) for this project, plus
  // generation progress. Generation is ALWAYS non-blocking: the binder
  // finalize/deliver flow never waits on it and never fails because of it.
  const [passportBaked, setPassportBaked] = useState<BakedHomePassport | null>(null);
  const [passportBusy, setPassportBusy] = useState(false);
  const [passportStep, setPassportStep] = useState('');
  const { canAccess } = useTierAccess();

  // ── Tutorial (closeout-binder) + the sample fence ────────────────────────
  // runOnThis: a tutorial run is live on THIS project — the only time the
  // TutorialTargets, the scroll anchor and the blocker sentinel render (a real
  // job renders byte-identical). sampleJob: the outbound fence
  // (utils/sampleGuard) — Deliver and Re-deliver refuse on a sample, run or
  // no run. The saved signal reads a ref, so handleSave's deps are unchanged.
  const tutorialSandboxId = useTutorialSandboxId();
  const runOnThis = !!projectId && tutorialSandboxId === projectId;
  const sampleJob = isSampleProject(project);
  const binderScrollRef = useRef<ScrollView>(null);
  // The preview card's four sections, counted the way the card counts them.
  const binderSections = runOnThis ? binderSectionsFilled({
    selections: selections.filter(s => (s.options ?? []).some(o => o.isChosen)).length,
    trades: (commitments ?? []).filter((c: any) => c.projectId === projectId && c.status !== 'draft').length,
    warranties: (warranties ?? []).filter((w: any) => w.projectId === projectId).length,
    maintenance: maintenance.length,
  }) : 0;
  const binderTutorialRef = useRef({ runOnThis, sections: binderSections });
  binderTutorialRef.current = { runOnThis, sections: binderSections };

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
      const [existing, sels, waiverRead, baked] = await Promise.all([
        fetchCloseoutBinder(projectId),
        fetchSelectionsForProject(projectId),
        loadLienWaiversChecked(projectId),
        loadBakedPassport(projectId),
      ]);
      if (cancelled) return;
      setPassportBaked(baked);
      if (existing) {
        setBinderId(existing.id);
        setMaintenance(existing.maintenanceSchedule.length ? existing.maintenanceSchedule : DEFAULT_MAINTENANCE);
        setNotes(existing.notes);
        setStatus(existing.status);
        setFinalizedAt(existing.finalizedAt);
        setSentAt(existing.sentAt);
      }
      setSelections(sels);
      if (waiverRead.ok) { setLienWaivers(waiverRead.waivers); setWaiverReadError(null); }
      else setWaiverReadError(waiverRead.error);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, waiverReload]);

  const persistBinder = useCallback(async (overrides: Partial<CloseoutBinder>) => {
    if (!projectId) return null;
    const saved = await saveCloseoutBinder({
      id: binderId,
      projectId,
      maintenanceSchedule: maintenance,
      notes,
      status,
      finalizedAt,
      sentAt,
      ...overrides,
    });
    // #12 (wave 4): the binder reaches the homeowner's portal only inside a
    // snapshot publish, and this write goes straight to closeout_binders — no
    // tracked project save marks the job. Every successful save (save,
    // finalize, send) asks the provider for one.
    if (saved) (requestPortalPublish as (id: string) => void)(projectId);
    return saved;
  }, [binderId, projectId, maintenance, notes, status, finalizedAt, sentAt, requestPortalPublish]);

  const handleSave = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const saved = await persistBinder({});
      if (saved) {
        setBinderId(saved.id);
        // Tutorial success point: saveCloseoutBinder resolved with the row.
        const tut = binderTutorialRef.current;
        if (tut.runOnThis && saved.status === 'draft') {
          tutorialSignal('binder.saved', { projectId, sections: tut.sections, status: 'draft' });
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        showAlert("Couldn't Save the Binder", 'Check your connection and try again.');
      }
    } catch (e) {
      console.warn('[Closeout] binder save failed:', rawErrorMessage(e));
      const copy = describeError(e, { action: 'save the binder' });
      showAlert("Couldn't Save the Binder", `${copy.body} Your edits are still on this screen. Try again before you leave.`);
    } finally {
      setSaving(false);
    }
  }, [persistBinder, projectId]);

  // ── Home Passport generation ──────────────────────────────────────
  // 1. buildHomePassport assembles pure docs from this project's data.
  // 2. Docs are indexed into memory_embeddings via project-memory-embed
  //    (contractor JWT, source 'Home Passport', idempotent by docId) so
  //    the client's portal-ask-home can retrieve them.
  // 3. Each FaqInput is pre-answered via answerFromMemory over the
  //    passport docs ONLY (never the full project index — change orders /
  //    punch items stay contractor-internal) and baked to AsyncStorage;
  //    the next snapshot push carries it to the portal (v9).
  //
  // `sharingOverride`: the owner-sharing switches to build under. A switch
  // flip passes the NEW value because `project` in this closure still holds
  // the old portal settings until the provider re-renders.
  const runPassportGeneration = useCallback(async (sharingOverride?: OwnerSharing) => {
    if (!project || passportBusy) return;
    if (!canAccess('client_portal')) {
      router.push('/paywall');
      return;
    }
    setPassportBusy(true);
    setPassportStep('Assembling home records…');
    try {
      const generatedAt = new Date().toISOString();
      const sharing = sharingOverride ?? ownerSharingFor(project.clientPortal);
      const projectCommitments = (commitments ?? []).filter((c: any) => c.projectId === project.id);
      const projectWarranties = (warranties ?? []).filter((w: any) => w.projectId === project.id);
      const projectPhotosArr = (projectPhotos ?? []).filter((p: any) => p.projectId === project.id);
      const passport = buildHomePassport({
        project: { id: project.id, name: project.name, location: project.location },
        selections,
        warranties: projectWarranties,
        commitments: projectCommitments,
        subcontractors: subcontractors ?? [],
        photos: projectPhotosArr,
        maintenance,
        generatedAt,
        sharing,
      });
      if (passport.docs.length === 0) {
        showAlert(
          'Nothing to Index Yet',
          'The passport is assembled from selections, warranties, commitments, photos, and the maintenance schedule. Add some of those to this project first.',
        );
        return;
      }

      setPassportStep('Indexing for the portal…');
      const memoryDocs: MemoryDoc[] = passport.docs.map(d => ({
        id: d.docId,
        source: 'Home Passport',
        ref: d.ref,
        date: d.date,
        text: d.text,
      }));
      // Diff-only, never a prune (validate-project-memory-sync pins it). The
      // index therefore CAN hold a supplier or sub-contact doc written while a
      // switch was on; that is safe because portal-ask-home drops those docs
      // at answer time unless the job's live switch is on
      // (supabase/functions/portal-ask-home/sharingFilter.ts). The index is
      // not what keeps a switched-off fact from the owner.
      const indexStatus = await syncMemoryEmbeddings(project.id, memoryDocs);
      if (indexStatus.code === AI_CONSENT_DECLINED_CODE) {
        // AI features are off on this phone, so nothing was sent to the index
        // (it is built by Google Gemini). Not a connection problem, and trying
        // again changes nothing: say what is off and where to turn it on. The
        // previous bake stays exactly as it was, as below.
        showAlert(AI_CONSENT_OFF_TITLE, AI_CONSENT_OFF_MESSAGE);
        return;
      }
      if (!indexStatus.ok) {
        // The index did not take the new docs (offline, monthly cap, rate
        // limit). Keep the previous bake exactly as it was — its recorded
        // `sharing` keeps the "built under different settings" hint up and
        // the portal holding its FAQ back — and say so, rather than save a
        // bake that claims a rebuild that did not reach Ask Your Home.
        showAlert(
          'Ask Your Home Not Updated',
          `The home records could not be indexed${indexStatus.reason ? ` (${indexStatus.reason})` : ''}, so the passport was left as it was. Check your connection and try again.`,
        );
        return;
      }

      const faq: BakedFaqEntry[] = [];
      let consecutiveFailures = 0;
      for (let i = 0; i < passport.faqInputs.length; i++) {
        const item = passport.faqInputs[i];
        setPassportStep(`Pre-answering ${i + 1} of ${passport.faqInputs.length}…`);
        const res = await answerFromMemory(item.question, memoryDocs);
        if (res.answer && !res.errorKind) {
          faq.push({ q: item.question, a: res.answer, refs: res.usedRefs.slice(0, 4) });
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 2) break; // offline / signed out / capped — keep what we have
        }
      }

      // `sharing` rides the bake so the portal can refuse to show FAQ prose
      // written under settings the GC has since switched off.
      const baked: BakedHomePassport = { faq, summary: passport.summary, generatedAt, sharing };
      await saveBakedPassport(project.id, baked);
      setPassportBaked(baked);
      // The baked passport rides the next snapshot publish (#12).
      (requestPortalPublish as (id: string) => void)(project.id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      // Non-blocking by design — the binder flow is untouched.
      console.warn('[home-passport] generation failed:', e);
      showAlert('Home Passport Not Created', 'The binder is unaffected. Check your connection and try again.');
    } finally {
      setPassportBusy(false);
      setPassportStep('');
    }
  }, [project, passportBusy, canAccess, router, commitments, warranties, projectPhotos, selections, subcontractors, maintenance, requestPortalPublish]);

  // ── Shared with your client (Phase 0, founder decision 5) ─────────
  // Off unless the GC turns it on for THIS job. Stored on the job's portal
  // settings, so a job with no portal has nowhere to store it — the switches
  // are then disabled with the reason, and nothing is shared.
  const ownerSharing = ownerSharingFor(project?.clientPortal);
  const hasPortal = !!project?.clientPortal;
  const setOwnerSharing = useCallback((key: keyof OwnerSharing, value: boolean) => {
    const cp = project?.clientPortal;
    if (!project || !cp || passportBusy) return;
    const field = key === 'supplierNames' ? 'shareSupplierNames' : 'shareTradeContacts';
    ctxUpdateProject(project.id, { clientPortal: { ...cp, [field]: value } });
    // The portal's closeout block is rebuilt from the saved switch on the
    // next publish; ask for one now rather than on the next unrelated edit.
    (requestPortalPublish as (id: string) => void)(project.id);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
    // An already-generated passport was indexed (and its FAQ written) under
    // the old setting. Rebuild it under the new one so Ask Your Home and the
    // FAQ stop carrying what was just switched off. Without access to run it,
    // the portal still holds the old FAQ back (bakedSharingAllowed) and the
    // card below says to regenerate.
    if (passportBaked && canAccess('client_portal')) {
      void runPassportGeneration({ ...ownerSharing, [key]: value });
    }
  }, [project, passportBusy, ctxUpdateProject, requestPortalPublish, passportBaked, canAccess, runPassportGeneration, ownerSharing]);

  // ── C4 (moments, lane MOMFIELD): finalizing the binder ─────────────────
  // The footer slide is the confirm (the "Finalize binder?" Alert, the
  // "Couldn't finalize" Alert and the success haptic are retired). The write
  // is the same row persistBinder builds, through saveCloseoutBinderDetailed,
  // which tells a refusal from a dropped connection. The binder is not kept on
  // the phone, so offline the slide is disabled with the reason. finalizedAt is
  // taken at RELEASE.
  const offline = useOffline();
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const finalizeSlideRef = useRef<SlideToConfirmHandle>(null);
  const commitFinalize = useCallback(async (): Promise<CommitResult> => {
    if (!projectId) return { status: 'refused', reason: fieldCopy.binderFinalizeRefused() };
    setFinalizeBusy(true);
    const now = new Date().toISOString();
    const res = await saveCloseoutBinderDetailed({
      id: binderId,
      projectId,
      maintenanceSchedule: maintenance,
      notes,
      status: 'finalized',
      finalizedAt: now,
      sentAt,
    });
    if (res.status === 'synced') {
      setBinderId(res.row.id);
      setFinalizedAt(now);
      // #12: every stored save asks the provider for a portal publish.
      (requestPortalPublish as (id: string) => void)(projectId);
      // Home Passport runs in onFinalizeDone, AFTER the confirmed result has
      // played: it can push the paywall or raise an Alert, never over the capsule.
    }
    const words = { refused: fieldCopy.binderFinalizeRefused(), timeout: fieldCopy.binderFinalizeTimeout() };
    if (res.status === 'refused' && res.error === 'offline') return { status: 'refused', reason: fieldCopy.binderFinalizeOffline() };
    return fromOnlineOutcome(res, { title: fieldCopy.binderFinalizedTitle(), next: fieldCopy.binderFinalizedNext() }, words);
  }, [projectId, binderId, maintenance, notes, sentAt, requestPortalPublish]);
  const finalizeWriteOptions = useMemo<CommitWriteOptions>(() => ({
    idempotent: false,
    copy: { refused: fieldCopy.binderFinalizeRefused(), timeout: fieldCopy.binderFinalizeTimeout() },
  }), []);
  // The slide shows its result, then the bar turns to the finalized actions.
  const onFinalizeDone = useCallback((r: CommitResult) => {
    setFinalizeBusy(false);
    if (r.status === 'confirmed') {
      setStatus('finalized');
      // Home Passport: index + pre-answer in the background, fire-and-forget,
      // once the confirmed result has played. Never blocks or fails the finalize.
      void runPassportGeneration();
    }
  }, [runPassportGeneration]);

  const handleDeliver = useCallback(() => {
    if (!project) return;
    // Sample fence (utils/sampleGuard): Deliver posts to the client's portal
    // and emails them — never from a sample, run or no run.
    if (isSampleProject(project)) { showAlert('Sample Job', SAMPLE_DOC_NOT_SENT); return; }
    const title = sentAt ? 'Re-deliver to client?' : 'Deliver to client?';
    const message = sentAt
      ? 'The client already received this binder. The email is sent again and the portal copy is refreshed.'
      : 'The binder appears in the client\'s portal under Closeout, and they get an email saying where to find it.';
    showAlert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deliver', onPress: async () => {
          setDelivering(true);
          try {
            const now = new Date().toISOString();
            const saved = await persistBinder({ status: 'sent', sentAt: now });
            if (!saved) {
              showAlert("Couldn't Deliver the Binder", 'Check your connection and try again.');
              return;
            }
            setBinderId(saved.id);
            setStatus('sent');
            setSentAt(now);
            // Fire-and-forget notification — don't block UI on email.
            // Pull the first portal invite (the client) so we can
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
            // Only on first delivery (not re-deliver) and only if it isn't
            // closed already. Asks the GC first because some projects keep
            // working after binder delivery (e.g., warranty work, punch
            // follow-ups).
            //
            // 'completed' used to skip the question, as if it were already
            // past this point. It isn't: 'closed' is handover, and the client
            // portal link (until-handover, migration 20260916140000) closes
            // 30 days after it. A job marked completed and then handed over
            // never became closed, so its portal link stayed open forever —
            // on exactly the jobs that were finished.
            const wasFirstDeliver = !sentAt;
            // Say what closing does to the Friday homeowner update too: the
            // digest stops at handover (homeowner-weekly-digest/clientVisible
            // planHomeownerDigest) after one "project complete" email that
            // gives the date the link closes. It used to keep sending "A quiet
            // week on this project" forever (audit 2026-09-18 #23).
            const digestOn = !!project.clientPortal?.weeklyDigest?.enabled;
            if (wasFirstDeliver && project.status !== 'closed') {
              showAlert(
                'Mark project as closed?',
                'Now that the binder is delivered, do you want to mark the whole project as closed? You can still come back to it for warranty work, punch follow-ups, or invoice tracking. The client portal link stays open for 30 more days, then closes.'
                  + (digestOn
                    ? ' The Friday update to your client stops: they get one last email saying the project is complete and the date the link closes.'
                    : ''),
                [
                  { text: 'Keep Open', style: 'cancel' },
                  {
                    text: 'Mark as Closed',
                    onPress: () => {
                      ctxUpdateProject(project.id, { status: 'closed', closedAt: new Date().toISOString() });
                    },
                  },
                ],
              );
            } else {
              showAlert('Delivered', 'The client can see it in their portal now.');
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
    // #30: never print "no lien waivers" off a read that failed. (No await
    // before the PDF call below — on web it opens its window in this tap.)
    if (waiverReadError) {
      showAlert(
        'Lien Waivers Not Loaded',
        "Couldn't read this project's lien waivers, so the binder would list none. Check your signal and try again.",
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Retry', onPress: () => setWaiverReload(n => n + 1) }],
      );
      return;
    }
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
        // The sub roster is what turns a commitment into a phone number the
        // client can dial. Without it the binder's "Trade contacts" table has
        // no contacts in it — which is how that table ended up printing each
        // sub's contract value under the column headed "Email".
        subcontractors: subcontractors ?? [],
        rfis: projectRfis,
        submittals: projectSubmittals,
        warranties: warranties ?? [],
        lienWaivers,
        // Lane SEAL: the "Final punch record" section prints only with a seal.
        ...(punchSeal ? { punchSeal } : {}),
        // Founder decision 5: the binder is the owner's handover document, so
        // supplier names and sub phone/email print only when the GC switched
        // them on for this job — the same two switches as the portal.
        sharing: ownerSharingFor(project.clientPortal),
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      // CONTRACT 25 (#147): a blocked web window says so; anything else gets
      // the plain fallback, never a raw exception string. No success haptic.
      showAlert('Export Failed', pdfFailureMessage(e, "Couldn't build the closeout binder PDF. Try again."));
    } finally {
      setExporting(false);
    }
  }, [project, branding, binderId, maintenance, notes, status, commitments, projectPhotos, rfis, submittals, selections, warranties, lienWaivers, subcontractors, waiverReadError, punchSeal]);

  const addMaintenance = useCallback(() => {
    setMaintenance(prev => [...prev, { id: generateUUID(), task: '', frequency: 'Annual', notes: '' }]);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);
  const removeMaintenance = useCallback((id: string) => {
    const m = maintenance.find(x => x.id === id);
    showAlert(
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

  // ── AIA closeout forms (G704 / G706 / G706A / G707) ─────────────
  // Each form has slightly different "extras" the user has to provide
  // (notary state, surety info). We branch in handleAiaFormTap to
  // open the modal only when extras are needed; if nothing's missing
  // (G704), we generate immediately.
  const handleAiaFormTap = useCallback((formId: AiaFormId) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (formId === 'G704') {
      // No extras needed — generate from project data.
      void generateAiaForm(formId, {});
      return;
    }
    setAiaModal(formId);
  }, []);

  const generateAiaForm = useCallback(async (formId: AiaFormId, extras: Record<string, string>) => {
    if (!project) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const punch = (getPunchItemsForProject?.(project.id) ?? []) as { description: string; location?: string; trade?: string; status: string }[];
      const openPunch = punch.filter(p => p.status !== 'closed').map(p => ({
        description: p.description,
        location: p.location,
        trade: p.trade,
      }));
      const projectAddress = (project as { location?: string; address?: string }).location ?? (project as { address?: string }).address ?? '';
      // The owner is the portal invite, or nothing. Two terms were removed:
      //   * `project.owner` — Project HAS NO `owner` FIELD. The only `owner:
      //     string` in types/index.ts belongs to IncidentCorrectiveAction. It
      //     compiled here purely by cast / `useProjects() as any`, and
      //     evaluated to undefined on every render since it was written.
      //   * `?? 'Owner'` — which printed the literal word "Owner" into the
      //     Owner field of a G704/G714 the client signs. field() in
      //     utils/aiaForms.ts:125 renders `value || ' '`, a blank fill-in
      //     line, which is the correct rendering of a field nobody has filled.
      //     A form that looks completed and is not is worse than a blank.
      // NOT added: project.primaryContact — only the two dev seeders ever
      // write it, so no real project-creation path produces one.
      const owner = project.clientPortal?.invites?.[0]?.name ?? '';

      switch (formId) {
        case 'G704': {
          const scDate = new Date().toISOString();
          const data: G704Data = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            dateOfSubstantialCompletion: scDate,
            punchList: openPunch,
            punchCompletionDate: new Date(Date.now() + 30 * 86400000).toISOString(),
            warrantyStartDate: scDate,
          };
          await generateG704PDF(data, branding);
          // Stamp the project so the 11-month warranty walk reminder
          // can fire ~11 months from now. Only sets if not already set;
          // a re-issued G704 (re-walk after revisions) shouldn't reset
          // the warranty clock.
          if (!project.substantialCompletionDate && ctxUpdateProject) {
            ctxUpdateProject(project.id, { substantialCompletionDate: scDate });
          }
          break;
        }
        case 'G706': {
          const data: G706Data = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            contractorState: (extras.state || '').toUpperCase(),
            contractorCounty: extras.county || undefined,
            exceptions: extras.exceptions || undefined,
          };
          await generateG706PDF(data, branding);
          break;
        }
        case 'G706A': {
          const data: G706AData = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            contractorState: (extras.state || '').toUpperCase(),
            contractorCounty: extras.county || undefined,
          };
          await generateG706APDF(data, branding);
          break;
        }
        case 'G707': {
          const cos = (getChangeOrdersForProject?.(project.id) ?? []) as { status: string; changeAmount: number }[];
          const coTotal = cos.filter(c => c.status === 'approved').reduce((s, c) => s + (c.changeAmount ?? 0), 0);
          const baseSum = effectiveEstimateTotal(project);
          const data: G707Data = {
            ownerName: owner,
            contractorName: branding.companyName,
            projectName: project.name,
            projectAddress,
            contractDate: undefined,
            suretyName: extras.suretyName || '',
            bondNumber: extras.bondNumber || undefined,
            bondDate: extras.bondDate || undefined,
            finalContractSum: baseSum + coTotal,
          };
          await generateG707PDF(data, branding);
          break;
        }
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[AIA Forms] Generate failed:', err);
      showAlert("Couldn't Create the Form", pdfFailureMessage(err, `Couldn't build the ${formId} form. Try again.`));
    }
  }, [project, branding, getPunchItemsForProject, getChangeOrdersForProject]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* This screen hides the nav header, so without ToolHeader the picker
            would have no back affordance at all — the exact dead end #3 is
            about. */}
        <ToolHeader eyebrow="Closeout · MAGE ID" title="Closeout Binder" />
        <ToolProjectPicker
          toolName="the Closeout Binder"
          message="The closeout binder pulls warranties, selections and as-builts from a single project."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<ShieldCheck size={36} color={themeColors.accent} strokeWidth={1.6} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Inside the project, log warranties, selections and any final invoices or change orders.',
            'Tap Closeout in the project tile grid to assemble and send the binder PDF.',
          ]}
        />
      </View>
    );
  }

  const selectionsCount = selections.filter(s => (s.options ?? []).some(o => o.isChosen)).length;
  const projectCommitmentsCount = (commitments ?? []).filter((c: any) => c.projectId === project.id && c.status !== 'draft').length;
  const projectWarrantiesCount  = (warranties ?? []).filter((w: any) => w.projectId === project.id).length;

  const statusPill = (() => {
    const label = status === 'sent' ? 'Delivered' : status === 'finalized' ? 'Finalized' : 'Draft';
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
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Back + which project + where the binder stands. NOT a second page
          title: this row used to also print "The handover packet" in
          Type.serifHeadline — the same style FeatureHeader below renders
          "Everything the client gets at the end" in — so the screen opened
          with two competing serif titles and two eyebrows before any content
          (2026-09-07 app-experience audit; app/handover.tsx and
          app/lien-waivers.tsx still have the same stack). FeatureHeader owns
          the title, and with it the single <h1> web promotion ScreenHeader
          adds; this row is chrome, so it stays unheaded. The row itself has to
          stay because the screen hides the nav bar, and deleting it outright —
          which is what the audit proposed — would leave no way back. */}
      <View style={styles.header}>
        <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="binder.back" />}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        </TutorialWrap>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow} numberOfLines={1}>{project.name}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusPill.bg }]}>
          <Text style={[styles.statusPillText, { color: statusPill.color }]}>{statusPill.label}</Text>
        </View>
      </View>
      <FeatureHeader
        eyebrow="Closeout Binder"
        title="Everything the Client Gets at the End"
        subtitle="Warranties, manuals, paint colors, the trades who did the work and as-builts, bundled into one PDF binder you hand over on closeout day."
        explainer={{
          term: 'Closeout Binder',
          definition: 'The closeout binder is the package of everything the client needs to operate what you built: warranty docs from each manufacturer, operating manuals for installed equipment, paint colors and finishes for touch-ups, sub contact info for warranty claims, and as-built drawings showing what was actually built (not just what was designed).',
          whenToUse: [
            'At project closeout, before you hand over the keys',
            'When the client asks "where\'s the warranty for the rooftop unit?"',
            'A year later, when something needs warranty work and they call you',
          ],
        }}
      />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text style={styles.loadingText}>Loading your binder…</Text>
        </View>
      ) : (
        <ScrollView ref={binderScrollRef} {...fabScroll} contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]}>
          <MaybeScrollAnchor on={runOnThis} scrollRef={binderScrollRef}>
          {/* Status timeline — small and informational so the GC always
              knows where this binder stands. */}
          {(finalizedAt || sentAt) && (
            <View style={styles.timeline}>
              {finalizedAt && (
                <View style={styles.timelineRow}>
                  <CheckCircle2 size={14} color={'#C26A00'} strokeWidth={1.75} />
                  <Text style={styles.timelineText}>Finalized {formattedAt(finalizedAt)}</Text>
                </View>
              )}
              {sentAt && (
                <View style={styles.timelineRow}>
                  <Send size={13} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={styles.timelineText}>Delivered to client {formattedAt(sentAt)}</Text>
                </View>
              )}
            </View>
          )}

          {/* What's in it */}
          <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="binder.sections" />}>
          <View style={styles.previewCard}>
            <View style={styles.previewHead}>
              <MageAIMark size={14} color={themeColors.accent} />
              <Text style={styles.previewTitle}>Auto-Compiled from This Project</Text>
            </View>
            <Text style={styles.previewBody}>
              Your binder will pull live data from the project so the client gets a complete record:
            </Text>
            <View style={styles.previewList}>
              <PreviewRow label="Finishes and Fixtures" value={`${selectionsCount} chosen`} />
              <PreviewRow label="Trades" value={`${projectCommitmentsCount} commitments`} />
              <PreviewRow label="Warranties" value={`${projectWarrantiesCount} on file`} />
              <PreviewRow label="Maintenance Schedule" value={`${maintenance.length} items`} />
            </View>
            {selectionsCount === 0 && projectCommitmentsCount === 0 && projectWarrantiesCount === 0 && (
              <Text style={styles.emptyHint}>Your maintenance schedule and personal note go into the binder even with nothing else logged. Deliver a partial binder now and re-deliver as the project closes out.</Text>
            )}
          </View>
          </TutorialWrap>

          {/* Shared with your client — the two owner-sharing switches. */}
          <View style={styles.card} testID="owner-sharing-card">
            <Text style={styles.cardLabel}>Shared with Your Client</Text>
            <Text style={styles.cardHelper}>
              Brand, model and serial numbers always show. These two are yours to share, job by job, and both start off. Each one also covers the binder PDF you export.
            </Text>
            {([
              { key: 'supplierNames', title: 'Supplier Names', desc: 'Where each finish and selection option comes from, and the suppliers you ordered from. Covers the client portal, the Home Passport, Ask Your Home and the binder PDF.' },
              { key: 'tradeContacts', title: 'Trade Contacts', desc: 'Each sub\u2019s contact name, phone and email, in the Home Passport, Ask Your Home and the binder PDF. Off, your client sees the company and what they did, and calls you. The client portal never lists a sub\u2019s phone or email.' },
            ] as const).map(row => (
              <View key={row.key} style={styles.shareRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shareRowTitle}>{row.title}</Text>
                  <Text style={styles.shareRowDesc}>{row.desc}</Text>
                </View>
                <Switch
                  value={ownerSharing[row.key]}
                  disabled={!hasPortal || passportBusy}
                  onValueChange={v => setOwnerSharing(row.key, v)}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  accessibilityLabel={`Share ${row.title.toLowerCase()} with your client`}
                  testID={`owner-sharing-${row.key}`}
                />
              </View>
            ))}
            {!hasPortal && (
              <>
                <Text style={styles.emptyHint}>
                  Set up the client portal for this project to choose. Until then, neither is shared.
                </Text>
                <TouchableOpacity
                  style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]}
                  onPress={() => router.push({ pathname: '/client-portal-setup', params: { id: project.id } })}
                  accessibilityRole="button"
                  accessibilityLabel="Set Up the Client Portal"
                >
                  <Text style={styles.smallBtnText}>Set Up Client Portal</Text>
                </TouchableOpacity>
              </>
            )}
            {/* A bake records the switches it was built under; one from before
                the switches existed has none and was built with everything in. */}
            {hasPortal && passportBaked && !passportBusy
              && (passportBaked.sharing?.supplierNames !== ownerSharing.supplierNames
                || passportBaked.sharing?.tradeContacts !== ownerSharing.tradeContacts) && (
              <Text style={styles.emptyHint}>
                Your Home Passport was built under different settings. Ask Your Home already follows these; rebuild it below so the pre-answered FAQ does too.
              </Text>
            )}
          </View>

          {/* Lane FACTS (S1): the read-only job facts link, where the GC already is at handover. */}
          <View style={styles.card} testID="share-facts-row">
            <View style={styles.shareRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareRowTitle}>Share Facts</Text>
                <Text style={styles.shareRowDesc}>A read-only link with the permits, inspections, change orders, milestones, photos and warranties you pick. You can turn it off any time.</Text>
              </View>
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={() => router.push({ pathname: '/job-facts', params: { projectId: project.id } })}
                accessibilityRole="button"
                accessibilityLabel="Share Job Facts"
              >
                <Text style={styles.smallBtnText}>Open</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Lane SEAL (SHOULD 9): the sealed final punch, when there is one. */}
          {punchSeal ? (
            <View style={styles.card} testID="punch-seal-row">
              <View style={styles.shareRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shareRowTitle}>Final Punch Record</Text>
                  <Text style={styles.shareRowDesc}>{`Accepted by ${punchSeal.signerName}, ${punchSeal.itemCount} punch item${punchSeal.itemCount === 1 ? '' : 's'}. The binder prints the record id and hash.`}</Text>
                </View>
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={() => router.push({ pathname: '/punch-seal' as any, params: { projectId: project.id } })}
                  accessibilityRole="button"
                  accessibilityLabel="Open the Final Punch Record"
                >
                  <Text style={styles.smallBtnText}>Open</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Home Passport — generation status + manual (re-)generate.
              Shown once the binder is finalized; auto-runs at finalize. */}
          {status !== 'draft' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>Home Passport</Text>
                  <Text style={styles.cardHelper}>
                    Indexes this project&apos;s finishes, warranties, trades and photos so the client can ask their portal questions, like “what paint is in the kitchen?”, and get cited answers, plus a pre-answered FAQ.
                  </Text>
                </View>
                <BookOpen size={18} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              {passportBaked ? (
                <Text style={styles.emptyHint}>
                  Generated {formattedAt(passportBaked.generatedAt)} — {passportBaked.summary.docCount} records indexed, {passportBaked.faq.length} questions pre-answered. Rebuild after editing selections, warranties or contacts.
                </Text>
              ) : (
                <Text style={styles.emptyHint}>
                  Not generated yet. The portal shows the binder either way; the passport adds the question box and pre-answered FAQ.
                </Text>
              )}
              <TouchableOpacity
                style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]}
                onPress={() => { void runPassportGeneration(); }}
                disabled={passportBusy}
                testID="passport-generate"
                accessibilityRole="button"
                accessibilityLabel={passportBaked ? 'Rebuild Home Passport' : 'Create Home Passport'}
              >
                {passportBusy ? (
                  <>
                    <ActivityIndicator size="small" color={themeColors.accent} />
                    <Text style={styles.smallBtnText}>{passportStep || 'Creating Home Passport…'}</Text>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.smallBtnText}>{passportBaked ? 'Rebuild Home Passport' : 'Create Home Passport'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>A Note to the Client</Text>
            <Text style={styles.cardHelper}>Goes at the top of the binder: a thank-you, a sign-off, anything they should know.</Text>
            <TextInput
              style={styles.textarea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Thanks for choosing us. Here's everything you need"
              placeholderTextColor={themeColors.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          {/* Maintenance schedule */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Maintenance Schedule</Text>
                <Text style={styles.cardHelper}>Routine tasks the client should do. Starts with common defaults you can edit, add to or remove.</Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={addMaintenance}>
                <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
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
                    placeholder="Task, like HVAC filter replacement"
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <View style={styles.maintMeta}>
                    <Wrench size={11} color={themeColors.textMuted} strokeWidth={1.75} />
                    <TextInput
                      style={styles.maintFreq}
                      value={m.frequency}
                      onChangeText={v => updateMaintenance(m.id, { frequency: v })}
                      placeholder="Frequency"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                </View>
                <TouchableOpacity onPress={() => removeMaintenance(m.id)} hitSlop={6} testID={`maint-remove-${m.id}`} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            ))}
            {maintenance.length === 0 && (
              <Text style={styles.emptyHint}>No maintenance items. Tap Add to start, or leave it blank. The rest of the binder still goes out.</Text>
            )}
          </View>

          {/* AIA-styled closeout forms — collapsed by default to keep
              the screen calm. Shows 4 form rows with one-tap Generate.
              Each form pulls live project data; only G706/A and G707
              prompt for the small extras (notary state, surety info)
              they need. Lives here because closeout is the natural
              moment to issue these — not buried in a separate menu. */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>AIA-Styled Closeout Forms</Text>
                <Text style={styles.cardHelper}>Create G704 (substantial completion), G706 and G706A affidavits, and G707 (surety) as PDFs you can sign and send. Filled from project data.</Text>
                <TemplateNotice testID="closeout-forms-template-notice" style={{ marginTop: 8 }} />
              </View>
            </View>
            {AIA_FORM_LIST.map(form => (
              <TouchableOpacity
                key={form.id}
                style={styles.aiaFormRow}
                onPress={() => handleAiaFormTap(form.id)}
                activeOpacity={0.7}
                testID={`aia-${form.id.toLowerCase()}-row`}
              >
                <View style={[styles.aiaFormIcon, { backgroundColor: form.color + '15' }]}>
                  <form.Icon size={18} color={form.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiaFormTitle}>{form.title}</Text>
                  <Text style={styles.aiaFormSub}>{form.subtitle}</Text>
                </View>
                <FileDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
            <Text style={styles.emptyHint}>
              These are MAGE ID-styled versions of the AIA forms. Some lenders, sureties, and architects require official AIA documents. Verify before you send.
            </Text>
          </View>
          </MaybeScrollAnchor>
        </ScrollView>
      )}

      {/* AIA form input modal — captures only the fields we couldn't
          auto-derive (state/county for notary affidavits, surety info
          for G707, exceptions etc.). Tap "Generate PDF" to render. */}
      {aiaModal && (
        <AiaFormModal
          form={aiaModal}
          onClose={() => setAiaModal(null)}
          onGenerate={(extras) => {
            void generateAiaForm(aiaModal, extras);
            setAiaModal(null);
          }}
        />
      )}

      {/* Sample fence: why Deliver is off on a sample. */}
      {!loading && sampleJob && status !== 'draft' ? (
        <Text style={[styles.emptyHint, { paddingHorizontal: 14 }]} testID="binder-sample-note">{SAMPLE_DOC_NOT_SENT}</Text>
      ) : null}
      {/* Action bar — different actions per status. PDF is always
          available so the GC can always pull a paper copy. */}
      {!loading && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
          {status === 'draft' && (
            <View style={styles.actionColumn}>
              <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="binder.finalize" />}>
              <SlideToConfirm
                ref={finalizeSlideRef}
                label={fieldCopy.binderFinalizeSlideLabel()}
                busyLabel={fieldCopy.binderFinalizeBusy()}
                srLabel={fieldCopy.binderFinalizeSrLabel()}
                srConfirm={fieldCopy.binderFinalizeSrConfirm()}
                onCommit={commitFinalize}
                writeOptions={finalizeWriteOptions}
                disabledReason={offline ? fieldCopy.binderFinalizeOffline() : saving ? fieldCopy.binderFinalizeSaving() : null}
                onResolved={(r) => { if (r.status !== 'confirmed') setFinalizeBusy(false); }}
                onDone={onFinalizeDone}
                // A finalize stored after "No answer yet": the bar turns and Home Passport runs, as on time.
                onLateResult={(r) => { if (r.status === 'confirmed') onFinalizeDone(r); }}
                testID="binder-finalize"
              />
              </TutorialWrap>
              <View style={styles.actionRowInner}>
              <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="binder.saveDraft" style={styles.secondaryWide} />}>
              <TouchableOpacity style={[styles.secondary, styles.secondaryWide]} onPress={handleSave} disabled={saving || finalizeBusy} testID="binder-save-draft">
                {saving ? <ActivityIndicator size="small" color={themeColors.text} /> : <Text style={styles.secondaryText}>Save Draft</Text>}
              </TouchableOpacity>
              </TutorialWrap>
              <TouchableOpacity style={[styles.secondary, styles.secondaryWide]} onPress={handleExport} disabled={exporting} testID="binder-pdf">
                {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
                  <>
                    <FileDown size={14} color={themeColors.text} strokeWidth={1.75} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              </View>
            </View>
          )}
          {status === 'finalized' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleSave} disabled={saving} testID="binder-save-final">
                {saving ? <ActivityIndicator size="small" color={themeColors.text} /> : <Text style={styles.secondaryText}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf-final">
                {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
                  <>
                    <FileDown size={14} color={themeColors.text} strokeWidth={1.75} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="binder.deliver" style={{ flex: 1 }} />}>
              <TouchableOpacity style={sampleJob ? [styles.primary, { opacity: 0.5 }] : styles.primary} onPress={handleDeliver} disabled={delivering || sampleJob} testID="binder-deliver">
                {delivering ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <Send size={14} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.primaryText}>Deliver to Client</Text>
                  </>
                )}
              </TouchableOpacity>
              </TutorialWrap>
            </>
          )}
          {status === 'sent' && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={handleExport} disabled={exporting} testID="binder-pdf-sent">
                {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
                  <>
                    <FileDown size={14} color={themeColors.text} strokeWidth={1.75} />
                    <Text style={styles.secondaryText}>PDF</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={sampleJob ? [styles.primary, { opacity: 0.5 }] : styles.primary} onPress={handleDeliver} disabled={delivering || sampleJob} testID="binder-redeliver">
                {delivering ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <RefreshCw size={14} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.primaryText}>Re-deliver</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
      {/* Tutorial blocker sentinel: while the AIA-styled form modal is up (it
          draws above the root coach layer on iOS), the coach draws nothing.
          Only while a run is live on this job. */}
      {runOnThis && aiaModal ? <TutorialTarget id="binder.modalUp" /> : null}
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewRowLabel}>{label}</Text>
      <Text style={styles.previewRowValue}>{value}</Text>
    </View>
  );
}

// ── AIA closeout forms catalog ──────────────────────────────────────
// Static list rendered as the form grid. Each entry is one row in the
// closeout-binder screen; tapping fires handleAiaFormTap.
type AiaFormId = 'G704' | 'G706' | 'G706A' | 'G707';

const AIA_FORM_LIST: {
  id: AiaFormId;
  title: string;
  subtitle: string;
  Icon: typeof FileText;
  color: string;
}[] = [
  { id: 'G704',  title: 'G704: Substantial Completion',         subtitle: 'Certifies the project is complete enough for owner to occupy. Includes punch list.', Icon: Stamp,    color: '#16A34A' },
  { id: 'G706',  title: 'G706: Affidavit of Debts and Claims',    subtitle: 'Notarized. Confirms all bills and claims are paid except as listed.',               Icon: FileText, color: '#1E5BC6' },
  { id: 'G706A', title: 'G706A: Affidavit of Lien Releases',    subtitle: 'Notarized. Confirms all lien waivers received except as listed.',                   Icon: FileText, color: '#1E5BC6' },
  { id: 'G707',  title: 'G707: Consent of Surety',              subtitle: 'Surety company approves final payment to contractor without releasing bond.',         Icon: Shield,   color: '#C26A00' },
];

// ── AIA form input modal ────────────────────────────────────────────
// Captures the small extras each form needs (state/county for notary,
// surety info for G707). Single component branches by form ID so the
// closeout-binder screen stays clean — no per-form modal explosion.
function AiaFormModal({
  form,
  onClose,
  onGenerate,
}: {
  form: AiaFormId;
  onClose: () => void;
  onGenerate: (extras: Record<string, string>) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const modalStyles = useThemedStyles(makeModalStyles);
  const [state, setState] = useState('');
  const [county, setCounty] = useState('');
  const [exceptions, setExceptions] = useState('');
  const [suretyName, setSuretyName] = useState('');
  const [bondNumber, setBondNumber] = useState('');
  const [bondDate, setBondDate] = useState('');

  const formMeta = AIA_FORM_LIST.find(f => f.id === form);
  const needsNotary = form === 'G706' || form === 'G706A';
  const isSurety = form === 'G707';
  const isG706 = form === 'G706';

  const canGenerate = needsNotary
    ? state.trim().length === 2
    : isSurety
      ? suretyName.trim().length > 1
      : true;

  const handleSubmit = () => {
    onGenerate({ state, county, exceptions, suretyName, bondNumber, bondDate });
  };

  return (
    <View style={modalStyles.backdrop}>
      <View style={modalStyles.sheet}>
        <View style={modalStyles.head}>
          <View style={{ flex: 1 }}>
            <Text style={modalStyles.headSub}>Generate</Text>
            <Text style={modalStyles.headTitle}>{formMeta?.title}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="aia-modal-close" accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {needsNotary && (
            <>
              <Text style={modalStyles.label}>State (2-Letter)</Text>
              <TextInput
                style={modalStyles.input}
                value={state}
                onChangeText={t => setState(t.slice(0, 2).toUpperCase())}
                placeholder="TX"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="characters"
                maxLength={2}
                testID="aia-state-input"
              />
              <Text style={modalStyles.label}>County (Optional)</Text>
              <TextInput
                style={modalStyles.input}
                value={county}
                onChangeText={setCounty}
                placeholder="Travis"
                placeholderTextColor={themeColors.textMuted}
              />
              {isG706 && (
                <>
                  <Text style={modalStyles.label}>Exceptions / Unsettled Items (Optional)</Text>
                  <TextInput
                    style={[modalStyles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                    value={exceptions}
                    onChangeText={setExceptions}
                    placeholder="Leave blank if all settled"
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                  />
                </>
              )}
              <Text style={modalStyles.helper}>
                Sign before a notary public. The form has signature + commission lines ready.
              </Text>
            </>
          )}

          {isSurety && (
            <>
              <Text style={modalStyles.label}>Surety Company *</Text>
              <TextInput
                style={modalStyles.input}
                value={suretyName}
                onChangeText={setSuretyName}
                placeholder="Travelers Casualty and Surety"
                placeholderTextColor={themeColors.textMuted}
                testID="aia-surety-input"
              />
              <Text style={modalStyles.label}>Bond Number</Text>
              <TextInput
                style={modalStyles.input}
                value={bondNumber}
                onChangeText={setBondNumber}
                placeholder="105-XXXX-22"
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={modalStyles.label}>Bond Date</Text>
              <TextInput
                style={modalStyles.input}
                value={bondDate}
                onChangeText={setBondDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={modalStyles.helper}>
                Final contract sum is auto-pulled from your linked estimate + approved change orders.
              </Text>
            </>
          )}
        </ScrollView>

        <TouchableOpacity
          style={[modalStyles.cta, !canGenerate && modalStyles.ctaDisabled]}
          onPress={handleSubmit}
          disabled={!canGenerate}
          activeOpacity={0.85}
          testID="aia-modal-generate"
        >
          <FileDown size={16} color="#FFF" strokeWidth={1.75} />
          <Text style={modalStyles.ctaText}>Generate PDF</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeModalStyles = (themeColors: ThemeColors) => StyleSheet.create({
  backdrop: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(11,13,16,0.5)',
    justifyContent: 'flex-end' as const,
  } as any,
  sheet: {
    backgroundColor: themeColors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 22,
    gap: 8,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingBottom: 12, marginBottom: 4,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  headSub: {
    fontSize: 10, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase' as const,
  },
  headTitle: {
    fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: themeColors.text,
    marginTop: 2,
  },
  label: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
    marginTop: 12, marginBottom: 5,
  },
  input: {
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize, color: themeColors.text,
  },
  helper: {
    fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 16,
    marginTop: 10, fontStyle: 'italic' as const,
  },
  cta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: themeColors.accentFill,
    borderRadius: Tokens.radius.card, paddingVertical: 14,
    marginTop: 14,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
});

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  center: { alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },

  // Centre-aligned since the title left this row — flex-start was there to top-
  // align a chevron against a two-line block that no longer exists, and would
  // now leave the pill and the project name floating at different heights.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text },
  emptyBack: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accentFill },
  emptyBackText: { color: '#FFF', fontWeight: '800', fontSize: Type.footnote.fontSize },

  timeline: { gap: 4, marginBottom: 10, paddingHorizontal: 4 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timelineText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontWeight: '600' },

  previewCard: { backgroundColor: themeColors.accent + '0D', borderRadius: Tokens.radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: themeColors.accent + '30', gap: 8 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: themeColors.accent, letterSpacing: -0.2 },
  previewBody: { fontSize: Type.caption1.fontSize, color: themeColors.text, lineHeight: 17 },
  previewList: { gap: 4 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  previewRowLabel: { fontSize: Type.caption1.fontSize, color: themeColors.text, fontWeight: '600' },
  previewRowValue: { fontSize: Type.caption1.fontSize, color: themeColors.accent, fontWeight: '800' },
  emptyHint: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontStyle: 'italic', lineHeight: 16, marginTop: 4 },

  card: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: themeColors.line, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  cardHelper: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: themeColors.line },
  shareRowTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: themeColors.text },
  shareRowDesc: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17, marginTop: 2 },

  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: themeColors.accent + '0D', borderWidth: 1, borderColor: themeColors.accent + '30' },
  smallBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: themeColors.accent },

  textarea: { backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: themeColors.text, minHeight: 110 },

  // AIA closeout form rows — clean tappable list inside the binder card
  aiaFormRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  aiaFormIcon: {
    width: 36, height: 36,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  aiaFormTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  aiaFormSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 15 },

  maintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  maintMain: { flex: 1, gap: 6 },
  maintTask: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '600', padding: 0 },
  maintMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  maintFreq: { flex: 1, fontSize: Type.caption2.fontSize, color: themeColors.textMuted, padding: 0 },

  actionBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: themeColors.line, backgroundColor: themeColors.surface },
  // C4: a draft binder's bar is the finalize slide over Save draft and PDF.
  actionColumn: { flex: 1, gap: 10 },
  actionRowInner: { flexDirection: 'row', gap: 8 },
  secondaryWide: { flex: 1 },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 11, backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line },
  secondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 11, backgroundColor: themeColors.accentFill, shadowColor: themeColors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4 },
  primaryText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFF' },
});
