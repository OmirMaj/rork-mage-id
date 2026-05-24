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
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Animated, Easing,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gavel, MapPin, Hammer, AlertTriangle, CheckCircle, Sparkles,
  ClipboardCheck, BookOpen, X, ChevronDown, ChevronUp, Zap,
  Home, Building2, Droplets, HardHat, Accessibility, Map,
  RefreshCw, PlusCircle, Flag, ChevronRight, FileText,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';
import { Colors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';
import { useTierAccess, FEATURE_LIMITS } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import { generateRoadmap, bookByDate, roadmapFlags, scopeHashOf } from '@/utils/permitRoadmap';
import type { RoadmapPermit, RoadmapInspection, PermitType } from '@/types';

// Each category gets a distinct, semantically-correct icon. Audit found
// 7 of 8 were `Hammer` — the AI was lying with its iconography. Now
// every category telegraphs its scope at a glance.
const CATEGORIES = [
  { key: 'residential', label: 'Residential', icon: Home },
  { key: 'commercial', label: 'Commercial', icon: Building2 },
  { key: 'electrical', label: 'Electrical', icon: Zap },
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
  const { canAccess } = useTierAccess();
  const [showPaywall, setShowPaywall] = useState(false);
  const insets = useSafeAreaInsets();

  if (!canAccess('ai_code_check')) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingHorizontal: 24 }]}>
        <View style={styles.lockedHero}>
          <View style={styles.lockedIconWrap}>
            <Gavel size={36} color={Colors.primary} />
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
            <Sparkles size={18} color="#FFF" />
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
  const insets = useSafeAreaInsets();
  const { tier } = useTierAccess();
  const { user } = useAuth();

  // ── Mode toggle ─────────────────────────────────────────────────────
  const [mode, setMode] = useState<'code' | 'roadmap'>('code');

  // ── Code-Check state ─────────────────────────────────────────────────
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
    getPermitRoadmapForProject,
    savePermitRoadmap,
    updatePermitRoadmap,
    addPermit,
  } = useProjects();

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

  const runGenerateRoadmap = useCallback(async (isRegen: boolean) => {
    if (!roadmapProject) return;
    const used = await getRoadmapTodayUsage(user?.id);
    if (used >= roadmapDailyCap) {
      setRoadmapOverLimit(true);
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRoadmapLoading(true);
    const res = await generateRoadmap(roadmapProject);
    setRoadmapLoading(false);
    if (!res.ok) {
      Alert.alert('Roadmap failed', res.error);
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
    void bumpRoadmapTodayUsage(user?.id);
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
      notes: p.description,
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
    const prompt = `You are a licensed code-compliance advisor for US construction. A contractor is working on the following project and needs a building-code sanity check.

Location: ${location.trim()}
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

    const cacheKey = `code_check::${location.trim().toLowerCase()}::${category}::${scenario.trim().toLowerCase().slice(0, 120)}`;

    try {
      const res = await mageAISmart(prompt, codeCheckSchema, cacheKey);
      if (!res.success || !res.data) {
        setLoading(false);
        Alert.alert('Code check failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
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
      Alert.alert('Code check failed', err instanceof Error ? err.message : 'Unknown error.');
    }
  }, [canSubmit, category, dailyCap, location, scenario, user?.id]);

  const presets = PRESET_QUESTIONS[category];

  if (overLimit) {
    return (
      <Paywall
        visible={true}
        feature={`Code Check Daily Limit (${dailyCap}/day on ${tier})`}
        requiredTier={tier === 'free' ? 'pro' : 'business'}
        onClose={() => setOverLimit(false)}
      />
    );
  }

  if (roadmapOverLimit) {
    return (
      <Paywall
        visible={true}
        feature={`Roadmap Daily Limit (${roadmapDailyCap}/day on ${tier})`}
        requiredTier={tier === 'free' ? 'pro' : 'business'}
        onClose={() => setRoadmapOverLimit(false)}
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
            <Gavel size={14} color={mode === 'code' ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.modeToggleText, mode === 'code' && styles.modeToggleTextActive]}>Code Check</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeToggleBtn, mode === 'roadmap' && styles.modeToggleBtnActive]}
            onPress={() => setMode('roadmap')}
            activeOpacity={0.8}
            testID="mode-toggle-roadmap"
          >
            <Map size={14} color={mode === 'roadmap' ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.modeToggleText, mode === 'roadmap' && styles.modeToggleTextActive]}>Project Roadmap</Text>
          </TouchableOpacity>
        </View>

        {mode === 'code' ? (
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 80 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <Gavel size={28} color={Colors.primary} />
              </View>
              <Text style={styles.heroTitle}>Construction AI</Text>
              <Text style={styles.heroSubtitle}>
                Describe your project and Construction AI flags the likely codes, permits and common violations to watch for.
              </Text>
            </View>

            <Text style={styles.label}>Location (city, state)</Text>
            <View style={styles.inputRow}>
              <MapPin size={16} color={Colors.textMuted} />
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
              <Zap size={14} color={Colors.primary} />
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
              <Sparkles size={18} color="#FFF" />
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
                <BookOpen size={16} color={Colors.primary} />
                <Text style={styles.reopenText}>View last result</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : (
          /* ── Project Roadmap mode ── */
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 80 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <FileText size={28} color={Colors.primary} />
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
                  <Sparkles size={18} color="#FFF" />
                  <Text style={styles.runBtnText}>Generate Roadmap</Text>
                </TouchableOpacity>
                <Text style={styles.quotaText}>
                  {roadmapDailyCap === Infinity ? 'Unlimited roadmaps today' : `Daily limit: ${roadmapDailyCap} generations`}
                </Text>
              </>
            ) : null}

            {roadmap && roadmapProject ? (
              <>
                {/* Flags banner */}
                {flags.length > 0 ? (
                  <View style={styles.flagsBanner}>
                    <Flag size={14} color={Colors.error} />
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
                  <RefreshCw size={16} color={scopeStale ? '#FFF' : Colors.primary} />
                  <Text style={[styles.regenBtnText, scopeStale && styles.regenBtnTextHighlighted]}>
                    {scopeStale ? 'Regenerate (scope changed)' : 'Regenerate'}
                  </Text>
                </TouchableOpacity>

                {/* Permits section */}
                <Text style={styles.roadmapSectionTitle}>Permits</Text>
                {roadmap.permits.map((p) => (
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
                  />
                ))}

                {/* Inspections section */}
                <Text style={styles.roadmapSectionTitle}>Inspections</Text>
                {roadmap.inspections.map((insp) => {
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
                      onCycleStatus={() => {
                        const next: RoadmapInspection['status'][] = ['pending', 'scheduled', 'passed'];
                        const idx = next.indexOf(insp.status);
                        const nextStatus = next[(idx + 1) % next.length];
                        updatePermitRoadmap(roadmap.id, {
                          inspections: roadmap.inspections.map((x) => x.id === insp.id ? { ...x, status: nextStatus } : x),
                        });
                      }}
                    />
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <LoadingModal visible={loading} />
      <RoadmapLoadingModal visible={roadmapLoading} />
      <ResultModal
        visible={resultOpen && !!result}
        result={result}
        onClose={() => setResultOpen(false)}
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
}: {
  permit: RoadmapPermit;
  onCycleStatus: () => void;
  onAddToPermits: () => void;
}) {
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
          <ChevronRight size={10} color={PERMIT_STATUS_COLORS[permit.status]} />
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
          <PlusCircle size={13} color={Colors.primary} />
          <Text style={styles.addToPermitsBtnText}>Add to Permits</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.linkedBadge}>
          <CheckCircle size={12} color={Colors.success} />
          <Text style={styles.linkedBadgeText}>Added to Permits</Text>
        </View>
      )}
    </View>
  );
}

const INSP_STATUS_COLORS: Record<RoadmapInspection['status'], string> = {
  pending: Colors.textMuted,
  scheduled: Colors.warning,
  passed: Colors.success,
};

function RoadmapInspectionRow({
  inspection,
  gatingLabel,
  bookBy,
  onCycleStatus,
}: {
  inspection: RoadmapInspection;
  gatingLabel: string;
  bookBy: Date | null;
  onCycleStatus: () => void;
}) {
  const bookByStr = bookBy
    ? bookBy.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';
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
          <ChevronRight size={10} color={INSP_STATUS_COLORS[inspection.status]} />
        </TouchableOpacity>
      </View>
      {inspection.description ? (
        <Text style={styles.roadmapRowDesc} numberOfLines={2}>{inspection.description}</Text>
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

function RoadmapLoadingModal({ visible }: { visible: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!visible) { setStepIdx(0); return; }
    const spinLoop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    spinLoop.start();
    pulseLoop.start();
    const interval = setInterval(() => setStepIdx((i) => (i + 1) % ROADMAP_LOADING_STEPS.length), 1500);
    return () => { spinLoop.stop(); pulseLoop.stop(); clearInterval(interval); spin.setValue(0); pulse.setValue(0); };
  }, [visible, spin, pulse]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.loadingBackdrop}>
        <View style={styles.loadingCard}>
          <View style={styles.loadingIconStack}>
            <Animated.View style={[styles.loadingPulse, { transform: [{ scale }], opacity }]} />
            <Animated.View style={{ transform: [{ rotate }] }}>
              <FileText size={44} color={Colors.primary} />
            </Animated.View>
          </View>
          <Text style={styles.loadingTitle}>Generating Roadmap</Text>
          <Text style={styles.loadingStep}>{ROADMAP_LOADING_STEPS[stepIdx]}</Text>
          <View style={styles.loadingDots}>
            {ROADMAP_LOADING_STEPS.map((_, i) => (
              <View key={i} style={[styles.loadingDot, i <= stepIdx && styles.loadingDotActive]} />
            ))}
          </View>
        </View>
      </View>
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

function LoadingModal({ visible }: { visible: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!visible) {
      setStepIdx(0);
      return;
    }
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    spinLoop.start();
    pulseLoop.start();
    const interval = setInterval(() => {
      setStepIdx((i) => (i + 1) % LOADING_STEPS.length);
    }, 1500);
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
      clearInterval(interval);
      spin.setValue(0);
      pulse.setValue(0);
    };
  }, [visible, spin, pulse]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.loadingBackdrop}>
        <View style={styles.loadingCard}>
          <View style={styles.loadingIconStack}>
            <Animated.View
              style={[
                styles.loadingPulse,
                { transform: [{ scale }], opacity },
              ]}
            />
            <Animated.View style={{ transform: [{ rotate }] }}>
              <Gavel size={44} color={Colors.primary} />
            </Animated.View>
          </View>
          <Text style={styles.loadingTitle}>Running Code Check</Text>
          <Text style={styles.loadingStep}>{LOADING_STEPS[stepIdx]}</Text>
          <View style={styles.loadingDots}>
            {LOADING_STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.loadingDot,
                  i <= stepIdx && styles.loadingDotActive,
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Result modal ───────────────────────────────────────────────────────
// Summary is always expanded. The other four sections collapse into
// chevrons so the result fits in one screen for a typical response.

type SectionKey = 'codes' | 'permits' | 'inspections' | 'violations';

function ResultModal({
  visible, result, onClose,
}: { visible: boolean; result: CodeCheckResult | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<SectionKey | null>('codes');

  if (!result) return null;

  const toggle = (k: SectionKey) => setExpanded((cur) => cur === k ? null : k);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.resultContainer, { paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8 }]}>
        <View style={styles.resultHeader}>
          <View style={styles.resultHeaderIcon}>
            <Gavel size={20} color={Colors.primary} />
          </View>
          <Text style={styles.resultHeaderTitle}>Code Check Result</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.resultCloseBtn}
            testID="code-check-close"
            activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.text} /></TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {result.summary ? (
            <View style={[styles.resultCard, styles.resultSummaryCard]}>
              <View style={styles.resultCardHeader}>
                <BookOpen size={16} color={Colors.primary} />
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
              {result.applicableCodes.map((c, i) => (
                <View key={i} style={styles.codeRow}>
                  <Text style={styles.codeLabel}>{[c.code, c.section].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.codeReq}>{c.requirement}</Text>
                </View>
              ))}
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
          ? <ChevronUp size={16} color={Colors.textMuted} />
          : <ChevronDown size={16} color={Colors.textMuted} />
        }
      </TouchableOpacity>
      {expanded ? <View style={styles.accordionBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: 'center' as const, marginBottom: 20, gap: 6 },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 6,
  },
  heroTitle: { fontSize: 24, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: {
    fontSize: Type.bodyCompact.fontSize, color: Colors.textMuted, textAlign: 'center' as const,
    paddingHorizontal: 20, lineHeight: 20,
  },
  label: {
    fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: Colors.textMuted,
    marginTop: 16, marginBottom: 8, letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.card, borderWidth: 1,
    borderColor: Colors.cardBorder, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: Type.subhead.fontSize, color: Colors.text, padding: 0 },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.text },
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
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  presetPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  presetPillText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.text,
    lineHeight: 18,
  },
  presetPillTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  textArea: {
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.card, borderWidth: 1,
    borderColor: Colors.cardBorder, padding: 12, minHeight: 100,
    fontSize: Type.subhead.fontSize, color: Colors.text,
  },
  runBtn: {
    marginTop: 20, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 8,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.lg, paddingVertical: 14,
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
  quotaText: {
    fontSize: Type.caption1.fontSize, color: Colors.textMuted, textAlign: 'center' as const,
    marginTop: 8,
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
  loadingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 24,
  },
  loadingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center' as const,
    minWidth: 260,
    gap: 12,
  },
  loadingIconStack: {
    width: 96,
    height: 96,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  loadingPulse: {
    position: 'absolute' as const,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.primary + '22',
  },
  loadingTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 8,
  },
  loadingStep: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    minHeight: 20,
  },
  loadingDots: {
    flexDirection: 'row' as const,
    gap: 6,
    marginTop: 4,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.cardBorder,
  },
  loadingDotActive: {
    backgroundColor: Colors.primary,
  },

  // Result modal
  resultContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  resultHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
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
    color: Colors.text,
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
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg, borderWidth: 1,
    borderColor: Colors.cardBorder, padding: 14,
  },
  resultSummaryCard: {
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.primary + '08',
  },
  resultCardHeader: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    gap: 8, marginBottom: 10,
  },
  resultCardTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  resultBody: { fontSize: Type.bodyCompact.fontSize, color: Colors.text, lineHeight: 20 },
  codeRow: { marginBottom: 10 },
  codeLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.primary, marginBottom: 2 },
  codeReq: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 19 },
  bulletRow: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 20, marginBottom: 4 },
  disclaimer: {
    fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontStyle: 'italic' as const,
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
    color: Colors.textSecondary,
  },
  accordionBody: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
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
    fontSize: 26, fontWeight: '700' as const, color: Colors.text,
    textAlign: 'center' as const,
  },
  lockedBody: {
    fontSize: Type.subhead.fontSize, color: Colors.textMuted,
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
    color: Colors.textSecondary,
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
    color: Colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginTop: 12,
    marginBottom: 8,
  },
  roadmapRow: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    color: Colors.text,
    marginBottom: 2,
  },
  roadmapRowMeta: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
  },
  roadmapRowDesc: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
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
});
