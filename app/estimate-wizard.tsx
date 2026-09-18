// Quick Estimate Wizard — 8 preset questions that feed mageAISmart for a
// fast, itemized construction estimate. Designed for the "I need a number
// now" moment where the full estimator is overkill.
//
// Flow:
//   Step 1 of 8 → project type
//   Step 2 of 8 → size
//   Step 3 of 8 → location
//   Step 4 of 8 → quality tier
//   Step 5 of 8 → scope summary
//   Step 6 of 8 → timeline
//   Step 7 of 8 → special requirements
//   Step 8 of 8 → budget target
//   → MAGE AI generates an itemized breakdown (materials, labor, permits,
//     contingency, subtotal, total)
//
// Result can be copied to clipboard or optionally dropped into a new
// project's estimate via the Projects context (left as a follow-up so the
// existing estimator isn't touched by this first pass).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, CheckCircle2, FileDown,
  RotateCcw, Users, FolderPlus, Plus, X, Mic, TrendingUp, AlertTriangle, Percent,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { BrainCard } from '@/components/brain/BrainCard';
import { BrandBackdrop, OnInk } from '@/components/BrandBackdrop';
import { RevenueEarlyAccessCard } from '@/components/RevenueEarlyAccessCard';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';
import { stableHash } from '@/utils/stableHash';
import { buildCostDatabase } from '@/utils/costDatabase';
import { estimateGroundingProps } from '@/utils/activationSignals';
import { useClientDocumentGate } from '@/hooks/useClientDocumentGate';
import ClientDocumentAskSheet from '@/components/ClientDocumentAskSheet';
import { acceptanceSentence, paymentStageRows, resolvePaymentSplit } from '@/utils/paymentTerms';
import {
  EMPTY_GROUNDING, buildGroundingFacts, estimateThinkingSteps, groundingChipLabel, selectGroundingEntries,
  type GroundingBundle, type ScopeHints,
} from '@/utils/groundingChip';
import { computeCalibration } from '@/utils/estimateCalibration';
import UpgradeSheet from '@/components/UpgradeSheet';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';
import { useProjects } from '@/contexts/ProjectContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import {
  buildQuickLinkedEstimate, priceCostBreakdown, isMarkupSet, marginOf,
  MARKUP_CHOICES, type MarkupPct,
} from '@/utils/estimateMarkup';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { recordPrediction } from '@/utils/brain/predictionLedger';
import { buildEstimateSnapshotPayload } from '@/utils/brain/estimateSnapshot';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { shareQuickEstimatePDF } from '@/utils/pdfGenerator';
import { checkAILimit, recordAIUsage, getFreeTrialsRemaining, type LimitCheck } from '@/utils/aiRateLimiter';
import { generateUUID } from '@/utils/generateId';
import type { Commitment, CompanyBranding, PaymentSplit, Project, ProjectType, QualityTier } from '@/types';
import {
  INITIAL_SCOPE, SCOPE_STEPS, TOTAL_SCOPE_STEPS, stepCanAdvance, buildEstimatePrompt,
  estimateSchema, QUALITY_LABELS, stepBlockReason,
  type WizardAnswers, type EstimateResult,
} from '@/utils/scopeQuestions';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Button, cardSurface } from '@/components/ui';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useTierAccess } from '@/hooks/useTierAccess';
import { showAlert } from '@/utils/alert';
import { track, AnalyticsEvents } from '@/utils/analytics';

// The loader's "Pricing from …" line is a claim about this run's prompt, so it
// comes from the same firewall as the chip: utils/groundingChip
// estimateThinkingSteps reads the MEASURED / STATED counts of the bundle
// stored for the run — "your history" only for a measured rate, "the rates
// you set" for a seeded-only book, market averages for nothing at all.

/** The wizard answers that steer PRODUCT-F18 grounding (project type → trade
 *  keywords; trades named in the scope / special requirements). */
const hintsFrom = (a: WizardAnswers): ScopeHints => ({
  projectType: a.projectType, scope: a.scope, specialRequirements: a.specialRequirements,
});

/** Bid-vs-actual calibration: one sentence about the worst-calibrated
 *  category, when there is history to say it. A FACT for the prompt, never an
 *  ENTRY for the chip count (utils/groundingChip.buildGroundingFacts). */
function calibrationFactFor(projects: Project[], commitments: Commitment[]): string | null {
  try {
    const cal = computeCalibration({ projects, commitments });
    const top = cal.hasData ? cal.categories[0] : undefined;
    return top && top.direction !== 'aligned' ? top.detail : null;
  } catch {
    return null;
  }
}

// On-brand cost-distribution bar palette (no purple/pink — matches the
// redesign's trade-tile colors). Rotated by category index.
const BREAKDOWN_COLORS = ['#FF6A1A', '#5FBF6B', '#90A4AE', '#4FC3F7', '#FFA726', '#8D6E63', '#EF5350', '#26C6DA'];

// Single source of truth for the post-wizard paywall destination in onboarding
// mode — avoids the cast being duplicated at every leave site.
const ONBOARDING_PAYWALL_ROUTE = '/onboarding-paywall' as never;

// Where the TRAILING run of optional steps begins (5 today: timeline, special
// requirements, target budget). From here on the wizard has everything it needs
// to price the job, but the UI still made the contractor tap Next through three
// screens that cannot be failed before Generate appeared on the last one —
// three taps of pure toll on the one path the whole onboarding arc funnels into.
//
// Derived by walking BACK from the end rather than `findIndex(q => q.optional)`.
// findIndex returns -1 when nothing is optional, and `step >= -1` is true on
// every step — the "everything from here on is optional" line and a Generate
// button would have appeared on question one, over a model that says the
// opposite. It also cannot offer to skip a REQUIRED question that someone later
// inserts after an optional one: the trailing run is optional by construction,
// which is exactly what the line below the button claims.
function firstTrailingOptionalStep(): number {
  let i = SCOPE_STEPS.length;
  while (i > 0 && SCOPE_STEPS[i - 1].optional) i -= 1;
  return i; // === SCOPE_STEPS.length when the last step is required → row hidden
}
const FIRST_OPTIONAL_STEP = firstTrailingOptionalStep();

/** The metered free allowance for this screen, as a sentence fragment: "2 free
 *  left". Null once the user is on a paid tier (nothing to count down). */
function freeRunsLabel(left: number | null): string | null {
  if (left === null) return null;
  return left === 1 ? '1 free left' : `${left} free left`;
}

// The AI EstimateResult → project LinkedEstimate mapper, and the pricing that
// turns the model's COST breakdown into what the client is charged, both live
// in utils/estimateMarkup.ts now.
//
// They used to live here as a screen-local `buildLinkedEstimate` that wrote
// `markup: 0` on every row and `globalMarkup: 0` on the estimate, with a
// comment claiming "the GC tunes it in the estimator". He did not. Nothing
// carried him there, nothing told him the number was his cost, and the
// estimate went out at a measured 0.0% margin. Moving the arithmetic into a
// util is what lets scripts/validate-estimate-cost-basis.ts call the exact
// function this screen ships instead of a re-typed copy of it.

// Map the wizard's free-text project-type answer onto the legacy Project.type
// enum so a newly-created project still classifies sensibly. Falls back to
// 'renovation' (the app's generic default) for anything unrecognized.
function mapProjectType(answer: string): ProjectType {
  const a = answer.toLowerCase();
  if (a.includes('new build') || a.includes('new construction') || a.includes('adu')) return 'new_build';
  if (a.includes('addition')) return 'addition';
  if (a.includes('commercial') || a.includes(' ti')) return 'commercial';
  if (a.includes('roof')) return 'roofing';
  if (a.includes('deck') || a.includes('outdoor') || a.includes('landscap')) return 'landscape';
  if (a.includes('remodel')) return 'remodel';
  return 'renovation';
}

// Map the wizard's quality answer onto the legacy Project.quality enum.
function mapQuality(quality: WizardAnswers['quality']): QualityTier {
  switch (quality) {
    case 'budget': return 'economy';
    case 'high_end': return 'premium';
    default: return 'standard';
  }
}

export default function EstimateWizardScreen() {
  return <EstimateWizardScreenInner />;
}

