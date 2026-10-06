// contract — GC-side contract editor. Drafts the formal scope-of-work +
// payment schedule, captures the GC signature, sends it to the homeowner
// via the portal for counter-signature.
//
// Flow:
//   1. GC opens this screen from a project. We load (or seed) the active
//      contract for the project.
//   2. GC edits scope/value/payment-schedule/allowances inline.
//   3. GC taps "Sign & Send" → captures their signature, sets status to
//      'sent', the homeowner sees + signs in the portal.
//   4. Once both signatures are on, status is 'signed' and the contract
//      is the binding document. Subsequent invoices reference it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Modal,
  AppState, RefreshControl,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileText, Plus, Trash2, DollarSign, Calendar, Send,
  CheckCircle2, AlertTriangle, Edit3, FileSignature, ChevronRight, Receipt,
} from 'lucide-react-native';
import { MageContract } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import Paywall from '@/components/Paywall';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import {
  loadActiveContract, saveContractDetailed, setContractStatusDetailed,
  markMilestonePaidByInvoice, recordHomeownerSignature, uploadSignedPageEvidence,
  buildDraftContract, buildProposalFromRevision,
  contractTimeline, contractTimelineSentence, suggestContractTimeline,
} from '@/utils/contractEngine';
import {
  resolvePaymentSplit, resolveWarrantyMonths, contractScheduleFromSplit, contractWarrantyText,
  retieContractSchedule, splitLabel, sameSplit, isLegacySeedSchedule, LEGACY_WARRANTY_TEXT,
  hasWarrantyPlaceholder, milestoneDueText, warrantyPeriodPhrase, warrantyShortLabel,
  WARRANTY_PERIOD_PLACEHOLDER, jobProposalSplit, quotedSplitOf,
  type ResolvedSplit,
} from '@/utils/paymentTerms';
import { useClientDocumentGate, type GateAnswers } from '@/hooks/useClientDocumentGate';
import ClientDocumentAskSheet from '@/components/ClientDocumentAskSheet';
import DatePickerModal from '@/components/DatePickerModal';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import * as ImagePicker from 'expo-image-picker';
import {
  recordSignatureBlockReason, buildRecordedHomeownerSignature, isOwnLandedPaperRecord,
  homeownerSignatureMethodLabel, type RecordSignatureDraft, type RecordedSignatureMethod,
  type RecordSignatureOutcome,
} from '@/utils/contractSignatureCore';
import { isTransportError } from '@/utils/networkErrors';
import {
  milestoneBillability, milestoneBillEffect, milestoneBlockMessage, progressRowOpen,
  contractBilledToDate, attributableContractBilling, milestonePaidFromInvoices, milestonePaidRepairs,
  type MilestoneBillability,
} from '@/utils/billingFlowCore';
import { generateUUID } from '@/utils/generateId';
import { getEffectiveInvoiceStatus } from '@/utils/projectFinancials';
import { formatMoney } from '@/utils/formatters';
import { statusPillStyle } from '@/utils/statusPill';
import { syncAllowancesToSelections } from '@/utils/selectionsEngine';
import { sendEmail } from '@/utils/emailService';
import { wrapEmailHtml, emailQuote, escapeHtml } from '@/utils/emailLayout';
import { portalShareUrl } from '@/utils/portalSnapshot';
import { portalDeliveryState, portalRecipients } from '@/utils/portalReady';
// C1 (UX wave): the pre-send question, the one-field ask and this device's
// delivery marker (decision: LOCAL — see utils/portalReady).
import {
  portalDeliveryFacts, contractDeliveryKey, stampContractDelivery, readContractDelivery,
  type ContractDelivery, type PortalDeliveryState,
} from '@/utils/portalReady';
import { resolveClientContact, seedClientEverywhere, isUsableEmail } from '@/utils/clientContact';
import { copyToClipboard } from '@/utils/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sheet } from '@/components/ui/Sheet';
import { supabase } from '@/lib/supabase';
import { sealSignedContract, downloadSealedContractPdf, SealAlreadyExistsError, SEALED_PDF_DOWNLOAD_FAILED_MESSAGE } from '@/utils/contractSealing';
import { pdfFailureMessage } from '@/utils/platformFile';
import { nailIt } from '@/components/animations/NailItToast';
import { SigningCeremony, type SigningCeremonyProps } from '@/components/moments/signing/SigningCeremony';
import { HandoffTurn, useHandoffTurn } from '@/components/moments/signing/HandoffTurn';
import { SlideToConfirm, type CommitResult, type SlideToConfirmHandle } from '@/components/moments/core/contract';
import { sayCommitResult } from '@/utils/moments/sayResult';
import { useOffline } from '@/hooks/useOnline';
import { nextBillableMilestone } from '@/utils/nextBillableMilestone';
import * as signingCopy from '@/utils/moments/sites/signingCopy';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import type { ProjectContract, PaymentMilestone, ContractAllowance, ContractStatus, PaymentSplit, Project } from '@/types';
import { snapshotPatch } from '@/utils/estimateCommit';
import { recordPrediction } from '@/utils/brain/predictionLedger';
import { buildEstimateSnapshotPayload } from '@/utils/brain/estimateSnapshot';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { PriceDriftCheck, usePriceDriftAtSend } from '@/components/priceWatch/PriceDriftCheck';
import type { DriftAtSend } from '@/utils/priceDriftGate';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
// Tutorials (contract-from-estimate) + the sample outbound fence: see the
// header of utils/tutorial/learn/laneD.ts.
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { TutorialScrollAnchor } from '@/components/tutorial/TutorialScrollAnchor';
import { tutorialSignal, useTutorialPractice, useTutorialSandboxId, useTutorialStepActive } from '@/utils/tutorial/store';
import { contractTermsSource, contractTimelinePayload } from '@/utils/tutorial/learn/fixturesD';
import { isSampleProject, SAMPLE_DOC_NOT_SENT } from '@/utils/sampleGuard';
import { NyContractChecklist, askNyMissingItems } from '@/components/contract/NyContractChecklist';
import { nyMissingBeforeSign } from '@/utils/nyHomeImprovement';

// Pipeline shown at the top of every saved contract. Void is omitted
// from the visual (user can still set status=void via the existing UI);
// it's a side branch, not a normal forward step. 'sent' is the period
// after the GC sends the contract to the homeowner but before they
// counter-sign — the homeowner-action waiting state.
const CONTRACT_PIPELINE_STAGES: PipelineStage<ContractStatus>[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'signed', label: 'Signed', terminal: true },
];

// ─── The GC's own terms on a draft (Direction B, "ask when it matters") ────
//
// A contract prints his deposit / progress / final split and his warranty
// period, never a default. Opening this screen never asks; the ask runs only
// from a press ("Set your payment terms", "Set your warranty", Sign & send),
// through hooks/useClientDocumentGate. These two helpers are the only things
// that write an answer onto a draft.

/** Terms may be written only while nobody has signed: a sent or signed row is
 *  the document the homeowner holds. Checked in every handler, not just by
 *  hiding the buttons, because a press can land after the status flips. */
function contractTermsLocked(c: Pick<ProjectContract, 'status' | 'gcSignature'>): boolean {
  return c.status !== 'draft' || !!c.gcSignature;
}

/**
 * Is the schedule on screen still the one this split produces? Triggers and
 * cent amounts, ids and labels ignored.
 *
 * The provenance line ("From the proposal your client was shown: 25 / 65 / 10")
 * reads the portal stamp LIVE, while the schedule below it is a seed frozen at
 * load. Replace the stamp from the portal screen and come back — the load
 * effect is keyed on ids and keeps the held draft, so the line would name a
 * split the rows below do not carry. A line about the rows must be tested
 * against the rows.
 */
function scheduleCarriesSplit(
  schedule: readonly PaymentMilestone[],
  value: number,
  split: PaymentSplit,
): boolean {
  const want = contractScheduleFromSplit(value, split, () => '');
  if (want.length !== schedule.length) return false;
  return want.every((w, i) =>
    schedule[i].trigger === w.trigger
    && Math.round((schedule[i].amount ?? 0) * 100) === Math.round((w.amount ?? 0) * 100));
}

/**
 * The draft with the sheet's answers on it. The schedule is REPLACED — the
 * terms step is only offered on an empty schedule, a schedule that does not
 * foot, or MAGE's old 25/25/25/25 placeholder. The warranty keeps every word he
 * wrote and fills only the period: the placeholder is swapped for his period,
 * and a paragraph with no placeholder (MAGE's old one-year text, the only other
 * way the warranty step opens) is rewritten from contractWarrantyText.
 */
