// app/takeoff-estimate.tsx — AI-priced estimate from takeoff quantities.
//
// User flow this fills:
//   1. Run AI Takeoff → quantity rollups (LF walls, SF floor, EA doors, …).
//   2. Tap "Generate Priced Estimate" on the takeoff screen.
//   3. Land here. The screen reads the saved takeoff, asks the AI to map
//      every quantity to a priced line item (description, unit cost, total),
//      shows them in an editable table, and saves the result as the
//      project's linkedEstimate.
//
// Why a separate screen (not the Quick Estimate Wizard):
//   - Wizard is a 8-question flow that builds an estimate from scratch
//     based on rough scope — designed for projects with no plans yet.
//   - Takeoff is the opposite path: we already have actual quantities
//     from real drawings, so the wizard's questions are noise. The
//     correct flow is "price these specific quantities", not "answer
//     8 generic questions".
//   - Pre-fix the takeoff screen routed users to the wizard with a
//     `fromTakeoff: '1'` param that nothing on the wizard side actually
//     consumed. So the takeoff data was lost on transition; the user
//     landed on a blank wizard with no idea where their numbers went.
//
// The AI call is centralized through mageAI (same edge function as every
// other AI feature in the app — auth-gated, monthly-capped, JSON-schema-
// constrained). On a typical residential takeoff (~30-80 quantity rows)
// it returns ~20-40 line items in 8-15 seconds.
//
// Editing: the user can tweak description, qty, unit price, and markup
// per line. The grand total updates live. Delete a row to skip it from
// the saved estimate. Add a row to fill in something the AI missed.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Save, Plus, Trash2, AlertTriangle,
  RefreshCw, Pencil, Check, Calculator,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';

import {
  getLivePrices, getRegionMultiplier, getMaterialCostBreakdown,
  type MaterialItem,
} from '@/constants/materials';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useProjects } from '@/contexts/ProjectContext';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { loadTakeoff, type PersistedTakeoff } from '@/utils/takeoffStorage';
import { mageAI } from '@/utils/mageAI';
import { formatMoney } from '@/utils/formatters';
import { generateUUID } from '@/utils/generateId';
import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import { showAlert } from '@/utils/alert';

interface PricedLine {
  id: string;
  csiDivision: string;        // e.g. "06 - Wood, Plastics & Composites"
  description: string;
  quantity: number;
  unit: string;               // EA, LF, SF, CY, …
  unitPrice: number;          // ACTIVE unit price — what the totals use
  notes?: string;
  /** The AI/LLM's original guessed unit price. Kept so the estimator can
   *  always fall back to it and audit against the engine number. */
  aiUnitPrice: number;
  /** Deterministic engine rate from constants/materials.ts, present only when
   *  the line maps cleanly to a materials category + unit. */
  engineRate?: EngineRate;
  /** Which number is currently driving unitPrice. */
  priceSource: 'ai' | 'engine' | 'manual';
}

// ─── Deterministic engine pricing ────────────────────────────────────────
// The AI returns an LLM-guessed unitPrice per line. Where a line maps cleanly
// to a materials category + unit, we ALSO compute a deterministic, reproducible
// installed rate from constants/materials.ts (regional-adjusted, material +
// labor + equipment + category waste). Both numbers are surfaced; the engine
// one is preferred because it's auditable — but the AI number is never silently
// discarded, and the estimator can switch back with one tap.

type EngineUnit = 'SF' | 'LF' | 'EA' | 'CY';

const ENGINE_PRICE_SEED = 100; // fixed → engine prices are reproducible run-to-run

interface EngineRate {
  rate: number;        // installed $/unit incl. waste
  material: number;
  labor: number;
  equipment: number;
  waste: number;       // fraction, e.g. 0.05
  category: string;
  skuCount: number;
}

function normEngineUnit(u: string): EngineUnit | null {
  const s = u.toLowerCase().trim();
  if (s === 'sf' || s === 'sqft' || s === 'sq ft') return 'SF';
  if (s === 'lf' || s === 'lin ft' || s === 'linft') return 'LF';
  if (s === 'ea' || s === 'each') return 'EA';
  if (s === 'cy' || s === 'cu yd' || s === 'cuyd') return 'CY';
  return null;
}

// Only exact-unit SKUs are used so we never guess a square→sqft or sheet→sqft
// conversion — an unconverted lookup is worse than no lookup.
const ENGINE_UNIT_ALIASES: Record<EngineUnit, string[]> = {
  SF: ['sq ft'],
  LF: ['lin ft'],
  EA: ['each'],
  CY: ['cu yd'],
};