function EstimateWizardScreenInner() {
  const router = useRouter();
  // UX-F14/F18: the wizard is gestureEnabled:false, so a cold-start deep link
  // into it has no history to pop — useSafeBack falls through to the home tab
  // instead of leaving the chevron dead (hooks/useSafeBack.ts).
  const safeBack = useSafeBack();
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { settings, getProject, updateProject, addProject, projects, commitments } = useProjects();
  const { maybeAskForPush } = useNotifications();
  const { receipts } = useMaterialReceipts();
  // Self-perform labor (D6): crew hours × configured loaded rates, folded
  // into the same cost book the wizard grounds its prices on.
  const laborSamples = useLaborCostSamples();
  // Cold-start seeds: rates the contractor stated before they had any closed
  // jobs here. Without these a veteran's first estimate is a beginner's.
  // seedsLoading keeps the onboarding banner from claiming a pricing basis
  // before the seed query has answered — in either direction.
  const { seeds, isLoading: seedsLoading } = useCostSeeds();
  const { tier } = useSubscription();

  const { projectId, onboarding } = useLocalSearchParams<{ projectId?: string; onboarding?: string }>();
  const isOnboarding = onboarding === '1';
  // /cost-seed is gated on job_costing (Pro) — app/cost-seed.tsx:67 renders a
  // paywall before its own body. Read it HERE so the card can say so before
  // he taps, rather than after.
  const { canAccess } = useTierAccess();
  const seedNeedsUpgrade = !canAccess('job_costing');
  const scopedProject = useMemo(() => (projectId ? getProject(projectId) : undefined), [projectId, getProject]);

  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<WizardAnswers>(INITIAL_SCOPE);
  // Why Next is blocked on this step — set when a blocked Next is tapped,
  // cleared on any input/step change. The button is never a silent dead end.
  const [stepHint, setStepHint] = useState<string | null>(null);
  // Answerable refine loop — which refineWith hint is open + its answer.
  const [refineIdx, setRefineIdx] = useState<number | null>(null);
  const [refineText, setRefineText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  // The re-entry latch for the send. `sharingPdf` disables the buttons, but a
  // state flag is only true on the NEXT render, so two taps landing before that
  // render both read `false` — two PDFs and, worse, two ESTIMATE_SHARED events
  // on the activation funnel. Two buttons reach the send (the share button and
  // the ask sheet's last press), so the latch lives on the send itself.
  const sharingRef = useRef(false);
  // THE MODEL RETURNS COST. THE CONTRACTOR SENDS A PRICE. Those are two
  // different numbers and this screen now holds them separately.
  //
  // `costResult` is exactly what the AI produced: materials, labor, permits,
  // contingency. utils/scopeQuestions' prompt asks for nothing else — there is
  // no overhead line and no profit line in it, and there never was. It is the
  // cost basis, and it is what the LinkedEstimate's unitPrice/baseTotal are
  // built from so the job-cost engine and the calibration loop keep learning
  // real costs (utils/estimateMarkup explains why scaling unitPrice would
  // poison that).
  //
  // `result` is that breakdown priced at the contractor's own markup. Every
  // display below — the hero total, the per-category breakdown, the payment
  // schedule, the PDF — reads `result`, so the markup is applied in exactly
  // ONE place and no downstream reader can be forgotten. That is the whole
  // reason it is derived rather than a second piece of state.
  const [costResult, setCostResult] = useState<EstimateResult | null>(null);
  // The contingency rate THIS estimate was built at (null = the model's own
  // figure). Held beside the result rather than re-read from settings, so the
  // label cannot name a rate changed after the estimate was generated.
  const [contingencyRateUsed, setContingencyRateUsed] = useState<number | null>(null);

  // His markup, and whether he has ever been asked for it. Lives in
  // MaterialCartContext because that is already where the estimator keeps
  // "the GC's usual markup" (app/quick-quote.tsx reads it under exactly that
  // name), so the wizard, the estimator and the quick quote cannot disagree
  // about what he charges. `markupDecided` is null while AsyncStorage is still
  // answering — never prompt on null or the sheet flashes open on cold start.
  const { globalMarkup, markupDecided, recordMarkupDecision } = useMaterialCart();
  /** The markup to price this estimate at, or null when he has not decided.
   *  null is NOT zero: null means "we must ask", zero means "he said none". */
  const markupPct: MarkupPct = markupDecided === true ? globalMarkup : null;
  const [showMarkupSheet, setShowMarkupSheet] = useState(false);
  const [markupInput, setMarkupInput] = useState('');
  // Set when the sheet was opened by an action that must NOT proceed until the
  // markup question is answered — sharing the PDF, or saving to a project.
  // Holds the action to run once he answers, so the tap he made is honoured
  // instead of being swallowed by a modal.
  const pendingAfterMarkupRef = useRef<null | ((pct: number) => void)>(null);
  // iOS only: the answered continuation, waiting for the markup Modal to finish
  // sliding out. The continuation opens the ask sheet (a second Modal) or the
  // share sheet, and iOS refuses to present either while a modal is still
  // dismissing — the tap would be honoured by nothing. Same pattern as the
  // estimator cart (app/(tabs)/estimate/full.tsx, Modal onDismiss).
  const afterMarkupDismissRef = useRef<null | (() => void)>(null);
  // The ?projectId auto-link, deferred when the markup is still unknown. Without
  // this the wizard would commit an at-cost estimate onto his project a beat
  // before asking what he charges, and the answer would land on a stale write.
  const pendingAutoLinkRef = useRef<EstimateResult | null>(null);

  // The priced estimate. `priceCostBreakdown` returns the input UNCHANGED when
  // the markup is unset or zero, so an undecided contractor sees his true cost
  // (correctly labelled as such by the at-cost banner) rather than a number the
  // app made up on his behalf.
  const result = useMemo(
    () => (costResult ? priceCostBreakdown(costResult, markupPct) : null),
    [costResult, markupPct],
  );
  /** The estimate on screen contains no profit — either he has not answered
   *  the markup question, or he answered zero. Both need saying out loud. */
  const atCost = !!result && !(isMarkupSet(markupPct) && markupPct > 0);
  // AI-F4 / PRODUCT-F18 (review): the grounding that went into THIS run's
  // prompt, stored next to the result. The chip, the seed CTA and the loader
  // copy read this — never a memo, which would re-render from newer answers
  // (the refine path) or from a cost book that finished loading after the
  // first result, and disagree with the prompt that was actually sent.
  const [groundingUsed, setGroundingUsed] = useState<GroundingBundle | null>(null);
  // Run counter (re-review A5). generate() stamps each run; cancelGenerate
  // bumps the counter without starting one. A run whose id no longer matches
  // is orphaned: its response is dropped and its `finally` must not flip
  // `loading` off under a newer run. The fetch itself is not aborted (the
  // AbortController is internal to mageAI) — this is the stale-state check.
  const runRef = useRef(0);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
  // How many free AI estimates are left, or null on a paid tier / unmetered.
  // Free gets TWO for life (utils/aiRateLimiterCore FEATURE_CONFIG
  // aiEstimateWizard.freeLifetimeCap) and the app never once said so: the
  // count was computed inside checkAILimit, returned as `remaining`, and
  // dropped on the floor. The contractor generated once, tapped Refine to
  // sharpen the number — which re-runs the model and spends the second — and
  // met the wall on the third, from a button labelled "Try it free".
  const [freeRunsLeft, setFreeRunsLeft] = useState<number | null>(null);
  // Standalone "Save to a project" flow. When the wizard is launched with no
  // ?projectId, the result would otherwise be a dead end (Share PDF + start
  // over only) — the number is thrown away the moment they leave. This modal
  // lets them attach the estimate to an existing project OR spin up a new
  // one, folding the AI line items into its linkedEstimate.
  const [showSaveModal, setShowSaveModal] = useState(false);

  // "Ask when it matters" (hooks/useClientDocumentGate). The share used to
  // carry its own identity modal and printed 25 / 65 / 10 that nobody chose;
  // both now go through the one ask sheet, which asks for the company identity
  // only when the bid gate blocks and for the GC's own payment terms only when
  // his profile has none, one question per step, and runs the send from the
  // last press with the answers as arguments.
  const gate = useClientDocumentGate();
  const [newProjectName, setNewProjectName] = useState('');
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  // The project the estimate was ACTUALLY written to by the ?projectId
  // link-back, set inside commitAutoLink after updateProject has run — not
  // derived from the route param.
  //
  // WHY IT IS NOT THE ROUTE PARAM. When the contractor has not yet said what
  // he charges, the link-back is deferred (pendingAutoLinkRef below) so the
  // project is not handed an at-cost estimate a beat before the question is
  // asked. The result screen, however, derived "is this attached?" from
  // `projectId && scopedProject` — the route param — and rendered a green
  // check reading "Saved to Henderson Kitchen — open project" over a project
  // that had received nothing. A first-run contractor who dismissed the markup
  // sheet got a positive confirmation of a write that never happened. The
  // label now tracks the write.
  const [committedProjectId, setCommittedProjectId] = useState<string | null>(null);
  // True while a link-back is parked waiting on the markup answer. Ref state
  // alone cannot drive the label, so the two are set together.
  const [autoLinkParked, setAutoLinkParked] = useState(false);

  useEffect(() => {
    if (scopedProject?.scope) {
      // Re-opening the wizard for a project that already has scope stamped:
      // restore all wizard answers so nothing is re-asked.
      const { updatedAt: _updatedAt, ...rest } = scopedProject.scope;
      setAnswers({ ...INITIAL_SCOPE, ...rest });
    } else if (scopedProject) {
      // First time through the wizard for this project — seed from the Project
      // record so the wizard never re-asks what the project already knows.
      // mapProjectType is a local helper that folds ProjectType back to a
      // wizard display string (e.g. 'renovation' → 'Full Remodel'); we just
      // use the raw type value here since the wizard accepts free text.
      const { type, squareFootage, quality, location, description } = scopedProject;
      const seedType = type && type !== 'renovation' ? type.replace(/_/g, ' ') : '';
      const seedQuality: WizardAnswers['quality'] =
        quality === 'premium' || quality === 'luxury' ? 'high_end'
        : quality === 'economy' ? 'budget'
        : 'standard';
      // Skip 'United States' placeholder — the wizard treats blank as unknown
      const seedLocation = location && location !== 'United States' ? location : '';
      setAnswers((prev) => ({
        ...prev,
        ...(seedType ? { projectType: seedType } : {}),
        ...(squareFootage && squareFootage > 0 ? { sizeSqft: String(squareFootage) } : {}),
        quality: seedQuality,
        ...(seedLocation ? { location: seedLocation } : {}),
        ...(description ? { scope: description } : {}),
      }));
    }
  }, [scopedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A standalone estimate (no ?projectId) used to open step 3 blank, so he
  // retyped his own city on every run while the app held it one screen away in
  // settings.location — the same market that already prices his catalog and
  // change orders. Seed it as a visible, editable starting answer (the job may
  // be somewhere else; the field is still his to change), never over anything
  // already typed, and never the 'United States' default, which names no market.
  const homeMarketSeed = useMemo(() => {
    const loc = (settings?.location ?? '').trim();
    return loc && loc !== 'United States' ? loc : '';
  }, [settings?.location]);
  useEffect(() => {
    if (projectId || !homeMarketSeed) return;
    setAnswers((prev) => (prev.location.trim() ? prev : { ...prev, location: homeMarketSeed }));
  }, [projectId, homeMarketSeed]);

  // Read the lifetime counter once on mount so the number is on screen BEFORE
  // he spends one. getFreeTrialsRemaining only reads storage — recordAIUsage is
  // the only thing that increments — and returns null when the feature has no
  // lifetime cap. Paid tiers are not metered this way, so they show nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (tier !== 'free') { setFreeRunsLeft(null); return; }
      try {
        const left = await getFreeTrialsRemaining('aiEstimateWizard');
        if (!cancelled) setFreeRunsLeft(left);
      } catch { /* a lost read must not block the wizard — just no badge */ }
    })();
    return () => { cancelled = true; };
  }, [tier]);

  const TOTAL_STEPS = TOTAL_SCOPE_STEPS;

  const set = useCallback(<K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const canAdvance = useMemo(() => {
    return stepCanAdvance(step, answers);
  }, [step, answers]);

  useEffect(() => { setStepHint(null); }, [step, answers]);

  // THE BRAIN IN THE WIZARD: learned-cost facts from the contractor's own
  // closed jobs (same grounding the estimate copilot uses). Injected into
  // the prompt so a quick estimate prices from YOUR history, not a generic
  // national average. Best-effort — an empty book just means no grounding.
  //
  // costDb is exposed as its own memo so the analytics emit path can attach
  // estimateGroundingProps (used_learned_costs / learned_rate_count /
  // jobs_analyzed) to estimate_generated without rebuilding the DB twice.
  const costDb = useMemo(
    () => buildCostDatabase(projects, commitments, receipts, laborSamples, seeds),
    [projects, commitments, receipts, laborSamples, seeds],
  );

  // PRODUCT-F18: ground on the entries that match THIS job (project type →
  // trade keywords, plus trades named in the scope text), not the six
  // largest jobs in the book — a bathroom used to get roofing, concrete and
  // siding. The exposure top-N is only the fallback when nothing matches.
  // Called from generate() with the answers actually SENT, so the refine
  // path grounds on the refined answers, and the result is stored as
  // groundingUsed so every surface describes the same prompt.
  const groundingFor = useCallback((a: WizardAnswers): GroundingBundle => {
    try {
      return buildGroundingFacts(
        selectGroundingEntries(costDb.entries, hintsFrom(a), 6),
        calibrationFactFor(projects, commitments),
      );
    } catch {
      return EMPTY_GROUNDING;
    }
  }, [costDb, projects, commitments]);

  const next = useCallback(() => {
    if (!canAdvance) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  }, [canAdvance, TOTAL_STEPS]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  /**
   * Fold a generated estimate into the ?projectId the wizard was launched
   * from, at the markup `pct`.
   *
   * Lifted out of `generate` so it can be called LATER. When the contractor
   * has not yet said what he charges, the wizard defers this write, parks the
   * breakdown on `pendingAutoLinkRef`, and runs it the moment he answers —
   * otherwise the project would receive an at-cost estimate a beat before the
   * question was asked, and his answer would have nothing to attach to.
   */
  const commitAutoLink = useCallback((data: EstimateResult, pct: MarkupPct, targetId: string) => {
    const target = getProject(targetId);
    if (!target) return;
    const linkedEstimate = buildQuickLinkedEstimate(data, pct, generateUUID);
    updateProject(targetId, commitEstimatePatch(target, linkedEstimate, { reason: 'pre_overwrite' }));
    // The write happened. Only now may the result screen say so.
    setCommittedProjectId(targetId);
    setAutoLinkParked(false);
    // G4: fire-and-forget capture — ledger failure must never break estimate link
    try {
      const projectWithEstimate = { ...target, linkedEstimate };
      const snapshotPayload = buildEstimateSnapshotPayload(
        projectWithEstimate, projects, commitments, receipts, laborSamples, seeds,
      );
      if (snapshotPayload) {
        recordPrediction(
          'estimate_confidence_snapshot',
          snapshotPayload.estimateId,
          snapshotPayload as unknown as Record<string, unknown>,
          targetId,
        );
      }
    } catch { /* G4 */ }
  }, [getProject, updateProject, projects, commitments, receipts, laborSamples, seeds]);

  const generate = useCallback(async (answersOverride?: WizardAnswers) => {
    if (loading) return;

    // Pre-flight rate-limit check. Pre-fix the wizard had no checkAILimit
    // gate at all — Pro+ users could spam smart-tier and free users (when
    // the gate is lifted in the future) had no lifetime-cap enforcement.
    // We use feature='quickEstimate' so the lifetime-trial counter (3 free
    // demos) and the smart-daily-cap both apply correctly per
    // utils/aiRateLimiter.ts FEATURE_CONFIG.
    const limit = await checkAILimit(tier, 'smart', 'aiEstimateWizard');
    if (!limit.allowed) {
      setUpgradeLimit(limit);
      // Only the LIFETIME cap means the free allowance is gone. Any other refusal
      // leaves his trials intact, and zeroing the badge would tell him he had
      // spent something he still has. (evaluateLimit returns on the lifetime
      // branch before the daily one for a free user on a capped feature, so
      // today that is the only reason this screen can be handed — the check is
      // narrow on purpose, for the day a second one is added.)
      if (limit.reason === 'lifetime_cap') setFreeRunsLeft(0);
      return;
    }

    setLoading(true);
    setCostResult(null);
    const runId = ++runRef.current;

    const a = answersOverride ?? answers;
    // Grounding from the answers actually SENT, stored before the call so the
    // loader (during) and the chip + seed CTA (after) describe this run.
    const used = groundingFor(a);
    setGroundingUsed(used);
    const prompt = buildEstimatePrompt(a, used.facts, { contingencyRate: Number(settings?.contingencyRate) });

    // The cache key is the PROMPT (re-review B2). The prompt already carries
    // every answer — including timeline, budget and the special requirements
    // the refine loop appends to — plus the grounding facts by content, so
    // two runs share a cached estimate only when the model would have been
    // asked the identical question. The old key was built from a subset of
    // the answers (type, size, location, quality, the first 80 chars of the
    // scope) plus a facts hash; special requirements were not in it, so most
    // refine answers ("How many bathrooms? 2") came back as the first
    // estimate, byte-identical, for two hours.
    const cacheKey = 'wizard::' + stableHash(prompt);

    try {
      // Tagged 2026-09-07. This screen bills the user under 'aiEstimateWizard'
      // (checkAILimit/recordAIUsage) but sent the relay no id, so the server
      // scored it as `general`. That mismatch was load-bearing: the relay also
      // carried a Pro floor for this feature, and free onboarding only worked
      // because the tag was missing. The floor is gone from
      // supabase/functions/ai/index.ts, so the honest tag is now safe — and the
      // 2-run free trial stays enforced where it belongs, client-side.
      const res = await mageAISmart(prompt, estimateSchema, cacheKey, 'aiEstimateWizard');
      // Cancelled or superseded while the model was thinking: a newer run (or
      // none) owns the screen now. Drop this response on the floor.
      if (runRef.current !== runId) return;
      if (!res.success || !res.data) {
        showAlert('Estimate failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
      } else {
        // NEVER trust AI arithmetic in a client-facing PDF or saved
        // project financials. Deterministically recompute every number
        // (mirrors app/takeoff-estimate.tsx): line total = round(qty ×
        // unit), subtotal = Σ line totals, grand = subtotal + contingency
        // + permits. Contingency/permits are AI-provided inputs (not
        // derived from line items), so we keep them — but round them and
        // fold them into the recomputed total. Display, PDF, and the
        // linkedEstimate baseTotal/grandTotal all read from this `data`.
        const raw = res.data as EstimateResult;
        const round = (n: number) => Math.round(Number.isFinite(n) ? n : 0);
        const lineItems = raw.lineItems.map((li) => {
          const quantity = Number.isFinite(li.quantity) ? li.quantity : 0;
          const unitCost = Number.isFinite(li.unitCost) ? li.unitCost : 0;
          return { ...li, quantity, unitCost, total: round(quantity * unitCost) };
        });
        const subtotal = lineItems.reduce((s, li) => s + li.total, 0);
        // Contingency is HIS number. Settings → Estimate Defaults has asked for
        // a contingency rate since launch, validated it 0-50 and synced it as
        // profiles.contingency_rate — and nothing read it: the prompt tells the
        // model "~10% of subtotal", so a GC who runs 8% shipped bids at
        // whatever the model rounded to and had no reason to suspect it. The
        // rate is a percentage of the recomputed subtotal, so it is applied
        // here, deterministically, like every other total on this sheet — and
        // the totals block names the rate and where it came from. Only a rate
        // outside what Settings accepts falls back to the model's figure.
        const rate = Number(settings?.contingencyRate);
        const rateUsable = Number.isFinite(rate) && rate >= 0 && rate <= 50;
        const contingency = rateUsable ? round(subtotal * rate / 100) : round(raw.contingency);
        const permits = round(raw.permits);
        const total = subtotal + contingency + permits;

        // Hard failure: an empty or non-positive estimate is not a real
        // $0 estimate — do NOT render/save it or overwrite the project.
        // (An AI error kind is already handled by the !res.success guard.)
        if (lineItems.length === 0 || total <= 0) {
          showAlert('Estimate failed', 'The AI returned an empty or invalid estimate. Please try again.');
          return;
        }

        const data: EstimateResult = { ...raw, lineItems, subtotal, contingency, permits, total };
        setContingencyRateUsed(rateUsable ? rate : null);
        setCostResult(data);

        // Activation funnel: enriched aha event — attaches whether THIS
        // estimate was priced from the contractor's own learned cost data.
        // used_learned_costs comes from the run's counts: true only when the
        // prompt that was just sent carried a MEASURED rate. The book-level
        // form counted seeded entries and the whole book, so a seeded-only
        // contractor fired the aha without ever seeing MAGE price from their
        // history (re-review A3). learned_rate_count / jobs_analyzed still
        // describe the book.
        track(AnalyticsEvents.ESTIMATE_GENERATED, {
          path: 'wizard_generated',
          grand_total: data.total,
          item_count: data.lineItems?.length ?? 0,
          ...estimateGroundingProps(costDb, used.counts),
        });

        // Project-aware link-back. When the wizard was launched with a
        // ?projectId (from a project's "estimate now" entry point), fold
        // the AI line items into that project's linkedEstimate so the
        // estimator / budget / portal all see the number. The standalone
        // flow (no projectId) skips this entirely and is byte-identical
        // to before.
        //
        // Item shape and mapping live in utils/estimateMarkup
        // (buildQuickLinkedEstimate), shared with the standalone "Save to a
        // project" flow. LinkedEstimate has no notes field, so the AI notes +
        // refineWith are NOT folded onto it (doing so would require an unsafe
        // cast); they remain surfaced to the user in this screen's result UI.
        if (projectId && scopedProject) {
          if (isMarkupSet(markupPct)) {
            commitAutoLink(data, markupPct, projectId);
          } else {
            // Park it. `applyMarkupChoice` drains this ref the instant he
            // answers, so the project gets ONE write, at his real price —
            // rather than an at-cost write now and a stale one after.
            pendingAutoLinkRef.current = data;
            setAutoLinkParked(true);
            setCommittedProjectId(null);
          }
        }

        // He has never told us what he charges, and an estimate is now on
        // screen with his cost on it. Ask — once, here, at the only moment the
        // question is concrete. The sheet is dismissible (the number is still
        // useful to him as a cost check) but sharing or saving re-opens it,
        // so nothing at cost can leave silently.
        if (markupDecided === false) setShowMarkupSheet(true);

        // Fire-and-forget usage write — was previously awaited, which left
        // the loading spinner up while AsyncStorage finished on slow disks.
        // recordAIUsage failure shouldn't gate the user seeing their estimate.
        // Only records on success — failed calls (timeout, MAX_TOKENS,
        // SAFETY) still shouldn't count against the quota.
        void recordAIUsage('smart', 'aiEstimateWizard');
        // `limit.remaining` is what is left AFTER this run — the value this
        // screen used to compute and discard. Applied here, next to the write
        // that actually spends it, so a failed run (which never records) does
        // not show the contractor a trial he still has.
        if (tier === 'free') setFreeRunsLeft(Math.max(0, limit.remaining));
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      if (runRef.current !== runId) return;
      showAlert('Estimate failed', err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      // Only the run that owns the screen may take the loader down.
      if (runRef.current === runId) setLoading(false);
    }
  }, [answers, groundingFor, costDb, loading, tier, router, projectId, scopedProject, markupPct, markupDecided, commitAutoLink, settings?.contingencyRate]);

  // Escape hatch for the loading screen. The in-flight fetch is not aborted
  // (the AbortController is internal to mageAI); bumping runRef orphans it,
  // so its response — success, failure or `finally` — cannot land on the
  // screen or under a run started after the cancel.
  const cancelGenerate = useCallback(() => {
    runRef.current += 1;
    setLoading(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  /**
   * THE GATE. Every action that turns this estimate into something a client
   * holds — the PDF, an attachment onto a project — runs through here first.
   *
   * If he has already answered the markup question (any answer, including
   * zero), returns true and the caller proceeds untouched. If he has not, it
   * parks the caller's own continuation, opens the sheet, and returns false.
   * The parked callback is invoked with the chosen percent the moment he
   * answers, so his tap is honoured rather than swallowed by a modal he then
   * has to dismiss and re-tap behind.
   *
   * It takes the percent as an ARGUMENT rather than letting the continuation
   * read `markupPct` from its closure: `recordMarkupDecision` has not flushed
   * through React state by the time the continuation runs, so a closure read
   * would price the PDF at the OLD markup — which, the first time, is none at
   * all. That is the exact bug this whole change exists to remove, and it
   * would have reappeared one tick later.
   */
  const requireMarkup = useCallback((then: (pct: number) => void): boolean => {
    if (isMarkupSet(markupPct)) return true;
    pendingAfterMarkupRef.current = then;
    setMarkupInput('');
    setShowMarkupSheet(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    return false;
  }, [markupPct]);

  /** He answered. Record it forever, drain the deferred project write, and run
   *  whatever he was trying to do when we stopped him. */
  const applyMarkupChoice = useCallback((pct: number) => {
    recordMarkupDecision(pct);
    setShowMarkupSheet(false);
    setMarkupInput('');
    const pendingLink = pendingAutoLinkRef.current;
    pendingAutoLinkRef.current = null;
    if (pendingLink && projectId) commitAutoLink(pendingLink, pct, projectId);
    const then = pendingAfterMarkupRef.current;
    pendingAfterMarkupRef.current = null;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (!then) return;
    // Web and Android run it in THIS press: on web the PDF's window.open only
    // survives inside the user gesture. iOS waits for the Modal's onDismiss.
    if (Platform.OS === 'ios') {
      afterMarkupDismissRef.current = () => then(pct);
    } else {
      then(pct);
    }
  }, [recordMarkupDecision, projectId, commitAutoLink]);

  /** iOS: the markup sheet is fully gone — run what he was doing when asked. */
  const onMarkupSheetDismissed = useCallback(() => {
    const next = afterMarkupDismissRef.current;
    afterMarkupDismissRef.current = null;
    next?.();
  }, []);

  // The answer can arrive AFTER the park. `markupDecided` is null until
  // AsyncStorage resolves, so a generation that lands first parks the link-back
  // even for a contractor who answered months ago (and whose answer is being
  // seeded from the markup already on disk). Draining here means he never sees
  // "Not saved to …" for a question he has already answered — and the project
  // still gets exactly one write, at his real price.
  useEffect(() => {
    if (!autoLinkParked || !isMarkupSet(markupPct)) return;
    const parked = pendingAutoLinkRef.current;
    pendingAutoLinkRef.current = null;
    if (parked && projectId) commitAutoLink(parked, markupPct, projectId);
    else setAutoLinkParked(false);
  }, [autoLinkParked, markupPct, projectId, commitAutoLink]);

  /** Open the sheet from the margin band — no action parked behind it, he is
   *  just changing his mind about the number. */
  const openMarkupSheet = useCallback(() => {
    pendingAfterMarkupRef.current = null;
    setMarkupInput(isMarkupSet(markupPct) ? String(markupPct) : '');
    setShowMarkupSheet(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [markupPct]);

  /** Dismissed without answering. The parked action is DROPPED, not silently
   *  run at cost — he asked to send a priced bid and we could not build one.
   *
   *  The parked ?projectId link-back is deliberately NOT dropped: he can still
   *  answer from the at-cost band or the primary button, and the estimate then
   *  lands on the project at his real price. What must not survive the dismiss
   *  is the claim that it already landed — `autoLinkParked` stays true and the
   *  primary button below says "not saved yet" instead of "Saved to …". */
  const dismissMarkupSheet = useCallback(() => {
    pendingAfterMarkupRef.current = null;
    afterMarkupDismissRef.current = null;
    setShowMarkupSheet(false);
  }, []);

  // The PDF actually goes out from here, and ONLY from here. It takes the
  // branding and the payment split as arguments rather than reading `settings`
  // itself, because the ask sheet hands it values that were typed one tick ago:
  // updateSettings / savePaymentTerms write through the offline queue, so the
  // `settings` captured in this closure is still the blank one the user was
  // just asked to fill in.
  //
  // It also takes the PRICED estimate as an argument, for the same reason: the
  // markup gate can hand it a freshly-priced breakdown one tick before React
  // has re-rendered `result`. Reading `result` from the closure here would
  // print the contractor's cost on the homeowner's PDF.
  const generateAndSharePdf = useCallback(async (branding: CompanyBranding, priced: EstimateResult, split: PaymentSplit) => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharingPdf(true);
    try {
      await shareQuickEstimatePDF(priced, answers, branding, split);
      // Activation funnel: the final funnel step — priced estimate sent to client.
      track(AnalyticsEvents.ESTIMATE_SHARED, {
        method: 'pdf_share',
        source: 'estimate_wizard',
        grand_total: priced.total,
      });
      // Onboarding arc: the bid has just left his hands, so this is the one
      // moment the ask follows a delivered artifact rather than replacing one.
      // The project (if the estimate is attached to one) rides along so the
      // paywall's "Continue on the free plan" returns him to it.
      if (isOnboarding) {
        const attachedId = committedProjectId ?? savedProjectId;
        router.replace(attachedId
          ? ({ pathname: '/onboarding-paywall', params: { projectId: attachedId } } as never)
          : ONBOARDING_PAYWALL_ROUTE);
      } else {
        // The contextual push ask. A proposal that just left for a homeowner is
        // the moment a reply notification obviously matters; NotificationContext
        // owns the once-only rule. Never during onboarding — the flow is still
        // mid-arc and a system dialog there spends the one iOS prompt cold.
        void maybeAskForPush('estimate_shared');
      }
    } catch (err) {
      showAlert('Share failed', err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      sharingRef.current = false;
      setSharingPdf(false);
    }
  }, [answers, isOnboarding, router, maybeAskForPush, committedProjectId, savedProjectId]);

  const share = useCallback(() => {
    if (!costResult) return;
    const go = (pct: number) => {
      const priced = priceCostBreakdown(costResult, pct);
      // Held between the two halves below on native. `then` keeps the press
      // (web: window.open must happen inside it); the native print → share
      // sheet waits for the ask sheet to finish sliding out, because iOS will
      // not present a share sheet over a modal that is still dismissing.
      let answered: { branding: CompanyBranding; split: PaymentSplit } | null = null;
      gate.run(
        {
          identity: true,
          terms: true,
          purpose: 'proposal_pdf',
          total: priced.total,
          projectType: scopedProject?.type ?? null,
        },
        (a) => {
          if (Platform.OS === 'web') void generateAndSharePdf(a.branding, priced, a.split);
          else answered = { branding: a.branding, split: a.split };
        },
        {
          afterDismiss: () => {
            if (answered) void generateAndSharePdf(answered.branding, priced, answered.split);
          },
        },
      );
    };
    // Two gates stand between this tap and a homeowner's inbox. The markup
    // sheet refuses to send a bid with nobody's profit in it; the ask sheet
    // refuses to send one with nobody's name on it, or with payment terms the
    // GC never gave. The markup sheet comes first, and on iOS its continuation
    // (which may open the ask sheet) runs from its onDismiss, so the two are
    // never on screen together.
    if (!requireMarkup(go)) return;
    go(markupPct as number);
  }, [costResult, gate, scopedProject?.type, generateAndSharePdf, requireMarkup, markupPct]);

  const reset = useCallback(() => {
    // Same seed as mount: "start over" must not un-learn his market.
    setAnswers(!projectId && homeMarketSeed ? { ...INITIAL_SCOPE, location: homeMarketSeed } : INITIAL_SCOPE);
    setCostResult(null);
    setGroundingUsed(null);
    setStep(0);
    setSavedProjectId(null);
    setCommittedProjectId(null);
    setAutoLinkParked(false);
    pendingAutoLinkRef.current = null;
  }, [projectId, homeMarketSeed]);

  // Attach the just-generated estimate to an EXISTING project, then jump to
  // it. Reuses commitEstimatePatch (same revision-history behavior as the
  // ?projectId link-back and the drawing analyzer).
  const attachAt = useCallback((targetId: string, pct: MarkupPct) => {
    if (!costResult) return;
    const linkedEstimate = buildQuickLinkedEstimate(costResult, pct, generateUUID);
    const targetProject = getProject(targetId);
    updateProject(targetId, commitEstimatePatch(targetProject, linkedEstimate, { reason: 'pre_overwrite' }));
    // G4: fire-and-forget capture — ledger failure must never break project link
    try {
      if (targetProject) {
        const projectWithEstimate = { ...targetProject, linkedEstimate };
        const snapshotPayload = buildEstimateSnapshotPayload(
          projectWithEstimate, projects, commitments, receipts, laborSamples, seeds,
        );
        if (snapshotPayload) {
          recordPrediction(
            'estimate_confidence_snapshot',
            snapshotPayload.estimateId,
            snapshotPayload as unknown as Record<string, unknown>,
            targetId,
          );
        }
      }
    } catch { /* G4 */ }
    setShowSaveModal(false);
    setSavedProjectId(targetId);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Onboarding used to `router.replace` onto the paywall here, so the first
    // estimate the contractor ever built was two navigations behind him at the
    // exact moment he was asked to pay for it. Stay on the result: the primary
    // button below now reads "Saved to <project> — open project", and THAT is
    // where the ask happens (with the project as its exit).
    if (!isOnboarding) {
      router.push({ pathname: '/project-detail', params: { id: targetId } } as never);
    }
  }, [costResult, updateProject, getProject, router, projects, commitments, receipts, laborSamples, seeds, isOnboarding]);

  /** The gated entry point the save modal calls. A project must never receive
   *  an at-cost estimate from a contractor who was simply never asked: the
   *  budget, the WIP report and the client portal all read this number. */
  const attachToExisting = useCallback((targetId: string) => {
    if (!costResult) return;
    const go = (pct: number) => attachAt(targetId, pct);
    // The sheet takes over the screen, so the save modal closes behind it; the
    // attach resumes on his answer via the parked continuation.
    if (!requireMarkup(go)) { setShowSaveModal(false); return; }
    go(markupPct as number);
  }, [costResult, requireMarkup, markupPct, attachAt]);

  // Create a NEW project from the wizard answers, hydrate its linkedEstimate,
  // and jump to it. The wizard answers are also stamped onto project.scope so
  // the estimate re-opens in the wizard with zero re-keying.
  const createAt = useCallback((pct: MarkupPct) => {
    if (!costResult) return;
    const name = newProjectName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const id = generateUUID();
    const baseProject: Project = {
      id,
      name,
      type: mapProjectType(answers.projectType),
      location: answers.location.trim() || 'United States',
      squareFootage: Number(answers.sizeSqft) || 0,
      quality: mapQuality(answers.quality),
      description: answers.scope.trim(),
      scope: {
        projectType: answers.projectType,
        sizeSqft: answers.sizeSqft,
        location: answers.location,
        quality: answers.quality,
        scope: answers.scope,
        timelineWeeks: answers.timelineWeeks,
        specialRequirements: answers.specialRequirements,
        targetBudget: answers.targetBudget,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
      estimate: null,
      schedule: null,
      status: 'estimated',
    };
    // Fold the AI estimate in through the same commit path so the new
    // project starts with an estimate revision (rev 1), not a bare project.
    const linkedEstimate = buildQuickLinkedEstimate(costResult, pct, generateUUID);
    const withEstimate = { ...baseProject, ...commitEstimatePatch(baseProject, linkedEstimate, { reason: 'pre_overwrite' }) };
    addProject(withEstimate);
    // G4: fire-and-forget capture — ledger failure must never break project create
    try {
      const snapshotPayload = buildEstimateSnapshotPayload(
        withEstimate, [...projects, withEstimate], commitments, receipts, laborSamples, seeds,
      );
      if (snapshotPayload) {
        recordPrediction(
          'estimate_confidence_snapshot',
          snapshotPayload.estimateId,
          snapshotPayload as unknown as Record<string, unknown>,
          id,
        );
      }
    } catch { /* G4 */ }
    setShowSaveModal(false);
    setNewProjectName('');
    setSavedProjectId(id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (!isOnboarding) {
      // A project the user just created is the other moment a push is
      // obviously about something they own. This fires on every create, not
      // only the first — NotificationContext holds the once-only rule, so
      // whichever qualifying moment comes first is the one that asks. Same
      // onboarding exclusion as the share path.
      void maybeAskForPush('project_created');
      router.push({ pathname: '/project-detail', params: { id } } as never);
    }
    // In onboarding we stay on the result for the same reason as
    // attachToExisting above: show him the thing he made before asking for $29.
  }, [costResult, newProjectName, answers, addProject, router, projects, commitments, receipts, laborSamples, seeds, isOnboarding, maybeAskForPush]);

  /** Gated entry point for "create a new project from this estimate". The name
   *  check runs BEFORE the markup sheet — being stopped for a markup and then
   *  stopped again for a missing name is two modals for one tap. */
  const createFromEstimate = useCallback(() => {
    if (!costResult) return;
    if (!newProjectName.trim()) {
      showAlert('Name required', 'Give this project a name so you can find it later.');
      return;
    }
    if (!requireMarkup(createAt)) { setShowSaveModal(false); return; }
    createAt(markupPct as number);
  }, [costResult, newProjectName, requireMarkup, markupPct, createAt]);

  const progressWidth = `${((step + 1) / TOTAL_STEPS) * 100}%` as const;

  if (result) {
    // Group line items by category and compute subtotals + percentages.
    // Used for both the breakdown summary card AND the per-category
    // sections below — flat list was the user's complaint ("doesn't give
    // a good breakdown").
    const sizeNum = Number(answers.sizeSqft) || 0;
    const costPerSqft = sizeNum > 0 ? result.total / sizeNum : 0;
    const groups = new Map<string, typeof result.lineItems>();
    for (const li of result.lineItems) {
      const cat = li.category || 'Other';
      const arr = groups.get(cat) ?? [];
      arr.push(li);
      groups.set(cat, arr);
    }
    const sortedCategories = Array.from(groups.entries())
      .map(([cat, items]) => ({
        cat,
        items,
        subtotal: items.reduce((s, li) => s + li.total, 0),
      }))
      .sort((a, b) => b.subtotal - a.subtotal);

    // Estimate metadata for the in-app preview, mirroring what the PDF
    // generator stamps on the client-facing doc. The estimate # changes
    // every regenerate — that's intentional, the GC will see the same
    // number on the PDF they share.
    const validUntilDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    })();
    const todayLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    // Payment terms preview — the GC's own split, the same rows the PDF prints
    // (utils/paymentTerms.paymentStageRows). Not set → the card says so and
    // offers to set it; the PDF cannot go out without it (share asks first).
    const previewSplit = resolvePaymentSplit({ settings }).split;
    const previewStages = previewSplit ? paymentStageRows(result.total, previewSplit) : [];

    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Estimate', ...(isOnboarding ? { headerLeft: () => null, gestureEnabled: false } : {}) }} />
        <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]}>
          {/* ── THE MARGIN BAND ──────────────────────────────────────────
              CONTRACTOR-ONLY. It is rendered above the "this is what your
              client sees" banner precisely because it is the one thing on
              this screen the client must never see, and it is rendered at
              ALL because the wizard used to show a cost total with nothing
              saying so. utils/scopeQuestions asks the model for materials,
              labor, permits and contingency — there is no profit anywhere in
              that prompt, and there never was. The number below the band is
              his cost until he says otherwise.

              Never asserts a markup he did not set: with no answer on file it
              reports the cost as a cost and asks the question. */}
          {atCost ? (
            <TouchableOpacity
              style={styles.atCostBand}
              onPress={openMarkupSheet}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={isMarkupSet(markupPct)
                ? 'You are quoting at cost. Change your markup.'
                : 'This estimate is your cost. Set what you charge on top.'}
              testID="estimate-wizard-at-cost-band"
            >
              <AlertTriangle size={18} color={themeColors.dangerLabel} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.atCostTitle}>
                  {isMarkupSet(markupPct) ? 'Quoted at cost — no profit' : 'This number is your cost'}
                </Text>
                <Text style={styles.atCostBody}>
                  {isMarkupSet(markupPct)
                    ? 'Your markup is set to none, so this bid carries no overhead and no profit. Tap to change it.'
                    : 'Materials, labor, permits and contingency — nothing on top. Tap to set what you charge.'}
                </Text>
              </View>
              <ChevronRight size={16} color={themeColors.dangerLabel} strokeWidth={2} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.marginBand}
              onPress={openMarkupSheet}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Your markup is ${markupPct} percent. Tap to change it.`}
              testID="estimate-wizard-margin-band"
            >
              <Percent size={16} color={themeColors.accent} strokeWidth={2.25} />
              <View style={{ flex: 1 }}>
                <Text style={styles.marginBandTitle}>
                  {`Your cost $${Math.round(costResult?.total ?? 0).toLocaleString()}`}
                  {'  ·  '}
                  {`+${markupPct}% markup`}
                </Text>
                <Text style={styles.marginBandBody}>
                  {`$${Math.round(result.total - (costResult?.total ?? 0)).toLocaleString()} of overhead and profit — a ${(marginOf(markupPct as number) * 100).toFixed(1)}% gross margin. Only you see this row.`}
                </Text>
              </View>
              <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          )}

          {/* "Client preview" banner — reminds the GC that what they see
              IS what the homeowner sees. Soft contextual cue at the top. */}
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerText}>This is the estimate your client will see</Text>
          </View>

          <View style={styles.heroCard}>
            <BrandBackdrop />
            <Text style={styles.heroEyebrow}>CONSTRUCTION ESTIMATE</Text>
            <TapeRollNumber
              value={result.total}
              prefix="$"
              decimals={0}
              duration={1100}
              style={styles.heroTotal}
            />
            <Text style={styles.heroSubtitle}>{answers.projectType}{answers.sizeSqft ? ` · ${answers.sizeSqft} sqft` : ''}{answers.location ? ` · ${answers.location}` : ''}</Text>
            {costPerSqft > 0 ? (
              <View style={styles.heroChip}><Text style={styles.heroChipText}>${costPerSqft.toFixed(0)} per sqft</Text></View>
            ) : null}
          </View>

          {/* Estimate metadata — prepared / valid / location. Same row
              that prints at the top of the PDF. */}
          <View style={styles.metaCard}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Prepared on</Text>
              <Text style={styles.metaValue}>{todayLabel}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Valid until</Text>
              <Text style={[styles.metaValue, { color: themeColors.accent }]}>{validUntilDate}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Quality</Text>
              <Text style={styles.metaValue}>{QUALITY_LABELS[answers.quality]}</Text>
            </View>
          </View>

          {/* At-a-glance stat tiles — labels updated to client-friendly
              language. "Categories" / "Line items" was internal jargon. */}
          <View style={styles.statGrid}>
            {sizeNum > 0 ? (
              <View style={styles.statTile}>
                <Text style={styles.statLabel}>Project size</Text>
                <Text style={styles.statValue}>{sizeNum.toLocaleString()}</Text>
                <Text style={styles.statUnit}>sqft</Text>
              </View>
            ) : null}
            {answers.timelineWeeks ? (
              <View style={styles.statTile}>
                <Text style={styles.statLabel}>Timeline</Text>
                <Text style={styles.statValue}>{answers.timelineWeeks}</Text>
                <Text style={styles.statUnit}>weeks</Text>
              </View>
            ) : null}
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Contingency</Text>
              <Text style={styles.statValue}>{result.subtotal > 0 ? `${Math.round(result.contingency / result.subtotal * 100)}%` : '—'}</Text>
              <Text style={styles.statUnit}>buffer</Text>
            </View>
          </View>

          {result.summary ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Scope of Work</Text>
              <Text style={styles.summaryText}>{result.summary}</Text>
              {answers.scope && answers.scope !== result.summary ? (
                <Text style={styles.summaryNote}>{answers.scope}</Text>
              ) : null}
              {answers.specialRequirements ? (
                <View style={styles.specialReq}>
                  <Text style={styles.specialReqLabel}>Special requirements</Text>
                  <Text style={styles.specialReqText}>{answers.specialRequirements}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {result.total > 0 ? (
            <>
              {/* No `?? 70`. When the model returns no confidence, BrainCard
                  omits the pill AND the meter, and the grounding line says so
                  — an absent score must not look like an earned one. */}
              <BrainCard
                style={styles.brainCardSpacing}
                confidence={result.confidence}
                ground={[
                  // AI-F4: "learned" counts MEASURED entries only; a stated
                  // rate is named as one you set; a calibration-only prompt
                  // says history-only (utils/groundingChip). Read from the
                  // bundle stored for THIS run, never a live memo.
                  groundingChipLabel((groundingUsed ?? EMPTY_GROUNDING).counts, { calibration: groundingUsed?.calibration }),
                  result.confidence === undefined ? 'No confidence score returned for this run' : null,
                ].filter(Boolean).join(' · ')}
                lead={result.refineWith && result.refineWith.length > 0
                  ? `Answer ${result.refineWith.length} question${result.refineWith.length === 1 ? '' : 's'} below to sharpen the number`
                  : undefined}
              />
              {/* Empty cost book: don't just confess to generic pricing, hand
                  them the fix. Closing jobs is the long road; seeding the
                  rates they already know works today. */}
              {(groundingUsed?.selectedCount ?? 0) === 0 ? (
                <TouchableOpacity
                  style={styles.seedPrompt}
                  onPress={() => router.push('/cost-seed' as never)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Add your own rates so estimates price from your numbers"
                  testID="estimate-wizard-seed-cta"
                >
                  <TrendingUp size={16} color={themeColors.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.seedPromptTitleRow}>
                      <Text style={styles.seedPromptTitle}>Price this from your numbers</Text>
                      {/* The tier, BEFORE the tap. "Takes a minute" landed on a
                          $29 wall — and it landed there ~90 seconds after the
                          identical paste box was free during onboarding. A
                          blocked action has to say why it is blocked. */}
                      {seedNeedsUpgrade ? (
                        <View style={styles.seedPromptTierPill}>
                          <Text style={styles.seedPromptTierPillText}>PRO</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.seedPromptBody}>
                      {seedNeedsUpgrade
                        ? 'Paste or type the rates you already charge and the next estimate is yours instead of the market\u2019s. Seeding your rates is part of Pro.'
                        : 'Paste or type the rates you already charge \u2014 takes a minute, and the next estimate is yours instead of the market\u2019s.'}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}

          {result.refineWith && result.refineWith.length > 0 && (
            <View style={styles.refineCard}>
              <Text style={styles.refineTitle}>Sharpen this estimate</Text>
              {/* Refining is not editing: the answer is appended to the prompt
                  and the model is asked again, which spends one of the two free
                  AI estimates. It used to do that silently, so a contractor who
                  thought he was tweaking his own number was spending his last
                  trial and meeting the wall on the next tap. */}
              {freeRunsLeft !== null ? (
                <Text style={styles.refineMeter}>
                  {freeRunsLeft > 0
                    ? `Each answer re-prices the whole estimate with AI — it uses one of your ${freeRunsLeft} free AI estimate${freeRunsLeft === 1 ? '' : 's'}.`
                    : 'Your free AI estimates are used up — answering here will ask you to upgrade.'}
                </Text>
              ) : null}
              {result.refineWith.map((rfn, i) => (
                <View key={i}>
                  <TouchableOpacity
                    onPress={() => { setRefineIdx(refineIdx === i ? null : i); setRefineText(''); }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Answer: ${rfn}`}
                  >
                    <Text style={styles.refineItem}>{refineIdx === i ? '▾' : '▸'} {rfn}</Text>
                  </TouchableOpacity>
                  {refineIdx === i ? (
                    <View style={styles.refineAnswerRow}>
                      <TextInput
                        style={styles.refineInput}
                        value={refineText}
                        onChangeText={setRefineText}
                        placeholder="Your answer…"
                        placeholderTextColor={themeColors.textMuted}
                        autoFocus
                        returnKeyType="done"
                      />
                      <TouchableOpacity
                        onPress={() => {
                          const detail = refineText.trim();
                          if (!detail) return;
                          const nextAnswers: WizardAnswers = {
                            ...answers,
                            specialRequirements: (answers.specialRequirements ? answers.specialRequirements + '\n' : '') + `${rfn}: ${detail}`,
                          };
                          setAnswers(nextAnswers);
                          setRefineIdx(null);
                          setRefineText('');
                          void generate(nextAnswers);
                        }}
                        disabled={!refineText.trim() || loading}
                        style={[styles.refineGoBtn, (!refineText.trim() || loading) && styles.primaryBtnDisabled]}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Add answer and refine estimate"
                      >
                        <Text style={styles.refineGoText}>
                          {freeRunsLeft !== null && freeRunsLeft > 0 ? 'Refine · uses 1 free' : 'Refine'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* Cost Distribution — same layout as the PDF, percentage bars. */}
          {result.total > 0 && sortedCategories.length > 0 ? (
            <View style={styles.breakdownCard}>
              <Text style={styles.breakdownTitle}>Cost Distribution</Text>
              {sortedCategories.map(({ cat, subtotal }, i) => {
                const pct = result.total > 0 ? (subtotal / result.total) * 100 : 0;
                const barColor = BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length];
                return (
                  <View key={i} style={styles.breakdownRow}>
                    <View style={styles.breakdownHead}>
                      <View style={styles.breakdownCatWrap}>
                        <View style={[styles.breakdownDot, { backgroundColor: barColor }]} />
                        <Text style={styles.breakdownCat}>{cat}</Text>
                      </View>
                      <Text style={styles.breakdownAmt}>
                        ${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} <Text style={styles.breakdownPct}>· {pct.toFixed(1)}%</Text>
                      </Text>
                    </View>
                    <View style={styles.breakdownBar}>
                      <View style={[styles.breakdownBarFill, { width: `${Math.max(pct, 1)}%`, backgroundColor: barColor }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Detailed line items, grouped by category, biggest first.
              Each category card has its own subtotal + % so the GC can
              still drill into specifics. */}
          <Text style={styles.sectionTitle}>Detailed Line Items</Text>
          {sortedCategories.map(({ cat, items, subtotal }, ci) => {
            const pct = result.total > 0 ? (subtotal / result.total) * 100 : 0;
            return (
              <View key={ci} style={styles.categoryCard}>
                <View style={styles.categoryHeader}>
                  <Text style={styles.categoryName}>{cat}</Text>
                  <View style={styles.categoryHeadRight}>
                    <Text style={styles.categoryMeta}>{pct.toFixed(0)}% · {items.length} item{items.length === 1 ? '' : 's'}</Text>
                    <Text style={styles.categoryTotal}>${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </View>
                </View>
                {items.map((li, i) => (
                  <View key={i} style={styles.lineItemNew}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineDesc}>{li.description}</Text>
                      <Text style={styles.lineMeta}>{li.quantity} {li.unit} × ${li.unitCost.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.lineTotal}>${li.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </View>
                ))}
              </View>
            );
          })}

          <View style={styles.totalsBlockNew}>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Line items subtotal</Text><Text style={styles.totalValue}>${result.subtotal.toLocaleString()}</Text></View>
            <View style={styles.totalRow}>
              {/* Names the rate and its source, so an 8% line is defensible
                  when a client asks — and so a GC who never set one can see
                  the 10% default is a setting, not the model's judgment. */}
              <Text style={styles.totalLabel} testID="wizard-contingency-label">
                {contingencyRateUsed != null
                  ? `Contingency · ${contingencyRateUsed}% (your default in Settings)`
                  : 'Contingency'}
              </Text>
              <Text style={styles.totalValue}>${result.contingency.toLocaleString()}</Text>
            </View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Permits & fees</Text><Text style={styles.totalValue}>${result.permits.toLocaleString()}</Text></View>
            <View style={[styles.totalRow, styles.totalRowGrand]}>
              <View>
                <Text style={styles.grandLabel}>Estimated total</Text>
                {costPerSqft > 0 ? (
                  <Text style={styles.grandSubLabel}>${costPerSqft.toFixed(0)}/sqft · {sizeNum.toLocaleString()} sqft</Text>
                ) : null}
              </View>
              <Text style={styles.grandValue}>${result.total.toLocaleString()}</Text>
            </View>
          </View>

          {/* What's Included — derived from category list (so it's
              honest — these are the categories actually estimated). */}
          {sortedCategories.length > 0 ? (
            <View style={styles.includedCard}>
              <Text style={styles.sectionTitle}>What's Included</Text>
              <View style={styles.includedChips}>
                {sortedCategories.map(({ cat }, i) => (
                  <View key={i} style={styles.includedChip}>
                    <Text style={styles.includedChipText}>{cat}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.includedFootnote}>
                All labor, materials, equipment, supervision, and required permits for the categories above as detailed in the line items.
              </Text>
            </View>
          ) : null}

          {/* What's Not Included — boilerplate residential exclusions.
              These prevent 90% of "I thought that was included" disputes.
              Same list as the PDF. */}
          <View style={styles.excludedCard}>
            <Text style={styles.sectionTitle}>What's Not Included</Text>
            <Text style={styles.excludedItem}>• Architectural / engineering / design fees</Text>
            <Text style={styles.excludedItem}>• HOA, city, or third-party plan-review fees beyond standard permits</Text>
            <Text style={styles.excludedItem}>• Asbestos, lead, mold, or other hazardous-material abatement</Text>
            <Text style={styles.excludedItem}>• Unforeseen conditions discovered after demolition begins</Text>
            <Text style={styles.excludedItem}>• Landscaping, fencing, or exterior work outside the stated scope</Text>
            <Text style={styles.excludedItem}>• Owner-supplied materials or fixtures (handled separately)</Text>
            <Text style={styles.excludedItem}>• Sales tax (where required) · Financing costs · Insurance riders</Text>
          </View>

          {/* Payment Terms — his split, never a default. When he has not
              given one, this GC-only line says so rather than showing a
              schedule the homeowner would never receive. */}
          <View style={styles.paymentCard} testID="wizard-payment-terms">
            <Text style={styles.sectionTitle}>Payment Terms</Text>
            {previewSplit ? (
              previewStages.map((row, i) => (
                <View
                  key={row.key}
                  style={[styles.paymentRow, i === previewStages.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={styles.paymentRowLeft}>
                    <Text style={styles.paymentRowTitle}>{`${row.label} (${row.pct}%)`}</Text>
                    <Text style={styles.paymentRowDesc}>{row.detail}</Text>
                  </View>
                  <Text style={styles.paymentRowAmt}>${row.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))
            ) : (
              <View style={styles.paymentNotSet} testID="wizard-payment-terms-not-set">
                <Text style={styles.paymentRowDesc}>
                  Payment terms — not set yet. You'll be asked before this goes to your client.
                </Text>
                <Button
                  label="Set now"
                  size="sm"
                  variant="secondary"
                  onPress={() => { gate.run({ terms: true, purpose: 'proposal_pdf', total: result.total, projectType: scopedProject?.type ?? null }, () => {}); }}
                  testID="wizard-payment-terms-set"
                />
              </View>
            )}
          </View>

          {/* Acceptance / Next Steps — soft CTA to the client. */}
          <View style={styles.acceptanceCard}>
            <Text style={styles.acceptanceTitle}>Ready to move forward?</Text>
            <Text style={styles.acceptanceBody}>
              {acceptanceSentence(previewSplit)}
            </Text>
          </View>

          {result.notes.length > 0 && (
            <View style={styles.notesBlock}>
              <Text style={styles.sectionTitle}>Project Notes</Text>
              {result.notes.map((n, i) => (
                <Text key={i} style={styles.noteRow}>• {n}</Text>
              ))}
            </View>
          )}

          <Text style={styles.disclaimer}>
            This is a project estimate, not a fixed-price quote, unless explicitly stated in a signed agreement. Quantities, unit prices, and materials are subject to change based on field conditions, market pricing, and design revisions.
          </Text>

          {/* Network-effect CTA: post this scope to the MAGE sub-bid
              network. Per billion-dollar-strategy.md §3 Bet E — this is
              the Levelset pattern, the moat slide for the $1B exit. We
              capture demand now via feature_interest; real broadcast
              ships once we hit local-sub density. */}
          <RevenueEarlyAccessCard
            eventKey="revenue.sub_bid_network"
            icon={Users}
            headline="Post this scope to vetted subs"
            body="Push the trades-by-line-item to qualified subs in your area, instead of emailing the set to each one and waiting."
            footer="Sub-bid network launches when your metro hits 50 active subs per trade"
            testID="estimate-subbid-cta"
          />

          {(() => {
            // Which project (if any) this estimate is now WRITTEN to: either
            // the ?projectId link-back once commitAutoLink has actually run,
            // or a project the standalone user just saved to via the modal.
            // Deriving this from the route param instead is what put a green
            // "Saved to …" over a project that had received nothing.
            const attachedId = committedProjectId ?? savedProjectId;
            const attachedProject = attachedId ? getProject(attachedId) : null;
            const hasProject = !!attachedProject;
            // Generated with a ?projectId, but the write is waiting on the
            // markup answer. Neither "saved" nor "save to a project" is true.
            const parkedProject = (!hasProject && autoLinkParked) ? scopedProject : null;
            return (
          <View style={styles.resultActions}>
            {hasProject ? (
              <TouchableOpacity
                style={styles.resultPrimaryBtn}
                onPress={() => {
                  if (isOnboarding) {
                    // The ask, once — and it knows where he was going, so
                    // "Continue on the free plan" lands on his project instead
                    // of an empty Summary.
                    router.replace({ pathname: '/onboarding-paywall', params: { projectId: attachedId! } } as never);
                  } else {
                    router.push({ pathname: '/project-detail', params: { id: attachedId! } } as never);
                  }
                }}
                activeOpacity={0.85}
                disabled={sharingPdf}
                testID="wizard-view-project"
              >
                <CheckCircle2 size={18} color="#FFF" strokeWidth={1.75} />
                {/* In onboarding this button opens the ask, and the paywall's
                    "Continue on the free plan" carries him on to the project —
                    so the label must not promise the project one tap earlier
                    than it arrives. */}
                <Text style={styles.resultPrimaryText} numberOfLines={1}>
                  Saved to {attachedProject.name}{isOnboarding ? ' — continue' : ' — open project'}
                </Text>
              </TouchableOpacity>
            ) : parkedProject ? (
              // Held, not saved. The estimate is priced at cost until he
              // answers, so writing it to the project would put his cost into
              // the budget, the WIP and the portal. Say so, and reopen the one
              // question that unblocks it.
              <TouchableOpacity
                style={[styles.resultPrimaryBtn, { backgroundColor: Colors.error }]}
                onPress={openMarkupSheet}
                activeOpacity={0.85}
                disabled={sharingPdf}
                testID="wizard-attach-blocked"
              >
                <AlertTriangle size={18} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.resultPrimaryText} numberOfLines={1}>
                  Not saved to {parkedProject.name} — set your markup
                </Text>
              </TouchableOpacity>
            ) : (
              // Standalone result — the estimate is not attached anywhere.
              // Without this the number is discarded the moment they leave.
              <TouchableOpacity
                style={styles.resultPrimaryBtn}
                onPress={() => { setShowSaveModal(true); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
                activeOpacity={0.85}
                disabled={sharingPdf}
                testID="wizard-save-to-project"
              >
                <FolderPlus size={18} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.resultPrimaryText} numberOfLines={1}>Save to a project</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.resultSecondaryBtn}
              onPress={share}
              activeOpacity={0.85}
              disabled={sharingPdf}
              testID="wizard-share"
            >
              {sharingPdf ? (
                <ActivityIndicator size="small" color={themeColors.text} />
              ) : (
                <>
                  <FileDown size={18} color={themeColors.text} strokeWidth={1.75} />
                  <Text style={styles.resultSecondaryText}>
                    {Platform.OS === 'web' ? 'Open PDF preview' : 'Download & share PDF'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resultSecondaryBtn}
              onPress={reset}
              activeOpacity={0.8}
              disabled={sharingPdf}
              testID="wizard-reset"
            >
              <RotateCcw size={16} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.resultSecondaryText}>Start a new estimate</Text>
            </TouchableOpacity>
            {/* Win Optimizer — contextual decision-moment link. After building
                an estimate the GC is thinking about bid price; Win Optimizer
                uses their win/loss history to recommend the price that
                maximises expected profit. Cross-link here so it's
                discoverable at the decision moment.

                HIDDEN DURING ONBOARDING. The onboarding branch did
                router.replace(ONBOARDING_PAYWALL_ROUTE) — a REPLACE, so it
                destroyed the very first estimate the contractor had just
                built (this file states that estimate "is discarded the moment
                they leave"), and landed him on a paywall that never names Win
                Optimizer, so he could not tell what he had been asked to buy.
                A brand-new user also has no win/loss history for it to read.
                A missing link is honest; that one was not. */}
            {!isOnboarding && (
              <TouchableOpacity
                style={[styles.resultSecondaryBtn, { borderColor: themeColors.accent + '40' }]}
                onPress={() => router.push('/win-optimizer' as never)}
                activeOpacity={0.85}
                testID="wizard-win-optimizer"
              >
                <TrendingUp size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={[styles.resultSecondaryText, { color: themeColors.accent }]}>Optimize your bid price</Text>
              </TouchableOpacity>
            )}
          </View>
            );
          })()}
        </ScrollView>

        {/* Save-to-project modal — cross-platform (no Alert.prompt). Lets a
            standalone user attach the estimate to an existing project or
            create a new one, folding the AI line items into its estimate. */}
        <Modal visible={showSaveModal} transparent animationType="slide" onRequestClose={() => setShowSaveModal(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.saveOverlay}>
              <View style={[styles.saveCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.saveHeader}>
                  <Text style={styles.saveTitle}>Save estimate</Text>
                  <TouchableOpacity onPress={() => setShowSaveModal(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {/* Create a brand-new project from this estimate */}
                <Text style={styles.saveSectionLabel}>New project</Text>
                <View style={styles.saveInputRow}>
                  <TextInput
                    style={styles.saveInput}
                    value={newProjectName}
                    onChangeText={setNewProjectName}
                    placeholder={answers.projectType || 'Project name'}
                    placeholderTextColor={themeColors.textMuted}
                    returnKeyType="done"
                    onSubmitEditing={createFromEstimate}
                    testID="wizard-new-project-name"
                  />
                  <TouchableOpacity
                    style={styles.saveCreateBtn}
                    onPress={createFromEstimate}
                    activeOpacity={0.85}
                    testID="wizard-create-project"
                  >
                    <Plus size={16} color="#FFF" strokeWidth={2} />
                    <Text style={styles.saveCreateText}>Create</Text>
                  </TouchableOpacity>
                </View>

                {projects.length > 0 ? (
                  <>
                    <Text style={[styles.saveSectionLabel, { marginTop: 18 }]}>Or add to an existing project</Text>
                    <ScrollView style={styles.saveList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                      {projects.map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.saveProjectRow}
                          onPress={() => attachToExisting(p.id)}
                          activeOpacity={0.7}
                          testID={`wizard-attach-${p.id}`}
                        >
                          <Text style={styles.saveProjectName} numberOfLines={1}>{p.name}</Text>
                          <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                ) : null}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── THE MARKUP SHEET ────────────────────────────────────────────
            Asked once, ever (MaterialCartContext.markupDecided), at the only
            moment the question is concrete: a real number for a real job is
            on the screen behind it.

            THREE THINGS THIS SHEET DELIBERATELY DOES NOT DO.

            It does not preselect a percentage. Not 15, not 20, not the industry
            median. A contractor's markup encodes his overhead structure, his
            risk, and what his market bears; an app that fills it in is telling
            him what to charge and will be believed. Every choice below is an
            equal, unhighlighted option.

            It does not hide the arithmetic. Each preset shows the MARGIN it
            actually yields, because markup and margin are different numbers
            and conflating them is the most common way a contractor loses the
            points he thought he had: 25% markup is 20% margin, and a man
            aiming for 25 points who types 25 here walks away with 20.

            It does not treat "none" as a failure to answer. Cost-plus work and
            a favour for a friend are real, and "none" is recorded as a real
            decision so he is never asked again — the at-cost band on the
            estimate is what keeps that honest instead of a nagging re-prompt.

            It is dismissible. The estimate is still useful to him as a cost
            check, and a modal he cannot close is a modal he learns to hate.
            What is NOT dismissible is sending it: `requireMarkup` re-opens
            this sheet from the share and save paths, so nothing at cost can
            reach a client without him having said, in as many words, that
            that is what he wants. */}
        <Modal visible={showMarkupSheet} transparent animationType="slide" onRequestClose={dismissMarkupSheet} onDismiss={onMarkupSheetDismissed}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.saveOverlay}>
              <View style={[styles.saveCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.saveHeader}>
                  <Text style={styles.saveTitle}>What do you add on top of cost?</Text>
                  <TouchableOpacity onPress={dismissMarkupSheet} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.identityReason}>
                  {`The $${Math.round(costResult?.total ?? 0).toLocaleString()} behind this sheet is what the job costs you — materials, labor, permits and contingency. Your overhead and profit go on top. We ask once and remember it.`}
                </Text>

                <Text style={styles.saveSectionLabel}>Markup on cost</Text>
                <View style={styles.markupGrid}>
                  {MARKUP_CHOICES.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={styles.markupChoice}
                      onPress={() => applyMarkupChoice(c)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`${c} percent markup, a ${(marginOf(c) * 100).toFixed(0)} percent margin`}
                      testID={`wizard-markup-${c}`}
                    >
                      <Text style={styles.markupChoicePct}>+{c}%</Text>
                      <Text style={styles.markupChoiceMargin}>{(marginOf(c) * 100).toFixed(0)}% margin</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.saveSectionLabel}>Or your own number</Text>
                <View style={styles.markupCustomRow}>
                  <TextInput
                    style={[styles.saveInput, { flex: 1, marginBottom: 0 }]}
                    value={markupInput}
                    onChangeText={setMarkupInput}
                    placeholder="e.g. 18"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    testID="wizard-markup-custom"
                  />
                  <Text style={styles.markupCustomSuffix}>%</Text>
                  <TouchableOpacity
                    style={[styles.markupApply, !(parseFloat(markupInput) > 0) && styles.markupApplyOff]}
                    disabled={!(parseFloat(markupInput) > 0)}
                    onPress={() => applyMarkupChoice(parseFloat(markupInput))}
                    accessibilityRole="button"
                    accessibilityLabel="Use this markup"
                    testID="wizard-markup-apply"
                  >
                    <Text style={styles.markupApplyText}>Use</Text>
                  </TouchableOpacity>
                </View>
                {parseFloat(markupInput) > 0 ? (
                  <Text style={styles.markupCustomHint}>
                    {`+${parseFloat(markupInput)}% on cost is a ${(marginOf(parseFloat(markupInput)) * 100).toFixed(1)}% gross margin — $${Math.round((costResult?.total ?? 0) * (parseFloat(markupInput) / 100)).toLocaleString()} on this job.`}
                  </Text>
                ) : null}

                <TouchableOpacity
                  style={styles.markupNone}
                  onPress={() => applyMarkupChoice(0)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Quote this at cost, with no markup"
                  testID="wizard-markup-none"
                >
                  <Text style={styles.markupNoneText}>I quote at cost — no markup</Text>
                  <Text style={styles.markupNoneSub}>Every estimate will say so, on screen and to you.</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* The one ask sheet (identity, then payment terms) behind the share
            and "Set now". Rendered once; it owns no copy of its own. */}
        <ClientDocumentAskSheet {...gate.sheet} />

        <UpgradeSheet
          visible={!!upgradeLimit}
          limit={upgradeLimit}
          featureLabel="AI Estimate"
          onClose={() => setUpgradeLimit(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Quick Estimate', ...(isOnboarding ? { headerLeft: () => null, gestureEnabled: false } : {}) }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressLabel}>Step {step + 1} of {TOTAL_STEPS}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 && !!projectId && (
            <TouchableOpacity
              style={styles.voiceBanner}
              onPress={() => router.replace({ pathname: '/copilot', params: { capabilityId: 'estimate', projectId } } as never)}
              activeOpacity={0.85}
              testID="estimate-voice-entry"
            >
              <Mic size={18} color={themeColors.accent} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.voiceBannerTitle}>Build by voice instead</Text>
                <Text style={styles.voiceBannerDesc}>Say the scope — MAGE prices it from your past jobs</Text>
              </View>
              <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
          {isOnboarding && (
            <View style={styles.onboardingBanner} testID="estimate-onboarding-banner">
              <Text style={styles.onboardingBannerTitle}>Your first bid</Text>
              {/* Onboarding lets him skip the rate paste, and this line claimed
                  his rates were pricing the bid either way. Same discriminator
                  the grounding chip uses on the result screen (utils/groundingChip):
                  with no seeds and no closed jobs the number is a market average. */}
              <Text style={styles.onboardingBannerSubtitle}>
                {seedsLoading
                  // Neither claim until the seed query answers: an empty array
                  // before it does is not an answer, and guessing either way
                  // tells someone something about his own numbers that we do
                  // not know yet.
                  ? 'Send it when it looks right.'
                  : seeds.length > 0
                    ? 'Priced off the rates you added — send it when it looks right.'
                    : 'Priced off market averages until you add your rates — send it when it looks right.'}
              </Text>
            </View>
          )}
          <ScopeQuestionStepper stepIndex={step} answers={answers} onChange={set} testIDPrefix="wizard" />
        </ScrollView>

        {stepHint ? (
          <View style={styles.stepHintRow}>
            <Text style={styles.stepHintText}>{stepHint}</Text>
          </View>
        ) : null}
        {/* The steps the model flags optional are now actually skippable. Before
            this, Generate existed only on the last screen, so "optional" meant
            "you still have to tap Next past it". */}
        {step >= FIRST_OPTIONAL_STEP && step < TOTAL_STEPS - 1 ? (
          <View style={styles.optionalRow}>
            <Text style={styles.optionalText}>
              Everything from here on is optional — it sharpens the number, it is not needed
              for one.
            </Text>
            <TouchableOpacity
              onPress={() => generate()}
              disabled={loading}
              style={[styles.optionalBtn, loading && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              testID="wizard-generate-now"
            >
              <MageAIMark size={16} color={themeColors.accent} />
              <Text style={styles.optionalBtnText}>
                Generate now{freeRunsLabel(freeRunsLeft) ? ` · ${freeRunsLabel(freeRunsLeft)}` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            onPress={step === 0
              // Cancel on the FIRST question used to land on the paywall: the
              // app asked for $29 having shown the contractor nothing at all.
              // Send him into the app instead; the paywall still owns every
              // path that follows a real result.
              ? () => (isOnboarding ? router.replace('/(tabs)/(home)' as never) : safeBack())
              : back}
            style={[styles.secondaryBtn, styles.footerBtn]}
            activeOpacity={0.8}
            testID="wizard-back"
          >
            <ChevronLeft size={18} color={themeColors.text} strokeWidth={1.75} />
            <Text style={styles.secondaryText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
          </TouchableOpacity>
          {step < TOTAL_STEPS - 1 ? (
            <TouchableOpacity
              onPress={() => {
                if (canAdvance) { next(); return; }
                // Never a silent dead end — say exactly what's missing.
                if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                setStepHint(stepBlockReason(step, answers));
              }}
              style={[styles.primaryBtn, styles.footerBtn, !canAdvance && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              accessibilityState={{ disabled: !canAdvance }}
              testID="wizard-next"
            >
              <Text style={styles.primaryText}>Next</Text>
              <ChevronRight size={18} color="#FFF" strokeWidth={1.75} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => generate()}
              disabled={loading}
              style={[styles.primaryBtn, styles.footerBtn, loading && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              testID="wizard-generate"
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <MageAIMark size={18} color="#FFF" />
                  <Text style={styles.primaryText}>
                    Generate Estimate{freeRunsLabel(freeRunsLeft) ? ` · ${freeRunsLabel(freeRunsLeft)}` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <EstimateLoadingOverlay
        visible={loading}
        title="Generating estimate…"
        // Nothing is retrieved: the model estimates from the answers plus the
        // grounding the steps name. The old line said materials, labor and
        // this year's pricing were being pulled — a lookup that never happens.
        subtitle="Usually 20–40 seconds. The model is estimating from your answers plus the grounding listed — nothing is pulled from a price list."
        // Loader copy from the counts of the bundle stored for THIS run: "your
        // history" only for a measured rate, "the rates you set" for a
        // seeded-only book, market averages otherwise (utils/groundingChip).
        thinkingSteps={estimateThinkingSteps((groundingUsed ?? EMPTY_GROUNDING).counts)}
        onCancel={cancelGenerate}
      />
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="AI Estimate"
        onClose={() => setUpgradeLimit(null)}
      />
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  // One-question-at-a-time wizard: a cap is correct, 680 was just tight.
  contentDesktop: { width: '100%', maxWidth: 900, alignSelf: 'center' as const },
  progressWrap: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
  },
  progressTrack: {
    height: 4, backgroundColor: themeColors.line, borderRadius: 2, overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: themeColors.accent },
  progressLabel: {
    fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 6, textAlign: 'center' as const,
  },
  footer: {
    flexDirection: 'row' as const, gap: 12,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: themeColors.line,
    backgroundColor: themeColors.bg,
  },
  footerBtn: { flex: 1 },
  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, backgroundColor: themeColors.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 14,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#FFF' },
  secondaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, paddingVertical: 14,
    borderWidth: 1, borderColor: themeColors.line,
  },
  secondaryText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  // Result view
  // Branded ink+amber hero card for the estimate total (matches the client
  // proposal aesthetic). BrandBackdrop fills it, so text is light-on-ink.
  heroCard: {
    borderRadius: Tokens.radius.panel, overflow: 'hidden' as const,
    paddingHorizontal: 22, paddingVertical: 24, marginBottom: 16,
    minHeight: 150, justifyContent: 'center' as const,
  },
  heroEyebrow: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, letterSpacing: 1.6,
    color: OnInk.eyebrow, marginBottom: 8,
  },
  heroTotal: {
    fontFamily: 'Fraunces_700Bold', fontSize: 46, color: OnInk.title, letterSpacing: -1,
  },
  heroSubtitle: { fontSize: Type.footnote.fontSize, color: OnInk.subtitle, marginTop: 8 },
  heroChip: {
    alignSelf: 'flex-start' as const, marginTop: 12,
    backgroundColor: 'rgba(255,106,26,0.18)', borderWidth: 1, borderColor: 'rgba(255,106,26,0.4)',
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
  },
  heroChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: '#FF8533' },
  resultBody: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 21, marginBottom: 20 },
  // At-a-glance stat tiles below hero
  statGrid: {
    flexDirection: 'row' as const, gap: 8,
    marginBottom: 16,
  },
  statTile: {
    flex: 1, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card,
    paddingVertical: 12, paddingHorizontal: 10,
    borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center' as const, gap: 4,
  },
  statLabel: {
    fontSize: 10, fontWeight: '700' as const, color: themeColors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
  },
  statValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: themeColors.text },
  // Scope summary card
  summaryCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 16, gap: 6,
  },
  summaryLabel: {
    fontSize: 10, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 1, textTransform: 'uppercase' as const,
  },
  summaryText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 21 },
  // Where-the-budget-goes breakdown card
  breakdownCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 20,
  },
  breakdownTitle: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 1.4, textTransform: 'uppercase' as const, marginBottom: 12,
  },
  breakdownRow: { marginBottom: 10 },
  breakdownHead: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  breakdownCatWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, flex: 1, minWidth: 0 },
  breakdownDot: { width: 8, height: 8, borderRadius: 4 },
  breakdownCat: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text, flexShrink: 1 },
  breakdownAmt: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  breakdownPct: { fontWeight: '500' as const, color: themeColors.textMuted },
  breakdownBar: {
    height: 6, borderRadius: 3, overflow: 'hidden' as const,
    backgroundColor: themeColors.line,
  },
  breakdownBarFill: { height: '100%' as const, backgroundColor: themeColors.accent, borderRadius: 3 },
  // Per-category detailed cards
  categoryCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: themeColors.line,
    marginBottom: 12, overflow: 'hidden' as const,
  },
  categoryHeader: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: themeColors.bg,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  categoryName: {
    fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: themeColors.text,
    letterSpacing: 0.2,
  },
  categoryHeadRight: { alignItems: 'flex-end' as const, gap: 2 },
  categoryMeta: {
    fontSize: 10, fontWeight: '700' as const, color: themeColors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
  },
  categoryTotal: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  lineItemNew: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingVertical: 10, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: themeColors.line, gap: 12,
  },
  totalsBlockNew: {
    marginTop: 8, padding: 16, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  grandSubLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.textMuted,
    marginTop: 2, letterSpacing: 0.2,
  },
  voiceBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    padding: 14, marginBottom: 16, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.accentSoft, borderWidth: 1, borderColor: themeColors.accentSoft,
  },
  voiceBannerTitle: { ...Type.subheadEmphasized, color: themeColors.accent },
  voiceBannerDesc: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 1 },
  // Onboarding-mode framing banner — shown at the top of the wizard when
  // launched with ?onboarding=1. Frames the moment without changing any
  // estimate logic.
  onboardingBanner: {
    backgroundColor: themeColors.accentSoft,
    borderWidth: 1,
    borderColor: themeColors.accentSoft,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 4,
  },
  onboardingBannerTitle: {
    ...Type.subheadEmphasized,
    color: themeColors.accent,
  },
  onboardingBannerSubtitle: {
    ...Type.footnote,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  // "Client preview" banner at top of result screen
  // ── Margin band + markup sheet (contractor-only, never printed) ────────
  atCostBand: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: themeColors.dangerSoft,
    borderColor: themeColors.danger + '55',
    borderWidth: 1,
    borderRadius: Tokens.radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  atCostTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.dangerLabel,
    marginBottom: 2,
  },
  atCostBody: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.dangerLabel,
    lineHeight: 17,
  },
  marginBand: {
    // cardSurface, not a hand-rolled recipe: this file already imports it and
    // the ratchet in scripts/validate-ui-adoption.ts counts every surface+radius
    // pair written by hand.
    ...cardSurface(themeColors, { radius: 'card', pad: 'none' }),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  marginBandTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    marginBottom: 2,
  },
  marginBandBody: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    lineHeight: 17,
  },
  markupGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 16,
  },
  // No `active` variant, on purpose: preselecting a markup is the app telling
  // a contractor what to charge. Every option renders identically.
  markupChoice: {
    ...cardSurface(themeColors, { radius: 'md', pad: 'none' }),
    minWidth: 84,
    flexGrow: 1,
    alignItems: 'center' as const,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  markupChoicePct: {
    fontSize: Type.headline.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  markupChoiceMargin: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    marginTop: 2,
  },
  markupCustomRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  markupCustomSuffix: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
  },
  markupApply: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Tokens.radius.md,
    // accentFill, not accent: the white "Use" label on the raw accent measures
    // 2.87:1, under AA. This is the button that records his markup.
    backgroundColor: themeColors.accentFill,
  },
  markupApplyOff: { opacity: 0.4 },
  markupApplyText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  markupCustomHint: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    lineHeight: 17,
    marginBottom: 12,
  },
  markupNone: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: themeColors.line,
    backgroundColor: 'transparent' as const,
  },
  markupNoneText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  markupNoneSub: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    marginTop: 2,
  },
  previewBanner: {
    backgroundColor: themeColors.accent + '12',
    borderColor: themeColors.accent + '30',
    borderWidth: 1,
    borderRadius: Tokens.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    alignItems: 'center' as const,
  },
  previewBannerText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  // Estimate metadata row (Prepared / Valid until / Quality)
  metaCard: {
    flexDirection: 'row' as const,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginBottom: 16,
    gap: 16,
  },
  metaCol: { flex: 1 },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: themeColors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  // Stat tile unit (e.g. "sqft", "weeks") below the value
  statUnit: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: themeColors.textMuted,
    marginTop: 1,
  },
  // Scope summary extras
  summaryNote: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textMuted,
    fontStyle: 'italic' as const,
    lineHeight: 20,
    marginTop: 8,
  },
  specialReq: {
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.sm,
    padding: 10,
    marginTop: 10,
  },
  specialReqLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  specialReqText: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  // Inclusions card
  includedCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginTop: 8,
    marginBottom: 12,
  },
  includedChips: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 4,
    marginBottom: 10,
  },
  includedChip: {
    backgroundColor: themeColors.successSoft,
    borderRadius: Tokens.radius.full,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  includedChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: '#1B5E20' },
  includedFootnote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 18 },
  // Exclusions card
  excludedCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginBottom: 12,
  },
  excludedItem: {
    fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 22, paddingLeft: 4,
  },
  // Payment terms card
  paymentCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginBottom: 12,
  },
  paymentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
    gap: 12,
  },
  paymentRowLeft: { flex: 1 },
  paymentNotSet: { gap: 10, alignItems: 'flex-start' as const, paddingTop: 4 },
  paymentRowTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  paymentRowDesc: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 16 },
  paymentRowAmt: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  // Acceptance / next-steps card
  acceptanceCard: {
    backgroundColor: '#0F1216',
    borderRadius: Tokens.radius.lg,
    padding: 18,
    marginTop: 8,
    marginBottom: 16,
  },
  acceptanceTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: themeColors.accent,
    marginBottom: 8,
  },
  acceptanceBody: {
    fontSize: Type.footnote.fontSize,
    color: '#E8E5DD',
    lineHeight: 20,
  },
  sectionTitle: {
    fontFamily: 'Fraunces_700Bold', fontSize: Type.serifHeadline.fontSize, color: themeColors.text,
    letterSpacing: -0.2, marginTop: 18, marginBottom: 10,
  },
  lineItem: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.line, gap: 12,
  },
  lineCategory: { fontSize: Type.caption2.fontSize, color: themeColors.accent, fontWeight: '700' as const, letterSpacing: 0.5 },
  lineDesc: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, marginTop: 2 },
  lineMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  lineTotal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  totalsBlock: { marginTop: 16 },
  totalRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    paddingVertical: 6,
  },
  totalLabel: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textMuted },
  totalValue: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, fontWeight: '600' as const },
  totalRowGrand: {
    borderTopWidth: 1, borderTopColor: themeColors.line,
    paddingTop: 10, marginTop: 6,
  },
  grandLabel: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  grandValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  notesBlock: { marginTop: 8 },
  noteRow: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, lineHeight: 20, marginBottom: 4 },
  // "Sharper number" card — surfaces the AI's refineWith hints (the
  // specific missing inputs that would most improve accuracy) directly
  // under the scope summary.
  // Brain confidence card — the reusable <BrainCard/> owns the look now; this
  // just spaces it under the total.
  brainCardSpacing: { marginTop: 12 },
  // "Your cost book is empty" → the actionable fix, not just the confession.
  seedPrompt: {
    ...cardSurface(themeColors, { radius: 'card', pad: 13 }),
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    marginTop: 8, minHeight: 56,
  },
  seedPromptTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flexWrap: 'wrap' as const },
  seedPromptTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: themeColors.text },
  seedPromptTierPill: {
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
    backgroundColor: themeColors.accent + '1A',
  },
  seedPromptTierPillText: {
    // 700, not 800: scripts/validate-app-slop.ts ratchets the count of
    // fontWeight '800' so it cannot grow, and a 10px pill does not need it.
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const,
    letterSpacing: 0.4, color: themeColors.accentLabel,
  },
  seedPromptBody: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 16, marginTop: 2 },
  refineCard: { backgroundColor: themeColors.accent + '12', borderRadius: 12, padding: 14, marginTop: 12, gap: 4 },
  refineTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  refineItem: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  refineMeter: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 16, marginBottom: 2 },
  refineAnswerRow: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 4 },
  refineInput: { flex: 1, borderWidth: 1, borderColor: themeColors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: Type.footnote.fontSize, color: themeColors.text, backgroundColor: themeColors.surface },
  refineGoBtn: { backgroundColor: themeColors.accentFill, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  refineGoText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.textOnPrimary },
  groundedChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start', backgroundColor: themeColors.successSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  groundedText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: themeColors.success },
  groundedChipEmpty: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start', backgroundColor: themeColors.surfaceAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  groundedTextEmpty: { fontSize: Type.caption1.fontSize, fontWeight: '500', color: themeColors.textMuted },
  optionalRow: { paddingHorizontal: 20, paddingTop: 10, gap: 8 },
  optionalText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16 },
  optionalBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, borderRadius: Tokens.radius.lg, paddingVertical: 12,
    borderWidth: 1, borderColor: themeColors.accent + '55', backgroundColor: themeColors.surface,
  },
  optionalBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  stepHintRow: { paddingHorizontal: 20, paddingTop: 8 },
  stepHintText: { fontSize: Type.footnote.fontSize, color: themeColors.danger, textAlign: 'center' },
  disclaimer: {
    fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const,
    textAlign: 'center' as const, marginTop: 16, paddingHorizontal: 12,
  },
  actionRow: {
    flexDirection: 'row' as const, gap: 12, marginTop: 20,
  },
  // Result-screen action stack — buttons stack vertically and span full
  // width so the two-button layout doesn't look cramped when only Share
  // and New Estimate are present.
  resultActions: {
    marginTop: 24,
    gap: 12,
    alignItems: 'stretch' as const,
  },
  resultPrimaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: themeColors.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: themeColors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
  },
  resultPrimaryText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: '#FFF',
    letterSpacing: 0.2,
  },
  resultSecondaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  resultSecondaryText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  // Save-to-project modal
  saveOverlay: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  saveCard: {
    backgroundColor: themeColors.bg,
    borderTopLeftRadius: Tokens.radius.panel,
    borderTopRightRadius: Tokens.radius.panel,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  saveHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 16,
  },
  saveTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
  },
  saveSectionLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: themeColors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 8,
  },
  saveInputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  saveInput: {
    flex: 1,
    backgroundColor: themeColors.surface,
    borderWidth: 1,
    borderColor: themeColors.line,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.text,
  },
  saveCreateBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    backgroundColor: themeColors.accentFill,
    borderRadius: Tokens.radius.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  saveCreateText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '800' as const,
    color: '#FFF',
  },
  saveList: {
    maxHeight: 240,
    marginTop: 2,
  },

  // Reason line under the markup sheet's title.
  identityReason: {
    fontSize: Type.footnote.fontSize,
    lineHeight: 19,
    color: themeColors.textMuted,
    marginBottom: 18,
  },
  saveProjectRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: themeColors.surface,
    borderWidth: 1,
    borderColor: themeColors.line,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 10,
  },
  saveProjectName: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
});
