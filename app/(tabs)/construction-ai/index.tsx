// DOB / Building Code Check — Pro+ feature
//
// Users describe a construction scenario (e.g. "finishing a basement in
// Brooklyn with an egress window"), pick a location and a category, and
// mageAISmart returns the relevant code sections, required permits,
// inspection checkpoints and common violations. Response is cached per
// unique prompt for 24h via mageAI's cacheKey mechanism so rapid
// re-queries don't hammer the edge function.
//
// Tier gating is enforced at the top; AI daily-call limits piggyback on
// the existing `ai_code_check_daily` FEATURE_LIMITS entry (free: 3,
// pro: 20, business: unlimited). Local counter lives in AsyncStorage so
// a fresh install resets the quota — acceptable for a lightweight gate.
//
// UX: the result is rendered in a full-screen Modal with accordion
// sections (summary first, everything else collapsed) so users don't
// have to scroll through a wall of text. A second Modal overlays while
// the AI request is in flight, with an animated loader that actually
// communicates what's happening ("Scanning IRC…", "Checking local
// amendments…") so the spinner doesn't feel dead.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, Animated, Easing, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import {
  Gavel, MapPin, Hammer, AlertTriangle, CheckCircle,
  ClipboardCheck, BookOpen, X, ChevronDown, ChevronUp,
  Home, Building2, Droplets, HardHat, Accessibility, Map,
  RefreshCw, PlusCircle, Flag, ChevronRight, FileText, ShieldCheck,
  Clock, Scale, MessageCircleQuestion, CalendarClock, Check, XCircle,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { mageAISmart } from '@/utils/mageAI';
