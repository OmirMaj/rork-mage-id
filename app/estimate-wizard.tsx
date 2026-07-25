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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, CheckCircle2, FileDown,
  RotateCcw, Users, FolderPlus, Plus, X, Mic, TrendingUp,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { RevenueEarlyAccessCard } from '@/components/RevenueEarlyAccessCard';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';
import { stableHash } from '@/utils/stableHash';
import { buildCostDatabase } from '@/utils/costDatabase';
import { computeCalibration } from '@/utils/estimateCalibration';
import UpgradeSheet from '@/components/UpgradeSheet';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
import { ScopeQuestionStepper } from '@/components/ScopeQuestionStepper';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { shareQuickEstimatePDF } from '@/utils/pdfGenerator';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import { generateUUID } from '@/utils/generateId';
import type { CompanyBranding, LinkedEstimate, LinkedEstimateItem, Project, ProjectType, QualityTier } from '@/types';
import {
  INITIAL_SCOPE, TOTAL_SCOPE_STEPS, stepCanAdvance, buildEstimatePrompt,
  scopeCacheKey, estimateSchema, QUALITY_LABELS, stepBlockReason,
  type WizardAnswers, type EstimateResult,
} from '@/utils/scopeQuestions';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

const ESTIMATE_THINKING_STEPS = [
  'Reading your scope…',
  'Pricing from your history…',
  'Checking your margin…',
  'Assembling line items…',
];

