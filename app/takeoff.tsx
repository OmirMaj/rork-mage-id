// app/takeoff.tsx — quantity takeoff UI.
//
// Sister screen to drawing-analyzer.tsx. The drawing analyzer returns a
// priced estimate; this screen returns raw quantities (LF, SF, EA, CY)
// the user can edit before piping into either an estimate or a buyout.
//
// Flow: idle → uploading → analyzing → review.
//
// Uploads go through utils/pdfRenderClient.uploadAndRenderPdf, which
// hits the convert-pdf-to-images edge function and returns public PNG
// URLs. Those URLs are then handed to analyze-takeoff via
// utils/takeoffAnalyzer.analyzeTakeoff.
//
// Edits: per-row quantity overrides are kept in local state keyed by
// the AI's row id. Persistence is Phase 2b — for now the override only
// lives until the user resets or navigates away.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Image, TextInput,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileUp, ShieldAlert, Eye, AlertTriangle, CheckCircle2,
  HelpCircle, FileText, RefreshCw, ChevronRight, Crown, Ruler, Square,
  DoorOpen, AppWindow, Paintbrush, Wrench, Boxes, Pencil, BookOpen, Search,
  Gavel, X,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Skeleton } from '@/components/Skeleton';
import { useProjects } from '@/contexts/ProjectContext';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
import { uploadAndRenderPdf, countPdfPages, type RenderedPlanPage } from '@/utils/pdfRenderClient';
import { confirmQuotaFits } from '@/utils/quotaPrecheck';
import { TakeoffQuotaBadge } from '@/components/TakeoffQuotaBadge';
import { useUsageStatus } from '@/hooks/useUsageStatus';
import { analyzeTakeoff, type TakeoffModel } from '@/utils/takeoffAnalyzer';
import { loadTakeoff, saveTakeoff, clearTakeoff } from '@/utils/takeoffStorage';
import { analyzeSpecBook, extractCodesFromTakeoff, buildSpecLookup } from '@/utils/specMatcher';
import { buildBuyoutDrafts, type BuyoutPackageDraft } from '@/utils/takeoffToBuyout';
import {
  loadFieldVerifications, appendFieldVerification, deleteFieldVerification,
} from '@/utils/fieldVerificationStorage';
import { markFirstTakeoffDone } from '@/utils/onboardingProgress';
import { recordCorrection } from '@/utils/takeoffCorrections';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { TakeoffPageInspector } from '@/components/TakeoffPageInspector';
import { TakeoffFieldVerifyButton } from '@/components/TakeoffFieldVerifyButton';
import { TakeoffAccuracyPanel } from '@/components/TakeoffAccuracyPanel';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import type {
  TakeoffResult, TakeoffConfidence, TakeoffWall, TakeoffFloorArea,
  TakeoffDoor, TakeoffWindow, TakeoffFinish, TakeoffFixture, TakeoffBulkMaterial,
  SpecMatchResult, SpecEntry, TakeoffFieldVerification,
} from '@/types';

type Step = 'idle' | 'uploading' | 'analyzing' | 'review';

/** Map of `${section}:${id}` → user-overridden quantity. */
type QuantityOverrides = Record<string, number>;

/** Set of row keys the user has explicitly rejected — drops them from
 *  totals + buyout generator + estimate conversion. The #1 industry
 *  complaint about every AI takeoff tool is "AI over-detects, hard to
 *  clean up." Bulk reject closes that gap. */
type RejectedRows = Record<string, true>;

const MODEL_DISPLAY: Record<TakeoffModel, { label: string; tagline: string }> = {
  'gemini-2.5-flash': {
    label: 'Standard',
    tagline: 'Fast counts on clean drawings. Good for most residential sets.',
  },
  'gemini-2.5-pro': {
    label: 'Pro Takeoff',
    tagline: 'Slower + more careful. Reads schedules + ambiguous areas more reliably.',
  },
  'claude-sonnet-4-5': {
    // Capability-tier name, NOT the vendor model name — user-facing copy
    // never name-drops the underlying provider (sim-audit #10).
    label: 'Max Takeoff',
    tagline: 'Highest accuracy on stamped or marked-up scans. Enterprise tier.',
  },
};

export default function TakeoffScreen() {
  return <TakeoffInner />;
}

function TakeoffInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, getProject, addBidPackage } = useProjects();
  const { isBusinessTier, isEnterpriseTier, tier } = useSubscription();
  const { canAccess } = useTierAccess();
  const { refresh: refreshQuota } = useUsageStatus();

  // Same gate the destination screen (takeoff-estimate.tsx) enforces. A free
  // user gets their metered takeoff, but the priced-estimate conversion is
  // Pro+. Knowing this up here lets the "Convert to estimate" CTA present as
  // an explicit upsell at the moment of intent instead of silently bouncing
  // the user into a full-screen paywall (audit P1: free trial dead-ends).
  const canConvertToEstimate = canAccess('ai_estimate_wizard');

  const [step, setStep] = useState<Step>('idle');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [pages, setPages] = useState<RenderedPlanPage[]>([]);
  const [result, setResult] = useState<TakeoffResult | null>(null);
  const [modelUsed, setModelUsed] = useState<TakeoffModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<string | undefined>(paramProjectId);
  const [overrides, setOverrides] = useState<QuantityOverrides>({});
  const [rejected, setRejected] = useState<RejectedRows>({});
  const [inspectorPage, setInspectorPage] = useState<number | null>(null);
  const [pickedModel, setPickedModel] = useState<TakeoffModel>(
    isBusinessTier ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
  );
  const [specMatch, setSpecMatch] = useState<SpecMatchResult | null>(null);
  const [specMatchLoading, setSpecMatchLoading] = useState(false);
  const [specMatchError, setSpecMatchError] = useState<string | null>(null);
  const [buyoutDrafts, setBuyoutDrafts] = useState<BuyoutPackageDraft[] | null>(null);
  const [buyoutBusy, setBuyoutBusy] = useState(false);
  const [verifications, setVerifications] = useState<TakeoffFieldVerification[]>([]);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);

  const project = useMemo(() =>
    pickedProjectId ? getProject(pickedProjectId) : undefined,
    [pickedProjectId, getProject],
  );

  // Load any persisted takeoff for the active project (or standalone) on
  // mount + whenever the user switches projects. If there's saved data,
  // jump straight to review mode so the user picks up where they left off.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadTakeoff(pickedProjectId);
      if (cancelled || !saved) return;
      setResult(saved.result);
      setOverrides(saved.overrides ?? {});
      setRejected(saved.rejected ?? {});
      setModelUsed(saved.modelUsed);
      setPages(saved.pages ?? []);
      setUploadedFileName(saved.fileName);
      setStep('review');
    })();
    return () => { cancelled = true; };
  }, [pickedProjectId]);

  // Load field verifications. Mobile-only feature, but the data layer
  // works on web too (just nothing writes to it there).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fv = await loadFieldVerifications(pickedProjectId);
      if (!cancelled) setVerifications(fv);
    })();
    return () => { cancelled = true; };
  }, [pickedProjectId]);

  // Persist after every override change (debounced via AsyncStorage's own
  // batching — these writes are tiny). Only save when in review state with
  // a result; saving an empty takeoff is meaningless.
  useEffect(() => {
    if (step !== 'review' || !result) return;
    void saveTakeoff(pickedProjectId, {
      result,
      overrides,
      rejected,
      modelUsed,
      pages,
      fileName: uploadedFileName,
    });
  }, [step, result, overrides, rejected, modelUsed, pages, uploadedFileName, pickedProjectId]);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      // Tier gate — AI Takeoff is Pro-only. The server hard-gates every step
      // (convert-pdf-to-images, analyze-takeoff) to Pro+, so a free user is
      // walled here (reason: 'pro_only') BEFORE any upload, matching the
      // server. Pro+ pass through subject to their smart daily quota.
      const gate = await checkAILimit(tier, 'smart', 'aiTakeoff');
      if (!gate.allowed) {
        setUpgradeLimit(gate);
        return;
      }

      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];

      // Quota precheck — count pages locally, confirm with the user if
      // it won't fit in their remaining monthly budget BEFORE we upload.
      // Server enforces the same cap; this is purely UX (fail fast vs.
      // a 60s upload that ends in 429).
      const pageCount = await countPdfPages(asset.uri);
      if (pageCount != null) {
        const fits = await confirmQuotaFits(pageCount, asset.name ?? 'PDF', router);
        if (!fits) return;
      }

      setUploadedFileName(asset.name);
      setStep('uploading');
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const rendered = await uploadAndRenderPdf({
        fileUri: asset.uri,
        projectId: pickedProjectId ?? 'tmp',
        fileName: asset.name,
        dpi: 150,
        maxPages: 16,
      });
      setPages(rendered);
      // Refresh the quota badge — Cloudconvert just charged page count
      // pages against the user's monthly takeoff_pages bucket.
      refreshQuota();

      setStep('analyzing');
      const { result: takeoff, modelUsed: usedModel } = await analyzeTakeoff({
        pageUrls: rendered.map(p => p.publicUrl),
        projectName: project?.name,
        projectType: project?.type,
        squareFootage: project?.squareFootage,
        location: project?.location,
        model: pickedModel,
      });
      setResult(takeoff);
      setModelUsed(usedModel);
      setStep('review');
      // Mark the onboarding milestone — drives the home-screen checklist.
      void markFirstTakeoffDone();
      // Record usage on success only — counts toward the Pro+ smart daily
      // quota. A cancelled pick or a failed analyze records nothing.
      void recordAIUsage('smart', 'aiTakeoff');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[Takeoff] failed', e);
      setError(String((e as Error).message ?? e));
      setStep('idle');
    }
  }, [pickedProjectId, project, pickedModel, router, refreshQuota, tier]);

  const handleMatchSpecs = useCallback(async () => {
    if (!result) return;
    setSpecMatchError(null);
    setSpecMatchLoading(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) {
        setSpecMatchLoading(false);
        return;
      }
      const asset = picked.assets[0];
      // Render PDF → PNG pages.
      const rendered = await uploadAndRenderPdf({
        fileUri: asset.uri,
        projectId: pickedProjectId ?? 'tmp',
        fileName: asset.name,
        dpi: 150,
        maxPages: 24,
      });
      // Extract codes from the takeoff and pass them so the AI prioritizes
      // matching them.
      const targetCodes = extractCodesFromTakeoff(result);
      // analyzeSpecBook is Gemini-only (different SpecModel union — no
      // Sonnet path on the spec analyzer yet). Coerce to gemini-pro
      // when the takeoff was Sonnet so the spec match still runs.
      const specModel = pickedModel === 'claude-sonnet-4-5' ? 'gemini-2.5-pro' : pickedModel;
      const { result: spec } = await analyzeSpecBook({
        pageUrls: rendered.map(p => p.publicUrl),
        targetCodes,
        projectName: project?.name,
        model: specModel,
      });
      setSpecMatch(spec);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[Takeoff] spec match failed', e);
      setSpecMatchError(String((e as Error).message ?? e));
    } finally {
      setSpecMatchLoading(false);
    }
  }, [result, pickedProjectId, project, pickedModel]);

  const handleReset = useCallback(() => {
    setStep('idle');
    setPages([]);
    setResult(null);
    setError(null);
    setUploadedFileName(null);
    setOverrides({});
    setRejected({});
    setSpecMatch(null);
    setSpecMatchError(null);
    void clearTakeoff(pickedProjectId);
  }, [pickedProjectId]);

  const handleConvertToEstimate = useCallback(() => {
    if (!result) return;
    // Free/sub-Pro users can't reach the priced-estimate screen — it hard-
    // gates on canAccess('ai_estimate_wizard'). Rather than push them into
    // /takeoff-estimate only to slam a full-screen Paywall over their result
    // (a silent bounce at the moment of maximum intent), send them straight
    // to the paywall from the already-upsell-labeled CTA. The intent is
    // explicit; the transition isn't a dead-end.
    if (!canConvertToEstimate) {
      router.push('/paywall');
      return;
    }
    // New flow (May 2026): route to /takeoff-estimate, a dedicated screen
    // that auto-prices every takeoff line via Gemini and shows them in an
    // editable table with running totals. Pre-fix this routed to
    // /estimate-wizard with `fromTakeoff: '1'`, but the wizard side never
    // consumed the flag so the takeoff data was silently dropped — the
    // user landed on a blank wizard and lost their numbers. The wizard is
    // designed for "no plans yet, answer 8 questions"; takeoff is the
    // opposite direction (real quantities from real drawings) so that
    // path was always architecturally wrong.
    router.push({
      pathname: '/takeoff-estimate',
      params: pickedProjectId ? { projectId: pickedProjectId } : {},
    } as never);
  }, [result, router, pickedProjectId, canConvertToEstimate]);

  // Look up the AI's original value + confidence + sourcePages for a row
  // key. Used by the correction-recording path so we capture training
  // signal alongside every user edit.
  const findRowMeta = useCallback((rowKey: string): {
    aiValue: number;
    confidence: TakeoffConfidence;
    sourcePages: number[];
  } | null => {
    if (!result) return null;
    const [section, id] = rowKey.split(':');
    if (!section || !id) return null;
    switch (section) {
      case 'walls': {
        const r = result.walls.find(w => w.id === id);
        return r ? { aiValue: r.lengthFt, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      case 'floor': {
        const r = result.floorAreas.find(f => f.id === id);
        return r ? { aiValue: r.areaSqFt, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      case 'doors': {
        const r = result.doors.find(d => d.id === id);
        return r ? { aiValue: r.count, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      case 'windows': {
        const r = result.windows.find(w => w.id === id);
        return r ? { aiValue: r.count, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      case 'finish': {
        const r = result.finishes.find(f => f.id === id);
        return r ? { aiValue: r.quantity, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      case 'fixture': {
        const r = result.fixtures.find(f => f.id === id);
        return r ? { aiValue: r.count, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      case 'bulk': {
        const r = result.bulkMaterials.find(b => b.id === id);
        return r ? { aiValue: r.quantity, confidence: r.confidence, sourcePages: r.sourcePages } : null;
      }
      default: return null;
    }
  }, [result]);

  const setOverride = useCallback((key: string, value: number) => {
    setOverrides(prev => ({ ...prev, [key]: value }));
    // Capture the diff as training signal. Skip when the user is just
    // resetting back to the AI's value (prevents noisy entries).
    const meta = findRowMeta(key);
    if (meta && value !== meta.aiValue) {
      void recordCorrection({
        rowKey: key,
        aiValue: meta.aiValue,
        userValue: value,
        kind: 'override',
        confidence: meta.confidence,
        model: modelUsed ?? undefined,
        sourcePages: meta.sourcePages,
        projectId: pickedProjectId,
      });
    }
  }, [findRowMeta, modelUsed, pickedProjectId]);

  // Toggle a single row in/out of the rejected set. Rejected rows are
  // hidden from totals, the buyout generator, and the estimate-conversion
  // flow. The takeoff data itself is preserved so the user can un-reject
  // later without losing the AI's original measurement.
  const toggleReject = useCallback((rowKey: string) => {
    let wasRejected = false;
    setRejected(prev => {
      const next = { ...prev };
      if (next[rowKey]) {
        delete next[rowKey];
        wasRejected = true;
      } else {
        next[rowKey] = true;
      }
      return next;
    });
    // Capture the reject / restore as a correction signal — the user
    // telling us "AI was wrong to surface this" is high-value training
    // data even when no quantity change happened.
    const meta = findRowMeta(rowKey);
    if (meta) {
      void recordCorrection({
        rowKey,
        aiValue: meta.aiValue,
        userValue: meta.aiValue,
        kind: wasRejected ? 'restore' : 'reject',
        confidence: meta.confidence,
        model: modelUsed ?? undefined,
        sourcePages: meta.sourcePages,
        projectId: pickedProjectId,
      });
    }
  }, [findRowMeta, modelUsed, pickedProjectId]);

  // Bulk-reject everything below a given confidence threshold. Most
  // useful for cleaning up a fresh takeoff: tap "Drop low-confidence" and
  // every row the AI guessed at vanishes in one click.
  const bulkRejectByConfidence = useCallback(
    (level: 'low' | 'medium_or_lower') => {
      if (!result) return;
      const shouldDrop = (c: TakeoffConfidence) =>
        level === 'low' ? c === 'low' : c === 'low' || c === 'medium';
      setRejected(prev => {
        const next = { ...prev };
        const sweep = <T extends { id: string; confidence: TakeoffConfidence }>(
          items: T[],
          section: string,
        ) => {
          for (const it of items) {
            if (shouldDrop(it.confidence)) next[`${section}:${it.id}`] = true;
          }
        };
        sweep(result.walls, 'walls');
        sweep(result.floorAreas, 'floor');
        sweep(result.doors, 'doors');
        sweep(result.windows, 'windows');
        sweep(result.finishes, 'finish');
        sweep(result.fixtures, 'fixture');
        sweep(result.bulkMaterials, 'bulk');
        return next;
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    [result],
  );

  const restoreAllRejected = useCallback(() => {
    setRejected({});
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const rejectedCount = useMemo(() => Object.keys(rejected).length, [rejected]);

  const handleCaptureVerification = useCallback(async (v: TakeoffFieldVerification) => {
    const next = await appendFieldVerification(pickedProjectId, v);
    setVerifications(next);
  }, [pickedProjectId]);

  const handleDeleteVerification = useCallback(async (id: string) => {
    const next = await deleteFieldVerification(pickedProjectId, id);
    setVerifications(next);
  }, [pickedProjectId]);

  const verificationsByRow = useMemo(() => {
    const map = new Map<string, TakeoffFieldVerification>();
    // Newest verification per row wins (verifications are stored newest-first).
    for (const v of verifications) {
      if (!map.has(v.rowKey)) map.set(v.rowKey, v);
    }
    return map;
  }, [verifications]);

  const handlePreviewBuyouts = useCallback(() => {
    if (!result) return;
    // Strip rejected rows from a clone of the result before generating
    // drafts. The buildBuyoutDrafts util doesn't know about rejection;
    // by filtering at this boundary we keep that pure function simple.
    const filtered: TakeoffResult = {
      ...result,
      walls: result.walls.filter(w => !rejected[`walls:${w.id}`]),
      floorAreas: result.floorAreas.filter(f => !rejected[`floor:${f.id}`]),
      doors: result.doors.filter(d => !rejected[`doors:${d.id}`]),
      windows: result.windows.filter(w => !rejected[`windows:${w.id}`]),
      finishes: result.finishes.filter(f => !rejected[`finish:${f.id}`]),
      fixtures: result.fixtures.filter(f => !rejected[`fixture:${f.id}`]),
      bulkMaterials: result.bulkMaterials.filter(b => !rejected[`bulk:${b.id}`]),
    };
    const drafts = buildBuyoutDrafts(filtered, specMatch, { overrides });
    setBuyoutDrafts(drafts);
  }, [result, specMatch, overrides, rejected]);

  const handleCreateAllBuyouts = useCallback(async () => {
    if (!buyoutDrafts || !pickedProjectId) {
      showAlert(
        'Pick a project first',
        'Buyout packages need to attach to a specific project. Pick one above and try again.',
      );
      return;
    }
    setBuyoutBusy(true);
    try {
      let created = 0;
      for (const draft of buyoutDrafts) {
        addBidPackage({
          projectId: pickedProjectId,
          name: draft.name,
          csiDivision: draft.csiDivision,
          scopeDescription: draft.scopeDescription,
          linkedEstimateItemIds: [],
          estimateBudget: 0, // user fills after sub bids come in
          status: 'open',
          notes: `Generated from AI takeoff. Confidence: ${draft.confidence}.${draft.primaryQuantity ? ` Primary qty: ${Math.round(draft.primaryQuantity.value)} ${draft.primaryQuantity.unit}.` : ''}`,
        });
        created++;
      }
      setBuyoutDrafts(null);
      showAlert(
        'Packages created',
        `${created} buyout package${created === 1 ? '' : 's'} drafted. Open Buyout to add bidders + send out for sub bids.`,
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Open Buyout', onPress: () => router.push({ pathname: '/buyout' as never, params: { projectId: pickedProjectId } as never }) },
        ],
      );
    } catch (e) {
      console.warn('[Takeoff] buyout create failed', e);
      showAlert('Could not create packages', String((e as Error).message ?? e));
    } finally {
      setBuyoutBusy(false);
    }
  }, [buyoutDrafts, pickedProjectId, addBidPackage, router]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Quantity takeoff</Text>
          <Text style={styles.title}>Measure your drawings automatically</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {step === 'idle' && (
          <>
            {/* Quota badge — visible above all the configuration cards
                so the user budgets pages before they pick anything else.
                Tapping the upgrade pill (when over cap) routes to the
                paywall. */}
            <TakeoffQuotaBadge variant="card" onUpgrade={() => router.push('/paywall' as never)} />

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Takeoff depth</Text>
              <Text style={styles.cardHelper}>
                Standard reads schedules + dimensions on clean drawings. Pro Takeoff is more careful on ambiguous areas — better when wall heights aren&apos;t fully dimensioned.
              </Text>
              <View style={styles.modelRow}>
                <ModelOption
                  modelKey="gemini-2.5-flash"
                  active={pickedModel === 'gemini-2.5-flash'}
                  disabled={false}
                  onPress={() => setPickedModel('gemini-2.5-flash')}
                />
                <ModelOption
                  modelKey="gemini-2.5-pro"
                  active={pickedModel === 'gemini-2.5-pro'}
                  disabled={!isBusinessTier}
                  onPress={() => isBusinessTier
                    ? setPickedModel('gemini-2.5-pro')
                    : router.push('/paywall')}
                />
                <ModelOption
                  modelKey="claude-sonnet-4-5"
                  active={pickedModel === 'claude-sonnet-4-5'}
                  disabled={!isEnterpriseTier}
                  onPress={() => isEnterpriseTier
                    ? setPickedModel('claude-sonnet-4-5')
                    : router.push('/paywall')}
                />
              </View>
              {!isBusinessTier && (
                <View style={styles.upsell}>
                  <Crown size={12} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.upsellText}>
                    Pro Takeoff is included with Business. Max Takeoff (highest accuracy on stamped scans) is included with Enterprise.
                  </Text>
                </View>
              )}
              {isBusinessTier && !isEnterpriseTier && (
                <View style={styles.upsell}>
                  <Crown size={12} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.upsellText}>
                    Max Takeoff (highest accuracy on stamped + marked-up scans) is included with Enterprise.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Project (optional context)</Text>
              <Text style={styles.cardHelper}>
                Picking a project lets the AI cross-check the SF figure and flag wall heights when they don&apos;t match your scope.
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, !pickedProjectId && styles.chipActive]}
                  onPress={() => setPickedProjectId(undefined)}
                >
                  <Text style={[styles.chipText, !pickedProjectId && styles.chipTextActive]}>Standalone</Text>
                </TouchableOpacity>
                {projects.slice(0, 6).map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.chip, pickedProjectId === p.id && styles.chipActive]}
                    onPress={() => setPickedProjectId(p.id)}
                  >
                    <Text style={[styles.chipText, pickedProjectId === p.id && styles.chipTextActive]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.uploadCard} onPress={handlePick} activeOpacity={0.85}>
              <View style={styles.uploadIcon}>
                <FileUp size={34} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              <Text style={styles.uploadTitle}>Upload a drawings PDF</Text>
              <Text style={styles.uploadBody}>
                Architectural plans + schedules. Up to 16 pages. The AI reads dimensions, schedules, and callouts to produce LF / SF / EA / CY quantities.
              </Text>
              <View style={styles.uploadCta}>
                <MageAIMark size={14} color="#FFF" />
                <Text style={styles.uploadCtaText}>Pick a PDF</Text>
              </View>
              <Text style={styles.uploadHint}>
                Each page is rendered to PNG and read by MAGE&apos;s vision engine. Uploaded drawings live in your project plans bucket.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sisterToolCard}
              onPress={() => router.push('/drawing-analyzer')}
              activeOpacity={0.85}
              testID="open-analyzer-link"
            >
              <View style={styles.sisterToolIconWrap}>
                <MageAIMark size={16} color={themeColors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sisterToolTitle}>Want a priced estimate instead?</Text>
                <Text style={styles.sisterToolBody}>
                  The AI Drawing Estimator returns a CSI-organized estimate with unit pricing, contingency, and a reasoning trail per line.
                </Text>
              </View>
              <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </>
        )}

        {error && step === 'idle' && (
          <View style={styles.errorCard}>
            <AlertTriangle size={16} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.errorRetry} onPress={() => setError(null)}>
              <Text style={styles.errorRetryText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {(step === 'uploading' || step === 'analyzing') && (
          <>
            <View style={styles.progressCard}>
              <ActivityIndicator size="small" color={themeColors.accent} />
              <Text style={styles.progressTitle}>
                {step === 'uploading' ? 'Rendering PDF pages…' : 'Reading dimensions + schedules…'}
              </Text>
              <Text style={styles.progressBody}>
                {step === 'uploading'
                  ? `Converting ${uploadedFileName ?? 'your PDF'} to high-res page images.`
                  : `MAGE is measuring ${pages.length} page${pages.length === 1 ? '' : 's'}, reading every schedule, and producing quantities. 30-90 seconds.`}
              </Text>
            </View>
            {step === 'analyzing' && (
              // Preview the result-shape so the user sees where line items
              // will land before they appear. Faster perceived latency than
              // a bare spinner.
              <View style={styles.skeletonStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {[0, 1, 2, 3, 4].map((i) => (
                  <View key={i} style={styles.skeletonRow}>
                    <Skeleton width={36} height={36} radius={10} />
                    <View style={{ flex: 1, gap: 8 }}>
                      <Skeleton width="65%" height={12} />
                      <Skeleton width="40%" height={10} />
                    </View>
                    <Skeleton width={56} height={20} radius={10} />
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {step === 'review' && result && (
          <ResultView
            result={result}
            pages={pages}
            modelUsed={modelUsed}
            overrides={overrides}
            onSetOverride={setOverride}
            onReset={handleReset}
            onConvert={handleConvertToEstimate}
            canConvertToEstimate={canConvertToEstimate}
            showProTeaser={!isBusinessTier && modelUsed === 'gemini-2.5-flash'}
            onUpgrade={() => router.push('/paywall')}
            onInspectPage={setInspectorPage}
            specMatch={specMatch}
            specMatchLoading={specMatchLoading}
            specMatchError={specMatchError}
            onMatchSpecs={handleMatchSpecs}
            onClearSpecs={() => { setSpecMatch(null); setSpecMatchError(null); }}
            onPreviewBuyouts={handlePreviewBuyouts}
            verificationsByRow={verificationsByRow}
            onCaptureVerification={handleCaptureVerification}
            onDeleteVerification={handleDeleteVerification}
            rejected={rejected}
            rejectedCount={rejectedCount}
            onToggleReject={toggleReject}
            onBulkReject={bulkRejectByConfidence}
            onRestoreAllRejected={restoreAllRejected}
          />
        )}
      </ScrollView>

      {/* Page inspector — opens when user taps a source-page badge on a row. */}
      {result && inspectorPage != null && (
        <TakeoffPageInspector
          visible={inspectorPage != null}
          onClose={() => setInspectorPage(null)}
          initialPage={inspectorPage}
          pages={pages}
          takeoff={result}
        />
      )}

      {/* Buyout package preview / generate modal */}
      {buyoutDrafts && (
        <BuyoutPreviewModal
          drafts={buyoutDrafts}
          busy={buyoutBusy}
          projectName={project?.name ?? null}
          onCancel={() => setBuyoutDrafts(null)}
          onConfirm={handleCreateAllBuyouts}
        />
      )}

      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="AI Takeoff"
        onClose={() => setUpgradeLimit(null)}
      />
    </View>
  );
}

function BuyoutPreviewModal({
  drafts, busy, projectName, onCancel, onConfirm,
}: {
  drafts: BuyoutPackageDraft[];
  busy: boolean;
  projectName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.modalBackdrop} pointerEvents="auto">
      <View style={styles.modalCard}>
        <View style={styles.modalHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Buyout packages</Text>
            <Text style={styles.modalSub}>
              {projectName ? `Drafts for ${projectName}` : 'Pick a project — buyouts attach to a project.'}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancel} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {drafts.map((d, idx) => {
            const conf = d.confidence === 'high' ? themeColors.success : d.confidence === 'medium' ? themeColors.accent : themeColors.danger;
            return (
              <View key={idx} style={styles.draftCard}>
                <View style={styles.draftHead}>
                  <Text style={styles.draftName}>{d.name}</Text>
                  <View style={[styles.miniPill, { backgroundColor: conf + '15' }]}>
                    <Text style={[styles.miniPillText, { color: conf }]}>{d.confidence}</Text>
                  </View>
                </View>
                <View style={styles.draftMeta}>
                  <Text style={styles.draftMetaText}>{d.trade}</Text>
                  {d.csiDivision && <Text style={styles.draftMetaText}>· CSI {d.csiDivision}</Text>}
                  {d.primaryQuantity && (
                    <Text style={styles.draftMetaText}>· {formatNum(d.primaryQuantity.value)} {d.primaryQuantity.unit}</Text>
                  )}
                </View>
                <Text style={styles.draftScope} numberOfLines={4}>{d.scopeDescription}</Text>
                <Text style={styles.draftItemCount}>{d.itemRefs.length} item{d.itemRefs.length === 1 ? '' : 's'}</Text>
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.modalFooter}>
          <TouchableOpacity style={styles.ctaSecondary} onPress={onCancel} disabled={busy}>
            <Text style={styles.ctaSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctaPrimary, busy && { opacity: 0.6 }]}
            onPress={onConfirm}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy && <ActivityIndicator size="small" color="#FFF" />}
            <Text style={styles.ctaPrimaryText}>
              {busy ? 'Creating…' : `Create all ${drafts.length} packages`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Model picker
// ---------------------------------------------------------------------------
function ModelOption({ modelKey, active, disabled, onPress }: {
  modelKey: TakeoffModel; active: boolean; disabled: boolean; onPress: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const meta = MODEL_DISPLAY[modelKey];
  const Icon = modelKey === 'gemini-2.5-pro' ? Crown : MageAIMark;
  return (
    <TouchableOpacity
      style={[
        styles.modelOption,
        active && styles.modelOptionActive,
        disabled && styles.modelOptionDisabled,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Icon + tier tag on their own row so the label gets the full
          card width below. Inline (icon · label · tag) char-wrapped
          "Pro Takeoff" → "Pr o Ta ke off" in the 3-column grid because
          the label was squeezed to ~20px. */}
      <View style={styles.modelOptionTopRow}>
        <Icon size={14} color={active ? themeColors.accent : disabled ? themeColors.textMuted : themeColors.text} />
        <View style={{ flex: 1 }} />
        {modelKey === 'gemini-2.5-pro' && (
          <View style={[styles.tierTag, disabled ? styles.tierTagLocked : styles.tierTagBusiness]}>
            <Text style={styles.tierTagText}>{disabled ? 'Business' : 'Active'}</Text>
          </View>
        )}
      </View>
      <Text
        style={[
          styles.modelOptionLabel,
          active && { color: themeColors.accent },
          disabled && { color: themeColors.textMuted },
        ]}
        numberOfLines={2}
      >
        {meta.label}
      </Text>
      <Text style={[styles.modelOptionTagline, disabled && { color: themeColors.textMuted }]}>
        {meta.tagline}
      </Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Result view
// ---------------------------------------------------------------------------
function ResultView({
  result, pages, modelUsed, overrides, onSetOverride,
  onReset, onConvert, canConvertToEstimate, showProTeaser, onUpgrade, onInspectPage,
  specMatch, specMatchLoading, specMatchError, onMatchSpecs, onClearSpecs,
  onPreviewBuyouts,
  verificationsByRow, onCaptureVerification, onDeleteVerification,
  rejected, rejectedCount, onToggleReject, onBulkReject, onRestoreAllRejected,
}: {
  result: TakeoffResult;
  pages: RenderedPlanPage[];
  modelUsed: TakeoffModel | null;
  overrides: QuantityOverrides;
  onSetOverride: (key: string, value: number) => void;
  onReset: () => void;
  onConvert: () => void;
  /** True when the current tier can reach the priced-estimate screen. When
   *  false, the Convert CTA reframes as an explicit upgrade prompt instead
   *  of silently bouncing to a paywall. */
  canConvertToEstimate: boolean;
  showProTeaser: boolean;
  onUpgrade: () => void;
  onInspectPage: (page: number) => void;
  specMatch: SpecMatchResult | null;
  specMatchLoading: boolean;
  specMatchError: string | null;
  onMatchSpecs: () => void;
  onClearSpecs: () => void;
  onPreviewBuyouts: () => void;
  verificationsByRow: Map<string, TakeoffFieldVerification>;
  onCaptureVerification: (v: TakeoffFieldVerification) => void;
  onDeleteVerification: (id: string) => void;
  rejected: RejectedRows;
  rejectedCount: number;
  onToggleReject: (rowKey: string) => void;
  onBulkReject: (level: 'low' | 'medium_or_lower') => void;
  onRestoreAllRejected: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const specLookup = useMemo(
    () => specMatch ? buildSpecLookup(specMatch.entries) : new Map<string, SpecEntry>(),
    [specMatch],
  );
  const modelMeta = modelUsed ? MODEL_DISPLAY[modelUsed] : null;
  const confColor = confidenceColor(result.confidenceOverall);

  // Headline rollups (cheap to compute on each render). Rejected rows
  // drop out of every total — once you cross out a wall it stops feeding
  // the LF + SF + buyout numbers immediately.
  const totalWallLF = useMemo(
    () => sumOverridable(
      result.walls.filter(w => !rejected[keyFor('walls', w.id)]),
      w => w.lengthFt, w => keyFor('walls', w.id), overrides,
    ),
    [result.walls, overrides, rejected],
  );
  const totalWallAreaSF = useMemo(
    () => result.walls
      .filter(w => !rejected[keyFor('walls', w.id)])
      .reduce((s, w) => s + (overridden(overrides, keyFor('walls', w.id), w.lengthFt) * w.heightFt * 2), 0),
    [result.walls, overrides, rejected],
  );
  const totalFloorSF = useMemo(
    () => sumOverridable(
      result.floorAreas.filter(f => !rejected[keyFor('floor', f.id)]),
      f => f.areaSqFt, f => keyFor('floor', f.id), overrides,
    ),
    [result.floorAreas, overrides, rejected],
  );
  const totalDoors = useMemo(
    () => sumOverridable(
      result.doors.filter(d => !rejected[keyFor('doors', d.id)]),
      d => d.count, d => keyFor('doors', d.id), overrides,
    ),
    [result.doors, overrides, rejected],
  );
  const totalWindows = useMemo(
    () => sumOverridable(
      result.windows.filter(w => !rejected[keyFor('windows', w.id)]),
      w => w.count, w => keyFor('windows', w.id), overrides,
    ),
    [result.windows, overrides, rejected],
  );

  // Confidence stats per category — fed to the bulk-reject toolbar so the
  // user can see "this AI flagged 4 walls as low confidence" at a glance
  // before deciding whether to drop them all.
  const lowConfCount = useMemo(() => {
    let n = 0;
    for (const list of [result.walls, result.floorAreas, result.doors, result.windows, result.finishes, result.fixtures, result.bulkMaterials]) {
      for (const it of list) if (it.confidence === 'low') n++;
    }
    return n;
  }, [result]);
  const mediumConfCount = useMemo(() => {
    let n = 0;
    for (const list of [result.walls, result.floorAreas, result.doors, result.windows, result.finishes, result.fixtures, result.bulkMaterials]) {
      for (const it of list) if (it.confidence === 'medium') n++;
    }
    return n;
  }, [result]);

  return (
    <View>
      {/* Summary card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <View style={[styles.confidenceBadge, { backgroundColor: confColor + '15' }]}>
            <View style={[styles.confidenceDot, { backgroundColor: confColor }]} />
            <Text style={[styles.confidenceText, { color: confColor }]}>
              {result.confidenceOverall.toUpperCase()} confidence
            </Text>
          </View>
          {modelMeta && (
            <View style={styles.modelBadge}>
              {modelUsed === 'gemini-2.5-pro'
                ? <Crown size={10} color={themeColors.accent} strokeWidth={1.75} />
                : <MageAIMark size={10} color={themeColors.textMuted} />}
              <Text style={styles.modelBadgeText}>{modelMeta.label}</Text>
            </View>
          )}
          <TouchableOpacity onPress={onReset} hitSlop={6} accessibilityRole="button" accessibilityLabel="Refresh"><RefreshCw size={16} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
        </View>
        <Text style={styles.summaryTitle}>{result.summary}</Text>
        <Text style={styles.summarySub}>{result.confidenceExplanation}</Text>

        <View style={styles.scaleRow}>
          <Ruler size={14} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.scaleText} numberOfLines={1}>
            Scale: {result.scale.label}
          </Text>
          <View style={[styles.miniPill, { backgroundColor: confidenceColor(result.scale.confidence) + '15' }]}>
            <Text style={[styles.miniPillText, { color: confidenceColor(result.scale.confidence) }]}>
              {result.scale.confidence}
            </Text>
          </View>
        </View>

        {/* Headline quantity tiles */}
        <View style={styles.tileGrid}>
          <Tile label="Floor area" value={formatNum(totalFloorSF)} unit="SF" />
          <Tile label="Wall length" value={formatNum(totalWallLF)} unit="LF" />
          <Tile label="Wall area" value={formatNum(totalWallAreaSF)} unit="SF" />
          {result.estimatedSquareFootage != null && (
            <Tile label="Building SF" value={formatNum(result.estimatedSquareFootage)} unit="SF" />
          )}
          <Tile label="Doors" value={formatNum(totalDoors)} unit="EA" />
          <Tile label="Windows" value={formatNum(totalWindows)} unit="EA" />
        </View>
      </View>

      {/* Spec book match card */}
      <SpecMatchCard
        specMatch={specMatch}
        loading={specMatchLoading}
        error={specMatchError}
        onMatch={onMatchSpecs}
        onClear={onClearSpecs}
        targetCodesCount={extractCodesFromTakeoff(result).length}
      />

      {/* Bulk-reject toolbar — closes the #1 industry complaint
          ("AI over-detects, hard to clean up"). Hidden when there's
          nothing low/medium to drop and nothing already rejected. */}
      {(lowConfCount > 0 || mediumConfCount > 0 || rejectedCount > 0) && (
        <BulkRejectToolbar
          lowConfCount={lowConfCount}
          mediumConfCount={mediumConfCount}
          rejectedCount={rejectedCount}
          onDropLow={() => onBulkReject('low')}
          onDropLowAndMedium={() => onBulkReject('medium_or_lower')}
          onRestore={onRestoreAllRejected}
        />
      )}

      {showProTeaser && (
        <TouchableOpacity style={styles.teaserCard} onPress={onUpgrade} activeOpacity={0.85}>
          <View style={styles.teaserHead}>
            <View style={styles.teaserIcon}>
              <Crown size={16} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teaserEyebrow}>Business tier · Pro Takeoff</Text>
              <Text style={styles.teaserTitle}>Want sharper counts on this set?</Text>
            </View>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </View>
          <Text style={styles.teaserBody}>
            Pro Takeoff reads schedules more reliably, escalates ambiguous wall heights to concerns, and won&apos;t guess at unlabeled areas — better numbers when drawings are incomplete.
          </Text>
          <View style={styles.teaserCta}>
            <Text style={styles.teaserCtaText}>Upgrade to Business</Text>
            <ChevronRight size={14} color="#FFF" strokeWidth={1.75} />
          </View>
        </TouchableOpacity>
      )}

      {/* Pages the AI saw */}
      <SectionHeader icon={<Eye size={16} color={themeColors.accent} strokeWidth={1.75} />} title="Pages the AI read" />
      <Text style={styles.sectionHelper}>
        Verify these match what you uploaded. If a page is &quot;poor,&quot; rerun with a higher-resolution scan. Tap a thumbnail to inspect the page + every quantity extracted from it.
      </Text>
      <View style={styles.cardList}>
        {result.drawingsSeen.map((d, idx) => {
          const page = pages.find(p => p.pageNumber === d.page);
          const readColor =
            d.readability === 'clear' ? themeColors.success
            : d.readability === 'partial' ? themeColors.accent
            : themeColors.danger;
          return (
            <TouchableOpacity
              key={idx}
              style={styles.drawingCard}
              onPress={() => onInspectPage(d.page)}
              activeOpacity={0.85}
            >
              {page?.publicUrl && (
                <Image source={{ uri: page.publicUrl }} style={styles.drawingThumb} resizeMode="cover" />
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.drawingHead}>
                  <Text style={styles.drawingPage}>Page {d.page}</Text>
                  <View style={[styles.readabilityPill, { backgroundColor: readColor + '15' }]}>
                    <Text style={[styles.readabilityText, { color: readColor }]}>{d.readability}</Text>
                  </View>
                </View>
                <Text style={styles.drawingType}>{d.type}</Text>
                <Text style={styles.drawingScope} numberOfLines={3}>{d.scope}</Text>
              </View>
              <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Walls */}
      {result.walls.length > 0 && (
        <QuantitySection
          icon={<Ruler size={16} color={themeColors.accent} strokeWidth={1.75} />}
          title={`Walls (${result.walls.length})`}
          helper="Length × height × 2 sides → finishable surface area."
        >
          {result.walls.map(w => (
            <EditableRow
              key={w.id}
              rowKey={keyFor('walls', w.id)}
              title={w.description}
              subtitle={w.typeCode ? `Type ${w.typeCode} · ${w.heightFt} ft tall` : `${w.heightFt} ft tall`}
              quantity={overridden(overrides, keyFor('walls', w.id), w.lengthFt)}
              unit="LF"
              confidence={w.confidence}
              sourcePages={w.sourcePages}
              notes={w.notes}
              onChangeQuantity={v => onSetOverride(keyFor('walls', w.id), v)}
              originalQuantity={w.lengthFt}
              onInspectPage={onInspectPage}
              specEntry={w.typeCode ? specLookup.get(w.typeCode) : undefined}
              verification={verificationsByRow.get(keyFor('walls', w.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('walls', w.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </QuantitySection>
      )}

      {/* Floor areas */}
      {result.floorAreas.length > 0 && (
        <QuantitySection
          icon={<Square size={16} color={themeColors.accent} strokeWidth={1.75} />}
          title={`Floor areas (${result.floorAreas.length})`}
          helper="Net floor SF per room. Subtotals what you'll bid for finishes + structure."
        >
          {result.floorAreas.map(f => (
            <EditableRow
              key={f.id}
              rowKey={keyFor('floor', f.id)}
              title={f.roomName}
              subtitle={f.finishCode ? `Finish ${f.finishCode} · CH ${f.ceilingHeightFt} ft` : `CH ${f.ceilingHeightFt} ft`}
              quantity={overridden(overrides, keyFor('floor', f.id), f.areaSqFt)}
              unit="SF"
              confidence={f.confidence}
              sourcePages={f.sourcePages}
              notes={f.notes}
              onChangeQuantity={v => onSetOverride(keyFor('floor', f.id), v)}
              originalQuantity={f.areaSqFt}
              onInspectPage={onInspectPage}
              specEntry={f.finishCode ? specLookup.get(f.finishCode) : undefined}
              verification={verificationsByRow.get(keyFor('floor', f.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('floor', f.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </QuantitySection>
      )}

      {/* Doors */}
      {result.doors.length > 0 && (
        <QuantitySection
          icon={<DoorOpen size={16} color={themeColors.accent} strokeWidth={1.75} />}
          title={`Doors (${result.doors.length} types)`}
          helper="Door schedule. Counts are by mark/type."
        >
          {result.doors.map(d => (
            <EditableRow
              key={d.id}
              rowKey={keyFor('doors', d.id)}
              title={d.mark ? `${d.mark} — ${d.description}` : d.description}
              subtitle={`${d.widthIn}" × ${d.heightIn}"`}
              quantity={overridden(overrides, keyFor('doors', d.id), d.count)}
              unit="EA"
              confidence={d.confidence}
              sourcePages={d.sourcePages}
              onChangeQuantity={v => onSetOverride(keyFor('doors', d.id), v)}
              originalQuantity={d.count}
              onInspectPage={onInspectPage}
              specEntry={d.mark ? specLookup.get(d.mark) : undefined}
              verification={verificationsByRow.get(keyFor('doors', d.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('doors', d.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </QuantitySection>
      )}

      {/* Windows */}
      {result.windows.length > 0 && (
        <QuantitySection
          icon={<AppWindow size={16} color={themeColors.accent} strokeWidth={1.75} />}
          title={`Windows (${result.windows.length} types)`}
          helper="Window schedule. Counts are by mark/type."
        >
          {result.windows.map(w => (
            <EditableRow
              key={w.id}
              rowKey={keyFor('windows', w.id)}
              title={w.mark ? `${w.mark} — ${w.description}` : w.description}
              subtitle={`${w.widthIn}" × ${w.heightIn}"`}
              quantity={overridden(overrides, keyFor('windows', w.id), w.count)}
              unit="EA"
              confidence={w.confidence}
              sourcePages={w.sourcePages}
              onChangeQuantity={v => onSetOverride(keyFor('windows', w.id), v)}
              originalQuantity={w.count}
              onInspectPage={onInspectPage}
              specEntry={w.mark ? specLookup.get(w.mark) : undefined}
              verification={verificationsByRow.get(keyFor('windows', w.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('windows', w.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </QuantitySection>
      )}

      {/* Finishes */}
      {result.finishes.length > 0 && (
        <FinishesSection
          finishes={result.finishes}
          overrides={overrides}
          onSetOverride={onSetOverride}
          onInspectPage={onInspectPage}
          specLookup={specLookup}
          verificationsByRow={verificationsByRow}
          onCaptureVerification={onCaptureVerification}
          onDeleteVerification={onDeleteVerification}
          rejected={rejected}
          onToggleReject={onToggleReject}
        />
      )}

      {/* Fixtures */}
      {result.fixtures.length > 0 && (
        <FixturesSection
          fixtures={result.fixtures}
          overrides={overrides}
          onSetOverride={onSetOverride}
          onInspectPage={onInspectPage}
          specLookup={specLookup}
          verificationsByRow={verificationsByRow}
          onCaptureVerification={onCaptureVerification}
          onDeleteVerification={onDeleteVerification}
          rejected={rejected}
          onToggleReject={onToggleReject}
        />
      )}

      {/* Bulk materials */}
      {result.bulkMaterials.length > 0 && (
        <QuantitySection
          icon={<Boxes size={16} color={themeColors.accent} strokeWidth={1.75} />}
          title={`Bulk materials (${result.bulkMaterials.length})`}
          helper="Concrete, gravel base, asphalt — anything measured in volume or weight."
        >
          {result.bulkMaterials.map(b => (
            <EditableRow
              key={b.id}
              rowKey={keyFor('bulk', b.id)}
              title={b.description}
              quantity={overridden(overrides, keyFor('bulk', b.id), b.quantity)}
              unit={b.unit.toUpperCase()}
              confidence={b.confidence}
              sourcePages={b.sourcePages}
              notes={b.notes}
              onChangeQuantity={v => onSetOverride(keyFor('bulk', b.id), v)}
              originalQuantity={b.quantity}
              onInspectPage={onInspectPage}
              verification={verificationsByRow.get(keyFor('bulk', b.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('bulk', b.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </QuantitySection>
      )}

      {/* Concerns */}
      {result.concerns.length > 0 && (
        <>
          <SectionHeader
            icon={<ShieldAlert size={16} color={themeColors.accent} strokeWidth={1.75} />}
            title="Areas of concern"
          />
          <Text style={styles.sectionHelper}>
            What the AI flagged before relying on these numbers.
          </Text>
          <View style={styles.cardList}>
            {result.concerns.map((c, idx) => {
              const sevColor =
                c.severity === 'critical' ? themeColors.danger
                : c.severity === 'moderate' ? themeColors.accent
                : themeColors.textMuted;
              return (
                <View key={idx} style={[styles.concernCard, { borderLeftColor: sevColor }]}>
                  <View style={styles.concernHead}>
                    <View style={[styles.severityPill, { backgroundColor: sevColor + '15' }]}>
                      <Text style={[styles.severityText, { color: sevColor }]}>{c.severity}</Text>
                    </View>
                    <Text style={styles.concernTopic}>{c.topic}</Text>
                  </View>
                  <Text style={styles.concernDetail}>{c.detail}</Text>
                  <View style={styles.concernRec}>
                    <Text style={styles.concernRecLabel}>Recommendation</Text>
                    <Text style={styles.concernRecText}>{c.recommendation}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      {result.doubleCheck.length > 0 && (
        <>
          <SectionHeader icon={<HelpCircle size={16} color={themeColors.accent} strokeWidth={1.75} />} title="Double-check before bidding" />
          <View style={styles.checklistCard}>
            {result.doubleCheck.map((item, idx) => (
              <View key={idx} style={styles.checklistRow}>
                <View style={styles.checklistDot} />
                <Text style={styles.checklistText}>{item}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {result.missingScopes.length > 0 && (
        <>
          <SectionHeader icon={<AlertTriangle size={16} color={themeColors.accent} strokeWidth={1.75} />} title="Scopes not in these drawings" />
          <View style={styles.checklistCard}>
            {result.missingScopes.map((item, idx) => (
              <View key={idx} style={styles.checklistRow}>
                <View style={[styles.checklistDot, { backgroundColor: themeColors.accent }]} />
                <Text style={styles.checklistText}>{item}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Corrections roll-up — only renders if user has actually edited rows. */}
      <TakeoffAccuracyPanel takeoff={result} overrides={overrides} />

      {/* CTA bar. For a free/sub-Pro user, priced conversion is walled — so
          the primary CTA reframes as an explicit upsell ("See these priced —
          upgrade to Pro") that routes to the paywall, rather than a silent
          bounce into a full-screen Paywall over their result. */}
      <View style={styles.ctaBar}>
        <TouchableOpacity style={styles.ctaSecondary} onPress={onReset}>
          <Text style={styles.ctaSecondaryText}>Run again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ctaPrimary}
          onPress={onConvert}
          testID="takeoff-convert-cta"
        >
          {canConvertToEstimate ? (
            <>
              <CheckCircle2 size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.ctaPrimaryText}>Convert to estimate</Text>
            </>
          ) : (
            <>
              <Crown size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.ctaPrimaryText}>See these priced — upgrade to Pro</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      <View style={styles.ctaBarSecondary}>
        <TouchableOpacity style={styles.ctaPrimary} onPress={onPreviewBuyouts}>
          <Gavel size={16} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.ctaPrimaryText}>Generate sub-trade buyout packages</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FinishesSection({
  finishes, overrides, onSetOverride, onInspectPage, specLookup,
  verificationsByRow, onCaptureVerification, onDeleteVerification,
  rejected, onToggleReject,
}: {
  finishes: TakeoffFinish[];
  overrides: QuantityOverrides;
  onSetOverride: (k: string, v: number) => void;
  onInspectPage: (page: number) => void;
  specLookup: Map<string, SpecEntry>;
  verificationsByRow: Map<string, TakeoffFieldVerification>;
  onCaptureVerification: (v: TakeoffFieldVerification) => void;
  onDeleteVerification: (id: string) => void;
  rejected: RejectedRows;
  onToggleReject: (rowKey: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const grouped = useMemo(() => {
    const map = new Map<string, TakeoffFinish[]>();
    for (const f of finishes) {
      const arr = map.get(f.surface) ?? [];
      arr.push(f);
      map.set(f.surface, arr);
    }
    return Array.from(map.entries());
  }, [finishes]);

  return (
    <QuantitySection
      icon={<Paintbrush size={16} color={themeColors.accent} strokeWidth={1.75} />}
      title={`Finishes (${finishes.length})`}
      helper="Paint, flooring, base, casing — grouped by surface."
    >
      {grouped.map(([surface, items]) => (
        <View key={surface} style={styles.categoryGroup}>
          <Text style={styles.categoryLabel}>{surface}</Text>
          {items.map(f => (
            <EditableRow
              key={f.id}
              rowKey={keyFor('finish', f.id)}
              title={f.code ? `${f.code} — ${f.description}` : f.description}
              quantity={overridden(overrides, keyFor('finish', f.id), f.quantity)}
              unit={f.unit.toUpperCase()}
              confidence={f.confidence}
              sourcePages={f.sourcePages}
              onChangeQuantity={v => onSetOverride(keyFor('finish', f.id), v)}
              originalQuantity={f.quantity}
              onInspectPage={onInspectPage}
              specEntry={f.code ? specLookup.get(f.code) : undefined}
              verification={verificationsByRow.get(keyFor('finish', f.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('finish', f.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </View>
      ))}
    </QuantitySection>
  );
}

function FixturesSection({
  fixtures, overrides, onSetOverride, onInspectPage, specLookup,
  verificationsByRow, onCaptureVerification, onDeleteVerification,
  rejected, onToggleReject,
}: {
  fixtures: TakeoffFixture[];
  overrides: QuantityOverrides;
  onSetOverride: (k: string, v: number) => void;
  onInspectPage: (page: number) => void;
  specLookup: Map<string, SpecEntry>;
  verificationsByRow: Map<string, TakeoffFieldVerification>;
  onCaptureVerification: (v: TakeoffFieldVerification) => void;
  onDeleteVerification: (id: string) => void;
  rejected: RejectedRows;
  onToggleReject: (rowKey: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const grouped = useMemo(() => {
    const map = new Map<string, TakeoffFixture[]>();
    for (const f of fixtures) {
      const arr = map.get(f.category) ?? [];
      arr.push(f);
      map.set(f.category, arr);
    }
    return Array.from(map.entries());
  }, [fixtures]);

  return (
    <QuantitySection
      icon={<Wrench size={16} color={themeColors.accent} strokeWidth={1.75} />}
      title={`Fixtures (${fixtures.length})`}
      helper="Plumbing, electrical, HVAC, appliances — grouped by trade."
    >
      {grouped.map(([cat, items]) => (
        <View key={cat} style={styles.categoryGroup}>
          <Text style={styles.categoryLabel}>{cat}</Text>
          {items.map(f => (
            <EditableRow
              key={f.id}
              rowKey={keyFor('fixture', f.id)}
              title={f.mark ? `${f.mark} — ${f.description}` : f.description}
              quantity={overridden(overrides, keyFor('fixture', f.id), f.count)}
              unit="EA"
              confidence={f.confidence}
              sourcePages={f.sourcePages}
              onChangeQuantity={v => onSetOverride(keyFor('fixture', f.id), v)}
              originalQuantity={f.count}
              onInspectPage={onInspectPage}
              specEntry={f.mark ? specLookup.get(f.mark) : undefined}
              verification={verificationsByRow.get(keyFor('fixture', f.id))}
              onCaptureVerification={onCaptureVerification}
              onDeleteVerification={onDeleteVerification}
              rejected={!!rejected[keyFor('fixture', f.id)]}
              onToggleReject={onToggleReject}
            />
          ))}
        </View>
      ))}
    </QuantitySection>
  );
}

function QuantitySection({
  icon, title, helper, children,
}: {
  icon: React.ReactNode;
  title: string;
  helper: string;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      <SectionHeader icon={icon} title={title} />
      <Text style={styles.sectionHelper}>{helper}</Text>
      <View style={styles.cardList}>{children}</View>
    </>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderIcon}>{icon}</View>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

function Tile({ label, value, unit }: { label: string; value: string; unit: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileValueRow}>
        <Text style={styles.tileValue}>{value}</Text>
        <Text style={styles.tileUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function EditableRow({
  rowKey, title, subtitle, quantity, unit, confidence, sourcePages, notes,
  onChangeQuantity, originalQuantity, onInspectPage, specEntry,
  verification, onCaptureVerification, onDeleteVerification,
  rejected, onToggleReject,
}: {
  rowKey: string;
  title: string;
  subtitle?: string;
  quantity: number;
  unit: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
  notes?: string;
  onChangeQuantity: (v: number) => void;
  originalQuantity: number;
  onInspectPage?: (page: number) => void;
  specEntry?: SpecEntry;
  verification?: TakeoffFieldVerification;
  onCaptureVerification?: (v: TakeoffFieldVerification) => void;
  onDeleteVerification?: (id: string) => void;
  rejected?: boolean;
  onToggleReject?: (rowKey: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(quantity));
  const confColor = confidenceColor(confidence);
  const wasEdited = quantity !== originalQuantity;

  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n >= 0) {
      onChangeQuantity(n);
    } else {
      setDraft(String(quantity));
    }
    setEditing(false);
  };

  return (
    <View style={[styles.row, rejected && styles.rowRejected]}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, rejected && styles.rowTextRejected]}>{title}</Text>
          {subtitle ? <Text style={[styles.rowSubtitle, rejected && styles.rowTextRejected]}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rowQty}>
          {editing && !rejected ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              onBlur={commit}
              onSubmitEditing={commit}
              style={styles.rowQtyInput}
              autoFocus
              selectTextOnFocus
            />
          ) : (
            <TouchableOpacity
              onPress={() => { if (!rejected) { setDraft(String(quantity)); setEditing(true); } }}
              hitSlop={6}
              disabled={rejected}
            >
              <Text style={[styles.rowQtyValue, rejected && styles.rowTextRejected]}>{formatNum(quantity)}</Text>
            </TouchableOpacity>
          )}
          <Text style={[styles.rowQtyUnit, rejected && styles.rowTextRejected]}>{unit}</Text>
          {!rejected && (
            <TouchableOpacity onPress={() => { setDraft(String(quantity)); setEditing(true); }} hitSlop={6} accessibilityRole="button" accessibilityLabel="Edit">
              <Pencil size={12} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
          {onToggleReject && (
            <TouchableOpacity
              onPress={() => onToggleReject(rowKey)}
              hitSlop={8}
              style={styles.rowRejectBtn}
              testID={`row-reject-${rowKey}`}
            >
              {rejected ? (
                <Text style={styles.rowRestoreText}>Restore</Text>
              ) : (
                <X size={14} color={themeColors.danger} strokeWidth={1.75} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={styles.rowMeta}>
        <View style={[styles.miniPill, { backgroundColor: confColor + '15' }]}>
          <Text style={[styles.miniPillText, { color: confColor }]}>{confidence}</Text>
        </View>
        {wasEdited && (
          <View style={[styles.miniPill, { backgroundColor: themeColors.accent + '15' }]}>
            <Text style={[styles.miniPillText, { color: themeColors.accent }]}>edited</Text>
          </View>
        )}
        {sourcePages.length > 0 && onInspectPage ? (
          <TouchableOpacity
            onPress={() => onInspectPage(sourcePages[0])}
            hitSlop={6}
            style={styles.rowSourceLink}
          >
            <Eye size={11} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.rowSourceLinkText}>pp. {sourcePages.join(', ')}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.rowSource}>pp. {sourcePages.join(', ')}</Text>
        )}
        {wasEdited && (
          <TouchableOpacity onPress={() => onChangeQuantity(originalQuantity)} hitSlop={4}>
            <Text style={styles.rowResetLink}>Reset to AI</Text>
          </TouchableOpacity>
        )}
        {onCaptureVerification && (
          <TakeoffFieldVerifyButton
            rowKey={rowKey}
            aiQuantity={quantity}
            unit={unit}
            existing={verification}
            onCapture={onCaptureVerification}
            onDelete={onDeleteVerification}
          />
        )}
      </View>
      {specEntry && (
        <View style={styles.specInline}>
          <BookOpen size={11} color={themeColors.accent} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <Text style={styles.specInlineTitle} numberOfLines={1}>
              {specEntry.manufacturer ?? 'Spec'}{specEntry.product ? ` · ${specEntry.product}` : ''}
            </Text>
            {(specEntry.finish || specEntry.sku) && (
              <Text style={styles.specInlineSub} numberOfLines={1}>
                {[specEntry.sku, specEntry.finish].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
          <View style={[styles.miniPill, { backgroundColor: confidenceColor(specEntry.confidence) + '15' }]}>
            <Text style={[styles.miniPillText, { color: confidenceColor(specEntry.confidence) }]}>
              {specEntry.confidence}
            </Text>
          </View>
        </View>
      )}
      {notes ? <Text style={styles.rowNotes}>{notes}</Text> : null}
    </View>
  );
}

function BulkRejectToolbar({
  lowConfCount, mediumConfCount, rejectedCount,
  onDropLow, onDropLowAndMedium, onRestore,
}: {
  lowConfCount: number;
  mediumConfCount: number;
  rejectedCount: number;
  onDropLow: () => void;
  onDropLowAndMedium: () => void;
  onRestore: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bulkRejectCard}>
      <View style={styles.bulkRejectHead}>
        <ShieldAlert size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.bulkRejectTitle}>Clean up low-confidence rows</Text>
      </View>
      <Text style={styles.bulkRejectHelper}>
        AI takeoffs over-detect on every tool — drop the rows you don&apos;t trust before they pollute your buyout. {rejectedCount > 0 ? `Currently hiding ${rejectedCount} row${rejectedCount === 1 ? '' : 's'}.` : ''}
      </Text>
      <View style={styles.bulkRejectActions}>
        {lowConfCount > 0 && (
          <TouchableOpacity
            style={[styles.bulkRejectBtn, styles.bulkRejectBtnWarn]}
            onPress={onDropLow}
            activeOpacity={0.85}
          >
            <X size={12} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.bulkRejectBtnText}>Drop {lowConfCount} low-confidence</Text>
          </TouchableOpacity>
        )}
        {(lowConfCount + mediumConfCount) > 0 && (
          <TouchableOpacity
            style={[styles.bulkRejectBtn, styles.bulkRejectBtnWarn]}
            onPress={onDropLowAndMedium}
            activeOpacity={0.85}
          >
            <X size={12} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.bulkRejectBtnText}>Drop {lowConfCount + mediumConfCount} low + medium</Text>
          </TouchableOpacity>
        )}
        {rejectedCount > 0 && (
          <TouchableOpacity
            style={[styles.bulkRejectBtn, styles.bulkRejectBtnRestore]}
            onPress={onRestore}
            activeOpacity={0.85}
          >
            <RefreshCw size={12} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={[styles.bulkRejectBtnText, { color: themeColors.accent }]}>Restore all</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function SpecMatchCard({
  specMatch, loading, error, onMatch, onClear, targetCodesCount,
}: {
  specMatch: SpecMatchResult | null;
  loading: boolean;
  error: string | null;
  onMatch: () => void;
  onClear: () => void;
  targetCodesCount: number;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (loading) {
    return (
      <View style={styles.specCard}>
        <View style={styles.specCardHead}>
          <View style={styles.specCardIcon}>
            <ActivityIndicator size="small" color={themeColors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.specCardTitle}>Reading spec book…</Text>
            <Text style={styles.specCardSub}>Matching callout codes against the architect&apos;s specifications.</Text>
          </View>
        </View>
      </View>
    );
  }
  if (specMatch) {
    return (
      <View style={styles.specCard}>
        <View style={styles.specCardHead}>
          <View style={styles.specCardIcon}>
            <BookOpen size={16} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.specCardTitle}>Spec book matched</Text>
            <Text style={styles.specCardSub}>
              Each callout below now shows the manufacturer + product + finish.
            </Text>
          </View>
          <TouchableOpacity onPress={onClear} style={styles.specCardClear} hitSlop={6}>
            <Text style={styles.specCardClearText}>Remove</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.specCardStatRow}>
          <View style={styles.specCardStat}>
            <Text style={styles.specCardStatLabel}>Specs found</Text>
            <Text style={styles.specCardStatValue}>{specMatch.entries.length}</Text>
          </View>
          <View style={styles.specCardStat}>
            <Text style={styles.specCardStatLabel}>Codes unmatched</Text>
            <Text style={styles.specCardStatValue}>{specMatch.unmatched.length}</Text>
          </View>
        </View>
        {specMatch.unmatched.length > 0 && (
          <>
            <Text style={[styles.specCardSub, { marginTop: 4 }]}>
              These codes appear on the plans but no spec was found for them. Get an RFI or sub bid before you commit a price:
            </Text>
            <View style={styles.specUnmatchedRow}>
              {specMatch.unmatched.map(c => (
                <View key={c} style={styles.specUnmatchedChip}>
                  <Text style={styles.specUnmatchedText}>{c}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    );
  }
  return (
    <View style={styles.specCard}>
      <View style={styles.specCardHead}>
        <View style={styles.specCardIcon}>
          <BookOpen size={16} color={themeColors.accent} strokeWidth={1.75} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.specCardTitle}>Match callouts to the spec book</Text>
          <Text style={styles.specCardSub}>
            {targetCodesCount > 0
              ? `${targetCodesCount} callout code${targetCodesCount === 1 ? '' : 's'} on these plans (PT-1, T-2, etc.). Upload the architect's spec PDF and the AI will pair each code with its actual product + finish.`
              : 'Upload the architect\'s spec PDF — the AI extracts manufacturer, product, finish, and SKU per code.'}
          </Text>
        </View>
      </View>
      {error && (
        <View style={[styles.errorCard, { marginBottom: 0 }]}>
          <AlertTriangle size={14} color={themeColors.danger} strokeWidth={1.75} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <TouchableOpacity style={styles.specCardCta} onPress={onMatch} activeOpacity={0.85}>
        <Search size={14} color="#FFF" strokeWidth={1.75} />
        <Text style={styles.specCardCtaText}>Pick spec book PDF</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function keyFor(section: string, id: string): string {
  return `${section}:${id}`;
}

function overridden(map: QuantityOverrides, key: string, fallback: number): number {
  const v = map[key];
  return Number.isFinite(v) ? (v as number) : fallback;
}

function sumOverridable<T extends { id: string }>(
  items: T[],
  pick: (t: T) => number,
  keyOf: (t: T) => string,
  map: QuantityOverrides,
): number {
  return items.reduce((s, t) => s + overridden(map, keyOf(t), pick(t)), 0);
}

function confidenceColor(c: TakeoffConfidence): string {
  return c === 'high' ? '#16A34A' : c === 'medium' ? '#FF6A1A' : '#DC2626';
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US');
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

// Re-export the TakeoffWall etc. types so callers of this screen can use
// them without importing from `@/types` directly.
export type {
  TakeoffWall, TakeoffFloorArea, TakeoffDoor, TakeoffWindow,
  TakeoffFinish, TakeoffFixture, TakeoffBulkMaterial,
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: Type.title2.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.4, marginTop: 4 },

  card: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 14,
  },
  cardLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardHelper: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 4, marginBottom: 10, lineHeight: 17 },

  modelRow: { flexDirection: 'row', gap: 8 },
  modelOption: {
    flex: 1, padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.bg,
    borderWidth: 1.5, borderColor: themeColors.line,
    gap: 4,
  },
  modelOptionActive: { borderColor: themeColors.accent, backgroundColor: themeColors.accent + '08' },
  modelOptionDisabled: { opacity: 0.6 },
  modelOptionTopRow: { flexDirection: 'row', alignItems: 'center', minHeight: 20 },
  modelOptionLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text, marginTop: 4 },
  modelOptionTagline: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15 },
  tierTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.full },
  tierTagBusiness: { backgroundColor: themeColors.accent + '20' },
  tierTagLocked: { backgroundColor: themeColors.accent + '20' },
  tierTagText: { fontSize: 9, fontWeight: '800', color: themeColors.text, letterSpacing: 0.4 },

  upsell: {
    marginTop: 8, padding: 10, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '0D',
    borderWidth: 1, borderColor: themeColors.accent + '30',
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
  },
  upsellText: { flex: 1, fontSize: Type.caption2.fontSize, color: themeColors.text, lineHeight: 16, fontStyle: 'italic' },

  modelBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  modelBadgeText: { fontSize: 10, fontWeight: '700', color: themeColors.text, letterSpacing: 0.3 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    maxWidth: 200,
  },
  chipActive: { backgroundColor: themeColors.text, borderColor: themeColors.text },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: themeColors.text },
  chipTextActive: { color: '#FFF' },

  uploadCard: {
    backgroundColor: themeColors.accent + '0D', borderRadius: Tokens.radius.xl, padding: 28,
    borderWidth: 1.5, borderColor: themeColors.accent + '40', borderStyle: 'dashed',
    alignItems: 'center', gap: 8, marginBottom: 14,
  },
  uploadIcon: {
    width: 64, height: 64, borderRadius: Tokens.radius.xl, backgroundColor: themeColors.accent + '15',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  uploadTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text, marginTop: 4 },
  uploadBody: { fontSize: Type.footnote.fontSize, color: themeColors.text, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  uploadCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accent, marginTop: 10,
    shadowColor: themeColors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  uploadCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
  uploadHint: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, textAlign: 'center', lineHeight: 15, marginTop: 8, fontStyle: 'italic' },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.danger + '0D', borderWidth: 1, borderColor: themeColors.danger + '30',
    marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.danger, lineHeight: 18 },
  errorRetry: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '15' },
  errorRetryText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.danger },

  progressCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 22,
    borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center', gap: 10,
  },
  progressTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: themeColors.text },
  progressBody: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  skeletonStack: { marginTop: 16, gap: 10 },
  skeletonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: themeColors.line,
  },

  summaryCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 22,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.full },
  confidenceDot: { width: 7, height: 7, borderRadius: 4 },
  confidenceText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  summaryTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600', color: themeColors.text, lineHeight: 22, marginBottom: 6 },
  summarySub: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 18, marginBottom: 14 },

  scaleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
    marginBottom: 14,
  },
  scaleText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.text },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.md, padding: 10,
    borderWidth: 1, borderColor: themeColors.line,
  },
  tileLabel: { fontSize: 10, fontWeight: '700', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  tileValue: { fontSize: Type.title2.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.4 },
  tileUnit: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.textMuted },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  sectionHeaderIcon: { width: 28, height: 28, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderText: { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.2 },
  sectionHelper: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },

  cardList: { gap: 8, marginBottom: 14 },

  drawingCard: {
    flexDirection: 'row', gap: 12,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 12,
    borderWidth: 1, borderColor: themeColors.line,
  },
  drawingThumb: { width: 64, height: 64, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.bg },
  drawingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  drawingPage: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  readabilityPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full },
  readabilityText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  drawingType: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text, marginBottom: 2 },
  drawingScope: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17 },

  // Editable row
  row: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.md, padding: 12,
    borderWidth: 1, borderColor: themeColors.line,
    gap: 6,
  },
  rowRejected: {
    backgroundColor: themeColors.bg,
    borderColor: themeColors.line + '60',
    opacity: 0.55,
  },
  rowTextRejected: {
    textDecorationLine: 'line-through' as const,
    color: themeColors.textMuted,
  },
  rowRejectBtn: {
    marginLeft: 4, paddingHorizontal: 6, paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  rowRestoreText: { fontSize: Type.caption2.fontSize, color: themeColors.accent, fontWeight: '700' },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text },
  rowSubtitle: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 16 },
  rowQty: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowQtyValue: { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.2, minWidth: 40, textAlign: 'right' },
  rowQtyInput: {
    fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text,
    minWidth: 60, textAlign: 'right',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.accent + '08',
    borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  rowQtyUnit: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textMuted, textTransform: 'uppercase' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowSource: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginLeft: 'auto' },
  rowSourceLink: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.accent + '0D',
  },
  rowSourceLinkText: { fontSize: Type.caption2.fontSize, color: themeColors.accent, fontWeight: '700' },
  rowResetLink: { fontSize: Type.caption2.fontSize, color: themeColors.accent, fontWeight: '700', textDecorationLine: 'underline' },
  rowNotes: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontStyle: 'italic', lineHeight: 15 },

  miniPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.full },
  miniPillText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  categoryGroup: { gap: 6 },
  categoryLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.accent, textTransform: 'uppercase', letterSpacing: 1, marginTop: 6, marginBottom: 2 },

  concernCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: themeColors.line, borderLeftWidth: 4,
    gap: 8,
  },
  concernHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  severityPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full },
  severityText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  concernTopic: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text },
  concernDetail: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  concernRec: { paddingTop: 6, borderTopWidth: 1, borderTopColor: themeColors.line },
  concernRecLabel: { fontSize: 10, fontWeight: '700', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  concernRecText: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },

  checklistCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 14,
    gap: 10,
  },
  checklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checklistDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: themeColors.accent, marginTop: 7 },
  checklistText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },

  ctaBar: { flexDirection: 'row', gap: 10, marginTop: 18, marginBottom: 8 },
  ctaBarSecondary: { marginTop: 4, marginBottom: 8 },
  ctaSecondary: {
    flex: 1, paddingVertical: 13, borderRadius: 11,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  ctaPrimary: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11, backgroundColor: themeColors.accent,
  },
  ctaPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },

  teaserCard: {
    backgroundColor: themeColors.accent + '0D',
    borderRadius: Tokens.radius.panel, padding: 16,
    borderWidth: 1.5, borderColor: themeColors.accent + '40',
    marginBottom: 22, gap: 12,
  },
  teaserHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teaserIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  teaserEyebrow: { fontSize: 10, fontWeight: '800', color: themeColors.accent, letterSpacing: 0.8, textTransform: 'uppercase' },
  teaserTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text, marginTop: 2, letterSpacing: -0.2 },
  teaserBody: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  teaserCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 11, backgroundColor: themeColors.text,
  },
  teaserCtaText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  sisterToolCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: Tokens.radius.card, marginBottom: 14,
    backgroundColor: themeColors.surface,
    borderWidth: 1, borderColor: themeColors.line,
  },
  sisterToolIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: themeColors.accent + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  sisterToolTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  sisterToolBody: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 16 },

  specInline: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.accent + '08',
    borderWidth: 1, borderColor: themeColors.accent + '20',
    marginTop: 4,
  },
  specInlineTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.text },
  specInlineSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 1 },

  specCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: themeColors.line, marginBottom: 14,
    gap: 10,
  },
  specCardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  specCardIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  specCardTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.1 },
  specCardSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2, lineHeight: 15 },
  specCardCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent, alignSelf: 'flex-start',
  },
  specCardCtaText: { color: '#FFF', fontSize: Type.footnote.fontSize, fontWeight: '700' },
  specCardStatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: themeColors.line,
  },
  specCardStat: { flex: 1 },
  specCardStatLabel: { fontSize: 10, fontWeight: '700', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  specCardStatValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: themeColors.text, marginTop: 2, letterSpacing: -0.2 },
  specCardClear: { paddingHorizontal: 10, paddingVertical: 6 },
  specCardClearText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: themeColors.danger },
  specUnmatchedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  specUnmatchedChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.accent + '15',
    borderWidth: 1, borderColor: themeColors.accent + '30',
  },
  specUnmatchedText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.accent },

  modalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    width: '100%', maxWidth: 560,
    backgroundColor: themeColors.bg, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: themeColors.line,
    overflow: 'hidden',
  },
  modalHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  modalTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.2 },
  modalSub: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  modalFooter: {
    flexDirection: 'row', gap: 10, padding: 14,
    borderTopWidth: 1, borderTopColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  draftCard: {
    margin: 12, padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
    gap: 6,
  },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  draftName: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.1 },
  draftMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  draftMetaText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  draftScope: { fontSize: Type.caption1.fontSize, color: themeColors.text, lineHeight: 17 },
  draftItemCount: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontStyle: 'italic' },

  bulkRejectCard: {
    backgroundColor: themeColors.accent + '0D',
    borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: themeColors.accent + '30',
    marginBottom: 14, gap: 10,
  },
  bulkRejectHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bulkRejectTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: themeColors.text, letterSpacing: -0.1 },
  bulkRejectHelper: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15 },
  bulkRejectActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bulkRejectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.bg,
    borderWidth: 1, borderColor: themeColors.line,
  },
  bulkRejectBtnWarn: {
    backgroundColor: themeColors.danger + '0D',
    borderColor: themeColors.danger + '30',
  },
  bulkRejectBtnRestore: {
    backgroundColor: themeColors.accent + '0D',
    borderColor: themeColors.accent + '30',
  },
  bulkRejectBtnText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.danger, letterSpacing: 0.2 },
});