import { useTierAccess, FEATURE_LIMITS } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import CodeCheckLoader from '@/components/CodeCheckLoader';
import { CONSTRUCTION_FACTS } from '@/utils/constructionFacts';
import { generateRoadmap, bookByDate, roadmapFlags, scopeHashOf, scopeSummary } from '@/utils/permitRoadmap';
import { reviewPlanCode, imageUriToBase64, PLAN_REVIEW_DISCLAIMER } from '@/utils/planCodeReviewer';
import type { RoadmapPermit, RoadmapInspection, PermitType, CodeFinding, PlanReview } from '@/types';
import { showAlert } from '@/utils/alert';
import AskConstructionMode from '@/components/construction/AskConstructionMode';
import { AutoScheduleReviewSheet } from '@/components/automation/AutoScheduleReviewSheet';
import { roadmapToScheduleWork, mergeReviewLines, hasRoadmapScheduleTasks, type ReviewLine } from '@/utils/automation/roadmapToScheduleWork';
import { buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { resolveZoning, confirmZoning, isZoningConfirmed } from '@/utils/automation/jurisdiction';
import { inspectionResultToScheduleWork, type InspectionResultWork } from '@/utils/automation/inspectionResultToScheduleWork';
import { InspectionResultReviewSheet } from '@/components/automation/InspectionResultReviewSheet';
import { useSafety } from '@/contexts/SafetyContext';
import { generateUUID } from '@/utils/generateId';

// Each category gets a distinct, semantically-correct icon. Audit found
// 7 of 8 were `Hammer` — the AI was lying with its iconography. Now
// every category telegraphs its scope at a glance.
const CATEGORIES = [
  { key: 'residential', label: 'Residential', icon: Home },
  { key: 'commercial', label: 'Commercial', icon: Building2 },
  { key: 'electrical', label: 'Electrical', icon: MageAIMark },
  { key: 'plumbing', label: 'Plumbing', icon: Droplets },
  { key: 'structural', label: 'Structural', icon: HardHat },
  { key: 'egress_fire', label: 'Egress / Fire', icon: AlertTriangle },
  { key: 'accessibility', label: 'ADA / Accessibility', icon: Accessibility },
  { key: 'zoning', label: 'Zoning / Land Use', icon: Map },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

// Curated "typical questions" per category. Tapping one autofills the
// scenario textarea so users get a structured, well-framed prompt instead
// of a vague one-liner — which in turn yields a better AI response.
const PRESET_QUESTIONS: Record<CategoryKey, string[]> = {
  residential: [
    'Finishing a basement into a livable bedroom with an egress window and new HVAC branch.',
    'Converting a detached garage into an ADU with full kitchen and bathroom.',
    'Adding a second story over a single-story ranch — existing foundation and framing.',
    'Replacing a roof on a 1960s home — tear-off to sheathing plus new underlayment.',
  ],
  commercial: [
    'Tenant fit-out for a 1,500 sq ft coffee shop in an existing retail shell.',
    'Converting a warehouse into a small office — new bathrooms, HVAC and lighting.',
    'Restaurant grease hood exhaust install and make-up air requirements.',
    'Interior demo of a 2,500 sq ft retail bay down to the shell.',
  ],
  electrical: [
    'Upgrading a 100A panel to a 200A service with a new meter socket.',
    'Adding a 60A sub-panel in a detached garage with a 100ft underground feeder.',
    'Installing a Level-2 EV charger on an existing residential panel.',
    'Bringing knob-and-tube wiring up to code in a pre-war apartment.',
  ],
  plumbing: [
    'Adding a full bathroom in a basement — new stack, pump-up ejector and vent.',
    'Replacing a 50-gallon atmospheric water heater with a tankless gas unit.',
    'Re-piping a house from galvanized to PEX with a new main shutoff.',
    'Installing a backflow preventer on an irrigation line to a public water main.',
  ],
  structural: [
    'Removing a load-bearing wall between kitchen and living room — new LVL beam.',
    'Cutting a new 6ft wide door opening in an exterior 2x6 load-bearing wall.',
    'Adding a rooftop deck over an existing flat roof — checking framing capacity.',
    'Underpinning a foundation to add a basement below an existing slab on grade.',
  ],
  egress_fire: [
    'Basement bedroom egress window — sizing, well and ladder requirements.',
    'Multi-family building — common-path-of-travel and second means of egress.',
    'Fire-rated wall assembly between an attached garage and living space.',
    'Fire sprinkler retrofit triggers for a major residential renovation.',
  ],
  accessibility: [
    'ADA-compliant bathroom in a new small commercial tenant fit-out.',
    'Accessible route from a public sidewalk to a small-business entrance.',
    'Single-user restroom minimum dimensions and grab-bar placement.',
    'Accessible parking count and van-accessible spaces for a 20-space lot.',
  ],
  zoning: [
    'Building a new deck at the rear setback line of a R4 zoning lot.',
    'Adding an ADU to a single-family lot — checking parking and lot coverage.',
    'Home-based contracting business — zoning restrictions and permit needs.',
    'Building height and FAR limits for a proposed 3-story addition.',
  ],
};

const codeCheckSchema = z.object({
  summary: z.string().catch('').default(''),
  applicableCodes: z.array(z.object({
    code: z.string().catch('').default(''),
    section: z.string().catch('').default(''),
    requirement: z.string().catch('').default(''),
  })).default([]),
  permitsRequired: z.array(z.string()).default([]),
  inspections: z.array(z.string()).default([]),
  commonViolations: z.array(z.string()).default([]),
  disclaimer: z.string().catch('').default(''),
});

type CodeCheckResult = z.infer<typeof codeCheckSchema>;

// Per-code drill-in. The summary check returns one plain-English line per code
// — enough to know it applies, not enough to act on it. Tapping a code fetches
// THIS: what it actually requires, why it caught this specific job, and what
// the inspector will physically look at. Fetched on demand (not up-front) so
// the main check stays fast and we only spend a call on the code the GC cares
// about.
const codeDetailSchema = z.object({
  plainEnglish: z.string().catch('').default(''),
  appliesBecause: z.string().catch('').default(''),
  inspectorChecks: z.array(z.string()).default([]),
  commonFailures: z.array(z.string()).default([]),
  ruleOfThumb: z.string().catch('').default(''),
});

type CodeDetail = z.infer<typeof codeDetailSchema>;

/** Per-code fetch state, keyed by `${code}::${section}`. */
type CodeDetailState = {
  loading: boolean;
  data: CodeDetail | null;
  error: string | null;
};

const codeDetailKey = (c: { code: string; section: string }) => `${c.code}::${c.section}`;

// Server-side daily counter. Replaces an earlier AsyncStorage-based
// implementation that audit found was trivially bypassed: reinstall,
// clear app data, or directly edit `mageid_code_check_usage_v1`. Backed
// by ai_usage_counters table + ai_usage_daily_increment RPC.
async function getTodayUsage(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  try {
    const { data } = await supabase.rpc('ai_usage_daily_get', {
      p_user_id: userId,
      p_feature: 'ai_code_check',
    });
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

async function bumpTodayUsage(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  try {
    const { data } = await supabase.rpc('ai_usage_daily_increment', {
      p_user_id: userId,
      p_feature: 'ai_code_check',
    });
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

// ── Roadmap usage RPC (mirrors code-check pattern) ──────────────────────
async function getRoadmapTodayUsage(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  try {
    const { data } = await supabase.rpc('ai_usage_daily_get', {
      p_user_id: userId,
      p_feature: 'ai_permit_roadmap',
    });
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

async function bumpRoadmapTodayUsage(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  try {
    const { data } = await supabase.rpc('ai_usage_daily_increment', {
      p_user_id: userId,
      p_feature: 'ai_permit_roadmap',
    });
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

// ── Plan Review constants / helpers (mirrors roadmap + code-check) ───────
const SEVERITY_COLORS: Record<CodeFinding['severity'], string> = { high: '#FF3B30', med: '#FF9500', low: '#34C759' };
const SEVERITY_LABEL: Record<CodeFinding['severity'], string> = { high: 'High', med: 'Medium', low: 'Low' };
const CONFIDENCE_LABEL: Record<CodeFinding['confidence'], string> = { high: 'High confidence', med: 'Medium confidence', low: 'Low confidence' };
const FINDING_STATUS_LABEL: Record<CodeFinding['status'], string> = { open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed' };
const SEVERITY_ORDER: CodeFinding['severity'][] = ['high', 'med', 'low'];
const CODE_CATEGORIES: CodeFinding['category'][] = ['egress', 'stairs', 'width', 'height', 'fire', 'ada', 'guards', 'other'];

function normalizeCategory(c?: string): CodeFinding['category'] {
  const v = (c ?? '').toLowerCase() as CodeFinding['category'];
  return CODE_CATEGORIES.includes(v) ? v : 'other';
}
function normalizeLevel(s?: string): 'high' | 'med' | 'low' {
  const v = (s ?? '').toLowerCase();
  return v === 'high' || v === 'low' ? v : 'med';
}

async function getPlanReviewMonthUsage(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  try {
    // Read the MONTHLY counter the server enforces on success
    // (analyze-plan-code increments 'plan_code_review'). A separate client
    // daily counter would double-count into an orphaned bucket.
    const { data } = await supabase.rpc('ai_usage_get', {
      p_user_id: userId,
      p_feature: 'plan_code_review',
    });
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

// ── Permit type mapping for Add-to-Permits (Task 6) ─────────────────────
const PERMIT_TYPE_MAP: Record<string, PermitType> = {
  electrical: 'electrical', plumbing: 'plumbing', mechanical: 'mechanical', hvac: 'mechanical',
  building: 'building', structural: 'building', demolition: 'demolition', demo: 'demolition',
  grading: 'grading', fire: 'fire', occupancy: 'occupancy', zoning: 'other',
};
function toPermitType(t: string): PermitType {
  return PERMIT_TYPE_MAP[t.trim().toLowerCase()] ?? 'other';
}

export default function ConstructionAITab() {
  const styles = useThemedStyles(makeStyles);
  const { canAccess } = useTierAccess();
  const [showPaywall, setShowPaywall] = useState(false);
  const insets = useSafeAreaInsets();

  if (!canAccess('ai_code_check')) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingHorizontal: 24 }]}>
        <View style={styles.lockedHero}>
          <View style={styles.lockedIconWrap}>
            <Gavel size={36} color={Colors.primary} strokeWidth={1.75} />
          </View>
          <Text style={styles.lockedTitle}>Construction AI</Text>
          <Text style={styles.lockedBody}>
            Describe a project and Construction AI flags the likely building codes, required permits,
            inspections and common violations to avoid. Part of Pro and Business plans.
          </Text>
          <TouchableOpacity
            style={styles.lockedCta}
            onPress={() => setShowPaywall(true)}
            activeOpacity={0.85}
            testID="construction-ai-upgrade"
          >
            <MageAIMark size={18} color="#FFF" />
            <Text style={styles.lockedCtaText}>Upgrade to Pro</Text>
          </TouchableOpacity>
        </View>
        <Paywall
          visible={showPaywall}
          feature="Construction AI"
          requiredTier="pro"
          onClose={() => setShowPaywall(false)}
        />
      </View>
    );
  }
  return <ConstructionAIScreenInner />;
}

function ConstructionAIScreenInner() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { tier } = useTierAccess();
  const { user } = useAuth();
  const router = useRouter();

  // ── Mode toggle ─────────────────────────────────────────────────────
  const [mode, setMode] = useState<'code' | 'roadmap' | 'plan' | 'ask'>('code');

  // ── Code-Check state ─────────────────────────────────────────────────
  const [codeCheckProjectId, setCodeCheckProjectId] = useState<string | null>(null);
  const [location, setLocation] = useState<string>('');
  const [category, setCategory] = useState<CategoryKey>('residential');
  const [scenario, setScenario] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CodeCheckResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [overLimit, setOverLimit] = useState(false);

  const dailyCap = useMemo(() => FEATURE_LIMITS.ai_code_check_daily[tier], [tier]);

  // ── Roadmap state ────────────────────────────────────────────────────
  const {
    projects,
    updateProject,
    getPermitRoadmapForProject,
    savePermitRoadmap,
    updatePermitRoadmap,
    addPermit,
    getPlanSheetsForProject,
    getPlanReviewForSheet,
    savePlanReview,
    updatePlanReview,
  } = useProjects();
  const { addHazard, hazards } = useSafety();

  // When the user picks a code-check project, auto-fill location if blank.
  const codeCheckProject = codeCheckProjectId ? projects.find((p) => p.id === codeCheckProjectId) ?? null : null;
  useEffect(() => {
    if (!codeCheckProject) return;
    if (!location && codeCheckProject.location) setLocation(codeCheckProject.location);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeCheckProjectId]);

  const [roadmapProjectId, setRoadmapProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapOverLimit, setRoadmapOverLimit] = useState(false);
  const roadmapDailyCap = useMemo(() => FEATURE_LIMITS.ai_permit_roadmap_daily[tier], [tier]);

  const roadmapProject = projects.find((p) => p.id === roadmapProjectId) ?? null;
  const roadmap = roadmapProject ? getPermitRoadmapForProject(roadmapProject.id) : undefined;
  const roadmapTasks = roadmapProject?.schedule?.tasks ?? [];
  const roadmapStartDate = roadmapProject?.schedule?.startDate ?? new Date().toISOString().slice(0, 10);
  const flags = roadmap ? roadmapFlags(roadmap, roadmapTasks, roadmapStartDate) : [];
  const scopeStale = roadmap && roadmapProject ? roadmap.scopeHash !== scopeHashOf(roadmapProject) : false;

  // ── Auto-schedule (inspections → schedule) surface ──────────────────
  // The review sheet is the ONLY commit path; nothing here mutates the
  // schedule. Draft lines are pure (roadmapToScheduleWork), gated on the
  // schedule actually existing.
  const [showInspectionSheet, setShowInspectionSheet] = useState(false);
  const reviewLines = useMemo(
    () =>
      !roadmapProject?.schedule
        ? []
        : roadmapToScheduleWork(
            roadmap?.inspections ?? [],
            roadmapProject.schedule,
            roadmapProject.location || undefined,
          ),
    [roadmapProject, roadmap],
  );
  const zoningProp = roadmapProject
    ? (() => {
        const rz = resolveZoning(roadmapProject);
        return {
          district: rz.district ?? undefined,
          status: isZoningConfirmed(roadmapProject)
            ? ('confirmed' as const)
            : ('guess' as const),
        };
      })()
    : undefined;
  // ALREADY-SCHEDULED detection: a task already carries this feature's ref, so
  // the surface flips to "view in Schedule" instead of re-committing. Uses the
  // shared predicate the smoke test also imports, so the two can't drift.
  const alreadyScheduled = hasRoadmapScheduleTasks(roadmapProject?.schedule);

  // What the project is missing for a richer roadmap — surfaced when results
  // come back empty (or proactively before generating) so the GC knows what to add.
  const roadmapMissing = useMemo(() => {
    if (!roadmapProject) return [] as string[];
    const m: string[] = [];
    if (!roadmapProject.linkedEstimate?.items?.length) {
      m.push('Add an estimate — the AI infers required permits from your scope line items.');
    }
    if (!roadmapProject.schedule?.tasks?.length) {
      m.push('Build a schedule — inspections get sequenced to tasks with book-by dates.');
    }
    if (!roadmapProject.location) {
      m.push('Set the project location — permit rules and lead times are jurisdiction-specific.');
    }
    return m;
  }, [roadmapProject]);
  const roadmapEmpty = !!roadmap && roadmap.permits.length === 0 && roadmap.inspections.length === 0;

  // Confirm the (guessed) zoning district — the ONLY path that unblocks the
  // review sheet's confirm gate. Guards an empty district: confirmZoning throws
  // on empty, so we never call it without one.
  const handleConfirmZoning = useCallback(() => {
    if (!roadmapProject) return;
    const district = resolveZoning(roadmapProject).district ?? roadmapProject.location;
    if (!district?.trim()) return;
    updateProject(roadmapProject.id, {
      structuredAddress: confirmZoning(roadmapProject, district),
    });
  }, [roadmapProject, updateProject]);

  // Commit the reviewed draft inspections into the schedule. Runs ONLY on an
  // explicit contractor confirm from the sheet. Merges the draft/patched tasks
  // (idempotent by id) and rebuilds the schedule through the real engine so CPM
  // re-runs — we invent no placement here.
  const handleConfirmInspections = useCallback((lines: ReviewLine[]) => {
    if (!roadmapProject?.schedule) return;
    const merged = mergeReviewLines(lines, roadmapProject.schedule.tasks ?? []);
    const rebuilt = buildScheduleFromTasks(
      roadmapProject.schedule.name ?? 'Schedule',
      roadmapProject.id,
      merged,
      roadmapProject.schedule.baseline ?? null,
    );
    updateProject(roadmapProject.id, {
      schedule: { ...roadmapProject.schedule, ...rebuilt },
    });
    setShowInspectionSheet(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [roadmapProject, updateProject]);

  // ── Inspection-RESULT surface (pass/FAIL → draft consequences) ──────────
  // Marking a scheduled inspection PASSED or FAILED never silently mutates. We
  // build the DRAFT consequences via the pure adapter and present a confirm
  // surface (mirroring the auto-schedule review sheet + the CO→reflow preview
  // gate). NOTHING commits to the schedule / safety until the contractor
  // confirms. `pendingResult` holds the drafted work + which inspection it is.
  const [pendingResult, setPendingResult] = useState<{
    inspection: RoadmapInspection;
    result: 'passed' | 'failed';
    work: InspectionResultWork;
  } | null>(null);

  // TRIGGER — the contractor marks a scheduled inspection PASSED or FAILED. We
  // build the draft consequences against the CURRENT committed schedule and open
  // the confirm surface. Pure derivation only; no mutation here.
  const handleMarkInspectionResult = useCallback(
    (inspection: RoadmapInspection, result: 'passed' | 'failed') => {
      if (!roadmapProject?.schedule) return;
      const work = inspectionResultToScheduleWork(
        inspection,
        roadmapProject.schedule,
        result,
        {
          projectId: roadmapProject.id,
          createdBy: user?.id ?? 'unknown',
          now: new Date().toISOString(),
          hazardId: generateUUID(),
          jurisdiction: roadmapProject.location || undefined,
        },
      );
      setPendingResult({ inspection, result, work });
    },
    [roadmapProject, user],
  );

  // COMMIT — runs ONLY on an explicit confirm from the result sheet. Commits all
  // consequences atomically: the reflowed/merged schedule tasks (when the
  // adapter produced any), the inspection status, and — on FAIL — the drafted
  // hazard. Idempotent by construction (adapter dedups on sourceEventRef /
  // sourceInspectionId), so a re-confirm never duplicates.
  const handleConfirmInspectionResult = useCallback(() => {
    if (!pendingResult || !roadmapProject?.schedule || !roadmap) return;
    const { inspection, result, work } = pendingResult;

    // 1) Schedule — only when the adapter produced a task set (PASS-with-no-
    //    successors returns none). Rebuild through the real engine so CPM re-runs.
    if (work.tasks) {
      const rebuilt = buildScheduleFromTasks(
        roadmapProject.schedule.name ?? 'Schedule',
        roadmapProject.id,
        work.tasks,
        roadmapProject.schedule.baseline ?? null,
      );
      updateProject(roadmapProject.id, {
        schedule: { ...roadmapProject.schedule, ...rebuilt },
      });
    }

    // 2) Inspection status — the source record now reflects the result.
    updatePermitRoadmap(roadmap.id, {
      inspections: roadmap.inspections.map((x) =>
        x.id === inspection.id ? { ...x, status: result } : x,
      ),
    });

    // 3) FAIL → commit the hazard. Dedupe on sourceInspectionId so a re-fail of
    //    the same inspection does not spawn a second live hazard.
    if (result === 'failed' && work.hazardDraft) {
      const already = hazards.some(
        (h) => h.sourceInspectionId === work.hazardDraft!.sourceInspectionId,
      );
      if (!already) addHazard(work.hazardDraft);
    }

    setPendingResult(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [pendingResult, roadmapProject, roadmap, updateProject, updatePermitRoadmap, addHazard, hazards]);

  // ── Plan Review state ────────────────────────────────────────────────
  const [planProjectId, setPlanProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [planSheetId, setPlanSheetId] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planOverLimit, setPlanOverLimit] = useState(false);
  const planProject = projects.find((p) => p.id === planProjectId) ?? null;
  const planSheets = planProjectId ? getPlanSheetsForProject(planProjectId) : [];
  const planSheet = planSheets.find((s) => s.id === planSheetId) ?? null;
  const existingReview = planSheetId ? getPlanReviewForSheet(planSheetId) : null;
  const planMonthlyCap = useMemo(() => FEATURE_LIMITS.ai_plan_review_monthly[tier], [tier]);

  const runPlanReview = useCallback(async () => {
    if (!planProject || !planSheet) return;
    const used = await getPlanReviewMonthUsage(user?.id);
    if (used >= planMonthlyCap) { setPlanOverLimit(true); return; }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPlanLoading(true);
    try {
      const { base64, mimeType } = await imageUriToBase64(planSheet.imageUri);
      const res = await reviewPlanCode({ imageBase64: base64, mimeType, location: planProject.location, projectType: planProject.type });
      const prior = getPlanReviewForSheet(planSheet.id);
      const priorStatusByRef = new globalThis.Map((prior?.findings ?? []).map((f) => [f.codeRef, f.status] as const));
      const reviewId = prior?.id ?? `plan-review-${planSheet.id}-${Date.now()}`;
      const findings: CodeFinding[] = res.findings.map((f, i) => {
        const codeRef = (f.codeRef ?? '').trim() || 'IRC/IBC (general)';
        return {
          id: `${reviewId}-${i}`,
          category: normalizeCategory(f.category),
          codeRef,
          requirement: (f.requirement ?? '').trim(),
          observed: (f.observed ?? '').trim(),
          severity: normalizeLevel(f.severity),
          confidence: normalizeLevel(f.confidence),
          status: priorStatusByRef.get(codeRef) ?? 'open',
        };
      });
      savePlanReview({ id: reviewId, projectId: planProject.id, planSheetId: planSheet.id, reviewedAt: new Date().toISOString(), findings });
      // Server (analyze-plan-code) increments the monthly 'plan_code_review'
      // counter on success — no client-side increment needed.
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showAlert('Plan review failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setPlanLoading(false);
    }
  }, [planProject, planSheet, planMonthlyCap, user?.id, getPlanReviewForSheet, savePlanReview]);

  const cycleFindingStatus = useCallback((review: PlanReview, findingId: string) => {
    const next: Record<CodeFinding['status'], CodeFinding['status']> = { open: 'resolved', resolved: 'dismissed', dismissed: 'open' };
    updatePlanReview(review.id, { findings: review.findings.map((f) => (f.id === findingId ? { ...f, status: next[f.status] } : f)) });
  }, [updatePlanReview]);

  const runGenerateRoadmap = useCallback(async (isRegen: boolean) => {
    if (!roadmapProject) return;
    const used = await getRoadmapTodayUsage(user?.id);
    if (used >= roadmapDailyCap) {
      setRoadmapOverLimit(true);
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRoadmapLoading(true);
    const res = await generateRoadmap(roadmapProject, { forceFresh: isRegen });
    setRoadmapLoading(false);
    if (!res.ok) {
      showAlert('Roadmap failed', res.error);
      return;
    }
    // On regen: carry over status by title
    let newRoadmap = res.roadmap;
    if (isRegen && roadmap) {
      const priorPermits = roadmap.permits;
      const priorInsps = roadmap.inspections;
      newRoadmap = {
        ...newRoadmap,
        permits: newRoadmap.permits.map((p) => {
          const prior = priorPermits.find((x) => x.title === p.title);
          return prior ? { ...p, status: prior.status, linkedPermitId: prior.linkedPermitId } : p;
        }),
        inspections: newRoadmap.inspections.map((i) => {
          const prior = priorInsps.find((x) => x.title === i.title);
          return prior ? { ...i, status: prior.status } : i;
        }),
      };
    }
    savePermitRoadmap(newRoadmap);
    if (!res.cached) void bumpRoadmapTodayUsage(user?.id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [roadmapProject, user?.id, roadmapDailyCap, roadmap, savePermitRoadmap]);

  const onAddToPermits = useCallback((p: RoadmapPermit) => {
    if (!roadmapProject || !roadmap || p.linkedPermitId) return;
    const created = addPermit({
      projectId: roadmapProject.id,
      projectName: roadmapProject.name,
      type: toPermitType(p.type),
      jurisdiction: roadmapProject.location || '',
      status: 'applied',
      appliedDate: new Date().toISOString(),
      fee: 0,
      // Carry the roadmap's descriptive name as the first line of notes (the
      // permits tracker has no dedicated title column), with the "why" below it.
      // The Permits card surfaces the first line as the permit's name.
      notes: p.description ? `${p.title}\n${p.description}` : p.title,
    });
    updatePermitRoadmap(roadmap.id, {
      permits: roadmap.permits.map((x) =>
        x.id === p.id ? { ...x, linkedPermitId: created.id, status: 'applied' } : x,
      ),
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [roadmapProject, roadmap, addPermit, updatePermitRoadmap]);

  const canSubmit = location.trim().length > 0 && scenario.trim().length > 10 && !loading;

  const runCheck = useCallback(async () => {
    if (!canSubmit) return;
    const used = await getTodayUsage(user?.id);
    if (used >= dailyCap) {
      setOverLimit(true);
      return;
    }

    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setResult(null);
    setResultOpen(false);

    const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label ?? category;

    // Build optional project-context prefix for a richer, grounded check.
    const projectContextBlock = codeCheckProject
      ? `PROJECT CONTEXT (auto-filled from "${codeCheckProject.name}"):\n` +
        `- Type: ${codeCheckProject.type || 'unknown'}\n` +
        `- Scope: ${scopeSummary(codeCheckProject) || codeCheckProject.description || '(none)'}\n`
      : '';

    const prompt = `You are a licensed code-compliance advisor for US construction. A contractor is working on the following project and needs a building-code sanity check.

${projectContextBlock}Location: ${location.trim()}
Category: ${categoryLabel}
Scenario: ${scenario.trim()}

Return a JSON object with:
- summary: one paragraph explaining the key code implications
- applicableCodes: array of { code (e.g. "IRC 2021", "NYC BC 2022"), section (e.g. "R310.1"), requirement (plain English) }
- permitsRequired: array of permit names the contractor should pull before work
- inspections: array of inspections this project will likely need
- commonViolations: array of the most common code violations for this type of work
- disclaimer: a one-sentence reminder that this is AI guidance, not legal advice, and the AHJ governs

Be specific to the cited location if possible. If the location is not in the US, note that and give the closest applicable model code guidance.`;

    const cacheKey = `code_check::${codeCheckProjectId ?? 'none'}::${location.trim().toLowerCase()}::${category}::${scenario.trim().toLowerCase().slice(0, 120)}`;

    try {
      const res = await mageAISmart(prompt, codeCheckSchema, cacheKey);
      if (!res.success || !res.data) {
        setLoading(false);
        showAlert('Code check failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
        return;
      }
      setResult(res.data as CodeCheckResult);
      if (!res.cached) await bumpTodayUsage(user?.id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // iOS can't present two Modals at once. Dismiss the loading modal
      // first, then open the result modal after the dismissal animation
      // has had time to finish — otherwise the second modal silently
      // refuses to present and the screen appears frozen.
      setLoading(false);
      const openDelay = Platform.OS === 'ios' ? 450 : 80;
      setTimeout(() => setResultOpen(true), openDelay);
    } catch (err) {
      setLoading(false);
      showAlert('Code check failed', err instanceof Error ? err.message : 'Unknown error.');
    }
  }, [canSubmit, category, dailyCap, location, scenario, user?.id]);

  const presets = PRESET_QUESTIONS[category];

  // Only free / pro users have a higher tier to upsell to. Business and
  // Enterprise already own the top of the ladder for these features, so a
  // "Upgrade to Business" wall would tell them to buy a tier they have (or,
  // for Enterprise, a LOWER one). Show a plain "limit reached, resets…"
  // message instead — no upsell. Free → pro, pro → business.
  const canUpsellCap = tier === 'free' || tier === 'pro';
  const upsellCapTier: 'pro' | 'business' = tier === 'free' ? 'pro' : 'business';

  if (overLimit) {
    return canUpsellCap ? (
      <Paywall
        visible={true}
        feature={`Code Check Daily Limit (${dailyCap}/day on ${tier})`}
        requiredTier={upsellCapTier}
        onClose={() => setOverLimit(false)}
      />
    ) : (
      <LimitReachedView
        title="Daily code check limit reached"
        message={`You've used today's ${dailyCap} code checks. Resets at midnight.`}
        onClose={() => setOverLimit(false)}
      />
    );
  }

  if (roadmapOverLimit) {
    return canUpsellCap ? (
      <Paywall
        visible={true}
        feature={`Roadmap Daily Limit (${roadmapDailyCap}/day on ${tier})`}
        requiredTier={upsellCapTier}
        onClose={() => setRoadmapOverLimit(false)}
      />
    ) : (
      <LimitReachedView
        title="Daily roadmap limit reached"
        message={`You've used today's ${roadmapDailyCap} roadmap generations. Resets at midnight.`}
        onClose={() => setRoadmapOverLimit(false)}
      />
    );
  }

  if (planOverLimit) {
    return canUpsellCap ? (
      <Paywall
        visible={true}
        feature={`Plan Review Monthly Limit (${planMonthlyCap}/month on ${tier})`}
        requiredTier={upsellCapTier}
        onClose={() => setPlanOverLimit(false)}
      />
    ) : (
      <LimitReachedView
        title="Monthly plan review limit reached"
        message={`You've used this month's ${planMonthlyCap} plan reviews. Resets on the 1st.`}
        onClose={() => setPlanOverLimit(false)}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          title: 'Construction AI',
          headerShown: false,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* ── Mode toggle ── */}
        <View style={styles.modeToggleBar}>
          <TouchableOpacity
            style={[styles.modeToggleBtn, mode === 'code' && styles.modeToggleBtnActive]}
            onPress={() => setMode('code')}
            activeOpacity={0.8}
            testID="mode-toggle-code"
          >
            <Gavel size={14} color={mode === 'code' ? '#FFF' : Colors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.modeToggleText, mode === 'code' && styles.modeToggleTextActive]}>Code Check</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeToggleBtn, mode === 'roadmap' && styles.modeToggleBtnActive]}
            onPress={() => setMode('roadmap')}
            activeOpacity={0.8}
            testID="mode-toggle-roadmap"
          >
            <Map size={14} color={mode === 'roadmap' ? '#FFF' : Colors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.modeToggleText, mode === 'roadmap' && styles.modeToggleTextActive]}>Project Roadmap</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeToggleBtn, mode === 'plan' && styles.modeToggleBtnActive]}
            onPress={() => setMode('plan')}
            activeOpacity={0.8}
            testID="mode-toggle-plan"
          >
            <ShieldCheck size={14} color={mode === 'plan' ? '#FFF' : Colors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.modeToggleText, mode === 'plan' && styles.modeToggleTextActive]}>Plan Review</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeToggleBtn, mode === 'ask' && styles.modeToggleBtnActive]}
            onPress={() => setMode('ask')}
            activeOpacity={0.8}
            testID="mode-toggle-ask"
          >
            <MessageCircleQuestion size={14} color={mode === 'ask' ? '#FFF' : Colors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.modeToggleText, mode === 'ask' && styles.modeToggleTextActive]}>Ask</Text>
          </TouchableOpacity>
        </View>

        {mode === 'code' ? (
          <ScrollView
            {...fabScroll}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <Gavel size={28} color={Colors.primary} strokeWidth={1.75} />
              </View>
              <Text style={styles.heroTitle}>Construction AI</Text>
              <Text style={styles.heroSubtitle}>
                Describe your project and Construction AI flags the likely codes, permits and common violations to watch for.
              </Text>
            </View>

            {/* Bid Advisor shortcut — Business tool that lives on its own screen */}
            <TouchableOpacity
              style={styles.bidAdvisorCard}
              onPress={() => router.push('/judges')}
              activeOpacity={0.85}
              testID="construction-ai-bid-advisor"
            >
              <View style={styles.bidAdvisorIconWrap}>
                <Scale size={20} color={Colors.primary} strokeWidth={1.75} />
              </View>
              <View style={styles.bidAdvisorBody}>
                <View style={styles.bidAdvisorTitleRow}>
                  <Text style={styles.bidAdvisorTitle}>Bid Advisor</Text>
                  <View style={styles.bidAdvisorTierChip}>
                    <Text style={styles.bidAdvisorTierText}>Business</Text>
                  </View>
                </View>
                <Text style={styles.bidAdvisorSubtitle}>Should I bid this — and at what price?</Text>
              </View>
              <ChevronRight size={16} color={Colors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>

            {/* Optional project link — auto-fills location + scope */}
            {projects.length > 0 && (
              <>
                <Text style={styles.label}>Link a project (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row' as const, gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.chip, codeCheckProjectId === null && styles.chipActive]}
                      onPress={() => setCodeCheckProjectId(null)}
                      activeOpacity={0.8}
                      testID="code-check-project-none"
                    >
                      <Text style={[styles.chipText, codeCheckProjectId === null && styles.chipTextActive]}>No project</Text>
                    </TouchableOpacity>
                    {projects.map((p) => {
                      const active = p.id === codeCheckProjectId;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => setCodeCheckProjectId(p.id)}
                          activeOpacity={0.8}
                          style={[styles.chip, active && styles.chipActive]}
                          testID={`code-check-project-${p.id}`}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
                {codeCheckProject && (
                  <Text style={styles.projectPrefillNote} testID="code-check-project-prefill">
                    Using {codeCheckProject.name}&apos;s location and scope — edit below to adjust
                  </Text>
                )}
              </>
            )}

            <Text style={styles.label}>Location (city, state)</Text>
            <View style={styles.inputRow}>
              <MapPin size={16} color={Colors.textMuted} strokeWidth={1.75} />
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. Brooklyn, NY"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                testID="code-check-location"
              />
            </View>

            <Text style={styles.label}>Category</Text>
            <View style={styles.chipWrap}>
              {CATEGORIES.map((c) => {
                const active = c.key === category;
                return (
                  <TouchableOpacity
                    key={c.key}
                    onPress={() => setCategory(c.key)}
                    activeOpacity={0.8}
                    style={[styles.chip, active && styles.chipActive]}
                    testID={`code-check-cat-${c.key}`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.presetHeader}>
              <MageAIMark size={14} color={Colors.primary} />
              <Text style={styles.presetHeaderText}>Popular questions</Text>
            </View>
            <View style={styles.presetList}>
              {presets.map((q) => (
                <TouchableOpacity
                  key={q}
                  onPress={() => {
                    setScenario(q);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.presetPill,
                    scenario === q && styles.presetPillActive,
                  ]}
                  testID={`code-check-preset-${q.slice(0, 20)}`}
                >
                  <Text style={[
                    styles.presetPillText,
                    scenario === q && styles.presetPillTextActive,
                  ]} numberOfLines={2}>
                    {q}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Describe the work</Text>
            <TextInput
              value={scenario}
              onChangeText={setScenario}
              placeholder="Tap a popular question above, or write your own (e.g. converting a garage into a livable bedroom with a new egress window)."
              placeholderTextColor={Colors.textMuted}
              style={styles.textArea}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              testID="code-check-scenario"
            />

            <TouchableOpacity
              style={[styles.runBtn, !canSubmit && styles.runBtnDisabled]}
              onPress={runCheck}
              disabled={!canSubmit}
              activeOpacity={0.85}
              testID="code-check-run"
            >
              <MageAIMark size={18} color="#FFF" />
              <Text style={styles.runBtnText}>Run Code Check</Text>
            </TouchableOpacity>

            <Text style={styles.quotaText}>
              {dailyCap === Infinity ? 'Unlimited code checks today' : `Daily limit: ${dailyCap} checks`}
            </Text>

            {result && !resultOpen ? (
              <TouchableOpacity
                style={styles.reopenBtn}
                onPress={() => setResultOpen(true)}
                activeOpacity={0.8}
                testID="code-check-reopen"
              >
                <BookOpen size={16} color={Colors.primary} strokeWidth={1.75} />
                <Text style={styles.reopenText}>View last result</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : mode === 'roadmap' ? (
          /* ── Project Roadmap mode ── */
          <>
          <ScrollView
            {...fabScroll}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <FileText size={28} color={Colors.primary} strokeWidth={1.75} />
              </View>
              <Text style={styles.heroTitle}>Project Roadmap</Text>
              <Text style={styles.heroSubtitle}>
                AI generates a sequenced permit and inspection roadmap from your project's scope and schedule.
              </Text>
            </View>

            {/* Project picker */}
            <Text style={styles.label}>Project</Text>
            {projects.length === 0 ? (
              <Text style={[styles.quotaText, { textAlign: 'left' as const }]}>No projects yet — create one first.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row' as const, gap: 8 }}>
                  {projects.map((p) => {
                    const active = p.id === roadmapProjectId;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => setRoadmapProjectId(p.id)}
                        activeOpacity={0.8}
                        style={[styles.chip, active && styles.chipActive]}
                        testID={`roadmap-project-${p.id}`}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {roadmapProject && !roadmap ? (
              /* Generate button (no roadmap yet) */
              <>
                <TouchableOpacity
                  style={styles.runBtn}
                  onPress={() => runGenerateRoadmap(false)}
                  disabled={roadmapLoading}
                  activeOpacity={0.85}
                  testID="roadmap-generate"
                >
                  <MageAIMark size={18} color="#FFF" />
                  <Text style={styles.runBtnText}>Generate Roadmap</Text>
                </TouchableOpacity>
                <Text style={styles.quotaText}>
                  {roadmapDailyCap === Infinity ? 'Unlimited roadmaps today' : `Daily limit: ${roadmapDailyCap} generations`}
                </Text>
                {roadmapMissing.length > 0 ? (
                  <View style={styles.missingCard}>
                    <Text style={styles.missingSubtitle}>For a fuller roadmap, add:</Text>
                    {roadmapMissing.map((m) => (
                      <Text key={m} style={styles.missingItem}>{`•  ${m}`}</Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {roadmap && roadmapProject ? (
              <>
                {/* Flags banner */}
                {flags.length > 0 ? (
                  <View style={styles.flagsBanner}>
                    <Flag size={14} color={Colors.error} strokeWidth={1.75} />
                    <View style={{ flex: 1, gap: 4 }}>
                      {flags.map((f) => (
                        <Text
                          key={f.itemId}
                          style={[styles.flagText, f.severity === 'high' && styles.flagTextHigh]}
                        >
                          {f.message}
                        </Text>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* Regenerate button */}
                <TouchableOpacity
                  style={[styles.regenBtn, scopeStale && styles.regenBtnHighlighted]}
                  onPress={() => runGenerateRoadmap(true)}
                  disabled={roadmapLoading}
                  activeOpacity={0.85}
                  testID="roadmap-regenerate"
                >
                  <RefreshCw size={16} color={scopeStale ? '#FFF' : Colors.primary} strokeWidth={1.75} />
                  <Text style={[styles.regenBtnText, scopeStale && styles.regenBtnTextHighlighted]}>
                    {scopeStale ? 'Regenerate (scope changed)' : 'Regenerate'}
                  </Text>
                </TouchableOpacity>

                {roadmapEmpty ? (
                  /* AI returned nothing — tell the GC what's missing */
                  <View style={styles.missingCard}>
                    <Text style={styles.missingTitle}>No permits or inspections generated</Text>
                    {roadmapMissing.length > 0 ? (
                      <>
                        <Text style={styles.missingSubtitle}>Add the following, then tap Regenerate:</Text>
                        {roadmapMissing.map((m) => (
                          <Text key={m} style={styles.missingItem}>{`•  ${m}`}</Text>
                        ))}
                      </>
                    ) : (
                      <Text style={styles.missingSubtitle}>
                        The AI couldn&apos;t infer items from the current scope. Tap Regenerate to try again, or add more detail to the estimate and schedule.
                      </Text>
                    )}
                  </View>
                ) : (
                  <>
                    {/* Permits section */}
                    <Text style={styles.roadmapSectionTitle}>Permits</Text>
                    {roadmap.permits.length === 0 ? (
                      <Text style={styles.roadmapEmptyNote}>No permits inferred — add an estimate scope, then Regenerate.</Text>
                    ) : roadmap.permits.map((p) => (
                      <RoadmapPermitRow
                        key={p.id}
                        permit={p}
                        onCycleStatus={() => {
                          const next: RoadmapPermit['status'][] = ['needed', 'applied', 'approved'];
                          const idx = next.indexOf(p.status);
                          const nextStatus = next[(idx + 1) % next.length];
                          updatePermitRoadmap(roadmap.id, {
                            permits: roadmap.permits.map((x) => x.id === p.id ? { ...x, status: nextStatus } : x),
                          });
                        }}
                        onAddToPermits={() => onAddToPermits(p)}
                        onOpenInTracker={() => router.push('/permits')}
                      />
                    ))}

                    {/* Inspections section */}
                    <Text style={styles.roadmapSectionTitle}>Inspections</Text>

                    {/* Auto-schedule affordance — hidden unless there is a real
                        schedule to add to AND at least one inspection. Once
                        committed it flips to a deep-link into the Schedule. */}
                    {roadmapProject?.schedule?.tasks && roadmap.inspections.length > 0 ? (
                      alreadyScheduled ? (
                        <TouchableOpacity
                          style={styles.inspectionScheduledCta}
                          onPress={() =>
                            router.push({
                              pathname: '/(tabs)/schedule',
                              params: { projectId: roadmapProject.id, focus: String(Date.now()) },
                            } as any)
                          }
                          activeOpacity={0.85}
                          testID="inspection-view-schedule"
                          accessibilityRole="button"
                          accessibilityLabel="Scheduled — view in Schedule"
                        >
                          <Check size={16} color={styles.inspectionScheduledText.color} strokeWidth={2} />
                          <Text style={styles.inspectionScheduledText}>Scheduled · View in Schedule</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={styles.inspectionGenerateCta}
                          onPress={() => setShowInspectionSheet(true)}
                          activeOpacity={0.85}
                          testID="inspection-generate-schedule"
                          accessibilityRole="button"
                          accessibilityLabel="Generate inspection schedule"
                        >
                          <CalendarClock size={16} color={Colors.primary} strokeWidth={1.75} />
                          <Text style={styles.inspectionGenerateText}>Generate inspection schedule</Text>
                        </TouchableOpacity>
                      )
                    ) : null}

                    {roadmap.inspections.length === 0 ? (
                      <Text style={styles.roadmapEmptyNote}>No inspections inferred — add a schedule, then Regenerate.</Text>
                    ) : roadmap.inspections.map((insp) => {
                      const gatingTask = insp.gatesTaskId
                        ? roadmapTasks.find((t) => t.id === insp.gatesTaskId)
                        : null;
                      const gatingLabel = gatingTask?.title ?? insp.gatesTaskHint ?? '—';
                      const bookBy = bookByDate(insp, roadmapTasks, roadmapStartDate);
                      return (
                        <RoadmapInspectionRow
                          key={insp.id}
                          inspection={insp}
                          gatingLabel={gatingLabel}
                          bookBy={bookBy}
                          canRecordResult={!!roadmapProject?.schedule}
                          onCycleStatus={() => {
                            // Cycle only the pre-result states (pending ↔ scheduled).
                            // Recording a PASS/FAIL result goes through the confirm
                            // surface, never this silent toggle.
                            const nextStatus: RoadmapInspection['status'] =
                              insp.status === 'scheduled' ? 'pending' : 'scheduled';
                            updatePermitRoadmap(roadmap.id, {
                              inspections: roadmap.inspections.map((x) => x.id === insp.id ? { ...x, status: nextStatus } : x),
                            });
                          }}
                          onMarkPassed={() => handleMarkInspectionResult(insp, 'passed')}
                          onMarkFailed={() => handleMarkInspectionResult(insp, 'failed')}
                        />
                      );
                    })}
                  </>
                )}
              </>
            ) : null}
          </ScrollView>

          {/* Review sheet — the ONLY commit path for auto-scheduling
              inspections. pageSheet on iOS, matching project-detail. */}
          <Modal
            visible={showInspectionSheet}
            animationType="slide"
            presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
            transparent={Platform.OS !== 'ios'}
            onRequestClose={() => setShowInspectionSheet(false)}
          >
            <AutoScheduleReviewSheet
              lines={reviewLines}
              zoning={zoningProp}
              onConfirm={handleConfirmInspections}
              onCancel={() => setShowInspectionSheet(false)}
              onConfirmZoning={handleConfirmZoning}
            />
          </Modal>

          {/* Inspection-RESULT confirm surface — the ONLY commit path for a
              pass release / fail re-inspection + hazard. Nothing mutates until
              the contractor confirms here. */}
          <Modal
            visible={!!pendingResult}
            animationType="slide"
            presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
            transparent={Platform.OS !== 'ios'}
            onRequestClose={() => setPendingResult(null)}
          >
            {pendingResult ? (
              <InspectionResultReviewSheet
                inspection={pendingResult.inspection}
                result={pendingResult.result}
                work={pendingResult.work}
                onConfirm={handleConfirmInspectionResult}
                onCancel={() => setPendingResult(null)}
              />
            ) : null}
          </Modal>
          </>
        ) : mode === 'plan' ? (
          /* ── Plan Review mode ── */
          <ScrollView
            {...fabScroll}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <ShieldCheck size={28} color={Colors.primary} strokeWidth={1.75} />
              </View>
              <Text style={styles.heroTitle}>Plan Review</Text>
              <Text style={styles.heroSubtitle}>
                AI scans a floor plan or drawing for likely building-code issues — egress, stairs, clearances, fire and ADA.
              </Text>
            </View>

            {/* Disclaimer banner (always visible) */}
            <View style={styles.planDisclaimer}>
              <AlertTriangle size={14} color="#FF9500" strokeWidth={1.75} />
              <Text style={styles.planDisclaimerText}>{PLAN_REVIEW_DISCLAIMER}</Text>
            </View>

            {/* Project picker */}
            <Text style={styles.label}>Project</Text>
            {projects.length === 0 ? (
              <Text style={[styles.quotaText, { textAlign: 'left' as const }]}>No projects yet — create one first.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row' as const, gap: 8 }}>
                  {projects.map((p) => {
                    const active = p.id === planProjectId;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => { setPlanProjectId(p.id); setPlanSheetId(null); }}
                        activeOpacity={0.8}
                        style={[styles.chip, active && styles.chipActive]}
                        testID={`plan-project-${p.id}`}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {planProject ? (
              planSheets.length === 0 ? (
                <Text style={[styles.quotaText, { textAlign: 'left' as const }]}>
                  Upload a floor plan or drawing for this project first.
                </Text>
              ) : (
                <>
                  {/* Plan-sheet picker */}
                  <Text style={styles.label}>Plan sheet</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row' as const, gap: 8 }}>
                      {planSheets.map((s) => {
                        const active = s.id === planSheetId;
                        return (
                          <TouchableOpacity
                            key={s.id}
                            onPress={() => setPlanSheetId(s.id)}
                            activeOpacity={0.8}
                            style={[styles.chip, active && styles.chipActive]}
                            testID={`plan-sheet-${s.id}`}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                              {s.sheetNumber ? `${s.sheetNumber} · ${s.name}` : s.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>

                  {/* Run button */}
                  <TouchableOpacity
                    style={[styles.runBtn, (planLoading || !planSheet) && styles.runBtnDisabled]}
                    onPress={runPlanReview}
                    disabled={planLoading || !planSheet}
                    activeOpacity={0.85}
                    testID="run-plan-review"
                  >
                    <MageAIMark size={18} color="#FFF" />
                    <Text style={styles.runBtnText}>
                      {planLoading ? 'Reviewing…' : existingReview ? 'Re-review for code' : 'Review for code'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.quotaText}>
                    {planMonthlyCap === Infinity ? 'Unlimited plan reviews this month' : `Monthly limit: ${planMonthlyCap} reviews`}
                  </Text>

                  {/* Results */}
                  {existingReview && !planLoading ? (
                    existingReview.findings.length === 0 ? (
                      <Text style={[styles.quotaText, { textAlign: 'left' as const, marginTop: 16 }]}>
                        No likely code issues found — still verify with your AHJ.
                      </Text>
                    ) : (
                      <View style={styles.findingsWrap}>
                        {SEVERITY_ORDER.map((sev) => {
                          const group = existingReview.findings.filter((f) => f.severity === sev);
                          if (group.length === 0) return null;
                          return (
                            <View key={sev} style={styles.severityGroup}>
                              <View style={styles.severityHeaderRow}>
                                <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLORS[sev] }]} />
                                <Text style={styles.severityHeaderText}>{`${SEVERITY_LABEL[sev]} · ${group.length}`}</Text>
                              </View>
                              {group.map((f) => (
                                <View key={f.id} style={[styles.findingCard, f.status !== 'open' && styles.findingCardMuted]}>
                                  <View style={styles.findingTopRow}>
                                    <Text style={styles.findingCodeRef}>{f.codeRef}</Text>
                                    <Text style={styles.findingConfidence}>{CONFIDENCE_LABEL[f.confidence]}</Text>
                                  </View>
                                  {f.requirement ? (
                                    <Text style={styles.findingRequirement}>{f.requirement}</Text>
                                  ) : null}
                                  {f.observed ? (
                                    <Text style={styles.findingObserved}>{`Observed: ${f.observed}`}</Text>
                                  ) : null}
                                  <TouchableOpacity
                                    onPress={() => cycleFindingStatus(existingReview, f.id)}
                                    activeOpacity={0.8}
                                    style={styles.findingStatusBtn}
                                    testID={`finding-status-${f.id}`}
                                  >
                                    <Text style={styles.findingStatusText}>{FINDING_STATUS_LABEL[f.status]}</Text>
                                    <ChevronRight size={10} color={Colors.primary} strokeWidth={1.75} />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          );
                        })}
                      </View>
                    )
                  ) : null}
                </>
              )
            ) : null}
          </ScrollView>
        ) : mode === 'ask' ? (
          <AskConstructionMode projects={projects} bottomInset={insets.bottom} />
        ) : null}
      </KeyboardAvoidingView>

      <LoadingModal visible={loading} subject={location.trim() || undefined} />
      <RoadmapLoadingModal visible={roadmapLoading} subject={location.trim() || undefined} />
      <ResultModal
        visible={resultOpen && !!result}
        result={result}
        onClose={() => setResultOpen(false)}
        location={location}
        scenario={scenario}
      />
    </View>
  );
}

// ── Roadmap row components ─────────────────────────────────────────────

const PERMIT_STATUS_COLORS: Record<RoadmapPermit['status'], string> = {
  needed: Colors.warning,
  applied: Colors.info,
  approved: Colors.success,
};

function RoadmapPermitRow({
  permit,
  onCycleStatus,
  onAddToPermits,
  onOpenInTracker,
}: {
  permit: RoadmapPermit;
  onCycleStatus: () => void;
  onAddToPermits: () => void;
  onOpenInTracker: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.roadmapRow}>
      <View style={styles.roadmapRowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.roadmapRowTitle}>{permit.title}</Text>
          <Text style={styles.roadmapRowMeta}>
            {permit.whoPulls.toUpperCase()} pulls · {permit.leadTimeDays}d lead
          </Text>
        </View>
        <TouchableOpacity
          onPress={onCycleStatus}
          activeOpacity={0.8}
          style={[styles.statusChip, { backgroundColor: PERMIT_STATUS_COLORS[permit.status] + '22', borderColor: PERMIT_STATUS_COLORS[permit.status] + '55' }]}
          testID={`permit-status-${permit.id}`}
        >
          <Text style={[styles.statusChipText, { color: PERMIT_STATUS_COLORS[permit.status] }]}>
            {permit.status}
          </Text>
          <ChevronRight size={10} color={PERMIT_STATUS_COLORS[permit.status]} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      {permit.description ? (
        <Text style={styles.roadmapRowDesc} numberOfLines={2}>{permit.description}</Text>
      ) : null}
      {!permit.linkedPermitId ? (
        <TouchableOpacity
          onPress={onAddToPermits}
          activeOpacity={0.8}
          style={styles.addToPermitsBtn}
          testID={`add-to-permits-${permit.id}`}
        >
          <PlusCircle size={13} color={Colors.primary} strokeWidth={1.75} />
          <Text style={styles.addToPermitsBtnText}>Add to Permits</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onOpenInTracker}
          activeOpacity={0.7}
          style={styles.linkedBadge}
          testID={`open-permit-${permit.id}`}
        >
          <CheckCircle size={12} color={Colors.success} strokeWidth={1.75} />
          <Text style={styles.linkedBadgeText}>Added to Permits</Text>
          <Text style={styles.linkedBadgeLink}>View</Text>
          <ChevronRight size={11} color={Colors.primary} strokeWidth={1.75} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const INSP_STATUS_COLORS: Record<RoadmapInspection['status'], string> = {
  pending: '#8E8E93',
  scheduled: '#FF9500',
  passed: '#34C759',
  failed: '#FF3B30',
};

function RoadmapInspectionRow({
  inspection,
  gatingLabel,
  bookBy,
  canRecordResult,
  onCycleStatus,
  onMarkPassed,
  onMarkFailed,
}: {
  inspection: RoadmapInspection;
  gatingLabel: string;
  bookBy: Date | null;
  canRecordResult: boolean;
  onCycleStatus: () => void;
  onMarkPassed: () => void;
  onMarkFailed: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const bookByStr = bookBy
    ? bookBy.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';
  // Pass/FAIL result buttons appear once the inspection is scheduled (there is a
  // committed schedule task to release / keep blocked). Marking a result opens
  // the confirm surface — it never silently mutates. A terminal result (passed /
  // failed) still allows re-recording (idempotent by construction).
  const showResultActions = canRecordResult && inspection.status !== 'pending';
  return (
    <View style={styles.roadmapRow}>
      <View style={styles.roadmapRowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.roadmapRowTitle}>{inspection.title}</Text>
          <Text style={styles.roadmapRowMeta}>
            Gates: {gatingLabel} · Book by: {bookByStr}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onCycleStatus}
          activeOpacity={0.8}
          style={[styles.statusChip, { backgroundColor: INSP_STATUS_COLORS[inspection.status] + '22', borderColor: INSP_STATUS_COLORS[inspection.status] + '55' }]}
          testID={`insp-status-${inspection.id}`}
        >
          <Text style={[styles.statusChipText, { color: INSP_STATUS_COLORS[inspection.status] }]}>
            {inspection.status}
          </Text>
          <ChevronRight size={10} color={INSP_STATUS_COLORS[inspection.status]} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      {inspection.description ? (
        <Text style={styles.roadmapRowDesc} numberOfLines={2}>{inspection.description}</Text>
      ) : null}
      {showResultActions ? (
        <View style={styles.inspResultActions}>
          <TouchableOpacity
            onPress={onMarkPassed}
            activeOpacity={0.85}
            style={styles.inspPassBtn}
            testID={`insp-mark-passed-${inspection.id}`}
            accessibilityRole="button"
            accessibilityLabel="Mark inspection passed"
          >
            <Check size={14} color={INSP_STATUS_COLORS.passed} strokeWidth={2} />
            <Text style={[styles.inspResultBtnText, { color: INSP_STATUS_COLORS.passed }]}>Passed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onMarkFailed}
            activeOpacity={0.85}
            style={styles.inspFailBtn}
            testID={`insp-mark-failed-${inspection.id}`}
            accessibilityRole="button"
            accessibilityLabel="Mark inspection failed"
          >
            <XCircle size={14} color={INSP_STATUS_COLORS.failed} strokeWidth={2} />
            <Text style={[styles.inspResultBtnText, { color: INSP_STATUS_COLORS.failed }]}>Failed</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// ── Roadmap loading modal ─────────────────────────────────────────────
const ROADMAP_LOADING_STEPS = [
  'Reading project scope…',
  'Mapping permit requirements…',
  'Sequencing inspections…',
  'Calculating book-by dates…',
  'Finalizing roadmap…',
];

function RoadmapLoadingModal({ visible, subject }: { visible: boolean; subject?: string }) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!visible) { setStepIdx(0); return; }
    // Advance and hold on the last step — see LoadingModal below for why a
    // looping checklist reads as stuck.
    const interval = setInterval(
      () => setStepIdx(i => Math.min(i + 1, ROADMAP_LOADING_STEPS.length - 1)),
      1700,
    );
    return () => clearInterval(interval);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen">
      <CodeCheckLoader
        eyebrow="PROJECT ROADMAP"
        headline="Sequencing permits, inspections and lead times"
        steps={ROADMAP_LOADING_STEPS}
        activeStep={stepIdx}
        subject={subject}
        facts={CONSTRUCTION_FACTS}
      />
    </Modal>
  );
}

// ── Animated loading modal ─────────────────────────────────────────────
// Shows a rotating gavel + a rotating status line so the wait feels
// like something is actually happening rather than a dead spinner.

const LOADING_STEPS = [
  'Scanning applicable codes…',
  'Checking local amendments…',
  'Flagging required permits…',
  'Reviewing common violations…',
  'Drafting inspection checklist…',
];

function LoadingModal({ visible, subject }: { visible: boolean; subject?: string }) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!visible) {
      setStepIdx(0);
      return;
    }
    // Walk the checklist forward and HOLD on the last step rather than looping
    // back to the top. A pass that restarts at "Scanning applicable codes…"
    // after reaching the end reads as stuck; holding reads as "finishing up".
    const interval = setInterval(() => {
      setStepIdx(i => Math.min(i + 1, LOADING_STEPS.length - 1));
    }, 1700);
    return () => {
      clearInterval(interval);
    };
  }, [visible]);

  // Full-screen, not a card on a dimmed form: the wait IS the screen while the
  // pass runs. presentationStyle fullScreen so there is no sheet chrome.
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen">
      <CodeCheckLoader
        steps={LOADING_STEPS}
        activeStep={stepIdx}
        subject={subject}
        facts={CONSTRUCTION_FACTS}
      />
    </Modal>
  );
}

// ── Result modal ───────────────────────────────────────────────────────
// Summary is always expanded. The other four sections collapse into
// chevrons so the result fits in one screen for a typical response.

type SectionKey = 'codes' | 'permits' | 'inspections' | 'violations';

function ResultModal({
  visible, result, onClose, location, scenario,
}: {
  visible: boolean;
  result: CodeCheckResult | null;
  onClose: () => void;
  /** Context carried in so a per-code drill-in is grounded in the same job the
   *  summary was run against, not asked in a vacuum. */
  location: string;
  scenario: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<SectionKey | null>('codes');
  /** Which code row is open, plus its lazily-fetched detail. Rendered INLINE:
   *  iOS refuses to present a second Modal over this one (see the openDelay
   *  workaround in runCodeCheck), so a detail sheet would silently never
   *  appear. */
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, CodeDetailState>>({});

  const loadDetail = useCallback(async (c: { code: string; section: string; requirement: string }) => {
    const key = codeDetailKey(c);
    // Already loaded or in flight — just toggle.
    if (details[key]?.data || details[key]?.loading) return;
    setDetails(prev => ({ ...prev, [key]: { loading: true, data: null, error: null } }));

    const label = [c.code, c.section].filter(Boolean).join(' ');
    const prompt = `You are a licensed code-compliance advisor for US construction. A contractor ran a code check and wants to understand ONE specific code citation in depth.

Location: ${location.trim()}
Work being done: ${scenario.trim()}
Code cited: ${label}
Summary requirement given: ${c.requirement}

Return a JSON object with:
- plainEnglish: what this code section actually requires, in plain contractor English (2-4 sentences). Include the specific numbers/dimensions/ratings it specifies when you are confident of them.
- appliesBecause: one or two sentences on why THIS code was triggered by THIS specific scope of work.
- inspectorChecks: array of 2-5 concrete things an inspector will physically look at or measure on site for this code.
- commonFailures: array of 2-4 specific ways contractors fail this particular code.
- ruleOfThumb: one short field-usable rule of thumb for staying compliant, or '' if none applies.

Be concrete and specific to the cited jurisdiction. Never invent a section number you are unsure of — describe the requirement instead.`;

    const cacheKey = `code_detail::${location.trim().toLowerCase()}::${label.toLowerCase()}::${c.requirement.toLowerCase().slice(0, 80)}`;
    try {
      const res = await mageAISmart(prompt, codeDetailSchema, cacheKey);
      if (!res.success || !res.data) {
        setDetails(prev => ({ ...prev, [key]: { loading: false, data: null, error: res.error ?? 'Could not load detail.' } }));
        return;
      }
      setDetails(prev => ({ ...prev, [key]: { loading: false, data: res.data as CodeDetail, error: null } }));
    } catch {
      setDetails(prev => ({ ...prev, [key]: { loading: false, data: null, error: 'Could not load detail.' } }));
    }
  }, [details, location, scenario]);

  const toggleCode = useCallback((c: { code: string; section: string; requirement: string }) => {
    const key = codeDetailKey(c);
    setOpenCode(cur => (cur === key ? null : key));
    if (openCode !== key) void loadDetail(c);
  }, [openCode, loadDetail]);

  if (!result) return null;

  const toggle = (k: SectionKey) => setExpanded((cur) => cur === k ? null : k);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.resultContainer, { paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8 }]}>
        <View style={styles.resultHeader}>
          <View style={styles.resultHeaderIcon}>
            <Gavel size={20} color={Colors.primary} strokeWidth={1.75} />
          </View>
          <Text style={styles.resultHeaderTitle}>Code Check Result</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.resultCloseBtn}
            testID="code-check-close"
            activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {result.summary ? (
            <View style={[styles.resultCard, styles.resultSummaryCard]}>
              <View style={styles.resultCardHeader}>
                <BookOpen size={16} color={Colors.primary} strokeWidth={1.75} />
                <Text style={styles.resultCardTitle}>Summary</Text>
              </View>
              <Text style={styles.resultBody}>{result.summary}</Text>
            </View>
          ) : null}

          {result.applicableCodes.length > 0 && (
            <AccordionSection
              keyName="codes"
              title="Applicable Codes"
              count={result.applicableCodes.length}
              Icon={Gavel}
              iconColor={Colors.primary}
              expanded={expanded === 'codes'}
              onToggle={toggle}
            >
              <Text style={styles.codeTapHint}>Tap a code for what it requires and what the inspector checks.</Text>
              {result.applicableCodes.map((c, i) => {
                const key = codeDetailKey(c);
                const isOpen = openCode === key;
                const st = details[key];
                return (
                  <View key={i} style={styles.codeRow}>
                    <TouchableOpacity
                      onPress={() => toggleCode(c)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${[c.code, c.section].filter(Boolean).join(' ')} — ${isOpen ? 'hide' : 'show'} detail`}
                      testID={`code-detail-toggle-${i}`}
                    >
                      <View style={styles.codeLabelRow}>
                        <Text style={styles.codeLabel}>{[c.code, c.section].filter(Boolean).join(' · ')}</Text>
                        {isOpen
                          ? <ChevronUp size={14} color={Colors.textMuted} strokeWidth={1.75} />
                          : <ChevronDown size={14} color={Colors.textMuted} strokeWidth={1.75} />}
                      </View>
                      <Text style={styles.codeReq}>{c.requirement}</Text>
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.codeDetail}>
                        {st?.loading && (
                          <View style={styles.codeDetailLoading}>
                            <ActivityIndicator size="small" color={Colors.primary} />
                            <Text style={styles.codeDetailLoadingText}>Looking up {[c.code, c.section].filter(Boolean).join(' ')}…</Text>
                          </View>
                        )}
                        {st?.error && (
                          <Text style={styles.codeDetailError}>{st.error}</Text>
                        )}
                        {st?.data && (
                          <>
                            {!!st.data.plainEnglish && (
                              <Text style={styles.codeDetailBody}>{st.data.plainEnglish}</Text>
                            )}
                            {!!st.data.appliesBecause && (
                              <>
                                <Text style={styles.codeDetailHeading}>Why it applies here</Text>
                                <Text style={styles.codeDetailBody}>{st.data.appliesBecause}</Text>
                              </>
                            )}
                            {st.data.inspectorChecks.length > 0 && (
                              <>
                                <Text style={styles.codeDetailHeading}>What the inspector checks</Text>
                                {st.data.inspectorChecks.map((x, k) => (
                                  <Text key={k} style={styles.codeDetailBullet}>• {x}</Text>
                                ))}
                              </>
                            )}
                            {st.data.commonFailures.length > 0 && (
                              <>
                                <Text style={styles.codeDetailHeading}>How jobs fail it</Text>
                                {st.data.commonFailures.map((x, k) => (
                                  <Text key={k} style={styles.codeDetailBullet}>• {x}</Text>
                                ))}
                              </>
                            )}
                            {!!st.data.ruleOfThumb && (
                              <View style={styles.codeRuleCard}>
                                <Text style={styles.codeRuleText}>{st.data.ruleOfThumb}</Text>
                              </View>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </AccordionSection>
          )}

          {result.permitsRequired.length > 0 && (
            <AccordionSection
              keyName="permits"
              title="Permits Required"
              count={result.permitsRequired.length}
              Icon={ClipboardCheck}
              iconColor={Colors.primary}
              expanded={expanded === 'permits'}
              onToggle={toggle}
            >
              {result.permitsRequired.map((p, i) => (
                <Text key={i} style={styles.bulletRow}>• {p}</Text>
              ))}
            </AccordionSection>
          )}

          {result.inspections.length > 0 && (
            <AccordionSection
              keyName="inspections"
              title="Inspections"
              count={result.inspections.length}
              Icon={CheckCircle}
              iconColor={Colors.success}
              expanded={expanded === 'inspections'}
              onToggle={toggle}
            >
              {result.inspections.map((ins, i) => (
                <Text key={i} style={styles.bulletRow}>• {ins}</Text>
              ))}
            </AccordionSection>
          )}

          {result.commonViolations.length > 0 && (
            <AccordionSection
              keyName="violations"
              title="Common Violations"
              count={result.commonViolations.length}
              Icon={AlertTriangle}
              iconColor={Colors.warning}
              expanded={expanded === 'violations'}
              onToggle={toggle}
            >
              {result.commonViolations.map((v, i) => (
                <Text key={i} style={styles.bulletRow}>• {v}</Text>
              ))}
            </AccordionSection>
          )}

          <Text style={styles.disclaimer}>
            {result.disclaimer ||
              'AI guidance only — verify with the local Authority Having Jurisdiction (AHJ) before work begins.'}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AccordionSection({
  keyName, title, count, Icon, iconColor, expanded, onToggle, children,
}: {
  keyName: SectionKey;
  title: string;
  count: number;
  Icon: typeof Gavel;
  iconColor: string;
  expanded: boolean;
  onToggle: (k: SectionKey) => void;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.resultCard}>
      <TouchableOpacity
        onPress={() => onToggle(keyName)}
        activeOpacity={0.7}
        style={styles.accordionHeader}
        testID={`code-check-accordion-${keyName}`}
      >
        <Icon size={16} color={iconColor} />
        <Text style={styles.resultCardTitle}>{title}</Text>
        <View style={styles.accordionCount}>
          <Text style={styles.accordionCountText}>{count}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {expanded
          ? <ChevronUp size={16} color={Colors.textMuted} strokeWidth={1.75} />
          : <ChevronDown size={16} color={Colors.textMuted} strokeWidth={1.75} />
        }
      </TouchableOpacity>
      {expanded ? <View style={styles.accordionBody}>{children}</View> : null}
    </View>
  );
}

// ── Limit-reached view ──────────────────────────────────────────────────
// Shown when a Business/Enterprise user exhausts a usage cap. There is no
// higher tier to sell them (Enterprise is the ceiling; Business already owns
// these features), so this is a plain "you've hit the limit, it resets…"
// screen — never an upsell Paywall. Reuses the locked-hero styling.
function LimitReachedView({
  title, message, onClose,
}: { title: string; message: string; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingHorizontal: 24 }]}>
      <View style={styles.lockedHero}>
        <View style={styles.lockedIconWrap}>
          <Clock size={36} color={Colors.primary} strokeWidth={1.75} />
        </View>
        <Text style={styles.lockedTitle}>{title}</Text>
        <Text style={styles.lockedBody}>{message}</Text>
        <TouchableOpacity
          style={styles.lockedCta}
          onPress={onClose}
          activeOpacity={0.85}
          testID="construction-ai-limit-dismiss"
        >
          <Text style={styles.lockedCtaText}>Got it</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  hero: { alignItems: 'center' as const, marginBottom: 20, gap: 6 },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  heroTitle: { fontSize: 24, fontWeight: '700' as const, color: themeColors.text },
  heroSubtitle: {
    fontSize: Type.bodyCompact.fontSize, color: themeColors.textMuted, textAlign: 'center' as const,
    paddingHorizontal: 20, lineHeight: 20,
  },
  label: {
    fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted,
    marginTop: 16, marginBottom: 8, letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, borderWidth: 1,
    borderColor: themeColors.line, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text, padding: 0 },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  chipTextActive: { color: '#FFF' },
  presetHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
  },
  presetHeaderText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  presetList: {
    gap: 8,
  },
  presetPill: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  presetPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  presetPillText: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.text,
    lineHeight: 18,
  },
  presetPillTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  textArea: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, borderWidth: 1,
    borderColor: themeColors.line, padding: 12, minHeight: 100,
    fontSize: Type.subhead.fontSize, color: themeColors.text,
  },
  runBtn: {
    marginTop: 20, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 8,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.lg, paddingVertical: 14,
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
  quotaText: {
    fontSize: Type.caption1.fontSize, color: themeColors.textMuted, textAlign: 'center' as const,
    marginTop: 8,
  },
  projectPrefillNote: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.accent,
    marginBottom: 8,
    fontStyle: 'italic' as const,
  },
  reopenBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  reopenText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },

  // Loading modal

  // Result modal
  resultContainer: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  resultHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  resultHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  resultHeaderTitle: {
    flex: 1,
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  resultCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  resultCard: {
    backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, borderWidth: 1,
    borderColor: themeColors.line, padding: 14,
  },
  resultSummaryCard: {
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.primary + '08',
  },
  resultCardHeader: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    gap: 8, marginBottom: 10,
  },
  resultCardTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  resultBody: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 20 },
  codeTapHint: {
    fontSize: Type.caption2.fontSize, color: themeColors.textMuted,
    fontStyle: 'italic' as const, marginBottom: 10, lineHeight: 15,
  },
  codeRow: { marginBottom: 10 },
  codeLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 2 },
  codeLabel: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.primary },
  codeReq: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },

  // Per-code drill-in, expanded inline under the tapped row.
  codeDetail: {
    marginTop: 10,
    paddingTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: Colors.primary + '40',
    gap: 2,
  },
  codeDetailLoading: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 4 },
  codeDetailLoadingText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  codeDetailError: { fontSize: Type.caption1.fontSize, color: themeColors.danger, lineHeight: 17 },
  codeDetailHeading: {
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const,
    color: themeColors.textMuted, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, marginTop: 10, marginBottom: 4,
  },
  codeDetailBody: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  codeDetailBullet: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19, marginBottom: 2 },
  codeRuleCard: {
    marginTop: 10,
    padding: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  codeRuleText: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18, fontWeight: '600' as const },
  bulletRow: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 20, marginBottom: 4 },
  disclaimer: {
    fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const,
    textAlign: 'center' as const, paddingHorizontal: 20, marginTop: 4,
  },

  // Accordion
  accordionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  accordionCount: {
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Tokens.radius.md,
    minWidth: 22,
    alignItems: 'center' as const,
  },
  accordionCountText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textSecondary,
  },
  accordionBody: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: themeColors.line,
  },

  lockedHero: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingBottom: 80,
    gap: 12,
  },
  lockedIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 8,
  },
  lockedTitle: {
    fontSize: 26, fontWeight: '700' as const, color: themeColors.text,
    textAlign: 'center' as const,
  },
  lockedBody: {
    fontSize: Type.subhead.fontSize, color: themeColors.textMuted,
    textAlign: 'center' as const, lineHeight: 22,
    paddingHorizontal: 12, marginBottom: 12,
  },
  lockedCta: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 8,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.lg,
    paddingVertical: 14, paddingHorizontal: 28,
  },
  lockedCtaText: {
    fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#FFF',
  },

  // ── Mode toggle ─────────────────────────────────────────────────────
  modeToggleBar: {
    flexDirection: 'row' as const,
    margin: 16,
    marginBottom: 0,
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.lg,
    padding: 3,
    gap: 3,
  },
  modeToggleBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 9,
    borderRadius: Tokens.radius.card,
  },
  modeToggleBtnActive: {
    backgroundColor: Colors.primary,
  },
  modeToggleText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  modeToggleTextActive: {
    color: '#FFF',
  },

  // ── Project Roadmap ─────────────────────────────────────────────────
  flagsBanner: {
    flexDirection: 'row' as const,
    gap: 10,
    backgroundColor: Colors.errorLight,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.error + '44',
    padding: 12,
    marginBottom: 12,
    alignItems: 'flex-start' as const,
  },
  flagText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.warning,
    lineHeight: 18,
  },
  flagTextHigh: {
    color: Colors.error,
    fontWeight: '600' as const,
  },
  regenBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    borderRadius: Tokens.radius.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.primary + '0A',
  },
  regenBtnHighlighted: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  regenBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  regenBtnTextHighlighted: {
    color: '#FFF',
  },
  roadmapSectionTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginTop: 12,
    marginBottom: 8,
  },
  roadmapEmptyNote: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textMuted,
    fontStyle: 'italic' as const,
    marginBottom: 8,
  },
  inspectionGenerateCta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: themeColors.accentSoft,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  inspectionGenerateText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  inspectionScheduledCta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: themeColors.successSoft,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.success,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  inspectionScheduledText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: themeColors.successLabel,
  },
  missingCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    padding: 14,
    gap: 6,
    marginTop: 12,
  },
  missingTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  missingSubtitle: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textMuted,
  },
  missingItem: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.text,
    lineHeight: 19,
  },
  roadmapRow: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    padding: 12,
    marginBottom: 8,
    gap: 6,
  },
  roadmapRowHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  roadmapRowTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    marginBottom: 2,
  },
  roadmapRowMeta: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
  },
  roadmapRowDesc: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 18,
  },
  statusChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const,
  },
  inspResultActions: {
    flexDirection: 'row' as const,
    gap: 8,
    marginTop: 10,
  },
  inspPassBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: INSP_STATUS_COLORS.passed + '55',
    backgroundColor: INSP_STATUS_COLORS.passed + '15',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inspFailBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: INSP_STATUS_COLORS.failed + '55',
    backgroundColor: INSP_STATUS_COLORS.failed + '15',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inspResultBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
  },
  addToPermitsBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    alignSelf: 'flex-start' as const,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '12',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  addToPermitsBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  linkedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    alignSelf: 'flex-start' as const,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.successLight,
  },
  linkedBadgeText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.successDark,
    fontWeight: '600' as const,
  },
  linkedBadgeLink: {
    fontSize: Type.caption1.fontSize,
    color: Colors.primary,
    fontWeight: '700' as const,
    marginLeft: 2,
  },

  // ── Plan Review ─────────────────────────────────────────────────────
  planDisclaimer: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    backgroundColor: '#FF950022',
    borderWidth: 1,
    borderColor: '#FF9500',
    borderRadius: Tokens.radius.card,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  planDisclaimerText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 17,
  },
  findingsWrap: {
    marginTop: 16,
    gap: 16,
  },
  severityGroup: {
    gap: 8,
  },
  severityHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  severityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  severityHeaderText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  findingCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    padding: 12,
    gap: 6,
  },
  findingCardMuted: {
    opacity: 0.55,
  },
  findingTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  findingCodeRef: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  findingConfidence: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  findingRequirement: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.text,
    lineHeight: 18,
  },
  findingObserved: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 18,
  },
  findingStatusBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    alignSelf: 'flex-start' as const,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '12',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginTop: 2,
  },
  findingStatusText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },

  // Bid Advisor shortcut card
  bidAdvisorCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: themeColors.line,
    padding: 14,
    marginBottom: 20,
  },
  bidAdvisorIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  bidAdvisorBody: { flex: 1 },
  bidAdvisorTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 3,
  },
  bidAdvisorTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  bidAdvisorTierChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary + '1A',
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  bidAdvisorTierText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  bidAdvisorSubtitle: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 17,
  },
});