/** Map a CSI division + description to a materials-engine category, or null. */
function mapLineToCategory(division: string, description: string): string | null {
  const num = (division.trim().match(/^\d{2}/) ?? [''])[0];
  const desc = description.toLowerCase();
  switch (num) {
    case '03': return 'concrete';
    case '04': return 'concrete';
    case '05': return 'steel';
    case '06': return 'lumber';
    case '07':
      if (/insulat/.test(desc)) return 'insulation';
      if (/roof|shingle|membrane|flash/.test(desc)) return 'roofing';
      if (/sid|stucco|wrap|veneer|brick|stone/.test(desc)) return 'siding';
      return null;
    case '08': return 'windows';
    case '09':
      if (/drywall|gypsum|gwb|\bboard\b/.test(desc)) return 'drywall';
      if (/paint|primer|coat/.test(desc)) return 'paint';
      if (/floor|tile|carpet|vinyl|hardwood|laminate|lvp|lvt|bamboo|cork/.test(desc)) return 'flooring';
      return null;
    case '22': return 'plumbing';
    case '23': return 'hvac';
    case '26': return 'electrical';
    case '32': return 'landscape';
    default: return null;
  }
}

/** Representative installed rate for a category+unit from the priced catalog. */
function buildEngineRate(priced: MaterialItem[], category: string, unit: EngineUnit): EngineRate | null {
  const aliases = ENGINE_UNIT_ALIASES[unit];
  const skus = priced.filter(m =>
    m.specTier === 'base' &&
    m.category === category &&
    aliases.includes(m.unit.toLowerCase().trim()),
  );
  if (skus.length === 0) return null;
  const rows = skus.map(m => {
    const b = getMaterialCostBreakdown(m);
    return {
      installed: b.materialCost + b.laborCost + b.equipmentCost,
      material: b.materialCost, labor: b.laborCost, equipment: b.equipmentCost,
      waste: m.wasteFactor ?? 0.05,
    };
  }).sort((a, z) => a.installed - z.installed);
  const mid = rows[Math.floor(rows.length / 2)]; // median SKU is the representative
  return {
    rate: Number((mid.installed * (1 + mid.waste)).toFixed(2)),
    material: mid.material,
    labor: mid.labor,
    equipment: mid.equipment,
    waste: mid.waste,
    category,
    skuCount: skus.length,
  };
}

/** A per-location engine pricer with a small (category:unit) cache. */
function makeEngineRater(location: string): (division: string, unit: string, description: string) => EngineRate | null {
  const priced = getLivePrices(ENGINE_PRICE_SEED, getRegionMultiplier(location));
  const cache = new Map<string, EngineRate | null>();
  return (division, unitRaw, description) => {
    const unit = normEngineUnit(unitRaw);
    if (!unit) return null;
    const category = mapLineToCategory(division, description);
    if (!category) return null;
    const key = `${category}:${unit}`;
    if (!cache.has(key)) cache.set(key, buildEngineRate(priced, category, unit));
    return cache.get(key) ?? null;
  };
}

const SCHEMA_HINT = {
  lines: [
    {
      csiDivision: '06 - Wood, Plastics & Composites',
      description: '2x4 wall framing, 8ft height, plate to plate',
      quantity: 240,
      unit: 'LF',
      unitPrice: 7.5,
      notes: 'Includes plates, studs, bracing; doesn\'t include sheathing',
    },
  ],
};