// Map an AI EstimateResult into a project LinkedEstimate. Item shape mirrors
// utils/estimateAssemblies.ts applyAssembly and app/drawing-analyzer.tsx (the
// canonical "AI lineItems → LinkedEstimate" mappers): bulkPrice = unitPrice,
// usesBulk=false, markup=0, supplier='', stable materialId. No markup is
// applied (globalMarkup=0) — the GC tunes it in the estimator. Shared by the
// ?projectId link-back and the standalone "Save to a project" flow so they
// can't drift.
function buildLinkedEstimate(data: EstimateResult): LinkedEstimate {
  const items: LinkedEstimateItem[] = data.lineItems.map<LinkedEstimateItem>((li) => ({
    materialId: generateUUID(),
    name: li.description,
    category: li.category,
    unit: li.unit,
    quantity: li.quantity,
    unitPrice: li.unitCost,
    bulkPrice: li.unitCost,
    markup: 0,
    usesBulk: false,
    lineTotal: li.total,
    supplier: '',
  }));
  // Represent contingency and permits as explicit line items so the Estimate
  // Items table in project-detail reconciles with the Base/Total. Previously
  // they were folded into baseTotal but not itemized, leaving an unexplained
  // gap (e.g. rows summing to $100k while summary showed "Base $130k").
  // Only appended when > 0. Same shape as the priced rows above:
  // quantity 1, unitPrice = the amount, markup 0.
  if (data.contingency > 0) {
    items.push({
      materialId: generateUUID(),
      name: 'Contingency (~10%)',
      category: 'Contingency',
      unit: 'ls',
      quantity: 1,
      unitPrice: data.contingency,
      bulkPrice: data.contingency,
      markup: 0,
      usesBulk: false,
      lineTotal: data.contingency,
      supplier: '',
    });
  }
  if (data.permits > 0) {
    items.push({
      materialId: generateUUID(),
      name: 'Permits & fees',
      category: 'Permits & fees',
      unit: 'ls',
      quantity: 1,
      unitPrice: data.permits,
      bulkPrice: data.permits,
      markup: 0,
      usesBulk: false,
      lineTotal: data.permits,
      supplier: '',
    });
  }
  // baseTotal now equals data.total (Σ all line items, including the
  // contingency/permits rows). No markup is applied here — the GC tunes it
  // in the estimator — so markupTotal stays 0 and grandTotal = data.total.
  const baseTotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    id: generateUUID(),
    items,
    globalMarkup: 0,
    baseTotal,
    markupTotal: 0,
    grandTotal: data.total,
    createdAt: new Date().toISOString(),
  };
}

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
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { settings, getProject, updateProject, addProject, projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();
  // Self-perform labor (D6): crew hours × configured loaded rates, folded
  // into the same cost book the wizard grounds its prices on.
  const laborSamples = useLaborCostSamples();
  const { tier } = useSubscription();

  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
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
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
  // Standalone "Save to a project" flow. When the wizard is launched with no
  // ?projectId, the result would otherwise be a dead end (Share PDF + start
  // over only) — the number is thrown away the moment they leave. This modal
  // lets them attach the estimate to an existing project OR spin up a new
  // one, folding the AI line items into its linkedEstimate.
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);

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
  const groundingFacts = useMemo<string[]>(() => {
    try {
      const db = buildCostDatabase(projects, commitments, receipts, laborSamples);
      const facts = db.entries.slice(0, 6).map((e) =>
        `${e.trade} runs $${e.suggestedRate.toFixed(2)}/${e.unit} on your jobs (${e.confidence} confidence, ${e.jobCount} job${e.jobCount === 1 ? '' : 's'})`);
      const cal = computeCalibration({ projects, commitments });
      if (cal.hasData && cal.categories[0] && cal.categories[0].direction !== 'aligned') {
        facts.push(cal.categories[0].detail);
      }
      return facts;
    } catch {
      return [];
    }
  }, [projects, commitments, receipts, laborSamples]);

  const next = useCallback(() => {
    if (!canAdvance) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  }, [canAdvance, TOTAL_STEPS]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

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
      return;
    }

    setLoading(true);
    setResult(null);

    const a = answersOverride ?? answers;
    const prompt = buildEstimatePrompt(a, groundingFacts);

    // Grounded prompts must not collide with ungrounded cache entries; salt
    // by fact CONTENT, not count — the fact list is capped, so a stale count
    // salt would replay an estimate grounded on an outdated cost book.
    const cacheKey = scopeCacheKey(a) + (groundingFacts.length > 0 ? `_g${stableHash(groundingFacts.join('|'))}` : '');

    try {
      const res = await mageAISmart(prompt, estimateSchema, cacheKey);
      if (!res.success || !res.data) {
        Alert.alert('Estimate failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
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
        const contingency = round(raw.contingency);
        const permits = round(raw.permits);
        const total = subtotal + contingency + permits;

        // Hard failure: an empty or non-positive estimate is not a real
        // $0 estimate — do NOT render/save it or overwrite the project.
        // (An AI error kind is already handled by the !res.success guard.)
        if (lineItems.length === 0 || total <= 0) {
          Alert.alert('Estimate failed', 'The AI returned an empty or invalid estimate. Please try again.');
          return;
        }

        const data: EstimateResult = { ...raw, lineItems, subtotal, contingency, permits, total };
        setResult(data);

        // Project-aware link-back. When the wizard was launched with a
        // ?projectId (from a project's "estimate now" entry point), fold
        // the AI line items into that project's linkedEstimate so the
        // estimator / budget / portal all see the number. The standalone
        // flow (no projectId) skips this entirely and is byte-identical
        // to before.
        //
        // Item shape and mapping live in buildLinkedEstimate (shared with
        // the standalone "Save to a project" flow). LinkedEstimate has no
        // notes field, so the AI notes + refineWith are NOT folded onto it
        // (doing so would require an unsafe cast); they remain surfaced to
        // the user in this screen's result UI instead.
        if (projectId && scopedProject) {
          const linkedEstimate = buildLinkedEstimate(data);
          updateProject(projectId, commitEstimatePatch(getProject(projectId), linkedEstimate, { reason: 'pre_overwrite' }));
        }

        // Fire-and-forget usage write — was previously awaited, which left
        // the loading spinner up while AsyncStorage finished on slow disks.
        // recordAIUsage failure shouldn't gate the user seeing their estimate.
        // Only records on success — failed calls (timeout, MAX_TOKENS,
        // SAFETY) still shouldn't count against the quota.
        void recordAIUsage('smart', 'aiEstimateWizard');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      Alert.alert('Estimate failed', err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }, [answers, groundingFacts, loading, tier, router, projectId, scopedProject, updateProject]);

  // Escape hatch for the loading screen. We don't actually abort the
  // in-flight fetch (the AbortController is internal to mageAI), but
  // flipping loading off lets the user retype / retry — orphaned response
  // is just dropped via the stale-state check below.
  const cancelGenerate = useCallback(() => {
    setLoading(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const share = useCallback(async () => {
    if (!result) return;
    setSharingPdf(true);
    try {
      // Build a CompanyBranding payload from the user's settings; fall back
      // to "MAGE ID" defaults so the PDF still renders if they haven't
      // filled in their branding yet.
      const branding: CompanyBranding = {
        companyName:   settings?.branding?.companyName ?? 'MAGE ID',
        contactName:   settings?.branding?.contactName ?? '',
        phone:         settings?.branding?.phone ?? '',
        email:         settings?.branding?.email ?? '',
        address:       settings?.branding?.address ?? '',
        licenseNumber: settings?.branding?.licenseNumber ?? '',
        tagline:       settings?.branding?.tagline ?? '',
        logoUri:       settings?.branding?.logoUri,
      };
      await shareQuickEstimatePDF(result, answers, branding);
    } catch (err) {
      Alert.alert('Share failed', err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      setSharingPdf(false);
    }
  }, [result, answers, settings]);

  const reset = useCallback(() => {
    setAnswers(INITIAL_SCOPE);
    setResult(null);
    setStep(0);
    setSavedProjectId(null);
  }, []);

  // Attach the just-generated estimate to an EXISTING project, then jump to
  // it. Reuses commitEstimatePatch (same revision-history behavior as the
  // ?projectId link-back and the drawing analyzer).
  const attachToExisting = useCallback((targetId: string) => {
    if (!result) return;
    const linkedEstimate = buildLinkedEstimate(result);
    updateProject(targetId, commitEstimatePatch(getProject(targetId), linkedEstimate, { reason: 'pre_overwrite' }));
    setShowSaveModal(false);
    setSavedProjectId(targetId);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/project-detail', params: { id: targetId } } as never);
  }, [result, updateProject, getProject, router]);

  // Create a NEW project from the wizard answers, hydrate its linkedEstimate,
  // and jump to it. The wizard answers are also stamped onto project.scope so
  // the estimate re-opens in the wizard with zero re-keying.
  const createFromEstimate = useCallback(() => {
    if (!result) return;
    const name = newProjectName.trim();
    if (!name) {
      Alert.alert('Name required', 'Give this project a name so you can find it later.');
      return;
    }
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
    const linkedEstimate = buildLinkedEstimate(result);
    const withEstimate = { ...baseProject, ...commitEstimatePatch(baseProject, linkedEstimate, { reason: 'pre_overwrite' }) };
    addProject(withEstimate);
    setShowSaveModal(false);
    setNewProjectName('');
    setSavedProjectId(id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/project-detail', params: { id } } as never);
  }, [result, newProjectName, answers, addProject, router]);

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

    // Payment terms preview — same defaults as the PDF (25/65/10).
    const depositAmt = result.total * 0.25;
    const progressAmt = result.total * 0.65;
    const completionAmt = result.total * 0.10;

    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Estimate' }} />
        <ScrollView contentContainerStyle={[{ padding: 20, paddingBottom: insets.bottom + 100 }, isDesktop && styles.contentDesktop]}>
          {/* "Client preview" banner — reminds the GC that what they see
              IS what the homeowner sees. Soft contextual cue at the top. */}
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerText}>This is the estimate your client will see</Text>
          </View>

          <View style={styles.resultHero}>
            <CheckCircle2 size={28} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.resultHeroTitle}>Construction Estimate</Text>
            <TapeRollNumber
              value={result.total}
              prefix="$"
              decimals={0}
              duration={1100}
              style={styles.resultTotal}
            />
            <Text style={styles.resultSubtitle}>{answers.projectType}{answers.sizeSqft ? ` · ${answers.sizeSqft} sqft` : ''}{answers.location ? ` · ${answers.location}` : ''}</Text>
            {costPerSqft > 0 ? (
              <Text style={styles.resultCostPerSqft}>${costPerSqft.toFixed(0)} per sqft</Text>
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

          {groundingFacts.length > 0 ? (
            <View style={styles.groundedChip}>
              <Text style={styles.groundedText}>Priced with your cost history · {groundingFacts.length} learned rate{groundingFacts.length === 1 ? '' : 's'}</Text>
            </View>
          ) : (
            <View style={styles.groundedChipEmpty}>
              <Text style={styles.groundedTextEmpty}>Priced from market averages — close jobs to teach MAGE your real costs</Text>
            </View>
          )}

          {result.refineWith && result.refineWith.length > 0 && (
            <View style={styles.refineCard}>
              <Text style={styles.refineTitle}>Answer these for a sharper number</Text>
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
                        <Text style={styles.refineGoText}>Refine</Text>
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
                return (
                  <View key={i} style={styles.breakdownRow}>
                    <View style={styles.breakdownHead}>
                      <Text style={styles.breakdownCat}>{cat}</Text>
                      <Text style={styles.breakdownAmt}>
                        ${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} <Text style={styles.breakdownPct}>· {pct.toFixed(1)}%</Text>
                      </Text>
                    </View>
                    <View style={styles.breakdownBar}>
                      <View style={[styles.breakdownBarFill, { width: `${Math.max(pct, 1)}%` }]} />
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
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Contingency</Text><Text style={styles.totalValue}>${result.contingency.toLocaleString()}</Text></View>
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

          {/* Payment Terms — 25/65/10 deposit / progress / final. Same
              defaults as the PDF. Future: let GC override per-project. */}
          <View style={styles.paymentCard}>
            <Text style={styles.sectionTitle}>Payment Terms</Text>
            <View style={styles.paymentRow}>
              <View style={styles.paymentRowLeft}>
                <Text style={styles.paymentRowTitle}>Deposit (25%)</Text>
                <Text style={styles.paymentRowDesc}>Due upon signed agreement, before work begins</Text>
              </View>
              <Text style={styles.paymentRowAmt}>${depositAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={styles.paymentRow}>
              <View style={styles.paymentRowLeft}>
                <Text style={styles.paymentRowTitle}>Progress (65%)</Text>
                <Text style={styles.paymentRowDesc}>Billed against documented progress per contract schedule</Text>
              </View>
              <Text style={styles.paymentRowAmt}>${progressAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={[styles.paymentRow, { borderBottomWidth: 0 }]}>
              <View style={styles.paymentRowLeft}>
                <Text style={styles.paymentRowTitle}>Final (10%)</Text>
                <Text style={styles.paymentRowDesc}>Due at substantial completion, after walk-through and punch list</Text>
              </View>
              <Text style={styles.paymentRowAmt}>${completionAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
          </View>

          {/* Acceptance / Next Steps — soft CTA to the client. */}
          <View style={styles.acceptanceCard}>
            <Text style={styles.acceptanceTitle}>Ready to move forward?</Text>
            <Text style={styles.acceptanceBody}>
              To proceed, the client replies with approval and we'll prepare a formal contract reflecting the scope and terms above. Final pricing is locked once the contract is signed and the deposit received.
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
            headline="Post this scope to 3 vetted subs"
            body="Push the trades-by-line-item to qualified subs in your area. Receive 3 bids in 48h. Industry data: real-time bid network closes 35% faster than email."
            footer="Sub-bid network launches when your metro hits 50 active subs per trade"
            testID="estimate-subbid-cta"
          />

          {(() => {
            // Which project (if any) this estimate is now attached to:
            // either the ?projectId link-back, or a project the standalone
            // user just saved to via the modal.
            const attachedId = (projectId && scopedProject) ? projectId : savedProjectId;
            const attachedProject = attachedId ? getProject(attachedId) : null;
            const hasProject = !!attachedProject;
            return (
          <View style={styles.resultActions}>
            {hasProject ? (
              <TouchableOpacity
                style={styles.resultPrimaryBtn}
                onPress={() => router.push({ pathname: '/project-detail', params: { id: attachedId! } } as never)}
                activeOpacity={0.85}
                disabled={sharingPdf}
                testID="wizard-view-project"
              >
                <CheckCircle2 size={18} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.resultPrimaryText} numberOfLines={1}>
                  Saved to {attachedProject.name} — open project
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
                discoverable at the decision moment. */}
            <TouchableOpacity
              style={[styles.resultSecondaryBtn, { borderColor: themeColors.accent + '40' }]}
              onPress={() => router.push('/win-optimizer' as never)}
              activeOpacity={0.85}
              testID="wizard-win-optimizer"
            >
              <TrendingUp size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={[styles.resultSecondaryText, { color: themeColors.accent }]}>Optimize your bid price</Text>
            </TouchableOpacity>
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
      <Stack.Screen options={{ title: 'Quick Estimate' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressLabel}>Step {step + 1} of {TOTAL_STEPS}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
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
          <ScopeQuestionStepper stepIndex={step} answers={answers} onChange={set} testIDPrefix="wizard" />
        </ScrollView>

        {stepHint ? (
          <View style={styles.stepHintRow}>
            <Text style={styles.stepHintText}>{stepHint}</Text>
          </View>
        ) : null}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            onPress={step === 0 ? () => router.back() : back}
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
                  <Text style={styles.primaryText}>Generate Estimate</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      <EstimateLoadingOverlay
        visible={loading}
        title="Generating estimate…"
        subtitle="Usually 20–40 seconds. Pulling materials, labor, and 2025 pricing."
        thinkingSteps={ESTIMATE_THINKING_STEPS}
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
  contentDesktop: { width: '100%', maxWidth: 680, alignSelf: 'center' as const },
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
    gap: 6, backgroundColor: themeColors.accent, borderRadius: Tokens.radius.lg, paddingVertical: 14,
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
  resultHero: {
    alignItems: 'center' as const, marginBottom: 24, gap: 4,
  },
  resultHeroTitle: {
    fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, marginTop: 8,
  },
  resultTotal: {
    fontSize: 44, fontWeight: '800' as const, color: themeColors.text, marginTop: 4,
  },
  resultSubtitle: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted },
  resultCostPerSqft: {
    fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent,
    marginTop: 4, letterSpacing: 0.3,
  },
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
  breakdownCat: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
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
  // "Client preview" banner at top of result screen
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
    fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text,
    letterSpacing: 0.3, marginTop: 16, marginBottom: 10,
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
  refineCard: { backgroundColor: themeColors.accent + '12', borderRadius: 12, padding: 14, marginTop: 12, gap: 4 },
  refineTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  refineItem: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  refineAnswerRow: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 4 },
  refineInput: { flex: 1, borderWidth: 1, borderColor: themeColors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: Type.footnote.fontSize, color: themeColors.text, backgroundColor: themeColors.surface },
  refineGoBtn: { backgroundColor: themeColors.accent, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  refineGoText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.textOnPrimary },
  groundedChip: { alignSelf: 'flex-start', backgroundColor: themeColors.successSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 12 },
  groundedText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: themeColors.success },
  groundedChipEmpty: { alignSelf: 'flex-start', backgroundColor: themeColors.surfaceAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 12 },
  groundedTextEmpty: { fontSize: Type.caption1.fontSize, fontWeight: '500', color: themeColors.textMuted },
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
    backgroundColor: themeColors.accent,
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
    backgroundColor: themeColors.accent,
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