function fillContractTerms(
  c: ProjectContract,
  asked: { terms: boolean; warranty: boolean },
  a: Pick<GateAnswers, 'split' | 'warrantyMonths'>,
): ProjectContract {
  let next = c;
  if (asked.terms && a.split) {
    next = { ...next, paymentSchedule: contractScheduleFromSplit(next.contractValue, a.split) };
  }
  if (asked.warranty && a.warrantyMonths != null) {
    next = {
      ...next,
      warrantyText: hasWarrantyPlaceholder(next.warrantyText)
        ? next.warrantyText.split(WARRANTY_PERIOD_PLACEHOLDER).join(warrantyPeriodPhrase(a.warrantyMonths))
        : contractWarrantyText(a.warrantyMonths),
    };
  }
  return next;
}
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { describeError, ownSentence } from '@/utils/errorCopy';
import { ActionBar, cardSurface, useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';

/**
 * The record found someone else's signature already on the contract (the
 * portal, or another phone): nothing of this record was stored. The in-person
 * ceremony turns it into its neutral result; the paper slide refuses it, so
 * neither ever plays a success over a signature that was not written.
 */
function wasSignedElsewhere(outcome: RecordSignatureOutcome): boolean {
  return outcome.kind === 'not_sent' && (outcome.homeownerSigned || outcome.status === 'signed');
}

// Gate: contracts are a Pro billing tool alongside invoices, change orders,
// and AIA pay apps — all of which hard-gate behind Pro. Previously the
// contract screen imported useTierAccess only for a growth badge and had NO
// paywall, so a free user could draft, sign, send, and seal a full
// construction contract (which also flips the project to in_progress and
// auto-creates selection categories) yet couldn't create the invoice to bill
// against it. `client_portal` is the closest Pro FeatureKey and matches the
// product bible, where client-portal / contract is a Pro feature.
//
// The practice pass (utils/tutorial/practicePass): while a tutorial that
// practises contracts runs, a Free user may open this screen on its SAMPLE job
// only — keyed to the URL's projectId, and the inner screen refuses any other
// project (a pick, a stale id). Client-side monetisation, not security.
export default function ContractScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { projectId: practiceParam } = useLocalSearchParams<{ projectId?: string }>();
  const practice = useTutorialPractice(practiceParam || undefined);
  const paid = canAccess('client_portal');
  if (!paid && !practice.has('client_portal')) {
    return (
      <Paywall
        visible={true}
        feature="Contracts"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <ContractScreenInner practiceProjectId={paid ? undefined : practiceParam} />;
}

/** The tutorial wrapper only while a run is live on this job: off, it renders
 *  its children with no host View of its own, so the tree is unchanged. */
function TutorialWrap({ on, wrap, children }: { on: boolean; wrap: React.ReactElement; children: React.ReactNode }) {
  return on ? React.cloneElement(wrap, undefined, children) : <>{children}</>;
}

function ContractScreenInner({ practiceProjectId }: { practiceProjectId?: string }) {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Reached from the sidebar (CLIENT ▸ Contracts), universal search or a deep
  // link there is no projectId, so ToolProjectPicker sets one locally
  // (field-ticket pattern). A pick outranks the param so a STALE id in the URL
  // — deleted project, old shared link — can't make the picker inert.
  const { projectId: paramProjectId, fromRevision } = useLocalSearchParams<{ projectId: string; fromRevision?: string }>();
  const { getProject, updateProject: ctxUpdateProject, settings, projects, commitments, getInvoicesForProject, getChangeOrdersForProject, requestPortalPublish } = useProjects();
  // The converted_to_contract snapshot was building its cost book from closed
  // jobs ALONE — no receipts, no self-perform labor, no seeds — so it graded
  // itself against a thinner book than the wizard that produced the estimate.
  // All four inputs now, matching app/estimate-wizard.tsx.
  const { receipts } = useMaterialReceipts();
  const laborSamples = useLaborCostSamples();
  const { seeds } = useCostSeeds();
  const { isFree } = useTierAccess();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const project = projectId ? getProject(projectId) : undefined;
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;

  const [contract, setContract] = useState<ProjectContract | null>(null);
  const [loading, setLoading] = useState(true);
  // The contract read FAILED (no signal, an outage) — not "this job has no
  // contract". While set, the screen shows a retry state and nothing that can
  // save or sign: a draft seeded here would become a second contract.
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  // The load-failed screen has no header; a push cold start or a fresh web
  // tab has nothing to pop, so its Go back falls through to home (UX-F18).
  const goBack = useSafeBack();
  // Bumped by Retry to re-run the load effect.
  const [loadSeq, setLoadSeq] = useState(0);
  const [saving, setSaving] = useState(false);
  const [signatureModal, setSignatureModal] = useState(false);
  // #67: "Record homeowner signature" — in person or on paper — on a sent contract.
  const [recordModal, setRecordModal] = useState(false);
  // Signing needs a connection (moments plan rule 2): every legal moment here is disabled offline.
  const offline = useOffline();
  const [startDatePicker, setStartDatePicker] = useState(false);
  // Where a freshly seeded draft's split came from: this job's portal stamp
  // (the proposal the client was shown), his profile, or nowhere. null for a
  // contract loaded from the database — its schedule is a stored value.
  const [termsSource, setTermsSource] = useState<ResolvedSplit['source'] | null>(null);
  // Sign & send was pressed, the missing terms were just filled in, and the
  // signature pad deliberately did NOT open — he has not read the schedule he
  // is about to sign. This is a notice on the page rather than a toast because
  // the gate already fires its own "Saved as your terms …" toast in the same
  // press, and the host shows one toast at a time: a second nailIt in that
  // press cancels the first and neither is seen. A notice also survives the
  // scroll back up through the schedule, which a 2-second toast does not.
  const [reviewBeforeSigning, setReviewBeforeSigning] = useState(false);
  // ── C1 (UX wave): a contract is never "Sent" to nobody ────────────────────
  // Sign & send asks portalDeliveryState BEFORE the pad opens; anything but
  // 'ready' opens the one-field ask (or explains) instead of the flip.
  // "Sign together now" runs the same GC flip with no email, then opens the
  // Record-homeowner-signature modal (it only works on a SENT contract, so the
  // order is fixed). The mode travels by ref: the Sign & send button calls
  // handleSignPress directly, so the press event can never be read as a mode.
  const pendingSignModeRef = useRef<'send' | 'together'>('send');
  const activeSignModeRef = useRef<'send' | 'together'>('send');
  const togetherRecordRef = useRef(false);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  // The ask: what blocked delivery, what he typed, and whether a Retry (not a
  // signature) waits behind it.
  const [deliveryAsk, setDeliveryAsk] = useState<null | { state: PortalDeliveryState; email: string; name: string; then: 'sign' | 'retry' }>(null);
  const [savingDeliveryAsk, setSavingDeliveryAsk] = useState(false);
  // This device's delivery marker for the contract on screen (null = none).
  const [delivery, setDelivery] = useState<{ contractId: string; d: ContractDelivery } | null>(null);
  const [retryingDelivery, setRetryingDelivery] = useState(false);
  // The pad's words follow its mode ("Sign & send" vs the in-person pair).
  const [padInPerson, setPadInPerson] = useState(false);
  const gate = useClientDocumentGate();
  const gateRun = gate.run;

  // The load effect reads these through refs so it can be keyed on IDS alone.
  // Keyed on the `project` object it re-ran on every project save (a portal
  // push, a status flip) and re-seeded the draft, wiping the schedule he had
  // just typed — or the terms he had just answered.
  const projectRef = useRef(project);
  projectRef.current = project;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const contractRef = useRef(contract);
  contractRef.current = contract;

  // T2: the stale-price check before he signs. Read through a ref so
  // handleSignPress keeps its one dependency. check is null while anything is
  // unread — that never holds the signature, it only means no card.
  const priceDrift = usePriceDriftAtSend(project?.linkedEstimate ? project.id : null);
  const driftCheckRef = useRef(priceDrift.check);
  driftCheckRef.current = priceDrift.check;
  // Set by a sign press that found drift: the card shows in the signing sheet
  // itself, in the ceremony's `above` slot, right over the card he signs
  // (wave-next W2 moved signing into SigningCeremony). Cleared by "Sign at
  // these prices" / "Keep these prices".
  const [driftAsk, setDriftAsk] = useState(false);
  const [driftNote, setDriftNote] = useState<string | null>(null);
  // NYCHECK: the New York checklist warns once per contract id (never blocks).
  const nyAckRef = useRef<string | null>(null);
  const signPressRef = useRef<() => void>(() => {});
  const [nyReveal, setNyReveal] = useState(0);

  // ── Tutorial (contract-from-estimate) + the sample fence ────────────────
  // runOnThis: a tutorial run is live on THIS project — the only time the
  // TutorialTargets, the scroll anchor and the blocker sentinel render (a real
  // job renders byte-identical). sampleJob: the outbound fence
  // (utils/sampleGuard) — Sign & send, Sign together and every delivery refuse
  // on a sample, run or no run. Signals read refs so the existing callbacks
  // keep their dependency lists.
  const tutorialSandboxId = useTutorialSandboxId();
  const runOnThis = !!projectId && tutorialSandboxId === projectId;
  const sampleJob = isSampleProject(project);
  const sampleJobRef = useRef(sampleJob);
  sampleJobRef.current = sampleJob;
  const contractTutorialRef = useRef({ runOnThis, termsSource: termsSource as string | null });
  contractTutorialRef.current = { runOnThis, termsSource };
  const contractScrollRef = useRef<ScrollView>(null);
  // The timeline step: BOTH halves on the draft, debounced 600 ms. The screen
  // has no timeline save of its own (Save draft writes it), so no stamp here.
  // Only while that step is the live one: a draft that already carries a
  // timeline (a replay) completes it when the coach gets there, and never
  // skips the look step before it.
  const timelineStepLive = useTutorialStepActive('contract-timeline');
  const timelineSig = runOnThis && timelineStepLive ? contractTimelinePayload(contract?.startDate, contract?.durationDays) : null;
  const timelineKey = timelineSig ? `${timelineSig.startDate}|${timelineSig.durationDays}` : '';
  useEffect(() => {
    if (!timelineKey || !projectId) return;
    const [startDate, days] = timelineKey.split('|');
    const timer = setTimeout(() => tutorialSignal('contract.timeline.set', { projectId, startDate, durationDays: Number(days) }), 600);
    return () => clearTimeout(timer);
  }, [timelineKey, projectId]);

  // Load (or seed a draft for) this project's contract.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = projectRef.current;
      if (!p) { setLoading(false); return; }
      // An unsaved draft for this project is already on screen (a user id
      // arriving late re-runs this effect): keep it — it may hold his edits.
      const held = contractRef.current;
      if (held && !held.id && held.projectId === p.id) { setLoading(false); return; }
      const load = await loadActiveContract(p.id);
      if (cancelled) return;
      if (!load.ok) {
        // Never seed a draft on a failed read — see loadActiveContract.
        setContract(null);
        setLoadFailed(load.error);
        setLoading(false);
        return;
      }
      setLoadFailed(null);
      const existing = load.contract;
      if (existing) {
        setContract(existing);
        setTermsSource(null);
      } else {
        // Seed a draft from the project — caller can edit before saving.
        // If a fromRevision param was passed and the revision exists, seed a
        // proposal from that revision instead of the generic draft.
        //
        // Terms: the proposal this client was shown (the portal stamp) wins,
        // then his saved terms. Neither → an empty schedule and a warranty
        // placeholder, and NO ask here: a sheet on mount is a setup form.
        const s = settingsRef.current;
        // #69: the portal stamp, then the split printed on the proposal PDF he
        // shared (quotedSplitOf — written on a successful share), then his
        // profile. The PDF's split outranks the profile: a profile change
        // between the PDF and the contract must not change the deposit the
        // homeowner agreed to.
        const fromStamp = resolvePaymentSplit({ record: p.clientPortal?.proposalPaymentTerms, settings: s });
        const quoted = quotedSplitOf(p);
        const resolved = fromStamp.source !== 'record' && quoted
          ? resolvePaymentSplit({ record: quoted, settings: s })
          : fromStamp;
        const terms = { split: resolved.split, warrantyMonths: resolveWarrantyMonths(s) };
        const rev = fromRevision
          ? (p.estimateVersions ?? []).find(v => v.id === fromRevision)
          : undefined;
        const draft = rev
          ? buildProposalFromRevision(p, rev, terms)
          : buildDraftContract({ project: p, terms });
        setTermsSource(resolved.source);
        setContract({
          ...draft,
          id: '',
          userId: user?.id ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // fromRevision is read once with the ids; the refs carry the rest.
    // loadSeq is the Retry after a failed read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, user?.id, loadSeq]);

  // Re-read the contract when this screen regains focus, so a milestone the
  // invoice editor just flipped to 'invoiced' shows as billed the moment the
  // GC lands back here. Gated on a SENT or SIGNED contract on purpose: a draft
  // holds unsaved local edits (scope text, amounts) that a refetch would
  // silently discard. A sent contract is locked (contractTermsLocked), so it
  // has nothing local to lose — and it is the one that changes under him: the
  // homeowner counter-signs on their own phone and, until this re-read, the
  // screen kept saying "Sent" with no Create invoice on the deposit (#119).
  //
  // A draft with NO id (seeded here, never saved) is re-checked too: if the job
  // has a live contract after all — it was written on another device, or it
  // was the first read that came back empty-handed — the seeded draft is
  // replaced by the real one and he is told, instead of sitting on a draft
  // whose save would now be refused as a duplicate.
  //
  // Keyed on PRIMITIVES (id, status, project id), never the contract object:
  // useFocusEffect re-runs its callback on every dep change while focused, so
  // keying on `contract` made each read's setContract trigger the next read —
  // an endless fetch loop on a signed contract, and a read per keystroke on an
  // unsaved draft. The held contract is read from contractRef instead, and a
  // re-read only replaces it when the row actually changed.
  const focusContractId = contract?.id;
  const focusContractStatus = contract?.status;
  const focusProjectId = project?.id;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const held = contractRef.current;
      if (!focusProjectId || !held) return;
      const unsavedDraft = !focusContractId;
      if (!unsavedDraft && focusContractStatus !== 'signed' && focusContractStatus !== 'sent') return;
      (async () => {
        const fresh = await loadActiveContract(focusProjectId);
        if (cancelled || !fresh.ok || !fresh.contract) return;
        if (unsavedDraft) {
          if (fresh.contract.status === 'void') return;
          setContract(fresh.contract);
          setTermsSource(null);
          showAlert('This job already has a contract.', 'Showing the saved contract. The unsaved draft that was on screen was not saved.');
        } else if (fresh.contract.id === focusContractId) {
          // Compared by CONTENT, not updatedAt: nothing bumps updated_at on a
          // write (no trigger, and writeContractRow does not set it), so a
          // milestone flipped to 'invoiced' leaves the stamp unchanged.
          const current = contractRef.current;
          if (!current || JSON.stringify(current) !== JSON.stringify(fresh.contract)) setContract(fresh.contract);
        }
      })();
      return () => { cancelled = true; };
    }, [focusContractId, focusContractStatus, focusProjectId]),
  );

  // The same re-read for a sent/signed contract, OFF the focus path (#119).
  // useFocusEffect does not fire when the app comes back from the background,
  // and the kitchen-table case never leaves this screen at all: he sends, the
  // homeowner signs on their phone, he is still looking at "Sent". So it also
  // runs on AppState 'active' and on pull-to-refresh. Only the SAME contract
  // is adopted (fresh.id === held.id): a superseding revision or a void is
  // never swapped in silently. Content-compared, like the focus read.
  const [refreshing, setRefreshing] = useState(false);
  const recheckLockedContract = useCallback(async () => {
    const held = contractRef.current;
    const pid = projectRef.current?.id;
    if (!held?.id || !pid || (held.status !== 'sent' && held.status !== 'signed')) return;
    const fresh = await loadActiveContract(pid);
    if (!fresh.ok || !fresh.contract || fresh.contract.id !== held.id) return;
    const current = contractRef.current;
    if (!current || current.id !== fresh.contract.id) return;
    if (JSON.stringify(current) !== JSON.stringify(fresh.contract)) setContract(fresh.contract);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void recheckLockedContract();
    });
    return () => sub.remove();
  }, [recheckLockedContract]);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await recheckLockedContract(); } finally { setRefreshing(false); }
  }, [recheckLockedContract]);

  /** Tell him the job already has a contract and show it — the refusal of a
   *  save that would have inserted a second one. */
  const adoptExistingContract = useCallback((existing: ProjectContract) => {
    setContract(existing);
    setTermsSource(null);
    showAlert('This job already has a contract.', 'Nothing was saved, because a second contract would have been created. Showing the one on file.');
  }, []);

  // ── Milestone → invoice ──────────────────────────────────────────
  // Invoices already billed against a milestone, keyed by milestone id. This
  // is the invoice-side half of the double-bill guard: if markMilestoneInvoiced
  // failed to persist (offline, RLS, app killed mid-flow) the milestone row
  // still says 'pending', but the invoice it produced still names it — and that
  // is enough to keep the "Create invoice" action off the row.
  const projectInvoices = useMemo(
    () => (projectId ? getInvoicesForProject(projectId) : []),
    [projectId, getInvoicesForProject],
  );
  const invoicesByMilestone = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const inv of projectInvoices) {
      if (!inv.sourceMilestoneId) continue;
      const list = map.get(inv.sourceMilestoneId) ?? [];
      list.push(inv.id);
      map.set(inv.sourceMilestoneId, list);
    }
    return map;
  }, [projectInvoices]);

  // PAID, AS THE MONEY SAYS (#132, #136). The stored milestone status only
  // turns 'paid' through the app's own Record Payment, fire-and-forget; a
  // Pay-link payment, a flip lost offline and every older row stayed
  // "Billed" on a paid draw. The invoices decide whenever this device knows
  // them — EFFECTIVE status, so a refund un-pays the draw too.
  const invoicePaidRows = useMemo(
    () => projectInvoices.map(inv => ({
      id: inv.id,
      sourceMilestoneId: inv.sourceMilestoneId,
      paid: getEffectiveInvoiceStatus(inv) === 'paid',
    })),
    [projectInvoices],
  );
  const paidMilestoneIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of contract?.paymentSchedule ?? []) {
      if (milestonePaidFromInvoices(m, invoicePaidRows)) ids.add(m.id);
    }
    return ids;
  }, [contract?.paymentSchedule, invoicePaidRows]);

  // Best-effort repair of the STORED status when the contract opens (#136):
  // the retry markMilestonePaidByInvoice's callers were supposed to provide
  // and never did. Each is a fresh read-verify-write on the live row (never a
  // queued copy of the whole schedule, which could overwrite an edit made in
  // between). Once per milestone per visit; silent, because the screen already
  // shows the derived PAID either way, and a failure is retried next open.
  const repairAttemptedRef = useRef(new Set<string>());
  const repairContractId = contract?.id;
  const repairContractStatus = contract?.status;
  useEffect(() => {
    const c = contractRef.current;
    if (!repairContractId || repairContractStatus !== 'signed' || !c || c.id !== repairContractId) return;
    const todo = milestonePaidRepairs(c.paymentSchedule, invoicePaidRows)
      .filter(r => !repairAttemptedRef.current.has(r.milestoneId));
    if (todo.length === 0) return;
    for (const r of todo) repairAttemptedRef.current.add(r.milestoneId);
    void (async () => {
      let changed = false;
      for (const r of todo) {
        try {
          if (await markMilestonePaidByInvoice(repairContractId, r.invoiceId) === 'flipped') changed = true;
        } catch { /* retried on the next open */ }
      }
      if (changed) await recheckLockedContract();
    })();
  }, [repairContractId, repairContractStatus, invoicePaidRows, recheckLockedContract]);

  // ONE CONTRACT, ONE BILLED-TO-DATE — the direction this screen owns
  // (MONEY-LEDGER-1, audit 2026-09-11). /bill-from-estimate was taught to see
  // milestone billing; without this, THIS screen still could not see
  // schedule-of-values billing, so a GC who billed the whole SOV there and
  // then tapped "Create invoice" on the four milestones every contract was
  // then seeded with invoiced 200% of the contract. Pre-tax and excluding change
  // orders — see `contractBilledToDate`. (The schedule is now his own deposit /
  // progress / final; the progress row bills through /bill-from-estimate, but
  // the deposit and the final still draw on this ledger.)
  const billedOnContract = useMemo(
    () => contractBilledToDate(projectInvoices),
    [projectInvoices],
  );
  // WHAT THE CEILING REFUSES ON is narrower than what the line above SHOWS
  // (audit 2026-09-11, review round 3). `contractBilledToDate` counts every
  // non-draft, non-change-order line — the right figure to print, the wrong
  // one to block on: three milestones billed plus one $500 quick invoice
  // refused the legitimate final draw on a $130,052 contract, saying the
  // contract had been invoiced in full when 25% of it had not. A quick
  // invoice records no mode on the row, so those dollars are unattributable BY
  // CONSTRUCTION — the same thing app/bill-from-estimate.tsx's reconciliation
  // banner says about them, on the same dollars. It warns; this must not block.
  const attributableBilled = useMemo(
    () => attributableContractBilling(projectInvoices),
    [projectInvoices],
  );
  // Memoised, like every other derivation on this screen. It was inline at
  // render, re-filtering and re-sorting the project's whole change-order list
  // on every keystroke in the contract-value field.
  const approvedChangeOrders = useMemo(
    () => (projectId ? getChangeOrdersForProject(projectId) : [])
      .filter(co => co.status === 'approved')
      .sort((a, b) => a.number - b.number),
    [projectId, getChangeOrdersForProject],
  );

  const billabilityFor = useCallback((m: PaymentMilestone): MilestoneBillability => milestoneBillability({
    milestone: m,
    contractValue: contract?.contractValue ?? 0,
    contractStatus: contract?.status,
    linkedInvoiceIds: invoicesByMilestone.get(m.id),
    contractBilledToDate: attributableBilled,
  }), [contract?.contractValue, contract?.status, invoicesByMilestone, attributableBilled]);

  // Open the invoice editor pre-filled from this milestone. We do NOT flip the
  // milestone here — the invoice screen flips it once addInvoice() actually
  // runs, so a GC who opens the editor and backs out leaves it 'pending'.
  const handleCreateInvoiceFromMilestone = useCallback((m: PaymentMilestone) => {
    if (!contract || !projectId) return;
    // The decision — refuse, or compose — is made in utils/billingFlowCore.ts
    // so it can be EXECUTED by a test; this handler only performs the effect it
    // returns. The union is what makes the refusal binding: `effect.line` does
    // not exist on the `refuse` arm, so removing the `return` below is a
    // compile error rather than a homeowner billed 125% of the contract.
    const effect = milestoneBillEffect(billabilityFor(m), m, contract);
    // "Billed as work is completed" — never one lump invoice. Bill from
    // Estimate bills the work done so far and nets milestone billing.
    if (effect.kind === 'progress') {
      router.push({ pathname: '/bill-from-estimate', params: { projectId } } as never);
      return;
    }
    if (effect.kind === 'refuse') {
      showAlert(
        effect.title,
        effect.message,
        effect.existingInvoiceId
          ? [
              { text: 'Close', style: 'cancel' },
              { text: 'Open Invoice', onPress: () => router.push({ pathname: '/invoice', params: { projectId, invoiceId: effect.existingInvoiceId! } } as never) },
            ]
          : undefined,
      );
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/invoice',
      params: {
        projectId,
        // 'quick' keeps the editor to a single line if prefill parsing ever
        // fails, instead of dragging the whole estimate in behind the milestone.
        type: 'quick',
        prefillLines: JSON.stringify([effect.line]),
        prefillNotes: effect.note,
        milestoneId: effect.milestoneId,
        contractId: contract.id,
        // What the signed contract already decided for this row (#31, #32):
        // the deposit and the final are due on receipt, and the deposit holds
        // no retainage. The editor seeds both and labels them as the
        // contract's; the trigger names the row for the caption.
        ...(effect.terms ? { contractTerms: effect.terms, milestoneTrigger: m.trigger } : {}),
        ...(effect.depositNoRetainage ? { depositNoRetainage: '1' } : {}),
      },
    } as never);
  }, [contract, projectId, billabilityFor, router]);

  // Generic field setter.
  const updateContract = useCallback(<K extends keyof ProjectContract>(key: K, value: ProjectContract[K]) => {
    setContract(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  // Re-balance the payment schedule when contract value changes — % rows are
  // re-tied to the cent, fixed-dollar entries stay put. retieContractSchedule
  // (utils/paymentTerms) puts the rounding cent where billing will never refuse
  // it; the old whole-dollar Math.round here printed amounts that billing, which
  // bills cents(value × pct), then disagreed with.
  const handleValueChange = useCallback((newValue: number) => {
    setContract(prev => {
      if (!prev) return prev;
      return { ...prev, contractValue: newValue, paymentSchedule: retieContractSchedule(newValue, prev.paymentSchedule) };
    });
  }, []);

  const addMilestone = useCallback(() => {
    setContract(prev => prev ? {
      ...prev,
      paymentSchedule: [...prev.paymentSchedule, {
        id: generateUUID(),
        label: 'New Milestone',
        trigger: 'on_milestone',
        triggerMilestone: '',
        amount: 0,
        status: 'pending',
      }],
    } : prev);
  }, []);

  const removeMilestone = useCallback((id: string) => {
    const m = contract?.paymentSchedule.find(x => x.id === id);
    const amount = m?.amount;
    showAlert(
      'Remove this milestone?',
      m?.label
        ? `"${m.label}"${amount ? ` — $${amount.toLocaleString()}` : ''} will be removed from the payment schedule.`
        : 'This milestone will be removed from the payment schedule.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setContract(prev => prev ? {
            ...prev,
            paymentSchedule: prev.paymentSchedule.filter(x => x.id !== id),
          } : prev);
        } },
      ],
    );
  }, [contract]);

  const updateMilestone = useCallback((id: string, patch: Partial<PaymentMilestone>) => {
    setContract(prev => prev ? {
      ...prev,
      paymentSchedule: prev.paymentSchedule.map(m => m.id === id ? { ...m, ...patch } : m),
    } : prev);
  }, []);

  const addAllowance = useCallback(() => {
    setContract(prev => prev ? {
      ...prev,
      allowances: [...prev.allowances, { id: generateUUID(), category: '', amount: 0 }],
    } : prev);
  }, []);

  const removeAllowance = useCallback((id: string) => {
    setContract(prev => prev ? {
      ...prev,
      allowances: prev.allowances.filter(a => a.id !== id),
    } : prev);
  }, []);

  const updateAllowance = useCallback((id: string, patch: Partial<ContractAllowance>) => {
    setContract(prev => prev ? {
      ...prev,
      allowances: prev.allowances.map(a => a.id === id ? { ...a, ...patch } : a),
    } : prev);
  }, []);

  // Save a draft (no status change). Takes the contract as an ARGUMENT rather
  // than reading the render's closure: "Just this contract" fills the draft
  // and saves it in the same press, before React has re-rendered, and a
  // closure save would write the draft from before the answer.
  const saveDraftFrom = useCallback(async (c: ProjectContract) => {
    setSaving(true);
    try {
      const saved = await saveContractDetailed({ ...c, id: c.id || undefined });
      if (saved.ok) {
        setContract(saved.contract);
        // Tutorial success point: the draft is WRITTEN, with a payment
        // schedule on it. Everything in the payload is the saved row's.
        const tut = contractTutorialRef.current;
        const row = saved.contract;
        if (tut.runOnThis && row.paymentSchedule.length > 0) {
          tutorialSignal('contract.terms.set', {
            projectId: row.projectId,
            source: contractTermsSource(tut.termsSource),
            warrantySet: !hasWarrantyPlaceholder(row.warrantyText),
            ...(contractTimelinePayload(row.startDate, row.durationDays) ?? {}),
          });
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (saved.reason === 'duplicate') {
        adoptExistingContract(saved.existing);
      } else {
        showAlert('Save Failed', 'Could not save the contract. Check your connection.');
      }
    } finally {
      setSaving(false);
    }
  }, [adoptExistingContract]);

  // The explicit "Save draft" button.
  const handleSaveDraft = useCallback(async () => {
    if (!contract) return;
    await saveDraftFrom(contract);
  }, [contract, saveDraftFrom]);

  // The one-tap terms actions ("Use 30 / 60 / 10", "Reset to your terms")
  // write his split onto the rows. They must SAVE it too: every one of them
  // renders only on a draft that is already in the database (the legacy
  // notices are gated on contract.id), and a schedule that only ever lived in
  // state was thrown away the moment he left the screen — the ask sheet's
  // "Just this contract" path saves for exactly the same reason.
  // contractRef is advanced by hand because setContract has not re-rendered
  // yet when saveDraftFrom reads the row to write.
  const applyOwnSplit = useCallback((split: PaymentSplit, source: ResolvedSplit['source']) => {
    const c = contractRef.current;
    if (!c || contractTermsLocked(c)) return;
    const next = { ...c, paymentSchedule: contractScheduleFromSplit(c.contractValue, split) };
    contractRef.current = next;
    setContract(next);
    setTermsSource(source);
    if (next.id) void saveDraftFrom(next);
  }, [saveDraftFrom]);

  // Ask for whatever this draft is missing — the split, the warranty period,
  // or both — through the one "ask when it matters" sheet. When his profile
  // (or this job's portal stamp) already answers, nothing is asked and the
  // draft is filled in this press.
  //   · "Use on every job" saves the answer to his profile (the gate does
  //     that) and fills this draft.
  //   · "Just this contract" fills this draft and SAVES it, so the answer
  //     lives on this job's row and survives leaving the screen.
  // Never called from an effect: every open is a press.
  const askContractTerms = useCallback((
    asked: { terms: boolean; warranty: boolean },
    after?: 'review',
  ) => {
    const c = contractRef.current;
    if (!c || contractTermsLocked(c)) return;
    const p = projectRef.current;
    const stamp = resolvePaymentSplit({ record: jobProposalSplit({ portalStamp: p?.clientPortal?.proposalPaymentTerms, quoted: quotedSplitOf(p) })?.split });
    gateRun({
      terms: asked.terms,
      warranty: asked.warranty,
      record: stamp.split,
      justThisJob: true,
      purpose: 'contract',
      documentNoun: c.kind === 'proposal' ? 'proposal' : 'contract',
      total: c.contractValue,
      projectType: p?.type ?? null,
    }, (a) => {
      // The contract may have been sent from another press while the sheet
      // was open — read the latest, and never write terms onto a locked row.
      const latest = contractRef.current;
      if (!latest || contractTermsLocked(latest)) return;
      const filled = fillContractTerms(latest, asked, a);
      contractRef.current = filled;
      setContract(filled);
      if (asked.terms && a.split) {
        setTermsSource(stamp.split && sameSplit(stamp.split, a.split) ? 'record' : 'profile');
      }
      // SAVE WHENEVER THE ROW ALREADY EXISTS, not only on the per-job scope
      // (review round 6). There is no auto-save on this screen — saveDraftFrom
      // is reached from "Save draft", from applyOwnSplit and from here — so an
      // answer that only reached React state is thrown away the moment he
      // leaves. "Use on every job", and the gate running SYNCHRONOUSLY because
      // his profile already answers, both rewrite the schedule and the
      // warranty paragraph of a draft that is already in the database: the
      // legacy notices that open this ask render only on a saved draft
      // (`!!contract.id`), and their sibling button, applyOwnSplit, has saved
      // since round 5 for exactly this reason. Without this the notice
      // vanished, the toast said "Your warranty is on this contract", and the
      // stored row still carried MAGE's paragraph.
      // An UNSAVED draft is still not written behind his back: only the
      // per-job scope, which is an explicit "put this on this job", creates a
      // row he never asked to save.
      if (filled.id || a.termsScope === 'this_job' || a.warrantyScope === 'this_job') {
        void saveDraftFrom(filled);
      }
      if (after === 'review') {
        // The signature pad does NOT open by itself: he has not read the
        // schedule he is about to sign. Said on the page, not in a toast —
        // see reviewBeforeSigning.
        setReviewBeforeSigning(true);
      } else if (a.termsScope == null && a.warrantyScope == null) {
        // Nothing was asked (his profile already answered), so no sheet
        // toast confirmed it — say what just landed on the page.
        nailIt(asked.terms && a.split
          ? `Your terms are on this contract: ${splitLabel(a.split)}`
          : 'Your warranty is on this contract');
      }
    });
  }, [gateRun, saveDraftFrom]);

  // Sign & send. An empty schedule or a warranty with no period cannot be
  // signed, and the press is where he finds that out — the button stays
  // enabled for exactly these two states so it can open the ask.
  const handleSignPress = useCallback(() => {
    const c = contractRef.current;
    if (!c) return;
    // Sample fence (utils/sampleGuard): Sign & send emails the client and Sign
    // together posts to the portal — neither ever goes out from a sample, run
    // or no run, so nothing below opens on one.
    if (sampleJobRef.current) { showAlert('Sample Job', SAMPLE_DOC_NOT_SENT); return; }
    // THE LOCK IS THE FIRST QUESTION, not a footnote inside the missing-terms
    // branch (review round 6). The action row renders on status 'draft', but a
    // draft that already carries his signature is locked like a sent one —
    // every input around it is disabled by that same predicate. Asked only
    // when something was missing, a signed draft with a COMPLETE schedule and
    // warranty fell straight through to the signature pad and captured a
    // second signature over the first.
    if (contractTermsLocked(c)) {
      showAlert(
        'This contract is already signed.',
        'Your signature is on it, so its payment terms and warranty can no longer be changed here.',
      );
      return;
    }
    const needsTerms = c.paymentSchedule.length === 0;
    const needsWarranty = hasWarrantyPlaceholder(c.warrantyText);
    if (needsTerms || needsWarranty) {
      askContractTerms({ terms: needsTerms, warranty: needsWarranty }, 'review');
      return;
    }
    // NYCHECK: after the lock and the terms ask, before the drift card and the mode.
    const nyMissing = nyMissingBeforeSign({ project: projectRef.current, contract: c, branding: settingsRef.current?.branding });
    if (nyMissing > 0 && nyAckRef.current !== c.id) {
      askNyMissingItems(nyMissing, {
        onReview: () => { pendingSignModeRef.current = 'send'; setNyReveal((n) => n + 1); },
        onContinue: () => { nyAckRef.current = c.id; signPressRef.current(); },
      });
      return;
    }
    // T2: a newer receipt of his contradicts a price on this job's estimate.
    // Decided here, after the lock and the missing-terms asks, before the
    // mode is consumed; the pad opens with the check above the signing card.
    // Nothing is signed here and nothing legal is queued: the card writes only
    // the estimate reprice, a normal project write.
    const drift = driftCheckRef.current;
    setDriftNote(null);
    setDriftAsk(!!drift && drift.lines.length > 0);
    // C1: which pad is opening. Consumed here, so a later plain Sign & send
    // press is always 'send'.
    const mode = pendingSignModeRef.current;
    pendingSignModeRef.current = 'send';
    activeSignModeRef.current = mode;
    setPadInPerson(mode === 'together');
    if (mode === 'send') {
      // Can the homeowner actually RECEIVE it? Asked before the signature,
      // never after the flip. Read through refs so this callback keeps its
      // one dependency.
      const p = projectRef.current;
      const state = portalDeliveryState(p, userIdRef.current);
      if (state === 'collaborator') {
        showAlert(
          'Only the project owner can send this.',
          'The client portal\'s signing link belongs to the account that owns this project, so the contract can\'t be emailed from yours. Ask the project owner to sign and send it, or use Sign together now if the client is with you.',
        );
        return;
      }
      if (state !== 'ready') {
        const known = resolveClientContact(p, { need: 'email' });
        setReviewBeforeSigning(false);
        setDeliveryAsk({ state, email: known?.email ?? '', name: known?.name ?? '', then: 'sign' });
        return;
      }
    }
    setReviewBeforeSigning(false);
    setSignatureModal(true);
  }, [askContractTerms]);
  signPressRef.current = handleSignPress;

  // C1: "Sign together now" — the same press, with the in-person mode queued.
  const handleSignTogetherPress = useCallback(() => {
    pendingSignModeRef.current = 'together';
    handleSignPress();
  }, [handleSignPress]);

  // T2: "Sign at these prices" / "Keep these prices": the card goes and he
  // signs in the sheet already open, the press he made (same mode).
  const continueSignPastDrift = useCallback(() => {
    setDriftAsk(false);
    setDriftNote(null);
  }, []);

  // T2: Reprice moved the ESTIMATE. The contract value follows only while it
  // still equals the estimate total it was drafted from (to the cent); a value
  // he set himself stays his. Nothing is signed: he checks, then signs.
  const handleDriftRepriced = useCallback((r: DriftAtSend) => {
    const c = contractRef.current;
    const followed = !!c && Math.round((c.contractValue ?? 0) * 100) === r.grandBeforeCents;
    if (followed) handleValueChange(r.grandAfterCents / 100);
    setDriftNote(followed
      ? 'The contract value now matches the new estimate total. Check it, then sign.'
      : 'The contract value is the one you set, so it did not change. Check it before you sign.');
  }, [handleValueChange]);

  // C1: the homeowner's email — moved here verbatim from handleSignAndSend so
  // the "Signed by you, not delivered" Retry sends the same message. Returns
  // how many recipients the email service accepted.
  const emailContractLink = useCallback(async (
    contract: ProjectContract,
    project: Project,
    portalUrl: string,
    recipients: { email: string; name: string }[],
  ): Promise<number> => {
    const companyName = settings?.branding?.companyName || 'MAGE ID';
    // CONTRACT-TIME-1: the homeowner is being asked to counter-sign a
    // completion date. Stated from the SAME helper the screen renders, so
    // the email and the document can never name different days. Omitted
    // entirely when either half is blank — never a half-stated timeline.
    const emailTimeline = contractTimeline(contract.startDate, contract.durationDays);
    const senderName = settings?.branding?.contactName || companyName;
    const senderEmail = settings?.branding?.email;
    const greetingFirstName = (recipients[0].name ?? '').split(' ')[0] || 'there';
    const html = wrapEmailHtml({
      preheader: `${companyName} sent you the contract for ${project.name}. Tap to review and counter-sign.`,
      eyebrow: 'Contract Ready to Sign',
      title: `${project.name}`,
      subtitle: `Hi ${greetingFirstName}, ${companyName} sent you the construction contract.`,
      bodyHtml: [
        `<p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#4A5159;">
           Your construction contract is ready for your review and counter-signature in your project portal. The contract value${emailTimeline ? ' and timeline are' : ' is'} below${contract.scopeText ? ', with the start of the scope of work' : ''}.
           If the contract isn't showing yet when you open the portal, it is still being posted. Check back in a few minutes. Once you sign, ${escapeHtml(companyName)} can start.
         </p>`,
        contract.scopeText ? emailQuote(contract.scopeText.slice(0, 600)) : '',
        `<p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:#4A5159;">
           <strong style="color:#0B0D10;">Project:</strong> ${escapeHtml(project.name)}<br/>
           ${project.location ? `<strong style="color:#0B0D10;">Location:</strong> ${escapeHtml(project.location)}<br/>` : ''}
           <strong style="color:#0B0D10;">Contract value:</strong> ${escapeHtml(formatMoney(contract.contractValue ?? 0))}
           ${emailTimeline ? `<br/><strong style="color:#0B0D10;">Timeline:</strong> ${escapeHtml(emailTimeline.startLabel)} to ${escapeHtml(emailTimeline.completionLabel)} (${emailTimeline.durationDays} calendar days)` : ''}
         </p>`,
      ].join(''),
      cta: { label: 'Review and Sign in Your Portal', href: portalUrl },
      companyName,
      project: { name: project.name, location: project.location },
      sender: { name: senderName, email: senderEmail, phone: settings?.branding?.phone },
      growthBadge: isFree,
    });

    const subject = `${project.name}: your contract is ready to sign`;
    const sendResults = await Promise.all(recipients.map(r =>
      sendEmail({
        to: r.email,
        subject,
        html,
        replyTo: senderEmail,
        fromCompanyName: companyName,
        projectId: project.id,
      })
    ));
    return sendResults.filter(r => r.success).length;
  }, [settings, isFree]);

  // ── A1 (moments, lane MOMSIGN): the GC's sign & send is a signing ceremony ──
  // The write the ceremony gates: save, then the online-only status flip with
  // the signature (never queued: a signature is a legal record), then the
  // email. It resolves only after the email call returns, so the letter folds
  // over a true answer: "Signed and sent to Jane" only when the email service
  // accepted it, otherwise "Signed. Not sent yet." with the reason on the back
  // face. The fold and its announce are read by the ceremony in the same tick
  // the write resolves (before React re-renders), so they live in one stable
  // object this write updates before it returns.
  const gcMomentRef = useRef<{ fold: NonNullable<SigningCeremonyProps['fold']>; sentAnnounce: string; signed: { signedAt: string; name: string } | null }>({
    fold: { to: '', email: '', sent: false },
    sentAnnounce: '',
    signed: null,
  });

  // Sign + send — captures the GC's signature, status='sent'.
  const handleSignAndSend = useCallback(async (signaturePaths: string[], typedName: string): Promise<CommitResult> => {
    const moment = gcMomentRef.current;
    moment.signed = null;
    moment.fold.sent = false;
    moment.fold.title = signingCopy.contractNotSentTitle();
    moment.fold.body = signingCopy.contractNotSentEmailFailed();
    moment.sentAnnounce = signingCopy.contractNotSentTitle();
    if (!contract) return { status: 'refused', reason: signingCopy.contractRefused() };
    // Last line of the sample fence: a press that reached the pad anyway.
    if (sampleJobRef.current) return { status: 'refused', reason: SAMPLE_DOC_NOT_SENT };
    // Last check, behind handleSignPress (which opens the sheet only with
    // terms and a warranty): the sheet shows these as the reason instead of
    // the line, and a write that still reaches here refuses with the same words.
    if (contract.paymentSchedule.length === 0) return { status: 'refused', reason: signingCopy.contractTermsReason() };
    if (hasWarrantyPlaceholder(contract.warrantyText)) return { status: 'refused', reason: signingCopy.contractWarrantyReason() };
    const name = typedName.trim();
    // Save first to get an id.
    const savedResult = await saveContractDetailed({ ...contract, id: contract.id || undefined });
    if (!savedResult.ok) {
      if (savedResult.reason === 'duplicate') {
        // The sheet stays up while this speaks; closing it shows the one on file.
        setContract(savedResult.existing);
        setTermsSource(null);
        return { status: 'refused', reason: signingCopy.contractDuplicate() };
      }
      return { status: 'refused', reason: signingCopy.contractRefused() };
    }
    const saved = savedResult.contract;
    // Then attach the GC signature + flip status to 'sent', online only.
    const signedAt = new Date().toISOString();
    const status = await setContractStatusDetailed(saved.id, 'sent', {
      gcSignature: {
        name,
        role: 'gc',
        signedAt,
        signaturePaths,
      },
    });
    if (status === 'unknown') return { status: 'timeout', message: signingCopy.contractTimeout() };
    if (status !== 'synced') return { status: 'refused', reason: signingCopy.contractRefused() };
    moment.signed = { signedAt, name };

    // The signature is stored. Everything below follows it, as before.
    // Snapshot the linked estimate at conversion (converted_to_contract
    // milestone for estimate versioning).
    if (project) {
      const _cvSnap = snapshotPatch(project, 'converted_to_contract');
      if (Object.keys(_cvSnap).length) ctxUpdateProject(project.id, _cvSnap);
      // G4: fire-and-forget capture — ledger failure must never break signing
      try {
        const snapshotPayload = buildEstimateSnapshotPayload(project, projects, commitments, receipts, laborSamples, seeds);
        if (snapshotPayload) {
          recordPrediction(
            'estimate_confidence_snapshot',
            snapshotPayload.estimateId,
            snapshotPayload as unknown as Record<string, unknown>,
            project.id,
          );
        }
      } catch { /* G4 */ }
    }
    void loadActiveContract(saved.projectId)
      .then((refreshed) => { if (refreshed.ok && refreshed.contract) setContract(refreshed.contract); })
      .catch(() => undefined);
    // #12: the portal reads the contract only when a snapshot is published,
    // and project_contracts is written directly here — no tracked project
    // save marks the job. Ask the provider for a republish AFTER the flip
    // (never before: a pass that read the draft would record a signature
    // that then blocks the republish). The status flip below re-asks too.
    requestPortalPublish(saved.projectId);

    // Connector: auto-create SelectionCategory rows from contract
    // allowances so the GC doesn't have to re-type the same data into
    // the selections screen. Idempotent — skips categories that
    // already exist by name. Fire-and-forget; the signature never waits on it.
    const allowancesPayload = (saved.allowances ?? []).filter(a => a.category && a.amount > 0);
    if (allowancesPayload.length > 0) {
      void syncAllowancesToSelections(saved.projectId, allowancesPayload).catch((err) => {
        console.warn('[contract] allowance → selection sync failed', err);
      });
    }

    // Connector: flip project to 'in_progress' so the schedule, budget
    // tracker and portal all reflect the project actually being live.
    // Only flip if we're upgrading from a pre-active state — never
    // overwrite 'completed' or 'closed'.
    if (project && (project.status === 'draft' || project.status === 'estimated')) {
      ctxUpdateProject(project.id, { status: 'in_progress' });
    }

    // C1 — "Sign together now": no email goes out and none is claimed. The
    // homeowner signs on this phone in the Record-homeowner-signature modal,
    // which needs the SENT contract the flip above just made. The sheet
    // closes in the ceremony's onDone and the record modal opens after it
    // (iOS tears down a modal presented while another is dismissing).
    if (activeSignModeRef.current === 'together') {
      return { status: 'confirmed', title: signingCopy.contractSignedFirstTitle(), next: signingCopy.contractSignedFirstNext() };
    }

    // Email the homeowner the portal URL + a sign-and-send prompt.
    // Pre-fix this was the audit's #4 finding — the contract status
    // flipped to 'sent' but no email actually went out, so the homeowner
    // had no idea there was anything to counter-sign. Best-effort —
    // failure here doesn't roll back the contract send, and the fold says
    // exactly what happened.
    let notSentReason = signingCopy.contractNotSentEmailFailed();
    // C1: what this device saw happen to the email, stamped below.
    let deliveryMarker: ContractDelivery | null = null;
    const deliveredAt = new Date().toISOString();
    const portalSettings = project?.clientPortal;
    // Who can receive it, by the one rule utils/portalReady shares with
    // the pre-send check (an '@' in the trimmed invitee address).
    const recipients = portalRecipients(portalSettings);
    const clientName = (recipients[0]?.name ?? '').trim();
    moment.fold.to = clientName;
    moment.fold.email = recipients[0]?.email ?? signingCopy.contractNoEmailOnFile();
    try {
      // The link in this email IS the homeowner's authority to counter-sign:
      // the portal's signing RPCs all gate on `?t=<accessToken>`. A bare
      // `mageid.app/portal/<id>` opens a portal that cannot do the one thing
      // this email asks for, and says nothing about why. portalShareUrl is
      // the client mirror of _shared/portalLinks.portalUrlFor — it returns
      // null rather than a token-less URL, and a null link is not a link to
      // send. Tell the GC what is missing instead of mailing a dead CTA.
      const portalUrl = project ? portalShareUrl(portalSettings) : null;
      if (project && portalUrl && recipients.length > 0) {
        // C1: the email itself lives in emailContractLink, so the
        // "not delivered" Retry sends exactly what this sends.
        const sentCount = await emailContractLink(contract, project, portalUrl, recipients);
        if (sentCount > 0) {
          deliveryMarker = { state: 'delivered', at: deliveredAt, count: sentCount };
        } else {
          notSentReason = signingCopy.contractNotSentEmailFailed();
          deliveryMarker = { state: 'not_delivered', at: deliveredAt, reason: 'send_failed' };
        }
      } else {
        // Why nothing went out, from utils/portalReady — the same answer the
        // pre-send check gets. 'ready' cannot reach this branch (it is the
        // `if` above); it shares the last note only to keep the switch total,
        // and its marker records 'send_failed' — never "ready" for an email
        // that did not go out.
        switch (portalDeliveryState(project, user?.id ?? null)) {
          case 'collaborator':
            notSentReason = signingCopy.contractNotSentCollaborator();
            break;
          case 'no_email':
            notSentReason = signingCopy.contractNotSentNoEmail();
            break;
          case 'no_signing_key':
            notSentReason = signingCopy.contractNotSentNoSigningKey();
            break;
          case 'portal_off':
          case 'ready':
            notSentReason = signingCopy.contractNotSentPortalOff();
            break;
        }
        const why = portalDeliveryState(project, user?.id ?? null);
        deliveryMarker = { state: 'not_delivered', at: deliveredAt, reason: why === 'ready' ? 'send_failed' : why };
      }
    } catch (err) {
      console.warn('[contract] email send failed', err);
      notSentReason = signingCopy.contractNotSentEmailFailed();
      deliveryMarker = { state: 'not_delivered', at: deliveredAt, reason: 'send_failed' };
    }
    // C1: remember on THIS device whether the email went out, so the status
    // line never claims receipt it did not see (a second device has no
    // marker and says only what is true everywhere).
    if (deliveryMarker) {
      setDelivery({ contractId: saved.id, d: deliveryMarker });
      if (user?.id) {
        void AsyncStorage.setItem(contractDeliveryKey(saved.id), stampContractDelivery(user.id, deliveryMarker)).catch(() => undefined);
      }
    }

    const sent = deliveryMarker?.state === 'delivered';
    if (sent) {
      const title = clientName ? signingCopy.contractSentTitle(clientName) : signingCopy.contractSentTitleNoName();
      moment.fold.sent = true;
      moment.fold.title = title;
      moment.fold.body = signingCopy.contractSentBody();
      moment.sentAnnounce = clientName ? signingCopy.contractSentAnnounce(clientName) : signingCopy.contractSentAnnounceNoName();
      return { status: 'confirmed', title, next: signingCopy.contractSentBody() };
    }
    // Stored but not delivered: never "sent". The back face says why.
    moment.fold.sent = false;
    moment.fold.title = signingCopy.contractNotSentTitle();
    moment.fold.body = notSentReason;
    moment.sentAnnounce = signingCopy.contractNotSentTitle();
    return { status: 'confirmed', title: signingCopy.contractNotSentTitle(), next: notSentReason };
  }, [contract, project, ctxUpdateProject, projects, commitments, receipts, laborSamples, seeds, requestPortalPublish, user?.id, emailContractLink]);

  // The ceremony held its result through the seal (and the fold): close the
  // sheet now. After "Sign together now" the record sheet opens next, after
  // this one has gone (iOS tears down a modal presented under a dismissing one).
  const onSignCeremonyDone = useCallback((r: CommitResult) => {
    if (r.status !== 'confirmed') return;
    setSignatureModal(false);
    if (activeSignModeRef.current === 'together') {
      activeSignModeRef.current = 'send';
      togetherRecordRef.current = true;
      setTimeout(() => setRecordModal(true), Platform.OS === 'ios' ? 450 : 0);
    }
  }, []);

  // A confirmed answer that arrived after the ceremony said "No answer yet":
  // the signature is stored. Reload what the server holds and say so once.
  const onSignLateResult = useCallback((r: CommitResult) => {
    if (r.status !== 'confirmed') return;
    const pid = projectRef.current?.id;
    if (pid) {
      void loadActiveContract(pid)
        .then((fresh) => { if (fresh.ok && fresh.contract) setContract(fresh.contract); })
        .catch(() => undefined);
    }
    setSignatureModal(false);
    activeSignModeRef.current = 'send';
    nailIt(r.title);
  }, []);

  // ── C1: this device's delivery marker, the ask sheet, Retry, Copy link ────
  // The marker is read for the contract on screen. A read that finds nothing
  // never erases a marker this session just wrote for the same contract (the
  // write is async and may land after the re-read the post-sign refresh
  // triggers).
  useEffect(() => {
    const id = contract?.id;
    const uid = user?.id;
    if (!id || !uid) { setDelivery(null); return; }
    let live = true;
    AsyncStorage.getItem(contractDeliveryKey(id))
      .then(raw => {
        if (!live) return;
        const d = readContractDelivery(raw, uid);
        setDelivery(prev => (d ? { contractId: id, d } : prev?.contractId === id ? prev : null));
      })
      .catch(() => { if (live) setDelivery(prev => (prev?.contractId === id ? prev : null)); });
    return () => { live = false; };
  }, [contract?.id, user?.id]);

  const retryDelivery = useCallback(async (projectOverride?: Project) => {
    const c = contractRef.current;
    const p = projectOverride ?? projectRef.current;
    if (!c?.id || !p || c.status !== 'sent') return;
    if (isSampleProject(p)) { showAlert('Sample Job', SAMPLE_DOC_NOT_SENT); return; }
    const state = portalDeliveryState(p, user?.id ?? null);
    if (state === 'collaborator') {
      showAlert('Only the project owner can send this.', 'The client portal\'s signing link belongs to the account that owns this project.');
      return;
    }
    if (state !== 'ready') {
      const known = resolveClientContact(p, { need: 'email' });
      setDeliveryAsk({ state, email: known?.email ?? '', name: known?.name ?? '', then: 'retry' });
      return;
    }
    const url = portalShareUrl(p.clientPortal);
    const recipients = portalRecipients(p.clientPortal);
    if (!url || recipients.length === 0) return;
    setRetryingDelivery(true);
    let sent = 0;
    try {
      sent = await emailContractLink(c, p, url, recipients);
    } catch (err) {
      console.warn('[contract] retry email failed', err);
      sent = 0;
    } finally {
      setRetryingDelivery(false);
    }
    const at = new Date().toISOString();
    const marker: ContractDelivery = sent > 0
      ? { state: 'delivered', at, count: sent }
      : { state: 'not_delivered', at, reason: 'send_failed' };
    setDelivery({ contractId: c.id, d: marker });
    if (user?.id) void AsyncStorage.setItem(contractDeliveryKey(c.id), stampContractDelivery(user.id, marker)).catch(() => undefined);
    if (sent > 0) nailIt(`Emailed the portal link to ${sent} recipient${sent === 1 ? '' : 's'}`);
    else showAlert('Still Not Delivered', 'The email service did not accept it. Copy the link and text it to the client, or try again in a minute.');
  }, [emailContractLink, user?.id]);

  const copyContractLink = useCallback(async () => {
    if (isSampleProject(projectRef.current)) { showAlert('Sample Job', SAMPLE_DOC_NOT_SENT); return; }
    const url = portalShareUrl(projectRef.current?.clientPortal);
    if (!url) {
      showAlert('No Signing Link Yet', 'This project\'s client portal has no signing link yet. Open the client portal once to finish it, then copy the link here.');
      return;
    }
    const ok = await copyToClipboard(url);
    showAlert(ok ? 'Copied' : 'Copy Failed', ok ? 'The client\'s signing link is on your clipboard. Text or email it to them.' : 'Couldn\'t copy the link. Open the client portal to share it from there.');
  }, []);

  // What the ask does after it unblocks delivery: open the pad (Sign & send)
  // or send the email again (Retry). The sheet closes first; on iOS the pad
  // opens after it has gone (a modal presented under a dismissing one is
  // torn down with it).
  const continueAfterAsk = useCallback((then: 'sign' | 'retry', patched: Project) => {
    setDeliveryAsk(null);
    const delay = Platform.OS === 'ios' ? 450 : 0;
    if (then === 'sign') {
      activeSignModeRef.current = 'send';
      setPadInPerson(false);
      setTimeout(() => setSignatureModal(true), delay);
    } else {
      setTimeout(() => { void retryDelivery(patched); }, delay);
    }
  }, [retryDelivery]);

  const saveDeliveryAsk = useCallback(() => {
    const ask = deliveryAsk;
    const p = projectRef.current;
    if (!ask || !p) return;
    if (isSampleProject(p)) { setDeliveryAsk(null); showAlert('Sample Job', SAMPLE_DOC_NOT_SENT); return; }
    // 'no_signing_key': the ask is a wait with a Retry — nothing to type.
    if (ask.state === 'no_signing_key') {
      const now = portalDeliveryState(p, user?.id ?? null);
      if (now === 'ready') continueAfterAsk(ask.then, p);
      else if (now !== 'no_signing_key') setDeliveryAsk({ ...ask, state: now });
      else showAlert('Still Getting It Ready', 'The signing link isn\'t ready yet. Open the client portal once to finish it, then tap Sign and Send again.');
      return;
    }
    if (!isUsableEmail(ask.email)) {
      showAlert('Check the Email', 'Type the address the client reads, like name@example.com.');
      return;
    }
    const portal = p.clientPortal;
    const portalExists = !!(portal && portal.portalId);
    setSavingDeliveryAsk(true);
    try {
      // The client goes on the job (primaryContact) and, when this job has a
      // portal, onto its invite list. The portal is switched on ONLY here,
      // after the sheet said what the client will see — never silently.
      const patch = seedClientEverywhere(p, { email: ask.email, name: ask.name }, {
        portalBeingEnabled: portalExists,
        newId: generateUUID,
        nowIso: new Date().toISOString(),
      });
      if (portalExists && !portal!.enabled) {
        patch.clientPortal = { ...(patch.clientPortal ?? portal!), enabled: true };
      }
      if (Object.keys(patch).length > 0) ctxUpdateProject(p.id, patch);
      if (!portalExists) {
        // No portal was ever set up: its id and signing key are made on the
        // Client Portal screen, which this one does not copy. The email is
        // saved on the job; say what is left and take him there.
        setDeliveryAsk(null);
        showAlert(
          'Set Up the Client Portal Once',
          `${ask.email} is saved on this project. The client signs through the client portal, which isn't set up for this project yet. Set it up (it shows them the schedule, invoices, change orders and photos), then come back and tap Sign and Send.`,
          [
            { text: 'Not Now', style: 'cancel' },
            { text: 'Set Up the Portal', onPress: () => router.push({ pathname: '/client-portal-setup', params: { id: p.id } }) },
          ],
        );
        return;
      }
      const patched = { ...p, ...patch } as Project;
      const next = portalDeliveryState(patched, user?.id ?? null);
      if (next === 'ready') continueAfterAsk(ask.then, patched);
      else setDeliveryAsk({ ...ask, state: next });
    } finally {
      setSavingDeliveryAsk(false);
    }
  }, [deliveryAsk, user?.id, ctxUpdateProject, continueAfterAsk, router]);

  // The ask sheet's "Sign together now instead".
  const signTogetherFromAsk = useCallback(() => {
    setDeliveryAsk(null);
    setTimeout(() => handleSignTogetherPress(), Platform.OS === 'ios' ? 450 : 0);
  }, [handleSignTogetherPress]);

  // #67: record a homeowner signature given OUTSIDE the portal. The rules
  // (name, pad or page photo + day, never a future day) and the conditional
  // flip live in utils/contractSignatureCore.ts; this handler does the IO:
  // paper → upload the page photo first (no photo on file, no record), then
  // re-read + flip only if the row is still 'sent' and unsigned. No signal
  // refuses with the reason — the contract stays Sent, nothing half-written.
  // C1: the marker for the contract on screen (never another contract's).
  const contractDelivery = delivery && contract?.id && delivery.contractId === contract.id ? delivery.d : null;

  // ── A2 / A3 (moments, lane MOMSIGN) ──────────────────────────────────────
  // The two writes the record sheet gates. Both are the same non-queued IO as
  // before (utils/contractSignatureCore: re-read, then flip only if the row is
  // still 'sent' and unsigned); each answer maps to exactly one CommitResult,
  // and only 'signed' (or the neutral "already signed") is confirmed.
  // Invoices for the paper result's "the deposit invoice can go out" line.
  const projectInvoicesRef = useRef(projectInvoices);
  projectInvoicesRef.current = projectInvoices;
  // Set by the in-person write when the contract was ALREADY signed elsewhere:
  // the ceremony then resolves neutral (no seal, no check), never a seal over
  // a signature that was not stored.
  const recordNeutralRef = useRef(false);
  // The stored homeowner signature (the ceremony's record reads it).
  const recordedSigRef = useRef<{ signedAt: string; name: string } | null>(null);

  /** Adopt the fresh row, never dropping a seal this session just wrote. */
  const adoptFreshContract = useCallback((fresh: ProjectContract) => {
    setContract(prev => (prev && prev.id === fresh.id && prev.signedPdfUrl && !fresh.signedPdfUrl
      ? { ...fresh, signedPdfUrl: prev.signedPdfUrl, documentHash: prev.documentHash }
      : fresh));
  }, []);

  /** A record outcome that is not 'signed', as one CommitResult. */
  const recordOutcomeResult = useCallback((outcome: Exclude<Awaited<ReturnType<typeof recordHomeownerSignature>>, { kind: 'signed' }>): CommitResult => {
    switch (outcome.kind) {
      case 'not_sent':
        if (wasSignedElsewhere(outcome)) {
          // Someone else's signature is on it: nothing of ours was stored.
          // Only the in-person ceremony reaches this (it reads isNeutral and
          // plays no seal); recordPaper refuses the same outcome before here.
          recordNeutralRef.current = true;
          void recheckLockedContract();
          return { status: 'confirmed', title: signingCopy.alreadySignedTitle() };
        }
        void recheckLockedContract();
        return {
          status: 'refused',
          reason: outcome.status === 'draft' ? signingCopy.recordNotSentDraft()
            : outcome.status === 'void' ? signingCopy.recordNotSentVoid()
            : outcome.status === 'sent' ? signingCopy.recordRefused()
            : signingCopy.recordNotOnFile(),
        };
      case 'offline':
        // A transport error after the read: the flip may have landed. A retry
        // is safe because the flip is conditional.
        return { status: 'timeout', message: signingCopy.contractTimeout() };
      case 'failed':
      default:
        return { status: 'refused', reason: signingCopy.recordRefused() };
    }
  }, [recheckLockedContract]);

  // A2: the client signs in person on this phone.
  const recordInPerson = useCallback(async (paths: string[], typedName: string): Promise<CommitResult> => {
    recordNeutralRef.current = false;
    recordedSigRef.current = null;
    const c = contractRef.current;
    // The LIVE row decides whether it can be signed (recordHomeownerSignature
    // re-reads it), never the local status: right after "Sign together" the
    // local copy can still read draft until its refresh lands.
    if (!c?.id || !user?.id) return { status: 'refused', reason: signingCopy.recordRefused() };
    const draft: RecordSignatureDraft = { method: 'in_person', name: typedName, signaturePaths: paths };
    const sig = buildRecordedHomeownerSignature(draft, { nowIso: new Date().toISOString() });
    const outcome = await recordHomeownerSignature(c.id, sig);
    if (outcome.kind !== 'signed') return recordOutcomeResult(outcome);
    recordedSigRef.current = { signedAt: sig.signedAt, name: sig.name };
    // The portal shows the contract as signed from the next publish (#12).
    requestPortalPublish(c.projectId);
    void loadActiveContract(c.projectId)
      .then((fresh) => { if (fresh.ok && fresh.contract) adoptFreshContract(fresh.contract); })
      .catch(() => undefined);
    const p = projectRef.current;
    return {
      status: 'confirmed',
      title: signingCopy.inPersonSignedTitle(),
      detail: p ? signingCopy.contractSummaryLine(p.name, formatMoney(c.contractValue ?? 0, 2)) : undefined,
    };
  }, [user?.id, recordOutcomeResult, requestPortalPublish, adoptFreshContract]);

  // A3: the paper attempts this screen made. The pin is the page photo it
  // uploaded, so a retry of the same page reuses it (never a second upload);
  // every path it uploaded is kept, so the retry knows its OWN earlier record
  // when that flip landed but its answer was lost.
  const paperPinRef = useRef<{ contractId: string; photoUri: string; evidencePath: string } | null>(null);
  const ownPaperEvidenceRef = useRef<Set<string>>(new Set());

  // A3: a paper signature. Nothing is written until the page photo is on file.
  const recordPaper = useCallback(async (draft: RecordSignatureDraft, pagePhotoUri: string | null): Promise<CommitResult> => {
    const c = contractRef.current;
    // The LIVE row decides (recordHomeownerSignature re-reads it), never the
    // local status: a draft, void or signed row answers with its own sentence.
    if (!c?.id || !user?.id) return { status: 'refused', reason: signingCopy.recordRefused() };
    const block = recordSignatureBlockReason({ ...draft, hasPagePhoto: !!pagePhotoUri }, todayCalendarDay());
    if (block || !pagePhotoUri) return { status: 'refused', reason: block ?? signingCopy.paperUploadRefused() };
    const pin = paperPinRef.current;
    let evidencePath = pin && pin.contractId === c.id && pin.photoUri === pagePhotoUri ? pin.evidencePath : '';
    if (!evidencePath) {
      try {
        evidencePath = await uploadSignedPageEvidence(user.id, c.id, pagePhotoUri);
        paperPinRef.current = { contractId: c.id, photoUri: pagePhotoUri, evidencePath };
        ownPaperEvidenceRef.current.add(evidencePath);
      } catch (err) {
        console.warn('[contract] signed page upload failed', err);
        return { status: 'refused', reason: signingCopy.paperUploadRefused() };
      }
    }
    const sig = buildRecordedHomeownerSignature(draft, { nowIso: new Date().toISOString(), evidencePath });
    const outcome = await recordHomeownerSignature(c.id, sig);
    // The signature on file is this screen's own earlier paper record (its
    // flip landed, the answer was lost): it IS stored, so it confirms below.
    const ownLanded = isOwnLandedPaperRecord(outcome, ownPaperEvidenceRef.current);
    if (!ownLanded) {
      // Signed elsewhere first: this paper record was not stored, so the slide
      // refuses it (no lock, no success tone) and the sheet stays open.
      if (wasSignedElsewhere(outcome)) {
        void recheckLockedContract();
        return { status: 'refused', reason: signingCopy.paperAlreadySigned() };
      }
      if (outcome.kind !== 'signed') return recordOutcomeResult(outcome);
    }
    requestPortalPublish(c.projectId);
    // "The deposit invoice can go out" only when the signed contract really
    // has an unbilled deposit due (the same decision the Bill deposit door reads).
    let next = signingCopy.paperRecordedNextNoDeposit();
    try {
      const fresh = await loadActiveContract(c.projectId);
      if (fresh.ok && fresh.contract) {
        adoptFreshContract(fresh.contract);
        if (nextBillableMilestone({ contract: fresh.contract, invoices: projectInvoicesRef.current })?.kind === 'deposit') {
          next = signingCopy.paperRecordedNext();
        }
      }
    } catch { /* the signature is stored; the next line stays the plain one */ }
    return { status: 'confirmed', title: signingCopy.paperRecordedTitle(), next };
  }, [user?.id, recordOutcomeResult, recheckLockedContract, requestPortalPublish, adoptFreshContract]);

  // Graft 7: after the client's signature closes the contract, seal it once.
  // The evidence line appears only after the seal returned a real hash; on
  // failure no hash shows and "Seal & save signed PDF" stays as the retry.
  const [autoSeal, setAutoSeal] = useState<{ state: 'idle' | 'running' | 'sealed' | 'failed'; hash?: string }>({ state: 'idle' });
  const autoSealStarted = useRef(false);
  const runAutoSeal = useCallback(async () => {
    if (autoSealStarted.current) return;
    autoSealStarted.current = true;
    const p = projectRef.current;
    const held = contractRef.current;
    if (!p || !held?.projectId || !user?.id) { setAutoSeal({ state: 'failed' }); return; }
    setAutoSeal({ state: 'running' });
    try {
      const fresh = await loadActiveContract(held.projectId);
      if (!fresh.ok || !fresh.contract || fresh.contract.status !== 'signed') { setAutoSeal({ state: 'failed' }); return; }
      try {
        const result = await sealSignedContract({
          contract: fresh.contract,
          project: p,
          branding: settingsRef.current?.branding ?? {},
          supabase,
          userId: user.id,
        });
        setContract({ ...fresh.contract, signedPdfUrl: result.signedPdfUrl, documentHash: result.documentHash });
        setAutoSeal({ state: 'sealed', hash: result.documentHash });
      } catch (err) {
        if (err instanceof SealAlreadyExistsError) {
          // Sealed before: that counts as sealed. The hash shows only if the row carries it.
          const again = await loadActiveContract(held.projectId).catch(() => null);
          const row = again && again.ok ? again.contract : null;
          if (row) setContract(row);
          setAutoSeal({ state: 'sealed', hash: row?.documentHash });
          return;
        }
        console.warn('[contract] auto-seal failed', err);
        setAutoSeal({ state: 'failed' });
      }
    } catch (err) {
      console.warn('[contract] auto-seal failed', err);
      setAutoSeal({ state: 'failed' });
    }
  }, [user?.id]);
  // Every open of the record sheet starts with no seal attempt behind it.
  useEffect(() => {
    if (!recordModal) return;
    autoSealStarted.current = false;
    setAutoSeal({ state: 'idle' });
  }, [recordModal]);
  const closeRecordModal = useCallback(() => {
    setRecordModal(false);
    togetherRecordRef.current = false;
  }, []);
  // A result that landed after the sheet closed: say it once.
  const onRecordResultAfterUnmount = useCallback((r: CommitResult) => {
    if (r.status === 'confirmed') nailIt(r.title);
  }, []);
  // A late confirmed answer after "No answer yet": reload what the server holds.
  const onRecordLateResult = useCallback((r: CommitResult) => {
    if (r.status !== 'confirmed') return;
    void recheckLockedContract();
    nailIt(r.title);
  }, [recheckLockedContract]);

  // ── A4: seal the signed contract, for a portal or paper signature ─────────
  // A one-shot legal write: the slide resolves confirmed only when the seal
  // returned its hash (or the contract was already sealed). The row is
  // adopted after the result hold (onDone), so the slide is not unmounted
  // under its own result by the Download button replacing it.
  const sealedPatchRef = useRef<ProjectContract | null>(null);
  const sealWrite = useCallback(async (): Promise<CommitResult> => {
    sealedPatchRef.current = null;
    if (!project || !contract || !user?.id) return { status: 'refused', reason: signingCopy.sealRefused() };
    try {
      const result = await sealSignedContract({
        contract,
        project,
        branding: settings?.branding ?? {},
        supabase,
        userId: user.id,
      });
      sealedPatchRef.current = { ...contract, signedPdfUrl: result.signedPdfUrl, documentHash: result.documentHash };
      return { status: 'confirmed', title: signingCopy.sealedTitle(result.documentHash.slice(0, 12)), next: signingCopy.sealedNext() };
    } catch (err) {
      if (err instanceof SealAlreadyExistsError) {
        void recheckLockedContract();
        return { status: 'confirmed', title: signingCopy.alreadySealedTitle() };
      }
      console.error('[Contract] Seal error:', err);
      if (isTransportError(err)) return { status: 'timeout', message: signingCopy.contractTimeout() };
      // sealSignedContract throws sentences written for the user ("Sealing
      // works in the mobile app…", "Both your signature and the client's are
      // needed…"); those say what unlocks the seal, so they win.
      return { status: 'refused', reason: ownSentence(err) ?? signingCopy.sealRefused() };
    }
  }, [project, contract, user?.id, settings?.branding, recheckLockedContract]);
  const onSealDone = useCallback((r: CommitResult) => {
    if (r.status !== 'confirmed') return;
    const patched = sealedPatchRef.current;
    sealedPatchRef.current = null;
    if (patched) setContract(prev => (prev && prev.id === patched.id ? { ...prev, signedPdfUrl: patched.signedPdfUrl, documentHash: patched.documentHash } : prev));
  }, []);
  // A late seal: adopt the row and reload what the server holds; the slide says it.
  const onSealLateResult = useCallback((r: CommitResult) => {
    if (r.status !== 'confirmed') return;
    onSealDone(r);
    void recheckLockedContract();
  }, [onSealDone, recheckLockedContract]);

  // The ceremonies read the STORED record (never the live fields) for the seal.
  const gcRecordFrom = useCallback(() => ({
    signedAtIso: gcMomentRef.current.signed?.signedAt ?? new Date().toISOString(),
    timeSource: 'device' as const,
    name: gcMomentRef.current.signed?.name ?? '',
  }), []);
  const recordInPersonFrom = useCallback(() => ({
    signedAtIso: recordedSigRef.current?.signedAt ?? new Date().toISOString(),
    timeSource: 'device' as const,
    name: recordedSigRef.current?.name ?? '',
  }), []);
  const isRecordNeutral = useCallback(() => recordNeutralRef.current, []);
  const runAutoSealOnce = useCallback(() => { void runAutoSeal(); }, [runAutoSeal]);

  const handleSealSignedContract = useCallback(async () => {
    if (!project || !contract || !user?.id) return;
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await sealSignedContract({
        contract,
        project,
        branding: settings?.branding ?? {},
        supabase,
        userId: user.id,
      });
      // Reflect into local state immediately so the UI flips to Download.
      setContract({
        ...contract,
        signedPdfUrl: result.signedPdfUrl,
        documentHash: result.documentHash,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt(`Sealed · ${result.documentHash.slice(0, 12)}…`);
    } catch (err) {
      if (err instanceof SealAlreadyExistsError) {
        showAlert('Already Sealed', 'This contract has already been sealed.');
        return;
      }
      console.error('[Contract] Seal error:', err);
      // sealSignedContract throws sentences written for the user ("Sealing
      // works in the mobile app…", "Both your signature and the client's are
      // needed…"); those say what unlocks the seal, so they win over the
      // generic "try again" copy.
      const own = ownSentence(err);
      const copy = describeError(err, { action: 'seal the contract', keptLocally: true });
      showAlert(own ? "Couldn't Seal the Contract" : copy.title, own ?? copy.body);
    }
  }, [project, contract, user?.id, settings?.branding]);

  const handleDownloadSealedPdf = useCallback(async () => {
    if (!contract || !user?.id) return;
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await downloadSealedContractPdf({ contract, userId: user.id, supabase });
    } catch (err) {
      console.error('[Contract] Download sealed PDF error:', err);
      // CONTRACT 25 (#147): the blocked-window sentence and the helper's own
      // download-failed sentence pass through; anything else (a raw storage
      // or network error) reads as the plain fallback.
      showAlert('Download Failed', err instanceof Error && err.message === SEALED_PDF_DOWNLOAD_FAILED_MESSAGE
        ? err.message
        : pdfFailureMessage(err, SEALED_PDF_DOWNLOAD_FAILED_MESSAGE));
    }
  }, [contract, user?.id]);

  // The practice pass opened this screen for the sample ONLY: a pick or a
  // stale id that lands anywhere else needs his own plan.
  if (practiceProjectId && project?.id !== practiceProjectId) {
    return <Paywall visible={true} feature="Contracts" requiredTier="pro" onClose={() => router.back()} />;
  }
  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolProjectPicker
          toolName="Contracts"
          message="A contract (scope, payment schedule, allowances, signatures) is written against one project."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MageContract size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Contracts inside the project tile grid.',
            'Edit the seeded draft, sign as the GC, and send to the client for counter-signature.',
          ]}
        />
      </View>
    );
  }
  if (!loading && loadFailed) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]} testID="contract-load-failed">
        <Stack.Screen options={{ headerShown: false }} />
        <AlertTriangle size={22} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.loadFailedTitle}>Couldn&apos;t Load This Job&apos;s Contract</Text>
        <Text style={styles.loadFailedText}>
          Check your signal and try again. Nothing is shown in its place, so no second contract can be started or signed.
        </Text>
        <Button
          label="Retry"
          variant="primary"
          onPress={() => { setLoadFailed(null); setLoading(true); setLoadSeq(n => n + 1); }}
          testID="contract-load-retry"
        />
        <Button label="Go Back" variant="secondary" onPress={goBack} style={{ marginTop: Tokens.spacing.sm }} testID="contract-load-back" />
      </View>
    );
  }
  if (loading || !contract) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={themeColors.accent} />
      </View>
    );
  }

  // THE SAME PREDICATE THE HANDLERS USE. It was `status === 'sent' || 'signed'`,
  // which left a VOID contract — status is 'draft' | 'sent' | 'signed' | 'void',
  // and fetchActiveContract filters only on superseded_by — rendering every
  // terms notice with buttons whose handlers all early-return on
  // contractTermsLocked: presses that neither work nor say why. It also treats
  // a draft that already carries the GC's signature as the document it is.
  const isLocked = contractTermsLocked(contract);
  const totalScheduled = contract.paymentSchedule.reduce((s, m) => s + (m.amount ?? 0), 0);
  // MEASURED AGAINST THE ORIGINAL CONTRACT SUM, DELIBERATELY (MONEY-CONTRACT-1,
  // audit 2026-09-11).
  //
  // The audit asked for this and the revised milestones to be measured against
  // the REVISED sum. Following that would create the very defect the rest of
  // this wave removes. The payment schedule divides the ORIGINAL agreement;
  // an approved change order is billed on its OWN ledger — /bill-from-estimate
  // renders a row per approved CO keyed `co:<id>` and
  // utils/changeOrderBilling.changeOrderBillingState tracks its billed-through.
  // Growing the milestones by the CO would bill every change order twice: once
  // inside the enlarged milestone and once on its own row. It would also put
  // every signed contract carrying a CO permanently into the mismatch banner
  // and disable Sign & send.
  //
  // What WAS missing is that the screen said nothing about change orders at
  // all, so a GC reading "Contract value $131,502" here had no way to
  // reconcile it with the $151,502 his reports showed. The revised-contract
  // card below states it, names each CO, and says where they bill.
  const scheduleMatchesValue = Math.abs(totalScheduled - contract.contractValue) < 1;

  // His saved split, and this job's stamp, for the terms rows below. Neither is
  // applied by rendering — only by a press.
  const profileSplit: PaymentSplit | null = resolvePaymentSplit({ settings }).split;
  // #69: the portal stamp, or the split on the proposal PDF he shared.
  const jobSplit = jobProposalSplit({ portalStamp: project.clientPortal?.proposalPaymentTerms, quoted: quotedSplitOf(project) });
  const stampSplit: PaymentSplit | null = jobSplit?.split ?? null;
  const jobSplitWhere = jobSplit?.from === 'quoted'
    ? `From the proposal you sent${jobSplit.sharedAt ? ` on ${formatCalendarDay(jobSplit.sharedAt.slice(0, 10))}` : ''}`
    : 'From the proposal your client was shown';
  const scheduleEmpty = contract.paymentSchedule.length === 0;
  const warrantyNotSet = hasWarrantyPlaceholder(contract.warrantyText);
  // A SAVED draft still holding what MAGE used to fill in. Flagged, never
  // rewritten: it is a stored value, and he may have meant it.
  const legacySchedule = !!contract.id && isLegacySeedSchedule(contract.paymentSchedule);
  // NOT A BARE EQUALITY AGAINST THE OLD PARAGRAPH. contractWarrantyText(12) IS
  // LEGACY_WARRANTY_TEXT byte for byte — the text is that paragraph with the
  // period substituted, and warrantyPeriodPhrase(12) is 'one (1) year'. So
  // `text === LEGACY_WARRANTY_TEXT` is true of HIS OWN 12-month answer, the
  // most likely answer there is, and the notice would accuse him of MAGE's
  // placeholder while its only button rewrote the identical string and left
  // the notice up. The question is "is this what his own answer would print?",
  // which is what ownWarrantyText answers.
  const ownWarrantyMonths = resolveWarrantyMonths(settings);
  const ownWarrantyText = contractWarrantyText(ownWarrantyMonths);
  const legacyWarranty = !!contract.id
    && contract.warrantyText.trim() === LEGACY_WARRANTY_TEXT
    && ownWarrantyText.trim() !== LEGACY_WARRANTY_TEXT;

  const approvedCoTotal = approvedChangeOrders.reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  const revisedContractSum = contract.contractValue + approvedCoTotal;

  // CONTRACT-TIME-1: the two columns that existed, round-tripped, and were
  // read by nothing. `timeline` is non-null only when BOTH halves are set —
  // a completion date derived from a blank start is not a date.
  const timeline = contractTimeline(contract.startDate, contract.durationDays);
  // Offered, never applied. `basis` states the working→calendar conversion so
  // the GC is not signing 90 working days under a 90-calendar-day label.
  const timelineSuggestion = project && !timeline ? suggestContractTimeline(project) : null;

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.back" />}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        </TutorialWrap>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Construction Agreement</Text>
        </View>
        <StatusPill status={contract.status} />
      </View>

      <ScrollView
        ref={contractScrollRef}
        {...fabScroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        // Pull to re-read a sent/signed contract (#119) — the homeowner can
        // sign while he is looking at it. A draft has nothing to pull: its
        // unsaved edits are the truth, and a re-read would discard them.
        refreshControl={contract.status === 'sent' || contract.status === 'signed'
          ? <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={themeColors.accent} />
          : undefined}
      >
        <MaybeScrollAnchor on={runOnThis} scrollRef={contractScrollRef}>
        {/* Centered icon-circle hero — matches the AI-feature screens
            (Construction AI, AI Punch, Payment Predictions) so the
            contract screen reads as part of the same design language. */}
        <View style={styles.contractHero}>
          <View style={styles.contractHeroIcon}>
            <FileSignature size={26} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.contractHeroTitle}>Construction Agreement</Text>
          <Text style={styles.contractHeroSub}>
            The signed contract between you and the client. Lock the scope, payment milestones, and warranty terms before work starts.
          </Text>
        </View>

        {contract.status !== 'void' && (
          <View style={{ marginBottom: 12 }}>
            <StatusPipeline
              stages={CONTRACT_PIPELINE_STAGES}
              current={contract.status}
              startedAt={contract.sentAt ?? contract.createdAt}
            />
          </View>
        )}

        {/* Title + value */}
        <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.sum" />}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Contract Title</Text>
          <TextInput
            style={[styles.input, isLocked && styles.inputDisabled]}
            value={contract.title}
            onChangeText={v => updateContract('title', v)}
            editable={!isLocked}
            placeholder="Construction Agreement"
            placeholderTextColor={themeColors.textMuted}
          />
          <Text style={[styles.cardLabel, { marginTop: 14 }]}>Contract Value</Text>
          <View style={styles.amountField}>
            <DollarSign size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            <TextInput
              style={[styles.amountInput, isLocked && styles.inputDisabled]}
              value={String(contract.contractValue || '')}
              onChangeText={v => handleValueChange(Number(v.replace(/[^0-9.]/g, '')) || 0)}
              keyboardType="numeric"
              editable={!isLocked}
              placeholder="0"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>

          {/* THE REVISED CONTRACT SUM (MONEY-CONTRACT-1). Before this, the
              contract screen contained no reference to change orders at all,
              so the figure a GC read here stopped tracking the job the day the
              first CO was approved — while every report, the portal and the
              AIA certificate moved. The AIA G701 form itself recites the
              original sum, the net of previously authorised change orders and
              the resulting sum; this says the same three things about the
              agreement the GC is actually holding. */}
          {approvedChangeOrders.length > 0 && (
            <View style={styles.revisedCard} testID="revised-contract-sum">
              <View style={styles.revisedRow}>
                <Text style={styles.revisedLabel}>Original Contract</Text>
                <Text style={styles.revisedValue}>{formatMoney(contract.contractValue)}</Text>
              </View>
              {approvedChangeOrders.map(co => (
                <View key={co.id} style={styles.revisedRow}>
                  <Text style={styles.revisedCoLabel} numberOfLines={1}>
                    CO #{co.number}{co.description ? ` — ${co.description}` : ''}
                  </Text>
                  <Text style={[
                    styles.revisedValue,
                    { color: co.changeAmount >= 0 ? themeColors.text : themeColors.success },
                  ]}>
                    {co.changeAmount >= 0 ? '+' : ''}{formatMoney(co.changeAmount)}
                  </Text>
                </View>
              ))}
              <View style={[styles.revisedRow, styles.revisedRowTotal]}>
                <Text style={styles.revisedLabelTotal}>Current Contract Sum</Text>
                <Text style={styles.revisedValueTotal}>{formatMoney(revisedContractSum)}</Text>
              </View>
              <Text style={styles.revisedCaption}>
                The payment schedule below still divides the original contract. Approved change
                orders are billed on their own lines in Bill from Estimate, so the milestones do
                not grow. That would bill each change order twice.
              </Text>
            </View>
          )}
        </View>
        </TutorialWrap>

        {/* Timeline — CONTRACT-TIME-1. Several states require a start date and
            a completion date on a residential contract, and clause 7 binds a
            change of timeline to a written Change Order for a timeline the
            document did not state. Calendar days, because that is what
            "substantial completion within N days" means to a homeowner. */}
        <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.timeline" />}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Timeline</Text>
          <Text style={styles.cardHelper}>
            When work starts and how long it runs. Both are binding terms. Changes to either need a
            signed Change Order (clause 7).
          </Text>

          <View style={styles.timelineRow}>
            <View style={styles.timelineCol}>
              <Text style={styles.timelineFieldLabel}>Start Date</Text>
              <TouchableOpacity
                style={[styles.timelineField, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setStartDatePicker(true)}
                disabled={isLocked}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Pick the Contract Start Date"
                testID="contract-start-date"
              >
                <Calendar size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={[styles.timelineFieldText, !contract.startDate && styles.timelineFieldPlaceholder]}>
                  {contract.startDate ? formatCalendarDay(contract.startDate) : 'Pick a Date'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.timelineCol}>
              <Text style={styles.timelineFieldLabel}>Duration (Calendar Days)</Text>
              <TextInput
                style={[styles.input, { marginBottom: 0 }, isLocked && styles.inputDisabled]}
                value={contract.durationDays ? String(contract.durationDays) : ''}
                onChangeText={v => {
                  const n = Number(v.replace(/[^0-9]/g, ''));
                  updateContract('durationDays', n > 0 ? n : undefined);
                }}
                keyboardType="numeric"
                editable={!isLocked}
                placeholder="120"
                placeholderTextColor={themeColors.textMuted}
                testID="contract-duration-days"
              />
            </View>
          </View>

          {timeline ? (
            <Text style={styles.timelineSentence} testID="contract-timeline-sentence">
              {contractTimelineSentence(timeline)}
            </Text>
          ) : (
            // A blocked state that says WHICH half is missing, not "incomplete".
            <Text style={styles.timelineMissing} testID="contract-timeline-missing">
              {contract.startDate
                ? 'Add a duration and this contract will state its completion date.'
                : contract.durationDays
                  ? 'Add a start date and this contract will state its completion date.'
                  : 'No dates set. This contract will not state when work starts or finishes.'}
            </Text>
          )}

          {timelineSuggestion && !isLocked ? (
            <TouchableOpacity
              style={styles.timelineSuggest}
              onPress={() => {
                setContract(prev => prev ? {
                  ...prev,
                  startDate: timelineSuggestion.startDate,
                  durationDays: timelineSuggestion.durationDays,
                } : prev);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              testID="contract-timeline-suggest"
            >
              <Text style={styles.timelineSuggestTitle}>
                Use My Schedule: {formatCalendarDay(timelineSuggestion.startDate)} to {timelineSuggestion.completionLabel}
              </Text>
              <Text style={styles.timelineSuggestBasis}>{timelineSuggestion.basis}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        </TutorialWrap>

        {/* Scope */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Scope of Work *</Text>
          <Text style={styles.cardHelper}>What you'll build, materials of note, exclusions. Be specific. This is what the client agrees to.</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, isLocked && styles.inputDisabled]}
            value={contract.scopeText}
            onChangeText={v => updateContract('scopeText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={8}
            placeholder="Describe the scope in detail"
            placeholderTextColor={themeColors.textMuted}
            textAlignVertical="top"
          />
        </View>

        {/* Payment schedule */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Payment Schedule</Text>
              <Text style={styles.cardHelper}>
                Tied to specific triggers. Total must equal contract value.
              </Text>
            </View>
            {!isLocked && (
              <TouchableOpacity style={styles.smallBtn} onPress={addMilestone}>
                <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {!isLocked && scheduleEmpty && (
            <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.paymentTerms" />}>
            <View style={styles.termsNotice} testID="contract-terms-not-set">
              <Text style={styles.termsNoticeTitle}>Payment Schedule Not Set Yet</Text>
              <Text style={styles.termsNoticeBody}>
                This contract can't be signed without one. Your deposit, progress and final split fills it in.
              </Text>
              <TouchableOpacity
                style={styles.termsNoticeBtn}
                onPress={() => askContractTerms({ terms: true, warranty: false })}
                accessibilityRole="button"
                testID="contract-set-payment-terms"
              >
                <Text style={styles.termsNoticeBtnText}>Set Your Payment Terms</Text>
              </TouchableOpacity>
            </View>
            </TutorialWrap>
          )}

          {/* THE ROWS DECIDE, NOT THE SESSION (review round 6). Only while the
              rows below still ARE that stamp — see scheduleCarriesSplit — but
              that is now the whole test. Gated on `termsSource === 'record'`
              this line, and its one-tap "Use <your split>", existed only in
              the session that seeded the draft: a saved draft sets termsSource
              to null on load, so reopening the contract dropped the sentence
              naming the proposal his client was actually shown, on rows that
              still carried it. The rows answer that question by themselves.
              termsSource is still consulted for the one thing the rows cannot
              say: when he has just pressed "Use <his own terms>" and those
              happen to equal the stamp, the rows came from that press, and
              crediting them to the proposal would name the wrong one. */}
          {!isLocked && !scheduleEmpty && termsSource !== 'profile' && stampSplit
            && scheduleCarriesSplit(contract.paymentSchedule, contract.contractValue, stampSplit) && (
            <View style={styles.termsProvenance} testID="contract-terms-provenance">
              <Text style={styles.termsProvenanceText}>
                {jobSplitWhere}: {splitLabel(stampSplit)}
              </Text>
              {profileSplit && !sameSplit(profileSplit, stampSplit) ? (
                <TouchableOpacity
                  onPress={() => applyOwnSplit(profileSplit, 'profile')}
                  accessibilityRole="button"
                  hitSlop={6}
                  testID="contract-use-current-terms"
                >
                  <Text style={styles.termsLink}>Use {splitLabel(profileSplit)}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* #69: the rows do NOT carry the split this homeowner was shown
              (the draft was seeded from his profile, or edited since). Say so
              — the deposit billed must be the one on the proposal he sent —
              unless he just chose his own terms on purpose. */}
          {!isLocked && !scheduleEmpty && !legacySchedule && termsSource !== 'profile' && stampSplit
            && !scheduleCarriesSplit(contract.paymentSchedule, contract.contractValue, stampSplit) && (
            <View style={styles.termsNotice} testID="contract-terms-mismatch">
              <Text style={styles.termsNoticeTitle}>Not the Terms Your Client Was Shown</Text>
              <Text style={styles.termsNoticeBody}>
                {jobSplitWhere}: {splitLabel(stampSplit)}. The schedule below is different. Check it before you sign.
              </Text>
              <TouchableOpacity
                style={styles.termsNoticeBtn}
                onPress={() => applyOwnSplit(stampSplit, 'record')}
                accessibilityRole="button"
                testID="contract-use-proposal-terms"
              >
                <Text style={styles.termsNoticeBtnText}>Use {splitLabel(stampSplit)}</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isLocked && legacySchedule && (
            <View style={styles.termsNotice} testID="contract-legacy-schedule">
              <Text style={styles.termsNoticeTitle}>MAGE's Old Placeholder, Not Your Terms</Text>
              <Text style={styles.termsNoticeBody}>
                This draft still has the 25 / 25 / 25 / 25 schedule MAGE filled in. Nobody chose it. Check it before you sign.
              </Text>
              {profileSplit ? (
                <TouchableOpacity
                  style={styles.termsNoticeBtn}
                  onPress={() => applyOwnSplit(profileSplit, 'profile')}
                  accessibilityRole="button"
                  testID="contract-legacy-reset-terms"
                >
                  <Text style={styles.termsNoticeBtnText}>Reset to Your Terms ({splitLabel(profileSplit)})</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.termsNoticeBtn}
                  onPress={() => askContractTerms({ terms: true, warranty: false })}
                  accessibilityRole="button"
                  testID="contract-legacy-set-terms"
                >
                  <Text style={styles.termsNoticeBtnText}>Set Your Payment Terms</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {contract.paymentSchedule.map((m) => {
            const bill = billabilityFor(m);
            return (
              <MilestoneRow
                key={m.id}
                milestone={m}
                locked={isLocked}
                onChange={patch => updateMilestone(m.id, patch)}
                onRemove={() => removeMilestone(m.id)}
                billability={contract.status === 'signed' ? bill : null}
                paidByInvoices={paidMilestoneIds.has(m.id)}
                onCreateInvoice={() => handleCreateInvoiceFromMilestone(m)}
                onBillProgress={() => router.push({ pathname: '/bill-from-estimate', params: { projectId } } as never)}
                onOpenInvoice={bill.existingInvoiceId
                  ? () => router.push({ pathname: '/invoice', params: { projectId: projectId!, invoiceId: bill.existingInvoiceId! } } as never)
                  : undefined}
              />
            );
          })}

          {/* What the OTHER ledger has already drawn on this contract
              (MONEY-LEDGER-1). Without this line the cross-ledger refusal on a
              milestone row arrives with no explanation on screen — the GC has
              no way to see that /bill-from-estimate already billed the work. */}
          {billedOnContract > 0.005 && (
            <View style={styles.scheduleTotalRow}>
              <Text style={styles.scheduleTotalLabel}>Already Invoiced on This Contract</Text>
              <Text style={styles.scheduleTotalValue} testID="contract-billed-to-date">
                {formatMoney(billedOnContract)}
                {contract.contractValue > 0
                  ? ` · ${formatMoney(Math.max(0, contract.contractValue - billedOnContract))} left`
                  : ''}
              </Text>
            </View>
          )}

          <View style={styles.scheduleTotalRow}>
            <Text style={styles.scheduleTotalLabel}>Total Scheduled</Text>
            <Text style={[
              styles.scheduleTotalValue,
              !scheduleMatchesValue && { color: themeColors.accent },
            ]}>
              {formatMoney(totalScheduled)}
            </Text>
          </View>

          {/* Mismatch banner — moved out of the inline total so the
              warning gets its own row instead of crashing into the dollar
              amount. Reads more like a real "this is wrong" alert. */}
          {!scheduleMatchesValue && !(scheduleEmpty && !isLocked) && (
            <View style={styles.scheduleMismatchBanner}>
              {/* The Sign & send clause only where that button exists: the
                  whole action row is gated on status === 'draft', so on a sent
                  or signed contract it promised something about a control that
                  is not on the screen. */}
              <Text style={styles.scheduleMismatchText}>
                Total doesn't match contract value of {formatMoney(contract.contractValue)}
                {contract.status === 'draft' ? '. Sign and Send stays off until it does.' : '.'}
              </Text>
              {!isLocked && (profileSplit ? (
                <TouchableOpacity
                  style={styles.rebalanceBtn}
                  onPress={() => applyOwnSplit(profileSplit, 'profile')}
                  accessibilityRole="button"
                  testID="contract-reset-terms"
                >
                  <Text style={styles.rebalanceText}>Reset to Your Terms ({splitLabel(profileSplit)})</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.rebalanceBtn}
                  onPress={() => askContractTerms({ terms: true, warranty: false })}
                  accessibilityRole="button"
                  testID="contract-mismatch-set-terms"
                >
                  <Text style={styles.rebalanceText}>Set Your Payment Terms</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Allowances */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Allowances (Optional)</Text>
              <Text style={styles.cardHelper}>
                Budget set aside for finishes the client picks (cabinets, fixtures, tile, etc.).
                Overruns trigger a Change Order.
              </Text>
            </View>
            {!isLocked && (
              <TouchableOpacity style={styles.smallBtn} onPress={addAllowance}>
                <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
          {contract.allowances.map(a => (
            <View key={a.id} style={styles.allowanceRow}>
              <TextInput
                style={[styles.allowanceCategory, isLocked && styles.inputDisabled]}
                value={a.category}
                onChangeText={v => updateAllowance(a.id, { category: v })}
                editable={!isLocked}
                placeholder="Category"
                placeholderTextColor={themeColors.textMuted}
              />
              <View style={styles.allowanceAmountField}>
                <DollarSign size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                <TextInput
                  style={[styles.allowanceAmount, isLocked && styles.inputDisabled]}
                  value={String(a.amount || '')}
                  onChangeText={v => updateAllowance(a.id, { amount: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                  keyboardType="numeric"
                  editable={!isLocked}
                  placeholder="0"
                  placeholderTextColor={themeColors.textMuted}
                />
              </View>
              {!isLocked && (
                <TouchableOpacity onPress={() => removeAllowance(a.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {contract.allowances.length === 0 && (
            <Text style={styles.allowanceEmpty}>
              No allowances yet. Tap Add to set a budget for fixtures, finishes, or any client-picked items.
            </Text>
          )}
        </View>

        {/* Terms */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Terms and Conditions</Text>
          <TextInput
            style={[styles.input, styles.inputTermsMultiline, isLocked && styles.inputDisabled]}
            value={contract.termsText}
            onChangeText={v => updateContract('termsText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
          />
        </View>

        {/* Warranty */}
        <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.warranty" />}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Warranty</Text>
          {!isLocked && warrantyNotSet && (
            <View style={styles.termsNotice} testID="contract-warranty-not-set">
              <Text style={styles.termsNoticeTitle}>Warranty Period Not Set Yet</Text>
              <Text style={styles.termsNoticeBody}>
                The paragraph below says how long you warrant your work once you set it. This contract can't be signed until then.
              </Text>
              <TouchableOpacity
                style={styles.termsNoticeBtn}
                onPress={() => askContractTerms({ terms: false, warranty: true })}
                accessibilityRole="button"
                testID="contract-set-warranty"
              >
                <Text style={styles.termsNoticeBtnText}>Set Your Warranty</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Two true sentences, not one guess. With no saved warranty nobody
              HAS chosen this paragraph and the button opens the ask; with a
              saved warranty of some other length this paragraph simply is not
              it, and the button writes his — so the label says which. */}
          {!isLocked && legacyWarranty && (
            <View style={styles.termsNotice} testID="contract-legacy-warranty">
              <Text style={styles.termsNoticeTitle}>
                {ownWarrantyMonths == null
                  ? "MAGE's Old Placeholder, Not Your Terms"
                  : 'This paragraph is not your warranty'}
              </Text>
              <Text style={styles.termsNoticeBody}>
                {ownWarrantyMonths == null
                  ? 'This paragraph still promises the one-year warranty MAGE filled in. Nobody chose it. Check it before you sign.'
                  : `This paragraph promises one (1) year. Your saved warranty is ${warrantyShortLabel(ownWarrantyMonths)}. Check which one this job should carry.`}
              </Text>
              <TouchableOpacity
                style={styles.termsNoticeBtn}
                onPress={() => askContractTerms({ terms: false, warranty: true })}
                accessibilityRole="button"
                testID="contract-legacy-set-warranty"
              >
                <Text style={styles.termsNoticeBtnText}>
                  {ownWarrantyMonths == null ? 'Set Your Warranty' : `Use your ${warrantyShortLabel(ownWarrantyMonths)}`}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            style={[styles.input, styles.inputMultiline, isLocked && styles.inputDisabled]}
            value={contract.warrantyText}
            onChangeText={v => updateContract('warrantyText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>
        </TutorialWrap>

        {/* Signatures */}
        {(contract.gcSignature || contract.homeownerSignature) && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Signatures</Text>
            {contract.gcSignature && (
              <SignatureBlock label="Contractor" name={contract.gcSignature.name} signedAt={contract.gcSignature.signedAt} />
            )}
            {contract.homeownerSignature && (
              <SignatureBlock
                label="Client"
                name={contract.homeownerSignature.name}
                signedAt={contract.homeownerSignature.signedAt}
                how={homeownerSignatureMethodLabel(contract.homeownerSignature)}
              />
            )}
          </View>
        )}

        {/* Sign & send was pressed, the missing terms were just filled in, and
            the signature pad did NOT open. Without this the press looks like
            it did nothing: see reviewBeforeSigning for why this is a notice on
            the page and not a second toast. */}
        {reviewBeforeSigning && contract.status === 'draft' && (
          <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.reviewNotice" />}>
          <View style={styles.termsNotice} testID="contract-review-before-signing">
            <Text style={styles.termsNoticeTitle}>Your Terms Are on This Contract</Text>
            <Text style={styles.termsNoticeBody}>
              Review it, the payment schedule and warranty above, then tap Sign and Send.
            </Text>
          </View>
          </TutorialWrap>
        )}

        {contract.status === 'draft' && (
          <NyContractChecklist project={project} contract={contract} branding={settings?.branding} revealSignal={nyReveal}
            scrollRef={contractScrollRef} onOpenProfile={() => router.push('/company-profile')} testID="contract-ny-checklist" />
        )}

        {/* Action bar */}
        {contract.status === 'draft' && (
          <ActionBar style={styles.actionRow} width="form">
            <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.saveDraft" style={{ flex: 1 }} />}>
            <Button
              label="Save Draft"
              onPress={handleSaveDraft}
              variant="secondary"
              loading={saving}
              iconLeft={<Edit3 size={14} color={themeColors.text} strokeWidth={1.75} />}
              style={{ flex: 1 }}
            />
            </TutorialWrap>
            {/* Sign & send stays pressable on a sample (its disabled rule is
                pinned by validate-money-definitions): the press refuses with
                SAMPLE_DOC_NOT_SENT, which also prints under this row. */}
            <TutorialWrap on={runOnThis} wrap={<TutorialTarget id="contract.sign" style={{ flex: 1 }} />}>
            <Button
              label="Sign and Send"
              onPress={handleSignPress}
              disabled={(contract.paymentSchedule.length > 0 && !scheduleMatchesValue) || saving}
              iconLeft={<FileSignature size={16} color="#FFF" strokeWidth={1.75} />}
              style={{ flex: 1 }}
            />
            </TutorialWrap>
          </ActionBar>
        )}
        {/* C1: the homeowner is at the kitchen table — both sign on this
            phone, no email, none claimed. Same gates as Sign & send. */}
        {contract.status === 'draft' && (
          <Button
            label="Sign Together Now"
            variant="secondary"
            onPress={handleSignTogetherPress}
            disabled={(contract.paymentSchedule.length > 0 && !scheduleMatchesValue) || saving || sampleJob}
            iconLeft={<FileSignature size={14} color={themeColors.text} strokeWidth={1.75} />}
            style={{ marginTop: 10 }}
            testID="contract-sign-together"
          />
        )}
        {contract.status === 'draft' && sampleJob && (
          <Text style={[styles.cardHelper, { marginTop: 8 }]} testID="contract-sample-note">{SAMPLE_DOC_NOT_SENT}</Text>
        )}

        {/* C1: "Sent to the homeowner" only when THIS device saw the email
            go out (the local delivery marker). A failed send says so, with
            Retry and Copy link; with no marker (another device, or signed
            together) the line says only what is true everywhere. */}
        {contract.status === 'sent' && contractDelivery?.state === 'delivered' && (
          <View style={styles.statusBanner}>
            <Send size={16} color={themeColors.accent} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitle}>Sent to the Client</Text>
              <Text style={styles.statusBannerBody}>
                You'll be notified when they sign. Until then this contract is read-only.
                If they signed in person or on paper, record it here so the deposit can be billed.
              </Text>
            </View>
          </View>
        )}
        {contract.status === 'sent' && contractDelivery?.state === 'not_delivered' && (
          <View style={[styles.statusBanner, { backgroundColor: themeColors.warningSoft, borderColor: themeColors.warningLabel + '40' }]} testID="contract-not-delivered">
            <AlertTriangle size={16} color={themeColors.warningLabel} strokeWidth={1.75} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={[styles.statusBannerTitle, { color: themeColors.warningLabel }]}>Signed by You, Not Delivered</Text>
              <Text style={styles.statusBannerBody}>
                {contractDelivery.reason === 'send_failed'
                  ? 'The email to the client did not go out. Nothing reached them yet. Try again, or copy the signing link and text it.'
                  : 'Nothing was emailed to the client. Fix what is missing and try again, or copy the signing link and text it.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  label={retryingDelivery ? 'Sending…' : 'Retry'}
                  onPress={() => { void retryDelivery(); }}
                  loading={retryingDelivery}
                  disabled={retryingDelivery}
                  containerStyle={{ flex: 1 }}
                  testID="contract-delivery-retry"
                />
                <Button
                  label="Copy Link"
                  variant="secondary"
                  onPress={() => { void copyContractLink(); }}
                  containerStyle={{ flex: 1 }}
                  testID="contract-delivery-copy"
                />
              </View>
            </View>
          </View>
        )}
        {contract.status === 'sent' && !contractDelivery && (
          <View style={styles.statusBanner} testID="contract-signed-by-you">
            <FileSignature size={16} color={themeColors.accent} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitle}>Signed by You, Waiting on the Client</Text>
              <Text style={styles.statusBannerBody}>
                {portalDeliveryState(project, user?.id ?? null) === 'ready'
                  ? 'They can review and counter-sign from their client portal link. Until then this contract is read-only. If they signed in person or on paper, record it here so the deposit can be billed.'
                  : 'This device has no record of the portal link reaching them. Share it from the client portal, or if they signed in person or on paper, record it here so the deposit can be billed.'}
              </Text>
            </View>
          </View>
        )}
        {contract.status === 'sent' && (
          <Button
            label="Record Client Signature"
            variant="secondary"
            onPress={() => setRecordModal(true)}
            iconLeft={<FileSignature size={14} color={themeColors.text} strokeWidth={1.75} />}
            style={{ marginTop: 10 }}
            testID="contract-record-homeowner-signature"
          />
        )}

        {contract.status === 'signed' && (
          <>
            <View style={[styles.statusBanner, { backgroundColor: themeColors.success + '0D', borderColor: themeColors.success + '30' }]}>
              <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusBannerTitle, { color: themeColors.success }]}>Signed by Both Parties</Text>
                <Text style={styles.statusBannerBody}>
                  Binding agreement on file. Invoices on this project should reference it.
                </Text>
              </View>
            </View>
            {/* A4: a contract the client signed in person was sealed on the spot
                (auto-seal); this tap is only its retry. Portal and paper
                signatures seal with the slide below. */}
            {!contract.signedPdfUrl && contract.homeownerSignature?.method === 'in_person' && (
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
                onPress={() => { void handleSealSignedContract(); }}
                accessibilityRole="button"
                accessibilityLabel="Seal and Save Signed PDF"
                testID="contract-seal-btn"
              >
                <FileText size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.primaryBtnText}>Seal and Save Signed PDF</Text>
              </TouchableOpacity>
            )}
            {!contract.signedPdfUrl && contract.homeownerSignature?.method !== 'in_person' && (
              <SlideToConfirm
                label={signingCopy.sealLabel()}
                busyLabel={signingCopy.sealBusyLabel()}
                srLabel={signingCopy.sealSrLabel()}
                srConfirm={signingCopy.sealSrConfirm()}
                onCommit={sealWrite}
                writeOptions={{
                  idempotent: false,
                  legal: true,
                  copy: {
                    refused: signingCopy.sealRefused(),
                    timeout: signingCopy.contractTimeout(),
                    legalQueued: signingCopy.sealLegalQueued(),
                    offline: signingCopy.sealOffline(),
                  },
                }}
                tone="ink"
                resultIcon="lock"
                offline={offline}
                onDone={onSealDone}
                onResultAfterUnmount={onSealDone}
                onLateResult={onSealLateResult}
                style={{ marginTop: 10 }}
                testID="contract-seal-slide"
              />
            )}
            {contract.signedPdfUrl && (
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
                onPress={() => { void handleDownloadSealedPdf(); }}
                accessibilityRole="button"
                accessibilityLabel="Download Sealed Signed PDF"
                testID="contract-download-sealed-btn"
              >
                <FileText size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.primaryBtnText}>Download Signed PDF</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 0, alignSelf: 'stretch', marginTop: 10 }]}
              onPress={() => router.push({ pathname: '/bill-from-estimate', params: { projectId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Create First Invoice"
            >
              <Plus size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.primaryBtnText}>Create First Invoice</Text>
            </TouchableOpacity>
          </>
        )}
        </MaybeScrollAnchor>
      </ScrollView>

      {/* "Ask when it matters" — rendered once. Opened only by a press. */}
      <ClientDocumentAskSheet {...gate.sheet} />

      {/* #67: record a homeowner signature given in person or on paper */}
      <RecordHomeownerSignatureModal
        visible={recordModal}
        onClose={closeRecordModal}
        contract={contract}
        projectName={project.name}
        clientName={resolveClientContact(project)?.name ?? ''}
        gcName={user?.name ?? ''}
        together={togetherRecordRef.current}
        offline={offline}
        recordInPerson={recordInPerson}
        recordPaper={recordPaper}
        isNeutral={isRecordNeutral}
        recordFrom={recordInPersonFrom}
        onBinding={runAutoSealOnce}
        autoSeal={autoSeal}
        onLateResult={onRecordLateResult}
        onResultAfterUnmount={onRecordResultAfterUnmount}
      />

      {/* Signature modal (A1: the contractor's signing ceremony) */}
      <SignatureModal
        visible={signatureModal}
        onClose={() => setSignatureModal(false)}
        onSign={handleSignAndSend}
        defaultName={user?.name ?? user?.email ?? ''}
        inPerson={padInPerson}
        contract={contract}
        projectName={project.name}
        offline={offline}
        moment={gcMomentRef.current}
        recordFrom={gcRecordFrom}
        onDone={onSignCeremonyDone}
        onLateResult={onSignLateResult}
        // T2: the stale-price check, opened by the sign press, in the ceremony's `above` slot.
        above={driftAsk && contract?.status === 'draft' ? (
          <PriceDriftCheck
            project={project}
            presentation="card"
            action="sign"
            repricedNote={driftNote}
            onReprice={handleDriftRepriced}
            onKeep={continueSignPastDrift}
            onContinue={continueSignPastDrift}
          />
        ) : undefined}
      />

      {/* C1: "Where should we send it?" — mounted only while it is open. */}
      {deliveryAsk && (
        <Sheet
          visible
          onClose={() => setDeliveryAsk(null)}
          title={deliveryAsk.state === 'no_signing_key' ? 'Getting the signing link ready…' : 'Who gets the contract?'}
          subtitle={deliveryAsk.state === 'no_signing_key'
            ? undefined
            : 'The client gets a link to review and counter-sign. Nothing is signed or sent until you do.'}
          primaryAction={{
            label: deliveryAsk.state === 'no_signing_key'
              ? 'Retry'
              : project?.clientPortal?.portalId && !project.clientPortal.enabled
                ? 'Turn On the Portal and Continue'
                : project?.clientPortal?.portalId ? 'Save and Continue' : 'Save the Email',
            onPress: saveDeliveryAsk,
            loading: savingDeliveryAsk,
            disabled: deliveryAsk.state !== 'no_signing_key' && !isUsableEmail(deliveryAsk.email),
            disabledReason: deliveryAsk.state !== 'no_signing_key' && !isUsableEmail(deliveryAsk.email) ? 'Type the client\'s email first' : undefined,
          }}
          secondaryAction={{ label: 'Sign Together Now Instead', onPress: signTogetherFromAsk }}
          testID="contract-delivery-ask"
        >
          {deliveryAsk.state === 'no_signing_key' ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.statusBannerBody}>
                This project&apos;s portal is on, but its secure signing link isn&apos;t ready yet. Open the client portal once to finish it, then come back and tap Retry.
              </Text>
              <Button
                label="Open Client Portal"
                variant="secondary"
                onPress={() => { const id = project?.id; setDeliveryAsk(null); if (id) router.push({ pathname: '/client-portal-setup', params: { id } }); }}
                testID="contract-delivery-open-portal"
              />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={styles.cardLabel}>Client Email</Text>
              <TextInput
                style={styles.input}
                value={deliveryAsk.email}
                onChangeText={(email) => setDeliveryAsk(prev => (prev ? { ...prev, email } : prev))}
                placeholder="name@example.com"
                placeholderTextColor={themeColors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="contract-delivery-email"
              />
              {!portalDeliveryFacts(project, user?.id ?? null).portalOn && (
                <Text style={styles.statusBannerBody} testID="contract-delivery-portal-line">
                  {project?.clientPortal?.portalId
                    ? 'Sending turns on this project\'s client portal. Your client will see the schedule, invoices, change orders and photos there.'
                    : 'This project has no client portal yet. The client signs through it, and it shows them the schedule, invoices, change orders and photos. Saving keeps the email and takes you to set it up.'}
                </Text>
              )}
            </View>
          )}
        </Sheet>
      )}

      {/* CONTRACT-TIME-1. This render was MISSING on first pass: the field
          above set `startDatePicker` true and nothing listened, so the start
          date was a dead tap on every platform and the whole timeline card was
          inert unless the project happened to have a schedule to seed from.
          scripts/validate-money-definitions.ts §6 now asserts the render, not
          just the control.

          DatePickerModal emits a NOON-UTC instant; `.slice(0, 10)` takes the
          day the GC actually tapped. `toCalendarDayString(new Date(iso))` reads
          LOCAL components off that instant, which in UTC+13 is the NEXT day —
          a contract commencing one day after the one he picked. */}
      <DatePickerModal
        visible={startDatePicker}
        value={contract.startDate ?? ''}
        allowFuture
        title="Contract Start Date"
        onClose={() => setStartDatePicker(false)}
        onChange={(iso) => {
          updateContract('startDate', iso.slice(0, 10));
          setStartDatePicker(false);
        }}
      />
      {/* Tutorial blocker sentinel: while any of this screen's layer-less
          sheets is up (they draw above the root coach layer on iOS), the coach
          draws nothing. Only while a run is live on this job. */}
      {runOnThis && (
        gate.sheet.visible || signatureModal || recordModal || !!deliveryAsk || startDatePicker
      ) ? <TutorialTarget id="contract.modalUp" /> : null}
    </View>
  );
}

/** The scroll anchor only during a tutorial run (a composite with no host
 *  View of its own when off, so the tree is unchanged). */
function MaybeScrollAnchor({ on, scrollRef, children }: {
  on: boolean; scrollRef: React.RefObject<ScrollView | null>; children: React.ReactNode;
}) {
  return on ? <TutorialScrollAnchor scrollRef={scrollRef}>{children}</TutorialScrollAnchor> : <>{children}</>;
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatusPill({ status }: { status: ProjectContract['status'] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  // Use the shared statusPillStyle helper so SIGNED / SENT / VOID /
  // DRAFT match the same green/amber/red/gray scheme used on lien
  // waivers and the closeout binder header.
  const label = (status ?? 'draft').toUpperCase();
  const { color, backgroundColor } = statusPillStyle(status);
  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function MilestoneRow({ milestone, locked, onChange, onRemove, billability, onCreateInvoice, onBillProgress, onOpenInvoice, paidByInvoices }: {
  milestone: PaymentMilestone;
  /** PAID as the linked invoices say (milestonePaidFromInvoices) — the
   *  stored status can lag behind a Pay-link payment or a lost flip. */
  paidByInvoices?: boolean;
  locked: boolean;
  onChange: (patch: Partial<PaymentMilestone>) => void;
  onRemove: () => void;
  /** null while the contract isn't signed — the billing action stays hidden. */
  billability?: MilestoneBillability | null;
  onCreateInvoice?: () => void;
  /** An `on_invoice` row opens Bill from Estimate instead of a lump invoice. */
  onBillProgress?: () => void;
  onOpenInvoice?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const isPaid = paidByInvoices ?? milestone.status === 'paid';
  const isProgressRow = milestone.trigger === 'on_invoice';
  // WHY A PROGRESS ROW HAS NO "PENDING". The progress stage is drawn against
  // from Bill from Estimate, which writes its own lines and stamps no
  // sourceMilestoneId — so nothing ever flips this row and its status stays
  // 'pending' however much of the 65% has already been invoiced. PENDING on a
  // row that is half drawn states a fact that stopped being true. The row has
  // no single billing state to report, and the contract-wide figure below
  // ("Already invoiced on this contract") would be a guess about THIS row, so
  // the pill says the only thing that stays true: this is the row the work is
  // billed against as it gets done. A hand-set paid / invoiced / skipped still
  // wins — that is a state somebody chose.
  const cfg =
    isPaid                          ? { bg: themeColors.success + '15', color: themeColors.success, label: 'Paid' } :
    milestone.status === 'paid'     ? { bg: themeColors.accent + '15', color: themeColors.accent, label: 'Invoiced' } :
    milestone.status === 'invoiced' ? { bg: themeColors.accent + '15', color: themeColors.accent, label: 'Invoiced' } :
    milestone.status === 'skipped'  ? { bg: themeColors.surfaceAlt,  color: themeColors.textMuted, label: 'Skipped' } :
    isProgressRow                   ? { bg: themeColors.surfaceAlt, color: themeColors.textMuted, label: 'As Work Is Done' } :
                                       { bg: themeColors.surfaceAlt, color: themeColors.textMuted, label: 'Pending' };
  // Signing, progress and final read exactly as the sealed PDF and the invoice
  // line print them (utils/paymentTerms.milestoneDueText) — "Billed as work is
  // completed", not "On invoice", which read as "one invoice".
  const triggerLabel =
    milestone.trigger === 'on_signing' || milestone.trigger === 'on_final' || milestone.trigger === 'on_invoice'
      ? milestoneDueText(milestone)
    : milestone.trigger === 'on_date'    ? `On ${milestone.triggerDate ?? 'date'}`
    : (milestone.triggerMilestone || 'On milestone');

  return (
    <View style={styles.milestoneCard}>
      {/* Top row: status pill on left, trash on far right.
          Pill sits OUTSIDE the input area so there's no overlap, no
          cramped feeling. Trash is its own column with explicit width. */}
      <View style={styles.milestoneHeader}>
        <View style={[styles.milestoneStatus, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.milestoneStatusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {!locked && (
          <TouchableOpacity onPress={onRemove} hitSlop={8} style={styles.milestoneTrash} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
        )}
      </View>

      {/* Label input — clearly bordered, full width, with a small caption
          ABOVE so the user knows what they're editing. Replaces the
          "text floating in a box" anti-pattern. */}
      <Text style={styles.milestoneFieldLabel}>Milestone</Text>
      <TextInput
        style={[styles.milestoneLabelInput, locked && styles.inputDisabled]}
        value={milestone.label}
        onChangeText={v => onChange({ label: v })}
        editable={!locked}
        placeholder="25% Deposit"
        placeholderTextColor={themeColors.textMuted}
      />

      {/* Amount + Trigger row — two columns with explicit flex so they
          can't overlap. Amount is the bigger box (flex 1), trigger is
          the smaller display column (flex 1.2 since text wraps). */}
      <View style={styles.milestoneFieldsRow}>
        <View style={styles.milestoneFieldCol}>
          <Text style={styles.milestoneFieldLabel}>Amount</Text>
          <View style={styles.milestoneAmountBox}>
            <DollarSign size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <TextInput
              style={[styles.milestoneAmountInput, locked && styles.inputDisabled]}
              value={String(milestone.amount ?? '')}
              // A typed amount clears the percent: billing bills a percent row
              // as cents(value × pct) and ignores `amount`, so leaving it set
              // would invoice a number other than the one he just typed.
              onChangeText={v => onChange({ amount: Number(v.replace(/[^0-9.]/g, '')) || 0, percent: undefined })}
              keyboardType="numeric"
              editable={!locked}
              placeholder="0"
              placeholderTextColor={themeColors.textMuted}
            />
          </View>
        </View>
        <View style={styles.milestoneFieldCol}>
          <Text style={styles.milestoneFieldLabel}>Trigger</Text>
          <View style={styles.milestoneTriggerBox}>
            <Text style={styles.milestoneTriggerText} numberOfLines={2}>
              {triggerLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* Trigger description (shown only for 'on_milestone' type) — full
          width, gets its own labelled input below the row above. */}
      {milestone.trigger === 'on_milestone' && !locked && (
        <>
          <Text style={[styles.milestoneFieldLabel, { marginTop: 10 }]}>Trigger Description</Text>
          <TextInput
            style={styles.milestoneTriggerInput}
            value={milestone.triggerMilestone ?? ''}
            onChangeText={v => onChange({ triggerMilestone: v })}
            placeholder="Foundation pour complete and inspected"
            placeholderTextColor={themeColors.textMuted}
          />
        </>
      )}

      {/* One-tap bill. The dollar figure printed here is the amount the
          invoice will actually carry — for a % milestone that's derived live
          from the contract value, not the cached `amount`, so the GC never
          taps through to a different number than the one they read. */}
      {/* THE SAME BILLABILITY THE LUMP BUTTON USES, read for what a PROGRESS
          row can do with it (progressRowOpen). Offered on `billability` alone,
          this action outlived every reason there was nothing left to bill — a
          skipped row, a paid one, a contract at its ceiling. Gated on
          `billable` outright, it instead died at the ceiling on a row that
          never bills its own amount: see progressRowOpen for why the ceiling
          is the one refusal that does not apply here. A progress row never
          gets an existingInvoiceId (bill-from-estimate writes its own lines
          and stamps no sourceMilestoneId), so the "Billed" row below can never
          speak for it: when it really is closed, the reason is printed here
          instead of the action silently vanishing. */}
      {billability && isProgressRow && !billability.existingInvoiceId && progressRowOpen(billability) && (
        <TouchableOpacity
          style={styles.milestoneBillBtn}
          onPress={onBillProgress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Bill progress for ${milestone.label} in Bill from Estimate`}
          testID={`milestone-bill-progress-${milestone.id}`}
        >
          <Receipt size={14} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.milestoneBillBtnText}>Bill Progress</Text>
        </TouchableOpacity>
      )}
      {billability && isProgressRow && !progressRowOpen(billability) && !billability.existingInvoiceId && billability.reason && (
        <Text style={styles.milestoneBlockNote} testID={`milestone-progress-blocked-${milestone.id}`}>
          {milestoneBlockMessage(billability.reason, billability.ceiling, billability.amount)}
        </Text>
      )}
      {billability?.billable && milestone.trigger !== 'on_invoice' && (
        <TouchableOpacity
          style={styles.milestoneBillBtn}
          onPress={onCreateInvoice}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Create invoice for ${milestone.label}`}
          testID={`milestone-create-invoice-${milestone.id}`}
        >
          <Receipt size={14} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.milestoneBillBtnText}>
            Create Invoice · {formatMoney(billability.amount)}
          </Text>
        </TouchableOpacity>
      )}
      {billability && !billability.billable && billability.existingInvoiceId && (
        <TouchableOpacity
          style={styles.milestoneBilledRow}
          onPress={onOpenInvoice}
          disabled={!onOpenInvoice}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Open the Invoice Billed from This Milestone"
          testID={`milestone-open-invoice-${milestone.id}`}
        >
          <CheckCircle2 size={13} color={themeColors.success} strokeWidth={1.75} />
          <Text style={styles.milestoneBilledText}>
            {isPaid ? 'Paid' : 'Billed'}, already on an invoice
          </Text>
          <Text style={styles.milestoneBilledLink}>Open</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function SignatureBlock({ label, name, signedAt, how }: { label: string; name: string; signedAt: string; how?: string | null }) {
  const styles = useThemedStyles(makeStyles);
  // A paper signature is dated to its calendar day (noon UTC) — print that day,
  // never a locale date that can slip a day across time zones.
  const day = /^\d{4}-\d{2}-\d{2}T12:00:00(\.000)?Z$/.test(signedAt)
    ? formatCalendarDay(signedAt.slice(0, 10))
    : new Date(signedAt).toLocaleDateString();
  return (
    <View style={styles.sigBlock}>
      <Text style={styles.sigLabel}>{label}</Text>
      <Text style={styles.sigName}>{name}</Text>
      <Text style={styles.sigDate}>Signed {day}</Text>
      {!!how && <Text style={styles.sigDate}>{how}</Text>}
    </View>
  );
}

/** The rows on the ceremony's top panel: the contract value (cents) and the timeline. */
function contractCeremonyTop(contract: ProjectContract, projectName: string): SigningCeremonyProps['top'] {
  const rows: SigningCeremonyProps['top']['rows'] = [
    { label: signingCopy.contractValueRowLabel(), value: formatMoney(contract.contractValue ?? 0, 2), mono: true },
  ];
  const t = contractTimeline(contract.startDate, contract.durationDays);
  if (t) rows.push({ label: signingCopy.contractTimelineRowLabel(), value: signingCopy.contractTimelineValue(t.startLabel, t.completionLabel) });
  return { title: signingCopy.contractDocTitle(contract.title ?? ''), subtitle: projectName, rows };
}

/** Why the contract cannot be signed from this sheet yet, or null. */
function contractSignBlockReason(contract: ProjectContract | null): string | null {
  if (!contract) return signingCopy.contractTermsReason();
  if (contract.paymentSchedule.length === 0) return signingCopy.contractTermsReason();
  if (hasWarrantyPlaceholder(contract.warrantyText)) return signingCopy.contractWarrantyReason();
  return null;
}

/** The ceremony's height budget on the in-person hand-off (card + name field + hand-back). */
const HANDOFF_MIN_HEIGHT = 600;

type GcMoment = { fold: NonNullable<SigningCeremonyProps['fold']>; sentAnnounce: string };

/**
 * A1: the contractor's signature (moments, lane MOMSIGN). A signing ceremony
 * on the line skin: sign above the line, slide along it, and only when the
 * write comes back confirmed does the seal land; for sign & send the letter
 * then folds and its back face says whether the email went out. Refusals and
 * timeouts speak inside the sheet (the iOS dismiss-plus-alert trap is gone),
 * the strokes and the name stay, and the sheet closes in onDone.
 */
export function SignatureModal({
  visible, onClose, onSign, defaultName, inPerson = false, contract, projectName, offline, moment,
  recordFrom, onDone, onLateResult, above,
}: {
  visible: boolean;
  onClose: () => void;
  onSign: (paths: string[], typedName: string) => Promise<CommitResult>;
  defaultName: string;
  /** C1 "Sign together now": his signature first, then the client's on
   *  this phone. Nothing is emailed, so the words never say "send". */
  inPerson?: boolean;
  contract: ProjectContract | null;
  projectName: string;
  offline: boolean;
  /** The fold and its announce, updated by the write before it returns (read live by the ceremony). */
  moment: GcMoment;
  recordFrom: SigningCeremonyProps['recordFrom'];
  onDone: (r: CommitResult) => void;
  onLateResult: (r: CommitResult) => void;
  /** T2 (ideas-1): the stale-price check, shown in the ceremony's `above` slot over the signing card. */
  above?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const [paths, setPaths] = useState<string[]>([]);
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPaths([]);
      setTypedName(defaultName);
      setBusy(false);
    }
  }, [visible, defaultName]);
  const fSign = useSheetFrame('form', { visible, animationType: 'slide' });
  // The slide is the commit: no Cmd+Enter and never Cmd+S (useSheetFrame
  // already holds the dialog scope, so the page's own shortcuts stay off).
  const blockReason = contractSignBlockReason(contract);
  const write = useCallback(() => onSign(paths, typedName), [onSign, paths, typedName]);
  const copy = useMemo(() => ({
    label: inPerson ? signingCopy.contractSignFirstLabel() : signingCopy.contractSignSendLabel(),
    srLabel: inPerson ? signingCopy.contractSignFirstSrLabel() : signingCopy.contractSignSendSrLabel(),
    srConfirm: inPerson ? signingCopy.contractSignFirstSrConfirm() : signingCopy.contractSignSendSrConfirm(),
    sealedAnnounce: signingCopy.contractGcSealedAnnounce(),
    // Read when the letter folds, after the write said whether the email went out.
    get sentAnnounce() { return moment.sentAnnounce; },
  }), [inPerson, moment]);

  return (
    <Modal visible={visible} animationType={fSign.animationType} transparent onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={[styles.modalOverlay, fSign.overlay]}>
        <View style={[styles.modalCard, fSign.card]} testID="contract-sign-sheet">
          <Text style={styles.modalTitle}>{inPerson ? 'Your Signature First' : 'Sign and Send'}</Text>
          <Text style={styles.modalBody}>
            {inPerson
              ? 'Sign below and type your full legal name. Nothing is emailed. Next, hand the phone to the client to sign.'
              : 'Sign below and type your full legal name. The contract becomes binding when the client counter-signs in their portal.'}
          </Text>
          {blockReason || !contract ? (
            <Text style={styles.modalBody} testID="contract-sign-block-reason">{blockReason}</Text>
          ) : visible ? (
            <SigningCeremony
              signer="gc"
              mode="drawn"
              method="drawn"
              parties={2}
              signedBefore={0}
              sealVerb="SIGNED"
              role="Contractor"
              top={contractCeremonyTop(contract, projectName)}
              name={{ value: typedName, onChange: setTypedName, label: signingCopy.contractGcNameLabel(), placeholder: signingCopy.contractGcNameLabel(), minLength: 2 }}
              paths={paths}
              onPathsChange={setPaths}
              offline={offline}
              copy={copy}
              write={write}
              writeOptions={{
                idempotent: false,
                copy: {
                  refused: signingCopy.contractRefused(),
                  timeout: signingCopy.contractTimeout(),
                  legalQueued: signingCopy.contractLegalQueued(),
                },
              }}
              recordFrom={recordFrom}
              above={above}
              fold={inPerson ? undefined : moment.fold}
              onCommitStart={() => setBusy(true)}
              onUncommit={() => setBusy(false)}
              onDone={(r) => { setBusy(false); onDone(r); }}
              onResultAfterUnmount={onLateResult}
              onLateResult={onLateResult}
              testID="contract-sign"
            />
          ) : null}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={busy} accessibilityRole="button" testID="contract-sign-cancel">
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * #67: record a client signature given outside the portal. Two ways, and the
 * record says which.
 *
 * In person (A2, moments lane MOMSIGN): a hand-off card, then the card turns
 * to face the client (useHandoffTurn), who reviews and signs the ceremony
 * themselves with their name EMPTY (never prefilled). On a confirmed record the
 * seal closes the contract ("Binding"), the signed PDF is sealed once
 * (onBinding), and a hand-back button turns the card back to the contractor's
 * record card.
 *
 * On paper (A3): no ceremony. The name, the day on the page (never a future
 * day) and a REQUIRED photo of the signed page, then a slide that stays
 * disabled, with the reason, until the draft passes recordSignatureBlockReason.
 */
export function RecordHomeownerSignatureModal({
  visible, onClose, contract, projectName, clientName, gcName, together, offline,
  recordInPerson, recordPaper, isNeutral, recordFrom, onBinding, autoSeal, onLateResult, onResultAfterUnmount,
}: {
  visible: boolean;
  onClose: () => void;
  contract: ProjectContract;
  projectName: string;
  /** The client's name on file, for the hand-off card ('' = unknown). */
  clientName: string;
  /** The contractor's name, for the hand-back button ('' = unknown). */
  gcName: string;
  together: boolean;
  offline: boolean;
  recordInPerson: (paths: string[], typedName: string) => Promise<CommitResult>;
  recordPaper: (draft: RecordSignatureDraft, pagePhotoUri: string | null) => Promise<CommitResult>;
  isNeutral: () => boolean;
  recordFrom: SigningCeremonyProps['recordFrom'];
  onBinding: () => void;
  autoSeal: { state: 'idle' | 'running' | 'sealed' | 'failed'; hash?: string };
  onLateResult: (r: CommitResult) => void;
  onResultAfterUnmount: (r: CommitResult) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const [method, setMethod] = useState<RecordedSignatureMethod>('in_person');
  const [paths, setPaths] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [signedDay, setSignedDay] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [dayPicker, setDayPicker] = useState(false);
  // In person: 'handoff' (the contractor's card), 'client' (turned to the
  // client), 'done' (confirmed; the hand-back waits), 'back' (the record card).
  const [stage, setStage] = useState<'handoff' | 'client' | 'done' | 'back'>('handoff');
  const [neutral, setNeutral] = useState(false);
  const [busy, setBusy] = useState(false);
  // The paper write answered that the client already signed elsewhere: the
  // slide stays disabled with that sentence (a second slide changes nothing).
  const [paperSignedElsewhere, setPaperSignedElsewhere] = useState(false);
  const turn = useHandoffTurn();
  const paperSlideRef = useRef<SlideToConfirmHandle>(null);

  useEffect(() => {
    if (visible) {
      setMethod('in_person'); setPaths([]); setName(''); setSignedDay(todayCalendarDay()); setPhotoUri(null);
      setStage('handoff'); setNeutral(false); setBusy(false); setPaperSignedElsewhere(false);
      void turn.turn('front');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const draft = useMemo<RecordSignatureDraft>(() => ({ method, name, signaturePaths: paths, signedDay, hasPagePhoto: !!photoUri }), [method, name, paths, signedDay, photoUri]);
  const blockReason = recordSignatureBlockReason(draft, todayCalendarDay());
  const paperReason = paperSignedElsewhere ? signingCopy.paperAlreadySigned() : blockReason;
  const clientFirst = clientName.trim().split(/\s+/)[0] ?? '';
  const gcFirst = gcName.trim().split(/\s+/)[0] ?? '';

  const pickPhoto = useCallback(async (source: 'camera' | 'library') => {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert(source === 'camera' ? 'Camera Access Needed' : 'Photo Access Needed',
        `Grant ${source === 'camera' ? 'camera' : 'photo'} access in Settings to add the signed page.`);
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPhotoUri(result.assets[0].uri);
  }, []);
  const fRecord = useSheetFrame('form', { visible, animationType: 'slide' });
  // Records the signed contract: Cmd+Enter plays the paper slide's hold (never
  // an instant commit), never Cmd+S (components/ui/Sheet saveKey). The
  // in-person ceremony is signed by hand only.
  useSheetPrimaryHotkey(visible && method === 'paper' && !paperReason && !busy, () => paperSlideRef.current?.playHoldToCommit(), { saveKey: false });

  const writeInPerson = useCallback(() => recordInPerson(paths, name), [recordInPerson, paths, name]);
  // The paper write holds the sheet: Cancel, Android back and the name field
  // are off until the answer is in, so a refusal or "No answer yet" is always
  // read on the open sheet (onResultAfterUnmount speaks only a confirmed one).
  const writePaper = useCallback(async (): Promise<CommitResult> => {
    setBusy(true);
    const r = await recordPaper(draft, photoUri);
    if (r.status === 'refused' && r.reason === signingCopy.paperAlreadySigned()) setPaperSignedElsewhere(true);
    return r;
  }, [recordPaper, draft, photoUri]);
  const inPersonCopy = useMemo(() => ({
    label: signingCopy.inPersonLabel(),
    srLabel: signingCopy.inPersonSrLabel(),
    srConfirm: signingCopy.inPersonSrConfirm(),
    sealedAnnounce: signingCopy.inPersonSealedAnnounce(),
  }), []);

  const handOver = useCallback(() => {
    setStage('client');
    void turn.turn('back', signingCopy.handoffTurnAnnounce());
  }, [turn]);
  const handBack = useCallback(() => {
    setStage('back');
    void turn.turn('front', signingCopy.handBackAnnounce());
  }, [turn]);

  const sealLine = autoSeal.state === 'running'
    ? signingCopy.autoSealRunning()
    : autoSeal.state === 'sealed' && autoSeal.hash
      ? signingCopy.sealEvidence(autoSeal.hash.slice(0, 12))
      : autoSeal.state === 'failed' ? signingCopy.autoSealFailed() : null;

  const front = stage === 'back' ? (
    <View style={styles.recordCard} testID="contract-record-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <CheckCircle2 size={16} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.statusBannerTitle}>
          {neutral ? signingCopy.alreadySignedTitle() : together ? signingCopy.recordCardTogetherTitle() : signingCopy.recordCardTitle()}
        </Text>
      </View>
      <Text style={styles.modalBody}>
        {neutral ? signingCopy.recordCardAlreadySigned() : signingCopy.recordCardSignedBy(name.trim())}
      </Text>
      {!neutral && !!sealLine && <Text style={styles.modalBody} testID="contract-record-seal-line">{sealLine}</Text>}
      <Button label={signingCopy.recordCardDone()} onPress={onClose} testID="contract-record-done" />
    </View>
  ) : (
    <View style={styles.recordCard} testID="contract-record-handoff">
      <Text style={styles.modalBody}>
        {clientName.trim() ? signingCopy.handoffBody(clientName.trim()) : signingCopy.handoffBodyNoName()}
      </Text>
      <Button
        label={clientFirst ? signingCopy.handoffButton(clientFirst) : signingCopy.handoffButtonNoName()}
        onPress={handOver}
        disabled={stage !== 'handoff'}
        testID="contract-record-hand-over"
      />
    </View>
  );

  const back = stage === 'handoff' ? null : (
    <View>
      <SigningCeremony
        signer="homeowner"
        mode="drawn"
        method="in_person"
        parties={2}
        signedBefore={1}
        sealVerb="SIGNED"
        role="Owner"
        top={contractCeremonyTop(contract, projectName)}
        name={{ value: name, onChange: setName, label: signingCopy.inPersonNameLabel(), placeholder: signingCopy.inPersonNameLabel(), minLength: 2 }}
        paths={paths}
        onPathsChange={setPaths}
        offline={offline}
        copy={inPersonCopy}
        write={writeInPerson}
        writeOptions={{
          idempotent: false,
          copy: {
            refused: signingCopy.recordRefused(),
            timeout: signingCopy.contractTimeout(),
            legalQueued: signingCopy.recordLegalQueued(),
          },
        }}
        recordFrom={recordFrom}
        isNeutral={isNeutral}
        evidence={autoSeal.state === 'sealed' && autoSeal.hash ? signingCopy.sealEvidence(autoSeal.hash.slice(0, 12)) : undefined}
        onBinding={onBinding}
        onCommitStart={() => setBusy(true)}
        onUncommit={() => setBusy(false)}
        onDone={(r) => {
          setBusy(false);
          if (r.status !== 'confirmed') return;
          setNeutral(isNeutral());
          setStage('done');
        }}
        onLateResult={onLateResult}
        onResultAfterUnmount={onResultAfterUnmount}
        testID="contract-record-ceremony"
      />
      {stage === 'done' && (
        <Button
          label={gcFirst ? signingCopy.handBackButton(gcFirst) : signingCopy.handBackButtonNoName()}
          onPress={handBack}
          style={{ marginTop: 14 }}
          testID="contract-record-hand-back"
        />
      )}
    </View>
  );

  const inPersonStarted = method === 'in_person' && stage !== 'handoff';

  return (
    <Modal visible={visible} animationType={fRecord.animationType} transparent onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={[styles.modalOverlay, fRecord.overlay]}>
        <View style={[styles.modalCard, fRecord.card]} testID="contract-record-signature-modal">
          <Text style={styles.modalTitle}>Record Client Signature</Text>
          {!inPersonStarted && (
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalCancel, method === 'in_person' && { borderColor: themeColors.accent }]}
                // Never mid-write: switching would unmount the paper slide before its answer.
                onPress={() => { if (!busy) setMethod('in_person'); }}
                accessibilityRole="button"
                accessibilityState={{ selected: method === 'in_person' }}
                testID="contract-record-in-person"
              >
                <Text style={styles.modalCancelText}>In Person</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCancel, method === 'paper' && { borderColor: themeColors.accent }]}
                onPress={() => { if (!busy) setMethod('paper'); }}
                accessibilityRole="button"
                accessibilityState={{ selected: method === 'paper' }}
                testID="contract-record-paper"
              >
                <Text style={styles.modalCancelText}>On Paper</Text>
              </TouchableOpacity>
            </View>
          )}
          {method === 'in_person' ? (
            visible ? (
              <HandoffTurn
                control={turn}
                front={front}
                back={back}
                style={inPersonStarted ? { minHeight: HANDOFF_MIN_HEIGHT } : null}
                testID="contract-record-turn"
              />
            ) : null
          ) : (
            <>
              <Text style={styles.modalBody}>
                For a contract the client signed on a printed copy. Type their name as it appears on the page, pick the day they signed, and photograph the signed page. The photo is kept as the proof.
              </Text>
              <TouchableOpacity onPress={() => setDayPicker(true)} style={styles.modalNameInput} accessibilityRole="button" testID="contract-record-day">
                <Text style={{ color: themeColors.text }}>{signedDay ? `Signed ${formatCalendarDay(signedDay)}` : 'Pick the Signing Day'}</Text>
              </TouchableOpacity>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => { void pickPhoto('camera'); }} accessibilityRole="button" testID="contract-record-photo-camera">
                  <Text style={styles.modalCancelText}>{photoUri ? 'Retake Photo' : 'Photograph the Page'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancel} onPress={() => { void pickPhoto('library'); }} accessibilityRole="button" testID="contract-record-photo-library">
                  <Text style={styles.modalCancelText}>Choose Photo</Text>
                </TouchableOpacity>
              </View>
              {!!photoUri && <Text style={styles.modalBody}>Photo of the signed page added.</Text>}
              <TextInput
                style={styles.modalNameInput}
                value={name}
                onChangeText={setName}
                placeholder="Client's full legal name"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="words"
                editable={!busy}
                testID="contract-record-name"
              />
              <SlideToConfirm
                ref={paperSlideRef}
                label={signingCopy.paperLabel()}
                busyLabel={signingCopy.paperBusyLabel()}
                srLabel={signingCopy.paperSrLabel()}
                srConfirm={signingCopy.paperSrConfirm()}
                onCommit={writePaper}
                writeOptions={{
                  idempotent: false,
                  legal: true,
                  copy: {
                    refused: signingCopy.recordRefused(),
                    timeout: signingCopy.contractTimeout(),
                    legalQueued: signingCopy.recordLegalQueued(),
                    offline: signingCopy.paperOffline(),
                  },
                }}
                tone="ink"
                resultIcon="lock"
                disabledReason={paperReason}
                offline={offline}
                // A confirmed record holds the sheet through its result; onDone
                // closes it and says it in the toast. say={false}: a late or
                // after-close answer is said by the screen's record handlers,
                // which the in-person ceremony shares (one toast, never two).
                say={false}
                onResolved={(r) => { if (r.status !== 'confirmed') setBusy(false); }}
                onDone={(r) => { setBusy(false); if (r.status === 'confirmed') onClose(); sayCommitResult(r, { quiet: true }); }}
                onResultAfterUnmount={onResultAfterUnmount}
                onLateResult={onLateResult}
                testID="contract-record-paper-slide"
              />
            </>
          )}
          {!(method === 'in_person' && stage === 'back') && (
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={busy} accessibilityRole="button" testID="contract-record-cancel">
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
      <DatePickerModal
        visible={dayPicker}
        value={signedDay}
        title="Day the Client Signed"
        onClose={() => setDayPicker(false)}
        onChange={(iso) => { setSignedDay(iso.slice(0, 10)); setDayPicker(false); }}
      />
    </Modal>
  );
}


const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadFailedTitle: { ...Type.headline, color: themeColors.text, textAlign: 'center', marginTop: Tokens.spacing.sm },
  loadFailedText: { ...Type.subhead, color: themeColors.textSecondary, textAlign: 'center', maxWidth: 420, marginVertical: Tokens.spacing.sm, paddingHorizontal: Tokens.spacing.lg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.4, marginTop: 4 },
  // Centered icon-circle hero — mirrors construction-ai.
  contractHero: { alignItems: 'center' as const, gap: 6, marginBottom: 18, paddingHorizontal: 8 },
  contractHeroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: themeColors.accent + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  contractHeroTitle: { fontSize: 24, fontWeight: '700' as const, color: themeColors.text, letterSpacing: -0.3 },
  contractHeroSub: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textMuted, textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 8 },

  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.full },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  card: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  cardHelper: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },

  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
    backgroundColor: themeColors.accent + '0D',
    borderWidth: 1, borderColor: themeColors.accent + '30',
  },
  smallBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: themeColors.accent },

  input: {
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: Type.bodyCompact.fontSize, color: themeColors.text,
  },
  inputDisabled: { opacity: 0.7 },
  inputMultiline: { minHeight: 110, paddingTop: 11 },

  // Timeline card (CONTRACT-TIME-1).
  timelineRow: { flexDirection: 'row', gap: 10 },
  timelineCol: { flex: 1, minWidth: 0 },
  timelineFieldLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textSecondary,
    marginBottom: 6,
  },
  timelineField: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  timelineFieldText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  timelineFieldPlaceholder: { color: themeColors.textMuted },
  // The sentence that goes on the document — same helper, so it reads exactly
  // as it will in the homeowner's email.
  timelineSentence: {
    fontSize: Type.caption1.fontSize, color: themeColors.text, lineHeight: 18, marginTop: 12,
  },
  timelineMissing: {
    fontSize: Type.caption1.fontSize, color: themeColors.warningLabel, lineHeight: 18, marginTop: 12,
  },
  // accentSoft fill with accentLabel ink: this is 11–13px type, and the raw
  // accent behind or as white type misses AA (2.87:1).
  timelineSuggest: {
    marginTop: 12, padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accentSoft, borderWidth: 1, borderColor: themeColors.line,
  },
  timelineSuggestTitle: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: themeColors.accentLabel },
  timelineSuggestBasis: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, marginTop: 4, lineHeight: 16 },
  inputTermsMultiline: { minHeight: 200, paddingTop: 11, fontSize: Type.caption1.fontSize, lineHeight: 18 },

  amountField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  amountInput: { flex: 1, fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text },

  // ── Milestone row (Payment Schedule) ──
  // Redesigned to remove the cramped/overlapping look. Each input has
  // a small caption above it and a clearly bordered box. Amount + Trigger
  // sit in a 2-column row with explicit flex so neither pushes into the
  // other. Status pill moved to its own header row to stop crowding the
  // label input.
  milestoneCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  milestoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  milestoneTrash: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: themeColors.danger,
  },
  milestoneStatus: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.full },
  milestoneStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  milestoneFieldLabel: {
    fontSize: 10, fontWeight: '800', color: themeColors.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 4,
  },
  milestoneLabelInput: {
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: themeColors.text,
    marginBottom: 12,
  },
  milestoneFieldsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  milestoneFieldCol: { flex: 1, minWidth: 0 },
  milestoneAmountBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44,
  },
  milestoneAmountInput: {
    flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700', color: themeColors.text,
    padding: 0,
    minHeight: 22,
  },
  milestoneTriggerBox: {
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  milestoneTriggerText: {
    fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text,
    lineHeight: 17,
  },
  milestoneTriggerInput: {
    fontSize: Type.footnote.fontSize, color: themeColors.text,
    backgroundColor: themeColors.bg, borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: themeColors.line,
    minHeight: 44,
  },
  // "Create invoice" — the one-tap milestone → invoice hand-off.
  milestoneBillBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 12, paddingVertical: 11, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accentFill,
    minHeight: 44,
  },
  milestoneBillBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
  milestoneBilledRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1, borderColor: themeColors.line,
    minHeight: 44,
  },
  milestoneBilledText: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.textMuted },
  milestoneBilledLink: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: themeColors.accent },
  // Why a progress row is offering nothing, in the row's own words. A
  // sentence, deliberately not another card — it sits inside milestoneCard and
  // a second surface inside a surface reads as a nested box, not an answer.
  milestoneBlockNote: {
    marginTop: 12, fontSize: Type.caption1.fontSize, lineHeight: 17, color: themeColors.textMuted,
  },

  scheduleTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, marginTop: 6,
    borderTopWidth: 1, borderTopColor: themeColors.line,
  },
  scheduleTotalLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  scheduleTotalValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text },
  // Mismatch banner — its own row, amber tint, real "this is wrong" affordance
  // MONEY-CONTRACT-1 — the revised-contract card.
  revisedCard: {
    marginTop: 14,
    borderRadius: Tokens.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: themeColors.line,
    backgroundColor: themeColors.bg,
    padding: 12,
    gap: 6,
  },
  revisedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  revisedRowTotal: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColors.line,
    paddingTop: 8,
    marginTop: 2,
  },
  revisedLabel: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },
  revisedCoLabel: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.textMuted },
  revisedValue: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '600' as const },
  revisedLabelTotal: { fontSize: Type.subhead.fontSize, color: themeColors.text, fontWeight: '700' as const },
  revisedValueTotal: { fontSize: Type.subhead.fontSize, color: themeColors.text, fontWeight: '800' as const },
  revisedCaption: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 4 },

  scheduleMismatchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: themeColors.accentSoft,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    gap: 10,
  },
  scheduleMismatchText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    color: themeColors.accent,
    lineHeight: 16,
  },
  rebalanceBtn: {
    backgroundColor: themeColors.accentFill,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rebalanceText: { fontSize: Type.caption2.fontSize, color: '#FFF', fontWeight: '800', letterSpacing: 0.3 },

  // Direction B terms rows — "not set yet", provenance, MAGE's old placeholder.
  // accentSoft fill with accentLabel/text ink: small type on raw accent misses AA.
  termsNotice: {
    backgroundColor: themeColors.accentSoft,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
    padding: 12, marginBottom: 10, gap: 6,
  },
  termsNoticeTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  termsNoticeBody: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  termsNoticeBtn: {
    alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center',
    backgroundColor: themeColors.accentFill, borderRadius: Tokens.radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 2,
  },
  termsNoticeBtnText: { fontSize: Type.caption1.fontSize, color: Colors.textOnAccent, fontWeight: '700' },
  termsProvenance: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
    gap: 8, marginBottom: 10,
  },
  termsProvenanceText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  termsLink: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.accentLabel },

  allowanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
    borderWidth: 1, borderColor: themeColors.line,
    minHeight: 48,
  },
  allowanceCategory: {
    flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text, padding: 0,
    fontWeight: '600',
  },
  allowanceAmountField: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: themeColors.line,
    minWidth: 110,
  },
  allowanceAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text, padding: 0, flex: 1 },
  allowanceEmpty: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },

  sigBlock: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  sigLabel: { fontSize: 10, fontWeight: '800', color: themeColors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  sigName:  { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text, fontStyle: 'italic', marginTop: 4 },
  sigDate:  { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryBtn: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accentFill,
    shadowColor: themeColors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
  primaryBtnDisabled: { opacity: 0.45 },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  secondaryBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accent + '0D',
    borderWidth: 1, borderColor: themeColors.accent + '30',
    marginTop: 10,
  },
  statusBannerTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: themeColors.accent },
  statusBannerBody:  { fontSize: Type.caption1.fontSize, color: themeColors.text, marginTop: 3, lineHeight: 17 },
  // The in-person hand-off and record cards (A2): the shared card recipe.
  recordCard: { ...cardSurface(themeColors, { radius: 'lg', pad: 16 }), gap: 12 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text },
  modalBody: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, lineHeight: 18 },
  modalNameInput: {
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: Type.subhead.fontSize, fontWeight: '700', color: themeColors.text,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: themeColors.bg, alignItems: 'center', borderWidth: 1, borderColor: themeColors.line },
  modalCancelText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: themeColors.accentFill },
  modalConfirmText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
});