export default function TakeoffEstimateScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();
  // Same gate as the takeoff screen itself — Pro+ only. Without this someone
  // could deep-link straight here and bypass the takeoff paywall.
  if (!canAccess('ai_estimate_wizard')) {
    return (
      <Paywall
        visible={true}
        feature="AI Priced Estimate from Takeoff"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <TakeoffEstimateInner />;
}

function TakeoffEstimateInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, updateProject, settings } = useProjects();

  const project = useMemo(() =>
    projectId ? projects.find(p => p.id === projectId) ?? null : null,
    [projects, projectId]);

  const [takeoff, setTakeoff] = useState<PersistedTakeoff | null>(null);
  const [loadingTakeoff, setLoadingTakeoff] = useState(true);

  const [pricing, setPricing] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [lines, setLines] = useState<PricedLine[]>([]);

  const [globalMarkup, setGlobalMarkup] = useState(15); // % default
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the saved takeoff for this project (or standalone) on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await loadTakeoff(projectId || undefined);
      if (!cancelled) {
        setTakeoff(t);
        setLoadingTakeoff(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Once the takeoff loads, kick off the AI pricing call.
  useEffect(() => {
    if (!takeoff || pricing || lines.length > 0) return;
    void runPricing(takeoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeoff]);

  const runPricing = useCallback(async (t: PersistedTakeoff) => {
    setPricing(true);
    setPricingError(null);
    try {
      // Strip the takeoff to the quantities the AI needs. We deliberately
      // omit confidence + sourcePages so the model focuses on numbers, not
      // metadata. We DO send rejected/overrides so the user's manual fixes
      // make it into the prompt.
      const overrides = t.overrides ?? {};
      const rejected = t.rejected ?? {};
      const apply = (section: string, id: string, fallback: number) => {
        if (rejected[`${section}:${id}`]) return null;  // skip rejected rows
        const o = overrides[`${section}:${id}`];
        return typeof o === 'number' ? o : fallback;
      };

      // settings.location is a free-form string set in app settings
      // (e.g. "Austin, TX"). We pass it through as a regional pricing
      // hint; AI is fine with whatever the user typed.
      const locationHint = typeof settings?.location === 'string' ? settings.location : '';
      const prompt = buildPricingPrompt(t, apply, locationHint);

      const r = await mageAI({
        prompt,
        schemaHint: SCHEMA_HINT,
        tier: 'smart',
        maxTokens: 16000,
        feature: 'aiEstimateWizard',
      });

      if (!r.success) {
        const msg = r.error ?? 'AI pricing failed.';
        setPricingError(msg);
        return;
      }

      const out = (r.data as { lines?: Partial<PricedLine>[] })?.lines ?? [];
      // Deterministic engine pricer, built once for this location.
      const rater = makeEngineRater(locationHint);
      const cleaned: PricedLine[] = out
        .filter(l => l && typeof l.description === 'string' && l.description.trim().length > 0)
        .map(l => {
          const csiDivision = typeof l.csiDivision === 'string' ? l.csiDivision : '01 - General';
          const description = l.description!.trim();
          const unit = typeof l.unit === 'string' ? l.unit : 'EA';
          const aiUnitPrice = typeof l.unitPrice === 'number' && l.unitPrice >= 0 ? l.unitPrice : 0;
          const engineRate = rater(csiDivision, unit, description) ?? undefined;
          return {
            id: generateUUID(),
            csiDivision,
            description,
            quantity: typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : 1,
            unit,
            // Prefer/surface the engine price when the line is matchable — it's
            // auditable — but keep the AI number one tap away.
            unitPrice: engineRate ? engineRate.rate : aiUnitPrice,
            notes: typeof l.notes === 'string' ? l.notes : undefined,
            aiUnitPrice,
            engineRate,
            priceSource: engineRate ? ('engine' as const) : ('ai' as const),
          };
        });

      if (cleaned.length === 0) {
        setPricingError('AI returned no priced lines. Tap regenerate to try again.');
      }
      setLines(cleaned);
    } catch (e) {
      setPricingError(e instanceof Error ? e.message : String(e));
    } finally {
      setPricing(false);
    }
  }, [settings?.location]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const markup = subtotal * (globalMarkup / 100);
    return {
      subtotal,
      markup,
      grandTotal: subtotal + markup,
    };
  }, [lines, globalMarkup]);

  // Group lines by CSI division so the GC can scan by trade.
  const grouped = useMemo(() => {
    const m = new Map<string, PricedLine[]>();
    for (const l of lines) {
      const k = l.csiDivision || '01 - General';
      const arr = m.get(k) ?? [];
      arr.push(l);
      m.set(k, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [lines]);

  const updateLine = useCallback((id: string, patch: Partial<PricedLine>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  // Snap a line's active unit price to either its engine or AI source.
  const setLineSource = useCallback((id: string, source: 'ai' | 'engine') => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const price = source === 'engine' ? (l.engineRate?.rate ?? l.unitPrice) : l.aiUnitPrice;
      return { ...l, unitPrice: price, priceSource: source };
    }));
  }, []);

  const addLine = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newLine: PricedLine = {
      id: generateUUID(),
      csiDivision: '01 - General',
      description: 'New line item',
      quantity: 1,
      unit: 'EA',
      unitPrice: 0,
      aiUnitPrice: 0,
      priceSource: 'manual',
    };
    setLines(prev => [...prev, newLine]);
    setEditingLineId(newLine.id);
  }, []);

  const handleRegenerate = useCallback(() => {
    if (!takeoff) return;
    showAlert(
      'Regenerate priced estimate?',
      'This will replace your current line items with a fresh AI-generated set. Any edits will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: () => {
            setLines([]);
            setPricingError(null);
            void runPricing(takeoff);
          },
        },
      ],
    );
  }, [takeoff, runPricing]);

  // Build the per-line estimate items at a given markup %. Shared by the
  // Replace path (uses the screen's globalMarkup) and the Append path (uses
  // the existing estimate's effective markup ratio so permits / contingency
  // baked into that estimate are preserved).
  const buildItems = useCallback((markupPct: number): LinkedEstimateItem[] =>
    lines.map(l => ({
      materialId: l.id,
      name: l.description,
      category: l.csiDivision,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      bulkPrice: l.unitPrice,
      markup: markupPct,
      usesBulk: false,
      lineTotal: l.quantity * l.unitPrice * (1 + markupPct / 100),
      supplier: 'AI Takeoff',
      csiDivision: l.csiDivision.split(' ')[0],
    })),
  [lines]);

  // Replace: wholesale-swap the project estimate with the takeoff lines.
  // commitEstimatePatch snapshots the outgoing estimate as a revision, so
  // it's recoverable from history — but the user is warned first (below).
  const doReplace = useCallback(() => {
    if (!project) return;
    setSaving(true);
    try {
      const items = buildItems(globalMarkup);
      const linkedEstimate: LinkedEstimate = {
        id: generateUUID(),
        items,
        globalMarkup,
        baseTotal: totals.subtotal,
        markupTotal: totals.markup,
        grandTotal: totals.grandTotal,
        createdAt: new Date().toISOString(),
      };
      updateProject(project.id, commitEstimatePatch(project, linkedEstimate, { reason: 'pre_overwrite' }));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Estimate saved',
        `${lines.length} priced lines saved to ${project.name}. Grand total: ${formatMoney(totals.grandTotal)}.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      showAlert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [project, buildItems, globalMarkup, totals, updateProject, router, lines.length]);

  // Append: add the takeoff lines onto the existing estimate, preserving its
  // items and applying its effective markup ratio to the new base (matches
  // the append semantics in area-takeoff.tsx). Nothing prior is discarded.
  const doAppend = useCallback(() => {
    if (!project?.linkedEstimate) return;
    setSaving(true);
    try {
      const est = project.linkedEstimate;
      // Reuse the estimate's effective markup ratio so permits/contingency
      // and current markup carry over instead of being recomputed.
      const ratio = est.baseTotal > 0 ? est.markupTotal / est.baseTotal : (globalMarkup / 100);
      const markupPct = ratio * 100;
      const newItems = buildItems(markupPct);
      const addedBase = totals.subtotal;
      const addedMarkup = addedBase * ratio;
      const next: LinkedEstimate = {
        ...est,
        items: [...est.items, ...newItems],
        baseTotal: est.baseTotal + addedBase,
        markupTotal: est.markupTotal + addedMarkup,
        grandTotal: est.grandTotal + addedBase + addedMarkup,
      };
      updateProject(project.id, commitEstimatePatch(project, next, { reason: 'manual', note: 'Appended from AI takeoff' }));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Lines appended',
        `${lines.length} priced lines added to ${project.name}. New grand total: ${formatMoney(next.grandTotal)}.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      showAlert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [project, buildItems, totals.subtotal, globalMarkup, updateProject, router, lines.length]);

  const handleSave = useCallback(() => {
    if (!project) {
      showAlert('No project linked', 'Run the takeoff against a project first to save the estimate.');
      return;
    }
    if (lines.length === 0) {
      showAlert('Nothing to save', 'Add at least one line before saving.');
      return;
    }
    // If the project already has a real estimate, never silently overwrite it.
    // Offer Replace vs Append (append preserves the prior lines + markup),
    // matching the semantics area-takeoff and cost-xray already use.
    const existing = project.linkedEstimate;
    if (existing && existing.items.length > 0) {
      showAlert(
        'This project already has an estimate',
        `${project.name} has a ${formatMoney(existing.grandTotal ?? 0)} estimate (${existing.items.length} line${existing.items.length === 1 ? '' : 's'}). Replace it, or append these ${lines.length} takeoff line${lines.length === 1 ? '' : 's'} to it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Append these lines', onPress: doAppend },
          { text: 'Replace', style: 'destructive', onPress: doReplace },
        ],
      );
      return;
    }
    doReplace();
  }, [project, lines.length, doReplace, doAppend]);

  // ── Render ────────────────────────────────────────────────────────────

  if (loadingTakeoff) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={themeColors.accent} />
          <Text style={styles.statusText}>Loading takeoff…</Text>
        </View>
      </View>
    );
  }

  if (!takeoff) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
            <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Priced Estimate</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.center}>
          <AlertTriangle size={36} color={Colors.warning} strokeWidth={1.75} />
          <Text style={styles.emptyTitle}>No takeoff to price</Text>
          <Text style={styles.emptyBody}>
            Run an AI Takeoff first — upload your plan PDFs and let the AI count walls, doors, and finishes. Then come back here and we&apos;ll turn those quantities into a priced estimate.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace({ pathname: '/takeoff', params: projectId ? { projectId } : {} } as never)}
          >
            <MageAIMark size={16} color={themeColors.surface} />
            <Text style={styles.primaryBtnText}>Run AI Takeoff</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>FROM TAKEOFF</Text>
          <Text style={styles.headerTitle}>{project?.name ?? 'Standalone Estimate'}</Text>
        </View>
        {!pricing && lines.length > 0 ? (
          <TouchableOpacity onPress={handleRegenerate} style={styles.headerBack}>
            <RefreshCw size={18} color={themeColors.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 220 }}>
        {/* Pricing in flight */}
        {pricing && (
          <View style={[styles.banner, { backgroundColor: themeColors.accent + '12' }]}>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text style={[styles.bannerText, { color: themeColors.accent }]}>
              AI is pricing {countQuantities(takeoff)} takeoff items. Hold tight — this takes 10–20 seconds.
            </Text>
          </View>
        )}

        {/* Pricing failed */}
        {pricingError && !pricing && (
          <View style={[styles.banner, { backgroundColor: Colors.errorLight }]}>
            <AlertTriangle size={16} color={Colors.errorDark} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerText, { color: Colors.errorDark }]}>{pricingError}</Text>
              <TouchableOpacity onPress={() => takeoff && void runPricing(takeoff)} style={{ marginTop: 6 }}>
                <Text style={[styles.bannerLink, { color: Colors.errorDark }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Source summary */}
        {!pricing && lines.length > 0 && (
          <View style={styles.sourceCard}>
            <MageAIMark size={14} color={themeColors.accent} />
            <Text style={styles.sourceText}>
              Auto-generated from {countQuantities(takeoff)} takeoff items. Lines that map to the pricing engine show a deterministic <Text style={styles.sourceTextStrong}>Engine</Text> rate (regional, auditable) next to the <Text style={styles.sourceTextStrong}>AI est.</Text> — tap either to use it. Tap a line to edit; add custom lines for anything missed.
            </Text>
          </View>
        )}

        {/* Grouped line items */}
        {grouped.map(([division, divLines]) => (
          <View key={division} style={styles.divisionSection}>
            <Text style={styles.divisionLabel}>{division}</Text>
            {divLines.map(line => (
              <LineRow
                key={line.id}
                line={line}
                editing={editingLineId === line.id}
                onStartEdit={() => setEditingLineId(line.id)}
                onCommit={(patch) => {
                  updateLine(line.id, patch);
                  setEditingLineId(null);
                }}
                onCancel={() => setEditingLineId(null)}
                onRemove={() => removeLine(line.id)}
                onSetSource={(src) => setLineSource(line.id, src)}
              />
            ))}
          </View>
        ))}

        {/* Add line button */}
        {!pricing && (
          <TouchableOpacity style={styles.addLineBtn} onPress={addLine}>
            <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.addLineText}>Add line item</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Sticky totals + save */}
      {!pricing && lines.length > 0 && (
        <View style={[styles.totalsBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatMoney(totals.subtotal)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.totalsLabel}>Markup</Text>
              <View style={styles.markupPickerRow}>
                {[10, 15, 20, 25].map(m => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setGlobalMarkup(m)}
                    style={[styles.markupPill, globalMarkup === m && styles.markupPillActive]}
                  >
                    <Text style={[styles.markupPillText, globalMarkup === m && styles.markupPillTextActive]}>{m}%</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={styles.totalsValue}>{formatMoney(totals.markup)}</Text>
          </View>
          <View style={[styles.totalsRow, styles.totalsRowGrand]}>
            <Text style={styles.totalsGrandLabel}>Grand Total</Text>
            <Text style={styles.totalsGrandValue}>{formatMoney(totals.grandTotal)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color={themeColors.surface} />
              : <Save size={16} color={themeColors.surface} strokeWidth={1.75} />}
            <Text style={styles.saveBtnText}>
              {saving ? 'Saving…' : project ? `Save to ${project.name}` : 'Save Estimate'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function LineRow({
  line,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  onRemove,
  onSetSource,
}: {
  line: PricedLine;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (patch: Partial<PricedLine>) => void;
  onCancel: () => void;
  onRemove: () => void;
  onSetSource: (source: 'ai' | 'engine') => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [desc, setDesc] = useState(line.description);
  const [qty, setQty] = useState(String(line.quantity));
  const [price, setPrice] = useState(String(line.unitPrice));
  const [unit, setUnit] = useState(line.unit);

  // Reset working state if the line changes externally (e.g. after a regen).
  useEffect(() => {
    setDesc(line.description);
    setQty(String(line.quantity));
    setPrice(String(line.unitPrice));
    setUnit(line.unit);
  }, [line]);

  const lineTotal = (parseFloat(qty) || 0) * (parseFloat(price) || 0);

  if (!editing) {
    return (
      <TouchableOpacity onPress={onStartEdit} style={styles.lineRow} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={styles.lineDesc} numberOfLines={2}>{line.description}</Text>
          <Text style={styles.lineMeta}>
            {line.quantity} {line.unit} × {formatMoney(line.unitPrice)}
            {line.priceSource === 'engine' ? ' · engine' : line.priceSource === 'ai' ? ' · AI est.' : ' · manual'}
            {line.notes ? ` · ${line.notes}` : ''}
          </Text>
          {/* Both prices, side by side, with a clear source label. The engine
              number is deterministic; the AI number is the model's guess. */}
          {line.engineRate && (
            <View style={styles.sourceRow}>
              <TouchableOpacity
                style={[styles.sourcePill, line.priceSource === 'engine' && styles.sourcePillActive]}
                onPress={() => onSetSource('engine')}
                activeOpacity={0.8}
                testID={`price-source-engine-${line.id}`}
              >
                <Calculator size={11} color={line.priceSource === 'engine' ? themeColors.surface : themeColors.accent} strokeWidth={2} />
                <Text style={[styles.sourcePillLabel, line.priceSource === 'engine' && styles.sourcePillLabelActive]}>Engine</Text>
                <Text style={[styles.sourcePillValue, line.priceSource === 'engine' && styles.sourcePillLabelActive]}>{formatMoney(line.engineRate.rate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sourcePill, line.priceSource !== 'engine' && styles.sourcePillActive]}
                onPress={() => onSetSource('ai')}
                activeOpacity={0.8}
                testID={`price-source-ai-${line.id}`}
              >
                <MageAIMark size={11} color={line.priceSource !== 'engine' ? themeColors.surface : themeColors.accent} />
                <Text style={[styles.sourcePillLabel, line.priceSource !== 'engine' && styles.sourcePillLabelActive]}>AI est.</Text>
                <Text style={[styles.sourcePillValue, line.priceSource !== 'engine' && styles.sourcePillLabelActive]}>{formatMoney(line.aiUnitPrice)}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <Text style={styles.lineTotal}>{formatMoney(line.quantity * line.unitPrice)}</Text>
        <Pencil size={14} color={themeColors.textMuted} style={{ marginLeft: 8 }} strokeWidth={1.75} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.lineRowEditing}>
      <TextInput
        style={styles.editInputDesc}
        value={desc}
        onChangeText={setDesc}
        placeholder="Line description"
        placeholderTextColor={themeColors.textMuted}
        multiline
      />
      <View style={styles.editInputRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.editLabel}>Qty</Text>
          <TextInput
            style={styles.editInputSmall}
            value={qty}
            onChangeText={setQty}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={themeColors.textMuted}
          />
        </View>
        <View style={{ width: 70 }}>
          <Text style={styles.editLabel}>Unit</Text>
          <TextInput
            style={styles.editInputSmall}
            value={unit}
            onChangeText={setUnit}
            placeholder="EA"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="characters"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.editLabel}>Unit Price ($)</Text>
          <TextInput
            style={styles.editInputSmall}
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={themeColors.textMuted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.editLabel}>Line Total</Text>
          <Text style={styles.editLineTotal}>{formatMoney(lineTotal)}</Text>
        </View>
      </View>
      <View style={styles.editActionsRow}>
        <TouchableOpacity onPress={onRemove} style={styles.deleteBtn}>
          <Trash2 size={14} color={Colors.errorDark} strokeWidth={1.75} />
          <Text style={[styles.deleteBtnText]}>Delete line</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            const nextPrice = Math.max(0, parseFloat(price) || 0);
            onCommit({
              description: desc.trim() || line.description,
              quantity: Math.max(0, parseFloat(qty) || 0),
              unit: unit.trim() || 'EA',
              unitPrice: nextPrice,
              // A hand-typed price is a manual override unless it exactly equals
              // one of the known sources (then keep that source's label).
              priceSource: nextPrice === line.engineRate?.rate ? 'engine'
                : nextPrice === line.aiUnitPrice ? 'ai' : 'manual',
            });
          }}
          style={styles.commitBtn}
        >
          <Check size={14} color={themeColors.surface} strokeWidth={1.75} />
          <Text style={styles.commitBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function countQuantities(t: PersistedTakeoff): number {
  const r = t.result;
  return (r.walls?.length ?? 0)
    + (r.floorAreas?.length ?? 0)
    + (r.doors?.length ?? 0)
    + (r.windows?.length ?? 0)
    + (r.finishes?.length ?? 0)
    + (r.fixtures?.length ?? 0)
    + (r.bulkMaterials?.length ?? 0);
}

/**
 * Build the AI pricing prompt. We send the takeoff quantities (with any user
 * overrides applied, rejected rows dropped) plus a location hint so the
 * model can pick regional unit prices. Output is a flat list of priced
 * lines grouped by CSI MasterFormat division.
 */
function buildPricingPrompt(
  t: PersistedTakeoff,
  apply: (section: string, id: string, fallback: number) => number | null,
  locationHint?: string,
): string {
  const r = t.result;
  const region = (locationHint && locationHint.trim().length > 0) ? locationHint.trim() : 'United States';

  const wallLines = r.walls
    .map(w => ({ ...w, length: apply('walls', w.id, w.lengthFt) }))
    .filter(w => w.length !== null)
    .map(w => `  - ${w.length} LF · ${w.category ?? 'wall'} · ${w.heightFt ? `${w.heightFt}ft tall` : 'height unknown'} · ${w.description}`)
    .join('\n');

  const floorLines = r.floorAreas
    .map(f => ({ ...f, sf: apply('floor', f.id, f.areaSqFt) }))
    .filter(f => f.sf !== null)
    .map(f => `  - ${f.sf} SF · ${f.roomName}${f.finishCode ? ` · ${f.finishCode}` : ''}`)
    .join('\n');

  const doorLines = r.doors
    .map(d => ({ ...d, count: apply('doors', d.id, d.count) }))
    .filter(d => d.count !== null)
    .map(d => `  - ${d.count} EA · ${d.description}${d.exterior ? ' (exterior)' : ' (interior)'}`)
    .join('\n');

  const windowLines = r.windows
    .map(w => ({ ...w, count: apply('windows', w.id, w.count) }))
    .filter(w => w.count !== null)
    .map(w => `  - ${w.count} EA · ${w.description}`)
    .join('\n');

  const finishLines = r.finishes
    .map(f => ({ ...f, qty: apply('finishes', f.id, f.quantity) }))
    .filter(f => f.qty !== null)
    .map(f => `  - ${f.qty} ${f.unit.toUpperCase()} · ${f.surface}: ${f.description}${f.code ? ` (${f.code})` : ''}`)
    .join('\n');

  const fixtureLines = r.fixtures
    .map(f => ({ ...f, count: apply('fixtures', f.id, f.count) }))
    .filter(f => f.count !== null)
    .map(f => `  - ${f.count} EA · ${f.category}: ${f.description}${f.mark ? ` (${f.mark})` : ''}`)
    .join('\n');

  const bulkLines = r.bulkMaterials
    .map(b => ({ ...b, qty: apply('bulkMaterials', b.id, b.quantity) }))
    .filter(b => b.qty !== null)
    .map(b => `  - ${b.qty} ${b.unit.toUpperCase()} · ${b.description}${b.notes ? ` · ${b.notes}` : ''}`)
    .join('\n');

  return `You are a senior estimator at a residential GC. Convert the takeoff quantities below into a priced estimate organized by CSI MasterFormat division.

PROJECT REGION: ${region}
TOTAL SQ FT: ${r.estimatedSquareFootage ?? 'unknown'}

TAKEOFF QUANTITIES:

WALLS:
${wallLines || '  (none)'}

FLOOR AREAS:
${floorLines || '  (none)'}

DOORS:
${doorLines || '  (none)'}

WINDOWS:
${windowLines || '  (none)'}

FINISHES:
${finishLines || '  (none)'}

FIXTURES:
${fixtureLines || '  (none)'}

BULK MATERIALS:
${bulkLines || '  (none)'}

INSTRUCTIONS:
1. Produce a list of priced line items that COVER all the takeoff quantities above. One quantity may produce multiple lines (e.g. wall LF → framing line + sheathing line + insulation line).
2. Each line: csiDivision (e.g. "06 - Wood, Plastics & Composites"), description (specific, contractor-readable), quantity (number), unit (LF/SF/EA/CY/etc.), unitPrice (USD installed cost incl. labor + material in this region), and an optional notes string for inclusions/exclusions.
3. Use REALISTIC current US installed unit costs for ${region}. If you don't know a regional rate, use a national-average rate.
4. Don't add lines for trades we don't have quantities for — just price what's in the takeoff.
5. Return JSON exactly matching the schema: { "lines": [...] }. No prose.

Be thorough and specific. The GC will review and edit every line; producing detailed priced lines saves the GC time vs. lump-sum allowances.`;
}

// ─── Styles ──────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  statusText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, marginTop: 12 },
  emptyTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 8 },
  emptyBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20 },

  headerBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 0.5, borderBottomColor: t.line,
  },
  headerBack: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  headerEyebrow: {
    fontSize: 10, fontWeight: '700' as const, color: t.accent,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
  headerTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: Tokens.radius.lg,
  },
  bannerText: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, lineHeight: 18 },
  bannerLink: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, textDecorationLine: 'underline' as const },

  sourceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '10',
  },
  sourceText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },
  sourceTextStrong: { fontWeight: '800' as const, color: t.text },

  divisionSection: { marginTop: 16, paddingHorizontal: 16 },
  divisionLabel: {
    fontSize: 11, fontWeight: '800' as const, color: t.textMuted,
    letterSpacing: 0.4, textTransform: 'uppercase' as const, marginBottom: 6,
  },

  lineRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 0.5, borderColor: t.line,
    marginBottom: 6,
  },
  lineDesc: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text, lineHeight: 18 },
  lineMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },
  lineTotal: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: t.text, minWidth: 80, textAlign: 'right' },

  sourceRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  sourcePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
    borderWidth: 0.5, borderColor: t.accent + '55',
    backgroundColor: t.accent + '10',
  },
  sourcePillActive: { backgroundColor: t.accent, borderColor: t.accent },
  sourcePillLabel: { fontSize: 10, fontWeight: '800' as const, color: t.accent, letterSpacing: 0.2 },
  sourcePillValue: { fontSize: 10, fontWeight: '700' as const, color: t.textSecondary },
  sourcePillLabelActive: { color: t.surface },

  lineRowEditing: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.accent,
    padding: 12, gap: 10, marginBottom: 6,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8,
  },
  editInputDesc: {
    borderWidth: 0.5, borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
    backgroundColor: Colors.fillSecondary,
    minHeight: 38,
  },
  editInputRow: { flexDirection: 'row', gap: 8 },
  editLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.3, textTransform: 'uppercase' as const, marginBottom: 3 },
  editInputSmall: {
    borderWidth: 0.5, borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 8, paddingVertical: 6,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
    backgroundColor: Colors.fillSecondary,
  },
  editLineTotal: {
    paddingVertical: 7, paddingHorizontal: 8,
    fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text,
  },
  editActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  deleteBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.errorDark },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  cancelBtnText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  commitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.sm, backgroundColor: t.accent,
  },
  commitBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.surface },

  addLineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderStyle: 'dashed' as const, borderColor: t.line,
    backgroundColor: 'transparent',
  },
  addLineText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.accent },

  totalsBar: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    backgroundColor: t.surface,
    borderTopWidth: 0.5, borderTopColor: t.line,
    paddingHorizontal: 16, paddingTop: 12,
    gap: 8,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -2 },
  },
  totalsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalsRowGrand: { paddingTop: 8, borderTopWidth: 0.5, borderTopColor: t.line },
  totalsLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  totalsValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  totalsGrandLabel: { fontSize: Type.body.fontSize, fontWeight: '800' as const, color: t.text },
  totalsGrandValue: { fontSize: Type.title3.fontSize, fontWeight: '900' as const, color: t.accent, letterSpacing: -0.3 },

  markupPickerRow: { flexDirection: 'row', gap: 4, marginLeft: 4 },
  markupPill: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
  },
  markupPillActive: { backgroundColor: t.accent },
  markupPillText: { fontSize: 11, fontWeight: '700' as const, color: t.textSecondary },
  markupPillTextActive: { color: t.surface },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, marginTop: 8,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent,
    shadowColor: t.accent, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  saveBtnText: { fontSize: Type.body.fontSize, fontWeight: '800' as const, color: t.surface, letterSpacing: 0.2 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, marginTop: 12,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent,
  },
  primaryBtnText: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.surface },
});
